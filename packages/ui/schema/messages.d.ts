// Generated from locales/en/messages.po by `pnpm run catalog`; do not edit.
declare module "@lingui/core" {
  interface Register {
    messageIds: keyof MessageValues;
  }
}

/** The values each message of the catalog takes, by id. */
export interface MessageValues {
  "app.title": Record<never, never>;
  "error.failed": { status: string | number; error: string | number };
  "error.unreachable": Record<never, never>;
  "error.unreadable": { codes: string | number };
  "nav.accounts": Record<never, never>;
  "nav.label": Record<never, never>;
  "nav.memory": Record<never, never>;
  "nav.runs": Record<never, never>;
  "nav.sessions": Record<never, never>;
  "nav.toggle": Record<never, never>;
  "nav.usage": Record<never, never>;
  "nav.workItems": Record<never, never>;
  "run.kind": { kind: string };
  "run.nothingToUndo": Record<never, never>;
  "run.skipped": { count: number };
  "run.status": { status: string };
  "run.title": { runId: string | number };
  "run.undo": Record<never, never>;
  "run.undoPlan": { count: number };
  "run.undone": { runId: string | number };
  "runs.caption": Record<never, never>;
  "runs.empty": Record<never, never>;
  "runs.kind": Record<never, never>;
  "runs.run": Record<never, never>;
  "runs.started": Record<never, never>;
  "runs.status": Record<never, never>;
  "session.lost": Record<never, never>;
  "view.notBuilt": Record<never, never>;
}
