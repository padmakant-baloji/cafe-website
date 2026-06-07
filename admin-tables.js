'use strict';

const ADMIN_STORAGE_KEY = 'balojiAdminCredentials';
const LS_FLOOR_KEY_PREFIX = 'balojiFloorSessions';
/** Max rows in the inline KOT name dropdown (full menu is ~80 items; do not cap at 28). */
const KOT_SUGGEST_MAX = 200;

const KOT_OPEN_PICKS = [
    { name: 'Water bottle', label: 'Water bottle' },
    { name: 'Ice cream', label: 'Ice cream' },
    { name: '', label: 'Open' }
];

function kotOpenPicksSectionHtml() {
    const chips = KOT_OPEN_PICKS.map(
        (o) =>
            `<button type="button" class="kot-menu-pick kot-open-pick" data-open-name="${escapeAttr(o.name)}" data-category="Open item">${escapeHtml(o.label)}</button>`
    ).join('');
    return `<div class="kot-menu-browser-section kot-menu-browser-section--open" data-open-section="1">
        <h4 class="kot-menu-browser-cat">Open items</h4>
        <div class="kot-menu-browser-items">${chips}</div>
    </div>`;
}

function kotUnitPriceFromMenuPrice(menuPrice) {
    const p = parseInt(String(menuPrice), 10);
    if (!Number.isFinite(p) || p < 0) return 0;
    return p;
}

let creds = null;
let currentVenue = null;
/** @type {{ tableCount: number, parcelCount: number }} */
let floorConfig = { tableCount: 7, parcelCount: 5 };
let floorOrders = [];
/** @type {Array<object>} Active floor sessions kept only in this browser until settled (ids start with `local-`). */
let localFloorSessions = [];
/** @type {Array<object>} Last in-progress floor rows from the server (legacy / other tabs). */
let lastApiFloorRows = [];
let selectedOrderId = null;
let menuFlat = [];
let menuLoadPromise = null;
let kotSuggestFloatEl = null;
let kotSuggestRepositionHandler = null;
/** @type {HTMLElement|null} Row whose name field is active (menu picks apply here). */
let kotComposerActiveRow = null;
/** @type {string|null} Saved KOT id when draft is editing an existing ticket. */
let kotEditingId = null;
/** Phone breakpoint for the touch-first KOT capture flow (menu + slide-up order sheet). */
const KOT_MOBILE_MQL = window.matchMedia('(max-width: 720px)');
/** Whether the mobile order sheet is currently expanded (persists across drawer re-renders). */
let mobileSheetOpen = false;

function loadCreds() {
    try {
        const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (!p || !p.user || !p.pass) return null;
        return { user: String(p.user).trim(), pass: String(p.pass).trim() };
    } catch {
        return null;
    }
}

function saveCreds(user, pass) {
    creds = { user: String(user || '').trim(), pass: String(pass || '').trim() };
    try {
        localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(creds));
    } catch {
        /* ignore */
    }
}

function clearCreds() {
    creds = null;
    try {
        localStorage.removeItem(ADMIN_STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

function adminHeaders() {
    const c = creds || loadCreds();
    if (!c) return { Accept: 'application/json' };
    const token = btoa(`${c.user}:${c.pass}`);
    return { Authorization: `Basic ${token}`, Accept: 'application/json' };
}

function showToast(msg, ms = 2600) {
    const el = document.getElementById('floorToast');
    if (!el) return;
    el.textContent = msg;
    el.dataset.show = '1';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
        el.dataset.show = '0';
    }, ms);
}

/** Toggle a spinner + disabled state on a button during async work. */
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

function parseMeta(order) {
    const raw = order.order_meta;
    let m = raw;
    if (typeof raw === 'string') {
        try {
            m = JSON.parse(raw);
        } catch {
            m = {};
        }
    }
    if (!m || typeof m !== 'object') m = {};
    return {
        slot: typeof m.slot === 'string' ? m.slot : '',
        guest_label: typeof m.guest_label === 'string' ? m.guest_label : '',
        kots: Array.isArray(m.kots) ? m.kots : [],
        payment_method: m.payment_method || null
    };
}

function floorMeta(order) {
    const m = parseMeta(order);
    const kots = JSON.parse(JSON.stringify(Array.isArray(m.kots) ? m.kots : []));
    for (const kot of kots) {
        const lines = Array.isArray(kot.lines) ? kot.lines.filter((x) => x && typeof x === 'object') : [];
        kot.lines = lines;
        const legacyWhole =
            kot.done === true &&
            lines.length > 0 &&
            lines.every((ln) => ln && !Object.prototype.hasOwnProperty.call(ln, 'served'));
        if (legacyWhole) {
            for (const ln of lines) {
                ln.served = true;
            }
        }
        for (const ln of lines) {
            if (ln.served === undefined || ln.served === null) ln.served = false;
            else ln.served = Boolean(ln.served);
        }
        kot.done = lines.length > 0 && lines.every((l) => l && l.served);
    }
    return { ...m, kots };
}

function isMainKotVenue(venue) {
    if (!venue) return true;
    return Boolean(venue.isMain || venue.isDefault || venue.slug === 'balojicafe');
}

function resetKotMenuCache() {
    menuLoadPromise = null;
}

function loadMenuForKots() {
    if (menuLoadPromise) return menuLoadPromise;
    const useMenuJson = isMainKotVenue(currentVenue);
    const menuInit = useMenuJson
        ? fetch('/menu.json', { cache: 'no-store' }).then((r) => {
              if (!r.ok) throw new Error('menu');
              return r.json();
          })
        : fetch('/api/admin/menu', { headers: adminHeaders(), cache: 'no-store' }).then((r) => {
              if (!r.ok) throw new Error('menu');
              return r.json().then((payload) => ({ categories: payload.categories || [] }));
          });
    menuLoadPromise = menuInit
        .then((data) => {
            menuFlat = buildMenuFlat(data);
            document.querySelectorAll('.kot-menu-browser').forEach((el) => {
                delete el.dataset.rendered;
            });
            refreshOpenKotSuggestions();
            return menuFlat;
        })
        .catch(() => {
            menuFlat = [];
            return menuFlat;
        });
    return menuLoadPromise;
}

function menuItemIsListed(item) {
    return item && item.enabled !== false;
}

function pushMenuFlatEntry(out, name, price, categoryType) {
    const nm = String(name || '').trim();
    if (!nm) return;
    const p = parseInt(String(price), 10);
    if (Number.isNaN(p) || p < 0) return;
    const cat = String(categoryType || '').trim() || 'Menu';
    out.push({
        name: nm,
        price: p,
        category_type: cat,
        search: `${nm} ${cat}`.toLowerCase()
    });
}

function pushMenuItemToFlat(out, item, categoryType) {
    if (!menuItemIsListed(item)) return;
    const base = String(item.name || '').trim();
    if (!base) return;
    const sizes = item.sizes && Array.isArray(item.sizes) ? item.sizes : [];
    if (sizes.length) {
        for (const sz of sizes) {
            const label = String(sz.label || sz.name || '').trim();
            const name = label ? `${base} (${label})` : base;
            pushMenuFlatEntry(out, name, sz.price, categoryType);
        }
        return;
    }
    if (item.price != null && item.price !== '') {
        pushMenuFlatEntry(out, base, item.price, categoryType);
    }
}

function buildMenuFlat(menuData) {
    const out = [];
    if (!menuData || !Array.isArray(menuData.categories)) return out;
    for (const cat of menuData.categories) {
        const catName = String(cat.name || '').trim() || 'Menu';
        for (const item of cat.items || []) {
            pushMenuItemToFlat(out, item, catName);
        }
        for (const sub of cat.subsections || []) {
            const subTitle = String(sub.title || sub.name || '').trim();
            const sectionLabel = subTitle ? `${catName} · ${subTitle}` : catName;
            for (const item of sub.items || []) {
                pushMenuItemToFlat(out, item, sectionLabel);
            }
        }
    }
    return out;
}

function filterMenuSuggestions(q, limit = KOT_SUGGEST_MAX) {
    const cap = Number.isFinite(limit) && limit > 0 ? limit : KOT_SUGGEST_MAX;
    const s = String(q || '').trim().toLowerCase();
    if (!s) return menuFlat.slice(0, cap);
    const words = s.split(/\s+/).filter(Boolean);
    return menuFlat
        .filter((m) => words.every((w) => m.search.includes(w)))
        .slice(0, cap);
}

function refreshOpenKotSuggestions() {
    if (!menuFlat.length) return;
    const active = document.activeElement;
    document.querySelectorAll('.kot-line-row').forEach((row) => {
        const inp = row.querySelector('.kot-name-input');
        if (!inp || row.dataset.openItem === '1') return;
        if (inp !== active && !(inp.value || '').trim()) return;
        const lineBox = row.closest('#kotLineInputs');
        if (lineBox) handleKotComposerInput(row, lineBox);
    });
}

function getKotSuggestFloat() {
    if (!kotSuggestFloatEl) {
        kotSuggestFloatEl = document.createElement('ul');
        kotSuggestFloatEl.className = 'kot-suggest kot-suggest--float';
        kotSuggestFloatEl.hidden = true;
        kotSuggestFloatEl.setAttribute('role', 'listbox');
        document.body.appendChild(kotSuggestFloatEl);
    }
    return kotSuggestFloatEl;
}

function positionKotSuggestFloat(inp) {
    const ul = getKotSuggestFloat();
    const rect = inp.getBoundingClientRect();
    const gap = 4;
    const maxH = Math.min(280, Math.max(100, window.innerHeight - rect.bottom - gap - 16));
    ul.style.left = `${Math.max(8, rect.left)}px`;
    ul.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
    ul.style.top = `${rect.bottom + gap}px`;
    ul.style.maxHeight = `${maxH}px`;
}

function attachKotSuggestReposition(inp) {
    detachKotSuggestReposition();
    const fn = () => positionKotSuggestFloat(inp);
    kotSuggestRepositionHandler = fn;
    window.addEventListener('scroll', fn, true);
    window.addEventListener('resize', fn);
}

function detachKotSuggestReposition() {
    if (!kotSuggestRepositionHandler) return;
    window.removeEventListener('scroll', kotSuggestRepositionHandler, true);
    window.removeEventListener('resize', kotSuggestRepositionHandler);
    kotSuggestRepositionHandler = null;
}

function setKotComposerActiveRow(row) {
    kotComposerActiveRow = row || null;
    document.querySelectorAll('.kot-line-row').forEach((r) => {
        r.classList.toggle('kot-line-row--active', r === row);
    });
}

function setKotMenuBrowserOpen(kotMenuBrowser, toggleBtn, lineBox, open) {
    const wrap = kotMenuBrowser?.closest('.kot-menu-browser-wrap');
    if (!kotMenuBrowser || !wrap) return;
    wrap.hidden = !open;
    kotMenuBrowser.hidden = !open;
    if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggleBtn.textContent = open ? 'Hide full menu' : 'Show full menu';
    }
    if (open) {
        void loadMenuForKots().then(() => {
            delete kotMenuBrowser.dataset.rendered;
            renderKotMenuBrowser(kotMenuBrowser, lineBox);
            const inp = kotComposerActiveRow?.querySelector('.kot-name-input');
            if (inp) filterKotMenuBrowserPanel(kotMenuBrowser, inp.value);
        });
    }
}

function filterKotMenuBrowserPanel(panel, q) {
    if (!panel) return;
    const s = String(q || '').trim().toLowerCase();
    const words = s.split(/\s+/).filter(Boolean);
    panel.querySelectorAll('.kot-menu-pick:not(.kot-open-pick)').forEach((btn) => {
        const hay = `${btn.dataset.name || ''} ${btn.getAttribute('data-category') || ''}`.toLowerCase();
        const show = !words.length || words.every((w) => hay.includes(w));
        btn.hidden = !show;
    });
    panel.querySelectorAll('.kot-menu-browser-section:not([data-open-section])').forEach((sec) => {
        const any = [...sec.querySelectorAll('.kot-menu-pick')].some((b) => !b.hidden);
        sec.hidden = !any;
    });
    const openSec = panel.querySelector('[data-open-section]');
    if (openSec) {
        openSec.hidden = false;
        openSec.querySelectorAll('.kot-open-pick').forEach((btn) => {
            const hay = `${btn.textContent || ''} open item`.toLowerCase();
            const show = !words.length || words.every((w) => hay.includes(w));
            btn.hidden = !show;
        });
    }
}

