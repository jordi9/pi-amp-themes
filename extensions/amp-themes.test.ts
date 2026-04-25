import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const requiredColorTokens = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "selectedBg",
  "userMessageBg",
  "userMessageText",
  "customMessageBg",
  "customMessageText",
  "customMessageLabel",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "bashMode",
];

type ThemeFile = {
  name: string;
  vars?: Record<string, string | number>;
  colors: Record<string, string | number>;
};

function readTheme(fileName: string): ThemeFile {
  return JSON.parse(readFileSync(join(process.cwd(), "themes", fileName), "utf8")) as ThemeFile;
}

test.each([
  ["amp-dark.json", "amp-dark"],
  ["amp-light.json", "amp-light"],
  ["amp-gruvbox-dark-hard.json", "amp-gruvbox-dark-hard"],
])("%s defines every required Pi color token", (fileName, expectedName) => {
  const theme = readTheme(fileName);

  expect(theme.name).toBe(expectedName);
  expect(Object.keys(theme.colors).sort()).toEqual([...requiredColorTokens].sort());

  for (const [token, value] of Object.entries(theme.colors)) {
    expect(value, `${fileName}:${token}`).not.toBe("");
  }
});
