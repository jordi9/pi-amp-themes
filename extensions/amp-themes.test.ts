import { readdirSync, readFileSync } from "node:fs";
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

test("amp-themes uses the current Pi package namespace", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    devDependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
    peerDependenciesMeta: Record<string, unknown>;
  };

  expect(packageJson.peerDependencies).toHaveProperty("@earendil-works/pi-coding-agent");
  expect(packageJson.peerDependencies).toHaveProperty("@earendil-works/pi-tui");
  expect(packageJson.devDependencies).toHaveProperty("@earendil-works/pi-coding-agent");
  expect(packageJson.devDependencies).toHaveProperty("@earendil-works/pi-tui");
  expect(packageJson.peerDependenciesMeta).toHaveProperty("@earendil-works/pi-coding-agent");
  expect(packageJson.peerDependenciesMeta).toHaveProperty("@earendil-works/pi-tui");

  const serializedPackageJson = JSON.stringify(packageJson);
  expect(serializedPackageJson).not.toContain("@mariozechner/pi-coding-agent");
  expect(serializedPackageJson).not.toContain("@mariozechner/pi-tui");
});

test("extension source imports Pi packages from the current namespace", () => {
  const extensionFiles = readdirSync(join(process.cwd(), "extensions"))
    .filter((fileName) => fileName.endsWith(".ts"))
    .filter((fileName) => !fileName.endsWith(".test.ts"));

  for (const fileName of extensionFiles) {
    const source = readFileSync(join(process.cwd(), "extensions", fileName), "utf8");

    expect(source, fileName).not.toContain("@mariozechner/pi-coding-agent");
    expect(source, fileName).not.toContain("@mariozechner/pi-tui");
  }
});

test.each([
  ["amp-dark.json", "amp-dark"],
  ["amp-light.json", "amp-light"],
  ["amp-gruvbox-dark-hard.json", "amp-gruvbox-dark-hard"],
  ["amp-rose-pine.json", "amp-rose-pine"],
  ["amp-rose-pine-moon.json", "amp-rose-pine-moon"],
  ["amp-nebula-moon.json", "amp-nebula-moon"],
])("%s defines every required Pi color token", (fileName, expectedName) => {
  const theme = readTheme(fileName);

  expect(theme.name).toBe(expectedName);
  expect(Object.keys(theme.colors).sort()).toEqual([...requiredColorTokens].sort());

  for (const [token, value] of Object.entries(theme.colors)) {
    expect(value, `${fileName}:${token}`).not.toBe("");
  }
});

const rosePineMainVars = {
  "rose-pine-base": "#191724",
  "rose-pine-surface": "#1f1d2e",
  "rose-pine-overlay": "#26233a",
  "rose-pine-muted": "#6e6a86",
  "rose-pine-subtle": "#908caa",
  "rose-pine-text": "#e0def4",
  "rose-pine-love": "#eb6f92",
  "rose-pine-gold": "#f6c177",
  "rose-pine-rose": "#ebbcba",
  "rose-pine-pine": "#31748f",
  "rose-pine-foam": "#9ccfd8",
  "rose-pine-iris": "#c4a7e7",
  "rose-pine-highlight-low": "#21202e",
  "rose-pine-highlight-med": "#403d52",
  "rose-pine-highlight-high": "#524f67",
};

const rosePineMoonVars = {
  "rose-pine-moon-base": "#232136",
  "rose-pine-moon-surface": "#2a273f",
  "rose-pine-moon-overlay": "#393552",
  "rose-pine-moon-muted": "#6e6a86",
  "rose-pine-moon-subtle": "#908caa",
  "rose-pine-moon-text": "#e0def4",
  "rose-pine-moon-love": "#eb6f92",
  "rose-pine-moon-gold": "#f6c177",
  "rose-pine-moon-rose": "#ea9a97",
  "rose-pine-moon-pine": "#3e8fb0",
  "rose-pine-moon-foam": "#9ccfd8",
  "rose-pine-moon-iris": "#c4a7e7",
  "rose-pine-moon-highlight-low": "#2a283e",
  "rose-pine-moon-highlight-med": "#44415a",
  "rose-pine-moon-highlight-high": "#56526e",
};

