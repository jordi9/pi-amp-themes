import { basename, dirname, isAbsolute, resolve as resolvePath } from "node:path";
import {
  createReadToolDefinition,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";

type ThemeLike = {
  fg(color: string, text: string): string;
  bold(text: string): string;
};

type ToolRenderContextLike = {
  cwd?: string;
  lastComponent?: unknown;
};

type RenderCall = (args: unknown, theme: ThemeLike, context?: ToolRenderContextLike) => Component;
type RenderResult = (result: unknown, options: unknown, theme: ThemeLike, context?: ToolRenderContextLike) => Component;
type ReadToolDefinition = ReturnType<typeof createReadToolDefinition>;

type RuntimeToolLike = Record<PropertyKey, unknown> & {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  renderCall?: RenderCall;
  renderResult?: RenderResult;
  renderShell?: "default" | "self";
};

type ToolDisplayApi = {
  version: 1;
  decorateTool<T extends RuntimeToolLike>(tool: T, adapter?: { kind?: "read" }): T;
};

type GlobalWithToolDisplayApi = typeof globalThis & {
  [TOOL_DISPLAY_API_KEY]?: ToolDisplayApi;
};

type SkillDisplayMetadata = {
  name: string;
  filePath: string;
  baseDir?: string;
};

const TOOL_DISPLAY_API_KEY = Symbol.for("pi-tool-display.api.v1");

// Pi exposes getAllTools() as metadata, not mutable runtime tool definitions.
// This extension therefore owns the read override and delegates normal read UI
// back through pi-tool-display's decoration API when it is available.
const readDefinitions = new Map<string, ReadToolDefinition>();

function getReadDefinition(cwd: string): ReadToolDefinition {
  let definition = readDefinitions.get(cwd);
  if (!definition) {
    definition = createReadToolDefinition(cwd);
    readDefinitions.set(cwd, definition);
  }
  return definition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringField(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value[field];
  return typeof raw === "string" ? raw : undefined;
}

function getNumericField(value: unknown, field: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value[field];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function getReadPath(args: unknown): string | undefined {
  return getStringField(args, "file_path") ?? getStringField(args, "path");
}

function normalizeReadPath(rawPath: string, cwd: string | undefined): string {
  const trimmed = rawPath.trim();
  const path = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return isAbsolute(path) ? resolvePath(path) : resolvePath(cwd || process.cwd(), path);
}

function extractSkillDisplayMetadataFromSkills(skills: unknown): SkillDisplayMetadata[] {
  if (!Array.isArray(skills)) return [];

  const metadata: SkillDisplayMetadata[] = [];
  for (const skill of skills) {
    const name = getStringField(skill, "name");
    const filePath = getStringField(skill, "filePath") ?? getStringField(skill, "location");
    const baseDir = getStringField(skill, "baseDir");
    if (name && filePath) metadata.push({ name, filePath, baseDir });
  }
  return metadata;
}

function extractSkillDisplayMetadataFromCommands(pi: ExtensionAPI): SkillDisplayMetadata[] {
  try {
    return pi.getCommands()
      .filter((command) => getStringField(command, "source") === "skill")
      .map((command) => {
        const commandName = getStringField(command, "name") ?? getStringField(command, "invocationName") ?? "skill";
        const sourceInfo = isRecord(command) ? command.sourceInfo : undefined;
        return {
          name: commandName.replace(/^skill:/, ""),
          filePath: getStringField(sourceInfo, "path") ?? "",
          baseDir: getStringField(sourceInfo, "baseDir"),
        };
      })
      .filter((skill) => skill.name.length > 0 && skill.filePath.length > 0);
  } catch {
    return [];
  }
}

function normalizeSkillPath(skill: SkillDisplayMetadata, cwd: string | undefined): string {
  return normalizeReadPath(skill.filePath, skill.baseDir ?? cwd);
}

function mergeSkillDisplayMetadata(...groups: readonly SkillDisplayMetadata[][]): SkillDisplayMetadata[] {
  const byPath = new Map<string, SkillDisplayMetadata>();
  for (const group of groups) {
    for (const skill of group) byPath.set(normalizeSkillPath(skill, process.cwd()), skill);
  }
  return [...byPath.values()];
}

function getReadRangeSuffix(args: unknown): string {
  const offset = getNumericField(args, "offset");
  const limit = getNumericField(args, "limit");
  if (offset === undefined && limit === undefined) return "";

  const from = offset ?? 1;
  const to = limit !== undefined ? from + limit - 1 : undefined;
  return to ? `:${from}-${to}` : `:${from}`;
}

function getSkillReadLabel(
  rawPath: string | undefined,
  cwd: string | undefined,
  skills: readonly SkillDisplayMetadata[],
): string | undefined {
  if (!rawPath || !rawPath.trim()) return undefined;

  const normalizedPath = normalizeReadPath(rawPath, cwd);
  for (const skill of skills) {
    if (normalizeSkillPath(skill, cwd) === normalizedPath) return skill.name;
  }

  if (basename(normalizedPath) === "SKILL.md") {
    return basename(dirname(normalizedPath)) || "skill";
  }

  return undefined;
}

function renderSkillReadCall(label: string, args: unknown, theme: ThemeLike, context?: ToolRenderContextLike): Text {
  const text = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
  const prefix = theme.fg("customMessageLabel", theme.bold("[skill]"));
  const name = theme.fg("customMessageText", label);
  const suffix = getReadRangeSuffix(args);
  text.setText(`${prefix} ${name}${suffix ? theme.fg("warning", suffix) : ""}`);
  return text;
}

function getToolDisplayApi(): ToolDisplayApi | undefined {
  const api = (globalThis as GlobalWithToolDisplayApi)[TOOL_DISPLAY_API_KEY];
  return api?.version === 1 && typeof api.decorateTool === "function" ? api : undefined;
}

function createDisplayDecoratedReadFallback(bootstrapRead: ReadToolDefinition): RuntimeToolLike {
  const tool: RuntimeToolLike = {
    name: bootstrapRead.name,
    label: bootstrapRead.label,
    description: bootstrapRead.description,
    parameters: bootstrapRead.parameters,
  };

  try {
    return getToolDisplayApi()?.decorateTool(tool, { kind: "read" }) ?? tool;
  } catch {
    return tool;
  }
}

function createAmpReadTool(getSkills: () => readonly SkillDisplayMetadata[]): ReadToolDefinition {
  const bootstrapRead = getReadDefinition(process.cwd());
  const displayFallback = createDisplayDecoratedReadFallback(bootstrapRead);
  const fallbackRenderCall = displayFallback.renderCall ?? (bootstrapRead.renderCall as RenderCall | undefined);
  const fallbackRenderResult = displayFallback.renderResult ?? (bootstrapRead.renderResult as RenderResult | undefined);

  return {
    ...bootstrapRead,
    renderShell: displayFallback.renderShell ?? bootstrapRead.renderShell,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getReadDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const label = getSkillReadLabel(getReadPath(args), context?.cwd, getSkills());
      if (label) return renderSkillReadCall(label, args, theme, context);
      return fallbackRenderCall?.(args, theme, context) ?? renderSkillReadCall("read", args, theme, context);
    },
    renderResult(result, options, theme, context) {
      return fallbackRenderResult?.(result, options, theme, context) ?? new Text("", 0, 0);
    },
  };
}

export default function (pi: ExtensionAPI) {
  let skills: SkillDisplayMetadata[] = [];

  const refreshSkills = (promptSkills: unknown = []): void => {
    skills = mergeSkillDisplayMetadata(
      extractSkillDisplayMetadataFromCommands(pi),
      extractSkillDisplayMetadataFromSkills(promptSkills),
    );
  };

  const registerReadOverride = (): void => {
    pi.registerTool(createAmpReadTool(() => skills));
  };

  pi.on("session_shutdown", () => {
    readDefinitions.clear();
  });

  pi.on("session_start", () => {
    refreshSkills();
    registerReadOverride();
  });

  pi.on("before_agent_start", (event) => {
    refreshSkills(event.systemPromptOptions?.skills);
    registerReadOverride();
  });
}
