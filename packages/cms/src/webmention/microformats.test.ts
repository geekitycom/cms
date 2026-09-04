import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { linksTo, sourceEntry } from './microformats.ts';

const SOURCE = 'https://them.example/2026/09/reply/';
const TARGET = 'https://blog.example/2026/09/hello/';

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

    const entry = sourceEntry(html, SOURCE, TARGET);

    assert.equal(entry.kind, 'reply');
    assert.equal(entry.author.name, 'Ada Lovelace');
    assert.equal(entry.author.url, 'https://them.example/');
    assert.equal(entry.content.html, '<p>Good <em>post</em>.</p>');
    assert.equal(entry.published, '2026-09-21T10:30:00.000Z');
    assert.equal(entry.url, SOURCE);
  });

  it('reads a like', () => {
    const html = `<div class="h-entry"><a class="u-like-of" href="${TARGET}">liked</a></div>`;
    assert.equal(sourceEntry(html, SOURCE, TARGET).kind, 'like');
  });

  it('reads a repost', () => {
    const html = `<div class="h-entry"><a class="u-repost-of" href="${TARGET}">boosted</a></div>`;
    assert.equal(sourceEntry(html, SOURCE, TARGET).kind, 'repost');
  });

  it('reads a plain link in the content as a mention', () => {
    const html = `
      <div class="h-entry">
        <h1 class="p-name">Some thoughts</h1>
        <div class="e-content"><p>As <a href="${TARGET}">they</a> said.</p></div>
      </div>`;

    const entry = sourceEntry(html, SOURCE, TARGET);
    assert.equal(entry.kind, 'mention');
  });

  it('picks the h-entry that links to the target, not the first on the page', () => {
    const html = `
      <div class="h-entry"><a class="p-author h-card" href="https://them.example/one">One</a>
        <div class="e-content"><a href="https://elsewhere.example/">elsewhere</a></div></div>
      <div class="h-entry"><a class="p-author h-card" href="https://them.example/two">Two</a>
        <a class="u-in-reply-to" href="${TARGET}">re</a></div>`;

    assert.equal(sourceEntry(html, SOURCE, TARGET).author.name, 'Two');
  });

  it('takes an author from a page-level h-card when the entry names none', () => {
    const html = `
      <div class="h-card"><a class="u-url p-name" href="https://them.example/">Grace</a>
        <img class="u-photo" src="/me.jpg" alt=""></div>
      <div class="h-entry"><div class="e-content"><a href="${TARGET}">there</a></div></div>`;

    const entry = sourceEntry(html, SOURCE, TARGET);
    assert.equal(entry.author.name, 'Grace');
    assert.equal(entry.author.url, 'https://them.example/');
    assert.equal(entry.author.photo, 'https://them.example/me.jpg');
  });

  it('falls back to the page title and the host when the page has no microformats', () => {
    const html = `<html><head><title>A note</title></head><body><p><a href="${TARGET}">there</a></p></body></html>`;

    const entry = sourceEntry(html, SOURCE, TARGET);
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

    assert.equal(sourceEntry(html, SOURCE, TARGET).author.url, 'https://them.example/blog/me/');
  });

  it('leaves the published date null when the page did not say one', () => {
    const html = `<div class="h-entry"><a class="u-like-of" href="${TARGET}">liked</a></div>`;
    assert.equal(sourceEntry(html, SOURCE, TARGET).published, null);
  });

  it('reads a name given as text rather than as an h-card', () => {
    const html = `
      <div class="h-entry"><span class="p-author">Alan Turing</span>
      <a class="u-in-reply-to" href="${TARGET}">re</a></div>`;

    const entry = sourceEntry(html, SOURCE, TARGET);
    assert.equal(entry.author.name, 'Alan Turing');
    assert.equal(entry.author.url, null);
  });
});
