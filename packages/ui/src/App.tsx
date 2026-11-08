import type { Api, components, RunEvent } from "@cedarloom/client";
import {
  Alert,
  Anchor,
  AppShell,
  Burger,
  Button,
  Fieldset,
  Group,
  List,
  NavLink,
  Stack,
  Switch,
  Table,
  Text,
  Title,
  useMatches,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  Brain,
  ClipboardList,
  Download,
  Gauge,
  History,
  MessagesSquare,
  SlidersHorizontal,
  Undo2,
  Users,
  Workflow,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { MessageId } from "@lingui/core";
// A file, never a data: URL: the server's CSP allows images from its own origin only.
import mark from "../../../brand/cedarloom-icon.svg?no-inline";
import { call } from "./call.ts";
import { t, when } from "./i18n.ts";
import { Import } from "./Import.tsx";
import { describe } from "./workflow/problems.ts";

type Run = components["schemas"]["Run"];
type GraphRun = components["schemas"]["GraphRunSummary"];
type ProfileView = components["schemas"]["ProfileView"];
type Part = components["schemas"]["ProfilePart"];
type Preview = { planHash: string | null; count: number; skipped: number };

const previewOf = ({ planHash, plan, findings }: components["schemas"]["UndoPreview"]): Preview => ({
  planHash,
  count: plan?.operations.length ?? 0,
  skipped: findings.length,
});

type Select = (runId: string) => void;

type Row = { id: string; first: ReactNode; second: string; status: string; startedAt: string };

/** A table of runs, newest first, under its caption: the run, a second column, its status and when it started. */
const RunsFrame = ({ caption, second, rows }: { caption: string; second: string; rows: Row[] }) => (
  // Narrow windows scroll the table, not the page.
  <Table.ScrollContainer minWidth={480}>
    <Table striped highlightOnHover>
      <Table.Caption c="bright">{caption}</Table.Caption>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t("runs.run")}</Table.Th>
          <Table.Th>{second}</Table.Th>
          <Table.Th>{t("runs.status")}</Table.Th>
          <Table.Th>{t("runs.started")}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.id}>
            <Table.Td>{row.first}</Table.Td>
            <Table.Td>{row.second}</Table.Td>
            <Table.Td>{row.status}</Table.Td>
            <Table.Td>{when(row.startedAt)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  </Table.ScrollContainer>
);

const RunsTable = ({ runs, selected, onSelect }: { runs: Run[]; selected: string | null; onSelect: Select }) => {
  const rows = runs.map((run) => ({
    id: run.id,
    first: (
      <Button
        variant="subtle"
        size="compact-sm"
        ff="monospace"
        aria-pressed={run.id === selected}
        onClick={() => onSelect(run.id)}
      >
        {run.id.slice(0, 8)}
      </Button>
    ),
    second: t("run.kind", { kind: run.kind }),
    status: t("run.status", { status: run.status }),
    startedAt: run.startedAt,
  }));
  return <RunsFrame caption={t("runs.caption")} second={t("runs.kind")} rows={rows} />;
};

/** The workflows' runs: which workflow, and where it stands (its execution view comes later). */
const GraphRunsTable = ({ runs }: { runs: GraphRun[] }) => {
  const rows = runs.map((run) => ({
    id: run.id,
    first: (
      <Text span ff="monospace" size="sm">
        {run.id.slice(0, 8)}
      </Text>
    ),
    second: run.workflow,
    status: t("graphRun.status", { status: run.status }),
    startedAt: run.startedAt,
  }));
  return <RunsFrame caption={t("graphRuns.caption")} second={t("graphRuns.workflow")} rows={rows} />;
};

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
  const [graphRuns, setGraphRuns] = useState<GraphRun[]>([]);
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
    setGraphRuns(event.graphRuns);
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    const stop = new AbortController();
    // Reopens after 1 s, doubled per failed check up to 30 s, so an unreadable store is not read and logged every second.
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
  if (runs.length + graphRuns.length === 0) return <Text>{t("runs.empty")}</Text>;
  return (
    <Stack>
      {selected && <RunDetail key={selected} api={api} runId={selected} revision={revision} />}
      {runs.length > 0 && <RunsTable runs={runs} selected={selected} onSelect={setSelected} />}
      {graphRuns.length > 0 && <GraphRunsTable runs={graphRuns} />}
    </Stack>
  );
};

