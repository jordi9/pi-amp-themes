import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import ampPlaywrightBash, {
  formatPythonHeredocCommand,
  PYTHON_LOC_FLEXES,
  summarizeImpeccableCommand,
  summarizeImpeccableResult,
  summarizePlaywrightCommand,
  tokenizeShellLike,
} from "./amp-playwright-bash.js";

type Handler = (event?: any, ctx?: any) => void | Promise<void>;

function createHarness(tools: any[] = []) {
  const handlers = new Map<string, Handler[]>();
  const registeredTools = new Map<string, any>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool(tool: any) {
      registeredTools.set(tool.name, tool);
    },
    getAllTools() {
      return tools;
    },
  };

  ampPlaywrightBash(pi as any);

  return {
    async emit(event: string, payload: any = {}, ctx: any = {}) {
      for (const handler of handlers.get(event) ?? []) {
        await handler(payload, ctx);
      }
    },
    getTool(name: string) {
      return registeredTools.get(name);
    },
  };
}

function render(component: unknown): string {
  return (component as { render(width: number): string[] }).render(120).join("\n").trimEnd();
}

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function expectLocFlex(rendered: string, locCount: number): void {
  expect(PYTHON_LOC_FLEXES.some((flex) => rendered.includes(` · ${locCount} LOC ${flex}`))).toBe(true);
}

test("loads before pi-tool-display so its bash override wins", () => {
  const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const extensions = packageJson.pi.extensions as string[];

  expect(extensions.indexOf("./extensions/amp-playwright-bash.ts")).toBeGreaterThanOrEqual(0);
  expect(extensions.indexOf("./extensions/amp-playwright-bash.ts")).toBeLessThan(
    extensions.indexOf("./node_modules/pi-tool-display/index.ts"),
  );
});

test("tokenizes semicolons outside quoted run-code snippets only", () => {
  const tokens = tokenizeShellLike('A=1; node "$SKILL_DIR/scripts/pw.js" run-code "async () => { await x(); await y(); }"');

  expect(tokens).toEqual([
    "A=1",
    ";",
    "node",
    "$SKILL_DIR/scripts/pw.js",
    "run-code",
    "async () => { await x(); await y(); }",
  ]);
});

test("pretty prints inline Python heredocs in bash calls", () => {
  const command = `python3 - <<'PY'
 from pathlib import Path
 ok=True
 for p in sorted(Path('.').glob('*/SKILL.md')):
     print(p)
PY
git diff --check
git status --short`;

  expect(formatPythonHeredocCommand(command)).toBe(`python3 - <<'PY'
  1 │ from pathlib import Path
  2 │ ok=True
  3 │ for p in sorted(Path('.').glob('*/SKILL.md')):
  4 │     print(p)
PY
git diff --check
git status --short`);
});

test("does not pretty print non-Python heredocs", () => {
  expect(formatPythonHeredocCommand("cat <<'PY'\nhello\nPY")).toBeUndefined();
});

test("registered bash renderer collapses Python heredocs by default", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  const bashTool = harness.getTool("bash");

  const rendered = render(bashTool.renderCall(
    {
      command: "python3 - <<'PY'\nfrom pathlib import Path\nprint(Path('.').resolve())\nPY",
      timeout: 10,
    },
    theme,
    { executionStarted: false, isPartial: false, state: {}, toolCallId: "python-test" },
  ));

  expect(rendered).toContain("$ ◆ python heredoc · 2 LOC ");
  expect(rendered).toContain(" · from pathlib import Path (timeout 10s)");
  expectLocFlex(rendered, 2);
});

test("registered bash renderer expands Python heredocs with a code gutter", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  const bashTool = harness.getTool("bash");

  const rendered = render(bashTool.renderCall(
    {
      command: "python3 - <<'PY'\nfrom pathlib import Path\nprint(Path('.').resolve())\nPY",
      timeout: 10,
    },
    theme,
    { executionStarted: false, expanded: true, isPartial: false, state: {}, toolCallId: "python-test" },
  ));

  expect(rendered).toContain("$ ◆ python heredoc · 2 LOC ");
  expect(rendered).toContain(" · from pathlib import Path (timeout 10s)");
  expectLocFlex(rendered, 2);
  expect(rendered).toContain("  python3 - <<'PY'");
  expect(rendered).toContain("  1 │ from pathlib import Path");
  expect(rendered).toContain("  2 │ print(Path('.').resolve())");
  expect(rendered).toContain("  PY");
});

test("registered bash renderer does not count blank Python lines as LOC", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  const bashTool = harness.getTool("bash");

  const rendered = render(bashTool.renderCall(
    {
      command: "python3 - <<'PY'\n\nprint('real code')\n\nPY",
    },
    theme,
    { executionStarted: false, isPartial: false, state: {}, toolCallId: "python-test" },
  ));

  expect(rendered).toContain("$ ◆ python heredoc · 1 LOC ");
  expect(rendered).toContain(" · print('real code')");
  expectLocFlex(rendered, 1);
});