const nebulaMoonVars = {
  "nebula-rp-base": "#232136",
  "nebula-rp-surface": "#2a273f",
  "nebula-rp-overlay": "#393552",
  "nebula-rp-muted": "#6e6a86",
  "nebula-rp-subtle": "#908caa",
  "nebula-rp-text": "#e0def4",
  "nebula-rp-rose": "#ea9a97",
  "nebula-rp-highlight-low": "#2a283e",
  "nebula-rp-highlight-med": "#44415a",
  "nebula-rp-highlight-high": "#56526e",
  "nebula-tokyo-blue": "#82aaff",
  "nebula-tokyo-cyan": "#86e1fc",
  "nebula-tokyo-green": "#c3e88d",
  "nebula-tokyo-magenta": "#c099ff",
  "nebula-tokyo-purple": "#fca7ea",
  "nebula-tokyo-orange": "#ff966c",
  "nebula-tokyo-red": "#ff757f",
  "nebula-tokyo-yellow": "#ffc777",
  "nebula-amp-red": "#f87171",
  "nebula-cat-mauve": "#cba6f7",
  "nebula-cat-pink": "#f5c2e7",
  "nebula-cat-red": "#f38ba8",
  "nebula-cat-peach": "#fab387",
  "nebula-cat-yellow": "#f9e2af",
  "nebula-cat-green": "#a6e3a1",
  "nebula-cat-teal": "#94e2d5",
  "nebula-cat-sapphire": "#74c7ec",
  "nebula-cat-lavender": "#b4befe",
};

function expectRosePineColorMapping(theme: ThemeFile, prefix: string): void {
  expect(theme.colors).toMatchObject({
    accent: `${prefix}-rose`,
    border: `${prefix}-highlight-high`,
    borderAccent: `${prefix}-rose`,
    borderMuted: `${prefix}-highlight-med`,
    text: `${prefix}-text`,
    thinkingText: `${prefix}-subtle`,
    muted: `${prefix}-subtle`,
    dim: `${prefix}-muted`,
    selectedBg: `${prefix}-highlight-low`,
    customMessageBg: `${prefix}-surface`,
    toolPendingBg: `${prefix}-surface`,
    toolSuccessBg: `${prefix}-surface`,
    toolErrorBg: `${prefix}-overlay`,
    error: `${prefix}-love`,
    warning: `${prefix}-gold`,
    success: `${prefix}-foam`,
    syntaxComment: `${prefix}-muted`,
    syntaxKeyword: `${prefix}-love`,
    syntaxFunction: `${prefix}-pine`,
    syntaxVariable: `${prefix}-foam`,
    syntaxString: `${prefix}-gold`,
    syntaxNumber: `${prefix}-iris`,
    syntaxType: `${prefix}-rose`,
    syntaxOperator: `${prefix}-subtle`,
    syntaxPunctuation: `${prefix}-subtle`,
    thinkingOff: `${prefix}-highlight-med`,
    thinkingMinimal: `${prefix}-subtle`,
    thinkingLow: `${prefix}-foam`,
    thinkingMedium: `${prefix}-gold`,
    thinkingHigh: `${prefix}-rose`,
    thinkingXhigh: `${prefix}-love`,
    bashMode: `${prefix}-gold`,
  });
}

test.each([
  ["amp-rose-pine.json", "official Rosé Pine main", rosePineMainVars],
  ["amp-rose-pine-moon.json", "official Rosé Pine Moon", rosePineMoonVars],
])("%s uses the %s palette", (fileName, _paletteName, expectedVars) => {
  const theme = readTheme(fileName);

  expect(theme.vars).toEqual(expectedVars);
});

test.each([
  ["amp-rose-pine.json", "rose-pine"],
  ["amp-rose-pine-moon.json", "rose-pine-moon"],
])("%s maps Pi tokens to Rosé Pine roles", (fileName, prefix) => {
  const theme = readTheme(fileName);

  expectRosePineColorMapping(theme, prefix);
});

test.each([
  ["amp-rose-pine.json"],
  ["amp-rose-pine-moon.json"],
])("%s maps every official Rosé Pine role into the TUI colors", (fileName) => {
  const theme = readTheme(fileName);
  const usedColors = new Set(Object.values(theme.colors));

  for (const roleName of Object.keys(theme.vars ?? {})) {
    expect(usedColors.has(roleName), roleName).toBe(true);
  }
});

