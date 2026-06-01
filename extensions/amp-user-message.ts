import {
  getMarkdownTheme,
  UserMessageComponent,
  type ExtensionAPI,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type RenderFn = (width: number) => string[];
type PatchableUserMessagePrototype = {
  render: RenderFn;
  children?: unknown[];
  __ampUserMessageOriginalRender?: RenderFn;
  __ampUserMessageRender?: RenderFn;
  __ampUserMessagePatched?: boolean;
  __ampUserMessagePatchOwner?: object;
  __ampUserMessageGetTheme?: () => ThemeLike | undefined;
  __ampUserMessageGetThinkingLevel?: () => string;
};

const AMP_USER_MESSAGE_PATCH_OWNER = {};

type MarkdownLike = {
  text?: unknown;
};

type ThemeLike = {
  fg(color: ThemeColor, text: string): string;
  italic?(text: string): string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findMarkdownText(value: unknown): string | undefined {
  if (isRecord(value) && typeof (value as MarkdownLike).text === "string") {
    return (value as { text: string }).text;
  }

  if (!isRecord(value)) return undefined;

  const children = Array.isArray(value.children) ? value.children : [];
  for (const child of children) {
    const text = findMarkdownText(child);
    if (text !== undefined) return text;
  }

  return undefined;
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

function styledUserLine(line: string, width: number, theme: ThemeLike | undefined, color: ThemeColor): string {
  const prefix = theme ? theme.fg(color, "▌") : "▌";
  const contentWidth = Math.max(1, width - visibleWidth(prefix));
  const clipped = truncateToWidth(line, contentWidth, "");
  const text = theme ? theme.fg("userMessageText", theme.italic ? theme.italic(clipped) : clipped) : clipped;
  const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
  return `${prefix}${text}${padding}`;
}

function renderAmpUserMessage(
  instance: PatchableUserMessagePrototype,
  width: number,
  theme: ThemeLike | undefined,
  color: ThemeColor,
): string[] | undefined {
  const text = findMarkdownText(instance);
  if (text === undefined) return undefined;

  const prefixWidth = 3;
  const contentWidth = Math.max(1, width - prefixWidth);
  const renderer = new Markdown(text, 0, 0, getMarkdownTheme());
  const lines = renderer.render(contentWidth);
  const body = lines.length > 0 ? lines : [""];

  return [
    "",
    ...body.map((line) => styledUserLine(line, width, theme, color)),
  ];
}

function patchUserMessageRender(getTheme: () => ThemeLike | undefined, getThinkingLevel: () => string): void {
  const prototype = UserMessageComponent.prototype as unknown as PatchableUserMessagePrototype;
  prototype.__ampUserMessageGetTheme = getTheme;
  prototype.__ampUserMessageGetThinkingLevel = getThinkingLevel;

  const currentRender = prototype.render;
  const currentAmpRender = prototype.__ampUserMessageRender;
  const currentIsAmpRender =
    prototype.__ampUserMessagePatchOwner === AMP_USER_MESSAGE_PATCH_OWNER &&
    currentRender === currentAmpRender;

  if (currentIsAmpRender) return;

  const existingOriginal = prototype.__ampUserMessageOriginalRender;
  const currentLooksLikeLegacyAmpRender =
    prototype.__ampUserMessagePatched &&
    typeof existingOriginal === "function" &&
    currentRender.name === "renderWithAmpUserMessage";

  if (!currentLooksLikeLegacyAmpRender) {
    prototype.__ampUserMessageOriginalRender = currentRender;
  }

  const original = prototype.__ampUserMessageOriginalRender ?? currentRender;
  const ampRender = function renderWithAmpUserMessage(this: PatchableUserMessagePrototype, width: number): string[] {
    const theme = prototype.__ampUserMessageGetTheme?.();
    const thinkingLevel = prototype.__ampUserMessageGetThinkingLevel?.() ?? "off";
    const color = getThinkingColor(thinkingLevel);
    const ampLines = renderAmpUserMessage(this as PatchableUserMessagePrototype, width, theme, color);
    return ampLines ?? original.call(this, width);
  };

  prototype.render = ampRender;
  prototype.__ampUserMessageRender = ampRender;
  prototype.__ampUserMessagePatched = true;
  prototype.__ampUserMessagePatchOwner = AMP_USER_MESSAGE_PATCH_OWNER;
}

export default function (pi: ExtensionAPI) {
  let activeTheme: ThemeLike | undefined;
  let activeThinkingLevel = "off";

  const getTheme = () => activeTheme;
  const getThinkingLevel = () => activeThinkingLevel;

  patchUserMessageRender(getTheme, getThinkingLevel);

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    activeTheme = ctx.ui.theme;
    activeThinkingLevel = pi.getThinkingLevel();
    patchUserMessageRender(getTheme, getThinkingLevel);
  });

  pi.on("thinking_level_select", (event) => {
    activeThinkingLevel = event.level;
  });

  pi.on("before_agent_start", () => {
    activeThinkingLevel = pi.getThinkingLevel();
    patchUserMessageRender(getTheme, getThinkingLevel);
  });
}
