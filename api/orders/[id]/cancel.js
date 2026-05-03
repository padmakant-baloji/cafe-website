'use strict';

const { ensureSchema } = require('../../../lib/schema');
const { cancelOrderByCustomer } = require('../../../lib/order-service');
const { resolveCustomerSession } = require('../../../lib/api-auth');
const { notifyCustomerOfOrderStatus } = require('../../../lib/push-service');

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
        const orderId = parseInt(String(req.query.id), 10);
        if (!Number.isFinite(orderId)) {
            return res.status(400).json({ error: 'Invalid order id.' });
        }
        const updated = await cancelOrderByCustomer(orderId, session.mobile);
        await notifyCustomerOfOrderStatus({ customerMobile: updated.customer_mobile, order: updated });
        return res.status(200).json({ ok: true, order: updated });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('cancel order:', err.message);
        }
        return res.status(code).json({ error: err.message || 'Could not cancel order.' });
    }
};
