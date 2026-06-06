'use strict';

const { httpError, sendOrderEmailIfConfigured } = require('./order-email');
const {
    getCustomerByMobile,
    createOrder,
    upsertDefaultCustomerAddress,
    setDefaultCustomerAddress
} = require('./order-service');
const { assertStoreAcceptingOrders } = require('./store-status');
const { validateAndPriceCustomerOrder } = require('./menu-service');
const { getVenueById } = require('./venue-service');

/**
 * @param {string} customerMobile
 * @param {object} body
 */
async function placeOrderForCustomer(customerMobile, body) {
    const customer = await getCustomerByMobile(customerMobile);
    if (!customer) {
        throw httpError(401, 'Customer not found.');
    }

    const priced = await validateAndPriceCustomerOrder(body, customer.city);
    await assertStoreAcceptingOrders(priced.orderVenueId);

    let selectedAddress = null;
    if (body.addressId != null && String(body.addressId).trim() !== '') {
        selectedAddress = await setDefaultCustomerAddress(customer.mobile, body.addressId);
    } else if (body.address && typeof body.address === 'object') {
        selectedAddress = await upsertDefaultCustomerAddress(customer.mobile, body.address);
    } else {
        const fallbackAddress =
            body.deliveryAddress && typeof body.deliveryAddress === 'object' ? body.deliveryAddress : null;
        if (fallbackAddress) {
            selectedAddress = await upsertDefaultCustomerAddress(customer.mobile, fallbackAddress);
        }
    }

    if (!selectedAddress) {
        throw httpError(400, 'Please select a delivery address or add a new one.');
    }

    const order = await createOrder(
        customer.mobile,
        priced.normalizedItems,
        {
            subtotal: priced.subtotal,
            deliveryFee: priced.deliveryFee,
            discount: priced.discount,
            couponCode: priced.couponCode,
            total: priced.total
        },
        selectedAddress,
        priced.orderVenueId
    );

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
        total: priced.total
    });

    return {
        ...order,
        venueName: venue ? venue.name : '',
        venueContactMobile: venue ? venue.contactMobile || '' : '',
        venueHoursText: venue ? venue.hoursText || '' : ''
    };
}

module.exports = { placeOrderForCustomer };
