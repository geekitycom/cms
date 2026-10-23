import type { Node } from './tree.ts';

type Align = 'left' | 'right' | 'center';

interface Cell {
  readonly text: string;
  readonly align: Align;
}

export function drawTable(table: Node, renderCell: (inline: readonly Node[]) => string): string[] {
  const section = (type: string) =>
    table.children
      .filter((child) => child.type === type)
      .flatMap((child) => child.children)
      .map((row) => row.children.map((cell) => readCell(cell, renderCell)));
  const head = section('thead');
  const body = section('tbody');
  const columns = Math.max(0, ...[...head, ...body].map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, i) =>
    Math.max(0, ...[...head, ...body].map((row) => width(row[i]?.text ?? ''))),
  );
  const rule = (left: string, fill: string, join: string, right: string) =>
    left + widths.map((w) => fill.repeat(w + 2)).join(join) + right;
  const row = (cells: readonly Cell[]) =>
    '│' +
    widths.map((w, i) => ` ${pad(cells[i] ?? { text: '', align: 'left' }, w)} `).join('│') +
    '│';
  return [
    rule('┌', '─', '┬', '┐'),
    ...head.map(row),
    ...(head.length > 0 && body.length > 0 ? [rule('╞', '═', '╪', '╡')] : []),
    ...body.map(row),
    rule('└', '─', '┴', '┘'),
  ];
}

function readCell(cell: Node, renderCell: (inline: readonly Node[]) => string): Cell {
  const align = /text-align:(left|right|center)/.exec(
    String(cell.token.attrGet('style') ?? ''),
  )?.[1];
  const inline = cell.children.find((child) => child.type === 'inline')?.children ?? [];
  return { text: renderCell(inline), align: (align as Align | undefined) ?? 'left' };
}

function width(text: string): number {
  return [...text].length;
}

function pad({ text, align }: Cell, to: number): string {
  const extra = to - width(text);
  const before = align === 'right' ? extra : align === 'center' ? Math.floor(extra / 2) : 0;
  return ' '.repeat(before) + text + ' '.repeat(extra - before);
}
