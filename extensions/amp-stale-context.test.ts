import { expect, test, vi } from "vitest";

import { UserMessageComponent, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import ampEditorExtension from "./amp-editor.js";
import ampUserMessageExtension from "./amp-user-message.js";

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;

type ThemeStub = {
  borderColor(text: string): string;
  fg(color: string, text: string): string;
  italic?(text: string): string;
};

function expectDefined<T>(value: T | undefined, message: string): T {
  expect(value, message).toBeDefined();
  return value as T;
}

function createPiStub(getThinkingLevel: () => string) {
  const handlers = new Map<string, EventHandler>();
  const pi = {
    on(event: string, handler: EventHandler) {
      handlers.set(event, handler);
    },
    getCommands: () => [],
    getThinkingLevel,
    registerCommand() {},
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

function createTaggedThemeStub(): ThemeStub {
  return {
    borderColor(text: string) {
      return text;
    },
    fg(color: string, text: string) {
      return `[${color}]${text}`;
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

function createSessionManagerWithCost(cost: number) {
  const entries = [
    {
      type: "message",
      id: "assistant-1",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: {
        role: "assistant",
        content: [],
        usage: { cost: { total: cost } },
      },
    },
  ];

  return {
    getEntries() {
      return entries;
    },
    getLeafId() {
      return "assistant-1";
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
    __ampUserMessageRender?: UserMessageComponent["render"];
    __ampUserMessagePatched?: boolean;
    __ampUserMessagePatchOwner?: object;
    __ampUserMessageGetTheme?: () => unknown;
    __ampUserMessageGetThinkingLevel?: () => string;
  };

  if (prototype.__ampUserMessageOriginalRender) {
    prototype.render = prototype.__ampUserMessageOriginalRender;
  }

  delete prototype.__ampUserMessageOriginalRender;
  delete prototype.__ampUserMessageRender;
  delete prototype.__ampUserMessagePatched;
  delete prototype.__ampUserMessagePatchOwner;
  delete prototype.__ampUserMessageGetTheme;
  delete prototype.__ampUserMessageGetThinkingLevel;
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

  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");

  sessionStart(
    { type: "session_start", reason: "startup" },
    {
      hasUI: true,
      sessionManager: staleAwareSessionManager,
      ui: { theme: createThemeStub() },
    } as unknown as ExtensionContext,
  );

  const message = new UserMessageComponent("hello from amp");
  expect(() => message.render(48)).not.toThrow();

  stale = true;
  expect(() => message.render(48)).not.toThrow();

  resetUserMessagePatch();
});

test("amp editor working message waits until assistant update before streaming", () => {
  const { pi, handlers } = createPiStub(() => "medium");
  const workingMessages: Array<string | undefined> = [];

  ampEditorExtension(pi);

  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");

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
  expect(workingMessages).toEqual([]);

  const beforeAgentStart = expectDefined(handlers.get("before_agent_start"), "before_agent_start handler should be registered");
  beforeAgentStart({ type: "before_agent_start" }, ctx);
  expect(workingMessages.at(-1)).toBe("Waiting");

  const messageStart = handlers.get("message_start");
  messageStart?.({ type: "message_start", message: { role: "assistant", content: [] } }, ctx);
  expect(workingMessages.at(-1)).toBe("Waiting");

  const messageUpdate = expectDefined(handlers.get("message_update"), "message_update handler should be registered");
  messageUpdate(
    {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta" },
      message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] },
    },
    ctx,
  );
  expect(workingMessages.at(-1)).toBe("Thinking");

  messageUpdate(
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta" },
      message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
    },
    ctx,
  );
  expect(workingMessages.at(-1)).toBe("Streaming");
});

test("amp editor shows running tools while tool execution is active", () => {
  const { pi, handlers } = createPiStub(() => "medium");
  const workingMessages: Array<string | undefined> = [];

  ampEditorExtension(pi);

  const toolExecutionStart = expectDefined(handlers.get("tool_execution_start"), "tool_execution_start handler should be registered");

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

  expect(workingMessages.at(-1)).toBe("Using tools");
});

test("amp editor hides Pi's built-in working row during agent start", () => {
  const { pi, handlers } = createPiStub(() => "medium");
  const visibility: boolean[] = [];
  const ctx = {
    hasUI: true,
    cwd: "/tmp",
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
      setWorkingMessage() {},
      setWorkingVisible(visible: boolean) {
        visibility.push(visible);
      },
      setFooter() {},
    },
  } as unknown as ExtensionContext;

  ampEditorExtension(pi);

  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");
  const beforeAgentStart = expectDefined(handlers.get("before_agent_start"), "before_agent_start handler should be registered");
  const agentStart = expectDefined(handlers.get("agent_start"), "agent_start handler should be registered");

  sessionStart({ type: "session_start", reason: "startup" }, ctx);
  beforeAgentStart({ type: "before_agent_start" }, ctx);
  agentStart({ type: "agent_start" }, ctx);

  expect(visibility).toEqual([false, false, false]);
});

test("amp editor keeps working message ordered while tools are active", () => {
  const { pi, handlers } = createPiStub(() => "medium");
  const workingMessages: Array<string | undefined> = [];
  const ctx = {
    hasUI: true,
    ui: {
      setWorkingMessage(message?: string) {
        workingMessages.push(message);
      },
    },
  } as unknown as ExtensionContext;

  ampEditorExtension(pi);

  const messageUpdate = expectDefined(handlers.get("message_update"), "message_update handler should be registered");
  const toolExecutionStart = expectDefined(handlers.get("tool_execution_start"), "tool_execution_start handler should be registered");
  const toolExecutionEnd = expectDefined(handlers.get("tool_execution_end"), "tool_execution_end handler should be registered");

  messageUpdate({ type: "message_update", assistantMessageEvent: { type: "thinking_delta" }, message: { role: "assistant", content: [] } }, ctx);
  expect(workingMessages).toEqual(["Thinking"]);

  toolExecutionStart({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: {} }, ctx);
  expect(workingMessages).toEqual(["Thinking", "Using tools"]);

  messageUpdate({ type: "message_update", assistantMessageEvent: { type: "text_delta" }, message: { role: "assistant", content: [] } }, ctx);
  expect(workingMessages).toEqual(["Thinking", "Using tools"]);

  toolExecutionEnd({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", result: {}, isError: false }, ctx);
  expect(workingMessages).toEqual(["Thinking", "Using tools", "Waiting"]);

  const agentEnd = expectDefined(handlers.get("agent_end"), "agent_end handler should be registered");
  agentEnd({ type: "agent_end", messages: [] }, ctx);
  expect(workingMessages).toEqual(["Thinking", "Using tools", "Waiting"]);
});

test("amp editor renders working status with an Esc cancel hint", () => {
  const { pi, handlers } = createPiStub(() => "medium");

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[] })
    | undefined;

  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");
  const ctx = {
    hasUI: true,
    cwd: "/tmp",
    model: {
      id: "claude-sonnet-4-20250514",
      contextWindow: 200000,
      reasoning: true,
    },
    modelRegistry: { isUsingOAuth: () => false },
    sessionManager: createSessionManager(),
    getContextUsage: () => ({ percent: 12, contextWindow: 200000 }),
    ui: {
      theme: createTaggedThemeStub(),
      setEditorComponent(factory: typeof editorFactory) {
        editorFactory = factory;
      },
      setWorkingIndicator() {},
      setWorkingMessage() {},
      setWorkingVisible() {},
      setFooter() {},
    },
  } as unknown as ExtensionContext;

  sessionStart({ type: "session_start", reason: "startup" }, ctx);
  const beforeAgentStart = expectDefined(handlers.get("before_agent_start"), "before_agent_start handler should be registered");
  beforeAgentStart({ type: "before_agent_start" }, ctx);

  const createEditor = expectDefined(editorFactory, "editor factory should be registered");
  const editor = createEditor(
    { requestRender() {}, terminal: { rows: 24 } },
    createTaggedThemeStub(),
    { matches: () => false },
  );

  expect(editor.render(200).join("\n")).toContain("[accent]Esc[muted] to cancel");
});

test("amp editor makes global output expansion visible", () => {
  const { pi, handlers } = createPiStub(() => "medium");

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[] })
    | undefined;

  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");
  sessionStart(
    { type: "session_start", reason: "startup" },
    {
      hasUI: true,
      cwd: "/tmp",
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
        getToolsExpanded: () => true,
        setEditorComponent(factory: typeof editorFactory) {
          editorFactory = factory;
        },
        setWorkingIndicator() {},
        setWorkingMessage() {},
        setFooter() {},
      },
    } as unknown as ExtensionContext,
  );

  const createEditor = expectDefined(editorFactory, "editor factory should be registered");
  const editor = createEditor(
    { requestRender() {}, terminal: { rows: 24 } },
    createThemeStub(),
    { matches: () => false },
  );

  expect(editor.render(200).join("\n")).toContain("output expanded · Ctrl+O to collapse");
});

