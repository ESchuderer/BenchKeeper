// The coordinator's handoff file and the context that hands it back, for the Claude Code module and the Codex hook.
export const RUNS = '.benchkeeper/runs';
export const FILE = `${RUNS}/handoff.md`;
const HEADER = "BenchKeeper restored this coordinator's handoff file after a context clear or compaction (.benchkeeper/runs/handoff.md, below). Before anything else, run its Resume steps: the runner's mail first, then the run's state. Then go on from its Next section and keep the file current in your own words, never pasting worker or issue text. If the run it names has closed, delete the file.";
// Claude Code drops additionalContext above 10,000 characters: the header, this much of the file and the cut line stay below.
const CAP = 9000;

// Whether the file is this session's: every Terminal: line of its header (before the first ## heading) names this terminal, and one does.
export const mine = (text, terminal) => {
  const claims = [...text.split(/^## /m)[0].matchAll(/^Terminal:(.*)$/gm)].map((m) => m[1].trim().replace(/^`+|`+$/g, '').trim());
  return Boolean(terminal) && claims.length > 0 && claims.every((claim) => claim === terminal);
};

export const restored = (text) =>
  `${HEADER}\n\n${text.length > CAP ? `${text.slice(0, CAP)}\n[BenchKeeper cut the file here; ${text.length - CAP} more characters are in ${FILE}.]` : text}`;
