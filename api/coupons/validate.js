'use strict';

const { ensureSchema } = require('../../lib/schema');
const { resolveCustomerSession } = require('../../lib/api-auth');
const { validateCoupon } = require('../../lib/coupon-service');

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
        const code = typeof body.code === 'string' ? body.code : '';
        const subtotal =
            typeof body.subtotal === 'number' && Number.isFinite(body.subtotal)
                ? body.subtotal
                : parseInt(String(body.subtotal || 0), 10);

        const result = await validateCoupon(code, subtotal);
        if (!result.ok) {
            return res.status(400).json({ ok: false, error: result.message, code: result.code || '' });
        }
        return res.status(200).json({ ok: true, code: result.code, discount: result.discount, message: result.message });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('coupons/validate:', err.message);
        return res.status(code).json({ ok: false, error: err.message || 'Could not validate coupon.' });
    }
};

