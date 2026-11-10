import { resolve } from "node:path";
import { githubTracker } from "@cedarloom/adapter-github";
import { type Intent, IssueRef, type OutboxEntry, type Result, shown } from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import { Argument, type Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { refused } from "./commands.ts";
import { describe } from "./messages.ts";
import { type Context, EXIT, emit, fail } from "./output.ts";

type Done = (code: number) => void;

const issueRef = (value: string): IssueRef => {
  const [, repo, number] = /^([^#\s]+)#(\d{1,10})$/.exec(value) ?? [];
  const parsed = IssueRef.safeParse({ repo, number: Number(number) });
  if (!parsed.success) throw new InvalidArgumentError("give the issue as owner/repo#number");
  return parsed.data;
};

const what = (intent: Intent): string => {
  if (intent.kind === "create-label")
    return `create label ${shown(intent.label, 100)} (${intent.color}) on ${intent.repo}`;
  // The undo's preview names its cost: GitHub takes a deleted label off every issue.
  if (intent.kind === "delete-label") {
    return `delete label ${shown(intent.label, 100)} from ${intent.repo} and every issue that has it`;
  }
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
const hubTracker = async (ctx: Context): Promise<Result<ReturnType<typeof githubTracker>>> => {
  const hub = useCases.hubOf(ctx.config);
  if (!hub.ok) return hub;
  const token = await useCases.readSecret(useCases.HUB_ISSUES, ctx.io.keyring);
  return token.ok ? { ok: true, value: githubTracker(hub.value, token.value) } : token;
};

const send = async (ctx: Context): Promise<number> => {
  const tracker = await hubTracker(ctx);
  if (!tracker.ok) return refused(ctx, "outbox", tracker.finding);
  return listed(ctx, useCases.sendOutbox(ctx.state, tracker.value), "Nothing was due.");
};

// The labels of the profile's hub parts that the hub lacks: shown, or with --yes each queued as the owner approved it.
const labels = async (ctx: Context, yes?: true, project?: string): Promise<number> => {
  const tracker = await hubTracker(ctx);
  if (!tracker.ok) return refused(ctx, "outbox", tracker.finding);
  const missing = await useCases.previewHubLabels(ctx.config, tracker.value, project);
  if (!missing.ok) return refused(ctx, "intent", missing.finding);
  if (missing.value.length === 0 || yes !== true) {
    const lines = missing.value.map(({ intent }) => `Would queue: ${what(intent)}.`);
    const human = lines.length === 0 ? "The hub has every label the profile names." : lines.join("\n");
    const note = lines.length === 0 ? "" : "\nNothing changed. Run the command again with --yes.";
    emit(ctx, "intents", { intents: missing.value }, `${human}${note}`);
    return EXIT.ok;
  }
  const entries: OutboxEntry[] = [];
  for (const { intent, hash } of missing.value) {
    const queued = await useCases.queueIntent(ctx.state, ctx.config, intent, hash);
    if (!queued.ok) return refused(ctx, "outbox", queued.finding);
    entries.push(queued.value);
  }
  emit(ctx, "outbox", { entries }, `${entries.map(entryLine).join("\n")}\nSend it with: cedarloom work-items send`);
  return EXIT.ok;
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

// The owner's step: nothing here tells who asks.
const retry = async (ctx: Context, id: string): Promise<number> => {
  const entry = await useCases.retryEntry(ctx.state, id);
  if (!entry.ok) return refused(ctx, "outbox", entry.finding);
  emit(ctx, "outbox", { entries: [entry.value] }, `${entryLine(entry.value)}\nSend it with: cedarloom work-items send`);
  return EXIT.ok;
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
    .command("labels")
    .description("queue creating the labels the profile's hub parts name that the hub lacks; with --yes, queue them")
    .option("--project <folder>", "also the label of this project, named after its origin's GitHub repository")
    .option("--yes", "queue them as shown now")
    .action(async ({ yes, project }) =>
      done(await labels(ctx(), yes, project === undefined ? undefined : resolve(project))),
    );
  group
    .command("undo")
    .description("queue what takes a sent entry back; with --yes, queue it")
    .argument("<id>", "the outbox entry")
    .option("--yes", "queue it as shown now")
    .action(async (id, { yes }) => done(await undo(ctx(), id, yes)));
};

/**
 * The work-items commands, the owner's: nothing in them tells who asks, so a session's own sandbox or permission rules
 * keep it from the hub-issues token they send with. CedarLoom's own calls on hub issues use that token (A37).
 */
export const workItemsGroup = (program: Command, ctx: () => Context, done: Done): void => {
  const group = program.command("work-items").description("hub issues as work items: the owner's outbox and token");
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
    .description("send the due entries to the hub")
    .action(async () => done(await send(ctx())));
  group
    .command("retry")
    .description("queue a failed entry again, once its cause is fixed")
    .argument("<id>", "the outbox entry")
    .action(async (id) => done(await retry(ctx(), id)));
  writes(group, ctx, done);
};
