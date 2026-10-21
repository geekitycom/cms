import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAdminTemplateEnvironment } from './templates.ts';

const environment = createAdminTemplateEnvironment({ noCache: true });

function draw(data: unknown): string {
  return environment
    .renderString(`{% from "components/blocks.njk" import block %}{{ block(data) }}`, { data })
    .replaceAll(/>\s+</g, '><')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function all(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((match) => match[1] ?? '');
}

function days(first: string, count: number): string[] {
  const start = Date.parse(`${first}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

const EMPTY = /No data to show\./;

function lines(html: string): { colour: string; dash: string }[] {
  return [
    ...html.matchAll(
      /<g class="([^"]*)"><path class="fill-none" stroke-dasharray="([^"]*)"[^>]* d="M/g,
    ),
  ].map(([, colour, dash]) => ({ colour: colour ?? '', dash: dash ?? '' }));
}

function legendOf(html: string): string {
  return /<ul class="[^"]*" aria-hidden="true">(.*?)<\/ul>/.exec(html)?.[1] ?? '';
}

describe('a block, given input it cannot draw', () => {
  const invalid: [string, unknown][] = [
    ['nothing', undefined],
    ['an unknown kind', { pie: [] }],
    ['a paragraph of no text', { paragraph: [] }],
    ['a table with no rows', { table: { caption: 'Paths', columns: ['Path'], rows: [] } }],
    [
      'a table with a short row',
      { table: { caption: 'Paths', columns: ['Path', 'When'], rows: [['/a']] } },
    ],
    ['no stats', { stats: [] }],
    ['a negative stat', { stats: [{ label: 'Views', value: -1 }] }],
    ['a stat that is not a number', { stats: [{ label: 'Views', value: 'many' }] }],
    [
      'a stat whose previous is not a number',
      { stats: [{ label: 'Views', value: 3, previous: NaN }] },
    ],
    [
      'a stat in a format it does not know',
      { stats: [{ label: 'Views', value: 3, format: 'money' }] },
    ],
    ['a time series of no days', { timeSeries: { caption: 'Views', days: [], series: [] } }],
    [
      'a time series with a negative value',
      {
        timeSeries: {
          caption: 'Views',
          days: days('2026-10-01', 2),
          series: [{ name: 'Views', values: [1, -2] }],
        },
      },
    ],
    [
      'a time series with a value that is not a number',
      {
        timeSeries: {
          caption: 'Views',
          days: days('2026-10-01', 2),
          series: [{ name: 'Views', values: [1, '2'] }],
        },
      },
    ],
    [
      'a time series whose values miss a day',
      {
        timeSeries: {
          caption: 'Views',
          days: days('2026-10-01', 2),
          series: [{ name: 'Views', values: [1] }],
        },
      },
    ],
    [
      'a time series with a day that is not a date',
      {
        timeSeries: {
          caption: 'Views',
          days: ['yesterday'],
          series: [{ name: 'Views', values: [1] }],
        },
      },
    ],
    ['a ranked list of nothing', { ranked: { caption: 'Pages', items: [] } }],
    [
      'a ranked item below zero',
      { ranked: { caption: 'Pages', items: [{ label: '/', value: -3 }] } },
    ],
    ['bars of no groups', { bars: { caption: 'Posts', groups: [], series: [] } }],
    [
      'bars whose values miss a group',
      {
        bars: {
          caption: 'Posts',
          groups: ['Sep', 'Oct'],
          series: [{ name: 'Notes', values: [1] }],
        },
      },
    ],
    [
      'bars with a negative value',
      {
        bars: {
          caption: 'Posts',
          groups: ['Oct'],
          series: [{ name: 'Notes', values: [-1] }],
        },
      },
    ],
    [
      'bars with a group that is not text',
      { bars: { caption: 'Posts', groups: [10], series: [{ name: 'Notes', values: [1] }] } },
    ],
    ['a calendar of no days', { calendar: { caption: 'Posts', days: [] } }],
    [
      'a calendar with a count that is not a number',
      { calendar: { caption: 'Posts', days: [{ day: '2026-10-01', count: Infinity }] } },
    ],
  ];

  for (const [name, data] of invalid) {
    it(`draws an empty state for ${name} instead of throwing`, () => {
      const html = draw(data);
      assert.match(html, EMPTY);
      assert.doesNotMatch(html, /<svg/);
    });
  }

  it('keeps the caption it was given above the empty state', () => {
    assert.match(
      draw({ timeSeries: { caption: 'Views <a day>', days: [], series: [] } }),
      /Views &lt;a day&gt;.*No data to show\./,
    );
  });
});

describe('a paragraph and a table', () => {
  it('draws a paragraph of plain text and code, escaped', () => {
    assert.equal(
      draw({ paragraph: ['Run ', { code: 'geekity <x>' }, '.'] }),
      '<p class="text-sm">Run <code>geekity &lt;x&gt;</code>.</p>',
    );
  });

  it('draws a table with its caption, headings and cells', () => {
    const html = draw({
      table: {
        caption: 'Paths',
        columns: ['Path', 'Last asked for'],
        rows: [[{ code: '/old' }, { time: null }]],
      },
    });
    assert.match(html, /<caption class="sr-only">Paths<\/caption>/);
    assert.deepEqual(all(html, /<th scope="col">([^<]*)<\/th>/g), ['Path', 'Last asked for']);
    assert.match(
      html,
      /<td class="wrap-anywhere"><code>\/old<\/code><\/td><td class="whitespace-nowrap">Never<\/td>/,
    );
  });

  it('draws a link cell as a link when it goes to a path or a web address, and as text otherwise', () => {
    const html = draw({
      table: {
        caption: 'Links',
        columns: ['Where'],
        rows: [
          [{ text: 'Comments', href: '/admin/comments?status=pending#comment-1' }],
          [{ text: 'Elsewhere <b>', href: 'https://example.com/' }],
          [{ text: 'Script', href: 'javascript:alert(1)' }],
          [{ text: 'Protocol-relative', href: '//evil.example/' }],
        ],
      },
    });
    assert.match(
      html,
      /<td class="wrap-anywhere"><a class="link" href="\/admin\/comments\?status=pending#comment-1">Comments<\/a><\/td>/,
    );
    assert.match(
      html,
      /<td class="wrap-anywhere"><a class="link" href="https:\/\/example.com\/">Elsewhere &lt;b&gt;<\/a><\/td>/,
    );
    assert.match(html, /<td class="wrap-anywhere">Script<\/td>/);
    assert.match(html, /<td class="wrap-anywhere">Protocol-relative<\/td>/);
    assert.doesNotMatch(html, /javascript:|evil\.example/);
  });
});

describe('stats', () => {
  it('draws each value with its label', () => {
    const html = draw({ stats: [{ label: 'Visitors', value: 1284 }] });
    assert.match(
      html,
      /<div class="stat-title">Visitors<\/div><div class="stat-value">1,284<\/div>/,
    );
    assert.doesNotMatch(html, /stat-desc/);
  });

  it('wraps its stats onto more rows when a narrow card cannot fit them side by side', () => {
    const html = draw({
      stats: [
        { label: 'Visitors', value: 1234, previous: 1000 },
        { label: 'Bounce rate', value: 41, previous: 45, better: 'down' },
      ],
    });
    assert.match(html, /^<div class="stats flex flex-wrap [^"]*">/);
    assert.equal(all(html, /<div class="stat ([^"]*)">/g).length, 2);
    for (const classes of all(html, /<div class="stat ([^"]*)">/g)) {
      assert.match(classes, /\bflex-auto\b/);
      assert.match(classes, /\bw-auto\b/);
    }
  });

  it('says a rise from the previous period in words and a sign, not only colour', () => {
    const html = draw({ stats: [{ label: 'Visitors', value: 120, previous: 100 }] });
    assert.match(html, /<span aria-hidden="true">▲<\/span> \+20%, up from 100/);
  });

  it('says a fall in words and a minus sign', () => {
    const html = draw({ stats: [{ label: 'Visitors', value: 75, previous: 100 }] });
    assert.match(html, /<span aria-hidden="true">▼<\/span> −25%, down from 100/);
  });

  it('says when nothing changed', () => {
    assert.match(
      draw({ stats: [{ label: 'Visitors', value: 5, previous: 5 }] }),
      /No change from 5/,
    );
  });

  it('says a rise from nothing without a percentage', () => {
    assert.match(
      draw({ stats: [{ label: 'Visitors', value: 5, previous: 0 }] }),
      /<span aria-hidden="true">▲<\/span> Up from 0/,
    );
  });

  it('colours a change by whether it is better, through theme tokens', () => {
    assert.match(
      draw({ stats: [{ label: 'Visitors', value: 9, previous: 5 }] }),
      /class="stat-desc text-success"/,
    );
    assert.match(
      draw({ stats: [{ label: 'Bounce rate', value: 9, previous: 5, better: 'down' }] }),
      /class="stat-desc text-error"/,
    );
  });
});

describe('a stat format', () => {
  it('draws a percent as the percentage it is, to one decimal place', () => {
    const html = draw({ stats: [{ label: 'Bounce rate', value: 41.66, format: 'percent' }] });
    assert.match(html, /<div class="stat-value">41\.7%<\/div>/);
  });

  it('draws a duration in seconds as minutes and seconds', () => {
    const html = draw({ stats: [{ label: 'Average visit', value: 90, format: 'duration' }] });
    assert.match(html, /<div class="stat-value">1m 30s<\/div>/);
  });

  it('draws a duration under a minute in seconds and one over an hour in hours and minutes', () => {
    const html = draw({
      stats: [
        { label: 'Short', value: 42.4, format: 'duration' },
        { label: 'Long', value: 3 * 3600 + 5 * 60 + 9, format: 'duration' },
        { label: 'None', value: 0, format: 'duration' },
      ],
    });
    assert.deepEqual(all(html, /<div class="stat-value">([^<]*)<\/div>/g), ['42s', '3h 5m', '0s']);
  });

  it('draws a number as a number when the format is left out or is number', () => {
    const html = draw({ stats: [{ label: 'Views', value: 1284, format: 'number' }] });
    assert.match(html, /<div class="stat-value">1,284<\/div>/);
  });

  it('writes the previous value in the same format as the value', () => {
    assert.match(
      draw({
        stats: [
          { label: 'Bounce rate', value: 45, previous: 40, format: 'percent', better: 'down' },
        ],
      }),
      /\+13%, up from 40%/,
    );
    assert.match(
      draw({ stats: [{ label: 'Average visit', value: 60, previous: 120, format: 'duration' }] }),
      /−50%, down from 2m 0s/,
    );
    assert.match(
      draw({ stats: [{ label: 'Average visit', value: 60, previous: 60, format: 'duration' }] }),
      /No change from 1m 0s/,
    );
    assert.match(
      draw({ stats: [{ label: 'Bounce rate', value: 5, previous: 0, format: 'percent' }] }),
      /Up from 0%/,
    );
  });
});

describe('a time series', () => {
  const week = {
    timeSeries: {
      caption: 'Visitors and views',
      days: days('2026-10-14', 7),
      series: [
        { name: 'Visitors', values: [3, 5, 2, 8, 6, 4, 9] },
        { name: 'Views', values: [10, 12, 7, 20, 15, 11, 25] },
      ],
    },
  };

  it('draws a line for each series, each with its own colour, dash and marker', () => {
    const html = draw(week);
    const [first, second, ...rest] = lines(html);
    assert.equal(rest.length, 0);
    assert.match(first?.colour ?? '', /\bstroke-primary\b/);
    assert.match(second?.colour ?? '', /\bstroke-secondary\b/);
    assert.notEqual(first?.dash, second?.dash, 'the two lines are dashed differently');
  });

  it('names both series in a legend whose keys repeat the dash and the marker', () => {
    const html = draw(week);
    const legend = legendOf(html);
    assert.deepEqual(all(legend, /<span>([^<]*)<\/span><\/li>/g), ['Visitors', 'Views']);
    assert.deepEqual(
      all(legend, /stroke-dasharray="([^"]*)"/g),
      lines(html).map(({ dash }) => dash),
    );
    assert.match(legend, /<g class="fill-primary stroke-primary">.*<circle/);
    assert.match(legend, /<g class="fill-secondary stroke-secondary">.*<rect/);
  });

  it('labels the value axis with round ticks and every day of a week', () => {
    const html = draw(week);
    assert.deepEqual(
      all(html, /<text class="[^"]*" x="[^"]*" y="[^"]*" text-anchor="end"[^>]*>([^<]*)</g),
      ['0', '10', '20', '30'],
    );
    assert.deepEqual(
      all(html, /<text class="[^"]*" x="[^"]*" y="[^"]*" text-anchor="middle"[^>]*>([^<]*)</g),
      ['14 Oct', '15 Oct', '16 Oct', '17 Oct', '18 Oct', '19 Oct', '20 Oct'],
    );
  });

  it('labels a month with a readable few days, the last day among them', () => {
    const html = draw({
      timeSeries: {
        caption: 'Views',
        days: days('2026-09-21', 30),
        series: [
          { name: 'Visitors', values: Array.from({ length: 30 }, (_, index) => index) },
          { name: 'Views', values: Array.from({ length: 30 }, (_, index) => index * 2) },
        ],
      },
    });
    const ticks = all(
      html,
      /<text class="[^"]*" x="[^"]*" y="[^"]*" text-anchor="middle"[^>]*>([^<]*)</g,
    );
    assert.ok(ticks.length >= 4 && ticks.length <= 8, `${String(ticks.length)} day ticks`);
    assert.equal(ticks.at(-1), '20 Oct');
  });

  it('has a description and a table of every value that a screen reader reaches', () => {
    const html = draw(week);
    assert.match(html, /<svg role="img" aria-labelledby="(chart-[^"]+)"[^>]*>.*<\/svg>/);
    assert.match(
      html,
      /<p id="chart-[^"]+" class="sr-only">Visitors and views, 7 days from 14 Oct to 20 Oct\.<\/p>/,
    );
    const table = /<table[^>]*>(.*?)<\/table>/.exec(html)?.[1] ?? '';
    assert.deepEqual(all(table, /<th scope="col">([^<]*)<\/th>/g), ['Day', 'Visitors', 'Views']);
    assert.match(table, /<th scope="row">14 Oct 2026<\/th><td>3<\/td><td>10<\/td>/);
    assert.match(table, /<th scope="row">20 Oct 2026<\/th><td>9<\/td><td>25<\/td>/);
  });

  it('gives each day a hover title with every series', () => {
    assert.match(draw(week), /<title>17 Oct: Visitors 8, Views 20<\/title>/);
  });

  it('draws a single series with no legend', () => {
    const html = draw({
      timeSeries: {
        caption: 'Views',
        days: days('2026-10-14', 2),
        series: [{ name: 'Views', values: [1, 2] }],
      },
    });
    assert.match(html, /<svg/);
    assert.equal(legendOf(html), '');
  });

  it('draws a single day', () => {
    assert.match(
      draw({
        timeSeries: {
          caption: 'Views',
          days: ['2026-10-14'],
          series: [{ name: 'Views', values: [0] }],
        },
      }),
      /14 Oct/,
    );
  });
});

describe('a ranked list', () => {
  it('lists items by value, largest first, with a bar for each', () => {
    const html = draw({
      ranked: {
        caption: 'Top pages',
        items: [
          { label: '/about', value: 4 },
          { label: '/', value: 16, href: '/admin/posts' },
        ],
      },
    });
    assert.match(html, /<ol aria-label="Top pages"/);
    assert.deepEqual(all(html, /<span class="truncate">(?:<a [^>]*>)?([^<]*)</g), ['/', '/about']);
    assert.match(html, /<a class="link" href="\/admin\/posts">\/<\/a>/);
    assert.deepEqual(all(html, /<rect class="fill-primary" [^>]*width="([^"]*)"/g), ['100', '25']);
  });

  it('drops a link that is not a web address or a path', () => {
    const html = draw({
      ranked: { caption: 'Pages', items: [{ label: 'x', value: 1, href: 'javascript:alert(1)' }] },
    });
    assert.doesNotMatch(html, /<a /);
    assert.match(html, />x</);
  });
});

describe('a calendar', () => {
  const calendar = {
    calendar: {
      caption: 'Posts',
      days: [
        { day: '2026-10-05', count: 1 },
        { day: '2026-10-07', count: 4 },
        { day: '2026-10-18', count: 2 },
      ],
    },
  };

  it('draws a square for every day from the first to the last, shaded by count', () => {
    const html = draw(calendar);
    const cells = all(html, /<rect class="([^"]*)"[^>]*><title>[^<]*<\/title><\/rect>/g);
    assert.equal(cells.length, 14);
    assert.ok(cells.includes('fill-primary'), 'the busiest day is the full colour');
    assert.ok(cells.includes('fill-base-content/10'), 'a day with none is the empty step');
    assert.match(html, /<title>7 Oct 2026: 4<\/title>/);
  });

  it('says what it shows in words and a table', () => {
    const html = draw(calendar);
    assert.match(
      html,
      /<p id="chart-[^"]+" class="sr-only">Posts, 14 days from 5 Oct to 18 Oct: 7 in all, most on 7 Oct \(4\)\.<\/p>/,
    );
    const table = /<table[^>]*>(.*?)<\/table>/.exec(html)?.[1] ?? '';
    assert.match(table, /<th scope="row">5 Oct 2026<\/th><td>1<\/td>/);
    assert.doesNotMatch(table, /6 Oct/);
  });

  it('shrinks a year to its card down to a readable floor and opens on the newest weeks', () => {
    const start = Date.UTC(2025, 9, 22);
    const year = {
      calendar: {
        caption: 'Posts',
        days: Array.from({ length: 364 }, (_, offset) => ({
          day: new Date(start + offset * 86_400_000).toISOString().slice(0, 10),
          count: offset % 3,
        })),
      },
    };
    const html = draw(year);
    assert.match(html, /<div class="flex flex-row-reverse overflow-x-auto">/);
    const svg = /<svg role="img"[^>]*>/.exec(html)?.[0] ?? '';
    assert.match(svg, /class="mr-auto h-auto max-w-full min-w-160 shrink-0"/);
    assert.match(svg, /width="965"/);
  });

  it('keeps a short calendar at its own size', () => {
    const svg = /<svg role="img"[^>]*>/.exec(draw(calendar))?.[0] ?? '';
    assert.match(svg, /class="mr-auto h-auto shrink-0"/);
  });
});

describe('bars', () => {
  const bars = {
    bars: {
      caption: 'Posts per month',
      groups: ['Aug', 'Sep', 'Oct'],
      series: [
        { name: 'Notes', values: [2, 0, 3] },
        { name: 'Photos', values: [1, 0, 1] },
      ],
    },
  };

  function segments(html: string): { height: number; title: string }[] {
    return [
      ...html.matchAll(
        /<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)"><title>([^<]*)<\/title>/g,
      ),
    ].map(([, height, title]) => ({ height: Number(height), title: title ?? '' }));
  }

  it('stacks a segment for every series with a value, taller for more, each with a hover title', () => {
    const drawn = segments(draw(bars));
    assert.deepEqual(
      drawn.map(({ title }) => title),
      ['Aug: Notes 2 of 3', 'Aug: Photos 1 of 3', 'Oct: Notes 3 of 4', 'Oct: Photos 1 of 4'],
    );
    const [augNotes, augPhotos, octNotes] = drawn;
    assert.ok((octNotes?.height ?? 0) > (augNotes?.height ?? 0));
    assert.ok((augNotes?.height ?? 0) > (augPhotos?.height ?? 0));
  });

  it('labels every group, and each bar with its total', () => {
    const html = draw(bars);
    assert.deepEqual(
      all(
        html,
        /<text class="fill-base-content\/70"[^>]*text-anchor="middle"[^>]*>([^<]*)<\/text>/g,
      ),
      ['Aug', 'Sep', 'Oct'],
    );
    assert.deepEqual(
      all(html, /<text class="fill-base-content font-semibold"[^>]*>([^<]*)<\/text>/g),
      ['3', '4'],
    );
  });

  it('marks each series with its own texture as well as its colour, repeated in the legend', () => {
    const html = draw(bars);
    const legend = legendOf(html);
    assert.match(legend, /Notes/);
    assert.match(legend, /Photos/);
    assert.match(legend, /fill-primary/);
    assert.match(legend, /fill-secondary/);
    assert.match(legend, /fill="url\(#chart-\d+-texture-1\)"/);
    assert.match(html, /<pattern id="chart-\d+-texture-1"/);
  });

  it('says what it shows in words and a table with a total column', () => {
    const html = draw(bars);
    assert.match(
      html,
      /<p id="chart-[^"]+" class="sr-only">Posts per month, Aug to Oct: 7 in all, most in Oct \(4\)\.<\/p>/,
    );
    const table = /<table[^>]*>(.*?)<\/table>/.exec(html)?.[1] ?? '';
    assert.match(
      table,
      /<th scope="col">Notes<\/th><th scope="col">Photos<\/th><th scope="col">Total<\/th>/,
    );
    assert.match(table, /<th scope="row">Sep<\/th><td>0<\/td><td>0<\/td><td>0<\/td>/);
  });

  it('draws a single series with no legend', () => {
    const html = draw({
      bars: { caption: 'Posts', groups: ['Oct'], series: [{ name: 'Posts', values: [2] }] },
    });
    assert.equal(legendOf(html), '');
    assert.equal(segments(html).length, 1);
  });

  it('draws groups that all hold nothing as bars of nothing, not an empty state', () => {
    const html = draw({
      bars: {
        caption: 'Posts',
        groups: ['Sep', 'Oct'],
        series: [{ name: 'Posts', values: [0, 0] }],
      },
    });
    assert.doesNotMatch(html, EMPTY);
    assert.equal(segments(html).length, 0);
    assert.match(html, /Posts, Sep to Oct: none\./);
  });
});

describe('every chart', () => {
  const charts: unknown[] = [
    {
      timeSeries: {
        caption: 'Views',
        days: days('2026-10-14', 7),
        series: [
          { name: 'A', values: [1, 2, 3, 4, 5, 6, 7] },
          { name: 'B', values: [7, 6, 5, 4, 3, 2, 1] },
          { name: 'C', values: [2, 2, 2, 2, 2, 2, 2] },
          { name: 'D', values: [0, 1, 0, 1, 0, 1, 0] },
        ],
      },
    },
    { ranked: { caption: 'Pages', items: [{ label: '/', value: 1 }] } },
    { calendar: { caption: 'Posts', days: [{ day: '2026-10-05', count: 1 }] } },
    {
      bars: {
        caption: 'Posts',
        groups: ['Sep', 'Oct'],
        series: ['A', 'B', 'C', 'D'].map((name) => ({ name, values: [1, 2] })),
      },
    },
    { stats: [{ label: 'Visitors', value: 9, previous: 5 }] },
  ];

  it('takes its colours from theme tokens, never a written colour', () => {
    for (const chart of charts) {
      const html = draw(chart);
      assert.doesNotMatch(
        html,
        /#[0-9a-f]{3,8}\b|rgb\(|hsl\(|oklch\(|(?:fill|stroke)="(?!none|url\(#)[a-z]/i,
      );
      assert.doesNotMatch(html, /style=/);
    }
  });

  it('gives four series four colours, four dashes and four markers', () => {
    const html = draw(charts[0]);
    const drawn = lines(html);
    assert.equal(new Set(drawn.map(({ colour }) => colour)).size, 4);
    assert.equal(new Set(drawn.map(({ dash }) => dash)).size, 4);
    assert.deepEqual(all(legendOf(html), /<(circle|rect|polygon) /g), [
      'circle',
      'rect',
      'polygon',
      'polygon',
    ]);
    assert.notEqual(
      /<polygon[^>]* points="([^"]*)"/.exec(legendOf(html))?.[1]?.split(' ').length,
      [...legendOf(html).matchAll(/<polygon[^>]* points="([^"]*)"/g)].at(-1)?.[1]?.split(' ')
        .length,
      'a triangle and a diamond',
    );
  });

  it('draws a fifth series as no chart rather than a colour it does not have', () => {
    const series = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name, values: [1] }));
    assert.match(draw({ timeSeries: { caption: 'Views', days: ['2026-10-14'], series } }), EMPTY);
    assert.match(draw({ bars: { caption: 'Posts', groups: ['Oct'], series } }), EMPTY);
  });
});
