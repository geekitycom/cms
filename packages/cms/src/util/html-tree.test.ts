import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classesOf,
  type HtmlElement,
  elementsIn,
  hasRel,
  innerHtmlOf,
  isElement,
  parseHtml,
  rawTextOf,
  textOf,
} from './html-tree.ts';

describe('parseHtml', () => {
  it('builds a tree under a document root, every element in document order', () => {
    const root = parseHtml('<div><p>One <a href="/x">two</a></p><img src="a.png"><p>three</div>');
    assert.equal(root.name, '#document');
    assert.deepEqual(
      [...elementsIn(root)].map((element) => element.name),
      ['div', 'p', 'a', 'img', 'p'],
    );
  });

  it('lower-cases names, decodes attribute values and keeps going past stray markup', () => {
    const root = parseHtml('<A HREF="/?a=1&amp;b=2">x</A> 1 < 2 <!-- gone --><script>no</script>');
    const [link] = [...elementsIn(root)];
    assert.equal(link?.name, 'a');
    assert.equal(link?.attributes['href'], '/?a=1&b=2');
    assert.equal(textOf(root), 'x 1 < 2');
  });

  it('keeps the data of a JSON-LD script and drops any other script', () => {
    const root = parseHtml(
      '<script type="application/ld+json">{"a":1}</script><script>alert(1)</script>',
    );
    const scripts = [...elementsIn(root)];
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0]?.data, '{"a":1}');
  });

  it('parses 30,000 unclosed tags followed by 30,000 stray closing tags in well under a second', () => {
    const page = '<b>'.repeat(30_000) + '</i>'.repeat(30_000);
    const started = performance.now();
    const root = parseHtml(page);
    const elapsed = performance.now() - started;
    assert.equal(root.name, '#document');
    assert.ok(elapsed < 1_000, `parseHtml took ${Math.round(elapsed)} ms for ${page.length} bytes`);
  });

  it('still closes an element that is open beneath stray closing tags', () => {
    const root = parseHtml('<i><b>one</a></u><b>two</i><p>three');
    assert.deepEqual(
      root.children.filter(isElement).map((element) => element.name),
      ['i', 'p'],
    );
  });

  it('nests no deeper than 512 elements and keeps the rest as siblings at the deepest level', () => {
    const root = parseHtml('<div>'.repeat(600) + 'end');
    let deepest = 0;
    const pending: [HtmlElement, number][] = [[root, 0]];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      const [element, depth] = next;
      deepest = Math.max(deepest, depth);
      for (const child of element.children) if (isElement(child)) pending.push([child, depth + 1]);
    }
    assert.equal(deepest, 512);
    assert.equal([...elementsIn(root)].length, 600);
    assert.equal(textOf(root), 'end');
  });
});

describe('reading a parsed element', () => {
  const root = parseHtml(
    '<article class=" h-entry  e-content "><a rel="Me nofollow" href="/">A\n   <b>name</b></a></article>',
  );
  const [article, link] = [...elementsIn(root)];

  it('reads text collapsed, or exactly as written', () => {
    assert.ok(article !== undefined && link !== undefined);
    assert.equal(textOf(link), 'A name');
    assert.equal(rawTextOf(link), 'A\n   name');
  });

  it('reads classes and link relations', () => {
    assert.ok(article !== undefined && link !== undefined);
    assert.deepEqual(classesOf(article), ['h-entry', 'e-content']);
    assert.equal(hasRel(link, 'me'), true);
    assert.equal(hasRel(link, 'author'), false);
  });

  it('rebuilds inner markup from the tree, escaped', () => {
    const [paragraph] = [...elementsIn(parseHtml('<p>a &amp; <i title="x&quot;y">b</i><br>'))];
    assert.ok(paragraph !== undefined && isElement(paragraph));
    assert.equal(innerHtmlOf(paragraph), 'a &amp; <i title="x&quot;y">b</i><br>');
  });
});

describe('reading part of an element', () => {
  const [section] = [
    ...elementsIn(parseHtml('<section>one <b>two &amp; three</b> four<br></section>')),
  ];

  it('reads text up to a limit', () => {
    assert.ok(section !== undefined);
    assert.equal(rawTextOf(section, 6), 'one tw');
    assert.equal(textOf(section, 4), 'one');
    assert.equal(rawTextOf(section), 'one two & three four');
  });

  it('rebuilds markup up to a limit and closes what it opened', () => {
    assert.ok(section !== undefined);
    assert.equal(innerHtmlOf(section, 13), 'one <b>two </b>');
    assert.equal(innerHtmlOf(section, 16), 'one <b>two &amp;</b>');
    assert.equal(innerHtmlOf(section, 3), 'one');
    assert.equal(innerHtmlOf(section), 'one <b>two &amp; three</b> four<br>');
  });
});

describe('walking a deep tree', () => {
  function chain(depth: number): HtmlElement {
    const root: HtmlElement = { name: '#document', attributes: {}, children: [] };
    let parent = root;
    for (let level = 0; level < depth; level += 1) {
      const element: HtmlElement = { name: 'i', attributes: {}, children: [{ text: 'x' }] };
      parent.children.push(element);
      parent = element;
    }
    return root;
  }

  it('lists every element of a 20,000-deep page without throwing', () => {
    const root = parseHtml('<div>'.repeat(20_000));
    const started = performance.now();
    const count = [...elementsIn(root)].length;
    const elapsed = performance.now() - started;
    assert.equal(count, 20_000);
    assert.ok(elapsed < 500, `elementsIn took ${Math.round(elapsed)} ms`);
  });

  it('lists, reads and rebuilds a 50,000-deep tree without throwing', () => {
    const root = chain(50_000);
    const started = performance.now();
    assert.equal([...elementsIn(root)].length, 50_000);
    assert.equal(rawTextOf(root).length, 50_000);
    assert.equal(textOf(root).length, 50_000);
    const markup = innerHtmlOf(root);
    const elapsed = performance.now() - started;
    assert.ok(markup.startsWith('<i>x<i>x') && markup.endsWith('</i></i>'));
    assert.equal(markup.length, 50_000 * '<i>x</i>'.length);
    assert.ok(elapsed < 1_000, `walking took ${Math.round(elapsed)} ms`);
  });
});
