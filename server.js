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
    updateCustomerAddressById,
    updateCustomerProfile,
    listOrdersForCustomer,
    listAllOrdersForAdmin,
    listFloorSessionsForAdmin,
    applyAdminOrderAction,
    applyFloorOrderAdminPatch,
    createFloorSession,
    commitFloorOrderToDb,
    cancelOrderByCustomer
} = require('./lib/order-service');
const { placeOrderForCustomer } = require('./lib/place-order');
const { validateCoupon } = require('./lib/coupon-service');
const { getStoreStatus, setStoreStatus, getPublicStorefrontStatus } = require('./lib/store-status');
const { resolveAdminVenue, getFloorConfig, setFloorConfig, resolvePublicVenue, venuePublicPayload, listVenuesForAdmin, createVenueByMain, updateVenueAccessByMain } = require('./lib/venue-service');
const { getAggregatedCustomerMenu, getAdminMenuForVenue, saveAdminMenuForVenue } = require('./lib/menu-service');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

app.use(express.json({ limit: '256kb' }));

async function requireAdmin(req, res, next) {
    try {
        await ensureSchema();
        const venue = await resolveAdminVenue(req);
        if (!venue) return res.status(401).send('Authentication required');
        req.adminVenue = venue;
        return next();
    } catch (err) {
        console.error('admin auth:', err.message);
        return res.status(500).send('Authentication failed');
    }
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

app.patch('/api/auth/address', requireCustomer, async (req, res) => {
    try {
        await ensureSchema();
        const body = req.body || {};
        const mobile = req.customerSession.mobile;
        const addressLine =
            typeof body.addressLine === 'string' ? body.addressLine.trim().slice(0, 300) : '';
        const city = typeof body.city === 'string' ? body.city.trim().slice(0, 200) : '';
        if (!addressLine) {
            return res.status(400).json({ error: 'Delivery address is required.' });
        }
        const payload = { label: 'Delivery', addressLine, city };
        if (body.addressId != null && String(body.addressId).trim() !== '') {
            await updateCustomerAddressById(mobile, body.addressId, payload, { makeDefault: true });
        } else {
            await upsertDefaultCustomerAddress(mobile, payload);
        }
        const row = await getCustomerByMobile(mobile);
        return res.json({ customer: await serializeCustomer(row) });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('auth/address:', err.message);
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
            created_at: order.created_at,
            venueName: order.venueName || '',
            venueContactMobile: order.venueContactMobile || '',
            venueHoursText: order.venueHoursText || ''
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

app.get('/api/menu', async (req, res) => {
    try {
        await ensureSchema();
        const menu = await getAggregatedCustomerMenu();
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.json(menu);
    } catch (err) {
        console.error('menu:', err.message);
        return res.status(500).json({ error: 'Could not load menu.' });
    }
});

app.get('/api/admin/menu', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const targetVenueId = req.query && req.query.venueId ? parseInt(String(req.query.venueId), 10) : null;
        const menu = await getAdminMenuForVenue(
            req.adminVenue,
            Number.isFinite(targetVenueId) ? targetVenueId : null
        );
        res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.json({ ok: true, ...menu });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin menu get:', err.message);
        return res.status(code).json({ error: err.message || 'Could not load menu.' });
    }
});

app.put('/api/admin/menu', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const targetVenueId = req.query && req.query.venueId ? parseInt(String(req.query.venueId), 10) : null;
        const menu = await saveAdminMenuForVenue(
            req.adminVenue,
            Number.isFinite(targetVenueId) ? targetVenueId : null,
            req.body || {}
        );
        return res.json({ ok: true, ...menu });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin menu put:', err.message);
        return res.status(code).json({ error: err.message || 'Could not save menu.' });
    }
});

app.get('/api/store-status', async (req, res) => {
    try {
        await ensureSchema();
        const status = await getPublicStorefrontStatus();
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.json(status);
    } catch (err) {
        console.error('store-status:', err.message);
        return res.json({ acceptingOrders: true, reason: null, notice: null, updatedAt: null });
    }
});

app.put('/api/admin/venue-profile', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const { updateVenueProfile } = require('./lib/venue-service');
        const venue = await updateVenueProfile(req.adminVenue, req.body || {});
        return res.json({ ok: true, venue });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin venue-profile:', err.message);
        return res.status(code).json({ error: err.message || 'Could not update hotel details.' });
    }
});

app.post('/api/admin/store-status', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const body = req.body || {};
        const status = await setStoreStatus(req.adminVenue.id, {
            acceptingOrders: Boolean(body.acceptingOrders),
            reason: typeof body.reason === 'string' ? body.reason : ''
        });
        return res.json({ ok: true, ...status });
    } catch (err) {
        console.error('admin store-status:', err.message);
        return res.status(500).json({ error: 'Could not update store status.' });
    }
});

