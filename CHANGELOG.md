# Changelog

## Unreleased

- Add `amp-rose-pine` and `amp-rose-pine-moon` themes based on the official Rosé Pine palettes.
- Add `amp-nebula-moon`, a louder Rosé Pine Moon, Tokyo Night Moon, Catppuccin Mocha, and Amp-red hybrid theme.
- Color the low `dumb` context warning with the theme's yellow heading token instead of the primary accent.
- Hide Pi's model-scope startup line before the custom Amp/Hermes header.
- Add a jordi9 Industries-branded Amp/Hermes startup header with a large ASCII wordmark, current model/thinking/cwd metadata, polished tool/resource summaries, expanded details, compact hints, and hidden default startup listing.
- Upgrade bundled `pi-tool-display` to 0.4.2, which uses the current `@earendil-works` Pi peer namespace.
- Show the active prompt elapsed time next to the Amp editor's `Esc to cancel` working hint, then keep the finished or cancelled elapsed time visible for 7 seconds.
- Add a minimal pulsing ready star before the Amp editor context usage, flash the editor chrome, and send a terminal bell after successful agent turns, clearing the visual cue when the user returns focus/input or the next turn begins.
- Randomly pick an editor working-status animation per prompt, including the original `~ → ≈ → ≋` Amp wave and new Hermes-inspired spinner styles, with `/working-animation` and argument autocomplete for experimentation.
- Add `Ctrl+Shift+X` for copying the current prompt editor text to the system clipboard with a transient editor status.
- Keep the Amp editor border fixed to the theme's low-thinking color while the thinking level label continues to change color.
- Use gold/yellow plus bold styling for the `xhigh` thinking label instead of red.
- Add fun high-context labels in the editor with escalating colors: `dumb`, `dumber`, and `dumbest`.
- Render assistant `txt` code fences containing HTTP endpoint lists as compact Markdown route tables.
- Dedent assistant shell code fences, remove the extra code-block rendering indent, and style code-block fence rows as compact `╭─ language` / `╰─` rails so commands are easier to copy and paste.
- Collapse `pi-playwright` bash wrapper calls into colorized Playwright action summaries while keeping compact bash output rendering.
- Render `impeccable` skill live-mode bash calls and collapsed JSON results as compact action summaries.
- Render Pi extension statuses inside the Amp editor status row so pluggable live indicators like `pi-impeccable` do not create a separate footer line.
- Add an Amp command-arguments palette so slash-command sub-options stay in the overlay instead of Pi's footer selector.
- Tighten wide command-palette columns so descriptions start closer to command names.
- Add a focused `/skills` palette with skill names and wrapped descriptions instead of the general three-column command layout, and hide redundant command-source columns in argument palettes.

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
