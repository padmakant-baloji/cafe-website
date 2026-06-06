'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { query } = require('./db');
const { assertValidFloorSlot, getVenueById } = require('./venue-service');
const { parseFloorPaymentInput, buildFloorMetaPayment } = require('./floor-payment');

const adminOrderEvents = new EventEmitter();
adminOrderEvents.setMaxListeners(200);

const VALID_STATUSES = new Set([
    'pending',
    'accepted',
    'rejected',
    'cancelled',
    'preparing',
    'out_for_delivery',
    'completed'
]);

/** Shared customer row for dine-in / parcel counter orders (no online signup). */
const FLOOR_WALKIN_MOBILE = '8888888888';

function assertOrderBelongsToVenue(order, venueId) {
    const orderVenueId = parseInt(String(order && order.venue_id), 10);
    const expected = parseInt(String(venueId), 10);
    if (!Number.isFinite(expected)) return;
    if (Number.isFinite(orderVenueId) && orderVenueId !== expected) {
        throw Object.assign(new Error('Order not found'), { statusCode: 404 });
    }
}

async function getWalkinMobileForVenue(venueId) {
    const venue = await getVenueById(venueId);
    return (venue && venue.walkinMobile) || FLOOR_WALKIN_MOBILE;
}

/** Customer self-cancel: 1 min from placement (pending) or 1 min after accept (uses updated_at). */
const CUSTOMER_CANCEL_MINUTES = 1;

/**
 * @param {string} mobile
 */
function normalizeMobile(mobile) {
    const d = String(mobile || '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) return d.slice(-10);
    return d.length === 10 ? d : '';
}

function trimText(value, max) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, max);
}

function normalizeAddressRow(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        label: row.label,
        addressLine: row.address_line,
        landmark: row.landmark || '',
        city: row.city,
        isDefault: Boolean(row.is_default)
    };
}

function sanitizeAddressInput(address, fallbackCity = '') {
    const source = address && typeof address === 'object' ? address : {};
    const label = trimText(source.label, 80) || 'Saved address';
    const addressLine = trimText(source.addressLine || source.address_line, 300);
    const city = trimText(source.city, 200) || trimText(fallbackCity, 200);
    if (!addressLine || !city) {
        throw Object.assign(new Error('Address is required.'), {
            statusCode: 400
        });
    }
    return { label, addressLine, landmark: '', city };
}

/**
 * @param {string} mobile
 */
async function findCustomerByMobile(mobile) {
    const m = normalizeMobile(mobile);
    if (!m) return null;
    const { rows } = await query(
        `SELECT mobile, name, city, created_at FROM customers WHERE mobile = $1 LIMIT 1`,
        [m]
    );
    return rows[0] || null;
}

/**
 * @param {string} mobile
 * @param {string} name
 * @param {string} city
 */
async function createCustomer(mobile, name, city) {
    const m = normalizeMobile(mobile);
    if (!m) throw Object.assign(new Error('Invalid mobile'), { statusCode: 400 });
    const { rows } = await query(
        `INSERT INTO customers (mobile, name, city)
         VALUES ($1, $2, $3)
         RETURNING mobile, name, city, created_at`,
        [m, String(name).trim().slice(0, 200), String(city).trim().slice(0, 200)]
    );
    return rows[0];
}

/**
 * @param {string} mobile
 */
async function getCustomerByMobile(mobile) {
    const m = normalizeMobile(mobile);
    if (!m) return null;
    const { rows } = await query(
        `SELECT mobile, name, city, created_at FROM customers WHERE mobile = $1 LIMIT 1`,
        [m]
    );
    return rows[0] || null;
}

async function listCustomerAddresses(mobile) {
    const m = normalizeMobile(mobile);
    if (!m) return [];
    const { rows } = await query(
        `SELECT id, label, address_line, landmark, city, is_default, created_at, updated_at
         FROM customer_addresses
         WHERE customer_mobile = $1
         ORDER BY is_default DESC, updated_at DESC, id DESC`,
        [m]
    );
    return rows.map(normalizeAddressRow);
}

async function createCustomerAddress(mobile, address, options = {}) {
    const m = normalizeMobile(mobile);
    if (!m) throw Object.assign(new Error('Invalid mobile number.'), { statusCode: 400 });
    const customer = await getCustomerByMobile(m);
    if (!customer) throw Object.assign(new Error('Customer not found.'), { statusCode: 404 });
    const clean = sanitizeAddressInput(address, customer.city);
    const shouldDefault = options.makeDefault !== false;

    if (shouldDefault) {
        await query(
            `UPDATE customer_addresses
             SET is_default = FALSE,
                 updated_at = NOW()
             WHERE customer_mobile = $1`,
            [m]
        );
    }

    const { rows } = await query(
        `INSERT INTO customer_addresses (
            customer_mobile, label, address_line, landmark, city, is_default, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING id, label, address_line, landmark, city, is_default, created_at, updated_at`,
        [m, clean.label, clean.addressLine, clean.landmark, clean.city, shouldDefault]
    );
    return normalizeAddressRow(rows[0]);
}

