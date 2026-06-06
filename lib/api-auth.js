'use strict';

const { verifyCustomerSession } = require('./customer-session');
const { normalizeMobile, getCustomerByMobile } = require('./order-service');
const { resolveAdminVenue, venuePublicPayload } = require('./venue-service');

async function requireAdminApi(req, res) {
    const venue = await resolveAdminVenue(req);
    if (!venue) {
        res.status(401).json({ error: 'Authentication required' });
        return null;
    }
    return venue;
}

async function resolveCustomerSession(req) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
        const session = verifyCustomerSession(auth.slice(7).trim());
        if (session) return session;
    }

    const fallbackMobile = normalizeMobile(req.headers['x-customer-mobile']);
    if (!fallbackMobile) return null;
    const customer = await getCustomerByMobile(fallbackMobile);
    if (!customer) return null;
    return { mobile: customer.mobile };
}

module.exports = { requireAdminApi, resolveCustomerSession, venuePublicPayload };
