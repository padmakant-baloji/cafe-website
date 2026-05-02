'use strict';

const { query, getPool } = require('./db');

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(name) {
    const s = String(name || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return s || 'item';
}

function validateSizeEntry(s) {
    return (
        s &&
        typeof s === 'object' &&
        typeof s.label === 'string' &&
        s.label.trim().length > 0 &&
        typeof s.price === 'number' &&
        Number.isFinite(s.price) &&
        s.price >= 0
    );
}

async function itemIdTaken(client, id) {
    const r = await client.query('SELECT 1 FROM menu_items WHERE id = $1 LIMIT 1', [id]);
    return r.rowCount > 0;
}

async function uniqueItemIdDb(client, baseId) {
    let id = baseId;
    let n = 0;
    while (await itemIdTaken(client, id)) {
        n += 1;
        id = `${baseId}-${n}`;
    }
    return id;
}

async function nextSortOrder(client, categoryId, subsectionId) {
    const r = await client.query(
        `SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM menu_items
         WHERE category_id = $1
           AND (subsection_id IS NOT DISTINCT FROM $2::text)`,
        [categoryId, subsectionId || null]
    );
    return Number(r.rows[0].n) || 1;
}

async function normalizeNewItemDb(client, raw) {
    if (!raw || typeof raw !== 'object') {
        const err = new Error('Invalid item payload.');
        err.statusCode = 400;
        throw err;
    }
    const name = String(raw.name || '').trim();
    const image = String(raw.image || '').trim();
    const alt = String(raw.alt !== undefined ? raw.alt : name).trim();
    if (!name || !image) {
        const err = new Error('Name and image path are required.');
        err.statusCode = 400;
        throw err;
    }

    let baseId = String(raw.id || '').trim();
    if (baseId) {
        if (!ID_RE.test(baseId)) {
            const err = new Error('Item id must be lowercase letters, numbers, and hyphens only.');
            err.statusCode = 400;
            throw err;
        }
    } else {
        baseId = slugify(name);
    }
    const id = await uniqueItemIdDb(client, baseId);

    const enabled = raw.enabled === false ? false : true;

    let price;
    let sizes;
    if (Array.isArray(raw.sizes) && raw.sizes.length > 0) {
        sizes = raw.sizes.map((s) => ({
            label: String(s.label || '').trim(),
            price: Math.round(Number(s.price))
        }));
        if (!sizes.every(validateSizeEntry)) {
            const err = new Error('Each size needs a label and a valid price.');
            err.statusCode = 400;
            throw err;
        }
    } else {
        price = Math.round(Number(raw.price));
        if (!Number.isFinite(price) || price < 0) {
            const err = new Error('A valid non-negative price is required (or use sizes).');
            err.statusCode = 400;
            throw err;
        }
    }

    const item = { id, name, image, alt, enabled };
    if (sizes) item.sizes = sizes;
    else item.price = price;
    return item;
}

async function categoryHasSubsections(client, categoryId) {
    const r = await client.query(
        'SELECT 1 FROM menu_subsections WHERE category_id = $1 LIMIT 1',
        [categoryId]
    );
    return r.rowCount > 0;
}

async function assertCategory(client, categoryId) {
    const r = await client.query('SELECT id FROM menu_categories WHERE id = $1', [categoryId]);
    if (r.rowCount === 0) {
        const err = new Error('Category not found.');
        err.statusCode = 400;
        throw err;
    }
}

async function assertSubsection(client, categoryId, subsectionId) {
    const r = await client.query(
        'SELECT 1 FROM menu_subsections WHERE category_id = $1 AND id = $2',
        [categoryId, subsectionId]
    );
    if (r.rowCount === 0) {
        const err = new Error('Subsection not found.');
        err.statusCode = 400;
        throw err;
    }
}

function mergeItemRow(rowData, id) {
    let raw = rowData;
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            raw = {};
        }
    }
    const d = raw && typeof raw === 'object' ? { ...raw } : {};
    d.id = id;
    return d;
}

/** In-memory snapshot so repeat API hits skip DB until TTL or admin mutation. */
let menuMemCache = {
    doc: null,
    expiresAt: 0
};
const MENU_MEM_TTL_MS = 45_000;

function invalidatePublicMenuCache() {
    menuMemCache.doc = null;
    menuMemCache.expiresAt = 0;
}

