'use strict';

const ADMIN_STORAGE_KEY = 'balojiAdminCredentials';
const LS_FLOOR_KEY = 'balojiFloorSessions';
/** Floor KOT lines use this many rupees less per unit than the online menu list price when picking from suggestions. */
const KOT_VS_ONLINE_UNIT_DISCOUNT_RS = 5;
/** Max rows in the inline KOT name dropdown (full menu is ~80 items; do not cap at 28). */
const KOT_SUGGEST_MAX = 200;

function kotFloorUnitPriceFromMenuListPrice(menuListPrice) {
    const p = parseInt(String(menuListPrice), 10);
    if (!Number.isFinite(p) || p < 0) return 0;
    return Math.max(0, p - KOT_VS_ONLINE_UNIT_DISCOUNT_RS);
}

let creds = null;
let pollTimer = null;
let floorOrders = [];
/** @type {Array<object>} Active floor sessions kept only in this browser until settled (ids start with `local-`). */
let localFloorSessions = loadLocalFloorSessions();
/** @type {Array<object>} Last in-progress floor rows from the server (legacy / other tabs). */
let lastApiFloorRows = [];
let selectedOrderId = null;
let menuFlat = [];
let menuLoadPromise = null;
let kotSuggestFloatEl = null;
let kotSuggestRepositionHandler = null;
/** @type {HTMLElement|null} Row whose name field is active (menu picks apply here). */
let kotComposerActiveRow = null;

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

