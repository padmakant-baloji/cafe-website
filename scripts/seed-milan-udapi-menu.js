'use strict';

require('dotenv').config();

const { ensureSchema } = require('../lib/schema');
const { query } = require('../lib/db');
const { MILAN_UDAPI_SLUG, buildMilanUdapiMenuCatalog } = require('../lib/milan-udapi-menu-catalog');

async function seedMilanUdapiMenu() {
    const catalog = buildMilanUdapiMenuCatalog();
    const { rows } = await query(
        `UPDATE venues
         SET menu_catalog = $2::jsonb
         WHERE slug = $1
         RETURNING id, slug, name`,
        [MILAN_UDAPI_SLUG, JSON.stringify(catalog)]
    );

    if (!rows[0]) {
        throw new Error(
            `Venue "${MILAN_UDAPI_SLUG}" not found. Create New Milan Hotel Udapi in admin first, then re-run this script.`
        );
    }

    const itemCount = catalog.categories.reduce((sum, cat) => sum + (cat.items || []).length, 0);
    return { venue: rows[0], itemCount };
}

async function main() {
    await ensureSchema();
    const { venue, itemCount } = await seedMilanUdapiMenu();
    console.log(`Seeded ${itemCount} menu items for ${venue.name} (${venue.slug}, id=${venue.id}).`);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});

module.exports = { seedMilanUdapiMenu };
