import { expect, test } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import ampStartupExtension, { AmpStartupHeader, type StartupSnapshot } from "./amp-startup.js";

type EventHandler = (event: any, ctx: ExtensionContext) => unknown;

type ThemeStub = {
  name?: string;
  fg(_color: string, text: string): string;
  bold(text: string): string;
};

function createThemeStub(): ThemeStub {
  return {
    name: "amp-gruvbox-dark-hard",
    fg(_color: string, text: string) {
      return text;
    },
    bold(text: string) {
      return text;
    },
  };
}

function createSnapshot(overrides: Partial<StartupSnapshot> = {}): StartupSnapshot {
  return {
    cwd: "~/dev/pi-amp-themes",
    project: "pi-amp-themes",
    sessionName: undefined,
    modelId: "claude-sonnet-4-20250514",
    thinkingLevel: "medium",
    themeName: "amp-gruvbox-dark-hard",
    commandCount: 42,
    tools: ["bash", "edit", "read", "write", "grep", "find", "ls", "web_search"],
    activeTools: ["bash", "edit", "read", "write"],
    contextFiles: [],
    contextFilesKnown: false,
    skills: ["git-committer", "librarian", "playwright-browser", "vercel-react-best-practices"],
    prompts: ["/create-goal"],
    extensionCommands: ["/builtin-header"],
    themes: ["amp-dark", "amp-gruvbox-dark-hard", "amp-light"],
    sections: [
      {
        title: "Skills",
        lines: [
          "  user",
          "    ~/.agents/skills/git-committer/SKILL.md",
          "    npm:pi-web-access",
          "      skills/librarian/SKILL.md",
        ],
      },
      {
        title: "Tools",
        lines: [
          "  active",
          "    bash — Execute shell commands",
          "    edit — Replace text in files",
        ],
      },
      { title: "Commands", lines: ["  extension", "    /builtin-header"] },
      { title: "Themes", lines: ["  user", "    ~/dev/pi-amp-themes/themes/amp-dark.json"] },
    ],
    ...overrides,
  };
}

function createPiStub() {
  const handlers = new Map<string, EventHandler>();
  const pi = {
    on(event: string, handler: EventHandler) {
      handlers.set(event, handler);
    },
    getThinkingLevel: () => "medium",
    getCommands: () => [
      { name: "librarian", description: "Research", source: "skill" },
      { name: "create-goal", description: "Create goal", source: "prompt" },
      {
        name: "builtin-header",
        description: "Restore header",
        source: "extension",
        sourceInfo: {
          path: "/tmp/pi-command-package/index.ts",
          source: "npm:pi-command-package",
          scope: "user",
          baseDir: "/tmp/pi-command-package",
        },
      },
    ],
    getAllTools: () => [
      { name: "bash" },
      { name: "edit" },
      { name: "read" },
      { name: "write" },
    ],
    getActiveTools: () => ["bash", "edit", "read", "write"],
  } as unknown as ExtensionAPI;

  return { pi, handlers };
}

function expectLinesWithinWidth(lines: string[], width: number): void {
  for (const line of lines) {
    expect(visibleWidth(line), line).toBeLessThanOrEqual(width);
  }
}

test("amp startup header renders a polished compact factory dashboard", () => {
  const header = new AmpStartupHeader(createThemeStub() as never, () => createSnapshot());
  const lines = header.render(88);
  const text = lines.join("\n");

  expect(lines[0]).toContain("████");
  expect(text).toContain("Importer/Exporter of fine software");
  expect(text).not.toContain("⣿⣿⣿⣿");
  expect(text).not.toContain("context (");
  expect(text).toContain("skills (4): git-committer, librarian");
  expect(text).toContain("playwright-browser");
  expect(text).toContain("vercel-react-best-practices");
  expect(text).toContain("tools (8): bash, edit, read, write, grep, find");
  expect(text).toContain("commands (1): /builtin-header");
  expect(text).not.toContain("themes (");
  expect(text).not.toContain("active: bash, edit, read, write");
  expect(text).not.toContain("ctx:");
  expect(text).not.toContain("AGENTS.md");
  expect(text).toContain("commands (1): /builtin-header");
  expect(text).not.toContain("prompts:");
  expect(text).not.toContain("HERMES LINK ONLINE");
  expectLinesWithinWidth(lines, 88);
});

