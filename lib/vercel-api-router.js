'use strict';

const { ensureSchema } = require('./schema');
const { verifyCustomerSession, signCustomerSession } = require('./customer-session');
const { placeOrderForCustomer } = require('./place-order');
const { validateCoupon } = require('./coupon-service');
const { requireAdminApi, resolveCustomerSession } = require('./api-auth');
const {
    normalizeMobile,
    findCustomerByMobile,
    getCustomerByMobile,
    createCustomer,
    listCustomerAddresses,
    upsertDefaultCustomerAddress,
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

function apiPathname(req) {
    const raw = req.url || '/';
    const pathOnly = String(raw).split('?')[0] || '/';
    const normalized = pathOnly.replace(/\/+$/, '') || '/';
    return normalized.startsWith('/api') ? normalized : `/api${normalized === '/' ? '' : normalized}`;
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
    if (!requireAdminApi(req, res)) return;
    try {
        await ensureSchema();
        const scope = String((req.query && req.query.scope) || '')
            .trim()
            .toLowerCase();
        const rows =
            scope === 'floor' ? await listFloorSessionsForAdmin() : await listAllOrdersForAdmin(150);
        res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        return res.status(200).json({ orders: rows });
    } catch (err) {
        console.error('admin orders:', err.message);
        return jsonError(res, 500, 'Could not load orders.');
    }
}

async function handlePostAdminOrders(req, res) {
    if (!requireAdminApi(req, res)) return;
    try {
        await ensureSchema();
        const body = typeof req.body === 'object' && req.body ? req.body : {};
        const act = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';
        if (act === 'floor_open') {
            const order = await createFloorSession(body.channel, body.slot, body.guest_label);
            return res.status(201).json({ ok: true, order });
        }
        if (act === 'floor_commit') {
            const order = await commitFloorOrderToDb(body);
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
    if (!requireAdminApi(req, res)) return;
    try {
        await ensureSchema();
        const body = typeof req.body === 'object' && req.body ? req.body : {};
        const action = typeof body.action === 'string' ? body.action.trim() : '';
        if (!action) return jsonError(res, 400, 'Missing action.');
        if (action.startsWith('floor_')) {
            const updated = await applyFloorOrderAdminPatch(orderId, body);
            return res.status(200).json({ ok: true, order: updated });
        }
        const updated = await applyAdminOrderAction(orderId, action, body);
        return res.status(200).json({ ok: true, order: updated });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) console.error('admin patch order:', err.message);
        return res.status(code).json({ error: err.message || 'Update failed.' });
    }
}

function handleGetAdminSession(req, res) {
    if (!requireAdminApi(req, res)) return;
    return res.status(200).json({ ok: true });
}

/**
 * Single Vercel serverless entry — routes all /api/* traffic (Hobby plan function limit).
 */
async function handleVercelApi(req, res) {
    const pathname = apiPathname(req);
    const method = String(req.method || 'GET').toUpperCase();

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

    return jsonError(res, 404, 'Not found');
}

module.exports = { handleVercelApi, apiPathname };
