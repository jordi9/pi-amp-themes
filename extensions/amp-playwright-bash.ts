import { basename } from "node:path";
import {
  createBashToolDefinition,
  type BashToolDetails,
  type ExtensionAPI,
  type ToolDefinition,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { renderBashCall } from "../node_modules/pi-tool-display/src/bash-display.js";
import { loadToolDisplayConfig } from "../node_modules/pi-tool-display/src/config-store.js";
import type { ToolDisplayConfig } from "../node_modules/pi-tool-display/src/types.js";
import {
  compactOutputLines,
  extractTextOutput,
  isLikelyQuietCommand,
  pluralize,
  previewLines,
  sanitizeAnsiForThemedOutput,
  splitLines,
} from "../node_modules/pi-tool-display/src/render-utils.js";

type ThemeLike = {
  fg(color: string, text: string): string;
  bold(text: string): string;
};

type BashArgs = {
  command?: string;
  commandPrefix?: string;
  shellPath?: string;
  timeout?: number;
};

type ToolRenderContextLike = {
  args?: unknown;
  cwd?: string;
  executionStarted?: boolean;
  expanded?: boolean;
  invalidate?: () => void;
  isError?: boolean;
  isPartial?: boolean;
  lastComponent?: unknown;
  state?: unknown;
  toolCallId?: string;
};

type RuntimeToolLike = ToolDefinition<any, BashToolDetails | undefined, any> & {
  promptSnippet?: string;
  promptGuidelines?: string[];
};

type ToolInfoLike = {
  name?: string;
  sourceInfo?: {
    path?: string;
    source?: string;
  };
};

const PLAYWRIGHT_OWNER_PATH_RE = /(?:pi-tool-display\/|amp-playwright-bash\.(?:t|j)s$)/;
const PLAYWRIGHT_OWNER_SOURCE_RE = /(?:pi-tool-display|amp-themes)/;
const bashDefinitions = new Map<string, ReturnType<typeof createBashToolDefinition>>();

function debugLog(message: string, data?: unknown): void {
  if (process.env.AMP_PLAYWRIGHT_BASH_DEBUG !== "1") return;
  console.error(`[amp-playwright-bash] ${message}`, data === undefined ? "" : JSON.stringify(data));
}

function getBashDefinition(cwd: string): ReturnType<typeof createBashToolDefinition> {
  let definition = bashDefinitions.get(cwd);
  if (!definition) {
    definition = createBashToolDefinition(cwd);
    bashDefinitions.set(cwd, definition);
  }
  return definition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value[field];
  return typeof raw === "string" ? raw : undefined;
}

function getCommand(args: unknown): string | undefined {
  return getStringField(args, "command");
}

function getTimeout(args: unknown): number | undefined {
  if (!isRecord(args)) return undefined;
  const raw = args.timeout;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function pushToken(tokens: string[], token: string): string {
  if (token.length > 0) tokens.push(token);
  return "";
}

export function tokenizeShellLike(input: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        token += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      token = pushToken(tokens, token);
      continue;
    }

    if (char === ";") {
      token = pushToken(tokens, token);
      tokens.push(";");
      continue;
    }

    token += char;
  }

  if (escaped) token += "\\";
  pushToken(tokens, token);
  return tokens;
}

function isPwScriptToken(token: string): boolean {
  return (
    token === "$SKILL_DIR/scripts/pw.js" ||
    token.endsWith("/scripts/pw.js") ||
    token.includes("playwright-browser/scripts/pw.js")
  );
}

function isDetectDevServersToken(token: string): boolean {
  return (
    token === "$SKILL_DIR/scripts/detect-dev-servers.js" ||
    token.endsWith("/scripts/detect-dev-servers.js") ||
    token.includes("playwright-browser/scripts/detect-dev-servers.js")
  );
}

function takeUntilCommandSeparator(tokens: string[], start: number): string[] {
  const args: string[] = [];
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index] === ";") break;
    args.push(tokens[index] ?? "");
  }
  return args;
}

function getFlagValue(args: readonly string[], flag: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);

  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function formatUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;

  try {
    const url = new URL(rawUrl);
    const path = `${url.pathname}${url.search}${url.hash}`;
    const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
    if (localHosts.has(url.hostname)) return path === "/" ? url.host : path;
    return `${url.host}${path === "/" ? "" : path}`;
  } catch {
    return rawUrl;
  }
}

