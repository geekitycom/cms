import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseHtml } from '../util/html-tree.ts';
import {
  MICROFORMAT_ITEMS_PER_PAGE,
  MICROFORMAT_VALUE_LENGTH,
  itemsIn,
  linksTo,
  sourceEntry,
} from './microformats.ts';
import type { MicroformatItem } from './microformats.ts';

const SOURCE = 'https://them.example/2026/09/reply/';
const TARGET = 'https://blog.example/2026/09/hello/';
const isTarget = (url: string): boolean => url === TARGET;

describe('linksTo', () => {
  it('sees a link to the target', () => {
    assert.equal(linksTo(`<p><a href="${TARGET}">yes</a></p>`, SOURCE, TARGET), true);
  });

  it('sees a relative link that resolves to the target', () => {
    assert.equal(
      linksTo('<a href="/2026/09/hello/">yes</a>', 'https://blog.example/other/', TARGET),
      true,
    );
  });

  it('sees a link inside an image or a video, which is still a mention', () => {
    assert.equal(linksTo(`<img src="${TARGET}" alt="">`, SOURCE, TARGET), true);
  });

  it('does not see a target that is only mentioned in the text', () => {
    assert.equal(linksTo(`<p>${TARGET}</p>`, SOURCE, TARGET), false);
  });

  it('does not see a link to somewhere else', () => {
    assert.equal(linksTo('<a href="https://blog.example/other/">no</a>', SOURCE, TARGET), false);
  });

  it('does not see the target inside a script', () => {
    assert.equal(linksTo(`<script>var a = "${TARGET}";</script>`, SOURCE, TARGET), false);
  });

  it('reads the first of two href attributes, as a browser does', () => {
    assert.equal(
      linksTo(`<a href="https://elsewhere.example/" href="${TARGET}">x</a>`, SOURCE, TARGET),
      false,
    );
    assert.equal(
      linksTo(`<a href="${TARGET}" href="https://elsewhere.example/">x</a>`, SOURCE, TARGET),
      true,
    );
  });

  it('does not see a link written inside a textarea or the title, which are text', () => {
    assert.equal(linksTo(`<textarea><a href="${TARGET}">x</a></textarea>`, SOURCE, TARGET), false);
    assert.equal(
      linksTo(`<html><head><title><a href="${TARGET}">x</a></title></head></html>`, SOURCE, TARGET),
      false,
    );
  });

  it('does not see a link inside a template, which is never shown', () => {
    assert.equal(linksTo(`<template><a href="${TARGET}">x</a></template>`, SOURCE, TARGET), false);
  });

  it('sees a link after a textarea, a title or a template closes', () => {
    const page = `<title>t</title><textarea>a</textarea><template><b>c</b></template><a href="${TARGET}">x</a>`;
    assert.equal(linksTo(page, SOURCE, TARGET), true);
  });
});

