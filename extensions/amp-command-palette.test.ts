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

type RegisteredCommand = {
  description?: string;
  getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string; description?: string }> | null;
  handler: (args: string, ctx: any) => Promise<void> | void;
};

function registerAmpEditorCommands(commands: CommandPaletteItem[]): Map<string, RegisteredCommand> {
  const registered = new Map<string, RegisteredCommand>();
  const pi = {
    on() {},
    getThinkingLevel: () => "medium",
    getCommands: () => commands,
    registerCommand(name: string, command: RegisteredCommand) {
      registered.set(name, command);
    },
  };

  ampEditorExtension(pi as never);
  return registered;
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

test("focused skill palette renders names with wrapped descriptions", () => {
  const overlay = new CommandPaletteOverlay(
    [
      {
        name: "tdd",
        source: "skill",
        description: "Drive implementation with a red-green-refactor loop from one customer-centric story and its just-in-time examples.",
      },
    ],
    "",
    { requestRender() {} } as never,
    createThemeStub() as never,
    { matches: () => false } as never,
    () => {},
    undefined,
    { title: " Skills ", itemLayout: "details", maxItems: 4 },
  );

  const rendered = overlay.render(64).map(stripAnsi).join("\n");

  expect(rendered).toContain("Skills");
  expect(rendered).toContain("→ tdd");
  expect(rendered).toContain("Drive implementation with a red-green-refactor loop");
  expect(rendered).toContain("customer-centric story");
  expect(rendered).not.toMatch(/skill\s+tdd\s+Drive/);
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

test("command palette can make enter submit commands for empty prompts", () => {
  let result: CommandPaletteResult | null | undefined;
  const item = { name: "component", source: "prompt" } satisfies CommandPaletteItem;

  new CommandPaletteOverlay([item], "", { requestRender() {} } as never, createThemeStub() as never, createPaletteKeybindings() as never, (value) => {
    result = value;
  }, undefined, { submitOnEnter: true }).handleInput("enter");

  expect(result).toEqual({ command: item.name, action: "submit" });
});

test("command palette keeps submit-on-enter when argument lookup has no matches", async () => {
  let result: CommandPaletteResult | null | undefined;
  const item = { name: "component", source: "prompt" } satisfies CommandPaletteItem;

  new CommandPaletteOverlay([item], "", { requestRender() {} } as never, createThemeStub() as never, createPaletteKeybindings() as never, (value) => {
    result = value;
  }, async () => null, { submitOnEnter: true }).handleInput("enter");
  await flushPromises();

  expect(result).toEqual({ command: item.name, action: "submit" });
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

test("command argument palette can hide the repeated command source column", async () => {
  const overlay = new CommandPaletteOverlay(
    [{ name: "impeccable", source: "extension" }],
    "",
    { requestRender() {} } as never,
    createThemeStub() as never,
    createPaletteKeybindings() as never,
    () => {},
    async () => [{ value: "live", label: "live", description: "Run live mode" }],
    { hideArgumentSource: true },
  );

  overlay.handleInput("enter");
  await flushPromises();

  const argumentRow = overlay.render(80).map(stripAnsi).find((line) => line.includes("live"));

  expect(argumentRow).toContain("→ live");
  expect(argumentRow).toContain("Run live mode");
  expect(argumentRow).not.toContain("impeccable");
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

test("command palette can escape slash into a literal prompt slash", () => {
  let result: CommandPaletteResult | null | undefined;
  const overlay = new CommandPaletteOverlay(
    [{ name: "settings", source: "builtin" }],
    "",
    { requestRender() {} } as never,
    createThemeStub() as never,
    createPaletteKeybindings() as never,
    (value) => { result = value; },
    undefined,
    { literalSlashEscape: true },
  );

  overlay.handleInput("/");

  expect(result).toEqual({ command: "/", action: "literal" });
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

test("command palette preserves existing prompt instead of submitting over it", async () => {
  const editor = createAmpEditor({ command: "compact", action: "submit" });
  const onSubmit = vi.fn();
  editor.onSubmit = onSubmit;

  for (const char of "review this") editor.handleInput(char);
  editor.handleInput("/");
  await Promise.resolve();

  expect(onSubmit).not.toHaveBeenCalled();
  expect(editor.getText()).toBe("review this /compact ");
});

test("command palette insertion respects existing prompt spacing", async () => {
  const editor = createAmpEditor({ command: "skill:tdd", action: "insert" });

  for (const char of "use ") editor.handleInput(char);
  editor.handleInput("/");
  await Promise.resolve();

  expect(editor.getText()).toBe("use /skill:tdd ");
});

test("slash slash types a literal slash in the prompt", async () => {
  const editor = createAmpEditor({ command: "/", action: "literal" });
  const onSubmit = vi.fn();
  editor.onSubmit = onSubmit;

  for (const char of "docs") editor.handleInput(char);
  editor.handleInput("/");
  await Promise.resolve();

  expect(onSubmit).not.toHaveBeenCalled();
  expect(editor.getText()).toBe("docs/");
});

test("skills command opens focused palette and inserts selected skill", async () => {
  const commands = registerAmpEditorCommands([
    {
      name: "skill:tdd",
      source: "skill",
      description: "Drive implementation with a red-green-refactor loop from one customer-centric story and its just-in-time examples.",
    },
    { name: "component", source: "prompt", description: "Build a UI component" },
  ]);
  const skillsCommand = commands.get("skills");
  const setEditorText = vi.fn();
  let rendered = "";

  expect(skillsCommand).toBeDefined();
  expect(skillsCommand?.getArgumentCompletions?.("td")).toEqual([
    {
      value: "tdd",
      label: "tdd",
      description: "Drive implementation with a red-green-refactor loop from one customer-centric story and its just-in-time examples.",
    },
  ]);

  await skillsCommand?.handler("td", {
    hasUI: true,
    mode: "tui",
    ui: {
      custom(factory: any, options: any) {
        const component = factory(
          { requestRender() {} },
          createThemeStub(),
          createPaletteKeybindings(),
          () => {},
        );
        rendered = component.render(72).map(stripAnsi).join("\n");
        expect(options.overlay).toBe(true);
        return Promise.resolve({ command: "tdd", action: "insert" });
      },
      notify: vi.fn(),
      setEditorText,
    },
  });

  expect(rendered).toContain("Skills");
  expect(rendered).toContain("→ tdd");
  expect(rendered).toContain("red-green-refactor loop");
  expect(rendered).not.toContain("component");
  expect(setEditorText).toHaveBeenCalledWith("/skill:tdd ");
});
