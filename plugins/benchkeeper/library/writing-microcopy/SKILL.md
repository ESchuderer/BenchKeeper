---
name: writing-microcopy
description: "Writes and reviews microcopy: labels, buttons, headings, helper text, tooltips, table headers, units, status text, empty states, error and confirmation messages, user docs. Use when adding or changing text people read in a UI or docs page, including technical UIs (dashboards, settings, data tables, admin tools), or reviewing one for wordy copy."
---

# Writing microcopy

Labels and values carry the screen. A line of text stays when it tells the reader something the heading, the layout or the control does not already show. Help text stays where a term needs a definition or the reader would otherwise make a real mistake.

## Each line

Read the whole screen or page first, then decide each line: keep, shorten, move, or delete. When nothing is left, the slot stays empty.

Delete:
- captions, hover notes and lead paragraphs that restate the page title, the heading or the control
- reassurance ("Don't worry", "You can change this later", "Your data is safe")
- descriptions of internals: storage, syncing, caching, logging
- tooltips that repeat their own label
- consequences of an action, unless they are destructive, irreversible, paid, or notify other people (these stay)

Each idea appears once per screen. Buttons that repeat the action they confirm are the exception.

## Technical UIs

Dashboards, settings, data tables and admin tools are read by people who know the domain. The value is the content.
- Units go in the label or column header ("Timeout (s)", "Cost (USD)"), not in every cell and not in a tooltip.
- Metric (SI) units by default. A quantity the domain states in another unit keeps it (barrel length in inches). The project's unit settings or its `AGENTS.md` decide over both.
- One number format per column: the same decimals, aligned on the decimal point, thousands separated.
- Tooltips only for an abbreviation, a unit, a formula or a term the reader may not know ("p: two-sided sign test"). A tooltip on a self-explanatory header goes.
- Status as text, optionally with a color or icon next to it ("Failed", "Running"). Color alone is not a status.
- Tables hold values. Explanations go in one short note under the table, or in the docs, and only when a term needs it.
- Missing values show one consistent marker ("n/a") with its meaning defined once.
- Identifiers, commands and paths in monospace and copyable.

## Controls and messages

- Buttons: a verb plus the outcome ("Save profile", "Delete 3 files").
- Confirmations: the question names the action and count ("Delete 3 files?"), the buttons repeat it ("Delete files", "Cancel"). Where the action can be undone, offer undo and skip the confirmation.
- Errors: what failed and how to fix it. An internal code, if shown, comes after that.
- Empty states: the one action that fills the space, as a button where there is one.
- Disabled controls: the reason they are disabled.
- To tell the reader how to enable something, show the control instead.

## Wording

- Sentence case for headings, labels and buttons.
- One term per concept, taken from the product's existing labels, fields and docs.
- Placeholders show an example value. The label sits outside the field.
- Icon-only controls get an accessible name (`aria-label` on the web).
- Facts (limits, prices, durations, counts, units) come from the code or the user. A missing fact becomes `[NEED: <fact>]` in the text and a question to the user.

## Examples

| Before | After |
|---|---|
| Settings page, lead paragraph: "Here you can manage your account settings." | (deleted) |
| Toggle "Dark mode", helper text: "Turn this on to use a dark theme." | Toggle "Dark mode" |
| Button "Submit" on a profile form | "Save profile" |
| "Oops! Something went wrong." | "Could not save: the name is taken. Choose another name." |
| Empty list: "You have no projects yet. Projects you create will appear here." | "No projects", button "Create project" |
| Docs page "Install", first paragraph: "This page explains how to install the tool." | (deleted, the page starts with the first step) |
| Field "Timeout", helper text: "Seconds before a request is cancelled." | Field "Timeout (s)", no helper text |
| Column "Duration", cells "12.8 min", "7.6 minutes", "11 min" | Column "Duration (min)", cells "12.8", "7.6", "11.0" |
| Column "Reward" with tooltip "The reward of the run" | Column "Reward", tooltip "Mean of the task's test scores, 0 to 1" or no tooltip |
| Badge colored red without text | Badge "Failed" |

## Reviews

When reviewing existing copy, report each change as location (`file:line`), current text, new text.
