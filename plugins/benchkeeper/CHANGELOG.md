# Changelog

## [6.28.0](https://github.com/ESchuderer/BenchKeeper/compare/setup-v6.27.0...setup-v6.28.0) (2026-11-13)


### Features

* **app:** projects apply writes the coordinator policy and worker rules ([#1331](https://github.com/ESchuderer/BenchKeeper/issues/1331)) ([7011e9f](https://github.com/ESchuderer/BenchKeeper/commit/7011e9f92711b4b3647ca96e4feb8de4dee2ebed))
* **plugin:** an owner's comment that is an option's label or letter alone answers an approval ([#1333](https://github.com/ESchuderer/BenchKeeper/issues/1333)) ([2eb17fb](https://github.com/ESchuderer/BenchKeeper/commit/2eb17fb6e1f953baef937739d5d1889ba2de03e4))
* **plugin:** facts generator for the coordinator run folder ([#1334](https://github.com/ESchuderer/BenchKeeper/issues/1334)) ([70a394d](https://github.com/ESchuderer/BenchKeeper/commit/70a394d9e295abefad5c584af3d5ebd018f734f4))
* **plugin:** sensitive-change model defaults, gather, recheck and verify agents, and the review loop rules ([#1330](https://github.com/ESchuderer/BenchKeeper/issues/1330)) ([cb8ff0d](https://github.com/ESchuderer/BenchKeeper/commit/cb8ff0deb4ec62cea50e6d7c6fc02986635997e8))


### Bug Fixes

* **plugin:** facts generator follow-ups from the review ([#1335](https://github.com/ESchuderer/BenchKeeper/issues/1335)) ([d11e1d6](https://github.com/ESchuderer/BenchKeeper/commit/d11e1d627ed0cd27b26ac9805dd3d229ea192db1))

## [6.27.0](https://github.com/ESchuderer/BenchKeeper/compare/setup-v6.26.0...setup-v6.27.0) (2026-11-12)


### Features

* **app,plugin:** projects plan and apply take --paths for a copied skill's globs ([#1295](https://github.com/ESchuderer/BenchKeeper/issues/1295)) ([74e1c9e](https://github.com/ESchuderer/BenchKeeper/commit/74e1c9ef00b3e3ed0bf3002a70b86f4dfe895c06))
* **app:** remove the agent-file sources and their agency-agents catalog entry ([#1281](https://github.com/ESchuderer/BenchKeeper/issues/1281)) ([2f85c27](https://github.com/ESchuderer/BenchKeeper/commit/2f85c27daa998cccec94e0fafc19d78770b8264b))
* **audit:** no coverage-floor check, and the workflow skill adds a test only where the test rule calls for one ([#1132](https://github.com/ESchuderer/BenchKeeper/issues/1132)) ([8712d4d](https://github.com/ESchuderer/BenchKeeper/commit/8712d4d2be7311586bb527e139d45ce61b662418))
* **automations:** the daily digest writes one file per day, digests/YYYY-MM-DD.md ([#1319](https://github.com/ESchuderer/BenchKeeper/issues/1319)) ([c28a98a](https://github.com/ESchuderer/BenchKeeper/commit/c28a98ae880ba1abc255315d1e9aa7b16bf38eaf))
* Matt Pocock's setup prompt goes, find-skills is off, and the workflow and ask texts close the tdd and chat-interview gaps ([#1283](https://github.com/ESchuderer/BenchKeeper/issues/1283)) ([177996e](https://github.com/ESchuderer/BenchKeeper/commit/177996e2b13a475ceb250fac46eaed1db3c41565))
* phase orchestration: standard and full tier run plan, implement, test and review as subagents, and CedarLoom ships a default feature workflow ([#1266](https://github.com/ESchuderer/BenchKeeper/issues/1266)) ([6aae47e](https://github.com/ESchuderer/BenchKeeper/commit/6aae47eb71db897327c02e13be2ded41358b4389))
* **plugin:** /benchkeeper:questions asks the open question issues and allows terminal questions for the session ([#1264](https://github.com/ESchuderer/BenchKeeper/issues/1264)) ([370e779](https://github.com/ESchuderer/BenchKeeper/commit/370e7791cf7092026d8a91d3f0c13fc16e94e62c))
* **plugin:** an idle Orca coordinator clears its context above a threshold and resumes from its handoff file ([#1270](https://github.com/ESchuderer/BenchKeeper/issues/1270)) ([32177a9](https://github.com/ESchuderer/BenchKeeper/commit/32177a94c771e2e2b375c3933dcece2f75c8520c))
* **plugin:** no question tool by default, and /benchkeeper:ask allows terminal questions for a while ([#1260](https://github.com/ESchuderer/BenchKeeper/issues/1260)) ([a4a678b](https://github.com/ESchuderer/BenchKeeper/commit/a4a678b1c6b2b7dec178eea2b40d54b12b933148))
* **plugin:** one approval layout with model, effort, review, merges and cost for owner gates and questions ([#1312](https://github.com/ESchuderer/BenchKeeper/issues/1312)) ([252f2f8](https://github.com/ESchuderer/BenchKeeper/commit/252f2f85c8bcb0529c47a1df0f4fee5a5bf26c75))
* **plugin:** one daily digest file that the automation can commit and mirror to an issue ([#1289](https://github.com/ESchuderer/BenchKeeper/issues/1289)) ([aae5852](https://github.com/ESchuderer/BenchKeeper/commit/aae58522d8d5c085caa977939114422b71f12693))
* **plugin:** phase agents for plan, implement, test, review and research ([#1280](https://github.com/ESchuderer/BenchKeeper/issues/1280)) ([d73adeb](https://github.com/ESchuderer/BenchKeeper/commit/d73adeb0ad17d3f2b64876af91d88ed6c158725c))
* **plugin:** policy schema version 2 and a reader for the effective policy; a policy key the schema does not name now starts nothing ([#1310](https://github.com/ESchuderer/BenchKeeper/issues/1310)) ([0285fd4](https://github.com/ESchuderer/BenchKeeper/commit/0285fd401570668553611d2e0838da77f60e960e))
* **plugin:** setting-up-projects keeps only its judgement steps and loads the dev container step on demand ([#1282](https://github.com/ESchuderer/BenchKeeper/issues/1282)) ([1f0fbdf](https://github.com/ESchuderer/BenchKeeper/commit/1f0fbdf893b0becd4b915e87add32041e218e20d))
* **plugin:** stuck signals in the implement agent, git drift in the restored handoff ([#1294](https://github.com/ESchuderer/BenchKeeper/issues/1294)) ([fdd8304](https://github.com/ESchuderer/BenchKeeper/commit/fdd830481a7290f54b4dce016eca217c4cf75f77))
* **plugin:** the coordinator runs by policy version 2; a version 1 policy now gets tier models, a fresh reviewer per pull request and pinned merges ([#1311](https://github.com/ESchuderer/BenchKeeper/issues/1311)) ([6364e25](https://github.com/ESchuderer/BenchKeeper/commit/6364e25da798aa250f8566f7acb5dad62e409886))
* **plugin:** the owner-only match, the merge pin and the pick are scripts with fixed cases, and the owner's answer to an approval is read back ([#1314](https://github.com/ESchuderer/BenchKeeper/issues/1314)) ([d0874b8](https://github.com/ESchuderer/BenchKeeper/commit/d0874b85ef1681785049245131cdba5ff4cb6822))
* **plugin:** worker rules in every spec and subagent brief, the review ladder in the workflow skill, and every default effort is high ([#1313](https://github.com/ESchuderer/BenchKeeper/issues/1313)) ([dba0553](https://github.com/ESchuderer/BenchKeeper/commit/dba05537592aba940ad244b33d878b82f3db83a8))
* **rules:** no question tool by default: open questions go into one issue per task, and the tiers, the coordinator and Codex stages follow ([#1249](https://github.com/ESchuderer/BenchKeeper/issues/1249)) ([d04e6d9](https://github.com/ESchuderer/BenchKeeper/commit/d04e6d98938e72205fc9a6036e462fb15856553a))
* **rules:** the global rules keep only small universal rules; questions, best practice and writing move to the project rules ([#1258](https://github.com/ESchuderer/BenchKeeper/issues/1258)) ([74357aa](https://github.com/ESchuderer/BenchKeeper/commit/74357aafeaf10f737d54ded37b40eb7c8c40c683))
* **setup:** every apply writes the shared rules into the BenchKeeper block; the setup skill commits the setup of a repository without an AGENTS.md of its own, and merges into a committed one only the parts you pick ([#1125](https://github.com/ESchuderer/BenchKeeper/issues/1125)) ([34f03c1](https://github.com/ESchuderer/BenchKeeper/commit/34f03c1ddccce1edbdc7ae05ccd059cf35bdf6b1))
* the webapp-testing library skill for the browser check, and optional TypeScript and Rust language-server plugins ([#1284](https://github.com/ESchuderer/BenchKeeper/issues/1284)) ([25cf684](https://github.com/ESchuderer/BenchKeeper/commit/25cf6841e9b19ab4cc791bbc9b39f77b900decad))
* **work-items:** the hub part's missing labels are queued in the outbox with an undo, and /benchkeeper:questions recovers from a failed label edit ([#1268](https://github.com/ESchuderer/BenchKeeper/issues/1268)) ([c664194](https://github.com/ESchuderer/BenchKeeper/commit/c664194885052762f8ade0cf00d398a2cf26d2c9))


### Bug Fixes

* **app,plugin:** digest follow-ups: models in sessions list, git options in the helper lint, origin in the precheck ([#1293](https://github.com/ESchuderer/BenchKeeper/issues/1293)) ([d440d68](https://github.com/ESchuderer/BenchKeeper/commit/d440d68b6bc048377276833b6b0f39b819c8facf))
* **plugin,app:** setting-up-projects applies the AGENTS.override.md change again after its AGENTS.md edits, and the Copy status has a UI check ([#1287](https://github.com/ESchuderer/BenchKeeper/issues/1287)) ([f2e36e8](https://github.com/ESchuderer/BenchKeeper/commit/f2e36e8a795296126b9655b36defa29c5e8a4e18))
* **plugin:** the tier band's mod type-checks against the engine's types ([#1272](https://github.com/ESchuderer/BenchKeeper/issues/1272)) ([27c4dee](https://github.com/ESchuderer/BenchKeeper/commit/27c4dee3b7a4cb346e99bd33ae772d43bd7b509d))

## [6.26.0](https://github.com/ESchuderer/BenchKeeper/compare/setup-v6.25.0...setup-v6.26.0) (2026-11-05)


### Features

* 7.0 (merge of integration/7.0) ([#562](https://github.com/ESchuderer/BenchKeeper/issues/562)) ([8fd9a91](https://github.com/ESchuderer/BenchKeeper/commit/8fd9a91ec1e09eb1bfc85aef242460a9886be80b))
* **app:** agent sessions commit as the user's GitHub machine account ([#968](https://github.com/ESchuderer/BenchKeeper/issues/968)) ([0e71c0e](https://github.com/ESchuderer/BenchKeeper/commit/0e71c0e26a534293c68fab1a4cb6b40f1797a59d))
* **app:** content contract and state version 2 ([#506](https://github.com/ESchuderer/BenchKeeper/issues/506)) ([9e08505](https://github.com/ESchuderer/BenchKeeper/commit/9e08505364bd14b25ceb406982823ee61ee44409))
* **app:** install the picked agent files for Codex and GitHub Copilot CLI ([#880](https://github.com/ESchuderer/BenchKeeper/issues/880)) ([a6d89c9](https://github.com/ESchuderer/BenchKeeper/commit/a6d89c9b943bf39171677abbe43e6d3e0c0b5ac7))
* **app:** presets, pins and the orchestrator policy as validated JSON ([#513](https://github.com/ESchuderer/BenchKeeper/issues/513)) ([94b8d62](https://github.com/ESchuderer/BenchKeeper/commit/94b8d62c89bd10a924f06542c1cb887b6f265756))
* **app:** project setup gives new worktrees the local setup through .worktreeinclude ([#970](https://github.com/ESchuderer/BenchKeeper/issues/970)) ([ed8b099](https://github.com/ESchuderer/BenchKeeper/commit/ed8b0994473132670221218bc6e0fc66faf67a76))
* **app:** remove the preset and pin files, pins list and their doctor checks ([#861](https://github.com/ESchuderer/BenchKeeper/issues/861)) ([9065692](https://github.com/ESchuderer/BenchKeeper/commit/9065692bce468dbb14c2536a89f349c0b6d9d02e)), closes [#827](https://github.com/ESchuderer/BenchKeeper/issues/827)
* **app:** rename the commands to the noun-first scheme ([#502](https://github.com/ESchuderer/BenchKeeper/issues/502)) ([a32f37c](https://github.com/ESchuderer/BenchKeeper/commit/a32f37c27016e35b1e64860d3ba90808b3529cf0))
* integrate the sessions facts, CLI help and refusals, secret masking and doctor work from the 6.x branch ([#763](https://github.com/ESchuderer/BenchKeeper/issues/763)) ([e1f4acc](https://github.com/ESchuderer/BenchKeeper/commit/e1f4acc7ec1d202067b4c62d70abfee1cacbb81f)), closes [#739](https://github.com/ESchuderer/BenchKeeper/issues/739) [#740](https://github.com/ESchuderer/BenchKeeper/issues/740) [#741](https://github.com/ESchuderer/BenchKeeper/issues/741) [#742](https://github.com/ESchuderer/BenchKeeper/issues/742) [#743](https://github.com/ESchuderer/BenchKeeper/issues/743) [#744](https://github.com/ESchuderer/BenchKeeper/issues/744) [#760](https://github.com/ESchuderer/BenchKeeper/issues/760) [#762](https://github.com/ESchuderer/BenchKeeper/issues/762) [#759](https://github.com/ESchuderer/BenchKeeper/issues/759)
* **orchestrating-projects:** skip delivered issues and name the wake-up and reclaim checks ([#892](https://github.com/ESchuderer/BenchKeeper/issues/892)) ([95cc1dc](https://github.com/ESchuderer/BenchKeeper/commit/95cc1dc0420682c664d7cd59baa3e991eaef2868))
* **plugin:** a quick-tier task reads only the workflow SKILL.md ([#858](https://github.com/ESchuderer/BenchKeeper/issues/858)) ([8323840](https://github.com/ESchuderer/BenchKeeper/commit/83238401a9b07c656724fbea4c2b8fac921890e2)), closes [#828](https://github.com/ESchuderer/BenchKeeper/issues/828)
* **plugin:** skill for operating BenchKeeper through the CLI ([#495](https://github.com/ESchuderer/BenchKeeper/issues/495)) ([2710e51](https://github.com/ESchuderer/BenchKeeper/commit/2710e5162f907ccf403a72081c9675da14012385))
* **plugin:** status band content, two-band doctor check and Ponytail ledger on the board ([#505](https://github.com/ESchuderer/BenchKeeper/issues/505)) ([197ca23](https://github.com/ESchuderer/BenchKeeper/commit/197ca235400f829a301c9f925cc6286edb40da61))
* **plugin:** validate the plugin in CI and correct plugin text ([#510](https://github.com/ESchuderer/BenchKeeper/issues/510)) ([f5a4504](https://github.com/ESchuderer/BenchKeeper/commit/f5a4504a4a1621949b14310b841d2b37b228b3e5))
* **plugin:** workflow checklists, change types, review rounds and rule lines ([#511](https://github.com/ESchuderer/BenchKeeper/issues/511)) ([bd961b2](https://github.com/ESchuderer/BenchKeeper/commit/bd961b23046b16f400dd191ba03de1c2281ca7e4))
* **plugin:** workflow text without a forced issue, branch, commit or pull request flow ([#834](https://github.com/ESchuderer/BenchKeeper/issues/834)) ([1a47374](https://github.com/ESchuderer/BenchKeeper/commit/1a47374cb706e10740e9c03c9e7e322bbe109d96)), closes [#822](https://github.com/ESchuderer/BenchKeeper/issues/822)
* pre-release design passes for settings, insights and change plans, with audit fixes and mutation tests ([#658](https://github.com/ESchuderer/BenchKeeper/issues/658)) ([18b68ec](https://github.com/ESchuderer/BenchKeeper/commit/18b68ec0e471ef284433a340d708121c43fa8ed1)), closes [#668](https://github.com/ESchuderer/BenchKeeper/issues/668)
* remove the issue-pickup and pr-watcher automations ([#835](https://github.com/ESchuderer/BenchKeeper/issues/835)) ([ad0f9a9](https://github.com/ESchuderer/BenchKeeper/commit/ad0f9a9b6a7c727514abff260e58b1483507b1b2)), closes [#826](https://github.com/ESchuderer/BenchKeeper/issues/826)
* rules text without personal style or tool-specific lines, and a per-project switch for the workflow load ([#836](https://github.com/ESchuderer/BenchKeeper/issues/836)) ([9b1018c](https://github.com/ESchuderer/BenchKeeper/commit/9b1018caf57b3d0c3de658afef67cdb7e3b7881b)), closes [#823](https://github.com/ESchuderer/BenchKeeper/issues/823)
* **rules:** ask on two readings, state assumptions and checks, change only what the request needs ([#1040](https://github.com/ESchuderer/BenchKeeper/issues/1040)) ([1bc10d5](https://github.com/ESchuderer/BenchKeeper/commit/1bc10d5b604a02b57e41b859138b5d8523671225))
* **rules:** confirm first, questions to the user and best practice in the global rules ([#705](https://github.com/ESchuderer/BenchKeeper/issues/705)) ([a215c7e](https://github.com/ESchuderer/BenchKeeper/commit/a215c7e2b286aab58442e2d196ea9319b52bb353)), closes [#715](https://github.com/ESchuderer/BenchKeeper/issues/715)
* stop GitHub lookups for pull request state and stop pushing shared setups ([#849](https://github.com/ESchuderer/BenchKeeper/issues/849)) ([e5f9f30](https://github.com/ESchuderer/BenchKeeper/commit/e5f9f300bbba0d22e150e9223bdb6a5dd1746f9d)), closes [#824](https://github.com/ESchuderer/BenchKeeper/issues/824)


### Bug Fixes

* **app:** keep the user's own lines in AGENTS.override.md on re-apply ([#974](https://github.com/ESchuderer/BenchKeeper/issues/974)) ([0c52c97](https://github.com/ESchuderer/BenchKeeper/commit/0c52c97f23791b2a1074d8a29aa46e257e082e2a)), closes [#973](https://github.com/ESchuderer/BenchKeeper/issues/973)
* **plugin:** describe project presets in the operating skill, setup guide, app README and site ([#888](https://github.com/ESchuderer/BenchKeeper/issues/888)) ([e6bf2d4](https://github.com/ESchuderer/BenchKeeper/commit/e6bf2d4a45e610bf290a39959d3e208d1961c2aa)), closes [#883](https://github.com/ESchuderer/BenchKeeper/issues/883)
* **plugin:** research playbook says when to skip research and how a note expires ([#771](https://github.com/ESchuderer/BenchKeeper/issues/771)) ([3bfd6bd](https://github.com/ESchuderer/BenchKeeper/commit/3bfd6bd9f9c8aeae33ee90243b22942579f6883f)), closes [#770](https://github.com/ESchuderer/BenchKeeper/issues/770)
* pre-release fixes for state files, undo, CLI exits, cleanup sweep and UI states ([#598](https://github.com/ESchuderer/BenchKeeper/issues/598)) ([4877ff7](https://github.com/ESchuderer/BenchKeeper/commit/4877ff7f2c4817c2712560bef532c6f066feddb2))
* pre-release fixes from audit rounds 12 and 13 for plans, settings layers and automations ([#698](https://github.com/ESchuderer/BenchKeeper/issues/698)) ([412d030](https://github.com/ESchuderer/BenchKeeper/commit/412d0300c761824fbb107964d9f482ac6b01a17d))
* pre-release fixes from audit rounds 7 and 8 and a Dashboard that shows what needs attention first ([#642](https://github.com/ESchuderer/BenchKeeper/issues/642)) ([02bf2c4](https://github.com/ESchuderer/BenchKeeper/commit/02bf2c4ab20711b731fd09684dd2e6569a149d61)), closes [#653](https://github.com/ESchuderer/BenchKeeper/issues/653)
