'use strict';

// ONE Serverless Function for the entire API (Vercel Hobby: max 12 functions).
// Never add api/auth/lookup.js, api/order.js, etc. — each file becomes its own function.
// All routes live in lib/vercel-api-router.js; vercel.json rewrites /api/* here.
const { handleVercelApi } = require('../lib/vercel-api-router');

module.exports = handleVercelApi;
