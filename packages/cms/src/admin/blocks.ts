import type { PluginScreenCell, PluginScreenText } from '../plugin.ts';
import { isRecord } from '../util/guards.ts';

export type DrawnBlock =
  | { readonly kind: 'empty'; readonly caption: string | undefined }
  | { readonly kind: 'paragraph'; readonly parts: readonly PluginScreenText[] }
  | { readonly kind: 'table'; readonly table: DrawnTable }
  | { readonly kind: 'stats'; readonly stats: readonly DrawnStat[] }
  | ({ readonly kind: 'timeSeries' } & DrawnTimeSeries)
  | {
      readonly kind: 'ranked';
      readonly caption: string;
      readonly items: readonly DrawnRankedItem[];
    }
  | ({ readonly kind: 'bars' } & DrawnBars)
  | ({ readonly kind: 'calendar' } & DrawnCalendar);

type DrawnCell =
  | PluginScreenText
  | { readonly time: string | null }
  | { readonly text: string; readonly href: string | undefined };

interface DrawnTable {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly DrawnCell[])[];
}

interface DrawnChange {
  readonly arrow: '▲' | '▼' | '';
  readonly text: string;
  readonly tone: 'better' | 'worse' | 'none';
}

interface DrawnStat {
  readonly label: string;
  readonly value: string;
  readonly change?: DrawnChange;
}

interface DrawnFigure {
  readonly id: string;
  readonly description: string;
  readonly width: number;
  readonly height: number;
  readonly columns: readonly string[];
  readonly rows: readonly { readonly heading: string; readonly cells: readonly string[] }[];
}

interface DrawnTimeSeries extends DrawnFigure {
  readonly plot: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  readonly yTicks: readonly { readonly y: number; readonly label: string }[];
  readonly xTicks: readonly { readonly x: number; readonly label: string }[];
  readonly series: readonly {
    readonly name: string;
    readonly path: string;
    readonly end: { readonly x: number; readonly y: number };
  }[];
  readonly bands: readonly { readonly x: number; readonly width: number; readonly title: string }[];
}

interface DrawnRankedItem {
  readonly label: string;
  readonly value: string;
  readonly href: string | undefined;
  readonly widthPercent: number;
}

interface DrawnBars extends DrawnFigure {
  readonly plot: DrawnTimeSeries['plot'];
  readonly yTicks: DrawnTimeSeries['yTicks'];
  readonly series: readonly string[];
  readonly bars: readonly {
    readonly tick: string | undefined;
    readonly centerX: number;
    readonly total: { readonly y: number; readonly text: string } | undefined;
    readonly segments: readonly {
      readonly series: number;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly title: string;
    }[];
  }[];
}

type CalendarLevel = 0 | 1 | 2 | 3 | 4;

interface DrawnCalendar extends DrawnFigure {
  readonly cells: readonly {
    readonly x: number;
    readonly y: number;
    readonly level: CalendarLevel;
    readonly title: string;
  }[];
  readonly months: readonly { readonly x: number; readonly label: string }[];
  readonly weekdays: readonly { readonly y: number; readonly label: string }[];
  readonly cell: number;
}

const MAX_SERIES = 4;

const MAX_GROUPS = 24;

const SEGMENT_GAP = 2;

const MAX_CALENDAR_DAYS = 366;

const DAY_MS = 86_400_000;

const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const shortDay = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const longDay = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const monthName = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });

let figures = 0;

const EMPTY: DrawnBlock = { kind: 'empty', caption: undefined };

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isText(value: unknown): value is PluginScreenText {
  return typeof value === 'string' || (isRecord(value) && typeof value['code'] === 'string');
}

function isCell(value: unknown): value is PluginScreenCell {
  return (
    isText(value) ||
    (isRecord(value) &&
      (typeof value['time'] === 'string' ||
        value['time'] === null ||
        (typeof value['text'] === 'string' && typeof value['href'] === 'string')))
  );
}

function drawCell(cell: PluginScreenCell): DrawnCell {
  return typeof cell === 'object' && 'href' in cell
    ? { text: cell.text, href: safeHref(cell.href) }
    : cell;
}

function dayTime(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value
    ? undefined
    : time;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function niceStep(max: number): number {
  const raw = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const factor = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return factor * magnitude;
}

function nextFigureId(): string {
  figures += 1;
  return `chart-${String(figures)}`;
}

function drawTable(data: unknown): DrawnBlock {
  if (!isRecord(data)) return EMPTY;
  const { caption, columns, rows } = data;
  if (typeof caption !== 'string') return EMPTY;
  const empty: DrawnBlock = { kind: 'empty', caption };
  if (!Array.isArray(columns) || !columns.every((column) => typeof column === 'string')) {
    return empty;
  }
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    !rows.every((row) => Array.isArray(row) && row.length === columns.length && row.every(isCell))
  ) {
    return empty;
  }
  return {
    kind: 'table',
    table: {
      caption,
      columns: columns as string[],
      rows: (rows as PluginScreenCell[][]).map((row) => row.map(drawCell)),
    },
  };
}