describe('sourceEntry', () => {
  it('reads a reply: its kind, its author, its content and when it was published', () => {
    const html = `
      <article class="h-entry">
        <a class="p-author h-card" href="https://them.example/">Ada Lovelace</a>
        <a class="u-in-reply-to" href="${TARGET}">in reply to</a>
        <div class="e-content"><p>Good <em>post</em>.</p></div>
        <time class="dt-published" datetime="2026-09-21T10:30:00Z">21 September</time>
        <a class="u-url" href="${SOURCE}">permalink</a>
      </article>`;

    const entry = sourceEntry(html, SOURCE, isTarget);

    assert.equal(entry.kind, 'reply');
    assert.equal(entry.author.name, 'Ada Lovelace');
    assert.equal(entry.author.url, 'https://them.example/');
    assert.equal(entry.content.html, '<p>Good <em>post</em>.</p>');
    assert.equal(entry.published, '2026-09-21T10:30:00.000Z');
    assert.equal(entry.url, SOURCE);
  });

  it('reads a like', () => {
    const html = `<div class="h-entry"><a class="u-like-of" href="${TARGET}">liked</a></div>`;
    assert.equal(sourceEntry(html, SOURCE, isTarget).kind, 'like');
  });

  it('reads a repost', () => {
    const html = `<div class="h-entry"><a class="u-repost-of" href="${TARGET}">boosted</a></div>`;
    assert.equal(sourceEntry(html, SOURCE, isTarget).kind, 'repost');
  });

  it('reads a plain link in the content as a mention', () => {
    const html = `
      <div class="h-entry">
        <h1 class="p-name">Some thoughts</h1>
        <div class="e-content"><p>As <a href="${TARGET}">they</a> said.</p></div>
      </div>`;

    const entry = sourceEntry(html, SOURCE, isTarget);
    assert.equal(entry.kind, 'mention');
  });

  it('picks the h-entry that links to the target, not the first on the page', () => {
    const html = `
      <div class="h-entry"><a class="p-author h-card" href="https://them.example/one">One</a>
        <div class="e-content"><a href="https://elsewhere.example/">elsewhere</a></div></div>
      <div class="h-entry"><a class="p-author h-card" href="https://them.example/two">Two</a>
        <a class="u-in-reply-to" href="${TARGET}">re</a></div>`;

    assert.equal(sourceEntry(html, SOURCE, isTarget).author.name, 'Two');
  });

  it('takes an author from a page-level h-card when the entry names none', () => {
    const html = `
      <div class="h-card"><a class="u-url p-name" href="https://them.example/">Grace</a>
        <img class="u-photo" src="/me.jpg" alt=""></div>
      <div class="h-entry"><div class="e-content"><a href="${TARGET}">there</a></div></div>`;

    const entry = sourceEntry(html, SOURCE, isTarget);
    assert.equal(entry.author.name, 'Grace');
    assert.equal(entry.author.url, 'https://them.example/');
    assert.equal(entry.author.photo, 'https://them.example/me.jpg');
  });

  it('falls back to the page title and the host when the page has no microformats', () => {
    const html = `<html><head><title>A note</title></head><body><p><a href="${TARGET}">there</a></p></body></html>`;

    const entry = sourceEntry(html, SOURCE, isTarget);
    assert.equal(entry.kind, 'mention');
    assert.equal(entry.author.name, 'them.example');
    assert.equal(entry.content.text, 'A note');
    assert.equal(entry.url, SOURCE);
  });

  it('resolves relative URLs against a base element when the page has one', () => {
    const html = `
      <html><head><base href="https://them.example/blog/"></head><body>
      <div class="h-entry"><a class="p-author h-card" href="me/">Ada</a>
      <a class="u-in-reply-to" href="${TARGET}">re</a></div></body></html>`;

    assert.equal(sourceEntry(html, SOURCE, isTarget).author.url, 'https://them.example/blog/me/');
  });

  it('leaves the published date null when the page did not say one', () => {
    const html = `<div class="h-entry"><a class="u-like-of" href="${TARGET}">liked</a></div>`;
    assert.equal(sourceEntry(html, SOURCE, isTarget).published, null);
  });

  it('reads a name given as text rather than as an h-card', () => {
    const html = `
      <div class="h-entry"><span class="p-author">Alan Turing</span>
      <a class="u-in-reply-to" href="${TARGET}">re</a></div>`;

    const entry = sourceEntry(html, SOURCE, isTarget);
    assert.equal(entry.author.name, 'Alan Turing');
    assert.equal(entry.author.url, null);
  });

  it('decodes named character references in the author and the content', () => {
    const html = `
      <article class="h-entry">
        <a class="p-author h-card" href="https://them.example/">Ren&eacute;</a>
        <a class="u-in-reply-to" href="${TARGET}">in reply to</a>
        <div class="e-content"><p>It&rsquo;s here&hellip;</p></div>
      </article>`;

    const entry = sourceEntry(html, SOURCE, isTarget);

    assert.equal(entry.author.name, 'René');
    assert.equal(entry.content.text, 'It’s here…');
    assert.equal(entry.content.html, '<p>It’s here…</p>');
  });
});

describe('what an entry answers', () => {
  it('names each thing once, and only the first few', () => {
    const others = Array.from(
      { length: 20 },
      (_, i) => `<a class="u-in-reply-to" href="https://elsewhere.example/${i}">${i}</a>`,
    ).join('');
    const html = `<article class="h-entry">
      <a class="u-in-reply-to" href="${TARGET}">the post</a>
      <a class="u-in-reply-to" href="${TARGET}">the post again</a>${others}
    </article>`;

    const { inReplyTo } = sourceEntry(html, SOURCE, isTarget);

    assert.equal(inReplyTo[0], TARGET);
    assert.equal(new Set(inReplyTo).size, inReplyTo.length);
    assert.ok(inReplyTo.length > 1 && inReplyTo.length <= 10, `kept ${inReplyTo.length}`);
  });
});