function fileLabel(rawPath: string | undefined): string | undefined {
  if (!rawPath) return undefined;
  const withoutQuotes = rawPath.replace(/^['"]|['"]$/g, "");
  return basename(withoutQuotes.replace(/^\$\{?ARTIFACT_DIR\}?\/?/, "")) || withoutQuotes;
}

function truncateInline(value: string, maxLength = 56): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function colorForPlaywrightAction(action: string): string {
  switch (action) {
    case "screenshot":
    case "pdf":
    case "state-save":
      return "success";
    case "snapshot":
    case "console":
    case "network":
    case "detect":
      return "warning";
    case "close":
      return "muted";
    default:
      return "accent";
  }
}

function splitSummaryHead(head: string): { action: string; rest: string } {
  const [action = "run", ...restParts] = head.split(" ");
  return { action, rest: restParts.join(" ").trim() };
}

function renderPlaywrightRest(rest: string, theme: ThemeLike): string {
  if (!rest) return "";

  for (const arrow of [" → ", " ← "] as const) {
    if (!rest.includes(arrow)) continue;
    const [target = "", artifact = ""] = rest.split(arrow, 2);
    const pieces: string[] = [];
    if (target.trim()) pieces.push(theme.fg("accent", target.trim()));
    pieces.push(theme.fg("dim", arrow.trim()));
    if (artifact.trim()) pieces.push(theme.fg("success", artifact.trim()));
    return ` ${pieces.join(" ")}`;
  }

  return ` ${theme.fg("accent", rest)}`;
}

function renderPlaywrightSummaryCall(summary: string, args: unknown, theme: ThemeLike, context?: ToolRenderContextLike): Text {
  const text = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
  const [head = "run", ...meta] = summary.replace(/^playwright\s+/, "").split(" · ");
  const { action, rest } = splitSummaryHead(head);
  const timeout = getTimeout(args);
  const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
  const metaSuffix = meta.length > 0
    ? ` ${theme.fg("dim", "·")} ${meta.map((item) => theme.fg("muted", item)).join(` ${theme.fg("dim", "·")} `)}`
    : "";

  text.setText(
    `${theme.fg("toolTitle", theme.bold("$"))} ${theme.fg("warning", "◆")} ${theme.fg("customMessageLabel", theme.bold("playwright"))} ${theme.fg(colorForPlaywrightAction(action), theme.bold(action))}${renderPlaywrightRest(rest, theme)}${metaSuffix}${timeoutSuffix}`,
  );
  return text;
}

function matchQuotedArg(source: string, pattern: string): string | undefined {
  const regex = new RegExp(`${pattern}\\s*\\(\\s*(['\"\`])([^'\"\`]+)\\1`);
  return source.match(regex)?.[2];
}

function matchObjectStringField(source: string, objectCallPattern: string, field: string): string | undefined {
  const regex = new RegExp(`${objectCallPattern}\\s*\\(\\s*\\{[\\s\\S]*?${field}\\s*:\\s*(['\"\`])([^'\"\`]+)\\1`);
  return source.match(regex)?.[2];
}

function compactStorageKey(key: string): string {
  return key
    .replace(/^doscomas-/, "")
    .replace(/^app-/, "")
    .replace(/^pi-/, "");
}

function formatStorageAssignment(key: string, value: string): string {
  return `${compactStorageKey(key)}=${value}`;
}

function extractLocalStorageMeta(code: string): string[] {
  return [...code.matchAll(/localStorage\.setItem\(\s*(['"`])([^'"`]+)\1\s*,\s*(['"`])([^'"`]+)\3/g)]
    .map((match) => {
      const key = match[2];
      const value = match[4];
      return key && value ? formatStorageAssignment(key, value) : undefined;
    })
    .filter((value): value is string => Boolean(value));
}

function extractRunCodeDisplay(args: readonly string[]): string {
  const code = args[0] ?? "";
  const url = formatUrl(matchQuotedArg(code, "page\\.goto"));
  const screenshot = fileLabel(matchObjectStringField(code, "page\\.screenshot", "path"));
  const viewport = code.match(/setViewportSize\(\s*\{\s*width\s*:\s*(\d+)\s*,\s*height\s*:\s*(\d+)/);
  const wait = code.match(/waitForTimeout\(\s*(\d+)\s*\)/);
  const storageMeta = extractLocalStorageMeta(code);

  const action = screenshot ? "screenshot" : "run-code";
  const pieces = ["playwright", action];
  if (url) pieces.push(url);
  if (screenshot) pieces.push("→", screenshot);

  const meta: string[] = [];
  if (viewport) meta.push(`${viewport[1]}×${viewport[2]}`);
  meta.push(...storageMeta);
  if (wait) {
    const waitMs = Number(wait[1]);
    meta.push(waitMs >= 1000 ? `+${(waitMs / 1000).toFixed(waitMs % 1000 === 0 ? 0 : 1)}s` : `+${waitMs}ms`);
  }

  if (meta.length > 0) pieces.push("·", meta.join(" · "));
  if (pieces.length > 2) return pieces.join(" ");
  return `playwright run-code ${truncateInline(code)}`;
}

function extractPwDisplay(command: string, args: readonly string[]): string {
  switch (command) {
    case "open": {
      const target = formatUrl(args[0]) ?? "page";
      const headed = args.includes("--headed") ? " · headed" : "";
      return `playwright open ${target}${headed}`;
    }
    case "snapshot": {
      const output = fileLabel(getFlagValue(args, "--filename"));
      return output ? `playwright snapshot → ${output}` : "playwright snapshot";
    }
    case "screenshot": {
      const output = fileLabel(getFlagValue(args, "--filename"));
      const fullPage = args.includes("--full-page") ? " · full page" : "";
      return output ? `playwright screenshot → ${output}${fullPage}` : `playwright screenshot${fullPage}`;
    }
    case "pdf": {
      const output = fileLabel(getFlagValue(args, "--filename"));
      return output ? `playwright pdf → ${output}` : "playwright pdf";
    }
    case "run-code":
      return extractRunCodeDisplay(args);
    case "eval":
      return `playwright eval ${truncateInline(args[0] ?? "")}`.trimEnd();
    case "fill":
    case "select":
      return `playwright ${command} ${args[0] ?? "ref"}`;
    case "click":
    case "check":
      return `playwright ${command} ${args[0] ?? "ref"}`;
    case "press":
      return `playwright press ${args[0] ?? "key"}`;
    case "state-save": {
      const output = fileLabel(args[0]);
      return output ? `playwright state-save → ${output}` : "playwright state-save";
    }
    case "state-load": {
      const input = fileLabel(args[0]);
      return input ? `playwright state-load ← ${input}` : "playwright state-load";
    }
    case "console":
    case "network":
    case "close":
      return `playwright ${command}`;
    default:
      return `playwright ${command} ${args.map((arg) => truncateInline(arg, 32)).join(" ")}`.trimEnd();
  }
}

export function summarizePlaywrightCommand(command: string): string | undefined {
  if (!command.includes("pw.js") && !command.includes("detect-dev-servers.js")) {
    return undefined;
  }

  const tokens = tokenizeShellLike(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (isDetectDevServersToken(token)) {
      const args = takeUntilCommandSeparator(tokens, index + 1);
      return args.includes("--json") ? "playwright detect dev servers · json" : "playwright detect dev servers";
    }

    if (!isPwScriptToken(token)) continue;
    const pwCommand = tokens[index + 1];
    if (!pwCommand || pwCommand === ";") return undefined;
    return extractPwDisplay(pwCommand, takeUntilCommandSeparator(tokens, index + 2));
  }

  return undefined;
}

function prepareOutputLines(rawText: string, options: ToolRenderResultOptions): string[] {
  return compactOutputLines(splitLines(rawText), {
    expanded: options.expanded,
    maxCollapsedConsecutiveEmptyLines: 1,
  });
}

function getExpandedPreviewLineLimit(lines: string[], config: ToolDisplayConfig): number {
  const limit = Math.max(0, config.expandedPreviewMaxLines);
  return limit === 0 ? lines.length : Math.min(lines.length, limit);
}

function formatExpandedPreviewCapHint(lines: string[], config: ToolDisplayConfig, theme: ThemeLike): string {
  const cap = Math.max(0, config.expandedPreviewMaxLines);
  if (cap === 0 || lines.length <= cap) return "";
  return `\n${theme.fg("warning", `(display capped at ${cap} lines by tool-display setting)`)}`;
}

function buildPreviewText(lines: string[], maxLines: number, theme: ThemeLike, expanded: boolean): string {
  if (lines.length === 0) return theme.fg("muted", "↳ (no output)");

  const { shown, remaining } = previewLines(lines, maxLines);
  let text = shown.map((line) => theme.fg("toolOutput", sanitizeAnsiForThemedOutput(line))).join("\n");
  if (remaining > 0) {
    const hint = expanded ? "" : " • Ctrl+O to expand";
    text += `\n${theme.fg("muted", `... (${remaining} more ${pluralize(remaining, "line")}${hint})`)}`;
  }
  return text;
}

function formatBashTruncationHints(details: BashToolDetails | undefined, theme: ThemeLike): string {
  if (!details) return "";

  const hints: string[] = [];
  if (details.truncation?.truncated) hints.push("output truncated");
  if (details.fullOutputPath) hints.push(`full output: ${details.fullOutputPath}`);
  return hints.length > 0 ? `\n${theme.fg("warning", `(${hints.join(" • ")})`)}` : "";
}

function formatBashNoOutputLine(command: string | undefined, theme: ThemeLike): string {
  return isLikelyQuietCommand(command)
    ? theme.fg("muted", "↳ command completed (no output)")
    : theme.fg("muted", "↳ (no output)");
}

function renderBashErrorResult(
  rawOutput: string,
  options: ToolRenderResultOptions,
  config: ToolDisplayConfig,
  theme: ThemeLike,
  details: BashToolDetails | undefined,
): Text {
  const lines = prepareOutputLines(rawOutput, options);
  let text = theme.fg("error", "↳ command failed");

  if (lines.length > 0) {
    const maxLines = options.expanded
      ? getExpandedPreviewLineLimit(lines, config)
      : config.bashOutputMode === "opencode"
        ? config.bashCollapsedLines
        : config.previewLines;
    if (options.expanded || maxLines > 0) {
      const { shown, remaining } = previewLines(lines, maxLines);
      text += `\n${shown.map((line) => theme.fg("error", sanitizeAnsiForThemedOutput(line))).join("\n")}`;
      if (remaining > 0) {
        const hint = options.expanded ? "" : " • Ctrl+O to expand";
        text += `\n${theme.fg("muted", `... (${remaining} more ${pluralize(remaining, "line")}${hint})`)}`;
      }
    }
  }

  if (config.showTruncationHints) text += formatBashTruncationHints(details, theme);
  if (options.expanded && lines.length > 0) text += formatExpandedPreviewCapHint(lines, config, theme);
  return new Text(text, 0, 0);
}

export function renderAmpBashResult(
  result: { content?: Array<{ type: string; text?: string }>; details?: BashToolDetails },
  options: ToolRenderResultOptions,
  theme: ThemeLike,
  context?: ToolRenderContextLike,
): Text {
  const config = loadToolDisplayConfig().config;
  const details = result.details;
  const rawOutput = extractTextOutput(result);

  if (options.isPartial) {
    const partialLines = prepareOutputLines(rawOutput, options);
    if (partialLines.length === 0) return new Text("", 0, 0);

    const maxLines = options.expanded
      ? getExpandedPreviewLineLimit(partialLines, config)
      : config.bashOutputMode === "opencode"
        ? config.bashCollapsedLines
        : config.previewLines;
    if (!options.expanded && maxLines === 0) return new Text("", 0, 0);

    let preview = buildPreviewText(partialLines, maxLines, theme, options.expanded);
    if (config.showTruncationHints) preview += formatBashTruncationHints(details, theme);
    if (options.expanded) preview += formatExpandedPreviewCapHint(partialLines, config, theme);
    return new Text(preview, 0, 0);
  }

  if (context?.isError) {
    return renderBashErrorResult(rawOutput, options, config, theme, details);
  }

  const lines = prepareOutputLines(rawOutput, options);
  if (lines.length === 0) {
    let text = formatBashNoOutputLine(getStringField(context?.args, "command"), theme);
    if (config.showTruncationHints) text += formatBashTruncationHints(details, theme);
    return new Text(text, 0, 0);
  }

  if (config.bashOutputMode === "summary") {
    if (!options.expanded) {
      const count = lines.length;
      let summary = theme.fg("muted", `↳ ${count} ${pluralize(count, "line")} returned`);
      summary += theme.fg("muted", " • Ctrl+O to expand");
      if (config.showTruncationHints) summary += formatBashTruncationHints(details, theme);
      return new Text(summary, 0, 0);
    }

    let preview = buildPreviewText(lines, getExpandedPreviewLineLimit(lines, config), theme, true);
    if (config.showTruncationHints) preview += formatBashTruncationHints(details, theme);
    preview += formatExpandedPreviewCapHint(lines, config, theme);
    return new Text(preview, 0, 0);
  }

  if (config.bashOutputMode === "preview") {
    const maxLines = options.expanded ? getExpandedPreviewLineLimit(lines, config) : config.previewLines;
    let preview = buildPreviewText(lines, maxLines, theme, options.expanded);
    if (config.showTruncationHints) preview += formatBashTruncationHints(details, theme);
    if (options.expanded) preview += formatExpandedPreviewCapHint(lines, config, theme);
    return new Text(preview, 0, 0);
  }

  if (!options.expanded && config.bashCollapsedLines === 0) {
    let hidden = theme.fg("muted", "↳ output hidden");
    if (config.showTruncationHints) hidden += formatBashTruncationHints(details, theme);
    return new Text(hidden, 0, 0);
  }

  const maxLines = options.expanded ? lines.length : config.bashCollapsedLines;
  let text = buildPreviewText(lines, maxLines, theme, options.expanded);
  if (config.showTruncationHints) text += formatBashTruncationHints(details, theme);
  return new Text(text, 0, 0);
}

function createAmpBashTool(): RuntimeToolLike {
  const bootstrap = getBashDefinition(process.cwd()) as RuntimeToolLike;

  return {
    ...bootstrap,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBashDefinition(ctx.cwd).execute(
        toolCallId,
        params as { command: string; timeout?: number },
        signal,
        onUpdate,
        ctx,
      );
    },
    renderCall(args, theme, context) {
      const summary = summarizePlaywrightCommand(getCommand(args) ?? "");
      if (summary) {
        return renderPlaywrightSummaryCall(summary, args, theme, context);
      }
      return renderBashCall(args as BashArgs, theme, context);
    },
    renderResult(result, options, theme, context) {
      return renderAmpBashResult(result, options, theme, context);
    },
  };
}

function isSafeBashOwner(tool: ToolInfoLike | undefined): boolean {
  if (!tool) return true;
  const sourceInfo = tool.sourceInfo;
  const source = sourceInfo?.source;
  const path = sourceInfo?.path;

  if (!source && !path) return true;
  if (source === "builtin") return true;
  if (source && PLAYWRIGHT_OWNER_SOURCE_RE.test(source)) return true;
  return path ? PLAYWRIGHT_OWNER_PATH_RE.test(path) : false;
}

function shouldRegisterBashOverride(pi: ExtensionAPI): boolean {
  const config = loadToolDisplayConfig().config;
  if (!config.registerToolOverrides.bash) {
    debugLog("skip: bash ownership disabled");
    return false;
  }

  try {
    const bashTool = (pi.getAllTools() as ToolInfoLike[]).find((tool) => tool.name === "bash");
    const safe = isSafeBashOwner(bashTool);
    debugLog(safe ? "will register" : "skip: unsafe bash owner", bashTool);
    return safe;
  } catch (error) {
    debugLog("skip: tool discovery failed", error instanceof Error ? error.message : String(error));
    return false;
  }
}

export default function ampPlaywrightBash(pi: ExtensionAPI) {
  const registerBashOverride = (): void => {
    if (shouldRegisterBashOverride(pi)) {
      pi.registerTool(createAmpBashTool());
      debugLog("registered bash override");
    }
  };

  pi.on("session_start", registerBashOverride);
  pi.on("before_agent_start", registerBashOverride);
  pi.on("session_shutdown", () => {
    bashDefinitions.clear();
  });
}
