import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, fuzzyFilter, Key, type KeybindingsManager, matchesKey, parseKey, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MIN_WIDTH = 40;
const MAX_ROWS = 14;
const SIDE_PADDING = 1;
const DEFAULT_TITLE = " Command Palette ";
const DEFAULT_HELP_HINT = " type filter · ↑↓ navigate · tab insert · enter run/insert · esc close ";

export interface CommandPaletteItem {
  name: string;
  description?: string;
  source?: string;
}

export interface CommandPaletteResult {
  command: string;
  action: "insert" | "submit";
}

export interface CommandPaletteArgumentItem {
  value: string;
  label: string;
  description?: string;
}

type GetArgumentCompletions = (command: string, prefix: string) => Promise<CommandPaletteArgumentItem[] | null>;

export interface CommandPaletteOverlayOptions {
  title?: string;
  helpHint?: string;
  itemLayout?: "columns" | "details";
  maxItems?: number;
  loadingMessage?: string;
  noMatchesMessage?: string;
  descriptionLines?: number;
  selectedDescriptionLines?: number;
  hideArgumentSource?: boolean;
}

type PaletteRenderItem = {
  name: string;
  description?: string;
  source?: string;
  value?: string;
};

export const BUILTIN_COMMAND_PALETTE_ITEMS: CommandPaletteItem[] = [
  { name: "settings", description: "Open settings menu", source: "builtin" },
  { name: "model", description: "Select model", source: "builtin" },
  { name: "scoped-models", description: "Enable/disable Ctrl+P model cycling", source: "builtin" },
  { name: "export", description: "Export session", source: "builtin" },
  { name: "import", description: "Import and resume a session", source: "builtin" },
  { name: "share", description: "Share session as a secret GitHub gist", source: "builtin" },
  { name: "copy", description: "Copy last agent message to clipboard", source: "builtin" },
  { name: "name", description: "Set session display name", source: "builtin" },
  { name: "session", description: "Show session info and stats", source: "builtin" },
  { name: "changelog", description: "Show changelog entries", source: "builtin" },
  { name: "hotkeys", description: "Show all keyboard shortcuts", source: "builtin" },
  { name: "fork", description: "Create a new fork", source: "builtin" },
  { name: "clone", description: "Duplicate current session", source: "builtin" },
  { name: "tree", description: "Navigate session tree", source: "builtin" },
  { name: "login", description: "Configure provider authentication", source: "builtin" },
  { name: "logout", description: "Remove provider authentication", source: "builtin" },
  { name: "new", description: "Start a new session", source: "builtin" },
  { name: "compact", description: "Manually compact context", source: "builtin" },
  { name: "resume", description: "Resume a different session", source: "builtin" },
  { name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes", source: "builtin" },
  { name: "quit", description: "Quit Pi", source: "builtin" },
];

type StyleText = (color: ThemeColor, text: string) => string;

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function normalizeToSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export class CommandPaletteOverlay implements Component {
  private query: string;
  private selectedIndex = 0;
  private scrollOffset = 0;
  private argumentCommand: CommandPaletteItem | undefined;
  private argumentItems: CommandPaletteArgumentItem[] = [];
  private argumentLoading = false;
  private argumentRequestId = 0;

  constructor(
    private readonly items: CommandPaletteItem[],
    initialQuery: string,
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly done: (result: CommandPaletteResult | null) => void,
    private readonly getArgumentCompletions?: GetArgumentCompletions,
    private readonly options: CommandPaletteOverlayOptions = {},
  ) {
    this.query = initialQuery.replace(/^\//, "");
  }

  invalidate(): void {}

  handleInput(data: string): void {
    const rows = this.getRows();

    if (this.keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
      this.done(null);
      return;
    }

    if (this.keybindings.matches(data, "tui.select.up")) {
      this.selectedIndex = rows.length === 0 ? 0 : Math.max(0, this.selectedIndex - 1);
      this.ensureSelectionVisible();
      this.tui.requestRender();
      return;
    }

    if (this.keybindings.matches(data, "tui.select.down")) {
      this.selectedIndex = rows.length === 0 ? 0 : Math.min(rows.length - 1, this.selectedIndex + 1);
      this.ensureSelectionVisible();
      this.tui.requestRender();
      return;
    }

    if (this.keybindings.matches(data, "tui.select.pageUp")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - MAX_ROWS);
      this.ensureSelectionVisible();
      this.tui.requestRender();
      return;
    }

    if (this.keybindings.matches(data, "tui.select.pageDown")) {
      this.selectedIndex = rows.length === 0 ? 0 : Math.min(rows.length - 1, this.selectedIndex + MAX_ROWS);
      this.ensureSelectionVisible();
      this.tui.requestRender();
      return;
    }

    if (this.keybindings.matches(data, "tui.input.tab") || matchesKey(data, Key.tab)) {
      if (this.argumentCommand) {
        if (this.argumentLoading) return;
        this.finishArgument("insert", rows[this.selectedIndex]);
        return;
      }

      const selected = this.getFilteredItems()[this.selectedIndex];
      this.done(selected ? { command: selected.name, action: "insert" } : null);
      return;
    }

    if (this.keybindings.matches(data, "tui.select.confirm")) {
      if (this.argumentCommand) {
        if (this.argumentLoading) return;
        this.finishArgument("submit", rows[this.selectedIndex]);
        return;
      }

      const selected = this.getFilteredItems()[this.selectedIndex];
      if (!selected) {
        this.done(null);
        return;
      }

      void this.submitOrOpenArguments(selected);
      return;
    }

    if (isClearQueryKey(data, this.keybindings)) {
      this.query = "";
      this.resetSelection();
      this.refreshArgumentItems(false);
      return;
    }

    if (this.keybindings.matches(data, "tui.editor.deleteCharBackward") || matchesKey(data, Key.backspace)) {
      if (this.argumentCommand && this.query.length === 0) {
        this.query = this.argumentCommand.name;
        this.argumentCommand = undefined;
        this.argumentItems = [];
        this.argumentLoading = false;
        this.resetSelection();
        this.tui.requestRender();
        return;
      }

      this.query = this.query.slice(0, -1);
      this.resetSelection();
      this.refreshArgumentItems(false);
      return;
    }

    const printable = getPrintableInput(data);
    if (printable) {
      this.query += printable;
      this.resetSelection();
      this.refreshArgumentItems(false);
    }
  }

  render(width: number): string[] {
    const boxWidth = Math.max(MIN_WIDTH, width);
    const innerWidth = Math.max(1, boxWidth - 2);
    const contentWidth = Math.max(1, innerWidth - SIDE_PADDING * 2);
    const items = this.getRows();
    this.selectedIndex = items.length === 0 ? 0 : Math.min(this.selectedIndex, items.length - 1);
    this.ensureSelectionVisible();

    const maxItems = this.getMaxItems();
    const visibleItems = items.slice(this.scrollOffset, this.scrollOffset + maxItems);
    const rows = this.argumentLoading
      ? [this.fg("dim", this.options.loadingMessage ?? "Loading options…")]
      : visibleItems.length > 0
        ? visibleItems.flatMap((item, index) => this.renderItemRows(item, this.scrollOffset + index === this.selectedIndex, contentWidth))
        : [this.fg("warning", this.options.noMatchesMessage ?? (this.argumentCommand ? "No options match" : "No commands match"))];

    return [
      topBorder(boxWidth, this.theme, this.options.title ?? DEFAULT_TITLE),
      wrapContent(this.renderInput(contentWidth), boxWidth, this.theme),
      wrapContent("", boxWidth, this.theme),
      ...rows.map((row) => wrapContent(row, boxWidth, this.theme)),
      wrapContent(this.renderCount(items.length, contentWidth), boxWidth, this.theme),
      bottomBorder(boxWidth, this.theme, this.options.helpHint ?? DEFAULT_HELP_HINT),
    ];
  }

  private getMaxItems(): number {
    return Math.max(1, this.options.maxItems ?? MAX_ROWS);
  }

  private resetSelection(): void {
    this.selectedIndex = 0;
    this.scrollOffset = 0;
  }

  private getRows(): PaletteRenderItem[] {
    if (!this.argumentCommand) return this.getFilteredItems();
    return dedupeArgumentItems(this.argumentItems).map((item) => ({
      name: item.label || item.value,
      value: item.value,
      description: item.description,
      source: this.options.hideArgumentSource ? undefined : this.argumentCommand?.name,
    }));
  }

  private async submitOrOpenArguments(selected: CommandPaletteItem): Promise<void> {
    const action = getDefaultCommandAction(selected);
    if (action === "insert" || !this.getArgumentCompletions) {
      this.done({ command: selected.name, action });
      return;
    }

    this.argumentCommand = selected;
    this.argumentItems = [];
    this.argumentLoading = true;
    this.query = "";
    this.resetSelection();
    this.tui.requestRender();
    this.refreshArgumentItems(true);
  }

  private refreshArgumentItems(fallbackToCommand: boolean): void {
    if (!this.argumentCommand || !this.getArgumentCompletions) {
      this.tui.requestRender();
      return;
    }

    const command = this.argumentCommand;
    const prefix = this.query;
    const requestId = ++this.argumentRequestId;
    this.argumentLoading = true;
    this.tui.requestRender();

    this.getArgumentCompletions(command.name, prefix).then((items) => {
      if (requestId !== this.argumentRequestId || this.argumentCommand !== command) return;
      const nextItems = dedupeArgumentItems(items ?? []);
      if (nextItems.length === 0 && fallbackToCommand) {
        this.done({ command: command.name, action: getDefaultCommandAction(command) });
        return;
      }

      this.argumentItems = nextItems;
      this.argumentLoading = false;
      this.resetSelection();
      this.tui.requestRender();
    }).catch(() => {
      if (requestId !== this.argumentRequestId || this.argumentCommand !== command) return;
      if (fallbackToCommand) {
        this.done({ command: command.name, action: getDefaultCommandAction(command) });
        return;
      }

      this.argumentItems = [];
      this.argumentLoading = false;
      this.resetSelection();
      this.tui.requestRender();
    });
  }

  private finishArgument(action: CommandPaletteResult["action"], selected: PaletteRenderItem | undefined): void {
    const command = this.argumentCommand;
    if (!command) return;

    const value = selected?.value ?? this.query.trim();
    const fullCommand = value ? `${command.name} ${value}` : command.name;
    this.done({ command: fullCommand, action });
  }

  private ensureSelectionVisible(): void {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
      return;
    }

    const maxItems = this.getMaxItems();
    const lastVisibleIndex = this.scrollOffset + maxItems - 1;
    if (this.selectedIndex > lastVisibleIndex) {
      this.scrollOffset = this.selectedIndex - maxItems + 1;
    }
  }

  private getFilteredItems(): CommandPaletteItem[] {
    const deduped = dedupeItems(this.items);
    if (!this.query.trim()) return deduped;
    return fuzzyFilter(deduped, this.query, (item) => [item.name, item.description, item.source]
      .filter((value): value is string => value !== undefined)
      .map(normalizeToSingleLine)
      .join(" "));
  }

  private renderInput(width: number): string {
    const prompt = this.fg("dim", "> ");
    const value = this.argumentCommand ? `/${this.argumentCommand.name} ${this.query}` : this.query;
    const text = this.fg("text", value);
    return truncateToWidth(prompt + text, width, "…", true);
  }

  private renderItemRows(item: PaletteRenderItem, selected: boolean, width: number): string[] {
    if (this.options.itemLayout === "details" && !this.argumentCommand) {
      return this.renderDetailItem(item, selected, width);
    }
    return [this.renderColumnItem(item, selected, width)];
  }

  private renderColumnItem(item: PaletteRenderItem, selected: boolean, width: number): string {
    const marker = selected ? this.fg("accent", "→ ") : "  ";
    const sourceText = item.source ? normalizeToSingleLine(item.source) : "";
    const sourceWidth = sourceText ? 12 : 0;
    const nameWidth = Math.min(32, Math.max(8, Math.floor(width * 0.25)));
    const sourceGap = sourceText ? 2 : 0;
    const descriptionWidth = Math.max(0, width - sourceWidth - sourceGap - nameWidth - 4);
    const nameText = normalizeToSingleLine(item.name);
    const descriptionText = item.description ? normalizeToSingleLine(item.description) : "";
    const source = sourceText ? this.fg("muted", truncateToWidth(sourceText, sourceWidth, "…")) : "";
    const nameColor: ThemeColor = selected ? "accent" : "text";
    const name = this.fg(nameColor, truncateToWidth(nameText, nameWidth, "…"));
    const description = descriptionText ? this.fg(selected ? "text" : "muted", truncateToWidth(descriptionText, descriptionWidth, "…")) : "";
    const left = sourceText ? padVisible(`${marker}${source}`, sourceWidth + 2) : marker;
    const middle = padVisible(name, nameWidth + 2);
    return truncateToWidth(`${left}${middle}${description}`, width, "", true);
  }

  private renderDetailItem(item: PaletteRenderItem, selected: boolean, width: number): string[] {
    const marker = selected ? this.fg("accent", "→ ") : "  ";
    const nameText = normalizeToSingleLine(item.name);
    const descriptionText = item.description ? normalizeToSingleLine(item.description) : "";
    const nameColor: ThemeColor = selected ? "accent" : "text";
    const name = this.fg(nameColor, selected ? this.theme.bold(nameText) : nameText);
    const lines = [truncateToWidth(`${marker}${name}`, width, "", true)];

    if (!descriptionText) return lines;

    const indent = "    ";
    const descriptionWidth = Math.max(1, width - visibleWidth(indent));
    const maxDescriptionLines = selected
      ? (this.options.selectedDescriptionLines ?? 4)
      : (this.options.descriptionLines ?? 2);
    const descriptionLines = wrapPlainText(descriptionText, descriptionWidth, maxDescriptionLines);
    const descriptionColor: ThemeColor = selected ? "text" : "muted";
    lines.push(...descriptionLines.map((line) => `${indent}${this.fg(descriptionColor, line)}`));
    return lines;
  }

  private renderCount(total: number, width: number): string {
    const maxItems = this.getMaxItems();
    const shown = Math.min(total, maxItems);
    const text = total > maxItems ? `(${shown}/${total})` : `(${total})`;
    return truncateToWidth(this.fg("dim", text), width, "");
  }

  private fg(color: ThemeColor, text: string): string {
    return this.theme.fg(color, text);
  }
}

