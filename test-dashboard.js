const { listAllOrdersSummaryForSuperAdmin } = require('./lib/order-service');
async function run() {
    const res = await listAllOrdersSummaryForSuperAdmin('all');
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
}
run();
