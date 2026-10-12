import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classesOf,
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
