'use strict';

const { ensureSchema } = require('../../lib/schema');
const { listOrdersForCustomer } = require('../../lib/order-service');
const { resolveCustomerSession } = require('../../lib/api-auth');

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await ensureSchema();
        const session = await resolveCustomerSession(req);
        if (!session) {
            return res.status(401).json({ error: 'Sign in required.' });
        }
        const rows = await listOrdersForCustomer(session.mobile, 50);
        return res.status(200).json({ orders: rows });
    } catch (err) {
        console.error('orders/my:', err.message);
        return res.status(500).json({ error: 'Could not load orders.' });
    }
};
