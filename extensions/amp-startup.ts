import { VERSION, type ExtensionAPI, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";

const MAX_HEADER_WIDTH = 88;
const MIN_FRAMED_WIDTH = 64;
const BRAND = "JORDI9 INDUSTRIES";
const MAX_CONTEXT_SEARCH_DEPTH = 8;

const BRAND_WORDMARK = [
  "     ██╗ ██████╗ ██████╗ ██████╗ ██╗ █████╗ ",
  "     ██║██╔═══██╗██╔══██╗██╔══██╗██║██╔══██╗",
  "     ██║██║   ██║██████╔╝██║  ██║██║╚██████║",
  "██   ██║██║   ██║██╔══██╗██║  ██║██║ ╚═══██║",
  "╚█████╔╝╚██████╔╝██║  ██║██████╔╝██║ █████╔╝",
  " ╚════╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚═╝ ╚════╝ ",
  "",
  "██╗███╗   ██╗██████╗ ██╗   ██╗███████╗████████╗██████╗ ██╗███████╗███████╗",
  "██║████╗  ██║██╔══██╗██║   ██║██╔════╝╚══██╔══╝██╔══██╗██║██╔════╝██╔════╝",
  "██║██╔██╗ ██║██║  ██║██║   ██║███████╗   ██║   ██████╔╝██║█████╗  ███████╗",
  "██║██║╚██╗██║██║  ██║██║   ██║╚════██║   ██║   ██╔══██╗██║██╔══╝  ╚════██║",
  "██║██║ ╚████║██████╔╝╚██████╔╝███████║   ██║   ██║  ██║██║███████╗███████║",
  "╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝ ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚══════╝╚══════╝",
];

export type StartupSection = {
  title: string;
  lines: string[];
};

export type StartupSnapshot = {
  cwd: string;
  project: string;
  sessionName: string | undefined;
  modelId: string;
  thinkingLevel: string;
  themeName: string | undefined;
  commandCount: number;
  tools: string[];
  activeTools: string[];
  contextFiles: string[];
  skills: string[];
  prompts: string[];
  extensionCommands: string[];
  themes: string[];
  sections: StartupSection[];
};

type StartupResources = Pick<StartupSnapshot,
  "tools" | "activeTools" | "contextFiles" | "skills" | "prompts" | "extensionCommands" | "themes" | "sections"
>;

type TuiLike = {
  requestRender(): void;
};

type ThemeLike = Pick<Theme, "fg" | "bold"> & { name?: string };

type SourceInfoLike = {
  path?: unknown;
  source?: unknown;
  scope?: unknown;
  baseDir?: unknown;
};

type ToolLike = { name?: unknown; description?: unknown; sourceInfo?: SourceInfoLike };
type CommandLike = { name?: unknown; source?: unknown; sourceInfo?: SourceInfoLike };
type ThemeInfoLike = { name?: string; path?: string | undefined };
type ResourceItem = { path: string; label?: string; sourceInfo?: SourceInfoLike };
type ToolAwareAPI = ExtensionAPI & {
  getAllTools?: () => ToolLike[];
  getActiveTools?: () => string[];
};

type PatchableSettingsManagerPrototype = {
  getQuietStartup?: () => boolean;
  __ampStartupOriginalGetQuietStartup?: () => boolean;
  __ampStartupQuietStartupPatched?: boolean;
};

let quietStartupPatchPromise: Promise<void> | undefined;

function forceQuietStartup(): Promise<void> {
  quietStartupPatchPromise ??= (async () => {
    try {
      const piPackageUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
      const settingsManagerUrl = new URL("./core/settings-manager.js", piPackageUrl).href;
      const module = await import(settingsManagerUrl) as {
        SettingsManager?: { prototype?: PatchableSettingsManagerPrototype };
      };
      const prototype = module.SettingsManager?.prototype;
      if (!prototype || typeof prototype.getQuietStartup !== "function" || prototype.__ampStartupQuietStartupPatched) return;

      prototype.__ampStartupOriginalGetQuietStartup = prototype.getQuietStartup;
      prototype.getQuietStartup = () => true;
      prototype.__ampStartupQuietStartupPatched = true;
    } catch {
      // Best-effort: older Pi builds may not expose the internal settings module path.
    }
  })();

  return quietStartupPatchPromise;
}

function uniqueSorted(items: string[], options?: { sort?: boolean }): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  if (options?.sort !== false) result.sort((a, b) => a.localeCompare(b));
  return result;
}

