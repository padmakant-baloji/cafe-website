'use strict';

const { ensureSchema } = require('../../../lib/schema');
const { applyAdminOrderAction } = require('../../../lib/order-service');
const { requireAdminApi } = require('../../../lib/api-auth');
const { notifyCustomerOfOrderStatus } = require('../../../lib/push-service');

module.exports = async (req, res) => {
    if (req.method !== 'PATCH') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!requireAdminApi(req, res)) return;

    try {
        await ensureSchema();
        const orderId = parseInt(String(req.query.id), 10);
        if (!Number.isFinite(orderId)) {
            return res.status(400).json({ error: 'Invalid order id.' });
        }
        const action = req.body && req.body.action;
        if (typeof action !== 'string') {
            return res.status(400).json({ error: 'Missing action.' });
        }
        const updated = await applyAdminOrderAction(orderId, action);
        if (updated && updated.customer_mobile) {
            await notifyCustomerOfOrderStatus({ customerMobile: updated.customer_mobile, order: updated });
        }
        return res.status(200).json({ ok: true, order: updated });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('admin patch order:', err.message);
        }
        return res.status(code).json({ error: err.message || 'Update failed.' });
    }
};
