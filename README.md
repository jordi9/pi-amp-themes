# amp-themes

[Amp](https://ampcode.com)-inspired UI for [Pi](https://pi.dev): Amp dark/light themes, a Gruvbox dark theme, rounded editor chrome, synchronized thinking-level colors, compact user messages, and bundled compact tool rendering.

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

- `amp-dark`, `amp-light`, and `amp-gruvbox-dark-hard` themes
- Jordi9 Industries-branded Amp/Hermes startup header with a left-aligned one-line wordmark, factory terminal art, polished tool/resource summaries, expanded details, and hidden default startup listing
- Amp-style editor chrome with context, cost, model, thinking level, cwd, branch, and git change summary
- Working status integrated into the editor status row, with elapsed prompt time after `Esc to cancel`, a 7-second finished timer, and git changes kept on the right
- Compact Amp-style user messages with thinking-level color sync
- Bundled `pi-tool-display`

## Development

```bash
npm install
npm test
npm run typecheck
npm run check
npm run pack:check
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
npm run release:check
npm publish
```

See `CHANGELOG.md` for release notes.

## License

MIT