test("summarizes pi-playwright run-code screenshots", () => {
  const command = `SKILL_DIR=/Users/jordi9/dev/doscomas-app/.pi/npm/node_modules/pi-playwright/skills/playwright-browser;
ARTIFACT_DIR=$(node "$SKILL_DIR/scripts/artifact-dir.js");
node "$SKILL_DIR/scripts/pw.js" run-code "async (page) => {
  await page.setViewportSize({ width: 3200, height: 1800 });
  await page.goto('http://127.0.0.1:5173/app/accounts');
  await page.evaluate(() => localStorage.setItem('doscomas-data-mode', 'mock'));
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '$ARTIFACT_DIR/accounts-populated-wide-3200-after.png', fullPage: true });
}"`;

  expect(summarizePlaywrightCommand(command)).toBe(
    "playwright screenshot /app/accounts → accounts-populated-wide-3200-after.png · 3200×1800 · data-mode=mock · +1.5s",
  );
});

test("shows localStorage assignments instead of bare values", () => {
  const command = `node "$SKILL_DIR/scripts/pw.js" run-code "async (page) => {
    await page.goto('http://127.0.0.1:5173/app/accounts');
    await page.evaluate(() => localStorage.setItem('doscomas-data-mode', 'backend'));
    await page.evaluate(() => localStorage.setItem('doscomas-mock-scenario', 'empty'));
  }"`;

  expect(summarizePlaywrightCommand(command)).toBe(
    "playwright run-code /app/accounts · data-mode=backend · mock-scenario=empty",
  );
});

test("summarizes common pi-playwright wrapper commands", () => {
  expect(summarizePlaywrightCommand('node "$SKILL_DIR/scripts/pw.js" open http://localhost:5173/app/accounts --headed'))
    .toBe("playwright open /app/accounts · headed");
  expect(summarizePlaywrightCommand('node "$SKILL_DIR/scripts/pw.js" screenshot --filename "$ARTIFACT_DIR/page.png" --full-page'))
    .toBe("playwright screenshot → page.png · full page");
  expect(summarizePlaywrightCommand('node "$SKILL_DIR/scripts/detect-dev-servers.js" --json'))
    .toBe("playwright detect dev servers · json");
});

test("summarizes common impeccable live commands", () => {
  expect(summarizeImpeccableCommand("node .agents/skills/impeccable/scripts/live.mjs"))
    .toBe("impeccable live boot");
  expect(summarizeImpeccableCommand("node .agents/skills/impeccable/scripts/live-poll.mjs"))
    .toBe("impeccable live poll");
  expect(summarizeImpeccableCommand("node .agents/skills/impeccable/scripts/live-wrap.mjs --id 77d9b92a --count 3 --tag aside --text \"Dos Comas Plan\""))
    .toBe("impeccable live wrap aside · 3 variants · 77d9b92a · \"Dos Comas Plan\"");
});

test("summarizes impeccable live replies before chained polls", () => {
  const command = "node .agents/skills/impeccable/scripts/live-poll.mjs --reply 4e1e3d6c done --file src/components/dev/CtuBar.tsx && node .agents/skills/impeccable/scripts/live-poll.mjs";

  expect(summarizeImpeccableCommand(command)).toBe(
    "impeccable live reply done → src/components/dev/CtuBar.tsx · 4e1e3d6c",
  );
});

test("summarizes impeccable JSON results when collapsed", () => {
  expect(summarizeImpeccableResult(
    "node .agents/skills/impeccable/scripts/live.mjs",
    JSON.stringify({
      ok: true,
      serverPort: 8400,
      pageFiles: ["index.html"],
      hasProduct: true,
      productPath: "PRODUCT.md",
      hasDesign: false,
      designPath: "DESIGN.md",
    }, null, 2),
  )).toBe("live ready · helper :8400 · 1 page · PRODUCT.md · no DESIGN.md");

  expect(summarizeImpeccableResult(
    "node .agents/skills/impeccable/scripts/live-poll.mjs",
    JSON.stringify({
      type: "generate",
      id: "77d9b92a",
      action: "bolder",
      count: 3,
      element: { tagName: "ASIDE" },
      screenshotPath: "/tmp/shot.png",
    }),
  )).toBe("generate · 77d9b92a · bolder · 3 variants · aside · screenshot");

  expect(summarizeImpeccableResult(
    "node .agents/skills/impeccable/scripts/live-complete.mjs --id 77d9b92a && node .agents/skills/impeccable/scripts/live-poll.mjs",
    '{"phase":"completed"}\n{"type":"timeout"}',
  )).toBe("poll timeout");
});

test("ignores unrelated bash commands", () => {
  expect(summarizePlaywrightCommand("pnpm test")).toBeUndefined();
  expect(summarizeImpeccableCommand("pnpm test")).toBeUndefined();
});
