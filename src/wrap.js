/**
 * Express 4 does not catch a rejected promise from an async route handler —
 * it just hangs the request instead of reaching the error middleware in
 * server.js. Wrap every async handler registration with this so a thrown/
 * rejected error is forwarded to next() like a sync handler's throw would be.
 */
export const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
