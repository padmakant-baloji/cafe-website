'use strict';

const DEFAULT_ADMIN_USER = 'balojicafe';
const DEFAULT_ADMIN_PASS = 'admin';
const ADMIN_STORAGE_KEY = 'balojiAdminCredentials';
const SESSION_STORAGE_SEEN = 'balojiAdminSeenPendingIds';
const SESSION_STORAGE_LAST_ORDER = 'balojiAdminLastOrderId';
const ringingOrderIds = new Set();
let ringingTimer = null;
let audioCtx = null;
let audioUnlocked = false;
let refreshTimer = null;
let currentAdminCredentials = null;

const ORDER_STATUS_TABS = [
    { key: 'all', label: 'All Orders', emptyText: 'orders' },
    { key: 'pending', label: 'New Orders', emptyText: 'pending orders' },
    { key: 'accepted', label: 'Accepted', emptyText: 'accepted orders' },
    { key: 'preparing', label: 'Preparing', emptyText: 'preparing orders' },
    { key: 'out_for_delivery', label: 'Out for delivery', emptyText: 'out for delivery orders' },
    { key: 'completed', label: 'Completed', emptyText: 'completed orders' },
    { key: 'rejected', label: 'Rejected', emptyText: 'rejected orders' }
];

let activeOrderTab = 'all';
let lastOrders = [];

// New pending orders are queued and shown one-by-one in a popup.
let pendingPopupQueue = [];
let pendingPopupQueueIds = new Set();
let newOrderPopupOpen = false;
let newOrderPopupOrderId = null;

function loadAdminCredentials() {
    try {
        const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        if (!parsed.user || !parsed.pass) return null;
        return parsed;
    } catch {
        return null;
    }
}

function saveAdminCredentials(user, pass) {
    const normalized = { user: String(user || '').trim(), pass: String(pass || '').trim() };
    currentAdminCredentials = normalized;
    try {
        localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
        /* ignore storage failures; in-memory creds still work */
    }
}

