import { Badge, Button, Code, Group, Paper, Progress, Radio, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconCopy, IconLogin2, IconPlus, IconStar, IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { CancelJob, Cli, Plan, Section, useJob } from './parts.jsx';
import { Dot, Loading, Note, icon, useApi } from './shell.jsx';

const AGENT = { claude: 'Claude Code', codex: 'Codex' };
const WINDOWS = [['fiveHour', '5-hour'], ['sevenDay', '7-day']];
const DOT = { ok: 'teal', warn: 'yellow', low: 'red', unknown: 'gray' };
const minimum = (l) => WINDOWS.map(([k, label]) => `${label} ${l.minimum[k]}%`).join(', ');
// What is left per rate limit window, from a Claude Code account's status line or a Codex app-server read; unknown says why.
// Not tracked: a host account turns it on with one click (a plan applied at once, undone in History), a container account in a terminal.
function Usage({ a, status, onTrack }) {
  if (!status) return null;
  const { usage, notAvailable } = status;
  if (!usage) return notAvailable ? <Text size="sm">Usage: {notAvailable}</Text> : null;
  if (!usage.tracked && status.tracking) return <Text size="sm"><Dot color="gray" /> Usage is tracked: it shows after the next session of this account.</Text>;
  if (!usage.tracked) {
    return (
      <Group gap="xs">
        <Text size="sm"><Dot color="gray" /> Usage not tracked.</Text>
        {a.mode === 'host'
          ? <Button size="compact-xs" variant="default" aria-label={`Track usage of ${a.name}`} onClick={onTrack}>Track usage</Button>
          : <Code>benchkeeper accounts track {a.name} --project &lt;dir&gt;</Code>}
      </Group>
    );
  }
  return (
    <Stack gap={6} aria-label={`Usage of ${a.name}`}>
      {WINDOWS.map(([k, label]) => {
        const w = usage[k], known = w.state !== 'unknown';
        const text = known ? `${w.remaining}% left, resets ${w.resetsAt.slice(0, 16).replace('T', ' ')} UTC` : `unknown (${w.reason})`;
        return (
          <Stack gap={2} key={k}>
            <Text size="sm"><Dot color={DOT[w.state]} /> {label}: {text}</Text>
            <Progress.Root size="sm"><Progress.Section value={known ? w.remaining : 0} color={DOT[w.state]} aria-label={`${label} window of ${a.name}: ${text}`} /></Progress.Root>
          </Stack>
        );
      })}
    </Stack>
  );
}

// The sign-in as steps: the account, the private window (or the link to open in one), a code when the browser shows one,
// the check. The agent's own lines are below. A pasted code goes to the agent and is kept nowhere.
const STEPS = [['start', 'Account'], ['url', 'Private window'], ['code', 'Code'], ['verify', 'Check']];
function SignIn({ job, title, onDone }) {
  const state = useJob(job, onDone);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const login = state?.login;
  if (!state) return <Text size="sm">Starting the sign-in</Text>;
  const at = login ? (login.step === 'done' ? STEPS.length : Math.max(0, STEPS.findIndex(([k]) => k === login.step))) : 0;
  const send = async () => {
    setError(null);
    try { await api('/api/accounts-code', { job, code }); setCode(''); } catch (e) { setError(e.message); }
  };
  return (
    <Stack gap="sm">
      <Text fw={600}>{title}</Text>
      <Group component="ol" gap="md" p={0} m={0} style={{ listStyle: 'none' }} aria-label="Sign-in steps">
        {STEPS.map(([key, label], i) => (
          <li key={key}><Badge variant={i === at && !state.done ? 'filled' : 'default'} leftSection={<Dot color={i < at ? 'teal' : 'gray'} />}>{i + 1}. {label}{i < at ? ' (done)' : ''}</Badge></li>
        ))}
      </Group>
      {login?.url && (
        <Note color={login.browser ? 'teal' : 'yellow'}>
          <Stack gap="xs">
            <Text size="sm"><Text span fw={700}>{login.browser ? `Opened a private window in ${login.browser}. ` : 'Open this link in a private browser window. '}</Text>{login.browser ? 'Sign in to the account you want to add. If the window shows a code, paste it below.' : 'No supported browser was found, or this machine has no display. A normal window may be signed in to another account: use a private one.'}</Text>
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <Code style={{ overflowWrap: 'anywhere' }}>{login.url}</Code>
              <Button size="compact-xs" variant="default" leftSection={icon(IconCopy)} aria-label="Copy the sign-in link" onClick={() => navigator.clipboard?.writeText(login.url).catch(() => {})}>Copy</Button>
            </Group>
          </Stack>
        </Note>
      )}
      {login?.awaitingCode && !state.done && (
        <Group align="flex-end" gap="sm">
          <TextInput label="Code from the browser, only if it shows one" value={code} onChange={(e) => setCode(e.currentTarget.value)} autoComplete="off" spellCheck={false} w={320} />
          <Button onClick={send} disabled={!code.trim()}>Send code</Button>
        </Group>
      )}
      {error && <Note color="red" title="Not sent">{error}</Note>}
      {login?.lines.length > 0 && <Code block tabIndex={0} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} aria-label="Output of the sign-in">{login.lines.join('\n')}</Code>}
      {state.done && (state.error
        ? <Note color="red" title="Sign-in failed">{state.error}</Note>
        : <Note color="teal">{login?.loggedIn === false ? 'The sign-in ended but the account is not signed in.' : login?.account ? `Added ${login.account}. It is signed in.` : 'The account is signed in.'}</Note>)}
      <CancelJob job={job} state={state} what="sign-in" />
    </Stack>
  );
}

