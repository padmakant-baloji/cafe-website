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
            daily_order_number INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS venues (
            id SERIAL PRIMARY KEY,
            slug VARCHAR(64) NOT NULL UNIQUE,
            name VARCHAR(200) NOT NULL,
            city VARCHAR(200) NOT NULL DEFAULT '',
            admin_user VARCHAR(100),
            admin_pass VARCHAR(100),
            table_count SMALLINT NOT NULL DEFAULT 7,
            parcel_count SMALLINT NOT NULL DEFAULT 5,
            walkin_mobile VARCHAR(15) NOT NULL DEFAULT '8888888888',
            is_default BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await query(`ALTER TABLE venues ADD COLUMN IF NOT EXISTS menu_catalog JSONB`);
    await query(`ALTER TABLE venues ADD COLUMN IF NOT EXISTS venue_type VARCHAR(16) NOT NULL DEFAULT 'food'`);
    await query(`ALTER TABLE venues ADD COLUMN IF NOT EXISTS address_line VARCHAR(300) NOT NULL DEFAULT ''`);
    await query(`ALTER TABLE venues ADD COLUMN IF NOT EXISTS contact_mobile VARCHAR(15) NOT NULL DEFAULT ''`);
    await query(`ALTER TABLE venues ADD COLUMN IF NOT EXISTS hours_text VARCHAR(120) NOT NULL DEFAULT ''`);
    await query(`ALTER TABLE venues ADD COLUMN IF NOT EXISTS payment_qr_code TEXT NOT NULL DEFAULT ''`);
    await query(`ALTER TABLE venues ADD COLUMN IF NOT EXISTS table_categories JSONB`);
    await query(`ALTER TABLE venues ADD COLUMN IF NOT EXISTS partner_markup_pct SMALLINT NOT NULL DEFAULT 0`);
    
    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(32) NOT NULL DEFAULT 'pending'`);
    await query(
        `INSERT INTO venues (id, slug, name, city, address_line, contact_mobile, hours_text, table_count, parcel_count, walkin_mobile, is_default)
         VALUES (1, 'balojicafe', 'Baloji Cafe''s Cafe', 'Kudachi', 'Opp. Railway Station, Near Bus Stop, Kudachi – 591311, Karnataka', '9845812238', '1 PM – 10 PM', 7, 5, '8888888888', TRUE)
         ON CONFLICT (id) DO UPDATE
         SET slug = EXCLUDED.slug,
             name = EXCLUDED.name,
             city = EXCLUDED.city,
             address_line = CASE
                 WHEN venues.address_line IS NULL OR venues.address_line = '' THEN EXCLUDED.address_line
                 ELSE venues.address_line
             END,
             contact_mobile = CASE
                 WHEN venues.contact_mobile IS NULL OR venues.contact_mobile = '' THEN EXCLUDED.contact_mobile
                 ELSE venues.contact_mobile
             END,
             hours_text = CASE
                 WHEN venues.hours_text IS NULL OR venues.hours_text = '' THEN EXCLUDED.hours_text
                 ELSE venues.hours_text
             END,
             is_default = TRUE`
    );

    await query(`
        CREATE TABLE IF NOT EXISTS store_settings (
            id SMALLINT PRIMARY KEY DEFAULT 1,
            accepting_orders BOOLEAN NOT NULL DEFAULT TRUE,
            closed_reason VARCHAR(40) NOT NULL DEFAULT '',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT store_settings_singleton CHECK (id = 1)
        )
    `);
    await query(`ALTER TABLE store_settings DROP CONSTRAINT IF EXISTS store_settings_singleton`);
    await query(`ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS venue_id INTEGER REFERENCES venues (id)`);
    await query(`UPDATE store_settings SET venue_id = 1 WHERE venue_id IS NULL`);
    await query(
        `INSERT INTO store_settings (id, venue_id, accepting_orders, closed_reason)
         VALUES (1, 1, TRUE, '')
         ON CONFLICT (id) DO UPDATE SET venue_id = COALESCE(store_settings.venue_id, 1)`
    );
    await query(
        `INSERT INTO store_settings (id, venue_id, accepting_orders, closed_reason)
         SELECT v.id, v.id, TRUE, ''
         FROM venues v
         WHERE NOT EXISTS (SELECT 1 FROM store_settings s WHERE s.venue_id = v.id)
         ON CONFLICT (id) DO NOTHING`
    );
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_store_settings_venue_id ON store_settings (venue_id)`);

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
        CREATE TABLE IF NOT EXISTS grocery_categories (
            id BIGSERIAL PRIMARY KEY,
            venue_id INTEGER NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
            name VARCHAR(120) NOT NULL,
            slug VARCHAR(140) NOT NULL,
            image VARCHAR(400) NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_grocery_categories_venue_slug ON grocery_categories (venue_id, slug)`
    );
    await query(`CREATE INDEX IF NOT EXISTS idx_grocery_categories_venue ON grocery_categories (venue_id)`);

    await query(`
        CREATE TABLE IF NOT EXISTS grocery_products (
            id BIGSERIAL PRIMARY KEY,
            venue_id INTEGER NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
            category_id BIGINT REFERENCES grocery_categories (id) ON DELETE SET NULL,
            name VARCHAR(200) NOT NULL,
            sku VARCHAR(80) NOT NULL DEFAULT '',
            unit VARCHAR(12) NOT NULL DEFAULT 'pcs',
            unit_value NUMERIC(10, 2) NOT NULL DEFAULT 1,
            image VARCHAR(400) NOT NULL DEFAULT '',
            mrp INTEGER NOT NULL DEFAULT 0,
            price INTEGER NOT NULL DEFAULT 0,
            sgst_percent INTEGER NOT NULL DEFAULT 0,
            cgst_percent INTEGER NOT NULL DEFAULT 0,
            igst_percent INTEGER NOT NULL DEFAULT 0,
            stock_qty INTEGER NOT NULL DEFAULT 0,
            low_stock_threshold INTEGER NOT NULL DEFAULT 5,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await query(`ALTER TABLE grocery_products ADD COLUMN IF NOT EXISTS sgst_percent INTEGER NOT NULL DEFAULT 0`);
    await query(`ALTER TABLE grocery_products ADD COLUMN IF NOT EXISTS cgst_percent INTEGER NOT NULL DEFAULT 0`);
    await query(`ALTER TABLE grocery_products ADD COLUMN IF NOT EXISTS igst_percent INTEGER NOT NULL DEFAULT 0`);
    await query(`CREATE INDEX IF NOT EXISTS idx_grocery_products_venue ON grocery_products (venue_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_grocery_products_category ON grocery_products (category_id)`);
    await query(
        `CREATE INDEX IF NOT EXISTS idx_grocery_products_low_stock ON grocery_products (venue_id) WHERE stock_qty <= low_stock_threshold`
    );

    await query(`
        CREATE TABLE IF NOT EXISTS grocery_staff (
            id BIGSERIAL PRIMARY KEY,
            venue_id INTEGER NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
            name VARCHAR(120) NOT NULL,
            phone VARCHAR(15) NOT NULL DEFAULT '',
            role VARCHAR(32) NOT NULL DEFAULT 'cashier',
            pin VARCHAR(6) NOT NULL DEFAULT '',
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_grocery_staff_venue ON grocery_staff (venue_id)`);

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

    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'delivery'`);
    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_meta JSONB`);
    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_screenshot TEXT`);
    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS venue_id INTEGER REFERENCES venues (id)`);
    await query(`UPDATE orders SET venue_id = 1 WHERE venue_id IS NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_orders_venue_id ON orders (venue_id)`);
    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS daily_order_number INTEGER`);
    
    // Backfill daily_order_number to equal id for existing orders
    await query(`UPDATE orders SET daily_order_number = id WHERE daily_order_number IS NULL`);
    await query(
        `CREATE INDEX IF NOT EXISTS idx_orders_channel_active ON orders (channel) WHERE channel IN ('dine_in', 'parcel')`
    );

    await query(
        `INSERT INTO customers (mobile, name, city)
         VALUES ('8888888888', 'Walk-in / Floor', 'Kudachi')
         ON CONFLICT (mobile) DO NOTHING`
    );

    await query(
        `INSERT INTO coupons (code, description, discount_type, discount_value, max_discount, min_subtotal, active, updated_at)
         VALUES ('RCB', '5% off up to ₹50', 'percent', 5, 50, 0, TRUE, NOW())
         ON CONFLICT (code) DO UPDATE
         SET description = EXCLUDED.description,
             discount_type = EXCLUDED.discount_type,
             discount_value = EXCLUDED.discount_value,
             max_discount = EXCLUDED.max_discount,
             min_subtotal = EXCLUDED.min_subtotal,
             active = TRUE,
             updated_at = NOW()`
    );
    // Web push removed (no client push).
    await query(`DROP TABLE IF EXISTS push_subscriptions CASCADE`);
    await query(`DROP TABLE IF EXISTS push_notifications CASCADE`);
    // Legacy menu catalog tables removed — menu is served from static menu.json.
    await query(`DROP TABLE IF EXISTS menu_items CASCADE`);
    await query(`DROP TABLE IF EXISTS menu_subsections CASCADE`);
    await query(`DROP TABLE IF EXISTS menu_categories CASCADE`);

    // Delivery zones — configurable per-city delivery fees & minimums.
    await query(`
        CREATE TABLE IF NOT EXISTS delivery_zones (
            id SERIAL PRIMARY KEY,
            venue_id INTEGER REFERENCES venues (id) ON DELETE CASCADE,
            city VARCHAR(120) NOT NULL,
            min_order INTEGER NOT NULL DEFAULT 0,
            delivery_fee INTEGER NOT NULL DEFAULT 0,
            free_delivery_above INTEGER,
            enabled BOOLEAN NOT NULL DEFAULT TRUE
        )
    `);
    // Unique index for venue_id IS NOT NULL
    await query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_zones_venue_city
         ON delivery_zones (venue_id, city) WHERE venue_id IS NOT NULL`
    );
    // Unique index for venue_id IS NULL (global / Baloji Cafe Cafe)
    await query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_zones_null_venue_city
         ON delivery_zones (city) WHERE venue_id IS NULL`
    );

    // Seed default delivery zones for Baloji Cafe Cafe (venue_id = NULL means main venue)
    await query(
        `INSERT INTO delivery_zones (venue_id, city, min_order, delivery_fee, free_delivery_above, enabled)
         VALUES (NULL, 'kudachi', 0, 8, NULL, TRUE)
         ON CONFLICT (city) WHERE venue_id IS NULL DO NOTHING`
    );
    await query(
        `INSERT INTO delivery_zones (venue_id, city, min_order, delivery_fee, free_delivery_above, enabled)
         VALUES (NULL, '_default', 200, 40, 500, TRUE)
         ON CONFLICT (city) WHERE venue_id IS NULL DO NOTHING`
    );

    const { buildMilanUdapiMenuCatalog, MILAN_UDAPI_SLUG } = require('./milan-udapi-menu-catalog');
    await query(
        `UPDATE venues
         SET menu_catalog = $2::jsonb
         WHERE slug = $1
           AND (
             menu_catalog IS NULL
             OR menu_catalog = 'null'::jsonb
             OR COALESCE(jsonb_array_length(menu_catalog->'categories'), 0) = 0
           )`,
        [MILAN_UDAPI_SLUG, JSON.stringify(buildMilanUdapiMenuCatalog())]
    );

    ready = true;
}

module.exports = { ensureSchema };
