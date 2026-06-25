import { expect, test } from "vitest";

import { formatVcsChangesLabel, normalizeJjDescription, parseDiffStatSummary, type VcsInfo } from "./amp-editor.js";

test("formats muted JJ description before changed file summary", () => {
  const info: VcsInfo = {
    kind: "jj",
    branch: null,
    description: "feat(editor): show JJ description",
    changedFiles: 2,
    added: 4,
    modified: 1,
    removed: 0,
  };

  expect(formatVcsChangesLabel(info)).toBe("feat(editor): show JJ description · ✎2 +4 ~1");
  expect(formatVcsChangesLabel(info, (color, text) => `[${color}:${text}]`)).toBe(
    "[muted:feat(editor): show JJ description] [muted:·] [syntaxNumber:✎2] [toolDiffAdded:+4] [warning:~1]",
  );
});

test("omits empty JJ descriptions", () => {
  expect(normalizeJjDescription("\n  \t")).toBeNull();
  expect(normalizeJjDescription("(no description set)")).toBeNull();
});

test("parses JJ diff stat summary into existing change counters", () => {
  expect(parseDiffStatSummary("a.txt | 3 ++-\n2 files changed, 3 insertions(+), 1 deletion(-)")).toEqual({
    added: 2,
    modified: 1,
    removed: 0,
  });
});