const ContainerRisk = () => <Note color="yellow"><Text span fw={700}>Dev containers. </Text>A hijacked session in a container can read the credentials in its volume. Run unknown code with the egress firewall of the Claude Code dev container documentation in mind. BenchKeeper never starts an agent with <Code>--dangerously-skip-permissions</Code>.</Note>;

function AddForm({ onPlan }) {
  const [v, setV] = useState({ name: '', agent: 'claude', where: 'host', label: '', mount: '', dir: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: typeof e === 'string' ? e : e.currentTarget.value });
  const submit = async () => {
    setBusy(true); setError(null);
    try { onPlan(await api('/api/accounts-plan', { op: 'add', name: v.name, agent: v.agent, container: v.where === 'container', label: v.label, mount: v.where === 'container' ? v.mount : '', dir: v.where === 'host' ? v.dir : '' })); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Stack gap="sm">
      {error && <Note color="red" title="Not planned">{error}</Note>}
      <Group align="flex-end" gap="sm">
        <TextInput label="Name" description="lower case letters, digits, - and _" value={v.name} onChange={set('name')} w={200} />
        <Select label="Agent" data={Object.entries(AGENT).map(([value, label]) => ({ value, label }))} value={v.agent} onChange={(x) => setV({ ...v, agent: x ?? 'claude' })} allowDeselect={false} w={160} />
        <TextInput label="Label (optional)" value={v.label} onChange={set('label')} w={200} />
      </Group>
      <Radio.Group label="Where the account lives" value={v.where} onChange={set('where')}>
        <Group mt={4}><Radio value="host" label="On this machine" /><Radio value="container" label="In a dev container" /></Group>
      </Radio.Group>
      {v.where === 'host'
        ? <TextInput label="Folder (optional)" description="default: a folder of its own below the BenchKeeper data folder in your home folder; it must not lie in the config folder" value={v.dir} onChange={set('dir')} />
        : <TextInput label="Mount path in the container" description="a folder its user can write, below its home folder; the account's volume is mounted there" value={v.mount} onChange={set('mount')} />}
      <Group><Button leftSection={icon(IconPlus)} onClick={submit} loading={busy} disabled={!v.name || (v.where === 'container' && !v.mount)}>Plan the new account</Button></Group>
    </Stack>
  );
}

// A plan applied at once (one click: make default, track usage), undone in History. Shows only a failure.
function Applying({ job, onDone }) {
  const state = useJob(job, onDone);
  if (!state?.done) return <Text size="sm">Saving</Text>;
  const failed = state.error ?? (state.run && state.run.status !== 'done' ? state.run.entries.find((e) => e.error)?.error ?? state.run.status : null);
  return failed ? <Note color="red" title="Not done">{failed}</Note> : null;
}

const AddButtons = ({ onAdd, size }) => (
  <Group gap="sm">
    {Object.entries(AGENT).map(([agent, label]) => <Button key={agent} size={size} leftSection={icon(IconPlus)} onClick={() => onAdd(agent)}>Add {label} account</Button>)}
  </Group>
);

function AccountCard({ a, c, onUse, onTrack, onSignIn, onRemove }) {
  const s = c?.result;
  const who = [s?.email, s?.plan].filter(Boolean).join(', ');
  return (
    <Paper component="article" withBorder p="md" aria-labelledby={`account-${a.name}`}>
      <Stack gap="sm">
        <Group gap="xs" justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={0} miw={0}>
            <Title order={3} size="h5" id={`account-${a.name}`} style={{ overflowWrap: 'anywhere' }}>{a.name}</Title>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{AGENT[a.agent]}{who ? `, ${who}` : ''}{a.label ? ` (${a.label})` : ''}</Text>
          </Stack>
          {a.default && <Badge color="teal" miw="max-content">For new sessions</Badge>}
        </Group>
        <Group gap="xs">
          <Badge variant="default" miw="max-content" leftSection={<Dot color={s?.loggedIn ? 'teal' : s?.loggedIn === false ? 'red' : 'gray'} />}>{c?.busy ? 'checking' : !s ? 'not checked' : s.loggedIn === null ? 'sign-in not read' : s.loggedIn ? 'signed in' : 'not signed in'}</Badge>
          {a.mode === 'container' && <Badge variant="default" miw="max-content">dev container</Badge>}
          {a.pool && <Badge variant="default" miw="max-content">pool {a.pool}</Badge>}
          {a.token.kept && <Badge variant="default" miw="max-content">token kept since {a.token.created.slice(0, 10)}</Badge>}
        </Group>
        {c?.error && <Text size="sm" c="red">{c.error}</Text>}
        <Usage a={a} status={s} onTrack={onTrack} />
        {s?.findings.filter((f) => f.level !== 'info').map((f) => <Text size="sm" key={f.message}>{f.message}. Fix: <Code>{f.fix}</Code></Text>)}
        <Group gap="xs">
          {!a.default && <Button size="compact-sm" leftSection={icon(IconStar)} aria-label={`Use for new sessions: ${a.name}`} onClick={onUse}>Use for new sessions</Button>}
          <Button size="compact-sm" variant="default" leftSection={icon(IconLogin2)} aria-label={`Sign in ${a.name}`} onClick={onSignIn}>Sign in</Button>
          <Button size="compact-sm" variant="default" color="red" leftSection={icon(IconTrash)} aria-label={`Remove ${a.name}`} onClick={onRemove}>Remove</Button>
        </Group>
      </Stack>
    </Paper>
  );
}

// Several accounts per agent: one card each with its sign-in and usage, add by sign-in, a check before a launch. The registry holds no credential.
export function Accounts({ overview, refresh }) {
  const state = useApi('/api/accounts');
  const projects = overview.data?.projects ?? [];
  const [project, setProject] = useState(null);
  const [pending, setPending] = useState(null);
  const [signIn, setSignIn] = useState(null);
  const [saving, setSaving] = useState(null);
  const [checks, setChecks] = useState({});
  const [error, setError] = useState(null);
  const done = () => { state.reload(); refresh(); };
  const plan = async (body) => {
    setError(null);
    try { setPending(await api('/api/accounts-plan', body)); } catch (e) { setError(e.message); }
  };
  // One click: the plan is applied without a review step; History has its run and undo.
  const now = async (body) => {
    setError(null);
    try {
      const p = await api('/api/accounts-plan', body);
      const bad = p.changes.find((x) => x.error);
      if (bad) throw new Error(bad.error);
      setSaving((await api('/api/apply', { planId: p.planId })).job);
    } catch (e) { setError(e.message); }
  };
  // Each entry notes the project it was asked for: an answer for a project no longer selected is dropped, and a card shows only the current project's entry.
  const asked = project ?? '';
  const check = async (a) => {
    const keep = (entry) => setChecks((c) => (c[a.name]?.project === asked ? { ...c, [a.name]: { project: asked, ...entry } } : c));
    setChecks((c) => ({ ...c, [a.name]: { ...(c[a.name]?.project === asked && c[a.name]), project: asked, busy: true } }));
    try {
      keep({ result: await api(`/api/accounts-status?${new URLSearchParams({ name: a.name, ...(project ? { project } : {}) })}`) });
    } catch (e) { keep({ error: e.message }); }
  };
  // Each card reads its sign-in and usage when the list loads; a container account once a project is chosen.
  const accounts = state.data?.accounts;
  useEffect(() => { for (const a of accounts ?? []) if (a.mode === 'host' || project) check(a).catch(console.error); }, [accounts, project]);
  const start = async (a) => {
    setError(null);
    try { setSignIn({ title: `Signing in ${a.name}`, ...(await api('/api/accounts-login', { name: a.name, ...(project ? { project } : {}) })) }); } catch (e) { setError(e.message); }
  };
  const add = async (agent) => {
    setError(null);
    try { setSignIn({ title: `Adding a ${AGENT[agent]} account`, ...(await api('/api/accounts-add', { agent })) }); } catch (e) { setError(e.message); }
  };
  return (
    <Stack gap="lg">
      <Text size="sm">Each login stays in the agent's own folder (mode 0700), never in BenchKeeper's config folder, History or a backup; the list keeps names, folders and dates, and a token goes only to the OS credential store when you ask for one.</Text>
      {error && <Note color="red" title="Not done">{error}</Note>}
      {saving && <Applying key={saving} job={saving} onDone={done} />}
      <Loading state={state} label="accounts">
        {(data) => (
          <Stack gap="lg">
            {(signIn || data.login) && (
              <Section title="Sign in">
                <SignIn key={signIn?.job ?? data.login} job={signIn?.job ?? data.login} title={signIn?.title ?? 'A sign-in is running'} onDone={done} />
                <Group><Button variant="default" onClick={() => setSignIn(null)}>Close</Button></Group>
              </Section>
            )}
            {data.accounts.length === 0
              ? (
                <Section title="Accounts">
                  <Text fw={600}>No account yet</Text>
                  <AddButtons onAdd={add} size="lg" />
                  <Text size="sm">A second login lets you go on in a new session when one account reaches its usage limit. Each button opens a private browser window to sign in; the name comes from the account.</Text>
                </Section>
              )
              : (
                <Section title="Accounts">
                  {data.accounts.some((a) => a.mode === 'container') && (
                    <Select label="Project of the dev container" description="Container accounts are checked and signed in inside this project's dev container" placeholder="Choose a project" clearable value={project} onChange={setProject}
                      data={projects.map((p) => ({ value: p.path, label: p.name ? `${p.name} (${p.path})` : p.path }))} />
                  )}
                  <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                    {data.accounts.map((a) => (
                      <AccountCard key={a.name} a={a} c={checks[a.name]?.project === asked ? checks[a.name] : undefined} onUse={() => now({ op: 'use', name: a.name })} onTrack={() => now({ op: 'track', name: a.name })} onSignIn={() => start(a)} onRemove={() => plan({ op: 'remove', name: a.name })} />
                    ))}
                  </SimpleGrid>
                  <AddButtons onAdd={add} size="sm" />
                </Section>
              )}
            {pending && (
              <Section title="Changes">
                <Plan key={pending.planId} plan={pending} onDone={done} />
                <Group><Button variant="default" onClick={() => setPending(null)}>Close</Button></Group>
              </Section>
            )}
            {data.accounts.some((a) => a.mode === 'container') && <ContainerRisk />}
            <details>
              <summary>Advanced: choose the name, a folder of your own or a dev container</summary>
              <Stack gap="sm" mt="sm">
                <ContainerRisk />
                <AddForm onPlan={setPending} />
              </Stack>
            </details>
            <Section title="Usage limits">
              <Text size="sm">Below the minimum headroom of a window (100 minus the used percentage), <Code>benchkeeper run</Code> warns and asks before it starts; a notice shows before that. Defaults: minimum {minimum({ minimum: data.settings.minimum })}, notice below {WINDOWS.map(([k, label]) => `${label} ${data.settings.warn[k]}%`).join(', ')}. Usage of a Claude Code account is read from its status line once tracked, and for a signed-in Codex host account from its app-server at each check.</Text>
              <Text size="sm">Auto-pick is {data.settings.autoPick ? 'on' : 'off'}{data.settings.autoPick ? `; with no pool member above its minimum a launch ${data.settings.whenNone === 'wait' ? 'waits for the earliest reset' : 'stops'}` : ''}. When it is on, a new launch under the default Claude Code account starts under another Claude Code account of the same pool that has headroom, never inside a running session. The provider's consumer terms prohibit bypassing its protective measures and do not say whether switching accounts at a limit is one: the setting is yours to carry. Pool members must all be accounts of one person.</Text>
              {data.accounts.length > 0 && <Text size="sm">{data.accounts.map((a) => `${a.name}: ${minimum(a.limits)}`).join('; ')}</Text>}
            </Section>
            <Section title="Token for unattended containers">
              <Text size="sm">A one-year token for Claude Code (<Code>claude setup-token</Code>, subscription, model requests only) is kept in the OS credential store ({data.store === 'none' ? 'none is available on this system, so the command refuses' : data.store}), never in a file, the list, History or a log. It is set in a terminal, and it reaches one launch only with <Code>--token</Code>.</Text>
            </Section>
          </Stack>
        )}
      </Loading>
      <Cli>{'benchkeeper accounts list\nbenchkeeper accounts add [name] --agent claude|codex [--container --mount <path>]\nbenchkeeper accounts use|remove <name>\nbenchkeeper accounts status [name] [--project <dir>]\nbenchkeeper accounts track <name> [--off]\nbenchkeeper accounts limits [name] [--five-hour N] [--seven-day N] [--pool name] [--auto-pick on|off]\nbenchkeeper accounts login <name> [--token] [--project <dir>]\nbenchkeeper run --account <name> -- claude|codex'}</Cli>
    </Stack>
  );
}
