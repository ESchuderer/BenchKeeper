import { Button, Group, List, Select, Stack, Text, Textarea } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Cli, Plan, Section } from './parts.jsx';
import { Loading, Note, useApi } from './shell.jsx';

// A file that does not exist yet starts as the smallest valid document of its family.
const START = { pins: '{\n  "schemaVersion": 1,\n  "phases": {}\n}\n', preset: '{\n  "schemaVersion": 1,\n  "presets": []\n}\n', policy: '{\n  "schemaVersion": 1\n}\n' };
const errorLine = (e) => `${e.rule}${e.path ? ` at ${e.path}` : ''}: ${e.message}`;

function FileEditor({ dir, entry, onDone }) {
  const [text, setText] = useState(entry.text ?? START[entry.family]);
  const [errors, setErrors] = useState(entry.errors);
  const [plan, setPlan] = useState(null);
  const [failed, setFailed] = useState(null);
  // Checked by the server's loader 300 ms after the last keystroke; an answer for an older text is dropped.
  const latest = useRef(text);
  useEffect(() => {
    latest.current = text;
    const timer = setTimeout(() => {
      api('/api/params-check', { dir, file: entry.file, text }).then((r) => { if (latest.current === text) setErrors(r.errors); }, (e) => setFailed(e.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);
  const review = async () => {
    setFailed(null);
    try { setPlan(await api('/api/params-plan', { dir, file: entry.file, text })); } catch (e) { setFailed(e.message); }
  };
  return (
    <Stack gap="sm">
      <Textarea label={entry.file} description={entry.text == null ? 'Not in the project yet' : undefined} value={text} onChange={(e) => { setText(e.currentTarget.value); setPlan(null); }}
        autosize minRows={8} maxRows={30} spellCheck={false} styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }} aria-invalid={errors.length > 0} />
      {errors.length > 0 && <List size="sm" aria-label={`Errors in ${entry.file}`}>{errors.map((e) => <List.Item key={errorLine(e)}>{errorLine(e)}</List.Item>)}</List>}
      {failed && <Note color="red" title="Not planned">{failed}</Note>}
      {plan
        ? <Section title="Changes"><Plan key={plan.planId} plan={plan} onDone={onDone} /></Section>
        : <Group><Button onClick={review} disabled={errors.length > 0}>Review change</Button></Group>}
    </Stack>
  );
}

// Presets, pins and the orchestrator policy of a registered project, as JSON checked by the loader doctor and CI use.
export function Editors({ overview, params, refresh }) {
  const projects = overview.data?.projects ?? [];
  const [dir, setDir] = useState(params.get('path') ?? projects[0]?.path ?? null);
  const [file, setFile] = useState(null);
  const state = useApi(dir ? `/api/params?${new URLSearchParams({ dir })}` : null);
  return (
    <Stack gap="lg">
      {!projects.length && <Note>Register a project first.</Note>}
      {!!projects.length && (
        <Group align="flex-end">
          <Select label="Project" data={projects.map((p) => p.path)} value={dir} onChange={(v) => { setDir(v); setFile(null); }} allowDeselect={false} comboboxProps={{ withinPortal: false }} miw={280} />
          {state.data && <Select label="File" data={state.data.map((f) => f.file)} value={file} onChange={setFile} placeholder="Choose a file" comboboxProps={{ withinPortal: false }} miw={280} />}
        </Group>
      )}
      {dir && (
        <Loading state={state} label="parameter files">
          {(data) => {
            const entry = data.find((f) => f.file === file);
            return entry ? <FileEditor key={`${dir}:${file}`} dir={dir} entry={entry} onDone={() => { state.reload(); refresh(); }} /> : <Text size="sm">{data.filter((f) => f.text != null).length} of {data.length} files exist.</Text>;
          }}
        </Loading>
      )}
      <Cli>{'benchkeeper pins list [dir]\nbenchkeeper doctor'}</Cli>
    </Stack>
  );
}
