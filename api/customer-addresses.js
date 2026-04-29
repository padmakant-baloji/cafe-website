'use strict';

const { ensureSchema } = require('../lib/schema');
const {
    createCustomerAddress,
    getCustomerByMobile,
    listCustomerAddresses
} = require('../lib/order-service');
const { resolveCustomerSession } = require('../lib/api-auth');

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
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await ensureSchema();
        const session = await resolveCustomerSession(req);
        if (!session) {
            return res.status(401).json({ error: 'Sign in required.' });
        }
        const address = await createCustomerAddress(session.mobile, req.body || {}, {
            makeDefault: req.body?.isDefault !== false
        });
        const customer = await getCustomerByMobile(session.mobile);
        return res.status(201).json({
            address,
            customer: customer ? await serializeCustomer(customer) : null
        });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('customer-addresses:', err.message);
        }
        return res.status(code).json({ error: err.message || 'Could not save address.' });
    }
};
