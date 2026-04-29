'use strict';

const { ensureSchema } = require('../../lib/schema');
const { signCustomerSession } = require('../../lib/customer-session');
const { normalizeMobile, findCustomerByMobile } = require('../../lib/order-service');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await ensureSchema();
        const mobile = normalizeMobile(req.body && req.body.mobile);
        if (!mobile || mobile.length !== 10) {
            return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
        }
        const row = await findCustomerByMobile(mobile);
        if (!row) return res.status(200).json({ exists: false });

        return res.status(200).json({
            exists: true,
            token: signCustomerSession(row.mobile),
            customer: {
                customerId: row.mobile,
                name: row.name,
                city: row.city,
                mobile: row.mobile
            }
        });
    } catch (err) {
        console.error('auth/lookup:', err.message);
        return res.status(500).json({ error: 'Could not reach database.' });
    }
};
