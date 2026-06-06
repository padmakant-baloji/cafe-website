'use strict';

const { ensureSchema } = require('./schema');
const { verifyCustomerSession, signCustomerSession } = require('./customer-session');
const { placeOrderForCustomer } = require('./place-order');
const { validateCoupon } = require('./coupon-service');
const { getStoreStatus, setStoreStatus, getPublicStorefrontStatus } = require('./store-status');
const { requireAdminApi, resolveCustomerSession } = require('./api-auth');
const {
    getFloorConfig,
    setFloorConfig,
    resolvePublicVenue,
    venuePublicPayload,
    listVenuesForAdmin,
    createVenueByMain,
    updateVenueAccessByMain,
    updateVenueProfile
} = require('./venue-service');
const { getAggregatedCustomerMenu, getAdminMenuForVenue, saveAdminMenuForVenue } = require('./menu-service');
const {
    normalizeMobile,
    findCustomerByMobile,
    getCustomerByMobile,
    createCustomer,
    listCustomerAddresses,
    upsertDefaultCustomerAddress,
    updateCustomerAddressById,
    updateCustomerProfile,
    listOrdersForCustomer,
    cancelOrderByCustomer,
    listAllOrdersForAdmin,
    listFloorSessionsForAdmin,
    createFloorSession,
    commitFloorOrderToDb,
    applyAdminOrderAction,
    applyFloorOrderAdminPatch
} = require('./order-service');

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

function segmentsToApiPath(value) {
    const segments = Array.isArray(value)
        ? value.flatMap((s) => String(s).split('/'))
        : String(value).split('/');
    const suffix = segments
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s !== 'api')
        .join('/');
    return suffix ? `/api/${suffix}` : '';
}

function apiPathname(req) {
    // Preferred: the explicit path the vercel.json rewrite forwards
    // (`/api/:path*` -> `/api/index?__apiPath=:path*`). This is reliable whether or
    // not `req.url` reflects the original request path after the rewrite.
    const q = req.query || {};
    if (q.__apiPath != null) {
        const fromRewrite = segmentsToApiPath(q.__apiPath);
        if (fromRewrite) return fromRewrite;
    }

    const raw = req.url || '/';
    const pathOnly = String(raw).split('?')[0] || '/';
    let normalized = pathOnly.replace(/\/+$/, '') || '/';
    if (!normalized.startsWith('/api')) {
        normalized = normalized === '/' ? '/api' : `/api${normalized}`;
    }
    // Legacy / edge: some deployments exposed only `/api` on `req.url` with segments in `query.path`.
    if ((normalized === '/api' || normalized === '/api/index') && q.path != null) {
        const fromLegacy = segmentsToApiPath(q.path);
        if (fromLegacy) normalized = fromLegacy;
    }
    return normalized;
}

/**
 * Vercel populates `req.body` when Content-Type is set; it can be undefined, a string, Buffer, or object.
 * Malformed JSON can throw on access — normalize to a plain object for handlers.
 */
function safeGetJsonBody(req) {
    try {
        const b = req.body;
        if (b == null) return {};
        if (typeof b === 'string') {
            const t = b.trim();
            if (!t) return {};
            try {
                return JSON.parse(b);
            } catch {
                return {};
            }
        }
        if (Buffer.isBuffer(b)) {
            const t = b.toString('utf8').trim();
            if (!t) return {};
            try {
                return JSON.parse(t);
            } catch {
                return {};
            }
        }
        if (typeof b === 'object') return b;
    } catch {
        return {};
    }
    return {};
}

function jsonError(res, status, message) {
    return res.status(status).json({ error: message });
}

async function handlePostOrder(req, res) {
    const auth = req.headers.authorization;
    let session = null;
    if (auth && auth.startsWith('Bearer ')) {
        session = verifyCustomerSession(auth.slice(7).trim());
    }
    if (!session) {
        const fallbackMobile = normalizeMobile(req.headers['x-customer-mobile']);
        if (fallbackMobile) {
            await ensureSchema();
            const customer = await getCustomerByMobile(fallbackMobile);
            if (customer) session = { mobile: customer.mobile };
        }
    }
    if (!session) return jsonError(res, 401, 'Sign in required.');

    try {
        await ensureSchema();
        const order = await placeOrderForCustomer(session.mobile, req.body || {});
        const id = typeof order.id === 'string' ? parseInt(order.id, 10) : Number(order.id);
        return res.status(200).json({
            ok: true,
            orderId: id,
            status: order.status,
            created_at: order.created_at
        });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('Order error:', err.message);
        return res.status(code).json({ error: err.message || 'Could not place order.' });
    }
}

