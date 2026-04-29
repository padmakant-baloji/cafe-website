'use strict';

const crypto = require('crypto');

const DEFAULT_SECRET = 'dev-only-change-SESSION_SECRET';

function getSecret() {
    return (process.env.SESSION_SECRET || DEFAULT_SECRET).trim() || DEFAULT_SECRET;
}

/**
 * @param {string} mobile
 * @returns {string}
 */
function signCustomerSession(mobile) {
    const m = String(mobile || '').replace(/\D/g, '').slice(-10);
    if (!/^[0-9]{10}$/.test(m)) throw new Error('Invalid mobile for session');
    const exp = Date.now() + 90 * 24 * 60 * 60 * 1000;
    const payload = Buffer.from(JSON.stringify({ m, exp }), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

/**
 * @param {string} token
 * @returns {{ mobile: string } | null}
 */
function verifyCustomerSession(token) {
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
    if (!data || typeof data.m !== 'string' || typeof data.exp !== 'number') {
        return null;
    }
    if (!/^[0-9]{10}$/.test(data.m)) return null;
    if (data.exp < Date.now()) return null;
    return { mobile: data.m };
}

module.exports = { signCustomerSession, verifyCustomerSession };