/**
 * Creates or updates the customer's default delivery row so checkout never piles up duplicate addresses.
 * @param {string} mobile
 * @param {object} address
 */
async function upsertDefaultCustomerAddress(mobile, address) {
    const m = normalizeMobile(mobile);
    if (!m) throw Object.assign(new Error('Invalid mobile number.'), { statusCode: 400 });
    const customer = await getCustomerByMobile(m);
    if (!customer) throw Object.assign(new Error('Customer not found.'), { statusCode: 404 });
    const clean = sanitizeAddressInput(address, customer.city);

    const { rows: existingRows } = await query(
        `SELECT id FROM customer_addresses
         WHERE customer_mobile = $1 AND is_default = TRUE
         LIMIT 1`,
        [m]
    );

    if (existingRows[0]) {
        const id = existingRows[0].id;
        await query(
            `UPDATE customer_addresses
             SET label = $2,
                 address_line = $3,
                 landmark = $4,
                 city = $5,
                 updated_at = NOW()
             WHERE customer_mobile = $1 AND id = $6`,
            [m, clean.label, clean.addressLine, clean.landmark, clean.city, id]
        );
        return getCustomerAddressById(m, id);
    }

    return createCustomerAddress(mobile, clean, { makeDefault: true });
}

async function getCustomerAddressById(mobile, addressId) {
    const m = normalizeMobile(mobile);
    const id = parseInt(String(addressId), 10);
    if (!m || !Number.isFinite(id)) return null;
    const { rows } = await query(
        `SELECT id, label, address_line, landmark, city, is_default, created_at, updated_at
         FROM customer_addresses
         WHERE customer_mobile = $1 AND id = $2
         LIMIT 1`,
        [m, id]
    );
    return normalizeAddressRow(rows[0]);
}

async function setDefaultCustomerAddress(mobile, addressId) {
    const m = normalizeMobile(mobile);
    const id = parseInt(String(addressId), 10);
    if (!m || !Number.isFinite(id)) {
        throw Object.assign(new Error('Invalid address selection.'), { statusCode: 400 });
    }
    const existing = await getCustomerAddressById(m, id);
    if (!existing) {
        throw Object.assign(new Error('Saved address not found.'), { statusCode: 404 });
    }
    await query(
        `UPDATE customer_addresses
         SET is_default = CASE WHEN id = $2 THEN TRUE ELSE FALSE END,
             updated_at = NOW()
         WHERE customer_mobile = $1`,
        [m, id]
    );
    return { ...existing, isDefault: true };
}

/** Updates a specific saved address row (text/city) and optionally marks it default. */
async function updateCustomerAddressById(mobile, addressId, address, options = {}) {
    const m = normalizeMobile(mobile);
    const id = parseInt(String(addressId), 10);
    if (!m || !Number.isFinite(id)) {
        throw Object.assign(new Error('Invalid address selection.'), { statusCode: 400 });
    }
    const customer = await getCustomerByMobile(m);
    if (!customer) throw Object.assign(new Error('Customer not found.'), { statusCode: 404 });
    const existing = await getCustomerAddressById(m, id);
    if (!existing) throw Object.assign(new Error('Saved address not found.'), { statusCode: 404 });

    const clean = sanitizeAddressInput(address, existing.city || customer.city);
    const makeDefault = options.makeDefault !== false;

    if (makeDefault) {
        await query(
            `UPDATE customer_addresses
             SET is_default = FALSE, updated_at = NOW()
             WHERE customer_mobile = $1`,
            [m]
        );
    }

    await query(
        `UPDATE customer_addresses
         SET label = $3, address_line = $4, landmark = $5, city = $6, is_default = $7, updated_at = NOW()
         WHERE customer_mobile = $1 AND id = $2`,
        [m, id, clean.label, clean.addressLine, clean.landmark, clean.city, makeDefault]
    );

    return getCustomerAddressById(m, id);
}

/**
 * @param {string} mobile
 * @param {string} name
 * @param {string} city
 */
async function updateCustomerProfile(mobile, name, city) {
    const m = normalizeMobile(mobile);
    const cleanName = typeof name === 'string' ? name.trim().slice(0, 200) : '';
    const cleanCity = typeof city === 'string' ? city.trim().slice(0, 200) : '';
    if (!m) throw Object.assign(new Error('Invalid mobile number.'), { statusCode: 400 });
    if (!cleanName || !cleanCity) {
        throw Object.assign(new Error('Name and city are required.'), { statusCode: 400 });
    }
    const { rows } = await query(
        `UPDATE customers
         SET name = $2, city = $3
         WHERE mobile = $1
         RETURNING mobile, name, city, created_at`,
        [m, cleanName, cleanCity]
    );
    if (!rows.length) throw Object.assign(new Error('Customer not found.'), { statusCode: 404 });
    return rows[0];
}

