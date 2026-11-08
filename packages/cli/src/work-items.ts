import { githubTracker } from "@cedarloom/adapter-github";
import { type Intent, IssueLink, IssueRef, type OutboxEntry, RepoName, type Result, shown } from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import { Argument, type Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { change, refused } from "./commands.ts";
import { describe } from "./messages.ts";
import { type Context, EXIT, emit, fail } from "./output.ts";

type Done = (code: number) => void;

const issueRef = (value: string): IssueRef => {
  const [, repo, number] = /^([^#\s]+)#(\d{1,10})$/.exec(value) ?? [];
  const parsed = IssueRef.safeParse({ repo, number: Number(number) });
  if (!parsed.success) throw new InvalidArgumentError("give the issue as owner/repo#number");
  return parsed.data;
};

const runIdOf = (value: string): string => {
  if (!IssueLink.shape.runId.safeParse(value).success) throw new InvalidArgumentError("give the run's id");
  return value;
};

const repoName = (value: string): string => {
  if (!RepoName.safeParse(value).success) throw new InvalidArgumentError("give the repository as owner/repo");
  return value;
};

const what = (intent: Intent): string => {
  const at = `${intent.issue.repo}#${intent.issue.number}`;
  if (intent.kind === "comment") return `comment on ${at}: ${shown(intent.body, 200)}`;
  if (intent.kind === "uncomment") return `delete comment ${intent.comment} of ${at}`;
  return `${intent.kind === "label" ? "add label" : "remove label"} ${shown(intent.label, 100)} on ${at}`;
};

const entryLine = ({ id, status, intent, finding }: OutboxEntry): string =>
  `${id}  ${status.padEnd(7)}  ${what(intent)}${finding === null ? "" : `\n    ${describe(finding)}`}`;

// Shown with its hash, or with --yes queued as the owner approved it.
const approve = async (
  ctx: Context,
  preview: Result<{ intent: Intent; hash: string }>,
  queue: (intent: Intent, hash: string) => Promise<Result<OutboxEntry>>,
  yes?: true,
): Promise<number> => {
  if (!preview.ok) return refused(ctx, "intent", preview.finding);
  const { intent, hash } = preview.value;
  if (yes !== true) {
    emit(
      ctx,
      "intent",
      { intent, hash },
      `Would queue: ${what(intent)}.\nNothing changed. Run the command again with --yes.`,
    );
    return EXIT.ok;
  }
  const queued = await queue(intent, hash);
  if (!queued.ok) return refused(ctx, "outbox", queued.finding);
  emit(
    ctx,
    "outbox",
    { entries: [queued.value] },
    `${entryLine(queued.value)}\nSend it with: cedarloom work-items send`,
  );
  return EXIT.ok;
};

const intend = (ctx: Context, input: unknown, yes?: true): Promise<number> =>
  approve(
    ctx,
    useCases.previewIntent(ctx.config, input),
    (intent, hash) => useCases.queueIntent(ctx.state, ctx.config, intent, hash),
    yes,
  );

const undo = async (ctx: Context, id: string, yes?: true): Promise<number> =>
  approve(
    ctx,
    await useCases.previewEntryUndo(ctx.state, id),
    (_, hash) => useCases.undoEntry(ctx.state, id, hash),
    yes,
  );

const listed = async (ctx: Context, read: Promise<Result<OutboxEntry[]>>, none: string): Promise<number> => {
  const entries = await read;
  if (!entries.ok) return refused(ctx, "outbox", entries.finding);
  emit(ctx, "outbox", { entries: entries.value }, entries.value.map(entryLine).join("\n") || none);
  return EXIT.ok;
};

// The hub's tracker with the hub-issues token from the OS credential store; the token goes to GitHub only.
const send = async (ctx: Context): Promise<number> => {
  const hub = useCases.hubOf(ctx.config);
  if (!hub.ok) return refused(ctx, "outbox", hub.finding);
  const token = await useCases.readSecret(useCases.HUB_ISSUES, ctx.io.keyring);
  if (!token.ok) return refused(ctx, "outbox", token.finding);
  return listed(
    ctx,
    useCases.sendOutbox(ctx.state, ctx.config, githubTracker(hub.value, token.value)),
    "Nothing was due.",
  );
};

// Never prints the token, not even in part.
const storeToken = async (ctx: Context): Promise<number> => {
  const { name } = useCases.HUB_ISSUES;
  const token = await ctx.io.stdin();
  if (token === null) return fail(ctx, "secret", [{ code: "secret.no-input", params: { name } }], EXIT.usage);
  const stored = await useCases.storeHubToken(token, ctx.io.keyring);
  if (!stored.ok) return fail(ctx, "secret", [stored.finding], EXIT.refused);
  emit(ctx, "secret", { name }, `Stored the ${name} token in the OS credential store.`);
  return EXIT.ok;
};

// The owner's step: nothing here tells who asks, and a worker's sandbox keeps it from the token a send needs.
const retry = async (ctx: Context, id: string): Promise<number> => {
  const entry = await useCases.retryEntry(ctx.state, id);
  if (!entry.ok) return refused(ctx, "outbox", entry.finding);
  emit(ctx, "outbox", { entries: [entry.value] }, `${entryLine(entry.value)}\nSend it with: cedarloom work-items send`);
  return EXIT.ok;
};

const link = async (ctx: Context, runId: string, issue: IssueRef): Promise<number> => {
  const links = await useCases.linkRun(ctx.state, ctx.config, runId, issue);
  if (!links.ok) return refused(ctx, "links", links.finding);
  const lines = links.value.map((each) => `  ${each.issue.repo}#${each.issue.number}`);
  emit(ctx, "links", { runId, links: links.value }, [`Run ${runId} is linked to:`, ...lines].join("\n"));
  return EXIT.ok;
};

const mirror = (ctx: Context, repo: string, on: boolean, yes?: true): number => {
  const plan = useCases.planMirroring(ctx.config, repo, on);
  if (!plan.ok) return refused(ctx, "plan", plan.finding);
  const note = on
    ? `\n  The next send posts a comment for each ended run of ${repo} linked to a hub issue, once.`
    : `\n  Runs of ${repo} post nothing.`;
  return change(ctx, plan.value, { note, data: { repository: repo, mirroring: on }, findings: [] }, yes);
};

const writes = (group: Command, ctx: () => Context, done: Done): void => {
  const issue = new Argument("<issue>", "the hub issue as owner/repo#number").argParser(issueRef);
  group
    .command("comment")
    .description("queue a comment on a hub issue; with --yes, queue it")
    .addArgument(issue)
    .argument("<text>", "the comment")
    .option("--yes", "queue it as shown now")
    .action(async (at, body, { yes }) => done(await intend(ctx(), { kind: "comment", issue: at, body }, yes)));
  group
    .command("label")
    .description("queue adding a label to a hub issue, or with --remove taking it off; with --yes, queue it")
    .addArgument(issue)
    .argument("<label>", "the label's name")
    .option("--remove", "take the label off")
    .option("--yes", "queue it as shown now")
    .action(async (at, label, { remove, yes }) =>
      done(await intend(ctx(), { kind: remove === true ? "unlabel" : "label", issue: at, label }, yes)),
    );
  group
    .command("undo")
    .description("queue what takes a sent entry back; with --yes, queue it")
    .argument("<id>", "the outbox entry")
    .option("--yes", "queue it as shown now")
    .action(async (id, { yes }) => done(await undo(ctx(), id, yes)));
};

/**
 * The work-items commands, the owner's: a worker's sandbox keeps it from the hub-issues token they send with (owner,
 * 2026-11-08). CedarLoom's own calls on hub issues use that token (A37).
 */
export const workItemsGroup = (program: Command, ctx: () => Context, done: Done): void => {
  const group = program
    .command("work-items")
    .description("hub issues as work items: the owner's outbox, links and token");
  group
    .command("token")
    .description("store the hub-issues token, piped in on standard input, in the OS credential store")
    // Its only word on the command line would be the token: commander's errors never repeat it.
    .configureOutput({
      outputError: (_, write) =>
        write("error: work-items token takes no arguments or options: pipe the token in on standard input\n"),
    })
    .action(async () => done(await storeToken(ctx())));
  group
    .command("list")
    .description("the outbox's entries, oldest first")
    .action(async () => {
      const c = ctx();
      done(await listed(c, useCases.outboxEntries(c.state), "The outbox is empty."));
    });
  group
    .command("send")
    .description("send the due entries to the hub, after queuing the comments of linked runs that mirror")
    .action(async () => done(await send(ctx())));
  group
    .command("retry")
    .description("queue a failed entry again, once its cause is fixed")
    .argument("<id>", "the outbox entry")
    .action(async (id) => done(await retry(ctx(), id)));
  group
    .command("link")
    .description("link a run to a hub issue, in this machine's ledger only")
    .addArgument(new Argument("<run>", "the run's id").argParser(runIdOf))
    .addArgument(new Argument("<issue>", "the hub issue as owner/repo#number").argParser(issueRef))
    .action(async (runId, issue) => done(await link(ctx(), runId, issue)));
  group
    .command("mirror")
    .description("switch the posts of a project repository's linked runs on or off; with --yes, save it as one run")
    .addArgument(new Argument("<repository>", "the project repository as owner/repo").argParser(repoName))
    .addArgument(new Argument("<state>").choices(["on", "off"] as const))
    .option("--yes", "save it as computed now")
    .action((repo, state, { yes }) => done(mirror(ctx(), repo, state === "on", yes)));
  writes(group, ctx, done);
};
