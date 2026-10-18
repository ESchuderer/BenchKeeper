---
name: designing-technical-uis
description: "Designs and reviews technical UIs for people who know the domain: workbenches, calculators, analysis and comparison views, dashboards, data tables, charts, settings and admin tools, and their docs. Covers text (labels, helper text, tooltips, errors, empty states), numbers and units, inputs and selection, tables, comparisons and charts. Use when building or changing such a screen or its text, or reviewing one. Visual style is frontend-design's job."
---

# Designing technical UIs

The reader knows the domain and came for the values. Every element earns its place by showing a value, taking an input, or preventing a real mistake. When the heading, the layout or the control already says it, the extra text goes.

Work in this order: read the whole screen, list what the reader needs to see and do, then decide each element (keep, shorten, move, delete). An empty slot is better than a filler line.

## Text

Delete:
- captions, hover notes and lead paragraphs that restate the page title, the heading or the control
- reassurance ("Don't worry", "You can change this later", "Your data is safe")
- descriptions of internals: storage, syncing, caching, logging
- tooltips that repeat their own label
- consequences of an action, unless they are destructive, irreversible, paid, or notify other people (these stay)

Keep help text where a term needs a definition. Each idea appears once per screen. Buttons that repeat the action they confirm are the exception.

Wording:
- Sentence case. One term per concept, taken from the product's existing labels, fields and docs.
- Buttons: a verb plus the outcome ("Save load", "Delete 3 files").
- Errors: what failed and how to fix it. An internal code, if shown, comes after that.
- Facts (limits, prices, durations, counts, units) come from the code or the user. A missing fact becomes `[NEED: <fact>]` in the text and a question to the user.

## Numbers and units

- The unit sits in the label or column header ("Timeout (s)", "Barrel length (in)"), not in every cell and not in a tooltip.
- Metric (SI) by default. A quantity the domain states in another unit keeps it (barrel length in inches). The project's unit settings or its `AGENTS.md` decide over both.
- Store and compute in one base unit, convert only for display, so a unit switch never changes the value.
- A unit switch on a field affects that field only. Saved unit preferences live in settings. A quantity with two units gets a one-click toggle, three or more get a menu.
- One number format per column or readout: the same decimals, aligned on the decimal point, thousands separated. Precision matches what the input or model supports.
- Missing values show one marker ("n/a"), defined once.

## Inputs and selection

- Start empty and let the reader choose. No preselected items in comparisons, overlays or charts. The empty state is the picker ("Add powder"), not a sample selection.
- Comparison works the same way everywhere in the product: pick items, then "Compare". Follow the pattern the product already uses (for example its bullet comparison) instead of a new one.
- Defaults only where a value has one correct starting point (a standard, the user's last saved setting). A default is a real value, not a placeholder.
- Placeholders show an example value. The label sits outside the field.
- Validation sits at the field, names the allowed range with its unit, and appears when the value is wrong, not before.
- Disabled controls say why. To explain how to enable something, show the control instead.
- Prefer undo over a confirmation. A confirmation names the action and count ("Delete 3 loads?") and its buttons repeat it.

## Tables, comparisons and charts

- Tables hold values. One short note under the table, only when a term needs it.
- Compared items share rows or axes and the same units and scales. Differences to the reference are shown as values, not described in text.
- Charts: axis titles with units, a legend only with more than one series, the series named as in the table.
- Status as text, optionally with a color or icon ("Failed", "Running"). Color alone is never the signal.
- Identifiers, commands and paths in monospace and copyable.

## Accessibility

- Click targets at least 24 by 24 px.
- Icon-only controls get an accessible name that says what they do ("Switch to mm").
- Every input has a visible label. Tooltips are reachable by keyboard focus, and nothing needed lives only in a tooltip.

## Examples

| Before | After |
|---|---|
| Settings page, lead paragraph: "Here you can manage your account settings." | (deleted) |
| Toggle "Dark mode", helper text: "Turn this on to use a dark theme." | Toggle "Dark mode" |
| Field "Timeout", helper text: "Seconds before a request is cancelled." | Field "Timeout (s)" |
| Column "Duration", cells "12.8 min", "7.6 minutes", "11 min" | Column "Duration (min)", cells "12.8", "7.6", "11.0" |
| Column "Reward" with tooltip "The reward of the run" | Column "Reward", tooltip with the definition from the code, or none |
| Burn rate overlay opens with three powders preselected | Empty overlay with "Add powder", then "Compare", as in the bullet comparison |
| Unit menu with "gr" and "g" | One-click toggle "gr / g" in the field suffix |
| "Oops! Something went wrong." | "Could not save: the name is taken. Choose another name." |
| Badge colored red without text | Badge "Failed" |

## Reviews

Report each change as location (`file:line`), current, new.
