'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const envTest = path.join(ROOT, '.env.test');
const envDefault = path.join(ROOT, '.env');
const envPath = fs.existsSync(envTest) ? envTest : envDefault;
require('dotenv').config({ path: envPath });

const { query } = require('../lib/db');

(async () => {
    console.log('Using env file:', path.basename(envPath));
    const dbUrl = process.env.DATABASE_URL || '';
    if (dbUrl) {
        const host = (() => {
            try {
                return new URL(dbUrl).hostname;
            } catch {
                return '(invalid DATABASE_URL)';
            }
        })();
        console.log('DB host:', host);
    } else {
        console.log('DB host: via Neon API (NEON_API_KEY + NEON_PROJECT_ID)');
    }

    const { rows } = await query(
        'SELECT current_database() AS db, current_user AS "user", version() AS version'
    );
    const row = rows[0];
    console.log('Neon connection OK');
    console.log('  database:', row.db);
    console.log('  user:', row.user);
    console.log('  server:', row.version.split('\n')[0]);
})().catch((err) => {
    console.error('Connection failed:', err.message);
    process.exit(1);
});
