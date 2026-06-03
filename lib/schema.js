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
        CREATE TABLE IF NOT EXISTS store_settings (
            id SMALLINT PRIMARY KEY DEFAULT 1,
            accepting_orders BOOLEAN NOT NULL DEFAULT TRUE,
            closed_reason VARCHAR(40) NOT NULL DEFAULT '',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT store_settings_singleton CHECK (id = 1)
        )
    `);
    await query(
        `INSERT INTO store_settings (id, accepting_orders, closed_reason)
         VALUES (1, TRUE, '')
         ON CONFLICT (id) DO NOTHING`
    );

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

    ready = true;
}

module.exports = { ensureSchema };
