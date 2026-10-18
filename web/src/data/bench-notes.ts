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
      tested: "BenchKeeper layer v3: the rules and following-dev-workflow skill of setup-v2.9 with Matt Pocock's skills (AD), plus OpenSpec (AE). setup-v3.x builds on this workflow skill; setup-v4.0 keeps the 3.x rules and skills and changes the install (plugin and setup.sh).",
      summary: "The BenchKeeper layer v3 with Matt Pocock's skills (AD) finished the three changes in a median of 7.6 minutes, the fastest arm, and passed all cross-step checks in 2 of 3 rounds. All five arms land within 3 points of each other (medians 82.9 to 85.7), inside the round-to-round spread of a single arm.",
      findings: [
        'Medians of 3 rounds: A and AB 85.7, AD 85.2, AE and V 82.9. The spread within one arm reaches about 7 points, so medians within 3 points are not separable at k = 3.',
        'AD (BenchKeeper layer v3 + Matt Pocock) took a median of 7.6 minutes, against 11 to 13 for V, AB and A, and passed all cross-step checks (changelog and version) in 2 of 3 rounds.',
        'AE round 3 wrote the OpenSpec proposal in step 2 and stopped there, so step 3 had no compare view to fix.',
        'Every arm misses the same CI hardening checks in step 1: actions pinned to commit SHAs, explicit workflow permissions, a ref guard on the Pages deploy.',
      ]
    },
    '2026-10-15-winery-react-sonnet': {
      tested: 'BenchKeeper layer v1: the rules file of 2026-10-14 (before setup-v1.0), with the SDLC in the rules and no workflow skill. setup-v3.x replaced it with the workflow skill; setup-v4.0 keeps the 3.x rules and skills and changes the install (plugin and setup.sh).',
      summary: 'Every one of the 29 apps passed all 18 hidden feature and robustness tests, so the setups differ in review and test quality. OpenSpec alone (AB) built the best-reviewed app (9 of 10), and ECC with OpenSpec (K) wrote the tests that caught the most mutants (94%). Maintainability is the lowest review criterion across all arms.',
      findings: [
        'Claude Code reviews: OpenSpec alone (AB) is rated 9, Ponytail (B) and the BenchKeeper layer with agent-skills (L) 7, all other arms 8.',
        'All 22 Claude Code apps and all 7 OpenCode apps pass the 6 feature tests and the 12 robustness tests.',
        'Maintainability is rated 2 or 3 in most apps, and no app has CI. setup-v2.9 added the README, test and CI checks the layer v1 arms lacked.',
        'Claude Code reviews use 13 criteria, OpenCode reviews 9. The two sets of ratings are not directly comparable.',
      ]
    },
    '2026-10-16-cartridges-sonnet': {
      tested: 'BenchKeeper layer v1: the rules file of 2026-10-14 (before setup-v1.0), with the SDLC in the rules and no workflow skill. setup-v3.x replaced it with the workflow skill; setup-v4.0 keeps the 3.x rules and skills and changes the install (plugin and setup.sh).',
      summary: "The top 10 of 29 arms lies within 3 points (81.8 to 84.8), so with one trial per arm the leading setups are not separable. Two OpenCode arms scored 84.8, and Matt Pocock's skills alone (V) built the best Claude Code app (84.0). The best BenchKeeper layer v1 arm, with ECC and OpenSpec (E), is 5th.",
      findings: [
        'The best BenchKeeper layer arm is E (BK v1 + ECC + OpenSpec), 5th of 29. BK + agent-skills (L) is 13th, BK + Matt Pocock (X) 20th.',
        "C (BK v1 + agent-skills + OpenSpec) scored 64.8: its unit tests failed in the scorer's coverage run, so its coverage scored 0 of 10 points (cause unverified). setup-v3.0 dropped agent-skills and OpenSpec from the recommended stack.",
        '26 of 29 apps pass all 6 feature tests (J passes 5, K and AA 2). Every reviewed app draws cartridges with values that match the records.',
        'K passes 2 of 6 hidden tests but is rated 8: the review could not check the detail and print rendering, where the hidden tests failed.',
      ]
    },
  },
  reports: [
    { file: '2026-10-16-skills-inventory.md', title: 'Skills inventory and usage', summary: 'The skills each framework adds, their size in tokens, and which of them the agents called in the 58 winery-react trials.' },
    { file: '2026-10-16-skill-authoring.md', title: 'Skill authoring check', summary: "The benchmarked skill collections checked against Anthropic's skill authoring guide: a static check and one review per collection, ranked." },
  ],
};
