'use strict';

// Single Serverless Function for the whole API (Hobby plan allows max 12 functions).
// Vercel's filesystem catch-all (`[...path].js`) is a Next.js-only feature, so on this
// static project every `/api/*` request is rewritten to this file via vercel.json
// ({ "source": "/api/:path*", "destination": "/api/index?__apiPath=:path*" }).
// `handleVercelApi` dispatches by method + the resolved request path.
const { handleVercelApi } = require('../lib/vercel-api-router');

module.exports = handleVercelApi;
