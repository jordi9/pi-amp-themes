import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import { summarizePlaywrightCommand, tokenizeShellLike } from "./amp-playwright-bash.js";

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

test("ignores unrelated bash commands", () => {
  expect(summarizePlaywrightCommand("npm test")).toBeUndefined();
});