function clearAdminCredentials() {
    currentAdminCredentials = null;
    try {
        localStorage.removeItem(ADMIN_STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

function adminHeaders(credsOverride) {
    const creds = credsOverride || currentAdminCredentials || loadAdminCredentials();
    if (!creds) return { Accept: 'application/json' };
    const user = creds.user;
    const pass = String(creds.pass || '');
    const token = btoa(`${user}:${pass}`);
    return {
        Authorization: `Basic ${token}`,
        Accept: 'application/json'
    };
}

function fillAdminDefaults() {
    // Intentionally do not auto-populate admin credentials.
}

function showAdminGate(message = '') {
    const gate = document.getElementById('adminAuthGate');
    const error = document.getElementById('adminAuthError');
    if (gate) gate.hidden = false;
    fillAdminDefaults();
    if (error) {
        error.textContent = message;
        error.hidden = !message;
    }
}

function hideAdminGate() {
    const gate = document.getElementById('adminAuthGate');
    const error = document.getElementById('adminAuthError');
    if (gate) gate.hidden = true;
    if (error) {
        error.textContent = '';
        error.hidden = true;
    }
}

function statusLabel(status) {
    const map = {
        pending: 'Awaiting action',
        accepted: 'Accepted',
        rejected: 'Rejected',
        preparing: 'Preparing',
        out_for_delivery: 'Out for delivery',
        completed: 'Completed'
    };
    return map[status] || status;
}

function loadSeenIds() {
    try {
        const raw = sessionStorage.getItem(SESSION_STORAGE_SEEN);
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch {
        return new Set();
    }
}

function saveSeenIds(set) {
    sessionStorage.setItem(SESSION_STORAGE_SEEN, JSON.stringify([...set]));
}

function loadLastOrderId() {
    const raw = sessionStorage.getItem(SESSION_STORAGE_LAST_ORDER);
    const n = parseInt(String(raw || ''), 10);
    return Number.isFinite(n) ? n : 0;
}

function saveLastOrderId(id) {
    sessionStorage.setItem(SESSION_STORAGE_LAST_ORDER, String(id));
}

async function fetchOrders() {
    const res = await fetch('/api/admin/orders', { headers: adminHeaders() });
    if (res.status === 401) throw Object.assign(new Error('Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(`Could not load orders (${res.status})`);
    const data = await res.json();
    return data.orders || [];
}

async function patchOrder(orderId, action) {
    const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: {
            ...adminHeaders(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data.order;
}

async function verifyAdminCredentials(user, pass) {
    const res = await fetch('/api/admin/session', {
        headers: adminHeaders({ user: String(user || '').trim(), pass: String(pass || '').trim() })
    });
    if (res.status === 401) return false;
    return res.ok;
}

function formatItems(items) {
    if (!items || typeof items !== 'object') return '';
    let parsed = items;
    if (typeof items === 'string') {
        try {
            parsed = JSON.parse(items);
        } catch {
            return '';
        }
    }
    if (!Array.isArray(parsed)) return '';
    return parsed
        .map((line) => `${line.name} × ${line.quantity} — ₹${line.price * line.quantity}`)
        .join('\n');
}

function formatDeliveryAddress(address) {
    if (!address) return '';
    let parsed = address;
    if (typeof address === 'string') {
        try {
            parsed = JSON.parse(address);
        } catch {
            return '';
        }
    }
    if (!parsed || typeof parsed !== 'object') return '';
    return String(parsed.addressLine || parsed.address_line || '').trim();
}

function formatMoney(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '₹0';
    return `₹${Math.round(v)}`;
}

function formatDuration(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '0m';
    const totalSec = Math.floor(n / 1000);
    const mins = Math.floor(totalSec / 60);
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hrs <= 0) return `${mins}m`;
    return `${hrs}h ${remMins}m`;
}

function isSameLocalDay(a, b) {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

function computeAdminAnalytics(orders) {
    const now = new Date();
    const todayOrders = [];
    let pendingNow = 0;
    let inProgressNow = 0;
    let completedToday = 0;
    let revenueToday = 0;
    let discountsToday = 0;
    let deliveryFeesToday = 0;
    let totalOrdersLoaded = 0;
    let totalEarningLoaded = 0;
    let oldestPendingMs = null;
    let oldestInProgressMs = null;
    let last60MinOrders = 0;
    let last60MinRevenue = 0;
    let kudachiCountLoaded = 0;
    let outsideCountLoaded = 0;

    for (const o of orders || []) {
        totalOrdersLoaded += 1;
        totalEarningLoaded += Number(o.total) || 0;
        const status = String(o.status || '');
        if (status === 'pending') pendingNow += 1;
        if (status === 'accepted' || status === 'preparing' || status === 'out_for_delivery') inProgressNow += 1;

        const createdAt = o.created_at ? new Date(o.created_at) : null;
        if (!createdAt || Number.isNaN(createdAt.getTime())) {
            // Still count city split even if timestamps are missing.
            const cityLower = String(o.city || '').trim().toLowerCase();
            if (cityLower === 'kudachi') kudachiCountLoaded += 1;
            else if (cityLower) outsideCountLoaded += 1;
            continue;
        }

        const ageMs = now.getTime() - createdAt.getTime();
        if (status === 'pending') {
            oldestPendingMs = oldestPendingMs == null ? ageMs : Math.max(oldestPendingMs, ageMs);
        }
        if (status === 'accepted' || status === 'preparing' || status === 'out_for_delivery') {
            oldestInProgressMs = oldestInProgressMs == null ? ageMs : Math.max(oldestInProgressMs, ageMs);
        }

        if (ageMs >= 0 && ageMs <= 60 * 60 * 1000) {
            last60MinOrders += 1;
            last60MinRevenue += Number(o.total) || 0;
        }

        const cityLower = String(o.city || '').trim().toLowerCase();
        if (cityLower === 'kudachi') kudachiCountLoaded += 1;
        else if (cityLower) outsideCountLoaded += 1;

        if (!isSameLocalDay(createdAt, now)) continue;

        todayOrders.push(o);
        const total = Number(o.total) || 0;
        revenueToday += total;
        discountsToday += Number(o.discount) || 0;
        deliveryFeesToday += Number(o.delivery_fee) || 0;

        if (status === 'completed') completedToday += 1;
    }

    const ordersTodayCount = todayOrders.length;
    const avgOrderToday = ordersTodayCount ? revenueToday / ordersTodayCount : 0;

    return {
        updatedAt: now,
        ordersTodayCount,
        revenueToday,
        avgOrderToday,
        totalOrdersLoaded,
        totalEarningLoaded,
        pendingNow,
        inProgressNow,
        completedToday,
        discountsToday,
        deliveryFeesToday,
        oldestPendingMs,
        oldestInProgressMs,
        last60MinOrders,
        last60MinRevenue,
        kudachiCountLoaded,
        outsideCountLoaded
    };
}

function safeClipboardWrite(text) {
    if (!text) return Promise.resolve(false);
    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
    }
    return new Promise((resolve) => {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', 'true');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            resolve(Boolean(ok));
        } catch {
            resolve(false);
        }
    });
}

function renderAdminAnalytics(orders) {
    const root = document.getElementById('adminDesktopAnalytics');
    if (!root) return;

    const data = computeAdminAnalytics(orders || []);

    const updatedEl = document.getElementById('adminAnalyticsUpdatedAt');
    if (updatedEl) updatedEl.textContent = `Updated ${data.updatedAt.toLocaleTimeString()}`;

    const ordersTodayEl = document.getElementById('metricOrdersToday');
    if (ordersTodayEl) ordersTodayEl.textContent = String(data.ordersTodayCount);
    const ordersTodayHintEl = document.getElementById('metricOrdersTodayHint');
    if (ordersTodayHintEl) ordersTodayHintEl.textContent = `Pending ${data.pendingNow} · In progress ${data.inProgressNow}`;

    const revenueEl = document.getElementById('metricRevenueToday');
    if (revenueEl) revenueEl.textContent = formatMoney(data.revenueToday);
    const revenueHintEl = document.getElementById('metricRevenueTodayHint');
    if (revenueHintEl) {
        const parts = [];
        if (data.deliveryFeesToday > 0) parts.push(`Delivery ${formatMoney(data.deliveryFeesToday)}`);
        if (data.discountsToday > 0) parts.push(`Discounts ${formatMoney(data.discountsToday)}`);
        revenueHintEl.textContent = parts.length ? parts.join(' · ') : '—';
    }

    const totalOrdersEl = document.getElementById('metricTotalOrders');
    if (totalOrdersEl) totalOrdersEl.textContent = String(data.totalOrdersLoaded);

    const totalEarnEl = document.getElementById('metricTotalEarning');
    if (totalEarnEl) totalEarnEl.textContent = formatMoney(data.totalEarningLoaded);

    const avgTodayEl = document.getElementById('insightAvgOrderToday');
    if (avgTodayEl) avgTodayEl.textContent = formatMoney(data.avgOrderToday);

    const discountsEl = document.getElementById('insightDiscountsToday');
    if (discountsEl) discountsEl.textContent = formatMoney(data.discountsToday);

    const deliveryEl = document.getElementById('insightDeliveryFeesToday');
    if (deliveryEl) deliveryEl.textContent = formatMoney(data.deliveryFeesToday);

    const oldestPendingEl = document.getElementById('insightOldestPending');
    if (oldestPendingEl) {
        oldestPendingEl.textContent = data.oldestPendingMs == null ? '—' : formatDuration(data.oldestPendingMs);
    }

    const oldestProgEl = document.getElementById('insightOldestInProgress');
    if (oldestProgEl) {
        oldestProgEl.textContent = data.oldestInProgressMs == null ? '—' : formatDuration(data.oldestInProgressMs);
    }

    const last60El = document.getElementById('insightLast60Min');
    if (last60El) {
        last60El.textContent = `${data.last60MinOrders} orders · ${formatMoney(data.last60MinRevenue)}`;
    }

    const splitEl = document.getElementById('insightKudachiSplit');
    if (splitEl) {
        const total = (data.kudachiCountLoaded || 0) + (data.outsideCountLoaded || 0);
        if (!total) splitEl.textContent = '—';
        else splitEl.textContent = `${data.kudachiCountLoaded} / ${data.outsideCountLoaded}`;
    }
}

function renderOrders(orders, container, emptyText = 'orders') {
    if (!orders.length) {
        container.innerHTML = `<p class="admin-empty">No ${escapeHtml(emptyText)} yet.</p>`;
        return;
    }

    container.innerHTML = orders
        .map((o) => {
            const id = String(o.id);
            const itemsHtml = formatItems(o.items)
                .split('\n')
                .map((line) => `<div class="admin-order-line">${escapeHtml(line)}</div>`)
                .join('');

            let actions = '';
            if (o.status === 'pending') {
                actions = `
                    <button type="button" class="admin-btn admin-btn--accept" data-action="accept" data-id="${id}">Accept</button>
                    <button type="button" class="admin-btn admin-btn--reject" data-action="reject" data-id="${id}">Reject</button>
                `;
            } else if (o.status === 'accepted') {
                actions = `
                    <button type="button" class="admin-btn admin-btn--prep" data-action="preparing" data-id="${id}">Preparing order</button>
                `;
            } else if (o.status === 'preparing') {
                actions = `
                    <button type="button" class="admin-btn admin-btn--out" data-action="out_for_delivery" data-id="${id}">Out for delivery</button>
                `;
            } else if (o.status === 'out_for_delivery') {
                actions = `
                    <button type="button" class="admin-btn admin-btn--complete" data-action="completed" data-id="${id}">Complete order</button>
                `;
            }

            const when = o.created_at ? new Date(o.created_at).toLocaleString() : '';
            const deliveryAddress = formatDeliveryAddress(o.delivery_address);

            return `
                <article class="admin-order admin-order--${escapeHtml(o.status)}" data-order-id="${id}">
                    <header class="admin-order-head">
                        <span class="admin-order-id">#${escapeHtml(id)}</span>
                        <span class="admin-order-status admin-order-status--${escapeHtml(o.status)}">${escapeHtml(statusLabel(o.status))}</span>
                    </header>
                    <div class="admin-order-meta">
                        <strong>${escapeHtml(o.name || '')}</strong>
                        <span>${escapeHtml(o.mobile || '')}</span>
                        <span>${escapeHtml(o.city || '')}</span>
                        ${deliveryAddress ? `<span>${escapeHtml(deliveryAddress)}</span>` : ''}
                        <span class="admin-order-time">${escapeHtml(when)}</span>
                    </div>
                    <div class="admin-order-items">${itemsHtml}</div>
                    <div class="admin-order-total">Total: ₹${Number(o.total) || 0}</div>
                    <div class="admin-order-actions">${actions}</div>
                </article>
            `;
        })
        .join('');
}

function renderOrderTabs(tabsEl, countsByStatus, activeKey) {
    if (!tabsEl) return;
    tabsEl.innerHTML = '';

    for (const tab of ORDER_STATUS_TABS) {
        const count = countsByStatus && typeof countsByStatus === 'object' ? countsByStatus[tab.key] : 0;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'admin-tab-btn';
        btn.setAttribute('role', 'tab');
        btn.dataset.status = tab.key;
        btn.setAttribute('aria-selected', tab.key === activeKey ? 'true' : 'false');

        const label = document.createElement('span');
        label.textContent = tab.label;

        const countSpan = document.createElement('span');
        countSpan.className = 'admin-tab-count';
        countSpan.textContent = String(count || 0);

        btn.appendChild(label);
        btn.appendChild(countSpan);
        tabsEl.appendChild(btn);
    }
}

function buildNewOrderPopupDetails(order) {
    const deliveryAddress = formatDeliveryAddress(order.delivery_address);
    const items = formatItems(order.items)
        .split('\n')
        .filter(Boolean)
        .slice(0, 5)
        .map((line) => `<div>${escapeHtml(line)}</div>`)
        .join('');

    const addressHtml = deliveryAddress ? `<div style="color: var(--muted);">${escapeHtml(deliveryAddress)}</div>` : '';
    const when = order.created_at ? new Date(order.created_at).toLocaleString() : '';
    const timeHtml = when ? `<div style="color: var(--muted); font-size: 0.8rem; margin-top: 0.25rem;">${escapeHtml(when)}</div>` : '';
    const itemsHtml = items ? `<div style="margin-top: 0.6rem;">${items}</div>` : '';
    return `${addressHtml}${itemsHtml}${timeHtml}`;
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function showToast(message) {
    let el = document.getElementById('adminToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'adminToast';
        el.className = 'admin-toast';
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('admin-toast--show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove('admin-toast--show'), 4500);
}

function maybeNotifyNewOrder(order) {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
        try {
            new Notification("New order at Baloji's Cafe", {
                body: `#${order.id} · ${order.name || ''} · ₹${order.total}`,
                tag: `order-${order.id}`
            });
        } catch {
            /* ignore */
        }
    }
}

function getAudioContext() {
    if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        audioCtx = new Ctx();
    }
    return audioCtx;
}

async function unlockAudio() {
    const ctx = getAudioContext();
    if (!ctx) return false;
    try {
        if (ctx.state !== 'running') {
            await ctx.resume();
        }
        audioUnlocked = ctx.state === 'running';
        return audioUnlocked;
    } catch {
        return false;
    }
}

async function playNewOrderAlert() {
    try {
        const ctx = getAudioContext();
        if (!ctx || !audioUnlocked) return;

        // Some browsers suspend audio in background tabs. If the user already
        // enabled sound once, resuming often succeeds without a new click.
        if (ctx.state !== 'running') {
            try {
                await ctx.resume();
            } catch {
                /* ignore resume errors */
            }
        }

        if (ctx.state !== 'running') return;
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, ctx.currentTime);
        // Louder + sharper: faster attack, slightly higher peak, quicker decay.
        master.gain.exponentialRampToValueAtTime(1.0, ctx.currentTime + 0.01);
        master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.0);
        master.connect(ctx.destination);

        const makeTone = (freq, start, duration, type = 'sine', peak = 0.36, detune = 0) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, start);
            osc.detune.setValueAtTime(detune, start);
            gain.gain.setValueAtTime(0.0001, start);
            // Very fast attack + shorter decay => "sharp" bell edge.
            gain.gain.exponentialRampToValueAtTime(peak, start + 0.006);
            gain.gain.exponentialRampToValueAtTime(peak * 0.45, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
            osc.connect(gain);
            gain.connect(master);
            osc.start(start);
            osc.stop(start + duration + 0.03);
        };

        const ringBurst = (start) => {
            // Telephone bell-like dual partials with a metallic pulse.
            makeTone(440, start, 0.20, 'triangle', 0.42, -6);
            makeTone(480, start, 0.20, 'triangle', 0.34, 6);
            makeTone(880, start + 0.008, 0.13, 'sine', 0.18);

            makeTone(440, start + 0.13, 0.20, 'triangle', 0.42, -6);
            makeTone(480, start + 0.13, 0.20, 'triangle', 0.34, 6);
            makeTone(880, start + 0.138, 0.13, 'sine', 0.18);
        };

        const t = ctx.currentTime;
        // Classic telephone bell cadence: ring-ring, pause, ring-ring.
        ringBurst(t);
        ringBurst(t + 0.72);
        ringBurst(t + 1.44);
    } catch {
        /* ignore */
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate([350, 120, 350, 120, 350, 120, 350]);
    }
}

function startRingingUntilHandled() {
    if (ringingTimer) return;
    if (!audioUnlocked) {
        showToast('Tap anywhere on this page once to enable ringing sound.');
    }
    playNewOrderAlert();
    ringingTimer = setInterval(() => {
        playNewOrderAlert();
    }, 1400);
}

function stopRingingIfAny() {
    if (!ringingTimer) return;
    clearInterval(ringingTimer);
    ringingTimer = null;
}

function updateSoundButtonState() {
    const btn = document.getElementById('adminEnableSoundBtn');
    if (!btn) return;
    btn.classList.toggle('admin-icon-btn--on', audioUnlocked);
    btn.title = audioUnlocked ? 'Sound enabled' : 'Enable sound';
    btn.setAttribute('aria-label', audioUnlocked ? 'Sound enabled' : 'Enable sound');
}

document.addEventListener('DOMContentLoaded', () => {
    const listEl = document.getElementById('adminOrderList');
    const tabsEl = document.getElementById('adminTabs');
    const searchInput = document.getElementById('adminSearchInput');
    const btnToggleDensity = document.getElementById('btnToggleDensity');
    const btnToggleDensityState = document.getElementById('btnToggleDensityState');
    const btnCopyTodaySummary = document.getElementById('btnCopyTodaySummary');
    const btnDownloadCsv = document.getElementById('btnDownloadCsv');
    const refreshBtn = document.getElementById('adminRefreshBtn');
    const enableSoundBtn = document.getElementById('adminEnableSoundBtn');
    const enableNotifyBtn = document.getElementById('adminEnableNotifyBtn');
    const logoutBtn = document.getElementById('adminLogoutBtn');
    const authForm = document.getElementById('adminAuthForm');
    const authSubmit = document.getElementById('adminAuthSubmit');
    const authUser = document.getElementById('adminUsername');
    const authPass = document.getElementById('adminPassword');
    const modalEl = document.getElementById('adminNewOrderModal');
    const popupTitleEl = document.getElementById('adminNewOrderTitle');
    const popupSubtitleEl = document.getElementById('adminNewOrderSubtitle');
    const popupDetailsEl = document.getElementById('adminNewOrderDetails');
    const popupCloseBtn = document.getElementById('adminNewOrderCloseBtn');
    const popupAcceptBtn = document.getElementById('adminNewOrderAcceptBtn');
    const popupRejectBtn = document.getElementById('adminNewOrderRejectBtn');

    fillAdminDefaults();

    const hashKey = String(window.location.hash || '').replace(/^#/, '').trim();
    if (ORDER_STATUS_TABS.some((t) => t.key === hashKey)) {
        activeOrderTab = hashKey;
    }
    if (!window.location.hash) {
        window.location.hash = `#${activeOrderTab}`;
    }

    function hideNewOrderPopup() {
        if (modalEl) modalEl.hidden = true;
        newOrderPopupOpen = false;
        newOrderPopupOrderId = null;
    }

    function showNewOrderPopup(order) {
        if (!modalEl) return;
        const id = String(order.id);
        popupTitleEl.textContent = `New order #${id}`;
        popupSubtitleEl.textContent = `${order.name || ''} · ₹${Number(order.total) || 0}`;
        popupDetailsEl.innerHTML = buildNewOrderPopupDetails(order);
        modalEl.hidden = false;
        newOrderPopupOpen = true;
        newOrderPopupOrderId = id;
    }

    function getCountsByStatus(orders) {
        const counts = {};
        for (const tab of ORDER_STATUS_TABS) counts[tab.key] = 0;
        counts.all = 0;
        for (const o of orders) {
            if (counts[o.status] !== undefined) counts[o.status] += 1;
            counts.all += 1;
        }
        return counts;
    }

    function normalizeSearch(s) {
        return String(s || '').trim().toLowerCase();
    }

    function matchesSearch(order, q) {
        if (!q) return true;
        const id = String(order.id || '').toLowerCase();
        const name = String(order.name || '').toLowerCase();
        const mobile = String(order.mobile || '').toLowerCase();
        const city = String(order.city || '').toLowerCase();
        return id.includes(q) || name.includes(q) || mobile.includes(q) || city.includes(q);
    }

    function renderTabsAndActiveList(orders) {
        const q = normalizeSearch(searchInput?.value);
        const searched = q ? orders.filter((o) => matchesSearch(o, q)) : orders;
        const countsByStatus = getCountsByStatus(searched);
        renderAdminAnalytics(orders);
        renderOrderTabs(tabsEl, countsByStatus, activeOrderTab);
        const tab = ORDER_STATUS_TABS.find((t) => t.key === activeOrderTab) || ORDER_STATUS_TABS[0];
        const filteredBase = activeOrderTab === 'all' ? searched : searched.filter((o) => o.status === activeOrderTab);
        const filtered = filteredBase;
        const emptyText = q ? 'matching orders' : (tab.emptyText || 'orders');
        renderOrders(filtered, listEl, emptyText);
    }

    tabsEl?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-status]');
        if (!btn) return;
        const nextKey = String(btn.getAttribute('data-status') || '');
        if (!ORDER_STATUS_TABS.some((t) => t.key === nextKey)) return;
        if (nextKey === activeOrderTab) return;
        activeOrderTab = nextKey;
        window.location.hash = `#${activeOrderTab}`;
        renderTabsAndActiveList(lastOrders);
    });

    searchInput?.addEventListener('input', () => {
        renderTabsAndActiveList(lastOrders);
    });

    const DENSITY_KEY = 'balojiAdminDensity';
    const applyDensity = (value) => {
        const compact = value === 'compact';
        document.body.classList.toggle('admin-density-compact', compact);
        if (btnToggleDensityState) btnToggleDensityState.textContent = compact ? 'Compact' : 'Comfort';
    };
    const storedDensity = (() => {
        try { return localStorage.getItem(DENSITY_KEY) || ''; } catch { return ''; }
    })();
    applyDensity(storedDensity);

    btnToggleDensity?.addEventListener('click', () => {
        const next = document.body.classList.contains('admin-density-compact') ? 'comfort' : 'compact';
        try { localStorage.setItem(DENSITY_KEY, next); } catch { /* ignore */ }
        applyDensity(next);
    });

    btnCopyTodaySummary?.addEventListener('click', async () => {
        const data = computeAdminAnalytics(lastOrders || []);
        const lines = [
            `Baloji's Cafe — Today summary`,
            `Updated: ${data.updatedAt.toLocaleString()}`,
            `Orders today: ${data.ordersTodayCount}`,
            `Revenue today: ${formatMoney(data.revenueToday)}`,
            `Avg order today: ${formatMoney(data.avgOrderToday)}`,
            `Discounts today: ${formatMoney(data.discountsToday)}`,
            `Delivery today: ${formatMoney(data.deliveryFeesToday)}`,
            `Last 60 min: ${data.last60MinOrders} orders · ${formatMoney(data.last60MinRevenue)}`,
            `Oldest pending: ${data.oldestPendingMs == null ? '—' : formatDuration(data.oldestPendingMs)}`,
            `Oldest in-progress: ${data.oldestInProgressMs == null ? '—' : formatDuration(data.oldestInProgressMs)}`,
            `Loaded totals: ${data.totalOrdersLoaded} orders · ${formatMoney(data.totalEarningLoaded)}`
        ];
        const ok = await safeClipboardWrite(lines.join('\n'));
        showToast(ok ? 'Summary copied' : 'Could not copy summary');
    });

    btnDownloadCsv?.addEventListener('click', () => {
        const rows = (lastOrders || []).map((o) => ({
            id: o.id,
            status: o.status,
            name: o.name,
            mobile: o.mobile,
            city: o.city,
            subtotal: o.subtotal,
            delivery_fee: o.delivery_fee,
            discount: o.discount,
            total: o.total,
            created_at: o.created_at,
            updated_at: o.updated_at
        }));
        const header = Object.keys(rows[0] || { id: '', status: '', name: '', mobile: '', city: '', total: '', created_at: '' });
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv = [
            header.join(','),
            ...rows.map((r) => header.map((k) => esc(r[k])).join(','))
        ].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    const updateNotifyButtonState = () => {
        if (!enableNotifyBtn) return;
        if (typeof Notification === 'undefined') {
            enableNotifyBtn.hidden = true;
            return;
        }
        if (Notification.permission === 'granted') {
            enableNotifyBtn.hidden = true;
            return;
        }
        enableNotifyBtn.hidden = false;
        enableNotifyBtn.classList.toggle('admin-icon-btn--on', Notification.permission === 'granted');
        const tip =
            Notification.permission === 'denied'
                ? 'Notifications blocked in browser settings'
                : 'Enable notifications';
        enableNotifyBtn.setAttribute('data-tip', Notification.permission === 'denied' ? 'Notifications blocked' : 'Notifications');
        enableNotifyBtn.setAttribute(
            'aria-label',
            Notification.permission === 'denied'
                ? 'Notifications blocked'
                : 'Enable notifications'
        );
        enableNotifyBtn.title = tip; // fallback tooltip for touch / long-press
        enableNotifyBtn.disabled = Notification.permission === 'denied';
    };
    updateNotifyButtonState();

    enableNotifyBtn?.addEventListener('click', async () => {
        if (typeof Notification === 'undefined') return;
        try {
            await Notification.requestPermission();
        } finally {
            updateNotifyButtonState();
        }
    });

    popupCloseBtn?.addEventListener('click', () => {
        if (!newOrderPopupOpen) {
            hideNewOrderPopup();
            return;
        }

        const currentId = newOrderPopupOrderId;
        if (pendingPopupQueue.length) {
            const idx = pendingPopupQueue.findIndex((o) => String(o.id) === currentId);
            if (idx >= 0) {
                const [item] = pendingPopupQueue.splice(idx, 1);
                pendingPopupQueue.push(item);
            } else {
                const first = pendingPopupQueue.shift();
                if (first) pendingPopupQueue.push(first);
            }
        }

        hideNewOrderPopup();

        const pendingSet = new Set(
            (lastOrders || []).filter((o) => o.status === 'pending').map((o) => String(o.id))
        );
        const next = pendingPopupQueue[0];
        if (next && pendingSet.has(String(next.id))) {
            showNewOrderPopup(next);
        }
    });

    async function handleNewOrderPopupAction(action) {
        const id = newOrderPopupOrderId;
        if (!id) return;

        if (popupAcceptBtn) popupAcceptBtn.disabled = true;
        if (popupRejectBtn) popupRejectBtn.disabled = true;

        try {
            await patchOrder(id, action);
            hideNewOrderPopup();
            await refresh();
        } catch (err) {
            if (err && err.code === 401) {
                clearAdminCredentials();
                showAdminGate('Session expired. Enter admin credentials again.');
            } else {
                alert(err && err.message ? err.message : 'Update failed');
            }
        } finally {
            if (popupAcceptBtn) popupAcceptBtn.disabled = false;
            if (popupRejectBtn) popupRejectBtn.disabled = false;
        }
    }

    popupAcceptBtn?.addEventListener('click', () => handleNewOrderPopupAction('accept'));
    popupRejectBtn?.addEventListener('click', () => handleNewOrderPopupAction('reject'));

    const seenPending = loadSeenIds();
    let lastOrderId = loadLastOrderId();
    let bootstrapped = false;

    const unlockHandler = async () => {
        const ok = await unlockAudio();
        updateSoundButtonState();
        if (ok && ringingOrderIds.size > 0) {
            playNewOrderAlert();
        }
    };
    document.addEventListener('click', unlockHandler, { passive: true });
    document.addEventListener('keydown', unlockHandler);
    document.addEventListener('touchstart', unlockHandler, { passive: true });

    enableSoundBtn?.addEventListener('click', async () => {
        const ok = await unlockAudio();
        updateSoundButtonState();
        if (ok && ringingOrderIds.size > 0) {
            playNewOrderAlert();
        }
    });

    document.addEventListener('visibilitychange', async () => {
        // After you previously tapped/clicked this page, some browsers suspend audio in background tabs.
        // When the tab becomes visible again, try resuming (no-op if the browser still blocks it).
        if (!document.hidden) {
            const ok = await unlockAudio();
            updateSoundButtonState();
            if (ok && ringingOrderIds.size > 0) {
                playNewOrderAlert();
            }
        }
    });

    updateSoundButtonState();

    async function refresh() {
        try {
            const orders = await fetchOrders();
            lastOrders = orders;
            renderTabsAndActiveList(orders);
            const pendingSet = new Set(
                orders.filter((o) => o.status === 'pending').map((o) => String(o.id))
            );

            // Drop handled/obsolete items from the popup queue.
            pendingPopupQueue = pendingPopupQueue.filter((o) => pendingSet.has(String(o.id)));
            pendingPopupQueueIds = new Set(pendingPopupQueue.map((o) => String(o.id)));

            // If the popup was open, ensure it still corresponds to a pending order.
            if (newOrderPopupOpen && newOrderPopupOrderId && !pendingSet.has(newOrderPopupOrderId)) {
                hideNewOrderPopup();
            }

            // Show the next queued pending order (one-at-a-time).
            if (!newOrderPopupOpen) {
                const next = pendingPopupQueue[0];
                if (next && pendingSet.has(String(next.id))) {
                    showNewOrderPopup(next);
                }
            }

            // Stop ringing for orders that were handled.
            for (const id of [...ringingOrderIds]) {
                if (!pendingSet.has(id)) {
                    ringingOrderIds.delete(id);
                }
            }
            if (ringingOrderIds.size === 0) {
                stopRingingIfAny();
            }

            if (orders.length > 0) {
                const latest = parseInt(String(orders[0].id), 10);
                if (Number.isFinite(latest) && latest > lastOrderId) {
                    lastOrderId = latest;
                    saveLastOrderId(lastOrderId);
                }
            }

            if (!bootstrapped) {
                orders
                    .filter((o) => o.status === 'pending')
                    .forEach((o) => seenPending.add(String(o.id)));
                saveSeenIds(seenPending);
                bootstrapped = true;
                return;
            }

            for (const o of orders) {
                const sid = String(o.id);
                if (o.status === 'pending' && !seenPending.has(sid)) {
                    seenPending.add(sid);
                    saveSeenIds(seenPending);
                    showToast(`New order #${sid}`);
                    maybeNotifyNewOrder(o);
                    ringingOrderIds.add(sid);
                    startRingingUntilHandled();

                    if (!pendingPopupQueueIds.has(sid)) {
                        pendingPopupQueue.push(o);
                        pendingPopupQueueIds.add(sid);
                    }

                    if (!newOrderPopupOpen) {
                        const next = pendingPopupQueue[0];
                        if (next) showNewOrderPopup(next);
                    }
                }
            }
        } catch (e) {
            if (e && e.code === 401) {
                if (refreshTimer) {
                    clearInterval(refreshTimer);
                    refreshTimer = null;
                }
                clearAdminCredentials();
                hideNewOrderPopup();
                pendingPopupQueue = [];
                pendingPopupQueueIds = new Set();
                showAdminGate('Enter valid admin credentials to continue.');
                listEl.innerHTML = '<p class="admin-empty">Admin login required.</p>';
                return;
            }
            listEl.innerHTML = `<p class="admin-error">${escapeHtml(e.message)}</p>`;
        }
    }

    listEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (!id || !action) return;
        btn.disabled = true;
        try {
            await patchOrder(id, action);
            await refresh();
        } catch (err) {
            if (err && err.code === 401) {
                clearAdminCredentials();
                hideNewOrderPopup();
                showAdminGate('Session expired. Enter admin credentials again.');
            } else {
                alert(err.message || 'Update failed');
            }
        } finally {
            btn.disabled = false;
        }
    });

    if (refreshBtn) refreshBtn.addEventListener('click', () => refresh());
    logoutBtn?.addEventListener('click', () => {
        clearAdminCredentials();
        hideNewOrderPopup();
        pendingPopupQueue = [];
        pendingPopupQueueIds = new Set();
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
        showAdminGate('Admin credentials removed from this browser.');
        listEl.innerHTML = '<p class="admin-empty">Login required to view orders.</p>';
    });

    authForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const user = ((authUser?.value || '').trim() || DEFAULT_ADMIN_USER);
        const pass = String(authPass?.value || DEFAULT_ADMIN_PASS).trim();
        if (!user || !pass) {
            showAdminGate('Enter both username and password.');
            return;
        }
        if (authSubmit) {
            authSubmit.disabled = true;
            authSubmit.textContent = 'Checking...';
        }
        const ok = await verifyAdminCredentials(user, pass).catch(() => false);
        if (!ok) {
            clearAdminCredentials();
            showAdminGate('Invalid admin credentials. Please try again.');
        } else {
            saveAdminCredentials(user, pass);
            hideAdminGate();
            await refresh();
            if (!refreshTimer) {
                refreshTimer = setInterval(refresh, 2500);
            }
        }
        if (authSubmit) {
            authSubmit.disabled = false;
            authSubmit.textContent = 'Continue';
        }
    });

    const initAdmin = async () => {
        const savedCreds = loadAdminCredentials();
        currentAdminCredentials = savedCreds;
        if (!savedCreds) {
            showAdminGate();
            hideNewOrderPopup();
            pendingPopupQueue = [];
            pendingPopupQueueIds = new Set();
            listEl.innerHTML = '<p class="admin-empty">Login required to view orders.</p>';
            return;
        }

        const ok = await verifyAdminCredentials(savedCreds.user, savedCreds.pass).catch(() => false);
        if (!ok) {
            clearAdminCredentials();
            showAdminGate('Invalid saved admin credentials. Please log in again.');
            hideNewOrderPopup();
            pendingPopupQueue = [];
            pendingPopupQueueIds = new Set();
            listEl.innerHTML = '<p class="admin-empty">Login required to view orders.</p>';
            return;
        }

        hideAdminGate();
        refresh();
        refreshTimer = setInterval(refresh, 2500);
    };

    initAdmin();
});