/** A part's switch; its description names its id, which the lines use, and the probe it is left to. */
const PartSwitch = ({ part, onSwitch }: { part: Part; onSwitch: (on: boolean) => void }) => (
  <Switch
    label={part.title}
    description={
      <>
        <Text span ff="monospace" inherit>
          {part.id}
        </Text>
        {part.when !== null && ` ${t("profile.when", { when: part.when })}`}
        {part.description !== null && ` ${part.description}`}
      </>
    }
    // The theme's dimmed description falls below 4.5:1 on white.
    styles={{ description: { color: "var(--mantine-color-text)" } }}
    checked={part.on}
    onChange={(event) => onSwitch(event.currentTarget.checked)}
  />
);

type OnSwitch = (part: string, on: boolean) => void;

/** The parts in a group per level, in the order the profile gives them. */
const Levels = ({ parts, onSwitch }: { parts: Part[]; onSwitch: OnSwitch }) =>
  [...Map.groupBy(parts, (part) => part.level)].map(([level, inLevel]) => (
    <Fieldset key={level} legend={t("profile.level", { level })}>
      <Stack gap="sm">
        {inLevel.map((part) => (
          <PartSwitch key={part.id} part={part} onSwitch={(on) => onSwitch(part.id, on)} />
        ))}
      </Stack>
    </Fieldset>
  ));

// A switch made while the last one applies is ignored, not disabled, which would drop the focus; the plan is live.
const Profile = ({ api }: { api: Api }): ReactNode => {
  const [view, setView] = useState<ProfileView | null>(null);
  const [problem, setProblem] = useState("");
  const busy = useRef(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    const show = async (): Promise<void> => {
      const answer = await call(() => api.GET("/api/profile"));
      if (!current) return;
      setProblem("problem" in answer ? answer.problem : "");
      if ("data" in answer) setView(answer.data);
      busy.current = false;
    };
    void show();
    return () => void (current = false);
  }, [api, version]);
  const choose = async (part: string, on: boolean): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    const answer = await call(() => api.PUT("/api/profile/parts/{part}", { params: { path: { part } }, body: { on } }));
    if ("data" in answer) return setVersion((value) => value + 1);
    setProblem(answer.problem);
    busy.current = false;
  };
  return (
    <Stack>
      {problem !== "" && <Alert color="red">{problem}</Alert>}
      {view && (
        <>
          <Text role="status">
            {view.held ? t("profile.held") : t("profile.plan", { count: view.plan?.operations.length ?? 0 })}
          </Text>
          {view.findings.length > 0 && (
            <List>
              {view.findings.map((finding) => (
                <List.Item key={JSON.stringify(finding)}>{describe(finding)}</List.Item>
              ))}
            </List>
          )}
          <Levels parts={view.parts} onSwitch={(part, on) => void choose(part, on)} />
        </>
      )}
    </Stack>
  );
};

const VIEWS = [
  { id: "nav.runs", icon: History },
  { id: "nav.workflows", icon: Workflow },
  { id: "nav.import", icon: Download },
  { id: "nav.profile", icon: SlidersHorizontal },
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
  if (view === "nav.profile") return <Profile api={session.api} />;
  if (view === "nav.import") return <Import api={session.api} />;
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
  <AppShell.Header px="md" style={{ display: "flex", alignItems: "center", gap: "var(--mantine-spacing-sm)" }}>
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

// Below sm the navigation sits behind a menu button; whichever of the two is out of sight is inert.
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