/**
 * @param {string} customerMobile
 * @param {object[]} items
 * @param {number} total
 */
async function createOrder(customerMobile, items, totals, deliveryAddress = null, venueId = 1) {
    const mobile = normalizeMobile(customerMobile);
    const vid = parseInt(String(venueId), 10) || 1;
    const serializedDeliveryAddress =
        deliveryAddress && typeof deliveryAddress === 'object'
            ? JSON.stringify(deliveryAddress)
            : null;
    const safeTotals = totals && typeof totals === 'object' ? totals : { total: totals };
    const subtotal = parseInt(String(safeTotals.subtotal ?? 0), 10);
    const deliveryFee = parseInt(String(safeTotals.deliveryFee ?? 0), 10);
    const discount = parseInt(String(safeTotals.discount ?? 0), 10);
    const couponCode = typeof safeTotals.couponCode === 'string' ? safeTotals.couponCode.trim().slice(0, 64) : null;
    const total = parseInt(String(safeTotals.total ?? 0), 10);

    const payload = [
        mobile,
        JSON.stringify(items),
        subtotal,
        deliveryFee,
        discount,
        couponCode,
        total,
        serializedDeliveryAddress,
        vid
    ];
    try {
        const { rows } = await query(
            `INSERT INTO orders (customer_id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, venue_id)
             SELECT c.id, c.mobile, 'pending', $2::jsonb, $3, $4, $5, $6, $7, $8::jsonb, $9
             FROM customers c
             WHERE c.mobile = $1
             RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, venue_id`,
            payload
        );
        if (!rows.length) {
            throw Object.assign(new Error('Customer not found for order.'), { statusCode: 401 });
        }
        const order = rows[0];
        adminOrderEvents.emit('new', { orderId: order.id, customerMobile: mobile });
        return order;
    } catch (err) {
        const msg = String(err && err.message ? err.message : '');
        const missingLegacyCustomerId =
            err &&
            (err.code === '42703' || err.code === '42P01' || msg.includes('column "customer_id"'));
        const missingCustomerTableId =
            err && (err.code === '42703' || msg.includes('column c.id') || msg.includes('customers.id'));

        if (!missingLegacyCustomerId && !missingCustomerTableId) {
            const notNullLegacyCustomerId =
                err && err.code === '23502' && msg.includes('customer_id');
            if (!notNullLegacyCustomerId) {
                throw err;
            }
        }

        const { rows } = await query(
            `INSERT INTO orders (customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, venue_id)
             VALUES ($1, 'pending', $2::jsonb, $3, $4, $5, $6, $7, $8::jsonb, $9)
             RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, venue_id`,
            payload
        );
        const order = rows[0];
        adminOrderEvents.emit('new', { orderId: order.id, customerMobile: mobile });
        return order;
    }
}

/**
 * @param {string} customerMobile
 */
async function listOrdersForCustomer(customerMobile, limit = 50) {
    const { rows } = await query(
        `SELECT o.id, o.status, o.items, o.total, o.delivery_address, o.created_at, o.updated_at,
                v.name AS venue_name, v.contact_mobile AS venue_contact_mobile
         FROM orders o
         LEFT JOIN venues v ON v.id = o.venue_id
         WHERE o.customer_mobile = $1
         ORDER BY o.created_at DESC
         LIMIT $2`,
        [normalizeMobile(customerMobile), limit]
    );
    return rows;
}

/**
 * @param {number} limit
 */
async function listAllOrdersForAdmin(venueId, limit = 100) {
    const vid = parseInt(String(venueId), 10) || 1;
    const { rows } = await query(
        `SELECT o.id, o.status, o.items, o.subtotal, o.delivery_fee, o.discount, o.coupon_code, o.total,
                o.delivery_address, o.created_at, o.updated_at, o.channel, o.order_meta, o.venue_id,
                c.mobile, c.name, c.city
         FROM orders o
         JOIN customers c ON c.mobile = o.customer_mobile
         WHERE o.venue_id = $1
         ORDER BY o.created_at DESC
         LIMIT $2`,
        [vid, limit]
    );
    return rows;
}

/**
 * @param {number} orderId
 */
async function getOrderById(orderId) {
    const { rows } = await query(
        `SELECT o.id, o.customer_mobile, o.status, o.items, o.subtotal, o.delivery_fee, o.discount, o.coupon_code, o.total,
                o.delivery_address, o.created_at, o.updated_at, o.channel, o.order_meta, o.venue_id,
                c.mobile, c.name, c.city
         FROM orders o
         JOIN customers c ON c.mobile = o.customer_mobile
         WHERE o.id = $1
         LIMIT 1`,
        [orderId]
    );
    return rows[0] || null;
}

/**
 * @param {number} orderId
 * @param {string} action
 * @param {object} [body]
 */
