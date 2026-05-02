'use strict';

const { ensureSchema } = require('../lib/schema');
const { getMenuJson } = require('../lib/menu-service');

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
        await ensureSchema();
        const menu = await getMenuJson();
        res.setHeader(
            'Cache-Control',
            'public, max-age=120, s-maxage=300, stale-while-revalidate=86400'
        );
        return res.status(200).json(menu);
    } catch (err) {
        console.error('public menu:', err.message);
        return res.status(503).json({ error: 'Menu temporarily unavailable.' });
    }
};
