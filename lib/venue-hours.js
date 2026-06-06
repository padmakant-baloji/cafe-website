'use strict';

/** Same zone as the cafe; keep in sync with `script.js`. */
const VENUE_HOURS_TZ = 'Asia/Kolkata';

/** Fallback when a venue has no hours_text configured. */
const DEFAULT_START_SEC = 9 * 3600;
const DEFAULT_END_SEC = 22 * 3600;

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

function parseClockToken(raw) {
    const text = String(raw || '').trim();
    const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (!match) return null;
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2] || '0', 10);
    const meridiem = match[3].toUpperCase();
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'AM') {
        if (hour === 12) hour = 0;
    } else if (hour !== 12) {
        hour += 12;
    }
    return hour * 3600 + minute * 60;
}

function parseHoursText(hoursText) {
    const text = String(hoursText || '').trim();
    if (!text) return null;
    const parts = text.split(/\s*(?:–|—|-|\bto\b)\s*/i).map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2) return null;
    const startSec = parseClockToken(parts[0]);
    const endSec = parseClockToken(parts[1]);
    if (startSec == null || endSec == null) return null;
    return { startSec, endSec, label: text };
}

function isWithinSecondsWindow(sec, startSec, endSec) {
    if (startSec === endSec) return false;
    if (startSec < endSec) return sec >= startSec && sec < endSec;
    return sec >= startSec || sec < endSec;
}

function isWithinVenueHours(hoursText, date = new Date(), timeZone = VENUE_HOURS_TZ) {
    const parsed = parseHoursText(hoursText);
    const sec = getSecondsSinceMidnightInZone(date, timeZone);
    if (!parsed) {
        return isWithinSecondsWindow(sec, DEFAULT_START_SEC, DEFAULT_END_SEC);
    }
    return isWithinSecondsWindow(sec, parsed.startSec, parsed.endSec);
}

function getVenueHoursClosedMessage(hoursText, venueName) {
    const parsed = parseHoursText(hoursText);
    const label = parsed ? parsed.label : '9 AM–10 PM';
    const name = String(venueName || 'This hotel').trim() || 'This hotel';
    return `${name} accepts online orders ${label} (India time).`;
}

module.exports = {
    VENUE_HOURS_TZ,
    DEFAULT_START_SEC,
    DEFAULT_END_SEC,
    parseHoursText,
    isWithinVenueHours,
    getVenueHoursClosedMessage,
    getSecondsSinceMidnightInZone
};
