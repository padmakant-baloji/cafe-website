require('dotenv').config();
const { getAggregatedCustomerMenu } = require('./lib/menu-service');
const fs = require('fs');

const menuCode = fs.readFileSync('./lib/menu-service.js', 'utf8');
const flattenMenuItemsStr = menuCode.match(/function flattenMenuItems[\s\S]*?return map;\n}/)[0];
const flattenMenuItems = new Function('menuPayload', 'itemIsListed', flattenMenuItemsStr + '\nreturn flattenMenuItems(menuPayload);');
const itemIsListed = (item) => item.enabled !== false;

(async () => {
  try {
    const payload = await getAggregatedCustomerMenu();
    const map = flattenMenuItems(payload, itemIsListed);
    console.log('SUCCESS');
  } catch(e) {
    console.error(e);
  }
  process.exit();
})();
