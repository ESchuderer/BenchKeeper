// The design tokens of the sessions board and the app UI, one set: each writes them out as CSS variables (the board
// without a prefix inside its page, the app with `bk-` through Mantine's variables resolver). The colors per scheme are
// checked with the dataviz palette validator (series colors) and for 4.5:1 text and 3:1 graphics on page and surface.
const LIGHT = {
  page: '#f4f6fa', surface: '#ffffff', ink: '#1a1b1e', 'ink-2': '#55565c', grid: '#e6e7e9', line: '#dde1e8',
  s1: '#2a78d6', s2: '#d9531c', s3: '#0a8f5e', s4: '#a86b00', s5: '#7a4fd1', s6: '#c22a7a', other: '#8a8984', accent: '#1c5cab',
  glow: 'rgba(42, 120, 214, 0.1)', shadow: '0 1px 2px rgba(20, 24, 40, 0.06), 0 8px 24px rgba(20, 24, 40, 0.07)',
};
const DARK = {
  page: '#17181c', surface: '#242424', ink: '#e9ecef', 'ink-2': '#b8bcc2', grid: '#373a40', line: '#3d4047',
  s1: '#3987e5', s2: '#d95926', s3: '#199e70', s4: '#c98500', s5: '#a98af0', s6: '#e0629f', other: '#8d8c85', accent: '#86b6ef',
  glow: 'rgba(57, 135, 229, 0.16)', shadow: '0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35)',
};
export const TOKENS = { light: LIGHT, dark: DARK };

// The Dashboard's health bar: the status green for current, then categorical slots in their validated order (adjacent
// pairs pass the lightness, chroma and color-vision checks in both schemes). "modified" is the board's first series;
// "missing" is a wine outside the series, as the series aqua read as a second green next to current.
export const HEALTH = ['current', 'modified', 'outdated', 'missing', 'foreign', 'untracked', 'removed', 'error', 'absent'];
const [CURRENT, ABSENT] = ['#0ca30c', '#8b8a85'];
const HEALTH_COLORS = {
  light: [CURRENT, LIGHT.s1, '#eb6834', '#882255', '#eda100', '#e87ba4', '#6250d6', '#e34948', ABSENT],
  dark: [CURRENT, DARK.s1, DARK.s2, '#cc00aa', DARK.s4, '#d55181', '#9085e9', '#e66767', ABSENT],
};

// Shape, type and motion every panel shares.
export const SHAPE = { radius: '16px', 'radius-sm': '10px', mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", ease: '150ms ease' };

// The tokens of one scheme as custom properties; `health` adds the Dashboard's bar colors.
export const varsOf = (scheme, prefix = '', health = false) => Object.fromEntries(Object.entries({
  ...TOKENS[scheme], ...SHAPE,
  ...(health ? Object.fromEntries(HEALTH.map((s, i) => [`h-${s}`, HEALTH_COLORS[scheme][i]])) : {}),
}).map(([k, v]) => [`--${prefix}${k}`, v]));
export const cssVars = (...args) => Object.entries(varsOf(...args)).map(([k, v]) => `${k}: ${v};`).join(' ');

// Mantine's 10-step primary scale: the accent of each scheme is a step, so the filled button (step 9) and the links in
// dark mode (step 4) are the board's accent; white text on step 9 is 7:1.
export const PRIMARY = ['#eef4fd', '#dde9fa', '#c0d7f6', '#a3c5f2', DARK.accent, '#5e9ae6', '#3d80d6', '#2a6cc0', '#2263b5', LIGHT.accent];
