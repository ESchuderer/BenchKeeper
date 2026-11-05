import type { Api, components } from "@cedarloom/client";
import { Alert, AppShell, Burger, Button, Group, NavLink, Stack, Table, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Brain, ClipboardList, Gauge, History, MessagesSquare, Undo2, Users } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type MessageId, t } from "./i18n.ts";

type Run = components["schemas"]["Run"];
type Preview = { planHash: string | null; count: number; skipped: number };
type Fetched<T> = { data: T; error?: never; response: Response } | { data?: never; error: unknown; response: Response };

/** The answer's data, or the sentence for the user: a lost session, a refusal with its codes, an unreachable server. */
const call = async <T,>(request: () => Promise<Fetched<T>>): Promise<{ data: T } | { problem: string }> => {
  try {
    const { data, error, response } = await request();
    if (data !== undefined) return { data };
    if (response.status === 401) return { problem: t("session.lost") };
    const codes = typeof error === "object" && error !== null && "findings" in error ? error.findings : null;
    const detail = Array.isArray(codes) ? codes.map((finding: { code: string }) => finding.code).join(", ") : "";
    return { problem: t("error.failed", { status: response.status, error: detail || JSON.stringify(error) }) };
  } catch {
    return { problem: t("error.unreachable") };
  }
};

// openapi-fetch drops the null-typed properties of a preview with nothing to undo from its type; they are null at runtime.
const previewOf = (data: { findings: unknown[] }): Preview => {
  const plan = "plan" in data ? data.plan : null;
  const operations = typeof plan === "object" && plan !== null && "operations" in plan ? plan.operations : [];
  const planHash = "planHash" in data && typeof data.planHash === "string" ? data.planHash : null;
  return { planHash, count: Array.isArray(operations) ? operations.length : 0, skipped: data.findings.length };
};

type Select = (runId: string) => void;

const RunsTable = ({ runs, selected, onSelect }: { runs: Run[]; selected: string | null; onSelect: Select }) => (
  <Table striped highlightOnHover>
    <Table.Caption c="bright">{t("runs.caption")}</Table.Caption>
    <Table.Thead>
      <Table.Tr>
        <Table.Th>{t("runs.run")}</Table.Th>
        <Table.Th>{t("runs.kind")}</Table.Th>
        <Table.Th>{t("runs.status")}</Table.Th>
        <Table.Th>{t("runs.started")}</Table.Th>
      </Table.Tr>
    </Table.Thead>
    <Table.Tbody>
      {runs.map((run) => (
        <Table.Tr key={run.id}>
          <Table.Td>
            <Button
              variant="subtle"
              size="compact-sm"
              ff="monospace"
              aria-pressed={run.id === selected}
              onClick={() => onSelect(run.id)}
            >
              {run.id.slice(0, 8)}
            </Button>
          </Table.Td>
          <Table.Td>{run.kind}</Table.Td>
          <Table.Td>{run.status}</Table.Td>
          <Table.Td>{new Date(run.startedAt).toLocaleString()}</Table.Td>
        </Table.Tr>
      ))}
    </Table.Tbody>
  </Table>
);

const UndoOffer = ({ preview, busy, onUndo }: { preview: Preview; busy: boolean; onUndo: (hash: string) => void }) => (
  <Stack gap="xs">
    {preview.planHash === null ? (
      <Text>{t("run.nothingToUndo")}</Text>
    ) : (
      <Group>
        <Text>{t("run.undoPlan", { count: preview.count })}</Text>
        <Button
          loading={busy}
          leftSection={<Undo2 size={16} aria-hidden />}
          onClick={() => onUndo(String(preview.planHash))}
        >
          {t("run.undo")}
        </Button>
      </Group>
    )}
    {preview.skipped > 0 && <Text>{t("run.skipped", { count: preview.skipped })}</Text>}
  </Stack>
);

