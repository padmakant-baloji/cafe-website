'use strict';

const { ensureSchema } = require('../../lib/schema');
const { getCustomerByMobile } = require('../../lib/order-service');
const { resolveCustomerSession } = require('../../lib/api-auth');

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await ensureSchema();
        const session = await resolveCustomerSession(req);
        if (!session) {
            return res.status(401).json({ error: 'Session expired.' });
        }
        const row = await getCustomerByMobile(session.mobile);
        if (!row) {
            return res.status(401).json({ error: 'Session expired.' });
        }
        return res.status(200).json({
            customer: {
                customerId: row.mobile,
                name: row.name,
                city: row.city,
                mobile: row.mobile
            }
        });
    } catch (err) {
        console.error('auth/me:', err.message);
        return res.status(500).json({ error: 'Database error.' });
    }
};
