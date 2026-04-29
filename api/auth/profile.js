'use strict';

const { ensureSchema } = require('../../lib/schema');
const {
    getCustomerByMobile,
    listCustomerAddresses,
    updateCustomerProfile
} = require('../../lib/order-service');
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
    if (req.method !== 'PATCH') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await ensureSchema();
        const session = await resolveCustomerSession(req);
        if (!session) {
            return res.status(401).json({ error: 'Session expired.' });
        }
        const body = req.body || {};
        const updated = await updateCustomerProfile(session.mobile, body.name, body.city);
        const customer = updated || (await getCustomerByMobile(session.mobile));
        return res.status(200).json({ customer: await serializeCustomer(customer) });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('auth/profile:', err.message);
        }
        return res.status(code).json({ error: err.message || 'Could not update profile.' });
    }
};
