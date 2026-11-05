import type { Api, components } from "@cedarloom/client";
import { Alert, AppShell, Button, Group, NavLink, Stack, Table, Text, Title } from "@mantine/core";
import { Brain, ClipboardList, Gauge, History, MessagesSquare, Undo2, Users } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { type MessageId, t } from "./i18n.ts";

type Run = components["schemas"]["Run"];
type Preview = { planHash: string | null; count: number };

// openapi-fetch drops the null-typed properties of a preview with nothing to undo from its type; they are null at runtime.
const previewOf = (data: object): Preview => {
  const plan = "plan" in data ? data.plan : null;
  const operations = typeof plan === "object" && plan !== null && "operations" in plan ? plan.operations : [];
  const planHash = "planHash" in data && typeof data.planHash === "string" ? data.planHash : null;
  return { planHash, count: Array.isArray(operations) ? operations.length : 0 };
};

const failure = (response: Response, error: unknown): string =>
  t("error.failed", { status: response.status, error: JSON.stringify(error) });

const RunsTable = ({ runs, onSelect }: { runs: Run[]; onSelect: (runId: string) => void }): ReactNode => (
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
            <Button variant="subtle" size="compact-sm" ff="monospace" onClick={() => onSelect(run.id)}>
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

/** One run: how many changes it made, and its undo, applied only with the hash of the preview shown here. */
const RunDetail = ({ api, runId, onUndone }: { api: Api; runId: string; onUndone: () => void }): ReactNode => {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState("");
  const params = { params: { path: { runId } } };
  useEffect(() => {
    const show = async (): Promise<void> => {
      const { data, error, response } = await api.GET("/api/runs/{runId}/undo", params);
      if (data === undefined) setStatus(failure(response, error));
      else setPreview(previewOf(data));
    };
    void show();
  }, [api, runId, status]);
  const undo = async (planHash: string): Promise<void> => {
    const { data, error, response } = await api.POST("/api/runs/{runId}/undo", {
      ...params,
      body: { approve: planHash },
    });
    const codes = error !== undefined && "findings" in error ? error.findings.map((f) => f.code).join(", ") : "";
    setStatus(
      data === undefined
        ? t("run.refused", { codes: codes || failure(response, error) })
        : t("run.undone", { runId: data.runId }),
    );
    onUndone();
  };
  return (
    <Stack gap="xs">
      {preview?.planHash ? (
        <Group>
          <Text>{t("run.undoPlan", { count: preview.count })}</Text>
          <Button leftSection={<Undo2 size={16} aria-hidden />} onClick={() => void undo(String(preview.planHash))}>
            {t("run.undo")}
          </Button>
        </Group>
      ) : (
        preview && <Text>{t("run.nothingToUndo")}</Text>
      )}
      <Text role="status">{status}</Text>
    </Stack>
  );
};

/** The runs, newest first; choosing one shows its undo. */
const Runs = ({ api }: { api: Api }): ReactNode => {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async (): Promise<void> => {
    const { data, error: refused, response } = await api.GET("/api/runs");
    if (data === undefined) setError(failure(response, refused));
    else setRuns(data.runs);
  }, [api]);
  useEffect(() => void load(), [load]);
  if (error !== "") return <Alert color="red">{error}</Alert>;
  if (runs === null) return null;
  if (runs.length === 0) return <Text>{t("runs.empty")}</Text>;
  return (
    <Stack>
      <RunsTable runs={runs} onSelect={setSelected} />
      {selected && <RunDetail api={api} runId={selected} onUndone={() => void load()} />}
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

/** The shell: the views in the navigation, the chosen one in the main region. */
export const App = ({ api }: { api: Api }): ReactNode => {
  const [view, setView] = useState<View>("nav.runs");
  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 220, breakpoint: "sm" }} padding="md">
      <AppShell.Header px="md" style={{ display: "flex", alignItems: "center" }}>
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
            onClick={() => setView(id)}
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
