import { fileURLToPath } from 'node:url';

import { Environment, FileSystemLoader } from 'nunjucks';

/**
 * The admin's templates, resolved from this module rather than the working
 * directory so they are found whether the CMS runs from `src/` under tsx or
 * from `dist/` as an installed dependency.
 *
 * They are a set of their own, not part of the theme search path: a site's
 * `theme/` may override any public template, and must not be able to shadow
 * the login form or the CSRF field inside it.
 */
export const PACKAGED_ADMIN_DIR: string = fileURLToPath(new URL('../../admin/', import.meta.url));

/** Templates {@link mountAdmin} asks for by name. */
export const ADMIN_TEMPLATES = {
  login: 'layouts/login.njk',
  setup: 'layouts/setup.njk',
  dashboard: 'layouts/dashboard.njk',
} as const;

/** How to build an {@link createAdminTemplateEnvironment}. */
export interface CreateAdminTemplateEnvironmentOptions {
  /**
   * Recompile a template on every render instead of caching it, so editing an
   * admin template in development shows up without a restart. On while the
   * content watcher is on, which is the same switch as "this is a dev server".
   */
  noCache?: boolean | undefined;
}

/** A Nunjucks environment over {@link PACKAGED_ADMIN_DIR} and nothing else. */
export function createAdminTemplateEnvironment(
  options: CreateAdminTemplateEnvironmentOptions = {},
): Environment {
  const loader = new FileSystemLoader([PACKAGED_ADMIN_DIR], {
    noCache: options.noCache === true,
  });

  return new Environment(loader, {
    autoescape: true,
    throwOnUndefined: false,
    trimBlocks: true,
    lstripBlocks: true,
  });
}
