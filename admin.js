'use strict';

const DEFAULT_ADMIN_USER = 'quickkartcafe';
const DEFAULT_ADMIN_PASS = 'admin';
const SESSION_STORAGE_SEEN = 'quickkartAdminSeenPendingIds';
const SESSION_STORAGE_LAST_ORDER = 'quickkartAdminLastOrderId';
let currentVenue = null;
let floorConfig = { tableCount: 7, parcelCount: 5 };
let managedHotels = [];
/** True when at least one partner venue has venueType === 'grocery' (main admin only). */
let hasGroceryStores = false;
let groceryInventoryInitialized = false;

const ORDER_STATUS_TABS = [
    { key: 'active', label: 'Active', emptyText: 'active orders' },
    { key: 'pending', label: 'New orders', emptyText: 'new orders' },
    { key: 'accepted', label: 'Accepted', emptyText: 'accepted orders' },
    { key: 'preparing', label: 'Preparing', emptyText: 'preparing orders' },
    { key: 'out_for_delivery', label: 'Out for delivery', emptyText: 'out for delivery orders' },
    { key: 'completed', label: 'Completed', emptyText: 'completed orders' },
    { key: 'rejected', label: 'Restaurant cancelled', emptyText: 'restaurant-cancelled orders' },
    { key: 'cancelled', label: 'Customer cancelled', emptyText: 'customer-cancelled orders' },
    { key: 'kot', label: 'KOT orders', emptyText: 'KOT orders', isKot: true },
    { key: 'grocery', label: 'Grocery', emptyText: 'grocery orders' },
    { key: 'all', label: 'All delivery', emptyText: 'delivery orders' }
];

function isGroceryOrder(o) {
    return o && String(o.channel || '').toLowerCase() === 'grocery';
}

let activeOrderTab = 'active';
/** Delivery order ids to keep visible after a status change until the user picks another tab. */
let pinnedOrderIdsAfterStatusChange = new Set();
let lastOrders = [];

/** Mobile layout hides search + status filters; always show the active queue. */
function isAdminMobileView() {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches;
}

function getEffectiveOrderTab() {
    return isAdminMobileView() ? 'active' : activeOrderTab;
}

// New pending orders are queued and shown one-by-one in a popup.
let pendingPopupQueue = [];
let pendingPopupQueueIds = new Set();
let newOrderPopupOpen = false;
let newOrderPopupOrderId = null;
/** Set when the user signs in manually so a slow boot check cannot wipe the session. */
let adminManualLoginDone = false;

async function failAdminBoot(message) {
    clearAdminCredentials();
    window.location.href = '/admin-login' + (message ? '?error=' + encodeURIComponent(message) : '');
    return true;
}

function adminSessionHooks() {
    return {
        onVenue: (venue) => {
            currentVenue = venue;
            updateVenueHeader();
        },
        onFloorConfig: (cfg) => {
            floorConfig = {
                tableCount: Number(cfg.tableCount) || 7,
                parcelCount: Number(cfg.parcelCount) || 5
            };
        }
    };
}

function adminHeaders(extra = {}) {
    return window.quickkartAdminAuth.adminAuthHeaders(extra);
}

function clearAdminCredentials() {
    window.quickkartAdminAuth.clearAdminToken();
}

function hasAdminSession() {
    return !!window.quickkartAdminAuth.loadAdminToken();
}

function setAdminOrderListLoading(message, options = {}) {
    const listEl = document.getElementById('adminOrderList');
    if (!listEl) return;
    window.quickkartAdminAuth.setSectionLoader(listEl, message || 'Loading orders…', {
        overlay: options.overlay
    });
}

function setAdminTabsLoading(message, options = {}) {
    const tabsEl = document.getElementById('adminTabs');
    if (!tabsEl) return;
    window.quickkartAdminAuth.setSectionLoader(tabsEl, message || 'Loading filters…', {
        overlay: options.overlay
    });
}

function setAdminAnalyticsLoading(message, options = {}) {
    const analyticsEl = document.getElementById('adminDesktopAnalytics');
    if (!analyticsEl) return;
    window.quickkartAdminAuth.setSectionLoader(analyticsEl, message || 'Updating analytics…', {
        overlay: options.overlay !== false
    });
}

function clearAdminOrderListLoading() {
    window.quickkartAdminAuth.clearSectionLoader(document.getElementById('adminOrderList'));
}

function clearAdminTabsLoading() {
    window.quickkartAdminAuth.clearSectionLoader(document.getElementById('adminTabs'));
}

function clearAdminAnalyticsLoading() {
    window.quickkartAdminAuth.clearSectionLoader(document.getElementById('adminDesktopAnalytics'));
}

function setAdminDashboardLoading(message, options = {}) {
    const text = message || 'Loading…';
    setAdminOrderListLoading(text, options);
    setAdminTabsLoading(text, options);
    if (options.overlay) setAdminAnalyticsLoading(text, options);
}

function clearAdminDashboardLoading() {
    clearAdminOrderListLoading();
    clearAdminTabsLoading();
    clearAdminAnalyticsLoading();
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
        rejected: 'Cancelled',
        cancelled: 'Customer cancelled',
        preparing: 'Preparing',
        out_for_delivery: 'Out for delivery',
        completed: 'Completed'
    };
    return map[status] || status;
}

function readOrderMeta(o) {
    let m = o && o.order_meta;
    if (m == null) return {};
    if (typeof m === 'string') {
        try {
            m = JSON.parse(m);
        } catch {
            return {};
        }
    }
    return m && typeof m === 'object' ? m : {};
}

/** Dine-in / parcel orders managed on the floor KOT screen (not delivery workflow). */
function isCancelledOrderStatus(status) {
    const s = String(status || '')
        .trim()
        .toLowerCase();
    return s === 'cancelled' || s === 'rejected';
}

function isUnsettledOrder(o) {
    const s = String(o && o.status ? o.status : '')
        .trim()
        .toLowerCase();
    return s !== 'completed' && !isCancelledOrderStatus(s);
}

function showInActiveOrdersTab(o, pinnedIds) {
    if (isCancelledOrderStatus(o && o.status)) return false;
    return isUnsettledOrder(o) || pinnedIds.has(String(o.id));
}

function isKotFloorOrder(o) {
    const ch = String(o && o.channel ? o.channel : '')
        .trim()
        .toLowerCase();
    return ch === 'dine_in' || ch === 'parcel';
}

function formatKotSlotLabel(o) {
    const meta = readOrderMeta(o);
    const slot = String(meta.slot || '').trim();
    const tm = /^table:(\d+)$/i.exec(slot);
    if (tm) return `Table ${tm[1]}`;
    const pm = /^parcel:(\d+)$/i.exec(slot);
    if (pm) return `Parcel ${pm[1]}`;
    if (slot) return slot;
    const ch = String(o && o.channel ? o.channel : '')
        .trim()
        .toLowerCase();
    if (ch === 'dine_in') return 'Dine-in';
    if (ch === 'parcel') return 'Parcel';
    return 'Floor';
}

function kotChannelLabel(o) {
    const ch = String(o && o.channel ? o.channel : '')
        .trim()
        .toLowerCase();
    if (ch === 'dine_in') return 'Dine-in KOT';
    if (ch === 'parcel') return 'Parcel KOT';
    return 'KOT';
}

function kotKotCount(o) {
    const meta = readOrderMeta(o);
    const kots = Array.isArray(meta.kots) ? meta.kots : [];
    return kots.length;
}

/** Short floor-oriented label (not the full delivery status strip). */
function kotFloorProgressLabel(o) {
    const s = String(o && o.status ? o.status : '')
        .trim()
        .toLowerCase();
    if (s === 'completed') return 'Settled';
    if (s === 'rejected') return 'Voided';
    if (s === 'cancelled') return 'Cancelled';
    if (s === 'pending') return 'Pending';
    return 'Open on floor';
}

function orderPaymentMethod(o) {
    const pm = String(readOrderMeta(o).payment_method || '')
        .trim()
        .toUpperCase();
    return pm === 'CASH' || pm === 'UPI' ? pm : null;
}

function formatPaymentPillHtml(o) {
    const pm = orderPaymentMethod(o);
    if (pm === 'CASH') return '<span class="admin-pay-pill admin-pay-pill--cash">Cash</span>';
    if (pm === 'UPI') return '<span class="admin-pay-pill admin-pay-pill--upi">UPI</span>';
    return '';
}

function isDeliveryChannelOrder(o) {
    const ch = String(o && o.channel ? o.channel : 'delivery')
        .trim()
        .toLowerCase();
    return ch !== 'dine_in' && ch !== 'parcel';
}

