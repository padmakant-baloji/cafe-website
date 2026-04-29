'use strict';

const { query } = require('./db');
const { httpError } = require('./order-email');

function normalizeCode(code) {
    if (typeof code !== 'string') return '';
    return code.trim().toUpperCase().slice(0, 64);
}

function computeDiscountAmount(subtotal, coupon) {
    const safeSubtotal = Number.isFinite(subtotal) ? Math.max(0, Math.floor(subtotal)) : 0;
    if (!coupon) return 0;
    if (!safeSubtotal) return 0;

    const type = String(coupon.discount_type || '').toLowerCase();
    const value = Number.isFinite(coupon.discount_value) ? Math.floor(coupon.discount_value) : 0;
    let discount = 0;

    if (type === 'flat') {
        discount = Math.max(0, value);
    } else if (type === 'percent') {
        const pct = Math.min(100, Math.max(0, value));
        discount = Math.floor((safeSubtotal * pct) / 100);
    } else {
        discount = 0;
    }

    if (Number.isFinite(coupon.max_discount) && coupon.max_discount != null) {
        const maxD = Math.max(0, Math.floor(coupon.max_discount));
        discount = Math.min(discount, maxD);
    }

    discount = Math.min(discount, safeSubtotal);
    return discount;
}

async function getCouponByCode(codeRaw) {
    const code = normalizeCode(codeRaw);
    if (!code) return null;
    const { rows } = await query(
        `SELECT code, description, discount_type, discount_value, max_discount, min_subtotal,
                active, starts_at, ends_at
         FROM coupons
         WHERE code = $1
         LIMIT 1`,
        [code]
    );
    return rows[0] || null;
}

async function validateCoupon(codeRaw, subtotal) {
    const code = normalizeCode(codeRaw);
    if (!code) return { ok: false, code: '', discount: 0, message: 'Enter a coupon code.' };

    const coupon = await getCouponByCode(code);
    if (!coupon) return { ok: false, code, discount: 0, message: 'Invalid coupon code.' };
    if (!coupon.active) return { ok: false, code, discount: 0, message: 'This coupon is not active.' };

    const now = Date.now();
    const startsAt = coupon.starts_at ? new Date(coupon.starts_at).getTime() : null;
    const endsAt = coupon.ends_at ? new Date(coupon.ends_at).getTime() : null;

    if (Number.isFinite(startsAt) && startsAt != null && now < startsAt) {
        return { ok: false, code, discount: 0, message: 'This coupon is not active yet.' };
    }
    if (Number.isFinite(endsAt) && endsAt != null && now > endsAt) {
        return { ok: false, code, discount: 0, message: 'This coupon has expired.' };
    }

    const safeSubtotal = Number.isFinite(subtotal) ? Math.max(0, Math.floor(subtotal)) : 0;
    const minSubtotal = Number.isFinite(coupon.min_subtotal) ? Math.max(0, Math.floor(coupon.min_subtotal)) : 0;
    if (safeSubtotal < minSubtotal) {
        return {
            ok: false,
            code,
            discount: 0,
            message: `Coupon applies only on orders ₹${minSubtotal}+.`
        };
    }

    const discount = computeDiscountAmount(safeSubtotal, coupon);
    if (!discount) {
        return { ok: false, code, discount: 0, message: 'Coupon not applicable on this order.' };
    }

    return {
        ok: true,
        code,
        discount,
        message: coupon.description || `Coupon applied: -₹${discount}`
    };
}

function requireValidCouponResult(result) {
    if (!result || !result.ok) {
        throw httpError(400, result?.message || 'Invalid coupon.');
    }
    return result;
}

module.exports = { normalizeCode, validateCoupon, requireValidCouponResult };

