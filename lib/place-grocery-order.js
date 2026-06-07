'use strict';

const { getPool } = require('./db');
const { httpError, sendOrderEmailIfConfigured } = require('./order-email');
const {
    getCustomerByMobile,
    upsertDefaultCustomerAddress,
    setDefaultCustomerAddress
} = require('./order-service');
const { assertStoreAcceptingOrders } = require('./store-status');
const { validateAndPriceGroceryOrder } = require('./grocery-service');
const { getVenueById } = require('./venue-service');

/**
 * Place a grocery (Instamart-style) order. Decrements stock and inserts the order in a single
 * transaction so stock can never go negative or get reserved without an order.
 *
 * @param {string} customerMobile
 * @param {object} body
 */
async function placeGroceryOrderForCustomer(customerMobile, body) {
    const customer = await getCustomerByMobile(customerMobile);
    if (!customer) {
        throw httpError(401, 'Customer not found.');
    }

    const priced = await validateAndPriceGroceryOrder(body);
    await assertStoreAcceptingOrders(priced.orderVenueId);

    let selectedAddress = null;
    if (body.addressId != null && String(body.addressId).trim() !== '') {
        selectedAddress = await setDefaultCustomerAddress(customer.mobile, body.addressId);
    } else if (body.address && typeof body.address === 'object') {
        selectedAddress = await upsertDefaultCustomerAddress(customer.mobile, body.address);
    } else if (body.deliveryAddress && typeof body.deliveryAddress === 'object') {
        selectedAddress = await upsertDefaultCustomerAddress(customer.mobile, body.deliveryAddress);
    }

    if (!selectedAddress) {
        throw httpError(400, 'Please select a delivery address or add a new one.');
    }

    const pool = await getPool();
    const client = await pool.connect();
    let order;
    try {
        await client.query('BEGIN');

        // Atomically decrement stock for each line; the WHERE guard prevents overselling.
        for (const item of priced.normalizedItems) {
            const { rowCount } = await client.query(
                `UPDATE grocery_products
                 SET stock_qty = stock_qty - $3, updated_at = NOW()
                 WHERE id = $1 AND venue_id = $2 AND stock_qty >= $3 AND enabled = TRUE`,
                [item.productId, priced.orderVenueId, item.quantity]
            );
            if (rowCount !== 1) {
                throw httpError(409, `Item just went out of stock: ${item.name}. Please review your cart.`);
            }
        }

        const { rows } = await client.query(
            `INSERT INTO orders (customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, venue_id, channel)
             VALUES ($1, 'pending', $2::jsonb, $3, $4, $5, $6, $7, $8::jsonb, $9, 'grocery')
             RETURNING id, customer_mobile, status, items, subtotal, delivery_fee, discount, coupon_code, total, delivery_address, created_at, updated_at, venue_id, channel`,
            [
                customer.mobile,
                JSON.stringify(priced.normalizedItems),
                priced.subtotal,
                priced.deliveryFee,
                priced.discount,
                priced.couponCode || null,
                priced.total,
                JSON.stringify(selectedAddress),
                priced.orderVenueId
            ]
        );
        order = rows[0];

        await client.query('COMMIT');
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr) {
            console.warn('Grocery order rollback failed:', rollbackErr.message);
        }
        throw err;
    } finally {
        client.release();
    }

    const venue = await getVenueById(priced.orderVenueId);

    await sendOrderEmailIfConfigured({
        customerName: customer.name,
        mobileNumber: customer.mobile,
        customerCity: customer.city,
        deliveryAddress: selectedAddress,
        items: priced.normalizedItems,
        subtotal: priced.subtotal,
        deliveryFee: priced.deliveryFee,
        discount: priced.discount,
        couponCode: priced.couponCode,
        total: priced.total,
        orderType: 'Grocery'
    });

    return {
        ...order,
        venueName: venue ? venue.name : '',
        venueContactMobile: venue ? venue.contactMobile || '' : '',
        venueHoursText: venue ? venue.hoursText || '' : ''
    };
}

module.exports = { placeGroceryOrderForCustomer };
