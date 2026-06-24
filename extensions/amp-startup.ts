import { VERSION, type BuildSystemPromptOptions, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve } from "node:path";

const MIN_FRAMED_WIDTH = 64;
const BRAND = "JORDI9 INDUSTRIES";
const TAGLINE = "Importer/Exporter of Fine Software";

const BRAND_WORDMARK = [
  "     ██╗ ██████╗ ██████╗ ██████╗ ██╗ █████╗   ██╗███╗   ██╗██████╗ ██╗   ██╗███████╗████████╗██████╗ ██╗███████╗███████╗",
  "     ██║██╔═══██╗██╔══██╗██╔══██╗██║██╔══██╗  ██║████╗  ██║██╔══██╗██║   ██║██╔════╝╚══██╔══╝██╔══██╗██║██╔════╝██╔════╝",
  "     ██║██║   ██║██████╔╝██║  ██║██║╚██████║  ██║██╔██╗ ██║██║  ██║██║   ██║███████╗   ██║   ██████╔╝██║█████╗  ███████╗",
  "██   ██║██║   ██║██╔══██╗██║  ██║██║ ╚═══██║  ██║██║╚██╗██║██║  ██║██║   ██║╚════██║   ██║   ██╔══██╗██║██╔══╝  ╚════██║",
  "╚█████╔╝╚██████╔╝██║  ██║██████╔╝██║ █████╔╝  ██║██║ ╚████║██████╔╝╚██████╔╝███████║   ██║   ██║  ██║██║███████╗███████║",
  " ╚════╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚═╝ ╚════╝   ╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝ ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚══════╝╚══════╝",
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
  contextFilesKnown: boolean;
  skills: string[];
  prompts: string[];
  extensionCommands: string[];
  themes: string[];
  sections: StartupSection[];
};

type StartupResources = Pick<StartupSnapshot,
  "tools" | "activeTools" | "contextFiles" | "contextFilesKnown" | "skills" | "prompts" | "extensionCommands" | "themes" | "sections"
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
type ResourceScope = "project" | "user" | "path";
type ResourceItem = { path: string; label?: string; sourceInfo?: SourceInfoLike; scope?: ResourceScope };
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

function sourceInfoScope(sourceInfo: SourceInfoLike | undefined): ResourceScope {
  const source = sourceInfoSource(sourceInfo);
  const scope = typeof sourceInfo?.scope === "string" ? sourceInfo.scope : "project";
  if (source === "cli" || scope === "temporary") return "path";
  if (scope === "user") return "user";
  if (scope === "project") return "project";
  return "path";
}

function relativeInside(root: string, filePath: string): string | undefined {
  const rel = relative(resolve(root), resolve(filePath));
  if (!rel || rel === "." || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.replace(/\\/g, "/");
}

function localPathScope(filePath: string, cwd: string): ResourceScope {
  const absolutePath = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
  if (relativeInside(cwd, absolutePath)) return "project";
  if (relativeInside(homedir(), absolutePath)) return "user";
  return "path";
}

function resourceScope(sourceInfo: SourceInfoLike | undefined, filePath: string, cwd: string): ResourceScope {
  const scope = sourceInfoScope(sourceInfo);
  return scope === "path" ? localPathScope(filePath, cwd) : scope;
}

function skillDisplayPath(fullPath: string, sourceInfo: SourceInfoLike | undefined, cwd: string): string {
  const projectRelativePath = isAbsolute(fullPath) ? relativeInside(cwd, fullPath) : undefined;
  return projectRelativePath ?? getShortPath(fullPath, sourceInfo);
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
    const scope = item.scope ?? sourceInfoScope(item.sourceInfo);
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

function commandSourceLabel(sourceInfo: SourceInfoLike | undefined): string | undefined {
  const path = sourceInfoPath(sourceInfo);
  if (!path) return undefined;
  if (isPackageSource(sourceInfo)) return sourceInfoSource(sourceInfo);
  return formatDisplayPath(path);
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
  contextFilesKnown: boolean;
  skillItems: ResourceItem[];
  commandItems: ResourceItem[];
  themeItems: ResourceItem[];
}): StartupSection[] {
  const sections: StartupSection[] = [];
  if (options.contextFilesKnown) {
    sections.push({
      title: "Context",
      lines: options.contextFiles.length > 0 ? options.contextFiles.map((file) => `  ${file}`) : ["  none loaded"],
    });
  }
  if (options.skillItems.length > 0) sections.push({ title: "Skills", lines: buildScopeGroupLines(options.skillItems) });
  const toolSection = buildToolSection(options.tools, options.activeTools);
  if (toolSection) sections.push(toolSection);
  if (options.commandItems.length > 0) {
    sections.push({ title: "Commands", lines: buildCommandLines(options.commandItems) });
  }
  if (options.themeItems.length > 0) sections.push({ title: "Themes", lines: buildScopeGroupLines(options.themeItems) });
  return sections;
}

function buildCommandLines(items: ResourceItem[]): string[] {
  const lines = ["  extension commands"];
  for (const item of [...items].sort((a, b) => (a.label ?? a.path).localeCompare(b.label ?? b.path))) {
    lines.push(`    ${item.label ?? formatDisplayPath(item.path)}`);
  }
  return lines;
}

function formatContextPath(filePath: string, cwd: string): string {
  const absolutePath = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
  const relativePath = relative(resolve(cwd), absolutePath);
  const isInsideCwd = relativePath === "" || (
    relativePath !== ".."
    && !relativePath.startsWith("../")
    && !relativePath.startsWith("..\\")
    && !isAbsolute(relativePath)
  );

  if (isInsideCwd) return (relativePath || ".").replace(/\\/g, "/");
  return compactPath(absolutePath);
}

function contextFilesFromSystemPromptOptions(
  contextFiles: BuildSystemPromptOptions["contextFiles"],
  cwd: string,
): string[] {
  return uniqueSorted((contextFiles ?? []).map((file) => formatContextPath(file.path, cwd)), { sort: false });
}

function isContextHeadingPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return /(?:^|\/)(?:AGENTS|CLAUDE)\.MD$/i.test(normalized);
}

