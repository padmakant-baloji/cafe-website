'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const { ensureSchema } = require('./lib/schema');
const { signCustomerSession, verifyCustomerSession } = require('./lib/customer-session');
const {
    normalizeMobile,
    findCustomerByMobile,
    createCustomer,
    getCustomerByMobile,
    listOrdersForCustomer,
    listAllOrdersForAdmin,
    applyAdminOrderAction
} = require('./lib/order-service');
const { placeOrderForCustomer } = require('./lib/place-order');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

const ADMIN_USER = process.env.ADMIN_USER || 'balojicafe';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';

app.use(express.json({ limit: '256kb' }));

function requireAdmin(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
        return res.status(401).send('Authentication required');
    }
    let decoded;
    try {
        decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    } catch {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
        return res.status(401).send('Invalid credentials');
    }
    const colon = decoded.indexOf(':');
    const u = colon >= 0 ? decoded.slice(0, colon) : decoded;
    const p = colon >= 0 ? decoded.slice(colon + 1) : '';
    if (u === ADMIN_USER && p === ADMIN_PASS) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Invalid credentials');
}

function customerAuth(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    return verifyCustomerSession(auth.slice(7).trim());
}

async function requireCustomer(req, res, next) {
    const session = customerAuth(req);
    if (!session) {
        const fallbackMobile = normalizeMobile(req.headers['x-customer-mobile']);
        if (fallbackMobile) {
            try {
                await ensureSchema();
                const customer = await getCustomerByMobile(fallbackMobile);
                if (customer) {
                    req.customerSession = { mobile: customer.mobile };
                    return next();
                }
            } catch (err) {
                console.error('customer fallback auth:', err.message);
            }
        }
        return res
            .status(401)
            .json({ error: 'Sign in required. Enter your mobile number on the welcome screen.' });
    }
    req.customerSession = session;
    next();
}

function parseId(v) {
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : NaN;
}

app.post('/api/auth/lookup', async (req, res) => {
    try {
        await ensureSchema();
        const mobile = normalizeMobile(req.body && req.body.mobile);
        if (!mobile || mobile.length !== 10) {
            return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
        }
        const row = await findCustomerByMobile(mobile);
        if (!row) {
            return res.json({ exists: false });
        }
        const token = signCustomerSession(row.mobile);
        return res.json({
            exists: true,
            token,
            customer: {
                customerId: row.mobile,
                name: row.name,
                city: row.city,
                mobile: row.mobile
            }
        });
    } catch (err) {
        console.error('auth/lookup:', err.message);
        return res.status(500).json({ error: 'Could not reach database. Set DATABASE_URL in .env.' });
    }
});

app.post('/api/auth/register', async (req, res) => {
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

        const token = signCustomerSession(row.mobile);
        return res.json({
            token,
            customer: {
                customerId: row.mobile,
                name: row.name,
                city: row.city,
                mobile: row.mobile
            }
        });
    } catch (err) {
        console.error('auth/register:', err.message);
        return res.status(500).json({ error: 'Could not save profile. Check DATABASE_URL.' });
    }
});

app.get('/api/auth/me', requireCustomer, async (req, res) => {
    try {
        await ensureSchema();
        const { mobile } = req.customerSession;
        const row = await getCustomerByMobile(mobile);
        if (!row) {
            return res.status(401).json({ error: 'Session expired.' });
        }
        return res.json({
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
});

app.get('/api/orders/my', requireCustomer, async (req, res) => {
    try {
        await ensureSchema();
        const rows = await listOrdersForCustomer(req.customerSession.mobile, 50);
        return res.json({ orders: rows });
    } catch (err) {
        console.error('orders/my:', err.message);
        return res.status(500).json({ error: 'Could not load orders.' });
    }
});

app.post('/api/order', requireCustomer, async (req, res) => {
    try {
        await ensureSchema();
        const order = await placeOrderForCustomer(req.customerSession.mobile, req.body || {});
        const id = typeof order.id === 'string' ? parseInt(order.id, 10) : Number(order.id);
        return res.json({ ok: true, orderId: id, status: order.status });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('place order:', err.message);
        }
        return res.status(code).json({
            error: err.message || 'Could not place order.'
        });
    }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const rows = await listAllOrdersForAdmin(150);
        return res.json({ orders: rows });
    } catch (err) {
        console.error('admin orders:', err.message);
        return res.status(500).json({ error: 'Could not load orders.' });
    }
});

app.patch('/api/admin/orders/:id', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const orderId = parseId(req.params.id);
        if (Number.isNaN(orderId)) {
            return res.status(400).json({ error: 'Invalid order id.' });
        }
        const action = req.body && req.body.action;
        if (typeof action !== 'string') {
            return res.status(400).json({ error: 'Missing action.' });
        }
        const updated = await applyAdminOrderAction(orderId, action);
        return res.json({ ok: true, order: updated });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('admin patch order:', err.message);
        }
        return res.status(code).json({ error: err.message || 'Update failed.' });
    }
});

app.get('/admin', requireAdmin, (req, res) => {
    res.sendFile(path.join(ROOT, 'admin.html'));
});

app.get('/admin.html', requireAdmin, (req, res) => {
    res.sendFile(path.join(ROOT, 'admin.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(ROOT, 'login.html'));
});

app.get('/menu', (req, res) => {
    res.sendFile(path.join(ROOT, 'index.html'));
});

app.use(express.static(ROOT));

app.listen(PORT, () => {
    console.log(`Server http://localhost:${PORT}`);
    console.log('Admin dashboard: /admin (set DATABASE_URL for orders DB)');
    ensureSchema().catch((err) => {
        console.warn('Could not run DB migrations yet:', err.message);
    });
});
