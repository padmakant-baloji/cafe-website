'use strict';

const { ensureSchema } = require('../../lib/schema');
const {
    listAllOrdersForAdmin,
    listFloorSessionsForAdmin,
    createFloorSession,
    commitFloorOrderToDb
} = require('../../lib/order-service');
const { requireAdminApi } = require('../../lib/api-auth');

module.exports = async (req, res) => {
    if (!requireAdminApi(req, res)) return;

    if (req.method === 'GET') {
        try {
            await ensureSchema();
            const scope = String((req.query && req.query.scope) || '')
                .trim()
                .toLowerCase();
            const rows =
                scope === 'floor' ? await listFloorSessionsForAdmin() : await listAllOrdersForAdmin(150);
            res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
            return res.status(200).json({ orders: rows });
        } catch (err) {
            console.error('admin orders:', err.message);
            return res.status(500).json({ error: 'Could not load orders.' });
        }
    }

    if (req.method === 'POST') {
        try {
            await ensureSchema();
            const body = typeof req.body === 'object' && req.body ? req.body : {};
            const act = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';
            if (act === 'floor_open') {
                const order = await createFloorSession(body.channel, body.slot, body.guest_label);
                return res.status(201).json({ ok: true, order });
            }
            if (act === 'floor_commit') {
                const order = await commitFloorOrderToDb(body);
                return res.status(201).json({ ok: true, order });
            }
            return res.status(400).json({
                error:
                    'Unknown action. Use floor_open for new sessions or floor_commit to save a completed local session.'
            });
        } catch (err) {
            const code =
                err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
            if (code >= 500) {
                console.error('admin create order:', err.message);
            }
            return res.status(code).json({ error: err.message || 'Could not create order.' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
