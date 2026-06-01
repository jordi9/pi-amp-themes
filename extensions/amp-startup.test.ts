import { expect, test } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

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
    contextFiles: ["AGENTS.md"],
    skills: ["git-committer", "librarian", "playwright-browser", "vercel-react-best-practices"],
    prompts: ["/create-goal"],
    extensionCommands: ["/builtin-header"],
    themes: ["amp-dark", "amp-gruvbox-dark-hard", "amp-light"],
    sections: [
      {
        title: "Tools",
        lines: [
          "  active",
          "    bash — Execute shell commands",
          "    edit — Replace text in files",
        ],
      },
      { title: "Context", lines: ["  AGENTS.md"] },
      {
        title: "Skills",
        lines: [
          "  user",
          "    ~/.agents/skills/git-committer/SKILL.md",
          "    npm:pi-web-access",
          "      skills/librarian/SKILL.md",
        ],
      },
      { title: "Prompts", lines: ["  user", "    npm:pi-codex-goal", "      /create-goal"] },
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
      { name: "builtin-header", description: "Restore header", source: "extension" },
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

test("amp startup header renders an epic framed launch banner", () => {
  const header = new AmpStartupHeader(createThemeStub() as never, () => createSnapshot());
  const lines = header.render(88);
  const text = lines.join("\n");

  expect(text).toContain("█████");
  expect(text).toContain("███╗   ██");
  expect(text).not.toContain("HERMES LINK ONLINE");
  expect(text).toContain("tools bash, edit, read, write");
  expect(text).toContain("ctx AGENTS.md");
  expect(text).toContain("prompts /create-goal");
  expect(text).toContain("42 cmds");
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

test("amp startup header expands with launch hints", () => {
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

  expect(text).toContain("[Tools]");
  expect(text).toContain("bash — Execute shell commands");
  expect(text).toContain("[Skills]");
  expect(text).toContain("~/.agents/skills/git-committer/SKILL.md");
  expect(text).toContain("npm:pi-web-access");
  expect(text).toContain("skills/librarian/SKILL.md");
  expect(text).toContain("[Prompts]");
  expect(text).toContain("/create-goal");
  expect(text).toContain("session demo");
  expectLinesWithinWidth(expanded, 88);
});

test("amp startup extension installs the custom header on session start", async () => {
  const { pi, handlers } = createPiStub();
  let headerFactory: ((tui: unknown, theme: ThemeStub) => AmpStartupHeader) | undefined;

  ampStartupExtension(pi);

  const sessionStart = handlers.get("session_start");
  expect(sessionStart).toBeDefined();

  await sessionStart?.(
    { type: "session_start", reason: "startup" },
    {
      hasUI: true,
      cwd: "/tmp/pi-amp-themes",
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
            { name: "amp-dark", path: "/tmp/pi-amp-themes/themes/amp-dark.json" },
            { name: "amp-gruvbox-dark-hard", path: "/tmp/pi-amp-themes/themes/amp-gruvbox-dark-hard.json" },
          ];
        },
      },
    } as unknown as ExtensionContext,
  );

  expect(headerFactory).toBeDefined();
  const header = headerFactory!({ requestRender() {} }, createThemeStub());
  const rendered = header.render(88).join("\n");

  expect(rendered).toContain("█████");
  expect(rendered).toContain("███╗   ██");
  expect(rendered).toContain("tools bash, edit, read, write");
  expect(rendered).toContain("skills librarian");
  expect(rendered).toContain("prompts /create-goal");
  expect(rendered).toContain("3 cmds");
  expect(rendered).toContain("pi-amp-themes");

  header.setExpanded(true);
  const expanded = header.render(88).join("\n");
  expect(expanded).toContain("[Themes]");
  expect(expanded).toContain("  user");
  expect(expanded).toContain("/tmp/pi-amp-themes/themes/amp-dark.json");
  expect(expanded).not.toContain("@earendil-works/pi-coding-agent/dist/modes/interactive/theme");
});