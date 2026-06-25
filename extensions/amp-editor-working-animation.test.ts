import { visibleWidth } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import ampEditorExtension, {
  formatExtensionStatuses,
  getWorkingAnimationFrame,
  pickWorkingAnimation,
  WORKING_ANIMATIONS,
  type WorkingAnimation,
} from "./amp-editor.js";

type RegisteredCommand = {
  description: string;
  getArgumentCompletions?(prefix: string): Array<{ value: string; label: string; description?: string }> | null;
  handler(args: string, ctx: ExtensionContext): Promise<void>;
};

test("working animation pool keeps the original Amp wave", () => {
  const ampWave = WORKING_ANIMATIONS.find((animation) => animation.name === "amp-wave");

  expect(ampWave?.frames).toEqual(["~", "≈", "≋"]);
});

test("working animation picker avoids immediate repeats when possible", () => {
  const previous = WORKING_ANIMATIONS[0];
  const picked = pickWorkingAnimation(previous, () => 0);

  expect(picked).toBe(WORKING_ANIMATIONS[1]);
});

test("working animation frames pad to the animation's widest frame", () => {
  const animation: WorkingAnimation = {
    name: "test",
    frames: ["x", "xxx"],
    intervalMs: 100,
  };

  expect(getWorkingAnimationFrame(animation, 0)).toBe("x  ");
  expect(visibleWidth(getWorkingAnimationFrame(animation, 0))).toBe(3);
  expect(getWorkingAnimationFrame(animation, 1)).toBe("xxx");
});

function getWorkingAnimationCommand(): RegisteredCommand {
  let command: RegisteredCommand | undefined;
  const pi = {
    on() {},
    getCommands: () => [],
    getThinkingLevel: () => "medium",
    registerCommand(name: string, options: RegisteredCommand) {
      if (name === "working-animation") command = options;
    },
  };

  ampEditorExtension(pi as never);

  expect(command).toBeDefined();
  return command!;
}

test("working-animation command can pin the original Amp wave", async () => {
  const command = getWorkingAnimationCommand();
  const notifications: string[] = [];

  await command.handler("amp-wave", {
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
    },
  } as unknown as ExtensionContext);

  expect(notifications.at(-1)).toContain("amp-wave (~ ≈ ≋)");
});

test("working-animation command exposes argument completions", () => {
  const command = getWorkingAnimationCommand();

  expect(command.getArgumentCompletions?.("amp")?.map((item) => item.value)).toEqual(["amp-wave"]);
  expect(command.getArgumentCompletions?.("")?.map((item) => item.value)).toContain("random");
});

test("formats extension statuses for the Amp editor row", () => {
  const statuses = new Map([
    ["z-live", "  live\npolling  "],
    ["a-impeccable", "● impeccable\tlive"],
  ]);

  expect(formatExtensionStatuses(statuses)).toBe("● impeccable live live polling");
});

test("registers editor shortcuts", () => {
  const shortcuts = new Map<string, { description?: string }>();
  const pi = {
    on() {},
    getCommands: () => [],
    getThinkingLevel: () => "medium",
    registerCommand() {},
    registerShortcut(key: string, options: { description?: string }) {
      shortcuts.set(key, { description: options.description });
    },
  };

  ampEditorExtension(pi as never);

  expect(shortcuts.get("ctrl+shift+x")).toEqual({ description: "Copy current prompt to clipboard" });
  expect(shortcuts.get("ctrl+7")).toEqual({ description: "Open command palette" });
});
