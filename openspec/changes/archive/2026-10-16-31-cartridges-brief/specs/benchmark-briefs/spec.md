## ADDED Requirements

### Requirement: Per-brief settings

A brief MAY carry `brief.json` with a follow-up message, a serving mode, axe pages and a review prompt; the runner, scorer, parser and review SHALL use them when present, and without `brief.json` every script SHALL behave as before.

#### Scenario: Winery unchanged

- **WHEN** `bench/briefs/winery/validate.sh` and `bench/briefs/winery-react/validate.sh` run after the change
- **THEN** they report the same results as before

### Requirement: Static serving

With `"serve": "static"` the scorer SHALL serve the workspace copy as static files, mounted read-only into the test container, instead of running `npm start`; the runner SHALL count the app as running when `index.html` loads from `file://` without page errors.

#### Scenario: Static brief

- **WHEN** the cartridges reference app is scored
- **THEN** it passes all six features without `npm start`

### Requirement: Cartridges hidden tests validated

The cartridges hidden tests SHALL pass on the reference app and on a variant with other markup, and each mutant SHALL fail exactly its feature.

#### Scenario: Scripts loaded as ES modules

- **WHEN** the reference loads its data as ES modules
- **THEN** only feature C6 fails
