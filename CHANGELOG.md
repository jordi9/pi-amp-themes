# Changelog

## Unreleased

- Upgrade bundled `pi-tool-display` to 0.4.2, which uses the current `@earendil-works` Pi peer namespace.

## 0.2.17

- Move amp-themes extension imports and Pi peer/development dependencies to the new `@earendil-works` package namespace.
- Keep bundled `pi-tool-display` unchanged for now while its upstream package still uses the legacy `@mariozechner` namespace.
- Add regression coverage for amp-themes package metadata and extension source imports so the main package does not drift back to the legacy Pi namespace.

## 0.2.16

- Require Pi 0.73 development types and use current thinking-level APIs directly.
- Update Amp editor and user-message rendering from session-derived thinking fallback to `thinking_level_select` event state.
- Deduplicate dynamically discovered command-palette entries from Pi command discovery.

## 0.2.15

- Fix command palette rows for multi-line skill descriptions so text cannot leak outside the overlay.
- Match Pi slash-command semantics: interactive built-in and extension commands run on Enter, while skill and prompt commands insert into the editor for review.
- Keep Tab as insert-only for every command source, and add regression coverage for command-source behavior.

## 0.2.14

- Rework `amp-gruvbox-dark-hard` to use the canonical Gruvbox dark hard palette.
- Color editor input text through the theme `text` token for consistent theme-specific editor rendering.
- Keep Pi's built-in working loader row hidden during agent starts while showing Amp's own `Esc to cancel` status hint.

## 0.2.13

- Update README to describe the latest editor working-status and color-sync behavior.

## 0.2.12

- Keep Amp user message colors synchronized with editor thinking colors after extension reloads.
- Add regression coverage for user message prototype state refresh across reloads.

## 0.2.11

- Hide Pi's built-in working loader row when supported.
- Render Amp working state in the existing editor status row while keeping git status on the right.

## 0.2.10

- Add an Amp-style overlay command palette for slash commands.
- Include built-in interactive commands alongside extension, prompt, and skill commands.
- Support palette filtering, scrolling, paging, and clearing the query.

## 0.2.9

- Keep Amp-style user message coloring in sync with runtime thinking-level changes.

## 0.2.8

- Add `amp-dark` and `amp-light` themes based on Amp's dark/light palette.
- Fix Amp editor borders so thinking-level color changes apply when cycling thinking levels.
- Validate bundled theme files include every required Pi theme color token.

## 0.2.7

- Refresh editor context and cost stats after `/reload` by reading the latest extension context.
- Move tests to Vitest and include them in `release:check`.

## 0.2.6

- Keep Amp editor thinking state stable after resumed sessions that lack a thinking-level entry.
- Preserve working-message order across waiting, streaming, and tool execution events.
- Avoid setting a custom working message while idle, and avoid restoring Pi's default message at agent end.
- Use a GitHub-hosted README screenshot so npm can render it without packaging the image.
- Simplify the README.

## 0.2.5

- Replace the working indicator with Amp-style `~ → ≈ → ≋` animation.
- Show `Waiting for response...` before the assistant starts and only switch to `Streaming response...` once assistant updates arrive.
- Show `Running tools...` while tool executions are active.
- Avoid stale session context crashes in Amp user message rendering after session replacement or reload.
- Darken the theme page background.
- Add a README screenshot as a repo-only asset.
- Add a release skill to keep npm publishing steps consistent.

## 0.2.4

- Published package maintenance update.

## 0.2.3

- Move git change summary out of the editor border and right-align it below the editor.
- Split git change summary into added, modified, and removed counts with theme-aware colors.
- Keep the editor bottom border focused on cwd and branch only.
- Tighten Amp-style user message rendering by removing the gap after the leading bar.

## 0.1.0

Initial release.

- Add `amp-gruvbox-dark-hard` Pi theme.
- Add Amp-inspired custom editor chrome.
- Show context usage and real session cost from Pi session usage data.
- Show model id and `pi.getThinkingLevel()` in the editor border.
- Show cwd, git branch, and dirty diff summary in the editor border.
- Add Amp-style working indicator.
- Bundle `pi-tool-display` for compact tool rendering.