function drawChange(value: number, previous: number, better: 'up' | 'down'): DrawnChange {
  if (value === previous)
    return { arrow: '', text: `No change from ${whole.format(previous)}`, tone: 'none' };
  const up = value > previous;
  const tone = up === (better === 'up') ? 'better' : 'worse';
  const from = whole.format(previous);
  if (previous === 0) return { arrow: '▲', text: `Up from ${from}`, tone };
  const percent = Math.round((Math.abs(value - previous) / previous) * 100);
  return up
    ? { arrow: '▲', text: `+${whole.format(percent)}%, up from ${from}`, tone }
    : { arrow: '▼', text: `−${whole.format(percent)}%, down from ${from}`, tone };
}

function drawStats(data: unknown): DrawnBlock {
  if (!Array.isArray(data) || data.length === 0) return EMPTY;
  const stats: DrawnStat[] = [];
  for (const stat of data) {
    if (!isRecord(stat) || typeof stat['label'] !== 'string' || !isAmount(stat['value'])) {
      return EMPTY;
    }
    const { previous, better = 'up' } = stat;
    if (previous !== undefined && !isAmount(previous)) return EMPTY;
    if (better !== 'up' && better !== 'down') return EMPTY;
    const value = stat['value'];
    stats.push({
      label: stat['label'],
      value: whole.format(value),
      ...(previous === undefined ? {} : { change: drawChange(value, previous, better) }),
    });
  }
  return { kind: 'stats', stats };
}

function consecutiveDays(days: unknown): number[] | undefined {
  if (!Array.isArray(days) || days.length === 0) return undefined;
  const times: number[] = [];
  for (const day of days) {
    const time = dayTime(day);
    const last = times.at(-1);
    if (time === undefined || (last !== undefined && time !== last + DAY_MS)) return undefined;
    times.push(time);
  }
  return times;
}

function spanText(first: number, last: number): string {
  const length = (last - first) / DAY_MS + 1;
  return length === 1
    ? `1 day, ${shortDay.format(first)}`
    : `${String(length)} days from ${shortDay.format(first)} to ${shortDay.format(last)}`;
}

function namedSeries(
  series: unknown,
  points: number,
): { name: string; values: number[] }[] | undefined {
  if (!Array.isArray(series) || series.length === 0 || series.length > MAX_SERIES) {
    return undefined;
  }
  const named: { name: string; values: number[] }[] = [];
  for (const entry of series) {
    if (
      !isRecord(entry) ||
      typeof entry['name'] !== 'string' ||
      !Array.isArray(entry['values']) ||
      entry['values'].length !== points ||
      !entry['values'].every(isAmount)
    ) {
      return undefined;
    }
    named.push({ name: entry['name'], values: entry['values'] as number[] });
  }
  return named;
}

const CHART_WIDTH = 480;
const CHART_HEIGHT = 220;
const PLOT = { left: 44, right: CHART_WIDTH - 24, top: 12, bottom: CHART_HEIGHT - 28 };

function valueAxis(peak: number): {
  y: (value: number) => number;
  ticks: DrawnTimeSeries['yTicks'][number][];
} {
  const step = niceStep(peak > 0 ? peak : 1);
  const top = Math.max(step, Math.ceil(peak / step) * step);
  const y = (value: number): number =>
    round(PLOT.bottom - (value / top) * (PLOT.bottom - PLOT.top));
  const ticks: DrawnTimeSeries['yTicks'][number][] = [];
  for (let tick = 0; tick <= top + step / 2; tick += step) {
    ticks.push({ y: y(tick), label: compact.format(tick) });
  }
  return { y, ticks };
}

