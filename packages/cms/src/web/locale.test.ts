import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { archiveMonths, createTemplateEnvironment, formatDate, themeSearchPath } from './index.ts';
import { siteLocale } from './context.ts';
import type { Document } from '../content/document.ts';

const environment = () =>
  createTemplateEnvironment({
    themeDirs: themeSearchPath('/no/such/theme'),
    baseUrl: 'https://geekity.example',
  });

const instant = '2026-09-02T09:00:00Z';

describe('the site locale', () => {
  it('is the locale setting when the site names one', () => {
    assert.equal(siteLocale({ title: '', url: '', language: 'en', locale: 'en-US' }), 'en-US');
  });

  it('is the site language when there is no locale setting', () => {
    assert.equal(siteLocale({ title: '', url: '', language: 'fr' }), 'fr');
    assert.equal(siteLocale({ title: '', url: '', language: 'fr', locale: '' }), 'fr');
  });

  it('is en when the site names neither', () => {
    assert.equal(siteLocale({ title: '', url: '' }), 'en');
  });

  it('is en when the tag is not one Intl can format in', () => {
    assert.equal(siteLocale({ title: '', url: '', locale: 'not a locale' }), 'en');
  });
});

describe('dates in a locale', () => {
  it('names the month in the locale’s own language and order', () => {
    assert.equal(formatDate(instant, 'long', 'UTC', 'fr'), '2 septembre 2026');
    assert.equal(formatDate(instant, 'long', 'UTC', 'de'), '2. September 2026');
    assert.equal(formatDate(instant, 'long', 'UTC', 'en-US'), 'September 2, 2026');
    assert.equal(formatDate(instant, 'month', 'UTC', 'fr'), 'septembre 2026');
  });

  it('takes a style rather than a fixed format', () => {
    assert.equal(formatDate(instant, 'short', 'UTC', 'en-US'), '9/2/26');
    assert.equal(formatDate(instant, 'medium', 'UTC', 'fr'), '2 sept. 2026');
    assert.equal(formatDate(instant, 'full', 'UTC', 'fr'), 'mercredi 2 septembre 2026');
  });

  it('keeps readable as the long style', () => {
    assert.equal(formatDate(instant, 'readable', 'UTC', 'fr'), '2 septembre 2026');
  });

  it('reads the calendar day in the zone before it formats it', () => {
    assert.equal(
      formatDate('2026-09-02T02:00:00Z', 'long', 'America/Chicago', 'fr'),
      '1 septembre 2026',
    );
  });

  it('keeps iso the instant and html the ISO calendar day in every locale', () => {
    assert.equal(formatDate(instant, 'iso', 'UTC', 'ar-EG'), '2026-09-02T09:00:00.000Z');
    assert.equal(formatDate(instant, 'html', 'UTC', 'ar-EG'), '2026-09-02');
  });

  it('prints an en site’s dates exactly as it always has', () => {
    assert.equal(formatDate(instant, 'readable', 'UTC', 'en'), '2 September 2026');
    assert.equal(formatDate(instant, 'month', 'UTC', 'en'), 'September 2026');
    assert.equal(formatDate(instant, 'year', 'UTC', 'en'), '2026');
    assert.equal(formatDate(instant, 'readable'), '2 September 2026', 'and en is the default');
  });

  it('renders nothing rather than throwing for a zone Intl does not know', () => {
    assert.equal(formatDate(instant, 'long', 'Not/A_Zone', 'fr'), '');
  });

  it('groups an archive under month headings in the locale', () => {
    const post = { date: instant, title: 'Hello', permalink: '/2026/09/hello/' } as Document;

    assert.deepEqual(
      archiveMonths([post], 'UTC', 'fr').map((month) => month.month),
      ['septembre 2026'],
    );
  });
});

