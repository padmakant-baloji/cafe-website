'use strict';

const { query } = require('./db');

let ready = false;

async function ensureSchema() {
    if (ready) return;

    await query(`
        CREATE TABLE IF NOT EXISTS customers (
            mobile VARCHAR(15) PRIMARY KEY,
            name VARCHAR(200) NOT NULL,
            city VARCHAR(200) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS customer_addresses (
            id BIGSERIAL PRIMARY KEY,
            customer_mobile VARCHAR(15) NOT NULL REFERENCES customers (mobile) ON DELETE CASCADE,
            label VARCHAR(80) NOT NULL,
            address_line VARCHAR(300) NOT NULL,
            landmark VARCHAR(200) NOT NULL DEFAULT '',
            city VARCHAR(200) NOT NULL,
            is_default BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS orders (
            id BIGSERIAL PRIMARY KEY,
            customer_mobile VARCHAR(15) NOT NULL REFERENCES customers (mobile) ON DELETE CASCADE,
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            items JSONB NOT NULL,
            subtotal INTEGER NOT NULL DEFAULT 0,
            delivery_fee INTEGER NOT NULL DEFAULT 0,
            discount INTEGER NOT NULL DEFAULT 0,
            coupon_code VARCHAR(64),
            total INTEGER NOT NULL,
            delivery_address JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS coupons (
            code VARCHAR(64) PRIMARY KEY,
            description VARCHAR(200) NOT NULL DEFAULT '',
            discount_type VARCHAR(16) NOT NULL,
            discount_value INTEGER NOT NULL,
            max_discount INTEGER,
            min_subtotal INTEGER NOT NULL DEFAULT 0,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            starts_at TIMESTAMPTZ,
            ends_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id BIGSERIAL PRIMARY KEY,
            customer_mobile VARCHAR(15) NOT NULL REFERENCES customers (mobile) ON DELETE CASCADE,
            endpoint TEXT NOT NULL,
            subscription JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (endpoint)
        )
    `);

    // Compatibility migration for earlier schema that used customers.id + orders.customer_id.
    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_mobile VARCHAR(15)`);
    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal INTEGER`);
    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee INTEGER`);
    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount INTEGER`);
    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(64)`);
    await query(`
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'orders' AND column_name = 'customer_id'
            ) THEN
                EXECUTE 'ALTER TABLE orders ALTER COLUMN customer_id DROP NOT NULL';
            END IF;
        END $$;
    `);
    await query(`
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'orders' AND column_name = 'customer_id'
            ) THEN
                EXECUTE '
                    UPDATE orders o
                    SET customer_mobile = c.mobile
                    FROM customers c
                    WHERE o.customer_mobile IS NULL
                      AND o.customer_id IS NOT NULL
                      AND c.id = o.customer_id
                ';
            END IF;
        END $$;
    `);
    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address JSONB`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_mobile_unique ON customers (mobile)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_mobile ON customer_addresses (customer_mobile)`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_addresses_default_unique ON customer_addresses (customer_mobile) WHERE is_default = TRUE`);
    await query(`CREATE INDEX IF NOT EXISTS idx_orders_customer_mobile ON orders (customer_mobile)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_customer_mobile ON push_subscriptions (customer_mobile)`);

    await query(`
        CREATE TABLE IF NOT EXISTS menu_categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS menu_subsections (
            category_id TEXT NOT NULL REFERENCES menu_categories (id) ON DELETE CASCADE,
            id TEXT NOT NULL,
            title TEXT NOT NULL,
            subtitle TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (category_id, id)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS menu_items (
            id TEXT PRIMARY KEY,
            category_id TEXT NOT NULL REFERENCES menu_categories (id) ON DELETE CASCADE,
            subsection_id TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            data JSONB NOT NULL,
            FOREIGN KEY (category_id, subsection_id)
                REFERENCES menu_subsections (category_id, id)
                ON DELETE CASCADE
        )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items (category_id)`);
    await query(
        `CREATE INDEX IF NOT EXISTS idx_menu_items_category_sub ON menu_items (category_id, subsection_id)`
    );

    await seedMenuFromJsonIfEmpty();

    ready = true;
}

async function seedMenuFromJsonIfEmpty() {
    const { rows } = await query(`SELECT COUNT(*)::int AS c FROM menu_categories`);
    if (rows[0].c > 0) return;

    const fs = require('fs/promises');
    const path = require('path');
    let raw;
    try {
        raw = await fs.readFile(path.join(process.cwd(), 'menu.json'), 'utf8');
    } catch {
        return;
    }
    let menu;
    try {
        menu = JSON.parse(raw);
    } catch {
        return;
    }
    if (!menu || !Array.isArray(menu.categories) || menu.categories.length === 0) return;

    const pool = await require('./db').getPool();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (let ci = 0; ci < menu.categories.length; ci++) {
            const cat = menu.categories[ci];
            const catId = String(cat.id || '').trim();
            const catName = String(cat.name || '').trim();
            if (!catId || !catName) continue;

            await client.query(
                `INSERT INTO menu_categories (id, name, sort_order) VALUES ($1, $2, $3)
                 ON CONFLICT (id) DO NOTHING`,
                [catId, catName, ci]
            );

            if (Array.isArray(cat.subsections) && cat.subsections.length > 0) {
                for (let si = 0; si < cat.subsections.length; si++) {
                    const sub = cat.subsections[si];
                    const subId = String(sub.id || '').trim();
                    const title = String(sub.title || '').trim();
                    if (!subId || !title) continue;
                    await client.query(
                        `INSERT INTO menu_subsections (category_id, id, title, subtitle, sort_order)
                         VALUES ($1, $2, $3, $4, $5)
                         ON CONFLICT (category_id, id) DO NOTHING`,
                        [catId, subId, title, String(sub.subtitle || ''), si]
                    );

                    const items = Array.isArray(sub.items) ? sub.items : [];
                    for (let ii = 0; ii < items.length; ii++) {
                        const item = items[ii];
                        const itemId = String(item.id || '').trim();
                        if (!itemId) continue;
                        const payload = { ...item, id: itemId };
                        await client.query(
                            `INSERT INTO menu_items (id, category_id, subsection_id, sort_order, data)
                             VALUES ($1, $2, $3, $4, $5::jsonb)
                             ON CONFLICT (id) DO NOTHING`,
                            [itemId, catId, subId, ii, JSON.stringify(payload)]
                        );
                    }
                }
            } else {
                const items = Array.isArray(cat.items) ? cat.items : [];
                for (let ii = 0; ii < items.length; ii++) {
                    const item = items[ii];
                    const itemId = String(item.id || '').trim();
                    if (!itemId) continue;
                    const payload = { ...item, id: itemId };
                    await client.query(
                        `INSERT INTO menu_items (id, category_id, subsection_id, sort_order, data)
                         VALUES ($1, $2, NULL, $3, $4::jsonb)
                         ON CONFLICT (id) DO NOTHING`,
                        [itemId, catId, ii, JSON.stringify(payload)]
                    );
                }
            }
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.warn('menu seed from menu.json:', err.message);
    } finally {
        client.release();
    }
}

module.exports = { ensureSchema };
