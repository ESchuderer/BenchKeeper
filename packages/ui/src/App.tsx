import type { Api, components, RunEvent } from "@cedarloom/client";
import {
  Alert,
  Anchor,
  AppShell,
  Burger,
  Button,
  Group,
  NavLink,
  Stack,
  Table,
  Text,
  Title,
  useMatches,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Brain, ClipboardList, Gauge, History, MessagesSquare, Undo2, Users, Workflow } from "lucide-react";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { MessageId } from "@lingui/core";
// A file, never a data: URL: the server's CSP allows images from its own origin only.
import mark from "../../../brand/cedarloom-icon.svg?no-inline";
import { t, when } from "./i18n.ts";

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

const previewOf = ({ planHash, plan, findings }: components["schemas"]["UndoPreview"]): Preview => ({
  planHash,
  count: plan?.operations.length ?? 0,
  skipped: findings.length,
});

type Select = (runId: string) => void;

const RunsTable = ({ runs, selected, onSelect }: { runs: Run[]; selected: string | null; onSelect: Select }) => (
  // Narrow windows scroll the table, not the page.
  <Table.ScrollContainer minWidth={480}>
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
            <Table.Td>{t("run.kind", { kind: run.kind })}</Table.Td>
            <Table.Td>{t("run.status", { status: run.status })}</Table.Td>
            <Table.Td>{when(run.startedAt)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  </Table.ScrollContainer>
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

type Detail = { api: Api; runId: string; revision: number };

/** One run's undo, applied only with the hash of the preview shown; focus lands on its heading, then on the result. */
const RunDetail = ({ api, runId, revision }: Detail): ReactNode => {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [problem, setProblem] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const announced = useRef<HTMLParagraphElement>(null);
  const params = { params: { path: { runId } } };
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    let current = true;
    const show = async (): Promise<void> => {
      const answer = await call(() => api.GET("/api/runs/{runId}/undo", params));
      if (!current) return;
      setProblem("problem" in answer ? answer.problem : "");
      if ("data" in answer) setPreview(previewOf(answer.data));
    };
    void show();
    // A later preview of this run replaces this one; an answer that arrives after it is dropped.
    return () => void (current = false);
  }, [api, runId, version, revision]);
  const undo = async (approve: string): Promise<void> => {
    setBusy(true);
    const answer = await call(() => api.POST("/api/runs/{runId}/undo", { ...params, body: { approve } }));
    const undoRun = "data" in answer ? answer.data.runId : null;
    const text = "problem" in answer ? answer.problem : t("run.nothingToUndo");
    setStatus(undoRun === null ? text : t("run.undone", { runId: undoRun }));
    setBusy(false);
    setVersion((value) => value + 1);
    announced.current?.focus();
  };
  return (
    <Stack gap="xs">
      <Title order={3} size="h5" ref={heading} tabIndex={-1}>
        {t("run.title", { runId })}
      </Title>
      {problem !== "" && <Alert color="red">{problem}</Alert>}
      {preview && <UndoOffer preview={preview} busy={busy} onUndo={(hash) => void undo(hash)} />}
      <Text role="status" ref={announced} tabIndex={-1}>
        {status}
      </Text>
    </Stack>
  );
};

/** The page's session: the API client and its event stream. */
export type Session = { api: Api; listen: (onEvent: (event: RunEvent) => void, signal: AbortSignal) => Promise<void> };

