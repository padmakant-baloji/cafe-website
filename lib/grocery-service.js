'use strict';

const { query } = require('./db');
const { getVenueById, isMainVenue } = require('./venue-service');
const { validateCoupon } = require('./coupon-service');
const { getStoreStatus } = require('./store-status');
const { isWithinVenueHours } = require('./venue-hours');

const GROCERY_DELIVERY_FEE_RS = 25;
const GROCERY_FREE_DELIVERY_OVER_RS = 199;
const GROCERY_MIN_ORDER_RS = 49;

const VALID_UNITS = ['pcs', 'pack', 'kg', 'g', 'l', 'ml', 'dozen', 'bundle'];
const DEFAULT_PLACEHOLDER_IMAGE = 'images/placeholder-icon.svg';

function trimText(value, max) {
    return String(value == null ? '' : value)
        .trim()
        .slice(0, max);
}

function toInt(value, fallback = 0) {
    const n = parseInt(String(value), 10);
    return Number.isFinite(n) ? n : fallback;
}

function toUnit(value) {
    const u = String(value || '').trim().toLowerCase();
    return VALID_UNITS.includes(u) ? u : 'pcs';
}

function slugify(raw, fallback = 'aisle') {
    const base = String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
    return base || fallback;
}

function normalizeCategoryRow(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        venueId: Number(row.venue_id),
        name: row.name,
        slug: row.slug,
        image: row.image || '',
        sortOrder: Number(row.sort_order) || 0,
        enabled: row.enabled !== false
    };
}

function normalizeProductRow(row) {
    if (!row) return null;
    const stockQty = toInt(row.stock_qty, 0);
    const lowThreshold = toInt(row.low_stock_threshold, 5);
    const enabled = row.enabled !== false;
    return {
        id: Number(row.id),
        venueId: Number(row.venue_id),
        categoryId: row.category_id == null ? null : Number(row.category_id),
        name: row.name,
        sku: row.sku || '',
        unit: row.unit || 'pcs',
        unitValue: row.unit_value == null ? 1 : Number(row.unit_value),
        image: row.image || '',
        mrp: toInt(row.mrp, 0),
        price: toInt(row.price, 0),
        sgstPercent: toInt(row.sgst_percent, 0),
        cgstPercent: toInt(row.cgst_percent, 0),
        igstPercent: toInt(row.igst_percent, 0),
        stockQty,
        lowStockThreshold: lowThreshold,
        enabled,
        lowStock: enabled && stockQty > 0 && stockQty <= lowThreshold,
        outOfStock: !enabled || stockQty <= 0,
        categoryName: row.category_name || ''
    };
}

/**
 * Resolve which grocery venue an admin may act on.
 * Main venue admin can target any grocery venue via targetVenueId.
 * A grocery-partner admin can only act on itself.
 */
async function resolveGroceryAdminVenue(actingVenue, targetVenueId = null) {
    if (!actingVenue) {
        throw Object.assign(new Error('Authentication required.'), { statusCode: 401 });
    }

    if (isMainVenue(actingVenue)) {
        if (targetVenueId == null || String(targetVenueId).trim() === '') {
            throw Object.assign(new Error('Select a grocery store (venueId) to manage.'), {
                statusCode: 400
            });
        }
        const venue = await getVenueById(targetVenueId);
        if (!venue) {
            throw Object.assign(new Error('Grocery store not found.'), { statusCode: 404 });
        }
        if (venue.venueType !== 'grocery') {
            throw Object.assign(new Error('That store is not a grocery store.'), { statusCode: 400 });
        }
        return venue;
    }

    if (actingVenue.venueType !== 'grocery') {
        throw Object.assign(new Error('This store is not a grocery store.'), { statusCode: 403 });
    }
    if (targetVenueId != null && Number(targetVenueId) !== Number(actingVenue.id)) {
        throw Object.assign(new Error('You can only manage your own store.'), { statusCode: 403 });
    }
    return actingVenue;
}

// ---------- Customer storefront ----------

