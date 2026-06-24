import { AssistantMessageComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AMP_ASSISTANT_MARKDOWN_PATCH_OWNER = {};
const AMP_CODE_BLOCK_THEME = Symbol("ampCodeBlockTheme");
const MARKDOWN_FENCE_REGEX = /(^|\n)([ \t]{0,3})```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n[ \t]{0,3}```[ \t]*(?=\r?\n|$)/g;
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE"]);
const ENDPOINT_LINE_REGEX = /^\s*([A-Za-z]+)\s+(\S+)\s*$/;
const API_FENCE_LANGUAGES = new Set(["", "txt", "text", "api", "http", "rest"]);
const SHELL_FENCE_LANGUAGES = new Set([
  "bash",
  "sh",
  "shell",
  "shell-session",
  "shellsession",
  "zsh",
  "fish",
  "console",
  "terminal",
]);

type AssistantMessageLike = {
  content?: unknown;
  [key: string]: unknown;
};

type TextContentLike = {
  type: "text";
  text: string;
  [key: string]: unknown;
};

type ApiEndpoint = {
  method: string;
  path: string;
};

type UpdateContentFn = (message: unknown) => void;

type PatchableAssistantMessagePrototype = {
  updateContent: UpdateContentFn;
  __ampAssistantMarkdownOriginalUpdateContent?: UpdateContentFn;
  __ampAssistantMarkdownUpdateContent?: UpdateContentFn;
  __ampAssistantMarkdownPatched?: boolean;
  __ampAssistantMarkdownPatchOwner?: object;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextContent(value: unknown): value is TextContentLike {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function getFenceLanguage(info: string): string {
  return info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function isPathLike(value: string): boolean {
  return value.startsWith("/") || /^https?:\/\//i.test(value);
}

function parseApiEndpointBlock(code: string): ApiEndpoint[] | undefined {
  const endpoints: ApiEndpoint[] = [];

  for (const line of code.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) continue;

    const match = ENDPOINT_LINE_REGEX.exec(line);
    if (!match) return undefined;

    const method = match[1].toUpperCase();
    const path = match[2];
    if (!HTTP_METHODS.has(method) || !isPathLike(path)) return undefined;

    endpoints.push({ method, path });
  }

  return endpoints.length > 0 ? endpoints : undefined;
}

function escapeTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function inlineCode(value: string): string {
  const escaped = escapeTableCell(value).replace(/`/g, "\\`");
  return `\`${escaped}\``;
}

function renderApiEndpointTable(endpoints: ApiEndpoint[]): string {
  return [
    "| Method | Endpoint |",
    "|---|---|",
    ...endpoints.map((endpoint) => `| ${inlineCode(endpoint.method)} | ${inlineCode(endpoint.path)} |`),
  ].join("\n");
}

function applyIndent(text: string, indent: string): string {
  if (!indent) return text;
  return text.split("\n").map((line) => `${indent}${line}`).join("\n");
}

function getLeadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

function commonWhitespacePrefix(lines: string[]): string {
  let common: string | undefined;

  for (const line of lines) {
    if (!line.trim()) continue;

    const whitespace = getLeadingWhitespace(line);
    if (common === undefined) {
      common = whitespace;
      continue;
    }

    let index = 0;
    while (index < common.length && index < whitespace.length && common[index] === whitespace[index]) {
      index += 1;
    }

    common = common.slice(0, index);
    if (!common) break;
  }

  return common ?? "";
}

function removeCommonLeadingWhitespace(code: string): string {
  const normalizedCode = code.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalizedCode.split("\n");
  const common = commonWhitespacePrefix(lines);
  if (!common) return code;

  return lines.map((line) => (line.trim() ? line.slice(common.length) : "")).join("\n");
}

export function transformApiEndpointFences(markdown: string): string {
  return markdown.replace(MARKDOWN_FENCE_REGEX, (match, leadingNewline: string, indent: string, info: string, code: string) => {
    const language = getFenceLanguage(info);
    if (!API_FENCE_LANGUAGES.has(language)) return match;

    const endpoints = parseApiEndpointBlock(code);
    if (!endpoints) return match;

    return `${leadingNewline}${applyIndent(renderApiEndpointTable(endpoints), indent)}`;
  });
}

export function transformShellCommandFences(markdown: string): string {
  return markdown.replace(MARKDOWN_FENCE_REGEX, (match, leadingNewline: string, indent: string, info: string, code: string) => {
    const language = getFenceLanguage(info);
    if (!SHELL_FENCE_LANGUAGES.has(language)) return match;

    const dedentedCode = removeCommonLeadingWhitespace(code);
    if (dedentedCode === code) return match;

    return `${leadingNewline}${indent}\`\`\`${info}\n${applyIndent(dedentedCode, indent)}\n${indent}\`\`\``;
  });
}

export function transformAssistantMarkdown(markdown: string): string {
  return transformShellCommandFences(transformApiEndpointFences(markdown));
}

type MarkdownThemeLike = Record<string, unknown> & {
  codeBlockBorder?: (text: string) => string;
  codeBlockIndent?: string;
  [AMP_CODE_BLOCK_THEME]?: true;
};

function renderCodeBlockBorderLabel(borderText: string, isClosing: boolean): string {
  if (isClosing) return "╰─";

  const info = borderText.slice(3).trim();
  const language = info.split(/\s+/)[0] || "code";
  return `╭─ ${language}`;
}

export function withCopyableCodeBlockIndent<T extends MarkdownThemeLike>(markdownTheme: T): T & { codeBlockIndent: "" } {
  if (markdownTheme[AMP_CODE_BLOCK_THEME] === true && markdownTheme.codeBlockIndent === "") {
    return markdownTheme as T & { codeBlockIndent: "" };
  }

  const originalCodeBlockBorder = markdownTheme.codeBlockBorder?.bind(markdownTheme) ?? ((text: string) => text);
  let insideCodeBlock = false;

  return {
    ...markdownTheme,
    [AMP_CODE_BLOCK_THEME]: true,
    codeBlockIndent: "",
    codeBlockBorder: (text: string) => {
      if (!text.startsWith("```")) return originalCodeBlockBorder(text);

      const isClosing = insideCodeBlock;
      insideCodeBlock = !insideCodeBlock;
      return originalCodeBlockBorder(renderCodeBlockBorderLabel(text, isClosing));
    },
  };
}

function applyCopyableCodeBlockTheme(renderContext: unknown): void {
  if (!isRecord(renderContext) || !isRecord(renderContext.markdownTheme)) return;
  renderContext.markdownTheme = withCopyableCodeBlockIndent(renderContext.markdownTheme);
}

function transformAssistantMessage(message: unknown): unknown {
  if (!isRecord(message)) return message;

  const content = (message as AssistantMessageLike).content;
  if (!Array.isArray(content)) return message;

  let changed = false;
  const transformedContent = content.map((part) => {
    if (!isTextContent(part)) return part;

    const text = transformAssistantMarkdown(part.text);
    if (text === part.text) return part;

    changed = true;
    return { ...part, text };
  });

  return changed ? { ...message, content: transformedContent } : message;
}

function patchAssistantMessageRender(): void {
  const prototype = AssistantMessageComponent.prototype as unknown as PatchableAssistantMessagePrototype;
  const currentUpdateContent = prototype.updateContent;
  const currentAmpUpdateContent = prototype.__ampAssistantMarkdownUpdateContent;
  const currentIsAmpUpdateContent =
    prototype.__ampAssistantMarkdownPatchOwner === AMP_ASSISTANT_MARKDOWN_PATCH_OWNER &&
    currentUpdateContent === currentAmpUpdateContent;

  if (currentIsAmpUpdateContent) return;

  const existingOriginal = prototype.__ampAssistantMarkdownOriginalUpdateContent;
  const currentLooksLikeLegacyAmpUpdate =
    prototype.__ampAssistantMarkdownPatched &&
    typeof existingOriginal === "function" &&
    currentUpdateContent.name === "updateContentWithAmpAssistantMarkdown";

  if (!currentLooksLikeLegacyAmpUpdate) {
    prototype.__ampAssistantMarkdownOriginalUpdateContent = currentUpdateContent;
  }

  const original = prototype.__ampAssistantMarkdownOriginalUpdateContent ?? currentUpdateContent;
  const ampUpdateContent = function updateContentWithAmpAssistantMarkdown(this: unknown, message: unknown): void {
    applyCopyableCodeBlockTheme(this);
    original.call(this, transformAssistantMessage(message));
  };

  prototype.updateContent = ampUpdateContent;
  prototype.__ampAssistantMarkdownUpdateContent = ampUpdateContent;
  prototype.__ampAssistantMarkdownPatched = true;
  prototype.__ampAssistantMarkdownPatchOwner = AMP_ASSISTANT_MARKDOWN_PATCH_OWNER;
}

export default function (pi: ExtensionAPI) {
  patchAssistantMessageRender();

  pi.on("session_start", () => {
    patchAssistantMessageRender();
  });
}
