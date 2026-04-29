'use strict';

require('dotenv').config();

const { ensureSchema } = require('../lib/schema');
const { query } = require('../lib/db');

function usage() {
    console.log(
        [
            'Usage:',
            '  node scripts/coupon-upsert.js CODE TYPE VALUE [MIN_SUBTOTAL] [DESCRIPTION]',
            '',
            'Examples:',
            "  node scripts/coupon-upsert.js WELCOME10 percent 10 0 '10% off'",
            "  node scripts/coupon-upsert.js FLAT50 flat 50 200 '₹50 off on ₹200+'"
        ].join('\n')
    );
}

async function main() {
    const [, , codeRaw, typeRaw, valueRaw, minRaw, ...descParts] = process.argv;
    if (!codeRaw || !typeRaw || !valueRaw) {
        usage();
        process.exit(1);
    }

    const code = String(codeRaw).trim().toUpperCase().slice(0, 64);
    const discountType = String(typeRaw).trim().toLowerCase();
    const discountValue = parseInt(String(valueRaw), 10);
    const minSubtotal = minRaw != null ? parseInt(String(minRaw), 10) : 0;
    const description = descParts.join(' ').trim().slice(0, 200);

    if (!code) throw new Error('Invalid CODE');
    if (!['flat', 'percent'].includes(discountType)) throw new Error('TYPE must be flat or percent');
    if (!Number.isFinite(discountValue) || discountValue <= 0) throw new Error('VALUE must be > 0');
    if (!Number.isFinite(minSubtotal) || minSubtotal < 0) throw new Error('MIN_SUBTOTAL must be >= 0');

    await ensureSchema();
    await query(
        `INSERT INTO coupons (code, description, discount_type, discount_value, min_subtotal, active, updated_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
         ON CONFLICT (code) DO UPDATE
         SET description = EXCLUDED.description,
             discount_type = EXCLUDED.discount_type,
             discount_value = EXCLUDED.discount_value,
             min_subtotal = EXCLUDED.min_subtotal,
             active = TRUE,
             updated_at = NOW()`,
        [code, description, discountType, discountValue, minSubtotal]
    );

    console.log(`Upserted coupon ${code}`);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});