function cloneMenuDoc(doc) {
    if (typeof structuredClone === 'function') {
        return structuredClone(doc);
    }
    return JSON.parse(JSON.stringify(doc));
}

/**
 * Assemble menu JSON from three ordered row sets (3 DB round-trips in parallel).
 */
function assembleMenuDocument(catRows, subRows, itemRows) {
    const subsByCategory = new Map();
    for (const s of subRows) {
        if (!subsByCategory.has(s.category_id)) {
            subsByCategory.set(s.category_id, []);
        }
        subsByCategory.get(s.category_id).push(s);
    }

    const itemBuckets = new Map();
    for (const row of itemRows) {
        const key = `${row.category_id}\u0000${row.subsection_id == null ? '' : row.subsection_id}`;
        if (!itemBuckets.has(key)) {
            itemBuckets.set(key, []);
        }
        itemBuckets.get(key).push(mergeItemRow(row.data, row.id));
    }

    const categories = [];
    for (const cat of catRows) {
        const subs = subsByCategory.get(cat.id);
        if (subs && subs.length > 0) {
            const subsections = subs.map((sub) => ({
                id: sub.id,
                title: sub.title,
                subtitle: sub.subtitle || undefined,
                items: itemBuckets.get(`${cat.id}\u0000${sub.id}`) || []
            }));
            categories.push({ id: cat.id, name: cat.name, subsections });
        } else {
            const items = itemBuckets.get(`${cat.id}\u0000`) || [];
            categories.push({ id: cat.id, name: cat.name, items });
        }
    }
    return { categories };
}

async function buildMenuDocument(runQuery) {
    const [cats, subs, items] = await Promise.all([
        runQuery(`SELECT id, name FROM menu_categories ORDER BY sort_order ASC, id ASC`),
        runQuery(
            `SELECT category_id, id, title, subtitle FROM menu_subsections
             ORDER BY category_id ASC, sort_order ASC, id ASC`
        ),
        runQuery(
            `SELECT category_id, subsection_id, id, data FROM menu_items
             ORDER BY category_id ASC, subsection_id ASC NULLS FIRST, sort_order ASC, id ASC`
        )
    ]);
    return assembleMenuDocument(cats.rows, subs.rows, items.rows);
}

async function getMenuJson() {
    const now = Date.now();
    if (menuMemCache.doc && now < menuMemCache.expiresAt) {
        return cloneMenuDoc(menuMemCache.doc);
    }
    const doc = await buildMenuDocument((text, params) => query(text, params));
    menuMemCache = { doc: cloneMenuDoc(doc), expiresAt: now + MENU_MEM_TTL_MS };
    return cloneMenuDoc(doc);
}

