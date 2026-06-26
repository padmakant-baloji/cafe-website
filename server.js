'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const { ensureSchema } = require('./lib/schema');
const { signCustomerSession, verifyCustomerSession } = require('./lib/customer-session');
const { signAdminSession } = require('./lib/admin-session');
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
    cancelOrderByCustomer,
    cleanupOldScreenshots
} = require('./lib/order-service');
const { placeOrderForCustomer } = require('./lib/place-order');
const { placeGroceryOrderForCustomer } = require('./lib/place-grocery-order');
const {
    getGroceryStorefront,
    listGroceryCategoriesForAdmin,
    upsertGroceryCategory,
    deleteGroceryCategory,
    listGroceryProductsForAdmin,
    upsertGroceryProduct,
    deleteGroceryProduct,
    adjustGroceryStock,
    getLowStockProducts
} = require('./lib/grocery-service');
const { validateCoupon } = require('./lib/coupon-service');
const { getStoreStatus, setStoreStatus, getPublicStorefrontStatus } = require('./lib/store-status');
const { resolveAdminVenue, authenticateAdminUser, getFloorConfig, setFloorConfig, resolvePublicVenue, venuePublicPayload, listVenuesForAdmin, createVenueByMain, updateVenueAccessByMain } = require('./lib/venue-service');
const { getAggregatedCustomerMenu, getAdminMenuForVenue, saveAdminMenuForVenue } = require('./lib/menu-service');
const { listDeliveryZones, upsertDeliveryZone, deleteDeliveryZone } = require('./lib/delivery-zone-service');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

app.use(express.json({ limit: '5mb' }));

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
            venueHoursText: order.venueHoursText || '',
            venuePaymentQrCode: order.venuePaymentQrCode || ''
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

app.patch('/api/orders/:id/screenshot', requireCustomer, async (req, res) => {
    try {
        await ensureSchema();
        const orderId = parseId(req.params.id);
        if (Number.isNaN(orderId)) {
            return res.status(400).json({ error: 'Invalid order id.' });
        }
        
        const { paymentScreenshot } = req.body || {};
        if (!paymentScreenshot || typeof paymentScreenshot !== 'string') {
            return res.status(400).json({ error: 'Invalid screenshot.' });
        }
        
        const { query } = require('./lib/db.js');
        // ensure customer owns order
        const { rows } = await query(
            `UPDATE orders SET payment_screenshot = $1
             WHERE id = $2 AND customer_mobile = $3
             RETURNING id, payment_screenshot`,
            [paymentScreenshot, orderId, req.customerSession.mobile]
        );
        
        if (rows.length === 0) {
             return res.status(404).json({ error: 'Order not found or unauthorized.' });
        }
        
        return res.json({ ok: true });
    } catch (err) {
        console.error('upload screenshot error:', err.message);
        return res.status(500).json({ error: 'Could not upload screenshot.' });
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

app.get('/api/grocery', async (req, res) => {
    try {
        await ensureSchema();
        const storefront = await getGroceryStorefront();
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.json(storefront);
    } catch (err) {
        console.error('grocery:', err.message);
        return res.status(500).json({ error: 'Could not load grocery store.' });
    }
});

app.post('/api/grocery/order', requireCustomer, async (req, res) => {
    try {
        await ensureSchema();
        const order = await placeGroceryOrderForCustomer(req.customerSession.mobile, req.body || {});
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
            console.error('place grocery order:', err.message);
        }
        return res.status(code).json({ error: err.message || 'Could not place order.' });
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

function groceryTargetVenueId(req) {
    const fromQuery = req.query && req.query.venueId != null ? parseInt(String(req.query.venueId), 10) : NaN;
    if (Number.isFinite(fromQuery)) return fromQuery;
    const fromBody = req.body && req.body.venueId != null ? parseInt(String(req.body.venueId), 10) : NaN;
    return Number.isFinite(fromBody) ? fromBody : null;
}

function sendGroceryError(res, err, fallback) {
    const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (code >= 500) console.error('grocery admin:', err.message);
    return res.status(code).json({ error: err.message || fallback });
}

app.get('/api/admin/grocery/categories', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const data = await listGroceryCategoriesForAdmin(req.adminVenue, groceryTargetVenueId(req));
        res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.json({ ok: true, ...data });
    } catch (err) {
        return sendGroceryError(res, err, 'Could not load categories.');
    }
});

app.post('/api/admin/grocery/categories', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const category = await upsertGroceryCategory(req.adminVenue, groceryTargetVenueId(req), req.body || {});
        return res.json({ ok: true, category });
    } catch (err) {
        return sendGroceryError(res, err, 'Could not save category.');
    }
});

app.patch('/api/admin/grocery/categories/:id', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const category = await upsertGroceryCategory(req.adminVenue, groceryTargetVenueId(req), {
            ...(req.body || {}),
            id: parseId(req.params.id)
        });
        return res.json({ ok: true, category });
    } catch (err) {
        return sendGroceryError(res, err, 'Could not save category.');
    }
});

