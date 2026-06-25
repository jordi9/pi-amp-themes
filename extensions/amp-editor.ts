import { CustomEditor, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, type ReadonlyFooterDataProvider, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey, truncateToWidth, visibleWidth, type AutocompleteItem, type AutocompleteProvider, type Component } from "@earendil-works/pi-tui";
import { BUILTIN_COMMAND_PALETTE_ITEMS, CommandPaletteOverlay, type CommandPaletteArgumentItem, type CommandPaletteItem, type CommandPaletteResult, stripAnsi } from "./amp-command-palette.js";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { relative } from "node:path";

const MIN_BODY_LINES = 2;
const EDITOR_TEXT_LEFT_INSET = 1;
const VCS_CACHE_MS = 2000;
const STATUS_LEFT_INSET = 1;
const STATUS_RIGHT_INSET = 1;
export type WorkingAnimation = {
  name: string;
  frames: readonly string[];
  intervalMs: number;
};

const WORKING_WAITING = "Waiting";
const WORKING_THINKING = "Thinking";
const WORKING_STREAMING = "Streaming";
const WORKING_TOOLS = "Using tools";
const FINISHED_STATUS_MS = 7000;
const COPY_PROMPT_STATUS_MS = 3000;
const COPY_PROMPT_SHORTCUT = "ctrl+shift+x";
const ASK_USER_QUESTION_TOOL = "ask_user_question";
const ASK_USER_QUESTION_COLLAPSE_KEY = "\x1d";
const ASK_USER_QUESTION_COLLAPSE_ALIASES = ["ctrl+o"] as const;
const ASK_USER_QUESTION_COLLAPSE_RAW_KEYS = new Set(["\x0f"]);
const WAITING_NOTIFICATION_INTERVAL_MS = 650;
const WAITING_NOTIFICATION_PULSE_MS = 60_000;
const WAITING_NOTIFICATION_FRAMES = ["", ""] as const;
export const AMP_WAITING_NOTIFICATION_EVENT = "amp:waiting_notification";
const TERMINAL_FOCUS_IN = "\x1b[I";
const TERMINAL_FOCUS_OUT = "\x1b[O";
const TERMINAL_FOCUS_REPORTING_ENABLE = "\x1b[?1004h";
const TERMINAL_FOCUS_REPORTING_DISABLE = "\x1b[?1004l";
const TERMINAL_BELL = "\x07";
const VCS_CHANGED_FILES_ICON = "✎";

// Compact, single-line animations for the editor status row. Inspired by
// Hermes' grab-bag of spinners while keeping most frames narrow enough that
// `Esc to cancel` and elapsed time still fit beside the terse phase labels.
export const WORKING_ANIMATIONS = [
  { name: "amp-wave", frames: ["~", "≈", "≋"], intervalMs: 160 },
  { name: "braille", frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], intervalMs: 100 },
  { name: "bounce", frames: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"], intervalMs: 120 },
  { name: "grow", frames: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"], intervalMs: 90 },
  { name: "arrows", frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"], intervalMs: 110 },
  { name: "orbit", frames: ["◜", "◠", "◝", "◞", "◡", "◟"], intervalMs: 120 },
  { name: "sparkle", frames: ["⁺", "˚", "*", "✧", "✦", "✧", "*", "˚"], intervalMs: 140 },
  { name: "ascii", frames: ["|", "/", "-", "\\"], intervalMs: 100 },
  { name: "scan", frames: ["[   ]", "[=  ]", "[== ]", "[===]", "[ ==]", "[  =]"], intervalMs: 130 },
  { name: "blocks", frames: ["▖", "▘", "▝", "▗"], intervalMs: 120 },
] as const satisfies readonly WorkingAnimation[];

export const DEFAULT_WORKING_ANIMATION = WORKING_ANIMATIONS[0];
const CENTER_TEXT = "I HAD POTENTIAL";

type FinishedStatus = "finished" | "cancelled";

type WorkingState = {
  active: boolean;
  message: string;
  frame: string;
  elapsedMs: number | undefined;
  finishedElapsedMs: number | undefined;
  finishedStatus: FinishedStatus;
};

type WaitingNotificationState = {
  active: boolean;
  frame: string;
  chromeColor: ThemeColor;
};

export type AmpWaitingNotificationEvent = {
  active: boolean;
  startedAt?: number;
  terminalFocusActive: boolean;
};

export type VcsInfo = {
  kind: "git" | "jj";
  branch: string | null;
  description: string | null;
  changedFiles: number;
  added: number;
  modified: number;
  removed: number;
};

type ClipboardCommand = {
  command: string;
  args: string[];
  label: string;
};

type ClipboardResult =
  | { ok: true; label: string }
  | { ok: false; message: string };

type CopyPromptStatus = {
  message: string;
  color: ThemeColor;
  icon: string;
};

type ShortcutRegistrar = {
  registerShortcut?: (shortcut: string, options: {
    description: string;
    handler: (ctx: ExtensionContext) => void | Promise<void>;
  }) => void;
};

type OptionalEventBusAPI = {
  events?: {
    emit?: (channel: string, data: unknown) => void;
  };
};

type InputListenerResult = { consume?: boolean; data?: string } | undefined;

type TuiWithInputListener = {
  requestRender(): void;
  addInputListener?: (listener: (data: string) => InputListenerResult) => () => void;
};

type FocusedComponentAccessor = {
  focusedComponent?: { handleInput?: (data: string) => void } | null;
};

let vcsCache: { cwd: string; at: number; info: VcsInfo } | undefined;

type DiffCounts = Pick<VcsInfo, "added" | "modified" | "removed">;
type Colorize = (color: ThemeColor, text: string) => string;

function runCommand(command: string, cwd: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    }).trim();
  } catch {
    return "";
  }
}

function runGit(cwd: string, args: string[]): string {
  return runCommand("git", cwd, args);
}

function runJj(cwd: string, args: string[]): string {
  return runCommand("jj", cwd, ["--color", "never", ...args]);
}

function countOutputLines(output: string): number {
  return output ? output.split("\n").filter((line) => line.trim().length > 0).length : 0;
}

function splitLineChanges(added: number, removed: number): DiffCounts {
  const modified = Math.min(added, removed);
  return { added: added - modified, modified, removed: removed - modified };
}

function countFromMatch(text: string, pattern: RegExp): number {
  const match = text.match(pattern);
  if (!match) return 0;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 0;
}

export function normalizeJjDescription(description: string): string | null {
  const firstLine = description.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
  if (!firstLine || firstLine === "(no description set)" || firstLine === "no description set") return null;
  return firstLine;
}

