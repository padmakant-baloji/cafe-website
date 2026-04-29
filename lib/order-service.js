'use strict';

const { EventEmitter } = require('events');
const { query } = require('./db');

const adminOrderEvents = new EventEmitter();
adminOrderEvents.setMaxListeners(200);

const VALID_STATUSES = new Set([
    'pending',
    'accepted',
    'rejected',
    'preparing',
    'out_for_delivery',
    'completed'
]);

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

    const { rows } = await query(
        `WITH reset_defaults AS (
            UPDATE customer_addresses
            SET is_default = FALSE,
                updated_at = NOW()
            WHERE customer_mobile = $1
              AND $5::boolean = TRUE
        )
        INSERT INTO customer_addresses (
            customer_mobile, label, address_line, landmark, city, is_default, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $6, $5, NOW(), NOW())
        RETURNING id, label, address_line, landmark, city, is_default, created_at, updated_at`,
        [m, clean.label, clean.addressLine, clean.landmark, shouldDefault, clean.city]
    );
    return normalizeAddressRow(rows[0]);
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
async function createOrder(customerMobile, items, total, deliveryAddress = null) {
    const mobile = normalizeMobile(customerMobile);
    const serializedDeliveryAddress =
        deliveryAddress && typeof deliveryAddress === 'object'
            ? JSON.stringify(deliveryAddress)
            : null;
    const payload = [mobile, JSON.stringify(items), total, serializedDeliveryAddress];
    try {
        const { rows } = await query(
            `INSERT INTO orders (customer_id, customer_mobile, status, items, total, delivery_address)
             SELECT c.id, c.mobile, 'pending', $2::jsonb, $3, $4::jsonb
             FROM customers c
             WHERE c.mobile = $1
             RETURNING id, customer_mobile, status, items, total, delivery_address, created_at, updated_at`,
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
            `INSERT INTO orders (customer_mobile, status, items, total, delivery_address)
             VALUES ($1, 'pending', $2::jsonb, $3, $4::jsonb)
             RETURNING id, customer_mobile, status, items, total, delivery_address, created_at, updated_at`,
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
        `SELECT id, status, items, total, delivery_address, created_at, updated_at
         FROM orders
         WHERE customer_mobile = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [normalizeMobile(customerMobile), limit]
    );
    return rows;
}

/**
 * @param {number} limit
 */
async function listAllOrdersForAdmin(limit = 100) {
    const { rows } = await query(
        `SELECT o.id, o.status, o.items, o.total, o.delivery_address, o.created_at, o.updated_at,
                c.mobile, c.name, c.city
         FROM orders o
         JOIN customers c ON c.mobile = o.customer_mobile
         ORDER BY o.created_at DESC
         LIMIT $1`,
        [limit]
    );
    return rows;
}

/**
 * @param {number} orderId
 */
async function getOrderById(orderId) {
    const { rows } = await query(
        `SELECT o.id, o.customer_mobile, o.status, o.items, o.total, o.delivery_address, o.created_at, o.updated_at,
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
 */
async function applyAdminOrderAction(orderId, action) {
    const order = await getOrderById(orderId);
    if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 });

    let next = order.status;

    if (action === 'accept') {
        if (order.status !== 'pending') throw Object.assign(new Error('Cannot accept'), { statusCode: 400 });
        next = 'accepted';
    } else if (action === 'reject') {
        if (order.status !== 'pending') throw Object.assign(new Error('Cannot reject'), { statusCode: 400 });
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
        next = 'completed';
    } else {
        throw Object.assign(new Error('Unknown action'), { statusCode: 400 });
    }

    if (!VALID_STATUSES.has(next)) throw Object.assign(new Error('Invalid status'), { statusCode: 400 });

    const { rows } = await query(
        `UPDATE orders SET status = $2, updated_at = NOW() WHERE id = $1
         RETURNING id, customer_mobile, status, items, total, delivery_address, created_at, updated_at`,
        [orderId, next]
    );
    const updated = rows[0];
    adminOrderEvents.emit('update', { orderId: updated.id, status: updated.status });
    return updated;
}

module.exports = {
    normalizeMobile,
    findCustomerByMobile,
    createCustomer,
    getCustomerByMobile,
    listCustomerAddresses,
    createCustomerAddress,
    getCustomerAddressById,
    setDefaultCustomerAddress,
    updateCustomerProfile,
    createOrder,
    listOrdersForCustomer,
    listAllOrdersForAdmin,
    getOrderById,
    applyAdminOrderAction,
    adminOrderEvents
};