function renderKotSuggestList(ul, hits) {
    if (!ul) return;
    if (!hits.length) {
        ul.hidden = true;
        ul.innerHTML = '';
        return;
    }
    ul.innerHTML = hits
        .map((h) => {
            const kotUnit = kotUnitPriceFromMenuPrice(h.price);
            return `<li><button type="button" class="kot-suggest-btn" data-name="${escapeAttr(h.name)}" data-price="${kotUnit}" data-category="${escapeAttr(h.category_type)}"><span class="kot-suggest-name">${escapeHtml(h.name)}</span><span class="kot-suggest-meta">${escapeHtml(h.category_type)} · ${formatRupee(kotUnit)}</span></button></li>`;
        })
        .join('');
    ul.hidden = false;
}

function bindKotSuggestButtons(ul, row, lineBox, inp, catEl) {
    if (!ul) return;
    ul.querySelectorAll('.kot-suggest-btn').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            inp.value = btn.dataset.name || '';
            if (catEl) catEl.textContent = btn.getAttribute('data-category') || '';
            const pr = row.querySelector('.kot-price');
            if (pr) pr.value = String(btn.dataset.price || '0');
            ul.hidden = true;
            ul.innerHTML = '';
            closeAllKotSuggest(null);
            inp.blur();
            if (row.dataset.placeholder && inp.value.trim()) {
                delete row.dataset.placeholder;
                const hasTrail = [...lineBox.querySelectorAll('.kot-line-row')].some((r) => r.dataset.placeholder);
                if (!hasTrail) addKotLineRow(lineBox, { placeholder: true, openItem: true });
            }
            lineBox.dispatchEvent(new CustomEvent('floor:kot-line-updated', { bubbles: true }));
        });
    });
}

function countUnservedLines(order) {
    const meta = floorMeta(order);
    let n = 0;
    for (const k of meta.kots || []) {
        for (const ln of k.lines || []) {
            if (ln && ln.name && !ln.served) n += 1;
        }
    }
    return n;
}

function slotMapFromOrders(orders) {
    const map = new Map();
    for (const o of orders || []) {
        const meta = parseMeta(o);
        if (meta.slot) map.set(meta.slot, o);
    }
    return map;
}

function isLocalFloorId(id) {
    return String(id || '').startsWith('local-');
}

function floorSessionsStorageKey() {
    const slug = currentVenue && currentVenue.slug ? currentVenue.slug : 'default';
    return `${LS_FLOOR_KEY_PREFIX}:${slug}`;
}

function loadLocalFloorSessions() {
    try {
        const raw = localStorage.getItem(floorSessionsStorageKey());
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        const bySlot = new Map();
        for (const o of arr) {
            if (!o || !isLocalFloorId(o.id)) continue;
            repairLocalOrderKots(o);
            const slot = parseMeta(o).slot;
            if (slot) bySlot.set(slot, o);
            else bySlot.set(String(o.id), o);
        }
        return [...bySlot.values()];
    } catch {
        return [];
    }
}

function saveLocalFloorSessions() {
    for (const o of localFloorSessions) {
        if (o && isLocalFloorId(o.id)) repairLocalOrderKots(o);
    }
    let json;
    try {
        json = JSON.stringify(localFloorSessions);
    } catch (e) {
        showToast('Could not save KOT data (serialization failed).');
        throw e;
    }
    try {
        localStorage.setItem(floorSessionsStorageKey(), json);
    } catch (e) {
        showToast('Could not write to browser storage. Check free space or site permissions.');
        throw e;
    }
    try {
        const chk = JSON.parse(localStorage.getItem(floorSessionsStorageKey()) || 'null');
        if (!Array.isArray(chk)) {
            showToast('KOT save could not be verified.');
            throw new Error('floor_storage_verify');
        }
    } catch (e) {
        if (e && e.message === 'floor_storage_verify') throw e;
        showToast('KOT save could not be verified.');
        throw e;
    }
}

/** Locals win a slot; only one API row per slot so duplicates cannot hide drafts. */
function mergeFloorOrdersApiAndLocal(apiRows, locals) {
    const out = [];
    const takenSlots = new Set();
    for (const o of locals || []) {
        if (!o) continue;
        const slot = parseMeta(o).slot;
        if (slot) takenSlots.add(slot);
        out.push(o);
    }
    for (const o of apiRows || []) {
        if (!o) continue;
        const slot = parseMeta(o).slot;
        if (slot) {
            if (takenSlots.has(slot)) continue;
            takenSlots.add(slot);
        }
        out.push(o);
    }
    return out;
}

function upsertApiFloorOrderInCache(updated) {
    if (!updated || isLocalFloorId(updated.id)) return;
    const id = String(updated.id);
    const i = lastApiFloorRows.findIndex((o) => String(o.id) === id);
    if (i >= 0) lastApiFloorRows[i] = updated;
    else lastApiFloorRows.push(updated);
}

function removeApiFloorOrderFromCache(orderId) {
    const id = String(orderId);
    lastApiFloorRows = lastApiFloorRows.filter((o) => String(o.id) !== id);
}

function trimTok(s, max) {
    return String(s || '')
        .trim()
        .slice(0, max);
}

function newKotIdLocal() {
    return `kot_${crypto.randomUUID()}`;
}

function newLineIdLocal() {
    return `ln_${crypto.randomUUID()}`;
}

function sanitizeKotLinesLocal(lines) {
    const out = [];
    for (const raw of Array.isArray(lines) ? lines : []) {
        if (!raw || typeof raw !== 'object') continue;
        const name = trimTok(raw.name, 200);
        const qty = parseInt(String(raw.quantity), 10);
        let price = parseInt(String(raw.price), 10);
        if (!name) continue;
        if (Number.isNaN(qty) || qty < 1 || qty > 99) continue;
        if (Number.isNaN(price) || price < 0) price = 0;
        const category_type = trimTok(raw.category_type || raw.category || '', 80);
        const row = {
            id: newLineIdLocal(),
            name,
            quantity: qty,
            price,
            served: false
        };
        if (category_type) row.category_type = category_type;
        out.push(row);
    }
    return out;
}

function mergeKotLinesToItemsLocal(kots) {
    const map = new Map();
    for (const kot of kots || []) {
        for (const line of kot.lines || []) {
            const name = trimTok(line.name, 200);
            const qty = parseInt(String(line.quantity), 10);
            const price = parseInt(String(line.price), 10);
            if (!name || Number.isNaN(qty) || qty < 1 || qty > 99) continue;
            const p = Number.isNaN(price) || price < 0 ? 0 : price;
            const key = `${name}\n${p}`;
            const cur = map.get(key);
            if (cur) cur.quantity += qty;
            else map.set(key, { name, price: p, quantity: qty });
        }
    }
    return [...map.values()];
}

function sumItemsSubtotalLocal(items) {
    return items.reduce((sum, it) => {
        const q = parseInt(String(it.quantity), 10);
        const p = parseInt(String(it.price), 10);
        if (Number.isNaN(q)) return sum;
        return sum + (Number.isNaN(p) ? 0 : p) * q;
    }, 0);
}

function rollbackLastKotFromLocalOrder(localOrder) {
    if (!localOrder || !isLocalFloorId(localOrder.id)) return;
    const om = ensureOrderMetaObject(localOrder);
    if (!Array.isArray(om.kots) || om.kots.length === 0) return;
    om.kots.pop();
    repairLocalOrderKots(localOrder);
    const items = mergeKotLinesToItemsLocal(om.kots);
    const subtotal = sumItemsSubtotalLocal(items);
    localOrder.items = items;
    localOrder.subtotal = subtotal;
    localOrder.total = subtotal;
    if (String(localOrder.status || '').toLowerCase() === 'preparing' && om.kots.length === 0) {
        localOrder.status = 'accepted';
    }
    localOrder.updated_at = new Date().toISOString();
}

function slotNumFromFloorSlotKey(slotKey) {
    const sk = String(slotKey || '').trim();
    const tm = /^table:(\d+)$/i.exec(sk);
    if (tm) return parseInt(tm[1], 10);
    const pm = /^parcel:(\d+)$/i.exec(sk);
    if (pm) return parseInt(pm[1], 10);
    return NaN;
}

function kotLinesPayloadForServerApi(kotLines) {
    const out = [];
    for (const ln of kotLines || []) {
        if (!ln || !ln.name) continue;
        const name = trimTok(String(ln.name), 200);
        if (!name) continue;
        const quantity = parseInt(String(ln.quantity), 10);
        const price = parseInt(String(ln.price), 10);
        const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
        const pr = Number.isFinite(price) && price >= 0 ? price : 0;
        const row = { name, quantity: qty, price: pr };
        const ct = trimTok(ln.category_type || ln.category || '', 80);
        if (ct) row.category_type = ct;
        out.push(row);
    }
    return out;
}

async function postFloorOpen(channel, slotNum, guest_label) {
    const res = await fetch('/api/admin/orders', {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'floor_open',
            channel,
            slot: slotNum,
            guest_label: guest_label || ''
        }),
        cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
        throw Object.assign(new Error('Authentication required'), { code: 401 });
    }
    if (res.status === 409) {
        const err = new Error(data.error || 'This slot already has an active order on the server.');
        err.statusCode = 409;
        throw err;
    }
    if (!res.ok) throw new Error(data.error || 'Could not open floor session on server.');
    return data.order;
}