async function applyAdminOrderAction(orderId, action, body = {}, venueId = null) {
    const order = await getOrderById(orderId);
    if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 });
    if (venueId != null) assertOrderBelongsToVenue(order, venueId);

    const floorCh = String(order.channel || 'delivery').toLowerCase();
    if (floorCh === 'dine_in' || floorCh === 'parcel') {
        if (action !== 'reject' && action !== 'cancel') {
            throw Object.assign(
                new Error('This is a dine-in / parcel order — use Floor / tables to manage it.'),
                { statusCode: 400 }
            );
        }
    }

    let next = order.status;
    let paymentMethod = null;

    if (action === 'accept') {
        if (order.status !== 'pending') throw Object.assign(new Error('Cannot accept'), { statusCode: 400 });
        next = 'accepted';
    } else if (action === 'reject' || action === 'cancel') {
        if (order.status === 'rejected' || order.status === 'cancelled') {
            return order;
        }
        if (order.status === 'completed') {
            throw Object.assign(new Error('Cannot cancel a completed order.'), { statusCode: 400 });
        }
        // Allow void from any active step (not only pending/accepted).
        next = 'rejected';
    } else if (action === 'preparing') {
        if (order.status !== 'accepted') throw Object.assign(new Error('Invalid transition'), { statusCode: 400 });
        next = 'preparing';
    } else if (action === 'out_for_delivery') {
        if (order.status !== 'preparing') throw Object.assign(new Error('Invalid transition'), { statusCode: 400 });
        next = 'out_for_delivery';
    } else if (action === 'completed' || action === 'complete') {
        if (order.status === 'completed') {
            return order;
        }
        if (order.status !== 'out_for_delivery') {
            throw Object.assign(new Error('Invalid transition'), { statusCode: 400 });
        }
        const pm = String((body && body.payment_method) || '').trim().toUpperCase();
        if (pm !== 'CASH' && pm !== 'UPI') {
            throw Object.assign(new Error('Choose payment: CASH or UPI.'), { statusCode: 400 });
        }
        paymentMethod = pm;
        next = 'completed';
    } else {
        throw Object.assign(new Error('Unknown action'), { statusCode: 400 });
    }

    if (!VALID_STATUSES.has(next)) throw Object.assign(new Error('Invalid status'), { statusCode: 400 });

    if (paymentMethod) {
        const existingMeta = parseJsonb(order.order_meta) || {};
        const metaJson = JSON.stringify({ ...existingMeta, payment_method: paymentMethod });
        const { rows } = await query(
            `UPDATE orders SET status = $2, order_meta = $3::jsonb, updated_at = NOW() WHERE id = $1
             RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, channel, order_meta`,
            [orderId, next, metaJson]
        );
        const updated = rows[0];
        adminOrderEvents.emit('update', { orderId: updated.id, status: updated.status });
        return updated;
    }

    const { rows } = await query(
        `UPDATE orders SET status = $2, updated_at = NOW() WHERE id = $1
         RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, channel, order_meta`,
        [orderId, next]
    );
    const updated = rows[0];
    adminOrderEvents.emit('update', { orderId: updated.id, status: updated.status });
    return updated;
}

/**
 * Customer cancels own order: within 1 min of placing (pending) or 1 min after restaurant accepts.
 * @param {number} orderId
 * @param {string} customerMobile
 */
async function cancelOrderByCustomer(orderId, customerMobile) {
    const m = normalizeMobile(customerMobile);
    const id = parseInt(String(orderId), 10);
    if (!Number.isFinite(id)) {
        throw Object.assign(new Error('Invalid order id.'), { statusCode: 400 });
    }

    const order = await getOrderById(id);
    if (!order) {
        throw Object.assign(new Error('Order not found.'), { statusCode: 404 });
    }
    if (normalizeMobile(order.customer_mobile) !== m) {
        throw Object.assign(new Error('Forbidden.'), { statusCode: 403 });
    }

    const { rows } = await query(
        `UPDATE orders SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND customer_mobile = $2
           AND (
             (status = 'pending' AND created_at > NOW() - INTERVAL '1 minute')
             OR
             (status = 'accepted' AND updated_at > NOW() - INTERVAL '1 minute')
           )
         RETURNING id, customer_mobile, status, items, total, delivery_address, created_at, updated_at`,
        [id, m]
    );

    if (rows.length) {
        const updated = rows[0];
        adminOrderEvents.emit('update', { orderId: updated.id, status: updated.status });
        return updated;
    }

    const st = String(order.status || '').trim().toLowerCase();
    if (st !== 'pending' && st !== 'accepted') {
        throw Object.assign(new Error('This order can no longer be cancelled.'), { statusCode: 400 });
    }

    if (st === 'pending') {
        const created = order.created_at ? new Date(order.created_at) : null;
        const expired =
            created &&
            !Number.isNaN(created.getTime()) &&
            Date.now() - created.getTime() >= CUSTOMER_CANCEL_MINUTES * 60 * 1000;
        if (expired) {
            throw Object.assign(
                new Error('You can only cancel within 1 minute of placing your order.'),
                { statusCode: 400 }
            );
        }
    }

    if (st === 'accepted') {
        const upd = order.updated_at ? new Date(order.updated_at) : null;
        const expiredAccept =
            upd &&
            !Number.isNaN(upd.getTime()) &&
            Date.now() - upd.getTime() >= CUSTOMER_CANCEL_MINUTES * 60 * 1000;
        if (expiredAccept) {
            throw Object.assign(
                new Error(
                    'You can only cancel within 1 minute after the restaurant accepts your order.'
                ),
                { statusCode: 400 }
            );
        }
    }

    throw Object.assign(new Error('Could not cancel this order right now. Please try again.'), {
        statusCode: 409
    });
}

