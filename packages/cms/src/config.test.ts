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

  it('caps an upload at ten mebibytes unless the site says otherwise', () => {
    assert.equal(resolveConfig({}, { cwd: '/srv/site', env: {} }).uploadMaxBytes, 10 * 1024 * 1024);
    assert.equal(
      resolveConfig({ uploadMaxBytes: 2048 }, { cwd: '/srv/site', env: {} }).uploadMaxBytes,
      2048,
    );
    assert.equal(
      resolveConfig(
        { uploadMaxBytes: 2048 },
        { cwd: '/srv/site', env: { GEEKITY_UPLOAD_MAX_BYTES: '512' } },
      ).uploadMaxBytes,
      512,
    );
  });

  it('rejects an upload limit that is not a positive whole number of bytes', () => {
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_UPLOAD_MAX_BYTES: 'lots' } }),
      /GEEKITY_UPLOAD_MAX_BYTES/,
    );
    assert.throws(
      () => resolveConfig({ uploadMaxBytes: 0 }, { cwd: '/srv/site', env: {} }),
      /uploadMaxBytes/,
    );
  });

  it('allows images, PDFs and plain text uploads by default, and no SVG', () => {
    const { uploadTypes } = resolveConfig({}, { cwd: '/srv/site', env: {} });

    assert.deepEqual(uploadTypes, [
      '.avif',
      '.gif',
      '.jpeg',
      '.jpg',
      '.md',
      '.pdf',
      '.png',
      '.txt',
      '.webp',
    ]);
  });

  it('takes an upload allowlist from the config or the environment, normalised', () => {
    assert.deepEqual(
      resolveConfig({ uploadTypes: ['PNG', '.Webp'] }, { cwd: '/srv/site', env: {} }).uploadTypes,
      ['.png', '.webp'],
    );
    assert.deepEqual(
      resolveConfig(
        { uploadTypes: ['.png'] },
        { cwd: '/srv/site', env: { GEEKITY_UPLOAD_TYPES: 'gif, .pdf' } },
      ).uploadTypes,
      ['.gif', '.pdf'],
    );
  });

  it('rejects an upload allowlist naming a type the CMS has no media type for', () => {
    assert.throws(
      () => resolveConfig({ uploadTypes: ['.exe'] }, { cwd: '/srv/site', env: {} }),
      /uploadTypes/,
    );
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_UPLOAD_TYPES: '.exe' } }),
      /GEEKITY_UPLOAD_TYPES/,
    );
  });

  it('optimises images by default, at the widths 11ty/image uses, in WebP alone', () => {
    const config = resolveConfig({}, { cwd: '/srv/site', env: {} });

    assert.equal(config.imageOptimization, true);
    assert.deepEqual(config.imageWidths, [320, 640, 960, 1280, 1920]);
    assert.deepEqual(config.imageFormats, ['webp']);
  });

  it('takes image widths from the config or the environment, sorted and deduplicated', () => {
    assert.deepEqual(
      resolveConfig({ imageWidths: [800, 400, 800] }, { cwd: '/srv/site', env: {} }).imageWidths,
      [400, 800],
    );
    assert.deepEqual(
      resolveConfig(
        { imageWidths: [800] },
        { cwd: '/srv/site', env: { GEEKITY_IMAGE_WIDTHS: '640, 320' } },
      ).imageWidths,
      [320, 640],
    );
  });

  it('rejects an image width that is not a positive whole number of pixels', () => {
    assert.throws(
      () => resolveConfig({ imageWidths: [0] }, { cwd: '/srv/site', env: {} }),
      /imageWidths/,
    );
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_IMAGE_WIDTHS: 'wide' } }),
      /GEEKITY_IMAGE_WIDTHS/,
    );
  });

  it('takes image formats from the config or the environment, normalised', () => {
    assert.deepEqual(
      resolveConfig({ imageFormats: ['AVIF', 'WebP'] }, { cwd: '/srv/site', env: {} }).imageFormats,
      ['avif', 'webp'],
    );
    assert.deepEqual(
      resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_IMAGE_FORMATS: 'avif , webp' } })
        .imageFormats,
      ['avif', 'webp'],
    );
  });

  it('rejects an image format sharp cannot write for the web', () => {
    assert.throws(
      () => resolveConfig({ imageFormats: ['bmp'] }, { cwd: '/srv/site', env: {} }),
      /imageFormats/,
    );
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_IMAGE_FORMATS: 'tiff' } }),
      /GEEKITY_IMAGE_FORMATS/,
    );
  });

  it('turns image optimization off from the config or the environment', () => {
    assert.equal(
      resolveConfig({ imageOptimization: false }, { cwd: '/srv/site', env: {} }).imageOptimization,
      false,
    );
    assert.equal(
      resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_IMAGE_OPTIMIZATION: 'off' } })
        .imageOptimization,
      false,
    );
  });

  it('defaults cwd and env to the running process', () => {
    const config = resolveConfig({ baseUrl: 'https://geekity.example' });

    assert.equal(config.contentDir, path.join(process.cwd(), 'content'));
  });
});