describe('the date filter in a locale', () => {
  it('formats in the locale of the site the template is rendering', () => {
    const env = environment();

    assert.equal(
      env.renderString('{{ d | date }}', { site: { language: 'fr' }, d: instant }),
      '2 septembre 2026',
    );
    assert.equal(
      env.renderString('{{ d | date("long") }}', {
        site: { language: 'en', locale: 'en-US' },
        d: instant,
      }),
      'September 2, 2026',
    );
    assert.equal(env.renderString('{{ d | date }}', { d: instant }), '2 September 2026');
  });

  it('takes a locale of its own after the zone, for a date in another language', () => {
    const env = environment();
    const site = { language: 'en', timezone: 'America/New_York' };
    const late = '2026-09-02T02:00:00Z';

    assert.equal(
      env.renderString('{{ d | date("long", none, "fr-ca") }}', { site, d: late }),
      '1 septembre 2026',
    );
    assert.equal(
      env.renderString('{{ d | date("long", "", lang) }}', { site, d: late, lang: 'de' }),
      '1. September 2026',
    );
    assert.equal(
      env.renderString('{{ d | date("long", "UTC", "fr") }}', { site, d: late }),
      '2 septembre 2026',
    );
  });

  it('writes in the site locale when the locale it is given is empty or no tag', () => {
    const env = environment();
    const site = { language: 'en' };

    for (const lang of [undefined, null, '', 'not a tag']) {
      assert.equal(
        env.renderString('{{ d | date("long", none, lang) }}', { site, d: instant, lang }),
        '2 September 2026',
        `lang ${String(lang)}`,
      );
    }
  });

  it('writes an ISO 8601 datetime on a time element whatever the locale', () => {
    const env = environment();

    assert.equal(
      env.renderString('<time datetime="{{ d | date("iso") }}">{{ d | date }}</time>', {
        site: { language: 'fr' },
        d: instant,
      }),
      '<time datetime="2026-09-02T09:00:00.000Z">2 septembre 2026</time>',
    );
  });
});

describe('the plural filter', () => {
  const render = (template: string, context: Record<string, unknown>) =>
    environment().renderString(template, context);

  it('picks the form by the locale’s plural category', () => {
    const template =
      '{{ n | plural({ one: "# комментарий", few: "# комментария", many: "# комментариев", other: "# комментария" }) }}';
    const site = { language: 'ru' };

    assert.equal(render(template, { site, n: 1 }), '1 комментарий');
    assert.equal(render(template, { site, n: 21 }), '21 комментарий');
    assert.equal(render(template, { site, n: 3 }), '3 комментария');
    assert.equal(render(template, { site, n: 5 }), '5 комментариев');
  });

  it('falls back to other when the forms have no entry for the category', () => {
    assert.equal(
      render('{{ n | plural({ one: "One reply", other: "# replies" }) }}', {
        site: { language: 'ru' },
        n: 5,
      }),
      '5 replies',
    );
  });

  it('writes the count in the locale’s digits', () => {
    assert.equal(
      render('{{ n | plural({ other: "# ردود" }) }}', { site: { language: 'ar-EG' }, n: 3 }),
      '٣ ردود',
    );
  });

  it('keeps an en count ungrouped, as it always has been', () => {
    assert.equal(
      render('{{ n | plural({ one: "One reply", other: "# replies" }) }}', { n: 1000 }),
      '1000 replies',
    );
  });

  it('takes a locale of its own for strings written in another language', () => {
    const template = '{{ n | plural({ one: "One reply", other: "# replies" }, "en") }}';

    assert.equal(render(template, { site: { language: 'ru' }, n: 21 }), '21 replies');
    assert.equal(render(template, { site: { language: 'ru' }, n: 1 }), 'One reply');
  });

  it('escapes the form it picks', () => {
    assert.equal(
      render('{{ n | plural({ other: "# <b>replies</b>" }) }}', { n: 2 }),
      '2 &lt;b&gt;replies&lt;/b&gt;',
    );
  });
});