async function handlePostAuthLookup(req, res) {
    try {
        await ensureSchema();
        const mobile = normalizeMobile(req.body && req.body.mobile);
        if (!mobile || mobile.length !== 10) {
            return jsonError(res, 400, 'Enter a valid 10-digit mobile number.');
        }
        const row = await findCustomerByMobile(mobile);
        if (!row) return res.status(200).json({ exists: false });
        return res.status(200).json({
            exists: true,
            token: signCustomerSession(row.mobile),
            customer: await serializeCustomer(row)
        });
    } catch (err) {
        console.error('auth/lookup:', err.message);
        return jsonError(res, 500, 'Could not reach database.');
    }
}

async function handlePostAuthRegister(req, res) {
    try {
        await ensureSchema();
        const body = req.body || {};
        const mobile = normalizeMobile(body.mobile);
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
        const city = typeof body.city === 'string' ? body.city.trim().slice(0, 200) : '';
        const addressLine =
            typeof body.addressLine === 'string' ? body.addressLine.trim().slice(0, 300) : '';

        if (!mobile || mobile.length !== 10) {
            return jsonError(res, 400, 'Enter a valid 10-digit mobile number.');
        }
        if (!name || !city) return jsonError(res, 400, 'Name and city are required.');
        if (!addressLine) return jsonError(res, 400, 'Delivery address is required.');

        let row;
        try {
            row = await createCustomer(mobile, name, city);
        } catch (e) {
            if (e && e.code === '23505') {
                return jsonError(res, 409, 'This number is already registered. Go back and continue.');
            }
            throw e;
        }

        await upsertDefaultCustomerAddress(mobile, { label: 'Delivery', addressLine, city });

        return res.status(200).json({
            token: signCustomerSession(row.mobile),
            customer: await serializeCustomer(row)
        });
    } catch (err) {
        console.error('auth/register:', err.message);
        return jsonError(res, 500, 'Could not save profile.');
    }
}

async function handleGetAuthMe(req, res) {
    try {
        await ensureSchema();
        const session = await resolveCustomerSession(req);
        if (!session) return jsonError(res, 401, 'Session expired.');
        const row = await getCustomerByMobile(session.mobile);
        if (!row) return jsonError(res, 401, 'Session expired.');
        return res.status(200).json({ customer: await serializeCustomer(row) });
    } catch (err) {
        console.error('auth/me:', err.message);
        return jsonError(res, 500, 'Database error.');
    }
}

async function handlePatchAuthProfile(req, res) {
    try {
        await ensureSchema();
        const session = await resolveCustomerSession(req);
        if (!session) return jsonError(res, 401, 'Session expired.');
        const body = req.body || {};
        const updated = await updateCustomerProfile(session.mobile, body.name, body.city);
        const customer = updated || (await getCustomerByMobile(session.mobile));
        return res.status(200).json({ customer: await serializeCustomer(customer) });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('auth/profile:', err.message);
        return res.status(code).json({ error: err.message || 'Could not update profile.' });
    }
}

async function handlePatchAuthAddress(req, res) {
    try {
        await ensureSchema();
        const session = await resolveCustomerSession(req);
        if (!session) return jsonError(res, 401, 'Session expired.');
        const body = req.body || {};
        const addressLine =
            typeof body.addressLine === 'string' ? body.addressLine.trim().slice(0, 300) : '';
        const city = typeof body.city === 'string' ? body.city.trim().slice(0, 200) : '';
        if (!addressLine) return jsonError(res, 400, 'Delivery address is required.');
        const payload = { label: 'Delivery', addressLine, city };
        if (body.addressId != null && String(body.addressId).trim() !== '') {
            await updateCustomerAddressById(session.mobile, body.addressId, payload, { makeDefault: true });
        } else {
            await upsertDefaultCustomerAddress(session.mobile, payload);
        }
        const row = await getCustomerByMobile(session.mobile);
        return res.status(200).json({ customer: await serializeCustomer(row) });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('auth/address:', err.message);
        return res.status(code).json({ error: err.message || 'Could not save address.' });
    }
}

