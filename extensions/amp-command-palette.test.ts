import { expect, test, vi } from "vitest";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import ampEditorExtension from "./amp-editor.js";
import { CommandPaletteOverlay, stripAnsi, type CommandPaletteItem, type CommandPaletteResult } from "./amp-command-palette.js";

type ThemeStub = {
  fg(color: string, text: string): string;
  bold(text: string): string;
};

type AmpEditorLike = {
  handleInput(data: string): void;
  getText(): string;
  onSubmit?: (text: string) => void;
};

function createThemeStub(): ThemeStub {
  return {
    fg(_color: string, text: string) {
      return text;
    },
    bold(text: string) {
      return text;
    },
  };
}

function createOverlay(items: CommandPaletteItem[], initialQuery = ""): CommandPaletteOverlay {
  return new CommandPaletteOverlay(
    items,
    initialQuery,
    { requestRender() {} } as never,
    createThemeStub() as never,
    { matches: () => false } as never,
    () => {},
  );
}

function createPaletteKeybindings() {
  return {
    matches(data: string, action: string) {
      return (data === "tab" && action === "tui.input.tab") || (data === "enter" && action === "tui.select.confirm");
    },
  };
}

function pickPaletteItem(item: CommandPaletteItem, key: "tab" | "enter"): CommandPaletteResult | null | undefined {
  let result: CommandPaletteResult | null | undefined;
  new CommandPaletteOverlay([item], "", { requestRender() {} } as never, createThemeStub() as never, createPaletteKeybindings() as never, (value) => {
    result = value;
  }).handleInput(key);
  return result;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createAmpEditor(paletteResult: CommandPaletteResult): AmpEditorLike {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
  const pi = {
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
      handlers.set(event, handler);
    },
    getThinkingLevel: () => "medium",
    getCommands: () => [],
    registerCommand() {},
  };

  ampEditorExtension(pi as never);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => AmpEditorLike)
    | undefined;

  const sessionStart = handlers.get("session_start");
  expect(sessionStart).toBeDefined();

  sessionStart?.(
    { type: "session_start", reason: "startup" },
    {
      hasUI: true,
      cwd: process.cwd(),
      model: {
        id: "claude-sonnet-4-20250514",
        contextWindow: 200000,
        reasoning: true,
      },
      modelRegistry: { isUsingOAuth: () => false },
      sessionManager: {
        getEntries: () => [],
        getLeafId: () => undefined,
        getSessionName: () => undefined,
      },
      getContextUsage: () => ({ percent: 12, contextWindow: 200000 }),
      ui: {
        custom: () => Promise.resolve(paletteResult),
        theme: createThemeStub(),
        setEditorComponent(factory: typeof editorFactory) {
          editorFactory = factory;
        },
        setWorkingIndicator() {},
        setWorkingMessage() {},
        setWorkingVisible() {},
        setFooter() {},
      },
    } as unknown as ExtensionContext,
  );

  expect(editorFactory).toBeDefined();
  return editorFactory!(
    { requestRender() {}, terminal: { rows: 24 } },
    createThemeStub(),
    { matches: () => false },
  );
}

test("command palette renders multiline descriptions as one terminal row", () => {
  const overlay = createOverlay([
    {
      name: "skill:pi-subagents",
      source: "skill",
      description: "Delegate work.\nContinue safely.",
    },
  ]);

  const rendered = overlay.render(96).map(stripAnsi);

  expect(rendered.every((line) => !/[\r\n]/.test(line))).toBe(true);
  expect(rendered.join("\n")).toContain("Delegate work. Continue safely.");
});

test("command palette caps command column on wide terminals", () => {
  const overlay = createOverlay([
    { name: "settings", source: "builtin", description: "Open settings menu" },
  ]);

  const row = overlay.render(180).map(stripAnsi).find((line) => line.includes("settings"));
  const gap = row?.match(/settings( +)Open settings/)?.[1] ?? "";

  expect(gap.length).toBeGreaterThan(0);
  expect(gap.length).toBeLessThanOrEqual(32);
});

test.each([
  [{ name: "settings", source: "builtin" }, "submit"],
  [{ name: "btw:new", source: "extension" }, "submit"],
  [{ name: "skill:pi-subagents", source: "skill" }, "insert"],
  [{ name: "component", source: "prompt" }, "insert"],
] satisfies Array<[CommandPaletteItem, CommandPaletteResult["action"]]>)
("command palette enter action follows command source for %s", (item, expectedAction) => {
  expect(pickPaletteItem(item, "enter")).toEqual({ command: item.name, action: expectedAction });
});

test.each([
  { name: "settings", source: "builtin" },
  { name: "btw:new", source: "extension" },
  { name: "skill:pi-subagents", source: "skill" },
  { name: "component", source: "prompt" },
] satisfies CommandPaletteItem[])("command palette tab always inserts %s", (item) => {
  expect(pickPaletteItem(item, "tab")).toEqual({ command: item.name, action: "insert" });
});

test("command palette selects command arguments before submitting", async () => {
  let result: CommandPaletteResult | null | undefined;
  const overlay = new CommandPaletteOverlay(
    [{ name: "impeccable", source: "extension" }],
    "",
    { requestRender() {} } as never,
    createThemeStub() as never,
    createPaletteKeybindings() as never,
    (value) => { result = value; },
    async () => [{ value: "live", label: "live", description: "Run live mode" }],
  );

  overlay.handleInput("enter");
  await flushPromises();

  expect(result).toBeUndefined();
  expect(overlay.render(80).map(stripAnsi).join("\n")).toContain("/impeccable");
  expect(overlay.render(80).map(stripAnsi).join("\n")).toContain("live");

  overlay.handleInput("enter");

  expect(result).toEqual({ command: "impeccable live", action: "submit" });
});

test("command palette falls back to submitting commands without arguments", async () => {
  let result: CommandPaletteResult | null | undefined;
  const overlay = new CommandPaletteOverlay(
    [{ name: "settings", source: "builtin" }],
    "",
    { requestRender() {} } as never,
    createThemeStub() as never,
    createPaletteKeybindings() as never,
    (value) => { result = value; },
    async () => null,
  );

  overlay.handleInput("enter");
  await flushPromises();

  expect(result).toEqual({ command: "settings", action: "submit" });
});

test("submitting a command from the palette matches native slash completion", async () => {
  const editor = createAmpEditor({ command: "compact", action: "submit" });
  const onSubmit = vi.fn();
  editor.onSubmit = onSubmit;

  editor.handleInput("/");
  await Promise.resolve();

  expect(onSubmit).toHaveBeenCalledWith("/compact");
  expect(editor.getText()).toBe("");
});

test("inserting a command from the palette leaves it editable without submitting", async () => {
  const editor = createAmpEditor({ command: "compact", action: "insert" });
  const onSubmit = vi.fn();
  editor.onSubmit = onSubmit;

  editor.handleInput("/");
  await Promise.resolve();

  expect(onSubmit).not.toHaveBeenCalled();
  expect(editor.getText()).toBe("/compact ");
});