async function patchOrderRemote(orderId, body) {
    const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error('Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(data.error || 'Update failed.');
    return data.order;
}

function ensureOrderMetaObject(order) {
    let om = order.order_meta;
    if (typeof om === 'string') {
        try {
            om = JSON.parse(om);
        } catch {
            om = {};
        }
    }
    if (!om || typeof om !== 'object') om = {};
    if (!Array.isArray(om.kots)) om.kots = [];
    order.order_meta = om;
    return om;
}

function repairLocalOrderKots(order) {
    if (!order || !isLocalFloorId(order.id)) return;
    const om = ensureOrderMetaObject(order);
    const kots = Array.isArray(om.kots) ? om.kots : [];
    om.kots = kots;
    for (let i = 0; i < kots.length; i += 1) {
        const kot = kots[i];
        if (!kot || typeof kot !== 'object') continue;
        if (!kot.id || String(kot.id).trim() === '') kot.id = newKotIdLocal();
        if (!Array.isArray(kot.lines)) kot.lines = [];
        for (const ln of kot.lines) {
            if (ln && typeof ln === 'object' && (!ln.id || String(ln.id).trim() === '')) {
                ln.id = newLineIdLocal();
            }
        }
    }
}

function applyLocalFloorMutation(orderIdStr, body) {
    const order = localFloorSessions.find((o) => String(o.id) === orderIdStr);
    if (!order) return null;
    const action = String(body.action || '').trim().toLowerCase();
    const om = ensureOrderMetaObject(order);

    if (action === 'floor_add_kot') {
        const lines = sanitizeKotLinesLocal(body.lines || (body.kot && body.kot.lines));
        if (!lines.length) {
            throw new Error('Add at least one line item to the KOT.');
        }
        const kot = {
            id: newKotIdLocal(),
            seq: om.kots.length + 1,
            label: trimTok(body.label ? String(body.label) : '', 80),
            lines,
            done: lines.every((ln) => ln && ln.served),
            created_at: new Date().toISOString()
        };
        om.kots.push(kot);
        repairLocalOrderKots(order);
        const items = mergeKotLinesToItemsLocal(om.kots);
        const subtotal = sumItemsSubtotalLocal(items);
        order.items = items;
        order.subtotal = subtotal;
        order.total = subtotal;
        if (order.status === 'accepted') order.status = 'preparing';
        order.updated_at = new Date().toISOString();
        return order;
    }

    if (action === 'floor_replace_kot') {
        const kotId = trimTok(String(body.kot_id || body.kotId || ''), 80);
        if (!kotId) throw new Error('Missing kot id.');
        const lines = sanitizeKotLinesLocal(body.lines || (body.kot && body.kot.lines));
        if (!lines.length) throw new Error('Add at least one line item to the KOT.');
        const kot = om.kots.find((k) => k && k.id === kotId);
        if (!kot) throw new Error('KOT not found.');
        if ((kot.lines || []).some((l) => l && l.served)) {
            throw new Error('Cannot modify a KOT with served lines.');
        }
        kot.lines = lines;
        kot.done = false;
        repairLocalOrderKots(order);
        const items = mergeKotLinesToItemsLocal(om.kots);
        const subtotal = sumItemsSubtotalLocal(items);
        order.items = items;
        order.subtotal = subtotal;
        order.total = subtotal;
        if (order.status === 'accepted') order.status = 'preparing';
        order.updated_at = new Date().toISOString();
        return order;
    }

    if (action === 'floor_mark_line') {
        const kotId = trimTok(String(body.kot_id || body.kotId || ''), 80);
        const lineId = trimTok(String(body.line_id || body.lineId || ''), 80);
        const lineIndex = parseInt(String(body.line_index ?? body.lineIndex), 10);
        if (!kotId) throw new Error('Missing kot id.');
        if (!lineId && !Number.isFinite(lineIndex)) throw new Error('Missing line id or line index.');
        const kot = om.kots.find((k) => k && k.id === kotId);
        if (!kot) throw new Error('KOT not found.');
        let line = null;
        if (lineId) line = (kot.lines || []).find((l) => l && l.id === lineId);
        if (!line && Number.isFinite(lineIndex) && lineIndex >= 0 && lineIndex < (kot.lines || []).length) {
            line = kot.lines[lineIndex];
        }
        if (!line) throw new Error('Line not found.');
        if (!line.id) line.id = newLineIdLocal();
        line.served = body.served === false ? false : true;
        kot.done = kot.lines.length > 0 && kot.lines.every((l) => l && l.served);
        order.updated_at = new Date().toISOString();
        return order;
    }

    return null;
}

/**
 * New table/parcel session: stored only in localStorage until payment completes.
 */
function createLocalFloorSession(channel, slot, guest_label = '') {
    const ch = String(channel || '').trim().toLowerCase();
    const n = parseInt(String(slot), 10);
    if (ch !== 'dine_in' && ch !== 'parcel') throw new Error('Invalid channel.');
    const maxTables = floorConfig.tableCount || 7;
    const maxParcels = floorConfig.parcelCount || 5;
    if (ch === 'dine_in' && (!Number.isFinite(n) || n < 1 || n > maxTables)) {
        throw new Error(`Table must be between 1 and ${maxTables}.`);
    }
    if (ch === 'parcel' && (!Number.isFinite(n) || n < 1 || n > maxParcels)) {
        throw new Error(`Parcel slot must be between 1 and ${maxParcels}.`);
    }
    const slotKey = ch === 'dine_in' ? `table:${n}` : `parcel:${n}`;
    const merged = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
    if (slotMapFromOrders(merged).get(slotKey)) {
        throw new Error('This slot already has an active order.');
    }
    const gl = trimTok(guest_label, 120);
    const order = {
        id: `local-${crypto.randomUUID()}`,
        customer_mobile: '8888888888',
        mobile: '8888888888',
        name: 'Walk-in',
        city: '',
        status: 'accepted',
        items: [],
        subtotal: 0,
        delivery_fee: 0,
        discount: null,
        coupon_code: null,
        total: 0,
        delivery_address: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        channel: ch,
        order_meta: { slot: slotKey, guest_label: gl, kots: [], payment_method: null }
    };
    localFloorSessions.push(order);
    try {
        saveLocalFloorSessions();
    } catch (e) {
        localFloorSessions.pop();
        throw e;
    }
    floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
    return order;
}

async function postFloorCommit(payload) {
    const res = await fetch('/api/admin/orders', {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'floor_commit', ...payload }),
        cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error('Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(data.error || 'Could not complete order.');
    return data.order;
}

async function verifyAdmin(user, pass) {
    let token;
    try {
        token = btoa(`${String(user).trim()}:${String(pass)}`);
    } catch {
        throw new Error(
            'This browser cannot encode your password for sign-in. Use only basic letters and numbers in the password field, or try another browser.'
        );
    }
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 20000);
    try {
        const res = await fetch('/api/admin/session', {
            headers: { Authorization: `Basic ${token}`, Accept: 'application/json' },
            signal: ctrl.signal
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({}));
        if (data.venue) {
            const prevId = currentVenue && currentVenue.id;
            currentVenue = data.venue;
            if (String(prevId) !== String(currentVenue.id)) {
                resetKotMenuCache();
            }
        }
        if (data.floorConfig) {
            floorConfig = {
                tableCount: Number(data.floorConfig.tableCount) || 7,
                parcelCount: Number(data.floorConfig.parcelCount) || 5
            };
        }
        return data;
    } catch (e) {
        if (e && e.name === 'AbortError') {
            throw new Error(
                'The server did not respond in time. If you are developing, run `yarn dev` and open this page at http://localhost:3000/admin/tables (same host as the API).'
            );
        }
        throw new Error('Could not reach the admin API. Check your network or VPN.');
    } finally {
        clearTimeout(tid);
    }
}

async function loadFloorConfig() {
    const res = await fetch('/api/admin/floor-config', {
        headers: adminHeaders(),
        cache: 'no-store'
    });
    if (res.status === 401) throw Object.assign(new Error('Session expired. Sign in again.'), { code: 401 });
    if (!res.ok) throw new Error('Could not load floor configuration.');
    const data = await res.json();
    floorConfig = {
        tableCount: Number(data.tableCount) || 7,
        parcelCount: Number(data.parcelCount) || 5
    };
    if (data.venue) {
        const prevId = currentVenue && currentVenue.id;
        currentVenue = data.venue;
        if (String(prevId) !== String(currentVenue.id)) {
            resetKotMenuCache();
        }
    }
    updateFloorConfigLabels();
    applyFloorSlotGridColumns();
    return floorConfig;
}

function updateFloorConfigLabels() {
    const tableLabel = document.getElementById('tableCountLabel');
    const parcelLabel = document.getElementById('parcelCountLabel');
    const nTables = floorConfig.tableCount || 7;
    const nParcels = floorConfig.parcelCount || 5;
    if (tableLabel) tableLabel.textContent = `${nTables} seat${nTables === 1 ? '' : 's'}`;
    if (parcelLabel) parcelLabel.textContent = `${nParcels} counter${nParcels === 1 ? '' : 's'}`;
    if (currentVenue && currentVenue.name) {
        document.title = `${currentVenue.name} — Floor & KOT Admin`;
    }
}

function applyFloorSlotGridColumns() {
    const tableWrap = document.getElementById('tableSlots');
    const parcelWrap = document.getElementById('parcelSlots');
    const nTables = Math.max(1, floorConfig.tableCount || 7);
    const nParcels = Math.max(1, floorConfig.parcelCount || 5);
    if (tableWrap) {
        tableWrap.style.setProperty('--floor-slot-cols', String(nTables));
    }
    if (parcelWrap) {
        parcelWrap.style.setProperty('--floor-slot-cols', String(nParcels));
    }
}

async function fetchFloorOrders() {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 25000);
    try {
        const res = await fetch(`/api/admin/orders?scope=floor&_=${Date.now()}`, {
            headers: adminHeaders(),
            cache: 'no-store',
            signal: ctrl.signal
        });
        if (res.status === 401) throw Object.assign(new Error('Session expired. Sign in again.'), { code: 401 });
        if (!res.ok) throw new Error('Could not load floor orders.');
        const data = await res.json();
        return data.orders || [];
    } catch (e) {
        if (e && e.code === 401) throw e;
        if (e && e.name === 'AbortError') {
            throw Object.assign(new Error('Loading floor orders timed out. Is the dev server running?'), {
                code: 'TIMEOUT'
            });
        }
        throw e instanceof Error ? e : new Error('Could not load floor orders.');
    } finally {
        clearTimeout(tid);
    }
}

async function patchOrder(orderId, body) {
    if (isLocalFloorId(orderId)) {
        const act = String(body.action || '').trim().toLowerCase();
        if (act === 'floor_void') {
            const idx = localFloorSessions.findIndex((o) => String(o.id) === String(orderId));
            if (idx === -1) throw new Error('Order not found.');
            localFloorSessions.splice(idx, 1);
            saveLocalFloorSessions();
            floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
            return null;
        }

        if (act === 'floor_add_kot') {
            const idx = localFloorSessions.findIndex((o) => String(o.id) === String(orderId));
            if (idx === -1) throw new Error('Order not found.');
            const localOrder = localFloorSessions[idx];

            const updatedLocal = applyLocalFloorMutation(String(orderId), body);
            if (!updatedLocal) throw new Error('Update failed.');
            saveLocalFloorSessions();
            floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);

            const om = ensureOrderMetaObject(updatedLocal);
            const slotKey = String(om.slot || '').trim();
            const slotNum = slotNumFromFloorSlotKey(slotKey);
            if (!Number.isFinite(slotNum)) {
                rollbackLastKotFromLocalOrder(localOrder);
                saveLocalFloorSessions();
                floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
                throw new Error('Invalid seat — cannot sync to server.');
            }
            const ch = String(localOrder.channel || '').trim().toLowerCase();
            const guest = String(om.guest_label || '').trim();

            const refreshFloorAfterConflict = async () => {
                const rows = await fetchFloorOrders();
                lastApiFloorRows = rows;
                floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
            };

            let serverOrder = null;
            try {
                serverOrder = await postFloorOpen(ch, slotNum, guest);
            } catch (e) {
                if (e && e.statusCode === 409) {
                    await refreshFloorAfterConflict();
                    const busy = (lastApiFloorRows || []).find((o) => {
                        const st = String(o.status || '').toLowerCase();
                        if (st === 'completed' || st === 'rejected' || st === 'cancelled') return false;
                        return String(parseMeta(o).slot || '') === slotKey;
                    });
                    if (!busy) {
                        rollbackLastKotFromLocalOrder(localOrder);
                        saveLocalFloorSessions();
                        floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
                        throw new Error(e.message || 'Could not sync to server.');
                    }
                    const busyKots = floorMeta(busy).kots || [];
                    if (busyKots.length > 0) {
                        rollbackLastKotFromLocalOrder(localOrder);
                        saveLocalFloorSessions();
                        floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
                        throw new Error(
                            'This table already has tickets on the server. Press ⟳ Refresh on the floor page, then continue there.'
                        );
                    }
                    serverOrder = busy;
                } else {
                    rollbackLastKotFromLocalOrder(localOrder);
                    saveLocalFloorSessions();
                    floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
                    throw e;
                }
            }

            const sid = String(serverOrder.id);
            const kotsToPush = floorMeta(updatedLocal).kots || [];
            let lastReturned = serverOrder;
            try {
                for (const kot of kotsToPush) {
                    const lines = kotLinesPayloadForServerApi(kot.lines || []);
                    if (!lines.length) continue;
                    lastReturned = await patchOrderRemote(sid, { action: 'floor_add_kot', lines });
                }
            } catch (e) {
                rollbackLastKotFromLocalOrder(localOrder);
                saveLocalFloorSessions();
                floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
                throw e;
            }

            localFloorSessions.splice(idx, 1);
            saveLocalFloorSessions();
            upsertApiFloorOrderInCache(lastReturned);
            floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
            return lastReturned;
        }

        const updated = applyLocalFloorMutation(String(orderId), body);
        if (!updated) throw new Error('Update failed.');
        saveLocalFloorSessions();
        floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
        return updated;
    }
    return patchOrderRemote(orderId, body);
}

function formatRupee(n) {
    const v = Number(n) || 0;
    return `₹${v}`;
}

function computeFloorOrderTotal(meta) {
    let total = 0;
    for (const kot of meta.kots || []) {
        for (const ln of kot.lines || []) {
            const q = parseInt(String(ln.quantity), 10) || 0;
            const p = parseInt(String(ln.price), 10) || 0;
            total += q * p;
        }
    }
    return total;
}

