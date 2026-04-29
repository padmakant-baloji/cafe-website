'use strict';

const { requireAdminApi } = require('../../lib/api-auth');

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!requireAdminApi(req, res)) return;
    return res.status(200).json({ ok: true });
};
