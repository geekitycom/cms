/**
 * What the authorization endpoint accepts (TASK-158).
 *
 * A fault in client_id or redirect_uri leaves nowhere safe to send the person,
 * so it is shown as a page. Any other fault is reported to the client at its
 * redirect_uri, once that redirect_uri is known to be the client's.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAuthorizationRequest } from './request.ts';
import type { ParsedAuthorizationRequest } from './request.ts';

const BASE = 'https://blog.example';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const VALID: Record<string, string> = {
  response_type: 'code',
  client_id: 'https://app.example/',
  redirect_uri: 'https://app.example/callback',
  state: 'xyz',
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
};

function parse(
  changes: Record<string, string | undefined> = {},
  extra: [string, string][] = [],
): ParsedAuthorizationRequest {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...VALID, ...changes })) {
    if (value !== undefined) params.append(name, value);
  }
  for (const [name, value] of extra) params.append(name, value);
  return parseAuthorizationRequest(params, BASE);
}

function refusal(parsed: ParsedAuthorizationRequest): string {
  assert.equal(parsed.kind, 'refused', JSON.stringify(parsed));
  return parsed.kind === 'refused' ? parsed.error : '';
}

describe('parseAuthorizationRequest', () => {
  it('accepts a complete request and keeps only the scopes the site offers', () => {
    const parsed = parse({
      scope: 'profile draft email',
      me: 'https://blog.example/',
      resource: 'https://blog.example/mcp',
    });
    assert.equal(parsed.kind, 'valid');
    if (parsed.kind !== 'valid') return;
    assert.deepEqual(parsed.request, {
      clientId: 'https://app.example/',
      redirectUri: 'https://app.example/callback',
      state: 'xyz',
      codeChallenge: CHALLENGE,
      scopes: ['profile', 'email'],
      me: 'https://blog.example/',
      resource: 'https://blog.example/mcp',
    });
  });

  it('refuses a request with no code_challenge', () => {
    assert.equal(refusal(parse({ code_challenge: undefined })), 'invalid_request');
  });

  it('refuses a challenge method other than S256, or none at all', () => {
    assert.equal(refusal(parse({ code_challenge_method: 'plain' })), 'invalid_request');
    assert.equal(refusal(parse({ code_challenge_method: undefined })), 'invalid_request');
  });

  it('refuses a challenge that is not a SHA-256 hash in base64url', () => {
    assert.equal(refusal(parse({ code_challenge: 'short' })), 'invalid_request');
    assert.equal(
      refusal(parse({ code_challenge: `${CHALLENGE.slice(0, 42)}=` })),
      'invalid_request',
    );
  });

  it('refuses a response_type other than code', () => {
    assert.equal(refusal(parse({ response_type: 'token' })), 'unsupported_response_type');
  });

  it('refuses a request with no state', () => {
    assert.equal(refusal(parse({ state: undefined })), 'invalid_request');
  });

  it('refuses a resource that is not on this site, or more than one', () => {
    assert.equal(refusal(parse({ resource: 'https://elsewhere.example/mcp' })), 'invalid_target');
    assert.equal(refusal(parse({ resource: 'https://blog.example/mcp#x' })), 'invalid_target');
    assert.equal(refusal(parse({ resource: '/mcp' })), 'invalid_target');
    assert.equal(
      refusal(
        parse({ resource: 'https://blog.example/a' }, [['resource', 'https://blog.example/b']]),
      ),
      'invalid_target',
    );
  });

  it('keeps what a refusal needs to redirect: the client, redirect_uri and state', () => {
    const parsed = parse({ code_challenge: undefined });
    assert.equal(parsed.kind, 'refused');
    if (parsed.kind !== 'refused') return;
    assert.equal(parsed.clientId, 'https://app.example/');
    assert.equal(parsed.redirectUri, 'https://app.example/callback');
    assert.equal(parsed.state, 'xyz');
  });

  it('shows a malformed client_id as a page rather than redirecting', () => {
    for (const clientId of [
      undefined,
      '',
      'app.example',
      'ftp://app.example/',
      'https://app.example/#fragment',
      'https://user:pass@app.example/',
      'https://app.example/a/../b',
      'https://app.example/./b',
      'https://10.0.0.1/',
      'https://[2001:db8::1]/',
    ]) {
      assert.equal(parse({ client_id: clientId }).kind, 'unredirectable', String(clientId));
    }
  });

  it('accepts a loopback client_id, which the spec allows for development', () => {
    for (const clientId of ['http://127.0.0.1/', 'http://[::1]/', 'http://localhost:8080/']) {
      assert.equal(
        parse({ client_id: clientId, redirect_uri: `${clientId}callback` }).kind,
        'valid',
        clientId,
      );
    }
  });

  it('shows a missing, relative or scripting redirect_uri as a page', () => {
    for (const redirectUri of [
      undefined,
      '',
      '/callback',
      'javascript:alert(1)',
      'data:text/html,hi',
      'https://app.example/callback#x',
    ]) {
      assert.equal(
        parse({ redirect_uri: redirectUri }).kind,
        'unredirectable',
        String(redirectUri),
      );
    }
  });
});