async function withTransaction(fn) {
    const pool = await getPool();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function applyMenuAction(body) {
    const result = await withTransaction(async (client) => {
        const action = body && body.action;

        if (action === 'add') {
            const categoryId = String(body.categoryId || '').trim();
            const subsectionId = body.subsectionId ? String(body.subsectionId).trim() : '';
            await assertCategory(client, categoryId);
            const hasSubs = await categoryHasSubsections(client, categoryId);
            if (hasSubs) {
                if (!subsectionId) {
                    const err = new Error('subsectionId is required for this category.');
                    err.statusCode = 400;
                    throw err;
                }
                await assertSubsection(client, categoryId, subsectionId);
            } else if (subsectionId) {
                const err = new Error('This category does not use subsections.');
                err.statusCode = 400;
                throw err;
            }

            const item = await normalizeNewItemDb(client, body.item);
            const so = await nextSortOrder(client, categoryId, hasSubs ? subsectionId : null);

            await client.query(
                `INSERT INTO menu_items (id, category_id, subsection_id, sort_order, data)
                 VALUES ($1, $2, $3, $4, $5::jsonb)`,
                [
                    item.id,
                    categoryId,
                    hasSubs ? subsectionId : null,
                    so,
                    JSON.stringify(item)
                ]
            );

            const menu = await getMenuJsonWithClient(client);
            return { ok: true, menu, item };
        }

        if (action === 'update') {
            const categoryId = String(body.categoryId || '').trim();
            const subsectionId = body.subsectionId ? String(body.subsectionId).trim() : '';
            const itemId = String(body.itemId || '').trim();
            const patch = body.patch && typeof body.patch === 'object' ? body.patch : null;
            if (!itemId || !patch) {
                const err = new Error('itemId and patch are required.');
                err.statusCode = 400;
                throw err;
            }

            const row = await client.query(
                `SELECT id, data FROM menu_items WHERE id = $1 AND category_id = $2
                 AND (subsection_id IS NOT DISTINCT FROM $3::text)`,
                [itemId, categoryId, subsectionId || null]
            );
            if (row.rowCount === 0) {
                const err = new Error('Item not found.');
                err.statusCode = 404;
                throw err;
            }

            const cur = { ...mergeItemRow(row.rows[0].data, row.rows[0].id) };

            if (patch.name !== undefined) cur.name = String(patch.name || '').trim();
            if (patch.image !== undefined) cur.image = String(patch.image || '').trim();
            if (patch.alt !== undefined) cur.alt = String(patch.alt || '').trim();
            if (patch.enabled !== undefined) cur.enabled = Boolean(patch.enabled);

            if (patch.price !== undefined && patch.sizes !== undefined) {
                const err = new Error('Send either price or sizes, not both.');
                err.statusCode = 400;
                throw err;
            }

            if (patch.sizes !== undefined) {
                if (!Array.isArray(patch.sizes) || patch.sizes.length === 0) {
                    const err = new Error('sizes must be a non-empty array.');
                    err.statusCode = 400;
                    throw err;
                }
                const sizes = patch.sizes.map((s) => ({
                    label: String(s.label || '').trim(),
                    price: Math.round(Number(s.price))
                }));
                if (!sizes.every(validateSizeEntry)) {
                    const err = new Error('Each size needs a label and a valid price.');
                    err.statusCode = 400;
                    throw err;
                }
                delete cur.price;
                cur.sizes = sizes;
            } else if (patch.price !== undefined) {
                const price = Math.round(Number(patch.price));
                if (!Number.isFinite(price) || price < 0) {
                    const err = new Error('Invalid price.');
                    err.statusCode = 400;
                    throw err;
                }
                delete cur.sizes;
                cur.price = price;
            }

            if (!cur.name || !cur.image) {
                const err = new Error('Name and image path cannot be empty.');
                err.statusCode = 400;
                throw err;
            }
            if (!cur.sizes && (cur.price === undefined || !Number.isFinite(cur.price))) {
                const err = new Error('Item must have either price or sizes.');
                err.statusCode = 400;
                throw err;
            }

            cur.id = itemId;
            await client.query(`UPDATE menu_items SET data = $1::jsonb WHERE id = $2`, [
                JSON.stringify(cur),
                itemId
            ]);

            const menu = await getMenuJsonWithClient(client);
            return { ok: true, menu, item: cur };
        }

        if (action === 'setEnabled') {
            const categoryId = String(body.categoryId || '').trim();
            const subsectionId = body.subsectionId ? String(body.subsectionId).trim() : '';
            const itemId = String(body.itemId || '').trim();
            if (!itemId || typeof body.enabled !== 'boolean') {
                const err = new Error('itemId and enabled (boolean) are required.');
                err.statusCode = 400;
                throw err;
            }

            const row = await client.query(
                `SELECT id, data FROM menu_items WHERE id = $1 AND category_id = $2
                 AND (subsection_id IS NOT DISTINCT FROM $3::text)`,
                [itemId, categoryId, subsectionId || null]
            );
            if (row.rowCount === 0) {
                const err = new Error('Item not found.');
                err.statusCode = 404;
                throw err;
            }

            const cur = { ...mergeItemRow(row.rows[0].data, row.rows[0].id), enabled: body.enabled };
            await client.query(`UPDATE menu_items SET data = $1::jsonb WHERE id = $2`, [
                JSON.stringify(cur),
                itemId
            ]);

            const menu = await getMenuJsonWithClient(client);
            return { ok: true, menu, item: cur };
        }

        const err = new Error('Unknown action. Use add, update, or setEnabled.');
        err.statusCode = 400;
        throw err;
    });
    invalidatePublicMenuCache();
    return result;
}

async function getMenuJsonWithClient(client) {
    return buildMenuDocument((text, params) => client.query(text, params));
}

module.exports = {
    getMenuJson,
    applyMenuAction,
    invalidatePublicMenuCache,
    slugify,
    ID_RE
};
