## ADDED Requirements

### Requirement: Per-brief settings

A brief MAY carry `brief.json`. With `"serve": "static"` the scorer SHALL serve the workspace copy as static files instead of running `npm start`, and SHALL mount it read-only into the test container; the runner SHALL use the brief's follow-up message and count the app as running when `index.html` loads from `file://` without page errors. The trial parser SHALL require the brief's `axe_pages`, and the app review SHALL use the brief's `review.md` when present. Without `brief.json` every script SHALL behave as before.

#### Scenario: Winery unchanged

- **WHEN** `bench/briefs/winery/validate.sh` and `bench/briefs/winery-react/validate.sh` run after the change
- **THEN** they report the same results as before

#### Scenario: Static brief

- **WHEN** the cartridges reference app is scored
- **THEN** it passes all six features without `npm start`

### Requirement: Cartridges hidden tests validated

The cartridges hidden tests SHALL pass on the reference app and on a variant with other markup, and each mutant SHALL fail exactly its feature.

#### Scenario: Scripts loaded as ES modules

- **WHEN** the reference loads its data as ES modules
- **THEN** only feature C6 fails