function drawTimeSeries(data: unknown): DrawnBlock {
  if (!isRecord(data) || typeof data['caption'] !== 'string') return EMPTY;
  const caption = data['caption'];
  const empty: DrawnBlock = { kind: 'empty', caption };
  const times = consecutiveDays(data['days']);
  const named = times === undefined ? undefined : namedSeries(data['series'], times.length);
  if (times === undefined || named === undefined) return empty;

  const { y, ticks: yTicks } = valueAxis(Math.max(...named.flatMap((entry) => entry.values)));
  const count = times.length;
  const span = (PLOT.right - PLOT.left) / Math.max(count - 1, 1);
  const x = (index: number): number =>
    round(count === 1 ? (PLOT.left + PLOT.right) / 2 : PLOT.left + index * span);

  const every = Math.ceil(count / 7);
  const xTicks: DrawnTimeSeries['xTicks'][number][] = [];
  for (let index = count - 1; index >= 0; index -= every) {
    xTicks.unshift({ x: x(index), label: shortDay.format(times[index] ?? 0) });
  }

  return {
    kind: 'timeSeries',
    id: nextFigureId(),
    description: `${caption}, ${spanText(times[0] ?? 0, times.at(-1) ?? 0)}.`,
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    plot: PLOT,
    yTicks,
    xTicks,
    series: named.map((entry) => ({
      name: entry.name,
      path: entry.values
        .map((value, index) => `${index === 0 ? 'M' : 'L'}${String(x(index))} ${String(y(value))}`)
        .join(' '),
      end: { x: x(count - 1), y: y(entry.values.at(-1) ?? 0) },
    })),
    bands: times.map((time, index) => {
      const start = index === 0 ? PLOT.left : x(index) - span / 2;
      const end = index === count - 1 ? PLOT.right : x(index) + span / 2;
      return {
        x: round(start),
        width: round(end - start),
        title: `${shortDay.format(time)}: ${named
          .map((entry) => `${entry.name} ${whole.format(entry.values[index] ?? 0)}`)
          .join(', ')}`,
      };
    }),
    columns: ['Day', ...named.map((entry) => entry.name)],
    rows: times.map((time, index) => ({
      heading: longDay.format(time),
      cells: named.map((entry) => whole.format(entry.values[index] ?? 0)),
    })),
  };
}

function safeHref(href: unknown): string | undefined {
  return typeof href === 'string' && /^(?:https?:\/\/|\/(?!\/))/i.test(href) ? href : undefined;
}

function drawRanked(data: unknown): DrawnBlock {
  if (!isRecord(data) || typeof data['caption'] !== 'string') return EMPTY;
  const caption = data['caption'];
  const items = data['items'];
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    !items.every(
      (item) => isRecord(item) && typeof item['label'] === 'string' && isAmount(item['value']),
    )
  ) {
    return { kind: 'empty', caption };
  }
  const ranked = (items as { label: string; value: number; href?: unknown }[]).toSorted(
    (a, b) => b.value - a.value,
  );
  const most = ranked[0]?.value ?? 0;
  return {
    kind: 'ranked',
    caption,
    items: ranked.map((item) => ({
      label: item.label,
      value: whole.format(item.value),
      href: safeHref(item.href),
      widthPercent: most > 0 ? Math.round((item.value / most) * 1000) / 10 : 0,
    })),
  };
}

function drawBars(data: unknown): DrawnBlock {
  if (!isRecord(data) || typeof data['caption'] !== 'string') return EMPTY;
  const caption = data['caption'];
  const empty: DrawnBlock = { kind: 'empty', caption };
  const groups = data['groups'];
  if (
    !Array.isArray(groups) ||
    groups.length === 0 ||
    groups.length > MAX_GROUPS ||
    !groups.every((group) => typeof group === 'string')
  ) {
    return empty;
  }
  const labels = groups as string[];
  const named = namedSeries(data['series'], labels.length);
  if (named === undefined) return empty;

  const totals = labels.map((_, index) =>
    named.reduce((sum, entry) => sum + (entry.values[index] ?? 0), 0),
  );
  const most = Math.max(...totals);
  const { y, ticks: yTicks } = valueAxis(most);
  const band = (PLOT.right - PLOT.left) / labels.length;
  const barWidth = round(Math.min(32, band * 0.6));
  const longest = Math.max(...labels.map((label) => label.length));
  const every = Math.max(1, Math.ceil((longest * 6.6 + 6) / band));

  const bars = labels.map((label, index) => {
    const middle = round(PLOT.left + (index + 0.5) * band);
    const left = round(middle - barWidth / 2);
    const total = totals[index] ?? 0;
    const segments: DrawnBars['bars'][number]['segments'][number][] = [];
    let below = 0;
    named.forEach((entry, series) => {
      const value = entry.values[index] ?? 0;
      if (value === 0) return;
      const bottom = y(below) - (segments.length === 0 ? 0 : SEGMENT_GAP);
      const top = y(below + value);
      below += value;
      segments.push({
        series,
        x: left,
        y: top,
        width: barWidth,
        height: round(Math.max(bottom - top, 1)),
        title: `${label}: ${entry.name} ${whole.format(value)} of ${whole.format(total)}`,
      });
    });
    return {
      tick: (labels.length - 1 - index) % every === 0 ? label : undefined,
      centerX: middle,
      total: total === 0 ? undefined : { y: round(y(total) - 4), text: whole.format(total) },
      segments,
    };
  });

  const sum = totals.reduce((all, total) => all + total, 0);
  const busiest = labels[totals.indexOf(most)] ?? '';
  const span = labels.length === 1 ? labels[0] : `${labels[0] ?? ''} to ${labels.at(-1) ?? ''}`;
  const summary =
    sum === 0 ? 'none' : `${whole.format(sum)} in all, most in ${busiest} (${whole.format(most)})`;

  return {
    kind: 'bars',
    id: nextFigureId(),
    description: `${caption}, ${span ?? ''}: ${summary}.`,
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    plot: PLOT,
    yTicks,
    series: named.map((entry) => entry.name),
    bars,
    columns: [
      typeof data['groupName'] === 'string' ? data['groupName'] : 'Group',
      ...named.map((entry) => entry.name),
      'Total',
    ],
    rows: labels.map((label, index) => ({
      heading: label,
      cells: [
        ...named.map((entry) => whole.format(entry.values[index] ?? 0)),
        whole.format(totals[index] ?? 0),
      ],
    })),
  };
}

