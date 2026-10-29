import { Button, Group, Modal, NumberInput, Stack, Switch, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Section } from './parts.jsx';
import { Loading, Note, useApi } from './shell.jsx';

// Preferences: how long the sessions cache keeps a summary after the agent deletes its transcript, and Clear.
export function SessionsHistory() {
  const cache = useApi('/api/sessions-cache');
  const [days, setDays] = useState(30);
  const [error, setError] = useState(null);
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const keep = cache.data?.keepDays;
  useEffect(() => { if (keep) setDays(keep); }, [keep]);
  const send = (body, said) => async () => {
    setError(null); setDone(''); setBusy(true);
    try { await api('/api/sessions-cache', body); setDone(said); cache.reload(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Section title="Sessions history">
      <Text size="sm" maw={720}>Claude Code deletes transcripts older than its cleanup period. The Sessions board keeps the summary of each session it has read (project, tier, setup, tokens, cost, tests, pull requests, times, never the messages), so older history comes from this cache and starts when the app first scanned.</Text>
      <Loading state={cache} label="sessions cache">{(c) => (
        <Stack gap="sm">
          <Text size="sm">{c.sessions} sessions in the cache.</Text>
          <Switch label="Drop summaries after a number of days" description="Off keeps them until you clear the cache." checked={!!c.keepDays} disabled={busy}
            onChange={(e) => send({ keepDays: e.currentTarget.checked ? Number(days) || 30 : null }, e.currentTarget.checked ? 'Retention set.' : 'Summaries are kept.')()} />
          {!!c.keepDays && (
            <Group align="flex-end">
              <NumberInput label="Days since the last activity" min={1} max={3650} allowDecimal={false} value={days} onChange={setDays} w={200} />
              <Button variant="default" loading={busy} disabled={!Number.isInteger(days) || days < 1} onClick={send({ keepDays: days }, 'Retention set.')}>Set days</Button>
            </Group>
          )}
          <Group><Button variant="default" loading={busy} onClick={() => setAsking(true)}>Clear the sessions cache</Button></Group>
          <Modal opened={asking} onClose={() => setAsking(false)} withCloseButton={false} attributes={{ content: { 'aria-label': 'Clear the sessions cache?' } }}>
            <Stack gap="sm">
              <Title order={2} size="h4">Clear the sessions cache?</Title>
              <Text size="sm">{c.sessions} session {c.sessions === 1 ? 'summary goes' : 'summaries go'}. Those of transcripts the agent already deleted are gone for good; the next scan reads the others again.</Text>
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setAsking(false)}>Cancel</Button>
                <Button onClick={() => { setAsking(false); void send({ clear: true }, 'Cache cleared.')(); }}>Clear the cache</Button>
              </Group>
            </Stack>
          </Modal>
          {done && <Text size="sm" role="status">{done}</Text>}
          {error && <Note color="red" title="Not changed">{error}</Note>}
        </Stack>
      )}</Loading>
    </Section>
  );
}