async function handleGetOrdersMy(req, res) {
    try {
        await ensureSchema();
        const session = await resolveCustomerSession(req);
        if (!session) return jsonError(res, 401, 'Sign in required.');
        const rows = await listOrdersForCustomer(session.mobile, 50);
        return res.status(200).json({ orders: rows });
    } catch (err) {
        console.error('orders/my:', err.message);
        return jsonError(res, 500, 'Could not load orders.');
    }
}

async function handlePostOrderCancel(req, res, orderId) {
    try {
        await ensureSchema();
        const session = await resolveCustomerSession(req);
        if (!session) return jsonError(res, 401, 'Sign in required.');
        const updated = await cancelOrderByCustomer(orderId, session.mobile);
        return res.status(200).json({ ok: true, order: updated });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('cancel order:', err.message);
        return res.status(code).json({ error: err.message || 'Could not cancel order.' });
    }
}

async function handlePostCouponsValidate(req, res) {
    try {
        await ensureSchema();
        const session = await resolveCustomerSession(req);
        if (!session) return jsonError(res, 401, 'Sign in required.');

        const body = req.body || {};
        const code = typeof body.code === 'string' ? body.code : '';
        const subtotal =
            typeof body.subtotal === 'number' && Number.isFinite(body.subtotal)
                ? body.subtotal
                : parseInt(String(body.subtotal || 0), 10);

        const result = await validateCoupon(code, subtotal);
        if (!result.ok) {
            return res
                .status(400)
                .json({ ok: false, error: result.message, code: result.code || '' });
        }
        return res
            .status(200)
            .json({ ok: true, code: result.code, discount: result.discount, message: result.message });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('coupons/validate:', err.message);
        return res
            .status(code)
            .json({ ok: false, error: err.message || 'Could not validate coupon.' });
    }
}

async function handleGetAdminOrders(req, res) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    try {
        await ensureSchema();
        const scope = String((req.query && req.query.scope) || '')
            .trim()
            .toLowerCase();
        const rows =
            scope === 'floor'
                ? await listFloorSessionsForAdmin(venue.id)
                : await listAllOrdersForAdmin(venue.id, 150);
        res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.status(200).json({ orders: rows });
    } catch (err) {
        console.error('admin orders:', err.message);
        return jsonError(res, 500, 'Could not load orders.');
    }
}

async function handlePostAdminOrders(req, res) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    try {
        await ensureSchema();
        const body = typeof req.body === 'object' && req.body ? req.body : {};
        const act = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';
        if (act === 'floor_open') {
            const order = await createFloorSession(venue.id, body.channel, body.slot, body.guest_label);
            return res.status(201).json({ ok: true, order });
        }
        if (act === 'floor_commit') {
            const order = await commitFloorOrderToDb(venue.id, body);
            return res.status(201).json({ ok: true, order });
        }
        return res.status(400).json({
            error:
                'Unknown action. Use floor_open for new sessions or floor_commit to save a completed local session.'
        });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin create order:', err.message);
        return res.status(code).json({ error: err.message || 'Could not create order.' });
    }
}

async function handlePatchAdminOrder(req, res, orderId) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    try {
        await ensureSchema();
        const body = typeof req.body === 'object' && req.body ? req.body : {};
        const action = typeof body.action === 'string' ? body.action.trim() : '';
        if (!action) return jsonError(res, 400, 'Missing action.');
        if (action.startsWith('floor_')) {
            const updated = await applyFloorOrderAdminPatch(orderId, body, venue.id);
            return res.status(200).json({ ok: true, order: updated });
        }
        const updated = await applyAdminOrderAction(orderId, action, body, venue.id);
        return res.status(200).json({ ok: true, order: updated });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin patch order:', err.message);
        return res.status(code).json({ error: err.message || 'Update failed.' });
    }
}

async function handleGetAdminSession(req, res) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    return res.status(200).json({
        ok: true,
        venue: venuePublicPayload(venue),
        floorConfig: {
            tableCount: venue.tableCount,
            parcelCount: venue.parcelCount
        }
    });
}

async function handleGetMenu(req, res) {
    try {
        await ensureSchema();
        const menu = await getAggregatedCustomerMenu();
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.status(200).json(menu);
    } catch (err) {
        console.error('menu:', err.message);
        return jsonError(res, 500, 'Could not load menu.');
    }
}

