'use strict';

const fs = require('fs/promises');
const path = require('path');

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).send('Method not allowed');
    }

    try {
        const html = await fs.readFile(path.join(process.cwd(), 'admin.html'), 'utf8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(html);
    } catch (err) {
        console.error('admin page:', err.message);
        return res.status(500).send('Could not load admin page.');
    }
};
