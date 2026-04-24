# amp-themes

[Amp](https://ampcode.com)-inspired UI for [Pi](https://pi.dev): a Gruvbox dark theme, rounded editor chrome, compact user messages, and bundled compact tool rendering.

![amp-gruvbox-dark-hard screenshot](https://raw.githubusercontent.com/me-frankan/amp-themes/main/screenshots/amp-gruvbox-dark-hard.png)

## Install

```bash
pi install npm:amp-themes
```

Set the theme in Pi settings, or in `~/.pi/agent/settings.json`:

```json
{
  "theme": "amp-gruvbox-dark-hard"
}
```

If `npm:pi-tool-display` is installed separately, remove it. `amp-themes` already bundles it.

## Includes

- `amp-gruvbox-dark-hard` theme
- Amp-style editor chrome with context, cost, model, thinking level, cwd, branch, and git change summary
- Compact Amp-style user messages
- Amp-style working indicator/status messages
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
