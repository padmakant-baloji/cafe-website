'use strict';

const { getMenuJson, applyMenuAction } = require('./menu-service');

/** Customer + admin menu document (backed by Postgres; `menu.json` is only used for one-time DB seed). */
module.exports = {
    readMenu: getMenuJson,
    applyMenuAction
};