function isAllKotsServed(meta) {
    return (
        (meta.kots || []).length > 0 &&
        meta.kots.every((k) => k && Array.isArray(k.lines) && k.lines.length && k.done)
    );
}

function focusSettleFooter() {
    const footer = document.getElementById('drawerFooter');
    if (!footer) return;
    footer.classList.add('drawer-footer--settle-ready');
    footer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (isKotMobile()) setMobileSheetOpen(true);
}

async function completeFloorSettlement(order, paymentPayload) {
    const wasLocal = isLocalFloorId(order.id);
    if (wasLocal) {
        const fm = floorMeta(order);
        const parts = String(fm.slot || '').split(':');
        const slotNum = parseInt(parts[1], 10);
        if (!Number.isFinite(slotNum)) throw new Error('Invalid slot.');
        await postFloorCommit({
            ...paymentPayload,
            channel: order.channel,
            slot: slotNum,
            guest_label: fm.guest_label,
            kots: fm.kots
        });
        localFloorSessions = localFloorSessions.filter((o) => String(o.id) !== String(order.id));
        saveLocalFloorSessions();
    } else {
        await patchOrder(order.id, { action: 'floor_complete', ...paymentPayload });
    }
    closeDrawer();
    if (!wasLocal) removeApiFloorOrderFromCache(order.id);
    floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
    renderSlots();
}

function bindSettleFooter(footer, order, meta) {
    const total = computeFloorOrderTotal(meta);
    footer.innerHTML = `<div class="settle-prompt">All items served — choose payment to close this KOT</div>
        <div class="settle-row settle-row--ready">
            <button type="button" class="pay-btn pay-btn--cash" data-pay="CASH">Cash</button>
            <button type="button" class="pay-btn pay-btn--upi" data-pay="UPI">UPI</button>
            <button type="button" class="pay-btn pay-btn--split" data-pay="SPLIT">Part pay</button>
        </div>
        <div class="settle-split-form" id="settleSplitForm" hidden>
            <div class="settle-split-head">Split payment · Total ${formatRupee(total)}</div>
            <label>Cash<input type="number" id="settleSplitCash" min="0" step="1" inputmode="numeric" placeholder="0"></label>
            <label>UPI<input type="number" id="settleSplitUpi" min="0" step="1" inputmode="numeric" placeholder="0"></label>
            <button type="button" class="floor-btn floor-btn--primary" id="settleSplitConfirm">Confirm split</button>
        </div>`;

    footer.querySelector('[data-pay="SPLIT"]')?.addEventListener('click', () => {
        const form = footer.querySelector('#settleSplitForm');
        if (form) form.hidden = false;
    });

    footer.querySelectorAll('[data-pay="CASH"], [data-pay="UPI"]').forEach((b) => {
        b.addEventListener('click', async () => {
            const pm = b.getAttribute('data-pay');
            setBtnLoading(b, true);
            try {
                await completeFloorSettlement(order, { payment_method: pm });
                showToast(`Completed · ${pm}`);
            } catch (e) {
                showToast(e.message || 'Failed.');
                setBtnLoading(b, false);
            }
        });
    });

    footer.querySelector('#settleSplitConfirm')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const cash = parseInt(String(footer.querySelector('#settleSplitCash')?.value || ''), 10);
        const upi = parseInt(String(footer.querySelector('#settleSplitUpi')?.value || ''), 10);
        if (!Number.isFinite(cash) || cash < 0 || !Number.isFinite(upi) || upi < 0) {
            showToast('Enter valid cash and UPI amounts.');
            return;
        }
        if (cash + upi !== total) {
            showToast(`Cash + UPI must equal ${formatRupee(total)}.`);
            return;
        }
        setBtnLoading(btn, true);
        try {
            await completeFloorSettlement(order, {
                payment_method: 'SPLIT',
                payment_cash: cash,
                payment_upi: upi
            });
            showToast(`Completed · Cash ${formatRupee(cash)} + UPI ${formatRupee(upi)}`);
        } catch (err) {
            showToast(err.message || 'Failed.');
            setBtnLoading(btn, false);
        }
    });
}

function getKotPrintAddress(venue) {
    const fallback = "Opp. Railway Station, Near Bus Stop\nKudachi – 591311, Karnataka";
    if (!venue) return fallback;
    const line = String(venue.addressLine || venue.address_line || '').trim();
    const city = String(venue.city || '').trim();
    if (line && city && !line.toLowerCase().includes(city.toLowerCase())) {
        return `${line}\n${city}`;
    }
    if (line) return line;
    if (city) return city;
    return fallback;
}

function printKotReceipt(order, kot) {
    const meta = floorMeta(order);
    const slotLabel =
        meta.slot && meta.slot.startsWith('table:')
            ? `Table ${meta.slot.split(':')[1]}`
            : meta.slot && meta.slot.startsWith('parcel:')
              ? `Parcel ${meta.slot.split(':')[1]}`
              : meta.slot || '—';
    const venueName = (currentVenue && currentVenue.name) || "Baloji's Cafe";
    const venueAddress = getKotPrintAddress(currentVenue);
    const kotTit = kot.label && String(kot.label).trim() ? kot.label : `KOT #${kot.seq || ''}`;
    const printedAt = new Date().toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    let lineTotal = 0;
    const lines = (kot.lines || [])
        .map((ln) => {
            const q = Number(ln.quantity) || 0;
            const p = Number(ln.price) || 0;
            const amt = q * p;
            lineTotal += amt;
            return `<tr>
                <td class="kot-print-item">${escapeHtml(String(ln.name || ''))}</td>
                <td class="kot-print-qty">${q}</td>
                <td class="kot-print-amt">${formatRupee(amt)}</td>
            </tr>`;
        })
        .join('');

    const addressHtml = venueAddress
        .split('\n')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => `<div class="kot-print-address">${escapeHtml(part)}</div>`)
        .join('');

    let area = document.getElementById('kotPrintArea');
    if (!area) {
        area = document.createElement('div');
        area.id = 'kotPrintArea';
        document.body.appendChild(area);
    }

    area.innerHTML = `<div class="kot-print-sheet">
        <header class="kot-print-header">
            <div class="kot-print-title">${escapeHtml(venueName)}</div>
            ${addressHtml}
        </header>
        <div class="kot-print-rule"></div>
        <div class="kot-print-order-meta">
            <div class="kot-print-meta-line"><strong>${escapeHtml(slotLabel)}</strong></div>
            <div class="kot-print-meta-line">${escapeHtml(kotTit)}</div>
            <div class="kot-print-meta-line kot-print-meta-line--muted">${escapeHtml(printedAt)}</div>
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
            <span>${formatRupee(lineTotal)}</span>
        </div>
        <footer class="kot-print-footer">Thank you! Visit again</footer>
        <div class="kot-print-delivery"><strong>Home delivery - www.balojicafe.com</strong></div>
    </div>`;

    window.print();
}

function renderSlotButton({ kind, num, order }) {
    const slotKey = kind === 'table' ? `table:${num}` : `parcel:${num}`;
    const label = kind === 'table' ? `Table ${num}` : `Parcel ${num}`;
    const busy = !!order;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `slot-card${busy ? ' slot-card--busy' : ''}`;
    btn.dataset.slotKey = slotKey;
    btn.dataset.channel = kind === 'table' ? 'dine_in' : 'parcel';
    btn.dataset.slotNum = String(num);

    const badge = document.createElement('span');
    badge.className = `slot-badge ${busy ? 'slot-badge--live' : 'slot-badge--free'}`;
    badge.textContent = busy ? 'Live' : 'Available';

    const lab = document.createElement('div');
    lab.className = 'slot-label';
    lab.textContent = kind === 'table' ? 'Dine-in' : 'Parcel';

    const name = document.createElement('div');
    name.className = 'slot-name';
    name.textContent = label;

    btn.append(lab, name, badge);

    if (busy) {
        const pending = countUnservedLines(order);
        const metaEl = document.createElement('div');
        metaEl.className = 'slot-meta';
        const meta = floorMeta(order);
        const itemCount = (meta.kots || []).reduce(
            (sum, k) => sum + (k.lines || []).reduce((a, l) => a + (Number(l.quantity) || 0), 0),
            0
        );
        const idShow = isLocalFloorId(order.id) ? 'Draft' : `#${order.id}`;
        metaEl.textContent = `${idShow} · ${itemCount} item${itemCount === 1 ? '' : 's'}`;
        const tot = document.createElement('div');
        tot.className = 'slot-total';
        tot.textContent = `${formatRupee(order.total)}${pending ? ` · ${pending} to serve` : ''}`;
        btn.append(metaEl, tot);
    }

    btn.addEventListener('click', () => {
        if (busy) {
            openDrawer(String(order.id));
        } else {
            try {
                const newOrder = createLocalFloorSession(btn.dataset.channel, Number(btn.dataset.slotNum), '');
                renderSlots();
                openDrawer(String(newOrder.id));
            } catch (e) {
                showToast(e.message || 'Could not open.');
            }
        }
    });

    return btn;
}

function getOrderById(id) {
    return floorOrders.find((o) => String(o.id) === String(id)) || null;
}

function kotCanModify(kot) {
    if (!kot || kot.done) return false;
    return !(kot.lines || []).some((l) => l && l.served);
}

function findLastModifiableKot(kots) {
    if (!Array.isArray(kots)) return null;
    for (let i = kots.length - 1; i >= 0; i -= 1) {
        const k = kots[i];
        if (kotCanModify(k)) return k;
    }
    return null;
}

function readKotLineRowData(row) {
    if (!row) return null;
    const name = (row.querySelector('.kot-name-input')?.value || '').trim();
    if (!name) return null;
    const qtyEl = row.querySelector('.kot-qty');
    const quantity = qtyEl
        ? parseInt(String(qtyEl.value || '1'), 10)
        : 1;
    const price = parseInt(String(row.querySelector('.kot-price')?.value || '0'), 10);
    const category_type = (row.querySelector('.kot-line-cat')?.textContent || '').trim();
    return {
        name,
        quantity: Number.isFinite(quantity) ? quantity : 1,
        price: Number.isFinite(price) ? price : 0,
        category_type
    };
}

function updateKotDraftEmptyVisible(draftBox) {
    const empty = draftBox?.querySelector('.kot-draft-empty');
    if (!empty) return;
    empty.hidden = draftBox.querySelectorAll('.kot-draft-line').length > 0;
}

function refreshKotDraftLineDisplay(el) {
    if (!el) return;
    let qty = parseInt(el.getAttribute('data-qty') || '1', 10);
    const price = parseInt(el.getAttribute('data-price') || '0', 10);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    if (qty > 99) qty = 99;
    el.setAttribute('data-qty', String(qty));
    const pr = Number.isFinite(price) && price >= 0 ? price : 0;
    const qtyVal = el.querySelector('.kot-draft-qty-val');
    if (qtyVal) qtyVal.textContent = String(qty);
    const priceEl = el.querySelector('.kot-draft-price');
    if (priceEl) priceEl.innerHTML = `${formatRupee(qty * pr)} <span>(${formatRupee(pr)} ea)</span>`;
    const nameEl = el.querySelector('.kot-draft-name');
    if (nameEl) {
        const cat = (el.getAttribute('data-category') || '').trim();
        const titleBits = [cat, formatRupee(qty * pr)].filter(Boolean).join(' · ');
        if (titleBits) nameEl.setAttribute('title', titleBits);
        else nameEl.removeAttribute('title');
    }
}

function applyKotDraftQtyDelta(draftEl, delta) {
    if (!draftEl) return;
    let v = parseInt(draftEl.getAttribute('data-qty') || '1', 10);
    if (!Number.isFinite(v)) v = 1;
    v = Math.min(99, Math.max(1, v + delta));
    draftEl.setAttribute('data-qty', String(v));
    refreshKotDraftLineDisplay(draftEl);
    draftEl.closest('#kotDraftLines')?.dispatchEvent(
        new CustomEvent('floor:kot-draft-updated', { bubbles: true })
    );
}

