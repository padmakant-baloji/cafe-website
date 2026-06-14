'use strict';

const { query } = require('./db');

/**
 * List all delivery zones for a venue.
 * Pass venueId = null to get the main-venue (Baloji) zones.
 */
async function listDeliveryZones(venueId) {
    const vid = venueId != null ? venueId : null;
    const { rows } = await query(
        `SELECT id, venue_id, city, min_order, delivery_fee, free_delivery_above, enabled
         FROM delivery_zones
         WHERE venue_id IS NOT DISTINCT FROM $1
         ORDER BY city ASC`,
        [vid]
    );
    return rows;
}

/**
 * Get the delivery zone that matches a city for a given venue.
 * Falls back to the '_default' row if no exact match.
 * Returns null if nothing matches at all.
 */
async function getDeliveryZoneForCity(venueId, cityName) {
    const vid = venueId != null ? venueId : null;
    const cityLower = String(cityName || '').trim().toLowerCase();

    const { rows } = await query(
        `SELECT id, venue_id, city, min_order, delivery_fee, free_delivery_above, enabled
         FROM delivery_zones
         WHERE venue_id IS NOT DISTINCT FROM $1
           AND enabled = TRUE
           AND (city = $2 OR city = '_default')
         ORDER BY
           CASE WHEN city = $2 THEN 0 ELSE 1 END
         LIMIT 1`,
        [vid, cityLower]
    );
    return rows[0] || null;
}

/**
 * Calculate delivery config for a city + subtotal.
 * Returns { deliveryFee, minOrder, allowed, zoneName }.
 */
async function getDeliveryConfig(venueId, cityName, subtotal) {
    const zone = await getDeliveryZoneForCity(venueId, cityName);
    if (!zone) {
        // No zone configured at all — allow order, no fee
        return { deliveryFee: 0, minOrder: 0, allowed: true, zoneName: '' };
    }

    const minOrder = Number(zone.min_order) || 0;
    const baseFee = Number(zone.delivery_fee) || 0;
    const freeAbove = zone.free_delivery_above != null ? Number(zone.free_delivery_above) : null;

    let deliveryFee = baseFee;
    if (freeAbove != null && subtotal >= freeAbove) {
        deliveryFee = 0;
    }

    const allowed = subtotal >= minOrder || subtotal === 0;

    return {
        deliveryFee,
        minOrder,
        allowed,
        zoneName: zone.city || ''
    };
}

/**
 * Get all zones for a venue, formatted for the customer-facing API.
 * Returns an array the client can use to replicate the fee calculation.
 */
async function getDeliveryZonesForClient(venueId) {
    const vid = venueId != null ? venueId : null;
    const { rows } = await query(
        `SELECT city, min_order, delivery_fee, free_delivery_above
         FROM delivery_zones
         WHERE venue_id IS NOT DISTINCT FROM $1
           AND enabled = TRUE
         ORDER BY city ASC`,
        [vid]
    );
    return rows.map((r) => ({
        city: r.city,
        minOrder: Number(r.min_order) || 0,
        deliveryFee: Number(r.delivery_fee) || 0,
        freeDeliveryAbove: r.free_delivery_above != null ? Number(r.free_delivery_above) : null
    }));
}

/**
 * Create or update a delivery zone.
 */
async function upsertDeliveryZone(venueId, zone) {
    const vid = venueId != null ? venueId : null;
    const city = String(zone.city || '').trim().toLowerCase();
    if (!city) {
        throw Object.assign(new Error('City name is required.'), { statusCode: 400 });
    }

    const deliveryFee = parseInt(String(zone.deliveryFee ?? zone.delivery_fee ?? 0), 10);
    const minOrder = parseInt(String(zone.minOrder ?? zone.min_order ?? 0), 10);
    const freeAbove = zone.freeDeliveryAbove ?? zone.free_delivery_above;
    const freeDeliveryAbove = freeAbove != null && freeAbove !== '' ? parseInt(String(freeAbove), 10) : null;
    const enabled = zone.enabled !== false;

    if (zone.id) {
        // Update existing
        const { rows } = await query(
            `UPDATE delivery_zones
             SET city = $2, min_order = $3, delivery_fee = $4, free_delivery_above = $5, enabled = $6
             WHERE id = $1
             RETURNING *`,
            [zone.id, city, minOrder, deliveryFee, freeDeliveryAbove, enabled]
        );
        if (!rows.length) {
            throw Object.assign(new Error('Zone not found.'), { statusCode: 404 });
        }
        return rows[0];
    }

    // Insert — upsert on (venue_id, city)
    const { rows } = await query(
        `INSERT INTO delivery_zones (venue_id, city, min_order, delivery_fee, free_delivery_above, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (venue_id, city)
           WHERE venue_id IS NOT NULL
         DO UPDATE SET min_order = EXCLUDED.min_order,
                       delivery_fee = EXCLUDED.delivery_fee,
                       free_delivery_above = EXCLUDED.free_delivery_above,
                       enabled = EXCLUDED.enabled
         RETURNING *`,
        [vid, city, minOrder, deliveryFee, freeDeliveryAbove, enabled]
    );

    // Handle NULL venue_id conflict separately (partial unique index doesn't cover IS NOT DISTINCT FROM)
    if (!rows.length && vid == null) {
        const existing = await query(
            `SELECT id FROM delivery_zones WHERE venue_id IS NULL AND city = $1`,
            [city]
        );
        if (existing.rows.length) {
            const { rows: updated } = await query(
                `UPDATE delivery_zones
                 SET min_order = $2, delivery_fee = $3, free_delivery_above = $4, enabled = $5
                 WHERE venue_id IS NULL AND city = $1
                 RETURNING *`,
                [city, minOrder, deliveryFee, freeDeliveryAbove, enabled]
            );
            return updated[0];
        }
        // If still nothing, do a plain insert
        const { rows: inserted } = await query(
            `INSERT INTO delivery_zones (venue_id, city, min_order, delivery_fee, free_delivery_above, enabled)
             VALUES (NULL, $1, $2, $3, $4, $5)
             RETURNING *`,
            [city, minOrder, deliveryFee, freeDeliveryAbove, enabled]
        );
        return inserted[0];
    }

    return rows[0];
}

/**
 * Delete a delivery zone by id.
 */
async function deleteDeliveryZone(id) {
    const { rowCount } = await query(`DELETE FROM delivery_zones WHERE id = $1`, [id]);
    if (!rowCount) {
        throw Object.assign(new Error('Zone not found.'), { statusCode: 404 });
    }
    return { deleted: true };
}

module.exports = {
    listDeliveryZones,
    getDeliveryZoneForCity,
    getDeliveryConfig,
    getDeliveryZonesForClient,
    upsertDeliveryZone,
    deleteDeliveryZone
};