test("amp startup header stays within narrow terminal widths", () => {
  const header = new AmpStartupHeader(createThemeStub() as never, () => createSnapshot({ modelId: "very-long-model-name-that-needs-to-collapse" }));
  const lines = header.render(32);

  const text = lines.join("\n");

  expect(text).toContain("JORDI9 INDUSTRIES");
  expect(text).not.toContain("HERMES LINK ONLINE");
  expect(text).not.toContain("I HAD POTENTIAL");
  expectLinesWithinWidth(lines, 32);
});

test("amp startup header expands resource sections in place", () => {
  let renderRequests = 0;
  const header = new AmpStartupHeader(createThemeStub() as never, () => createSnapshot({ sessionName: "demo" }), {
    requestRender() {
      renderRequests += 1;
    },
  });

  const collapsed = header.render(88);
  header.setExpanded(true);
  const expanded = header.render(88);

  expect(renderRequests).toBe(1);
  const text = expanded.join("\n");

  expect(text).not.toContain("Startup Controls");
  expect(text).not.toContain("Loaded Resources");
  expect(text).toContain("Ctrl+O collapses");
  expect(text).not.toContain("context (");
  expect(text).toContain("8 tools · 4 skills · 1 command");
  expect(text).toContain("tools (8): bash, edit, read, write, grep, find");
  expect(text).toContain("bash — Execute shell commands");
  expect(text).toContain("skills (4): git-committer, librarian");
  expect(text).toContain("~/.agents/skills/git-committer/SKILL.md");
  expect(text).toContain("npm:pi-web-access");
  expect(text).toContain("skills/librarian/SKILL.md");
  expect(text).toContain("commands (1): /builtin-header");
  expect(text).toContain("themes (3): amp-dark, amp-gruvbox-dark-hard");
  expect(text).toContain("~/dev/pi-amp-themes/themes/amp-dark.json");
  expect(text).toContain("/builtin-header");
  expect(text).not.toContain("prompts (");
  expect(text).not.toContain("/create-goal");
  expect(text).toContain("⣿⣿⣿⣿");
  expectLinesWithinWidth(expanded, 88);
});