describe('baseUrlSource', () => {
  it('says where the base URL came from, so the settings screen knows if it may offer one', () => {
    assert.equal(resolveConfig({}, { cwd: '/srv/site', env: {} }).baseUrlSource, 'default');
    assert.equal(
      resolveConfig({ baseUrl: 'https://from-config.example' }, { cwd: '/srv/site', env: {} })
        .baseUrlSource,
      'config',
    );
    assert.equal(
      resolveConfig(
        { baseUrl: 'https://from-config.example' },
        { cwd: '/srv/site', env: { GEEKITY_BASE_URL: 'https://from-env.example' } },
      ).baseUrlSource,
      'environment',
    );
    assert.equal(
      resolveConfig({ baseUrl: '' }, { cwd: '/srv/site', env: { GEEKITY_BASE_URL: '' } })
        .baseUrlSource,
      'default',
      'an empty value is not a value',
    );
  });

  it('allows five failed logins and a quarter-hour lockout unless the site says otherwise', () => {
    const config = resolveConfig({}, { cwd: '/srv/site', env: {} });

    assert.equal(config.loginAttempts, 5);
    assert.equal(config.loginLockout, 15 * 60);
  });

  it('takes the login limits from the config or the environment', () => {
    assert.equal(
      resolveConfig({ loginAttempts: 3 }, { cwd: '/srv/site', env: {} }).loginAttempts,
      3,
    );
    assert.equal(
      resolveConfig(
        { loginAttempts: 3 },
        { cwd: '/srv/site', env: { GEEKITY_LOGIN_ATTEMPTS: '9' } },
      ).loginAttempts,
      9,
    );
    assert.equal(
      resolveConfig({ loginLockout: 30 }, { cwd: '/srv/site', env: {} }).loginLockout,
      30,
    );
    assert.equal(
      resolveConfig(
        { loginLockout: 30 },
        { cwd: '/srv/site', env: { GEEKITY_LOGIN_LOCKOUT: '45' } },
      ).loginLockout,
      45,
    );
  });

  it('rejects login limits that are not positive whole numbers', () => {
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_LOGIN_ATTEMPTS: 'three' } }),
      /GEEKITY_LOGIN_ATTEMPTS/,
    );
    assert.throws(
      () => resolveConfig({ loginAttempts: 0 }, { cwd: '/srv/site', env: {} }),
      /loginAttempts/,
    );
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_LOGIN_LOCKOUT: '-1' } }),
      /GEEKITY_LOGIN_LOCKOUT/,
    );
    assert.throws(
      () => resolveConfig({ loginLockout: 0 }, { cwd: '/srv/site', env: {} }),
      /loginLockout/,
    );
  });

  it('does not believe a forwarding header until the site says it is behind a proxy', () => {
    assert.equal(resolveConfig({}, { cwd: '/srv/site', env: {} }).trustProxy, false);
    assert.equal(
      resolveConfig({ trustProxy: true }, { cwd: '/srv/site', env: {} }).trustProxy,
      true,
    );
    assert.equal(
      resolveConfig({ trustProxy: true }, { cwd: '/srv/site', env: { GEEKITY_TRUST_PROXY: 'off' } })
        .trustProxy,
      false,
    );
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_TRUST_PROXY: 'maybe' } }),
      /GEEKITY_TRUST_PROXY/,
    );
  });
});
