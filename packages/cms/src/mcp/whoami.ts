import { callingClient, defineTool } from './tools.ts';

/** Who the connection acts as, through which client, with which scopes. */
export const whoami = defineTool({
  name: 'whoami',
  title: 'Who am I',
  description:
    'Names the site user this connection acts as, the client or token it was issued to, and the scopes it was granted.',
  scope: 'profile',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: {
    type: 'object',
    properties: {
      me: { type: 'string', description: 'The profile URL the connection signs in as.' },
      username: { type: 'string' },
      client: {
        type: 'string',
        description: 'The client_id of the app, or the name of a token created by hand.',
      },
      clientName: { type: 'string', description: 'What the app called itself, when it said.' },
      scopes: { type: 'array', items: { type: 'string' } },
    },
    required: ['me', 'username', 'client', 'scopes'],
  },
  run: (_args, { user, token }) => {
    const { client, clientName } = callingClient(token);
    const scopes = [...token.scopes];
    return Promise.resolve({
      ok: true,
      summary: `Signed in as ${user.username} (${token.me}) through ${clientName ?? client}, with ${scopes.join(', ')}.`,
      structured: {
        me: token.me,
        username: user.username,
        client,
        ...(clientName === undefined ? {} : { clientName }),
        scopes,
      },
    });
  },
});
