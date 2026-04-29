'use strict';

const { ensureSchema } = require('../../lib/schema');
const { listAllOrdersForAdmin } = require('../../lib/order-service');
const { requireAdminApi } = require('../../lib/api-auth');

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!requireAdminApi(req, res)) return;

    try {
        await ensureSchema();
        const rows = await listAllOrdersForAdmin(150);
        return res.status(200).json({ orders: rows });
    } catch (err) {
        console.error('admin orders:', err.message);
        return res.status(500).json({ error: 'Could not load orders.' });
    }
};