describe('sourceEntry replies (TASK-320)', () => {
  const entry = (inside: string): string => `
    <article class="h-entry">
      <a class="u-url" href="${SOURCE}">permalink</a>
      <a class="u-in-reply-to" href="${TARGET}">re</a>
      <div class="e-content"><p>The reply.</p></div>
      ${inside}
    </article>`;

  it('reads the p-comment h-cites of the entry, each with its own replies nested under it', () => {
    const html = entry(`
      <div class="p-comment h-cite">
        <a class="p-author h-card" href="https://carol.example/">Carol</a>
        <a class="u-url" href="https://carol.example/1"><time class="dt-published" datetime="2026-09-21T10:00:00Z">then</time></a>
        <div class="e-content"><p>Carol answers.</p></div>
        <div class="p-comment h-cite">
          <span class="p-author h-card"><span class="p-name">Dan</span></span>
          <a class="u-url" href="https://dan.example/2">link</a>
          <div class="e-content"><p>Dan answers Carol.</p></div>
        </div>
      </div>
      <div class="p-comment h-cite"><div class="e-content">No page of its own.</div></div>`);

    const replies = sourceEntry(html, SOURCE, isTarget).replies;
    assert.equal(replies.length, 1, 'one with no url has no identity and is left out');
    const carol = replies[0];
    assert.equal(carol?.url, 'https://carol.example/1');
    assert.deepEqual(carol?.author, { name: 'Carol', url: 'https://carol.example/', photo: null });
    assert.equal(carol?.content.html, '<p>Carol answers.</p>');
    assert.equal(carol?.published, '2026-09-21T10:00:00.000Z');
    assert.equal(carol?.replies.length, 1);
    assert.equal(carol?.replies[0]?.url, 'https://dan.example/2');
    assert.equal(carol?.replies[0]?.author.name, 'Dan');
    assert.equal(carol?.replies[0]?.content.text, 'Dan answers Carol.');
  });

  it('reads a child h-entry that answers the entry as one of its replies', () => {
    const html = entry(`
      <article class="h-entry">
        <a class="u-url" href="https://erin.example/3">link</a>
        <a class="u-in-reply-to" href="${SOURCE}">re</a>
        <div class="e-content"><p>Erin answers.</p></div>
      </article>
      <article class="h-entry">
        <a class="u-url" href="https://frank.example/4">link</a>
        <div class="e-content"><p>Frank answers nothing here.</p></div>
      </article>`);

    const replies = sourceEntry(html, SOURCE, isTarget).replies;
    assert.deepEqual(
      replies.map((reply) => reply.url),
      ['https://erin.example/3'],
    );
  });

  it('has no replies when the entry carries none, and stops at a bounded depth', () => {
    assert.deepEqual(sourceEntry(entry(''), SOURCE, isTarget).replies, []);

    let nested = '';
    for (let depth = 20; depth > 0; depth -= 1) {
      nested = `<div class="p-comment h-cite"><a class="u-url" href="https://deep.example/${String(depth)}">x</a>${nested}</div>`;
    }
    let deepest = 0;
    let level = sourceEntry(entry(nested), SOURCE, isTarget).replies;
    while (level.length > 0) {
      deepest += 1;
      level = level[0]?.replies ?? [];
    }
    assert.ok(deepest > 1 && deepest < 20, `read ${String(deepest)} levels of twenty`);
  });
});

describe('implied properties of an h-card author', () => {
  const author = (card: string) =>
    sourceEntry(
      `<div class="h-entry">${card}<a class="u-in-reply-to" href="${TARGET}">re</a></div>`,
      SOURCE,
      isTarget,
    ).author;

  it('implies the url and photo from a link wrapping an avatar', () => {
    assert.deepEqual(
      author(
        `<span class="p-author h-card"><a href="/ada"><img src="/ada.jpg" alt=""></a> Ada</span>`,
      ),
      { name: 'Ada', url: 'https://them.example/ada', photo: 'https://them.example/ada.jpg' },
    );
  });

  it('implies the url and photo from the only element inside the card', () => {
    assert.deepEqual(
      author(`<span class="p-author h-card"><span><a href="/ada">Ada</a></span></span>`),
      { name: 'Ada', url: 'https://them.example/ada', photo: null },
    );
    assert.deepEqual(
      author(`<span class="p-author h-card"><span><img src="/ada.jpg" alt=""></span>Ada</span>`),
      { name: 'Ada', url: null, photo: 'https://them.example/ada.jpg' },
    );
  });

  it('implies nothing from a link or avatar nested deeper than that', () => {
    assert.deepEqual(
      author(
        `<span class="p-author h-card"><b><i><a href="/ada"><img src="/ada.jpg" alt=""></a></i></b>Ada</span>`,
      ),
      { name: 'Ada', url: null, photo: null },
    );
  });

  it('implies nothing when the card holds two links or two avatars side by side', () => {
    assert.deepEqual(
      author(
        `<span class="p-author h-card"><a href="/a"><img src="/a.jpg" alt=""></a><a href="/b"><img src="/b.jpg" alt=""></a>Ada</span>`,
      ),
      { name: 'Ada', url: null, photo: null },
    );
  });
});

