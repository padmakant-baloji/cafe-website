'use strict';

const { query } = require('./db');
const { httpError } = require('./order-email');
const { getDefaultVenue, getVenueById } = require('./venue-service');
const { isWithinVenueHours, getVenueHoursClosedMessage } = require('./venue-hours');

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

async function getStoreStatus(venueId) {
    const id = parseInt(String(venueId), 10);
    if (!Number.isFinite(id)) {
        throw Object.assign(new Error('Invalid venue.'), { statusCode: 400 });
    }

    let row = null;
    try {
        const result = await query(
            `SELECT accepting_orders, closed_reason, updated_at
             FROM store_settings
             WHERE venue_id = $1
             LIMIT 1`,
            [id]
        );
        row = result.rows && result.rows[0] ? result.rows[0] : null;
    } catch {
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
 * @param {number} venueId
 * @param {{ acceptingOrders: boolean, reason?: string }} input
 */
async function setStoreStatus(venueId, input) {
    const id = parseInt(String(venueId), 10);
    if (!Number.isFinite(id)) {
        throw Object.assign(new Error('Invalid venue.'), { statusCode: 400 });
    }

    const acceptingOrders = Boolean(input && input.acceptingOrders);
    const reasonKey = acceptingOrders ? '' : normalizeReasonKey(input && input.reason);

    await query(
        `INSERT INTO store_settings (id, venue_id, accepting_orders, closed_reason, updated_at)
         VALUES ($1::smallint, $1::integer, $2, $3, NOW())
         ON CONFLICT (id) DO UPDATE
         SET accepting_orders = EXCLUDED.accepting_orders,
             closed_reason = EXCLUDED.closed_reason,
             updated_at = NOW()`,
        [id, acceptingOrders, reasonKey]
    );

    return getStoreStatus(id);
}

function buildEffectiveVenueStatus(venue, adminAcceptingOrders, date = new Date()) {
    const withinHours = isWithinVenueHours(venue.hoursText, date);
    return {
        id: venue.id,
        slug: venue.slug,
        name: venue.name,
        city: venue.city || '',
        contactMobile: venue.contactMobile || '',
        hoursText: venue.hoursText || '',
        adminAcceptingOrders: Boolean(adminAcceptingOrders),
        withinHours,
        acceptingOrders: Boolean(adminAcceptingOrders) && withinHours
    };
}

/** Throws a 403 when admin paused orders or the venue is outside its hours. */
async function assertStoreAcceptingOrders(venueId) {
    const id = parseInt(String(venueId), 10);
    const venue = await getVenueById(id);
    if (!venue) {
        throw httpError(400, 'Hotel not found.');
    }

    const status = await getStoreStatus(id);
    if (!status.acceptingOrders) {
        const message =
            status.notice && status.notice.messageEn
                ? status.notice.messageEn
                : 'We are not accepting orders right now. Please try again later.';
        throw httpError(403, message);
    }

    if (!isWithinVenueHours(venue.hoursText)) {
        throw httpError(403, getVenueHoursClosedMessage(venue.hoursText, venue.name));
    }
}

function venueCatalogHasItems(catalog) {
    if (!catalog) return false;
    let data = catalog;
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        } catch {
            return false;
        }
    }
    const categories = Array.isArray(data.categories) ? data.categories : Array.isArray(data) ? data : [];
    return categories.some((cat) => {
        if ((cat.items || []).some((item) => item && item.enabled !== false)) return true;
        return (cat.subsections || []).some((sub) =>
            (sub.items || []).some((item) => item && item.enabled !== false)
        );
    });
}

async function listPartnerVenueStatuses() {
    const { rows } = await query(
        `SELECT v.id, v.slug, v.name, v.city, v.contact_mobile, v.hours_text, v.menu_catalog,
                COALESCE(ss.accepting_orders, TRUE) AS accepting_orders
         FROM venues v
         LEFT JOIN store_settings ss ON ss.venue_id = v.id
         WHERE v.is_default = FALSE
         ORDER BY v.name ASC`
    );

    return (rows || [])
        .filter((row) => venueCatalogHasItems(row.menu_catalog))
        .map((row) =>
            buildEffectiveVenueStatus(
                {
                    id: row.id,
                    slug: row.slug,
                    name: row.name,
                    city: row.city || '',
                    contactMobile: row.contact_mobile || '',
                    hoursText: row.hours_text || ''
                },
                row.accepting_orders
            )
        );
}

async function getPublicStorefrontStatus() {
    const partners = await listPartnerVenueStatuses();
    const venues = partners.map((venue) => ({ ...venue, isMain: false }));
    const openPartners = venues.filter((venue) => venue.acceptingOrders);

    if (openPartners.length > 0) {
        const pick = openPartners[0]; // Just pick the first open partner
        return {
            acceptingOrders: true,
            activeVenueId: pick.id,
            activeVenueName: pick.name,
            mainVenueOpen: false,
            isFallbackVenue: false,
            fallbackMessage: null,
            reason: null,
            notice: null,
            venues,
            updatedAt: new Date().toISOString()
        };
    }

    const anyVenueWithinHours = venues.some((venue) => venue.withinHours);
    
    return {
        acceptingOrders: false,
        activeVenueId: venues.length > 0 ? venues[0].id : null,
        activeVenueName: venues.length > 0 ? venues[0].name : null,
        mainVenueOpen: false,
        isFallbackVenue: false,
        fallbackMessage: null,
        reason: anyVenueWithinHours ? null : 'shop_closed',
        notice: anyVenueWithinHours ? null : buildNotice('shop_closed'),
        venues,
        updatedAt: new Date().toISOString()
    };
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
    assertStoreAcceptingOrders,
    getPublicStorefrontStatus
};
