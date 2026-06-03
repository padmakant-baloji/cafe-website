'use strict';

const { query } = require('./db');
const { httpError } = require('./order-email');

/**
 * Reasons the cafe can stop accepting online orders. Each carries an icon and
 * bilingual (English + Hindi) copy so the storefront overlay and admin panel
 * stay in sync from a single source of truth.
 */
const STORE_STATUS_REASONS = {
    no_electricity: {
        key: 'no_electricity',
        icon: '⚡',
        en: {
            label: 'No electricity',
            message: 'Power is out at the cafe right now, so we have paused online orders. Please try again a little later.'
        },
        hi: {
            label: 'बिजली नहीं है',
            message: 'अभी कैफ़े में बिजली नहीं है, इसलिए ऑनलाइन ऑर्डर बंद हैं। कृपया थोड़ी देर बाद फिर कोशिश करें।'
        }
    },
    shop_closed: {
        key: 'shop_closed',
        icon: '🏪',
        en: {
            label: 'Shop closed',
            message: 'Our shop is closed at the moment. We will start taking orders again soon.'
        },
        hi: {
            label: 'दुकान बंद है',
            message: 'हमारी दुकान अभी बंद है। हम जल्द ही फिर से ऑर्डर लेना शुरू करेंगे।'
        }
    },
    no_delivery_boy: {
        key: 'no_delivery_boy',
        icon: '🛵',
        en: {
            label: 'No delivery boy available',
            message: 'No delivery partner is available right now, so we cannot take orders. Please try again shortly.'
        },
        hi: {
            label: 'डिलीवरी बॉय उपलब्ध नहीं',
            message: 'अभी कोई डिलीवरी बॉय उपलब्ध नहीं है, इसलिए हम ऑर्डर नहीं ले पा रहे हैं। कृपया थोड़ी देर बाद कोशिश करें।'
        }
    }
};

const DEFAULT_REASON_KEY = 'shop_closed';

const STORE_CLOSED_TITLE_EN = 'We are not accepting orders right now';
const STORE_CLOSED_TITLE_HI = 'हम अभी ऑर्डर स्वीकार नहीं कर रहे हैं';

function isValidReasonKey(key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(STORE_STATUS_REASONS, key);
}

function normalizeReasonKey(key) {
    return isValidReasonKey(key) ? key : DEFAULT_REASON_KEY;
}

/** Public-facing notice (icon + bilingual copy) shown when ordering is paused. */
function buildNotice(reasonKey) {
    const reason = STORE_STATUS_REASONS[normalizeReasonKey(reasonKey)];
    return {
        reason: reason.key,
        icon: reason.icon,
        titleEn: STORE_CLOSED_TITLE_EN,
        titleHi: STORE_CLOSED_TITLE_HI,
        reasonEn: reason.en.label,
        reasonHi: reason.hi.label,
        messageEn: reason.en.message,
        messageHi: reason.hi.message
    };
}

/** Options for the admin dropdown (key + bilingual label). */
function listReasonOptions() {
    return Object.values(STORE_STATUS_REASONS).map((r) => ({
        key: r.key,
        labelEn: r.en.label,
        labelHi: r.hi.label,
        icon: r.icon
    }));
}

async function getStoreStatus() {
    let row = null;
    try {
        const result = await query(
            `SELECT accepting_orders, closed_reason, updated_at FROM store_settings WHERE id = 1`
        );
        row = result.rows && result.rows[0] ? result.rows[0] : null;
    } catch {
        // If the table is not ready, default to accepting orders so the storefront keeps working.
        row = null;
    }

    const acceptingOrders = row ? Boolean(row.accepting_orders) : true;
    const reasonKey = row && row.closed_reason ? normalizeReasonKey(row.closed_reason) : DEFAULT_REASON_KEY;

    return {
        acceptingOrders,
        reason: acceptingOrders ? null : reasonKey,
        notice: acceptingOrders ? null : buildNotice(reasonKey),
        updatedAt: row && row.updated_at ? row.updated_at : null
    };
}

/**
 * @param {{ acceptingOrders: boolean, reason?: string }} input
 */
async function setStoreStatus(input) {
    const acceptingOrders = Boolean(input && input.acceptingOrders);
    const reasonKey = acceptingOrders ? '' : normalizeReasonKey(input && input.reason);

    await query(
        `INSERT INTO store_settings (id, accepting_orders, closed_reason, updated_at)
         VALUES (1, $1, $2, NOW())
         ON CONFLICT (id) DO UPDATE
         SET accepting_orders = EXCLUDED.accepting_orders,
             closed_reason = EXCLUDED.closed_reason,
             updated_at = NOW()`,
        [acceptingOrders, reasonKey]
    );

    return getStoreStatus();
}

/** Throws a 403 (with the bilingual reason message) when ordering is paused. */
async function assertStoreAcceptingOrders() {
    const status = await getStoreStatus();
    if (!status.acceptingOrders) {
        const message =
            status.notice && status.notice.messageEn
                ? status.notice.messageEn
                : 'We are not accepting orders right now. Please try again later.';
        throw httpError(403, message);
    }
}

module.exports = {
    STORE_STATUS_REASONS,
    DEFAULT_REASON_KEY,
    isValidReasonKey,
    normalizeReasonKey,
    buildNotice,
    listReasonOptions,
    getStoreStatus,
    setStoreStatus,
    assertStoreAcceptingOrders
};
