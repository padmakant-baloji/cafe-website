'use strict';

const { ensureSchema } = require('../../lib/schema');
const { upsertPushSubscription } = require('../../lib/push-service');
const { resolveCustomerSession } = require('../../lib/api-auth');

/**
 * Vercel serverless: POST /api/push/subscribe
 * Stores the browser push subscription for the signed-in customer.
 */
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await ensureSchema();
        const session = await resolveCustomerSession(req);
        if (!session) {
            return res.status(401).json({ error: 'Sign in required.' });
        }
        const body = req.body || {};
        const subscription = body.subscription;
        await upsertPushSubscription(session.mobile, subscription);
        return res.status(200).json({ ok: true });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('push/subscribe:', err.message);
        }
        return res.status(code).json({ error: err.message || 'Could not save subscription.' });
    }
};
