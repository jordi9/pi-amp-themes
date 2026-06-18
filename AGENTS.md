# Repository Guidelines

Maintainer: jordi9. This is jordi9's fork of Frank's upstream `me-frankan/amp-themes` repo.

## Fork & Upstream Context

- Fork point: upstream `v0.2.17` (`f226d4b`, `chore: release 0.2.17`).
- Upstream has since moved through `0.3.x`/`0.4.x` with larger product-direction changes (auto dark/light appearance switching, dropping Gruvbox, and replacing `pi-tool-display` with self-authored tool renderers).
- This fork intentionally diverges: keep the broader theme set, jordi9 Industries/Hermes branding, custom editor chrome, and bundled `pi-tool-display@0.4.2`.
- Do **not** merge upstream wholesale. Compare and cherry-pick small ideas manually when useful.
- `pi-tool-display` is current enough for this fork: it uses the `@earendil-works` Pi peer namespace and provides compact built-in tool rendering, bash spinner, edit/write diffs, and MCP-aware rendering. Do not drop it unless explicitly asked.

## Project Structure & Module Organization

This package ships an Amp-inspired Pi UI bundle.

- Theme assets live in `themes/`: Amp dark/light, Gruvbox, Rosé Pine main/moon, and Nebula Moon variants.
- Pi extension code lives in `extensions/`:
  - `amp-startup.ts`: jordi9 Industries / Hermes startup header and default startup listing suppression.
  - `amp-editor.ts`: custom editor chrome, command palette integration, working phases, random working animations, elapsed/finished timing, output-expanded status, context warnings, cost/model/thinking/cwd/git display.
  - `amp-assistant-markdown.ts`: display-only Markdown enhancements such as endpoint route tables.
  - `amp-user-message.ts`: compact user message rendering with thinking-color sync.
  - `amp-command-palette.ts`: Amp-style slash command overlay.
- Bundled third-party tool rendering is loaded from `./node_modules/pi-tool-display/index.ts` via `package.json`.
- There is currently no checked-in `skills/` directory in this fork, even though package metadata still includes the path for compatibility if skills are reintroduced.
- Package metadata, Pi registration, and scripts are in `package.json`; TypeScript settings are in `tsconfig.json`.

## Build, Test, and Development Commands

- `pnpm install`: install dependencies and bundled package inputs.
- `pnpm test`: run the Vitest regression suite.
- `pnpm run typecheck`: run `tsc --noEmit` against `extensions/**/*.ts`.
- `pnpm run check`: load this package with Pi using `pi --no-extensions --no-themes -e . -p 'Reply with ok'`.
- `pnpm run pack:check`: inspect the npm package contents with `pnpm pack --dry-run`.
- `pnpm run release:check`: run typecheck, tests, Pi load check, and package dry run before publishing.
- `mise run check` or `mise run release-check`: use the pinned Node version from `.mise.toml` when available.

## Coding Style & Naming Conventions

Use TypeScript ESM and strict typing for extension code. Keep indentation at two spaces in TypeScript and JSON. Prefer small helper functions near the behavior they support, and keep Pi API integration in extension entrypoints. Use descriptive kebab-case filenames for package-facing assets, such as `amp-gruvbox-dark-hard.json`, and `amp-*` names for bundled Pi extensions.

## Editor & Tool Rendering Notes

- Keep our editor working-status affordance: terse phases (`Waiting`, `Thinking`, `Streaming`, `Using tools`) plus `Esc to cancel` and elapsed prompt time.
- `Thinking` should be detected from `thinking_*` assistant stream events; visible output from `text_*` / `toolcall_*`; tool execution should override with `Using tools` until all active tool calls finish.
- Hide Pi's built-in working row with `setWorkingVisible(false)` when available, but keep the optional-call style for compatibility with older Pi versions.
- Editor working animations are intentionally playful and selectable via `/working-animation`; random per-prompt animation is the default behavior.
- Keep `pi-tool-display` responsible for built-in tool rendering unless the user explicitly asks to replace it. Its bash spinner is separate from the editor status animation.

## Testing Guidelines

Treat `pnpm test`, `pnpm run typecheck`, and `pnpm run check` as the minimum validation for behavior changes. For theme-only edits, also run `pnpm run pack:check` to confirm package contents. For extension UI changes, manually verify through Pi when practical, especially layout, truncation, terminal-width behavior, reload behavior, and interaction with bundled `pi-tool-display`.

## Commit & Pull Request Guidelines

Git history uses Conventional Commit-style subjects such as `feat: add amp pi theme suite`, `fix: avoid duplicate theme load in check`, and `chore: release 0.2.2`. Keep commits focused on one concern. Pull requests should summarize user-visible changes, list verification commands run, and include screenshots or terminal captures when UI rendering changes. Link related issues when available and call out release or packaging impacts.

## Security & Configuration Tips

Do not commit local Pi settings or credentials. Keep `.npmrc` behavior intentional; pnpm reads it too, and this repo uses `legacy-peer-deps=true` because current Pi package peer ranges can lag compatible runtime versions. Before publishing, confirm `pnpm pack --dry-run` includes `README.md`, `CHANGELOG.md`, `LICENSE`, `extensions`, `themes`, and the bundled `pi-tool-display` dependency.