describe('reading a deeply nested page', () => {
  function timed<T>(run: () => T): { value: T; ms: number } {
    const started = performance.now();
    const value = run();
    return { value, ms: performance.now() - started };
  }

  it('checks the link on 4,000 nested divs in well under 100 ms', () => {
    const depth = 4_000;
    const page = '<div>'.repeat(depth) + `<a href="${TARGET}">hi</a>` + '</div>'.repeat(depth);
    const { value, ms } = timed(() => linksTo(page, SOURCE, TARGET));
    assert.equal(value, true);
    assert.ok(ms < 100, `linksTo took ${Math.round(ms)} ms for ${page.length} bytes`);
  });

  it('reads 800 nested h-entry divs that link to the target in well under a second', () => {
    const depth = 800;
    const page =
      `<a href="${TARGET}">hi</a>` +
      '<div class="h-entry">x'.repeat(depth) +
      '</div>'.repeat(depth);
    const { value, ms } = timed(() => sourceEntry(page, SOURCE, isTarget));
    assert.equal(value.kind, 'mention');
    assert.ok(ms < 500, `sourceEntry took ${Math.round(ms)} ms for ${page.length} bytes`);
  });

  it('reads a 24-deep chain of roots that each carry two property classes in well under a second', () => {
    const depth = 24;
    const page =
      `<div class="h-entry"><a href="${TARGET}">hello</a>` +
      '<div class="p-a p-b h-x">x'.repeat(depth) +
      '</div>'.repeat(depth) +
      '</div>';
    const { value, ms } = timed(() => sourceEntry(page, SOURCE, isTarget));
    assert.equal(value.kind, 'mention');
    assert.ok(ms < 500, `sourceEntry took ${Math.round(ms)} ms for ${page.length} bytes`);
  });

  it('reads a 500-deep chain of roots that each carry three property classes in well under a second', () => {
    const depth = 500;
    const page =
      `<div class="h-entry"><a href="${TARGET}">hello</a>` +
      '<div class="p-a p-b p-c h-entry">x'.repeat(depth) +
      '</div>'.repeat(depth) +
      '</div>';
    const { value, ms } = timed(() => sourceEntry(page, SOURCE, isTarget));
    assert.equal(value.kind, 'mention');
    assert.ok(ms < 1_000, `sourceEntry took ${Math.round(ms)} ms for ${page.length} bytes`);
  });

  it('looks for a link to the target in 500 nested entries over thousands of links in well under a second', () => {
    const depth = 500;
    const links = `<a href="https://elsewhere.example/a">a</a>`.repeat(20_000);
    const page =
      `<a href="${TARGET}">hi</a>` +
      '<div class="h-entry">x'.repeat(depth) +
      links +
      '</div>'.repeat(depth);
    const { value, ms } = timed(() => sourceEntry(page, SOURCE, isTarget));
    assert.equal(value.kind, 'mention');
    assert.ok(ms < 1_000, `sourceEntry took ${Math.round(ms)} ms for ${page.length} bytes`);
  });
});

