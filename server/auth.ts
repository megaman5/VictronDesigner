import type { RequestHandler } from 'express';

interface PassportLike {
  initialize(): RequestHandler;
  session(): RequestHandler;
  authenticate(strategy?: string, options?: any): RequestHandler;
}

// Very simple "allow everything" stub.
// This satisfies imports like `import { passport } from "./auth";`
// without enforcing any real authentication.
const passportImpl: PassportLike = {
  initialize() {
    return (_req, _res, next) => next();
  },
  session() {
    return (_req, _res, next) => next();
  },
  authenticate(_strategy?: string, _options?: any) {
    return (_req, _res, next) => next();
  },
};

export const passport = passportImpl;