function parseJsonb(val) {
    if (val == null) return null;
    if (typeof val === 'object') return val;
    if (typeof val === 'string') {
        try {
            return JSON.parse(val);
        } catch {
            return null;
        }
    }
    return null;
}

function readFloorMeta(order) {
    const meta = parseJsonb(order.order_meta) || {};
    return {
        slot: typeof meta.slot === 'string' ? meta.slot : '',
        guest_label: typeof meta.guest_label === 'string' ? meta.guest_label : '',
        kots: Array.isArray(meta.kots) ? meta.kots : [],
        payment_method: meta.payment_method || null
    };
}

function slotKeyFromChannel(channel, slotNum) {
    if (channel === 'dine_in') return `table:${slotNum}`;
    if (channel === 'parcel') return `parcel:${slotNum}`;
    return '';
}

async function findActiveFloorOrderBySlot(slotKey, venueId) {
    const vid = parseInt(String(venueId), 10) || 1;
    const { rows } = await query(
        `SELECT id FROM orders
         WHERE channel IN ('dine_in', 'parcel')
           AND venue_id = $2
           AND status NOT IN ('completed', 'rejected', 'cancelled')
           AND COALESCE(order_meta->>'slot','') = $1
         LIMIT 1`,
        [slotKey, vid]
    );
    return rows[0] || null;
}

async function listFloorSessionsForAdmin(venueId) {
    const vid = parseInt(String(venueId), 10) || 1;
    const { rows } = await query(
        `SELECT o.id, o.status, o.items, o.subtotal, o.delivery_fee, o.discount, o.coupon_code, o.total,
                o.delivery_address, o.created_at, o.updated_at, o.channel, o.order_meta, o.venue_id,
                c.mobile, c.name, c.city
         FROM orders o
         JOIN customers c ON c.mobile = o.customer_mobile
         WHERE o.channel IN ('dine_in', 'parcel')
           AND o.venue_id = $1
           AND o.status NOT IN ('completed', 'rejected', 'cancelled')
         ORDER BY o.updated_at DESC`,
        [vid]
    );
    return rows;
}

function mergeKotLinesToItems(kots) {
    const map = new Map();
    for (const kot of kots || []) {
        for (const line of kot.lines || []) {
            const name = trimText(line.name, 200);
            const qty = parseInt(String(line.quantity), 10);
            const price = parseInt(String(line.price), 10);
            if (!name || Number.isNaN(qty) || qty < 1 || qty > 99) continue;
            const p = Number.isNaN(price) || price < 0 ? 0 : price;
            const key = `${name}\n${p}`;
            const cur = map.get(key);
            if (cur) cur.quantity += qty;
            else map.set(key, { name, price: p, quantity: qty });
        }
    }
    return [...map.values()];
}

function sumItemsSubtotal(items) {
    return items.reduce((sum, it) => {
        const q = parseInt(String(it.quantity), 10);
        const p = parseInt(String(it.price), 10);
        if (Number.isNaN(q) || Number.isNaN(p)) return sum;
        return sum + q * p;
    }, 0);
}