test("amp editor renders prompt elapsed time after the Esc cancel hint", () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
  const { pi, handlers } = createPiStub(() => "medium");

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[] })
    | undefined;

  const ctx = {
    hasUI: true,
    cwd: "/tmp",
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
      setEditorComponent(factory: typeof editorFactory) {
        editorFactory = factory;
      },
      setWorkingIndicator() {},
      setWorkingMessage() {},
      setWorkingVisible() {},
      setFooter() {},
    },
  } as unknown as ExtensionContext;

  try {
    const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");
    sessionStart({ type: "session_start", reason: "startup" }, ctx);

    const beforeAgentStart = expectDefined(handlers.get("before_agent_start"), "before_agent_start handler should be registered");
    beforeAgentStart({ type: "before_agent_start" }, ctx);
    now.mockReturnValue(66_000);

    const createEditor = expectDefined(editorFactory, "editor factory should be registered");
    const editor = createEditor(
      { requestRender() {}, terminal: { rows: 24 } },
      createThemeStub(),
      { matches: () => false },
    );

    expect(editor.render(200).join("\n")).toContain("Esc to cancel · 1m 5s");
  } finally {
    handlers.get("agent_end")?.({ type: "agent_end", messages: [] }, ctx);
    handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);
    now.mockRestore();
  }
});

