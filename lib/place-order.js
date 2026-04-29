'use strict';

const { httpError, sendOrderEmailIfConfigured } = require('./order-email');
const {
    getCustomerByMobile,
    createOrder,
    createCustomerAddress,
    setDefaultCustomerAddress
} = require('./order-service');
const { validateCoupon } = require('./coupon-service');

const MAX_LEN = 200;
const MAX_ITEMS = 50;
const MIN_NON_KUDACHI_ORDER_VALUE = 200;
const MIN_FREE_DELIVERY_ORDER_VALUE = 500;
const NON_KUDACHI_DELIVERY_FEE = 40;

function trimStr(s, max) {
    if (typeof s !== 'string') return '';
    return s.trim().slice(0, max);
}

/**
 * @param {string} customerMobile
 * @param {object} body
 */
async function placeOrderForCustomer(customerMobile, body) {
    const items = Array.isArray(body.items) ? body.items : [];
    const total =
        typeof body.total === 'number' && !Number.isNaN(body.total)
            ? body.total
            : parseInt(String(body.total), 10);
    const couponCode = typeof body.couponCode === 'string' ? body.couponCode : '';

    if (items.length === 0 || items.length > MAX_ITEMS) {
        throw httpError(400, 'Invalid cart.');
    }

    const normalizedItems = [];
    let subtotal = 0;
    for (const row of items) {
        const name = trimStr(row.name, MAX_LEN);
        const price = parseInt(row.price, 10);
        const quantity = parseInt(row.quantity, 10);
        if (!name || Number.isNaN(price) || price < 0 || Number.isNaN(quantity) || quantity < 1 || quantity > 99) {
            throw httpError(400, 'Invalid order line.');
        }
        subtotal += price * quantity;
        normalizedItems.push({ name, price, quantity });
    }

    const customer = await getCustomerByMobile(customerMobile);
    if (!customer) {
        throw httpError(401, 'Customer not found.');
    }

    const cityLower = String(customer.city || '').trim().toLowerCase();
    if (cityLower && cityLower !== 'kudachi' && subtotal < MIN_NON_KUDACHI_ORDER_VALUE) {
        throw httpError(
            400,
            `Minimum order for delivery outside Kudachi is ₹${MIN_NON_KUDACHI_ORDER_VALUE}.`
        );
    }

    const deliveryFee =
        cityLower && cityLower !== 'kudachi' && subtotal >= MIN_NON_KUDACHI_ORDER_VALUE && subtotal < MIN_FREE_DELIVERY_ORDER_VALUE
            ? NON_KUDACHI_DELIVERY_FEE
            : 0;

    let discount = 0;
    let normalizedCouponCode = '';
    if (couponCode && couponCode.trim()) {
        const result = await validateCoupon(couponCode, subtotal);
        if (result.ok) {
            discount = result.discount;
            normalizedCouponCode = result.code;
        } else {
            throw httpError(400, result.message || 'Invalid coupon.');
        }
    }

    const computedPayableTotal = Math.max(0, subtotal - discount) + deliveryFee;
    if (Number.isNaN(total) || total !== computedPayableTotal) {
        throw httpError(400, `Total mismatch. Expected ₹${computedPayableTotal}.`);
    }

    let selectedAddress = null;
    if (body.addressId != null && String(body.addressId).trim() !== '') {
        selectedAddress = await setDefaultCustomerAddress(customer.mobile, body.addressId);
    } else if (body.address && typeof body.address === 'object') {
        selectedAddress = await createCustomerAddress(customer.mobile, body.address, {
            makeDefault: true
        });
    } else {
        const fallbackAddress = body.deliveryAddress && typeof body.deliveryAddress === 'object'
            ? body.deliveryAddress
            : null;
        if (fallbackAddress) {
            selectedAddress = fallbackAddress;
        }
    }

    if (!selectedAddress) {
        throw httpError(400, 'Please select a delivery address or add a new one.');
    }

    const order = await createOrder(
        customer.mobile,
        normalizedItems,
        {
            subtotal,
            deliveryFee,
            discount,
            couponCode: normalizedCouponCode,
            total: computedPayableTotal
        },
        selectedAddress
    );

    await sendOrderEmailIfConfigured({
        customerName: customer.name,
        mobileNumber: customer.mobile,
        customerCity: customer.city,
        deliveryAddress: selectedAddress,
        items: normalizedItems,
        subtotal,
        deliveryFee,
        discount,
        couponCode: normalizedCouponCode,
        total: computedPayableTotal
    });

    return order;
}

module.exports = { placeOrderForCustomer };
