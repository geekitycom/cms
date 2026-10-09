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
    assert.equal(config.themesDir, path.join('/srv/site', 'themes'));
    assert.equal(config.baseUrl, 'http://localhost:3000');
  });

  it('keeps the default base URL in step with an explicit port', () => {
    const config = resolveConfig({ port: 8080 }, { cwd: '/srv/site', env: {} });

    assert.equal(config.baseUrl, 'http://localhost:8080');
  });

  it('resolves relative directories against the config file directory', () => {
    const config = resolveConfig(
      { contentDir: 'src/content', dataDir: '../shared/data', themesDir: 'themes' },
      { cwd: '/srv/site', env: {} },
    );

    assert.equal(config.contentDir, '/srv/site/src/content');
    assert.equal(config.dataDir, '/srv/shared/data');
    assert.equal(config.themesDir, '/srv/site/themes');
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
        themesDir: '/from/config/themes',
        baseUrl: 'https://from-config.example',
      },
      {
        cwd: '/srv/site',
        env: {
          GEEKITY_PORT: '9001',
          GEEKITY_CONTENT_DIR: '/from/env/content',
          GEEKITY_DATA_DIR: '/from/env/data',
          GEEKITY_THEMES_DIR: '/from/env/themes',
          GEEKITY_BASE_URL: 'https://from-env.example',
        },
      },
    );

    assert.equal(config.port, 9001);
    assert.equal(config.contentDir, '/from/env/content');
    assert.equal(config.dataDir, '/from/env/data');
    assert.equal(config.themesDir, '/from/env/themes');
    assert.equal(config.baseUrl, 'https://from-env.example');
  });

  it('names no plugins folder unless the config or GEEKITY_PLUGINS_DIR does', () => {
    const cwd = '/srv/site';
    assert.equal(resolveConfig({}, { cwd, env: {} }).pluginsDir, undefined);
    assert.equal(
      resolveConfig({ pluginsDir: 'plugins' }, { cwd, env: {} }).pluginsDir,
      path.join(cwd, 'plugins'),
    );
    assert.equal(
      resolveConfig(
        { pluginsDir: 'plugins' },
        { cwd, env: { GEEKITY_PLUGINS_DIR: '/site/plugins' } },
      ).pluginsDir,
      '/site/plugins',
    );
  });

  it('watches the plugins folder unless the config or GEEKITY_PLUGIN_WATCH turns it off', () => {
    const cwd = '/srv/site';
    assert.equal(resolveConfig({}, { cwd, env: {} }).pluginWatch, true);
    assert.equal(resolveConfig({ pluginWatch: false }, { cwd, env: {} }).pluginWatch, false);
    assert.equal(
      resolveConfig({}, { cwd, env: { GEEKITY_PLUGIN_WATCH: 'off' } }).pluginWatch,
      false,
    );
  });

  // decision-15 replaced the single `theme/` directory with a `themes/`
  // directory of named themes, and replaced rather than aliased the names: an
  // environment still setting the old one is a deployment that has to be
  // looked at, and quietly reading it as the new one would point the whole
  // search path at a directory that now means something else.
  it('ignores the environment variable the single theme directory had', () => {
    const config = resolveConfig(
      {},
      { cwd: '/srv/site', env: { GEEKITY_THEME_DIR: '/from/env/theme' } },
    );

    assert.equal(config.themesDir, path.join('/srv/site', 'themes'));
  });

  it('makes a config that still names the single theme directory a type error', () => {
    // @ts-expect-error `themeDir` is gone; a site names `themesDir` now.
    const config = resolveConfig({ themeDir: '/from/config/theme' }, { cwd: '/srv/site', env: {} });

    assert.equal(config.themesDir, path.join('/srv/site', 'themes'));
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

  it('caps an audio or video upload at two hundred mebibytes unless the site says otherwise', () => {
    assert.equal(
      resolveConfig({}, { cwd: '/srv/site', env: {} }).uploadMediaMaxBytes,
      200 * 1024 * 1024,
    );
    assert.equal(
      resolveConfig({ uploadMediaMaxBytes: 4096 }, { cwd: '/srv/site', env: {} })
        .uploadMediaMaxBytes,
      4096,
    );
    assert.equal(
      resolveConfig(
        { uploadMediaMaxBytes: 4096 },
        { cwd: '/srv/site', env: { GEEKITY_UPLOAD_MEDIA_MAX_BYTES: '1024' } },
      ).uploadMediaMaxBytes,
      1024,
    );
  });

  it('rejects a media upload limit that is not a positive whole number of bytes', () => {
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_UPLOAD_MEDIA_MAX_BYTES: '1.5' } }),
      /GEEKITY_UPLOAD_MEDIA_MAX_BYTES/,
    );
    assert.throws(
      () => resolveConfig({ uploadMediaMaxBytes: -1 }, { cwd: '/srv/site', env: {} }),
      /uploadMediaMaxBytes/,
    );
  });

  it('allows images, PDFs, text, captions, audio and video uploads by default, and no SVG', () => {
    const { uploadTypes } = resolveConfig({}, { cwd: '/srv/site', env: {} });

    assert.deepEqual(uploadTypes, [
      '.aac',
      '.avif',
      '.gif',
      '.jpeg',
      '.jpg',
      '.m4a',
      '.m4v',
      '.md',
      '.mp3',
      '.mp4',
      '.oga',
      '.ogg',
      '.opus',
      '.pdf',
      '.png',
      '.srt',
      '.txt',
      '.vtt',
      '.webm',
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

  it('merges security headers over the defaults by name, whatever the case', () => {
    const defaults = resolveConfig({}, { cwd: '/srv/site', env: {} }).securityHeaders;
    const config = resolveConfig(
      {
        securityHeaders: {
          'REFERRER-POLICY': 'no-referrer',
          'Cross-Origin-Opener-Policy': false,
          'Cross-Origin-Resource-Policy': 'same-site',
        },
      },
      { cwd: '/srv/site', env: {} },
    );

    assert.equal(defaults['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(config.securityHeaders['referrer-policy'], 'no-referrer');
    assert.ok(!('cross-origin-opener-policy' in config.securityHeaders), 'removed');
    assert.equal(config.securityHeaders['cross-origin-resource-policy'], 'same-site');
    assert.equal(config.securityHeaders['x-frame-options'], 'SAMEORIGIN', 'the rest stay');
  });

  it('refuses a security header it could not send', () => {
    const at = { cwd: '/srv/site', env: {} };
    assert.throws(() => resolveConfig({ securityHeaders: { 'Bad Name': 'x' } }, at), /Bad Name/);
    assert.throws(
      () => resolveConfig({ securityHeaders: { 'X-Test': 'a\r\nSet-Cookie: b' } }, at),
      /X-Test/,
    );
    assert.throws(() => resolveConfig({ securityHeaders: { 'X-Test': '' } }, at), /X-Test/);
    assert.throws(
      () => resolveConfig({ securityHeaders: { 'X-Test': true as unknown as string } }, at),
      /X-Test/,
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
  it('logs no request unless the site or the environment asks it to', () => {
    assert.equal(resolveConfig({}, { cwd: '/srv/site', env: {} }).accessLog, false);
    assert.equal(resolveConfig({ accessLog: true }, { cwd: '/srv/site', env: {} }).accessLog, true);
    assert.equal(
      resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_ACCESS_LOG: 'yes' } }).accessLog,
      true,
    );
    assert.equal(
      resolveConfig({ accessLog: true }, { cwd: '/srv/site', env: { GEEKITY_ACCESS_LOG: 'off' } })
        .accessLog,
      false,
    );
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_ACCESS_LOG: 'quietly' } }),
      /GEEKITY_ACCESS_LOG/,
    );
  });

  it('keeps the client address off the access log unless it is asked for', () => {
    assert.equal(resolveConfig({}, { cwd: '/srv/site', env: {} }).accessLogAddress, false);
    assert.equal(
      resolveConfig({ accessLogAddress: true }, { cwd: '/srv/site', env: {} }).accessLogAddress,
      true,
    );
    assert.equal(
      resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_ACCESS_LOG_ADDRESS: 'true' } })
        .accessLogAddress,
      true,
    );
    assert.equal(
      resolveConfig(
        { accessLogAddress: true },
        { cwd: '/srv/site', env: { GEEKITY_ACCESS_LOG_ADDRESS: 'no' } },
      ).accessLogAddress,
      false,
    );
    assert.throws(
      () =>
        resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_ACCESS_LOG_ADDRESS: 'sometimes' } }),
      /GEEKITY_ACCESS_LOG_ADDRESS/,
    );
  });

  it('carries the access log sink through, since no environment variable can', () => {
    const lines: string[] = [];
    const write = (line: string): void => {
      lines.push(line);
    };
    assert.equal(resolveConfig({}, { cwd: '/srv/site', env: {} }).accessLogWriter, undefined);
    assert.equal(
      resolveConfig({ accessLogWriter: write }, { cwd: '/srv/site', env: {} }).accessLogWriter,
      write,
    );
  });

  it('seeds nothing unless the site or the environment asks it to', () => {
    assert.equal(resolveConfig({}, { cwd: '/srv/site', env: {} }).seedContent, false);
    assert.equal(
      resolveConfig({ seedContent: true }, { cwd: '/srv/site', env: {} }).seedContent,
      true,
    );
    assert.equal(
      resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_SEED_CONTENT: 'true' } }).seedContent,
      true,
    );
    assert.equal(
      resolveConfig(
        { seedContent: true },
        { cwd: '/srv/site', env: { GEEKITY_SEED_CONTENT: 'false' } },
      ).seedContent,
      false,
    );
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_SEED_CONTENT: 'sometimes' } }),
      /GEEKITY_SEED_CONTENT/,
    );
  });

  it('compresses by default, and turns it off from config or GEEKITY_COMPRESSION', () => {
    assert.equal(resolveConfig({}, { cwd: '/srv/site', env: {} }).compression, true);
    assert.equal(
      resolveConfig({ compression: false }, { cwd: '/srv/site', env: {} }).compression,
      false,
    );
    assert.equal(
      resolveConfig(
        { compression: true },
        { cwd: '/srv/site', env: { GEEKITY_COMPRESSION: 'false' } },
      ).compression,
      false,
    );
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_COMPRESSION: 'sometimes' } }),
      /GEEKITY_COMPRESSION/,
    );
  });

  it('forces maintenance mode from GEEKITY_MAINTENANCE, and is off by default', () => {
    assert.equal(resolveConfig({}, { cwd: '/srv/site', env: {} }).maintenance, false);
    assert.equal(
      resolveConfig({ maintenance: true }, { cwd: '/srv/site', env: {} }).maintenance,
      true,
    );
    assert.equal(
      resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_MAINTENANCE: 'on' } }).maintenance,
      true,
    );
    assert.throws(
      () => resolveConfig({}, { cwd: '/srv/site', env: { GEEKITY_MAINTENANCE: 'sometimes' } }),
      /GEEKITY_MAINTENANCE/,
    );
  });
});