test("amp editor keeps finished elapsed time visible briefly after agent end", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const { pi, handlers } = createPiStub(() => "medium");

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[] })
    | undefined;

  const ctx = {
    hasUI: true,
    cwd: "/tmp",
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
      setEditorComponent(factory: typeof editorFactory) {
        editorFactory = factory;
      },
      setWorkingIndicator() {},
      setWorkingMessage() {},
      setWorkingVisible() {},
      setFooter() {},
    },
  } as unknown as ExtensionContext;

  try {
    const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");
    sessionStart({ type: "session_start", reason: "startup" }, ctx);

    const beforeAgentStart = expectDefined(handlers.get("before_agent_start"), "before_agent_start handler should be registered");
    beforeAgentStart({ type: "before_agent_start" }, ctx);

    const createEditor = expectDefined(editorFactory, "editor factory should be registered");
    const editor = createEditor(
      { requestRender() {}, terminal: { rows: 24 } },
      createThemeStub(),
      { matches: () => false },
    );

    vi.setSystemTime(66_000);
    const agentEnd = expectDefined(handlers.get("agent_end"), "agent_end handler should be registered");
    agentEnd({ type: "agent_end", messages: [] }, ctx);

    expect(editor.render(200).join("\n")).toContain("✓ Finished · 1m 5s");

    vi.advanceTimersByTime(6_999);
    expect(editor.render(200).join("\n")).toContain("✓ Finished · 1m 5s");

    vi.advanceTimersByTime(1);
    expect(editor.render(200).join("\n")).not.toContain("Finished");
  } finally {
    handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);
    vi.useRealTimers();
  }
});