app.delete('/api/admin/grocery/categories/:id', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const result = await deleteGroceryCategory(req.adminVenue, groceryTargetVenueId(req), parseId(req.params.id));
        return res.json({ ok: true, ...result });
    } catch (err) {
        return sendGroceryError(res, err, 'Could not delete category.');
    }
});

app.get('/api/admin/grocery/products', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const data = await listGroceryProductsForAdmin(req.adminVenue, groceryTargetVenueId(req));
        res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.json({ ok: true, ...data });
    } catch (err) {
        return sendGroceryError(res, err, 'Could not load products.');
    }
});

app.post('/api/admin/grocery/products', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const product = await upsertGroceryProduct(req.adminVenue, groceryTargetVenueId(req), req.body || {});
        return res.json({ ok: true, product });
    } catch (err) {
        return sendGroceryError(res, err, 'Could not save product.');
    }
});

app.patch('/api/admin/grocery/products/:id', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const product = await upsertGroceryProduct(req.adminVenue, groceryTargetVenueId(req), {
            ...(req.body || {}),
            id: parseId(req.params.id)
        });
        return res.json({ ok: true, product });
    } catch (err) {
        return sendGroceryError(res, err, 'Could not save product.');
    }
});

app.delete('/api/admin/grocery/products/:id', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const result = await deleteGroceryProduct(req.adminVenue, groceryTargetVenueId(req), parseId(req.params.id));
        return res.json({ ok: true, ...result });
    } catch (err) {
        return sendGroceryError(res, err, 'Could not delete product.');
    }
});

app.post('/api/admin/grocery/products/:id/stock', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const product = await adjustGroceryStock(
            req.adminVenue,
            groceryTargetVenueId(req),
            parseId(req.params.id),
            req.body || {}
        );
        return res.json({ ok: true, product });
    } catch (err) {
        return sendGroceryError(res, err, 'Could not adjust stock.');
    }
});

app.get('/api/admin/grocery/low-stock', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const data = await getLowStockProducts(req.adminVenue, groceryTargetVenueId(req));
        res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.json({ ok: true, ...data });
    } catch (err) {
        return sendGroceryError(res, err, 'Could not load low-stock items.');
    }
});

app.post('/api/admin/grocery/pos-order', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const body = req.body || {};
        
        // 1. Get venue
        const venueId = groceryTargetVenueId(req) || req.adminVenue.id;
        
        // 2. Validate items
        const { validateAndPriceGroceryOrder } = require('./lib/grocery-service');
        const priced = await validateAndPriceGroceryOrder({
            storeId: venueId,
            items: body.items,
            total: body.total,
            isPos: true
        });
        
        // 3. Connect to DB to deduct stock and insert order atomically
        const { getPool } = require('./lib/db');
        const pool = await getPool();
        const client = await pool.connect();
        let order;
        try {
            await client.query('BEGIN');

            for (const item of priced.normalizedItems) {
                const { rowCount } = await client.query(
                    `UPDATE grocery_products
                     SET stock_qty = stock_qty - $3, updated_at = NOW()
                     WHERE id = $1 AND venue_id = $2 AND stock_qty >= $3 AND enabled = TRUE`,
                    [item.productId, venueId, item.quantity]
                );
                if (rowCount !== 1) {
                    throw new Error(`Item out of stock or insufficient quantity: ${item.name}`);
                }
            }

            const { rows } = await client.query(
                `INSERT INTO orders (customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, venue_id, channel)
                 VALUES ($1, 'completed', $2::jsonb, $3, $4, $5, $6, $7, $8::jsonb, $9, 'walk_in')
                 RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, venue_id, channel`,
                [
                    body.customerMobile || '8888888888', // Default walk-in mobile
                    JSON.stringify(priced.normalizedItems),
                    priced.subtotal,
                    priced.deliveryFee,
                    priced.discount,
                    null,
                    priced.total,
                    JSON.stringify({ label: 'POS', addressLine: 'Walk-in Store Purchase', city: '' }),
                    venueId
                ]
            );
            order = rows[0];

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        return res.json({ ok: true, orderId: order.id });
    } catch (err) {
        return sendGroceryError(res, err, 'Could not complete POS order.');
    }
});

