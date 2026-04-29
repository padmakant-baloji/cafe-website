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
        CREATE TABLE IF NOT EXISTS orders (
            id BIGSERIAL PRIMARY KEY,
            customer_mobile VARCHAR(15) NOT NULL REFERENCES customers (mobile) ON DELETE CASCADE,
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            items JSONB NOT NULL,
            total INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // Compatibility migration for earlier schema that used customers.id + orders.customer_id.
    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_mobile VARCHAR(15)`);
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
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_mobile_unique ON customers (mobile)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_orders_customer_mobile ON orders (customer_mobile)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC)`);

    ready = true;
}

module.exports = { ensureSchema };
