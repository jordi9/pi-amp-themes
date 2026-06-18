import { CustomEditor, type ExtensionAPI, type ExtensionContext, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type AutocompleteItem } from "@earendil-works/pi-tui";
import { BUILTIN_COMMAND_PALETTE_ITEMS, CommandPaletteOverlay, type CommandPaletteItem, type CommandPaletteResult, stripAnsi } from "./amp-command-palette.js";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { relative } from "node:path";

const MIN_BODY_LINES = 2;
const GIT_CACHE_MS = 2000;
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

type GitInfo = {
  branch: string | null;
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

let gitCache: { cwd: string; at: number; info: GitInfo } | undefined;

function runGit(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    }).trim();
  } catch {
    return "";
  }
}

function getGitInfo(cwd: string): GitInfo {
  const now = Date.now();
  if (gitCache && gitCache.cwd === cwd && now - gitCache.at < GIT_CACHE_MS) return gitCache.info;

  const branch = runGit(cwd, ["branch", "--show-current"]) || null;
  const porcelain = runGit(cwd, ["status", "--short"]);
  const changedFiles = porcelain ? porcelain.split("\n").filter(Boolean).length : 0;
  const numstat = runGit(cwd, ["diff", "--numstat"]);
  let added = 0;
  let removed = 0;

  for (const line of numstat.split("\n")) {
    const [a, r] = line.split("\t");
    const add = Number(a);
    const rem = Number(r);
    if (Number.isFinite(add)) added += add;
    if (Number.isFinite(rem)) removed += rem;
  }

  const modified = Math.min(added, removed);
  const info = { branch, changedFiles, added: added - modified, modified, removed: removed - modified };
  gitCache = { cwd, at: now, info };
  return info;
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
  constructor(
    tui: any,
    theme: any,
    keybindings: any,
    private readonly getCtx: () => ExtensionContext,
    private readonly getThinkingLevel: () => string,
    private readonly getWorkingState: () => WorkingState,
    private readonly getCopyPromptStatus: () => CopyPromptStatus | undefined,
    private readonly openCommandPalette: (initialQuery: string | undefined, onSelect: (result: CommandPaletteResult) => void) => void,
  ) {
    super(tui, theme, keybindings, { paddingX: 1 });
  }

  private get ctx(): ExtensionContext {
    return this.getCtx();
  }

  handleInput(data: string): void {
    if (data === "/" && this.getText().trim() === "") {
      this.openCommandPalette(undefined, (result) => {
        if (result.action === "insert") {
          this.insertCommand(result.command);
        } else {
          this.submitCommand(result.command);
        }
      });
      return;
    }

    super.handleInput(data);
  }

  private insertCommand(command: string): void {
    this.setText(`/${command} `);
    this.tui.requestRender();
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
    const base = super.render(innerWidth);
    const { editorLines, popupLines } = splitEditorRender(base);
    const body = [...editorLines];

    while (body.length < MIN_BODY_LINES) {
      body.push(" ".repeat(innerWidth));
    }

    const leftTop = this.getUsageLabel();
    const rightTop = this.getModelLabel(Math.max(8, Math.floor(innerWidth * 0.48)));
    const cwdLabel = this.getCwdLabel();
    const workingLabel = this.getWorkingLabel();
    const outputExpandedLabel = this.getOutputExpandedLabel();
    const copyPromptLabel = this.getCopyPromptLabel();
    const gitChangesLabel = this.getGitChangesLabel();
    const leftStatusLabel = joinStatusLabels([
      workingLabel,
      outputExpandedLabel,
      copyPromptLabel,
    ], ` ${this.fg("muted", "·")} `);

    return [
      this.borderWithLabels(width, leftTop, rightTop),
      ...body.map((line) => this.wrapBody(line, innerWidth)),
      this.borderWithCenterThenPath(width, CENTER_TEXT, cwdLabel),
      ...this.statusRows(width, leftStatusLabel, gitChangesLabel),
      ...this.wrapPopupBlock(popupLines, width),
    ];
  }

  private getUsageLabel(): string {
    const usage = this.ctx.getContextUsage();
    const pct = usage?.percent == null ? "?" : `${Math.max(0, Math.floor(usage.percent))}%`;
    const contextWindow = usage?.contextWindow ?? this.ctx.model?.contextWindow ?? null;
    const parts = [this.fg("muted", ` ${pct} of ${formatCount(contextWindow)}`)];
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
    const thinking = this.fg(this.getThinkingColor(), thinkingLevel);
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
    const git = getGitInfo(this.ctx.cwd);
    return ` ${compactPath(this.ctx.cwd)}${git.branch ? ` (${git.branch})` : ""} `;
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

  private getGitChangesLabel(): string {
    const git = getGitInfo(this.ctx.cwd);
    if (git.changedFiles === 0) return "";

    const fileLabel = this.fg("muted", `${git.changedFiles} ${git.changedFiles === 1 ? "file" : "files"} changed`);
    const added = git.added > 0 ? ` ${this.fg("toolDiffAdded", `+${git.added}`)}` : "";
    const modified = git.modified > 0 ? ` ${this.fg("warning", `~${git.modified}`)}` : "";
    const removed = git.removed > 0 ? ` ${this.fg("toolDiffRemoved", `-${git.removed}`)}` : "";
    return `${fileLabel}${added}${modified}${removed}`;
  }

  private fg(color: ThemeColor, text: string): string {
    return this.ctx.ui.theme.fg(color, text);
  }

  private wrapBody(line: string, innerWidth: number): string {
    const clipped = truncateToWidth(line, innerWidth, "");
    const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
    const content = clipped ? this.fg("text", clipped) : clipped;
    return this.sideBorder() + content + padding + this.sideBorder();
  }

  private wrapPopupBlock(lines: string[], width: number): string[] {
    if (lines.length === 0) return [];

    return lines.map((line) => {
      const clipped = truncateToWidth(line, width, "");
      const padding = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
      return clipped + padding;
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

  private borderWithLabels(width: number, leftLabel: string, rightLabel: string): string {
    const innerWidth = Math.max(0, width - 2);
    const maxLeft = Math.max(0, Math.floor(innerWidth * 0.44));
    const maxRight = Math.max(0, innerWidth - maxLeft - 2);
    const left = truncateToWidth(leftLabel, maxLeft, "…");
    const right = truncateToWidth(rightLabel, maxRight, "…");
    const used = visibleWidth(left) + visibleWidth(right);
    const fill = Math.max(0, innerWidth - used);
    return this.borderColor("╭") + left + this.borderColor("─".repeat(fill)) + right + this.borderColor("╮");
  }

  private sideBorder(): string {
    return this.borderColor("│");
  }

  private borderWithCenterThenPath(width: number, centerLabel: string, rightLabel: string): string {
    const innerWidth = Math.max(0, width - 2);
    // Minimum width: ╰ + sp + center(min 14) + sp + ╯ + right (at least 1)
    const minWidth = 20;
    if (innerWidth < minWidth) {
      const right = this.fg("muted", truncateToWidth(rightLabel.trim(), Math.max(0, innerWidth - 2), "…"));
      const fill = Math.max(0, innerWidth - visibleWidth(right));
      return this.borderColor("╰") + this.borderColor("─".repeat(fill)) + right + this.borderColor("╯");
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

    const leftD = this.borderColor("─".repeat(leftDashes));
    const rightD = this.borderColor("─".repeat(rightDashes));

    return (
      this.borderColor("╰") +
      leftD +
      " " +
      centerText +
      " " +
      rightD +
      " " +
      right +
      " " +
      this.borderColor("╯")
    );
  }

  private borderWithRightLabel(width: number, label: string): string {
    const innerWidth = Math.max(0, width - 2);
    const right = this.fg("muted", truncateToWidth(label, Math.max(0, innerWidth - 2), "…"));
    const fill = Math.max(0, innerWidth - visibleWidth(right));
    return this.borderColor("╰") + this.borderColor("─".repeat(fill)) + right + this.borderColor("╯");
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

export default function (pi: ExtensionAPI) {
  const activeToolExecutions = new Set<string>();
  let activeThinkingLevel = "off";
  let activeCtx: ExtensionContext | undefined;
  let activeTui: { requestRender(): void } | undefined;
  let commandPaletteOpen = false;
  let isWorking = false;
  let workingMessage = WORKING_WAITING;
  let forcedWorkingAnimation: WorkingAnimation | undefined;
  let workingAnimation: WorkingAnimation | undefined;
  let workingFrameIndex = 0;
  let promptStartedAt: number | undefined;
  let finishedPromptElapsedMs: number | undefined;
  let finishedPromptStatus: FinishedStatus = "finished";
  let copyPromptStatus: CopyPromptStatus | undefined;
  let workingTimer: ReturnType<typeof setInterval> | undefined;
  let finishedStatusTimer: ReturnType<typeof setTimeout> | undefined;
  let copyPromptStatusTimer: ReturnType<typeof setTimeout> | undefined;

  const requestRender = () => activeTui?.requestRender();
  const getActiveWorkingAnimation = () => workingAnimation ?? DEFAULT_WORKING_ANIMATION;

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

  const openCommandPalette = (initialQuery = "", onSelect: (result: CommandPaletteResult) => void) => {
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

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    activeCtx = ctx;
    activeThinkingLevel = pi.getThinkingLevel();

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      activeTui = tui;
      return new AmpEditor(tui, theme, keybindings, () => activeCtx ?? ctx, () => activeThinkingLevel, () => ({
        active: isWorking,
        message: workingMessage,
        frame: getWorkingAnimationFrame(getActiveWorkingAnimation(), workingFrameIndex),
        elapsedMs: promptStartedAt === undefined ? undefined : Date.now() - promptStartedAt,
        finishedElapsedMs: finishedPromptElapsedMs,
        finishedStatus: finishedPromptStatus,
      }), () => copyPromptStatus, openCommandPalette);
    });

    hideBuiltInWorking(ctx);

    ctx.ui.setFooter(() => ({
      invalidate() {},
      render() {
        return [];
      },
    }));
  });

  pi.on("thinking_level_select", (event, ctx) => {
    activeThinkingLevel = event.level;
    if (ctx.hasUI) requestRender();
  });

  pi.on("before_agent_start", (_event, ctx) => {
    activeThinkingLevel = pi.getThinkingLevel();
    activeToolExecutions.clear();
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
    if (!ctx.hasUI) return;
    setWorkingMessage(WORKING_TOOLS, ctx);
  });

  pi.on("tool_execution_update", (_event, ctx) => {
    if (!ctx.hasUI) return;
    setWorkingMessage(WORKING_TOOLS, ctx);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    activeToolExecutions.delete(event.toolCallId);
    if (!ctx.hasUI) return;
    if (activeToolExecutions.size === 0) {
      setWorkingMessage(WORKING_WAITING, ctx);
    }
  });

  pi.on("agent_end", (event, _ctx) => {
    isWorking = false;
    finishedPromptElapsedMs = promptStartedAt === undefined ? undefined : Date.now() - promptStartedAt;
    finishedPromptStatus = isCancelledAgentEnd(event) ? "cancelled" : "finished";
    promptStartedAt = undefined;
    activeToolExecutions.clear();
    stopWorkingTimer();
    if (finishedPromptElapsedMs !== undefined) startFinishedStatusTimer();
    requestRender();
  });

  pi.on("session_shutdown", () => {
    stopWorkingTimer();
    stopFinishedStatusTimer();
    clearCopyPromptStatus();
    promptStartedAt = undefined;
    finishedPromptElapsedMs = undefined;
    finishedPromptStatus = "finished";
    copyPromptStatus = undefined;
    workingAnimation = undefined;
    activeTui = undefined;
  });
}
