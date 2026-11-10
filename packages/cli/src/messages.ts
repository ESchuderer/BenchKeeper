import { type Finding, type FindingCode, shown, WORKFLOW_MARKETPLACE } from "@cedarloom/contracts";

type Params = { [F in Finding as F["code"]]: F["params"] };

const short = (hash: string | null): string => (hash === null ? "no file" : hash.slice(0, 12));
// Quoted as Python's shlex.quote does, so pasting the command runs nothing of the path.
// shortcut: PowerShell reads an embedded quote as doubled (''), not \'; due once a Windows folder name holds one.
/** A folder as one shell word. */
export const folderArgument = (path: string): string =>
  /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
// An undo run that stopped is not undone itself: planning the undo of its target again starts from the files as they are.
const undoHint = (p: { runId: string; undoes: string | null }): string =>
  p.undoes === null
    ? `Undo it with: cedarloom runs undo ${p.runId} --yes`
    : `Plan the undo of run ${p.undoes} again with: cedarloom runs undo ${p.undoes} --yes`;

const PIPE =
  "Copy it, then pipe the clipboard in: pbpaste | cedarloom work-items token (macOS; wl-paste on Linux, Get-Clipboard in PowerShell).";
// An issue's path holds a document's own keys, which may come from elsewhere (an extension's manifest): shown safely.
const issueList = (issues: { path: string; code: string; char?: string | undefined }[]): string =>
  issues.map((i) => `${shown(i.path, 200) || "(top)"} ${i.char ?? i.code}`).join(", ");
const indented = (text: string, indent: string): string => `\n${indent}${text.replaceAll("\n", `\n${indent}`)}`;
// A node's input, or (node null) one of the workflow's own outputs.
const handleName = (p: { node: string | null; handle: string }): string =>
  p.node === null ? `The workflow output ${p.handle}` : `Input ${p.handle} of node ${p.node}`;

const EXTENSION_REFUSALS = {
  "sandbox-unavailable": "an extension from elsewhere runs only in an OS sandbox, and this CedarLoom has none yet",
  windows: "extensions from elsewhere do not run on native Windows",
  protocol: "it speaks another version of the extension protocol",
  actions: "it serves other actions than its manifest names",
  folder: "its folder has a * or ? in its path or a link inside, which would widen what it may read",
  runtime: "Node denies an extension the network only from version 25 on",
  off: "it is switched off (cedarloom components switch)",
  programs: "only an extension that ships with CedarLoom may have programs run for it",
} as const;
const EXTENSION_STEPS = {
  stage: "stage its files",
  start: "start",
  initialize: "answer its handshake",
  run: "run an action",
  doctor: "answer the doctor's checks",
} as const;
const INSTALL_REFUSALS = {
  "no-manifest": "its folder has no cedarloom-extension.json",
  entry: "the entry file its manifest names is not in its folder",
  protocol: "it needs a version of the extension protocol this CedarLoom does not speak",
  installed: "it is installed already",
  reserved: "its publisher, cedarloom, is CedarLoom's own, whose extensions come only with the app",
  programs: "it asks for programs to run, which only an extension that ships with CedarLoom may",
  id: "its folder now holds another extension",
} as const;

const ENTRY_KINDS = {
  link: "is a symbolic link",
  submodule: "is a submodule",
  name: 'is not a portable file name (letters, digits, ".", "_" and "-")',
  case: "differs from an earlier path in case only, which macOS and Windows would join",
} as const;