test("amp-nebula-moon blends Rosé Pine Moon, Tokyo Night Moon, and Catppuccin Mocha", () => {
  const theme = readTheme("amp-nebula-moon.json");
  const usedColors = new Set(Object.values(theme.colors));

  expect(theme.vars).toEqual(nebulaMoonVars);
  expect(theme.colors).toMatchObject({
    accent: "nebula-cat-mauve",
    border: "nebula-rp-highlight-high",
    borderAccent: "nebula-tokyo-purple",
    selectedBg: "nebula-rp-highlight-low",
    customMessageBg: "nebula-rp-surface",
    toolErrorBg: "nebula-rp-overlay",
    mdHeading: "nebula-tokyo-yellow",
    mdLink: "nebula-tokyo-blue",
    mdCode: "nebula-tokyo-cyan",
    error: "nebula-amp-red",
    toolDiffRemoved: "nebula-tokyo-red",
    syntaxKeyword: "nebula-cat-red",
    syntaxVariable: "nebula-cat-sapphire",
    syntaxString: "nebula-cat-green",
    syntaxNumber: "nebula-cat-peach",
    thinkingLow: "nebula-cat-teal",
    thinkingHigh: "nebula-tokyo-purple",
    thinkingXhigh: "nebula-amp-red"
  });

  for (const roleName of Object.keys(theme.vars ?? {})) {
    expect(usedColors.has(roleName), roleName).toBe(true);
  }
});

test("amp-gruvbox-dark-hard uses the canonical Gruvbox dark hard palette", () => {
  const theme = readTheme("amp-gruvbox-dark-hard.json");

  expect(theme.vars).toEqual({
    "gruvbox-bg0-hard": "#1d2021",
    "gruvbox-bg0": "#282828",
    "gruvbox-bg0-soft": "#32302f",
    "gruvbox-bg1": "#3c3836",
    "gruvbox-bg2": "#504945",
    "gruvbox-bg3": "#665c54",
    "gruvbox-bg4": "#7c6f64",
    "gruvbox-gray": "#928374",
    "gruvbox-fg0-hard": "#f9f5d7",
    "gruvbox-fg0": "#fbf1c7",
    "gruvbox-fg0-soft": "#f2e5bc",
    "gruvbox-fg1": "#ebdbb2",
    "gruvbox-fg2": "#d5c4a1",
    "gruvbox-fg3": "#bdae93",
    "gruvbox-fg4": "#a89984",
    "gruvbox-red": "#fb4934",
    "gruvbox-green": "#b8bb26",
    "gruvbox-yellow": "#fabd2f",
    "gruvbox-blue": "#83a598",
    "gruvbox-purple": "#d3869b",
    "gruvbox-aqua": "#8ec07c",
    "gruvbox-orange": "#fe8019",
    "gruvbox-neutral-red": "#cc241d",
    "gruvbox-neutral-green": "#98971a",
    "gruvbox-neutral-yellow": "#d79921",
    "gruvbox-neutral-blue": "#458588",
    "gruvbox-neutral-purple": "#b16286",
    "gruvbox-neutral-aqua": "#689d6a",
    "gruvbox-neutral-orange": "#d65d0e",
  });
});

test("amp-gruvbox-dark-hard maps Pi tokens to Gruvbox roles", () => {
  const theme = readTheme("amp-gruvbox-dark-hard.json");

  expect(theme.colors).toMatchObject({
    accent: "gruvbox-green",
    border: "gruvbox-bg4",
    borderAccent: "gruvbox-green",
    borderMuted: "gruvbox-bg3",
    text: "gruvbox-fg1",
    thinkingText: "gruvbox-fg3",
    muted: "gruvbox-fg4",
    dim: "gruvbox-gray",
    selectedBg: "gruvbox-bg1",
    error: "gruvbox-red",
    warning: "gruvbox-orange",
    success: "gruvbox-green",
    syntaxComment: "gruvbox-gray",
    syntaxKeyword: "gruvbox-red",
    syntaxFunction: "gruvbox-green",
    syntaxVariable: "gruvbox-blue",
    syntaxString: "gruvbox-green",
    syntaxNumber: "gruvbox-purple",
    syntaxType: "gruvbox-yellow",
    syntaxOperator: "gruvbox-fg1",
    syntaxPunctuation: "gruvbox-fg4",
    thinkingOff: "gruvbox-bg3",
    thinkingMinimal: "gruvbox-fg4",
    thinkingLow: "gruvbox-green",
    thinkingMedium: "gruvbox-yellow",
    thinkingHigh: "gruvbox-orange",
    thinkingXhigh: "gruvbox-red",
    bashMode: "gruvbox-orange",
  });
});
