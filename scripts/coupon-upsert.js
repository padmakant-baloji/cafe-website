'use strict';

require('dotenv').config();

const { ensureSchema } = require('../lib/schema');
const { query } = require('../lib/db');

function usage() {
    console.log(
        [
            'Usage:',
            '  node scripts/coupon-upsert.js CODE TYPE VALUE [MIN_SUBTOTAL] [MAX_DISCOUNT] [DESCRIPTION]',
            '',
            'Examples:',
            "  node scripts/coupon-upsert.js WELCOME10 percent 10 0 0 '10% off'",
            "  node scripts/coupon-upsert.js FLAT50 flat 50 200 0 '₹50 off on ₹200+'",
            "  node scripts/coupon-upsert.js RCB percent 5 0 50 '5% off up to ₹50'"
        ].join('\n')
    );
}

async function main() {
    const [, , codeRaw, typeRaw, valueRaw, minRaw, maxRaw, ...descParts] = process.argv;
    if (!codeRaw || !typeRaw || !valueRaw) {
        usage();
        process.exit(1);
    }

    const code = String(codeRaw).trim().toUpperCase().slice(0, 64);
    const discountType = String(typeRaw).trim().toLowerCase();
    const discountValue = parseInt(String(valueRaw), 10);
    const minSubtotal = minRaw != null && minRaw !== '' ? parseInt(String(minRaw), 10) : 0;
    const maxDiscount =
        maxRaw != null && maxRaw !== '' && !Number.isNaN(parseInt(String(maxRaw), 10))
            ? parseInt(String(maxRaw), 10)
            : null;
    const description = descParts.join(' ').trim().slice(0, 200);

    if (!code) throw new Error('Invalid CODE');
    if (!['flat', 'percent'].includes(discountType)) throw new Error('TYPE must be flat or percent');
    if (!Number.isFinite(discountValue) || discountValue <= 0) throw new Error('VALUE must be > 0');
    if (!Number.isFinite(minSubtotal) || minSubtotal < 0) throw new Error('MIN_SUBTOTAL must be >= 0');
    if (maxDiscount != null && (!Number.isFinite(maxDiscount) || maxDiscount <= 0)) {
        throw new Error('MAX_DISCOUNT must be > 0 when provided');
    }

    await ensureSchema();
    await query(
        `INSERT INTO coupons (code, description, discount_type, discount_value, max_discount, min_subtotal, active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
         ON CONFLICT (code) DO UPDATE
         SET description = EXCLUDED.description,
             discount_type = EXCLUDED.discount_type,
             discount_value = EXCLUDED.discount_value,
             max_discount = EXCLUDED.max_discount,
             min_subtotal = EXCLUDED.min_subtotal,
             active = TRUE,
             updated_at = NOW()`,
        [code, description, discountType, discountValue, maxDiscount, minSubtotal]
    );

    console.log(`Upserted coupon ${code}`);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