function appendKotDraftLine(draftBox, data) {
    if (!draftBox || !data?.name) return null;
    const qty = Number.isFinite(data.quantity) ? data.quantity : 1;
    const price = Number.isFinite(data.price) ? data.price : 0;
    const cat = data.category_type || '';
    const el = document.createElement('div');
    el.className = 'kot-draft-line';
    el.dataset.draftId = `draft_${crypto.randomUUID()}`;
    el.setAttribute('data-name', data.name);
    el.setAttribute('data-qty', String(qty));
    el.setAttribute('data-price', String(price));
    if (cat) el.setAttribute('data-category', cat);
    const lineTotal = qty * price;
    const priceLabel = `${formatRupee(lineTotal)} <span>(${formatRupee(price)} ea)</span>`;
    el.innerHTML = `<div class="kot-draft-name-cell">
            <span class="kot-draft-name">${escapeHtml(data.name)}</span>
            <span class="kot-draft-price">${priceLabel}</span>
        </div>
        <div class="kot-draft-qty-wrap" role="group" aria-label="Quantity">
            <button type="button" class="kot-draft-qty-btn" data-draft-qty-delta="-1" aria-label="Decrease quantity">−</button>
            <span class="kot-draft-qty-val">${qty}</span>
            <button type="button" class="kot-draft-qty-btn" data-draft-qty-delta="1" aria-label="Increase quantity">+</button>
        </div>
        <button type="button" class="kot-draft-remove" aria-label="Remove">×</button>`;
    draftBox.appendChild(el);
    updateKotDraftEmptyVisible(draftBox);
    return el;
}

/** Merge two sets of KOT lines into one, summing quantities for the same item + price. */
function mergeKotLineArrays(...lineGroups) {
    const map = new Map();
    const order = [];
    const addLine = (ln) => {
        if (!ln) return;
        const name = String(ln.name || '').trim();
        if (!name) return;
        const price = parseInt(String(ln.price), 10) || 0;
        let qty = parseInt(String(ln.quantity), 10);
        if (!Number.isFinite(qty) || qty < 1) return;
        const key = `${name.toLowerCase()}\u0000${price}`;
        const cat = String(ln.category_type || ln.category || '').trim();
        if (map.has(key)) {
            map.get(key).quantity = Math.min(99, map.get(key).quantity + qty);
        } else {
            const row = { name, quantity: Math.min(99, qty), price };
            if (cat) row.category_type = cat;
            map.set(key, row);
            order.push(row);
        }
    };
    for (const group of lineGroups) {
        for (const ln of group || []) addLine(ln);
    }
    return order;
}

/** Stable identity for matching draft lines to menu chips (same item + price). */
function menuPickKey(name, price) {
    const nm = String(name || '').trim().toLowerCase();
    const p = parseInt(String(price), 10);
    return `${nm}\u0000${Number.isFinite(p) ? p : 0}`;
}

/** Add a line, or bump the quantity of an identical existing line, so a menu item maps to one draft row. */
function addOrMergeKotDraftLine(draftBox, data) {
    if (!draftBox || !data?.name) return null;
    const key = menuPickKey(data.name, data.price);
    const existing = [...draftBox.querySelectorAll('.kot-draft-line')].find(
        (el) => menuPickKey(el.getAttribute('data-name'), el.getAttribute('data-price')) === key
    );
    if (existing) {
        const cur = parseInt(existing.getAttribute('data-qty') || '1', 10) || 1;
        const add = Number.isFinite(data.quantity) ? data.quantity : 1;
        existing.setAttribute('data-qty', String(Math.min(99, cur + add)));
        refreshKotDraftLineDisplay(existing);
        updateKotDraftEmptyVisible(draftBox);
        return existing;
    }
    return appendKotDraftLine(draftBox, data);
}

/** Map of "item + price" -> total quantity currently in the draft. */
function buildDraftQtyMap(draftBox) {
    const map = new Map();
    const box = draftBox || document.getElementById('kotDraftLines');
    if (!box) return map;
    box.querySelectorAll('.kot-draft-line').forEach((el) => {
        const name = (el.getAttribute('data-name') || '').trim();
        if (!name) return;
        const price = parseInt(el.getAttribute('data-price') || '0', 10) || 0;
        const qty = parseInt(el.getAttribute('data-qty') || '1', 10) || 0;
        const key = menuPickKey(name, price);
        map.set(key, (map.get(key) || 0) + qty);
    });
    return map;
}

/** Highlight menu chips that are in the current draft and show their quantity badge. */
function syncMenuPickSelection() {
    const map = buildDraftQtyMap();
    document.querySelectorAll('#kotMenuBrowser .kot-menu-pick:not(.kot-open-pick)').forEach((btn) => {
        const qty = map.get(menuPickKey(btn.dataset.name, btn.dataset.price)) || 0;
        const badge = btn.querySelector('.kot-menu-pick-badge');
        if (qty > 0) {
            btn.classList.add('kot-menu-pick--selected');
            btn.setAttribute('aria-pressed', 'true');
            if (badge) badge.textContent = `×${qty}`;
        } else {
            btn.classList.remove('kot-menu-pick--selected');
            btn.removeAttribute('aria-pressed');
            if (badge) badge.textContent = '';
        }
    });
}

function collectKotDraftLines(draftBox) {
    const lines = [];
    if (!draftBox) return lines;
    for (const el of draftBox.querySelectorAll('.kot-draft-line')) {
        const name = (el.getAttribute('data-name') || '').trim();
        if (!name) continue;
        const quantity = parseInt(el.getAttribute('data-qty') || '1', 10);
        const price = parseInt(el.getAttribute('data-price') || '0', 10);
        const row = {
            name,
            quantity: Number.isFinite(quantity) ? quantity : 1,
            price: Number.isFinite(price) ? price : 0
        };
        const category_type = (el.getAttribute('data-category') || '').trim();
        if (category_type) row.category_type = category_type;
        lines.push(row);
    }
    return lines;
}

function clearKotDraft(draftBox, resetEdit = true) {
    if (!draftBox) return;
    draftBox.querySelectorAll('.kot-draft-line').forEach((el) => el.remove());
    updateKotDraftEmptyVisible(draftBox);
    if (resetEdit) kotEditingId = null;
}

function loadKotLinesIntoDraft(draftBox, kot) {
    clearKotDraft(draftBox, false);
    kotEditingId = kot?.id ? String(kot.id) : null;
    for (const ln of kot?.lines || []) {
        if (!ln || !String(ln.name || '').trim()) continue;
        appendKotDraftLine(draftBox, {
            name: String(ln.name).trim(),
            quantity: Number(ln.quantity) || 1,
            price: Number(ln.price) || 0,
            category_type: ln.category_type || ''
        });
    }
    draftBox.dispatchEvent(new CustomEvent('floor:kot-draft-updated', { bubbles: true }));
}

function resetKotComposerRow(row) {
    if (!row) return;
    row.dataset.placeholder = '1';
    delete row.dataset.needsPrice;
    const inp = row.querySelector('.kot-name-input');
    const pr = row.querySelector('.kot-price');
    const catEl = row.querySelector('.kot-line-cat');
    if (inp) inp.value = '';
    if (pr) pr.value = '';
    if (catEl) catEl.textContent = 'Open item';
}

function ensureSingleKotComposerRow(lineBox) {
    if (!lineBox) return null;
    const rows = [...lineBox.querySelectorAll('.kot-line-row')];
    let row = rows.find((r) => r.dataset.placeholder === '1') || rows[0];
    if (!row) {
        row = addKotLineRow(lineBox, { placeholder: true, openItem: true });
    }
    for (const r of rows) {
        if (r !== row) r.remove();
    }
    resetKotComposerRow(row);
    return row;
}

function isKotMobile() {
    return !!(KOT_MOBILE_MQL && KOT_MOBILE_MQL.matches);
}

function focusKotComposerSearch(lineBox) {
    if (!lineBox) return;
    const row = ensureSingleKotComposerRow(lineBox);
    if (!row) return;
    setKotComposerActiveRow(row);
    const inp = row.querySelector('.kot-name-input');
    if (!inp) return;
    window.setTimeout(() => {
        if (!lineBox.contains(row)) return;
        // On phones, re-focusing after every menu tap pops the keyboard back over
        // the menu. Keep the menu visible and let the staff keep tapping items.
        if (!isKotMobile()) inp.focus();
        handleKotComposerInput(row, lineBox);
    }, 0);
}

function promoteKotLineToDraft(row, lineBox, draftBox) {
    if (!row || !lineBox || !draftBox) return false;
    const data = readKotLineRowData(row);
    if (!data) return false;
    addOrMergeKotDraftLine(draftBox, data);
    resetKotComposerRow(row);
    ensureSingleKotComposerRow(lineBox);
    draftBox.dispatchEvent(new CustomEvent('floor:kot-draft-updated', { bubbles: true }));
    lineBox.dispatchEvent(new CustomEvent('floor:kot-line-updated', { bubbles: true }));
    return true;
}

function syncKotDraftState(draftBox, saveBtn, modifyBtn, cancelBtn, kots) {
    const n = draftBox?.querySelectorAll('.kot-draft-line').length || 0;
    const modifiable = findLastModifiableKot(kots);
    if (saveBtn) {
        saveBtn.disabled = n === 0;
        saveBtn.textContent = kotEditingId ? 'Update KOT' : modifiable ? 'Add to order' : 'Save KOT';
    }
    if (modifyBtn) {
        if (kotEditingId) {
            modifyBtn.textContent = 'Cancel edit';
            modifyBtn.disabled = false;
            modifyBtn.hidden = false;
        } else {
            modifyBtn.textContent = 'Modify KOT';
            modifyBtn.hidden = false;
            modifyBtn.disabled = n > 0 || !modifiable;
        }
    }
    if (cancelBtn) cancelBtn.hidden = !kotEditingId;
}

function getKotDraftBox() {
    return document.getElementById('kotDraftLines');
}

/** Move a filled composer row into the left draft list (after qty/price set). */
function tryPromoteComposerRow(row, lineBox) {
    if (!row || !lineBox?.contains(row)) return false;
    const draftBox = getKotDraftBox();
    if (!draftBox || !readKotLineRowData(row)) return false;
    const promoted = promoteKotLineToDraft(row, lineBox, draftBox);
    if (promoted) focusKotComposerSearch(lineBox);
    return promoted;
}

function closeKotMenuBrowserForLineBox(lineBox) {
    const kotMenuBrowser = lineBox?.closest('#addKotBox')?.querySelector('#kotMenuBrowser');
    if (kotMenuBrowser) setKotMenuBrowserOpen(kotMenuBrowser, null, lineBox, false);
}

function setMobileSheetOpen(open, animate = true) {
    const sheet = document.getElementById('kotListColumn');
    const backdrop = document.getElementById('kotSheetBackdrop');
    mobileSheetOpen = !!open && isKotMobile();
    if (sheet) {
        if (!animate) {
            sheet.classList.add('kot-no-anim');
            requestAnimationFrame(() =>
                requestAnimationFrame(() => sheet.classList.remove('kot-no-anim'))
            );
        }
        sheet.dataset.sheetOpen = mobileSheetOpen ? '1' : '0';
    }
    if (backdrop) backdrop.dataset.open = mobileSheetOpen ? '1' : '0';
}

/**
 * Touch-first KOT capture: the menu fills the screen, the running order lives in
 * a slide-up sheet, and a persistent bottom bar shows the live count/total + Save.
 * Re-run after every drawer render; a no-op (and self-cleaning) on desktop widths.
 */
