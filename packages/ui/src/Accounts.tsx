import type { Api, components } from "@cedarloom/client";
import { Alert, Button, Code, Group, NumberInput, Stack, Table, Text, Title, VisuallyHidden } from "@mantine/core";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { call } from "./call.ts";
import { t, when } from "./i18n.ts";

type Swap = components["schemas"]["SwapAccounts"];
type Account = Swap["accounts"][number];
type Approval = components["schemas"]["SwapApproval"] | components["schemas"]["SwapInstall"];
type Service = components["schemas"]["SwapService"];
/** A change of claude-swap's: a switch to one of its accounts, one of its settings set, its auto mode, its install. */
type Change = { account: number } | { key: Setting; value: number } | { auto: boolean } | { install: true };

const nameOf = ({ number, alias }: Account): string =>
  alias === undefined ? String(number) : t("accounts.name", { number, alias });

/** A window's share, when it resets, and whether claude-swap still trusts the share. */
const windowOf = ({ window, usedPercent, resetsAt, readAt }: Account["windows"][number]): string => {
  const [span = window, model = "none"] = window.split(":");
  const parts = [t("accounts.window", { span, model, percent: usedPercent })];
  // claude-swap's own text: a date the browser cannot read is left out, not thrown.
  if (resetsAt !== null && !Number.isNaN(Date.parse(resetsAt)))
    parts.push(t("accounts.resets", { when: when(resetsAt) }));
  if (readAt === null) parts.push(t("accounts.stale"));
  return parts.join(", ");
};

const stateOf = ({ active, disabled, held }: Account): string =>
  [active && t("accounts.active"), disabled && t("accounts.disabled"), held && t("accounts.held")]
    .filter(Boolean)
    .join(", ");

type Ask = (change: Change) => void;

/** An account with its state, its usage per window and its switch line; any but the active one can be switched to. */
const AccountRow = ({ account, busy, onAsk }: { account: Account; busy: boolean; onAsk: Ask }) => (
  <Table.Tr>
    <Table.Td>{nameOf(account)}</Table.Td>
    <Table.Td>{stateOf(account)}</Table.Td>
    <Table.Td>
      {account.windows.map((window) => (
        <Text key={window.window} size="sm">
          {windowOf(window)}
        </Text>
      ))}
    </Table.Td>
    <Table.Td>
      {account.threshold === null ? t("accounts.globalLine") : t("accounts.percent", { percent: account.threshold })}
    </Table.Td>
    <Table.Td>
      {!account.active && (
        <Button size="compact-sm" variant="default" loading={busy} onClick={() => onAsk({ account: account.number })}>
          {t("accounts.switch", { name: nameOf(account) })}
        </Button>
      )}
    </Table.Td>
  </Table.Tr>
);

const AccountTable = ({ accounts, busy, onAsk }: { accounts: Account[]; busy: boolean; onAsk: Ask }) => (
  <Table.ScrollContainer minWidth={640}>
    <Table striped>
      <Table.Caption c="bright">{t("accounts.caption")}</Table.Caption>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t("accounts.account")}</Table.Th>
          <Table.Th>{t("accounts.state")}</Table.Th>
          <Table.Th>{t("accounts.usage")}</Table.Th>
          <Table.Th>{t("accounts.line")}</Table.Th>
          <Table.Th>{t("accounts.action")}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {accounts.map((account) => (
          <AccountRow key={account.number} account={account} busy={busy} onAsk={onAsk} />
        ))}
      </Table.Tbody>
    </Table>
  </Table.ScrollContainer>
);

// claude-swap's switch lines: one for the 5-hour window, one for the weekly and model windows (unset: the first).
const LINES = [
  ["autoswitch.threshold", "fiveHour"],
  ["autoswitch.weeklyThreshold", "sevenDay"],
] as const;
type Setting = (typeof LINES)[number][0];

