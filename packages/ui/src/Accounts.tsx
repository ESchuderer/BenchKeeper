import type { Api, components } from "@cedarloom/client";
import { Alert, Button, Code, Group, NumberInput, Stack, Table, Text, Title } from "@mantine/core";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { call } from "./call.ts";
import { t, when } from "./i18n.ts";

type Swap = components["schemas"]["SwapAccounts"];
type Account = Swap["accounts"][number];
type Approval = components["schemas"]["SwapApproval"];
/** A change of claude-swap's: a switch to one of its accounts, or one of its settings set. */
type Change = { account: number } | { key: string; value: string };

const nameOf = ({ number, alias }: Account): string =>
  alias === undefined ? String(number) : t("accounts.name", { number, alias });

/** A window's share, when it resets, and whether claude-swap still trusts the share. */
const windowOf = ({ window, usedPercent, resetsAt, readAt }: Account["windows"][number]): string => {
  const [span = window, model = "none"] = window.split(":");
  const parts = [t("accounts.window", { span, model, percent: usedPercent })];
  if (resetsAt !== null) parts.push(t("accounts.resets", { when: when(resetsAt) }));
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

/** One of claude-swap's switch lines in percent, which claude-swap itself checks once it is set. */
const Line = ({
  setting,
  window,
  value,
  busy,
  onSet,
}: {
  setting: string;
  window: string;
  value: unknown;
  busy: boolean;
  onSet: Ask;
}) => {
  const [given, setGiven] = useState<string | number>(typeof value === "number" ? value : "");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onSet({ key: setting, value: String(given) });
  };
  return (
    <form onSubmit={submit}>
      <Group align="end">
        <NumberInput
          label={t("accounts.threshold", { window, setting })}
          placeholder={t("accounts.unset")}
          suffix="%"
          min={0}
          max={100}
          decimalScale={1}
          required
          value={given}
          onChange={setGiven}
        />
        <Button type="submit" loading={busy}>
          {t("accounts.change")}
        </Button>
      </Group>
    </form>
  );
};

/** claude-swap's command for a change, which runs only once the user approves it; it takes the focus. */
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
        {t("accounts.approve")}
      </Title>
      <Code block>{approval.runs}</Code>
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

/** claude-swap's accounts and settings as its extension reads them now, read again on each `version`. */
const useSwap = (api: Api, version: number): { swap: Swap | null; problem: string } => {
  const [read, setRead] = useState<{ swap: Swap | null; problem: string }>({ swap: null, problem: "" });
  useEffect(() => {
    let current = true;
    const show = async (): Promise<void> => {
      const answer = await call(() => api.GET("/api/accounts"));
      if (current)
        setRead("data" in answer ? { swap: answer.data, problem: "" } : { swap: null, problem: answer.problem });
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
 * claude-swap's accounts with their usage, and its switch and switch lines: CedarLoom keeps none of it. A change asks
 * claude-swap's extension for the command first and runs it only on the user's word; the outcome takes the focus.
 */
export const Accounts = ({ api }: { api: Api }): ReactNode => {
  const [version, setVersion] = useState(0);
  const { swap, problem } = useSwap(api, version);
  const [pending, setPending] = useState<{ change: Change; approval: Approval } | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("");
  const announced = useRef<HTMLParagraphElement>(null);
  const send = (change: Change, allow: boolean) =>
    "account" in change
      ? call(() => api.POST("/api/accounts/switch", { body: { account: change.account, allow } }))
      : call(() => api.POST("/api/accounts/settings", { body: { ...change, allow } }));
  const announce = (text: string): void => {
    setOutcome(text);
    announced.current?.focus();
  };
  const ask = async (change: Change): Promise<void> => {
    setBusy(true);
    setOutcome("");
    const answer = await send(change, false);
    setBusy(false);
    if ("problem" in answer) announce(answer.problem);
    else if ("runs" in answer.data) setPending({ change, approval: answer.data });
  };
  const run = async ({ change }: { change: Change }): Promise<void> => {
    setBusy(true);
    const answer = await send(change, true);
    setBusy(false);
    setPending(null);
    if ("problem" in answer) announce(answer.problem);
    else announce("account" in change ? t("accounts.switched", change) : t("accounts.set", change));
    setVersion((value) => value + 1);
  };
  const cancel = (): void => {
    setPending(null);
    announce(t("accounts.cancelled"));
  };
  return (
    <Stack>
      {problem !== "" && <Alert color="red">{problem}</Alert>}
      {pending && <Approve approval={pending.approval} busy={busy} onRun={() => void run(pending)} onCancel={cancel} />}
      <Text role="status" ref={announced} tabIndex={-1}>
        {outcome}
      </Text>
      {swap === null && problem === "" && <Text>{t("accounts.reading")}</Text>}
      {swap && <Shown swap={swap} busy={busy} onAsk={(change) => void ask(change)} />}
    </Stack>
  );
};
