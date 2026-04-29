'use strict';

const { ensureSchema } = require('../../lib/schema');
const { getCustomerByMobile, listCustomerAddresses } = require('../../lib/order-service');
const { resolveCustomerSession } = require('../../lib/api-auth');

async function serializeCustomer(row) {
    const addresses = row ? await listCustomerAddresses(row.mobile) : [];
    return {
        customerId: row.mobile,
        name: row.name,
        city: row.city,
        mobile: row.mobile,
        addresses
    };
}

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
        return res.status(200).json({ customer: await serializeCustomer(row) });
    } catch (err) {
        console.error('auth/me:', err.message);
        return res.status(500).json({ error: 'Database error.' });
    }
};
