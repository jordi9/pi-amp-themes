import assert from "node:assert/strict";
import test from "node:test";

import { UserMessageComponent, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";

import ampEditorExtension from "./amp-editor.js";
import ampUserMessageExtension from "./amp-user-message.js";

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;

type ThemeStub = {
  borderColor(text: string): string;
  fg(color: string, text: string): string;
  italic?(text: string): string;
};

function createPiStub(getThinkingLevel: () => string) {
  const handlers = new Map<string, EventHandler>();
  const pi = {
    on(event: string, handler: EventHandler) {
      handlers.set(event, handler);
    },
    getThinkingLevel,
  } as unknown as ExtensionAPI;

  return { pi, handlers };
}

function createThemeStub(): ThemeStub {
  return {
    borderColor(text: string) {
      return text;
    },
    fg(_color: string, text: string) {
      return text;
    },
    italic(text: string) {
      return text;
    },
  };
}

function createSessionManager(thinkingLevel = "medium") {
  const entries = [
    {
      type: "thinking_level_change",
      id: "thinking-1",
      parentId: null,
      timestamp: new Date().toISOString(),
      thinkingLevel,
    },
  ];

  return {
    getEntries() {
      return entries;
    },
    getLeafId() {
      return "thinking-1";
    },
    getSessionName() {
      return undefined;
    },
  };
}

function createSessionManagerWithoutThinking() {
  return {
    getEntries() {
      return [];
    },
    getLeafId() {
      return undefined;
    },
    getSessionName() {
      return undefined;
    },
  };
}

function resetUserMessagePatch(): void {
  const prototype = UserMessageComponent.prototype as unknown as {
    render: UserMessageComponent["render"];
    __ampUserMessageOriginalRender?: UserMessageComponent["render"];
    __ampUserMessagePatched?: boolean;
  };

  if (prototype.__ampUserMessageOriginalRender) {
    prototype.render = prototype.__ampUserMessageOriginalRender;
  }

  delete prototype.__ampUserMessageOriginalRender;
  delete prototype.__ampUserMessagePatched;
}

test("amp user message render stays safe after session manager becomes stale", () => {
  resetUserMessagePatch();

  let stale = false;
  const sessionManager = createSessionManager();
  const staleAwareSessionManager = {
    ...sessionManager,
    getEntries() {
      if (stale) throw new Error("stale session manager");
      return sessionManager.getEntries();
    },
    getLeafId() {
      if (stale) throw new Error("stale session manager");
      return sessionManager.getLeafId();
    },
  };

  const { pi, handlers } = createPiStub(() => "medium");

  ampUserMessageExtension(pi);

  const sessionStart = handlers.get("session_start");
  assert.ok(sessionStart, "session_start handler should be registered");

  sessionStart(
    { type: "session_start", reason: "startup" },
    {
      hasUI: true,
      sessionManager: staleAwareSessionManager,
      ui: { theme: createThemeStub() },
    } as unknown as ExtensionContext,
  );

  const message = new UserMessageComponent("hello from amp");
  assert.doesNotThrow(() => message.render(48));

  stale = true;
  assert.doesNotThrow(() => message.render(48));

  resetUserMessagePatch();
});

test("amp editor working message waits until assistant update before streaming", () => {
  const { pi, handlers } = createPiStub(() => "medium");
  const workingMessages: Array<string | undefined> = [];

  ampEditorExtension(pi);

  const sessionStart = handlers.get("session_start");
  assert.ok(sessionStart, "session_start handler should be registered");

  const ctx = {
    hasUI: true,
    cwd: process.cwd(),
    model: {
      id: "claude-sonnet-4-20250514",
      contextWindow: 200000,
      reasoning: true,
    },
    modelRegistry: { isUsingOAuth: () => false },
    sessionManager: createSessionManager(),
    getContextUsage: () => ({ percent: 12, contextWindow: 200000 }),
    ui: {
      theme: createThemeStub(),
      setEditorComponent() {},
      setWorkingIndicator() {},
      setWorkingMessage(message?: string) {
        workingMessages.push(message);
      },
      setFooter() {},
    },
  } as unknown as ExtensionContext;

  sessionStart({ type: "session_start", reason: "startup" }, ctx);

  const beforeAgentStart = handlers.get("before_agent_start");
  assert.ok(beforeAgentStart, "before_agent_start handler should be registered");
  beforeAgentStart({ type: "before_agent_start" }, ctx);
  assert.equal(workingMessages.at(-1), "Waiting for response...");

  const messageStart = handlers.get("message_start");
  messageStart?.({ type: "message_start", message: { role: "assistant", content: [] } }, ctx);
  assert.equal(workingMessages.at(-1), "Waiting for response...");

  const messageUpdate = handlers.get("message_update");
  assert.ok(messageUpdate, "message_update handler should be registered");
  messageUpdate(
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta" },
      message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
    },
    ctx,
  );
  assert.equal(workingMessages.at(-1), "Streaming response...");
});

