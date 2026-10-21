import { createServer } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Received {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface Website {
  id: string;
  name: string;
  domain: string;
}

export interface FakeData {
  stats: unknown;
  pageviews: unknown;
  metrics: Record<string, unknown>;
  expanded: Record<string, unknown>;
  active: unknown;
  pathViews: Record<string, number>;
}

export interface FakeUmami {
  origin: string;
  cloudBase: string;
  apiKey: string;
  username: string;
  password: string;
  websites: Website[];
  data: FakeData;
  received: Received[];
  logins: number;
  delayMs: number;
  twoFactor: boolean;
  expireTokens(): void;
  refuseAllTokens(refuse?: boolean): void;
  requestsTo(path: string): Received[];
  close(): Promise<void>;
}

export const WEBSITE: Website = {
  id: '2f4b6c8d-0000-4000-8000-000000000001',
  name: 'Geekity',
  domain: 'example.com',
};

export function defaultData(): FakeData {
  return {
    stats: {
      pageviews: 120,
      visitors: 40,
      visits: 50,
      bounces: 20,
      totaltime: 6000,
      comparison: { pageviews: 100, visitors: 32, visits: 40, bounces: 18, totaltime: 4000 },
    },
    pageviews: {
      pageviews: [
        { x: '2026-10-14 00:00:00', y: 10 },
        { x: '2026-10-15 00:00:00', y: 20 },
      ],
      sessions: [
        { x: '2026-10-14 00:00:00', y: 4 },
        { x: '2026-10-15 00:00:00', y: 6 },
      ],
    },
    metrics: {
      path: [
        { x: '/', y: 60 },
        { x: '/2026/10/hello/', y: 30 },
      ],
      referrer: [{ x: 'news.ycombinator.com', y: 12 }],
      country: [{ x: 'US', y: 20 }],
      browser: [{ x: 'firefox', y: 15 }],
      device: [{ x: 'desktop', y: 25 }],
    },
    expanded: {
      path: [
        { name: '/', pageviews: 60, visitors: 30, visits: 35, bounces: 0, totaltime: 0 },
        {
          name: '/2026/10/hello/',
          pageviews: 30,
          visitors: 12,
          visits: 14,
          bounces: 0,
          totaltime: 0,
        },
      ],
    },
    active: { visitors: 3 },
    pathViews: {},
  };
}

interface Exchange {
  fake: FakeUmami;
  received: Received;
  query: URLSearchParams;
  segments: string[];
}

type Answer = { status: number; body: unknown };

const UNAUTHORIZED: Answer = {
  status: 401,
  body: { error: { message: 'Unauthorized', code: 'unauthorized', status: 401 } },
};

const NOT_FOUND: Answer = {
  status: 404,
  body: { error: { message: 'Not found', code: 'not-found', status: 404 } },
};

function website(exchange: Exchange): Website | undefined {
  return exchange.fake.websites.find((entry) => entry.id === exchange.segments[1]);
}

function withRange(exchange: Exchange, answer: () => unknown): Answer {
  if (exchange.query.get('startAt') === null || exchange.query.get('endAt') === null) {
    return { status: 400, body: { error: { message: 'Bad request', status: 400 } } };
  }
  return website(exchange) === undefined ? UNAUTHORIZED : { status: 200, body: answer() };
}

const ROUTES: Record<string, (exchange: Exchange) => Answer> = {
  websites: (exchange) => ({
    status: 200,
    body: { data: exchange.fake.websites, count: exchange.fake.websites.length },
  }),
  'websites/:id': (exchange) => {
    const found = website(exchange);
    return found === undefined ? UNAUTHORIZED : { status: 200, body: found };
  },
  'websites/:id/stats': (exchange) =>
    withRange(exchange, () => {
      const filter = exchange.query.get('path');
      if (filter === null) return exchange.fake.data.stats;
      const views = exchange.fake.data.pathViews[filter.replace(/^eq\./, '')] ?? 0;
      return { pageviews: views, visitors: views, visits: views, bounces: 0, totaltime: 0 };
    }),
  'websites/:id/pageviews': (exchange) => withRange(exchange, () => exchange.fake.data.pageviews),
  'websites/:id/metrics': (exchange) =>
    withRange(exchange, () => exchange.fake.data.metrics[exchange.query.get('type') ?? ''] ?? []),
  'websites/:id/metrics/expanded': (exchange) =>
    withRange(exchange, () => exchange.fake.data.expanded[exchange.query.get('type') ?? ''] ?? []),
  'websites/:id/active': (exchange) =>
    website(exchange) === undefined
      ? UNAUTHORIZED
      : { status: 200, body: exchange.fake.data.active },
};

function routeOf(segments: string[]): string {
  return segments.map((segment, index) => (index === 1 ? ':id' : segment)).join('/');
}

async function bodyOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function fakeUmami(): Promise<FakeUmami> {
  let issued = new Set<string>();
  let refusing = false;
  let next = 0;

  const fake: FakeUmami = {
    origin: '',
    cloudBase: '',
    apiKey: 'api_cloud-key-0000',
    username: 'admin',
    password: 'umami-password-1111',
    websites: [WEBSITE],
    data: defaultData(),
    received: [],
    logins: 0,
    delayMs: 0,
    twoFactor: false,
    expireTokens: () => {
      issued = new Set();
    },
    refuseAllTokens: (refuse = true) => {
      refusing = refuse;
    },
    requestsTo: (path) => fake.received.filter((entry) => entry.path.split('?')[0] === path),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };

  function answerSelfHostedLogin(received: Received): Answer {
    const sent = received.body as { username?: unknown; password?: unknown } | undefined;
    if (sent?.username !== fake.username || sent.password !== fake.password) {
      return { status: 401, body: { error: { message: 'Incorrect username and/or password.' } } };
    }
    if (fake.twoFactor)
      return { status: 200, body: { requiresTwoFactor: true, partialToken: 'p' } };
    next += 1;
    const token = `token-${String(next)}`;
    issued.add(token);
    fake.logins += 1;
    return { status: 200, body: { token, user: { id: 'u1', username: fake.username } } };
  }

  function signedIn(cloud: boolean, headers: IncomingHttpHeaders): boolean {
    const bearer = /^Bearer (.+)$/.exec(headers.authorization ?? '')?.[1];
    if (cloud) return bearer === fake.apiKey || headers['x-umami-api-key'] === fake.apiKey;
    return !refusing && bearer !== undefined && issued.has(bearer);
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://fake');
    const [prefix, ...segments] = url.pathname.split('/').filter((segment) => segment !== '');
    const received: Received = {
      method: request.method ?? 'GET',
      path: `/${segments.join('/')}${url.search}`,
      headers: request.headers,
      body: await bodyOf(request),
    };
    fake.received.push(received);
    const cloud = prefix === 'v1';

    let answer: Answer;
    if (prefix !== 'v1' && prefix !== 'api') answer = NOT_FOUND;
    else if (!cloud && received.method === 'POST' && segments.join('/') === 'auth/login') {
      answer = answerSelfHostedLogin(received);
    } else if (!signedIn(cloud, request.headers)) answer = UNAUTHORIZED;
    else {
      const route = ROUTES[routeOf(segments)];
      answer =
        route === undefined || received.method !== 'GET'
          ? NOT_FOUND
          : route({ fake, received, query: url.searchParams, segments });
    }

    if (fake.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, fake.delayMs));
    if (response.destroyed) return;
    response.writeHead(answer.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answer.body));
  }

  const server = createServer((request, response) => {
    void handle(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  fake.origin = `http://127.0.0.1:${String(port)}`;
  fake.cloudBase = `${fake.origin}/v1`;
  return fake;
}