function drawCalendar(data: unknown): DrawnBlock {
  if (!isRecord(data) || typeof data['caption'] !== 'string') return EMPTY;
  const caption = data['caption'];
  const empty: DrawnBlock = { kind: 'empty', caption };
  const days = data['days'];
  if (!Array.isArray(days) || days.length === 0) return empty;

  const counts = new Map<number, number>();
  for (const entry of days) {
    const time = isRecord(entry) ? dayTime(entry['day']) : undefined;
    if (time === undefined || !isRecord(entry) || !isAmount(entry['count']) || counts.has(time)) {
      return empty;
    }
    counts.set(time, entry['count']);
  }
  const first = Math.min(...counts.keys());
  const last = Math.max(...counts.keys());
  const length = (last - first) / DAY_MS + 1;
  if (length > MAX_CALENDAR_DAYS) return empty;

  const cell = 12;
  const pitch = cell + 2;
  const left = 30;
  const top = 16;
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const most = Math.max(...counts.values());
  const cells: DrawnCalendar['cells'][number][] = [];
  const months: { x: number; label: string }[] = [];
  let total = 0;
  let busiest = first;
  for (let offset = 0; offset < length; offset += 1) {
    const time = first + offset * DAY_MS;
    const count = counts.get(time) ?? 0;
    total += count;
    if (count > (counts.get(busiest) ?? 0)) busiest = time;
    const column = Math.floor((offset + lead) / 7);
    const row = (offset + lead) % 7;
    if (offset === 0 || new Date(time).getUTCDate() === 1) {
      months.push({ x: left + column * pitch, label: monthName.format(time) });
    }
    cells.push({
      x: left + column * pitch,
      y: top + row * pitch,
      level:
        count === 0
          ? 0
          : (Math.min(4, Math.max(1, Math.ceil((count / most) * 4))) as CalendarLevel),
      title: `${longDay.format(time)}: ${whole.format(count)}`,
    });
  }
  const columns = Math.floor((length - 1 + lead) / 7) + 1;
  const summary =
    total === 0
      ? 'none'
      : `${whole.format(total)} in all, most on ${shortDay.format(busiest)} (${whole.format(most)})`;

  return {
    kind: 'calendar',
    id: nextFigureId(),
    description: `${caption}, ${spanText(first, last)}: ${summary}.`,
    width: left + columns * pitch,
    height: top + 7 * pitch,
    cell,
    cells,
    months: months.filter(
      (month, index) => index === 0 || month.x - (months[index - 1]?.x ?? 0) >= 3 * pitch,
    ),
    weekdays: [
      { y: top + cell - 2, label: 'Mon' },
      { y: top + 2 * pitch + cell - 2, label: 'Wed' },
      { y: top + 4 * pitch + cell - 2, label: 'Fri' },
    ],
    columns: ['Day', caption],
    rows: [...counts.entries()]
      .filter(([, count]) => count > 0)
      .toSorted(([a], [b]) => a - b)
      .map(([time, count]) => ({ heading: longDay.format(time), cells: [whole.format(count)] })),
  };
}

export function drawBlock(block: unknown): DrawnBlock {
  if (!isRecord(block)) return EMPTY;
  if ('paragraph' in block) {
    const { paragraph } = block;
    return Array.isArray(paragraph) && paragraph.length > 0 && paragraph.every(isText)
      ? { kind: 'paragraph', parts: paragraph }
      : EMPTY;
  }
  if ('table' in block) return drawTable(block['table']);
  if ('stats' in block) return drawStats(block['stats']);
  if ('timeSeries' in block) return drawTimeSeries(block['timeSeries']);
  if ('ranked' in block) return drawRanked(block['ranked']);
  if ('bars' in block) return drawBars(block['bars']);
  if ('calendar' in block) return drawCalendar(block['calendar']);
  return EMPTY;
}