function safeList<T>(read: () => T[]): T[] {
  try {
    return read();
  } catch {
    return [];
  }
}

function discoverContextFiles(cwd: string): string[] {
  const files: string[] = [];
  let dir = cwd;

  for (let depth = 0; depth < MAX_CONTEXT_SEARCH_DEPTH; depth += 1) {
    const candidate = join(dir, "AGENTS.md");
    if (existsSync(candidate)) files.push(compactPath(candidate));

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return uniqueSorted(files, { sort: false });
}

function commandName(command: CommandLike): string | undefined {
  return typeof command.name === "string" ? command.name : undefined;
}

function commandSource(command: CommandLike): string | undefined {
  return typeof command.source === "string" ? command.source : undefined;
}

function sourceInfoPath(sourceInfo: SourceInfoLike | undefined): string | undefined {
  return typeof sourceInfo?.path === "string" ? sourceInfo.path : undefined;
}

function sourceInfoSource(sourceInfo: SourceInfoLike | undefined): string {
  return typeof sourceInfo?.source === "string" ? sourceInfo.source : "local";
}

function sourceInfoScope(sourceInfo: SourceInfoLike | undefined): "project" | "user" | "path" {
  const source = sourceInfoSource(sourceInfo);
  const scope = typeof sourceInfo?.scope === "string" ? sourceInfo.scope : "project";
  if (source === "cli" || scope === "temporary") return "path";
  if (scope === "user") return "user";
  if (scope === "project") return "project";
  return "path";
}

function isPackageSource(sourceInfo: SourceInfoLike | undefined): boolean {
  const source = sourceInfoSource(sourceInfo);
  return source.startsWith("npm:") || source.startsWith("git:");
}

function formatDisplayPath(path: string): string {
  return compactPath(path);
}

function getShortPath(fullPath: string, sourceInfo: SourceInfoLike | undefined): string {
  const baseDir = typeof sourceInfo?.baseDir === "string" ? sourceInfo.baseDir : undefined;
  if (baseDir && isPackageSource(sourceInfo)) {
    const rel = relative(baseDir, fullPath);
    if (rel && rel !== "." && !rel.startsWith("..") && !rel.startsWith("/")) return rel.replace(/\\/g, "/");
  }

  const source = sourceInfoSource(sourceInfo);
  const npmMatch = fullPath.match(/node_modules\/(?:\.store\/)?(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
  if (npmMatch && source.startsWith("npm:")) return npmMatch[2] ?? formatDisplayPath(fullPath);

  return formatDisplayPath(fullPath);
}

function buildScopeGroupLines(items: ResourceItem[], packageLabelFallback?: (item: ResourceItem) => string): string[] {
  const groups = {
    project: { paths: [] as ResourceItem[], packages: new Map<string, ResourceItem[]>() },
    user: { paths: [] as ResourceItem[], packages: new Map<string, ResourceItem[]>() },
    path: { paths: [] as ResourceItem[], packages: new Map<string, ResourceItem[]>() },
  };

  for (const item of items) {
    const scope = sourceInfoScope(item.sourceInfo);
    const group = groups[scope];
    if (isPackageSource(item.sourceInfo)) {
      const source = sourceInfoSource(item.sourceInfo);
      const list = group.packages.get(source) ?? [];
      list.push(item);
      group.packages.set(source, list);
    } else {
      group.paths.push(item);
    }
  }

  const lines: string[] = [];
  for (const [scope, group] of Object.entries(groups) as Array<["project" | "user" | "path", typeof groups.project]>) {
    if (group.paths.length === 0 && group.packages.size === 0) continue;

    lines.push(`  ${scope}`);
    for (const item of [...group.paths].sort((a, b) => a.path.localeCompare(b.path))) {
      lines.push(`    ${item.label ?? formatDisplayPath(item.path)}`);
    }

    for (const [source, sourceItems] of [...group.packages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`    ${source}`);
      for (const item of [...sourceItems].sort((a, b) => a.path.localeCompare(b.path))) {
        lines.push(`      ${item.label ?? packageLabelFallback?.(item) ?? getShortPath(item.path, item.sourceInfo)}`);
      }
    }
  }

  return lines;
}

function toolLine(tool: ToolLike): string {
  const name = typeof tool.name === "string" ? tool.name : "tool";
  const description = typeof tool.description === "string" ? tool.description.replace(/\s+/g, " ").trim() : "";
  return description ? `${name} — ${description}` : name;
}

function buildToolSection(tools: ToolLike[], activeToolNames: string[]): StartupSection | undefined {
  const active = new Set(activeToolNames);
  const activeTools = tools.filter((tool) => typeof tool.name === "string" && active.has(tool.name));
  const inactiveTools = tools.filter((tool) => typeof tool.name !== "string" || !active.has(tool.name));
  const lines: string[] = [];

  if (activeTools.length > 0) {
    lines.push("  active");
    for (const tool of activeTools) lines.push(`    ${toolLine(tool)}`);
  }

  if (inactiveTools.length > 0) {
    lines.push("  available");
    for (const tool of inactiveTools) lines.push(`    ${toolLine(tool)}`);
  }

  return lines.length > 0 ? { title: "Tools", lines } : undefined;
}

function commandResourcePath(command: CommandLike, fallback: string): string {
  return sourceInfoPath(command.sourceInfo) ?? fallback;
}

function isBuiltInPiThemePath(themePath: string): boolean {
  const normalizedPath = themePath.replace(/\\/g, "/");
  return /\/@earendil-works\/pi-coding-agent\/dist\/(?:modes\/interactive\/theme|theme)\//.test(normalizedPath);
}

function themeSourceInfo(themePath: string | undefined, cwd: string): SourceInfoLike | undefined {
  if (!themePath) return undefined;

  const normalizedPath = themePath.replace(/\\/g, "/");
  const normalizedCwd = cwd.replace(/\\/g, "/");
  const isProjectLocal = normalizedPath.startsWith(`${normalizedCwd}/.pi/`) || normalizedPath.startsWith(`${normalizedCwd}/.agents/`);

  return {
    path: themePath,
    source: "local",
    scope: isProjectLocal ? "project" : "user",
  };
}

function buildStartupSections(options: {
  tools: ToolLike[];
  activeTools: string[];
  contextFiles: string[];
  skillItems: ResourceItem[];
  promptItems: ResourceItem[];
  extensionCommands: string[];
  themeItems: ResourceItem[];
}): StartupSection[] {
  const sections: StartupSection[] = [];
  const toolSection = buildToolSection(options.tools, options.activeTools);
  if (toolSection) sections.push(toolSection);
  if (options.contextFiles.length > 0) sections.push({ title: "Context", lines: options.contextFiles.map((file) => `  ${file}`) });
  if (options.skillItems.length > 0) sections.push({ title: "Skills", lines: buildScopeGroupLines(options.skillItems) });
  if (options.promptItems.length > 0) sections.push({
    title: "Prompts",
    lines: buildScopeGroupLines(options.promptItems, (item) => item.label ?? getShortPath(item.path, item.sourceInfo)),
  });
  if (options.extensionCommands.length > 0) {
    sections.push({ title: "Extension commands", lines: options.extensionCommands.map((command) => `  ${command}`) });
  }
  if (options.themeItems.length > 0) sections.push({ title: "Themes", lines: buildScopeGroupLines(options.themeItems) });
  return sections;
}

function getStartupResources(pi: ExtensionAPI, ctx: ExtensionContext): StartupResources {
  const toolApi = pi as ToolAwareAPI;
  const toolItems = safeList(() => toolApi.getAllTools?.() ?? []);
  const tools = uniqueSorted(toolItems.map((tool) => typeof tool.name === "string" ? tool.name : ""));
  const activeTools = uniqueSorted(safeList(() => toolApi.getActiveTools?.() ?? []));
  const commands = safeList(() => pi.getCommands() as CommandLike[]);
  const themeInfos = safeList(() => ctx.ui.getAllThemes?.() as ThemeInfoLike[] ?? []);
  const contextFiles = discoverContextFiles(ctx.cwd);

  const skillCommands = commands.filter((command) => commandSource(command) === "skill");
  const skillItems = skillCommands.map((command): ResourceItem => {
    const name = commandName(command)?.replace(/^skill:/, "") ?? "skill";
    const path = commandResourcePath(command, name);
    return { path, sourceInfo: command.sourceInfo, label: sourceInfoPath(command.sourceInfo) ? undefined : name };
  });
  const skills = uniqueSorted(skillCommands.map((command) => commandName(command)?.replace(/^skill:/, "") ?? ""));

  const promptCommands = commands.filter((command) => commandSource(command) === "prompt");
  const promptItems = promptCommands.map((command): ResourceItem => {
    const name = commandName(command) ?? "prompt";
    const label = `/${name}`;
    return { path: commandResourcePath(command, label), sourceInfo: command.sourceInfo, label };
  });
  const prompts = uniqueSorted(promptItems.map((item) => item.label ?? ""));

  const extensionCommands = uniqueSorted(commands
    .filter((command) => commandSource(command) === "extension")
    .map((command) => {
      const name = commandName(command);
      return name ? `/${name}` : "";
    }));

  const customThemeInfos = themeInfos.filter((themeInfo) => (
    typeof themeInfo.path === "string" && !isBuiltInPiThemePath(themeInfo.path)
  ));
  const themeItems = customThemeInfos.map((themeInfo): ResourceItem => {
    const path = themeInfo.path ?? themeInfo.name ?? "theme";
    return {
      path,
      label: themeInfo.path ? formatDisplayPath(themeInfo.path) : themeInfo.name,
      sourceInfo: themeSourceInfo(themeInfo.path, ctx.cwd),
    };
  });
  const themes = uniqueSorted(customThemeInfos.map((themeInfo) => themeInfo.name ?? ""));

  return {
    tools,
    activeTools,
    contextFiles,
    skills,
    prompts,
    extensionCommands,
    themes,
    sections: buildStartupSections({
      tools: toolItems,
      activeTools,
      contextFiles,
      skillItems,
      promptItems,
      extensionCommands,
      themeItems,
    }),
  };
}

function emptyStartupResources(): StartupResources {
  return {
    tools: [],
    activeTools: [],
    contextFiles: [],
    skills: [],
    prompts: [],
    extensionCommands: [],
    themes: [],
    sections: [],
  };
}

function compactPath(cwd: string): string {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~/${relative(home, cwd)}`;
  return cwd;
}

function projectName(cwd: string): string {
  return basename(cwd) || cwd || "project";
}

function compactModelId(modelId: string, maxWidth: number): string {
  if (visibleWidth(modelId) <= maxWidth) return modelId;

  const simplified = modelId
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "")
    .replace(/-20\d{6}$/, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")
    .replace(/-latest$/, "");

  if (visibleWidth(simplified) <= maxWidth) return simplified;
  return truncateToWidth(simplified, maxWidth, "…");
}

function getThinkingColor(level: string): ThemeColor {
  switch (level) {
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

function padToWidth(text: string, width: number): string {
  const clipped = truncateToWidth(text, Math.max(0, width), "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function centerToWidth(text: string, width: number): string {
  const clipped = truncateToWidth(text, Math.max(0, width), "…");
  const left = Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2));
  return " ".repeat(left) + padToWidth(clipped, width - left);
}

function joinStyled(parts: string[], separator: string, width: number): string {
  const joined = parts.filter(Boolean).join(separator);
  return truncateToWidth(joined, Math.max(0, width), "…");
}

function formatItemList(items: string[], maxItems: number): string {
  if (items.length === 0) return "none";

  const visible = items.slice(0, maxItems);
  const remaining = items.length - visible.length;
  return `${visible.join(", ")}${remaining > 0 ? ` +${remaining}` : ""}`;
}

function resourceSegment(theme: ThemeLike, label: string, items: string[], maxItems: number): string {
  return `${theme.fg("accent", label)} ${theme.fg("text", formatItemList(items, maxItems))}`;
}

function framedLine(theme: ThemeLike, content: string, innerWidth: number): string {
  return `${theme.fg("borderAccent", "│")}${padToWidth(content, innerWidth)}${theme.fg("borderAccent", "│")}`;
}

function withIndent(lines: string[], totalWidth: number, boxWidth: number): string[] {
  const indent = " ".repeat(Math.max(0, Math.floor((totalWidth - boxWidth) / 2)));
  return lines.map((line) => truncateToWidth(indent + line, totalWidth, ""));
}

function styleWordmarkLine(theme: ThemeLike, line: string, index: number): string {
  if (line === "") return line;
  if (index < 3 || (index >= 7 && index < 10)) return theme.fg("accent", theme.bold(line));
  if (index === 5 || index === BRAND_WORDMARK.length - 1) return theme.fg("borderMuted", line);
  return theme.fg("mdHeading", theme.bold(line));
}

export function createStartupSnapshot(
  ctx: ExtensionContext,
  theme: ThemeLike,
  thinkingLevel: string,
  commandCount: number,
  resources: StartupResources = emptyStartupResources(),
): StartupSnapshot {
  return {
    cwd: compactPath(ctx.cwd),
    project: projectName(ctx.cwd),
    sessionName: ctx.sessionManager.getSessionName(),
    modelId: ctx.model?.id ?? "model unknown",
    thinkingLevel,
    themeName: theme.name,
    commandCount,
    ...resources,
  };
}

export class AmpStartupHeader implements Component {
  private expanded = false;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    private readonly theme: ThemeLike,
    private readonly getSnapshot: () => StartupSnapshot,
    private readonly tui?: TuiLike,
  ) {}

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.invalidate();
    this.tui?.requestRender();
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;

    const lines = width < MIN_FRAMED_WIDTH ? this.renderCompact(width) : this.renderFramed(width);
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  private renderCompact(width: number): string[] {
    const snapshot = this.getSnapshot();
    const model = compactModelId(snapshot.modelId, Math.max(6, width - 8));
    const brand = this.theme.fg("accent", `✦ ${BRAND} ✦`);
    const detail = joinStyled([
      this.theme.fg("text", model),
      this.theme.fg(getThinkingColor(snapshot.thinkingLevel), snapshot.thinkingLevel),
      this.theme.fg("muted", snapshot.project),
    ], this.theme.fg("dim", " · "), width);

    const tools = snapshot.activeTools.length > 0 ? snapshot.activeTools : snapshot.tools;
    const tooling = joinStyled([
      resourceSegment(this.theme, "tools", tools, 4),
      this.theme.fg("muted", `${snapshot.commandCount} cmds`),
    ], this.theme.fg("dim", " · "), width);

    return [
      centerToWidth(brand, width),
      centerToWidth(detail, width),
      centerToWidth(tooling, width),
    ];
  }

  private renderFramed(width: number): string[] {
    const snapshot = this.getSnapshot();
    const boxWidth = Math.min(width, MAX_HEADER_WIDTH);
    const innerWidth = Math.max(1, boxWidth - 2);
    const top = `${this.theme.fg("borderAccent", "╭")}${this.theme.fg("borderMuted", "─".repeat(innerWidth))}${this.theme.fg("borderAccent", "╮")}`;
    const bottom = `${this.theme.fg("borderAccent", "╰")}${this.theme.fg("borderMuted", "─".repeat(innerWidth))}${this.theme.fg("borderAccent", "╯")}`;

    const body: string[] = [top];
    body.push(framedLine(this.theme, "", innerWidth));

    for (const [index, line] of BRAND_WORDMARK.entries()) {
      body.push(framedLine(this.theme, centerToWidth(styleWordmarkLine(this.theme, line, index), innerWidth), innerWidth));
    }

    body.push(framedLine(this.theme, "", innerWidth));
    body.push(framedLine(this.theme, centerToWidth(this.metaLine(snapshot, innerWidth), innerWidth), innerWidth));
    body.push(framedLine(this.theme, centerToWidth(this.toolsLine(snapshot, innerWidth), innerWidth), innerWidth));
    body.push(framedLine(this.theme, centerToWidth(this.resourcesLine(snapshot, innerWidth), innerWidth), innerWidth));
    body.push(framedLine(this.theme, centerToWidth(this.hintLine(snapshot, innerWidth), innerWidth), innerWidth));

    if (this.expanded) {
      body.push(framedLine(this.theme, "", innerWidth));
      for (const line of this.expandedLines(snapshot, innerWidth)) {
        body.push(framedLine(this.theme, padToWidth(line, innerWidth), innerWidth));
      }
    }

    body.push(framedLine(this.theme, "", innerWidth));
    body.push(bottom);

    return withIndent(body, width, boxWidth);
  }

  private metaLine(snapshot: StartupSnapshot, width: number): string {
    const maxModelWidth = Math.max(6, Math.floor(width * 0.32));
    const maxPathWidth = Math.max(6, Math.floor(width * 0.26));
    return joinStyled([
      `${this.theme.fg("muted", "model")} ${this.theme.fg("text", compactModelId(snapshot.modelId, maxModelWidth))}`,
      `${this.theme.fg("muted", "think")} ${this.theme.fg(getThinkingColor(snapshot.thinkingLevel), snapshot.thinkingLevel)}`,
      `${this.theme.fg("muted", "cwd")} ${this.theme.fg("text", truncateToWidth(snapshot.cwd, maxPathWidth, "…"))}`,
    ], this.theme.fg("dim", " · "), width);
  }

  private toolsLine(snapshot: StartupSnapshot, width: number): string {
    const active = snapshot.activeTools.length > 0 ? snapshot.activeTools : snapshot.tools;
    return joinStyled([
      resourceSegment(this.theme, "tools", active, 6),
      this.theme.fg("muted", `${snapshot.commandCount} cmds`),
    ], this.theme.fg("dim", " · "), width);
  }

  private resourcesLine(snapshot: StartupSnapshot, width: number): string {
    return joinStyled([
      resourceSegment(this.theme, "ctx", snapshot.contextFiles, 1),
      resourceSegment(this.theme, "prompts", snapshot.prompts, 2),
      resourceSegment(this.theme, "skills", snapshot.skills, 2),
      resourceSegment(this.theme, "themes", snapshot.themes, 2),
    ], this.theme.fg("dim", " · "), width);
  }

  private hintLine(snapshot: StartupSnapshot, width: number): string {
    return joinStyled([
      this.theme.fg("muted", "Ctrl+O expands"),
      this.theme.fg("dim", `Pi v${VERSION}`),
    ], this.theme.fg("dim", " · "), width);
  }

  private expandedLines(snapshot: StartupSnapshot, width: number): string[] {
    const themeName = snapshot.themeName ?? "current theme";
    const session = snapshot.sessionName ? `session ${snapshot.sessionName}` : "fresh session";
    const detailLine = (label: string, text: string) => (
      `  ${this.theme.fg("accent", label.padEnd(8))}${this.theme.fg("dim", " :: ")}${this.theme.fg("text", text)}`
    );

    const lines = [
      detailLine("ready", `${session} · ${themeName}`),
      detailLine("flow", "/ for commands · ! for bash · drop files to attach"),
      detailLine("nav", "Ctrl+P cycles models · Ctrl+L selects · Shift+Tab thinks harder"),
      "",
    ];

    for (const section of snapshot.sections) {
      lines.push(this.theme.fg("mdHeading", `[${section.title}]`));
      for (const line of section.lines) {
        lines.push(this.styleResourceDetailLine(line));
      }
      lines.push("");
    }

    if (lines.at(-1) === "") lines.pop();
    return lines.map((line) => truncateToWidth(line, width, "…"));
  }

  private styleResourceDetailLine(line: string): string {
    const indentWidth = line.length - line.trimStart().length;
    const text = line.trimStart();
    const indent = " ".repeat(indentWidth);

    if (indentWidth <= 2) return `${indent}${this.theme.fg("accent", text)}`;
    if (text.startsWith("npm:") || text.startsWith("git:")) return `${indent}${this.theme.fg("mdLink", text)}`;
    return `${indent}${this.theme.fg("dim", text)}`;
  }
}

export default async function (pi: ExtensionAPI) {
  await forceQuietStartup();

  let activeCtx: ExtensionContext | undefined;
  let activeTheme: ThemeLike | undefined;
  let activeThinkingLevel = "off";
  let activeHeader: AmpStartupHeader | undefined;
  let activeTui: TuiLike | undefined;

  const refreshHeader = () => {
    activeHeader?.invalidate();
    activeTui?.requestRender();
  };

  const getSnapshot = (): StartupSnapshot => {
    const ctx = activeCtx;
    const theme = activeTheme;
    if (!ctx || !theme) {
      return {
        cwd: ".",
        project: "project",
        sessionName: undefined,
        modelId: "model unknown",
        thinkingLevel: activeThinkingLevel,
        themeName: undefined,
        commandCount: pi.getCommands().length,
        ...emptyStartupResources(),
      };
    }

    return createStartupSnapshot(ctx, theme, activeThinkingLevel, pi.getCommands().length, getStartupResources(pi, ctx));
  };

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    activeCtx = ctx;
    activeTheme = ctx.ui.theme;
    activeThinkingLevel = pi.getThinkingLevel();

    ctx.ui.setHeader((tui, theme) => {
      activeTui = tui;
      activeTheme = theme;
      activeHeader = new AmpStartupHeader(theme, getSnapshot, tui);
      return activeHeader;
    });
  });

  pi.on("thinking_level_select", (event) => {
    activeThinkingLevel = event.level;
    refreshHeader();
  });

  pi.on("model_select", (_event, ctx) => {
    if (ctx.hasUI) {
      activeCtx = ctx;
      refreshHeader();
    }
  });

  pi.on("session_shutdown", () => {
    activeCtx = undefined;
    activeTheme = undefined;
    activeHeader = undefined;
    activeTui = undefined;
  });
}