'use strict';

const nodemailer = require('nodemailer');

const MAX_LEN = 200;
const MAX_ITEMS = 50;

function trimStr(s, max) {
    if (typeof s !== 'string') return '';
    return s.trim().slice(0, max);
}

function httpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function buildOrderEmailText(body) {
    const { customerName, mobileNumber, customerCity, deliveryAddress, items, total } = body;
    let text = `Order from Baloji's Cafe\n\n`;
    text += `Name: ${customerName}\n`;
    text += `Mobile: ${mobileNumber}\n`;
    text += `City: ${customerCity}\n\n`;
    if (deliveryAddress && typeof deliveryAddress === 'object') {
        text += `Delivery address:\n`;
        text += `${deliveryAddress.addressLine || deliveryAddress.address_line || ''}\n\n`;
    }
    text += `Order details:\n`;
    items.forEach((item, i) => {
        const lineTotal = item.price * item.quantity;
        text += `${i + 1}. ${item.name} × ${item.quantity} = ₹${lineTotal}\n`;
    });
    text += `\nTotal: ₹${total}\n`;
    return text;
}

function getMailTransport() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const to = process.env.ORDER_TO_EMAIL;

    if (!host || !user || !pass || !to) {
        throw new Error(
            'Missing SMTP configuration. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and ORDER_TO_EMAIL'
        );
    }

    const port = Number(process.env.SMTP_PORT) || 587;
    const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';

    return nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass }
    });
}

/**
 * Validates payload and sends the order email.
 * @throws {Error & { statusCode?: number }}
 */
async function submitOrder(body) {
    const customerName = trimStr(body.customerName, MAX_LEN);
    const mobileNumber = trimStr(body.mobileNumber, 20);
    const customerCity = trimStr(body.customerCity, MAX_LEN);
    const deliveryAddress =
        body.deliveryAddress && typeof body.deliveryAddress === 'object' ? body.deliveryAddress : null;
    const items = Array.isArray(body.items) ? body.items : [];
    const total =
        typeof body.total === 'number' && !Number.isNaN(body.total)
            ? body.total
            : parseInt(String(body.total), 10);

    if (!customerName || !mobileNumber || !customerCity) {
        throw httpError(400, 'Missing name, mobile, or city.');
    }
    if (!/^[0-9]{10}$/.test(mobileNumber)) {
        throw httpError(400, 'Invalid mobile number.');
    }
    if (items.length === 0 || items.length > MAX_ITEMS) {
        throw httpError(400, 'Invalid cart.');
    }

    const normalizedItems = [];
    let computedTotal = 0;
    for (const row of items) {
        const name = trimStr(row.name, MAX_LEN);
        const price = parseInt(row.price, 10);
        const quantity = parseInt(row.quantity, 10);
        if (!name || Number.isNaN(price) || price < 0 || Number.isNaN(quantity) || quantity < 1 || quantity > 99) {
            throw httpError(400, 'Invalid order line.');
        }
        computedTotal += price * quantity;
        normalizedItems.push({ name, price, quantity });
    }

    if (Number.isNaN(total) || total !== computedTotal) {
        throw httpError(400, 'Total mismatch.');
    }

    const transport = getMailTransport();
    const from = trimStr(process.env.ORDER_FROM_EMAIL, MAX_LEN) || process.env.SMTP_USER;
    const to = process.env.ORDER_TO_EMAIL;

    const payload = {
        customerName,
        mobileNumber,
        customerCity,
        deliveryAddress,
        items: normalizedItems,
        total: computedTotal
    };

    await transport.sendMail({
        from,
        to,
        subject: `New order — ${customerName} (${customerCity})`,
        text: buildOrderEmailText(payload)
    });

    return { ok: true };
}

function isSmtpConfigured() {
    return !!(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        process.env.ORDER_TO_EMAIL
    );
}

/**
 * Sends order email when SMTP is configured. Does not throw on missing SMTP.
 * @param {object} body same shape as submitOrder
 */
async function sendOrderEmailIfConfigured(body) {
    if (!isSmtpConfigured()) return;
    try {
        await submitOrder(body);
    } catch (err) {
        console.error('Order email (non-fatal):', err.message);
    }
}

module.exports = { submitOrder, sendOrderEmailIfConfigured, httpError, isSmtpConfigured };