app.get('/api/admin/store-status', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const status = await getStoreStatus(req.adminVenue.id);
        res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.json(status);
    } catch (err) {
        console.error('admin store-status get:', err.message);
        return res.status(500).json({ error: 'Could not load store status.' });
    }
});

app.get('/api/admin/floor-config', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const config = await getFloorConfig(req.adminVenue.id);
        res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.json({ ok: true, ...config, venue: venuePublicPayload(req.adminVenue) });
    } catch (err) {
        console.error('admin floor-config get:', err.message);
        return res.status(500).json({ error: 'Could not load floor configuration.' });
    }
});

app.put('/api/admin/floor-config', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const body = req.body || {};
        const config = await setFloorConfig(req.adminVenue.id, {
            tableCount: body.tableCount ?? body.table_count,
            parcelCount: body.parcelCount ?? body.parcel_count
        });
        return res.json({ ok: true, ...config, venue: venuePublicPayload(req.adminVenue) });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin floor-config put:', err.message);
        return res.status(code).json({ error: err.message || 'Could not save floor configuration.' });
    }
});

app.get('/api/admin/venues', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const venues = await listVenuesForAdmin(req.adminVenue);
        res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.json({ ok: true, venues, isMain: Boolean(req.adminVenue.isDefault) });
    } catch (err) {
        console.error('admin venues get:', err.message);
        return res.status(500).json({ error: 'Could not load hotels.' });
    }
});

app.post('/api/admin/venues', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const venue = await createVenueByMain(req.adminVenue, req.body || {});
        return res.status(201).json({ ok: true, venue });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin venues post:', err.message);
        return res.status(code).json({ error: err.message || 'Could not create hotel.' });
    }
});

app.patch('/api/admin/venues/:id', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const venueId = parseId(req.params.id);
        if (Number.isNaN(venueId)) {
            return res.status(400).json({ error: 'Invalid hotel id.' });
        }
        const venue = await updateVenueAccessByMain(req.adminVenue, venueId, req.body || {});
        return res.json({ ok: true, venue });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin venues patch:', err.message);
        return res.status(code).json({ error: err.message || 'Could not update hotel.' });
    }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const scope = (req.query && String(req.query.scope || '').trim().toLowerCase()) || '';
        const venueId = req.adminVenue.id;
        const rows =
            scope === 'floor'
                ? await listFloorSessionsForAdmin(venueId)
                : await listAllOrdersForAdmin(venueId, 150);
        res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.json({ orders: rows });
    } catch (err) {
        console.error('admin orders:', err.message);
        return res.status(500).json({ error: 'Could not load orders.' });
    }
});

app.post('/api/admin/orders', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const body = req.body || {};
        const act = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';
        const venueId = req.adminVenue.id;
        if (act === 'floor_open') {
            const order = await createFloorSession(venueId, body.channel, body.slot, body.guest_label);
            return res.status(201).json({ ok: true, order });
        }
        if (act === 'floor_commit') {
            const order = await commitFloorOrderToDb(venueId, body);
            return res.status(201).json({ ok: true, order });
        }
        return res.status(400).json({
            error:
                'Unknown action. Use floor_open for new sessions or floor_commit to save a completed local session.'
        });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('admin create order:', err.message);
        }
        return res.status(code).json({ error: err.message || 'Could not create order.' });
    }
});

app.patch('/api/admin/orders/:id', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const orderId = parseId(req.params.id);
        if (Number.isNaN(orderId)) {
            return res.status(400).json({ error: 'Invalid order id.' });
        }
        const body = req.body || {};
        const action = typeof body.action === 'string' ? body.action.trim() : '';
        if (!action) {
            return res.status(400).json({ error: 'Missing action.' });
        }
        const venueId = req.adminVenue.id;
        if (action.startsWith('floor_')) {
            const updated = await applyFloorOrderAdminPatch(orderId, body, venueId);
            return res.json({ ok: true, order: updated });
        }
        const updated = await applyAdminOrderAction(orderId, action, body, venueId);
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
    return res.json({
        ok: true,
        venue: venuePublicPayload(req.adminVenue),
        floorConfig: {
            tableCount: req.adminVenue.tableCount,
            parcelCount: req.adminVenue.parcelCount
        }
    });
});

app.get('/admin/tables', (req, res) => {
    res.sendFile(path.join(ROOT, 'admin-tables.html'));
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

app.get('/privacy-policy', (req, res) => {
    res.sendFile(path.join(ROOT, 'privacy-policy.html'));
});

app.get(['/download', '/install'], (req, res) => {
    res.sendFile(path.join(ROOT, 'download.html'));
});

app.use(express.static(ROOT));

app.listen(PORT, () => {
    console.log(`Server http://localhost:${PORT}`);
    console.log('Admin dashboard: /admin (set DATABASE_URL for orders DB)');
    ensureSchema().catch((err) => {
        console.warn('Could not run DB migrations yet:', err.message);
    });
});