test("amp editor only shows the notification icon when the terminal is already unfocused", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const { pi, handlers } = createPiStub(() => "medium");

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[]; handleInput(data: string): void })
    | undefined;

  const ctx = {
    hasUI: true,
    cwd: "/tmp",
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
      setEditorComponent(factory: typeof editorFactory) {
        editorFactory = factory;
      },
      setWorkingIndicator() {},
      setWorkingMessage() {},
      setWorkingVisible() {},
      setFooter() {},
    },
  } as unknown as ExtensionContext;

  try {
    const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");
    sessionStart({ type: "session_start", reason: "startup" }, ctx);

    const beforeAgentStart = expectDefined(handlers.get("before_agent_start"), "before_agent_start handler should be registered");
    const agentEnd = expectDefined(handlers.get("agent_end"), "agent_end handler should be registered");

    const createEditor = expectDefined(editorFactory, "editor factory should be registered");
    const editor = createEditor(
      { requestRender() {}, terminal: { rows: 24 } },
      createThemeStub(),
      { matches: () => false },
    );
    (editor as unknown as { focused: boolean }).focused = true;

    beforeAgentStart({ type: "before_agent_start" }, ctx);
    vi.setSystemTime(66_000);
    agentEnd({ type: "agent_end", messages: [] }, ctx);

    expect(editor.render(200).join("\n")).not.toContain(" 12% of 200k");

    vi.setSystemTime(70_000);
    beforeAgentStart({ type: "before_agent_start" }, ctx);
    editor.handleInput("\x1b[O");
    vi.setSystemTime(75_000);
    agentEnd({ type: "agent_end", messages: [] }, ctx);

    const waitingRender = editor.render(200);
    expect(waitingRender[0]).toContain(" 12% of 200k");
    expect(waitingRender[0]).not.toContain("Agent is ready");
    expect(waitingRender[0]).not.toContain("Enter");

    editor.handleInput("\x1b[I");
    expect(editor.render(200).join("\n")).not.toContain(" 12% of 200k");

    vi.setSystemTime(80_000);
    beforeAgentStart({ type: "before_agent_start" }, ctx);
    editor.handleInput("\x1b[O");
    vi.setSystemTime(85_000);
    agentEnd({ type: "agent_end", messages: [] }, ctx);
    editor.handleInput("a");

    expect(editor.render(200).join("\n")).not.toContain(" 12% of 200k");
  } finally {
    handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);
    vi.useRealTimers();
  }
});

test("amp editor flashes the editor chrome while waiting for input after focus leaves", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const { pi, handlers } = createPiStub(() => "medium");

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[]; handleInput(data: string): void })
    | undefined;

  const ctx = {
    hasUI: true,
    cwd: "/tmp",
    model: {
      id: "claude-sonnet-4-20250514",
      contextWindow: 200000,
      reasoning: true,
    },
    modelRegistry: { isUsingOAuth: () => false },
    sessionManager: createSessionManager(),
    getContextUsage: () => ({ percent: 12, contextWindow: 200000 }),
    ui: {
      theme: createTaggedThemeStub(),
      setEditorComponent(factory: typeof editorFactory) {
        editorFactory = factory;
      },
      setWorkingIndicator() {},
      setWorkingMessage() {},
      setWorkingVisible() {},
      setFooter() {},
    },
  } as unknown as ExtensionContext;

  try {
    const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");
    sessionStart({ type: "session_start", reason: "startup" }, ctx);

    const beforeAgentStart = expectDefined(handlers.get("before_agent_start"), "before_agent_start handler should be registered");
    beforeAgentStart({ type: "before_agent_start" }, ctx);

    const createEditor = expectDefined(editorFactory, "editor factory should be registered");
    const editor = createEditor(
      { requestRender() {}, terminal: { rows: 24 } },
      createTaggedThemeStub(),
      { matches: () => false },
    );

    editor.handleInput("\x1b[O");
    vi.setSystemTime(66_000);
    const agentEnd = expectDefined(handlers.get("agent_end"), "agent_end handler should be registered");
    agentEnd({ type: "agent_end", messages: [] }, ctx);

    expect(editor.render(200)[0]).toContain("[warning]╭");
  } finally {
    handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);
    vi.useRealTimers();
  }
});

