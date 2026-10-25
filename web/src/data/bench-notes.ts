// Short text for the /bench/ pages from the Markdown reports; tables come from the data. A run without an entry shows its tables only.
import type { Notes } from '../components/Bench';

export const notes: Notes = {
  briefs: {
    mistreevous: 'One feature for an existing TypeScript behaviour tree library, in three new sessions: snapshot and restore of a running tree (its open issue #120); restore checks that the snapshot fits the tree; two bug fixes.',
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
  },
  // The components the published runs tested, at the versions bench/image/install-arm.sh pins.
  stacks: [
    { name: 'BenchKeeper layer', url: 'https://github.com/ESchuderer/BenchKeeper', version: 'setup-v4.0, setup-v4.0 without Ponytail and setup-v5.0', text: 'Global rules and the workflow skill that sets the task tier. Every layer arm also gets Ponytail.' },
    { name: 'Ponytail', url: 'https://github.com/DietrichGebert/ponytail', version: 'v5.3.2, level full', text: 'A behavior mode for the smallest complete change.' },
    { name: "Matt Pocock's skills", url: 'https://github.com/mattpocock/skills', version: 'commit 49dd158', text: 'Skills for grilling, specs, tickets, TDD and code review.' },
    { name: 'agent-skills', url: 'https://github.com/addyosmani/agent-skills', version: '0.6.13', text: "Addy Osmani's engineering skill library." },
    { name: 'Superpowers', url: 'https://github.com/obra/superpowers', version: 'v7.0.0', text: 'A workflow framework of skills by Jesse Vincent.' },
    { name: 'ECC', url: 'https://github.com/affaan-m/ECC', version: '2.2.3, minimal profile', text: 'A harness bundle of agents, skills and rules (formerly everything-claude-code).' },
    { name: 'OpenSpec', url: 'https://github.com/Fission-AI/OpenSpec', version: '1.14.3', text: 'A proposal, specs and tasks per change, kept in the repository.' },
    { name: 'Spec Kit', url: 'https://github.com/github/spec-kit', version: 'v1.2.1', text: 'Spec, plan and tasks per feature, with a constitution.' },
  ],
  reports: [
    { file: '2026-10-16-skills-inventory.md', title: 'Skills inventory', summary: 'The skills each framework adds, their phase and size in tokens.' },
    { file: '2026-10-16-skill-authoring.md', title: 'Skill authoring check', summary: "The benchmarked skill collections checked against Anthropic's skill authoring guide: a static check and one review per collection, ranked." },
  ],
};