function loadMenuForKots() {
    if (menuLoadPromise) return menuLoadPromise;
    menuLoadPromise = fetch('/menu.json', { cache: 'no-store' })
        .then((r) => {
            if (!r.ok) throw new Error('menu');
            return r.json();
        })
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
    panel.querySelectorAll('.kot-menu-pick').forEach((btn) => {
        const hay = `${btn.dataset.name || ''} ${btn.getAttribute('data-category') || ''}`.toLowerCase();
        const show = !words.length || words.every((w) => hay.includes(w));
        btn.hidden = !show;
    });
    panel.querySelectorAll('.kot-menu-browser-section').forEach((sec) => {
        const any = [...sec.querySelectorAll('.kot-menu-pick')].some((b) => !b.hidden);
        sec.hidden = !any;
    });
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
            const kotUnit = kotFloorUnitPriceFromMenuListPrice(h.price);
            return `<li><button type="button" class="kot-suggest-btn" data-name="${escapeAttr(h.name)}" data-price="${kotUnit}" data-category="${escapeAttr(h.category_type)}"><span class="kot-suggest-name">${escapeHtml(h.name)}</span><span class="kot-suggest-meta">${escapeHtml(h.category_type)} · ${formatRupee(kotUnit)} <span class="kot-suggest-online">(online ${formatRupee(h.price)})</span></span></button></li>`;
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
                if (!hasTrail) addKotLineRow(lineBox, { placeholder: true });
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

function loadLocalFloorSessions() {
    try {
        const raw = localStorage.getItem(LS_FLOOR_KEY);
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
        localStorage.setItem(LS_FLOOR_KEY, json);
    } catch (e) {
        showToast('Could not write to browser storage. Check free space or site permissions.');
        throw e;
    }
    try {
        const chk = JSON.parse(localStorage.getItem(LS_FLOOR_KEY) || 'null');
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
    if (ch === 'dine_in' && (!Number.isFinite(n) || n < 1 || n > 7)) {
        throw new Error('Table must be between 1 and 7.');
    }
    if (ch === 'parcel' && (!Number.isFinite(n) || n < 1 || n > 5)) {
        throw new Error('Parcel slot must be between 1 and 5.');
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
        return res.ok;
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
        const idShow = isLocalFloorId(order.id) ? 'Draft' : `#${order.id}`;
        metaEl.textContent = `${idShow} · ${meta.kots.length} KOT${meta.kots.length === 1 ? '' : 's'}`;
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

function renderDrawer() {
    closeAllKotSuggest(null);
    setKotComposerActiveRow(null);
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
    leftCol.push('<div class="floor-kot-list-head">Saved KOTs</div>');
    if (!meta.kots.length) {
        leftCol.push(
            '<p class="floor-kot-empty">No KOTs saved yet. Add lines on the right, then <strong>Save KOT</strong> for each ticket.</p>'
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
            leftCol.push(`<div class="kot-card" data-kot-id="${escapeHtml(String(kot.id))}">
                <div class="kot-card-head"><strong>${kotTit}</strong>${pill}</div>
                <div class="kot-lines kot-lines--stack">${linesHtml || '<div style="color:var(--muted)">No lines</div>'}</div>
            </div>`);
        }
    }

    const rightCol = [];
    rightCol.push(`<div class="add-kot" id="addKotBox">
        <h3>New KOT</h3>
        <p class="add-kot-hint" style="font-size:0.8rem;color:var(--muted);line-height:1.45;margin:0 0 0.5rem 0;">Tap <strong>Search menu…</strong> — typing filters the <strong>full menu</strong> below. Use <strong>×</strong> to remove a line, or <strong>open items</strong> for custom entries.</p>
        <div class="kot-line-inputs-wrap"><div id="kotLineInputs"></div></div>
        <div class="kot-menu-browser-wrap" id="kotMenuBrowserWrap" hidden>
            <button type="button" class="floor-btn floor-btn--ghost kot-menu-browser-toggle" id="toggleKotMenuBrowser" aria-expanded="true">Hide full menu</button>
            <div id="kotMenuBrowser" class="kot-menu-browser"></div>
        </div>
        <div class="kot-form-toolbar">
            <button type="button" class="floor-btn floor-btn--ghost" id="addKotLineBtn">+ From menu</button>
            <button type="button" class="floor-btn floor-btn--ghost" id="addOpenItemBtn">+ Open item</button>
            <span class="kot-form-toolbar-spacer" aria-hidden="true"></span>
            <button type="button" class="floor-btn floor-btn--primary" id="submitKotBtn" disabled>Save KOT</button>
        </div>
        <p class="kot-kot-rate-hint">Menu suggestions use the dine-in KOT rate (−₹${KOT_VS_ONLINE_UNIT_DISCOUNT_RS} per unit vs online).</p>
        <button type="button" class="floor-btn floor-btn--danger-outline floor-kot-clear-table" id="voidFloorBtn">Clear this table</button>
    </div>`);

    body.innerHTML = `<div class="floor-kot-shell">
        <div class="floor-kot-list-col" id="kotListColumn">${leftCol.join('')}</div>
        <div class="floor-kot-form-col" id="kotFormColumn">${rightCol.join('')}</div>
    </div>`;

    const lineBox = body.querySelector('#kotLineInputs');
    const saveKotBtn = body.querySelector('#submitKotBtn');
    function syncSaveKotState() {
        if (!saveKotBtn || !lineBox) return;
        let n = 0;
        for (const r of lineBox.querySelectorAll('.kot-line-row')) {
            if ((r.querySelector('.kot-name-input')?.value || '').trim()) n += 1;
        }
        saveKotBtn.disabled = n === 0;
    }
    if (lineBox) {
        addKotLineRow(lineBox, { placeholder: true });
        lineBox.addEventListener('input', syncSaveKotState);
        lineBox.addEventListener('change', syncSaveKotState);
        lineBox.addEventListener('floor:kot-line-updated', syncSaveKotState);
        lineBox.addEventListener('pointerdown', (e) => {
            const rm = e.target.closest('.kot-line-remove');
            if (!rm) return;
            e.preventDefault();
            e.stopPropagation();
            const row = rm.closest('.kot-line-row');
            removeKotLineRow(row, lineBox, syncSaveKotState);
        });
        lineBox.addEventListener('focusout', (e) => {
            const row = e.target.closest('.kot-line-row');
            if (!row || !lineBox.contains(row)) return;
            if (!e.target.matches('.kot-name-input, .kot-qty, .kot-price')) return;
            const related = e.relatedTarget;
            if (related && row.contains(related)) return;

            window.setTimeout(() => {
                if (!lineBox.contains(row)) return;
                const active = document.activeElement;
                if (active && row.contains(active)) return;
                if (active?.closest('.kot-menu-pick, .kot-menu-browser, .kot-suggest-btn')) return;
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
        lineBox.addEventListener('click', (e) => {
            const qbtn = e.target.closest('[data-qty-delta]');
            if (qbtn) {
                const row = qbtn.closest('.kot-line-row');
                const qtyInp = row?.querySelector('.kot-qty');
                if (!row || !lineBox.contains(row) || !qtyInp) return;
                const delta = parseInt(String(qbtn.getAttribute('data-qty-delta')), 10);
                if (!Number.isFinite(delta)) return;
                let v = parseInt(String(qtyInp.value), 10);
                if (!Number.isFinite(v)) v = 1;
                v = Math.min(99, Math.max(1, v + delta));
                qtyInp.value = String(v);
                qtyInp.dispatchEvent(new Event('input', { bubbles: true }));
                syncSaveKotState();
                return;
            }
            const rm = e.target.closest('.kot-line-remove');
            if (rm) {
                e.preventDefault();
                e.stopPropagation();
                removeKotLineRow(rm.closest('.kot-line-row'), lineBox, syncSaveKotState);
                return;
            }
            const chip = e.target.closest('.kot-preset-chip');
            if (chip) {
                const row = chip.closest('.kot-line-row');
                if (!row || !lineBox.contains(row) || row.dataset.openItem !== '1') return;
                const presetName = (chip.getAttribute('data-preset-name') || '').trim();
                if (!presetName) return;
                const inp = row.querySelector('.kot-name-input');
                if (inp) inp.value = presetName;
                closeAllKotSuggest(null);
                if (row.dataset.placeholder && presetName) {
                    delete row.dataset.placeholder;
                    const hasTrail = [...lineBox.querySelectorAll('.kot-line-row')].some((r) => r.dataset.placeholder);
                    if (!hasTrail) addKotLineRow(lineBox, { placeholder: true });
                }
                inp?.focus();
                syncSaveKotState();
                lineBox.dispatchEvent(new CustomEvent('floor:kot-line-updated', { bubbles: true }));
            }
        });
        body.querySelector('#addKotLineBtn')?.addEventListener('click', () => {
            const row = addKotLineRow(lineBox, { placeholder: false });
            row?.querySelector('.kot-name-input')?.focus();
            syncSaveKotState();
        });
        body.querySelector('#addOpenItemBtn')?.addEventListener('click', () => {
            addKotLineRow(lineBox, { placeholder: false, openItem: true });
            const rows = lineBox.querySelectorAll('.kot-line-row');
            const last = rows[rows.length - 1];
            last?.querySelector('.kot-preset-chip')?.focus();
            syncSaveKotState();
        });
        const kotMenuBrowser = body.querySelector('#kotMenuBrowser');
        const toggleKotMenuBrowser = body.querySelector('#toggleKotMenuBrowser');
        toggleKotMenuBrowser?.addEventListener('click', () => {
            if (!kotMenuBrowser) return;
            const wrap = kotMenuBrowser.closest('.kot-menu-browser-wrap');
            const open = wrap?.hidden === true;
            setKotMenuBrowserOpen(kotMenuBrowser, toggleKotMenuBrowser, lineBox, open);
            if (!open) closeAllKotSuggest(null);
        });
        body.querySelector('#submitKotBtn')?.addEventListener('click', async () => {
            if (saveKotBtn && saveKotBtn.disabled) return;
            const lines = [];
            for (const r of lineBox.querySelectorAll('.kot-line-row')) {
                const name = (r.querySelector('.kot-name-input')?.value || '').trim();
                if (!name) continue;
                const quantity = parseInt(String(r.querySelector('.kot-qty')?.value || '1'), 10);
                const price = parseInt(String(r.querySelector('.kot-price')?.value || '0'), 10);
                const category_type = (r.querySelector('.kot-line-cat')?.textContent || '').trim();
                const linePayload = {
                    name,
                    quantity: Number.isFinite(quantity) ? quantity : 1,
                    price: Number.isFinite(price) ? price : 0
                };
                if (category_type) linePayload.category_type = category_type;
                lines.push(linePayload);
            }
            if (!lines.length) {
                showToast('Add at least one item line.');
                return;
            }
            try {
                const updated = await patchOrder(order.id, { action: 'floor_add_kot', lines });
                showToast('KOT saved.');
                if (updated && !isLocalFloorId(updated.id)) {
                    selectedOrderId = String(updated.id);
                    upsertApiFloorOrderInCache(updated);
                }
                floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
                renderSlots();
                renderDrawer();
            } catch (e) {
                showToast(e.message || 'Failed.');
            }
        });
        syncSaveKotState();
    }

    body.querySelector('#voidFloorBtn')?.addEventListener('click', async () => {
        if (
            !window.confirm(
                'Clear this table and remove all KOTs for this seat? This cannot be undone.'
            )
        )
            return;
        const wasLocal = isLocalFloorId(order.id);
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
        }
    });

    const allDone =
        meta.kots.length > 0 && meta.kots.every((k) => k && Array.isArray(k.lines) && k.lines.length && k.done);
    if (allDone) {
        footer.innerHTML = `<div style="font-size:0.75rem;color:var(--muted);text-align:center;margin-bottom:0.25rem;">Choose payment to complete</div>
            <div class="settle-row">
                <button type="button" class="pay-btn pay-btn--cash" data-pay="CASH">Cash</button>
                <button type="button" class="pay-btn pay-btn--upi" data-pay="UPI">UPI</button>
            </div>`;
        footer.querySelectorAll('[data-pay]').forEach((b) => {
            b.addEventListener('click', async () => {
                const pm = b.getAttribute('data-pay');
                const wasLocal = isLocalFloorId(order.id);
                try {
                    if (wasLocal) {
                        const fm = floorMeta(order);
                        const parts = String(fm.slot || '').split(':');
                        const slotNum = parseInt(parts[1], 10);
                        if (!Number.isFinite(slotNum)) throw new Error('Invalid slot.');
                        await postFloorCommit({
                            payment_method: pm,
                            channel: order.channel,
                            slot: slotNum,
                            guest_label: fm.guest_label,
                            kots: fm.kots
                        });
                        localFloorSessions = localFloorSessions.filter((o) => String(o.id) !== String(order.id));
                        saveLocalFloorSessions();
                    } else {
                        await patchOrder(order.id, { action: 'floor_complete', payment_method: pm });
                    }
                    showToast(`Completed · ${pm}`);
                    closeDrawer();
                    if (!wasLocal) {
                        removeApiFloorOrderFromCache(order.id);
                    }
                    floorOrders = mergeFloorOrdersApiAndLocal(lastApiFloorRows, localFloorSessions);
                    renderSlots();
                } catch (e) {
                    showToast(e.message || 'Failed.');
                }
            });
        });
    } else {
        footer.innerHTML = `<div style="font-size:0.8rem;color:var(--muted);text-align:center;line-height:1.45;">Settle appears when <strong>every line</strong> on every KOT is <strong>marked served</strong>. Then choose cash or UPI.</div>`;
    }
}

function ensureTrailingKotPlaceholderRow(lineBox) {
    if (!lineBox) return;
    const rows = lineBox.querySelectorAll('.kot-line-row');
    if (!rows.length) {
        addKotLineRow(lineBox, { placeholder: true });
        return;
    }
    if (![...rows].some((r) => r.dataset.placeholder)) {
        addKotLineRow(lineBox, { placeholder: true });
    }
}

/** After leaving a filled line, lock it in and add an empty line for the next item. */
function commitKotLineAfterRowBlur(row, lineBox) {
    if (!row || !lineBox?.contains(row)) return;

    const name = (row.querySelector('.kot-name-input')?.value || '').trim();
    if (!name) return;

    if (row.dataset.placeholder) delete row.dataset.placeholder;
    ensureTrailingKotPlaceholderRow(lineBox);
    lineBox.dispatchEvent(new CustomEvent('floor:kot-line-updated', { bubbles: true }));
}

function removeKotLineRow(row, lineBox, syncSaveKotState) {
    if (!row || !lineBox?.contains(row)) return;
    const wasActive = row === kotComposerActiveRow;
    const wasPlaceholder = row.dataset.placeholder === '1';
    row.remove();
    if (wasActive) {
        setKotComposerActiveRow(null);
        closeAllKotSuggest(null);
    }
    const rows = [...lineBox.querySelectorAll('.kot-line-row')];
    if (!rows.length) {
        addKotLineRow(lineBox, { placeholder: true });
    } else if (!wasPlaceholder) {
        ensureTrailingKotPlaceholderRow(lineBox);
    } else {
        const hasNamed = rows.some((r) => (r.querySelector('.kot-name-input')?.value || '').trim());
        if (hasNamed) ensureTrailingKotPlaceholderRow(lineBox);
    }
    if (typeof syncSaveKotState === 'function') syncSaveKotState();
    lineBox.dispatchEvent(new CustomEvent('floor:kot-line-updated', { bubbles: true }));
}

function addKotLineRow(
    lineBox,
    { placeholder = false, name = '', qty = '1', price = '', category = '', openItem = false } = {}
) {
    const row = document.createElement('div');
    row.className = 'kot-line-row';
    if (placeholder) row.dataset.placeholder = '1';
    if (openItem) row.dataset.openItem = '1';
    const catLabel = openItem ? (category || 'Open item') : category;
    const namePh = openItem ? 'Item name — set qty and ₹' : 'Search menu…';
    const presetsHtml = openItem
        ? `<div class="kot-open-presets">
            <span class="kot-open-presets-label">Quick pick</span>
            <button type="button" class="kot-preset-chip" data-preset-name="${escapeAttr('Water bottle')}">Water bottle</button>
            <button type="button" class="kot-preset-chip" data-preset-name="${escapeAttr('Ice cream')}">Ice cream</button>
        </div>`
        : '';
    row.innerHTML = `
        <div class="kot-line-main">
            <div class="kot-line-name-cell">
                <input type="text" class="kot-name-input" placeholder="${escapeAttr(namePh)}" value="${escapeAttr(name)}" autocomplete="off">
            </div>
            <div class="kot-qty-wrap" role="group" aria-label="Quantity">
                <button type="button" class="kot-qty-btn kot-qty-btn--minus" data-qty-delta="-1" aria-label="Decrease quantity">−</button>
                <input type="number" class="kot-qty" min="1" max="99" inputmode="numeric" placeholder="Qty" value="${escapeAttr(String(qty))}">
                <button type="button" class="kot-qty-btn kot-qty-btn--plus" data-qty-delta="1" aria-label="Increase quantity">+</button>
            </div>
            <input type="number" class="kot-price" min="0" placeholder="₹" value="${escapeAttr(String(price))}">
            <button type="button" class="kot-line-remove" aria-label="Remove this line">×</button>
        </div>
        <div class="kot-line-meta-row">
            <div class="kot-line-cat">${escapeHtml(catLabel)}</div>
            ${presetsHtml}
        </div>`;
    lineBox.appendChild(row);
    const inp = row.querySelector('.kot-name-input');
    if (inp) {
        inp.addEventListener('input', () => {
            handleKotComposerInput(row, lineBox);
        });
        inp.addEventListener('focus', () => {
            setKotComposerActiveRow(row);
            handleKotComposerInput(row, lineBox);
        });
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
    const inp = row.querySelector('.kot-name-input');
    const catEl = row.querySelector('.kot-line-cat');
    if (!inp) return;

    const v = inp.value.trim();
    const addKotBox = lineBox.closest('#addKotBox');
    const kotMenuBrowser = addKotBox?.querySelector('#kotMenuBrowser');
    const toggleKotMenuBrowser = addKotBox?.querySelector('#toggleKotMenuBrowser');

    if (row.dataset.openItem === '1') {
        closeAllKotSuggest(null);
        setKotMenuBrowserOpen(kotMenuBrowser, toggleKotMenuBrowser, lineBox, false);
        return;
    }

    closeAllKotSuggest(null);
    setKotMenuBrowserOpen(kotMenuBrowser, toggleKotMenuBrowser, lineBox, true);
    if (kotMenuBrowser?.dataset.rendered === '1') {
        filterKotMenuBrowserPanel(kotMenuBrowser, v);
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
                    const kotUnit = kotFloorUnitPriceFromMenuListPrice(h.price);
                    return `<button type="button" class="kot-menu-pick" data-name="${escapeAttr(h.name)}" data-price="${kotUnit}" data-category="${escapeAttr(h.category_type)}">${escapeHtml(h.name)} <span class="kot-menu-pick-price">${formatRupee(kotUnit)}</span></button>`;
                })
                .join('');
            return `<div class="kot-menu-browser-section"><h4 class="kot-menu-browser-cat">${escapeHtml(cat)}</h4><div class="kot-menu-browser-items">${chips}</div></div>`;
        })
        .join('');
    panel.innerHTML = `<div class="kot-menu-browser-inner">${sections}</div>`;
    panel.querySelectorAll('.kot-menu-pick').forEach((btn) => {
        btn.addEventListener('click', () => {
            let target = kotComposerActiveRow;
            if (
                !target ||
                target.dataset.openItem === '1' ||
                !lineBox.contains(target)
            ) {
                target = [...lineBox.querySelectorAll('.kot-line-row')].find(
                    (r) =>
                        r.dataset.openItem !== '1' &&
                        r.dataset.placeholder !== '1' &&
                        !(r.querySelector('.kot-name-input')?.value || '').trim()
                );
            }
            if (!target) {
                target = addKotLineRow(lineBox, { placeholder: false });
            }
            if (target.dataset.placeholder) delete target.dataset.placeholder;
            const inp = target.querySelector('.kot-name-input');
            const catEl = target.querySelector('.kot-line-cat');
            const pr = target.querySelector('.kot-price');
            if (inp) inp.value = btn.dataset.name || '';
            if (catEl) catEl.textContent = btn.getAttribute('data-category') || '';
            if (pr) pr.value = String(btn.dataset.price || '0');
            ensureTrailingKotPlaceholderRow(lineBox);
            lineBox.dispatchEvent(new CustomEvent('floor:kot-line-updated', { bubbles: true }));
            closeAllKotSuggest(null);
        });
    });
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
    for (let n = 1; n <= 7; n += 1) {
        tableWrap.appendChild(renderSlotButton({ kind: 'table', num: n, order: map.get(`table:${n}`) }));
    }
    for (let n = 1; n <= 5; n += 1) {
        parcelWrap.appendChild(renderSlotButton({ kind: 'parcel', num: n, order: map.get(`parcel:${n}`) }));
    }
}

async function refreshAll(options = {}) {
    if (options.reloadLocalFromDisk) {
        localFloorSessions = loadLocalFloorSessions();
    }
    if (!options.skipFloorFetch) {
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

function startPoll() {
    clearInterval(pollTimer);
    pollTimer = null;
}

function showApp() {
    const boot = document.getElementById('floorBoot');
    if (boot) boot.hidden = true;
    document.getElementById('floorAuth').hidden = true;
    document.getElementById('floorApp').hidden = false;
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

document.getElementById('floorAuthForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('floorUser')?.value || '';
    const p = document.getElementById('floorPass')?.value || '';
    let ok;
    try {
        ok = await verifyAdmin(u, p);
    } catch (err) {
        showGate(err.message || 'Could not verify.');
        return;
    }
    if (!ok) {
        showGate('Invalid username or password.');
        return;
    }
    saveCreds(u, p);
    try {
        await refreshAll();
        showApp();
    } catch (err) {
        if (err && err.code === 401) showGate('Session invalid.');
        else showGate(err.message || 'Could not load.');
    }
});

document.getElementById('floorRefreshBtn')?.addEventListener('click', async () => {
    try {
        await refreshAll({ reloadLocalFromDisk: true });
        showToast('Updated.');
    } catch (e) {
        showToast(e.message || 'Refresh failed.');
        if (e && e.code === 401) showGate('Sign in again.');
    }
});

document.getElementById('floorLogoutBtn')?.addEventListener('click', () => {
    clearInterval(pollTimer);
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
        let ok;
        try {
            ok = await verifyAdmin(creds.user, creds.pass);
        } catch (e) {
            showGate(e.message || 'Could not verify saved login.');
            return;
        }
        if (!ok) {
            showGate('Saved login is no longer valid. Please sign in again.');
            return;
        }
        try {
            await refreshAll();
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
