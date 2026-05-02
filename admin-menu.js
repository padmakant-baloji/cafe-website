'use strict';

const ADMIN_STORAGE_KEY = 'balojiAdminCredentials';

let menuCache = null;
let flatRows = [];
let editingRef = null;

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
    try {
        localStorage.setItem(
            ADMIN_STORAGE_KEY,
            JSON.stringify({ user: String(user || '').trim(), pass: String(pass || '').trim() })
        );
    } catch {
        /* ignore */
    }
}

function clearAdminCredentials() {
    try {
        localStorage.removeItem(ADMIN_STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

let currentAdminCredentials = null;

function adminHeaders(credsOverride) {
    const creds = credsOverride || currentAdminCredentials || loadAdminCredentials();
    if (!creds) return { Accept: 'application/json' };
    const token = btoa(`${creds.user}:${String(creds.pass || '')}`);
    return {
        Authorization: `Basic ${token}`,
        Accept: 'application/json'
    };
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
    return String(s ?? '').replace(/"/g, '&quot;');
}

function showAdminGate(message = '') {
    const gate = document.getElementById('adminAuthGate');
    const error = document.getElementById('adminAuthError');
    if (gate) gate.hidden = false;
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

async function verifyAdminCredentials(user, pass) {
    const res = await fetch('/api/admin/session', {
        headers: adminHeaders({ user: String(user || '').trim(), pass: String(pass || '').trim() })
    });
    if (res.status === 401) return false;
    return res.ok;
}

function flattenMenu(menu) {
    const rows = [];
    for (const cat of menu.categories || []) {
        if (Array.isArray(cat.subsections) && cat.subsections.length > 0) {
            for (const sub of cat.subsections) {
                for (const item of sub.items || []) {
                    rows.push({
                        categoryId: cat.id,
                        categoryName: cat.name,
                        subsectionId: sub.id,
                        subsectionTitle: sub.title,
                        item
                    });
                }
            }
        } else {
            for (const item of cat.items || []) {
                rows.push({
                    categoryId: cat.id,
                    categoryName: cat.name,
                    subsectionId: '',
                    subsectionTitle: '',
                    item
                });
            }
        }
    }
    return rows;
}

function priceSummary(item) {
    if (item.sizes && item.sizes.length) {
        return item.sizes.map((s) => `${s.label}: ₹${s.price}`).join(' · ');
    }
    return `₹${item.price ?? '—'}`;
}

function imgSrc(path) {
    const p = String(path || '');
    if (p.startsWith('http://') || p.startsWith('https://')) return p;
    return p.startsWith('/') ? p : `/${p}`;
}

async function fetchMenu() {
    const res = await fetch('/api/admin/menu', { headers: adminHeaders() });
    if (res.status === 401) throw Object.assign(new Error('Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(`Could not load menu (${res.status})`);
    return res.json();
}

async function postMenuAction(body) {
    const res = await fetch('/api/admin/menu', {
        method: 'POST',
        headers: {
            ...adminHeaders(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error(data.error || 'Authentication required'), { code: 401 });
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
}

function showToast(message, ok = true) {
    let el = document.getElementById('adminMenuToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'adminMenuToast';
        el.className = 'admin-menu-toast';
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.background = ok ? '#14532d' : '#7f1d1d';
    el.classList.add('admin-menu-toast--show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove('admin-menu-toast--show'), 3200);
}

function getCategoriesWithMeta(menu) {
    return (menu.categories || []).map((c) => ({
        id: c.id,
        name: c.name,
        hasSubsections: Array.isArray(c.subsections) && c.subsections.length > 0,
        subsections: (c.subsections || []).map((s) => ({ id: s.id, title: s.title }))
    }));
}

function fillCategorySelect(selectEl, menu, selectedId) {
    const cats = getCategoriesWithMeta(menu);
    selectEl.innerHTML = cats
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
        .join('');
    if (selectedId) selectEl.value = selectedId;
    return cats;
}

function fillSubsectionSelect(selectEl, menu, categoryId, selectedSubId) {
    const cat = (menu.categories || []).find((c) => c.id === categoryId);
    const subs = (cat && cat.subsections) || [];
    selectEl.innerHTML = subs
        .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)}</option>`)
        .join('');
    selectEl.disabled = subs.length === 0;
    if (selectedSubId && subs.some((s) => s.id === selectedSubId)) {
        selectEl.value = selectedSubId;
    }
}

function readSizesFromForm() {
    const mode = document.querySelector('input[name="menuPriceMode"]:checked')?.value || 'single';
    if (mode === 'sizes') {
        const rows = document.querySelectorAll('#menuSizeRows [data-size-row]');
        const sizes = [];
        rows.forEach((row) => {
            const label = row.querySelector('[data-size-label]')?.value?.trim();
            const price = Math.round(Number(row.querySelector('[data-size-price]')?.value));
            if (label && Number.isFinite(price) && price >= 0) sizes.push({ label, price });
        });
        return { sizes };
    }
    const price = Math.round(Number(document.getElementById('menuItemPrice')?.value));
    return { price };
}

function renderSizeRows(sizes) {
    const wrap = document.getElementById('menuSizeRows');
    if (!wrap) return;
    const list = sizes && sizes.length ? sizes : [{ label: 'Small', price: '' }, { label: 'Regular', price: '' }];
    wrap.innerHTML = list
        .map(
            (s, i) => `
        <div class="menu-size-row" data-size-row>
            <input type="text" data-size-label placeholder="Label" value="${escapeHtml(s.label)}" aria-label="Size label ${i + 1}">
            <input type="number" data-size-price placeholder="₹" min="0" step="1" value="${s.price === '' || s.price === undefined ? '' : escapeHtml(s.price)}" aria-label="Size price ${i + 1}">
        </div>`
        )
        .join('');
}

function openModal(mode, row) {
    const modal = document.getElementById('menuItemModal');
    const title = document.getElementById('menuModalTitle');
    const catSel = document.getElementById('menuCategorySelect');
    const subSel = document.getElementById('menuSubsectionSelect');
    const subWrap = document.getElementById('menuSubsectionWrap');
    const idInput = document.getElementById('menuItemId');
    const idWrap = document.getElementById('menuItemIdWrap');

    editingRef = row || null;
    if (mode === 'add') {
        title.textContent = 'Add menu item';
        idWrap.hidden = false;
        idInput.value = '';
        document.getElementById('menuItemName').value = '';
        document.getElementById('menuItemImage').value = '';
        document.getElementById('menuItemAlt').value = '';
        document.getElementById('menuItemPrice').value = '';
        document.querySelector('input[name="menuPriceMode"][value="single"]').checked = true;
        renderSizeRows(null);
        document.getElementById('menuPriceSingleWrap').hidden = false;
        document.getElementById('menuPriceSizesWrap').hidden = true;

        fillCategorySelect(catSel, menuCache, '');
        const firstCat = menuCache.categories[0];
        if (firstCat) {
            catSel.value = firstCat.id;
            const meta = getCategoriesWithMeta(menuCache).find((c) => c.id === firstCat.id);
            subWrap.hidden = !meta.hasSubsections;
            fillSubsectionSelect(subSel, menuCache, firstCat.id, '');
            subSel.disabled = !meta.hasSubsections;
        }
    } else {
        title.textContent = 'Edit menu item';
        idWrap.hidden = true;
        fillCategorySelect(catSel, menuCache, row.categoryId);
        const meta = getCategoriesWithMeta(menuCache).find((c) => c.id === row.categoryId);
        subWrap.hidden = !meta.hasSubsections;
        if (meta.hasSubsections) {
            fillSubsectionSelect(subSel, menuCache, row.categoryId, row.subsectionId);
        }
        const it = row.item;
        document.getElementById('menuItemName').value = it.name || '';
        document.getElementById('menuItemImage').value = it.image || '';
        document.getElementById('menuItemAlt').value = it.alt || '';
        if (it.sizes && it.sizes.length) {
            document.querySelector('input[name="menuPriceMode"][value="sizes"]').checked = true;
            document.getElementById('menuPriceSingleWrap').hidden = true;
            document.getElementById('menuPriceSizesWrap').hidden = false;
            renderSizeRows(it.sizes);
        } else {
            document.querySelector('input[name="menuPriceMode"][value="single"]').checked = true;
            document.getElementById('menuItemPrice').value = it.price ?? '';
            document.getElementById('menuPriceSingleWrap').hidden = false;
            document.getElementById('menuPriceSizesWrap').hidden = true;
            renderSizeRows(null);
        }
    }

    if (mode === 'edit') {
        catSel.disabled = true;
        subSel.disabled = true;
    } else {
        catSel.disabled = false;
        const m = getCategoriesWithMeta(menuCache).find((c) => c.id === catSel.value);
        subSel.disabled = !m || !m.hasSubsections;
    }

    modal.hidden = false;
}

function closeModal() {
    const modal = document.getElementById('menuItemModal');
    if (modal) modal.hidden = true;
    editingRef = null;
}

function updateStats() {
    const totalEl = document.getElementById('menuStatTotal');
    if (!totalEl) return;
    const total = flatRows.length;
    const hidden = flatRows.filter((r) => r.item.enabled === false).length;
    const live = total - hidden;
    const cats = new Set(flatRows.map((r) => r.categoryId)).size;
    totalEl.textContent = String(total);
    document.getElementById('menuStatLive').textContent = String(live);
    document.getElementById('menuStatHidden').textContent = String(hidden);
    document.getElementById('menuStatCats').textContent = String(cats);
}

function renderTable(filterText = '') {
    const tbody = document.getElementById('menuAdminBody');
    const q = filterText.trim().toLowerCase();
    const rows = flatRows.filter((r) => {
        if (!q) return true;
        const it = r.item;
        const blob = `${r.categoryName} ${r.subsectionTitle} ${it.name} ${it.alt || ''}`.toLowerCase();
        return blob.includes(q);
    });

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="admin-menu-empty">No items match.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows
        .map((r) => {
            const it = r.item;
            const enabled = it.enabled !== false;
            const sub = r.subsectionTitle ? `<span class="admin-menu-sub">${escapeHtml(r.subsectionTitle)}</span>` : '';
            return `<tr class="${enabled ? '' : 'admin-menu-row--off'}">
                <td class="admin-menu-thumb"><img src="${escapeAttr(imgSrc(it.image))}" alt="" loading="lazy" width="48" height="48"></td>
                <td><strong>${escapeHtml(it.name)}</strong><div class="admin-menu-id">${escapeHtml(it.id)}</div></td>
                <td>${escapeHtml(r.categoryName)}${sub}</td>
                <td>${escapeHtml(priceSummary(it))}</td>
                <td><span class="admin-menu-badge ${enabled ? 'admin-menu-badge--on' : 'admin-menu-badge--off'}">${enabled ? 'Live' : 'Hidden'}</span></td>
                <td class="admin-menu-actions">
                    <button type="button" class="admin-menu-btn" data-act="edit" data-item-id="${escapeHtml(it.id)}">Edit</button>
                    <button type="button" class="admin-menu-btn admin-menu-btn--toggle" data-act="toggle" data-item-id="${escapeHtml(it.id)}">${enabled ? 'Disable' : 'Enable'}</button>
                </td>
            </tr>`;
        })
        .join('');
}

async function refreshList() {
    menuCache = await fetchMenu();
    flatRows = flattenMenu(menuCache);
    updateStats();
    const searchInput = document.getElementById('menuAdminSearch');
    renderTable(searchInput ? searchInput.value : '');
}

function wireTableClick() {
    const tbody = document.getElementById('menuAdminBody');
    tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const itemId = btn.getAttribute('data-item-id');
        const row = flatRows.find((r) => r.item.id === itemId);
        if (!row) return;
        if (btn.getAttribute('data-act') === 'edit') {
            openModal('edit', row);
        }
        if (btn.getAttribute('data-act') === 'toggle') {
            const currentlyEnabled = row.item.enabled !== false;
            const nextEnabled = !currentlyEnabled;
            postMenuAction({
                action: 'setEnabled',
                categoryId: row.categoryId,
                subsectionId: row.subsectionId || undefined,
                itemId: row.item.id,
                enabled: nextEnabled
            })
                .then(() => {
                    showToast(nextEnabled ? 'Item is live on the menu.' : 'Item hidden from the menu.');
                    return refreshList();
                })
                .catch((err) => showToast(err.message || 'Update failed', false));
        }
    });
}

async function init() {
    const gateForm = document.getElementById('adminAuthForm');
    const logoutBtn = document.getElementById('adminMenuLogoutBtn');
    const addBtn = document.getElementById('menuAddBtn');
    const searchInput = document.getElementById('menuAdminSearch');
    const modal = document.getElementById('menuItemModal');
    const modalClose = document.getElementById('menuModalCloseBtn');
    const modalCancel = document.getElementById('menuModalCancelBtn');
    const modalSave = document.getElementById('menuModalSaveBtn');
    const catSel = document.getElementById('menuCategorySelect');
    const subSel = document.getElementById('menuSubsectionSelect');
    const subWrap = document.getElementById('menuSubsectionWrap');

    wireTableClick();

    gateForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = document.getElementById('adminUsername').value;
        const pass = document.getElementById('adminPassword').value;
        const ok = await verifyAdminCredentials(user, pass);
        if (!ok) {
            showAdminGate('Invalid credentials.');
            return;
        }
        saveAdminCredentials(user, pass);
        currentAdminCredentials = { user, pass };
        hideAdminGate();
        try {
            await refreshList();
        } catch (err) {
            if (err.code === 401) showAdminGate('Session expired.');
            else showToast(err.message, false);
        }
    });

    logoutBtn.addEventListener('click', () => {
        clearAdminCredentials();
        currentAdminCredentials = null;
        showAdminGate('');
        document.getElementById('menuAdminBody').innerHTML =
            '<tr><td colspan="6" class="admin-menu-empty">Login required.</td></tr>';
    });

    addBtn.addEventListener('click', () => openModal('add'));

    searchInput.addEventListener('input', () => renderTable(searchInput.value));

    modalClose.addEventListener('click', closeModal);
    modalCancel.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    document.querySelectorAll('input[name="menuPriceMode"]').forEach((r) => {
        r.addEventListener('change', () => {
            const mode = document.querySelector('input[name="menuPriceMode"]:checked').value;
            document.getElementById('menuPriceSingleWrap').hidden = mode !== 'single';
            document.getElementById('menuPriceSizesWrap').hidden = mode !== 'sizes';
        });
    });

    document.getElementById('menuAddSizeRowBtn').addEventListener('click', () => {
        const wrap = document.getElementById('menuSizeRows');
        const div = document.createElement('div');
        div.className = 'menu-size-row';
        div.setAttribute('data-size-row', '');
        div.innerHTML =
            '<input type="text" data-size-label placeholder="Label" aria-label="Size label">' +
            '<input type="number" data-size-price placeholder="₹" min="0" step="1" aria-label="Size price">';
        wrap.appendChild(div);
    });

    catSel.addEventListener('change', () => {
        const meta = getCategoriesWithMeta(menuCache).find((c) => c.id === catSel.value);
        subWrap.hidden = !meta.hasSubsections;
        fillSubsectionSelect(subSel, menuCache, catSel.value, '');
        subSel.disabled = !meta.hasSubsections;
    });

    modalSave.addEventListener('click', async () => {
        const name = document.getElementById('menuItemName').value.trim();
        const image = document.getElementById('menuItemImage').value.trim();
        const alt = document.getElementById('menuItemAlt').value.trim();
        if (!name || !image) {
            showToast('Name and image path are required.', false);
            return;
        }

        try {
            if (editingRef) {
                const pricing = readSizesFromForm();
                if (pricing.sizes) {
                    if (!pricing.sizes.length) {
                        showToast('Add at least one size with label and price.', false);
                        return;
                    }
                } else if (!Number.isFinite(pricing.price) || pricing.price < 0) {
                    showToast('Enter a valid price or use size pricing.', false);
                    return;
                }
                const patch = { name, image, alt };
                if (pricing.sizes) patch.sizes = pricing.sizes;
                else patch.price = pricing.price;

                await postMenuAction({
                    action: 'update',
                    categoryId: editingRef.categoryId,
                    subsectionId: editingRef.subsectionId || undefined,
                    itemId: editingRef.item.id,
                    patch
                });
                showToast('Item updated.');
            } else {
                const categoryId = catSel.value;
                const subsectionMeta = getCategoriesWithMeta(menuCache).find((c) => c.id === categoryId);
                const subsectionId = subsectionMeta.hasSubsections ? subSel.value : undefined;
                const rawId = document.getElementById('menuItemId').value.trim();
                const pricing = readSizesFromForm();
                const item = {
                    id: rawId || undefined,
                    name,
                    image,
                    alt: alt || name
                };
                if (pricing.sizes) {
                    if (!pricing.sizes.length) {
                        showToast('Add at least one size with label and price.', false);
                        return;
                    }
                    item.sizes = pricing.sizes;
                } else {
                    if (!Number.isFinite(pricing.price) || pricing.price < 0) {
                        showToast('Enter a valid price or switch to size pricing.', false);
                        return;
                    }
                    item.price = pricing.price;
                }

                await postMenuAction({
                    action: 'add',
                    categoryId,
                    subsectionId,
                    item
                });
                showToast('Item added.');
            }
            closeModal();
            await refreshList();
        } catch (err) {
            if (err.code === 401) showAdminGate('Session expired.');
            else showToast(err.message || 'Save failed', false);
        }
    });

    const saved = loadAdminCredentials();
    if (saved) {
        currentAdminCredentials = saved;
        const ok = await verifyAdminCredentials(saved.user, saved.pass);
        if (ok) {
            hideAdminGate();
            try {
                await refreshList();
            } catch (err) {
                if (err.code === 401) showAdminGate('Session expired.');
                else showToast(err.message, false);
            }
        } else {
            clearAdminCredentials();
            currentAdminCredentials = null;
            showAdminGate('Enter admin credentials to manage the menu.');
        }
    } else {
        showAdminGate('Enter admin credentials to manage the menu.');
    }
}

init();