test("amp editor renders cancelled elapsed time after aborted agent end", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const { pi, handlers } = createPiStub(() => "medium");

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[] })
    | undefined;

  const ctx = {
    hasUI: true,
    cwd: "/tmp",
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
      setEditorComponent(factory: typeof editorFactory) {
        editorFactory = factory;
      },
      setWorkingIndicator() {},
      setWorkingMessage() {},
      setWorkingVisible() {},
      setFooter() {},
    },
  } as unknown as ExtensionContext;

  try {
    const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");
    sessionStart({ type: "session_start", reason: "startup" }, ctx);

    const beforeAgentStart = expectDefined(handlers.get("before_agent_start"), "before_agent_start handler should be registered");
    beforeAgentStart({ type: "before_agent_start" }, ctx);

    const createEditor = expectDefined(editorFactory, "editor factory should be registered");
    const editor = createEditor(
      { requestRender() {}, terminal: { rows: 24 } },
      createThemeStub(),
      { matches: () => false },
    );

    vi.setSystemTime(66_000);
    const agentEnd = expectDefined(handlers.get("agent_end"), "agent_end handler should be registered");
    agentEnd({
      type: "agent_end",
      messages: [{ role: "assistant", stopReason: "aborted" }],
    }, ctx);

    const rendered = editor.render(200).join("\n");
    expect(rendered).toContain("Cancelled · 1m 5s");
    expect(rendered).not.toContain("Finished");
    expect(rendered).not.toContain(" 12% of 200k");
  } finally {
    handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);
    vi.useRealTimers();
  }
});

test("amp editor applies the theme text color to typed input", () => {
  const { pi, handlers } = createPiStub(() => "medium");

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[]; setText(text: string): void })
    | undefined;

  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");
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
        theme: createTaggedThemeStub(),
        setEditorComponent(factory: typeof editorFactory) {
          editorFactory = factory;
        },
        setWorkingIndicator() {},
        setWorkingMessage() {},
        setFooter() {},
      },
    } as unknown as ExtensionContext,
  );

  const createEditor = expectDefined(editorFactory, "editor factory should be registered");
  const editor = createEditor(
    { requestRender() {}, terminal: { rows: 24 } },
    createTaggedThemeStub(),
    { matches: () => false },
  );
  editor.setText("why does this keep failing?");

  expect(editor.render(100).join("\n")).toContain("│ [text]why does this keep failing?");
});

test("amp editor uses latest context and cost after reload", () => {
  const { pi, handlers } = createPiStub(() => "high");

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[] })
    | undefined;

  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");

  const createCtx = (percent: number, cost: number) => ({
    hasUI: true,
    cwd: process.cwd(),
    model: {
      id: "claude-sonnet-4-20250514",
      contextWindow: 272000,
      reasoning: true,
    },
    modelRegistry: { isUsingOAuth: () => false },
    sessionManager: createSessionManagerWithCost(cost),
    getContextUsage: () => ({ percent, contextWindow: 272000 }),
    ui: {
      theme: createThemeStub(),
      setEditorComponent(factory: typeof editorFactory) {
        editorFactory = factory;
      },
      setWorkingIndicator() {},
      setWorkingMessage() {},
      setFooter() {},
    },
  }) as unknown as ExtensionContext;

  sessionStart({ type: "session_start", reason: "startup" }, createCtx(12, 1.23));
  const createEditor = expectDefined(editorFactory, "editor factory should be registered");

  const editor = createEditor(
    { requestRender() {}, terminal: { rows: 24 } },
    createThemeStub(),
    { matches: () => false },
  );

  expect(editor.render(100).join("\n")).toMatch(/12% of 272k · \$1\.23/);

  sessionStart({ type: "session_start", reason: "reload" }, createCtx(72, 16.37));

  expect(editor.render(100).join("\n")).toMatch(/72% of 272k · dumber · \$16\.37/);
});

