import { expect, test } from "vitest";

import {
  transformApiEndpointFences,
  transformAssistantMarkdown,
  transformShellCommandFences,
  withCopyableCodeBlockIndent,
} from "./amp-assistant-markdown.js";

test("transforms txt endpoint fences into markdown tables", () => {
  const input = `API:\n\n \`\`\`txt\n  GET /api/v1/spaces\n  GET /api/v1/spaces/current\n  GET /api/v1/accounts\n \`\`\``;

  const transformed = transformApiEndpointFences(input);

  expect(transformed).toContain("API:");
  expect(transformed).toContain("| Method | Endpoint |");
  expect(transformed).toContain("| `GET` | `/api/v1/spaces` |");
  expect(transformed).toContain("| `GET` | `/api/v1/spaces/current` |");
  expect(transformed).toContain("| `GET` | `/api/v1/accounts` |");
  expect(transformed).not.toContain("```txt");
});

test("transforms nested API endpoint paths", () => {
  const input = `or nested when needed:\n\n\`\`\`txt\n  GET /api/v1/spaces/{spaceId}/accounts\n\`\`\``;

  expect(transformApiEndpointFences(input)).toContain("| `GET` | `/api/v1/spaces/{spaceId}/accounts` |");
});

test("leaves non-endpoint text fences unchanged", () => {
  const input = `\`\`\`txt\nhello world\nGET without-a-leading-slash\n\`\`\``;

  expect(transformApiEndpointFences(input)).toBe(input);
});

test("leaves explicitly non-api code fences unchanged", () => {
  const input = `\`\`\`ts\nconst route = \"GET /api/v1/spaces\";\n\`\`\``;

  expect(transformApiEndpointFences(input)).toBe(input);
});

test("dedents bash command fences for copy-paste", () => {
  const input = `Use two terminals:\n\n\`\`\`bash\n   cd /Users/jordi9/dev/reeve\n   pnpm build\n   node dist/cli.js worker --config ~/.config/reeve/worker.toml\n\`\`\``;

  expect(transformShellCommandFences(input)).toContain(
    "```bash\ncd /Users/jordi9/dev/reeve\npnpm build\nnode dist/cli.js worker --config ~/.config/reeve/worker.toml\n```",
  );
});

test("preserves relative shell script indentation", () => {
  const input = `\`\`\`bash\n  if pnpm test; then\n    echo passed\n  fi\n\`\`\``;

  expect(transformShellCommandFences(input)).toBe(`\`\`\`bash\nif pnpm test; then\n  echo passed\nfi\n\`\`\``);
});

test("leaves non-shell code fence indentation unchanged", () => {
  const input = `\`\`\`ts\n  const command = \"pnpm build\";\n\`\`\``;

  expect(transformShellCommandFences(input)).toBe(input);
});

test("assistant markdown applies endpoint tables and shell dedent", () => {
  const input = `API:\n\n\`\`\`txt\nGET /api/v1/spaces\n\`\`\`\n\nRun:\n\n\`\`\`bash\n  pnpm build\n\`\`\``;

  const transformed = transformAssistantMarkdown(input);

  expect(transformed).toContain("| `GET` | `/api/v1/spaces` |");
  expect(transformed).toContain("```bash\npnpm build\n```");
});

test("styles code block borders while keeping line indentation empty", () => {
  const theme = {
    codeBlockIndent: "  ",
    codeBlock: (text: string) => text,
    codeBlockBorder: (text: string) => `[${text}]`,
  };

  const transformed = withCopyableCodeBlockIndent(theme);

  expect(transformed.codeBlockIndent).toBe("");
  expect(transformed.codeBlock("ok")).toBe("ok");
  expect(transformed.codeBlockBorder("```bash")).toBe("[╭─ bash]");
  expect(transformed.codeBlockBorder("```")).toBe("[╰─]");
});

test("styles unlabeled code block borders as code", () => {
  const theme = { codeBlockBorder: (text: string) => text };

  const transformed = withCopyableCodeBlockIndent(theme);

  expect(transformed.codeBlockBorder("```")).toBe("╭─ code");
  expect(transformed.codeBlockBorder("```")).toBe("╰─");
});