async function getGroceryStorefront() {
    const { rows: venueRows } = await query(
        `SELECT v.id, v.slug, v.name, v.city, v.contact_mobile, v.hours_text,
                COALESCE(ss.accepting_orders, TRUE) AS accepting_orders
         FROM venues v
         LEFT JOIN store_settings ss ON ss.venue_id = v.id
         WHERE COALESCE(v.venue_type, 'food') = 'grocery'
         ORDER BY v.is_default DESC, v.name ASC`
    );

    if (!venueRows.length) {
        return { stores: [], categories: [], deliveryFee: GROCERY_DELIVERY_FEE_RS, freeDeliveryOver: GROCERY_FREE_DELIVERY_OVER_RS, minOrder: GROCERY_MIN_ORDER_RS };
    }

    const venueIds = venueRows.map((r) => Number(r.id));

    const { rows: catRows } = await query(
        `SELECT id, venue_id, name, slug, image, sort_order, enabled
         FROM grocery_categories
         WHERE venue_id = ANY($1::int[]) AND enabled = TRUE
         ORDER BY sort_order ASC, name ASC`,
        [venueIds]
    );

    const { rows: prodRows } = await query(
        `SELECT id, venue_id, category_id, name, sku, unit, unit_value, image, mrp, price, sgst_percent, cgst_percent, igst_percent,
                stock_qty, low_stock_threshold, enabled
         FROM grocery_products
         WHERE venue_id = ANY($1::int[]) AND enabled = TRUE
         ORDER BY name ASC`,
        [venueIds]
    );

    const stores = venueRows.map((row) => ({
        id: Number(row.id),
        slug: row.slug,
        name: row.name,
        city: row.city || '',
        contactMobile: row.contact_mobile || '',
        hoursText: row.hours_text || '',
        acceptingOrders: Boolean(row.accepting_orders) && isWithinVenueHours(row.hours_text)
    }));

    const categories = catRows.map(normalizeCategoryRow);
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    for (const cat of categories) cat.products = [];

    // Per-venue bucket for products with no category.
    const uncategorized = new Map();
    for (const row of prodRows) {
        const product = normalizeProductRow(row);
        const cat = product.categoryId != null ? categoryById.get(product.categoryId) : null;
        if (cat) {
            cat.products.push(product);
        } else {
            if (!uncategorized.has(product.venueId)) {
                const store = stores.find((s) => s.id === product.venueId);
                const bucket = {
                    id: `uncat-${product.venueId}`,
                    venueId: product.venueId,
                    name: 'More items',
                    slug: 'more-items',
                    image: '',
                    sortOrder: 9999,
                    enabled: true,
                    products: []
                };
                uncategorized.set(product.venueId, bucket);
                categories.push(bucket);
                void store;
            }
            uncategorized.get(product.venueId).products.push(product);
        }
    }

    const populated = categories.filter((c) => c.products && c.products.length);

    return {
        stores,
        categories: populated,
        deliveryFee: GROCERY_DELIVERY_FEE_RS,
        freeDeliveryOver: GROCERY_FREE_DELIVERY_OVER_RS,
        minOrder: GROCERY_MIN_ORDER_RS
    };
}

// ---------- Admin: categories ----------

async function listGroceryCategoriesForAdmin(actingVenue, targetVenueId = null) {
    const venue = await resolveGroceryAdminVenue(actingVenue, targetVenueId);
    const { rows } = await query(
        `SELECT id, venue_id, name, slug, image, sort_order, enabled
         FROM grocery_categories
         WHERE venue_id = $1
         ORDER BY sort_order ASC, name ASC`,
        [venue.id]
    );
    return { venue: { id: venue.id, slug: venue.slug, name: venue.name }, categories: rows.map(normalizeCategoryRow) };
}

async function upsertGroceryCategory(actingVenue, targetVenueId, input) {
    const venue = await resolveGroceryAdminVenue(actingVenue, targetVenueId);
    const src = input && typeof input === 'object' ? input : {};
    const name = trimText(src.name, 120);
    if (!name) {
        throw Object.assign(new Error('Category name is required.'), { statusCode: 400 });
    }
    const slug = slugify(src.slug || name);
    const image = trimText(src.image, 400);
    const sortOrder = toInt(src.sortOrder ?? src.sort_order, 0);
    const enabled = src.enabled === false ? false : true;
    const id = src.id != null ? toInt(src.id, 0) : 0;

    if (id) {
        const { rows } = await query(
            `UPDATE grocery_categories
             SET name = $2, slug = $3, image = $4, sort_order = $5, enabled = $6, updated_at = NOW()
             WHERE id = $1 AND venue_id = $7
             RETURNING id, venue_id, name, slug, image, sort_order, enabled`,
            [id, name, slug, image, sortOrder, enabled, venue.id]
        );
        if (!rows[0]) throw Object.assign(new Error('Category not found.'), { statusCode: 404 });
        return normalizeCategoryRow(rows[0]);
    }

    const { rows } = await query(
        `INSERT INTO grocery_categories (venue_id, name, slug, image, sort_order, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (venue_id, slug) DO UPDATE
         SET name = EXCLUDED.name, image = EXCLUDED.image, sort_order = EXCLUDED.sort_order,
             enabled = EXCLUDED.enabled, updated_at = NOW()
         RETURNING id, venue_id, name, slug, image, sort_order, enabled`,
        [venue.id, name, slug, image, sortOrder, enabled]
    );
    return normalizeCategoryRow(rows[0]);
}

