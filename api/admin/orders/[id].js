'use strict';

const { ensureSchema } = require('../../../lib/schema');
const { applyAdminOrderAction, applyFloorOrderAdminPatch } = require('../../../lib/order-service');
const { requireAdminApi } = require('../../../lib/api-auth');

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
        const body = typeof req.body === 'object' && req.body ? req.body : {};
        const action = typeof body.action === 'string' ? body.action.trim() : '';
        if (!action) {
            return res.status(400).json({ error: 'Missing action.' });
        }
        if (action.startsWith('floor_')) {
            const updated = await applyFloorOrderAdminPatch(orderId, body);
            return res.status(200).json({ ok: true, order: updated });
        }
        const updated = await applyAdminOrderAction(orderId, action);
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