function getDefaultCommandAction(item: CommandPaletteItem): CommandPaletteResult["action"] {
  return item.source === "skill" || item.source === "prompt" ? "insert" : "submit";
}

function dedupeItems(items: CommandPaletteItem[]): CommandPaletteItem[] {
  const seen = new Set<string>();
  const result: CommandPaletteItem[] = [];
  for (const item of items) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    result.push(item);
  }
  return result;
}

function dedupeArgumentItems(items: CommandPaletteArgumentItem[]): CommandPaletteArgumentItem[] {
  const seen = new Set<string>();
  const result: CommandPaletteArgumentItem[] = [];
  for (const item of items) {
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    result.push(item);
  }
  return result;
}

function isClearQueryKey(data: string, keybindings: KeybindingsManager): boolean {
  const parsed = parseKey(data);
  return (
    data === "\x15" ||
    keybindings.matches(data, "tui.editor.deleteToLineStart") ||
    matchesKey(data, Key.ctrl("u")) ||
    matchesKey(data, Key.super("backspace")) ||
    matchesKey(data, Key.super("delete")) ||
    parsed === "super+backspace" ||
    parsed === "super+delete" ||
    parsed === "ctrl+backspace" ||
    parsed === "ctrl+delete"
  );
}

function getPrintableInput(data: string): string {
  if (data.length === 1 && data >= " " && data !== "\x7f") return data;
  return "";
}

