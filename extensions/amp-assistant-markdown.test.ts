import { expect, test } from "vitest";

import { transformApiEndpointFences } from "./amp-assistant-markdown.js";

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
