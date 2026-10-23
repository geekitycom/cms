const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)([\s\S]*?[^`])\1(?!`)/g;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const REFERENCE_DEFINITION = /^ {0,3}\[(?!\^)[^\]]+\]:[ \t]*\S+.*$/gm;
const FOOTNOTE_LABEL = /\[\^[^\]\s]+\]:?/g;
const INLINE_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const REFERENCE_LINK = /!?\[([^\]]*)\]\[[^\]]*\]/g;
const HTML_TAG = /<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/g;
const LINE_MARKER = /^[ \t>]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

const MAX_EDITS = 2000;

export function wordCount(markdown: string): number {
  return wordsOf(markdown).length;
}

export function addedWords(before: string, after: string): number {
  return insertions(wordsOf(before), wordsOf(after));
}

function wordsOf(markdown: string): string[] {
  const words: string[] = [];
  let prose: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (fence === undefined) {
      if (marker === undefined) {
        prose.push(line);
        continue;
      }
      pushProse(prose.join('\n'), words);
      prose = [];
      fence = marker;
    } else if (marker?.startsWith(fence) === true) fence = undefined;
    else pushRuns(line, words);
  }
  pushProse(prose.join('\n'), words);
  return words;
}

function pushProse(text: string, words: string[]): void {
  let at = 0;
  for (const span of text.matchAll(INLINE_CODE)) {
    pushRuns(stripMarkdown(text.slice(at, span.index)), words);
    pushRuns(span[2] ?? '', words);
    at = span.index + span[0].length;
  }
  pushRuns(stripMarkdown(text.slice(at)), words);
}

function stripMarkdown(text: string): string {
  return text
    .replace(HTML_COMMENT, ' ')
    .replace(REFERENCE_DEFINITION, ' ')
    .replace(FOOTNOTE_LABEL, ' ')
    .replace(INLINE_LINK, '$1')
    .replace(REFERENCE_LINK, '$1')
    .replace(HTML_TAG, ' ')
    .replace(LINE_MARKER, ' ');
}

function pushRuns(text: string, words: string[]): void {
  for (const run of text.split(/\s+/)) {
    const word = run.replace(EDGE_PUNCTUATION, '').toLowerCase();
    if (word !== '') words.push(word);
  }
}

function insertions(before: readonly string[], after: readonly string[]): number {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start])
    start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const removed = before.slice(start, endBefore);
  const inserted = after.slice(start, endAfter);
  if (removed.length === 0 || inserted.length === 0) return inserted.length;

  const edits = cappedEditDistance(removed, inserted);
  if (edits === undefined) return unmatchedWordCount(removed, inserted);
  return (edits + inserted.length - removed.length) / 2;
}

function cappedEditDistance(a: readonly string[], b: readonly string[]): number | undefined {
  const max = Math.min(a.length + b.length, MAX_EDITS);
  const offset = max + 1;
  const furthest = new Int32Array(2 * max + 3);
  for (let d = 0; d <= max; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && furthest[offset + k - 1]! < furthest[offset + k + 1]!);
      let x = down ? furthest[offset + k + 1]! : furthest[offset + k - 1]! + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      furthest[offset + k] = x;
      if (x >= a.length && y >= b.length) return d;
    }
  }
  return undefined;
}

function unmatchedWordCount(before: readonly string[], after: readonly string[]): number {
  const counts = new Map<string, number>();
  for (const word of before) counts.set(word, (counts.get(word) ?? 0) + 1);
  let added = 0;
  for (const word of after) {
    const left = counts.get(word) ?? 0;
    if (left > 0) counts.set(word, left - 1);
    else added += 1;
  }
  return added;
}
