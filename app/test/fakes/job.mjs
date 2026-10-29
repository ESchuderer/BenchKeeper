// Polled, not a fixed wait: under a loaded test run a job may take longer. A wait that runs out throws and names what it
// waited for, so the test does not go on with a half-done job and fail later on an assertion that reads like a product bug.
export const DEADLINE_MS = 10_000;

// Resolves with the first truthy value of f.
export async function waitFor(f, what, ms = DEADLINE_MS) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() >= end) throw new Error(`${what} not done after ${ms} ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Resolves with the state of the UI server's job once it is done.
export const jobDone = (routes, id, ms) => waitFor(() => { const s = routes['GET /api/job'](new URLSearchParams({ id })); return s.done && s; }, `job ${id}`, ms);