function matchesAdminOrderSearch(order, q) {
    if (!q) return true;
    const id = String(order.id || '').toLowerCase();
    const name = String(order.name || '').toLowerCase();
    const mobile = String(order.mobile || '').toLowerCase();
    const city = String(order.city || '').toLowerCase();
    if (id.includes(q) || name.includes(q) || mobile.includes(q) || city.includes(q)) return true;
    if (isKotFloorOrder(order)) {
        const slot = formatKotSlotLabel(order).toLowerCase();
        if (slot.includes(q)) return true;
        const gl = String(readOrderMeta(order).guest_label || '')
            .trim()
            .toLowerCase();
        if (gl.includes(q)) return true;
    }
    return false;
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

function normalizeOrdersFromApi(orders) {
    return (orders || []).map((o) => {
        if (!o || typeof o !== 'object') return o;
        const status = String(o.status ?? '')
            .trim()
            .toLowerCase();
        return { ...o, status };
    });
}

async function fetchOrders() {
    const res = await fetch('/api/admin/orders', {
        headers: adminHeaders(),
        cache: 'no-store'
    });
    if (res.status === 401) throw Object.assign(new Error('Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(`Could not load orders (${res.status})`);
    const data = await res.json();
    return normalizeOrdersFromApi(data.orders || []);
}

async function patchOrder(orderId, action, extra = {}) {
    const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: {
            ...adminHeaders(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action, ...extra })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data.order;
}

async function fetchStoreStatus() {
    const res = await fetch('/api/admin/store-status', {
        headers: adminHeaders(),
        cache: 'no-store'
    });
    if (res.status === 401) throw Object.assign(new Error('Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(`Could not load store status (${res.status})`);
    return res.json();
}

async function saveStoreStatus(acceptingOrders, reason) {
    const res = await fetch('/api/admin/store-status', {
        method: 'POST',
        headers: {
            ...adminHeaders(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ acceptingOrders, reason })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
}

async function verifyAdminCredentials(user, pass) {
    try {
        return await window.quickkartAdminAuth.adminLogin(user, pass, adminSessionHooks());
    } catch {
        return null;
    }
}

function updateVenueHeader() {
    const title = document.getElementById('adminVenueTitle');
    if (title && currentVenue && currentVenue.name) {
        const suffix = isGroceryVenue() ? 'Grocery' : 'Orders';
        title.textContent = `${currentVenue.name} — ${suffix}`;
    }
    applyMainVenueUi();
}

function isMainAdminVenue() {
    return Boolean(currentVenue && currentVenue.isMain);
}

function isGroceryVenue() {
    return Boolean(currentVenue && currentVenue.venueType === 'grocery');
}

function isFoodPartnerVenue() {
    return Boolean(currentVenue && !currentVenue.isMain && !isGroceryVenue());
}

function getAdminPanelMode() {
    if (isGroceryVenue()) return 'grocery';
    if (isFoodPartnerVenue()) return 'hotel';
    if (isMainAdminVenue()) return 'main';
    return 'unknown';
}

/** Orders scoped to the logged-in admin role (never mix grocery + hotel in one view). */
function filterOrdersForAdminView(orders) {
    const list = Array.isArray(orders) ? orders : [];
    if (isGroceryVenue()) return list.filter((o) => isGroceryOrder(o));
    if (isFoodPartnerVenue()) return list.filter((o) => !isGroceryOrder(o));
    return list;
}

function shouldShowGroceryOrderTab(countsByStatus) {
    if (isGroceryVenue()) return false;
    if (!isMainAdminVenue()) return false;
    const groceryCount =
        countsByStatus && typeof countsByStatus === 'object' ? countsByStatus.grocery ?? 0 : 0;
    return hasGroceryStores || groceryCount > 0;
}

function isOrderTabVisible(tab, countsByStatus) {
    if (tab.key === 'kot') return !isGroceryVenue();
    if (tab.key === 'grocery') return shouldShowGroceryOrderTab(countsByStatus);
    return true;
}

function normalizeActiveOrderTab() {
    const visible = ORDER_STATUS_TABS.filter((t) => isOrderTabVisible(t, {}));
    if (!visible.some((t) => t.key === activeOrderTab)) {
        activeOrderTab = visible[0]?.key || 'active';
        if (window.location.hash.replace(/^#/, '') !== activeOrderTab) {
            window.location.hash = `#${activeOrderTab}`;
        }
    }
}

async function refreshGroceryStorePresence() {
    if (!isMainAdminVenue()) {
        hasGroceryStores = false;
        applyMainVenueUi();
        return;
    }
    try {
        await fetchManagedHotels();
        hasGroceryStores = managedHotels.some((v) => v.venueType === 'grocery');
    } catch {
        hasGroceryStores = false;
    }
    applyMainVenueUi();
    normalizeActiveOrderTab();
}

function applyMainVenueUi() {
    const isMain = isMainAdminVenue();
    const isGrocery = isGroceryVenue();
    const isFoodPartner = isFoodPartnerVenue();

    document.body.classList.toggle('admin-mode-main', isMain);
    document.body.classList.toggle('admin-mode-grocery', isGrocery);
    document.body.classList.toggle('admin-mode-hotel', isFoodPartner);

    const btn = document.getElementById('adminHotelsBtn');
    if (btn) btn.hidden = !isMain;

    const dzBtn2 = document.getElementById('adminDeliveryZonesBtn');
    if (dzBtn2) dzBtn2.hidden = false;

    const menuBtn = document.getElementById('adminPartnerMenuBtn');
    if (menuBtn) {
        menuBtn.hidden = isGrocery;
        menuBtn.setAttribute('data-tip', 'Hotel menu');
        menuBtn.setAttribute('aria-label', 'Edit hotel menu');
    }

    const invBtn = document.getElementById('adminGroceryInventoryBtn');
    if (invBtn) {
        invBtn.hidden = !((isMain && hasGroceryStores) || isGrocery);
        invBtn.setAttribute('data-tip', isGrocery ? 'Inventory' : 'Grocery inventory');
        invBtn.setAttribute('aria-label', isGrocery ? 'Manage inventory' : 'Manage grocery inventory');
    }

    const profileBtn = document.getElementById('adminVenueProfileBtn');
    if (profileBtn) {
        profileBtn.hidden = isGrocery;
        profileBtn.setAttribute('data-tip', isGrocery ? 'Store info' : 'Hotel info');
        profileBtn.setAttribute('aria-label', isGrocery ? 'Edit store info' : 'Edit hotel info');
        profileBtn.textContent = isGrocery ? '🏪' : '🏨';
    }

    const floorLink = document.getElementById('adminFloorLink');
    if (floorLink) floorLink.hidden = isGrocery;

    const floorConfigBtn = document.getElementById('adminFloorConfigBtn');
    if (floorConfigBtn) floorConfigBtn.hidden = isGrocery;

    const hotelsCreateSection = document.getElementById('adminHotelsCreateSection');
    if (hotelsCreateSection) hotelsCreateSection.hidden = !isMain;

    const hotelsModalSub = document.getElementById('adminHotelsModalSub');
    if (hotelsModalSub) {
        hotelsModalSub.textContent = isMain
            ? 'QuickKart is the main hotel. Create other hotels here and give each its own admin login.'
            : 'Hotel details for your property.';
    }

    const roleBanner = document.getElementById('adminRoleBanner');
    if (roleBanner) {
        if (isGrocery) {
            roleBanner.hidden = false;
            roleBanner.textContent =
                'Grocery store admin — manage inventory, stock, and grocery delivery orders.';
        } else if (isFoodPartner) {
            roleBanner.hidden = false;
            roleBanner.textContent =
                'Hotel admin — manage your menu, online orders, and hotel details.';
        } else if (isMain) {
            roleBanner.hidden = true;
            roleBanner.textContent = '';
        } else {
            roleBanner.hidden = true;
            roleBanner.textContent = '';
        }
    }

    const floorMetric = document.getElementById('adminMetricFloor');
    if (floorMetric) floorMetric.hidden = isGrocery;

    normalizeActiveOrderTab();
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function fetchManagedHotels() {
    const res = await fetch('/api/admin/venues', {
        headers: adminHeaders(),
        cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(data.error || res.statusText);
    managedHotels = Array.isArray(data.venues) ? data.venues : [];
    return managedHotels;
}

async function createManagedHotel(payload) {
    const res = await fetch('/api/admin/venues', {
        method: 'POST',
        headers: {
            ...adminHeaders(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data.venue;
}

async function updateManagedHotelAccess(venueId, payload) {
    const res = await fetch(`/api/admin/venues/${venueId}`, {
        method: 'PATCH',
        headers: {
            ...adminHeaders(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data.venue;
}

function renderManagedHotelsList() {
    const listEl = document.getElementById('adminHotelsList');
    if (!listEl) return;
    if (!managedHotels.length) {
        listEl.innerHTML = '<p class="admin-modal-sub" style="margin:0;">No hotels yet.</p>';
        return;
    }
    listEl.innerHTML = managedHotels
        .map((hotel) => {
            const isGrocery = hotel.venueType === 'grocery';
            const badge = hotel.isMain
                ? '<span class="admin-hotel-badge">Main</span>'
                : isGrocery
                  ? '<span class="admin-hotel-badge" style="background:#7c3aed;">Grocery</span>'
                  : '';
            const accessFields = hotel.isMain
                ? ''
                : `<label class="admin-search">
                           <span>Admin username</span>
                           <input type="text" data-hotel-user="${hotel.id}" value="${escapeHtml(hotel.adminUser || '')}">
                       </label>
                       <label class="admin-search">
                           <span>New password (optional)</span>
                           <input type="password" data-hotel-pass="${hotel.id}" autocomplete="new-password" placeholder="Leave blank to keep current">
                       </label>`;
            const catalogBtn = isGrocery
                ? `<button type="button" class="admin-hotel-edit-btn" data-hotel-inventory="${hotel.id}">Inventory</button>`
                : `<button type="button" class="admin-hotel-edit-btn" data-hotel-menu="${hotel.id}"${hotel.isMain ? ' hidden' : ''}>Menu</button>`;
            const editBtn = `${catalogBtn}
                   <button type="button" class="admin-hotel-edit-btn" data-hotel-edit="${hotel.id}">Hotel details</button>
                   <div class="admin-hotel-edit-form" id="adminHotelEditForm-${hotel.id}" hidden>
                       ${accessFields}
                       <label class="admin-search">
                           <span>Hotel number</span>
                           <input type="tel" data-hotel-contact="${hotel.id}" value="${escapeHtml(hotel.contactMobile || '')}">
                       </label>
                       <label class="admin-search">
                           <span>Hotel timing</span>
                           <input type="text" data-hotel-hours="${hotel.id}" value="${escapeHtml(hotel.hoursText || '')}">
                       </label>
                       <button type="button" class="admin-hotel-edit-btn" data-hotel-save="${hotel.id}">Save details</button>
                   </div>`;
            const contactMeta = hotel.contactMobile
                ? `${escapeHtml(hotel.contactMobile)}${hotel.hoursText ? ` · ${escapeHtml(hotel.hoursText)}` : ''}`
                : '—';
            return `<div class="admin-hotel-row">
                <div class="admin-hotel-row-head">
                    <div>
                        <div class="admin-hotel-row-title">${escapeHtml(hotel.name)}</div>
                        <div class="admin-hotel-row-meta">${escapeHtml(hotel.city || '—')} · ${hotel.isMain ? 'main credentials (env)' : `login: ${escapeHtml(hotel.adminUser || '—')}`}</div>
                        <div class="admin-hotel-row-meta">Customer: ${contactMeta}</div>
                    </div>
                    ${badge}
                </div>
                ${editBtn}
            </div>`;
        })
        .join('');
}

async function fetchFloorConfig() {
    const res = await fetch('/api/admin/floor-config', {
        headers: adminHeaders(),
        cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(data.error || res.statusText);
    floorConfig = {
        tableCount: Number(data.tableCount) || 7,
        parcelCount: Number(data.parcelCount) || 5
    };
    if (data.venue) {
        currentVenue = data.venue;
        updateVenueHeader();
    }
    return floorConfig;
}

async function saveFloorConfig(tableCount, parcelCount) {
    const res = await fetch('/api/admin/floor-config', {
        method: 'PUT',
        headers: {
            ...adminHeaders(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tableCount, parcelCount })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(data.error || res.statusText);
    floorConfig = {
        tableCount: Number(data.tableCount) || tableCount,
        parcelCount: Number(data.parcelCount) || parcelCount
    };
    return data;
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

/** Completed orders: use settlement time; others use created time. */
function orderDayForAnalytics(o, status) {
    if (status === 'completed' && o.updated_at) {
        const u = new Date(o.updated_at);
        if (!Number.isNaN(u.getTime())) return u;
    }
    if (o.created_at) {
        const c = new Date(o.created_at);
        if (!Number.isNaN(c.getTime())) return c;
    }
    return null;
}

function computeAdminAnalytics(orders) {
    const now = new Date();
    let deliveryPending = 0;
    let deliveryInProgress = 0;
    let kotActive = 0;
    let kotActiveValue = 0;
    let ordersTodayDelivery = 0;
    let ordersTodayKot = 0;
    let settledToday = 0;
    let settledSalesToday = 0;
    let settledDeliverySales = 0;
    let settledKotSales = 0;
    let cashSettledToday = 0;
    let upiSettledToday = 0;
    let cashCountToday = 0;
    let upiCountToday = 0;
    let unknownSettledToday = 0;
    let unknownCountToday = 0;
    let discountsToday = 0;
    let deliveryFeesToday = 0;
    let totalOrdersLoaded = 0;
    let oldestPendingMs = null;
    let oldestInProgressMs = null;
    let last60MinDelivery = 0;
    let last60MinDeliveryRevenue = 0;
    let totalSaleLoaded = 0;

    for (const o of orders || []) {
        totalOrdersLoaded += 1;
        totalSaleLoaded += Number(o.total) || 0;
        const status = String(o.status || '');
        const kot = isKotFloorOrder(o);
        const delivery = isDeliveryChannelOrder(o);
        const total = Number(o.total) || 0;
        const completed = status === 'completed';
        const closed = completed || status === 'rejected' || status === 'cancelled';
        const pm = orderPaymentMethod(o);

        if (delivery) {
            if (status === 'pending') deliveryPending += 1;
            if (status === 'accepted' || status === 'preparing' || status === 'out_for_delivery') {
                deliveryInProgress += 1;
            }
        } else if (kot && !closed) {
            kotActive += 1;
            kotActiveValue += total;
        }

        const createdAt = o.created_at ? new Date(o.created_at) : null;
        if (!createdAt || Number.isNaN(createdAt.getTime())) continue;

        const ageMs = now.getTime() - createdAt.getTime();
        if (delivery) {
            if (status === 'pending') {
                oldestPendingMs = oldestPendingMs == null ? ageMs : Math.max(oldestPendingMs, ageMs);
            }
            if (status === 'accepted' || status === 'preparing' || status === 'out_for_delivery') {
                oldestInProgressMs = oldestInProgressMs == null ? ageMs : Math.max(oldestInProgressMs, ageMs);
            }
            if (ageMs >= 0 && ageMs <= 60 * 60 * 1000) {
                last60MinDelivery += 1;
                last60MinDeliveryRevenue += total;
            }
        }

        if (isSameLocalDay(createdAt, now)) {
            if (delivery) ordersTodayDelivery += 1;
            else if (kot) ordersTodayKot += 1;

            if (delivery) {
                discountsToday += Number(o.discount) || 0;
                deliveryFeesToday += Number(o.delivery_fee) || 0;
            }
        }

        if (completed) {
            const settledDay = orderDayForAnalytics(o, status);
            if (!settledDay || !isSameLocalDay(settledDay, now)) continue;

            settledToday += 1;
            settledSalesToday += total;
            if (delivery) settledDeliverySales += total;
            else if (kot) settledKotSales += total;
            if (pm === 'CASH') {
                cashSettledToday += total;
                cashCountToday += 1;
            } else if (pm === 'UPI') {
                upiSettledToday += total;
                upiCountToday += 1;
            } else {
                unknownSettledToday += total;
                unknownCountToday += 1;
            }
        }
    }

    const ordersTodayCount = ordersTodayDelivery + ordersTodayKot;
    const avgSettledToday = settledToday ? settledSalesToday / settledToday : 0;

    return {
        updatedAt: now,
        ordersTodayCount,
        ordersTodayDelivery,
        ordersTodayKot,
        deliveryPending,
        deliveryInProgress,
        kotActive,
        kotActiveValue,
        settledToday,
        settledSalesToday,
        settledDeliverySales,
        settledKotSales,
        cashSettledToday,
        upiSettledToday,
        cashCountToday,
        upiCountToday,
        unknownSettledToday,
        unknownCountToday,
        avgSettledToday,
        discountsToday,
        deliveryFeesToday,
        totalOrdersLoaded,
        oldestPendingMs,
        oldestInProgressMs,
        last60MinDelivery,
        last60MinDeliveryRevenue,
        totalSaleLoaded
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

    const headerTotalEl = document.getElementById('adminHeaderTotalSale');
    if (headerTotalEl) headerTotalEl.textContent = formatMoney(data.settledSalesToday);
    const headerCashEl = document.getElementById('adminHeaderCashSale');
    if (headerCashEl) headerCashEl.textContent = formatMoney(data.cashSettledToday);
    const headerUpiEl = document.getElementById('adminHeaderUpiSale');
    if (headerUpiEl) headerUpiEl.textContent = formatMoney(data.upiSettledToday);
    


    const updatedEl = document.getElementById('adminAnalyticsUpdatedAt');
    if (updatedEl) updatedEl.textContent = `Updated ${data.updatedAt.toLocaleTimeString()}`;

    const ordersTodayEl = document.getElementById('metricOrdersToday');
    if (ordersTodayEl) ordersTodayEl.textContent = String(data.ordersTodayCount);
    const ordersTodayHintEl = document.getElementById('metricOrdersTodayHint');
    if (ordersTodayHintEl) {
        if (isGroceryVenue()) {
            ordersTodayHintEl.textContent = `${data.ordersTodayDelivery} grocery delivery today`;
        } else if (isFoodPartnerVenue()) {
            ordersTodayHintEl.textContent = `Delivery ${data.ordersTodayDelivery} · Floor ${data.ordersTodayKot}`;
        } else {
            ordersTodayHintEl.textContent = `Delivery ${data.ordersTodayDelivery} · Floor ${data.ordersTodayKot}`;
        }
    }

    const revenueEl = document.getElementById('metricRevenueToday');
    if (revenueEl) revenueEl.textContent = formatMoney(data.settledSalesToday);
    const revenueHintEl = document.getElementById('metricRevenueTodayHint');
    if (revenueHintEl) {
        if (isGroceryVenue()) {
            revenueHintEl.textContent = `Settled grocery sales ${formatMoney(data.settledDeliverySales)}`;
        } else {
            revenueHintEl.textContent = `Online ${formatMoney(data.settledDeliverySales)} · KOT ${formatMoney(data.settledKotSales)}`;
        }
    }

    const cashTodayEl = document.getElementById('metricCashToday');
    if (cashTodayEl) cashTodayEl.textContent = formatMoney(data.cashSettledToday);
    const cashTodayHintEl = document.getElementById('metricCashTodayHint');
    if (cashTodayHintEl) {
        cashTodayHintEl.textContent =
            data.cashCountToday > 0
                ? `${data.cashCountToday} settled order${data.cashCountToday === 1 ? '' : 's'}`
                : 'No cash settlements today';
    }

    const upiTodayEl = document.getElementById('metricUpiToday');
    if (upiTodayEl) upiTodayEl.textContent = formatMoney(data.upiSettledToday);
    const upiTodayHintEl = document.getElementById('metricUpiTodayHint');
    if (upiTodayHintEl) {
        upiTodayHintEl.textContent =
            data.upiCountToday > 0
                ? `${data.upiCountToday} settled order${data.upiCountToday === 1 ? '' : 's'}`
                : 'No UPI settlements today';
    }

    const paymentSplitEl = document.getElementById('metricPaymentSplit');
    if (paymentSplitEl) {
        const paidTotal = data.cashSettledToday + data.upiSettledToday;
        const cashPct = paidTotal > 0 ? Math.round((data.cashSettledToday / paidTotal) * 100) : 0;
        const upiPct = paidTotal > 0 ? 100 - cashPct : 0;
        if (paidTotal > 0) {
            paymentSplitEl.hidden = false;
            paymentSplitEl.innerHTML = `
                <div class="admin-payment-split-bar" aria-hidden="true">
                    <span class="admin-payment-split-cash" style="width:${cashPct}%"></span>
                    <span class="admin-payment-split-upi" style="width:${upiPct}%"></span>
                </div>
                <div class="admin-payment-split-labels">
                    <span>Cash ${cashPct}%</span>
                    <span>UPI ${upiPct}%</span>
                </div>`;
        } else {
            paymentSplitEl.hidden = true;
            paymentSplitEl.innerHTML = '';
        }
    }

    const paymentSplitNoteEl = document.getElementById('metricPaymentSplitNote');
    if (paymentSplitNoteEl) {
        if (data.unknownCountToday > 0) {
            paymentSplitNoteEl.hidden = false;
            paymentSplitNoteEl.textContent = `${data.unknownCountToday} settled today without payment recorded (${formatMoney(data.unknownSettledToday)})`;
        } else {
            paymentSplitNoteEl.hidden = true;
            paymentSplitNoteEl.textContent = '';
        }
    }

    const totalOrdersEl = document.getElementById('metricTotalOrders');
    if (totalOrdersEl) totalOrdersEl.textContent = String(data.deliveryPending + data.deliveryInProgress);
    const totalOrdersHintEl = document.getElementById('metricTotalOrdersHint');
    if (totalOrdersHintEl) {
        totalOrdersHintEl.textContent = `Pending ${data.deliveryPending} · In progress ${data.deliveryInProgress}`;
    }

    const totalEarnEl = document.getElementById('metricTotalEarning');
    if (totalEarnEl && !isGroceryVenue()) totalEarnEl.textContent = String(data.kotActive);
    const totalEarnHintEl = document.getElementById('metricTotalEarningHint');
    if (totalEarnHintEl && !isGroceryVenue()) {
        totalEarnHintEl.textContent =
            data.kotActive > 0
                ? `Open bills ${formatMoney(data.kotActiveValue)}`
                : 'No live floor sessions';
    }

    const allLoadedCountEl = document.getElementById('metricAllLoadedOrders');
    if (allLoadedCountEl) allLoadedCountEl.textContent = String(data.totalOrdersLoaded);
    const allLoadedSaleEl = document.getElementById('metricAllLoadedSale');
    if (allLoadedSaleEl) allLoadedSaleEl.textContent = formatMoney(data.totalSaleLoaded);

    const avgTodayEl = document.getElementById('insightAvgOrderToday');
    if (avgTodayEl) avgTodayEl.textContent = formatMoney(data.avgSettledToday);

    const settledSplitEl = document.getElementById('insightSettledSplit');
    if (settledSplitEl) {
        settledSplitEl.textContent = `${data.settledToday} settled · ${data.cashCountToday} cash · ${data.upiCountToday} UPI`;
    }

    const cashUpiEl = document.getElementById('insightCashUpiToday');
    if (cashUpiEl) {
        cashUpiEl.textContent = `${formatMoney(data.cashSettledToday)} cash · ${formatMoney(data.upiSettledToday)} UPI`;
    }

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
        last60El.textContent = `${data.last60MinDelivery} delivery · ${formatMoney(data.last60MinDeliveryRevenue)}`;
    }

    const loadedEl = document.getElementById('insightLoadedOrders');
    if (loadedEl) loadedEl.textContent = String(data.totalOrdersLoaded);
}

function buildDeliveryOrderArticleHtml(o) {
    const id = String(o.id);
    const itemsHtml = formatItems(o.items)
        .split('\n')
        .map((line) => `<div class="admin-order-line">${escapeHtml(line)}</div>`)
        .join('');

    const copyBtn = `<button type="button" class="admin-btn admin-btn--copy" data-action="copy" data-id="${id}">Copy order</button>`;
    let statusActions = '';
    if (o.status === 'pending') {
        statusActions = `
                    <button type="button" class="admin-btn admin-btn--accept" data-action="accept" data-id="${id}">Accept</button>
                    <button type="button" class="admin-btn admin-btn--cancel" data-action="cancel" data-id="${id}">Cancel</button>
                `;
    } else if (o.status === 'accepted') {
        statusActions = `
                    <button type="button" class="admin-btn admin-btn--cancel" data-action="cancel" data-id="${id}">Cancel</button>
                    <button type="button" class="admin-btn admin-btn--prep" data-action="preparing" data-id="${id}">Preparing order</button>
                `;
    } else if (o.status === 'preparing') {
        statusActions = `
                    <button type="button" class="admin-btn admin-btn--cancel" data-action="cancel" data-id="${id}">Cancel</button>
                    <button type="button" class="admin-btn admin-btn--out" data-action="out_for_delivery" data-id="${id}">Out for delivery</button>
                `;
    } else if (o.status === 'out_for_delivery') {
        statusActions = `
                    <button type="button" class="admin-btn admin-btn--cancel" data-action="cancel" data-id="${id}">Cancel</button>
                    <button type="button" class="admin-btn admin-btn--complete" data-action="complete-prompt" data-id="${id}">Complete order</button>
                `;
    }
    const actions = `${copyBtn}${statusActions}`;

    const when = o.created_at ? new Date(o.created_at).toLocaleString() : '';
    const deliveryAddress = formatDeliveryAddress(o.delivery_address);
    const payPill = o.status === 'completed' ? formatPaymentPillHtml(o) : '';
    
    let paymentStatusBadge = '';
    let markPaidBtn = '';
    let screenshotBtn = '';
    
    if (o.payment_status === 'completed') {
        paymentStatusBadge = '<span class="admin-order-status" style="background:#dcfce7;color:#166534;">Payment: Completed</span>';
    } else {
        paymentStatusBadge = '<span class="admin-order-status" style="background:#fee2e2;color:#991b1b;">Payment: Pending</span>';
        if (o.status !== 'cancelled' && o.status !== 'rejected') {
            markPaidBtn = `<button type="button" class="admin-btn admin-btn--prep" data-action="mark_paid" data-id="${id}" style="background:#16a34a;color:#fff;">Mark Paid</button>`;
        }
    }
    
    if (o.payment_screenshot) {
        screenshotBtn = `<button type="button" class="admin-btn admin-btn--screenshot" data-action="view_screenshot" data-id="${id}">View screenshot</button>`;
    } else if (o.payment_status !== 'completed' && o.status !== 'cancelled' && o.status !== 'rejected') {
        screenshotBtn = `<span style="font-size: 0.75rem; color: #94a3b8; padding: 0.25rem 0.5rem;">Screenshot pending</span>`;
    }

    return `
                <article class="admin-order admin-order--${escapeHtml(o.status)}" data-order-id="${id}">
                    <header class="admin-order-head">
                        <span class="admin-order-id">#${escapeHtml(id)}</span>
                        <span class="admin-order-head-badges">
                            ${!isFoodPartnerVenue() && isGroceryOrder(o) ? '<span class="admin-order-status" style="background:#7c3aed;color:#fff;">🛒 Grocery</span>' : ''}
                            ${payPill}
                            ${paymentStatusBadge}
                            <span class="admin-order-status admin-order-status--${escapeHtml(o.status)}">${escapeHtml(statusLabel(o.status))}</span>
                        </span>
                    </header>
                    <div class="admin-order-meta">
                        <strong>${escapeHtml(o.name || '')}</strong>
                        ${
                            o.mobile
                                ? `<a class="admin-order-phone" href="tel:${escapeHtml(telHref(o.mobile))}" aria-label="Call ${escapeHtml(o.mobile)}">
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                                        <span>${escapeHtml(o.mobile)}</span>
                                    </a>`
                                : '<span></span>'
                        }
                        <span>${escapeHtml(o.city || '')}</span>
                        ${deliveryAddress ? `<span>${escapeHtml(deliveryAddress)}</span>` : ''}
                        <span class="admin-order-time">${escapeHtml(when)}</span>
                    </div>
                    <div class="admin-order-items">${itemsHtml}</div>
                    <div class="admin-order-total">Total: ₹${Number(o.total) || 0}</div>
                    <div class="admin-order-actions">
                        ${actions}${markPaidBtn}${screenshotBtn}
                        <button type="button" class="admin-btn admin-btn--outline" onclick="printAdminOrderReceipt('${escapeHtml(id)}')">Print</button>
                    </div>
                </article>
            `;
}

function buildKotOrderArticleHtml(o) {
    const id = String(o.id);
    const itemsHtml = formatItems(o.items)
        .split('\n')
        .map((line) => `<div class="admin-order-line">${escapeHtml(line)}</div>`)
        .join('');

    const copyBtn = `<button type="button" class="admin-btn admin-btn--copy" data-action="copy" data-id="${id}">Copy order</button>`;
    const meta = readOrderMeta(o);
    const slotKey = String(meta.slot || '').trim();
    const floorQuery = new URLSearchParams({ order: id });
    if (slotKey) floorQuery.set('slot', slotKey);
    const floorBtn = `<a class="admin-btn admin-btn--floor" href="/admin/tables?${floorQuery.toString()}">Open floor / KOT</a>`;
    const when = o.created_at ? new Date(o.created_at).toLocaleString() : '';
    const slot = formatKotSlotLabel(o);
    const ch = kotChannelLabel(o);
    const prog = kotFloorProgressLabel(o);
    const nk = kotKotCount(o);
    const guest = String(readOrderMeta(o).guest_label || '').trim();
    const kotLine =
        nk > 0
            ? `${nk} ticket${nk === 1 ? '' : 's'}`
            : 'No tickets yet';
    const payPill = o.status === 'completed' ? formatPaymentPillHtml(o) : '';

    let screenshotBtn = '';
    if (o.payment_screenshot) {
        screenshotBtn = `<button type="button" class="admin-btn admin-btn--screenshot" data-action="view_screenshot" data-id="${id}">View screenshot</button>`;
    } else if (o.payment_status !== 'completed' && o.status !== 'cancelled' && o.status !== 'rejected') {
        screenshotBtn = `<span style="font-size: 0.75rem; color: #94a3b8; padding: 0.25rem 0.5rem;">Screenshot pending</span>`;
    }

    return `
                <article class="admin-order admin-order--kot" data-order-id="${id}">
                    <header class="admin-order-head admin-order-head--kot">
                        <span class="admin-order-id">#${escapeHtml(id)}</span>
                        <span class="admin-order-head-badges">
                            ${payPill}
                            <span class="admin-kot-ribbon" title="Floor kitchen ticket order">${escapeHtml(ch)}</span>
                        </span>
                    </header>
                    <div class="admin-kot-subhead">
                        <span class="admin-kot-slot">${escapeHtml(slot)}</span>
                        <span class="admin-kot-progress">${escapeHtml(prog)}</span>
                    </div>
                    <div class="admin-order-meta admin-order-meta--kot">
                        <span><strong>${escapeHtml(kotLine)}</strong>${guest ? ` · ${escapeHtml(guest)}` : ''}</span>
                        <span class="admin-order-time">${escapeHtml(when)}</span>
                    </div>
                    <div class="admin-order-items">${itemsHtml || '<div class="admin-order-line" style="color:var(--muted)">No lines yet</div>'}</div>
                    <div class="admin-order-total">Total: ₹${Number(o.total) || 0}</div>
                    <div class="admin-order-actions">${copyBtn}${floorBtn}${screenshotBtn}</div>
                </article>
            `;
}

function renderMixedOrderList(container, { kotOrders, deliveryOrders, deliveryEmptyText }) {
    const kots = kotOrders || [];
    const dels = deliveryOrders || [];
    const hasKot = kots.length > 0;
    const hasDel = dels.length > 0;
    if (!hasKot && !hasDel) {
        container.innerHTML = `<p class="admin-empty">No ${escapeHtml(deliveryEmptyText)} yet.</p>`;
        return;
    }
    const kotSection = hasKot
        ? `<section class="admin-kot-block" aria-label="Floor KOT orders">
            <div class="admin-kot-block-head">
                <span class="admin-kot-badge">KOT</span>
                <div class="admin-kot-block-head-text">
                    <span class="admin-kot-block-title">Floor — dine-in &amp; parcel</span>
                    <span class="admin-kot-block-hint">Dine-in and parcel bills from the floor screen.</span>
                </div>
            </div>
            <div class="admin-kot-block-cards">${kots.map(buildKotOrderArticleHtml).join('')}</div>
        </section>`
        : '';
    const delCards = hasDel ? dels.map(buildDeliveryOrderArticleHtml).join('') : '';
    const delEmpty = hasDel
        ? ''
        : `<p class="admin-empty admin-empty--in-section">No ${escapeHtml(deliveryEmptyText)} in this view.</p>`;
    const delTitle = hasKot
        ? `<h3 class="admin-delivery-block-title">Delivery &amp; online</h3>`
        : '';
    container.innerHTML = `<div class="admin-order-list-stack">
        ${kotSection}
        <section class="admin-delivery-block" aria-label="Delivery and online orders">
            ${delTitle}
            <div class="admin-delivery-block-cards">${delCards}${delEmpty}</div>
        </section>
    </div>`;
}

function buildOrderCopyText(order) {
    const id = String(order?.id ?? '');
    const name = String(order?.name ?? '').trim();
    const mobile = String(order?.mobile ?? '').trim();
    const city = String(order?.city ?? '').trim();
    const address = formatDeliveryAddress(order?.delivery_address);
    const when = order?.created_at ? new Date(order.created_at).toLocaleString() : '';
    const pm = orderPaymentMethod(order);

    const lines = [
        `QuickKart — Order #${id}`,
        when ? `Time: ${when}` : '',
        name ? `Name: ${name}` : '',
        mobile ? `Mobile: ${mobile}` : '',
        city ? `City: ${city}` : '',
        address ? `Address: ${address}` : '',
        pm ? `Payment: ${pm}` : '',
        '',
        'Items:',
        ...formatItems(order?.items)
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => `- ${l}`),
        '',
        `Subtotal: ${formatMoney(order?.subtotal ?? 0)}`,
        `Delivery: ${formatMoney(order?.delivery_fee ?? 0)}`,
        `Discount: ${formatMoney(order?.discount ?? 0)}`,
        `Total: ${formatMoney(order?.total ?? 0)}`
    ].filter(Boolean);

    return lines.join('\n');
}

function renderOrderTabs(tabsEl, countsByStatus, activeKey) {
    if (!tabsEl) return;
    tabsEl.innerHTML = '';

    for (const tab of ORDER_STATUS_TABS) {
        if (!isOrderTabVisible(tab, countsByStatus)) {
            continue;
        }
        const count =
            countsByStatus && typeof countsByStatus === 'object'
                ? countsByStatus[tab.key] ?? 0
                : 0;

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

/** Sanitize a phone number for a `tel:` link (keep leading + and digits only). */
function telHref(mobile) {
    const raw = String(mobile || '').trim();
    const plus = raw.startsWith('+') ? '+' : '';
    return plus + raw.replace(/[^\d]/g, '');
}

/** Toggle a spinner + disabled state on an admin button during async work. */
function setBtnLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
        btn.classList.add('is-loading');
        btn.dataset.wasDisabled = btn.disabled ? '1' : '0';
        btn.disabled = true;
    } else {
        btn.classList.remove('is-loading');
        btn.disabled = btn.dataset.wasDisabled === '1';
        delete btn.dataset.wasDisabled;
    }
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

function ensureGroceryInventoryInit() {
    if (groceryInventoryInitialized || getAdminPanelMode() === 'hotel') return;
    initGroceryInventory();
}

function initGroceryInventory() {
    if (groceryInventoryInitialized) return;
    groceryInventoryInitialized = true;

    const modal = document.getElementById('adminGroceryModal');
    if (!modal) return;
    const el = (id) => document.getElementById(id);

    const state = { storeId: null, isMain: false, categories: [], products: [], editingId: null };

    async function api(method, path, body) {
        const opts = { method, headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, cache: 'no-store' };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const res = await fetch(path, opts);
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            clearAdminCredentials();
            showAdminGate('Session expired. Enter admin credentials again.');
            throw Object.assign(new Error('Authentication required'), { code: 401 });
        }
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
    }

    function withVenue(path) {
        if (!state.storeId) return path;
        return path + (path.includes('?') ? '&' : '?') + 'venueId=' + encodeURIComponent(state.storeId);
    }

    function setMsg(text, isError) {
        const m = el('adminGroceryProductMsg');
        if (!m) return;
        m.textContent = text || '';
        if (isError) m.setAttribute('data-state', 'error');
        else m.removeAttribute('data-state');
    }

    function close() {
        modal.hidden = true;
    }

    async function loadStoreSelect() {
        const wrap = el('adminGroceryStoreSelectWrap');
        const select = el('adminGroceryStoreSelect');
        if (!state.isMain) {
            if (wrap) wrap.hidden = true;
            return;
        }
        const data = await api('GET', '/api/admin/venues');
        const stores = (data.venues || []).filter((v) => v.venueType === 'grocery');
        if (wrap) wrap.hidden = stores.length <= 1 && stores.length !== 0 ? false : false;
        if (wrap) wrap.hidden = false;
        if (!stores.length) {
            if (select) select.innerHTML = '<option value="">No grocery stores yet — create one in Hotels</option>';
            state.storeId = null;
            return;
        }
        if (select) {
            select.innerHTML = stores
                .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
                .join('');
            if (!state.storeId || !stores.some((s) => String(s.id) === String(state.storeId))) {
                state.storeId = stores[0].id;
            }
            select.value = String(state.storeId);
            select.onchange = async () => {
                state.storeId = select.value ? Number(select.value) : null;
                await loadAll();
            };
        }
    }

    async function loadAll() {
        if (state.isMain && !state.storeId) {
            renderCategories();
            renderProductCatSelect();
            renderProducts();
            el('adminGroceryLowStock').hidden = true;
            return;
        }
        try {
            const [cats, prods, low] = await Promise.all([
                api('GET', withVenue('/api/admin/grocery/categories')),
                api('GET', withVenue('/api/admin/grocery/products')),
                api('GET', withVenue('/api/admin/grocery/low-stock'))
            ]);
            state.categories = cats.categories || [];
            state.products = prods.products || [];
            renderCategories();
            renderProductCatSelect();
            renderProducts();
            renderLowStock(low.products || []);
        } catch (err) {
            if (err.code !== 401) setMsg(err.message || 'Could not load inventory.', true);
        }
    }

    function renderLowStock(items) {
        const box = el('adminGroceryLowStock');
        if (!box) return;
        if (!items.length) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        box.hidden = false;
        box.innerHTML =
            '<strong>⚠️ Low stock (' + items.length + ')</strong>' +
            items
                .map((p) => `${escapeHtml(p.name)} — ${p.stockQty} left`)
                .join(' · ');
    }

    function renderCategories() {
        const list = el('adminGroceryCatList');
        if (!list) return;
        if (!state.categories.length) {
            list.innerHTML = '<p class="admin-modal-sub" style="margin:0;">No categories yet.</p>';
            return;
        }
        list.innerHTML = state.categories
            .map(
                (c) => `<div class="admin-grocery-row">
                    <div class="admin-grocery-row-main">
                        <div class="admin-grocery-row-name">${escapeHtml(c.name)}${c.enabled ? '' : ' <span class="admin-grocery-badge admin-grocery-badge--oos">Hidden</span>'}</div>
                        <div class="admin-grocery-row-meta">${escapeHtml(c.slug)}</div>
                    </div>
                    <div class="admin-grocery-row-actions">
                        <button type="button" class="danger" data-gro-cat-del="${c.id}">Delete</button>
                    </div>
                </div>`
            )
            .join('');
    }

    function renderProductCatSelect() {
        const select = el('adminGroceryProductCategory');
        if (!select) return;
        const current = select.value;
        select.innerHTML =
            '<option value="">— No category —</option>' +
            state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        if (current) select.value = current;
    }

    function renderProducts() {
        const list = el('adminGroceryProductList');
        const count = el('adminGroceryProductCount');
        if (count) count.textContent = `${state.products.length} item${state.products.length === 1 ? '' : 's'}`;
        if (!list) return;
        if (!state.products.length) {
            list.innerHTML = '<p class="admin-modal-sub" style="margin:0;">No products yet.</p>';
            return;
        }
        list.innerHTML = state.products
            .map((p) => {
                const badge = !p.enabled
                    ? '<span class="admin-grocery-badge admin-grocery-badge--oos">Hidden</span>'
                    : p.outOfStock
                      ? '<span class="admin-grocery-badge admin-grocery-badge--oos">Out</span>'
                      : p.lowStock
                        ? '<span class="admin-grocery-badge admin-grocery-badge--low">Low</span>'
                        : '';
                const mrp = p.mrp > p.price ? ` <s style="color:#94a3b8;">₹${p.mrp}</s>` : '';
                return `<div class="admin-grocery-row">
                    <div class="admin-grocery-row-main">
                        <div class="admin-grocery-row-name">${escapeHtml(p.name)}${badge}</div>
                        <div class="admin-grocery-row-meta">₹${p.price}${mrp} · ${p.unitValue} ${escapeHtml(p.unit)} · ${escapeHtml(p.categoryName || 'Uncategorized')}</div>
                    </div>
                    <div class="admin-grocery-stock-controls">
                        <button type="button" data-gro-stock-dec="${p.id}">−</button>
                        <span class="admin-grocery-stock-val">${p.stockQty}</span>
                        <button type="button" data-gro-stock-inc="${p.id}">+</button>
                    </div>
                    <div class="admin-grocery-row-actions">
                        <button type="button" data-gro-prod-edit="${p.id}">Edit</button>
                        <button type="button" class="danger" data-gro-prod-del="${p.id}">Del</button>
                    </div>
                </div>`;
            })
            .join('');
    }

    function resetProductForm() {
        state.editingId = null;
        el('adminGroceryProductId').value = '';
        el('adminGroceryProductName').value = '';
        el('adminGroceryProductSku').value = '';
        el('adminGroceryProductUnit').value = 'pcs';
        el('adminGroceryProductUnitValue').value = '1';
        el('adminGroceryProductMrp').value = '';
        el('adminGroceryProductPrice').value = '';
        el('adminGroceryProductStock').value = '0';
        el('adminGroceryProductLowStock').value = '5';
        el('adminGroceryProductImage').value = '';
        el('adminGroceryProductEnabled').checked = true;
        el('adminGroceryProductCategory').value = '';
        el('adminGroceryProductFormTitle').textContent = 'Add product';
        el('adminGroceryProductSaveBtn').textContent = 'Add product';
        el('adminGroceryProductCancelBtn').hidden = true;
    }

    function fillProductForm(p) {
        state.editingId = p.id;
        el('adminGroceryProductId').value = p.id;
        el('adminGroceryProductName').value = p.name || '';
        el('adminGroceryProductSku').value = p.sku || '';
        el('adminGroceryProductUnit').value = p.unit || 'pcs';
        el('adminGroceryProductUnitValue').value = p.unitValue != null ? p.unitValue : 1;
        el('adminGroceryProductMrp').value = p.mrp || '';
        el('adminGroceryProductPrice').value = p.price || '';
        el('adminGroceryProductStock').value = p.stockQty || 0;
        el('adminGroceryProductLowStock').value = p.lowStockThreshold != null ? p.lowStockThreshold : 5;
        el('adminGroceryProductImage').value = p.image || '';
        el('adminGroceryProductEnabled').checked = p.enabled !== false;
        renderProductCatSelect();
        el('adminGroceryProductCategory').value = p.categoryId != null ? String(p.categoryId) : '';
        el('adminGroceryProductFormTitle').textContent = 'Edit product';
        el('adminGroceryProductSaveBtn').textContent = 'Save changes';
        el('adminGroceryProductCancelBtn').hidden = false;
    }

    async function openGroceryInventory(targetId) {
        state.isMain = isMainAdminVenue();
        state.storeId = targetId != null ? Number(targetId) : state.isMain ? null : (currentVenue ? currentVenue.id : null);
        modal.hidden = false;
        setMsg('', false);
        resetProductForm();
        const sub = el('adminGroceryModalSub');
        if (sub) {
            sub.textContent = state.isMain
                ? 'Pick a grocery store, then manage its categories, products and stock.'
                : 'Manage your categories, products, stock, MRP and selling price.';
        }
        try {
            await loadStoreSelect();
            await loadAll();
        } catch (err) {
            if (err.code !== 401) setMsg(err.message || 'Could not open inventory.', true);
        }
    }
    window.openGroceryInventory = openGroceryInventory;

    // toolbar button
    el('adminGroceryInventoryBtn')?.addEventListener('click', () => openGroceryInventory(null));
    el('adminGroceryCloseBtn')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });

    // category add
    el('adminGroceryCatAddBtn')?.addEventListener('click', async () => {
        const name = String(el('adminGroceryCatName').value || '').trim();
        if (!name) {
            setMsg('Category name is required.', true);
            return;
        }
        try {
            await api('POST', withVenue('/api/admin/grocery/categories'), {
                name,
                image: String(el('adminGroceryCatImage').value || '').trim(),
                sortOrder: parseInt(String(el('adminGroceryCatSort').value || '0'), 10) || 0
            });
            el('adminGroceryCatName').value = '';
            el('adminGroceryCatImage').value = '';
            el('adminGroceryCatSort').value = '';
            await loadAll();
            setMsg('Category saved.', false);
        } catch (err) {
            if (err.code !== 401) setMsg(err.message || 'Could not save category.', true);
        }
    });

    // category + product delegated actions
    document.getElementById('adminGroceryCatList')?.addEventListener('click', async (e) => {
        const del = e.target.closest('[data-gro-cat-del]');
        if (!del) return;
        if (!window.confirm('Delete this category? Products keep existing but lose the category.')) return;
        try {
            await api('DELETE', withVenue('/api/admin/grocery/categories/' + del.getAttribute('data-gro-cat-del')));
            await loadAll();
        } catch (err) {
            if (err.code !== 401) setMsg(err.message || 'Could not delete category.', true);
        }
    });

    document.getElementById('adminGroceryProductList')?.addEventListener('click', async (e) => {
        const inc = e.target.closest('[data-gro-stock-inc]');
        const dec = e.target.closest('[data-gro-stock-dec]');
        const edit = e.target.closest('[data-gro-prod-edit]');
        const del = e.target.closest('[data-gro-prod-del]');
        try {
            if (inc || dec) {
                const id = (inc || dec).getAttribute(inc ? 'data-gro-stock-inc' : 'data-gro-stock-dec');
                await api('POST', withVenue('/api/admin/grocery/products/' + id + '/stock'), {
                    mode: 'delta',
                    amount: inc ? 1 : -1
                });
                await loadAll();
                return;
            }
            if (edit) {
                const id = Number(edit.getAttribute('data-gro-prod-edit'));
                const p = state.products.find((x) => x.id === id);
                if (p) {
                    fillProductForm(p);
                    modal.querySelector('.admin-modal-card')?.scrollTo({ top: 0, behavior: 'smooth' });
                }
                return;
            }
            if (del) {
                if (!window.confirm('Delete this product?')) return;
                await api('DELETE', withVenue('/api/admin/grocery/products/' + del.getAttribute('data-gro-prod-del')));
                await loadAll();
            }
        } catch (err) {
            if (err.code !== 401) setMsg(err.message || 'Action failed.', true);
        }
    });

    el('adminGroceryProductCancelBtn')?.addEventListener('click', resetProductForm);

    el('adminGroceryProductForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (state.isMain && !state.storeId) {
            setMsg('Select a grocery store first.', true);
            return;
        }
        const payload = {
            name: String(el('adminGroceryProductName').value || '').trim(),
            sku: String(el('adminGroceryProductSku').value || '').trim(),
            unit: el('adminGroceryProductUnit').value,
            unitValue: el('adminGroceryProductUnitValue').value,
            mrp: el('adminGroceryProductMrp').value,
            price: el('adminGroceryProductPrice').value,
            stockQty: el('adminGroceryProductStock').value,
            lowStockThreshold: el('adminGroceryProductLowStock').value,
            image: String(el('adminGroceryProductImage').value || '').trim(),
            enabled: el('adminGroceryProductEnabled').checked,
            categoryId: el('adminGroceryProductCategory').value || null
        };
        if (!payload.name || !payload.price) {
            setMsg('Name and selling price are required.', true);
            return;
        }
        const saveBtn = el('adminGroceryProductSaveBtn');
        setBtnLoading(saveBtn, true);
        try {
            if (state.editingId) {
                await api('PATCH', withVenue('/api/admin/grocery/products/' + state.editingId), payload);
            } else {
                await api('POST', withVenue('/api/admin/grocery/products'), payload);
            }
            resetProductForm();
            await loadAll();
            setMsg('Product saved.', false);
        } catch (err) {
            if (err.code !== 401) setMsg(err.message || 'Could not save product.', true);
        } finally {
            setBtnLoading(saveBtn, false);
        }
    });
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
    const popupCancelBtn = document.getElementById('adminNewOrderCancelBtn');
    const payModalEl = document.getElementById('adminCompletePayModal');
    const payModalTitleEl = document.getElementById('adminCompletePayTitle');
    const payModalSubEl = document.getElementById('adminCompletePaySubtitle');
    const payModalCloseBtn = document.getElementById('adminCompletePayCloseBtn');
    const payModalCashBtn = document.getElementById('adminCompletePayCashBtn');
    const payModalUpiBtn = document.getElementById('adminCompletePayUpiBtn');
    let completePayOrderId = null;

    const storeStatusBtn = document.getElementById('adminStoreStatusBtn');
    const storeStatusModal = document.getElementById('adminStoreStatusModal');
    const storeStatusCloseBtn = document.getElementById('adminStoreStatusCloseBtn');
    const storeStatusEl = document.getElementById('adminStoreStatus');
    const storeStatusPill = document.getElementById('adminStoreStatusPill');
    const storeStatusNote = document.getElementById('adminStoreStatusNote');
    const storeAcceptBtn = document.getElementById('adminStoreAcceptBtn');
    const storePauseBtn = document.getElementById('adminStorePauseBtn');
    const storeReasonWrap = document.getElementById('adminStoreReasonWrap');
    const storeReasonSelect = document.getElementById('adminStoreReason');
    const storeSaveBtn = document.getElementById('adminStoreSaveBtn');
    const storeStatusMsg = document.getElementById('adminStoreStatusMsg');

    let storeAccepting = true;

    function setStoreStatusMessage(text, state) {
        if (!storeStatusMsg) return;
        storeStatusMsg.textContent = text || '';
        if (state) storeStatusMsg.setAttribute('data-state', state);
        else storeStatusMsg.removeAttribute('data-state');
    }

    function renderStoreStatusControls() {
        if (storeAcceptBtn) storeAcceptBtn.setAttribute('data-active', String(storeAccepting));
        if (storePauseBtn) storePauseBtn.setAttribute('data-active', String(!storeAccepting));
        if (storeReasonWrap) storeReasonWrap.hidden = storeAccepting;
        if (storeStatusEl) storeStatusEl.setAttribute('data-state', storeAccepting ? 'open' : 'paused');
        if (storeStatusPill) {
            storeStatusPill.setAttribute('data-state', storeAccepting ? 'open' : 'paused');
            storeStatusPill.textContent = storeAccepting ? 'Accepting orders' : 'Orders paused';
        }
        if (storeStatusNote) {
            storeStatusNote.textContent = storeAccepting
                ? 'Customers can place orders on the website.'
                : 'Customers see a “not accepting orders” overlay and cannot order.';
        }
        if (storeStatusBtn) {
            storeStatusBtn.setAttribute('data-state', storeAccepting ? 'open' : 'paused');
            storeStatusBtn.textContent = storeAccepting ? '🏪' : '⛔';
            storeStatusBtn.setAttribute('data-tip', storeAccepting ? 'Orders: ON' : 'Orders: OFF');
            storeStatusBtn.setAttribute(
                'aria-label',
                storeAccepting ? 'Online orders: accepting' : 'Online orders: paused'
            );
        }
    }

    function applyStoreStatus(status) {
        if (!status || typeof status !== 'object') return;
        storeAccepting = status.acceptingOrders !== false;
        if (!storeAccepting && status.reason && storeReasonSelect) {
            storeReasonSelect.value = status.reason;
        }
        renderStoreStatusControls();
    }

    async function loadStoreStatus() {
        if (!storeStatusEl) return;
        try {
            const status = await fetchStoreStatus();
            applyStoreStatus(status);
            setStoreStatusMessage('', null);
        } catch (err) {
            if (err && err.code === 401) {
                clearAdminCredentials();
                showAdminGate('Session expired. Enter admin credentials again.');
            } else {
                setStoreStatusMessage('Could not load store status.', 'error');
            }
        }
    }

    async function persistStoreStatus() {
        if (!storeSaveBtn) return;
        const reason = storeAccepting ? '' : (storeReasonSelect ? storeReasonSelect.value : '');
        setBtnLoading(storeSaveBtn, true);
        setStoreStatusMessage('Saving…', null);
        try {
            const data = await saveStoreStatus(storeAccepting, reason);
            applyStoreStatus(data);
            setStoreStatusMessage(storeAccepting ? 'Orders are now ON.' : 'Orders are now OFF.', 'success');
        } catch (err) {
            if (err && err.code === 401) {
                clearAdminCredentials();
                showAdminGate('Session expired. Enter admin credentials again.');
            } else {
                setStoreStatusMessage(err.message || 'Could not save store status.', 'error');
            }
        } finally {
            setBtnLoading(storeSaveBtn, false);
        }
    }

    storeAcceptBtn?.addEventListener('click', () => {
        storeAccepting = true;
        renderStoreStatusControls();
        setStoreStatusMessage('Press Save to apply.', null);
    });
    storePauseBtn?.addEventListener('click', () => {
        storeAccepting = false;
        renderStoreStatusControls();
        setStoreStatusMessage('Choose a reason, then press Save.', null);
    });
    storeReasonSelect?.addEventListener('change', () => {
        if (!storeAccepting) setStoreStatusMessage('Press Save to apply.', null);
    });
    storeSaveBtn?.addEventListener('click', persistStoreStatus);

    function openStoreStatusModal() {
        if (!storeStatusModal) return;
        storeStatusModal.hidden = false;
        loadStoreStatus();
    }
    function closeStoreStatusModal() {
        if (storeStatusModal) storeStatusModal.hidden = true;
    }
    storeStatusBtn?.addEventListener('click', openStoreStatusModal);
    storeStatusCloseBtn?.addEventListener('click', closeStoreStatusModal);
    storeStatusModal?.addEventListener('click', (e) => {
        if (e.target === storeStatusModal) closeStoreStatusModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && storeStatusModal && !storeStatusModal.hidden) {
            closeStoreStatusModal();
        }
        if (e.key === 'Escape' && floorConfigModal && !floorConfigModal.hidden) {
            closeFloorConfigModal();
        }
        if (e.key === 'Escape' && hotelsModal && !hotelsModal.hidden) {
            closeHotelsModal();
        }
        if (e.key === 'Escape' && venueProfileModal && !venueProfileModal.hidden) {
            closeVenueProfileModal();
        }
    });

    const venueProfileBtn = document.getElementById('adminVenueProfileBtn');
    const venueProfileModal = document.getElementById('adminVenueProfileModal');
    const venueProfileCloseBtn = document.getElementById('adminVenueProfileCloseBtn');
    const venueProfileTitle = document.getElementById('adminVenueProfileModalTitle');
    const venueProfileSub = document.getElementById('adminVenueProfileModalSub');
    const venueProfileContact = document.getElementById('adminVenueProfileContact');
    const venueProfileHours = document.getElementById('adminVenueProfileHours');
    const venueProfileAddress = document.getElementById('adminVenueProfileAddress');
    const venueProfileSaveBtn = document.getElementById('adminVenueProfileSaveBtn');
    const venueProfileMsg = document.getElementById('adminVenueProfileMsg');

    const venueProfileQrCode = document.getElementById('adminVenueProfileQrCode');
    const venueProfileQrPreview = document.getElementById('adminVenueProfileQrPreview');
    let qrCodeBase64 = null;

    venueProfileQrCode?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) {
            qrCodeBase64 = null;
            if (venueProfileQrPreview) venueProfileQrPreview.style.display = 'none';
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const MAX_SIZE = 400;
                if (width > MAX_SIZE || height > MAX_SIZE) {
                    if (width > height) {
                        height = Math.round((height * MAX_SIZE) / width);
                        width = MAX_SIZE;
                    } else {
                        width = Math.round((width * MAX_SIZE) / height);
                        height = MAX_SIZE;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                qrCodeBase64 = canvas.toDataURL('image/jpeg', 0.85);
                if (venueProfileQrPreview) {
                    venueProfileQrPreview.src = qrCodeBase64;
                    venueProfileQrPreview.style.display = 'block';
                }
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });

    function setVenueProfileMessage(text, state) {
        if (!venueProfileMsg) return;
        venueProfileMsg.textContent = text || '';
        if (state) venueProfileMsg.setAttribute('data-state', state);
        else venueProfileMsg.removeAttribute('data-state');
    }

    function fillVenueProfileForm() {
        if (venueProfileContact) venueProfileContact.value = currentVenue?.contactMobile || '';
        if (venueProfileHours) venueProfileHours.value = currentVenue?.hoursText || '';
        if (venueProfileAddress) venueProfileAddress.value = currentVenue?.addressLine || '';
        qrCodeBase64 = currentVenue?.paymentQrCode || null;
        if (venueProfileQrCode) venueProfileQrCode.value = '';
        if (venueProfileQrPreview) {
            if (qrCodeBase64) {
                venueProfileQrPreview.src = qrCodeBase64;
                venueProfileQrPreview.style.display = 'block';
            } else {
                venueProfileQrPreview.src = '';
                venueProfileQrPreview.style.display = 'none';
            }
        }
    }

    function openVenueProfileModal() {
        if (!venueProfileModal || isMainAdminVenue()) return;
        const grocery = isGroceryVenue();
        if (venueProfileTitle) venueProfileTitle.textContent = grocery ? 'Store info' : 'Hotel info';
        if (venueProfileSub) {
            venueProfileSub.textContent = grocery
                ? 'Contact, hours, and address for your grocery store.'
                : 'Contact number and hours shown to customers after they order.';
        }
        fillVenueProfileForm();
        setVenueProfileMessage('', null);
        venueProfileModal.hidden = false;
    }

    function closeVenueProfileModal() {
        if (venueProfileModal) venueProfileModal.hidden = true;
    }

    venueProfileBtn?.addEventListener('click', openVenueProfileModal);
    venueProfileCloseBtn?.addEventListener('click', closeVenueProfileModal);
    venueProfileModal?.addEventListener('click', (e) => {
        if (e.target === venueProfileModal) closeVenueProfileModal();
    });
    venueProfileSaveBtn?.addEventListener('click', async () => {
        if (!currentVenue || isMainAdminVenue()) return;
        setBtnLoading(venueProfileSaveBtn, true);
        setVenueProfileMessage('Saving…', null);
        try {
            const bodyPayload = {
                contactMobile: String(venueProfileContact?.value || '').trim(),
                hoursText: String(venueProfileHours?.value || '').trim(),
                addressLine: String(venueProfileAddress?.value || '').trim()
            };
            if (qrCodeBase64 !== null) {
                bodyPayload.paymentQrCode = qrCodeBase64;
            }

            const res = await fetch('/api/admin/venue-profile', {
                method: 'PUT',
                headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload)
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
            if (!res.ok) throw new Error(data.error || res.statusText);
            if (data.venue) {
                currentVenue = data.venue;
                updateVenueHeader();
            }
            setVenueProfileMessage('Saved.', 'success');
        } catch (err) {
            if (err && err.code === 401) {
                clearAdminCredentials();
                showAdminGate('Session expired. Enter admin credentials again.');
            } else {
                setVenueProfileMessage(err.message || 'Could not save.', 'error');
            }
        } finally {
            setBtnLoading(venueProfileSaveBtn, false);
        }
    });

    // ── Delivery Zones modal ──
    const dzBtn = document.getElementById('adminDeliveryZonesBtn');
    const dzModal = document.getElementById('adminDeliveryZonesModal');
    const dzCloseBtn = document.getElementById('adminDeliveryZonesCloseBtn');
    const dzListEl = document.getElementById('adminDeliveryZonesList');
    const dzFormTitle = document.getElementById('adminDzFormTitle');
    const dzEditId = document.getElementById('adminDzEditId');
    const dzCity = document.getElementById('adminDzCity');
    const dzMinOrder = document.getElementById('adminDzMinOrder');
    const dzDeliveryFee = document.getElementById('adminDzDeliveryFee');
    const dzFreeAbove = document.getElementById('adminDzFreeAbove');
    const dzSaveBtn = document.getElementById('adminDzSaveBtn');
    const dzCancelEditBtn = document.getElementById('adminDzCancelEditBtn');
    const dzMsg = document.getElementById('adminDzMsg');

    let deliveryZonesCache = [];

    function setDzMessage(text, state) {
        if (!dzMsg) return;
        dzMsg.textContent = text || '';
        if (state) dzMsg.setAttribute('data-state', state);
        else dzMsg.removeAttribute('data-state');
    }

    function renderDeliveryZonesTable() {
        if (!dzListEl) return;
        if (!deliveryZonesCache.length) {
            dzListEl.innerHTML = '<p class="admin-dz-empty">No delivery zones configured yet.</p>';
            return;
        }
        const rows = deliveryZonesCache.map((z) => {
            const cityLabel = z.city === '_default'
                ? '<span class="dz-city dz-default">Other Cities</span>'
                : `<span class="dz-city">${escapeHtml(z.city)}</span>`;
            const freeAboveLabel = z.free_delivery_above != null
                ? `₹${z.free_delivery_above}`
                : '—';
            const enabledLabel = z.enabled ? '✅' : '❌';
            return `<tr>
                <td>${cityLabel}</td>
                <td>₹${z.min_order || 0}</td>
                <td>₹${z.delivery_fee || 0}</td>
                <td>${freeAboveLabel}</td>
                <td>${enabledLabel}</td>
                <td class="admin-dz-actions">
                    <button type="button" data-dz-edit="${z.id}">Edit</button>
                    <button type="button" class="danger" data-dz-delete="${z.id}">Delete</button>
                </td>
            </tr>`;
        });
        dzListEl.innerHTML = `<table class="admin-dz-table">
            <thead><tr>
                <th>City</th><th>Min order</th><th>Delivery fee</th><th>Reduced fee above</th><th>Active</th><th></th>
            </tr></thead>
            <tbody>${rows.join('')}</tbody>
        </table>`;
    }

    async function fetchDeliveryZones() {
        const res = await fetch('/api/admin/delivery-zones', {
            headers: adminHeaders(),
            cache: 'no-store'
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
        if (!res.ok) throw new Error(data.error || 'Could not load zones.');
        deliveryZonesCache = Array.isArray(data.zones) ? data.zones : [];
        renderDeliveryZonesTable();
    }

    function resetDzForm() {
        if (dzEditId) dzEditId.value = '';
        if (dzCity) dzCity.value = '';
        if (dzMinOrder) dzMinOrder.value = '0';
        if (dzDeliveryFee) dzDeliveryFee.value = '0';
        if (dzFreeAbove) dzFreeAbove.value = '';
        if (dzFormTitle) dzFormTitle.textContent = 'Add delivery zone';
        if (dzSaveBtn) dzSaveBtn.textContent = 'Add zone';
        if (dzCancelEditBtn) dzCancelEditBtn.hidden = true;
        if (dzCity) dzCity.removeAttribute('disabled');
        setDzMessage('', null);
    }

    function fillDzFormForEdit(zone) {
        if (dzEditId) dzEditId.value = String(zone.id);
        if (dzCity) { dzCity.value = zone.city; dzCity.setAttribute('disabled', 'true'); }
        if (dzMinOrder) dzMinOrder.value = String(zone.min_order || 0);
        if (dzDeliveryFee) dzDeliveryFee.value = String(zone.delivery_fee || 0);
        if (dzFreeAbove) dzFreeAbove.value = zone.free_delivery_above != null ? String(zone.free_delivery_above) : '';
        if (dzFormTitle) dzFormTitle.textContent = `Edit zone: ${zone.city}`;
        if (dzSaveBtn) dzSaveBtn.textContent = 'Save zone';
        if (dzCancelEditBtn) dzCancelEditBtn.hidden = false;
        setDzMessage('', null);
    }

    async function openDeliveryZonesModal() {
        if (!dzModal) return;
        dzModal.hidden = false;
        resetDzForm();
        setDzMessage('Loading…', null);
        try {
            await fetchDeliveryZones();
            setDzMessage('', null);
        } catch (err) {
            if (err && err.code === 401) {
                clearAdminCredentials();
                showAdminGate('Session expired.');
            } else {
                setDzMessage(err.message || 'Could not load.', 'error');
            }
        }
    }

    function closeDeliveryZonesModal() {
        if (dzModal) dzModal.hidden = true;
    }

    dzBtn?.addEventListener('click', openDeliveryZonesModal);
    dzCloseBtn?.addEventListener('click', closeDeliveryZonesModal);
    dzModal?.addEventListener('click', (e) => {
        if (e.target === dzModal) closeDeliveryZonesModal();
    });
    dzCancelEditBtn?.addEventListener('click', resetDzForm);

    dzSaveBtn?.addEventListener('click', async () => {
        const city = String(dzCity?.value || '').trim().toLowerCase();
        if (!city) { setDzMessage('City name is required.', 'error'); return; }
        const payload = {
            city,
            deliveryFee: parseInt(String(dzDeliveryFee?.value || '0'), 10),
            minOrder: parseInt(String(dzMinOrder?.value || '0'), 10),
            freeDeliveryAbove: dzFreeAbove?.value ? parseInt(String(dzFreeAbove.value), 10) : null
        };
        const editId = dzEditId?.value ? parseInt(dzEditId.value, 10) : null;
        if (editId) payload.id = editId;

        setBtnLoading(dzSaveBtn, true);
        setDzMessage('Saving…', null);
        try {
            const res = await fetch('/api/admin/delivery-zones', {
                method: 'POST',
                headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
            if (!res.ok) throw new Error(data.error || 'Could not save.');
            setDzMessage('Saved.', 'success');
            resetDzForm();
            await fetchDeliveryZones();
        } catch (err) {
            if (err && err.code === 401) {
                clearAdminCredentials();
                showAdminGate('Session expired.');
            } else {
                setDzMessage(err.message || 'Could not save.', 'error');
            }
        } finally {
            setBtnLoading(dzSaveBtn, false);
        }
    });

    dzListEl?.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('[data-dz-edit]');
        if (editBtn) {
            const id = parseInt(editBtn.getAttribute('data-dz-edit'), 10);
            const zone = deliveryZonesCache.find((z) => z.id === id);
            if (zone) fillDzFormForEdit(zone);
            return;
        }
        const deleteBtn = e.target.closest('[data-dz-delete]');
        if (deleteBtn) {
            const id = parseInt(deleteBtn.getAttribute('data-dz-delete'), 10);
            if (!confirm('Delete this delivery zone?')) return;
            setDzMessage('Deleting…', null);
            try {
                const res = await fetch(`/api/admin/delivery-zones/${id}`, {
                    method: 'DELETE',
                    headers: adminHeaders()
                });
                const data = await res.json().catch(() => ({}));
                if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
                if (!res.ok) throw new Error(data.error || 'Could not delete.');
                setDzMessage('Deleted.', 'success');
                await fetchDeliveryZones();
            } catch (err) {
                if (err && err.code === 401) {
                    clearAdminCredentials();
                    showAdminGate('Session expired.');
                } else {
                    setDzMessage(err.message || 'Could not delete.', 'error');
                }
            }
        }
    });

    const floorConfigBtn = document.getElementById('adminFloorConfigBtn');
    const floorConfigModal = document.getElementById('adminFloorConfigModal');
    const floorConfigCloseBtn = document.getElementById('adminFloorConfigCloseBtn');
    const floorTableCountInput = document.getElementById('adminFloorTableCount');
    const floorParcelCountInput = document.getElementById('adminFloorParcelCount');
    const floorConfigSaveBtn = document.getElementById('adminFloorConfigSaveBtn');
    const floorConfigMsg = document.getElementById('adminFloorConfigMsg');

    function setFloorConfigMessage(text, state) {
        if (!floorConfigMsg) return;
        floorConfigMsg.textContent = text || '';
        if (state) floorConfigMsg.setAttribute('data-state', state);
        else floorConfigMsg.removeAttribute('data-state');
    }

    function renderFloorConfigForm() {
        if (floorTableCountInput) floorTableCountInput.value = String(floorConfig.tableCount || 7);
        if (floorParcelCountInput) floorParcelCountInput.value = String(floorConfig.parcelCount || 5);
    }

    async function openFloorConfigModal() {
        if (!floorConfigModal) return;
        floorConfigModal.hidden = false;
        setFloorConfigMessage('', null);
        try {
            await fetchFloorConfig();
            renderFloorConfigForm();
        } catch (err) {
            if (err && err.code === 401) {
                clearAdminCredentials();
                showAdminGate('Session expired. Enter admin credentials again.');
            } else {
                setFloorConfigMessage(err.message || 'Could not load floor configuration.', 'error');
            }
        }
    }

    function closeFloorConfigModal() {
        if (floorConfigModal) floorConfigModal.hidden = true;
    }

    async function persistFloorConfig() {
        if (!floorConfigSaveBtn) return;
        const tableCount = parseInt(String(floorTableCountInput && floorTableCountInput.value), 10);
        const parcelCount = parseInt(String(floorParcelCountInput && floorParcelCountInput.value), 10);
        if (!Number.isFinite(tableCount) || tableCount < 1 || tableCount > 30) {
            setFloorConfigMessage('Tables must be between 1 and 30.', 'error');
            return;
        }
        if (!Number.isFinite(parcelCount) || parcelCount < 1 || parcelCount > 20) {
            setFloorConfigMessage('Parcel counters must be between 1 and 20.', 'error');
            return;
        }
        setBtnLoading(floorConfigSaveBtn, true);
        setFloorConfigMessage('Saving…', null);
        try {
            await saveFloorConfig(tableCount, parcelCount);
            renderFloorConfigForm();
            setFloorConfigMessage('Floor layout saved. Open the tables screen to see changes.', 'success');
        } catch (err) {
            if (err && err.code === 401) {
                clearAdminCredentials();
                showAdminGate('Session expired. Enter admin credentials again.');
            } else {
                setFloorConfigMessage(err.message || 'Could not save floor configuration.', 'error');
            }
        } finally {
            setBtnLoading(floorConfigSaveBtn, false);
        }
    }

    floorConfigBtn?.addEventListener('click', openFloorConfigModal);
    floorConfigCloseBtn?.addEventListener('click', closeFloorConfigModal);
    floorConfigSaveBtn?.addEventListener('click', persistFloorConfig);
    floorConfigModal?.addEventListener('click', (e) => {
        if (e.target === floorConfigModal) closeFloorConfigModal();
    });

    const hotelsBtn = document.getElementById('adminHotelsBtn');
    const hotelsModal = document.getElementById('adminHotelsModal');
    const hotelsCloseBtn = document.getElementById('adminHotelsCloseBtn');
    const hotelsMsg = document.getElementById('adminHotelsMsg');
    const hotelCreateBtn = document.getElementById('adminHotelCreateBtn');
    const hotelNameInput = document.getElementById('adminHotelName');
    const hotelCityInput = document.getElementById('adminHotelCity');
    const hotelSlugInput = document.getElementById('adminHotelSlug');
    const hotelAdminUserInput = document.getElementById('adminHotelAdminUser');
    const hotelAdminPassInput = document.getElementById('adminHotelAdminPass');
    const hotelTableCountInput = document.getElementById('adminHotelTableCount');
    const hotelParcelCountInput = document.getElementById('adminHotelParcelCount');
    const hotelContactMobileInput = document.getElementById('adminHotelContactMobile');
    const hotelHoursTextInput = document.getElementById('adminHotelHoursText');
    const hotelTypeInput = document.getElementById('adminHotelType');

    function setHotelsMessage(text, state) {
        if (!hotelsMsg) return;
        hotelsMsg.textContent = text || '';
        if (state) hotelsMsg.setAttribute('data-state', state);
        else hotelsMsg.removeAttribute('data-state');
    }

    function clearHotelCreateForm() {
        if (hotelNameInput) hotelNameInput.value = '';
        if (hotelCityInput) hotelCityInput.value = '';
        if (hotelSlugInput) hotelSlugInput.value = '';
        if (hotelAdminUserInput) hotelAdminUserInput.value = '';
        if (hotelAdminPassInput) hotelAdminPassInput.value = '';
        if (hotelTableCountInput) hotelTableCountInput.value = '7';
        if (hotelParcelCountInput) hotelParcelCountInput.value = '5';
        if (hotelContactMobileInput) hotelContactMobileInput.value = '';
        if (hotelHoursTextInput) hotelHoursTextInput.value = '';
    }

    async function openHotelsModal() {
        if (!hotelsModal) return;
        hotelsModal.hidden = false;
        setHotelsMessage('', null);
        try {
            await fetchManagedHotels();
            renderManagedHotelsList();
        } catch (err) {
            if (err && err.code === 401) {
                clearAdminCredentials();
                showAdminGate('Session expired. Enter admin credentials again.');
            } else {
                setHotelsMessage(err.message || 'Could not load hotels.', 'error');
            }
        }
    }

    function closeHotelsModal() {
        if (hotelsModal) hotelsModal.hidden = true;
    }

    hotelsBtn?.addEventListener('click', openHotelsModal);
    hotelsCloseBtn?.addEventListener('click', closeHotelsModal);
    hotelsModal?.addEventListener('click', (e) => {
        if (e.target === hotelsModal) closeHotelsModal();
    });

    hotelCreateBtn?.addEventListener('click', async () => {
        if (!isMainAdminVenue()) {
            setHotelsMessage('Only QuickKart can create hotels.', 'error');
            return;
        }
        const name = String(hotelNameInput?.value || '').trim();
        const city = String(hotelCityInput?.value || '').trim();
        const slug = String(hotelSlugInput?.value || '').trim();
        const adminUser = String(hotelAdminUserInput?.value || '').trim();
        const adminPass = String(hotelAdminPassInput?.value || '').trim();
        const tableCount = parseInt(String(hotelTableCountInput?.value || '7'), 10);
        const parcelCount = parseInt(String(hotelParcelCountInput?.value || '5'), 10);
        const contactMobile = String(hotelContactMobileInput?.value || '').trim();
        const hoursText = String(hotelHoursTextInput?.value || '').trim();
        const venueType = hotelTypeInput?.value === 'grocery' ? 'grocery' : 'food';
        if (!name || !adminUser || !adminPass) {
            setHotelsMessage('Name, admin username, and password are required.', 'error');
            return;
        }
        setBtnLoading(hotelCreateBtn, true);
        setHotelsMessage('Creating…', null);
        try {
            await createManagedHotel({
                name,
                city,
                slug: slug || undefined,
                adminUser,
                adminPass,
                tableCount,
                parcelCount,
                contactMobile,
                hoursText,
                venueType
            });
            clearHotelCreateForm();
            await fetchManagedHotels();
            hasGroceryStores = managedHotels.some((v) => v.venueType === 'grocery');
            applyMainVenueUi();
            renderManagedHotelsList();
            setHotelsMessage('Hotel created. Share the login with that property.', 'success');
        } catch (err) {
            if (err && err.code === 401) {
                clearAdminCredentials();
                showAdminGate('Session expired. Enter admin credentials again.');
            } else {
                setHotelsMessage(err.message || 'Could not create hotel.', 'error');
            }
        } finally {
            setBtnLoading(hotelCreateBtn, false);
        }
    });

    hotelsModal?.addEventListener('click', async (e) => {
        const invBtn = e.target.closest('[data-hotel-inventory]');
        if (invBtn) {
            const id = invBtn.getAttribute('data-hotel-inventory');
            closeHotelsModal();
            if (typeof window.openGroceryInventory === 'function') {
                window.openGroceryInventory(id);
            }
            return;
        }
        const menuBtn = e.target.closest('[data-hotel-menu]');
        if (menuBtn) {
            const id = menuBtn.getAttribute('data-hotel-menu');
            await openPartnerMenuEditor(id);
            return;
        }
        const editBtn = e.target.closest('[data-hotel-edit]');
        if (editBtn) {
            const id = editBtn.getAttribute('data-hotel-edit');
            const form = document.getElementById(`adminHotelEditForm-${id}`);
            if (form) form.hidden = !form.hidden;
            return;
        }
        const saveBtn = e.target.closest('[data-hotel-save]');
        if (!saveBtn) return;
        const id = saveBtn.getAttribute('data-hotel-save');
        const userInput = hotelsModal.querySelector(`[data-hotel-user="${id}"]`);
        const passInput = hotelsModal.querySelector(`[data-hotel-pass="${id}"]`);
        const contactInput = hotelsModal.querySelector(`[data-hotel-contact="${id}"]`);
        const hoursInput = hotelsModal.querySelector(`[data-hotel-hours="${id}"]`);
        const adminUser = userInput ? String(userInput.value || '').trim() : '';
        const adminPass = passInput ? String(passInput.value || '').trim() : '';
        const contactMobile = contactInput ? String(contactInput.value || '').trim() : '';
        const hoursText = hoursInput ? String(hoursInput.value || '').trim() : '';
        const hotel = managedHotels.find((row) => String(row.id) === String(id));
        if (!hotel?.isMain && !adminUser) {
            setHotelsMessage('Admin username is required.', 'error');
            return;
        }
        setBtnLoading(saveBtn, true);
        setHotelsMessage('Saving…', null);
        try {
            if (hotel?.isMain) {
                const profileRes = await fetch('/api/admin/venue-profile', {
                    method: 'PUT',
                    headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contactMobile, hoursText })
                });
                const profileData = await profileRes.json().catch(() => ({}));
                if (!profileRes.ok) throw new Error(profileData.error || 'Could not save hotel details.');
            } else {
                const payload = { contactMobile, hoursText, adminUser };
                if (adminPass) payload.adminPass = adminPass;
                await updateManagedHotelAccess(id, payload);
            }
            await fetchManagedHotels();
            renderManagedHotelsList();
            setHotelsMessage('Hotel details updated.', 'success');
        } catch (err) {
            if (err && err.code === 401) {
                clearAdminCredentials();
                showAdminGate('Session expired. Enter admin credentials again.');
            } else {
                setHotelsMessage(err.message || 'Could not update hotel.', 'error');
            }
        } finally {
            setBtnLoading(saveBtn, false);
        }
    });

    const partnerMenuBtn = document.getElementById('adminPartnerMenuBtn');
    const partnerMenuModal = document.getElementById('adminPartnerMenuModal');
    const partnerMenuCloseBtn = document.getElementById('adminPartnerMenuCloseBtn');
    const partnerMenuAddForm = document.getElementById('adminPartnerMenuAddForm');
    const partnerMenuItemName = document.getElementById('adminPartnerMenuItemName');
    const partnerMenuItemOnlinePrice = document.getElementById('adminPartnerMenuItemOnlinePrice');
    const partnerMenuItemOfflinePrice = document.getElementById('adminPartnerMenuItemOfflinePrice');
    const partnerMenuHalfFullToggle = document.getElementById('adminPartnerMenuHalfFull');
    const partnerMenuSinglePriceRow = document.getElementById('adminPartnerMenuSinglePriceRow');
    const partnerMenuHalfFullRow = document.getElementById('adminPartnerMenuHalfFullRow');
    const partnerMenuItemHalfOnlinePrice = document.getElementById('adminPartnerMenuItemHalfOnlinePrice');
    const partnerMenuItemHalfOfflinePrice = document.getElementById('adminPartnerMenuItemHalfOfflinePrice');
    const partnerMenuItemFullOnlinePrice = document.getElementById('adminPartnerMenuItemFullOnlinePrice');
    const partnerMenuItemFullOfflinePrice = document.getElementById('adminPartnerMenuItemFullOfflinePrice');
    const partnerMenuItemCategory = document.getElementById('adminPartnerMenuItemCategory');
    const partnerMenuCategoryList = document.getElementById('adminPartnerMenuCategoryList');
    const partnerMenuList = document.getElementById('adminPartnerMenuList');
    const partnerMenuListCount = document.getElementById('adminPartnerMenuListCount');
    const partnerMenuAddBtn = document.getElementById('adminPartnerMenuAddBtn');
    const partnerMenuCancelBtn = document.getElementById('adminPartnerMenuCancelBtn');
    const partnerMenuFormTitle = document.getElementById('adminPartnerMenuFormTitle');
    const partnerMenuMsg = document.getElementById('adminPartnerMenuMsg');
    const partnerMenuModalTitle = document.getElementById('adminPartnerMenuModalTitle');
    const partnerMenuModalSub = document.getElementById('adminPartnerMenuModalSub');
    const partnerMenuItemImage = document.getElementById('adminPartnerMenuItemImage');
    const partnerMenuItemImagePreview = document.getElementById('adminPartnerMenuItemImagePreview');
    const partnerMenuItemImagePreviewImg = document.getElementById('adminPartnerMenuItemImagePreviewImg');
    const partnerMenuItemImageClear = document.getElementById('adminPartnerMenuItemImageClear');
    let partnerMenuVenueId = null;
    let partnerMenuCategories = [];
    let partnerMenuVenueName = '';
    let partnerMenuEditing = null;
    let partnerMenuPendingImageBase64 = null;

    function compressMenuItemImage(file, maxDim = 400) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let w = img.width, h = img.height;
                    if (w > maxDim || h > maxDim) {
                        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
                        else { w = Math.round(w * maxDim / h); h = maxDim; }
                    }
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/webp', 0.75));
                };
                img.onerror = () => reject(new Error('Invalid image'));
                img.src = reader.result;
            };
            reader.onerror = () => reject(new Error('Could not read file'));
            reader.readAsDataURL(file);
        });
    }

    function showMenuItemImagePreview(src) {
        if (partnerMenuItemImagePreview && partnerMenuItemImagePreviewImg) {
            partnerMenuItemImagePreviewImg.src = src;
            partnerMenuItemImagePreview.style.display = 'inline-block';
        }
    }

    function clearMenuItemImage() {
        partnerMenuPendingImageBase64 = null;
        if (partnerMenuItemImage) partnerMenuItemImage.value = '';
        if (partnerMenuItemImagePreview) partnerMenuItemImagePreview.style.display = 'none';
        if (partnerMenuItemImagePreviewImg) partnerMenuItemImagePreviewImg.src = '';
    }

    partnerMenuItemImage?.addEventListener('change', async () => {
        const file = partnerMenuItemImage.files?.[0];
        if (!file) return;
        try {
            partnerMenuPendingImageBase64 = await compressMenuItemImage(file);
            showMenuItemImagePreview(partnerMenuPendingImageBase64);
        } catch {
            setPartnerMenuMessage('Could not load image.', 'error');
            clearMenuItemImage();
        }
    });

    partnerMenuItemImageClear?.addEventListener('click', () => {
        partnerMenuPendingImageBase64 = '__clear__';
        clearMenuItemImage();
    });

    function slugifyMenuId(text) {
        return (
            String(text || '')
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '') || 'item'
        );
    }

    function collectPartnerMenuItemIds(categories) {
        const ids = new Set();
        for (const cat of categories || []) {
            for (const item of cat.items || []) {
                if (item && item.id) ids.add(String(item.id));
            }
            for (const sub of cat.subsections || []) {
                for (const item of sub.items || []) {
                    if (item && item.id) ids.add(String(item.id));
                }
            }
        }
        return ids;
    }

    function makeUniquePartnerItemId(categories, name) {
        const base = slugifyMenuId(name);
        const existing = collectPartnerMenuItemIds(categories);
        let id = base;
        let n = 2;
        while (existing.has(id)) {
            id = `${base}-${n++}`;
        }
        return id;
    }

    function findPartnerCategory(categories, categoryName) {
        const normalized = String(categoryName || '').trim().toLowerCase();
        if (!normalized) return null;
        return (categories || []).find((cat) => String(cat.name || '').trim().toLowerCase() === normalized) || null;
    }

    function findOrCreatePartnerCategory(categories, categoryName) {
        const name = String(categoryName || '').trim();
        if (!name) return null;
        let cat = findPartnerCategory(categories, name);
        if (cat) return cat;
        const baseId = slugifyMenuId(name);
        let id = baseId;
        let n = 2;
        const usedIds = new Set((categories || []).map((c) => String(c.id || '')));
        while (usedIds.has(id)) {
            id = `${baseId}-${n++}`;
        }
        cat = { id, name, items: [] };
        categories.push(cat);
        return cat;
    }

    function normalizePartnerMenuCategories(rawCategories) {
        const categories = JSON.parse(JSON.stringify(rawCategories || []));
        for (const cat of categories) {
            if (!cat.id) cat.id = slugifyMenuId(cat.name || 'category');
            if (!Array.isArray(cat.items)) cat.items = [];
            const existingIds = collectPartnerMenuItemIds(categories);
            for (const item of cat.items) {
                if (!item || item.enabled === false) continue;
                if (!item.id) {
                    item.id = makeUniquePartnerItemId(categories, item.name || 'item');
                    existingIds.add(String(item.id));
                }
                if (!item.alt && item.name) item.alt = item.name;
                if (!item.image) item.image = 'images/placeholder-icon.svg';
            }
            for (const sub of cat.subsections || []) {
                for (const item of sub.items || []) {
                    if (!item || item.enabled === false) continue;
                    if (!item.id) {
                        item.id = makeUniquePartnerItemId(categories, item.name || 'item');
                        existingIds.add(String(item.id));
                    }
                    if (!item.alt && item.name) item.alt = item.name;
                    if (!item.image) item.image = 'images/placeholder-icon.svg';
                }
            }
        }
        return categories;
    }

    function getPartnerMenuItemPrice(item) {
        if (item.onlinePrice != null) return item.onlinePrice;
        if (item.price != null) return item.price;
        return null;
    }

    function getPartnerMenuItemOfflinePrice(item) {
        if (item.offlinePrice != null) return item.offlinePrice;
        return getPartnerMenuItemPrice(item);
    }

    function itemUsesHalfFullPricing(item) {
        return Boolean(item.sizes && (item.sizes.half != null || item.sizes.full != null));
    }

    function getPartnerMenuSizePrice(item, size) {
        if (!item.sizes || !item.sizes[size]) return null;
        if (item.sizes[size].onlinePrice != null) return item.sizes[size].onlinePrice;
        if (item.sizes[size].price != null) return item.sizes[size].price;
        return null;
    }

    function getPartnerMenuSizeOfflinePrice(item, size) {
        if (!item.sizes || !item.sizes[size]) return null;
        if (item.sizes[size].offlinePrice != null) return item.sizes[size].offlinePrice;
        return getPartnerMenuSizePrice(item, size);
    }

    function formatPartnerMenuItemPrice(item) {
        if (!item) return '—';
        const half = getPartnerMenuSizePrice(item, 'half');
        const full = getPartnerMenuSizePrice(item, 'full');
        if (half != null && full != null) return `₹${half} / ₹${full}`;
        if (full != null && half == null) return `₹${full}`;
        if (half != null) return `₹${half}`;
        const p = getPartnerMenuItemPrice(item);
        return p != null ? `₹${p}` : '—';
    }

    function syncPartnerMenuPricingFields() {
        const useHalfFull = Boolean(partnerMenuHalfFullToggle?.checked);
        if (partnerMenuSinglePriceRow) partnerMenuSinglePriceRow.hidden = useHalfFull;
        if (partnerMenuHalfFullRow) partnerMenuHalfFullRow.hidden = !useHalfFull;
        if (partnerMenuItemOnlinePrice) partnerMenuItemOnlinePrice.required = !useHalfFull;
        if (partnerMenuItemFullOnlinePrice) partnerMenuItemFullOnlinePrice.required = useHalfFull;
    }

    function buildPartnerMenuItemPricing(values) {
        if (values.useHalfFull) {
            const sizes = {};
            if (Number.isFinite(values.halfOnlinePrice) && values.halfOnlinePrice >= 1) {
                sizes.half = { 
                    onlinePrice: values.halfOnlinePrice,
                    offlinePrice: Number.isFinite(values.halfOfflinePrice) && values.halfOfflinePrice >= 1 ? values.halfOfflinePrice : values.halfOnlinePrice
                };
            }
            if (Number.isFinite(values.fullOnlinePrice) && values.fullOnlinePrice >= 1) {
                sizes.full = { 
                    onlinePrice: values.fullOnlinePrice,
                    offlinePrice: Number.isFinite(values.fullOfflinePrice) && values.fullOfflinePrice >= 1 ? values.fullOfflinePrice : values.fullOnlinePrice
                };
            }
            return { sizes };
        }
        return { 
            onlinePrice: values.onlinePrice,
            offlinePrice: Number.isFinite(values.offlinePrice) && values.offlinePrice >= 1 ? values.offlinePrice : values.onlinePrice
        };
    }

    function collectPartnerMenuRows(categories) {
        const rows = [];
        for (const cat of categories || []) {
            const categoryName = String(cat.name || 'Category').trim();
            const catId = cat.id;
            const pushRow = (item) => {
                if (!item || item.enabled === false) return;
                const name = String(item.name || '').trim();
                const priceLabel = formatPartnerMenuItemPrice(item);
                if (!name || priceLabel === '—') return;
                rows.push({
                    item,
                    catId,
                    categoryName,
                    name,
                    priceLabel
                });
            };
            for (const item of cat.items || []) pushRow(item);
            for (const sub of cat.subsections || []) {
                for (const item of sub.items || []) pushRow(item);
            }
        }
        rows.sort((a, b) => {
            const catCmp = a.categoryName.localeCompare(b.categoryName, undefined, { sensitivity: 'base' });
            if (catCmp !== 0) return catCmp;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
        return rows;
    }

    function resetPartnerMenuFormMode() {
        partnerMenuEditing = null;
        if (partnerMenuFormTitle) partnerMenuFormTitle.textContent = 'Add menu item';
        if (partnerMenuAddBtn) partnerMenuAddBtn.textContent = 'Add item';
        if (partnerMenuCancelBtn) partnerMenuCancelBtn.hidden = true;
        partnerMenuAddForm?.reset();
        if (partnerMenuHalfFullToggle) partnerMenuHalfFullToggle.checked = false;
        syncPartnerMenuPricingFields();
        clearMenuItemImage();
    }

    function findPartnerMenuItemRef(categoryId, itemId) {
        const cat = (partnerMenuCategories || []).find((c) => String(c.id) === String(categoryId));
        if (!cat) return null;
        const direct = (cat.items || []).find((item) => String(item.id) === String(itemId));
        if (direct) return { item: direct, cat };
        for (const sub of cat.subsections || []) {
            const nested = (sub.items || []).find((item) => String(item.id) === String(itemId));
            if (nested) return { item: nested, cat, sub };
        }
        return null;
    }

    function extractPartnerMenuItem(categoryId, itemId) {
        const cat = (partnerMenuCategories || []).find((c) => String(c.id) === String(categoryId));
        if (!cat) return null;
        const itemIndex = (cat.items || []).findIndex((item) => String(item.id) === String(itemId));
        if (itemIndex >= 0) {
            const [item] = cat.items.splice(itemIndex, 1);
            return item;
        }
        for (const sub of cat.subsections || []) {
            const subIndex = (sub.items || []).findIndex((item) => String(item.id) === String(itemId));
            if (subIndex >= 0) {
                const [item] = sub.items.splice(subIndex, 1);
                return item;
            }
        }
        return null;
    }

    function updatePartnerMenuItem(oldCatId, itemId, values) {
        const existing = extractPartnerMenuItem(oldCatId, itemId);
        if (!existing) return false;

        const pricing = buildPartnerMenuItemPricing(values);
        const updated = {
            ...existing,
            name: values.name,
            alt: values.name,
            enabled: existing.enabled !== false
        };
        delete updated.price;
        delete updated.sizes;
        delete updated.customerPrice;
        delete updated.basePrice;
        Object.assign(updated, pricing);

        if (partnerMenuPendingImageBase64 === '__clear__') {
            updated.image = '';
        } else if (partnerMenuPendingImageBase64) {
            updated.image = partnerMenuPendingImageBase64;
        }

        const targetCat = findOrCreatePartnerCategory(partnerMenuCategories, values.categoryName);
        if (!targetCat.items) targetCat.items = [];
        targetCat.items.push(updated);
        pruneEmptyPartnerCategories();
        return true;
    }

    function startPartnerMenuEdit(categoryId, itemId) {
        const ref = findPartnerMenuItemRef(categoryId, itemId);
        if (!ref) return;
        if (formatPartnerMenuItemPrice(ref.item) === '—') return;

        partnerMenuEditing = { catId: String(categoryId), itemId: String(itemId) };
        if (partnerMenuFormTitle) partnerMenuFormTitle.textContent = 'Edit menu item';
        if (partnerMenuAddBtn) partnerMenuAddBtn.textContent = 'Save changes';
        if (partnerMenuCancelBtn) partnerMenuCancelBtn.hidden = false;
        if (partnerMenuItemName) partnerMenuItemName.value = String(ref.item.name || '').trim();
        if (partnerMenuItemCategory) partnerMenuItemCategory.value = String(ref.cat.name || '').trim();

        const useHalfFull = itemUsesHalfFullPricing(ref.item);
        if (partnerMenuHalfFullToggle) partnerMenuHalfFullToggle.checked = useHalfFull;
        syncPartnerMenuPricingFields();

        if (useHalfFull) {
            if (partnerMenuItemHalfOnlinePrice) {
                const half = getPartnerMenuSizePrice(ref.item, 'half');
                partnerMenuItemHalfOnlinePrice.value = half != null ? String(half) : '';
            }
            if (partnerMenuItemHalfOfflinePrice) {
                const halfOff = getPartnerMenuSizeOfflinePrice(ref.item, 'half');
                partnerMenuItemHalfOfflinePrice.value = halfOff != null ? String(halfOff) : '';
            }
            if (partnerMenuItemFullOnlinePrice) {
                const full = getPartnerMenuSizePrice(ref.item, 'full');
                partnerMenuItemFullOnlinePrice.value = full != null ? String(full) : '';
            }
            if (partnerMenuItemFullOfflinePrice) {
                const fullOff = getPartnerMenuSizeOfflinePrice(ref.item, 'full');
                partnerMenuItemFullOfflinePrice.value = fullOff != null ? String(fullOff) : '';
            }
            if (partnerMenuItemOnlinePrice) partnerMenuItemOnlinePrice.value = '';
            if (partnerMenuItemOfflinePrice) partnerMenuItemOfflinePrice.value = '';
        } else {
            if (partnerMenuItemOnlinePrice) {
                const price = getPartnerMenuItemPrice(ref.item);
                partnerMenuItemOnlinePrice.value = price != null ? String(price) : '';
            }
            if (partnerMenuItemOfflinePrice) {
                const priceOff = getPartnerMenuItemOfflinePrice(ref.item);
                partnerMenuItemOfflinePrice.value = priceOff != null ? String(priceOff) : '';
            }
            if (partnerMenuItemHalfOnlinePrice) partnerMenuItemHalfOnlinePrice.value = '';
            if (partnerMenuItemHalfOfflinePrice) partnerMenuItemHalfOfflinePrice.value = '';
            if (partnerMenuItemFullOnlinePrice) partnerMenuItemFullOnlinePrice.value = '';
            if (partnerMenuItemFullOfflinePrice) partnerMenuItemFullOfflinePrice.value = '';
        }

        clearMenuItemImage();
        if (ref.item.image && ref.item.image !== 'images/placeholder-icon.svg') {
            partnerMenuPendingImageBase64 = null;
            showMenuItemImagePreview(ref.item.image);
        }

        setPartnerMenuMessage('', null);
        renderPartnerMenuList();
        partnerMenuItemName?.focus();
        partnerMenuAddForm?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function readPartnerMenuFormValues() {
        const name = String(partnerMenuItemName?.value || '').trim();
        const categoryName = String(partnerMenuItemCategory?.value || '').trim();
        const useHalfFull = Boolean(partnerMenuHalfFullToggle?.checked);
        const onlinePrice = parseInt(String(partnerMenuItemOnlinePrice?.value || ''), 10);
        const offlinePrice = parseInt(String(partnerMenuItemOfflinePrice?.value || ''), 10);
        const halfOnlinePrice = parseInt(String(partnerMenuItemHalfOnlinePrice?.value || ''), 10);
        const halfOfflinePrice = parseInt(String(partnerMenuItemHalfOfflinePrice?.value || ''), 10);
        const fullOnlinePrice = parseInt(String(partnerMenuItemFullOnlinePrice?.value || ''), 10);
        const fullOfflinePrice = parseInt(String(partnerMenuItemFullOfflinePrice?.value || ''), 10);
        return { name, categoryName, useHalfFull, onlinePrice, offlinePrice, halfOnlinePrice, halfOfflinePrice, fullOnlinePrice, fullOfflinePrice };
    }

    function validatePartnerMenuFormValues(values) {
        if (!values.name) {
            setPartnerMenuMessage('Enter item name.', 'error');
            partnerMenuItemName?.focus();
            return false;
        }
        if (!values.categoryName) {
            setPartnerMenuMessage('Enter category.', 'error');
            partnerMenuItemCategory?.focus();
            return false;
        }
        if (values.useHalfFull) {
            const hasHalf = Number.isFinite(values.halfOnlinePrice) && values.halfOnlinePrice >= 1;
            const hasFull = Number.isFinite(values.fullOnlinePrice) && values.fullOnlinePrice >= 1;
            if (!hasHalf && !hasFull) {
                setPartnerMenuMessage('Enter at least a Full online price, or both Half and Full.', 'error');
                partnerMenuItemFullOnlinePrice?.focus();
                return false;
            }
            if (hasHalf && hasFull && values.halfOnlinePrice >= values.fullOnlinePrice) {
                setPartnerMenuMessage('Half online price must be less than Full online price.', 'error');
                partnerMenuItemHalfOnlinePrice?.focus();
                return false;
            }
            return true;
        }
        if (!Number.isFinite(values.onlinePrice) || values.onlinePrice < 1) {
            setPartnerMenuMessage('Enter a valid online price.', 'error');
            partnerMenuItemOnlinePrice?.focus();
            return false;
        }
        return true;
    }

    function updatePartnerMenuCategoryDatalist() {
        if (!partnerMenuCategoryList) return;
        const names = (partnerMenuCategories || [])
            .map((cat) => String(cat.name || '').trim())
            .filter(Boolean);
        partnerMenuCategoryList.innerHTML = names.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
    }

    function renderPartnerMenuList() {
        if (!partnerMenuList) return;
        const rows = collectPartnerMenuRows(partnerMenuCategories);
        if (partnerMenuListCount) {
            partnerMenuListCount.textContent = `${rows.length} item${rows.length === 1 ? '' : 's'}`;
        }
        if (!rows.length) {
            partnerMenuList.innerHTML =
                '<div class="admin-partner-menu-table-wrap"><p class="admin-partner-menu-empty">No items yet. Add your first item above.</p></div>';
            updatePartnerMenuCategoryDatalist();
            return;
        }
        partnerMenuList.innerHTML = `
            <div class="admin-partner-menu-table-wrap">
                <table class="admin-partner-menu-table">
                    <thead>
                        <tr>
                            <th scope="col">Item</th>
                            <th scope="col">Category</th>
                            <th scope="col">Price</th>
                            <th scope="col">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows
                            .map(({ item, catId, categoryName, name, priceLabel }) => {
                                const isEditing =
                                    partnerMenuEditing &&
                                    String(partnerMenuEditing.catId) === String(catId) &&
                                    String(partnerMenuEditing.itemId) === String(item.id);
                                return `
                        <tr${isEditing ? ' data-partner-menu-editing="true"' : ''}>
                            <td><span class="admin-partner-menu-table-name">${escapeHtml(name)}</span></td>
                            <td><span class="admin-partner-menu-table-cat">${escapeHtml(categoryName)}</span></td>
                            <td><span class="admin-partner-menu-table-price">${escapeHtml(priceLabel)}</span></td>
                            <td>
                                <div class="admin-partner-menu-table-actions">
                                    <button type="button" class="admin-partner-menu-item-edit" data-partner-menu-edit="${escapeHtml(String(item.id))}" data-partner-menu-cat="${escapeHtml(String(catId))}"${isEditing ? ' disabled' : ''}>Edit</button>
                                    <button type="button" class="admin-partner-menu-item-remove" data-partner-menu-remove="${escapeHtml(String(item.id))}" data-partner-menu-cat="${escapeHtml(String(catId))}"${partnerMenuEditing ? ' disabled' : ''}>Remove</button>
                                </div>
                            </td>
                        </tr>`;
                            })
                            .join('')}
                    </tbody>
                </table>
            </div>`;
        updatePartnerMenuCategoryDatalist();
    }

    function removePartnerMenuItem(categoryId, itemId) {
        const cat = (partnerMenuCategories || []).find((c) => String(c.id) === String(categoryId));
        if (!cat) return false;
        const before = (cat.items || []).length;
        cat.items = (cat.items || []).filter((item) => String(item.id) !== String(itemId));
        if (cat.items.length !== before) return true;
        for (const sub of cat.subsections || []) {
            const subBefore = (sub.items || []).length;
            sub.items = (sub.items || []).filter((item) => String(item.id) !== String(itemId));
            if (sub.items.length !== subBefore) return true;
        }
        return false;
    }

    function pruneEmptyPartnerCategories() {
        partnerMenuCategories = (partnerMenuCategories || []).filter((cat) => {
            const direct = (cat.items || []).length;
            const nested = (cat.subsections || []).some((sub) => (sub.items || []).length);
            return direct || nested;
        });
    }

    function setPartnerMenuMessage(text, state) {
        if (!partnerMenuMsg) return;
        partnerMenuMsg.textContent = text || '';
        if (state) partnerMenuMsg.setAttribute('data-state', state);
        else partnerMenuMsg.removeAttribute('data-state');
    }

    async function savePartnerMenuCategories() {
        const url = partnerMenuVenueId
            ? `/api/admin/menu?venueId=${encodeURIComponent(partnerMenuVenueId)}`
            : '/api/admin/menu';
        const res = await fetch(url, {
            method: 'PUT',
            headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories: partnerMenuCategories })
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
        if (!res.ok) throw new Error(data.error || res.statusText);
        partnerMenuCategories = normalizePartnerMenuCategories(data.categories || partnerMenuCategories);
        renderPartnerMenuList();
        return data;
    }

    async function openPartnerMenuEditor(venueId = null) {
        if (!partnerMenuModal) return;
        partnerMenuVenueId = venueId;
        partnerMenuModal.hidden = false;
        setPartnerMenuMessage('', null);
        resetPartnerMenuFormMode();
        try {
            const url = venueId ? `/api/admin/menu?venueId=${encodeURIComponent(venueId)}` : '/api/admin/menu';
            const res = await fetch(url, { headers: adminHeaders(), cache: 'no-store' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || res.statusText);
            if (data.editable === false) {
                setPartnerMenuMessage('This hotel menu is managed in menu.json.', 'error');
                if (partnerMenuAddForm) partnerMenuAddForm.hidden = true;
                partnerMenuList.innerHTML = '<p class="admin-partner-menu-empty">QuickKart menu is edited in menu.json.</p>';
                return;
            }
            if (partnerMenuAddForm) partnerMenuAddForm.hidden = false;
            partnerMenuCategories = normalizePartnerMenuCategories(data.categories || []);
            partnerMenuVenueName = (data.venue && data.venue.name) || '';
            if (partnerMenuModalTitle) {
                partnerMenuModalTitle.textContent = partnerMenuVenueName
                    ? `${partnerMenuVenueName} — menu`
                    : 'Hotel menu';
            }
            if (partnerMenuModalSub) {
                partnerMenuModalSub.textContent =
                    'Add items with name, price, and category. Customers see prices plus ₹8 online markup.';
            }
            renderPartnerMenuList();
        } catch (err) {
            setPartnerMenuMessage(err.message || 'Could not load menu.', 'error');
        }
    }

    function closePartnerMenuModal() {
        if (partnerMenuModal) partnerMenuModal.hidden = true;
        partnerMenuVenueId = null;
        partnerMenuCategories = [];
        partnerMenuVenueName = '';
        resetPartnerMenuFormMode();
        if (partnerMenuList) partnerMenuList.innerHTML = '';
        if (partnerMenuListCount) partnerMenuListCount.textContent = '0 items';
        if (partnerMenuAddForm) partnerMenuAddForm.hidden = false;
    }

    partnerMenuBtn?.addEventListener('click', () => openPartnerMenuEditor(null));
    partnerMenuCloseBtn?.addEventListener('click', closePartnerMenuModal);
    partnerMenuCancelBtn?.addEventListener('click', () => {
        resetPartnerMenuFormMode();
        renderPartnerMenuList();
        setPartnerMenuMessage('Edit cancelled.', null);
    });
    partnerMenuModal?.addEventListener('click', (e) => {
        if (e.target === partnerMenuModal) closePartnerMenuModal();
    });

    partnerMenuHalfFullToggle?.addEventListener('change', syncPartnerMenuPricingFields);
    syncPartnerMenuPricingFields();

    partnerMenuAddForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = readPartnerMenuFormValues();
        if (!validatePartnerMenuFormValues(values)) return;

        const { name, categoryName } = values;
        const pricing = buildPartnerMenuItemPricing(values);
        const snapshot = normalizePartnerMenuCategories(partnerMenuCategories);
        const isEditing = Boolean(partnerMenuEditing);

        if (isEditing) {
            if (!updatePartnerMenuItem(partnerMenuEditing.catId, partnerMenuEditing.itemId, values)) {
                setPartnerMenuMessage('Could not find item to update.', 'error');
                return;
            }
        } else {
            const cat = findOrCreatePartnerCategory(partnerMenuCategories, categoryName);
            if (!cat.items) cat.items = [];
            const newItem = {
                id: makeUniquePartnerItemId(partnerMenuCategories, name),
                name,
                alt: name,
                image: partnerMenuPendingImageBase64 && partnerMenuPendingImageBase64 !== '__clear__'
                    ? partnerMenuPendingImageBase64
                    : 'images/placeholder-icon.svg',
                enabled: true,
                ...pricing
            };
            cat.items.push(newItem);
        }

        setBtnLoading(partnerMenuAddBtn, true);
        setPartnerMenuMessage('Saving…', null);
        try {
            await savePartnerMenuCategories();
            resetPartnerMenuFormMode();
            partnerMenuItemName?.focus();
            setPartnerMenuMessage(isEditing ? 'Item updated.' : 'Item added.', 'success');
        } catch (err) {
            partnerMenuCategories = snapshot;
            pruneEmptyPartnerCategories();
            renderPartnerMenuList();
            setPartnerMenuMessage(err.message || 'Could not save menu.', 'error');
        } finally {
            setBtnLoading(partnerMenuAddBtn, false);
        }
    });

    partnerMenuList?.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('[data-partner-menu-edit]');
        if (editBtn) {
            if (partnerMenuEditing) return;
            const itemId = editBtn.getAttribute('data-partner-menu-edit');
            const catId = editBtn.getAttribute('data-partner-menu-cat');
            if (!itemId || !catId) return;
            startPartnerMenuEdit(catId, itemId);
            return;
        }

        const btn = e.target.closest('[data-partner-menu-remove]');
        if (!btn || partnerMenuEditing) return;
        const itemId = btn.getAttribute('data-partner-menu-remove');
        const catId = btn.getAttribute('data-partner-menu-cat');
        if (!itemId || !catId) return;

        const snapshot = normalizePartnerMenuCategories(partnerMenuCategories);
        if (!removePartnerMenuItem(catId, itemId)) return;
        pruneEmptyPartnerCategories();
        renderPartnerMenuList();

        setBtnLoading(btn, true);
        setPartnerMenuMessage('Saving…', null);
        try {
            await savePartnerMenuCategories();
            setPartnerMenuMessage('Item removed.', 'success');
        } catch (err) {
            partnerMenuCategories = snapshot;
            renderPartnerMenuList();
            setPartnerMenuMessage(err.message || 'Could not save menu.', 'error');
        } finally {
            setBtnLoading(btn, false);
        }
    });

    fillAdminDefaults();

    const hashKey = String(window.location.hash || '').replace(/^#/, '').trim();
    if (ORDER_STATUS_TABS.some((t) => t.key === hashKey)) {
        activeOrderTab = hashKey;
    }
    normalizeActiveOrderTab();
    if (!window.location.hash) {
        window.location.hash = `#${activeOrderTab}`;
    }

    window.addEventListener('hashchange', () => {
        const key = String(window.location.hash || '')
            .replace(/^#/, '')
            .trim();
        const countsByStatus = getCountsByStatus(filterOrdersForAdminView(lastOrders));
        const tabDef = ORDER_STATUS_TABS.find((t) => t.key === key);
        if (tabDef && isOrderTabVisible(tabDef, countsByStatus)) {
            activeOrderTab = key;
            renderTabsAndActiveList(lastOrders);
        } else {
            normalizeActiveOrderTab();
            renderTabsAndActiveList(lastOrders);
        }
    });

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

    function hideCompletePayModal() {
        if (payModalEl) payModalEl.hidden = true;
        completePayOrderId = null;
        if (payModalCashBtn) payModalCashBtn.disabled = false;
        if (payModalUpiBtn) payModalUpiBtn.disabled = false;
    }

    const screenshotModalEl = document.getElementById('adminScreenshotModal');
    const screenshotImgEl = document.getElementById('adminScreenshotImg');
    const screenshotLoadingEl = document.getElementById('adminScreenshotLoading');
    const screenshotErrorEl = document.getElementById('adminScreenshotError');
    const screenshotSubtitleEl = document.getElementById('adminScreenshotSubtitle');
    const screenshotOpenLinkEl = document.getElementById('adminScreenshotOpenLink');
    const screenshotCloseBtn = document.getElementById('adminScreenshotClose');
    const screenshotDoneBtn = document.getElementById('adminScreenshotDoneBtn');

    function setScreenshotModalState(state) {
        if (screenshotLoadingEl) screenshotLoadingEl.hidden = state !== 'loading';
        if (screenshotErrorEl) screenshotErrorEl.hidden = state !== 'error';
        if (screenshotImgEl) screenshotImgEl.hidden = state !== 'ready';
        if (screenshotOpenLinkEl) screenshotOpenLinkEl.hidden = state !== 'ready';
    }

    function hideAdminScreenshotModal() {
        if (!screenshotModalEl) return;
        screenshotModalEl.hidden = true;
        if (screenshotImgEl) {
            screenshotImgEl.onload = null;
            screenshotImgEl.onerror = null;
            screenshotImgEl.removeAttribute('src');
        }
        if (screenshotOpenLinkEl) screenshotOpenLinkEl.setAttribute('href', '#');
        setScreenshotModalState('loading');
    }

    function showAdminScreenshotModal(orderId) {
        if (!screenshotModalEl || !screenshotImgEl) return;

        const order = (lastOrders || []).find((o) => String(o.id) === String(orderId));
        const src = String(order?.payment_screenshot || '').trim();

        if (screenshotSubtitleEl) {
            screenshotSubtitleEl.textContent = order
                ? `Order #${order.id} · ${order.name || 'Customer'} · ₹${Number(order.total) || 0}`
                : `Order #${orderId}`;
        }

        setScreenshotModalState('loading');
        screenshotModalEl.hidden = false;

        if (!src) {
            setScreenshotModalState('error');
            return;
        }

        screenshotImgEl.onload = () => setScreenshotModalState('ready');
        screenshotImgEl.onerror = () => setScreenshotModalState('error');
        screenshotImgEl.removeAttribute('src');
        screenshotImgEl.src = src;
        if (screenshotOpenLinkEl) screenshotOpenLinkEl.href = src;
        if (screenshotImgEl.complete && screenshotImgEl.naturalWidth > 0) {
            setScreenshotModalState('ready');
        }
    }

    window.openAdminScreenshotModal = showAdminScreenshotModal;

    screenshotCloseBtn?.addEventListener('click', hideAdminScreenshotModal);
    screenshotDoneBtn?.addEventListener('click', hideAdminScreenshotModal);
    screenshotModalEl?.addEventListener('click', (e) => {
        if (e.target === screenshotModalEl) hideAdminScreenshotModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && screenshotModalEl && !screenshotModalEl.hidden) {
            hideAdminScreenshotModal();
        }
    });

    function showCompletePayModal(orderId) {
        if (!payModalEl) return;
        const order = (lastOrders || []).find((o) => String(o.id) === String(orderId));
        completePayOrderId = String(orderId);
        if (payModalTitleEl) payModalTitleEl.textContent = `Complete order #${orderId}`;
        if (payModalSubEl) {
            payModalSubEl.textContent = order
                ? `${order.name || 'Customer'} · ${formatMoney(order.total)} — choose how they paid`
                : 'Choose how the customer paid';
        }
        payModalEl.hidden = false;
    }

    async function completeOrderWithPayment(paymentMethod, triggerBtn) {
        const id = completePayOrderId;
        if (!id) return;
        const otherBtn = triggerBtn === payModalCashBtn ? payModalUpiBtn : payModalCashBtn;
        setBtnLoading(triggerBtn, true);
        if (otherBtn) otherBtn.disabled = true;
        try {
            await patchOrder(id, 'completed', { payment_method: paymentMethod });
            hideCompletePayModal();
            pinnedOrderIdsAfterStatusChange.add(String(id));
            showToast(`Order #${id} completed · ${paymentMethod}`);
            await refresh();
        } catch (err) {
            if (err && err.code === 401) {
                clearAdminCredentials();
                hideCompletePayModal();
                showAdminGate('Session expired. Enter admin credentials again.');
            } else {
                alert(err.message || 'Update failed');
            }
        } finally {
            setBtnLoading(triggerBtn, false);
            if (otherBtn) otherBtn.disabled = false;
        }
    }

    payModalCloseBtn?.addEventListener('click', hideCompletePayModal);
    payModalEl?.addEventListener('click', (e) => {
        if (e.target === payModalEl) hideCompletePayModal();
    });
    payModalCashBtn?.addEventListener('click', () => completeOrderWithPayment('CASH', payModalCashBtn));
    payModalUpiBtn?.addEventListener('click', () => completeOrderWithPayment('UPI', payModalUpiBtn));

    function getCountsByStatus(orders) {
        const counts = {};
        for (const tab of ORDER_STATUS_TABS) counts[tab.key] = 0;
        const delivery = (orders || []).filter((o) => !isKotFloorOrder(o));
        const kot = (orders || []).filter((o) => isKotFloorOrder(o));
        counts.kot = kot.length;
        counts.all = delivery.length;
        counts.grocery = delivery.filter((o) => isGroceryOrder(o)).length;
        counts.active = (orders || []).filter((o) => isUnsettledOrder(o)).length;
        for (const o of delivery) {
            if (counts[o.status] !== undefined) counts[o.status] += 1;
        }
        return counts;
    }

    function normalizeSearch(s) {
        return String(s || '').trim().toLowerCase();
    }

    function renderTabsAndActiveList(orders) {
        const scoped = filterOrdersForAdminView(orders);
        const mobile = isAdminMobileView();
        const q = mobile ? '' : normalizeSearch(searchInput?.value);
        const searched = q ? scoped.filter((o) => matchesAdminOrderSearch(o, q)) : scoped;
        const deliverySearched = searched.filter((o) => !isKotFloorOrder(o));
        const kotSearched = searched.filter((o) => isKotFloorOrder(o));
        const viewTab = getEffectiveOrderTab();

        const countsByStatus = getCountsByStatus(searched);
        renderAdminAnalytics(scoped);
        renderOrderTabs(tabsEl, countsByStatus, viewTab);
        const tab = ORDER_STATUS_TABS.find((t) => t.key === viewTab) || ORDER_STATUS_TABS[0];
        const emptyText = q ? 'matching orders' : tab.emptyText || 'orders';

        if (viewTab === 'active') {
            renderMixedOrderList(listEl, {
                kotOrders: kotSearched.filter((o) => showInActiveOrdersTab(o, pinnedOrderIdsAfterStatusChange)),
                deliveryOrders: deliverySearched.filter((o) => showInActiveOrdersTab(o, pinnedOrderIdsAfterStatusChange)),
                deliveryEmptyText: emptyText
            });
            return;
        }

        if (viewTab === 'kot') {
            renderMixedOrderList(listEl, {
                kotOrders: kotSearched,
                deliveryOrders: [],
                deliveryEmptyText: emptyText
            });
            return;
        }

        if (viewTab === 'grocery') {
            renderMixedOrderList(listEl, {
                kotOrders: [],
                deliveryOrders: deliverySearched.filter((o) => isGroceryOrder(o)),
                deliveryEmptyText: emptyText
            });
            return;
        }

        const filteredDelivery =
            viewTab === 'all'
                ? deliverySearched
                : deliverySearched.filter(
                      (o) =>
                          o.status === viewTab ||
                          pinnedOrderIdsAfterStatusChange.has(String(o.id))
                  );

        renderMixedOrderList(listEl, {
            kotOrders: [],
            deliveryOrders: filteredDelivery,
            deliveryEmptyText: emptyText
        });
    }

    tabsEl?.addEventListener('click', (e) => {
        if (isAdminMobileView()) return;
        const btn = e.target.closest('button[data-status]');
        if (!btn) return;
        const nextKey = String(btn.getAttribute('data-status') || '');
        const countsByStatus = getCountsByStatus(filterOrdersForAdminView(lastOrders));
        const tabDef = ORDER_STATUS_TABS.find((t) => t.key === nextKey);
        if (!tabDef || !isOrderTabVisible(tabDef, countsByStatus)) return;
        if (nextKey === activeOrderTab) return;
        activeOrderTab = nextKey;
        pinnedOrderIdsAfterStatusChange.clear();
        window.location.hash = `#${activeOrderTab}`;
        renderTabsAndActiveList(lastOrders);
    });

    searchInput?.addEventListener('input', () => {
        if (isAdminMobileView()) return;
        renderTabsAndActiveList(lastOrders);
    });

    let wasAdminMobile = isAdminMobileView();
    window.addEventListener('resize', () => {
        const mobile = isAdminMobileView();
        if (mobile === wasAdminMobile) return;
        wasAdminMobile = mobile;
        if (mobile && searchInput) searchInput.value = '';
        renderTabsAndActiveList(lastOrders);
    });

    const DENSITY_KEY = 'quickkartAdminDensity';
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
        const data = computeAdminAnalytics(filterOrdersForAdminView(lastOrders));
        const lines = [
            `QuickKart — Today summary`,
            `Updated: ${data.updatedAt.toLocaleString()}`,
            `Orders today: ${data.ordersTodayCount} (delivery ${data.ordersTodayDelivery} · floor ${data.ordersTodayKot})`,
            `Settled sales: ${formatMoney(data.settledSalesToday)} (online ${formatMoney(data.settledDeliverySales)} · KOT ${formatMoney(data.settledKotSales)})`,
            `Payments: ${formatMoney(data.cashSettledToday)} cash (${data.cashCountToday}) · ${formatMoney(data.upiSettledToday)} UPI (${data.upiCountToday})`,
            `Delivery queue: pending ${data.deliveryPending} · in progress ${data.deliveryInProgress}`,
            `Floor live: ${data.kotActive} sessions · ${formatMoney(data.kotActiveValue)} open`,
            `Avg settled order: ${formatMoney(data.avgSettledToday)}`,
            `Discounts today (delivery): ${formatMoney(data.discountsToday)}`,
            `Delivery fees today: ${formatMoney(data.deliveryFeesToday)}`,
            `Last 60 min (delivery): ${data.last60MinDelivery} orders · ${formatMoney(data.last60MinDeliveryRevenue)}`,
            `Oldest pending: ${data.oldestPendingMs == null ? '—' : formatDuration(data.oldestPendingMs)}`,
            `Oldest in-progress: ${data.oldestInProgressMs == null ? '—' : formatDuration(data.oldestInProgressMs)}`,
            `Loaded in admin: ${data.totalOrdersLoaded} orders · ${formatMoney(data.totalSaleLoaded)} total sale`
        ];
        const ok = await safeClipboardWrite(lines.join('\n'));
        showToast(ok ? 'Summary copied' : 'Could not copy summary');
    });

    btnDownloadCsv?.addEventListener('click', () => {
        const rows = filterOrdersForAdminView(lastOrders).map((o) => ({
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
            filterOrdersForAdminView(lastOrders)
                .filter((o) => o.status === 'pending' && !isKotFloorOrder(o))
                .map((o) => String(o.id))
        );
        const next = pendingPopupQueue[0];
        if (next && pendingSet.has(String(next.id))) {
            showNewOrderPopup(next);
        }
    });

    async function handleNewOrderPopupAction(action, triggerBtn) {
        const id = newOrderPopupOrderId;
        if (!id) return;

        const otherBtn = triggerBtn === popupAcceptBtn ? popupCancelBtn : popupAcceptBtn;
        setBtnLoading(triggerBtn, true);
        if (otherBtn) otherBtn.disabled = true;

        try {
            await patchOrder(id, action);
            pinnedOrderIdsAfterStatusChange.add(String(id));
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
            setBtnLoading(triggerBtn, false);
            if (otherBtn) otherBtn.disabled = false;
        }
    }

    popupAcceptBtn?.addEventListener('click', () => handleNewOrderPopupAction('accept', popupAcceptBtn));
    popupCancelBtn?.addEventListener('click', () => handleNewOrderPopupAction('cancel', popupCancelBtn));

    const seenPending = loadSeenIds();
    let lastOrderId = loadLastOrderId();
    let bootstrapped = false;

    function applyOrdersRefreshState(orders) {
        const scopedOrders = filterOrdersForAdminView(orders);
        const pendingSet = new Set(
            scopedOrders
                .filter((o) => o.status === 'pending' && !isKotFloorOrder(o))
                .map((o) => String(o.id))
        );

        pendingPopupQueue = pendingPopupQueue.filter((o) => pendingSet.has(String(o.id)));
        pendingPopupQueueIds = new Set(pendingPopupQueue.map((o) => String(o.id)));

        if (newOrderPopupOpen && newOrderPopupOrderId && !pendingSet.has(newOrderPopupOrderId)) {
            hideNewOrderPopup();
        }

        if (!newOrderPopupOpen) {
            const next = pendingPopupQueue[0];
            if (next && pendingSet.has(String(next.id))) {
                showNewOrderPopup(next);
            }
        }

        if (orders.length > 0) {
            const latest = parseInt(String(orders[0].id), 10);
            if (Number.isFinite(latest) && latest > lastOrderId) {
                lastOrderId = latest;
                saveLastOrderId(lastOrderId);
            }
        }

        if (!bootstrapped) {
            scopedOrders
                .filter((o) => o.status === 'pending' && !isKotFloorOrder(o))
                .forEach((o) => seenPending.add(String(o.id)));
            saveSeenIds(seenPending);
            bootstrapped = true;
            return;
        }

        for (const o of scopedOrders) {
            const sid = String(o.id);
            if (o.status === 'pending' && !isKotFloorOrder(o) && !seenPending.has(sid)) {
                seenPending.add(sid);
                saveSeenIds(seenPending);
                showToast(`New order #${sid}`);

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
    }

    async function loadAdminDashboard(message = 'Loading…', options = {}) {
        const overlay = options.overlay === true;
        if (!overlay) hideAdminGate();
        setAdminDashboardLoading(message, { overlay });
        try {
            const ordersPromise = fetchOrders();
            await Promise.all([
                ordersPromise,
                refreshGroceryStorePresence().catch(() => {}),
                loadStoreStatus().catch(() => {}),
                fetchFloorConfig().catch(() => {})
            ]);
            const orders = await ordersPromise;
            lastOrders = orders;
            normalizeActiveOrderTab();
            renderTabsAndActiveList(orders);
            applyOrdersRefreshState(orders);
            ensureGroceryInventoryInit();
        } catch (e) {
            clearAdminDashboardLoading();
            if (e && e.code === 401) {
                clearAdminCredentials();
                hideNewOrderPopup();
                pendingPopupQueue = [];
                pendingPopupQueueIds = new Set();
                showAdminGate('Enter valid admin credentials to continue.');
                listEl.innerHTML = '<p class="admin-empty">Admin login required.</p>';
                if (tabsEl) tabsEl.innerHTML = '';
                return;
            }
            listEl.innerHTML = `<p class="admin-error">${escapeHtml(e.message)}</p>`;
            if (tabsEl) tabsEl.innerHTML = '<p class="admin-empty">Could not load filters.</p>';
            return;
        }
        clearAdminDashboardLoading();
    }

    async function refresh(showLoader = false) {
        if (showLoader) {
            await loadAdminDashboard('Refreshing…', { overlay: true });
            return;
        }
        try {
            const orders = await fetchOrders();
            lastOrders = orders;
            renderTabsAndActiveList(orders);
            applyOrdersRefreshState(orders);
        } catch (e) {
            if (e && e.code === 401) {
                clearAdminCredentials();
                hideNewOrderPopup();
                pendingPopupQueue = [];
                pendingPopupQueueIds = new Set();
                showAdminGate('Enter valid admin credentials to continue.');
                listEl.innerHTML = '<p class="admin-empty">Admin login required.</p>';
                if (tabsEl) tabsEl.innerHTML = '';
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

        if (action === 'copy') {
            const order = (lastOrders || []).find((o) => String(o.id) === String(id));
            const text = order ? buildOrderCopyText(order) : '';
            const ok = text ? await safeClipboardWrite(text) : false;
            showToast(ok ? `Order #${id} copied` : 'Could not copy order');
            return;
        }

        if (action === 'complete-prompt') {
            showCompletePayModal(id);
            return;
        }

        if (action === 'view_screenshot') {
            showAdminScreenshotModal(id);
            return;
        }

        setBtnLoading(btn, true);
        try {
            await patchOrder(id, action);
            pinnedOrderIdsAfterStatusChange.add(String(id));
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
            setBtnLoading(btn, false);
        }
    });

    if (refreshBtn)
        refreshBtn.addEventListener('click', async () => {
            setBtnLoading(refreshBtn, true);
            try {
                await refresh(true);
            } finally {
                setBtnLoading(refreshBtn, false);
            }
        });
    logoutBtn?.addEventListener('click', () => {
        clearAdminCredentials();
        window.location.href = '/admin-login';
    });

    authForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const user = ((authUser?.value || '').trim() || DEFAULT_ADMIN_USER);
        const pass = String(authPass?.value || DEFAULT_ADMIN_PASS).trim();
        if (!user || !pass) {
            showAdminGate('Enter both username and password.');
            return;
        }
        setBtnLoading(authSubmit, true);
        try {
            const session = await verifyAdminCredentials(user, pass).catch(() => null);
            if (!session) {
                clearAdminCredentials();
                showAdminGate('Invalid admin credentials. Please try again.');
            } else {
                window.location.reload();
            }
        } finally {
            setBtnLoading(authSubmit, false);
        }
    });

    const initAdmin = async () => {
        if (
            !window.quickkartAdminAuth.loadAdminToken() &&
            !localStorage.getItem('quickkartAdminCredentials')
        ) {
            await failAdminBoot('');
            return;
        }

        hideAdminGate();

        let session = null;
        try {
            session = await window.quickkartAdminAuth.ensureAdminSession(adminSessionHooks());
        } catch (err) {
            if (adminManualLoginDone) return;
            if (window.quickkartAdminAuth.loadAdminToken()) {
                await failAdminBoot(err.message || 'Could not verify session. Please log in again.');
                return;
            }
            await failAdminBoot(err.message || 'Could not verify session.');
            return;
        }

        if (session && session.venue && session.venue.venueType === 'grocery') {
            window.location.href = '/grocery-admin';
            return;
        }

        if (!session) {
            if (adminManualLoginDone) return;
            if (window.quickkartAdminAuth.loadAdminToken()) {
                session = await window.quickkartAdminAuth
                    .fetchAdminSession(adminSessionHooks())
                    .catch(() => null);
            }
            if (!session) {
                await failAdminBoot('Session expired. Please log in again.');
                return;
            }
        }
        if (adminManualLoginDone) return;
        await loadAdminDashboard('Loading orders…');
    };

    window.printAdminOrderReceipt = function(orderId) {
        const order = (lastOrders || []).find((o) => String(o.id) === String(orderId));
        if (!order) return;

        const styles = `
        @page { size: 72mm auto; margin: 0; }
        body { font-family: -apple-system, sans-serif; margin: 0; padding: 2mm; background: #fff; color: #000; width: 72mm; }
        .kot-print-sheet { width: 100%; box-sizing: border-box; }
        .kot-print-header { text-align: center; margin-bottom: 2mm; }
        .kot-print-title { font-size: 20px; font-weight: 800; line-height: 1.25; margin-bottom: 1mm; }
        .kot-print-address { font-size: 14px; font-weight: 600; line-height: 1.35; white-space: pre-wrap; }
        .kot-print-rule { border-top: 1px dashed #000; margin: 2mm 0; }
        .kot-print-order-meta { margin-bottom: 0.5mm; }
        .kot-print-meta-row { display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; line-height: 1.35; }
        .kot-print-meta-left { text-align: left; flex: 1 1 auto; min-width: 0; }
        .kot-print-meta-right { text-align: right; flex: 0 0 auto; white-space: nowrap; }
        .kot-print-meta-line--muted { color: #333; font-size: 12px; font-weight: 500; margin-top: 0.5mm; }
        .kot-print-table { width: 100%; border-collapse: collapse; }
        .kot-print-table th { border-bottom: 1px dashed #000; padding: 1mm 0; font-size: 13px; font-weight: 800; }
        .kot-print-table td { padding: 1.5mm 0; font-size: 14px; vertical-align: top; }
        .kot-print-item { width: auto; text-align: left; word-break: break-word; font-weight: 700; }
        .kot-print-qty { width: 10mm; text-align: center; white-space: nowrap; font-weight: 800; }
        .kot-print-amt { width: 16mm; text-align: right; white-space: nowrap; font-weight: 800; }
        .kot-print-empty { text-align: center; color: #444; font-weight: 600; }
        .kot-print-total-row { display: flex; justify-content: space-between; font-size: 16px; font-weight: 800; margin-top: 1mm; }
        .kot-print-footer { text-align: center; font-size: 15px; font-weight: 800; margin-top: 2mm; padding-top: 1mm; }
        .kot-print-delivery { text-align: center; font-size: 14px; font-weight: 700; line-height: 1.4; margin-top: 1.5mm; }
        `;

        const venueName = (currentVenue && currentVenue.name) || 'QuickKart';
        const printedAt = new Date().toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
        });

        const lines = (order.items || [])
            .map((ln) => {
                const q = Number(ln.quantity) || 0;
                const p = Number(ln.price) || 0;
                const amt = q * p;
                return `<tr>
                    <td class="kot-print-item">${escapeHtml(String(ln.name || ''))}</td>
                    <td class="kot-print-qty">${q}</td>
                    <td class="kot-print-amt">₹${amt}</td>
                </tr>`;
            })
            .join('');

        const receiptHtml = `<div class="kot-print-sheet">
            <header class="kot-print-header">
                <div class="kot-print-title">${escapeHtml(venueName)}</div>
                <div class="kot-print-address">Online Order</div>
            </header>
            <div class="kot-print-rule"></div>
            <div class="kot-print-order-meta">
                <div class="kot-print-meta-row">
                    <span class="kot-print-meta-left">${escapeHtml(order.name || 'Customer')}</span>
                    <span class="kot-print-meta-right">#${escapeHtml(order.id)}</span>
                </div>
                ${order.mobile ? `<div class="kot-print-meta-row"><span>${escapeHtml(order.mobile)}</span></div>` : ''}
                <div class="kot-print-meta-line--muted">${escapeHtml(printedAt)}</div>
            </div>
            <div class="kot-print-rule"></div>
            <table class="kot-print-table">
                <thead>
                    <tr>
                        <th class="kot-print-item">Item</th>
                        <th class="kot-print-qty">Qty</th>
                        <th class="kot-print-amt">Amt</th>
                    </tr>
                </thead>
                <tbody>${lines || '<tr><td colspan="3" class="kot-print-empty">No items</td></tr>'}</tbody>
            </table>
            <div class="kot-print-rule"></div>
            <div class="kot-print-total-row">
                <span>Total</span>
                <span>₹${Number(order.total) || 0}</span>
            </div>
            <footer class="kot-print-footer">Thank you! Visit again</footer>
            <div class="kot-print-delivery"><strong>${escapeHtml(order.city || '')}</strong></div>
        </div>`;

        let frame = document.getElementById('kotPrintFrame');
        if (!frame) {
            frame = document.createElement('iframe');
            frame.id = 'kotPrintFrame';
            frame.setAttribute('title', 'KOT print');
            frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
            document.body.appendChild(frame);
        }

        const doc = frame.contentDocument || frame.contentWindow.document;
        doc.open();
        doc.write(
            `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>KOT</title><style>${styles}</style></head><body>${receiptHtml}</body></html>`
        );
        doc.close();

        const win = frame.contentWindow;
        if (!win) return;

        const runPrint = () => {
            win.focus();
            win.print();
        };

        requestAnimationFrame(() => requestAnimationFrame(runPrint));
    };

    initAdmin();
});