test("amp editor labels high context usage as progressively dumber", () => {
  const { pi, handlers } = createPiStub(() => "medium");
  let percent = 50;

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[] })
    | undefined;

  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");

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
      getContextUsage: () => ({ percent, contextWindow: 200000 }),
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

  const createEditor = expectDefined(editorFactory, "editor factory should be registered");
  const editor = createEditor(
    { requestRender() {}, terminal: { rows: 24 } },
    createThemeStub(),
    { matches: () => false },
  );
  const render = () => editor.render(120).join("\n");

  expect(render()).toContain("50% of 200k");
  expect(render()).not.toContain("dumb");

  percent = 51;
  expect(render()).toContain("51% of 200k · dumb");
  expect(render()).not.toContain("dumber");
  expect(render()).not.toContain("dumbest");

  percent = 71;
  expect(render()).toContain("71% of 200k · dumber");
  expect(render()).not.toContain("dumbest");

  percent = 86;
  expect(render()).toContain("86% of 200k · dumbest");
});

test("amp editor colors high context labels by severity", () => {
  const { pi, handlers } = createPiStub(() => "medium");
  let percent = 51;

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[] })
    | undefined;

  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");

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
      getContextUsage: () => ({ percent, contextWindow: 200000 }),
      ui: {
        theme: createTaggedThemeStub(),
        setEditorComponent(factory: typeof editorFactory) {
          editorFactory = factory;
        },
        setWorkingIndicator() {},
        setWorkingMessage() {},
        setFooter() {},
      },
    } as unknown as ExtensionContext,
  );

  const createEditor = expectDefined(editorFactory, "editor factory should be registered");
  const editor = createEditor(
    { requestRender() {}, terminal: { rows: 24 } },
    createTaggedThemeStub(),
    { matches: () => false },
  );
  const render = () => editor.render(240).join("\n");

  expect(render()).toContain("[mdHeading]dumb");

  percent = 71;
  expect(render()).toContain("[warning]dumber");

  percent = 86;
  expect(render()).toContain("[error]dumbest");
});

test("amp editor border always uses the thinkingLow color", () => {
  const { pi, handlers } = createPiStub(() => "medium");

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[]; borderColor?: (text: string) => string })
    | undefined;

  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");

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
        theme: createTaggedThemeStub(),
        setEditorComponent(factory: typeof editorFactory) {
          editorFactory = factory;
        },
        setWorkingIndicator() {},
        setWorkingMessage() {},
        setFooter() {},
      },
    } as unknown as ExtensionContext,
  );

  const createEditor = expectDefined(editorFactory, "editor factory should be registered");
  const editor = createEditor(
    { requestRender() {}, terminal: { rows: 24 } },
    createTaggedThemeStub(),
    { matches: () => false },
  );

  editor.borderColor = (text: string) => `[border]${text}`;

  expect(editor.render(80).join("\n")).toContain("[thinkingLow]╭");
});

test("amp editor uses runtime thinking level after resume when session has no thinking entry", () => {
  const { pi, handlers } = createPiStub(() => "high");

  ampEditorExtension(pi);

  let editorFactory:
    | ((tui: unknown, theme: ThemeStub, keybindings: { matches(): boolean }) => { render(width: number): string[] })
    | undefined;

  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");

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

  const createEditor = expectDefined(editorFactory, "editor factory should be registered");

  const editor = createEditor(
    { requestRender() {}, terminal: { rows: 24 } },
    createThemeStub(),
    { matches: () => false },
  );

  expect(editor.render(80).join("\n")).toMatch(/ high /);
});

