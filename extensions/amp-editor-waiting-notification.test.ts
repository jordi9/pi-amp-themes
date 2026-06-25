import { expect, test } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import ampEditorExtension, { AMP_WAITING_NOTIFICATION_EVENT, type AmpWaitingNotificationEvent } from "./amp-editor.js";

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;

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
  const emitted: Array<{ channel: string; data: unknown }> = [];
  const pi = {
    events: {
      emit(channel: string, data: unknown) {
        emitted.push({ channel, data });
      },
      on() {
        return () => {};
      },
    },
    on(event: string, handler: EventHandler) {
      handlers.set(event, handler);
    },
    getCommands: () => [],
    getThinkingLevel: () => "medium",
    registerCommand() {},
    registerShortcut() {},
  } as unknown as ExtensionAPI;

  return { pi, handlers, emitted };
}

function createContext(theme: ThemeStub, setEditorComponent: (factory: (tui: never, theme: never, keybindings: never) => unknown) => void): ExtensionContext {
  return {
    hasUI: true,
    mode: "tui",
    cwd: process.cwd(),
    model: { id: "test-model", contextWindow: 200000 },
    modelRegistry: { isUsingOAuth: () => false },
    sessionManager: {
      getEntries: () => [],
    },
    getContextUsage: () => ({ percent: 12, contextWindow: 200000 }),
    ui: {
      theme,
      setEditorComponent,
      setWorkingMessage() {},
      setWorkingVisible() {},
      setFooter() {},
      getToolsExpanded: () => false,
    },
  } as unknown as ExtensionContext;
}

function getHandler(handlers: Map<string, EventHandler>, name: string): EventHandler {
  const handler = handlers.get(name);
  expect(handler, `${name} handler should be registered`).toBeDefined();
  return handler!;
}

function startSessionWithEditor() {
  const { pi, handlers, emitted } = createPiStub();
  const theme = createThemeStub();
  let editorFactory: ((tui: never, theme: never, keybindings: never) => unknown) | undefined;
  const ctx = createContext(theme, (factory) => {
    editorFactory = factory;
  });
  const tui = { requestRender() {} };

  ampEditorExtension(pi);
  getHandler(handlers, "session_start")({ type: "session_start", reason: "startup" }, ctx);
  expect(editorFactory).toBeDefined();
  const editor = editorFactory!(tui as never, theme as never, { matches: () => false } as never) as { handleInput(data: string): void };

  return { handlers, emitted, ctx, editor };
}

test("emits waiting notification events when the idle notification starts and focus clears it", () => {
  const { handlers, emitted, ctx, editor } = startSessionWithEditor();

  editor.handleInput("\x1b[O");
  getHandler(handlers, "agent_end")({ type: "agent_end", messages: [] }, ctx);

  expect(emitted).toHaveLength(1);
  expect(emitted[0]?.channel).toBe(AMP_WAITING_NOTIFICATION_EVENT);
  expect(emitted[0]?.data).toMatchObject<Partial<AmpWaitingNotificationEvent>>({
    active: true,
    terminalFocusActive: false,
  });
  expect((emitted[0]?.data as AmpWaitingNotificationEvent).startedAt).toEqual(expect.any(Number));

  editor.handleInput("\x1b[I");

  expect(emitted).toHaveLength(2);
  expect(emitted[1]).toEqual({
    channel: AMP_WAITING_NOTIFICATION_EVENT,
    data: { active: false, terminalFocusActive: true },
  });

  getHandler(handlers, "session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
});

test("emits an inactive waiting notification event when the next agent turn clears it", () => {
  const { handlers, emitted, ctx, editor } = startSessionWithEditor();

  editor.handleInput("\x1b[O");
  getHandler(handlers, "agent_end")({ type: "agent_end", messages: [] }, ctx);
  getHandler(handlers, "before_agent_start")({ type: "before_agent_start" }, ctx);

  expect(emitted.map((event) => event.channel)).toEqual([
    AMP_WAITING_NOTIFICATION_EVENT,
    AMP_WAITING_NOTIFICATION_EVENT,
  ]);
  expect(emitted[1]?.data).toEqual({ active: false, terminalFocusActive: false });

  getHandler(handlers, "session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
});
