'use strict';

const fs = require('fs');
const path = require('path');
const { query } = require('./db');
const { getDefaultVenue, getVenueById, isMainVenue } = require('./venue-service');
const { validateCoupon } = require('./coupon-service');
const { getStoreStatus } = require('./store-status');
const { isWithinVenueHours } = require('./venue-hours');
const { getDeliveryConfig, getDeliveryZonesForClient, getAllDeliveryZonesForClient } = require('./delivery-zone-service');

const PARTNER_ONLINE_MARKUP_RS = 8;
const PARTNER_DELIVERY_FEE_RS = 20;

let balojiMenuCache = null;

function loadBalojiMenuJson() {
    if (balojiMenuCache) return balojiMenuCache;
    const filePath = path.join(__dirname, '..', 'menu.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    balojiMenuCache = JSON.parse(raw);
    return balojiMenuCache;
}

function clearBalojiMenuCache() {
    balojiMenuCache = null;
}

function itemIsListed(item) {
    return item && item.enabled !== false;
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function isDrinksCategory(category) {
    const id = String(category?.sourceCategoryId || category?.id || '')
        .trim()
        .toLowerCase();
    const name = String(category?.name || '').trim().toLowerCase();
    const text = `${id} ${name}`;

    if (/\bdrinks?\b/.test(text)) return true;
    if (/\bbeverages?\b/.test(text)) return true;
    if (text.includes('coffee-tea') || text.includes('coffee & tea')) return true;
    if (text.includes('cold-drink') || text.includes('cold drink')) return true;
    if (text.includes('masala-cold')) return true;
    return false;
}

function markupForCategory(category, defaultMarkup) {
    const base = parseInt(String(defaultMarkup), 10) || 0;
    return isDrinksCategory(category) ? 0 : base;
}

function scopedPartnerId(venue, rawId) {
    const slug = String(venue.slug || 'hotel')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/gi, '-')
        .replace(/^-+|-+$/g, '');
    const base = String(rawId || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/gi, '-')
        .replace(/^-+|-+$/g, '');
    if (!base) return slug;
    return base.startsWith(`${slug}-`) ? base : `${slug}-${base}`;
}

function annotateItemForCustomer(item, venue, options = {}) {
    const markup = options.markup || 0;
    if (options.preserveSource) {
        return {
            ...item,
            venueId: venue.id,
            venueName: venue.name,
            isMainVenue: Boolean(venue.isDefault)
        };
    }

    const next = {
        ...item,
        id: scopedPartnerId(venue, item.id || item.name),
        sourceItemId: item.id || item.name,
        venueId: venue.id,
        venueSlug: venue.slug,
        venueName: venue.name,
        isMainVenue: Boolean(venue.isDefault)
    };

    if (Array.isArray(item.sizes) && item.sizes.length) {
        next.sizes = item.sizes.map((size) => {
            const basePrice = parseInt(String(size.price), 10) || 0;
            const customerPrice = basePrice + markup;
            return {
                ...size,
                basePrice,
                price: customerPrice,
                customerPrice
            };
        });
        const minCustomerPrice = Math.min(...next.sizes.map((size) => size.customerPrice));
        next.basePrice = Math.min(...next.sizes.map((size) => size.basePrice));
        next.price = minCustomerPrice;
        next.customerPrice = minCustomerPrice;
        return next;
    }

    const basePrice = parseInt(String(item.price), 10) || 0;
    const customerPrice = basePrice + markup;
    next.basePrice = basePrice;
    next.price = customerPrice;
    next.customerPrice = customerPrice;
    return next;
}

function annotateCategoryTree(categories, venue, options = {}) {
    const preserveSource = Boolean(options.preserveSource);
    const out = [];
    for (const cat of categories || []) {
        const next = preserveSource
            ? {
                  ...cat,
                  venueId: venue.id,
                  venueName: venue.name,
                  isMainVenue: Boolean(venue.isDefault)
              }
            : {
                  ...cat,
                  id: `${venue.slug}-${cat.id || cat.name}`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase(),
                  sourceCategoryId: cat.id || cat.name,
                  venueId: venue.id,
                  venueSlug: venue.slug,
                  venueName: venue.name,
                  isMainVenue: Boolean(venue.isDefault)
              };
        if (Array.isArray(cat.subsections) && cat.subsections.length) {
            next.subsections = cat.subsections.map((sub) => {
                const itemOptions = { ...options, markup: markupForCategory(sub, options.markup || 0) };
                return {
                    ...sub,
                    items: (sub.items || [])
                        .filter(itemIsListed)
                        .map((item) => annotateItemForCustomer(item, venue, itemOptions))
                };
            });
        } else {
            const itemOptions = { ...options, markup: markupForCategory(cat, options.markup || 0) };
            next.items = (cat.items || [])
                .filter(itemIsListed)
                .map((item) => annotateItemForCustomer(item, venue, itemOptions));
        }
        const hasItems =
            (next.items && next.items.length) ||
            (next.subsections && next.subsections.some((s) => (s.items || []).length));
        if (hasItems) out.push(next);
    }
    return out;
}

async function getAggregatedCustomerMenu() {
    const mainVenue = await getDefaultVenue();
    if (!mainVenue) {
        throw Object.assign(new Error('Main venue is not configured.'), { statusCode: 503 });
    }

    const balojiMenu = loadBalojiMenuJson();
    const categories = annotateCategoryTree(balojiMenu.categories || [], mainVenue, {
        markup: 0,
        preserveSource: true
    });

    const mainStatus = await getStoreStatus(mainVenue.id);
    const venues = [
        {
            id: mainVenue.id,
            slug: mainVenue.slug,
            name: mainVenue.name,
            city: mainVenue.city || '',
            contactMobile: mainVenue.contactMobile || '',
            hoursText: mainVenue.hoursText || '',
            isMain: true,
            acceptingOrders: mainStatus.acceptingOrders && isWithinVenueHours(mainVenue.hoursText)
        }
    ];

    const { rows } = await query(
        `SELECT v.id, v.slug, v.name, v.city, v.contact_mobile, v.hours_text, v.menu_catalog,
                COALESCE(ss.accepting_orders, TRUE) AS accepting_orders
         FROM venues v
         LEFT JOIN store_settings ss ON ss.venue_id = v.id
         WHERE v.is_default = FALSE
           AND COALESCE(v.venue_type, 'food') <> 'grocery'
         ORDER BY v.name ASC`
    );

    for (const row of rows) {
        if (!row.menu_catalog) continue;
        let catalog = row.menu_catalog;
        if (typeof catalog === 'string') {
            try {
                catalog = JSON.parse(catalog);
            } catch {
                continue;
            }
        }
        const venue = {
            id: row.id,
            slug: row.slug,
            name: row.name,
            city: row.city,
            isDefault: false
        };
        venues.push({
            id: venue.id,
            slug: venue.slug,
            name: venue.name,
            city: venue.city || '',
            contactMobile: row.contact_mobile || '',
            hoursText: row.hours_text || '',
            isMain: false,
            acceptingOrders: Boolean(row.accepting_orders) && isWithinVenueHours(row.hours_text)
        });
        categories.push(
            ...annotateCategoryTree(catalog.categories || catalog || [], venue, {
                markup: PARTNER_ONLINE_MARKUP_RS
            })
        );
    }

    // Fetch delivery zones for all venues
    const deliveryZonesMap = await getAllDeliveryZonesForClient();

    return {
        defaultVenueId: mainVenue.id,
        defaultVenueSlug: mainVenue.slug,
        defaultVenueName: mainVenue.name,
        partnerMarkup: PARTNER_ONLINE_MARKUP_RS,
        partnerDeliveryFee: PARTNER_DELIVERY_FEE_RS,
        deliveryZonesMap,
        venues,
        categories
    };
}

async function getAdminMenuForVenue(actingVenue, targetVenueId = null) {
    let venue = actingVenue;
    if (targetVenueId != null && isMainVenue(actingVenue)) {
        venue = await getVenueById(targetVenueId);
        if (!venue) {
            throw Object.assign(new Error('Hotel not found.'), { statusCode: 404 });
        }
    }

    if (isMainVenue(venue)) {
        const balojiMenu = loadBalojiMenuJson();
        return {
            venue: { id: venue.id, slug: venue.slug, name: venue.name, isMain: true },
            source: 'menu.json',
            editable: false,
            categories: balojiMenu.categories || []
        };
    }

    const { rows } = await query(`SELECT menu_catalog FROM venues WHERE id = $1 LIMIT 1`, [venue.id]);
    let catalog = rows[0] && rows[0].menu_catalog ? rows[0].menu_catalog : { categories: [] };
    if (typeof catalog === 'string') {
        try {
            catalog = JSON.parse(catalog);
        } catch {
            catalog = { categories: [] };
        }
    }

    return {
        venue: { id: venue.id, slug: venue.slug, name: venue.name, isMain: false },
        source: 'database',
        editable: true,
        categories: catalog.categories || []
    };
}

async function saveAdminMenuForVenue(actingVenue, targetVenueId, body) {
    let venue = actingVenue;
    if (targetVenueId != null && isMainVenue(actingVenue)) {
        venue = await getVenueById(targetVenueId);
        if (!venue) {
            throw Object.assign(new Error('Hotel not found.'), { statusCode: 404 });
        }
    }

    if (isMainVenue(venue)) {
        throw Object.assign(new Error('Baloji Cafe menu is managed in menu.json.'), { statusCode: 400 });
    }

    const categories = body && Array.isArray(body.categories) ? body.categories : null;
    if (!categories) {
        throw Object.assign(new Error('Send { categories: [...] } to save the menu.'), { statusCode: 400 });
    }

    await query(`UPDATE venues SET menu_catalog = $2::jsonb WHERE id = $1`, [
        venue.id,
        JSON.stringify({ categories })
    ]);

    return getAdminMenuForVenue(actingVenue, venue.id);
}

function flattenMenuItems(menuPayload) {
    const map = new Map();
    for (const cat of menuPayload.categories || []) {
        const pushItem = (item) => {
            if (!item || !itemIsListed(item)) return;
            const itemId = item.id || item.name;
            const basePrice = parseInt(String(item.customerPrice ?? item.price), 10);
            if (Number.isFinite(basePrice)) {
                map.set(`${item.venueId}:${itemId}:${basePrice}`, item);
                map.set(`${item.venueId}:${item.name}:${basePrice}`, item);
            }

            for (const size of item.sizes || []) {
                const sizePrice = parseInt(String(size.customerPrice ?? size.price), 10);
                const sizeLabel = String(size.label || '').trim();
                if (!Number.isFinite(sizePrice) || !sizeLabel) continue;
                const sizeName = `${String(item.name || '').trim()} (${sizeLabel})`;
                const sizedItem = {
                    ...item,
                    name: sizeName,
                    price: sizePrice,
                    customerPrice: sizePrice,
                    sizeLabel
                };
                map.set(`${item.venueId}:${itemId}:${sizePrice}`, sizedItem);
                map.set(`${item.venueId}:${sizeName}:${sizePrice}`, sizedItem);
            }
        };
        if (Array.isArray(cat.subsections)) {
            for (const sub of cat.subsections) {
                for (const item of sub.items || []) pushItem(item);
            }
        }
        for (const item of cat.items || []) pushItem(item);
    }
    return map;
}

function findCatalogItem(catalogMap, row) {
    const venueId = parseInt(String(row.venueId), 10);
    const price = parseInt(String(row.price), 10);
    const name = String(row.name || '').trim();
    if (!name || !Number.isFinite(venueId) || !Number.isFinite(price)) return null;

    if (row.itemId) {
        const byId = catalogMap.get(`${venueId}:${row.itemId}:${price}`);
        if (byId) return byId;
    }
    return catalogMap.get(`${venueId}:${name}:${price}`) || null;
}

async function validateAndPriceCustomerOrder(body, customerCity) {
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
        throw Object.assign(new Error('Invalid cart.'), { statusCode: 400 });
    }

    const menuPayload = await getAggregatedCustomerMenu();
    const catalogMap = flattenMenuItems(menuPayload);

    const orderVenueId = parseInt(String(body.orderVenueId || items[0].venueId), 10);
    if (!Number.isFinite(orderVenueId)) {
        throw Object.assign(new Error('Missing order hotel.'), { statusCode: 400 });
    }

    const normalizedItems = [];
    let subtotal = 0;

    for (const row of items) {
        const venueId = parseInt(String(row.venueId), 10);
        if (venueId !== orderVenueId) {
            throw Object.assign(new Error('All items must be from the same hotel.'), { statusCode: 400 });
        }

        const catalogItem = findCatalogItem(catalogMap, row);
        if (!catalogItem) {
            throw Object.assign(new Error(`Item not available: ${String(row.name || '').trim()}`), {
                statusCode: 400
            });
        }

        const originalPrice = parseInt(String(catalogItem.customerPrice ?? catalogItem.price), 10);
        // Apply global 20% discount
        const DISCOUNT_PERCENT = 20;
        const price = Math.round(originalPrice * (1 - DISCOUNT_PERCENT / 100));
        
        const quantity = parseInt(String(row.quantity), 10);
        const name = String(catalogItem.name || row.name || '').trim().slice(0, 200);
        if (!name || !Number.isFinite(price) || price < 0 || !Number.isFinite(quantity) || quantity < 1 || quantity > 99) {
            throw Object.assign(new Error('Invalid order line.'), { statusCode: 400 });
        }

        subtotal += price * quantity;
        normalizedItems.push({
            name,
            price,
            quantity,
            venueId,
            itemId: catalogItem.id || null,
            venueName: catalogItem.venueName || ''
        });
    }

    const mainVenue = await getDefaultVenue();
    const isPartnerOrder = mainVenue && orderVenueId !== mainVenue.id;
    const cityLower = String(customerCity || '').trim().toLowerCase();

    // Flat ₹8 delivery fee
    let deliveryFee = subtotal > 0 ? 8 : 0;

    if (!isPartnerOrder && cityLower && deliveryConfig && deliveryConfig.minOrder > 0 && subtotal > 0 && subtotal < deliveryConfig.minOrder) {
        throw Object.assign(
            new Error(`Minimum order for delivery outside Kudachi is ₹${deliveryConfig.minOrder}.`),
            { statusCode: 400 }
        );
    }

    if (isPartnerOrder && subtotal <= 0) {
        throw Object.assign(new Error('Invalid cart.'), { statusCode: 400 });
    }

    let discount = 0;
    let normalizedCouponCode = '';
    const couponCode = typeof body.couponCode === 'string' ? body.couponCode : '';
    if (couponCode && couponCode.trim()) {
        const result = await validateCoupon(couponCode, subtotal);
        if (result.ok) {
            discount = result.discount;
            normalizedCouponCode = result.code;
        } else {
            throw Object.assign(new Error(result.message || 'Invalid coupon.'), { statusCode: 400 });
        }
    }

    const total = Math.max(0, subtotal - discount) + deliveryFee;
    const clientTotal =
        typeof body.total === 'number' && !Number.isNaN(body.total)
            ? body.total
            : parseInt(String(body.total), 10);

    if (Number.isNaN(clientTotal) || clientTotal !== total) {
        throw Object.assign(new Error(`Total mismatch. Expected ₹${total}.`), { statusCode: 400 });
    }

    return {
        normalizedItems,
        subtotal,
        deliveryFee,
        discount,
        couponCode: normalizedCouponCode,
        total,
        orderVenueId,
        isPartnerOrder
    };
}

module.exports = {
    PARTNER_ONLINE_MARKUP_RS,
    PARTNER_DELIVERY_FEE_RS,
    loadBalojiMenuJson,
    clearBalojiMenuCache,
    getAggregatedCustomerMenu,
    getAdminMenuForVenue,
    saveAdminMenuForVenue,
    validateAndPriceCustomerOrder
};
