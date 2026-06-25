import { expect, test } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import ampEditorExtension from "./amp-editor.js";

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;
type InputListenerResult = { consume?: boolean; data?: string } | undefined;
type InputListener = (data: string) => InputListenerResult;

type ThemeStub = {
  fg(color: string, text: string): string;
  borderColor(text: string): string;
  bold(text: string): string;
};

function createThemeStub(): ThemeStub {
  return {
    fg(_color: string, text: string) {
      return text;
    },
    borderColor(text: string) {
      return text;
    },
    bold(text: string) {
      return text;
    },
  };
}

function createPiStub() {
  const handlers = new Map<string, EventHandler>();
  const pi = {
    on(event: string, handler: EventHandler) {
      handlers.set(event, handler);
    },
    getCommands: () => [],
    getThinkingLevel: () => "medium",
    registerCommand() {},
    registerShortcut() {},
  } as unknown as ExtensionAPI;

  return { pi, handlers };
}

function createContext(theme: ThemeStub, setEditorComponent: (factory: (tui: never, theme: never, keybindings: never) => unknown) => void): ExtensionContext {
  return {
    hasUI: true,
    mode: "tui",
    cwd: "/tmp",
    model: { id: "test-model", contextWindow: 200000 },
    modelRegistry: { isUsingOAuth: () => false },
    sessionManager: {
      getEntries: () => [],
    },
    getContextUsage: () => ({ percent: 12, contextWindow: 200000 }),
    ui: {
      theme,
      setEditorComponent,
      setWorkingIndicator() {},
      setWorkingMessage() {},
      setWorkingVisible() {},
      setFooter() {},
    },
  } as unknown as ExtensionContext;
}

test("maps Ctrl+O to rpiv ask_user_question's collapse toggle only while the tool is active", () => {
  const { pi, handlers } = createPiStub();
  const theme = createThemeStub();
  let editorFactory: ((tui: never, theme: never, keybindings: never) => unknown) | undefined;
  let inputListener: InputListener | undefined;
  const forwarded: string[] = [];

  const tui = {
    focusedComponent: {
      handleInput(data: string) {
        forwarded.push(data);
      },
    },
    requestRender() {},
    addInputListener(listener: InputListener) {
      inputListener = listener;
      return () => {
        if (inputListener === listener) inputListener = undefined;
      };
    },
  };

  ampEditorExtension(pi);

  handlers.get("session_start")?.(
    { type: "session_start", reason: "startup" },
    createContext(theme, (factory) => {
      editorFactory = factory;
    }),
  );

  expect(editorFactory).toBeDefined();
  editorFactory?.(tui as never, theme as never, { matches: () => false } as never);
  expect(inputListener).toBeDefined();

  // Ctrl+O remains untouched in normal editing and for unrelated tool overlays.
  expect(inputListener?.("\x0f")).toBeUndefined();
  handlers.get("tool_execution_start")?.(
    { type: "tool_execution_start", toolCallId: "read-1", toolName: "read", args: {} },
    createContext(theme, () => {}),
  );
  expect(inputListener?.("\x0f")).toBeUndefined();

  handlers.get("tool_execution_start")?.(
    { type: "tool_execution_start", toolCallId: "question-1", toolName: "ask_user_question", args: {} },
    createContext(theme, () => {}),
  );
  expect(inputListener?.("\x0f")).toEqual({ consume: true });
  expect(forwarded).toEqual(["\x1d"]);

  handlers.get("tool_execution_end")?.(
    { type: "tool_execution_end", toolCallId: "question-1", toolName: "ask_user_question", result: {}, isError: false },
    createContext(theme, () => {}),
  );
  expect(inputListener?.("\x0f")).toBeUndefined();
});

test("ignores key release events so Ctrl+O does not immediately expand again", () => {
  const { pi, handlers } = createPiStub();
  const theme = createThemeStub();
  let editorFactory: ((tui: never, theme: never, keybindings: never) => unknown) | undefined;
  let inputListener: InputListener | undefined;
  const forwarded: string[] = [];

  const tui = {
    focusedComponent: { handleInput: (data: string) => forwarded.push(data) },
    requestRender() {},
    addInputListener(listener: InputListener) {
      inputListener = listener;
      return () => {};
    },
  };

  ampEditorExtension(pi);
  handlers.get("session_start")?.(
    { type: "session_start", reason: "startup" },
    createContext(theme, (factory) => {
      editorFactory = factory;
    }),
  );
  editorFactory?.(tui as never, theme as never, { matches: () => false } as never);
  handlers.get("tool_execution_start")?.(
    { type: "tool_execution_start", toolCallId: "question-1", toolName: "ask_user_question", args: {} },
    createContext(theme, () => {}),
  );

  expect(inputListener?.("\x1b[111;5:3u")).toBeUndefined();
  expect(forwarded).toEqual([]);
});

test("removes the ask_user_question input alias listener on session shutdown", () => {
  const { pi, handlers } = createPiStub();
  const theme = createThemeStub();
  let editorFactory: ((tui: never, theme: never, keybindings: never) => unknown) | undefined;
  let removed = false;

  const tui = {
    requestRender() {},
    addInputListener() {
      return () => {
        removed = true;
      };
    },
  };

  ampEditorExtension(pi);
  handlers.get("session_start")?.(
    { type: "session_start", reason: "startup" },
    createContext(theme, (factory) => {
      editorFactory = factory;
    }),
  );

  editorFactory?.(tui as never, theme as never, { matches: () => false } as never);
  handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, createContext(theme, () => {}));

  expect(removed).toBe(true);
});
