'use strict';

const { query } = require('./db');
const { verifyAdminSession } = require('./admin-session');

const ADMIN_USER = process.env.ADMIN_USER || 'balojicafe';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';
const DEFAULT_VENUE_SLUG = 'balojicafe';

const MIN_TABLE_COUNT = 1;
const MAX_TABLE_COUNT = 30;
const MIN_PARCEL_COUNT = 1;
const MAX_PARCEL_COUNT = 20;

function normalizeVenueRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        city: row.city || '',
        addressLine: row.address_line || '',
        contactMobile: row.contact_mobile || '',
        hoursText: row.hours_text || '',
        tableCount: Number(row.table_count) || 7,
        parcelCount: Number(row.parcel_count) || 5,
        walkinMobile: row.walkin_mobile || '8888888888',
        isDefault: Boolean(row.is_default),
        adminUser: row.admin_user || '',
        venueType: row.venue_type === 'grocery' ? 'grocery' : 'food',
        paymentQrCode: row.payment_qr_code || '',
        tableCategories: typeof row.table_categories === 'string' ? JSON.parse(row.table_categories) : (row.table_categories || null)
    };
}

function trimText(value, max) {
    return String(value || '')
        .trim()
        .slice(0, max);
}

function normalizeSlug(raw) {
    return String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}

function slugFromName(name) {
    const base = normalizeSlug(name);
    return base || 'hotel';
}

function isMainVenue(venue) {
    return Boolean(venue && venue.isDefault);
}

function assertMainVenue(venue) {
    if (!isMainVenue(venue)) {
        throw Object.assign(new Error('Only the main venue can manage hotels.'), { statusCode: 403 });
    }
}

function decodeBasicAuth(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) return null;
    try {
        const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
        const colon = decoded.indexOf(':');
        const user = colon >= 0 ? decoded.slice(0, colon) : decoded;
        const pass = colon >= 0 ? decoded.slice(colon + 1) : '';
        return { user, pass };
    } catch {
        return null;
    }
}

async function getDefaultVenue() {
    const { rows } = await query(
        `SELECT id, slug, name, city, address_line, contact_mobile, hours_text, table_count, parcel_count, walkin_mobile, is_default, admin_user, venue_type, payment_qr_code, table_categories
         FROM venues
         WHERE is_default = TRUE OR slug = $1
         ORDER BY is_default DESC, id ASC
         LIMIT 1`,
        [DEFAULT_VENUE_SLUG]
    );
    return normalizeVenueRow(rows[0]);
}

async function getVenueById(venueId) {
    const id = parseInt(String(venueId), 10);
    if (!Number.isFinite(id)) return null;
    const { rows } = await query(
        `SELECT id, slug, name, city, address_line, contact_mobile, hours_text, table_count, parcel_count, walkin_mobile, is_default, admin_user, venue_type, payment_qr_code, table_categories
         FROM venues WHERE id = $1 LIMIT 1`,
        [id]
    );
    return normalizeVenueRow(rows[0]);
}

async function getVenueBySlug(slug) {
    const s = String(slug || '').trim().toLowerCase();
    if (!s) return null;
    const { rows } = await query(
        `SELECT id, slug, name, city, address_line, contact_mobile, hours_text, table_count, parcel_count, walkin_mobile, is_default, admin_user, venue_type, payment_qr_code, table_categories
         FROM venues WHERE slug = $1 LIMIT 1`,
        [s]
    );
    return normalizeVenueRow(rows[0]);
}

async function resolvePublicVenue() {
    return (await getVenueBySlug(DEFAULT_VENUE_SLUG)) || (await getDefaultVenue());
}

/**
 * Validate admin username/password and return the venue they manage.
 */