test("amp startup extension silences built-in startup output during factory load", async () => {
  const { pi } = createPiStub();

  await ampStartupExtension(pi);

  const settingsManagerUrl = new URL("./core/settings-manager.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href;
  const module = await import(settingsManagerUrl) as {
    SettingsManager?: { prototype?: { getQuietStartup?: () => boolean } };
  };
  const getQuietStartup = module.SettingsManager?.prototype?.getQuietStartup;

  expect(getQuietStartup?.call({ settings: { quietStartup: false } })).toBe(true);
});

test("amp startup extension installs the custom header on session start", async () => {
  const cwd = await mkdtemp("/tmp/pi-amp-themes-");
  await writeFile(join(cwd, "AGENTS.md"), "local instructions");

  try {
    const { pi, handlers } = createPiStub();
    let headerFactory: ((tui: unknown, theme: ThemeStub) => AmpStartupHeader) | undefined;

    await ampStartupExtension(pi);

    const sessionStart = handlers.get("session_start");
    expect(sessionStart).toBeDefined();

    await sessionStart?.(
      { type: "session_start", reason: "startup" },
      {
        hasUI: true,
        cwd,
        model: { id: "claude-sonnet-4-20250514" },
        sessionManager: { getSessionName: () => undefined },
        ui: {
          theme: createThemeStub(),
          setHeader(factory: typeof headerFactory) {
            headerFactory = factory;
          },
          getAllThemes() {
            return [
              {
                name: "dark",
                path: "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json",
              },
              {
                name: "light",
                path: "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/light.json",
              },
              { name: "amp-dark", path: join(cwd, "themes/amp-dark.json") },
              { name: "amp-gruvbox-dark-hard", path: join(cwd, "themes/amp-gruvbox-dark-hard.json") },
            ];
          },
        },
      } as unknown as ExtensionContext,
    );

    expect(headerFactory).toBeDefined();
    const header = headerFactory!({ requestRender() {} }, createThemeStub());
    const rendered = header.render(88).join("\n");

    expect(rendered).toContain("████");
    expect(rendered).toContain("Importer/Exporter of fine software");
    expect(rendered).not.toContain("⣿⣿⣿⣿");
    expect(rendered).not.toContain("context (");
    expect(rendered).toContain("tools (4): bash, edit, read, write");
    expect(rendered).toContain("skills (1): librarian");
    expect(rendered).toContain("commands (1): /builtin-header");
    expect(rendered).not.toContain("themes (");
    expect(rendered).not.toContain("prompts:");
    expect(rendered).toContain("pi-amp-themes");
    expect(rendered).not.toContain("ctx:");
    expect(rendered).not.toContain("AGENTS.md");

    header.setExpanded(true);
    const expanded = header.render(140).join("\n");
    expect(expanded).toContain("commands (1): /builtin-header");
    expect(expanded).toContain("themes (2): amp-dark, amp-gruvbox-dark-hard");
    expect(expanded).toContain(join(cwd, "themes/amp-dark.json"));
    expect(expanded).toContain("extension commands");
    expect(expanded).toContain("/builtin-header — npm:pi-command-package");
    expect(expanded).not.toContain("/builtin-header — index.ts");
    expect(expanded).not.toContain("@earendil-works/pi-coding-agent/dist/modes/interactive/theme");
    expect(expanded).not.toContain("AGENTS.md");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});



test("amp startup extension reads canonical context from system prompt on session start", async () => {
  const cwd = await mkdtemp("/tmp/pi-startup-context-");
  const contextPath = join(cwd, "AGENTS.md");
  await writeFile(contextPath, "canonical startup instructions");

  try {
    const { pi, handlers } = createPiStub();
    let headerFactory: ((tui: unknown, theme: ThemeStub) => AmpStartupHeader) | undefined;

    await ampStartupExtension(pi);

    await handlers.get("session_start")?.(
      { type: "session_start", reason: "startup" },
      {
        hasUI: true,
        cwd,
        model: { id: "claude-sonnet-4-20250514" },
        sessionManager: { getSessionName: () => undefined },
        getSystemPrompt() {
          return `You are pi.\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n## AGENTS.md\n\ncanonical startup instructions\n\nCurrent date: 2026-06-01\nCurrent working directory: ${cwd}`;
        },
        ui: {
          theme: createThemeStub(),
          setHeader(factory: typeof headerFactory) {
            headerFactory = factory;
          },
          getAllThemes() {
            return [];
          },
        },
      } as unknown as ExtensionContext,
    );

    expect(headerFactory).toBeDefined();
    const header = headerFactory!({ requestRender() {} }, createThemeStub());
    const rendered = header.render(88).join("\n");

    expect(rendered).toContain("context (1): AGENTS.md");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("amp startup extension refreshes with canonical loaded context files", async () => {
  const cwd = await mkdtemp("/tmp/pi-canonical-context-");

  try {
    const { pi, handlers } = createPiStub();
    let headerFactory: ((tui: unknown, theme: ThemeStub) => AmpStartupHeader) | undefined;
    let renderRequests = 0;

    await ampStartupExtension(pi);

    await handlers.get("session_start")?.(
      { type: "session_start", reason: "startup" },
      {
        hasUI: true,
        cwd,
        model: { id: "claude-sonnet-4-20250514" },
        sessionManager: { getSessionName: () => undefined },
        ui: {
          theme: createThemeStub(),
          setHeader(factory: typeof headerFactory) {
            headerFactory = factory;
          },
          getAllThemes() {
            return [];
          },
        },
      } as unknown as ExtensionContext,
    );

    expect(headerFactory).toBeDefined();
    const header = headerFactory!({ requestRender() { renderRequests += 1; } }, createThemeStub());

    const initial = header.render(88).join("\n");
    expect(initial).not.toContain("ctx:");
    expect(initial).not.toContain("context (");

    await handlers.get("before_agent_start")?.(
      {
        type: "before_agent_start",
        prompt: "hello",
        systemPrompt: "system",
        systemPromptOptions: {
          cwd,
          contextFiles: [{ path: join(cwd, "CLAUDE.md"), content: "canonical instructions" }],
        },
      },
      {
        hasUI: true,
        cwd,
        model: { id: "claude-sonnet-4-20250514" },
        sessionManager: { getSessionName: () => undefined },
        ui: {
          theme: createThemeStub(),
          setHeader() {},
          getAllThemes() {
            return [];
          },
        },
      } as unknown as ExtensionContext,
    );

    const rendered = header.render(88).join("\n");
    expect(renderRequests).toBe(1);
    expect(rendered).toContain("context (1): CLAUDE.md");

    header.setExpanded(true);
    const expanded = header.render(88).join("\n");
    expect(expanded).toContain("context (1): CLAUDE.md");
    expect(expanded).toContain("CLAUDE.md");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});
