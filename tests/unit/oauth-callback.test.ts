/** @vitest-environment node */
import express from 'express';
import { expect, it } from 'vitest';
import { handleOAuthCallbackError, oauthReturnPath } from '../../server/oauth-callback';

it('redirects a failed token exchange to a recoverable sign-in page', async () => {
  const app = express();
  app.get('/callback', (_req, _res, next) => next(Object.assign(new Error('Bad Request'), { name: 'TokenError' })), handleOAuthCallbackError);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/callback`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/?auth=failed');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('only accepts a local return path', () => {
  expect(oauthReturnPath('/observability-admin?tab=errors')).toBe('/observability-admin?tab=errors');
  for (const path of ['https://example.com', '//example.com', '/\\example.com', '/\r\nLocation: bad', null]) expect(oauthReturnPath(path)).toBe('/');
});
