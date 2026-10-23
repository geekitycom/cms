import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { headerFor, readRequestLine, routeRequest } from './gemini-request.ts';
import type { GeminiHeader } from './gemini-request.ts';

const HOST = 'shll.me';
const ORIGIN = 'https://shll.me';

function statusOf(read: object | undefined): number | undefined {
  return read !== undefined && 'header' in read ? (read.header as GeminiHeader).status : undefined;
}

function line(text: string) {
  return readRequestLine(Buffer.from(text, 'utf8'));
}

describe('reading a request line', () => {
  it('waits for the CRLF', () => {
    assert.equal(line('gemini://shll.me/'), undefined);
  });

  it('takes the URL before the CRLF', () => {
    assert.deepEqual(line('gemini://shll.me/about/\r\n'), { line: 'gemini://shll.me/about/' });
  });

  it('refuses a URL longer than 1024 bytes with 59, without waiting for the end', () => {
    const long = `gemini://shll.me/${'a'.repeat(1024)}`;
    assert.equal(statusOf(line(long)), 59);
    const exactly = `gemini://shll.me/${'a'.repeat(1024 - 'gemini://shll.me/'.length)}`;
    assert.deepEqual(line(`${exactly}\r\n`), { line: exactly });
    assert.equal(statusOf(line(`${exactly}a\r\n`)), 59);
  });

  it('refuses a bare LF with 59', () => {
    assert.equal(statusOf(line('gemini://shll.me/\n')), 59);
  });
});

describe('routing a request', () => {
  function route(text: string) {
    return routeRequest(text, HOST);
  }

  it('asks for a directory at its index.gmi and anything else as it is', () => {
    assert.deepEqual(route('gemini://shll.me/2026/09/one/'), {
      paths: ['/2026/09/one/index.gmi', '/2026/09/one/'],
    });
    assert.deepEqual(route('gemini://shll.me'), { paths: ['/index.gmi', '/'] });
    assert.deepEqual(route('gemini://shll.me/about/index.gmi'), { paths: ['/about/index.gmi'] });
    assert.deepEqual(route('gemini://shll.me/uploads/a.png'), { paths: ['/uploads/a.png'] });
    assert.deepEqual(route('gemini://SHLL.ME:1965/page/2/?x=1'), {
      paths: ['/page/2/index.gmi?x=1', '/page/2/?x=1'],
    });
  });

  it('answers 59 to what is not one absolute gemini URL', () => {
    for (const bad of [
      '',
      '/about/',
      'not a url',
      'gemini://ada@shll.me/',
      'gemini://shll.me/#part',
      '﻿gemini://shll.me/',
    ]) {
      assert.equal(statusOf(route(bad)), 59, JSON.stringify(bad));
    }
  });

  it('answers 53 to another scheme or another host', () => {
    assert.equal(statusOf(route('https://shll.me/')), 53);
    assert.equal(statusOf(route('gemini://elsewhere.example/')), 53);
  });

  it('accepts a bracketed IPv6 host', () => {
    assert.deepEqual(routeRequest('gemini://[::1]/', '::1'), { paths: ['/index.gmi', '/'] });
  });

  it('asks for a search query with 10, and runs what comes back', () => {
    assert.equal(statusOf(route('gemini://shll.me/search/')), 10);
    assert.equal(statusOf(route('gemini://shll.me/search/index.gmi')), 10);
    assert.equal(statusOf(route('gemini://shll.me/search/?')), 10);
    assert.deepEqual(route('gemini://shll.me/search/?field%20notes'), {
      paths: ['/search/index.gmi?q=field%20notes'],
    });
    assert.deepEqual(route('gemini://shll.me/search/index.gmi?a%26b'), {
      paths: ['/search/index.gmi?q=a%26b'],
    });
  });

  it('follows a search page’s own links, which carry q', () => {
    assert.deepEqual(route('gemini://shll.me/search/index.gmi?q=notes&page=2'), {
      paths: ['/search/index.gmi?q=notes&page=2'],
    });
  });

  it('answers 59 to input that is not percent-encoded UTF-8', () => {
    assert.equal(statusOf(route('gemini://shll.me/search/?%E0%A4%A')), 59);
  });
});

describe('answering from the HTTP response', () => {
  function header(status: number, headers: Record<string, string> = {}) {
    return headerFor(new Response(null, { status, headers }), ORIGIN);
  }

  it('answers 20 with the media type', () => {
    assert.deepEqual(header(200, { 'content-type': 'text/gemini; charset=utf-8' }), {
      status: 20,
      meta: 'text/gemini; charset=utf-8',
    });
    assert.deepEqual(header(200), { status: 20, meta: 'application/octet-stream' });
  });

  it('maps permanent redirects to 31 and temporary ones to 30, keeping them in the capsule', () => {
    assert.deepEqual(header(301, { location: 'https://shll.me/about/index.gmi?x=1' }), {
      status: 31,
      meta: '/about/index.gmi?x=1',
    });
    assert.deepEqual(header(308, { location: '/a/' }), { status: 31, meta: '/a/' });
    for (const status of [302, 303, 307]) {
      assert.deepEqual(header(status, { location: '/b/' }), { status: 30, meta: '/b/' });
    }
    assert.deepEqual(header(302, { location: 'https://elsewhere.example/x' }), {
      status: 30,
      meta: 'https://elsewhere.example/x',
    });
  });

  it('maps 404 to 51, 410 to 52, a server error to 40 and a bad request to 59', () => {
    assert.equal(header(404).status, 51);
    assert.equal(header(410).status, 52);
    assert.equal(header(500).status, 40);
    assert.equal(header(502).status, 40);
    assert.equal(header(400).status, 59);
    assert.equal(header(403).status, 50);
  });

  it('maps maintenance to 41 with its back-by time', () => {
    const until = new Date('2026-10-23T13:30:00Z');
    const dated = header(503, { 'retry-after': until.toUTCString() });
    assert.equal(dated.status, 41);
    assert.match(dated.meta, /2026-10-23T13:30:00\.000Z/);
    const waited = header(503, { 'retry-after': '600' });
    assert.equal(waited.status, 41);
    assert.match(waited.meta, /10 minutes/);
  });
});