async function handleGetAdminMenu(req, res) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    try {
        await ensureSchema();
        const targetVenueId = req.query && req.query.venueId ? parseInt(String(req.query.venueId), 10) : null;
        const menu = await getAdminMenuForVenue(venue, Number.isFinite(targetVenueId) ? targetVenueId : null);
        res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.status(200).json({ ok: true, ...menu });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin menu get:', err.message);
        return res.status(code).json({ error: err.message || 'Could not load menu.' });
    }
}

async function handlePutAdminMenu(req, res) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    try {
        await ensureSchema();
        const targetVenueId = req.query && req.query.venueId ? parseInt(String(req.query.venueId), 10) : null;
        const menu = await saveAdminMenuForVenue(
            venue,
            Number.isFinite(targetVenueId) ? targetVenueId : null,
            req.body || {}
        );
        return res.status(200).json({ ok: true, ...menu });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin menu put:', err.message);
        return res.status(code).json({ error: err.message || 'Could not save menu.' });
    }
}

async function handlePutAdminVenueProfile(req, res) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    try {
        await ensureSchema();
        const body = typeof req.body === 'object' && req.body ? req.body : {};
        const updated = await updateVenueProfile(venue, body);
        return res.status(200).json({ ok: true, venue: updated });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin venue-profile:', err.message);
        return jsonError(res, code, err.message || 'Could not update hotel details.');
    }
}

async function handleGetStoreStatus(req, res) {
    try {
        await ensureSchema();
        const status = await getPublicStorefrontStatus();
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.status(200).json(status);
    } catch (err) {
        console.error('store-status:', err.message);
        return res
            .status(200)
            .json({ acceptingOrders: true, reason: null, notice: null, updatedAt: null });
    }
}

async function handleGetAdminStoreStatus(req, res) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    try {
        await ensureSchema();
        const status = await getStoreStatus(venue.id);
        res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.status(200).json(status);
    } catch (err) {
        console.error('admin store-status get:', err.message);
        return jsonError(res, 500, 'Could not load store status.');
    }
}

async function handlePostAdminStoreStatus(req, res) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    try {
        await ensureSchema();
        const body = typeof req.body === 'object' && req.body ? req.body : {};
        const status = await setStoreStatus(venue.id, {
            acceptingOrders: Boolean(body.acceptingOrders),
            reason: typeof body.reason === 'string' ? body.reason : ''
        });
        return res.status(200).json({ ok: true, ...status });
    } catch (err) {
        console.error('admin store-status:', err.message);
        return jsonError(res, 500, 'Could not update store status.');
    }
}

async function handleGetAdminFloorConfig(req, res) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    try {
        await ensureSchema();
        const config = await getFloorConfig(venue.id);
        res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.status(200).json({ ok: true, ...config, venue: venuePublicPayload(venue) });
    } catch (err) {
        console.error('admin floor-config get:', err.message);
        return jsonError(res, 500, 'Could not load floor configuration.');
    }
}

async function handlePutAdminFloorConfig(req, res) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    try {
        await ensureSchema();
        const body = typeof req.body === 'object' && req.body ? req.body : {};
        const config = await setFloorConfig(venue.id, {
            tableCount: body.tableCount ?? body.table_count,
            parcelCount: body.parcelCount ?? body.parcel_count
        });
        return res.status(200).json({ ok: true, ...config, venue: venuePublicPayload(venue) });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin floor-config put:', err.message);
        return res.status(code).json({ error: err.message || 'Could not save floor configuration.' });
    }
}

async function handleGetAdminVenues(req, res) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    try {
        await ensureSchema();
        const venues = await listVenuesForAdmin(venue);
        res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.status(200).json({ ok: true, venues, isMain: Boolean(venue.isDefault) });
    } catch (err) {
        console.error('admin venues get:', err.message);
        return jsonError(res, 500, 'Could not load hotels.');
    }
}

async function handlePostAdminVenues(req, res) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    try {
        await ensureSchema();
        const created = await createVenueByMain(venue, req.body || {});
        return res.status(201).json({ ok: true, venue: created });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin venues post:', err.message);
        return res.status(code).json({ error: err.message || 'Could not create hotel.' });
    }
}

async function handlePatchAdminVenue(req, res, venueId) {
    const venue = await requireAdminApi(req, res);
    if (!venue) return;
    try {
        await ensureSchema();
        const updated = await updateVenueAccessByMain(venue, venueId, req.body || {});
        return res.status(200).json({ ok: true, venue: updated });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin venues patch:', err.message);
        return res.status(code).json({ error: err.message || 'Could not update hotel.' });
    }
}