function newKotId() {
    if (typeof crypto.randomUUID === 'function') return `kot_${crypto.randomUUID()}`;
    return `kot_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function newLineId() {
    if (typeof crypto.randomUUID === 'function') return `ln_${crypto.randomUUID()}`;
    return `ln_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeFloorKotLines(meta) {
    for (const kot of meta.kots || []) {
        if (!Array.isArray(kot.lines)) kot.lines = [];
        const lines = kot.lines.filter((x) => x && typeof x === 'object');
        kot.lines = lines;

        const legacyWholeKotDone =
            kot.done === true &&
            lines.length > 0 &&
            lines.every((ln) => ln && !Object.prototype.hasOwnProperty.call(ln, 'served'));

        if (legacyWholeKotDone) {
            for (const ln of lines) {
                ln.served = true;
            }
        }

        for (const ln of kot.lines) {
            if (!ln.id) ln.id = newLineId();
            if (ln.served === undefined || ln.served === null) {
                ln.served = false;
            } else {
                ln.served = Boolean(ln.served);
            }
        }
        kot.done = kot.lines.length > 0 && kot.lines.every((l) => l && l.served);
    }
}

function sanitizeKotLines(lines) {
    if (!Array.isArray(lines)) return [];
    const out = [];
    for (const raw of lines) {
        if (!raw || typeof raw !== 'object') continue;
        const name = trimText(raw.name, 200);
        const qty = parseInt(String(raw.quantity), 10);
        let price = parseInt(String(raw.price), 10);
        if (!name) continue;
        if (Number.isNaN(qty) || qty < 1 || qty > 99) continue;
        if (Number.isNaN(price) || price < 0) price = 0;
        const category_type = trimText(String(raw.category_type || raw.category || ''), 80);
        out.push({
            id: newLineId(),
            name,
            quantity: qty,
            price,
            served: false,
            ...(category_type ? { category_type } : {})
        });
    }
    return out;
}

async function createFloorSession(venueId, channel, slotNum, guestLabel = '') {
    const vid = parseInt(String(venueId), 10) || 1;
    const ch = String(channel || '').trim().toLowerCase();
    const n = parseInt(String(slotNum), 10);
    await assertValidFloorSlot(vid, ch, n);
    const slotKey = slotKeyFromChannel(ch, n);
    const busy = await findActiveFloorOrderBySlot(slotKey, vid);
    if (busy) {
        throw Object.assign(new Error('This slot already has an active order.'), { statusCode: 409 });
    }

    const walkinMobile = await getWalkinMobileForVenue(vid);
    const order_meta = {
        slot: slotKey,
        guest_label: trimText(String(guestLabel || ''), 120),
        kots: [],
        payment_method: null
    };

    const { rows } = await query(
        `INSERT INTO orders (
            customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, channel, order_meta, venue_id
        )
        VALUES ($1, 'accepted', '[]'::jsonb, 0, 0, 0, NULL, 0, NULL, $2, $3::jsonb, $4)
        RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, channel, order_meta, venue_id`,
        [walkinMobile, ch, JSON.stringify(order_meta), vid]
    );
    const order = rows[0];
    adminOrderEvents.emit('new', { orderId: order.id, customerMobile: walkinMobile });
    return order;
}

async function applyFloorOrderAdminPatch(orderId, body, venueId = null) {
    const id = parseInt(String(orderId), 10);
    if (!Number.isFinite(id)) {
        throw Object.assign(new Error('Invalid order id.'), { statusCode: 400 });
    }
    const order = await getOrderById(id);
    if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 });
    if (venueId != null) assertOrderBelongsToVenue(order, venueId);

    const ch = String(order.channel || 'delivery').toLowerCase();
    if (ch !== 'dine_in' && ch !== 'parcel') {
        throw Object.assign(new Error('This action only applies to floor orders.'), { statusCode: 400 });
    }

    const action = body && typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';
    const meta = readFloorMeta(order);
    normalizeFloorKotLines(meta);

    if (action === 'floor_void' || action === 'floor_cancel') {
        if (order.status === 'completed' || order.status === 'rejected' || order.status === 'cancelled') {
            return order;
        }
        const { rows } = await query(
            `UPDATE orders SET status = 'rejected', updated_at = NOW() WHERE id = $1
             RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, channel, order_meta`,
            [id]
        );
        const u = rows[0];
        adminOrderEvents.emit('update', { orderId: u.id, status: u.status });
        return u;
    }

    if (action === 'floor_add_kot') {
        const lines = sanitizeKotLines(body && body.lines ? body.lines : body.kot && body.kot.lines);
        if (!lines.length) {
            throw Object.assign(new Error('Add at least one line item to the KOT.'), { statusCode: 400 });
        }
        if (order.status === 'completed' || order.status === 'rejected' || order.status === 'cancelled') {
            throw Object.assign(new Error('Cannot add a KOT to a closed order.'), { statusCode: 400 });
        }
        const kot = {
            id: newKotId(),
            seq: meta.kots.length + 1,
            label: trimText(body && body.label ? String(body.label) : '', 80),
            lines,
            done: lines.every((ln) => ln && ln.served),
            created_at: new Date().toISOString()
        };
        meta.kots.push(kot);
        const items = mergeKotLinesToItems(meta.kots);
        const subtotal = sumItemsSubtotal(items);
        const total = subtotal;
        const metaJson = JSON.stringify({
            slot: meta.slot,
            guest_label: meta.guest_label,
            kots: meta.kots,
            payment_method: meta.payment_method
        });
        const { rows } = await query(
            `UPDATE orders
             SET items = $2::jsonb,
                 subtotal = $3,
                 delivery_fee = 0,
                 discount = 0,
                 total = $4,
                 order_meta = $5::jsonb,
                 status = CASE WHEN status = 'accepted' THEN 'preparing' ELSE status END,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, channel, order_meta`,
            [id, JSON.stringify(items), subtotal, total, metaJson]
        );
        const u = rows[0];
        adminOrderEvents.emit('update', { orderId: u.id, status: u.status });
        return u;
    }

    if (action === 'floor_replace_kot') {
        const kotId = trimText(String((body && body.kot_id) || (body && body.kotId) || ''), 80);
        if (!kotId) {
            throw Object.assign(new Error('Missing kot id.'), { statusCode: 400 });
        }
        const lines = sanitizeKotLines(body && body.lines ? body.lines : body.kot && body.kot.lines);
        if (!lines.length) {
            throw Object.assign(new Error('Add at least one line item to the KOT.'), { statusCode: 400 });
        }
        if (order.status === 'completed' || order.status === 'rejected' || order.status === 'cancelled') {
            throw Object.assign(new Error('Cannot modify a KOT on a closed order.'), { statusCode: 400 });
        }
        const kot = meta.kots.find((k) => k && k.id === kotId);
        if (!kot) {
            throw Object.assign(new Error('KOT not found.'), { statusCode: 404 });
        }
        if ((kot.lines || []).some((l) => l && l.served)) {
            throw Object.assign(new Error('Cannot modify a KOT with served lines.'), { statusCode: 400 });
        }
        kot.lines = lines;
        kot.done = lines.length > 0 && lines.every((ln) => ln && ln.served);
        const items = mergeKotLinesToItems(meta.kots);
        const subtotal = sumItemsSubtotal(items);
        const total = subtotal;
        const metaJson = JSON.stringify({
            slot: meta.slot,
            guest_label: meta.guest_label,
            kots: meta.kots,
            payment_method: meta.payment_method
        });
        const { rows } = await query(
            `UPDATE orders
             SET items = $2::jsonb,
                 subtotal = $3,
                 delivery_fee = 0,
                 discount = 0,
                 total = $4,
                 order_meta = $5::jsonb,
                 status = CASE WHEN status = 'accepted' THEN 'preparing' ELSE status END,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, channel, order_meta`,
            [id, JSON.stringify(items), subtotal, total, metaJson]
        );
        const u = rows[0];
        adminOrderEvents.emit('update', { orderId: u.id, status: u.status });
        return u;
    }

    if (action === 'floor_mark_line') {
        const kotId = trimText(String((body && body.kot_id) || (body && body.kotId) || ''), 80);
        const lineId = trimText(String((body && body.line_id) || (body && body.lineId) || ''), 80);
        const lineIndexRaw = body && (body.line_index ?? body.lineIndex);
        const lineIndex = parseInt(String(lineIndexRaw), 10);
        if (!kotId) {
            throw Object.assign(new Error('Missing kot id.'), { statusCode: 400 });
        }
        if (!lineId && !Number.isFinite(lineIndex)) {
            throw Object.assign(new Error('Missing line id or line index.'), { statusCode: 400 });
        }
        const kot = meta.kots.find((k) => k && k.id === kotId);
        if (!kot) {
            throw Object.assign(new Error('KOT not found.'), { statusCode: 404 });
        }
        let line = null;
        if (lineId) {
            line = (kot.lines || []).find((l) => l && l.id === lineId);
        }
        if (!line && Number.isFinite(lineIndex) && lineIndex >= 0 && lineIndex < (kot.lines || []).length) {
            line = kot.lines[lineIndex];
        }
        if (!line) {
            throw Object.assign(new Error('Line not found.'), { statusCode: 404 });
        }
        if (!line.id) line.id = newLineId();
        line.served = body && body.served === false ? false : true;
        kot.done = kot.lines.length > 0 && kot.lines.every((l) => l && l.served);
        const metaJson = JSON.stringify({
            slot: meta.slot,
            guest_label: meta.guest_label,
            kots: meta.kots,
            payment_method: meta.payment_method
        });
        const { rows } = await query(
            `UPDATE orders SET order_meta = $2::jsonb, updated_at = NOW() WHERE id = $1
             RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, channel, order_meta`,
            [id, metaJson]
        );
        const u = rows[0];
        adminOrderEvents.emit('update', { orderId: u.id, status: u.status });
        return u;
    }

    if (action === 'floor_kot_done' || action === 'floor_kot_toggle') {
        const kotId = trimText(String((body && body.kot_id) || (body && body.kotId) || ''), 80);
        if (!kotId) {
            throw Object.assign(new Error('Missing kot id.'), { statusCode: 400 });
        }
        const kot = meta.kots.find((k) => k && k.id === kotId);
        if (!kot) {
            throw Object.assign(new Error('KOT not found.'), { statusCode: 404 });
        }
        if (action === 'floor_kot_done') {
            kot.done = true;
        } else {
            kot.done = Boolean(body && body.done);
        }
        const metaJson = JSON.stringify({
            slot: meta.slot,
            guest_label: meta.guest_label,
            kots: meta.kots,
            payment_method: meta.payment_method
        });
        const { rows } = await query(
            `UPDATE orders SET order_meta = $2::jsonb, updated_at = NOW() WHERE id = $1
             RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, channel, order_meta`,
            [id, metaJson]
        );
        const u = rows[0];
        adminOrderEvents.emit('update', { orderId: u.id, status: u.status });
        return u;
    }

    if (action === 'floor_complete') {
        if (!meta.kots.length) {
            throw Object.assign(new Error('Add at least one KOT before settling.'), { statusCode: 400 });
        }
        const allServed = meta.kots.every((k) => {
            if (!k || !Array.isArray(k.lines) || !k.lines.length) return false;
            if (k.done) return true;
            return k.lines.every((ln) => ln && ln.served);
        });
        if (!allServed) {
            throw Object.assign(new Error('Mark every line item as served before settling.'), { statusCode: 400 });
        }
        const items = mergeKotLinesToItems(meta.kots);
        const subtotal = sumItemsSubtotal(items);
        const total = subtotal;
        const payment = parseFloorPaymentInput(body, total);
        const metaJson = JSON.stringify(
            buildFloorMetaPayment(
                {
                    slot: meta.slot,
                    guest_label: meta.guest_label,
                    kots: meta.kots
                },
                payment
            )
        );
        const { rows } = await query(
            `UPDATE orders
             SET status = 'completed',
                 items = $2::jsonb,
                 subtotal = $3,
                 delivery_fee = 0,
                 discount = 0,
                 total = $4,
                 order_meta = $5::jsonb,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, channel, order_meta`,
            [id, JSON.stringify(items), subtotal, total, metaJson]
        );
        const u = rows[0];
        adminOrderEvents.emit('update', { orderId: u.id, status: u.status });
        return u;
    }

    throw Object.assign(new Error('Unknown floor action.'), { statusCode: 400 });
}

