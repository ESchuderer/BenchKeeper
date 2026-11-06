import { type Finding, type FindingCode, shown } from "@cedarloom/contracts";

type Params = { [F in Finding as F["code"]]: F["params"] };

const short = (hash: string | null): string => (hash === null ? "no file" : hash.slice(0, 12));
// An undo run that stopped is not undone itself: planning the undo of its target again starts from the files as they are.
const undoHint = (p: { runId: string; undoes: string | null }): string =>
  p.undoes === null
    ? `Undo it with: cedarloom runs undo ${p.runId} --yes`
    : `Plan the undo of run ${p.undoes} again with: cedarloom runs undo ${p.undoes} --yes`;

// An issue's path holds a document's own keys, which may come from elsewhere (an extension's manifest): shown safely.
const issueList = (issues: { path: string; code: string }[]): string =>
  issues.map((i) => `${shown(i.path, 200) || "(top)"} ${i.code}`).join(", ");
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
} as const;
const EXTENSION_STEPS = {
  stage: "stage its files",
  start: "start",
  initialize: "answer its handshake",
  run: "run an action",
} as const;
const INSTALL_REFUSALS = {
  "no-manifest": "its folder has no cedarloom-extension.json",
  entry: "the entry file its manifest names is not in its folder",
  protocol: "it needs a version of the extension protocol this CedarLoom does not speak",
  installed: "it is installed already",
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
  "document.newer-schema": (p) => `The document has schema version ${p.found}; this CedarLoom reads up to ${p.known}.`,
  "document.invalid": (p) => `The document does not match its schema: ${issueList(p.issues)}.`,
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
  "run.input-unknown": (p) => `The workflow has no input ${p.input}.`,
  "run.input-missing": (p) => `The workflow needs its input ${p.input}, which has no default.`,
  "run.input-invalid": (p) => `The input ${p.input} must be a ${p.type} value.`,
  "run.event-invalid": (p) =>
    `Event ${p.seq} of run ${p.runId} does not match its schema (${issueList(p.issues)}), so the run is not replayed.`,
  "run.lease-held": (p) =>
    `Process ${p.pid} holds run ${p.runId}; resuming the run takes it over once that process has ended.`,
  "run.finished": (p) => `Run ${p.runId} has ended (${p.status}); nothing of it runs any more.`,
  "run.report-only-apply": (p) =>
    `Run ${p.runId} only reports, so no apply run (${p.applyRun}) is recorded under it and nothing is written.`,
  "run.node-unsupported": (p) => `Node ${p.node} is a ${p.type} node, which this version does not run yet.`,
  "run.project-mismatch": (p) =>
    `Run ${p.runId} runs in ${p.project}, not in ${p.given}: a run stays in the folder it started in.`,
  "run.project-missing": (p) =>
    `The project folder ${p.project} is not there, so no command of the run could run there.`,
  "run.shell-missing": () => "No POSIX sh was found for the commands; on Windows, install Git for Windows.",
  "undo.file-edited": (p) => `${p.path} was edited after run ${p.runId} wrote it; it is left as it is.`,
  "undo.backup-missing": (p) => `The backup of ${p.path} from run ${p.runId} is gone; nothing was undone.`,
  "undo.backup-changed": (p) => `The backup of ${p.path} from run ${p.runId} was changed; nothing was undone.`,
  "store.busy": (p) => `Another CedarLoom process is applying changes in ${p.dir}; try again when it ends.`,
  "store.network-filesystem": (p) =>
    `The state folder ${p.dir} is on a network filesystem (${p.fsType}); use a local folder.`,
  "draft.not-found": (p) => `No draft of workflow ${p.id} in this state folder.`,
  "draft.too-large": (p) => `The draft of workflow ${p.id} has ${p.bytes} bytes; a draft holds at most ${p.limit}.`,
  "store.newer-schema": (p) => `The run store has schema version ${p.found}; this CedarLoom reads up to ${p.known}.`,
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
    `Input ${p.handle} of node ${p.node} waits for outputs of ${p.from} of which only one fires, so ${p.node} is always skipped; merge them in a join with policy any.`,
  "workflow.optional-input": (p) =>
    `Input ${p.handle} of node ${p.node} needs a value, but the workflow input ${p.input} it comes from is optional and has no default.`,
  "workflow.schedule-input": (p) =>
    `A schedule starts this workflow without inputs, so the required input ${p.input} needs a default.`,
  "workflow.report-only-write": (p) =>
    `Node ${p.node} may write files, but a schedule starts this workflow, and a scheduled run only reports.`,
  "workflow.report-only-extension": (p) =>
    `Node ${p.node} runs an extension action, which may write files or change other systems, but a schedule starts this workflow, and a scheduled run only reports.`,
  "workflow.extension-missing": (p) =>
    `Node ${p.node} runs ${p.type}, an extension action that is not installed, so the workflow cannot run until its extension is.`,
  "workflow.unreachable": (p) => `Nothing leads to node ${p.node} from the trigger, so it never runs.`,
  "workflow.stray-entry": (p) => `The ${p.section} section names node ${p.node}, which the workflow does not have.`,
  "accounts.registry-exists": (p) =>
    `${p.path} exists: BenchKeeper's registry is imported once, into a new registry; nothing was changed.`,
  "accounts.unknown-pool": (p) => `The registry has no ${p.agent} pool named ${p.pool}.`,
  "automation.unknown-folder": (p) => `No folder at ${p.path}; a project's level is set for a folder that exists.`,
  // Every quote checked at its source on 2026-11-06: three bullets of the Usage Policy's "Do Not Abuse Our Platform",
  // whose page is marked effective Nov 12, 2026, and the "ordinary use" sentence of the help article on logging in.
  "accounts.pool-terms": (p) =>
    `Confirm pool ${p.pool} only if you hold and pay for every account in it yourself. Anthropic's Usage Policy, in ` +
    "force from November 12, 2026 (https://www.anthropic.com/legal/aup), forbids users to " +
    '"create multiple accounts, to avoid detection, circumvent product guardrails", to "intentionally bypass or ' +
    'interfere with capabilities, restrictions, or guardrails established within our products", and to "provide ' +
    "access to Claude through unauthorized means, including services that route requests through consumer " +
    'subscriptions". Its help article says a subscription\'s usage "is designed to support ordinary use of native ' +
    'Anthropic applications, including the Claude web, desktop, and mobile applications and Claude Code" ' +
    "(https://support.claude.com/en/articles/13189465). Neither page says whether moving new work between accounts " +
    "you hold yourself falls under these rules.",
  "accounts.unknown-account": (p) => `The registry has no account named ${p.account}.`,
  "accounts.login-unsupported": (p) =>
    `Account ${p.account} is a ${p.agent} account; own homes and their login are for Claude Code accounts for now.`,
  "accounts.folder-taken": (p) => `${p.path} is a folder another account names already; it is not taken over.`,
  "accounts.home-not-own": (p) =>
    `Account ${p.account} names ${p.home}, not its own home on this machine, so nothing runs or logs in there: move it with cedarloom accounts home ${p.account} --yes, then log in with cedarloom accounts login ${p.account}.`,
  "accounts.home-linked": (p) =>
    `The own home of account ${p.account} is a link or lies in one (${p.path}), so nothing runs or logs in there; make ${p.path} a real folder.`,
  "accounts.home-missing": (p) =>
    `Account ${p.account} has no own home yet (${p.home}), so nothing runs on it; log in first with: cedarloom accounts login ${p.account}`,
  "accounts.home-unusable": (p) =>
    `The own home of account ${p.account} cannot be made or closed to its owner at ${p.path} (${p.error}), so nothing runs or logs in there.`,
  "accounts.login-failed": (p) =>
    `The login of account ${p.account} did not complete (${p.error}); run cedarloom accounts login ${p.account} again.`,
  "doctor.logged-out": (p) =>
    `Account ${p.account} is not logged in in its own home ${p.home}; log in with: cedarloom accounts login ${p.account}`,
  "doctor.login-elsewhere": (p) =>
    `Claude Code reads the login of account ${p.account} from ${p.configDirectory}, not from its own home ${p.home}; something in the environment points it there.`,
  "doctor.login-method": (p) =>
    `Account ${p.account} is logged in with ${p.method}, not with a Claude subscription (claude.ai); log in again with: cedarloom accounts login ${p.account}`,
  "doctor.login-unchecked": (p) => `The login of account ${p.account} could not be checked (${p.error}).`,
  "doctor.login-skipped": (p) =>
    `The login of account ${p.account} was not checked: a worker runs on it, and the check could renew its login.`,
  "launch.not-logged-in": (p) =>
    `Account ${p.account} shows no login in its own home (${p.reason}), so no worker starts on it and its CLI version is not checked; log in with: cedarloom accounts login ${p.account}`,
  "doctor.plugin-none": (p) =>
    `Workers run without the ${p.plugin} plugin: the pinned marketplace commit ${p.commit} has none yet, or it could not be fetched.`,
  "doctor.plugin-not-loaded": (p) =>
    `The ${p.plugin} plugin went with the latest worker but did not load with its skills${p.errors === "" ? "" : ` (${p.errors})`}.`,
  "launch.settings-unproven": (p) =>
    `The ${p.agent} CLI ${p.version} gave no proof that it applies the worker settings, sandbox included; no worker starts on it.`,
  "launch.account-full": (p) =>
    `Account ${p.account} runs ${p.max} workers already, its most at once; no worker starts on it until one ends.`,
  "launch.agent-unavailable": (p) =>
    `The ${p.agent} CLI could not report its version or run its contract check (${p.error}); no worker of it starts.`,
  "accounts.codex-switching-off": (p) =>
    `Pool ${p.pool} cannot be confirmed: switching between Codex accounts stays off until OpenAI's terms are reviewed.`,
  "launch.sandbox-overridden": (p) =>
    `The managed settings file ${p.path} sets ${p.key}, which loosens the worker sandbox or replaces the settings checked; no worker starts while it does.`,
  "launch.managed-settings-unreadable": (p) =>
    `The managed settings file ${p.path} cannot be read or parsed (${p.error}), so it may loosen the worker sandbox; no worker starts until it can.`,
  "launch.gh-login": (p) =>
    p.error === null
      ? "gh finds a token without GH_TOKEN, so a worker could fall back to it; the launch is refused."
      : `The check for a gh login without GH_TOKEN failed (${p.error}); the launch is refused.`,
  "extension.refused": (p) => `Extension ${p.extension} is not run: ${EXTENSION_REFUSALS[p.reason]}.`,
  "extension.failed": (p) => `Extension ${p.extension} failed to ${EXTENSION_STEPS[p.step]} (${p.error}).`,
  "extension.unknown": (p) => `Extension ${p.extension} is not installed.`,
  "extension.consent-needed": (p) =>
    `Extension ${p.extension} asks for more than you approved; nothing changed. Read what it adds, then apply exactly that plan with --approve <hash>.`,
  "extension.install-refused": (p) =>
    `${p.extension === null ? "The extension" : `Extension ${p.extension}`} is not installed: ${INSTALL_REFUSALS[p.reason]}.`,
  "git.failed": (p) => `Git failed to ${p.step} (${p.error}).`,
  "git.refused-source": (p) =>
    `The ${p.field} is refused before Git runs: it holds a password, a control character, a space or non-ASCII text, or starts with "-".`,
  "git.unsafe-entry": (p) => `${p.path} ${ENTRY_KINDS[p.kind]}, so nothing of the fetched tree is used.`,
  "git.too-large": (p) =>
    `${p.path ?? "The tree"} has ${p.found} ${p.unit}, more than the ${p.limit} a fetched tree may have; nothing of it is used.`,
};

const text = <C extends FindingCode>(code: C, params: Params[C]): string => messages[code](params);

/** The English sentence for a finding. */
export const describe = (finding: Finding): string => text(finding.code, finding.params);