function contextFilesFromSystemPrompt(systemPrompt: string, cwd: string): string[] | undefined {
  const start = systemPrompt.indexOf("# Project Context");
  if (start === -1) return undefined;

  const sectionAndRest = systemPrompt.slice(start);
  const stopMarkers = ["\n\nThe following skills", "\nCurrent date:"];
  const stop = stopMarkers
    .map((marker) => sectionAndRest.indexOf(marker))
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0];
  const section = stop === undefined ? sectionAndRest : sectionAndRest.slice(0, stop);
  const files: string[] = [];

  for (const match of section.matchAll(/^##\s+(.+?)\s*$/gm)) {
    const filePath = match[1]?.trim();
    if (filePath && isContextHeadingPath(filePath)) files.push(formatContextPath(filePath, cwd));
  }

  const uniqueFiles = uniqueSorted(files, { sort: false });
  return uniqueFiles.length > 0 ? uniqueFiles : undefined;
}

function getStartupResources(pi: ExtensionAPI, ctx: ExtensionContext, contextFiles: string[] | undefined): StartupResources {
  const toolApi = pi as ToolAwareAPI;
  const toolItems = safeList(() => toolApi.getAllTools?.() ?? []);
  const tools = uniqueSorted(toolItems.map((tool) => typeof tool.name === "string" ? tool.name : ""));
  const activeTools = uniqueSorted(safeList(() => toolApi.getActiveTools?.() ?? []));
  const commands = safeList(() => pi.getCommands() as CommandLike[]);
  const themeInfos = safeList(() => ctx.ui.getAllThemes?.() as ThemeInfoLike[] ?? []);

  const skillCommands = commands.filter((command) => commandSource(command) === "skill");
  const skillItems = skillCommands.map((command): ResourceItem => {
    const name = commandName(command)?.replace(/^skill:/, "") ?? "skill";
    const path = commandResourcePath(command, name);
    const shortPath = sourceInfoPath(command.sourceInfo) ? skillDisplayPath(path, command.sourceInfo, ctx.cwd) : undefined;
    const label = shortPath && shortPath !== name ? `${name} — ${shortPath}` : name;
    return { path, sourceInfo: command.sourceInfo, scope: resourceScope(command.sourceInfo, path, ctx.cwd), label };
  });
  const skills = uniqueSorted(skillCommands.map((command) => commandName(command)?.replace(/^skill:/, "") ?? ""));

  const promptCommands = commands.filter((command) => commandSource(command) === "prompt");
  const promptItems = promptCommands.map((command): ResourceItem => {
    const name = commandName(command) ?? "prompt";
    const label = `/${name}`;
    return { path: commandResourcePath(command, label), sourceInfo: command.sourceInfo, label };
  });
  const prompts = uniqueSorted(promptItems.map((item) => item.label ?? ""));

  const extensionCommandItems = commands.filter((command) => commandSource(command) === "extension");
  const commandItems = extensionCommandItems.map((command): ResourceItem => {
    const name = commandName(command) ?? "extension";
    const label = `/${name}`;
    const sourceLabel = commandSourceLabel(command.sourceInfo);
    const path = commandResourcePath(command, label);
    return {
      path,
      sourceInfo: command.sourceInfo,
      label: sourceLabel ? `${label} — ${sourceLabel}` : label,
    };
  });
  const extensionCommands = uniqueSorted(extensionCommandItems.map((command) => {
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
    contextFiles: contextFiles ?? [],
    contextFilesKnown: contextFiles !== undefined,
    skills,
    prompts,
    extensionCommands,
    themes,
    sections: buildStartupSections({
      tools: toolItems,
      activeTools,
      contextFiles: contextFiles ?? [],
      contextFilesKnown: contextFiles !== undefined,
      skillItems,
      commandItems,
      themeItems,
    }),
  };
}

function emptyStartupResources(): StartupResources {
  return {
    tools: [],
    activeTools: [],
    contextFiles: [],
    contextFilesKnown: false,
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

function frameRuleLine(theme: ThemeLike, left: string, right: string, innerWidth: number): string {
  return `${theme.fg("borderAccent", left)}${theme.fg("borderAccent", "─".repeat(innerWidth))}${theme.fg("borderAccent", right)}`;
}

function framedLine(theme: ThemeLike, content: string, innerWidth: number): string {
  return `${theme.fg("borderAccent", "│")}${padToWidth(content, innerWidth)}${theme.fg("borderAccent", "│")}`;
}

function alignBlockLeft(lines: string[], totalWidth: number): string[] {
  return lines.map((line) => truncateToWidth(line, totalWidth, ""));
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function styleBrandWordmarkLine(theme: ThemeLike, line: string, index: number): string {
  if (index <= 1) return theme.fg("accent", theme.bold(line));
  if (index === BRAND_WORDMARK.length - 1) return theme.fg("borderMuted", line);
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
    return [
      "",
      this.titleRuleLine(BRAND, width),
      centerToWidth(this.theme.fg("mdHeading", TAGLINE), width),
      centerToWidth(this.summaryLine(snapshot, width), width),
      this.theme.fg("borderMuted", "─".repeat(width)),
      "",
    ];
  }

  private renderFramed(width: number): string[] {
    const snapshot = this.getSnapshot();
    const boxWidth = width;

    if (!this.expanded) return this.renderCollapsedFramed(snapshot, boxWidth, width);

    const innerWidth = Math.max(1, boxWidth - 2);
    const top = frameRuleLine(this.theme, "╭", "╮", innerWidth);
    const bottom = frameRuleLine(this.theme, "╰", "╯", innerWidth);

    const body: string[] = [
      "",
      ...this.headingLines(boxWidth),
      "",
      top,
    ];

    for (const line of this.dashboardLines(snapshot, innerWidth)) {
      body.push(framedLine(this.theme, line, innerWidth));
    }

    body.push(bottom);

    return alignBlockLeft(body, width);
  }

  private renderCollapsedFramed(snapshot: StartupSnapshot, boxWidth: number, width: number): string[] {
    const innerWidth = Math.max(1, boxWidth - 2);
    const top = frameRuleLine(this.theme, "╭", "╮", innerWidth);
    const bottom = frameRuleLine(this.theme, "╰", "╯", innerWidth);

    const body = [
      "",
      ...this.headingLines(boxWidth),
      centerToWidth(this.theme.fg("mdHeading", TAGLINE), boxWidth),
      "",
      top,
      ...this.compactDashboardLines(snapshot, innerWidth).map((line) => framedLine(this.theme, line, innerWidth)),
      bottom,
      "",
    ];

    return alignBlockLeft(body, width);
  }

  private titleRuleLine(title: string, width: number): string {
    const clipped = truncateToWidth(title, Math.max(1, width - 4), "…");
    const titleText = ` ${clipped} `;
    const fillWidth = Math.max(0, width - visibleWidth(titleText));
    const leftWidth = Math.floor(fillWidth / 2);
    const rightWidth = fillWidth - leftWidth;
    return `${this.theme.fg("borderMuted", "─".repeat(leftWidth))}${this.theme.fg("accent", this.theme.bold(titleText))}${this.theme.fg("borderMuted", "─".repeat(rightWidth))}`;
  }

  private headingLines(width: number): string[] {
    return BRAND_WORDMARK.map((line, index) => centerToWidth(styleBrandWordmarkLine(this.theme, line, index), width));
  }

  private dashboardLines(snapshot: StartupSnapshot, innerWidth: number): string[] {
    return this.paddedDashboardLines(innerWidth, (width) => this.infoPanelLines(snapshot, width));
  }

  private compactDashboardLines(snapshot: StartupSnapshot, innerWidth: number): string[] {
    return this.paddedDashboardLines(innerWidth, (width) => this.compactInfoPanelLines(snapshot, width));
  }

  private paddedDashboardLines(
    innerWidth: number,
    buildInfoLines: (width: number) => string[],
  ): string[] {
    const padding = innerWidth >= 4 ? 2 : 0;
    const contentWidth = Math.max(1, innerWidth - (padding * 2));

    return [
      "",
      ...buildInfoLines(contentWidth).map((line) => `${" ".repeat(padding)}${padToWidth(line, contentWidth)}${" ".repeat(padding)}`),
      "",
    ];
  }

  private infoPanelLines(snapshot: StartupSnapshot, width: number): string[] {
    const lines = [
      this.startupTitleLine(snapshot),
      this.summaryLine(snapshot, width),
    ];

    const addSection = (sectionLines: string[]) => {
      lines.push("", ...sectionLines);
    };

    if (snapshot.contextFilesKnown) addSection(this.contextPanelLines(snapshot, width));
    addSection(this.skillsPanelLines(snapshot, width));
    addSection(this.toolsPanelLines(snapshot, width));
    addSection(this.commandsPanelLines(snapshot, width));
    if (this.expanded && snapshot.themes.length > 0) addSection(this.themesPanelLines(snapshot, width));

    lines.push("", this.hintLine(snapshot, width));
    return lines.map((line) => truncateToWidth(line, width, "…"));
  }

  private compactInfoPanelLines(snapshot: StartupSnapshot, width: number): string[] {
    const lines = [
      this.startupTitleLine(snapshot),
      this.summaryLine(snapshot, width),
      "",
    ];

    if (snapshot.contextFilesKnown) lines.push(this.trimmedResourceLine("context", snapshot.contextFiles, width, 2));
    lines.push("", this.hintLine(snapshot, width));
    return lines.map((line) => truncateToWidth(line, width, "…"));
  }

  private startupTitleLine(snapshot: StartupSnapshot): string {
    const color = this.theme.name === "amp-dark" ? "success" : "mdHeading";
    return this.theme.fg(color, this.theme.bold(`pi v${VERSION} · ${snapshot.project}`));
  }

  private contextPanelLines(snapshot: StartupSnapshot, width: number): string[] {
    const section = this.findSection(snapshot, "Context");
    return [
      ...this.resourceListLines("context", snapshot.contextFiles, width),
      ...(this.expanded ? this.sectionDetailLines(section, width) : []),
    ];
  }

  private skillsPanelLines(snapshot: StartupSnapshot, width: number): string[] {
    const section = this.findSection(snapshot, "Skills");
    return [
      ...this.resourceListLines("skills", snapshot.skills, width),
      ...(this.expanded ? this.sectionDetailLines(section, width) : []),
    ];
  }

  private toolsPanelLines(snapshot: StartupSnapshot, width: number): string[] {
    const tools = snapshot.tools.length > 0 ? snapshot.tools : snapshot.activeTools;
    const section = this.findSection(snapshot, "Tools");
    return [
      ...this.resourceListLines("tools", tools, width),
      ...(this.expanded ? this.sectionDetailLines(section, width) : []),
    ];
  }

  private commandsPanelLines(snapshot: StartupSnapshot, width: number): string[] {
    const section = this.findSection(snapshot, "Commands");
    return [
      ...this.resourceListLines("commands", snapshot.extensionCommands, width),
      ...(this.expanded ? this.sectionDetailLines(section, width) : []),
    ];
  }

  private themesPanelLines(snapshot: StartupSnapshot, width: number): string[] {
    const section = this.findSection(snapshot, "Themes");
    return [
      ...this.resourceListLines("themes", snapshot.themes, width),
      ...this.sectionDetailLines(section, width),
    ];
  }

  private trimmedResourceLine(label: string, items: string[], width: number, maxItems: number): string {
    const prefix = `${label} (${items.length}): `;
    if (items.length === 0) return `${this.theme.fg("muted", prefix)}${this.theme.fg("text", "none")}`;

    for (let count = Math.min(maxItems, items.length); count >= 0; count -= 1) {
      const shown = items.slice(0, count);
      const hidden = items.length - count;
      const values = shown.length > 0 ? shown.join(", ") : `${items.length} total`;
      const suffix = hidden > 0 && shown.length > 0 ? ` +${hidden}` : "";
      const plain = `${prefix}${values}${suffix}`;

      if (visibleWidth(plain) <= width || count === 0) {
        return truncateToWidth(`${this.theme.fg("muted", prefix)}${this.theme.fg("text", values)}${this.theme.fg("dim", suffix)}`, width, "…");
      }
    }

    return truncateToWidth(`${this.theme.fg("muted", prefix)}${this.theme.fg("text", `${items.length} total`)}`, width, "…");
  }

  private resourceListLines(label: string, items: string[], width: number, countLabel = String(items.length)): string[] {
    const prefix = `${label} (${countLabel}): `;
    const styledPrefix = this.theme.fg("muted", prefix);
    const values = items.length > 0 ? items : ["none"];
    const lines: string[] = [];
    let current = styledPrefix;
    let currentPlain = prefix;
    const continuation = " ".repeat(visibleWidth(prefix));

    for (let index = 0; index < values.length; index += 1) {
      const value = values[index] ?? "";
      const chunk = index === 0 ? value : `, ${value}`;
      const nextPlain = `${currentPlain}${chunk}`;

      if (visibleWidth(nextPlain) <= width || currentPlain === prefix) {
        current += this.theme.fg("text", chunk);
        currentPlain = nextPlain;
        continue;
      }

      lines.push(truncateToWidth(current, width, "…"));
      current = `${continuation}${this.theme.fg("text", value)}`;
      currentPlain = `${continuation}${value}`;
    }

    lines.push(truncateToWidth(current, width, "…"));
    return lines;
  }

  private findSection(snapshot: StartupSnapshot, title: string): StartupSection | undefined {
    return snapshot.sections.find((section) => section.title === title);
  }

  private sectionDetailLines(section: StartupSection | undefined, width: number): string[] {
    const lines = section?.lines.length ? section.lines : ["  none loaded"];
    return lines.map((line) => truncateToWidth(this.styleResourceDetailLine(line), width, "…"));
  }

  private summaryLine(snapshot: StartupSnapshot, width: number): string {
    const tools = snapshot.tools.length > 0 ? snapshot.tools : snapshot.activeTools;
    const parts = [
      this.theme.fg("text", plural(tools.length, "tool")),
      this.theme.fg("text", plural(snapshot.skills.length, "skill")),
      this.theme.fg("text", plural(snapshot.extensionCommands.length, "command")),
    ];
    return joinStyled(parts, this.theme.fg("dim", " · "), width);
  }

  private hintLine(snapshot: StartupSnapshot, width: number): string {
    return joinStyled([
      this.theme.fg("muted", this.expanded ? "Ctrl+O collapses" : "Ctrl+O expands"),
      this.theme.fg("dim", "/ for commands"),
    ], this.theme.fg("dim", " · "), width);
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
  // Populated only from Pi's canonical systemPromptOptions; never rediscover context files here.
  let loadedContextFiles: string[] | undefined;

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

    return createStartupSnapshot(ctx, theme, activeThinkingLevel, pi.getCommands().length, getStartupResources(pi, ctx, loadedContextFiles));
  };

  pi.on("session_start", (_event, ctx) => {
    loadedContextFiles = typeof ctx.getSystemPrompt === "function"
      ? contextFilesFromSystemPrompt(ctx.getSystemPrompt(), ctx.cwd)
      : undefined;
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

  pi.on("before_agent_start", (event, ctx) => {
    loadedContextFiles = contextFilesFromSystemPromptOptions(event.systemPromptOptions.contextFiles, ctx.cwd);
    if (!ctx.hasUI) return;

    activeCtx = ctx;
    activeTheme = ctx.ui.theme;
    refreshHeader();
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
    loadedContextFiles = undefined;
  });
}
