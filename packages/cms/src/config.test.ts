import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';

import { resolveConfig } from './config.ts';

describe('resolveConfig', () => {
  it('falls back to documented defaults when nothing is supplied', () => {
    const config = resolveConfig({}, { cwd: '/srv/site', env: {} });

    assert.equal(config.port, 3000);
    assert.equal(config.contentDir, path.join('/srv/site', 'content'));
    assert.equal(config.dataDir, path.join('/srv/site', 'data'));
    assert.equal(config.themeDir, path.join('/srv/site', 'theme'));
    assert.equal(config.baseUrl, 'http://localhost:3000');
  });

  it('keeps the default base URL in step with an explicit port', () => {
    const config = resolveConfig({ port: 8080 }, { cwd: '/srv/site', env: {} });

    assert.equal(config.baseUrl, 'http://localhost:8080');
  });

  it('resolves relative directories against the config file directory', () => {
    const config = resolveConfig(
      { contentDir: 'src/content', dataDir: '../shared/data', themeDir: 'theme' },
      { cwd: '/srv/site', env: {} },
    );

    assert.equal(config.contentDir, '/srv/site/src/content');
    assert.equal(config.dataDir, '/srv/shared/data');
    assert.equal(config.themeDir, '/srv/site/theme');
  });

  it('leaves absolute directories alone', () => {
    const config = resolveConfig({ contentDir: '/var/content' }, { cwd: '/srv/site', env: {} });

    assert.equal(config.contentDir, '/var/content');
  });

  it('strips a trailing slash from the base URL so joins are unambiguous', () => {
    const config = resolveConfig(
      { baseUrl: 'https://geekity.example/' },
      { cwd: '/srv/site', env: {} },
    );

    assert.equal(config.baseUrl, 'https://geekity.example');
  });

  it('lets environment variables override the config file', () => {
    const config = resolveConfig(
      {
        port: 3000,
        contentDir: '/from/config/content',
        dataDir: '/from/config/data',
        themeDir: '/from/config/theme',
        baseUrl: 'https://from-config.example',
      },
      {
        cwd: '/srv/site',
        env: {
          GEEKITY_PORT: '9001',
          GEEKITY_CONTENT_DIR: '/from/env/content',
          GEEKITY_DATA_DIR: '/from/env/data',
          GEEKITY_THEME_DIR: '/from/env/theme',
          GEEKITY_BASE_URL: 'https://from-env.example',
        },
      },
    );

    assert.equal(config.port, 9001);
    assert.equal(config.contentDir, '/from/env/content');
    assert.equal(config.dataDir, '/from/env/data');
    assert.equal(config.themeDir, '/from/env/theme');
    assert.equal(config.baseUrl, 'https://from-env.example');
  });

  it('also honours PORT, which hosts set for us', () => {
    const config = resolveConfig({ port: 3000 }, { cwd: '/srv/site', env: { PORT: '4321' } });

    assert.equal(config.port, 4321);
  });

  it('prefers GEEKITY_PORT over a generic PORT', () => {
    const config = resolveConfig(
      {},
      { cwd: '/srv/site', env: { PORT: '4321', GEEKITY_PORT: '9001' } },
    );

    assert.equal(config.port, 9001);
  });

  it('resolves a relative directory from the environment too', () => {
    const config = resolveConfig(
      {},
      { cwd: '/srv/site', env: { GEEKITY_CONTENT_DIR: 'other/content' } },
    );

    assert.equal(config.contentDir, '/srv/site/other/content');
  });

  it('rejects a port that is not a number', () => {
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_PORT: 'http' } }),
      /GEEKITY_PORT/,
    );
  });

  it('rejects a port outside the valid range', () => {
    assert.throws(() => resolveConfig({ port: 70000 }, { cwd: '/srv/site', env: {} }), /port/);
  });

  it('rejects a base URL that is not a URL', () => {
    assert.throws(
      () => resolveConfig({ baseUrl: 'geekity' }, { cwd: '/srv/site', env: {} }),
      /baseUrl/,
    );
  });

  it('watches the content directory unless the site says otherwise', () => {
    assert.equal(resolveConfig({}, { cwd: '/srv/site', env: {} }).watch, true);
    assert.equal(resolveConfig({ watch: false }, { cwd: '/srv/site', env: {} }).watch, false);
  });

  it('lets the environment turn watching off, for a one-shot sync or a read-only host', () => {
    assert.equal(
      resolveConfig({ watch: true }, { cwd: '/srv/site', env: { GEEKITY_WATCH: 'false' } }).watch,
      false,
    );
    assert.equal(
      resolveConfig({ watch: false }, { cwd: '/srv/site', env: { GEEKITY_WATCH: '1' } }).watch,
      true,
    );
  });

  it('rejects a GEEKITY_WATCH it cannot read as a boolean', () => {
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_WATCH: 'sometimes' } }),
      /GEEKITY_WATCH/,
    );
  });

  it('keeps an admin session for a fortnight unless the site says otherwise', () => {
    assert.equal(
      resolveConfig({}, { cwd: '/srv/site', env: {} }).sessionLifetime,
      14 * 24 * 60 * 60,
    );
    assert.equal(
      resolveConfig({ sessionLifetime: 3600 }, { cwd: '/srv/site', env: {} }).sessionLifetime,
      3600,
    );
  });

  it('lets GEEKITY_SESSION_LIFETIME override the session lifetime', () => {
    assert.equal(
      resolveConfig(
        { sessionLifetime: 3600 },
        { cwd: '/srv/site', env: { GEEKITY_SESSION_LIFETIME: '900' } },
      ).sessionLifetime,
      900,
    );
  });

  it('rejects a session lifetime that is not a positive number of seconds', () => {
    assert.throws(
      () =>
        resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_SESSION_LIFETIME: 'a fortnight' } }),
      /GEEKITY_SESSION_LIFETIME/,
    );
    assert.throws(
      () => resolveConfig({ sessionLifetime: 0 }, { cwd: '/srv/site', env: {} }),
      /sessionLifetime/,
    );
  });

  it('defaults cwd and env to the running process', () => {
    const config = resolveConfig({ baseUrl: 'https://geekity.example' });

    assert.equal(config.contentDir, path.join(process.cwd(), 'content'));
  });
});
