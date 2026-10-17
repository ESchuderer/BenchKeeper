// Short text for the /bench/ pages from the Markdown reports; tables come from the data. A run without an entry shows its tables only.
import type { Notes } from '../components/Bench';

export const notes: Notes = {
  briefs: {
    'winery-react': 'The brief asks for a React app to book wine tastings at a family winery, with a staff page behind a password. Every arm gets the same prompt in an empty workspace.',
    openballistics: 'Three changes to an existing Svelte site, each in a new session: CI, Pages deploy, release flow and README; a cartridge compare view; two bug fixes reported against that view.',
    cartridges: 'The brief asks for a static reference database of 25 C.I.P. cartridges: list, search and family filter, a detail view, a computed 2D drawing with dimensions and a one-page print view.',
  },
  runs: {
    '2026-10-17-openballistics-sonnet': {
      headline: 'No BenchKeeper layer arm met the win rule (median at least 3 above the best of V, AB and A, ahead in 2 of 3 rounds). Plain Claude Code (A) and OpenSpec alone (AB) tie on the median.',
      findings: [
        'Medians of 3 rounds: A and AB 85.7, AD 85.2, AE and V 82.9. Spread within an arm reaches about 7 points: medians within 3 points are not separable at k = 3.',
        'AD (BenchKeeper layer v3 + Matt Pocock) took a median of 7.6 minutes, against 11.1 to 12.8 for V, AB and A, and passed all cross-step checks (changelog and version) in 2 of 3 rounds.',
        'AE round 3 stopped after writing the OpenSpec proposal in step 2 and implemented nothing, so step 3 had no compare view to fix.',
        'Step 1 misses the same CI hardening checks in every arm: actions pinned to commit SHAs, explicit workflow permissions, a ref guard on the Pages deploy.',
      ],
    },
    '2026-10-15-winery-react-sonnet': {
      findings: [
        'Claude Code reviews: OpenSpec alone (AB) is rated 9, Ponytail (B) and the BenchKeeper layer with agent-skills (L) 7, all other arms 8.',
        'All 22 Claude Code apps and all 7 OpenCode apps pass the 6 feature tests and the 12 robustness tests. The hidden tests do not separate the arms on this brief.',
        'Maintainability is the weakest review criterion, mostly 2 or 3. No app has CI. The BenchKeeper-layer arms without OpenSpec score lowest on it (2, 2, 2, 3).',
        'Claude Code reviews use 13 criteria, OpenCode reviews 9. The two sets of ratings are not directly comparable.',
      ],
    },
    '2026-10-16-cartridges-sonnet': {
      findings: [
        'The BenchKeeper layer arms (v1: the SDLC in the rules file, no workflow skill) do not lead. The best is E (BK + ECC + OpenSpec), 5th of 29. BK + agent-skills (L) is 13th, BK + Matt Pocock (X) 20th.',
        'The setup BenchKeeper recommends today (BK v1 + agent-skills + OpenSpec, C) is 28th of 29 (64.8). Its unit tests failed in the scorer\'s coverage run, so its coverage scores 0 of 10 points (cause unverified).',
        '26 of 29 apps pass all 6 feature tests (J passes 5, K and AA 2). Every reviewed app draws proper cartridges with values that match the records.',
        'K passes 2 of 6 hidden tests but is rated 8: the review could not check the detail and print rendering, where the hidden tests failed.',
      ],
    },
  },
  reports: [
    { file: '2026-10-16-skills-inventory.md', title: 'Skills inventory and usage', summary: 'The skills each framework adds, their size in tokens, and which of them the agents called in the 58 winery-react trials.' },
    { file: '2026-10-16-skill-authoring.md', title: 'Skill authoring check', summary: "The benchmarked skill collections checked against Anthropic's skill authoring guide: a static check and one review per collection, ranked." },
  ],
};
