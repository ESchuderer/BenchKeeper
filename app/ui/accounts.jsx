import { Badge, Button, Code, Group, Radio, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconCopy, IconLogin2, IconPlus, IconStar, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from './api.js';
import { CancelJob, Cli, Plan, Section, useJob } from './parts.jsx';
import { Dot, Loading, Note, icon, useApi } from './shell.jsx';

const AGENT = { claude: 'Claude Code', codex: 'Codex' };
const WINDOWS = [['fiveHour', '5-hour'], ['sevenDay', '7-day']];
const DOT = { ok: 'teal', warn: 'yellow', low: 'red', unknown: 'gray' };
const minimum = (l) => WINDOWS.map(([k, label]) => `${label} ${l.minimum[k]}%`).join(', ');
// What is left per rate limit window, from a Claude Code account's status line or a Codex app-server read; unknown says why.
function Usage({ usage, name, notAvailable }) {
  if (!usage) return notAvailable ? <Text size="sm">Usage: {notAvailable}</Text> : null;
  if (!usage.tracked) return <Text size="sm">Usage is not tracked: <Code>benchkeeper accounts track {name}</Code></Text>;
  return (
    <Stack gap={2} aria-label={`Usage of ${name}`}>
      {WINDOWS.map(([k, label]) => {
        const w = usage[k];
        return <Text size="sm" key={k}><Dot color={DOT[w.state]} /> {label}: {w.state === 'unknown' ? `unknown (${w.reason})` : `${w.remaining}% left, resets ${w.resetsAt.slice(0, 16).replace('T', ' ')} UTC`}</Text>;
      })}
    </Stack>
  );
}
const where = (a) => (a.mode === 'host' ? <Code style={{ overflowWrap: 'anywhere' }}>{a.dir}</Code> : <Text size="sm">Dev container volume <Code>{a.volume}</Code> at <Code>{a.mount}</Code></Text>);

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
        : <Note color="teal">{login?.loggedIn === false ? 'The sign-in ended but the account is not signed in.' : 'The account is signed in. Check it in the list.'}</Note>)}
      <CancelJob job={job} state={state} what="sign-in" />
    </Stack>
  );
}

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

