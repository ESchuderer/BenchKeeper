import { api } from './api.js';

// Update all, one request per project, so the server's synchronous apply stays as it is and each row reports on its own.
// control.stop set to true ends the run after the project that is running; the rest are skipped.
export async function updateProjects(paths, push, onProgress, control) {
  const rows = paths.map((path) => ({ path, status: 'pending' }));
  onProgress([...rows]);
  for (const [i, row] of rows.entries()) {
    rows[i] = { ...row, status: 'running' };
    onProgress([...rows]);
    try { rows[i] = (await api('/api/update-all', { paths: [row.path], push }))[0] ?? { path: row.path, status: 'stopped', reason: 'no longer registered' }; } catch (e) { rows[i] = { path: row.path, status: 'stopped', reason: e.message }; }
    const stop = control?.stop;
    if (stop) for (let j = i + 1; j < rows.length; j++) rows[j] = { path: rows[j].path, status: 'skipped', reason: 'stopped by you' };
    onProgress([...rows]);
    if (stop) break;
  }
  return rows;
}
