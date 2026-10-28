import { AsyncLocalStorage } from 'node:async_hooks';

import nunjucks from 'nunjucks';

import type { ChallengeWidget } from '../forms/challenge.ts';
import { NO_PAGE_TAGS } from '../plugins/page-tags.ts';
import type { DrawnPageTags } from '../plugins/page-tags.ts';
import { DEFAULT_SITE_SETTINGS } from '../site/settings.ts';
import type { SiteSettings } from '../site/settings.ts';

const signedInReader = new AsyncLocalStorage<true>();

export function drawnForSignedInReader<T>(draw: () => T): T {
  return signedInReader.run(true, draw);
}

export interface RequestInputs {
  readonly devMode: boolean;
  readonly mailConfigured: boolean;
  readonly site: SiteSettings;
  readonly challenge?: ChallengeWidget | undefined;
}

const requestInputs = new AsyncLocalStorage<RequestInputs>();

export function drawnWith<T>(inputs: RequestInputs, draw: () => T): T {
  return requestInputs.run(inputs, draw);
}

const pageTags = new AsyncLocalStorage<DrawnPageTags>();

export function drawnWithPageTags<T>(tags: DrawnPageTags, draw: () => T): T {
  return pageTags.run(tags, draw);
}

export function pluginTagsContext(): {
  headEnd: nunjucks.runtime.SafeString;
  bodyEnd: nunjucks.runtime.SafeString;
} {
  const { headEnd, bodyEnd } = pageTags.getStore() ?? NO_PAGE_TAGS;
  return {
    headEnd: new nunjucks.runtime.SafeString(headEnd),
    bodyEnd: new nunjucks.runtime.SafeString(bodyEnd),
  };
}

export function requestSite(): SiteSettings {
  return requestInputs.getStore()?.site ?? DEFAULT_SITE_SETTINGS;
}

export function requestDevMode(): boolean {
  return requestInputs.getStore()?.devMode === true;
}

export function requestMailConfigured(): boolean {
  return requestInputs.getStore()?.mailConfigured === true;
}

export function requestChallenge(): ChallengeWidget | undefined {
  return requestInputs.getStore()?.challenge;
}

export function requestSignedIn(): boolean {
  return signedInReader.getStore() === true;
}