export function parseDiffStatSummary(stat: string): DiffCounts {
  const summary = stat
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((line) => /\bfiles? changed\b/.test(line));

  if (!summary) return { added: 0, modified: 0, removed: 0 };

  const added = countFromMatch(summary, /(\d+)\s+insertions?\(\+\)/);
  const removed = countFromMatch(summary, /(\d+)\s+deletions?\(-\)/);
  return splitLineChanges(added, removed);
}

function parseGitNumstat(numstat: string): DiffCounts {
  let added = 0;
  let removed = 0;

  for (const line of numstat.split("\n")) {
    const [a, r] = line.split("\t");
    const add = Number(a);
    const rem = Number(r);
    if (Number.isFinite(add)) added += add;
    if (Number.isFinite(rem)) removed += rem;
  }

  return splitLineChanges(added, removed);
}

function getGitInfo(cwd: string): VcsInfo {
  const branch = runGit(cwd, ["branch", "--show-current"]) || null;
  const porcelain = runGit(cwd, ["status", "--short"]);
  const changedFiles = countOutputLines(porcelain);
  const counts = parseGitNumstat(runGit(cwd, ["diff", "--numstat"]));

  return { kind: "git", branch, description: null, changedFiles, ...counts };
}

function getJjInfo(cwd: string): VcsInfo {
  const description = normalizeJjDescription(runJj(cwd, ["log", "--no-graph", "-r", "@", "-T", "description.first_line()"]))
    ?? null;
  const changedFiles = countOutputLines(runJj(cwd, ["diff", "--name-only"]));
  const counts = parseDiffStatSummary(runJj(cwd, ["diff", "--stat"]));

  return { kind: "jj", branch: null, description, changedFiles, ...counts };
}

function getVcsInfo(cwd: string): VcsInfo {
  const now = Date.now();
  if (vcsCache && vcsCache.cwd === cwd && now - vcsCache.at < VCS_CACHE_MS) return vcsCache.info;

  const info = runJj(cwd, ["root"]) ? getJjInfo(cwd) : getGitInfo(cwd);
  vcsCache = { cwd, at: now, info };
  return info;
}

export function formatVcsChangesLabel(info: VcsInfo, colorize: Colorize = (_color, text) => text): string {
  const parts: string[] = [];

  if (info.kind === "jj" && info.description) {
    parts.push(colorize("muted", info.description));
  }

  if (info.changedFiles > 0) {
    const fileLabel = colorize("syntaxNumber", `${VCS_CHANGED_FILES_ICON}${info.changedFiles}`);
    const added = info.added > 0 ? ` ${colorize("toolDiffAdded", `+${info.added}`)}` : "";
    const modified = info.modified > 0 ? ` ${colorize("warning", `~${info.modified}`)}` : "";
    const removed = info.removed > 0 ? ` ${colorize("toolDiffRemoved", `-${info.removed}`)}` : "";
    parts.push(`${fileLabel}${added}${modified}${removed}`);
  }

  return parts.join(` ${colorize("muted", "·")} `);
}

function clipboardCandidates(): ClipboardCommand[] {
  const commands: ClipboardCommand[] = [];
  const add = (command: string, args: string[], label = command) => {
    if (commands.some((candidate) => candidate.command === command && candidate.args.join("\0") === args.join("\0"))) return;
    commands.push({ command, args, label });
  };

  if (process.platform === "darwin") {
    add("pbcopy", [], "pbcopy");
    return commands;
  }

  if (process.platform === "win32") {
    add("powershell.exe", ["-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"], "powershell");
    add("clip.exe", [], "clip.exe");
    return commands;
  }

  if (process.env.WAYLAND_DISPLAY) add("wl-copy", [], "wl-copy");
  if (process.env.DISPLAY) {
    add("xclip", ["-selection", "clipboard"], "xclip");
    add("xsel", ["--clipboard", "--input"], "xsel");
  }
  add("wl-copy", [], "wl-copy");
  add("xclip", ["-selection", "clipboard"], "xclip");
  add("xsel", ["--clipboard", "--input"], "xsel");
  add("termux-clipboard-set", [], "termux-clipboard-set");
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) add("clip.exe", [], "clip.exe");
  return commands;
}

function writeClipboard(text: string): ClipboardResult {
  const errors: string[] = [];

  for (const candidate of clipboardCandidates()) {
    const result = spawnSync(candidate.command, candidate.args, {
      input: text,
      encoding: "utf8",
      stdio: ["pipe", "ignore", "pipe"],
    });

    if (result.error) {
      errors.push(`${candidate.label}: ${result.error.message}`);
      continue;
    }

    if (result.status === 0) return { ok: true, label: candidate.label };

    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const detail = stderr || (result.signal ? `terminated by ${result.signal}` : `exit ${result.status ?? "unknown"}`);
    errors.push(`${candidate.label}: ${detail}`);
  }

  return {
    ok: false,
    message: errors[0] ?? "no clipboard command found",
  };
}

function getEditorText(ctx: ExtensionContext): string {
  return (ctx.ui as typeof ctx.ui & { getEditorText?: () => string }).getEditorText?.() ?? "";
}

function copyPromptToClipboard(ctx: ExtensionContext): CopyPromptStatus | undefined {
  if (!ctx.hasUI) return undefined;

  const prompt = getEditorText(ctx);
  if (!prompt) {
    return { icon: "!", color: "warning", message: "prompt empty" };
  }

  const result = writeClipboard(prompt);
  if (result.ok) {
    return { icon: "✓", color: "success", message: "prompt copied to clipboard" };
  }

  return { icon: "!", color: "error", message: `copy failed: ${result.message}` };
}

