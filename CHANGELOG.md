# Changelog

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
