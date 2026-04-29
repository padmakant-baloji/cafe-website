'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const { submitOrder } = require('./lib/order-email');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

app.use(express.json({ limit: '128kb' }));

app.post('/api/order', async (req, res) => {
    try {
        await submitOrder(req.body || {});
        return res.json({ ok: true });
    } catch (err) {
        const code =
            err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
        if (code >= 500) {
            console.error('Order email error:', err.message);
        }
        return res.status(code).json({
            error: err.message || 'Could not send order email.'
        });
    }
});

app.use(express.static(ROOT));

app.listen(PORT, () => {
    console.log(`Server http://localhost:${PORT}`);
    console.log('Configure .env from .env.example to enable email orders.');
});
