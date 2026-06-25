# amp-themes

[Amp](https://ampcode.com)-inspired UI for [Pi](https://pi.dev): Amp dark/light themes, Gruvbox, Rosé Pine main/moon, and Nebula Moon hybrid dark themes, rounded editor chrome, synchronized thinking-level colors, compact user messages, and bundled compact tool rendering.

![amp-gruvbox-dark-hard screenshot](https://raw.githubusercontent.com/me-frankan/amp-themes/main/screenshots/amp-gruvbox-dark-hard.png)

## Install

```bash
pi install npm:amp-themes
```

Set the theme in Pi settings, or in `~/.pi/agent/settings.json`:

```json
{
  "theme": "amp-dark"
}
```

If `npm:pi-tool-display` is installed separately, remove it. `amp-themes` already bundles it.

## Includes

- `amp-dark`, `amp-light`, `amp-gruvbox-dark-hard`, `amp-rose-pine`, `amp-rose-pine-moon`, and `amp-nebula-moon` themes
- jordi9 Industries-branded Amp/Hermes startup header with a left-aligned one-line wordmark, factory terminal art, polished tool/resource summaries, expanded details, and hidden default startup listing
- Amp-style editor chrome with context, fun high-context warnings, cost, model, thinking level, cwd, branch, git change summary, slash command palette, and a focused `/skills` palette
- `Ctrl+Shift+X` to copy the current prompt editor text to the system clipboard with a transient editor status
- `Ctrl+O` to collapse/expand `rpiv-ask-user-question` dialogs while that tool is active, mirroring its `Ctrl+]` toggle for keyboard layouts where `]` is awkward
- Working status integrated into the editor status row, with a random per-prompt animation, elapsed prompt time after `Esc to cancel`, a 7-second finished/cancelled timer, a pulsing ready star before the context usage plus flashing editor chrome and terminal bell after successful agent turns only when the terminal was already unfocused, and git changes kept on the right
- Compact Amp-style user messages with thinking-level color sync
- Display-only assistant Markdown enhancements that turn HTTP endpoint `txt` fences into route tables and render copy-pasteable, lightly styled shell fences
- Bundled `pi-tool-display`

## Development

```bash
pnpm install
pnpm test
pnpm run typecheck
pnpm run check
pnpm run pack:check
```

For local Pi testing:

```bash
pi install /Users/frank/Code/amp-themes
```

Switch back to the published package when done:

```bash
pi remove /Users/frank/Code/amp-themes
pi install npm:amp-themes
```

## Release

Use the bundled release skill/checklist:

```text
release-amp-themes
```

At minimum:

```bash
pnpm run release:check
pnpm publish
```

See `CHANGELOG.md` for release notes.

## License

MIT