// Several accounts per agent: the registry, the guided sign-in, a check before a launch. The registry holds no credential.
export function Accounts({ overview, refresh }) {
  const state = useApi('/api/accounts');
  const projects = overview.data?.projects ?? [];
  const [project, setProject] = useState(null);
  const [pending, setPending] = useState(null);
  const [signIn, setSignIn] = useState(null);
  const [checks, setChecks] = useState({});
  const [error, setError] = useState(null);
  const done = () => { state.reload(); refresh(); };
  const plan = async (body) => {
    setError(null);
    try { setPending(await api('/api/accounts-plan', body)); } catch (e) { setError(e.message); }
  };
  const check = async (a) => {
    setChecks((c) => ({ ...c, [a.name]: { busy: true } }));
    try {
      const result = await api(`/api/accounts-status?${new URLSearchParams({ name: a.name, ...(project ? { project } : {}) })}`);
      setChecks((c) => ({ ...c, [a.name]: { result } }));
    } catch (e) { setChecks((c) => ({ ...c, [a.name]: { error: e.message } })); }
  };
  const start = async (a) => {
    setError(null);
    try { setSignIn({ title: `Signing in ${a.name}`, ...(await api('/api/accounts-login', { name: a.name, ...(project ? { project } : {}) })) }); } catch (e) { setError(e.message); }
  };
  return (
    <Stack gap="lg">
      <Note>Several logins per agent, each in a folder of its own on this machine or in a volume of a dev container. Nothing here switches accounts for you: pick one when you start an agent. A change to the list is a plan with a diff and an undo, and the list holds no credential.</Note>
      <Note color="yellow"><Text span fw={700}>Dev containers. </Text>A hijacked session in a container can read the credentials in its volume. Run unknown code with the egress firewall of the Claude Code dev container documentation in mind. BenchKeeper never starts an agent with <Code>--dangerously-skip-permissions</Code>.</Note>
      {error && <Note color="red" title="Not done">{error}</Note>}
      <Loading state={state} label="accounts">
        {(data) => (
          <Stack gap="lg">
            <Section title="Accounts">
              {data.accounts.some((a) => a.mode === 'container') && (
                <Select label="Project of the dev container" description="Container accounts are checked and signed in inside this project's dev container" placeholder="Choose a project" clearable value={project} onChange={setProject}
                  data={projects.map((p) => ({ value: p.path, label: p.name ? `${p.name} (${p.path})` : p.path }))} />
              )}
              {data.accounts.length === 0
                ? <Text>No account yet. Add one below.</Text>
                : (
                  <Table.ScrollContainer minWidth={760} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': 'Accounts, scrollable' } }}>
                    <Table aria-label="Accounts" verticalSpacing="sm">
                      <Table.Thead><Table.Tr><Table.Th>Account</Table.Th><Table.Th>Agent</Table.Th><Table.Th>Where</Table.Th><Table.Th>Sign-in</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
                      <Table.Tbody>
                        {data.accounts.map((a) => {
                          const c = checks[a.name];
                          return (
                            <Table.Tr key={a.name}>
                              <Table.Td><Stack gap={2}><Text fw={600}>{a.name}</Text>{a.label && <Text size="sm">{a.label}</Text>}{a.default && <Badge variant="default" miw="max-content">default for {AGENT[a.agent]}</Badge>}{a.pool && <Badge variant="default" miw="max-content">pool {a.pool}</Badge>}{a.token.kept && <Badge variant="default" miw="max-content">token kept since {a.token.created.slice(0, 10)}</Badge>}</Stack></Table.Td>
                              <Table.Td>{AGENT[a.agent]}</Table.Td>
                              <Table.Td>{where(a)}</Table.Td>
                              <Table.Td miw={220}>
                                {c?.error && <Text size="sm" c="red">{c.error}</Text>}
                                {c?.result && (
                                  <Stack gap={2}>
                                    <Badge variant="default" miw="max-content" leftSection={<Dot color={c.result.loggedIn ? 'teal' : c.result.loggedIn === false ? 'red' : 'gray'} />}>{c.result.loggedIn === null ? 'not checked' : c.result.loggedIn ? `signed in${c.result.method ? ` (${c.result.method})` : ''}` : 'not signed in'}</Badge>
                                    <Usage usage={c.result.usage} name={a.name} notAvailable={c.result.notAvailable} />
                                    {c.result.findings.map((f) => <Text size="sm" key={f.message}>{f.message}. Fix: <Code>{f.fix}</Code></Text>)}
                                  </Stack>
                                )}
                                <Button size="compact-xs" variant="default" mt={4} onClick={() => check(a)} loading={c?.busy}>Check</Button>
                              </Table.Td>
                              <Table.Td miw={260}>
                                <Group gap="xs">
                                  <Button size="compact-xs" leftSection={icon(IconLogin2)} aria-label={`Sign in ${a.name}`} onClick={() => start(a)}>Sign in</Button>
                                  {!a.default && <Button size="compact-xs" variant="default" leftSection={icon(IconStar)} aria-label={`Use ${a.name} as the default ${AGENT[a.agent]} account`} onClick={() => plan({ op: 'use', name: a.name })}>Make default</Button>}
                                  <Button size="compact-xs" variant="default" color="red" leftSection={icon(IconTrash)} aria-label={`Remove ${a.name}`} onClick={() => plan({ op: 'remove', name: a.name })}>Remove</Button>
                                </Group>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
            </Section>
            {(signIn || data.login) && (
              <Section title="Sign in">
                <SignIn key={signIn?.job ?? data.login} job={signIn?.job ?? data.login} title={signIn?.title ?? 'A sign-in is running'} onDone={() => { state.reload(); refresh(); }} />
                <Group><Button variant="default" onClick={() => setSignIn(null)}>Close</Button></Group>
              </Section>
            )}
            {pending && (
              <Section title="Changes">
                <Plan key={pending.planId} plan={pending} onDone={done} />
                <Group><Button variant="default" onClick={() => setPending(null)}>Close</Button></Group>
              </Section>
            )}
            <Section title="Add account"><AddForm onPlan={setPending} /></Section>
            <Section title="Usage limits">
              <Text size="sm">Below the minimum headroom of a window (100 minus the used percentage), <Code>benchkeeper run</Code> warns and asks before it starts; a notice shows before that. Defaults: minimum {minimum({ minimum: data.settings.minimum })}, notice below {WINDOWS.map(([k, label]) => `${label} ${data.settings.warn[k]}%`).join(', ')}. Usage is read from the Claude Code status line of an account after <Code>benchkeeper accounts track</Code>; Codex has no documented source.</Text>
              <Text size="sm">Auto-pick is {data.settings.autoPick ? 'on' : 'off'}{data.settings.autoPick ? `; with no pool member above its minimum a launch ${data.settings.whenNone === 'wait' ? 'waits for the earliest reset' : 'stops'}` : ''}. When it is on, a new launch under the default account starts under another account of the same pool that has headroom, never inside a running session. The provider's consumer terms prohibit bypassing its protective measures and do not say whether switching accounts at a limit is one: the setting is yours to carry. Pool members must all be accounts of one person.</Text>
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
