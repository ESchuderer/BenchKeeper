// The agent support tables of docs/setup.md, derived from app/src/agents.json.
const LEVEL = { true: 'full', false: 'what the agent documents' };
const FEATURES = [['plugins', 'Plugin install'], ['usage', 'Usage feed'], ['accounts', 'Accounts'], ['tier', 'Tier strip']];
const cell = (s) => String(s).replace(/\|/g, '\\|');
const code = (v) => (v == null ? 'none' : `\`${cell(v)}\``);
const list = (xs) => (xs.length ? xs.map(code).join(', ') : 'none');
const yes = (a, f) => ((f === 'plugins' ? a.plugins : a.features[f]) ? 'yes' : 'not available');

export function supportTables(agents) {
  return [
    '| Agent | Support | ' + FEATURES.map(([, label]) => label).join(' | ') + ' | Note |',
    '|---|---|' + FEATURES.map(() => '---|').join('') + '---|',
    ...agents.map((a) => `| ${cell(a.name)} | ${LEVEL[a.tested]} | ${FEATURES.map(([f]) => yes(a, f)).join(' | ')} | ${cell(a.note ?? '')} |`),
    '',
    'Recorded per agent; the permission default is never written, and versions are observations, not minimums.',
    '',
    '| Agent | Wake mode | Trust | Permission default | Model flag | Effort flag | Forbidden headless forms | Observed versions |',
    '|---|---|---|---|---|---|---|---|',
    ...agents.map((a) => `| ${cell(a.name)} | ${a.wake} | ${a.trust} | ${code(a.permissionDefault)} | ${code(a.modelFlag)} | ${code(a.effortFlag)} | ${list(a.forbiddenHeadless)} | ${list(a.observed)} |`),
  ];
}