// shortcut: English text in code until the Lingui catalog package exists; the codes and parameters are the contract.
const messages: { [C in FindingCode]: (params: Params[C]) => string } = {
  "document.unreadable": (p) => `${p.path} cannot be read (${p.error}).`,
  "document.newer-schema": (p) =>
    `${p.path ?? "The document"} has schema version ${p.found}; this CedarLoom reads up to ${p.known}.`,
  "document.invalid": (p) => `${p.path ?? "The document"} does not match its schema: ${issueList(p.issues)}.`,
  "plan.not-approved": (p) => `The approval names plan ${short(p.approvedHash)}, not ${short(p.planHash)}.`,
  "plan.path-not-absolute": (p) =>
    `${p.path} is not an absolute, normalized path; plans name every file by its full path.`,
  "plan.not-a-file": (p) => `${p.path} is not a regular file (${p.error}); plans change files only.`,
  "plan.chain-broken": (p) =>
    `Operation ${p.index + 1} on ${p.path} expects ${short(p.found)}, but the operations before it leave ${short(p.expected)}; the plan is inconsistent and nothing was written.`,
  "plan.file-changed": (p) =>
    `${p.path} changed since the plan was made (${short(p.expected)} expected, ${short(p.actual)} found); make the plan again.`,
  "apply.symlink": (p) =>
    `${p.path} is a symbolic link; CedarLoom changes regular files only, so the link stays as it is.`,
  "apply.not-text": (p) => `${p.path} is not UTF-8 text; CedarLoom changes text files only, so it stays as it is.`,
  "apply.backup-failed": (p) => `The backup of ${p.path} failed (${p.error}); nothing was written to it.`,
  "apply.write-failed": (p) => `Changing ${p.path} failed (${p.error}).`,
  "apply.write-mismatch": (p) =>
    `${p.path} does not hold what was written (${short(p.expected)} expected, ${short(p.actual)} found); another program may write it.`,
  "run.not-found": (p) => `No run ${p.runId} in this state folder.`,
  "run.interrupted": (p) => `Run ${p.runId} was interrupted. ${undoHint(p)}`,
  "run.failed": (p) => `Run ${p.runId} stopped before its end; earlier changes of it stay. ${undoHint(p)}`,
  "run.node-unsupported": (p) => `Node ${p.node} is a ${p.type} node, which this version does not run yet.`,
  "undo.file-edited": (p) => `${p.path} was edited after run ${p.runId} wrote it; it is left as it is.`,
  "undo.backup-missing": (p) => `The backup of ${p.path} from run ${p.runId} is gone; nothing was undone.`,
  "undo.backup-changed": (p) => `The backup of ${p.path} from run ${p.runId} was changed; nothing was undone.`,
  "store.busy": (p) => `Another CedarLoom process is applying changes in ${p.dir}; try again when it ends.`,
  "store.network-filesystem": (p) =>
    `The state folder ${p.dir} is on a network filesystem (${p.fsType}); use a local folder.`,
  "draft.not-found": (p) => `No draft of workflow ${p.id} in this state folder.`,
  "import.not-found": (p) => `No planned import ${p.id}: it was applied, or is too old; review the import again.`,
  "draft.too-large": (p) => `The draft of workflow ${p.id} has ${p.bytes} bytes; a draft holds at most ${p.limit}.`,
  "store.newer-schema": (p) => `The run store has schema version ${p.found}; this CedarLoom reads up to ${p.known}.`,
  "store.older-schema": (p) =>
    `The run store in ${p.dir} is from before CedarLoom 0.1.0 (schema version ${p.found}; this one reads ${p.known}), and nothing from before 0.1.0 is carried over. Delete runs.sqlite, runs.sqlite-wal, runs.sqlite-shm and the backups folder there to start a new store.`,
  "workflow.duplicate-id": (p) => `More than one ${p.kind} has the id ${p.id}; ids are unique within a workflow.`,
  "workflow.trigger-count": (p) => `The workflow has ${p.count} trigger nodes; it needs exactly one.`,
  "workflow.unknown-node-type": (p) => `Node ${p.node} has the type ${p.type}, which this CedarLoom does not know.`,
  "workflow.invalid-config": (p) =>
    `The configuration of node ${p.node} does not match its type: ${issueList(p.issues)}.`,
  "workflow.dangling-edge": (p) =>
    `Edge ${p.edge} starts or ends at ${p.ref} (its ${p.end} end), which does not exist.`,
  "workflow.unknown-handle": (p) =>
    `Edge ${p.edge} uses the handle ${p.handle} at its ${p.end} end, which that node type lacks.`,
  "workflow.incompatible-handles": (p) =>
    `Edge ${p.edge} joins a ${p.from} output to a ${p.to} input, which cannot take it.`,
  "workflow.unchecked-handles": (p) =>
    `Edge ${p.edge} passes ${p.from} to a ${p.to} input; the value is checked only when the workflow runs.`,
  "workflow.many-sources": (p) => `${handleName(p)} gets ${p.count} edges; a data input takes one.`,
  "workflow.missing-source": (p) => `${handleName(p)} gets no edge, but it needs one.`,
  "workflow.cycle": (p) => `The nodes ${p.nodes.join(", ")} form a cycle; repeats need an explicit loop node.`,
  "workflow.join-branches": (p) => `Join ${p.node} has ${p.count} incoming branch edges; a join needs at least two.`,
  "workflow.duplicate-edge": (p) =>
    `Edge ${p.edge} joins the same output to the same input as edge ${p.of}; remove one.`,
  "workflow.exclusive-sources": (p) =>
    `Input ${p.handle} of node ${p.node} waits for outputs of ${p.from} of which only one fires, so ${p.node} is always skipped; give each branch a node of its own.`,
  "workflow.optional-input": (p) =>
    `Input ${p.handle} of node ${p.node} needs a value, but the workflow input ${p.input} it comes from is optional and has no default.`,
  "workflow.schedule-input": (p) =>
    `A schedule starts this workflow without inputs, so the required input ${p.input} needs a default.`,
  "workflow.report-only-write": (p) =>
    `Node ${p.node} may write files, but a schedule starts this workflow, and a scheduled run only reports.`,
  "workflow.unreachable": (p) => `Nothing leads to node ${p.node} from the trigger, so it never runs.`,
  "workflow.stray-entry": (p) => `The ${p.section} section names node ${p.node}, which the workflow does not have.`,
  "workflow.skill-name": (p) =>
    `Agent step ${p.node} writes its skill folder under the name ${p.name}, which is no skill name (a to z, 0 to 9, single hyphens inside); give the step a skill.`,
  "workflow.duplicate-skill": (p) =>
    `Agent steps ${p.node} and ${p.of} both write the skill folder ${p.name}; give one of them another skill.`,
  "workflow.check-source": (p) =>
    `Check ${p.node} starts from ${p.from}, but a check runs right after the done of the agent step it holds back.`,
  "workflow.check-output": (p) => `Check ${p.node} leads on from its ${p.handle}; a check leads on from done only.`,
  "package.two-stages": (p) =>
    `Node ${p.node} is reached from two stages, but each stage runs on its own, between the gates the automation level keeps.`,
  "package.cross-stage": (p) =>
    `Edge ${p.edge} passes a value from one stage to the next, but a stage keeps no value once a gate ends it.`,
  "package.name-taken": (p) =>
    `Node ${p.node} takes the name ${p.name}, which another node or stage of the package takes too; give an agent step another skill, or rename the node.`,
  "package.approval-needed": (p) => {
    const runs = p.commands.map((command) => indented(command, "      ")).join("");
    return `${p.plugin}, the workflow ${p.id} at ${p.level}, waits for your approval by name, as its guard and exit hooks run in every Claude Code session and its commands then run unasked: cedarloom workflows install ${p.id} --level ${p.level} --allow ${p.plugin} --yes. ${p.commands.length === 0 ? "It runs no command of its own." : `Its commands:${runs}`}`;
  },
  "package.hooks-missing": (p) =>
    `The guard's and the exit hook's bundles are missing from ${p.path}, where the CLI package ships them; in a checkout, build them with pnpm --filter @cedarloom/orchestration run build.`,
  "package.not-installed": (p) => `No package of the workflow ${p.id} is installed.`,
  "package.plugin-taken": (p) =>
    `The plugin ${p.plugin} holds the package of the workflow ${p.id}, whose id folds to the same name; uninstall that one first, or give one of the two workflows another id.`,
  "package.levels-mixed": (p) =>
    `The workflow ${p.other} is installed at ${p.otherLevel}, and ${p.id} at ${p.level}. Each package's guard binds the agents of every workflow script, so for their merges the strictest installed level holds: no workflow agent's merge passes while one package is below Auto. Install them at one level: cedarloom workflows install ${p.other} --level ${p.level}, or this one at ${p.otherLevel}.`,
  "package.codex-missing": (p) =>
    `Codex holds CedarLoom's packages but not ${p.plugin}, the workflow ${p.id}: codex plugin add ${p.plugin}@${WORKFLOW_MARKETPLACE}`,
  "package.codex-stale": (p) =>
    `Codex runs a copy of ${p.plugin}, the workflow ${p.id}, that differs from the one CedarLoom installed; add it again: codex plugin add ${p.plugin}@${WORKFLOW_MARKETPLACE}`,
  "package.codex-left": (p) =>
    `Codex still runs ${p.plugin}, which CedarLoom no longer installs: codex plugin remove ${p.plugin}@${WORKFLOW_MARKETPLACE}`,
  "package.node-missing": (p) =>
    `The hooks of ${p.plugin} run with ${p.path}, which is gone, so Claude Code refuses every shell call and agent they guard, in every session. Install its workflow again: cedarloom workflows install ${p.id ?? "<id>"}${p.level === null ? "" : ` --level ${p.level}`} --allow ${p.plugin} --yes`,
  "package.reserved-name": (p) =>
    `The package would be named ${p.name}, which Claude Code keeps for Anthropic's own plugins; give the workflow another id.`,
  "automation.unknown-folder": (p) => `No folder at ${p.path}; a project's level is set for a folder that exists.`,
  "extension.refused": (p) => `Extension ${p.extension} is not run: ${EXTENSION_REFUSALS[p.reason]}.`,
  "extension.failed": (p) => `Extension ${p.extension} failed to ${EXTENSION_STEPS[p.step]} (${p.error}).`,
  "extension.finding": (p) => `${p.extension}: ${p.message}`,
  "extension.unknown": (p) => `Extension ${p.extension} is not installed.`,
  "extension.consent-needed": (p) =>
    `Extension ${p.extension} asks for more than you approved; nothing changed. Read what it adds, then apply exactly that plan with --approve <hash>.`,
  "extension.install-refused": (p) =>
    `${p.extension === null ? "The extension" : `Extension ${p.extension}`} is not installed: ${INSTALL_REFUSALS[p.reason]}.`,
  "git.failed": (p) => `Git failed to ${p.step} (${p.error}).`,
  "store.conflict": (p) =>
    `The draft of ${p.id} was opened from another stored version than the one in the store now; save it on top with --on-top, or discard it.`,
  "store.version-not-higher": (p) =>
    `The draft of ${p.id} has version ${p.found}, which is not above the stored ${p.stored}; raise metadata.version.`,
  "store.identity-missing": (p) =>
    `Stored versions carry your Git identity, and ${p.key} is not set; set it with: git config --global ${p.key} "…"`,
  "store.moved": (p) =>
    `The workflow store's ${p.ref} is at ${p.actual?.slice(0, 12) ?? "no commit"}, not at ${p.expected?.slice(0, 12) ?? "no commit"} as planned; nothing moved. Plan again.`,
  "store.not-found": (p) =>
    `The workflow store holds no version of ${p.id}${p.commit === null ? "" : ` at ${p.commit.slice(0, 12)}`}.`,
  "store.draft-exists": (p) => `A draft of ${p.id} exists; save or discard it before opening a stored version.`,
  "git.refused-source": (p) =>
    `The ${p.field} is refused before Git runs: it holds a password, a control character, a space or non-ASCII text, or starts with "-".`,
  "git.unsafe-entry": (p) => `${p.path} ${ENTRY_KINDS[p.kind]}, so nothing of the fetched tree is used.`,
  "git.too-large": (p) =>
    `${p.path ?? "The tree"} has ${p.found} ${p.unit}, more than the ${p.limit} a fetched tree may have; nothing of it is used.`,
  "profile.foreign-kind": (p) =>
    `This is a "${p.kind}" file, not a CedarLoom profile. CedarLoom does not import BenchKeeper profiles or presets; remove BenchKeeper's setup with BenchKeeper, then apply a CedarLoom profile.`,
  "profile.secret-like": (p) =>
    `The profile holds what looks like a credential at ${p.path}. A profile is shared, so it is refused; keep the value in your environment or a secret store.`,
  "profile.forbidden-setting": (p) =>
    `The profile sets ${p.path}, which CedarLoom never writes: it removes a guard, runs a command or keeps your own choice.`,
  "profile.parent-unknown": (p) => `The parent profile ${p.path} is not in pack ${p.pack}.`,
  "profile.parent-cycle": (p) => `The profiles extend each other in a circle: ${p.chain.join(" -> ")}.`,
  "profile.parent-limit": (p) =>
    `The profile reaches more than ${p.limit} profile files through its parents, last ${p.chain.join(" -> ")}; nothing is read further.`,
  "profile.pack-sources": (p) =>
    `Pack ${p.pack} comes from different sources in ${p.files.join(" and ")}; give it one source in every profile file.`,
  "profile.entry-unknown": (p) => `Pack ${p.pack} has no ${p.kind} entry ${p.path} on this machine.`,
  "profile.app-too-old": (p) => `The profile needs CedarLoom ${p.minApp} or newer; this is ${p.app}. Update CedarLoom.`,
  "profile.part-unknown": (p) => `${p.by} names the part ${p.part}, which the profile does not have.`,
  "profile.part-requires": (p) =>
    `${p.part} needs ${p.requires}, which is off. Switch one: cedarloom profiles select ${p.requires} on, or cedarloom profiles select ${p.part} off`,
  "profile.binding-missing": (p) =>
    `${p.part} needs this machine's ${p.binding} repository. Name it: cedarloom profiles bind ${p.binding} ${p.binding === "gates" ? "<owner/repo@commit>" : "<owner/repo>"}, or switch the part off: cedarloom profiles select ${p.part} off`,
  "profile.drift": (p) => {
    const what = {
      missing: "lacks what the profile writes there; an apply writes it",
      outdated: "holds an older version of what the profile writes there; an apply updates it",
      "deselected-present": "is no longer part of the profile",
      "not-run": "was not checked, as a Git source of the profile could not be fetched",
    }[p.status];
    const removal = p.remove === null ? "" : `. Remove it: cedarloom profiles apply --remove ${p.remove}`;
    const next = p.remove === null && p.status === "deselected-present" ? "; an apply removes it" : "";
    return `${p.subject} ${what}${next}${removal}.`;
  },
  "profile.extra": (p) =>
    `${p.item} is not named by the profile. Remove it if you want: cedarloom profiles apply --remove ${p.item}`,
  "profile.remove-unknown": (p) =>
    `--remove names ${p.item}, which the plan does not offer to remove; cedarloom profiles check lists what it offers.`,
  "profile.copy-exists": (p) =>
    `${p.path} is there already or is the selection file; profiles init copies into a new file, so name another one.`,
  "profile.newer-pack": (p) =>
    `${p.path} was written from ${p.recorded}, newer than ${p.local} here; CedarLoom leaves it until it is updated here.`,
  "profile.binding-waiting": (p) =>
    `${p.part} stays off until this machine names its ${p.binding} source: cedarloom profiles bind ${p.binding} <owner/repo@commit>`,
  "profile.when-unmet": (p) =>
    `${p.part} is switched on but stays off while Orca is not here: install Orca, switch its extension back on with cedarloom components switch cedarloom.orca auto, or cedarloom profiles select ${p.part} default`,
  "profile.placeholder-unknown": (p) =>
    `The text at ${p.at} uses {{${p.placeholder}}}, which CedarLoom has no value for here.`,
  "profile.approval-needed": (p) => {
    const from =
      p.source === null
        ? "a marketplace Claude Code already knows"
        : `${p.source}${p.ref === null ? "" : ` at ${p.ref}`}`;
    const updates = p.autoUpdate ? ", updated by Claude Code by itself" : "";
    const where = p.project === null ? "" : ` --project ${folderArgument(p.project)}`;
    return `${p.part} adds or changes the plugin ${p.plugin} from ${from}${updates}; its hooks, MCP servers and commands would run in every session. It waits for your approval by name: cedarloom profiles apply${where} --allow ${p.part}`;
  },
  "profile.options-guarded": (p) =>
    `${p.part} writes its options to ${p.path}, inside a Claude Code home or CedarLoom's config or state, where a plugin's options never go.`,
  "profile.pack-unpinned": (p) =>
    `${p.source} follows a branch or tag, but ${p.path} may run; pin the source by commit and digest.`,
  "profile.source-digest": (p) =>
    `${p.source} has the digest ${p.found} at its commit, not the pinned ${p.expected}; nothing of it is used.`,
  "profile.source-waiting": (p) =>
    `${p.source} has a new commit ${p.commit.slice(0, 12)}; it is taken from ${p.offered}, 3 days after this machine first saw it.`,
  "profile.source-unavailable": (p) =>
    `${p.source} no longer has the commit in use, ${p.commit.slice(0, 12)}, while its new commit waits its 3 days; pin the source by commit and digest.`,
  "profile.target-approval": (p) => {
    const what = [
      ...(p.programs.length === 0 ? [] : [`${p.programs.join(", ")}, run as a program (mode 0755)`]),
      ...(p.configs.length === 0 ? [] : [`${p.configs.join(", ")}, configuration a tool reads to decide what to run`]),
    ];
    const from = p.source === null ? "" : `, from ${p.source}`;
    return `${p.part} (${p.title}) writes ${what.join("; and ")}${from}. It waits for your approval by name: cedarloom profiles apply --project ${folderArgument(p.project)} --allow ${p.part}`;
  },
  "profile.mcp-approval": (p) => {
    const files = p.entries.map(({ file }) => file).join(" and ");
    const codex = p.codex
      ? ""
      : " Codex gets no entry, as this project has no .codex/ folder; create one to add it there too.";
    const http = p.transport === "http";
    const named = `${p.variables.length === 1 ? "variable" : "variables"} ${p.variables.join(", ")}`;
    const bearer = p.variables.length === 0 ? "" : `, with your ${named} as its bearer token`;
    const env = p.variables.length === 0 ? "" : `, with your ${named}`;
    const unpinned = p.unpinned ? " Unpinned: it runs the newest release at each start." : "";
    const runs = http
      ? `Your agents connect to ${p.runs} themselves, outside their sandboxes, and send it what their sessions give its tools${bearer}.`
      : `It runs ${p.installed === null ? p.runs : `the bin of ${p.installed}, the locally installed package from the nearest folder that installs it, inside this repository,`} on this machine, outside the agents' sandboxes${env}.${unpinned}`;
    const written = p.entries
      .map(({ file, change, entry }) => {
        const label = change === "replace" ? `${file}, in place of the entry it wrote before:` : `${file}:`;
        return `\n      ${label}${indented(entry, "        ")}`;
      })
      .join("");
    return `${p.part} (${p.title}) writes the MCP server ${p.server} (${http ? "HTTP" : "stdio"}) into this project's committed ${files}, project scope.${codex} ${runs} Once committed, every claude -p run without --bare in the repository, yours and everyone's who clones it, ${http ? "connects to it" : "starts it"} without a trust prompt. It waits for your approval by name: cedarloom profiles apply --project ${folderArgument(p.project)} --allow ${p.part}. It writes:${written}`;
  },
  "profile.mcp-entry": (p) => {
    const entry = indented(p.entry, "      ");
    if (p.change === "add") return `${p.part} adds the MCP server ${p.server} to ${p.file}:${entry}`;
    if (p.change === "replace")
      return `${p.part} puts its new entry for the MCP server ${p.server} in ${p.file} in place of the one it wrote before:${entry}`;
    return `${p.part} is switched off, so the plan takes its MCP server ${p.server} out of ${p.file}:${entry}`;
  },
  "profile.mcp-conflict": (p) =>
    `${p.file} holds the MCP server ${p.server} with an entry CedarLoom did not write or that changed since, or in a form the plan cannot change alone, so the plan writes that server nowhere for ${p.part}. Remove or rename that entry, or write the servers as plain tables, to take the part's.`,
  "profile.mcp-kept": (p) =>
    `${p.part} is switched off, but its MCP server ${p.server} stays in ${p.file}, as that entry changed since CedarLoom wrote it or sits in a form the plan cannot take out alone; from this plan on, CedarLoom leaves it to you. Remove it by hand if the server should go.`,
  "profile.mcp-dependency": (p) =>
    `${p.part} starts ${p.package} from this project's own install, but package.json does not list ${p.package} as a devDependency at an exact version, so it adds nothing. Add it pinned, so Dependabot updates it: npm install --save-dev --save-exact ${p.package}`,
  "profile.mcp-outside-git": (p) =>
    `${p.part} starts ${p.package} from this project's own install, found by walking up to the repository's root, but this project is in no Git repository, so the walk could reach a parent folder's install; it adds nothing. Put the project under Git (git init) to take it.`,
  "profile.project-is-home": (p) =>
    `${p.project} is your home folder, so its .claude/settings.json and .codex/config.toml are Claude Code's and Codex's user config, which no profile writes. Plan a project folder of its own.`,
  "profile.target-linked": (p) =>
    `${p.part} writes ${p.target}, which a link leads to ${p.path}: outside the project, into its Git folder or onto a file only its own parts write. Remove the link or switch the part off.`,
  "profile.template-failed": (p) =>
    `${p.part} could not apply the Dev Container Template ${p.template}, so it writes nothing: ${shown(p.error, 300)}${/ENOENT/.test(p.error) ? ". Install the Dev Containers CLI: npm install -g @devcontainers/cli" : ""}`,
  "profile.target-twice": (p) =>
    `${p.part} writes ${p.target}, which another part of the profile writes too; switch one of them off.`,
  "profile.skill-plugin": (p) =>
    `The skill ${p.skill} holds ${p.path}, so Claude Code would load it as a plugin with its hooks and servers. Add it as a plugin part instead, which waits for your approval by name.`,
  "profile.skill-twice": (p) =>
    `${p.skills.join(" and ")} both install into ${p.folder}, as their names are the same; list only one of their packs.`,
  "profile.agents-unread": (p) =>
    `${p.path} does not import AGENTS.md, so Claude Code does not read CedarLoom's rules there. Add the line @AGENTS.md to it.`,
  "profile.owner-changed": (p) =>
    `${p.path} was changed or made outside CedarLoom since its last write, so the plan leaves it as it is.`,
  "outbox.not-approved": (p) =>
    `The approval names intent ${short(p.approvedHash)}, not ${short(p.hash)}; nothing was queued under ${p.key}.`,
  "outbox.not-found": (p) => `No outbox entry ${p.id} in this state folder.`,
  "outbox.key-taken": (p) => `Outbox entry ${p.id} holds another intent under ${p.key}; nothing was queued.`,
  "outbox.not-hub": (p) =>
    `Outbox entry ${p.id} writes to ${p.repo}, which is not the hub; CedarLoom writes to hub issues only, so it failed.`,
  "outbox.status": (p) =>
    p.status === "sending"
      ? `Another CedarLoom process is sending outbox entry ${p.id}.`
      : `Outbox entry ${p.id} is ${p.status}, so this step does not apply to it.`,
  "outbox.not-undoable": (p) =>
    p.reason === "unchanged"
      ? `Outbox entry ${p.id} changed nothing on its issue, so there is nothing to undo.`
      : `Outbox entry ${p.id} deleted a comment, which cannot be brought back.`,
  "tracker.unavailable": (p) => {
    const after = p.retryAfter === null ? "" : ` GitHub asks to wait ${shown(p.retryAfter, 20)} s.`;
    const reset =
      p.rateLimitReset === null ? "" : ` The rate limit resets at ${shown(p.rateLimitReset, 20)} (epoch seconds).`;
    return `The tracker did not take the write now (${shown(p.error, 300)}); the entry stays queued for the next send.${after}${reset}`;
  },
  "tracker.refused": (p) => `The tracker refused the write with HTTP ${p.status}: ${shown(p.error, 300)}`,
  "tracker.invalid-answer": (p) =>
    `The tracker's answer is not what CedarLoom reads (${shown(p.error, 300)}); the entry failed, and the write may have happened.`,
  "managed.guard-off": (p) =>
    p.key.startsWith("sandbox.")
      ? `${p.path} sets ${p.key} in Claude Code's managed policy, which switches the sandbox off for every Claude Code session on this machine.`
      : `${p.path} sets ${p.key} in Claude Code's managed policy, which switches hooks off for every Claude Code session on this machine, CedarLoom's guard among them.`,
  "managed.unreadable": (p) =>
    `${p.path} holds a managed Claude Code policy that cannot be read (${shown(p.error, 100)}), so whether it switches hooks or the sandbox off is unknown.`,
  "work-items.no-hub": () => "This machine binds no hub. Name it: cedarloom profiles bind hub <owner/repo> --yes",
  "work-items.not-hub": (p) =>
    `${p.repo} is not this machine's hub (${p.hub}); CedarLoom works on hub issues only, so nothing was queued or linked.`,
  "work-items.no-project-name": (p) =>
    `git found no origin naming exactly one GitHub repository in ${shown(p.project, 300)}, or its name has no letter or digit, so its project label has no name; nothing was queued.`,
  "work-items.label-too-long": (p) =>
    `The project label ${shown(p.label, 300)} is longer than the ${p.limit} characters GitHub takes; shorten the profile's projectLabel prefix or name the project in projectNames. Nothing was queued.`,
  "secret.missing": (p) => `No ${p.name} token is in the OS credential store. ${PIPE}`,
  "secret.unavailable": (p) =>
    `The OS credential store did not answer for ${p.name} (${shown(p.error, 300)}). Check that it is unlocked and, on Linux, that a Secret Service such as GNOME Keyring or KWallet runs.`,
  "secret.not-fine-grained": (p) =>
    `What was piped in is not a fine-grained GitHub token (github_pat_...), so nothing was stored as ${p.name}.`,
  "secret.no-input": (p) =>
    `The ${p.name} token is read from standard input only when it is piped in, as it would show at the terminal. ${PIPE}`,
};

const text = <C extends FindingCode>(code: C, params: Params[C]): string => messages[code](params);

/** The English sentence for a finding. */
export const describe = (finding: Finding): string => text(finding.code, finding.params);