function setupMobileKotUx(meta) {
    const shell = document.querySelector('.floor-kot-shell');
    const listCol = document.getElementById('kotListColumn');
    const formCol = document.getElementById('kotFormColumn');
    const draftBox = document.getElementById('kotDraftLines');
    const footer = document.getElementById('drawerFooter');
    if (!shell || !listCol || !formCol) return;

    if (!isKotMobile()) {
        shell.classList.remove('kot-mobile');
        return;
    }
    shell.classList.add('kot-mobile');

    const hasSettle = !!(footer && footer.querySelector('[data-pay]'));
    if (footer) footer.dataset.settle = hasSettle ? '1' : '0';

    const listScroll = listCol.querySelector('.floor-kot-list-scroll');

    if (!listCol.querySelector('.kot-sheet-handle')) {
        const head = document.createElement('div');
        head.className = 'kot-sheet-handle';
        head.innerHTML = `<span class="kot-sheet-grip" aria-hidden="true"></span>
            <span class="kot-sheet-title">Order details</span>
            <button type="button" class="kot-sheet-close" aria-label="Close order details">Done</button>`;
        listCol.prepend(head);
        head.querySelector('.kot-sheet-close')?.addEventListener('click', () => setMobileSheetOpen(false));
    }

    // Move "Clear this table" out of the (hidden) form footer into the sheet.
    const voidBtn = document.getElementById('voidFloorBtn');
    if (voidBtn && listScroll && !listScroll.contains(voidBtn)) {
        const wrap = document.createElement('div');
        wrap.className = 'kot-sheet-clear';
        wrap.appendChild(voidBtn);
        listScroll.appendChild(wrap);
    }

    let backdrop = document.getElementById('kotSheetBackdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'kotSheetBackdrop';
        backdrop.className = 'kot-sheet-backdrop';
        backdrop.dataset.open = '0';
        backdrop.addEventListener('click', () => setMobileSheetOpen(false));
        shell.appendChild(backdrop);
    }

    let bar = shell.querySelector('.kot-mobile-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'kot-mobile-bar';
        bar.innerHTML = `<button type="button" class="kot-mobile-review">
                <span class="kot-mobile-review-line">
                    <span class="kot-mobile-count">0 items</span>
                    <span class="kot-mobile-total">${formatRupee(0)}</span>
                </span>
                <span class="kot-mobile-view">Tap to review</span>
            </button>
            <button type="button" class="floor-btn floor-btn--primary kot-mobile-save">Save KOT</button>`;
        shell.appendChild(bar);
        bar.querySelector('.kot-mobile-review')?.addEventListener('click', () => setMobileSheetOpen(true));
        bar.querySelector('.kot-mobile-save')?.addEventListener('click', () => {
            const sb = document.getElementById('submitKotBtn');
            if (sb && !sb.disabled) sb.click();
            else setMobileSheetOpen(true);
        });
    }

    const countEl = bar.querySelector('.kot-mobile-count');
    const totalEl = bar.querySelector('.kot-mobile-total');
    const viewEl = bar.querySelector('.kot-mobile-view');
    const barSave = bar.querySelector('.kot-mobile-save');

    const sumLines = (lines) => {
        let qty = 0;
        let amount = 0;
        for (const ln of lines || []) {
            const q = parseInt(String(ln.quantity), 10) || 0;
            const p = parseInt(String(ln.price), 10) || 0;
            qty += q;
            amount += q * p;
        }
        return { qty, amount };
    };

    const updateBar = () => {
        // Items already saved on this table (so the bar still shows the real total
        // after a KOT is saved and the draft is cleared — it must never read ₹0).
        let savedItems = 0;
        let savedAmount = 0;
        for (const kot of meta?.kots || []) {
            const s = sumLines(kot.lines);
            savedItems += s.qty;
            savedAmount += s.amount;
        }
        // While editing an existing KOT, the draft replaces that KOT (avoid double-count).
        let editItems = 0;
        let editAmount = 0;
        if (kotEditingId) {
            const k = (meta?.kots || []).find((x) => x && String(x.id) === String(kotEditingId));
            const s = sumLines(k && k.lines);
            editItems = s.qty;
            editAmount = s.amount;
        }
        // Unsaved items currently in the draft.
        let draftItems = 0;
        let draftAmount = 0;
        if (draftBox) {
            draftBox.querySelectorAll('.kot-draft-line').forEach((el) => {
                const q = parseInt(el.getAttribute('data-qty') || '0', 10) || 0;
                const p = parseInt(el.getAttribute('data-price') || '0', 10) || 0;
                draftItems += q;
                draftAmount += q * p;
            });
        }
        const items = Math.max(0, savedItems - editItems + draftItems);
        const total = Math.max(0, savedAmount - editAmount + draftAmount);
        if (countEl) countEl.textContent = `${items} item${items === 1 ? '' : 's'}`;
        if (totalEl) totalEl.textContent = formatRupee(total);
        const sb = document.getElementById('submitKotBtn');
        if (barSave) {
            barSave.disabled = !sb || sb.disabled;
            barSave.textContent = sb ? sb.textContent : 'Save KOT';
        }
        if (viewEl) {
            viewEl.textContent = savedItems > 0 ? 'Tap to view order' : 'Tap to review';
        }
        if (draftItems > 0) {
            bar.classList.remove('kot-mobile-bar--pulse');
            void bar.offsetWidth;
            bar.classList.add('kot-mobile-bar--pulse');
        }
    };

    if (draftBox && draftBox.dataset.mobileBound !== '1') {
        draftBox.dataset.mobileBound = '1';
        draftBox.addEventListener('floor:kot-draft-updated', updateBar);
    }
    updateBar();

    setMobileSheetOpen(mobileSheetOpen, false);
}

function renderDrawer() {
    closeAllKotSuggest(null);
    setKotComposerActiveRow(null);
    kotEditingId = null;
    const order = selectedOrderId ? getOrderById(selectedOrderId) : null;
    const drawer = document.getElementById('drawer');
    const backdrop = document.getElementById('drawerBackdrop');
    const title = document.getElementById('drawerTitle');
    const sub = document.getElementById('drawerSub');
    const body = document.getElementById('drawerBody');
    const footer = document.getElementById('drawerFooter');
    if (!drawer || !body || !footer) return;

    if (!order) {
        drawer.dataset.open = '0';
        drawer.setAttribute('aria-hidden', 'true');
        backdrop.dataset.open = '0';
        body.innerHTML = '';
        footer.innerHTML = '';
        return;
    }

    void loadMenuForKots();

    drawer.dataset.open = '1';
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.dataset.open = '1';

    if (isLocalFloorId(order.id)) {
        repairLocalOrderKots(order);
    }
    const meta = floorMeta(order);
    const slotLabel =
        meta.slot && meta.slot.startsWith('table:')
            ? `Table ${meta.slot.split(':')[1]}`
            : meta.slot && meta.slot.startsWith('parcel:')
              ? `Parcel ${meta.slot.split(':')[1]}`
              : meta.slot || '—';

    title.textContent = slotLabel;
    sub.textContent = `${isLocalFloorId(order.id) ? 'Draft order' : `Order #${order.id}`} · ${formatRupee(order.total)} · ${meta.guest_label ? meta.guest_label : 'Walk-in guest'}`;

    const leftCol = [];
    leftCol.push(`<div class="kot-draft-panel" id="kotDraftPanel">
        <div class="floor-kot-list-head">Current KOT</div>
        <div id="kotDraftLines" class="kot-draft-lines" aria-live="polite">
            <p class="kot-draft-empty">No items yet — pick from the menu on the right.</p>
        </div>
    </div>
    <div class="floor-kot-saved-wrap">
        <div class="floor-kot-list-head">Saved KOTs</div>`);
    if (!meta.kots.length) {
        leftCol.push(
            '<p class="floor-kot-empty">No KOTs saved yet. Add items on the right, then <strong>Save KOT</strong>.</p>'
        );
    } else {
        for (const kot of meta.kots) {
            if (!kot || typeof kot !== 'object' || !kot.id) continue;
            const done = !!kot.done;
            const kotTit = kot.label && String(kot.label).trim() ? escapeHtml(kot.label) : `KOT #${kot.seq || ''}`;
            const linesHtml = (kot.lines || [])
                .map((ln, idx) => {
                    if (!ln || !(String(ln.name || '').trim())) return '';
                    const nm = escapeHtml(String(ln.name || ''));
                    const q = Number(ln.quantity) || 0;
                    const p = Number(ln.price) || 0;
                    const cat = ln.category_type ? escapeHtml(String(ln.category_type)) : '';
                    const lineTot = q * p;
                    const served = !!ln.served;
                    const idAttr = ln.id ? escapeHtml(String(ln.id)) : '';
                    const markBtn = served
                        ? '<span class="pill-done pill-done--yes">Served</span>'
                        : `<button type="button" class="floor-btn floor-btn--primary kot-line-served-btn" data-mark-line="1" data-kot-id="${escapeHtml(String(kot.id))}" data-line-id="${idAttr}" data-line-index="${idx}" style="padding:0.35rem 0.55rem;font-size:0.72rem;">Mark served</button>`;
                    const catHtml = cat ? `<div class="kot-line-type">${cat}</div>` : '';
                    return `<div class="kot-line-block">
                        <div class="kot-lines kot-lines--row"><span>${nm} ×${q}</span><span>${formatRupee(lineTot)}</span></div>
                        ${catHtml}
                        <div class="kot-line-served-row">${markBtn}</div>
                    </div>`;
                })
                .join('');
            const pill = done
                ? '<span class="pill-done pill-done--yes">All served</span>'
                : '<span class="pill-done pill-done--no">Kitchen</span>';
            const modifyKotCardBtn = kotCanModify(kot)
                ? `<button type="button" class="floor-btn kot-card-modify" data-load-kot="${escapeHtml(String(kot.id))}">Modify KOT</button>`
                : '';
            leftCol.push(`<div class="kot-card" data-kot-id="${escapeHtml(String(kot.id))}">
                <div class="kot-card-head"><strong>${kotTit}</strong>${pill}</div>
                <div class="kot-lines kot-lines--stack">${linesHtml || '<div style="color:var(--muted)">No lines</div>'}</div>
                <div class="kot-card-actions">
                    <button type="button" class="floor-btn kot-card-print" data-print-kot="${escapeHtml(String(kot.id))}">Print 3″</button>
                    ${modifyKotCardBtn || ''}
                </div>
            </div>`);
        }
    }
    leftCol.push('</div>');
    const rightCol = [];
    rightCol.push(`<div class="add-kot" id="addKotBox">
        <h3>Add items</h3>
        <p class="add-kot-hint" style="font-size:0.8rem;color:var(--muted);line-height:1.45;margin:0 0 0.5rem 0;">Pick a menu item — it moves to the left and search clears. Adjust qty with <strong>+ / −</strong> on the left.</p>
        <div class="kot-line-inputs-wrap"><div id="kotLineInputs"></div></div>
        <div class="kot-menu-browser-wrap" id="kotMenuBrowserWrap">
            <div id="kotMenuBrowser" class="kot-menu-browser"></div>
        </div>
    </div>`);

    body.innerHTML = `<div class="floor-kot-shell">
        <div class="floor-kot-list-col" id="kotListColumn">
            <div class="floor-kot-list-scroll">${leftCol.join('')}</div>
            <div class="kot-draft-actions kot-draft-actions--fixed">
                <button type="button" class="floor-btn floor-btn--primary" id="submitKotBtn" disabled>Save KOT</button>
                <button type="button" class="floor-btn floor-btn--ghost" id="modifyKotBtn" disabled>Modify KOT</button>
            </div>
        </div>
        <div class="floor-kot-form-col" id="kotFormColumn">
            <div class="floor-kot-form-scroll">${rightCol.join('')}</div>
            <div class="kot-form-footer kot-form-footer--fixed">
                <button type="button" class="floor-btn floor-btn--danger-outline floor-kot-clear-table" id="voidFloorBtn">Clear this table</button>
            </div>
        </div>
    </div>`;

    const lineBox = body.querySelector('#kotLineInputs');
    const draftBox = body.querySelector('#kotDraftLines');
    const saveKotBtn = body.querySelector('#submitKotBtn');
    const modifyKotBtn = body.querySelector('#modifyKotBtn');
    const refreshDraftUi = () => syncKotDraftState(draftBox, saveKotBtn, modifyKotBtn, null, meta.kots);

    function flushComposerLinesToDraft() {
        if (!lineBox || !draftBox) return;
        for (const row of [...lineBox.querySelectorAll('.kot-line-row')]) {
            if (row.dataset.placeholder === '1') continue;
            promoteKotLineToDraft(row, lineBox, draftBox);
        }
    }

    if (draftBox) {
        draftBox.addEventListener(
            'pointerdown',
            (e) => {
                const qbtn = e.target.closest('[data-draft-qty-delta]');
                if (qbtn) {
                    e.preventDefault();
                    const draftEl = qbtn.closest('.kot-draft-line');
                    const delta = parseInt(String(qbtn.getAttribute('data-draft-qty-delta')), 10);
                    if (draftEl && Number.isFinite(delta)) applyKotDraftQtyDelta(draftEl, delta);
                    refreshDraftUi();
                    return;
                }
                const rmBtn = e.target.closest('.kot-draft-remove');
                if (rmBtn) {
                    e.preventDefault();
                    const draftEl = rmBtn.closest('.kot-draft-line');
                    if (draftEl) {
                        draftEl.remove();
                        updateKotDraftEmptyVisible(draftBox);
                        draftBox.dispatchEvent(new CustomEvent('floor:kot-draft-updated', { bubbles: true }));
                    }
                    refreshDraftUi();
                }
            },
            true
        );
        draftBox.addEventListener('floor:kot-draft-updated', refreshDraftUi);
        draftBox.addEventListener('floor:kot-draft-updated', syncMenuPickSelection);
    }

    body.querySelector('#kotListColumn')?.addEventListener('click', (e) => {
        const loadBtn = e.target.closest('[data-load-kot]');
        if (!loadBtn || !draftBox) return;
        const kotId = loadBtn.getAttribute('data-load-kot');
        const kot = (meta.kots || []).find((k) => k && String(k.id) === String(kotId));
        if (!kot || !kotCanModify(kot)) return;
        loadKotLinesIntoDraft(draftBox, kot);
        refreshDraftUi();
    });

    modifyKotBtn?.addEventListener('click', () => {
        if (!draftBox) return;
        if (kotEditingId) {
            clearKotDraft(draftBox);
            refreshDraftUi();
            return;
        }
        const kot = findLastModifiableKot(meta.kots);
        if (!kot) {
            showToast('No KOT available to modify.');
            return;
        }
        loadKotLinesIntoDraft(draftBox, kot);
        refreshDraftUi();
    });

    if (lineBox) {
        ensureSingleKotComposerRow(lineBox);
        lineBox.addEventListener(
            'pointerdown',
            (e) => {
                const rm = e.target.closest('.kot-line-remove');
                if (!rm) return;
                e.preventDefault();
                e.stopPropagation();
                const row = rm.closest('.kot-line-row');
                removeKotLineRow(row, lineBox, refreshDraftUi);
            },
            true
        );
        lineBox.addEventListener('focusout', (e) => {
            const row = e.target.closest('.kot-line-row');
            if (!row || !lineBox.contains(row)) return;
            if (!e.target.matches('.kot-name-input, .kot-price')) return;
            const related = e.relatedTarget;
            if (related && row.contains(related)) return;

            window.setTimeout(() => {
                if (!lineBox.contains(row)) return;
                const active = document.activeElement;
                if (active && row.contains(active)) return;
                if (
                    active?.closest(
                        '.kot-menu-pick, .kot-menu-browser, .kot-draft-panel, .kot-draft-actions--fixed, .kot-form-footer--fixed, .kot-qty-btn'
                    )
                )
                    return;
                commitKotLineAfterRowBlur(row, lineBox);
                if (row === kotComposerActiveRow && active && !row.contains(active)) {
                    setKotComposerActiveRow(
                        active.closest('.kot-line-row') && lineBox.contains(active.closest('.kot-line-row'))
                            ? active.closest('.kot-line-row')
                            : null
                    );
                }
            }, 0);
        });
    }

    saveKotBtn?.addEventListener('click', async () => {
        if (saveKotBtn.disabled || !draftBox) return;
        flushComposerLinesToDraft();
        const lines = collectKotDraftLines(draftBox);
        if (!lines.length) {
            showToast('Add at least one item line.');
            return;
        }
        setBtnLoading(saveKotBtn, true);
        try {
            // One KOT per table: when the table already has an editable ticket, merge the
            // new items into it (replace) instead of opening another KOT.
            let payload;
            if (kotEditingId) {
                payload = { action: 'floor_replace_kot', kot_id: kotEditingId, lines };
            } else {
                const target = findLastModifiableKot(meta.kots);
                if (target) {
                    payload = {
                        action: 'floor_replace_kot',
                        kot_id: String(target.id),
                        lines: mergeKotLineArrays(target.lines, lines)
                    };
                } else {
                    payload = { action: 'floor_add_kot', lines };
                }
            }
            const updated = await patchOrder(order.id, payload);
            showToast('Order updated.');
            if (updated && !isLocalFloorId(updated.id)) {
                selectedOrderId = String(updated.id);
                upsertApiFloorOrderInCache(updated);
            }
            // Collapse the sheet back to the menu so staff can start the next round of items.
            mobileSheetOpen = false;
            floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
            renderSlots();
            renderDrawer();
        } catch (e) {
            showToast(e.message || 'Failed.');
        } finally {
            setBtnLoading(saveKotBtn, false);
        }
    });

    refreshDraftUi();

    const kotMenuBrowser = body.querySelector('#kotMenuBrowser');
    if (kotMenuBrowser && lineBox) {
        setKotMenuBrowserOpen(kotMenuBrowser, null, lineBox, true);
    }

    body.querySelector('#voidFloorBtn')?.addEventListener('click', async (ev) => {
        if (
            !window.confirm(
                'Clear this table and remove all KOTs for this seat? This cannot be undone.'
            )
        )
            return;
        const voidBtn = ev.currentTarget;
        const wasLocal = isLocalFloorId(order.id);
        setBtnLoading(voidBtn, true);
        try {
            await patchOrder(order.id, { action: 'floor_void' });
            showToast('Table cleared.');
            closeDrawer();
            if (wasLocal) {
                renderSlots();
            } else {
                removeApiFloorOrderFromCache(order.id);
                floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
                renderSlots();
            }
        } catch (e) {
            showToast(e.message || 'Failed.');
            setBtnLoading(voidBtn, false);
        }
    });

    bindKotPrintButtons(order);

    const allDone = isAllKotsServed(meta);
    if (allDone) {
        bindSettleFooter(footer, order, meta);
        focusSettleFooter();
    } else {
        footer.innerHTML = `<div style="font-size:0.8rem;color:var(--muted);text-align:center;line-height:1.45;">Payment opens as soon as <strong>every line</strong> on every KOT is marked served.</div>`;
    }

    setupMobileKotUx(meta);
}