/** The runs, newest first; the chosen run's undo comes first, so the keyboard reaches it before the table. */
const Runs = ({ session: { api, listen } }: { session: Session }): ReactNode => {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  // The stream gives the runs at once and on every change; a refusal names its findings.
  const update = useCallback((event: RunEvent): void => {
    if (event.event === "refusal") {
      setError(t("error.unreadable", { codes: event.findings.map((finding) => finding.code).join(", ") }));
      return;
    }
    setError("");
    setRuns(event.runs);
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    const stop = new AbortController();
    // When the stream ends or is refused, one request checks the API and shows what it answers wrong. The stream then
    // opens again, so a failed read, a store error or a server that comes back recovers on its own; only a lost
    // session stays lost. The wait is 1 s, doubled for each failed check in a row up to 30 s, so a store that stays
    // unreadable is not read, and logged, every second; an event resets it.
    let failures = 0;
    const onEvent = (event: RunEvent): void => {
      failures = 0;
      update(event);
    };
    const follow = async (): Promise<void> => {
      await listen(onEvent, stop.signal).catch(() => undefined);
      if (stop.signal.aborted) return;
      const answer = await call(() => api.GET("/api/runs"));
      const problem = "problem" in answer ? answer.problem : "";
      if (problem !== "") setError(problem);
      if (problem === t("session.lost")) return;
      failures += problem === "" ? 0 : 1;
      setTimeout(() => void follow(), Math.min(1000 * 2 ** failures, 30_000));
    };
    void follow();
    return () => stop.abort();
  }, [api, listen, update]);
  if (error !== "") return <Alert color="red">{error}</Alert>;
  if (runs === null) return null;
  if (runs.length === 0) return <Text>{t("runs.empty")}</Text>;
  return (
    <Stack>
      {selected && <RunDetail key={selected} api={api} runId={selected} revision={revision} />}
      <RunsTable runs={runs} selected={selected} onSelect={setSelected} />
    </Stack>
  );
};

const VIEWS = [
  { id: "nav.runs", icon: History },
  { id: "nav.workflows", icon: Workflow },
  { id: "nav.sessions", icon: MessagesSquare },
  { id: "nav.accounts", icon: Users },
  { id: "nav.memory", icon: Brain },
  { id: "nav.workItems", icon: ClipboardList },
  { id: "nav.usage", icon: Gauge },
] as const satisfies { id: MessageId; icon: unknown }[];

type View = (typeof VIEWS)[number]["id"];

// The editor and the zod schemas it needs load only when its view opens, so the shell and Runs stay small.
const WorkflowEditor = lazy(() => import("./workflow/Editor.tsx"));

const content = (view: View, session: Session): ReactNode => {
  if (view === "nav.runs") return <Runs session={session} />;
  if (view === "nav.workflows") {
    return (
      <Suspense fallback={null}>
        <WorkflowEditor api={session.api} />
      </Suspense>
    );
  }
  return <Text>{t("view.notBuilt")}</Text>;
};

/** The title, and below the sm breakpoint the button that shows the views. */
const Header = ({ opened, toggle }: { opened: boolean; toggle: () => void }): ReactNode => (
  <AppShell.Header px="md" style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <Burger
      opened={opened}
      onClick={toggle}
      hiddenFrom="sm"
      size="sm"
      aria-label={t("nav.toggle")}
      aria-expanded={opened}
      aria-controls="views"
    />
    <img src={mark} alt="" width={28} height={28} />
    <Title order={1} size="h3">
      {t("app.title")}
    </Title>
  </AppShell.Header>
);

/** The notices of the third-party code the page bundles, generated with each build. */
const Footer = (): ReactNode => (
  <AppShell.Footer px="md" style={{ display: "flex", alignItems: "center" }}>
    <Anchor href="licenses/third-party.txt" target="_blank" rel="noreferrer" size="xs">
      {t("app.licenses")}
    </Anchor>
  </AppShell.Footer>
);

/**
 * The shell: the views in the navigation, the chosen one in the main region. Below the sm breakpoint the navigation sits
 * behind a menu button; whichever of the two is out of sight is inert, so neither focus nor a screen reader lands there.
 */
export const App = ({ session }: { session: Session }): ReactNode => {
  const [view, setView] = useState<View>("nav.runs");
  const [opened, { toggle, close }] = useDisclosure();
  // The theme's own sm breakpoint, as AppShell uses it: at exactly 48em the desktop navigation already shows.
  const narrow = useMatches({ base: true, sm: false });
  return (
    <AppShell
      header={{ height: 56 }}
      footer={{ height: 32 }}
      navbar={{ width: 220, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <Header opened={opened} toggle={toggle} />
      <AppShell.Navbar p="xs" component="nav" id="views" aria-label={t("nav.label")} inert={narrow && !opened}>
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
      <AppShell.Main inert={narrow && opened}>
        <Title order={2} size="h4" mb="md">
          {t(view)}
        </Title>
        {content(view, session)}
      </AppShell.Main>
      <Footer />
    </AppShell>
  );
};