async function deleteGroceryCategory(actingVenue, targetVenueId, categoryId) {
    const venue = await resolveGroceryAdminVenue(actingVenue, targetVenueId);
    const id = toInt(categoryId, 0);
    if (!id) throw Object.assign(new Error('Invalid category id.'), { statusCode: 400 });
    await query(`DELETE FROM grocery_categories WHERE id = $1 AND venue_id = $2`, [id, venue.id]);
    return { ok: true };
}

// ---------- Admin: products ----------

async function listGroceryProductsForAdmin(actingVenue, targetVenueId = null) {
    const venue = await resolveGroceryAdminVenue(actingVenue, targetVenueId);
    const { rows } = await query(
        `SELECT p.id, p.venue_id, p.category_id, p.name, p.sku, p.unit, p.unit_value, p.image,
                p.mrp, p.price, p.sgst_percent, p.cgst_percent, p.igst_percent,
                p.stock_qty, p.low_stock_threshold, p.enabled,
                c.name AS category_name
         FROM grocery_products p
         LEFT JOIN grocery_categories c ON c.id = p.category_id
         WHERE p.venue_id = $1
         ORDER BY p.name ASC`,
        [venue.id]
    );
    return {
        venue: { id: venue.id, slug: venue.slug, name: venue.name },
        products: rows.map(normalizeProductRow)
    };
}

async function upsertGroceryProduct(actingVenue, targetVenueId, input) {
    const venue = await resolveGroceryAdminVenue(actingVenue, targetVenueId);
    const src = input && typeof input === 'object' ? input : {};
    const name = trimText(src.name, 200);
    if (!name) {
        throw Object.assign(new Error('Product name is required.'), { statusCode: 400 });
    }

    const sku = trimText(src.sku, 80);
    const unit = toUnit(src.unit);
    const unitValueRaw = src.unitValue ?? src.unit_value;
    const unitValue = unitValueRaw == null || String(unitValueRaw).trim() === '' ? 1 : Math.max(0, Number(unitValueRaw) || 1);
    const image = trimText(src.image, 400) || DEFAULT_PLACEHOLDER_IMAGE;
    const price = Math.max(0, toInt(src.price, 0));
    const mrpRaw = src.mrp;
    const mrp = mrpRaw == null || String(mrpRaw).trim() === '' ? price : Math.max(0, toInt(mrpRaw, price));
    const sgstPercent = Math.max(0, toInt(src.sgstPercent ?? src.sgst_percent, 0));
    const cgstPercent = Math.max(0, toInt(src.cgstPercent ?? src.cgst_percent, 0));
    const igstPercent = Math.max(0, toInt(src.igstPercent ?? src.igst_percent, 0));
    const stockQty = Math.max(0, toInt(src.stockQty ?? src.stock_qty, 0));
    const lowThreshold = Math.max(0, toInt(src.lowStockThreshold ?? src.low_stock_threshold, 5));
    const enabled = src.enabled === false ? false : true;
    const id = src.id != null ? toInt(src.id, 0) : 0;

    let categoryId = src.categoryId ?? src.category_id;
    categoryId = categoryId == null || String(categoryId).trim() === '' ? null : toInt(categoryId, 0) || null;
    if (categoryId) {
        const { rows: catCheck } = await query(
            `SELECT id FROM grocery_categories WHERE id = $1 AND venue_id = $2 LIMIT 1`,
            [categoryId, venue.id]
        );
        if (!catCheck[0]) {
            throw Object.assign(new Error('Category does not belong to this store.'), { statusCode: 400 });
        }
    }

    if (price <= 0) {
        throw Object.assign(new Error('Selling price must be greater than 0.'), { statusCode: 400 });
    }

    if (id) {
        const { rows } = await query(
            `UPDATE grocery_products
             SET category_id = $2, name = $3, sku = $4, unit = $5, unit_value = $6, image = $7,
                 mrp = $8, price = $9, sgst_percent = $14, cgst_percent = $15, igst_percent = $16, stock_qty = $10, low_stock_threshold = $11, enabled = $12, updated_at = NOW()
             WHERE id = $1 AND venue_id = $13
             RETURNING id, venue_id, category_id, name, sku, unit, unit_value, image, mrp, price, sgst_percent, cgst_percent, igst_percent,
                       stock_qty, low_stock_threshold, enabled`,
            [id, categoryId, name, sku, unit, unitValue, image, mrp, price, stockQty, lowThreshold, enabled, venue.id, sgstPercent, cgstPercent, igstPercent]
        );
        if (!rows[0]) throw Object.assign(new Error('Product not found.'), { statusCode: 404 });
        return normalizeProductRow(rows[0]);
    }

    const { rows } = await query(
        `INSERT INTO grocery_products (venue_id, category_id, name, sku, unit, unit_value, image, mrp, price, sgst_percent, cgst_percent, igst_percent, stock_qty, low_stock_threshold, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $13, $14, $15, $10, $11, $12)
         RETURNING id, venue_id, category_id, name, sku, unit, unit_value, image, mrp, price, sgst_percent, cgst_percent, igst_percent,
                   stock_qty, low_stock_threshold, enabled`,
        [venue.id, categoryId, name, sku, unit, unitValue, image, mrp, price, stockQty, lowThreshold, enabled, sgstPercent, cgstPercent, igstPercent]
    );
    return normalizeProductRow(rows[0]);
}

