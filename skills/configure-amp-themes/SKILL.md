---
name: configure-amp-themes
description: Use when configuring, installing, updating, troubleshooting, or switching themes for the amp-themes Pi UI package, especially amp-dark, amp-light, amp-gruvbox-dark-hard, or conflicts with pi-tool-display.
---

# Configure amp-themes

## Overview

`amp-themes` is a Pi UI package. It provides Amp-style editor chrome, bundled compact tool display, and theme files such as `amp-dark`, `amp-light`, and `amp-gruvbox-dark-hard`.

Goal: make the package load once, avoid renderer conflicts, and set the intended theme.

## Quick setup

Install the package:

```bash
pi install npm:amp-themes
```

Set the theme in `~/.pi/agent/settings.json`:

```json
{
  "theme": "amp-dark"
}
```

Or use Pi's interactive settings:

```text
/settings → Theme → amp-dark
```

## Conflict cleanup

`amp-themes` bundles `pi-tool-display`. Do not load standalone `npm:pi-tool-display` at the same time.

Check packages:

```bash
pi list
```

If standalone `pi-tool-display` is present, remove it:

```bash
pi remove npm:pi-tool-display
```

If an old local package appears in settings, remove it from `~/.pi/agent/settings.json`:

```text
packages/amp-agent-ui
```

Keep this package entry:

```text
npm:amp-themes
```

## Update

```bash
pi update npm:amp-themes
```

## Verify

Run a smoke test:

```bash
pi -p "Reply with ok"
```

For interactive UI verification, start Pi and check startup resources show:

```text
[Extensions]
  amp-themes:amp-editor.ts
  amp-themes:node_modules/pi-tool-display

[Themes]
  amp-dark
  amp-light
  amp-gruvbox-dark-hard
```

The editor should show a rounded bottom input area with context usage, model id, thinking level, cwd, and branch.

## Common issues

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Tool renderer conflict | `npm:pi-tool-display` loaded separately | `pi remove npm:pi-tool-display` |
| Theme not found | Old theme name or package not installed | Use `amp-dark`, `amp-light`, or `amp-gruvbox-dark-hard`; run `pi install npm:amp-themes` |
| Editor chrome not showing | Extension disabled or package filtered | Check `pi list` and `~/.pi/agent/settings.json` package filters |
| Old `amp-agent` theme missing | Theme was renamed before general use | Set theme to `amp-dark`, `amp-light`, or `amp-gruvbox-dark-hard` |

## Do not

- Do not install standalone `npm:pi-tool-display` together with `amp-themes`.
- Do not keep old `packages/amp-agent-ui` in settings.
- Do not set theme to `amp-agent`; use `amp-dark`, `amp-light`, or `amp-gruvbox-dark-hard`.
