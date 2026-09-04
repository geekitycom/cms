import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseDocument } from '../content/parser.ts';
import type { Document } from '../content/document.ts';
import { commentsOpen, DEFAULT_COMMENTS_CLOSE_AFTER_DAYS } from './policy.ts';
import type { CommentPolicy } from './policy.ts';

const OPEN: CommentPolicy = { enabled: true, closeAfterDays: DEFAULT_COMMENTS_CLOSE_AFTER_DAYS };

/** The moment every case below is judged at. */
const NOW = new Date('2026-09-20T12:00:00.000Z');

/** A post dated `date`, with whatever front matter the case is about. */
function post(date: string, front = ''): Document {
  return parseDocument(`---\ntitle: Hello\ndate: ${date}\n${front}---\n\nWords.\n`, {
    path: 'posts/2026-09-01-hello.md',
  });
}

/** A page, which is standing content rather than something dated. */
function page(front = ''): Document {
  return parseDocument(`---\ntitle: About\n${front}---\n\nWords.\n`, { path: 'pages/about.md' });
}

describe('whether a post is taking comments', () => {
  it('is open while the post is younger than the closing window', () => {
    assert.equal(commentsOpen(post('2026-09-18T00:00:00Z'), OPEN, NOW), true);
  });

  it('is closed once the post is older than it', () => {
    assert.equal(commentsOpen(post('2026-09-01T00:00:00Z'), OPEN, NOW), false);
  });

  it('never closes when the window is zero', () => {
    const never: CommentPolicy = { enabled: true, closeAfterDays: 0 };
    assert.equal(commentsOpen(post('2001-01-01T00:00:00Z'), never, NOW), true);
  });

  it('is closed everywhere when the site has comments switched off', () => {
    const off: CommentPolicy = { enabled: false, closeAfterDays: 0 };
    assert.equal(commentsOpen(post('2026-09-19T00:00:00Z'), off, NOW), false);
    assert.equal(commentsOpen(post('2026-09-19T00:00:00Z', 'comments: true\n'), off, NOW), false);
  });

  it('is closed by comments: false however young the post is', () => {
    assert.equal(commentsOpen(post('2026-09-19T00:00:00Z', 'comments: false\n'), OPEN, NOW), false);
  });

  it('is reopened by comments: true however old the post is', () => {
    assert.equal(commentsOpen(post('2001-01-01T00:00:00Z', 'comments: true\n'), OPEN, NOW), true);
  });

  it('is closed on a page unless the page says otherwise', () => {
    assert.equal(commentsOpen(page(), OPEN, NOW), false);
    assert.equal(commentsOpen(page('comments: true\n'), OPEN, NOW), true);
  });

  it('stays open on a post with no date at all, having no age to be past', () => {
    const undated = parseDocument('---\ntitle: Hello\npermalink: /notes/hello/\n---\n\nWords.\n', {
      path: 'posts/hello.md',
    });
    assert.equal(commentsOpen(undated, OPEN, NOW), true);
  });

  it('is closed on a draft, which nobody can read to comment on', () => {
    assert.equal(commentsOpen(post('2026-09-19T00:00:00Z', 'draft: true\n'), OPEN, NOW), false);
  });
});