/**
 * Vercel: ONE Serverless Function (api/index.js) routes all /api/* traffic here.
 * Do not add per-route files under api/ — Hobby plan max is 12 functions.
 */
async function handleVercelApi(req, res) {
    const pathname = apiPathname(req);
    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
        req.body = safeGetJsonBody(req);
    }

    if (method === 'POST' && pathname === '/api/order') {
        return handlePostOrder(req, res);
    }
    if (method === 'POST' && pathname === '/api/auth/lookup') {
        return handlePostAuthLookup(req, res);
    }
    if (method === 'POST' && pathname === '/api/auth/register') {
        return handlePostAuthRegister(req, res);
    }
    if (method === 'GET' && pathname === '/api/auth/me') {
        return handleGetAuthMe(req, res);
    }
    if (method === 'PATCH' && pathname === '/api/auth/profile') {
        return handlePatchAuthProfile(req, res);
    }
    if (method === 'PATCH' && pathname === '/api/auth/address') {
        return handlePatchAuthAddress(req, res);
    }
    if (method === 'GET' && pathname === '/api/orders/my') {
        return handleGetOrdersMy(req, res);
    }
    if (method === 'POST' && pathname === '/api/coupons/validate') {
        return handlePostCouponsValidate(req, res);
    }
    if (method === 'GET' && pathname === '/api/admin/orders') {
        return handleGetAdminOrders(req, res);
    }
    if (method === 'POST' && pathname === '/api/admin/orders') {
        return handlePostAdminOrders(req, res);
    }
    if (method === 'GET' && pathname === '/api/admin/session') {
        return handleGetAdminSession(req, res);
    }
    if (method === 'GET' && pathname === '/api/admin/floor-config') {
        return handleGetAdminFloorConfig(req, res);
    }
    if (method === 'PUT' && pathname === '/api/admin/floor-config') {
        return handlePutAdminFloorConfig(req, res);
    }
    if (method === 'GET' && pathname === '/api/admin/venues') {
        return handleGetAdminVenues(req, res);
    }
    if (method === 'POST' && pathname === '/api/admin/venues') {
        return handlePostAdminVenues(req, res);
    }
    if (method === 'GET' && pathname === '/api/menu') {
        return handleGetMenu(req, res);
    }
    if (method === 'GET' && pathname === '/api/admin/menu') {
        return handleGetAdminMenu(req, res);
    }
    if (method === 'PUT' && pathname === '/api/admin/menu') {
        return handlePutAdminMenu(req, res);
    }
    if (method === 'GET' && pathname === '/api/store-status') {
        return handleGetStoreStatus(req, res);
    }
    if (method === 'GET' && pathname === '/api/admin/store-status') {
        return handleGetAdminStoreStatus(req, res);
    }
    if (method === 'POST' && pathname === '/api/admin/store-status') {
        return handlePostAdminStoreStatus(req, res);
    }
    if (method === 'PUT' && pathname === '/api/admin/venue-profile') {
        return handlePutAdminVenueProfile(req, res);
    }

    const cancelMatch = pathname.match(/^\/api\/orders\/(\d+)\/cancel$/);
    if (method === 'POST' && cancelMatch) {
        const orderId = parseInt(cancelMatch[1], 10);
        if (!Number.isFinite(orderId)) return jsonError(res, 400, 'Invalid order id.');
        return handlePostOrderCancel(req, res, orderId);
    }

    const adminPatchMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
    if (method === 'PATCH' && adminPatchMatch) {
        const orderId = parseInt(adminPatchMatch[1], 10);
        if (!Number.isFinite(orderId)) return jsonError(res, 400, 'Invalid order id.');
        return handlePatchAdminOrder(req, res, orderId);
    }

    const adminVenuePatchMatch = pathname.match(/^\/api\/admin\/venues\/(\d+)$/);
    if (method === 'PATCH' && adminVenuePatchMatch) {
        const venueId = parseInt(adminVenuePatchMatch[1], 10);
        if (!Number.isFinite(venueId)) return jsonError(res, 400, 'Invalid hotel id.');
        return handlePatchAdminVenue(req, res, venueId);
    }

    return jsonError(res, 404, 'Not found');
}

module.exports = { handleVercelApi, apiPathname };
