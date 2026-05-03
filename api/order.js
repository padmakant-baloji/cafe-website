'use strict';

const { ensureSchema } = require('../lib/schema');
const { verifyCustomerSession } = require('../lib/customer-session');
const { placeOrderForCustomer } = require('../lib/place-order');
const { normalizeMobile, getCustomerByMobile } = require('../lib/order-service');

/**
 * Vercel serverless: POST /api/order
 * Requires Authorization: Bearer <customer session token> (same as Express).
 */
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = req.headers.authorization;
    let session = null;
    if (auth && auth.startsWith('Bearer ')) {
        session = verifyCustomerSession(auth.slice(7).trim());
    }
    if (!session) {
        const fallbackMobile = normalizeMobile(req.headers['x-customer-mobile']);
        if (fallbackMobile) {
            await ensureSchema();
            const customer = await getCustomerByMobile(fallbackMobile);
            if (customer) {
                session = { mobile: customer.mobile };
            }
        }
    }
    if (!session) {
        return res.status(401).json({ error: 'Sign in required.' });
    }

    try {
        await ensureSchema();
        const order = await placeOrderForCustomer(session.mobile, req.body || {});
        const id = typeof order.id === 'string' ? parseInt(order.id, 10) : Number(order.id);
        return res.status(200).json({
            ok: true,
            orderId: id,
            status: order.status,
            created_at: order.created_at
        });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('Order error:', err.message);
        }
        return res.status(code).json({
            error: err.message || 'Could not place order.'
        });
    }
};
