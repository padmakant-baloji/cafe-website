'use strict';

const { ensureSchema } = require('../../lib/schema');
const { requireAdminApi } = require('../../lib/api-auth');
const { readMenu, applyMenuAction } = require('../../lib/menu-store');

module.exports = async (req, res) => {
    if (!requireAdminApi(req, res)) return;

    if (req.method === 'GET') {
        try {
            await ensureSchema();
            const menu = await readMenu();
            return res.status(200).json(menu);
        } catch (err) {
            console.error('admin menu get:', err.message);
            return res.status(500).json({ error: 'Could not load menu.' });
        }
    }

    if (req.method === 'POST') {
        try {
            await ensureSchema();
            const result = await applyMenuAction(req.body || {});
            return res.status(200).json(result);
        } catch (err) {
            const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
            if (code >= 500) {
                console.error('admin menu post:', err.message);
            }
            return res.status(code).json({ error: err.message || 'Menu update failed.' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
