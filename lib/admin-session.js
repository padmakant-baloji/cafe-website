'use strict';

const crypto = require('crypto');

const DEFAULT_SECRET = 'dev-only-change-SESSION_SECRET';
const ADMIN_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret() {
    return (process.env.SESSION_SECRET || DEFAULT_SECRET).trim() || DEFAULT_SECRET;
}

/**
 * @param {number} venueId
 * @returns {string}
 */
function signAdminSession(venueId) {
    const id = parseInt(String(venueId), 10);
    if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid venue for admin session');
    const exp = Date.now() + ADMIN_SESSION_MS;
    const payload = Buffer.from(JSON.stringify({ v: id, exp }), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

/**
 * @param {string} token
 * @returns {{ venueId: number } | null}
 */
function verifyAdminSession(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');

    const sigBuf = Buffer.from(sig, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    let data;
    try {
        data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    if (!data || typeof data.v !== 'number' || typeof data.exp !== 'number') return null;
    if (data.v <= 0) return null;
    if (data.exp < Date.now()) return null;
    return { venueId: data.v };
}

module.exports = { signAdminSession, verifyAdminSession };