// ─── Grocery Staff CRUD ───────────────────────────────────

app.get('/api/admin/grocery/staff', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const { resolveGroceryAdminVenue } = require('./lib/grocery-service');
        const venue = await resolveGroceryAdminVenue(req.adminVenue, groceryTargetVenueId(req));
        const { rows } = await require('./lib/db').query(
            `SELECT id, venue_id, name, phone, role, pin, enabled, created_at, updated_at
             FROM grocery_staff WHERE venue_id = $1 ORDER BY name ASC`,
            [venue.id]
        );
        return res.json({ ok: true, staff: rows.map(r => ({
            id: Number(r.id), venueId: Number(r.venue_id),
            name: r.name, phone: r.phone || '', role: r.role,
            pin: r.pin || '', enabled: r.enabled !== false,
            createdAt: r.created_at, updatedAt: r.updated_at
        })) });
    } catch (err) { return sendGroceryError(res, err, 'Could not load staff.'); }
});

app.post('/api/admin/grocery/staff', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const { resolveGroceryAdminVenue } = require('./lib/grocery-service');
        const venue = await resolveGroceryAdminVenue(req.adminVenue, groceryTargetVenueId(req));
        const b = req.body || {};
        const name = String(b.name || '').trim().slice(0, 120);
        if (!name) return res.status(400).json({ error: 'Name is required.' });
        const phone = String(b.phone || '').trim().slice(0, 15);
        const validRoles = ['owner', 'manager', 'cashier', 'inventory'];
        const role = validRoles.includes(b.role) ? b.role : 'cashier';
        const pin = String(b.pin || '').trim().slice(0, 6);
        const enabled = b.enabled !== false;
        const { rows } = await require('./lib/db').query(
            `INSERT INTO grocery_staff (venue_id, name, phone, role, pin, enabled)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, venue_id, name, phone, role, pin, enabled, created_at, updated_at`,
            [venue.id, name, phone, role, pin, enabled]
        );
        const r = rows[0];
        return res.json({ ok: true, staff: {
            id: Number(r.id), venueId: Number(r.venue_id),
            name: r.name, phone: r.phone, role: r.role,
            pin: r.pin, enabled: r.enabled,
            createdAt: r.created_at, updatedAt: r.updated_at
        } });
    } catch (err) { return sendGroceryError(res, err, 'Could not add staff.'); }
});

app.patch('/api/admin/grocery/staff/:id', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const { resolveGroceryAdminVenue } = require('./lib/grocery-service');
        const venue = await resolveGroceryAdminVenue(req.adminVenue, groceryTargetVenueId(req));
        const id = parseInt(String(req.params.id), 10);
        if (!id) return res.status(400).json({ error: 'Invalid staff id.' });
        const b = req.body || {};
        const name = String(b.name || '').trim().slice(0, 120);
        if (!name) return res.status(400).json({ error: 'Name is required.' });
        const phone = String(b.phone || '').trim().slice(0, 15);
        const validRoles = ['owner', 'manager', 'cashier', 'inventory'];
        const role = validRoles.includes(b.role) ? b.role : 'cashier';
        const pin = String(b.pin || '').trim().slice(0, 6);
        const enabled = b.enabled !== false;
        const { rows } = await require('./lib/db').query(
            `UPDATE grocery_staff SET name=$2, phone=$3, role=$4, pin=$5, enabled=$6, updated_at=NOW()
             WHERE id=$1 AND venue_id=$7
             RETURNING id, venue_id, name, phone, role, pin, enabled, created_at, updated_at`,
            [id, name, phone, role, pin, enabled, venue.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Staff not found.' });
        const r = rows[0];
        return res.json({ ok: true, staff: {
            id: Number(r.id), venueId: Number(r.venue_id),
            name: r.name, phone: r.phone, role: r.role,
            pin: r.pin, enabled: r.enabled,
            createdAt: r.created_at, updatedAt: r.updated_at
        } });
    } catch (err) { return sendGroceryError(res, err, 'Could not update staff.'); }
});

