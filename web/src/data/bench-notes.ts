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
  // The components the published runs tested, at the versions bench/image/install-arm.sh pins.
  stacks: [
    { name: 'BenchKeeper layer', url: 'https://github.com/ESchuderer/BenchKeeper', version: 'layer v1 (rules of 2026-10-14), layer v3 (setup-v2.9)', text: 'Global rules and the workflow skill that sets the task tier. Every layer arm also gets Ponytail.', arms: 'C, D, E, L, M, N, X, Y, AD, AE' },
    { name: 'Ponytail', url: 'https://github.com/DietrichGebert/ponytail', version: 'v5.2.0, level full', text: 'A behavior mode for the smallest complete change.', arms: 'B, O, P and every BenchKeeper layer arm' },
    { name: "Matt Pocock's skills", url: 'https://github.com/mattpocock/skills', version: 'v1.3.1', text: 'Skills for grilling, specs, tickets, TDD and code review.', arms: 'V, W, X, Y, AD, AE, Z, AA' },
    { name: 'agent-skills', url: 'https://github.com/addyosmani/agent-skills', version: '0.6.13', text: "Addy Osmani's engineering skill library.", arms: 'F, I, L, C, Q, T, U' },
    { name: 'Superpowers', url: 'https://github.com/obra/superpowers', version: 'v7.0.0 (v6.1.1 in S)', text: 'A workflow framework of skills by Jesse Vincent.', arms: 'G, J, M, D, R, S' },
    { name: 'ECC', url: 'https://github.com/affaan-m/ECC', version: '2.2.3, minimal profile', text: 'A harness bundle of agents, skills and rules (formerly everything-claude-code).', arms: 'H, K, N, E' },
    { name: 'OpenSpec', url: 'https://github.com/Fission-AI/OpenSpec', version: '1.14.1', text: 'A proposal, specs and tasks per change, kept in the repository.', arms: 'AB, O, I, J, K, W, C, D, E, Y, AE, Q, S, U, AA' },
    { name: 'Spec Kit', url: 'https://github.com/github/spec-kit', version: 'v1.2.0', text: 'Spec, plan and tasks per feature, with a constitution.', arms: 'AC, P' },
    { name: 'oso', url: 'https://github.com/moyaspace/openspec-superpowers-opencode', version: '1.1.1', text: 'OpenSpec and Superpowers combined for OpenCode.', arms: 'S' },
    { name: 'Vercel agent-skills', url: 'https://github.com/vercel-labs/agent-skills', version: 'commit 063bee9', text: 'React skills, next to targeted agent-skills.', arms: 'Q' },
  ],
  partial: [
    { title: 'SkillsBench, Sonnet 5.5, one round', url: 'https://github.com/benchflow-ai/skillsbench', text: "86 one-shot tasks in 8 domains, run through Harbor 0.24.0 with Claude Code on Sonnet 5.5 at effort medium, scored 0 to 1 by a pytest verifier. The tasks' own skills were withheld, the arms' skills were available. The agents called no skill from Matt Pocock's skills or Ponytail. The BenchKeeper workflow skill was the only one called, in 9 to 22 of 82 trials per BenchKeeper arm. So this run tested what an installed setup adds to every session (rules, skill descriptions, project files) on work outside a repository. The BenchKeeper layer v5 alone (setup-v3.3, which also stands for setup-v3.4 and v4.0) passed the most tasks: 37 of 81, plain Claude Code 33, the other arms 30 to 33. One round per arm. Skill libraries such as Matt Pocock's skills, ECC and Superpowers are compared on repository briefs, where their skills get called." },
  ],
  reports: [
    { file: '2026-10-16-skills-inventory.md', title: 'Skills inventory and usage', summary: 'The skills each framework adds, their size in tokens, and which of them the agents called in the 58 winery-react trials.' },
    { file: '2026-10-16-skill-authoring.md', title: 'Skill authoring check', summary: "The benchmarked skill collections checked against Anthropic's skill authoring guide: a static check and one review per collection, ranked." },
  ],
};