test("amp editor shows running tools while tool execution is active", () => {
  const { pi, handlers } = createPiStub(() => "medium");
  const workingMessages: Array<string | undefined> = [];

  ampEditorExtension(pi);

  const toolExecutionStart = handlers.get("tool_execution_start");
  assert.ok(toolExecutionStart, "tool_execution_start handler should be registered");

  toolExecutionStart(
    { type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: {} },
    {
      hasUI: true,
      ui: {
        setWorkingMessage(message?: string) {
          workingMessages.push(message);
        },
      },
    } as unknown as ExtensionContext,
  );

  assert.equal(workingMessages.at(-1), "Running tools...");
});

test("amp editor uses runtime thinking level after resume when session has no thinking entry", () => {
  const { pi, handlers } = createPiStub(() => "high");

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[] })
    | undefined;

  const sessionStart = handlers.get("session_start");
  assert.ok(sessionStart, "session_start handler should be registered");

  sessionStart(
    { type: "session_start", reason: "resume" },
    {
      hasUI: true,
      cwd: process.cwd(),
      model: {
        id: "claude-sonnet-4-20250514",
        contextWindow: 200000,
        reasoning: true,
      },
      modelRegistry: { isUsingOAuth: () => false },
      sessionManager: createSessionManagerWithoutThinking(),
      getContextUsage: () => ({ percent: 12, contextWindow: 200000 }),
      ui: {
        theme: createThemeStub(),
        setEditorComponent(factory: typeof editorFactory) {
          editorFactory = factory;
        },
        setWorkingIndicator() {},
        setWorkingMessage() {},
        setFooter() {},
      },
    } as unknown as ExtensionContext,
  );

  assert.ok(editorFactory, "editor factory should be registered");

  const editor = editorFactory(
    { requestRender() {}, terminal: { rows: 24 } },
    createThemeStub(),
    { matches: () => false },
  );

  assert.match(editor.render(80).join("\n"), / high /);
});

test("amp user message uses runtime thinking level after resume when session has no thinking entry", () => {
  resetUserMessagePatch();

  const { pi, handlers } = createPiStub(() => "high");

  ampUserMessageExtension(pi);

  const sessionStart = handlers.get("session_start");
  assert.ok(sessionStart, "session_start handler should be registered");

  sessionStart(
    { type: "session_start", reason: "resume" },
    {
      hasUI: true,
      sessionManager: createSessionManagerWithoutThinking(),
      ui: {
        theme: {
          fg(color: string, text: string) {
            return `[${color}]${text}`;
          },
          italic(text: string) {
            return text;
          },
        },
      },
    } as unknown as ExtensionContext,
  );

  const message = new UserMessageComponent("hello from amp");
  assert.match(message.render(48).join("\n"), /\[thinkingHigh\]▌/);

  resetUserMessagePatch();
});

test("amp editor render stays safe after pi runtime becomes stale", () => {
  let stale = false;
  const { pi, handlers } = createPiStub(() => {
    if (stale) throw new Error("stale runtime");
    return "medium";
  });

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[] })
    | undefined;

  const theme = createThemeStub();
  const sessionStart = handlers.get("session_start");
  assert.ok(sessionStart, "session_start handler should be registered");

  sessionStart(
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
      sessionManager: createSessionManager(),
      getContextUsage: () => ({ percent: 12, contextWindow: 200000 }),
      ui: {
        theme,
        setEditorComponent(factory: typeof editorFactory) {
          editorFactory = factory;
        },
        setWorkingIndicator() {},
        setWorkingMessage() {},
        setFooter() {},
      },
    } as unknown as ExtensionContext,
  );

  assert.ok(editorFactory, "editor factory should be registered");

  const editor = editorFactory(
    { requestRender() {}, terminal: { rows: 24 } },
    theme,
    { matches: () => false },
  );

  assert.doesNotThrow(() => editor.render(80));

  stale = true;
  assert.doesNotThrow(() => editor.render(80));
});
