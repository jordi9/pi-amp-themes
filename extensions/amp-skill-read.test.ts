import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Text } from "@earendil-works/pi-tui";
import { afterEach, expect, test } from "vitest";
import ampSkillRead from "./amp-skill-read.js";

type Handler = (event?: any, ctx?: any) => void | Promise<void>;

type FakeCommand = {
  name: string;
  source: string;
  sourceInfo: { path: string; baseDir?: string };
};

const TOOL_DISPLAY_API_KEY = Symbol.for("pi-tool-display.api.v1");

function installToolDisplayApi() {
  (globalThis as any)[TOOL_DISPLAY_API_KEY] = {
    version: 1,
    decorateTool(tool: any) {
      return {
        ...tool,
        renderCall(args: any) {
          return new Text(`read fallback ${args.path ?? args.file_path ?? "..."}`, 0, 0);
        },
        renderResult() {
          return new Text("read result fallback", 0, 0);
        },
      };
    },
  };
}

function createHarness(commands: FakeCommand[] = []) {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, any>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    getCommands() {
      return commands;
    },
    getAllTools() {
      throw new Error("amp-skill-read should not mutate getAllTools() metadata");
    },
  };

  ampSkillRead(pi as any);

  return {
    async emit(event: string, payload: any = {}, ctx: any = {}) {
      for (const handler of handlers.get(event) ?? []) {
        await handler(payload, ctx);
      }
    },
    getTool(name: string) {
      return tools.get(name);
    },
  };
}

function render(component: unknown): string {
  return (component as { render(width: number): string[] }).render(80).join("\n").trimEnd();
}

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

afterEach(() => {
  delete (globalThis as any)[TOOL_DISPLAY_API_KEY];
});

test("loads before pi-tool-display so its read override wins", () => {
  const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const extensions = packageJson.pi.extensions as string[];

  expect(extensions.indexOf("./extensions/amp-skill-read.ts")).toBeGreaterThanOrEqual(0);
  expect(extensions.indexOf("./extensions/amp-skill-read.ts"))
    .toBeLessThan(extensions.indexOf("./node_modules/pi-tool-display/index.ts"));
});

test("renders SKILL.md reads with compact skill label", async () => {
  installToolDisplayApi();
  const harness = createHarness();

  await harness.emit("session_start");
  const readTool = harness.getTool("read");

  const rendered = render(readTool.renderCall(
    { path: "/tmp/skills/git-committer/SKILL.md" },
    theme,
    { cwd: "/tmp" },
  ));

  expect(rendered).toContain("[skill] git-committer");
});

test("uses discovered skill name when path does not reveal it", async () => {
  installToolDisplayApi();
  const harness = createHarness([
    { name: "skill:frontmatter-name", source: "skill", sourceInfo: { path: "/tmp/skills/custom.md" } },
  ]);

  await harness.emit("session_start");
  const readTool = harness.getTool("read");

  const rendered = render(readTool.renderCall(
    { path: "/tmp/skills/custom.md", offset: 3, limit: 2 },
    theme,
    { cwd: "/tmp" },
  ));

  expect(rendered).toContain("[skill] frontmatter-name:3-4");
});

test("keeps pi-tool-display read rendering for non-skill files", async () => {
  installToolDisplayApi();
  const harness = createHarness();

  await harness.emit("session_start");
  const readTool = harness.getTool("read");

  const rendered = render(readTool.renderCall(
    { path: "/tmp/src/app.ts" },
    theme,
    { cwd: "/tmp" },
  ));

  expect(rendered).toBe("read fallback /tmp/src/app.ts");
});

test("refreshes prompt-loaded skill metadata before agent start", async () => {
  installToolDisplayApi();
  const harness = createHarness();

  await harness.emit("session_start");
  await harness.emit("before_agent_start", {
    systemPromptOptions: {
      skills: [{ name: "prompt-skill", filePath: "/tmp/generated/loaded.md" }],
    },
  });
  const readTool = harness.getTool("read");

  const rendered = render(readTool.renderCall(
    { path: "/tmp/generated/loaded.md" },
    theme,
    { cwd: "/tmp" },
  ));

  expect(rendered).toContain("[skill] prompt-skill");
});
