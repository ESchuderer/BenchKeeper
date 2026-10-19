// Short text for the /bench/ pages from the Markdown reports; tables come from the data. A run without an entry shows its tables only.
import type { Notes } from '../components/Bench';

export const notes: Notes = {
  briefs: {
    'winery-react': 'The brief asks for a React app to book wine tastings at a family winery, with a staff page behind a password. Every arm gets the same prompt in an empty workspace.',
    openballistics: 'Three changes to an existing Svelte site, each in a new session: CI, Pages deploy, release flow and README; a cartridge compare view; two bug fixes reported against that view.',
    mistreevous: 'One feature for an existing TypeScript behaviour tree library, in three new sessions: snapshot and restore of a running tree (its open issue #120); restore checks that the snapshot fits the tree; two bug fixes.',
    cartridges: 'The brief asks for a static reference database of 25 C.I.P. cartridges: list, search and family filter, a detail view, a computed 2D drawing with dimensions and a one-page print view.',
  },
  runs: {
    '2026-10-19-mistreevous-opusplan': {
      tested: "Model setting opusplan (Opus 5.5 in plan mode, Sonnet 5.5 otherwise) with plain Claude Code (A) and BenchKeeper setup-v5.0 (AM), seed 101. No trial entered plan mode: the main loop ran on Sonnet, and only AM's subagents ran on Opus.",
      score: 'hidden tests 35, review 25, static checks 15, process checks 15, test suite green after each step 10 (method in the report).',
      summary: 'AM scores 90.3 against 86.6 for A, ahead in 2 of 3 rounds, at 1.9 times the cost and 1.4 times the time; the process checks make the difference. Against the Sonnet run, AM gains 1.4 points at 1.3 times the cost, inside the round-to-round spread, so opusplan shows a cost increase and no measurable score gain here.',
      findings: [
        'Medians: AM 90.34 (26.4 min, 6.26 USD), A 86.61 (19.4 min, 3.32 USD). Sonnet run, seed 83: AM 88.98 (24.9 min, 4.79 USD), A 86.97 (22.7 min, 3.76 USD).',
        "AM's general-purpose and Explore subagents ran on Opus in steps 1 and 2: 1.63 to 2.28 USD per trial, 29 to 35% of its cost. A spawned no subagent and used no Opus.",
        'All 6 trials pass all 17 hidden checks and end every step with the suite green. Review parts are close (AM 20.3 to 23.1, A 21.9 to 23.1). Process checks: AM 9.55 of 15 in every round, A 5.45 to 6.82.',
      ]
    },
    '2026-10-18-mistreevous-sonnet': {
      tested: "BenchKeeper setup-v4.0 (AL): the rules, the following-dev-workflow skill, Matt Pocock's skills and Ponytail. Added 2026-10-19 with the same seed, baseline and checks: setup-v5.0 (AM, the rules and workflow skill of setup-v5.2) and setup-v4.0 without Ponytail (AN).",
      score: 'hidden tests 35, review 25, static checks 15, process checks 15, test suite green after each step 10 (method in the report).',
      summary: 'Most setups score within the round-to-round spread of plain Claude Code (A, 86.97). ECC (H) is the only arm measurably above it (+3.15, ahead in 2 of 3 rounds), at 2.0 times the cost and 1.6 times the time. Superpowers (G) scores 2.3 higher at slightly less cost, and Ponytail alone (B) matches A at 0.58 times the cost. BenchKeeper setup-v5.0 (AM) scores 88.98, 4.9 above setup-v4.0 (AL) and ahead in all 3 rounds, at 2.1 times its cost.',
      findings: [
        'Weighing cost against score: one arm varies by up to about 8 points between rounds, so a median difference below about 3 points is not measurable. A higher cost needs a median at least 3 points higher and a lead in 2 of 3 rounds. Against A, only H meets that.',
        'Medians, minutes and API-equivalent cost against A (86.97, 22.7 min, 3.76 USD): H 90.12, 1.56x time, 2.00x cost. F 89.73, 1.26x, 1.30x. G 89.31, 0.89x, 0.94x. AM 88.98, 1.10x, 1.27x. AB 88.37, 1.37x, 1.10x. AC 87.94, 1.08x, 0.99x. B 87.58, 0.59x, 0.58x. AN 87.58, 1.12x, 1.12x. V 87.22, 1.00x, 0.99x. AF 84.63, 0.56x, 0.53x. AL 84.08, 0.58x, 0.61x.',
        'setup-v5.0 (AM) against setup-v4.0 (AL): review part 22.5 against 20.2 of 25, process checks 6 to 7 of 11 against 3 to 5. The v4.0 rule that stopped AL without a devcontainer is gone in v5.0.',
        'Ponytail at the same setup version: without it (AN) the median is 3.5 higher and leads in 2 of 3 rounds, at 1.9 times the time and 1.8 times the cost. The arms with Ponytail (B, AF, AL) are the fastest and cheapest, and reviews rate their validation and tests lower.',
        'BenchKeeper setup-v4.0 (AL) skipped the final test run in 3 of 9 steps while it looked for a devcontainer, and once ended a step with failing tests.',
        'Superpowers (G) called its TDD skill in 8 of 9 steps and planned before the first edit in 4 of 6. The OpenSpec and Spec Kit arms never ran their spec tools.',
      ]
    },
    '2026-10-17-openballistics-sonnet': {
      tested: "BenchKeeper layer v3: the rules and following-dev-workflow skill of setup-v2.9 with Matt Pocock's skills (AD), plus OpenSpec (AE). Added later with the same seed, baseline and checks: setup-v3.3 (AH, 2026-10-18), setup-v5.0 (AM) and setup-v4.0 without Ponytail (AN, both 2026-10-19).",
      summary: 'Cost and time separate the setups here, the score does not. Five arms reach medians of 85.2 to 86.2 (AM, AH, A, AB, AD), inside the round-to-round spread of up to 7 points, so they count as equal in quality. At that quality, setup-v3.3 (AH) and layer v3 (AD) need about 8 minutes and 1.7 USD per trial, 40% less time and 30% less cost than plain Claude Code (A). setup-v5.0 (AM) scores 0.4 points more than AH at 2.2 times the cost and time.',
      findings: [
        'Weighing cost against score: with 3 rounds, a median difference below about 3 points is not measurable. A setup that costs 2 or 4 times as much and scores 1 point higher has shown a cost increase, not a quality gain. The win rule set before the run asks for a median at least 3 points higher and a lead in 2 of 3 rounds. No arm meets it.',
        'Medians, minutes and API-equivalent cost against plain Claude Code (A: 85.69, 12.8 min, 2.42 USD): AH 85.76, 0.63x time, 0.69x cost. AD 85.21, 0.59x, 0.73x. AM 86.18, 1.38x, 1.53x. AB 85.69, 0.92x, 1.07x. V, AE and AN 82.85.',
        'setup-v5.0 (AM) writes about twice the output tokens of setup-v3.3 (AH) per trial (78,000 to 95,000 against 43,000 to 48,000) and called the code-review skill in 2 of 3 rounds. On this brief its changes add cost and time without a measurable score gain.',
        'AH is the most consistent arm (85.69 to 86.67). AN, setup-v4.0 without Ponytail, ranges from 60.21 to 91.39: in round 1 a type error left in step 2 failed the build and every step 2 check. No setup-v4.0 arm with Ponytail ran on this brief.',
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
    { name: 'BenchKeeper layer', url: 'https://github.com/ESchuderer/BenchKeeper', version: 'layer v1 (rules of 2026-10-14), layer v3 (setup-v2.9), setup-v4.0 (mistreevous), setup-v3.3 (openballistics), setup-v4.0 without Ponytail and setup-v5.0 (openballistics, mistreevous)', text: 'Global rules and the workflow skill that sets the task tier. Every layer arm also gets Ponytail.' },
    { name: 'Ponytail', url: 'https://github.com/DietrichGebert/ponytail', version: 'v5.2.0, v5.3.2 in mistreevous, level full', text: 'A behavior mode for the smallest complete change.' },
    { name: "Matt Pocock's skills", url: 'https://github.com/mattpocock/skills', version: 'v1.3.1, commit 49dd158 in mistreevous', text: 'Skills for grilling, specs, tickets, TDD and code review.' },
    { name: 'agent-skills', url: 'https://github.com/addyosmani/agent-skills', version: '0.6.13', text: "Addy Osmani's engineering skill library." },
    { name: 'Superpowers', url: 'https://github.com/obra/superpowers', version: 'v7.0.0 (v6.1.1 in S)', text: 'A workflow framework of skills by Jesse Vincent.' },
    { name: 'ECC', url: 'https://github.com/affaan-m/ECC', version: '2.2.3, minimal profile', text: 'A harness bundle of agents, skills and rules (formerly everything-claude-code).' },
    { name: 'OpenSpec', url: 'https://github.com/Fission-AI/OpenSpec', version: '1.14.1, 1.14.3 in mistreevous', text: 'A proposal, specs and tasks per change, kept in the repository.' },
    { name: 'Spec Kit', url: 'https://github.com/github/spec-kit', version: 'v1.2.0, v1.2.1 in mistreevous', text: 'Spec, plan and tasks per feature, with a constitution.' },
    { name: 'oso', url: 'https://github.com/moyaspace/openspec-superpowers-opencode', version: '1.1.1', text: 'OpenSpec and Superpowers combined for OpenCode.' },
    { name: 'Vercel agent-skills', url: 'https://github.com/vercel-labs/agent-skills', version: 'commit 063bee9', text: 'React skills, next to targeted agent-skills.' },
  ],
  reports: [
    { file: '2026-10-16-skills-inventory.md', title: 'Skills inventory and usage', summary: 'The skills each framework adds, their size in tokens, and which of them the agents called in the 58 winery-react trials.' },
    { file: '2026-10-16-skill-authoring.md', title: 'Skill authoring check', summary: "The benchmarked skill collections checked against Anthropic's skill authoring guide: a static check and one review per collection, ranked." },
  ],
};