function formatCount(value: number | null | undefined): string {
  if (value == null) return "?";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function formatCost(value: number): string {
  if (value === 0) return "$0.000";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function getContextWarning(percent: number | null | undefined): { label: string; color: ThemeColor } | undefined {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return undefined;
  if (percent > 85) return { label: "dumbest", color: "error" };
  if (percent > 70) return { label: "dumber", color: "warning" };
  if (percent > 50) return { label: "dumb", color: "mdHeading" };
  return undefined;
}

function isCancelledAgentEnd(event: { messages?: readonly unknown[] }): boolean {
  if (!Array.isArray(event.messages)) return false;

  let lastAssistantStopReason: unknown;
  for (const message of event.messages) {
    if (typeof message !== "object" || message === null) continue;
    const candidate = message as { role?: unknown; stopReason?: unknown };
    if (candidate.role === "assistant") lastAssistantStopReason = candidate.stopReason;
  }

  return lastAssistantStopReason === "aborted";
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function compactModelId(modelId: string, maxWidth: number): string {
  if (visibleWidth(modelId) <= maxWidth) return modelId;

  const simplified = modelId
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "")
    .replace(/-20\d{6}$/, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "");

  if (visibleWidth(simplified) <= maxWidth) return simplified;
  return truncateToWidth(simplified, maxWidth, "…");
}

function compactPath(cwd: string): string {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~/${relative(home, cwd)}`;
  return cwd;
}

function isEditorRule(line: string): boolean {
  const plain = stripAnsi(line).trim();
  return plain.includes("─") && [...plain].every((char) => "─↑↓ 0123456789more".includes(char));
}

function splitEditorRender(lines: string[]): { editorLines: string[]; popupLines: string[] } {
  const withoutTop = lines.slice(1);
  const bottomRuleIndex = withoutTop.findIndex(isEditorRule);

  if (bottomRuleIndex === -1) {
    return { editorLines: withoutTop, popupLines: [] };
  }

  return {
    editorLines: withoutTop.slice(0, bottomRuleIndex),
    popupLines: withoutTop.slice(bottomRuleIndex + 1),
  };
}

function hideBuiltInWorking(ctx: ExtensionContext): void {
  (ctx.ui as typeof ctx.ui & { setWorkingVisible?: (visible: boolean) => void }).setWorkingVisible?.(false);
}

function joinStatusLabels(parts: string[], separator: string): string {
  return parts.filter(Boolean).join(separator);
}

export function formatExtensionStatuses(statuses: ReadonlyMap<string, string>): string {
  return Array.from(statuses.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

class EmptyFooter implements Component {
  render(): string[] {
    return [];
  }

  invalidate(): void {}
}

function safeRandomUnit(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.999999999, value));
}

export function pickWorkingAnimation(
  previous: WorkingAnimation | undefined,
  random: () => number = Math.random,
): WorkingAnimation {
  const nextIndex = Math.floor(safeRandomUnit(random) * WORKING_ANIMATIONS.length);
  const previousIndex = previous === undefined
    ? -1
    : WORKING_ANIMATIONS.findIndex((animation) => animation.name === previous.name);

  if (WORKING_ANIMATIONS.length > 1 && nextIndex === previousIndex) {
    return WORKING_ANIMATIONS[(nextIndex + 1) % WORKING_ANIMATIONS.length];
  }

  return WORKING_ANIMATIONS[nextIndex] ?? DEFAULT_WORKING_ANIMATION;
}

export function getWorkingAnimationFrame(animation: WorkingAnimation, frameIndex: number): string {
  const frames = animation.frames.length > 0 ? animation.frames : DEFAULT_WORKING_ANIMATION.frames;
  const index = Math.abs(frameIndex) % frames.length;
  const frame = frames[index] ?? frames[0] ?? "";
  const width = frames.reduce((maxWidth, candidate) => Math.max(maxWidth, visibleWidth(candidate)), 0);
  return frame + " ".repeat(Math.max(0, width - visibleWidth(frame)));
}

function getWorkingAnimation(name: string): WorkingAnimation | undefined {
  const normalized = name.trim().toLowerCase();
  return WORKING_ANIMATIONS.find((animation) => animation.name === normalized);
}

function workingAnimationSummary(animation: WorkingAnimation): string {
  return `${animation.name} (${animation.frames.join(" ")})`;
}

function workingAnimationCommandHelp(): string {
  return `Usage: /working-animation [random|${WORKING_ANIMATIONS.map((animation) => animation.name).join("|")}]`;
}

function getWorkingAnimationCompletions(prefix: string): AutocompleteItem[] | null {
  const normalized = prefix.trim().toLowerCase();
  const items: AutocompleteItem[] = [
    {
      value: "random",
      label: "random",
      description: "Pick a different animation for each prompt.",
    },
    {
      value: "list",
      label: "list",
      description: "Show current mode and available animation names.",
    },
    {
      value: "reset",
      label: "reset",
      description: "Alias for random selection.",
    },
    ...WORKING_ANIMATIONS.map((animation) => ({
      value: animation.name,
      label: animation.name,
      description: animation.frames.join(" "),
    })),
  ];

  const filtered = items.filter((item) => item.value.startsWith(normalized));
  return filtered.length > 0 ? filtered : null;
}

class AmpEditor extends CustomEditor {
  private editorFocused = false;

  constructor(
    tui: any,
    theme: any,
    keybindings: any,
    private readonly getCtx: () => ExtensionContext,
    private readonly getThinkingLevel: () => string,
    private readonly getWorkingState: () => WorkingState,
    private readonly getWaitingNotificationState: () => WaitingNotificationState,
    private readonly getExtensionStatus: () => string,
    private readonly getCopyPromptStatus: () => CopyPromptStatus | undefined,
    private readonly dismissWaitingNotification: () => void,
    private readonly setTerminalFocusActive: (active: boolean) => void,
    private readonly openCommandPalette: (
      initialQuery: string | undefined,
      onSelect: (result: CommandPaletteResult) => void,
      options?: { forceInsert?: boolean },
    ) => void,
  ) {
    super(tui, theme, keybindings, { paddingX: 0 });
    this.editorFocused = Boolean(this.focused);
    Object.defineProperty(this, "focused", {
      configurable: true,
      enumerable: true,
      get: () => this.editorFocused,
      set: (value: boolean) => {
        const wasFocused = this.editorFocused;
        this.editorFocused = value;
        if (value && !wasFocused) this.dismissWaitingNotification();
      },
    });
  }

  private get ctx(): ExtensionContext {
    return this.getCtx();
  }

  handleInput(data: string): void {
    if (data === TERMINAL_FOCUS_IN) {
      this.setTerminalFocusActive(true);
      this.dismissWaitingNotification();
      return;
    }

    if (data === TERMINAL_FOCUS_OUT) {
      this.setTerminalFocusActive(false);
      return;
    }

    this.setTerminalFocusActive(true);
    this.dismissWaitingNotification();

    if (data === "/" && !this.isShowingAutocomplete()) {
      const preservePrompt = this.getText().trim() !== "";
      this.openCommandPalette(undefined, (result) => {
        if (result.action === "literal") {
          this.insertLiteral(result.command);
        } else if (preservePrompt || result.action === "insert") {
          this.insertCommand(result.command, preservePrompt);
        } else {
          this.submitCommand(result.command);
        }
      }, { forceInsert: preservePrompt });
      return;
    }

    super.handleInput(data);
  }

  private insertCommand(command: string, preservePrompt = false): void {
    const commandText = `/${command} `;
    if (preservePrompt) {
      this.insertTextAtCursor(this.withPromptSeparators(commandText));
    } else {
      this.setText(commandText);
    }
    this.tui.requestRender();
  }

  private insertLiteral(text: string): void {
    this.insertTextAtCursor(text);
    this.tui.requestRender();
  }

  private withPromptSeparators(text: string): string {
    const cursor = this.getCursor();
    const line = this.getLines()[cursor.line] ?? "";
    const beforeCursor = line.slice(0, cursor.col);
    const prefix = beforeCursor.length > 0 && !/\s$/.test(beforeCursor) ? " " : "";
    return `${prefix}${text}`;
  }

  private submitCommand(command: string): void {
    this.setText(`/${command}`);
    const submitValue = (this as unknown as { submitValue?: () => void }).submitValue;
    if (submitValue) {
      submitValue.call(this);
      return;
    }

    this.onSubmit?.(`/${command}`);
  }

  render(width: number): string[] {
    if (width < 12) return super.render(width);

    const innerWidth = Math.max(1, width - 2);
    const editorWidth = Math.max(1, innerWidth - EDITOR_TEXT_LEFT_INSET);
    const base = super.render(editorWidth);
    const { editorLines, popupLines } = splitEditorRender(base);
    const body = [...editorLines];

    while (body.length < MIN_BODY_LINES) {
      body.push(" ".repeat(editorWidth));
    }

    const leftTop = this.getUsageLabel();
    const rightTop = this.getModelLabel(Math.max(8, Math.floor(innerWidth * 0.48)));
    const cwdLabel = this.getCwdLabel();
    const workingLabel = this.getWorkingLabel();
    const extensionStatusLabel = this.getExtensionStatusLabel();
    const outputExpandedLabel = this.getOutputExpandedLabel();
    const copyPromptLabel = this.getCopyPromptLabel();
    const vcsChangesLabel = this.getVcsChangesLabel();
    const leftStatusLabel = joinStatusLabels([
      workingLabel,
      extensionStatusLabel,
      outputExpandedLabel,
      copyPromptLabel,
    ], ` ${this.fg("muted", "·")} `);

    return [
      this.borderWithLabels(width, leftTop, rightTop),
      ...body.map((line) => this.wrapBody(line, innerWidth)),
      this.borderWithCenterThenPath(width, CENTER_TEXT, cwdLabel),
      ...this.statusRows(width, leftStatusLabel, vcsChangesLabel),
      ...this.wrapPopupBlock(popupLines, width),
    ];
  }

  private getUsageLabel(): string {
    const usage = this.ctx.getContextUsage();
    const pct = usage?.percent == null ? "?" : `${Math.max(0, Math.floor(usage.percent))}%`;
    const contextWindow = usage?.contextWindow ?? this.ctx.model?.contextWindow ?? null;
    const notification = this.getWaitingNotificationState();
    const notificationIcon = notification.active ? `${this.fg("accent", notification.frame)} ` : "";
    const parts = [` ${notificationIcon}${this.fg("muted", `${pct} of ${formatCount(contextWindow)}`)}`];
    const warning = getContextWarning(usage?.percent);

    if (warning) {
      parts.push(this.fg(warning.color, warning.label));
    }

    if (!this.isSubscription()) {
      const cost = this.getSessionCost();
      if (cost.hasCost) {
        parts.push(this.fg("muted", formatCost(cost.total)));
      }
    }

    return `${parts.join(this.fg("muted", " · "))} `;
  }

  private isSubscription(): boolean {
    if (!this.ctx.model) return false;
    const modelRegistry = this.ctx.modelRegistry as { isUsingOAuth?: (model: unknown) => boolean };
    if (modelRegistry.isUsingOAuth?.(this.ctx.model)) return true;
    const modelId = this.ctx.model.id.toLowerCase();
    return modelId.includes("minimax") || modelId.includes("gemini");
  }

  private getSessionCost(): { total: number; hasCost: boolean } {
    let total = 0;
    let hasCost = false;

    for (const entry of this.ctx.sessionManager.getEntries()) {
      if (entry.type !== "message" || entry.message.role !== "assistant") continue;

      const cost = entry.message.usage?.cost?.total;
      if (typeof cost !== "number" || !Number.isFinite(cost)) continue;

      total += cost;
      if (cost > 0) hasCost = true;
    }

    return { total, hasCost };
  }

  private getModelLabel(maxWidth: number): string {
    const modelId = this.ctx.model?.id ?? "model unknown";
    const thinkingLevel = this.getThinkingLevel();
    const thinkingWidth = visibleWidth(thinkingLevel);
    const modelWidth = Math.max(1, maxWidth - thinkingWidth - 3);
    const model = this.fg("text", compactModelId(modelId, modelWidth));
    const thinkingText = this.fg(this.getThinkingColor(), thinkingLevel);
    const thinking = thinkingLevel === "xhigh" ? this.ctx.ui.theme.bold(thinkingText) : thinkingText;
    return ` ${model} ${this.fg("dim", "·")} ${thinking} `;
  }

  private getThinkingColor(): ThemeColor {
    switch (this.getThinkingLevel()) {
      case "minimal":
        return "thinkingMinimal";
      case "low":
        return "thinkingLow";
      case "medium":
        return "thinkingMedium";
      case "high":
        return "thinkingHigh";
      case "xhigh":
        return "thinkingXhigh";
      case "off":
      default:
        return "thinkingOff";
    }
  }

  private getCwdLabel(): string {
    const vcs = getVcsInfo(this.ctx.cwd);
    return ` ${compactPath(this.ctx.cwd)}${vcs.branch ? ` (${vcs.branch})` : ""} `;
  }

  private getWorkingLabel(): string {
    const working = this.getWorkingState();
    if (!working.active) {
      if (working.finishedElapsedMs === undefined) return "";
      const status = working.finishedStatus === "cancelled"
        ? { color: "warning" as const, icon: "×", label: "Cancelled" }
        : { color: "success" as const, icon: "✓", label: "Finished" };
      return `${this.fg(status.color, status.icon)} ${this.fg("text", status.label)} ${this.fg("muted", "·")} ${this.fg("accent", formatElapsed(working.finishedElapsedMs))}`;
    }

    const cancelHint = `${this.fg("accent", "Esc")}${this.fg("muted", " to cancel")}`;
    const elapsed = working.elapsedMs === undefined
      ? ""
      : `${this.fg("muted", " · ")}${this.fg("accent", formatElapsed(working.elapsedMs))}`;
    return `${this.fg("accent", working.frame)} ${this.fg("text", working.message)}  ${cancelHint}${elapsed}`;
  }

  private getExtensionStatusLabel(): string {
    return this.getExtensionStatus();
  }

  private getOutputExpandedLabel(): string {
    if (!this.isOutputExpanded()) return "";

    return `${this.fg("warning", "output expanded")} ${this.fg("muted", "·")} ${this.fg("accent", "Ctrl+O")} ${this.fg("muted", "to collapse")}`;
  }

  private getCopyPromptLabel(): string {
    const status = this.getCopyPromptStatus();
    if (!status) return "";

    return `${this.fg(status.color, status.icon)} ${this.fg("text", status.message)}`;
  }

  private isOutputExpanded(): boolean {
    try {
      return this.ctx.ui.getToolsExpanded();
    } catch {
      return false;
    }
  }

  private getVcsChangesLabel(): string {
    return formatVcsChangesLabel(getVcsInfo(this.ctx.cwd), (color, text) => this.fg(color, text));
  }

  private fg(color: ThemeColor, text: string): string {
    return this.ctx.ui.theme.fg(color, text);
  }

  private wrapBody(line: string, innerWidth: number): string {
    const leftInset = " ".repeat(EDITOR_TEXT_LEFT_INSET);
    const contentWidth = Math.max(1, innerWidth - EDITOR_TEXT_LEFT_INSET);
    const clipped = truncateToWidth(line, contentWidth, "");
    const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
    const content = clipped ? this.fg("text", clipped) : clipped;
    return this.sideBorder() + leftInset + content + padding + this.sideBorder();
  }

  private wrapPopupBlock(lines: string[], width: number): string[] {
    if (lines.length === 0) return [];

    const leftInset = " ".repeat(1 + EDITOR_TEXT_LEFT_INSET);
    const contentWidth = Math.max(1, width - visibleWidth(leftInset));
    return lines.map((line) => {
      const clipped = truncateToWidth(line, contentWidth, "");
      const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
      return leftInset + clipped + padding;
    });
  }

  private statusRows(width: number, leftLabel: string, rightLabel: string): string[] {
    if (!leftLabel && !rightLabel) return [];

    const contentWidth = Math.max(1, width - STATUS_LEFT_INSET - STATUS_RIGHT_INSET);
    const maxRight = rightLabel ? Math.max(0, Math.floor(contentWidth * 0.56)) : 0;
    const right = truncateToWidth(rightLabel, maxRight, "…");
    const rightGap = right ? 2 : 0;
    const maxLeft = Math.max(0, contentWidth - visibleWidth(right) - rightGap);
    const left = truncateToWidth(leftLabel, maxLeft, "…");
    const minGap = left && right ? 2 : 0;
    const gap = " ".repeat(Math.max(minGap, contentWidth - visibleWidth(left) - visibleWidth(right)));
    const leftPadding = " ".repeat(Math.min(STATUS_LEFT_INSET, Math.max(0, width - contentWidth)));
    const rightPadding = " ".repeat(Math.min(STATUS_RIGHT_INSET, Math.max(0, width - contentWidth - visibleWidth(leftPadding))));
    return [`${leftPadding}${left}${gap}${right}${rightPadding}`];
  }

  private promptBorderColor(text: string): string {
    const notification = this.getWaitingNotificationState();
    if (notification.active) return this.fg(notification.chromeColor, text);
    return this.fg("thinkingLow", text);
  }

  private borderWithLabels(width: number, leftLabel: string, rightLabel: string): string {
    const innerWidth = Math.max(0, width - 2);
    const maxLeft = Math.max(0, Math.floor(innerWidth * 0.44));
    const maxRight = Math.max(0, innerWidth - maxLeft - 2);
    const left = truncateToWidth(leftLabel, maxLeft, "…");
    const right = truncateToWidth(rightLabel, maxRight, "…");
    const used = visibleWidth(left) + visibleWidth(right);
    const fill = Math.max(0, innerWidth - used);
    return this.promptBorderColor("╭") + left + this.promptBorderColor("─".repeat(fill)) + right + this.promptBorderColor("╮");
  }

  private sideBorder(): string {
    return this.promptBorderColor("│");
  }

  private borderWithCenterThenPath(width: number, centerLabel: string, rightLabel: string): string {
    const innerWidth = Math.max(0, width - 2);
    // Minimum width: ╰ + sp + center(min 14) + sp + ╯ + right (at least 1)
    const minWidth = 20;
    if (innerWidth < minWidth) {
      const right = this.fg("muted", truncateToWidth(rightLabel.trim(), Math.max(0, innerWidth - 2), "…"));
      const fill = Math.max(0, innerWidth - visibleWidth(right));
      return this.promptBorderColor("╰") + this.promptBorderColor("─".repeat(fill)) + right + this.promptBorderColor("╯");
    }

    const centerTrunc = truncateToWidth(centerLabel, Math.max(0, Math.floor(innerWidth * 0.3)), "…");
    const centerText = this.fg("mdHeading", centerTrunc);
    const centerWidth = visibleWidth(centerText);

    // Layout: ╰ + [dashes] + sp + center + sp + [dashes] + sp + right + sp + ╯
    // Borders (2) + spaces (4) + right (at least 1)
    const minDashes = 1;
    const minPadding = 1;
    const rightMin = 1;
    const overhead = 2 + 4 + rightMin;
    const availableForRight = Math.max(rightMin, innerWidth - centerWidth - overhead);
    const rightText = truncateToWidth(rightLabel.trim(), availableForRight, "…");
    const right = this.fg("muted", rightText);
    const rightWidth = visibleWidth(right);

    const remaining = innerWidth - centerWidth - rightWidth - 4;
    const totalDashes = Math.max(2, remaining);
    const leftDashes = Math.floor(totalDashes / 2);
    const rightDashes = totalDashes - leftDashes;

    const leftD = this.promptBorderColor("─".repeat(leftDashes));
    const rightD = this.promptBorderColor("─".repeat(rightDashes));

    return (
      this.promptBorderColor("╰") +
      leftD +
      " " +
      centerText +
      " " +
      rightD +
      " " +
      right +
      " " +
      this.promptBorderColor("╯")
    );
  }

  private borderWithRightLabel(width: number, label: string): string {
    const innerWidth = Math.max(0, width - 2);
    const right = this.fg("muted", truncateToWidth(label, Math.max(0, innerWidth - 2), "…"));
    const fill = Math.max(0, innerWidth - visibleWidth(right));
    return this.promptBorderColor("╰") + this.promptBorderColor("─".repeat(fill)) + right + this.promptBorderColor("╯");
  }
}

function getCommandPaletteItems(pi: ExtensionAPI): CommandPaletteItem[] {
  const items = [
    ...BUILTIN_COMMAND_PALETTE_ITEMS,
    ...pi.getCommands().map((command) => ({
      name: command.name,
      description: command.description,
      source: command.source,
    })),
  ];
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

function getSkillPaletteItems(pi: ExtensionAPI): CommandPaletteItem[] {
  const seen = new Set<string>();
  return pi.getCommands()
    .filter((command) => command.source === "skill")
    .map((command) => ({
      name: command.name.replace(/^skill:/, ""),
      description: command.description,
      source: "skill",
    }))
    .filter((item) => {
      if (seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getSkillArgumentCompletions(pi: ExtensionAPI, prefix: string): AutocompleteItem[] | null {
  const normalizedPrefix = prefix.trim().toLowerCase();
  const items = getSkillPaletteItems(pi);
  const filtered = normalizedPrefix
    ? items.filter((item) => `${item.name} ${item.description ?? ""}`.toLowerCase().includes(normalizedPrefix))
    : items;

  if (filtered.length === 0) return null;
  return filtered.map((item) => ({
    value: item.name,
    label: item.name,
    description: item.description,
  }));
}

async function openSkillsPalette(pi: ExtensionAPI, initialQuery: string, ctx: ExtensionCommandContext): Promise<void> {
  const mode = (ctx as ExtensionCommandContext & { mode?: string }).mode;
  if (!ctx.hasUI || (mode !== undefined && mode !== "tui")) {
    ctx.ui.notify("The skills palette is available in interactive mode.", "warning");
    return;
  }

  const items = getSkillPaletteItems(pi);
  if (items.length === 0) {
    ctx.ui.notify("No skills available.", "info");
    return;
  }

  const result = await ctx.ui.custom<CommandPaletteResult | null>(
    (tui, theme, keybindings, done) => new CommandPaletteOverlay(
      items,
      initialQuery,
      tui,
      theme,
      keybindings,
      done,
      undefined,
      {
        title: " Skills ",
        helpHint: " type filter · ↑↓ navigate · tab/enter insert · esc close ",
        itemLayout: "details",
        maxItems: 5,
        noMatchesMessage: "No skills match",
        selectedDescriptionLines: 4,
        descriptionLines: 1,
        hideArgumentSource: true,
      },
    ),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "90%",
        minWidth: 42,
        maxHeight: "80%",
        margin: 1,
      },
    },
  );

  if (!result) return;
  const skillName = result.command.replace(/^skill:/, "");
  ctx.ui.setEditorText(`/skill:${skillName} `);
}

function isTuiContext(ctx: unknown): boolean {
  return typeof ctx === "object" && ctx !== null && (ctx as { mode?: unknown }).mode === "tui";
}

export default function (pi: ExtensionAPI) {
  const activeToolExecutions = new Set<string>();
  const activeAskUserQuestionToolCalls = new Set<string>();
  let activeThinkingLevel = "off";
  let activeCtx: ExtensionContext | undefined;
  let activeTui: TuiWithInputListener | undefined;
  let askUserQuestionInputListenerCleanup: (() => void) | undefined;
  let askUserQuestionInputListenerTui: TuiWithInputListener | undefined;
  let activeFooterData: ReadonlyFooterDataProvider | undefined;
  let activeAutocompleteProvider: AutocompleteProvider | undefined;
  let commandPaletteOpen = false;
  let isWorking = false;
  let workingMessage = WORKING_WAITING;
  let forcedWorkingAnimation: WorkingAnimation | undefined;
  let workingAnimation: WorkingAnimation | undefined;
  let workingFrameIndex = 0;
  let promptStartedAt: number | undefined;
  let finishedPromptElapsedMs: number | undefined;
  let finishedPromptStatus: FinishedStatus = "finished";
  let waitingNotificationActive = false;
  let waitingNotificationStartedAt: number | undefined;
  let waitingNotificationFrameIndex = 0;
  let copyPromptStatus: CopyPromptStatus | undefined;
  let workingTimer: ReturnType<typeof setInterval> | undefined;
  let waitingNotificationTimer: ReturnType<typeof setInterval> | undefined;
  let finishedStatusTimer: ReturnType<typeof setTimeout> | undefined;
  let copyPromptStatusTimer: ReturnType<typeof setTimeout> | undefined;
  let terminalFocusReportingEnabled = false;
  let terminalFocusActive = true;

  const requestRender = () => activeTui?.requestRender();
  const emitWaitingNotificationEvent = () => {
    const payload: AmpWaitingNotificationEvent = waitingNotificationActive && waitingNotificationStartedAt !== undefined
      ? { active: true, startedAt: waitingNotificationStartedAt, terminalFocusActive }
      : { active: false, terminalFocusActive };
    (pi as OptionalEventBusAPI).events?.emit?.(AMP_WAITING_NOTIFICATION_EVENT, payload);
  };
  const isAskUserQuestionActive = () => activeAskUserQuestionToolCalls.size > 0;
  const isAskUserQuestionCollapseAlias = (data: string): boolean => {
    if (isKeyRelease(data)) return false;
    if (ASK_USER_QUESTION_COLLAPSE_RAW_KEYS.has(data)) return true;
    return ASK_USER_QUESTION_COLLAPSE_ALIASES.some((alias) => matchesKey(data, alias));
  };
  const installAskUserQuestionInputAliases = (tui: TuiWithInputListener) => {
    if (askUserQuestionInputListenerTui === tui && askUserQuestionInputListenerCleanup) return;

    askUserQuestionInputListenerCleanup?.();
    askUserQuestionInputListenerCleanup = undefined;
    askUserQuestionInputListenerTui = undefined;

    if (!tui.addInputListener) return;

    askUserQuestionInputListenerTui = tui;
    askUserQuestionInputListenerCleanup = tui.addInputListener((data) => {
      if (!isAskUserQuestionActive()) return;
      if (!isAskUserQuestionCollapseAlias(data)) return;

      const focused = (tui as FocusedComponentAccessor).focusedComponent;
      if (focused?.handleInput) {
        focused.handleInput(ASK_USER_QUESTION_COLLAPSE_KEY);
        tui.requestRender();
        return { consume: true };
      }

      return { data: ASK_USER_QUESTION_COLLAPSE_KEY };
    });
  };
  const getActiveWorkingAnimation = () => workingAnimation ?? DEFAULT_WORKING_ANIMATION;
  const getWaitingNotificationFrame = () => (
    WAITING_NOTIFICATION_FRAMES[Math.abs(waitingNotificationFrameIndex) % WAITING_NOTIFICATION_FRAMES.length]
    ?? WAITING_NOTIFICATION_FRAMES[0]
  );
  const getWaitingNotificationChromeColor = (): ThemeColor => (
    waitingNotificationFrameIndex % 2 === 0 ? "warning" : "thinkingLow"
  );

  const enableTerminalFocusReporting = () => {
    if (terminalFocusReportingEnabled || !process.stdout.isTTY) return;
    process.stdout.write(TERMINAL_FOCUS_REPORTING_ENABLE);
    terminalFocusReportingEnabled = true;
  };

  const disableTerminalFocusReporting = () => {
    if (!terminalFocusReportingEnabled || !process.stdout.isTTY) return;
    process.stdout.write(TERMINAL_FOCUS_REPORTING_DISABLE);
    terminalFocusReportingEnabled = false;
  };

  const ringTerminalBell = (ctx: ExtensionContext) => {
    if (!process.stdout.isTTY || !isTuiContext(ctx)) return;
    process.stdout.write(TERMINAL_BELL);
  };

  const stopWaitingNotificationTimer = () => {
    if (!waitingNotificationTimer) return;
    clearInterval(waitingNotificationTimer);
    waitingNotificationTimer = undefined;
  };

  const startWaitingNotificationTimer = () => {
    stopWaitingNotificationTimer();
    waitingNotificationTimer = setInterval(() => {
      if (!waitingNotificationActive) {
        stopWaitingNotificationTimer();
        return;
      }

      if (
        waitingNotificationStartedAt !== undefined
        && Date.now() - waitingNotificationStartedAt >= WAITING_NOTIFICATION_PULSE_MS
      ) {
        waitingNotificationFrameIndex = 0;
        stopWaitingNotificationTimer();
        requestRender();
        return;
      }

      waitingNotificationFrameIndex = (waitingNotificationFrameIndex + 1) % WAITING_NOTIFICATION_FRAMES.length;
      requestRender();
    }, WAITING_NOTIFICATION_INTERVAL_MS);
    waitingNotificationTimer.unref?.();
  };

  const clearWaitingNotification = () => {
    stopWaitingNotificationTimer();
    if (!waitingNotificationActive) return;
    waitingNotificationActive = false;
    waitingNotificationStartedAt = undefined;
    waitingNotificationFrameIndex = 0;
    emitWaitingNotificationEvent();
    requestRender();
  };

  const showWaitingNotification = () => {
    waitingNotificationActive = true;
    waitingNotificationStartedAt = Date.now();
    waitingNotificationFrameIndex = 0;
    startWaitingNotificationTimer();
    emitWaitingNotificationEvent();
    requestRender();
  };

  const notifyAgentReadyIfInactive = (ctx: ExtensionContext) => {
    if (terminalFocusActive) {
      clearWaitingNotification();
      return;
    }

    ringTerminalBell(ctx);
    showWaitingNotification();
  };

  const stopWorkingTimer = () => {
    if (!workingTimer) return;
    clearInterval(workingTimer);
    workingTimer = undefined;
  };

  const startWorkingTimer = () => {
    stopWorkingTimer();
    const animation = getActiveWorkingAnimation();
    const frameCount = Math.max(1, animation.frames.length);
    workingTimer = setInterval(() => {
      workingFrameIndex = (workingFrameIndex + 1) % frameCount;
      requestRender();
    }, animation.intervalMs);
    workingTimer.unref?.();
  };

  const stopFinishedStatusTimer = () => {
    if (!finishedStatusTimer) return;
    clearTimeout(finishedStatusTimer);
    finishedStatusTimer = undefined;
  };

  const clearFinishedStatus = () => {
    stopFinishedStatusTimer();
    if (finishedPromptElapsedMs === undefined) return;
    finishedPromptElapsedMs = undefined;
    finishedPromptStatus = "finished";
    requestRender();
  };

  const startFinishedStatusTimer = () => {
    stopFinishedStatusTimer();
    finishedStatusTimer = setTimeout(() => {
      finishedStatusTimer = undefined;
      finishedPromptElapsedMs = undefined;
      finishedPromptStatus = "finished";
      requestRender();
    }, FINISHED_STATUS_MS);
    finishedStatusTimer.unref?.();
  };

  const stopCopyPromptStatusTimer = () => {
    if (!copyPromptStatusTimer) return;
    clearTimeout(copyPromptStatusTimer);
    copyPromptStatusTimer = undefined;
  };

  const clearCopyPromptStatus = () => {
    stopCopyPromptStatusTimer();
    if (!copyPromptStatus) return;
    copyPromptStatus = undefined;
    requestRender();
  };

  const showCopyPromptStatus = (status: CopyPromptStatus) => {
    stopCopyPromptStatusTimer();
    copyPromptStatus = status;
    requestRender();
    copyPromptStatusTimer = setTimeout(() => {
      copyPromptStatusTimer = undefined;
      copyPromptStatus = undefined;
      requestRender();
    }, COPY_PROMPT_STATUS_MS);
    copyPromptStatusTimer.unref?.();
  };

  const setWorkingMessage = (message: string, ctx?: ExtensionContext) => {
    workingMessage = message;
    ctx?.ui.setWorkingMessage(message);
    requestRender();
  };

  const setAnimation = (animation: WorkingAnimation | undefined) => {
    workingAnimation = animation;
    workingFrameIndex = 0;
    if (isWorking) startWorkingTimer();
    requestRender();
  };

  const getCommandArgumentItems = async (command: string, prefix: string): Promise<CommandPaletteArgumentItem[] | null> => {
    const provider = activeAutocompleteProvider;
    if (!provider) return null;

    const line = `/${command} ${prefix}`;
    const suggestions = await provider.getSuggestions([line], 0, line.length, { signal: new AbortController().signal });
    if (!suggestions?.items.length) return null;
    return suggestions.items.map((item) => ({
      value: item.value,
      label: item.label,
      description: item.description,
    }));
  };

  const openCommandPalette = (
    initialQuery = "",
    onSelect: (result: CommandPaletteResult) => void,
    options: { forceInsert?: boolean } = {},
  ) => {
    const ctx = activeCtx;
    if (!ctx?.hasUI || commandPaletteOpen) return;

    commandPaletteOpen = true;
    void ctx.ui.custom<CommandPaletteResult | null>(
      (tui, theme, keybindings, done) => new CommandPaletteOverlay(
        getCommandPaletteItems(pi),
        initialQuery,
        tui,
        theme,
        keybindings,
        done,
        getCommandArgumentItems,
        {
          hideArgumentSource: true,
          literalSlashEscape: true,
          submitOnEnter: !options.forceInsert,
          helpHint: options.forceInsert
            ? " type filter · ↑↓ navigate · // insert / · tab/enter insert · esc close "
            : " type filter · ↑↓ navigate · // insert / · tab insert · enter run · esc close ",
        },
      ),
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "90%",
          minWidth: 42,
          maxHeight: "80%",
          margin: 1,
        },
      },
    ).then((result) => {
      commandPaletteOpen = false;
      if (!result) return;
      onSelect(result);
    }).catch(() => {
      commandPaletteOpen = false;
    });
  };

  (pi as typeof pi & ShortcutRegistrar).registerShortcut?.(COPY_PROMPT_SHORTCUT, {
    description: "Copy current prompt to clipboard",
    handler: async (ctx) => {
      const status = copyPromptToClipboard(ctx);
      if (status) showCopyPromptStatus(status);
    },
  });

  pi.registerCommand("working-animation", {
    description: "Set Amp editor working animation: random or a named animation.",
    getArgumentCompletions: getWorkingAnimationCompletions,
    handler: async (args, ctx) => {
      const value = args.trim().toLowerCase();
      if (!value || value === "list") {
        const current = forcedWorkingAnimation
          ? `fixed ${workingAnimationSummary(forcedWorkingAnimation)}`
          : "random";
        ctx.ui.notify(`Working animation: ${current}. ${workingAnimationCommandHelp()}`, "info");
        return;
      }

      if (value === "random" || value === "reset") {
        forcedWorkingAnimation = undefined;
        setAnimation(pickWorkingAnimation(workingAnimation));
        ctx.ui.notify("Working animation will be randomly selected for each prompt.", "info");
        return;
      }

      const animation = getWorkingAnimation(value);
      if (!animation) {
        ctx.ui.notify(workingAnimationCommandHelp(), "error");
        return;
      }

      forcedWorkingAnimation = animation;
      setAnimation(animation);
      ctx.ui.notify(`Working animation set to ${workingAnimationSummary(animation)}.`, "info");
    },
  });

  pi.registerCommand("skills", {
    description: "Browse skills in a focused palette.",
    getArgumentCompletions: (prefix) => getSkillArgumentCompletions(pi, prefix),
    handler: async (args, ctx) => {
      await openSkillsPalette(pi, args.trim(), ctx);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    if (isTuiContext(ctx)) enableTerminalFocusReporting();

    activeCtx = ctx;
    activeThinkingLevel = pi.getThinkingLevel();
    terminalFocusActive = true;

    (ctx.ui as typeof ctx.ui & { addAutocompleteProvider?: (factory: (current: AutocompleteProvider) => AutocompleteProvider) => void }).addAutocompleteProvider?.((current) => {
      activeAutocompleteProvider = current;
      return current;
    });

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      activeTui = tui;
      installAskUserQuestionInputAliases(tui);
      return new AmpEditor(
        tui,
        theme,
        keybindings,
        () => activeCtx ?? ctx,
        () => activeThinkingLevel,
        () => ({
          active: isWorking,
          message: workingMessage,
          frame: getWorkingAnimationFrame(getActiveWorkingAnimation(), workingFrameIndex),
          elapsedMs: promptStartedAt === undefined ? undefined : Date.now() - promptStartedAt,
          finishedElapsedMs: finishedPromptElapsedMs,
          finishedStatus: finishedPromptStatus,
        }),
        () => ({
          active: waitingNotificationActive,
          frame: getWaitingNotificationFrame(),
          chromeColor: getWaitingNotificationChromeColor(),
        }),
        () => activeFooterData ? formatExtensionStatuses(activeFooterData.getExtensionStatuses()) : "",
        () => copyPromptStatus,
        clearWaitingNotification,
        (active) => {
          terminalFocusActive = active;
        },
        openCommandPalette,
      );
    });

    hideBuiltInWorking(ctx);

    ctx.ui.setFooter((_tui, _theme, footerData) => {
      activeFooterData = footerData;
      return new EmptyFooter();
    });
  });

  pi.on("thinking_level_select", (event, ctx) => {
    activeThinkingLevel = event.level;
    if (ctx.hasUI) requestRender();
  });

  pi.on("before_agent_start", (_event, ctx) => {
    activeThinkingLevel = pi.getThinkingLevel();
    activeToolExecutions.clear();
    activeAskUserQuestionToolCalls.clear();
    clearWaitingNotification();
    isWorking = true;
    workingAnimation = forcedWorkingAnimation ?? pickWorkingAnimation(workingAnimation);
    clearFinishedStatus();
    promptStartedAt = Date.now();
    workingFrameIndex = 0;
    startWorkingTimer();
    if (!ctx.hasUI) return;
    hideBuiltInWorking(ctx);
    setWorkingMessage(WORKING_WAITING, ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    hideBuiltInWorking(ctx);
  });

  pi.on("message_update", (event, ctx) => {
    if (!ctx.hasUI || event.message.role !== "assistant") return;
    if (activeToolExecutions.size > 0) return;

    // Pi's assistant stream events distinguish reasoning from visible output.
    const phase = event.assistantMessageEvent?.type ?? "";
    if (phase.startsWith("thinking")) {
      setWorkingMessage(WORKING_THINKING, ctx);
    } else if (phase.startsWith("text") || phase.startsWith("toolcall")) {
      setWorkingMessage(WORKING_STREAMING, ctx);
    }
  });

  pi.on("tool_execution_start", (event, ctx) => {
    activeToolExecutions.add(event.toolCallId);
    if (event.toolName === ASK_USER_QUESTION_TOOL) activeAskUserQuestionToolCalls.add(event.toolCallId);
    if (!ctx.hasUI) return;
    setWorkingMessage(WORKING_TOOLS, ctx);
  });

  pi.on("tool_execution_update", (_event, ctx) => {
    if (!ctx.hasUI) return;
    setWorkingMessage(WORKING_TOOLS, ctx);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    activeToolExecutions.delete(event.toolCallId);
    if (event.toolName === ASK_USER_QUESTION_TOOL) activeAskUserQuestionToolCalls.delete(event.toolCallId);
    if (!ctx.hasUI) return;
    if (activeToolExecutions.size === 0) {
      setWorkingMessage(WORKING_WAITING, ctx);
    }
  });

  pi.on("agent_end", (event, ctx) => {
    const cancelled = isCancelledAgentEnd(event);
    isWorking = false;
    finishedPromptElapsedMs = promptStartedAt === undefined ? undefined : Date.now() - promptStartedAt;
    finishedPromptStatus = cancelled ? "cancelled" : "finished";
    promptStartedAt = undefined;
    activeToolExecutions.clear();
    activeAskUserQuestionToolCalls.clear();
    stopWorkingTimer();
    if (finishedPromptElapsedMs !== undefined) startFinishedStatusTimer();
    if (!cancelled && ctx.hasUI) {
      notifyAgentReadyIfInactive(ctx);
    } else {
      clearWaitingNotification();
    }
    requestRender();
  });

  pi.on("session_shutdown", () => {
    disableTerminalFocusReporting();
    stopWorkingTimer();
    clearWaitingNotification();
    stopFinishedStatusTimer();
    clearCopyPromptStatus();
    promptStartedAt = undefined;
    finishedPromptElapsedMs = undefined;
    finishedPromptStatus = "finished";
    waitingNotificationActive = false;
    waitingNotificationStartedAt = undefined;
    waitingNotificationFrameIndex = 0;
    copyPromptStatus = undefined;
    workingAnimation = undefined;
    terminalFocusActive = true;
    activeAskUserQuestionToolCalls.clear();
    askUserQuestionInputListenerCleanup?.();
    askUserQuestionInputListenerCleanup = undefined;
    askUserQuestionInputListenerTui = undefined;
    activeTui = undefined;
    activeFooterData = undefined;
  });
}
