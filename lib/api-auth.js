'use strict';

const { verifyCustomerSession } = require('./customer-session');
const { normalizeMobile, getCustomerByMobile } = require('./order-service');

const ADMIN_USER = process.env.ADMIN_USER || 'balojicafe';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';

function requireAdminApi(req, res) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
        res.status(401).json({ error: 'Authentication required' });
        return null;
    }
    let decoded;
    try {
        decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    } catch {
        res.status(401).json({ error: 'Invalid credentials' });
        return null;
    }
    const colon = decoded.indexOf(':');
    const u = colon >= 0 ? decoded.slice(0, colon) : decoded;
    const p = colon >= 0 ? decoded.slice(colon + 1) : '';
    if (u === ADMIN_USER && p === ADMIN_PASS) return true;
    res.status(401).json({ error: 'Invalid credentials' });
    return null;
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

module.exports = { requireAdminApi, resolveCustomerSession };