async function authenticateAdminUser(user, pass) {
    const u = String(user || '').trim();
    const p = String(pass || '');
    if (!u) return null;

    const defaultVenue = await getDefaultVenue();
    if (defaultVenue && u === ADMIN_USER && p === ADMIN_PASS) {
        return defaultVenue;
    }

    const { rows } = await query(
        `SELECT id, slug, name, city, address_line, contact_mobile, hours_text, table_count, parcel_count, walkin_mobile, is_default, admin_user, venue_type, payment_qr_code, table_categories
         FROM venues
         WHERE admin_user = $1 AND admin_pass = $2
         LIMIT 1`,
        [u, p]
    );
    return normalizeVenueRow(rows[0]);
}

/**
 * Authenticate admin credentials and return the venue they manage.
 * Accepts Bearer session token or Basic auth (for login).
 */
async function resolveAdminVenue(req) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
        const session = verifyAdminSession(auth.slice(7).trim());
        if (!session) return null;
        return getVenueById(session.venueId);
    }

    const creds = decodeBasicAuth(req);
    if (!creds || !creds.user) return null;
    return authenticateAdminUser(creds.user, creds.pass);
}

function clampFloorCount(value, min, max, fallback) {
    const n = parseInt(String(value), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

async function getFloorConfig(venueId) {
    const venue = await getVenueById(venueId);
    if (!venue) {
        throw Object.assign(new Error('Venue not found.'), { statusCode: 404 });
    }
    return {
        tableCount: venue.tableCount,
        parcelCount: venue.parcelCount,
        tableCategories: venue.tableCategories
    };
}

async function setFloorConfig(venueId, input) {
    const tableCount = clampFloorCount(
        input && input.tableCount,
        MIN_TABLE_COUNT,
        MAX_TABLE_COUNT,
        7
    );
    const parcelCount = clampFloorCount(
        input && input.parcelCount,
        MIN_PARCEL_COUNT,
        MAX_PARCEL_COUNT,
        5
    );

    let tableCategories = input && input.tableCategories ? input.tableCategories : null;
    if (tableCategories) {
        if (!Array.isArray(tableCategories)) tableCategories = null;
        else tableCategories = JSON.stringify(tableCategories);
    }

    const { rows } = await query(
        `UPDATE venues
         SET table_count = $2, parcel_count = $3, table_categories = $4
         WHERE id = $1
         RETURNING id, slug, name, city, address_line, contact_mobile, hours_text, table_count, parcel_count, walkin_mobile, is_default, admin_user, venue_type, payment_qr_code, table_categories`,
        [venueId, tableCount, parcelCount, tableCategories]
    );
    if (!rows[0]) {
        throw Object.assign(new Error('Venue not found.'), { statusCode: 404 });
    }
    const venue = normalizeVenueRow(rows[0]);
    return {
        tableCount: venue.tableCount,
        parcelCount: venue.parcelCount,
        tableCategories: venue.tableCategories
    };
}

async function assertValidFloorSlot(venueId, channel, slotNum) {
    const ch = String(channel || '').trim().toLowerCase();
    const n = parseInt(String(slotNum), 10);
    const cfg = await getFloorConfig(venueId);

    if (ch === 'dine_in') {
        if (!Number.isFinite(n) || n < MIN_TABLE_COUNT || n > cfg.tableCount) {
            throw Object.assign(
                new Error(`Table must be between ${MIN_TABLE_COUNT} and ${cfg.tableCount}.`),
                { statusCode: 400 }
            );
        }
        return;
    }
    if (ch === 'parcel') {
        if (!Number.isFinite(n) || n < MIN_PARCEL_COUNT || n > cfg.parcelCount) {
            throw Object.assign(
                new Error(`Parcel slot must be between ${MIN_PARCEL_COUNT} and ${cfg.parcelCount}.`),
                { statusCode: 400 }
            );
        }
        return;
    }
    throw Object.assign(new Error('Invalid channel.'), { statusCode: 400 });
}

function venuePublicPayload(venue) {
    if (!venue) return null;
    return {
        id: venue.id,
        slug: venue.slug,
        name: venue.name,
        city: venue.city,
        addressLine: venue.addressLine || '',
        contactMobile: venue.contactMobile || '',
        hoursText: venue.hoursText || '',
        venueType: venue.venueType || 'food',
        isMain: isMainVenue(venue)
    };
}

function venueAdminListPayload(venue) {
    if (!venue) return null;
    return {
        id: venue.id,
        slug: venue.slug,
        name: venue.name,
        city: venue.city,
        venueType: venue.venueType || 'food',
        isMain: isMainVenue(venue),
        adminUser: venue.adminUser || '',
        contactMobile: venue.contactMobile || '',
        hoursText: venue.hoursText || '',
        addressLine: venue.addressLine || '',
        tableCount: venue.tableCount,
        parcelCount: venue.parcelCount
    };
}

async function listVenuesForAdmin(actingVenue) {
    if (isMainVenue(actingVenue)) {
        const { rows } = await query(
            `SELECT id, slug, name, city, address_line, contact_mobile, hours_text, table_count, parcel_count, walkin_mobile, is_default, admin_user, venue_type, payment_qr_code, table_categories
             FROM venues
             ORDER BY is_default DESC, name ASC`
        );
        return rows.map(normalizeVenueRow).map(venueAdminListPayload);
    }
    return [venueAdminListPayload(actingVenue)];
}

async function createVenueByMain(actingVenue, input) {
    assertMainVenue(actingVenue);
    const src = input && typeof input === 'object' ? input : {};

    const name = trimText(src.name, 200);
    if (!name) {
        throw Object.assign(new Error('Hotel name is required.'), { statusCode: 400 });
    }

    const city = trimText(src.city, 200);
    const adminUser = trimText(src.adminUser || src.admin_user, 100);
    const adminPass = String(src.adminPass || src.admin_pass || '').trim();
    if (!adminUser || !adminPass) {
        throw Object.assign(new Error('Admin username and password are required.'), { statusCode: 400 });
    }
    if (adminPass.length < 4) {
        throw Object.assign(new Error('Admin password must be at least 4 characters.'), { statusCode: 400 });
    }

    let slug = normalizeSlug(src.slug);
    if (!slug) slug = slugFromName(name);
    if (slug.length < 2) {
        throw Object.assign(new Error('Slug must be at least 2 characters.'), { statusCode: 400 });
    }

    const tableCount = clampFloorCount(src.tableCount ?? src.table_count, MIN_TABLE_COUNT, MAX_TABLE_COUNT, 7);
    const parcelCount = clampFloorCount(
        src.parcelCount ?? src.parcel_count,
        MIN_PARCEL_COUNT,
        MAX_PARCEL_COUNT,
        5
    );
    const walkinMobile = trimText(src.walkinMobile || src.walkin_mobile || '8888888888', 15) || '8888888888';
    const contactMobile = trimText(src.contactMobile || src.contact_mobile || walkinMobile, 15);
    const hoursText = trimText(src.hoursText || src.hours_text || '1 PM – 10 PM', 120);
    const venueType =
        String(src.venueType || src.venue_type || 'food').trim().toLowerCase() === 'grocery'
            ? 'grocery'
            : 'food';

    const existingSlug = await getVenueBySlug(slug);
    if (existingSlug) {
        throw Object.assign(new Error('A hotel with this slug already exists.'), { statusCode: 409 });
    }

    const { rows: userRows } = await query(
        `SELECT id FROM venues WHERE admin_user = $1 LIMIT 1`,
        [adminUser]
    );
    if (userRows[0]) {
        throw Object.assign(new Error('That admin username is already in use.'), { statusCode: 409 });
    }

    const { rows } = await query(
        `INSERT INTO venues (slug, name, city, admin_user, admin_pass, table_count, parcel_count, walkin_mobile, contact_mobile, hours_text, venue_type, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE)
         RETURNING id, slug, name, city, address_line, contact_mobile, hours_text, table_count, parcel_count, walkin_mobile, is_default, admin_user, venue_type, payment_qr_code, table_categories`,
        [slug, name, city, adminUser, adminPass, tableCount, parcelCount, walkinMobile, contactMobile, hoursText, venueType]
    );

    const venue = normalizeVenueRow(rows[0]);
    await query(
        `INSERT INTO store_settings (id, venue_id, accepting_orders, closed_reason)
         VALUES ($1::smallint, $1::int, TRUE, '')
         ON CONFLICT (venue_id) DO NOTHING`,
        [venue.id]
    );

    return venueAdminListPayload(venue);
}

async function updateVenueAccessByMain(actingVenue, venueId, input) {
    assertMainVenue(actingVenue);
    const id = parseInt(String(venueId), 10);
    if (!Number.isFinite(id)) {
        throw Object.assign(new Error('Invalid hotel id.'), { statusCode: 400 });
    }

    const target = await getVenueById(id);
    if (!target) {
        throw Object.assign(new Error('Hotel not found.'), { statusCode: 404 });
    }
    if (isMainVenue(target)) {
        throw Object.assign(new Error('The main venue cannot be edited here.'), { statusCode: 400 });
    }

    const src = input && typeof input === 'object' ? input : {};
    const name = src.name != null ? trimText(src.name, 200) : target.name;
    const city = src.city != null ? trimText(src.city, 200) : target.city;
    const adminUser =
        src.adminUser != null || src.admin_user != null
            ? trimText(src.adminUser || src.admin_user, 100)
            : target.adminUser;
    const adminPassRaw = src.adminPass ?? src.admin_pass;
    const adminPass = adminPassRaw != null ? String(adminPassRaw).trim() : null;

    if (!name) {
        throw Object.assign(new Error('Hotel name is required.'), { statusCode: 400 });
    }
    if (!adminUser) {
        throw Object.assign(new Error('Admin username is required.'), { statusCode: 400 });
    }
    if (adminPass != null && adminPass.length > 0 && adminPass.length < 4) {
        throw Object.assign(new Error('Admin password must be at least 4 characters.'), { statusCode: 400 });
    }

    const { rows: userRows } = await query(
        `SELECT id FROM venues WHERE admin_user = $1 AND id <> $2 LIMIT 1`,
        [adminUser, id]
    );
    if (userRows[0]) {
        throw Object.assign(new Error('That admin username is already in use.'), { statusCode: 409 });
    }

    const tableCount =
        src.tableCount != null || src.table_count != null
            ? clampFloorCount(src.tableCount ?? src.table_count, MIN_TABLE_COUNT, MAX_TABLE_COUNT, target.tableCount)
            : target.tableCount;
    const parcelCount =
        src.parcelCount != null || src.parcel_count != null
            ? clampFloorCount(
                  src.parcelCount ?? src.parcel_count,
                  MIN_PARCEL_COUNT,
                  MAX_PARCEL_COUNT,
                  target.parcelCount
              )
            : target.parcelCount;
    const contactMobile =
        src.contactMobile != null || src.contact_mobile != null
            ? trimText(src.contactMobile || src.contact_mobile, 15)
            : target.contactMobile;
    const hoursText =
        src.hoursText != null || src.hours_text != null
            ? trimText(src.hoursText || src.hours_text, 120)
            : target.hoursText;
    const addressLine =
        src.addressLine != null || src.address_line != null
            ? trimText(src.addressLine || src.address_line, 300)
            : target.addressLine;
    const venueType =
        src.venueType != null || src.venue_type != null
            ? String(src.venueType || src.venue_type).trim().toLowerCase() === 'grocery'
                ? 'grocery'
                : 'food'
            : target.venueType;

    let rows;
    if (adminPass != null && adminPass.length > 0) {
        ({ rows } = await query(
            `UPDATE venues
             SET name = $1, city = $2, admin_user = $3, admin_pass = $4, table_count = $5, parcel_count = $6,
                 contact_mobile = $7, hours_text = $8, address_line = $9, venue_type = $10
             WHERE id = $11
             RETURNING id, slug, name, city, address_line, contact_mobile, hours_text, table_count, parcel_count, walkin_mobile, is_default, admin_user, venue_type, payment_qr_code, table_categories`,
            [name, city, adminUser, adminPass, tableCount, parcelCount, contactMobile, hoursText, addressLine, venueType, id]
        ));
    } else {
        ({ rows } = await query(
            `UPDATE venues
             SET name = $1, city = $2, admin_user = $3, table_count = $4, parcel_count = $5,
                 contact_mobile = $6, hours_text = $7, address_line = $8, venue_type = $9
             WHERE id = $10
             RETURNING id, slug, name, city, address_line, contact_mobile, hours_text, table_count, parcel_count, walkin_mobile, is_default, admin_user, venue_type, payment_qr_code, table_categories`,
            [name, city, adminUser, tableCount, parcelCount, contactMobile, hoursText, addressLine, venueType, id]
        ));
    }

    return venueAdminListPayload(normalizeVenueRow(rows[0]));
}

async function updateVenueProfile(actingVenue, input) {
    const src = input && typeof input === 'object' ? input : {};
    const contactMobile =
        src.contactMobile != null || src.contact_mobile != null
            ? trimText(src.contactMobile || src.contact_mobile, 15)
            : actingVenue.contactMobile;
    const hoursText =
        src.hoursText != null || src.hours_text != null
            ? trimText(src.hoursText || src.hours_text, 120)
            : actingVenue.hoursText;
    const addressLine =
        src.addressLine != null || src.address_line != null
            ? trimText(src.addressLine || src.address_line, 300)
            : actingVenue.addressLine;
    const paymentQrCode =
        src.paymentQrCode !== undefined
            ? src.paymentQrCode
            : actingVenue.paymentQrCode || '';

    const { rows } = await query(
        `UPDATE venues
         SET contact_mobile = $2, hours_text = $3, address_line = $4, payment_qr_code = $5
         WHERE id = $1
         RETURNING id, slug, name, city, address_line, contact_mobile, hours_text, table_count, parcel_count, walkin_mobile, is_default, admin_user, venue_type, payment_qr_code, table_categories`,
        [actingVenue.id, contactMobile, hoursText, addressLine, paymentQrCode]
    );

    return venuePublicPayload(normalizeVenueRow(rows[0]));
}

async function deleteVenueByMain(actingVenue, venueId) {
    assertMainVenue(actingVenue);
    const id = parseInt(String(venueId), 10);
    if (!Number.isFinite(id)) {
        throw Object.assign(new Error('Invalid venue id.'), { statusCode: 400 });
    }

    const target = await getVenueById(id);
    if (!target) {
        throw Object.assign(new Error('Venue not found.'), { statusCode: 404 });
    }
    if (isMainVenue(target)) {
        throw Object.assign(new Error('The main venue cannot be deleted.'), { statusCode: 400 });
    }

    // Explicitly delete references from tables that might not have ON DELETE CASCADE
    await query(`DELETE FROM orders WHERE venue_id = $1`, [id]);
    await query(`DELETE FROM store_settings WHERE venue_id = $1`, [id]);
    await query(`DELETE FROM delivery_zones WHERE venue_id = $1`, [id]);
    await query(`DELETE FROM venues WHERE id = $1`, [id]);

    return { ok: true, deletedVenueId: id };
}

module.exports = {
    DEFAULT_VENUE_SLUG,
    MIN_TABLE_COUNT,
    MAX_TABLE_COUNT,
    MIN_PARCEL_COUNT,
    MAX_PARCEL_COUNT,
    getDefaultVenue,
    getVenueById,
    getVenueBySlug,
    resolvePublicVenue,
    authenticateAdminUser,
    resolveAdminVenue,
    getFloorConfig,
    setFloorConfig,
    assertValidFloorSlot,
    venuePublicPayload,
    venueAdminListPayload,
    isMainVenue,
    listVenuesForAdmin,
    createVenueByMain,
    updateVenueAccessByMain,
    deleteVenueByMain,
    updateVenueProfile
};