async function deleteGroceryProduct(actingVenue, targetVenueId, productId) {
    const venue = await resolveGroceryAdminVenue(actingVenue, targetVenueId);
    const id = toInt(productId, 0);
    if (!id) throw Object.assign(new Error('Invalid product id.'), { statusCode: 400 });
    await query(`DELETE FROM grocery_products WHERE id = $1 AND venue_id = $2`, [id, venue.id]);
    return { ok: true };
}

/**
 * Adjust stock. `mode: 'set'` overwrites stock_qty; `mode: 'delta'` adds/subtracts.
 */
async function adjustGroceryStock(actingVenue, targetVenueId, productId, input) {
    const venue = await resolveGroceryAdminVenue(actingVenue, targetVenueId);
    const id = toInt(productId, 0);
    if (!id) throw Object.assign(new Error('Invalid product id.'), { statusCode: 400 });
    const src = input && typeof input === 'object' ? input : {};
    const mode = String(src.mode || 'set').toLowerCase() === 'delta' ? 'delta' : 'set';
    const amount = toInt(src.amount ?? src.value ?? src.stockQty ?? src.stock_qty, NaN);
    if (!Number.isFinite(amount)) {
        throw Object.assign(new Error('Provide a numeric stock amount.'), { statusCode: 400 });
    }

    let rows;
    if (mode === 'delta') {
        ({ rows } = await query(
            `UPDATE grocery_products
             SET stock_qty = GREATEST(0, stock_qty + $2), updated_at = NOW()
             WHERE id = $1 AND venue_id = $3
             RETURNING id, venue_id, category_id, name, sku, unit, unit_value, image, mrp, price,
                       stock_qty, low_stock_threshold, enabled`,
            [id, amount, venue.id]
        ));
    } else {
        ({ rows } = await query(
            `UPDATE grocery_products
             SET stock_qty = GREATEST(0, $2), updated_at = NOW()
             WHERE id = $1 AND venue_id = $3
             RETURNING id, venue_id, category_id, name, sku, unit, unit_value, image, mrp, price,
                       stock_qty, low_stock_threshold, enabled`,
            [id, amount, venue.id]
        ));
    }
    if (!rows[0]) throw Object.assign(new Error('Product not found.'), { statusCode: 404 });
    return normalizeProductRow(rows[0]);
}

