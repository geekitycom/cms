export type CitedStart =
  | { readonly kind: 'wall-clock'; readonly written: string; readonly asUtc: Date }
  | { readonly kind: 'instant'; readonly at: Date };

const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?$/;

export function readCitedStart(value: string): CitedStart | undefined {
  const written = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(written)) return undefined;
  const wallClock = WALL_CLOCK.exec(written);
  if (wallClock !== null) {
    const [, date, time] = wallClock;
    const asUtc = new Date(`${date}T${time ?? '00:00'}Z`);
    if (Number.isNaN(asUtc.getTime())) return undefined;
    return {
      kind: 'wall-clock',
      written: time === undefined ? `${date}` : `${date}T${time}`,
      asUtc,
    };
  }
  const at = new Date(written);
  return Number.isNaN(at.getTime()) ? undefined : { kind: 'instant', at };
}