function bindKotPrintButtons(order) {
    document.querySelectorAll('[data-print-kot]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const kotId = btn.getAttribute('data-print-kot');
            const meta = floorMeta(order);
            const kot = (meta.kots || []).find((k) => k && String(k.id) === String(kotId));
            if (!kot) {
                showToast('KOT not found.');
                return;
            }
            printKotReceipt(order, kot);
        });
    });
}

function ensureTrailingKotPlaceholderRow(lineBox) {
    ensureSingleKotComposerRow(lineBox);
}

function focusNextKotLineEntry(lineBox) {
    focusKotComposerSearch(lineBox);
}

/** Quantity currently selected in the open-item dialog. */
let openItemQty = 1;

function setOpenItemQty(n) {
    openItemQty = Math.max(1, Math.min(99, n || 1));
    const el = document.getElementById('openItemQty');
    if (el) el.textContent = String(openItemQty);
}

function setOpenItemError(msg) {
    const el = document.getElementById('openItemErr');
    if (!el) return;
    if (msg) {
        el.textContent = msg;
        el.hidden = false;
    } else {
        el.textContent = '';
        el.hidden = true;
    }
}

function closeOpenItemDialog() {
    const modal = document.getElementById('openItemModal');
    if (!modal) return;
    modal.dataset.open = '0';
    modal.setAttribute('aria-hidden', 'true');
}

/** Open a clean, explicit form to capture a custom/open item (name + price + qty). */
function openOpenItemDialog(prefillName = '') {
    initOpenItemDialog();
    const modal = document.getElementById('openItemModal');
    const nameEl = document.getElementById('openItemName');
    const priceEl = document.getElementById('openItemPrice');
    if (!modal || !nameEl || !priceEl) return;
    nameEl.value = prefillName || '';
    priceEl.value = '';
    setOpenItemQty(1);
    setOpenItemError('');
    modal.dataset.open = '1';
    modal.setAttribute('aria-hidden', 'false');
    // Focus the field the user still needs to fill: price when the name is known,
    // otherwise the name. The modal owns the screen, so showing the keyboard is wanted.
    const focusEl = prefillName ? priceEl : nameEl;
    window.setTimeout(() => focusEl.focus(), 60);
}

function commitOpenItemDialog() {
    const nameEl = document.getElementById('openItemName');
    const priceEl = document.getElementById('openItemPrice');
    if (!nameEl || !priceEl) return;
    const name = String(nameEl.value || '').trim();
    const price = parseInt(String(priceEl.value), 10);
    if (!name) {
        setOpenItemError('Enter an item name.');
        nameEl.focus();
        return;
    }
    if (!Number.isFinite(price) || price < 1) {
        setOpenItemError('Enter a price (₹) for this item.');
        priceEl.focus();
        return;
    }
    const draftBox = document.getElementById('kotDraftLines');
    if (!draftBox) {
        setOpenItemError('Open a table first.');
        return;
    }
    addOrMergeKotDraftLine(draftBox, {
        name,
        quantity: openItemQty,
        price,
        category_type: 'Open item'
    });
    draftBox.dispatchEvent(new CustomEvent('floor:kot-draft-updated', { bubbles: true }));
    closeOpenItemDialog();
    showToast(`Added ${openItemQty}× ${name}`);
}

let openItemDialogBound = false;
function initOpenItemDialog() {
    if (openItemDialogBound) return;
    const modal = document.getElementById('openItemModal');
    if (!modal) return;
    openItemDialogBound = true;

    modal.querySelectorAll('[data-open-close]').forEach((el) => {
        el.addEventListener('click', closeOpenItemDialog);
    });
    modal.querySelectorAll('[data-open-qty]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setOpenItemQty(openItemQty + parseInt(btn.getAttribute('data-open-qty'), 10));
        });
    });
    const addBtn = document.getElementById('openItemAdd');
    if (addBtn) addBtn.addEventListener('click', commitOpenItemDialog);

    const priceEl = document.getElementById('openItemPrice');
    const nameEl = document.getElementById('openItemName');
    [priceEl, nameEl].forEach((el) => {
        if (!el) return;
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitOpenItemDialog();
            }
        });
        el.addEventListener('input', () => setOpenItemError(''));
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.dataset.open === '1') closeOpenItemDialog();
    });
}

/** After leaving a filled line, move it to the left draft panel and add a new composer row. */
function commitKotLineAfterRowBlur(row, lineBox) {
    if (!row || !lineBox?.contains(row)) return;
    const draftBox =
        lineBox.closest('#kotDraftPanel')?.querySelector('#kotDraftLines') ||
        document.getElementById('kotDraftLines');
    if (!draftBox) return;
    if (!readKotLineRowData(row)) return;
    promoteKotLineToDraft(row, lineBox, draftBox);
}

function removeKotLineRow(row, lineBox, syncSaveKotState) {
    if (!row || !lineBox?.contains(row)) return;
    const wasActive = row === kotComposerActiveRow;
    const rows = [...lineBox.querySelectorAll('.kot-line-row')];
    if (rows.length <= 1) {
        resetKotComposerRow(row);
        if (wasActive) {
            setKotComposerActiveRow(row);
            closeAllKotSuggest(null);
        }
        focusKotComposerSearch(lineBox);
    } else {
        row.remove();
        if (wasActive) {
            setKotComposerActiveRow(null);
            closeAllKotSuggest(null);
        }
        ensureSingleKotComposerRow(lineBox);
    }
    if (typeof syncSaveKotState === 'function') syncSaveKotState();
    lineBox.dispatchEvent(new CustomEvent('floor:kot-line-updated', { bubbles: true }));
}

