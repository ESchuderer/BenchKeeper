// Import rules of the app's modules (decoupled-modules note). A module is a set of paths under src/; moving a file into a folder
// changes only its pattern here. engine is every file of src/ that no other module claims.
const CORE = 'fsx|git|merge|redact|childenv|cooldown|states|tokens|ledger|diff|roots|runner';
const MODULES = {
  core: `^src/(${CORE})\\.mjs$`,
  agents: '^src/agents\\.mjs$',
  content: '^src/(content|packs)\\.mjs$',
  orca: '^src/orca/',
  cli: '^src/cli\\.mjs$',
  server: '^src/server\\.mjs$',
  engine: `^src/(?!(?:${CORE}|agents|content|packs|cli|server)\\.mjs$|orca/)`,
  ui: '^ui/',
};
// What each module may import besides itself. The UI reaches src/ through HTTP, apart from the two pure files the browser also loads.
const MAY = {
  core: [], agents: ['core'], content: ['core'], orca: ['core'],
  engine: ['core', 'agents', 'content', 'orca'],
  server: ['core', 'agents', 'content', 'orca', 'engine'],
  cli: ['core', 'agents', 'content', 'orca', 'engine', 'server'],
  ui: [],
};
const BROWSER_SAFE = '^src/(states|tokens)\\.mjs$';

module.exports = {
  forbidden: [
    { name: 'no-circular', comment: 'a cycle keeps its modules from being split', severity: 'error', from: {}, to: { circular: true } },
    ...Object.entries(MAY).map(([m, may]) => ({
      name: `${m}-imports`,
      comment: `${m} may import ${may.length ? may.join(', ') : 'nothing'} besides itself`,
      severity: 'error',
      from: { path: MODULES[m] },
      to: { path: '^(src|ui)/', pathNot: [MODULES[m], ...may.map((x) => MODULES[x]), ...(m === 'ui' ? [BROWSER_SAFE] : [])].join('|') },
    })),
  ],
  options: { doNotFollow: { path: 'node_modules' }, moduleSystems: ['es6', 'cjs'], enhancedResolveOptions: { exportsFields: ['exports'] } },
};
