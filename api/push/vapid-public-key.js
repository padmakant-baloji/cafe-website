'use strict';

/**
 * Vercel serverless: GET /api/push/vapid-public-key
 * Matches Express route in server.js for Web Push subscription.
 */
module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
        return res.status(501).json({ error: 'Push is not configured (VAPID_PUBLIC_KEY missing).' });
    }
    return res.status(200).json({ publicKey });
};