/** One of claude-swap's switch lines in percent, which claude-swap itself checks once it is set. */
const Line = ({
  setting,
  window,
  value,
  busy,
  onSet,
}: {
  setting: Setting;
  window: string;
  value: unknown;
  busy: boolean;
  onSet: Ask;
}) => {
  const [given, setGiven] = useState<string | number>(typeof value === "number" ? value : "");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onSet({ key: setting, value: Number(given) });
  };
  const label = t("accounts.threshold", { window, setting });
  return (
    <form onSubmit={submit}>
      <Group align="end">
        <NumberInput
          label={label}
          placeholder={t("accounts.unset")}
          suffix="%"
          min={0}
          max={100}
          clampBehavior="strict"
          allowNegative={false}
          decimalScale={1}
          required
          value={given}
          onChange={setGiven}
        />
        {/* Named after its line too, so a screen reader's list of buttons tells the two apart. */}
        <Button type="submit" loading={busy}>
          {t("accounts.change")}
          <VisuallyHidden> {label}</VisuallyHidden>
        </Button>
      </Group>
    </form>
  );
};

/**
 * claude-swap's command for a change, which runs only once the user approves it; for its install also the release and
 * where it comes from. It takes the focus.
 */
const Approve = ({
  approval,
  busy,
  onRun,
  onCancel,
}: {
  approval: Approval;
  busy: boolean;
  onRun: () => void;
  onCancel: () => void;
}) => {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [approval]);
  return (
    <Stack gap="xs">
      <Title order={3} size="h5" ref={heading} tabIndex={-1}>
        {"installer" in approval ? t("accounts.approveInstall") : t("accounts.approve")}
      </Title>
      <Code block>{approval.runs}</Code>
      {"installer" in approval && <Text>{t("accounts.source", approval)}</Text>}
      {approval.hint !== undefined && <Text>{approval.hint}</Text>}
      <Group>
        <Button loading={busy} onClick={onRun}>
          {t("accounts.run")}
        </Button>
        <Button variant="default" disabled={busy} onClick={onCancel}>
          {t("accounts.cancel")}
        </Button>
      </Group>
    </Stack>
  );
};

/** `auto`: claude-swap's auto mode, or why it cannot be read; `install`: claude-swap's extension failed to read it. */
type Read = { swap: Swap | null; auto: Service | string | null; problem: string; install: boolean };

/** claude-swap's accounts, settings and auto mode as its extension reads them now, read again on each `version`. */
const useSwap = (api: Api, version: number): Read => {
  const [read, setRead] = useState<Read>({ swap: null, auto: null, problem: "", install: false });
  useEffect(() => {
    let current = true;
    const show = async (): Promise<void> => {
      const answers = [call(() => api.GET("/api/accounts")), call(() => api.GET("/api/accounts/auto"))] as const;
      const [listed, auto] = await Promise.all(answers);
      if (!current) return;
      setRead({
        ...("data" in listed ? { swap: listed.data, problem: "" } : { swap: null, problem: listed.problem }),
        auto: "data" in auto ? auto.data : auto.problem,
        install: "codes" in listed && listed.codes.includes("extension.failed"),
      });
    };
    void show();
    return () => void (current = false);
  }, [api, version]);
  return read;
};

const Shown = ({ swap, busy, onAsk }: { swap: Swap; busy: boolean; onAsk: Ask }) => (
  <>
    <AccountTable accounts={swap.accounts} busy={busy} onAsk={onAsk} />
    <Title order={3} size="h5">
      {t("accounts.lines")}
    </Title>
    {LINES.map(([setting, window]) => (
      // Keyed by its value, so after a change the field shows the value claude-swap kept.
      <Line
        key={`${setting} ${String(swap.settings[setting])}`}
        setting={setting}
        window={window}
        value={swap.settings[setting]}
        busy={busy}
        onSet={onAsk}
      />
    ))}
  </>
);

/**
 * claude-swap's auto mode, which its menu bar service runs on macOS, on or off there through claude-swap's command; or
 * why it cannot be read, which leaves the accounts above as they are.
 */
const AutoMode = ({ auto, busy, onAsk }: { auto: Service | string; busy: boolean; onAsk: Ask }) => (
  <>
    <Title order={3} size="h5">
      {t("accounts.auto")}
    </Title>
    {typeof auto === "string" ? (
      <Text>{auto}</Text>
    ) : (
      <>
        {auto.service !== undefined && <Text>{auto.service}</Text>}
        <Text>{auto.hint}</Text>
      </>
    )}
    {typeof auto !== "string" && auto.service !== undefined && (
      <Group>
        <Button variant="default" loading={busy} onClick={() => onAsk({ auto: true })}>
          {t("accounts.autoOn")}
        </Button>
        <Button variant="default" loading={busy} onClick={() => onAsk({ auto: false })}>
          {t("accounts.autoOff")}
        </Button>
      </Group>
    )}
  </>
);

