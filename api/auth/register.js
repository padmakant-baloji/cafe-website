'use strict';

const { ensureSchema } = require('../../lib/schema');
const { signCustomerSession } = require('../../lib/customer-session');
const { normalizeMobile, createCustomer } = require('../../lib/order-service');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await ensureSchema();
        const body = req.body || {};
        const mobile = normalizeMobile(body.mobile);
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
        const city = typeof body.city === 'string' ? body.city.trim().slice(0, 200) : '';

        if (!mobile || mobile.length !== 10) {
            return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
        }
        if (!name || !city) {
            return res.status(400).json({ error: 'Name and city are required.' });
        }

        let row;
        try {
            row = await createCustomer(mobile, name, city);
        } catch (e) {
            if (e && e.code === '23505') {
                return res.status(409).json({ error: 'This number is already registered. Go back and continue.' });
            }
            throw e;
        }

        return res.status(200).json({
            token: signCustomerSession(row.mobile),
            customer: {
                customerId: row.mobile,
                name: row.name,
                city: row.city,
                mobile: row.mobile
            }
        });
    } catch (err) {
        console.error('auth/register:', err.message);
        return res.status(500).json({ error: 'Could not save profile.' });
    }
};
