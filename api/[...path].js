'use strict';

// Single catch-all Serverless Function for the whole API.
// Vercel's Hobby plan allows at most 12 functions per deployment, so instead of
// one function per route we route every `/api/*` request through this one file.
// `handleVercelApi` dispatches by method + `req.url` pathname.
const { handleVercelApi } = require('../lib/vercel-api-router');

module.exports = handleVercelApi;
