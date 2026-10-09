export function ownParagraph(
  doc: string,
  from: number,
  to: number,
  line: string,
): { from: number; to: number; insert: string; cursor: number } {
  const before = doc.slice(0, from);
  const after = doc.slice(to);
  const lead =
    before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const startOfNextParagraph = from + `${lead}${line}\n\n`.length;
  return { from, to, insert: `${lead}${line}${trail}`, cursor: startOfNextParagraph };
}
