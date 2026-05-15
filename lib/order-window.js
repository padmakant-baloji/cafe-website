'use strict';

const { httpError } = require('./order-email');

/** Same zone as the cafe; keep in sync with `isOnlineOrderingWindowOpenIST` in `script.js`. */
const ORDER_WINDOW_TZ = 'Asia/Kolkata';
const ORDER_WINDOW_START_SEC = 9 * 3600;
/** Block from 22:00:00 IST onward until next day’s window opens. */
const ORDER_WINDOW_END_SEC = 22 * 3600;

function getSecondsSinceMidnightInZone(date, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    });
    let h = 0;
    let m = 0;
    let s = 0;
    for (const p of dtf.formatToParts(date)) {
        if (p.type === 'hour') h = parseInt(p.value, 10) || 0;
        else if (p.type === 'minute') m = parseInt(p.value, 10) || 0;
        else if (p.type === 'second') s = parseInt(p.value, 10) || 0;
    }
    return h * 3600 + m * 60 + s;
}

function isWithinOnlineOrderingWindow(date = new Date()) {
    const sec = getSecondsSinceMidnightInZone(date, ORDER_WINDOW_TZ);
    return sec >= ORDER_WINDOW_START_SEC && sec < ORDER_WINDOW_END_SEC;
}

function getOrderingWindowClosedMessage() {
    return 'Online ordering is open 9 AM–10 PM (India time). Try again after 9 AM tomorrow.';
}

function assertOrderingWindowOpen() {
    if (!isWithinOnlineOrderingWindow()) {
        throw httpError(403, getOrderingWindowClosedMessage());
    }
}

module.exports = {
    ORDER_WINDOW_TZ,
    ORDER_WINDOW_START_SEC,
    ORDER_WINDOW_END_SEC,
    isWithinOnlineOrderingWindow,
    getOrderingWindowClosedMessage,
    assertOrderingWindowOpen
};
