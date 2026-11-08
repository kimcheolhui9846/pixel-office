/**
 * A small unified line diff (no dependencies) for showing what `init` and `uninit` change.
 * Longest common subsequence by dynamic programming: settings files are small, and inputs
 * past a size limit fall back to "everything changed" instead of using a lot of memory.
 */

type Op = { kind: " " | "-" | "+"; line: string };

const MAX_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  if (text === "") {
    return [];
  }
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function lineOps(a: string[], b: string[]): Op[] {
  // trim the common head and tail first; most edits are local
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const head: Op[] = a.slice(0, start).map((line) => ({ kind: " ", line }));
  const tail: Op[] = a.slice(endA).map((line) => ({ kind: " ", line }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  const middle: Op[] = [];
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    for (const line of midA) middle.push({ kind: "-", line });
    for (const line of midB) middle.push({ kind: "+", line });
    return [...head, ...middle, ...tail];
  }
  // lcs[i][j] = LCS length of midA[i..] and midB[j..]
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        midA[i] === midB[j]
          ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      middle.push({ kind: " ", line: midA[i] as string });
      i += 1;
      j += 1;
    } else if ((lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0)) {
      middle.push({ kind: "-", line: midA[i] as string });
      i += 1;
    } else {
      middle.push({ kind: "+", line: midB[j] as string });
      j += 1;
    }
  }
  for (; i < n; i += 1) middle.push({ kind: "-", line: midA[i] as string });
  for (; j < m; j += 1) middle.push({ kind: "+", line: midB[j] as string });
  return [...head, ...middle, ...tail];
}

/**
 * Unified diff of two texts with `context` lines around each change, or "" when the lines
 * are equal. `--- fromLabel` / `+++ toLabel` head the output.
 */
export function unifiedDiff(before: string, after: string, fromLabel: string, toLabel: string, context = 3): string {
  const ops = lineOps(splitLines(before), splitLines(after));
  const changed = ops.map((op, index) => (op.kind === " " ? -1 : index)).filter((index) => index >= 0);
  if (changed.length === 0) {
    return "";
  }
  // group changes whose context windows touch
  const groups: Array<[number, number]> = [];
  for (const index of changed) {
    const last = groups[groups.length - 1];
    if (last && index - last[1] <= context * 2 + 1) {
      last[1] = index;
    } else {
      groups.push([index, index]);
    }
  }
  // line numbers (1-based) of each op in the old and new text
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    oldAt.push(oldLine);
    newAt.push(newLine);
    if (op.kind !== "+") oldLine += 1;
    if (op.kind !== "-") newLine += 1;
  }

  const out = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  for (const [first, last] of groups) {
    const from = Math.max(0, first - context);
    const to = Math.min(ops.length - 1, last + context);
    const slice = ops.slice(from, to + 1);
    const oldCount = slice.filter((op) => op.kind !== "+").length;
    const newCount = slice.filter((op) => op.kind !== "-").length;
    // a range with no lines is written as the line before it, as GNU diff does
    const oldStart = oldCount === 0 ? (oldAt[from] ?? 1) - 1 : (oldAt[from] ?? 1);
    const newStart = newCount === 0 ? (newAt[from] ?? 1) - 1 : (newAt[from] ?? 1);
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of slice) {
      out.push(`${op.kind}${op.line}`);
    }
  }
  return out.join("\n") + "\n";
}