function wrapPlainText(text: string, width: number, maxLines: number): string[] {
  if (maxLines <= 0) return [];

  const words = normalizeToSingleLine(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let consumedWords = 0;

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (visibleWidth(candidate) <= width) {
      current = candidate;
      consumedWords += 1;
      continue;
    }

    if (current) {
      lines.push(current);
      if (lines.length >= maxLines) break;
      current = "";
    }

    if (visibleWidth(word) > width) {
      lines.push(truncateToWidth(word, width, "…"));
      consumedWords += 1;
      if (lines.length >= maxLines) break;
      continue;
    }

    current = word;
    consumedWords += 1;
  }

  if (current && lines.length < maxLines) lines.push(current);

  if (consumedWords < words.length && lines.length > 0) {
    const lastIndex = lines.length - 1;
    lines[lastIndex] = truncateToWidth(`${lines[lastIndex]}…`, width, "…");
  }

  return lines;
}

function topBorder(width: number, theme: Theme, titleLabel: string): string {
  const innerWidth = Math.max(0, width - 2);
  const titleWidth = visibleWidth(titleLabel);
  if (innerWidth < titleWidth + 2) return theme.fg("accent", `╭${"─".repeat(innerWidth)}╮`);

  const leftFill = Math.max(1, Math.floor((innerWidth - titleWidth) / 2));
  const rightFill = Math.max(0, innerWidth - titleWidth - leftFill);
  const title = theme.fg("accent", theme.bold(titleLabel));
  return theme.fg("accent", `╭${"─".repeat(leftFill)}`) + title + theme.fg("accent", `${"─".repeat(rightFill)}╮`);
}

function bottomBorder(width: number, theme: Theme, helpHint: string): string {
  const innerWidth = Math.max(0, width - 2);
  if (innerWidth < visibleWidth(helpHint) + 2) return theme.fg("accent", `╰${"─".repeat(innerWidth)}╯`);

  const label = theme.fg("dim", helpHint);
  const fill = Math.max(0, innerWidth - visibleWidth(helpHint) - 1);
  return theme.fg("accent", "╰") + theme.fg("accent", "─".repeat(fill)) + label + theme.fg("accent", "─╯");
}

function wrapContent(line: string, width: number, theme: Theme): string {
  const innerWidth = Math.max(1, width - 2 - SIDE_PADDING * 2);
  const clipped = truncateToWidth(line, innerWidth, "", true);
  return theme.fg("accent", "│") + " ".repeat(SIDE_PADDING) + padVisible(clipped, innerWidth) + " ".repeat(SIDE_PADDING) + theme.fg("accent", "│");
}

function padVisible(line: string, width: number): string {
  return line + " ".repeat(Math.max(0, width - visibleWidth(line)));
}
