---
name: mantine-family
description: "Mantine conventions for the family's projects (those on @open-reloading/ui and @open-reloading/design-tokens, and CedarLoom): provider setup, design tokens, control density, component traps (Modal, NumberInput, Pagination, Select, Switch, useHotkeys), forms, tables, i18n, accessibility checks and docs lookup. Use when building, changing or reviewing a screen on Mantine in such a project, or when a Mantine component misbehaves."
---

## Setup

- Projects on `@open-reloading/ui`: wrap the app in `UiProvider` (its `i18n` holds `uiMessages` beside the app's messages) and import `ui.css` once; it brings Mantine's styles. No `MantineProvider` or `MantineThemeProvider` of your own: their props undo `ui.css` or the tokens.
- Server-rendered shell: spread `mantineHtmlProps` on `<html>`, give `ColorSchemeScript` and the provider the same `defaultColorScheme`, render scheme controls after mount.
- CedarLoom's UI: an interim evergreen theme (`packages/ui/src/main.tsx`) until the generated theme lands.

## Tokens

- Tokens, never raw colors or px: `--page --surface --surface-alt --ink --muted --line --control-line --accent --accent-hover --accent-tint --on-accent --link --error-text --warn-* --select --space-xs..xl --font-size-xs..xl --font-size-field --size-target`.
- New styles: CSS modules with `classNames`, never Mantine's private `--_*` variables.
- Mantine's grays still show in SegmentedControl and Switch tracks and disabled Buttons.

## Density

- `size="field"` 24 px (property grids), `xs` 30 px (rows, buttons), `sm` 36 px (bars). Under a coarse pointer these become 44 px with 16 px field text; Mantine's `md` does not. Row checkboxes need an explicit 44 px hit area.

## Component traps

- Modal role is always `dialog`. Confirms: `data-autofocus` on Cancel (`autoFocus` loses to the focus trap). Return focus by hand when the opener can be disabled.
- Modal focus arrives late, so keys typed right after opening can be lost: `data-autofocus` on the first field, and test typing at 0 ms.
- `useHotkeys` skips input, textarea and select, checkboxes included: pass `tagsToIgnore` or put `getHotkeyHandler` on `onKeyDown`.
- NumberInput: `clampBehavior="none"` to show range errors.
- Pagination: name controls through `getControlProps` and `getItemProps`.
- Select with `size="field"`: size its options too.
- `vars` beat `styles` on the same key.
- A Switch description becomes part of its accessible name: keep it short.
- Filled controls: the accent, no `autoContrast` (`color="blue" autoContrast` failed contrast in dark).

## Forms, tables, i18n

- `useForm` (`@mantine/form`; the `mantine-form` skill has its API): validators return message ids; focus the first invalid field; validate live after the first submit.
- `@rjsf/mantine` for schema forms, never mixed with `useForm`; it builds against Mantine 8, so test its widgets early.
- `Table` inside `Table.ScrollContainer`; `aria-sort` on each sortable `th` with a sort button inside; an indeterminate select-all. Thousands of rows: TanStack Table with TanStack Virtual.
- Every kit string is a prop: Lingui `t` into `labels` and `aria-label`. Dates: `@mantine/dates` with dayjs locales.

## Done when

- axe with WCAG 2.2 AA tags: 0 violations at 320, 390 and 1280 px, light and dark.
- Keyboard: dialog focus trap and return to the opener, Escape, first invalid field on a failed save, typing right after a dialog opens.
- Every interactive element has a name and a 44 px target under a coarse pointer.

## Docs lookup

- Before reading kit source: the `mantine` MCP server (`search_docs`, `get_item_doc`, `get_item_props`, `list_items`, `get_api`), else https://mantine.dev/llms.txt; both serve the latest release.
- Missing server: a CedarLoom profile adds it through its MCP part. By hand: a root devDependency `@mantine/mcp-server` at the `@mantine/core` version, in the Mantine packages' Dependabot group, then `claude mcp add --scope project mantine -- npx --no @mantine/mcp-server` (the installed copy, committed in `.mcp.json`, never user-global). Show the user that command; never run it: it executes code.