function addKotLineRow(
    lineBox,
    { placeholder = false, name = '', qty = '1', price = '', category = '', openItem = true } = {}
) {
    const row = document.createElement('div');
    row.className = 'kot-line-row';
    if (placeholder) row.dataset.placeholder = '1';
    row.dataset.openItem = '1';
    const catLabel = category || 'Open item';
    const namePh = 'Search menu…';
    row.innerHTML = `
        <div class="kot-line-main kot-line-main--composer">
            <div class="kot-line-name-cell">
                <input type="text" class="kot-name-input" placeholder="${escapeAttr(namePh)}" value="${escapeAttr(name)}" autocomplete="off">
            </div>
            <input type="number" class="kot-price" min="0" placeholder="₹" value="${escapeAttr(String(price))}">
            <button type="button" class="kot-line-remove" aria-label="Remove this line">×</button>
        </div>
        <div class="kot-line-meta-row">
            <div class="kot-line-cat">${escapeHtml(catLabel)}</div>
        </div>`;
    lineBox.appendChild(row);
    const inp = row.querySelector('.kot-name-input');
    if (inp) {
        inp.addEventListener('input', () => handleKotComposerInput(row, lineBox));
        inp.addEventListener('focus', () => {
            setKotComposerActiveRow(row);
            handleKotComposerInput(row, lineBox);
        });
    }
    const priceInp = row.querySelector('.kot-price');
    if (priceInp) {
        priceInp.addEventListener('change', () => tryPromoteComposerRow(row, lineBox));
    }
    return row;
}

function closeAllKotSuggest(except) {
    const float = getKotSuggestFloat();
    if (float !== except) {
        float.hidden = true;
        float.innerHTML = '';
        detachKotSuggestReposition();
    }
    document.querySelectorAll('.kot-line-row .kot-suggest').forEach((u) => {
        u.hidden = true;
        u.innerHTML = '';
    });
}

function handleKotComposerInput(row, lineBox) {
    closeAllKotSuggest(null);
    const addKotBox = lineBox?.closest('#addKotBox');
    const kotMenuBrowser = addKotBox?.querySelector('#kotMenuBrowser');
    if (!kotMenuBrowser) return;
    setKotMenuBrowserOpen(kotMenuBrowser, null, lineBox, true);
    if (kotMenuBrowser.dataset.rendered === '1') {
        const inp = row?.querySelector('.kot-name-input');
        filterKotMenuBrowserPanel(kotMenuBrowser, inp?.value || '');
    }
}

function renderKotMenuBrowser(panel, lineBox) {
    if (!panel || !lineBox) return;
    if (panel.dataset.rendered === '1') return;
    panel.dataset.rendered = '1';
    if (!menuFlat.length) {
        panel.innerHTML = '<p class="kot-menu-browser-empty">Menu still loading…</p>';
        return;
    }
    const byCat = new Map();
    for (const m of menuFlat) {
        const c = m.category_type || 'Menu';
        if (!byCat.has(c)) byCat.set(c, []);
        byCat.get(c).push(m);
    }
    const sections = [...byCat.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([cat, items]) => {
            const chips = items
                .map((h) => {
                    const kotUnit = kotUnitPriceFromMenuPrice(h.price);
                    return `<button type="button" class="kot-menu-pick" data-name="${escapeAttr(h.name)}" data-price="${kotUnit}" data-category="${escapeAttr(h.category_type)}"><span class="kot-menu-pick-label">${escapeHtml(h.name)}</span><span class="kot-menu-pick-end"><span class="kot-menu-pick-badge" aria-hidden="true"></span><span class="kot-menu-pick-price">${formatRupee(kotUnit)}</span></span></button>`;
                })
                .join('');
            return `<div class="kot-menu-browser-section"><h4 class="kot-menu-browser-cat">${escapeHtml(cat)}</h4><div class="kot-menu-browser-items">${chips}</div></div>`;
        })
        .join('');
    panel.innerHTML = `<div class="kot-menu-browser-inner">${sections}${kotOpenPicksSectionHtml()}</div>`;
    panel.querySelectorAll('.kot-menu-pick').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('kot-open-pick')) {
                closeAllKotSuggest(null);
                openOpenItemDialog((btn.getAttribute('data-open-name') || '').trim());
                return;
            }
            const target = ensureSingleKotComposerRow(lineBox);
            if (!target) return;
            delete target.dataset.placeholder;
            delete target.dataset.needsPrice;
            const inp = target.querySelector('.kot-name-input');
            const catEl = target.querySelector('.kot-line-cat');
            const pr = target.querySelector('.kot-price');
            if (inp) inp.value = btn.dataset.name || '';
            if (catEl) catEl.textContent = btn.getAttribute('data-category') || '';
            if (pr) pr.value = String(btn.dataset.price || '0');
            closeAllKotSuggest(null);
            tryPromoteComposerRow(target, lineBox);
        });
    });
    syncMenuPickSelection();
}

function initFloorDrawerDelegates() {
    const body = document.getElementById('drawerBody');
    if (!body || body.dataset.floorDelegates) return;
    body.dataset.floorDelegates = '1';

    body.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-mark-line]');
        if (!btn) return;
        const oid = selectedOrderId;
        if (!oid) return;
        const kotId = btn.getAttribute('data-kot-id');
        const lineId = (btn.getAttribute('data-line-id') || '').trim();
        const lineIndexRaw = btn.getAttribute('data-line-index');
        const payload = { action: 'floor_mark_line', kot_id: kotId, served: true };
        if (lineId) payload.line_id = lineId;
        else if (lineIndexRaw != null && lineIndexRaw !== '') payload.line_index = parseInt(lineIndexRaw, 10);
        try {
            const updated = await patchOrder(oid, payload);
            showToast('Marked served');
            if (isLocalFloorId(oid)) {
                renderSlots();
                renderDrawer();
            } else {
                upsertApiFloorOrderInCache(updated);
                floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
                renderSlots();
                renderDrawer();
            }
            const current = getOrderById(oid);
            if (current && isAllKotsServed(floorMeta(current))) {
                focusSettleFooter();
            }
        } catch (err) {
            showToast(err.message || 'Failed');
        }
    });

    document.addEventListener(
        'pointerdown',
        (e) => {
            if (
                e.target.closest('.kot-line-name-cell') ||
                e.target.closest('.kot-suggest') ||
                e.target.closest('.kot-menu-browser') ||
                e.target.closest('.kot-qty-wrap') ||
                e.target.closest('.kot-draft-qty-wrap') ||
                e.target.closest('.kot-line-remove')
            )
                return;
            document.querySelectorAll('.kot-suggest').forEach((u) => {
                u.hidden = true;
                u.innerHTML = '';
            });
        },
        true
    );
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
}

function openDrawer(orderId) {
    selectedOrderId = String(orderId);
    mobileSheetOpen = false;
    renderDrawer();
}

function closeDrawer() {
    selectedOrderId = null;
    renderDrawer();
}

function renderSlots() {
    const tableWrap = document.getElementById('tableSlots');
    const parcelWrap = document.getElementById('parcelSlots');
    if (!tableWrap || !parcelWrap) return;
    const map = slotMapFromOrders(floorOrders);
    tableWrap.innerHTML = '';
    parcelWrap.innerHTML = '';
    const nTables = Math.max(1, floorConfig.tableCount || 7);
    const nParcels = Math.max(1, floorConfig.parcelCount || 5);
    applyFloorSlotGridColumns();
    updateFloorConfigLabels();
    for (let n = 1; n <= nTables; n += 1) {
        tableWrap.appendChild(renderSlotButton({ kind: 'table', num: n, order: map.get(`table:${n}`) }));
    }
    for (let n = 1; n <= nParcels; n += 1) {
        parcelWrap.appendChild(renderSlotButton({ kind: 'parcel', num: n, order: map.get(`parcel:${n}`) }));
    }
}

async function refreshAll(options = {}) {
    if (options.reloadLocalFromDisk) {
        localFloorSessions = loadLocalFloorSessions();
    }
    if (!options.skipFloorFetch) {
        await loadFloorConfig().catch((err) => {
            if (err && err.code === 401) throw err;
        });
        lastApiFloorRows = await fetchFloorOrders();
    }
    floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
    renderSlots();
    if (selectedOrderId && !getOrderById(selectedOrderId)) {
        closeDrawer();
    } else if (selectedOrderId) {
        renderDrawer();
    }
}

function showApp() {
    const boot = document.getElementById('floorBoot');
    if (boot) boot.hidden = true;
    document.getElementById('floorAuth').hidden = true;
    document.getElementById('floorApp').hidden = false;
    resetKotMenuCache();
    void loadMenuForKots();
}

function showGate(msg = '') {
    const boot = document.getElementById('floorBoot');
    if (boot) boot.hidden = true;
    document.getElementById('floorAuth').hidden = false;
    document.getElementById('floorApp').hidden = true;
    const err = document.getElementById('floorAuthError');
    if (err) {
        err.textContent = msg;
        err.dataset.show = msg ? '1' : '0';
    }
}

document.getElementById('drawerClose')?.addEventListener('click', closeDrawer);
document.getElementById('drawerBackdrop')?.addEventListener('click', closeDrawer);

// Rebuild the open drawer when switching between the phone and desktop layouts.
const onKotBreakpointChange = () => {
    if (selectedOrderId) {
        mobileSheetOpen = false;
        renderDrawer();
    }
};
if (KOT_MOBILE_MQL.addEventListener) KOT_MOBILE_MQL.addEventListener('change', onKotBreakpointChange);
else if (KOT_MOBILE_MQL.addListener) KOT_MOBILE_MQL.addListener(onKotBreakpointChange);

document.getElementById('floorAuthForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('floorUser')?.value || '';
    const p = document.getElementById('floorPass')?.value || '';
    const submitBtn = e.currentTarget.querySelector('button[type="submit"], button:not([type])');
    setBtnLoading(submitBtn, true);
    let session;
    try {
        session = await verifyAdmin(u, p);
    } catch (err) {
        setBtnLoading(submitBtn, false);
        showGate(err.message || 'Could not verify.');
        return;
    }
    if (!session) {
        setBtnLoading(submitBtn, false);
        showGate('Invalid username or password.');
        return;
    }
    saveCreds(u, p);
    localFloorSessions = loadLocalFloorSessions();
    try {
        await refreshAll({ reloadLocalFromDisk: true });
        showApp();
    } catch (err) {
        if (err && err.code === 401) showGate('Session invalid.');
        else showGate(err.message || 'Could not load.');
    } finally {
        setBtnLoading(submitBtn, false);
    }
});

document.getElementById('floorRefreshBtn')?.addEventListener('click', async (e) => {
    const refreshBtn = e.currentTarget;
    setBtnLoading(refreshBtn, true);
    try {
        await refreshAll({ reloadLocalFromDisk: true });
        showToast('Updated.');
    } catch (e) {
        showToast(e.message || 'Refresh failed.');
        if (e && e.code === 401) showGate('Sign in again.');
    } finally {
        setBtnLoading(refreshBtn, false);
    }
});

document.getElementById('floorLogoutBtn')?.addEventListener('click', () => {
    clearCreds();
    closeDrawer();
    showGate('');
    window.location.reload();
});

initFloorDrawerDelegates();

(async function init() {
    const boot = document.getElementById('floorBoot');
    if (boot) {
        boot.hidden = false;
        boot.textContent = 'Checking admin session…';
    }

    try {
        creds = loadCreds();
        if (!creds) {
            showGate('');
            return;
        }
        let session;
        try {
            session = await verifyAdmin(creds.user, creds.pass);
        } catch (e) {
            showGate(e.message || 'Could not verify saved login.');
            return;
        }
        if (!session) {
            showGate('Saved login is no longer valid. Please sign in again.');
            return;
        }
        try {
            localFloorSessions = loadLocalFloorSessions();
            await refreshAll({ reloadLocalFromDisk: true });
            showApp();
        } catch (err) {
            const msg =
                err && err.code === 401
                    ? 'Session expired. Sign in again.'
                    : err.message || 'Could not load floor data. Sign in again.';
            showGate(msg);
        }
    } catch (e) {
        showGate(e.message || 'Something went wrong. Please sign in.');
    } finally {
        if (boot) boot.hidden = true;
    }
})();