/** One run's undo, applied only with the hash of the preview shown; focus lands on its heading, then on the result. */
const RunDetail = ({ api, runId, onUndone }: { api: Api; runId: string; onUndone: () => void }): ReactNode => {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const announced = useRef<HTMLParagraphElement>(null);
  const params = { params: { path: { runId } } };
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    let current = true;
    const show = async (): Promise<void> => {
      const answer = await call(() => api.GET("/api/runs/{runId}/undo", params));
      if (!current) return;
      if ("problem" in answer) setStatus(answer.problem);
      else setPreview(previewOf(answer.data));
    };
    void show();
    // A later preview of this run replaces this one; an answer that arrives after it is dropped.
    return () => void (current = false);
  }, [api, runId, version]);
  const undo = async (approve: string): Promise<void> => {
    setBusy(true);
    const answer = await call(() => api.POST("/api/runs/{runId}/undo", { ...params, body: { approve } }));
    const done = "data" in answer && answer.data.runId !== null;
    const text = "problem" in answer ? answer.problem : t("run.nothingToUndo");
    setStatus(done ? t("run.undone", { runId: answer.data.runId }) : text);
    setBusy(false);
    setVersion((value) => value + 1);
    onUndone();
    announced.current?.focus();
  };
  return (
    <Stack gap="xs">
      <Title order={3} size="h5" ref={heading} tabIndex={-1}>
        {t("run.title", { runId })}
      </Title>
      {preview && <UndoOffer preview={preview} busy={busy} onUndo={(hash) => void undo(hash)} />}
      <Text role="status" ref={announced} tabIndex={-1}>
        {status}
      </Text>
    </Stack>
  );
};

/** The runs, newest first; the chosen run's undo comes first, so the keyboard reaches it before the table. */
const Runs = ({ api }: { api: Api }): ReactNode => {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async (): Promise<void> => {
    const answer = await call(() => api.GET("/api/runs"));
    if ("problem" in answer) setError(answer.problem);
    else setRuns(answer.data.runs);
  }, [api]);
  useEffect(() => void load(), [load]);
  if (error !== "") return <Alert color="red">{error}</Alert>;
  if (runs === null) return null;
  if (runs.length === 0) return <Text>{t("runs.empty")}</Text>;
  return (
    <Stack>
      {selected && <RunDetail key={selected} api={api} runId={selected} onUndone={() => void load()} />}
      <RunsTable runs={runs} selected={selected} onSelect={setSelected} />
    </Stack>
  );
};

const VIEWS = [
  { id: "nav.runs", icon: History },
  { id: "nav.sessions", icon: MessagesSquare },
  { id: "nav.accounts", icon: Users },
  { id: "nav.memory", icon: Brain },
  { id: "nav.workItems", icon: ClipboardList },
  { id: "nav.usage", icon: Gauge },
] as const satisfies { id: MessageId; icon: unknown }[];

type View = (typeof VIEWS)[number]["id"];

const content = (view: View, api: Api): ReactNode =>
  view === "nav.runs" ? <Runs api={api} /> : <Text>{t("view.notBuilt")}</Text>;

/** The shell: the views in the navigation (behind a menu button on narrow screens), the chosen one in the main region. */
export const App = ({ api }: { api: Api }): ReactNode => {
  const [view, setView] = useState<View>("nav.runs");
  const [opened, { toggle, close }] = useDisclosure();
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header px="md" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label={t("nav.toggle")} />
        <Title order={1} size="h3">
          {t("app.title")}
        </Title>
      </AppShell.Header>
      <AppShell.Navbar p="xs" component="nav" aria-label={t("nav.label")}>
        {VIEWS.map(({ id, icon: Icon }) => (
          <NavLink
            key={id}
            component="button"
            label={t(id)}
            leftSection={<Icon size={18} aria-hidden />}
            active={view === id}
            aria-current={view === id ? "page" : undefined}
            onClick={() => {
              setView(id);
              close();
            }}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Title order={2} size="h4" mb="md">
          {t(view)}
        </Title>
        {content(view, api)}
      </AppShell.Main>
    </AppShell>
  );
};