describe('how many microformats one page may hold', () => {
  const plain = '<div class="h-entry"><p class="p-name">another post</p></div>';
  const like = `<div class="h-entry"><a class="u-like-of" href="${TARGET}">liked</a></div>`;

  it('reads the last item that fits under the limit', () => {
    const page = plain.repeat(MICROFORMAT_ITEMS_PER_PAGE - 1) + like;
    assert.equal(sourceEntry(page, SOURCE, isTarget).kind, 'like');
  });

  it('reads no item past the limit, nested items counted', () => {
    const nested = '<div class="h-entry"><div class="p-author h-card">Ada</div></div>';
    const page = nested.repeat(MICROFORMAT_ITEMS_PER_PAGE / 2) + like;
    assert.equal(sourceEntry(page, SOURCE, isTarget).kind, 'mention');
  });

  it('reads a page of 50,000 entries that link to the target in well under a second', () => {
    const page = `<div class="h-entry"><a href="${TARGET}">hi</a></div>`.repeat(50_000);
    const started = performance.now();
    const entry = sourceEntry(page, SOURCE, isTarget);
    const ms = performance.now() - started;
    assert.equal(entry.kind, 'mention');
    assert.ok(ms < 1_000, `sourceEntry took ${Math.round(ms)} ms for ${page.length} bytes`);
  });
});

describe('how much of one element is kept', () => {
  function keptLength(item: MicroformatItem): number {
    let total = 0;
    for (const values of Object.values(item.properties)) {
      for (const value of values) {
        total += value.text.length + (value.html?.length ?? 0);
        if (value.item !== undefined) total += keptLength(value.item);
      }
    }
    return total;
  }

  const text = 'word '.repeat(4_000);
  const repeated = `<div class="h-entry"><div class="${'e-content '.repeat(500)}">${text}</div></div>`;

  it('reads a property class repeated on one element once', () => {
    const [entry] = itemsIn(parseHtml(repeated), SOURCE);
    assert.ok(entry !== undefined);
    assert.equal(entry.properties['content']?.length, 1);
  });

  it('keeps no more than a small multiple of the page in property values', () => {
    const [entry] = itemsIn(parseHtml(repeated), SOURCE);
    assert.ok(entry !== undefined);
    const kept = keptLength(entry);
    assert.ok(kept <= 4 * repeated.length, `kept ${kept} characters for ${repeated.length}`);
  });

  it('reads no more than 16 property classes off one element', () => {
    const classes = Array.from({ length: 2_000 }, (_, index) => `e-a${String(index)}`).join(' ');
    const [entry] = itemsIn(
      parseHtml(`<div class="h-entry"><div class="${classes}">hi</div></div>`),
      SOURCE,
    );
    assert.ok(entry !== undefined);
    assert.equal(Object.keys(entry.properties).length, 16);
    assert.ok(entry.properties['a0'] !== undefined && entry.properties['a15'] !== undefined);
  });

  it('cuts a long e-content short and still closes what it opened', () => {
    const long = '<p><b>' + 'word '.repeat(40_000) + '</b></p>';
    const read = sourceEntry(
      `<div class="h-entry"><a class="u-in-reply-to" href="${TARGET}">re</a><div class="e-content">${long}</div></div>`,
      SOURCE,
      isTarget,
    );
    assert.equal(read.kind, 'reply');
    assert.ok(read.content.html.length <= MICROFORMAT_VALUE_LENGTH + 64);
    assert.ok(read.content.html.startsWith('<p><b>word'));
    assert.ok(read.content.html.endsWith('</b></p>'), read.content.html.slice(-40));
    assert.ok(read.content.text.length <= MICROFORMAT_VALUE_LENGTH);
  });

  it('reads 500 nested h-entry e-content roots over 900 KB of text in well under a second', () => {
    const depth = 500;
    const page =
      `<div class="h-entry"><a href="${TARGET}">hi</a>` +
      '<div class="h-entry e-content">'.repeat(depth) +
      'word '.repeat(180_000) +
      '</div>'.repeat(depth) +
      '</div>';
    const started = performance.now();
    const read = sourceEntry(page, SOURCE, isTarget);
    const ms = performance.now() - started;
    assert.equal(read.kind, 'mention');
    assert.ok(ms < 500, `sourceEntry took ${Math.round(ms)} ms for ${page.length} bytes`);
  });
});

describe('property names that are Object.prototype properties', () => {
  it('reads p-constructor, p-__proto__ and p-toString as ordinary properties', () => {
    const [item] = itemsIn(
      parseHtml(
        '<div class="h-entry"><span class="p-constructor">a</span>' +
          '<span class="p-__proto__">b</span><span class="p-toString">c</span>' +
          '<span class="p-constructor">d</span></div>',
      ),
      SOURCE,
    );

    assert.deepEqual(Object.entries(item?.properties ?? {}), [
      ['constructor', [{ text: 'a' }, { text: 'd' }]],
      ['__proto__', [{ text: 'b' }]],
      ['toString', [{ text: 'c' }]],
    ]);
  });
});
