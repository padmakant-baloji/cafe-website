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
    listCustomerAddresses,
    upsertDefaultCustomerAddress,
    updateCustomerProfile,
    listOrdersForCustomer,
    listAllOrdersForAdmin,
    applyAdminOrderAction,
    cancelOrderByCustomer
} = require('./lib/order-service');
const { placeOrderForCustomer } = require('./lib/place-order');
const { validateCoupon } = require('./lib/coupon-service');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

const ADMIN_USER = process.env.ADMIN_USER || 'balojicafe';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';

app.use(express.json({ limit: '256kb' }));

function requireAdmin(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
        return res.status(401).send('Authentication required');
    }
    let decoded;
    try {
        decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    } catch {
        return res.status(401).send('Invalid credentials');
    }
    const colon = decoded.indexOf(':');
    const u = colon >= 0 ? decoded.slice(0, colon) : decoded;
    const p = colon >= 0 ? decoded.slice(colon + 1) : '';
    if (u === ADMIN_USER && p === ADMIN_PASS) return next();
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
            customer: await serializeCustomer(row)
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
        const addressLine =
            typeof body.addressLine === 'string' ? body.addressLine.trim().slice(0, 300) : '';

        if (!mobile || mobile.length !== 10) {
            return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
        }
        if (!name || !city) {
            return res.status(400).json({ error: 'Name and city are required.' });
        }
        if (!addressLine) {
            return res.status(400).json({ error: 'Delivery address is required.' });
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

        await upsertDefaultCustomerAddress(mobile, {
            label: 'Delivery',
            addressLine,
            city
        });

        const token = signCustomerSession(row.mobile);
        return res.json({
            token,
            customer: await serializeCustomer(row)
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
        return res.json({ customer: await serializeCustomer(row) });
    } catch (err) {
        console.error('auth/me:', err.message);
        return res.status(500).json({ error: 'Database error.' });
    }
});

app.patch('/api/auth/profile', requireCustomer, async (req, res) => {
    try {
        await ensureSchema();
        const body = req.body || {};
        const updated = await updateCustomerProfile(
            req.customerSession.mobile,
            body.name,
            body.city
        );
        return res.json({ customer: await serializeCustomer(updated) });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('auth/profile:', err.message);
        }
        return res.status(code).json({ error: err.message || 'Could not update profile.' });
    }
});

app.post('/api/customer-addresses', requireCustomer, async (req, res) => {
    try {
        await ensureSchema();
        const address = await upsertDefaultCustomerAddress(req.customerSession.mobile, req.body || {});
        const customer = await getCustomerByMobile(req.customerSession.mobile);
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
        return res.json({
            ok: true,
            orderId: id,
            status: order.status,
            created_at: order.created_at
        });
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

app.post('/api/orders/:id/cancel', requireCustomer, async (req, res) => {
    try {
        await ensureSchema();
        const orderId = parseId(req.params.id);
        if (Number.isNaN(orderId)) {
            return res.status(400).json({ error: 'Invalid order id.' });
        }
        const updated = await cancelOrderByCustomer(orderId, req.customerSession.mobile);
        return res.json({ ok: true, order: updated });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('cancel order:', err.message);
        }
        return res.status(code).json({ error: err.message || 'Could not cancel order.' });
    }
});

app.post('/api/coupons/validate', requireCustomer, async (req, res) => {
    try {
        await ensureSchema();
        const body = req.body || {};
        const code = typeof body.code === 'string' ? body.code : '';
        const subtotal =
            typeof body.subtotal === 'number' && Number.isFinite(body.subtotal)
                ? body.subtotal
                : parseInt(String(body.subtotal || 0), 10);

        const result = await validateCoupon(code, subtotal);
        if (!result.ok) {
            return res.status(400).json({ ok: false, error: result.message, code: result.code || '' });
        }
        return res.json({ ok: true, code: result.code, discount: result.discount, message: result.message });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('coupons/validate:', err.message);
        }
        return res.status(code).json({ ok: false, error: err.message || 'Could not validate coupon.' });
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

app.get('/api/admin/session', requireAdmin, (req, res) => {
    return res.json({ ok: true });
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(ROOT, 'admin.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(ROOT, 'admin.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(ROOT, 'login.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(ROOT, 'login.html'));
});

app.get('/menu', (req, res) => {
    res.sendFile(path.join(ROOT, 'index.html'));
});

app.get('/orders', (req, res) => {
    res.sendFile(path.join(ROOT, 'orders.html'));
});

app.get('/profile', (req, res) => {
    res.sendFile(path.join(ROOT, 'profile.html'));
});

app.use(express.static(ROOT));

app.listen(PORT, () => {
    console.log(`Server http://localhost:${PORT}`);
    console.log('Admin dashboard: /admin (set DATABASE_URL for orders DB)');
    ensureSchema().catch((err) => {
        console.warn('Could not run DB migrations yet:', err.message);
    });
});
