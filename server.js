'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const nodemailer = require('nodemailer');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

const MAX_LEN = 200;
const MAX_ITEMS = 50;

function trimStr(s, max) {
    if (typeof s !== 'string') return '';
    return s.trim().slice(0, max);
}

function buildOrderEmailText(body) {
    const { customerName, mobileNumber, customerCity, items, total } = body;
    let text = `Order from Baloji's Cafe\n\n`;
    text += `Name: ${customerName}\n`;
    text += `Mobile: ${mobileNumber}\n`;
    text += `City: ${customerCity}\n\n`;
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
            'Missing SMTP configuration. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and ORDER_TO_EMAIL in .env'
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

app.use(express.json({ limit: '128kb' }));

app.post('/api/order', async (req, res) => {
    try {
        const customerName = trimStr(req.body.customerName, MAX_LEN);
        const mobileNumber = trimStr(req.body.mobileNumber, 20);
        const customerCity = trimStr(req.body.customerCity, MAX_LEN);
        const items = Array.isArray(req.body.items) ? req.body.items : [];
        const total =
            typeof req.body.total === 'number' && !Number.isNaN(req.body.total)
                ? req.body.total
                : parseInt(String(req.body.total), 10);

        if (!customerName || !mobileNumber || !customerCity) {
            return res.status(400).json({ error: 'Missing name, mobile, or city.' });
        }
        if (!/^[0-9]{10}$/.test(mobileNumber)) {
            return res.status(400).json({ error: 'Invalid mobile number.' });
        }
        if (items.length === 0 || items.length > MAX_ITEMS) {
            return res.status(400).json({ error: 'Invalid cart.' });
        }

        const normalizedItems = [];
        let computedTotal = 0;
        for (const row of items) {
            const name = trimStr(row.name, MAX_LEN);
            const price = parseInt(row.price, 10);
            const quantity = parseInt(row.quantity, 10);
            if (!name || Number.isNaN(price) || price < 0 || Number.isNaN(quantity) || quantity < 1 || quantity > 99) {
                return res.status(400).json({ error: 'Invalid order line.' });
            }
            computedTotal += price * quantity;
            normalizedItems.push({ name, price, quantity });
        }

        if (Number.isNaN(total) || total !== computedTotal) {
            return res.status(400).json({ error: 'Total mismatch.' });
        }

        const transport = getMailTransport();
        const from =
            trimStr(process.env.ORDER_FROM_EMAIL, MAX_LEN) || process.env.SMTP_USER;
        const to = process.env.ORDER_TO_EMAIL;

        const payload = {
            customerName,
            mobileNumber,
            customerCity,
            items: normalizedItems,
            total: computedTotal
        };

        await transport.sendMail({
            from,
            to,
            subject: `New order — ${customerName} (${customerCity})`,
            text: buildOrderEmailText(payload)
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error('Order email error:', err.message);
        return res.status(500).json({
            error: err.message || 'Could not send order email.'
        });
    }
});

app.use(express.static(ROOT));

app.listen(PORT, () => {
    console.log(`Server http://localhost:${PORT}`);
    console.log('Configure .env from .env.example to enable email orders.');
});