test("amp user message follows thinking_level_select changes after session start", () => {
  resetUserMessagePatch();

  let thinkingLevel = "off";
  const { pi, handlers } = createPiStub(() => thinkingLevel);

  ampUserMessageExtension(pi);

  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");

  sessionStart(
    { type: "session_start", reason: "startup" },
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

  thinkingLevel = "medium";
  const thinkingLevelSelect = expectDefined(handlers.get("thinking_level_select"), "thinking_level_select handler should be registered");
  thinkingLevelSelect({ level: "medium", previousLevel: "off" }, {} as ExtensionContext);

  const message = new UserMessageComponent("hello from amp");
  expect(message.render(48).join("\n")).toMatch(/\[thinkingMedium\]▌/);

  resetUserMessagePatch();
});

test("amp user message uses runtime thinking level after resume when session has no thinking entry", () => {
  resetUserMessagePatch();

  const { pi, handlers } = createPiStub(() => "high");

  ampUserMessageExtension(pi);

  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");

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
  expect(message.render(48).join("\n")).toMatch(/\[thinkingHigh\]▌/);

  resetUserMessagePatch();
});

test("amp user message refreshes prototype state after extension reload", () => {
  resetUserMessagePatch();

  let firstThinkingLevel = "low";
  const first = createPiStub(() => firstThinkingLevel);
  ampUserMessageExtension(first.pi);

  const firstSessionStart = expectDefined(first.handlers.get("session_start"), "first session_start handler should be registered");
  firstSessionStart(
    { type: "session_start", reason: "startup" },
    {
      hasUI: true,
      sessionManager: createSessionManagerWithoutThinking(),
      ui: {
        theme: {
          fg(color: string, text: string) {
            return `[first:${color}]${text}`;
          },
          italic(text: string) {
            return text;
          },
        },
      },
    } as unknown as ExtensionContext,
  );

  const beforeReload = new UserMessageComponent("hello from amp");
  expect(beforeReload.render(48).join("\n")).toMatch(/\[first:thinkingLow\]▌/);

  const second = createPiStub(() => "high");
  ampUserMessageExtension(second.pi);

  const secondSessionStart = expectDefined(second.handlers.get("session_start"), "second session_start handler should be registered");
  secondSessionStart(
    { type: "session_start", reason: "reload" },
    {
      hasUI: true,
      sessionManager: createSessionManagerWithoutThinking(),
      ui: {
        theme: {
          fg(color: string, text: string) {
            return `[second:${color}]${text}`;
          },
          italic(text: string) {
            return text;
          },
        },
      },
    } as unknown as ExtensionContext,
  );

  firstThinkingLevel = "minimal";

  const afterReload = new UserMessageComponent("hello from amp");
  const rendered = afterReload.render(48).join("\n");
  expect(rendered).toMatch(/\[second:thinkingHigh\]▌/);
  expect(rendered).not.toMatch(/\[first:thinkingMinimal\]▌/);

  resetUserMessagePatch();
});

test("amp user message reapplies if another patch replaces render after session replacement", () => {
  resetUserMessagePatch();

  const first = createPiStub(() => "low");
  ampUserMessageExtension(first.pi);

  const firstSessionStart = expectDefined(first.handlers.get("session_start"), "first session_start handler should be registered");
  firstSessionStart(
    { type: "session_start", reason: "startup" },
    {
      hasUI: true,
      sessionManager: createSessionManagerWithoutThinking(),
      ui: { theme: createTaggedThemeStub() },
    } as unknown as ExtensionContext,
  );

  const prototype = UserMessageComponent.prototype as unknown as {
    render: UserMessageComponent["render"];
  };
  prototype.render = function renderWithNativeUserBorder(): string[] {
    return ["native user box"];
  };

  const second = createPiStub(() => "high");
  ampUserMessageExtension(second.pi);

  const secondSessionStart = expectDefined(second.handlers.get("session_start"), "second session_start handler should be registered");
  secondSessionStart(
    { type: "session_start", reason: "new" },
    {
      hasUI: true,
      sessionManager: createSessionManagerWithoutThinking(),
      ui: { theme: createTaggedThemeStub() },
    } as unknown as ExtensionContext,
  );

  const message = new UserMessageComponent("hello from amp");
  const rendered = message.render(48).join("\n");

  expect(rendered).toMatch(/\[thinkingHigh\]▌/);
  expect(rendered).not.toContain("native user box");

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
  const sessionStart = expectDefined(handlers.get("session_start"), "session_start handler should be registered");

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

  const createEditor = expectDefined(editorFactory, "editor factory should be registered");

  const editor = createEditor(
    { requestRender() {}, terminal: { rows: 24 } },
    theme,
    { matches: () => false },
  );

  expect(() => editor.render(80)).not.toThrow();

  stale = true;
  expect(() => editor.render(80)).not.toThrow();
});