app.delete('/api/admin/grocery/staff/:id', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const { resolveGroceryAdminVenue } = require('./lib/grocery-service');
        const venue = await resolveGroceryAdminVenue(req.adminVenue, groceryTargetVenueId(req));
        const id = parseInt(String(req.params.id), 10);
        if (!id) return res.status(400).json({ error: 'Invalid staff id.' });
        await require('./lib/db').query(
            `DELETE FROM grocery_staff WHERE id = $1 AND venue_id = $2`, [id, venue.id]
        );
        return res.json({ ok: true });
    } catch (err) { return sendGroceryError(res, err, 'Could not delete staff.'); }
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

app.post('/api/admin/login', async (req, res) => {
    try {
        await ensureSchema();
        const body = req.body || {};
        let user = String(body.user || body.username || '').trim();
        let pass = String(body.pass || body.password || '');

        if (!user || !pass) {
            const auth = req.headers.authorization;
            if (auth && auth.startsWith('Basic ')) {
                try {
                    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
                    const colon = decoded.indexOf(':');
                    user = colon >= 0 ? decoded.slice(0, colon) : decoded;
                    pass = colon >= 0 ? decoded.slice(colon + 1) : '';
                } catch {
                    /* ignore */
                }
            }
        }

        if (!user || !pass) {
            return res.status(400).json({ error: 'Username and password are required.' });
        }

        const venue = await authenticateAdminUser(user, pass);
        if (!venue) {
            return res.status(401).json({ error: 'Invalid admin credentials.' });
        }

        const token = signAdminSession(venue.id);
        return res.json({
            ok: true,
            token,
            venue: venuePublicPayload(venue),
            floorConfig: {
                tableCount: venue.tableCount,
                parcelCount: venue.parcelCount
            }
        });
    } catch (err) {
        console.error('admin login:', err.message);
        return res.status(500).json({ error: 'Could not sign in.' });
    }
});

app.get('/api/admin/delivery-zones', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const venueId = req.adminVenue.isDefault ? null : req.adminVenue.id;
        const zones = await listDeliveryZones(venueId);
        res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.json({ ok: true, zones });
    } catch (err) {
        console.error('admin delivery-zones get:', err.message);
        return res.status(500).json({ error: 'Could not load delivery zones.' });
    }
});

app.post('/api/admin/delivery-zones', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const venueId = req.adminVenue.isDefault ? null : req.adminVenue.id;
        const zone = await upsertDeliveryZone(venueId, req.body || {});
        return res.json({ ok: true, zone });
    } catch (err) {
        const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin delivery-zones post:', err.message);
        return res.status(code).json({ error: err.message || 'Could not save delivery zone.' });
    }
});

app.delete('/api/admin/delivery-zones/:id', requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const id = parseInt(String(req.params.id), 10);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid zone id.' });
        const result = await deleteDeliveryZone(id);
        return res.json({ ok: true, ...result });
    } catch (err) {
        const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin delivery-zones delete:', err.message);
        return res.status(code).json({ error: err.message || 'Could not delete delivery zone.' });
    }
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

app.get('/admin-login', (req, res) => {
    res.sendFile(path.join(ROOT, 'admin-login.html'));
});

app.get('/menu', (req, res) => {
    res.sendFile(path.join(ROOT, 'index.html'));
});

app.get('/grocery-admin', (req, res) => {
    res.sendFile(path.join(ROOT, 'grocery-admin.html'));
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

    // Cleanup old user-uploaded screenshots from DB (3 days old)
    cleanupOldScreenshots().catch(() => {});
    setInterval(() => {
        cleanupOldScreenshots().catch(() => {});
    }, 6 * 60 * 60 * 1000); // Run every 6 hours
});
