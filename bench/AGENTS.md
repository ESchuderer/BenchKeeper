# Benchmark conventions

These apply to work in `bench/`, next to the repository's `AGENTS.md`.

- The BenchKeeper layer uses pinned rules: v1 `bench/arms/bk-rules.md`, v2 `bench/arms/bk-v2/` (rules and `sdlc` skill of setup-v2.2, `--build-arg BK=v2`), v3 `bench/arms/bk-v3/` and `bench/arms/bk-v3-openspec/` (rules and `following-dev-workflow` of setup-v2.9 for Matt Pocock's skills, arms AD and AE), v4 `bench/arms/bk-v4/` (rules and skills of setup-v3.1, arm AG). After editing `rules/global.md` or `skills/` for a new setup version, copy them into a new `bench/arms/bk-v<n>/` instead of changing a pinned one. v1 is `rules/global.md` at `7e17860`, used by every published run. Edits to `rules/global.md` do not reach it. After editing `bk-rules.md` or `bench/arms/<framework>.md`, run `devcontainer exec --docker-path podman --workspace-folder . node bench/scripts/arm-rules.mjs` (CI checks the variants are current).
