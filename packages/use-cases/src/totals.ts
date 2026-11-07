import type { LaunchRecord, NodeAttempt, RunTotals } from "@cedarloom/contracts";

/**
 * A launch's own totals: what its session's result reported, less what the session's previous launch reported, since a
 * resumed session reports its whole spend (https://code.claude.com/docs/en/agent-sdk/cost-tracking); null while unknown.
 */
export const ownTotals = (launch: LaunchRecord, launches: readonly LaunchRecord[]): RunTotals | null => {
  const { totals, sessionId, startedAt } = launch;
  if (totals === null) return null;
  const before = launches.findLast(
    (each) => sessionId !== null && each.sessionId === sessionId && each.startedAt < startedAt && each.totals !== null,
  )?.totals;
  if (before === undefined || before === null) return totals;
  const less = (key: keyof RunTotals): number => Math.max(0, totals[key] - before[key]);
  return {
    inputTokens: less("inputTokens"),
    outputTokens: less("outputTokens"),
    cacheReadTokens: less("cacheReadTokens"),
    cacheCreationTokens: less("cacheCreationTokens"),
    costUsdMicros: less("costUsdMicros"),
  };
};

/**
 * An attempt's own totals: those of the launch of its session, the one that started nearest to it when a resumed session
 * has several; null for none or unknown.
 */
export const attemptTotals = (attempt: NodeAttempt, launches: readonly LaunchRecord[]): RunTotals | null => {
  if (attempt.sessionId === null) return null;
  const started = Date.parse(attempt.startedAt);
  const distance = (launch: LaunchRecord): number => Math.abs(Date.parse(launch.startedAt) - started);
  const [launch] = launches
    .filter((each) => each.sessionId === attempt.sessionId)
    .toSorted((a, b) => distance(a) - distance(b));
  return launch === undefined ? null : ownTotals(launch, launches);
};