/**
 * Insert a completed dine-in / parcel session in one step (used when the floor UI
 * kept the session in localStorage until settle).
 * @param {object} body
 * @param {string} body.payment_method CASH | UPI
 * @param {string} body.channel dine_in | parcel
 * @param {number} body.slot table 1–7 or parcel 1–5
 * @param {string} [body.guest_label]
 * @param {object[]} body.kots
 */
async function commitFloorOrderToDb(venueId, body) {
    const vid = parseInt(String(venueId), 10) || 1;
    const src = body && typeof body === 'object' ? body : {};
    const ch = String(src.channel || '').trim().toLowerCase();
    const n = parseInt(String(src.slot), 10);
    await assertValidFloorSlot(vid, ch, n);
    const slotKey = slotKeyFromChannel(ch, n);
    const busy = await findActiveFloorOrderBySlot(slotKey, vid);
    if (busy) {
        throw Object.assign(
            new Error('This slot already has an active order in the system. Finish or void it first.'),
            { statusCode: 409 }
        );
    }

    const guest_label = trimText(String(src.guest_label || ''), 120);
    const rawKots = Array.isArray(src.kots) ? src.kots : [];
    const meta = {
        slot: slotKey,
        guest_label,
        kots: JSON.parse(JSON.stringify(rawKots))
    };
    normalizeFloorKotLines(meta);

    if (!meta.kots.length) {
        throw Object.assign(new Error('Add at least one KOT before settling.'), { statusCode: 400 });
    }
    const allServed = meta.kots.every((k) => {
        if (!k || !Array.isArray(k.lines) || !k.lines.length) return false;
        if (k.done) return true;
        return k.lines.every((ln) => ln && ln.served);
    });
    if (!allServed) {
        throw Object.assign(new Error('Mark every line item as served before settling.'), {
            statusCode: 400
        });
    }

    const items = mergeKotLinesToItems(meta.kots);
    const subtotal = sumItemsSubtotal(items);
    const total = subtotal;
    const payment = parseFloorPaymentInput(src, total);
    const metaJson = JSON.stringify(
        buildFloorMetaPayment(
            {
                slot: meta.slot,
                guest_label: meta.guest_label,
                kots: meta.kots
            },
            payment
        )
    );

    const walkinMobile = await getWalkinMobileForVenue(vid);

    const { rows } = await query(
        `INSERT INTO orders (
            customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, channel, order_meta, venue_id
        )
        VALUES ($1, 'completed', $2::jsonb, $3, 0, 0, NULL, $4, NULL, $5, $6::jsonb, $7)
        RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, channel, order_meta, venue_id`,
        [walkinMobile, JSON.stringify(items), subtotal, total, ch, metaJson, vid]
    );
    const order = rows[0];
    adminOrderEvents.emit('update', { orderId: order.id, status: order.status });
    return order;
}

module.exports = {
    normalizeMobile,
    findCustomerByMobile,
    createCustomer,
    getCustomerByMobile,
    listCustomerAddresses,
    createCustomerAddress,
    upsertDefaultCustomerAddress,
    getCustomerAddressById,
    setDefaultCustomerAddress,
    updateCustomerAddressById,
    updateCustomerProfile,
    createOrder,
    listOrdersForCustomer,
    listAllOrdersForAdmin,
    listFloorSessionsForAdmin,
    getOrderById,
    applyAdminOrderAction,
    applyFloorOrderAdminPatch,
    createFloorSession,
    commitFloorOrderToDb,
    cancelOrderByCustomer,
    adminOrderEvents
};
