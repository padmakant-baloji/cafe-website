const { query } = require('./lib/db.js');

async function main() {
    const { rows } = await query('SELECT id, name FROM venues');
    console.log(rows);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