async function getLowStockProducts(actingVenue, targetVenueId = null) {
    const venue = await resolveGroceryAdminVenue(actingVenue, targetVenueId);
    const { rows } = await query(
        `SELECT p.id, p.venue_id, p.category_id, p.name, p.sku, p.unit, p.unit_value, p.image,
                p.mrp, p.price, p.stock_qty, p.low_stock_threshold, p.enabled,
                c.name AS category_name
         FROM grocery_products p
         LEFT JOIN grocery_categories c ON c.id = p.category_id
         WHERE p.venue_id = $1 AND p.enabled = TRUE AND p.stock_qty <= p.low_stock_threshold
         ORDER BY p.stock_qty ASC, p.name ASC`,
        [venue.id]
    );
    return {
        venue: { id: venue.id, slug: venue.slug, name: venue.name },
        products: rows.map(normalizeProductRow)
    };
}

// ---------- Customer order pricing ----------

async function validateAndPriceGroceryOrder(body) {
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
        throw Object.assign(new Error('Invalid cart.'), { statusCode: 400 });
    }

    const storeId = toInt(body.storeId ?? body.orderVenueId ?? items[0].venueId, 0);
    if (!storeId) {
        throw Object.assign(new Error('Missing grocery store.'), { statusCode: 400 });
    }

    const venue = await getVenueById(storeId);
    if (!venue || venue.venueType !== 'grocery') {
        throw Object.assign(new Error('Grocery store not found.'), { statusCode: 400 });
    }

    const productIds = [];
    for (const row of items) {
        const pid = toInt(row.productId ?? row.id ?? row.itemId, 0);
        if (pid) productIds.push(pid);
    }
    if (!productIds.length) {
        throw Object.assign(new Error('Invalid cart.'), { statusCode: 400 });
    }

    const { rows: prodRows } = await query(
        `SELECT id, venue_id, name, unit, unit_value, price, stock_qty, enabled
         FROM grocery_products
         WHERE venue_id = $1 AND id = ANY($2::bigint[])`,
        [storeId, productIds]
    );
    const productById = new Map(prodRows.map((r) => [Number(r.id), r]));

    const normalizedItems = [];
    let subtotal = 0;

    for (const row of items) {
        const pid = toInt(row.productId ?? row.id ?? row.itemId, 0);
        const product = productById.get(pid);
        if (!product || product.enabled === false) {
            throw Object.assign(new Error(`Item not available: ${trimText(row.name, 120) || 'unknown'}`), {
                statusCode: 400
            });
        }
        const quantity = toInt(row.quantity, 0);
        if (quantity < 1 || quantity > 99) {
            throw Object.assign(new Error('Invalid quantity.'), { statusCode: 400 });
        }
        if (toInt(product.stock_qty, 0) < quantity) {
            throw Object.assign(
                new Error(`Only ${toInt(product.stock_qty, 0)} left of ${product.name}.`),
                { statusCode: 409 }
            );
        }
        const price = toInt(product.price, 0);
        subtotal += price * quantity;
        normalizedItems.push({
            productId: Number(product.id),
            itemId: Number(product.id),
            name: trimText(product.name, 200),
            price,
            quantity,
            unit: product.unit || 'pcs',
            unitValue: product.unit_value == null ? 1 : Number(product.unit_value),
            venueId: storeId,
            venueName: venue.name
        });
    }

    if (subtotal < GROCERY_MIN_ORDER_RS && !body.isPos) {
        throw Object.assign(
            new Error(`Minimum grocery order is ₹${GROCERY_MIN_ORDER_RS}.`),
            { statusCode: 400 }
        );
    }

    let deliveryFee = body.isPos ? 0 : (subtotal >= GROCERY_FREE_DELIVERY_OVER_RS ? 0 : GROCERY_DELIVERY_FEE_RS);

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
        orderVenueId: storeId
    };
}

module.exports = {
    GROCERY_DELIVERY_FEE_RS,
    GROCERY_FREE_DELIVERY_OVER_RS,
    GROCERY_MIN_ORDER_RS,
    VALID_UNITS,
    getGroceryStorefront,
    listGroceryCategoriesForAdmin,
    upsertGroceryCategory,
    deleteGroceryCategory,
    listGroceryProductsForAdmin,
    upsertGroceryProduct,
    deleteGroceryProduct,
    adjustGroceryStock,
    getLowStockProducts,
    validateAndPriceGroceryOrder
};
