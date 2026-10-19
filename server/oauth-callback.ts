import type { ErrorRequestHandler } from 'express';

export function oauthReturnPath(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value) ? value : '/';
}

/** Expired/replayed authorization codes should offer retry, rather than a 500 page. */
export const handleOAuthCallbackError: ErrorRequestHandler = (error, _req, res, _next) => {
  console.warn('[auth] Google callback failed', { name: error?.name, status: error?.status });
  res.redirect('/?auth=failed');
};