// Offered while claude-swap's extension cannot read the accounts, as when claude-swap is not installed.
const Install = ({ busy, onAsk }: { busy: boolean; onAsk: Ask }) => (
  <Group>
    <Button variant="default" loading={busy} onClick={() => onAsk({ install: true })}>
      {t("accounts.install")}
    </Button>
  </Group>
);

// Without an approval it asks for the command; with one it runs it, an install only as that approval named it.
const send = (api: Api, change: Change, approval?: Approval) => {
  const allow = approval !== undefined;
  if ("account" in change)
    return call(() => api.POST("/api/accounts/switch", { body: { account: change.account, allow } }));
  if ("key" in change) return call(() => api.POST("/api/accounts/settings", { body: { ...change, allow } }));
  if ("auto" in change) return call(() => api.POST("/api/accounts/auto", { body: { on: change.auto, allow } }));
  const named = approval !== undefined && "installer" in approval ? approval : null;
  const body = { allow: named && { installer: named.installer, runs: named.runs } };
  return call(() => api.POST("/api/accounts/install", { body }));
};
type Done = Exclude<Extract<Awaited<ReturnType<typeof send>>, { data: unknown }>["data"], Approval>;

// What a change did, as the page says it.
const outcomeOf = (change: Change, done: Done): string => {
  // claude-swap names the account active after the switch, which is the one it stayed on when it switched nothing.
  if ("to" in done) return t("accounts.switched", { account: done.to });
  if ("settings" in done) return "key" in change ? t("accounts.set", change) : "";
  if ("installed" in done) return t("accounts.installed", done);
  return [done.service, done.hint].filter((part) => part !== undefined).join(" ");
};

/**
 * claude-swap's accounts with their usage, its switch, switch lines and auto mode, and its install: CedarLoom keeps none
 * of it. A change asks claude-swap's extension for the command first and runs it only on the user's word; the outcome
 * takes the focus.
 */
export const Accounts = ({ api }: { api: Api }): ReactNode => {
  const [version, setVersion] = useState(0);
  const { swap, auto, problem, install } = useSwap(api, version);
  const [pending, setPending] = useState<{ change: Change; approval: Approval } | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("");
  const announced = useRef<HTMLParagraphElement>(null);
  const announce = (text: string): void => {
    setOutcome(text);
    announced.current?.focus();
  };
  // Without an approval it shows the command to approve; with one it runs it, shows a command that changed since to
  // approve again, and reads claude-swap anew.
  const ask = async (change: Change, approval?: Approval): Promise<void> => {
    setBusy(true);
    setOutcome("");
    if (approval === undefined) setPending(null);
    const answer = await send(api, change, approval);
    setBusy(false);
    setPending(null);
    if ("problem" in answer) announce(answer.problem);
    else if ("runs" in answer.data) setPending({ change, approval: answer.data });
    else announce(outcomeOf(change, answer.data));
    if (approval !== undefined) setVersion((value) => value + 1);
  };
  const cancel = (): void => {
    setPending(null);
    announce(t("accounts.cancelled"));
  };
  const onAsk = (change: Change): void => void ask(change);
  return (
    <Stack>
      {problem !== "" && <Alert color="red">{problem}</Alert>}
      {pending && (
        <Approve
          approval={pending.approval}
          busy={busy}
          onRun={() => void ask(pending.change, pending.approval)}
          onCancel={cancel}
        />
      )}
      <Text role="status" ref={announced} tabIndex={-1}>
        {outcome}
      </Text>
      {swap === null && problem === "" && <Text>{t("accounts.reading")}</Text>}
      {install && <Install busy={busy} onAsk={onAsk} />}
      {swap && <Shown swap={swap} busy={busy} onAsk={onAsk} />}
      {swap && auto !== null && <AutoMode auto={auto} busy={busy} onAsk={onAsk} />}
    </Stack>
  );
};
