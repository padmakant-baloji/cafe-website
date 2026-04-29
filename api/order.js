'use strict';

const { submitOrder } = require('../lib/order-email');

/**
 * Vercel serverless: POST /api/order
 * Set the same env vars as .env.example in the Vercel project dashboard.
 */
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await submitOrder(req.body || {});
        return res.status(200).json({ ok: true });
    } catch (err) {
        const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('Order email error:', err.message);
        }
        return res.status(code).json({
            error: err.message || 'Could not send order email.'
        });
    }
};
