'use strict';

/* ═══════════════════════════════════════════════════════════
   Grocery Admin — Client-side Application
   ═══════════════════════════════════════════════════════════ */

const S = {
    token: localStorage.getItem('quickkartAdminToken') || '',
    products: [],
    categories: [],
    staff: [],
    cart: [],
    paymentMethod: 'cash',
    packagingCategoryId: null,
    invFilter: 'all',
    posCatFilter: null,
    billNumber: Math.floor(Date.now() / 1000),
    carryBagEnabled: false,
    carryBagPrice: 5, // default ₹5
    openQaMenu: null
};

// ─── Helpers ──────────────────────────────────────────────

function $(id) { return document.getElementById(id); }
function $$(sel) { return document.querySelectorAll(sel); }
function rupee(v) { return '₹' + Math.max(0, Math.round(Number(v) || 0)); }

function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[m]);
}

function authHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.token };
}

function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function updateClock() {
    const now = new Date();
    const h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    $('topbarClock').textContent = `${h12}:${m} ${ampm}`;
}

// ─── Auth & Init ──────────────────────────────────────────

async function init() {
    if (!S.token) { window.location.href = '/admin-login'; return; }
    try {
        const res = await fetch('/api/admin/session', { headers: authHeaders() });
        if (!res.ok) throw new Error('bad');
        await loadData();
    } catch {
        localStorage.removeItem('quickkartAdminToken');
        window.location.href = '/admin-login';
    }
}

function logout() {
    localStorage.removeItem('quickkartAdminToken');
    window.location.href = '/admin-login';
}

async function loadData() {
    await Promise.all([fetchCategories(), fetchProducts(), fetchStaff()]);
    setupNav();
    renderAll();
    updateClock();
    setInterval(updateClock, 30000);

    $('posSearch').addEventListener('input', renderPosGrid);
    $('posSearch').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const q = e.target.value.toLowerCase().trim();
            if (!q) return;

            let matches = displayProducts().filter(p => p.enabled !== false && p.sku && p.sku.toLowerCase() === q);
            if (matches.length === 0) {
                matches = displayProducts().filter(p => p.enabled !== false && p.name && p.name.toLowerCase() === q);
            }

            if (matches.length === 1) {
                addToCart(matches[0].id);
                e.target.value = '';
                renderPosGrid();
                toast(`Added ${matches[0].name}`);
            } else if (matches.length > 1) {
                showDuplicateScannerPopup(matches);
            } else {
                toast('No exact match found for scanned code');
            }
        }
    });

    $('invSearch').addEventListener('input', renderInventory);

    // Close any open quick-action menus on outside click
    document.addEventListener('click', (e) => {
        if (S.openQaMenu && !e.target.closest('.qa-wrap')) {
            S.openQaMenu.classList.remove('open');
            S.openQaMenu = null;
        }
    });

    // Detect carry bag packaging material
    updateCarryBagUI();
}

async function fetchCategories() {
    try {
        const res = await fetch('/api/admin/grocery/categories', { headers: authHeaders() });
        const d = await res.json();
        S.categories = d.categories || [];
        let pkg = S.categories.find(c => c.name.toLowerCase() === 'packaging');
        if (!pkg) {
            const r2 = await fetch('/api/admin/grocery/categories', {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify({ name: 'Packaging', slug: 'packaging' })
            });
            const d2 = await r2.json();
            if (d2.ok) { pkg = d2.category; S.categories.push(pkg); }
        }
        if (pkg) S.packagingCategoryId = pkg.id;
    } catch (e) { console.error('fetchCategories', e); }
}

async function fetchProducts() {
    try {
        const res = await fetch('/api/admin/grocery/products', { headers: authHeaders() });
        const d = await res.json();
        S.products = d.products || [];
    } catch (e) { console.error('fetchProducts', e); }
}

async function fetchStaff() {
    try {
        const res = await fetch('/api/admin/grocery/staff', { headers: authHeaders() });
        const d = await res.json();
        S.staff = d.staff || [];
    } catch (e) { console.error('fetchStaff', e); }
}

// ─── Navigation ───────────────────────────────────────────

const VIEW_TITLES = {
    billing: 'Billing',
    inventory: 'Inventory',
    packaging: 'Packaging',
    barcodes: 'Barcodes',
    staff: 'Store Staff',
    reports: 'Reports'
};

function setupNav() {
    $$('.sidebar-link[data-view]').forEach(el => {
        el.addEventListener('click', () => {
            $$('.sidebar-link').forEach(n => n.classList.remove('active'));
            $$('.view').forEach(v => v.classList.remove('active'));
            el.classList.add('active');
            const view = el.dataset.view;
            $('v-' + view).classList.add('active');
            $('topbarTitle').textContent = VIEW_TITLES[view] || view;
            if (view === 'reports') loadReports();
            if (view === 'barcodes') populateBarcodeSelect();
        });
    });
}

function renderAll() {
    renderPosCatPills();
    renderPosGrid();
    renderCart();
    renderInventory();
    renderPackaging();
    renderStaff();
    populateBarcodeSelect();
    populateCategorySelect();
}

// ─── Helpers for product filtering ────────────────────────

function displayProducts() {
    return S.products.filter(p => p.enabled !== false);
}

function packagingProducts() {
    return S.products.filter(p => p.categoryId === S.packagingCategoryId);
}

function nonPkgCategories() {
    return S.categories.filter(c => c.id !== S.packagingCategoryId);
}

// ═══════════════════════════════════════════════════════════
// POS — BILLING
// ═══════════════════════════════════════════════════════════

function renderPosCatPills() {
    const cats = nonPkgCategories();
    const html = [`<div class="cat-pill ${!S.posCatFilter ? 'active' : ''}" onclick="filterPosCat(null)">All</div>`];
    cats.forEach(c => {
        html.push(`<div class="cat-pill ${S.posCatFilter === c.id ? 'active' : ''}" onclick="filterPosCat(${c.id})">${escHtml(c.name)}</div>`);
    });
    $('posCatPills').innerHTML = html.join('');
}

function filterPosCat(catId) {
    S.posCatFilter = catId;
    renderPosCatPills();
    renderPosGrid();
}

function renderPosGrid() {
    const q = $('posSearch').value.toLowerCase().trim();
    let items = displayProducts().filter(p => p.enabled !== false);

    if (S.posCatFilter) items = items.filter(p => p.categoryId === S.posCatFilter);
    if (q) items = items.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q))
    );

    if (!items.length) {
        $('posGrid').innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No products found</p></div>';
        return;
    }

    $('posGrid').innerHTML = items.map(p => {
        const inCart = S.cart.find(c => c.id === p.id);
        const qty = inCart ? inCart.qty : 0;
        const oos = p.stockQty <= 0;
        const low = !oos && p.stockQty <= p.lowStockThreshold;
        return `<div class="pos-item ${oos ? 'oos' : ''} ${qty ? 'in-cart' : ''}" onclick="addToCart(${p.id})">
            <div class="pos-item-badge">${qty}</div>
            <div class="pos-item-name">${escHtml(p.name)}</div>
            <div class="pos-item-meta">
                <span class="pos-item-price">${rupee(p.price)}</span>
                <span class="pos-item-stock ${low ? 'low' : ''}">${oos ? 'Out' : p.stockQty + ' left'}</span>
            </div>
        </div>`;
    }).join('');
}

function showDuplicateScannerPopup(items) {
    const body = $('duplicateScannerBody');
    body.innerHTML = items.map(p => {
        return `<div class="pos-item" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid var(--border); cursor:pointer; margin-bottom:0.5rem; border-radius:var(--radius); background:var(--bg);" onclick="selectScannedDuplicate(${p.id})">
            <div>
                <div style="font-weight:600; color:var(--text);">${escHtml(p.name)}</div>
                <div style="font-size:0.8rem; color:var(--text-secondary);">SKU: ${escHtml(p.sku || 'N/A')} &nbsp;·&nbsp; Stock: ${p.stockQty}</div>
            </div>
            <div style="font-weight:700; color:var(--primary);">${rupee(p.price)}</div>
        </div>`;
    }).join('');
    $('duplicateScannerModal').classList.add('open');
}

function selectScannedDuplicate(id) {
    addToCart(id);
    $('duplicateScannerModal').classList.remove('open');
    $('posSearch').value = '';
    renderPosGrid();
    const p = S.products.find(x => x.id === id);
    if (p) toast(`Added ${p.name}`);
}

// ─── Cart Logic ───────────────────────────────────────────

function addToCart(id) {
    const p = S.products.find(x => x.id === id);
    if (!p || p.stockQty <= 0) return;
    const existing = S.cart.find(x => x.id === id);
    if (existing) {
        if (existing.qty < p.stockQty) existing.qty++;
        else { toast('Maximum stock reached'); return; }
    } else {
        S.cart.push({ 
            id: p.id, name: p.name, price: p.price, 
            qty: 1, maxQty: p.stockQty,
            sgstPercent: p.sgstPercent || 0,
            cgstPercent: p.cgstPercent || 0,
            igstPercent: p.igstPercent || 0
        });
    }
    renderCart();
    renderPosGrid(); // update badges
}

function updateQty(id, delta) {
    const idx = S.cart.findIndex(x => x.id === id);
    if (idx < 0) return;
    const p = S.products.find(x => x.id === id);
    S.cart[idx].qty += delta;
    if (S.cart[idx].qty <= 0) S.cart.splice(idx, 1);
    else if (p && S.cart[idx].qty > p.stockQty) S.cart[idx].qty = p.stockQty;
    renderCart();
    renderPosGrid();
}

function removeFromCart(id) {
    S.cart = S.cart.filter(x => x.id !== id);
    renderCart();
    renderPosGrid();
}

function clearCart() {
    S.cart = [];
    renderCart();
    renderPosGrid();
}

function cartTotal() {
    return S.cart.reduce((s, i) => s + i.price * i.qty, 0);
}

function cartItemCount() {
    return S.cart.reduce((s, i) => s + i.qty, 0);
}

function renderCart() {
    const body = $('cartBody');
    const total = cartTotal();
    const count = cartItemCount();

    $('cartCount').textContent = count;
    $('cartItemCount').textContent = count + ' items';
    const bagCharge = S.carryBagEnabled ? S.carryBagPrice : 0;
    $('bagChargeRow').style.display = S.carryBagEnabled ? '' : 'none';
    $('bagChargeAmt').textContent = rupee(bagCharge);
    $('cartTotal').textContent = rupee(total + bagCharge);
    $('checkoutBtn').disabled = !S.cart.length;
    $('cartClearBtn').style.display = S.cart.length ? '' : 'none';

    if (!S.cart.length) {
        body.innerHTML = `<div class="pos-cart-empty"><div class="empty-icon">🛒</div><p>Tap a product to add</p></div>`;
        return;
    }

    body.innerHTML = S.cart.map(item => {
        const lineTotal = item.price * item.qty;
        return `<div class="cart-line">
            <div class="cart-line-info">
                <div class="cart-line-name">${escHtml(item.name)}</div>
                <div class="cart-line-price">${rupee(item.price)} × ${item.qty} = <strong>${rupee(lineTotal)}</strong></div>
            </div>
            <div class="cart-line-actions">
                <button class="cart-qty-btn ${item.qty <= 1 ? 'remove' : ''}" onclick="updateQty(${item.id},-1)">${item.qty <= 1 ? '🗑' : '−'}</button>
                <span class="cart-qty-val">${item.qty}</span>
                <button class="cart-qty-btn" onclick="updateQty(${item.id},1)">+</button>
            </div>
        </div>`;
    }).join('');
}

function selectPayment(method) {
    S.paymentMethod = method;
    $$('.pay-method-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.method === method);
    });
}

// ─── Checkout ─────────────────────────────────────────────

async function checkout() {
    if (!S.cart.length) return;
    const btn = $('checkoutBtn');
    btn.disabled = true;
    btn.textContent = 'Processing…';

    const total = cartTotal();
    const bagCharge = S.carryBagEnabled ? S.carryBagPrice : 0;
    const grandTotal = total + bagCharge;
    const payloadItems = S.cart.map(i => ({ productId: i.id, quantity: i.qty, name: i.name }));
    if (S.carryBagEnabled && S.carryBagMaterial) {
        payloadItems.push({ productId: S.carryBagMaterial.id, quantity: 1, name: S.carryBagMaterial.name });
    }

    const payload = {
        items: payloadItems,
        total: grandTotal,
        paymentMethod: S.paymentMethod,
        customerMobile: undefined,
        carryBag: S.carryBagEnabled
    };

    try {
        const res = await fetch('/api/admin/grocery/pos-order', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.ok) {
            showReceipt(data.orderId, S.cart, grandTotal, S.paymentMethod, bagCharge);
            S.cart = [];
            S.billNumber++;
            S.carryBagEnabled = false;
            if ($('carryBagToggle')) $('carryBagToggle').checked = false;
            await fetchProducts();
            renderAll();
            toast('Sale completed!');
        } else {
            toast('Error: ' + (data.error || 'Failed'));
        }
    } catch {
        toast('Network error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Complete Sale';
    }
}

function showReceipt(orderId, items, total, method, bagCharge = 0) {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    let html = `<div class="receipt">
        <div style="font-weight:900; font-size:1.1rem; margin-bottom:2px; text-align:center;">TAX INVOICE</div>
        <div style="font-size:0.7rem; color:#666; text-align:center;">Bill #${orderId} • ${date} ${time}</div>
        <hr>
        <div class="receipt-items">`;

    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    const taxGroups = {};

    items.forEach(i => {
        const itemTotal = i.price * i.qty;
        const taxRate = (i.sgstPercent + i.cgstPercent + i.igstPercent) / 100;
        const basePrice = itemTotal / (1 + taxRate);
        const sgstAmt = basePrice * (i.sgstPercent / 100);
        const cgstAmt = basePrice * (i.cgstPercent / 100);
        const igstAmt = basePrice * (i.igstPercent / 100);

        totalTaxable += basePrice;
        totalCgst += cgstAmt;
        totalSgst += sgstAmt;
        totalIgst += igstAmt;

        const groupKey = `${i.sgstPercent}_${i.cgstPercent}_${i.igstPercent}`;
        if (!taxGroups[groupKey]) {
            taxGroups[groupKey] = { sgstP: i.sgstPercent, cgstP: i.cgstPercent, igstP: i.igstPercent, taxable: 0, sgst: 0, cgst: 0, igst: 0 };
        }
        taxGroups[groupKey].taxable += basePrice;
        taxGroups[groupKey].sgst += sgstAmt;
        taxGroups[groupKey].cgst += cgstAmt;
        taxGroups[groupKey].igst += igstAmt;

        html += `<div class="ri">
            <span>${escHtml(i.name)} × ${i.qty}</span>
            <span>${rupee(itemTotal)}</span>
        </div>`;
    });

    html += `</div><hr>
        <div class="receipt-items" style="font-size:0.8rem; color:#444;">
            <div class="ri"><span>Taxable Value</span><span>${rupee(totalTaxable.toFixed(2))}</span></div>
            ${totalCgst > 0 ? `<div class="ri"><span>Total CGST</span><span>${rupee(totalCgst.toFixed(2))}</span></div>` : ''}
            ${totalSgst > 0 ? `<div class="ri"><span>Total SGST</span><span>${rupee(totalSgst.toFixed(2))}</span></div>` : ''}
            ${totalIgst > 0 ? `<div class="ri"><span>Total IGST</span><span>${rupee(totalIgst.toFixed(2))}</span></div>` : ''}
            ${bagCharge ? `<div class="ri"><span>Carry Bag</span><span>${rupee(bagCharge)}</span></div>` : ''}
        </div>
        <hr>
        <div class="ri total-line"><span>GRAND TOTAL</span><span>${rupee(total)}</span></div>
        <hr>
        <div style="font-size:0.7rem; color:#333; margin-top:8px; font-weight:700;">TAX BREAKDOWN</div>
        <table style="width:100%; font-size:0.65rem; color:#666; border-collapse:collapse; margin-top:4px;">
            <tr style="border-bottom:1px dashed #ccc;">
                <th style="text-align:left; padding-bottom:2px;">Rate</th>
                <th style="text-align:right; padding-bottom:2px;">Taxable</th>
                <th style="text-align:right; padding-bottom:2px;">CGST</th>
                <th style="text-align:right; padding-bottom:2px;">SGST</th>
            </tr>`;

    Object.values(taxGroups).forEach(g => {
        if (g.sgstP === 0 && g.cgstP === 0 && g.igstP === 0) return;
        const rateLabel = g.igstP > 0 ? `IGST ${g.igstP}%` : `${g.cgstP + g.sgstP}% (${g.cgstP}+${g.sgstP})`;
        html += `<tr>
            <td style="padding:2px 0;">${rateLabel}</td>
            <td style="text-align:right; padding:2px 0;">₹${g.taxable.toFixed(2)}</td>
            <td style="text-align:right; padding:2px 0;">${g.cgst > 0 ? `₹${g.cgst.toFixed(2)}` : '-'}</td>
            <td style="text-align:right; padding:2px 0;">${g.sgst > 0 ? `₹${g.sgst.toFixed(2)}` : (g.igst > 0 ? `IGST ₹${g.igst.toFixed(2)}` : '-')}</td>
        </tr>`;
    });

    html += `</table>
        <div style="font-size:0.75rem; color:#666; margin-top:10px; text-align:center;">Paid via ${method.toUpperCase()}</div>
        <hr>
        <div style="font-size:0.7rem; color:#999; margin-top:4px; text-align:center;">Thank you! Visit again.<br>Home delivery - www.balojicafe.com</div>
    </div>`;

    $('receiptBody').innerHTML = html;
    $('receiptModal').classList.add('open');
}

function closeReceipt() { $('receiptModal').classList.remove('open'); }

function printReceipt() {
    const content = $('receiptBody').innerHTML;
    const win = window.open('', '_blank', 'width=320,height=500');
    win.document.write(`<html><head><style>
        body { font-family: 'Courier New', monospace; font-size: 12px; padding: 10px; }
        .ri { display: flex; justify-content: space-between; padding: 2px 0; }
        .total-line { font-weight: 900; font-size: 14px; }
        hr { border: none; border-top: 1px dashed #999; margin: 6px 0; }
    </style></head><body>${content}</body></html>`);
    win.document.close();
    win.print();
}

// ═══════════════════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════════════════

function setInvFilter(f) {
    S.invFilter = f;
    $$('.inv-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
    renderInventory();
}

function renderInventory() {
    const q = ($('invSearch') ? $('invSearch').value : '').toLowerCase().trim();
    let items = displayProducts();

    if (q) items = items.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.categoryName && p.categoryName.toLowerCase().includes(q))
    );

    if (S.invFilter === 'low') items = items.filter(p => p.lowStock);
    if (S.invFilter === 'out') items = items.filter(p => p.outOfStock);

    const tbody = $('invTableBody');
    if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="icon">📦</div><p>No products match your filter</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(p => {
        const statusClass = p.outOfStock ? 'out-stock' : p.lowStock ? 'low-stock' : 'in-stock';
        const statusText = p.outOfStock ? 'Out of Stock' : p.lowStock ? 'Low Stock' : 'In Stock';
        const enableLabel = p.enabled !== false ? 'Disable' : 'Enable';
        const enableIcon = p.enabled !== false ? '🚫' : '✅';
        return `<tr>
            <td ondblclick="makeEditable(this, ${p.id}, 'name')" class="editable-cell"><span class="inv-name">${escHtml(p.name)}</span></td>
            <td ondblclick="makeEditable(this, ${p.id}, 'sku')" class="editable-cell">${p.sku ? `<span class="inv-sku">${escHtml(p.sku)}</span>` : '<span style="color:var(--text-tertiary);">—</span>'}</td>
            <td style="color:var(--text-secondary); font-size:0.8rem;">${escHtml(p.categoryName || '—')}</td>
            <td ondblclick="makeEditable(this, ${p.id}, 'price', 'number')" class="editable-cell">
                <div style="font-weight:700;">${rupee(p.price)}</div>
                ${p.mrp > p.price ? `<div style="font-size:0.7rem; color:var(--text-tertiary); text-decoration:line-through;">${rupee(p.mrp)}</div>` : ''}
            </td>
            <td><div style="font-size:0.75rem; color:var(--text-secondary);">S:${p.sgstPercent}% C:${p.cgstPercent}% I:${p.igstPercent}%</div></td>
            <td>
                <div class="inv-stock-inline">
                    <button class="stock-adjust-btn" onclick="adjustStock(${p.id},-1)">−</button>
                    <span class="stock-qty-display">${p.stockQty}</span>
                    <button class="stock-adjust-btn" onclick="adjustStock(${p.id},+1)">+</button>
                </div>
            </td>
            <td><span class="stock-badge ${statusClass}">${statusText}</span></td>
            <td style="text-align:right;">
                <div class="inv-actions">
                    <button class="inv-btn" onclick="openProductModal(${p.id})">Edit</button>
                    <div class="qa-wrap">
                        <button class="qa-trigger" onclick="toggleQaMenu(event, 'qa-inv-${p.id}')" title="Quick Actions">⋯</button>
                        <div class="qa-menu" id="qa-inv-${p.id}">
                            <button class="qa-item" onclick="quickPrintLabel(${p.id})"><span class="qa-icon">🏷️</span> Print Label</button>
                            <button class="qa-item" onclick="quickSetStock(${p.id})"><span class="qa-icon">📝</span> Set Stock</button>
                            <button class="qa-item" onclick="quickDuplicate(${p.id})"><span class="qa-icon">📋</span> Duplicate</button>
                            <button class="qa-item" onclick="quickToggleEnable(${p.id})"><span class="qa-icon">${enableIcon}</span> ${enableLabel}</button>
                            <div class="qa-sep"></div>
                            <button class="qa-item danger" onclick="deleteProduct(${p.id})"><span class="qa-icon">🗑️</span> Delete</button>
                        </div>
                    </div>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function makeEditable(el, id, field, type = 'text') {
    if (el.querySelector('input')) return; // already editing
    const p = S.products.find(x => x.id === id);
    if (!p) return;
    
    let val = p[field] || '';
    if (field === 'price') val = p.price;

    const originalHtml = el.innerHTML;
    const input = document.createElement('input');
    input.type = type;
    input.value = val;
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.style.margin = '0';
    input.style.padding = '9px 13px'; // matches td padding approx, minus border
    input.style.border = '1.5px solid var(--primary)';
    input.style.borderRadius = '4px';
    input.style.font = 'inherit';
    input.style.backgroundColor = 'var(--surface)';

    const originalPadding = el.style.padding;
    el.style.padding = '0'; // remove cell padding so input fills exactly
    el.innerHTML = '';
    el.appendChild(input);
    input.focus();
    input.select();

    const finishEdit = async (save) => {
        if (!el.querySelector('input')) return;
        let newVal = input.value.trim();
        if (type === 'number') newVal = Number(newVal);

        if (save && newVal !== val && newVal !== '') {
            try {
                const payload = { [field]: newVal };
                if (field === 'price') payload.mrp = newVal > p.mrp ? newVal : p.mrp;
                
                const res = await fetch(`/api/admin/grocery/products/${id}`, {
                    method: 'PATCH', headers: authHeaders(),
                    body: JSON.stringify(payload)
                });
                const d = await res.json();
                if (d.ok) {
                    await fetchProducts();
                    renderAll();
                    toast('Updated');
                    return;
                }
            } catch (e) {
                toast('Update failed');
            }
        }
        el.style.padding = originalPadding;
        el.innerHTML = originalHtml; // Revert if cancelled or no change
    };

    input.addEventListener('blur', () => finishEdit(true));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finishEdit(true);
        if (e.key === 'Escape') finishEdit(false);
    });
}

async function adjustStock(id, delta) {
    try {
        const res = await fetch(`/api/admin/grocery/products/${id}/stock`, {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ mode: 'delta', amount: delta })
        });
        const d = await res.json();
        if (d.ok && d.product) {
            const idx = S.products.findIndex(p => p.id === id);
            if (idx >= 0) S.products[idx] = d.product;
            renderInventory();
            renderPosGrid();
            toast(`Stock ${delta > 0 ? 'increased' : 'decreased'}`);
        }
    } catch { toast('Stock update failed'); }
}

async function deleteProduct(id) {
    if (!confirm('Delete this product permanently?')) return;
    try {
        const res = await fetch(`/api/admin/grocery/products/${id}`, {
            method: 'DELETE', headers: authHeaders()
        });
        const d = await res.json();
        if (d.ok) {
            S.products = S.products.filter(p => p.id !== id);
            renderAll();
            toast('Product deleted');
        } else {
            toast('Delete failed: ' + (d.error || 'Unknown'));
        }
    } catch { toast('Network error'); }
}

// ═══════════════════════════════════════════════════════════
// QUICK ACTIONS
// ═══════════════════════════════════════════════════════════

function toggleQaMenu(e, menuId) {
    e.stopPropagation();
    const menu = $(menuId);
    if (S.openQaMenu && S.openQaMenu !== menu) S.openQaMenu.classList.remove('open');
    menu.classList.toggle('open');
    S.openQaMenu = menu.classList.contains('open') ? menu : null;
}

function closeAllQa() {
    if (S.openQaMenu) { S.openQaMenu.classList.remove('open'); S.openQaMenu = null; }
}

function quickPrintLabel(id) {
    closeAllQa();
    const p = S.products.find(x => x.id === id);
    if (!p) return;
    
    // Switch to Barcodes view
    $$('.sidebar-link').forEach(n => n.classList.remove('active'));
    $$('.view').forEach(v => v.classList.remove('active'));
    const link = document.querySelector('.sidebar-link[data-view="barcodes"]');
    if (link) link.classList.add('active');
    $('v-barcodes').classList.add('active');
    $('topbarTitle').textContent = VIEW_TITLES['barcodes'] || 'Barcodes';
    
    // Set form fields
    $('bcProductSelect').value = p.id;
    $('bcCopies').value = Math.max(1, p.stockQty || 1);
    
    // Generate barcode preview
    generateBarcode();
    toast('Switched to Barcodes. You can edit copies before printing.');
}

function quickSetStock(id) {
    closeAllQa();
    const p = S.products.find(x => x.id === id);
    if (!p) return;
    const newQty = prompt(`Set stock for "${p.name}"\nCurrent: ${p.stockQty}`, p.stockQty);
    if (newQty === null) return;
    const qty = parseInt(newQty, 10);
    if (isNaN(qty) || qty < 0) { toast('Invalid quantity'); return; }
    fetch(`/api/admin/grocery/products/${id}/stock`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ mode: 'set', amount: qty })
    }).then(r => r.json()).then(d => {
        if (d.ok && d.product) {
            const idx = S.products.findIndex(x => x.id === id);
            if (idx >= 0) S.products[idx] = d.product;
            renderInventory();
            renderPosGrid();
            renderPackaging();
            toast(`Stock set to ${qty}`);
        }
    }).catch(() => toast('Failed'));
}

async function quickDuplicate(id) {
    closeAllQa();
    const p = S.products.find(x => x.id === id);
    if (!p) return;
    const payload = {
        name: p.name + ' (Copy)',
        sku: '',
        price: p.price,
        mrp: p.mrp,
        stockQty: 0,
        lowStockThreshold: p.lowStockThreshold,
        unit: p.unit,
        unitValue: p.unitValue,
        categoryId: p.categoryId
    };
    try {
        const res = await fetch('/api/admin/grocery/products', {
            method: 'POST', headers: authHeaders(), body: JSON.stringify(payload)
        });
        const d = await res.json();
        if (d.ok) {
            await fetchProducts();
            renderAll();
            toast('Product duplicated');
        } else { toast('Failed: ' + (d.error || '')); }
    } catch { toast('Network error'); }
}

async function quickToggleEnable(id) {
    closeAllQa();
    const p = S.products.find(x => x.id === id);
    if (!p) return;
    const newEnabled = p.enabled === false ? true : false;
    try {
        const res = await fetch(`/api/admin/grocery/products/${id}`, {
            method: 'PATCH', headers: authHeaders(),
            body: JSON.stringify({ name: p.name, price: p.price, enabled: newEnabled })
        });
        const d = await res.json();
        if (d.ok) {
            await fetchProducts();
            renderAll();
            toast(newEnabled ? 'Product enabled' : 'Product disabled');
        }
    } catch { toast('Failed'); }
}

// ═══════════════════════════════════════════════════════════
// PACKAGING (Consumable Materials)
// ═══════════════════════════════════════════════════════════

const PKG_ICONS = {
    'bag': '🛍️', 'carry': '🛍️', 'plastic': '🛍️',
    'box': '📦', 'carton': '📦',
    'tape': '🪡', 'seal': '🪡',
    'wrap': '🧻', 'cling': '🧻', 'foil': '🧻',
    'container': '🥡', 'cup': '🥤', 'tray': '🍱',
    'label': '🏷️', 'sticker': '🏷️',
    'rubber': '⭕', 'band': '⭕',
};

function pkgIcon(name) {
    const lower = (name || '').toLowerCase();
    for (const [key, icon] of Object.entries(PKG_ICONS)) {
        if (lower.includes(key)) return icon;
    }
    return '📦';
}

function pkgType(name) {
    const lower = (name || '').toLowerCase();
    if (lower.includes('bag') || lower.includes('carry')) return 'Carry Bag';
    if (lower.includes('box') || lower.includes('carton')) return 'Box';
    if (lower.includes('tape') || lower.includes('seal')) return 'Tape';
    if (lower.includes('wrap') || lower.includes('cling') || lower.includes('foil')) return 'Wrap';
    if (lower.includes('container') || lower.includes('tray') || lower.includes('cup')) return 'Container';
    if (lower.includes('label') || lower.includes('sticker')) return 'Label';
    if (lower.includes('rubber') || lower.includes('band')) return 'Band';
    return 'Other';
}

function renderPackaging() {
    const items = packagingProducts();
    const tbody = $('pkgTableBody');
    const bar = $('pkgSummaryBar');

    // Summary stats
    const total = items.length;
    const lowCount = items.filter(p => p.lowStock || p.outOfStock).length;
    const okCount = total - lowCount;

    bar.innerHTML = `
        <div class="pkg-stat"><div class="pkg-stat-label">Total Materials</div><div class="pkg-stat-value">${total}</div></div>
        <div class="pkg-stat"><div class="pkg-stat-label">Healthy Stock</div><div class="pkg-stat-value ok">${okCount}</div></div>
        <div class="pkg-stat"><div class="pkg-stat-label">Needs Reorder</div><div class="pkg-stat-value warn">${lowCount}</div></div>
    `;

    if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon">🥡</div><p>No packaging materials yet. Add carry bags, boxes, tape, etc.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(p => {
        const isLow = p.lowStock || p.outOfStock;
        const statusClass = p.outOfStock ? 'out-stock' : p.lowStock ? 'low-stock' : 'in-stock';
        const statusText = p.outOfStock ? 'Out' : p.lowStock ? 'Low' : 'OK';
        const icon = pkgIcon(p.name);
        const type = pkgType(p.name);

        return `<tr>
            <td>
                <div style="display:flex; align-items:center; gap:0.6rem;">
                    <span style="font-size:1.2rem;">${icon}</span>
                    <span class="inv-name">${escHtml(p.name)}</span>
                </div>
            </td>
            <td style="font-size:0.8rem; color:var(--text-secondary);">${type}</td>
            <td style="font-weight:600;">${rupee(p.price)}<span style="font-size:0.7rem; color:var(--text-tertiary);">/${p.unit}</span></td>
            <td>
                <div class="inv-stock-inline">
                    <button class="stock-adjust-btn" onclick="adjustPkgStock(${p.id},-1)">−</button>
                    <span class="stock-qty-display" style="${isLow ? 'color:var(--danger);' : ''}">${p.stockQty}</span>
                    <button class="stock-adjust-btn" onclick="adjustPkgStock(${p.id},+1)">+</button>
                </div>
            </td>
            <td><span class="stock-badge ${statusClass}">${statusText}</span></td>
            <td style="text-align:right;">
                <div class="inv-actions">
                    <button class="inv-btn" onclick="openProductModal(${p.id}, true)">Edit</button>
                    <div class="qa-wrap">
                        <button class="qa-trigger" onclick="toggleQaMenu(event, 'qa-pkg-${p.id}')" title="Quick Actions">⋯</button>
                        <div class="qa-menu" id="qa-pkg-${p.id}">
                            <button class="qa-item" onclick="quickPrintLabel(${p.id})"><span class="qa-icon">🏷️</span> Print Label</button>
                            <button class="qa-item" onclick="quickSetStock(${p.id})"><span class="qa-icon">📝</span> Set Stock</button>
                            <button class="qa-item" onclick="quickDuplicate(${p.id})"><span class="qa-icon">📋</span> Duplicate</button>
                            <button class="qa-item" onclick="quickToggleEnable(${p.id})"><span class="qa-icon">${p.enabled !== false ? '🚫' : '✅'}</span> ${p.enabled !== false ? 'Disable' : 'Enable'}</button>
                            <div class="qa-sep"></div>
                            <button class="qa-item danger" onclick="deleteProduct(${p.id})"><span class="qa-icon">🗑️</span> Delete</button>
                        </div>
                    </div>
                </div>
            </td>
        </tr>`;
    }).join('');
}

async function adjustPkgStock(id, delta) {
    await adjustStock(id, delta);
    renderPackaging();
    updateCarryBagUI();
}

// ─── Carry Bag in POS ─────────────────────────────────────

function updateCarryBagUI() {
    const bags = packagingProducts().filter(p =>
        p.name.toLowerCase().includes('bag') || p.name.toLowerCase().includes('carry')
    );
    const row = $('carryBagRow');
    if (bags.length > 0 && bags[0].stockQty > 0) {
        S.carryBagPrice = bags[0].price || 5;
        row.style.display = '';
    } else {
        row.style.display = 'none';
        S.carryBagEnabled = false;
        if ($('carryBagToggle')) $('carryBagToggle').checked = false;
    }
}

function toggleCarryBag() {
    S.carryBagEnabled = $('carryBagToggle').checked;
    renderCart();
}

// ═══════════════════════════════════════════════════════════
// PRODUCT MODAL
// ═══════════════════════════════════════════════════════════

function populateCategorySelect() {
    const sel = $('fCategory');
    sel.innerHTML = '<option value="">None</option>' + nonPkgCategories().map(c =>
        `<option value="${c.id}">${escHtml(c.name)}</option>`
    ).join('');
}

function openProductModal(id = null, isPackaging = false) {
    $('fId').value = '';
    $('fIsPackaging').value = isPackaging ? '1' : '';
    $('fName').value = '';
    $('fSku').value = '';
    $('fCategory').value = '';
    $('fPrice').value = '';
    $('fMrp').value = '';
    $('fSgst').value = '0';
    $('fCgst').value = '0';
    $('fIgst').value = '0';
    $('fStock').value = '';
    $('fLowStock').value = '5';
    $('fUnit').value = 'pcs';
    $('fUnitValue').value = '1';
    $('modalTitle').textContent = id ? 'Edit Product' : (isPackaging ? 'Add Packaging Material' : 'Add Product');

    if (id) {
        const p = S.products.find(x => x.id === id);
        if (p) {
            $('fId').value = p.id;
            $('fName').value = p.name;
            $('fSku').value = p.sku;
            $('fCategory').value = p.categoryId || '';
            $('fPrice').value = p.price;
            $('fMrp').value = p.mrp || '';
            $('fSgst').value = p.sgstPercent || 0;
            $('fCgst').value = p.cgstPercent || 0;
            $('fIgst').value = p.igstPercent || 0;
            $('fStock').value = p.stockQty;
            $('fLowStock').value = p.lowStockThreshold;
            $('fUnit').value = p.unit;
            $('fUnitValue').value = p.unitValue || 1;
        }
    }

    populateCategorySelect();
    $('productModal').classList.add('open');
    setTimeout(() => $('fName').focus(), 100);
}

function closeModal() { $('productModal').classList.remove('open'); }

async function saveProduct() {
    const id = $('fId').value;
    const isPackaging = $('fIsPackaging').value === '1';
    const name = $('fName').value.trim();
    if (!name) { toast('Product name is required'); return; }

    const price = Number($('fPrice').value);
    if (!price || price <= 0) { toast('Price must be greater than 0'); return; }

    const payload = {
        name,
        sku: $('fSku').value.trim(),
        price,
        mrp: Number($('fMrp').value) || price,
        sgstPercent: Number($('fSgst').value) || 0,
        cgstPercent: Number($('fCgst').value) || 0,
        igstPercent: Number($('fIgst').value) || 0,
        stockQty: Number($('fStock').value) || 0,
        lowStockThreshold: Number($('fLowStock').value) || 5,
        unit: $('fUnit').value || 'pcs',
        unitValue: Number($('fUnitValue').value) || 1,
        categoryId: isPackaging ? S.packagingCategoryId : ($('fCategory').value || null)
    };

    const method = id ? 'PATCH' : 'POST';
    const url = id ? `/api/admin/grocery/products/${id}` : '/api/admin/grocery/products';

    try {
        const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
        const d = await res.json();
        if (d.ok) {
            closeModal();
            await fetchProducts();
            renderAll();
            toast(id ? 'Product updated' : 'Product added');
        } else {
            toast('Failed: ' + (d.error || 'Unknown'));
        }
    } catch { toast('Network error'); }
}

// ═══════════════════════════════════════════════════════════
// BARCODES
// ═══════════════════════════════════════════════════════════

function populateBarcodeSelect() {
    const sel = $('bcProductSelect');
    sel.innerHTML = '<option value="">Choose a product…</option>' + displayProducts().map(p =>
        `<option value="${p.id}">${escHtml(p.name)} ${p.sku ? '(' + escHtml(p.sku) + ')' : ''}</option>`
    ).join('');
}

function generateBarcode() {
    const id = Number($('bcProductSelect').value);
    const p = S.products.find(x => x.id === id);
    if (!p) { toast('Select a product first'); return; }

    const copies = Math.min(50, Math.max(1, Number($('bcCopies').value) || 1));
    const sku = p.sku || `PROD-${p.id}`;
    const area = $('bcPreviewArea');

    let html = '';
    for (let i = 0; i < copies; i++) {
        html += `<div class="bc-label-card visible" id="bcCard-${i}">
            <div class="bc-label-name">${escHtml(p.name)}</div>
            <div class="bc-label-price">${rupee(p.price)}</div>
            ${p.mrp > p.price ? `<div class="bc-label-mrp">MRP ${rupee(p.mrp)}</div>` : ''}
            <svg class="bc-svg" id="bcSvg-${i}"></svg>
        </div>`;
    }
    area.innerHTML = html;

    for (let i = 0; i < copies; i++) {
        try {
            JsBarcode(`#bcSvg-${i}`, sku, {
                format: 'CODE128', width: 2, height: 50,
                displayValue: true, fontSize: 12, margin: 4
            });
        } catch (e) { console.warn('Barcode error', e); }
    }
}

function printBarcode() {
    if (!$('bcPreviewArea').querySelector('.bc-label-card.visible')) {
        toast('Generate labels first');
        return;
    }
    window.print();
}

// ═══════════════════════════════════════════════════════════
// STAFF MANAGEMENT
// ═══════════════════════════════════════════════════════════

function renderStaff() {
    const tbody = $('staffTableBody');
    if (!tbody) return;

    if (!S.staff || !S.staff.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon">👥</div><p>No staff members added yet</p></div></td></tr>`;
        return;
    }

    const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', inventory: 'Inventory Clerk' };
    const ROLE_COLORS = { owner: 'purple', manager: 'primary', cashier: 'teal', inventory: 'warning' };

    tbody.innerHTML = S.staff.map(s => {
        const rColor = ROLE_COLORS[s.role] || 'text';
        const rLabel = ROLE_LABELS[s.role] || s.role;
        const statusBadge = s.enabled ? '<span class="stock-badge in-stock">Active</span>' : '<span class="stock-badge out-stock">Inactive</span>';

        return `<tr>
            <td><span class="inv-name" style="display:flex; align-items:center; gap:0.5rem;"><span style="font-size:1.2rem;">👤</span> ${escHtml(s.name)}</span></td>
            <td><span style="color:var(--${rColor}); font-weight:700; font-size:0.8rem; background:var(--${rColor}-soft); padding:3px 8px; border-radius:999px;">${rLabel}</span></td>
            <td>${escHtml(s.phone) || '<span style="color:var(--text-tertiary);">—</span>'}</td>
            <td><span style="font-family:monospace; background:var(--surface-alt); padding:3px 6px; border-radius:4px; font-weight:700;">${escHtml(s.pin) || '—'}</span></td>
            <td>${statusBadge}</td>
            <td style="text-align:right;">
                <div class="inv-actions">
                    <button class="inv-btn" onclick="openStaffModal(${s.id})">Edit</button>
                    <button class="inv-btn danger" onclick="deleteStaff(${s.id})">Delete</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function openStaffModal(id = null) {
    $('sId').value = '';
    $('sName').value = '';
    $('sRole').value = 'cashier';
    $('sPhone').value = '';
    $('sPin').value = '';
    $('sEnabled').checked = true;
    $('staffModalTitle').textContent = id ? 'Edit Staff' : 'Add Staff';

    if (id) {
        const s = S.staff.find(x => x.id === id);
        if (s) {
            $('sId').value = s.id;
            $('sName').value = s.name;
            $('sRole').value = s.role;
            $('sPhone').value = s.phone;
            $('sPin').value = s.pin;
            $('sEnabled').checked = s.enabled;
        }
    }

    $('staffModal').classList.add('open');
    setTimeout(() => $('sName').focus(), 100);
}

function closeStaffModal() { $('staffModal').classList.remove('open'); }

async function saveStaff() {
    const id = $('sId').value;
    const name = $('sName').value.trim();
    if (!name) { toast('Staff name is required'); return; }
    const pin = $('sPin').value.trim();
    if (!pin || pin.length < 4) { toast('PIN must be at least 4 digits'); return; }

    const payload = {
        name,
        role: $('sRole').value,
        phone: $('sPhone').value.trim(),
        pin: pin,
        enabled: $('sEnabled').checked
    };

    const method = id ? 'PATCH' : 'POST';
    const url = id ? `/api/admin/grocery/staff/${id}` : '/api/admin/grocery/staff';

    try {
        const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
        const d = await res.json();
        if (d.ok) {
            closeStaffModal();
            await fetchStaff();
            renderStaff();
            toast(id ? 'Staff updated' : 'Staff added');
        } else {
            toast('Failed: ' + (d.error || 'Unknown error'));
        }
    } catch { toast('Network error'); }
}

async function deleteStaff(id) {
    if (!confirm('Permanently delete this staff member?')) return;
    try {
        const res = await fetch(`/api/admin/grocery/staff/${id}`, { method: 'DELETE', headers: authHeaders() });
        const d = await res.json();
        if (d.ok) {
            await fetchStaff();
            renderStaff();
            toast('Staff deleted');
        } else {
            toast('Failed to delete');
        }
    } catch { toast('Network error'); }
}

// ═══════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════

async function loadReports() {
    try {
        const [ordersRes, lowStockRes] = await Promise.all([
            fetch('/api/admin/orders', { headers: authHeaders() }),
            fetch('/api/admin/grocery/low-stock', { headers: authHeaders() })
        ]);
        const ordersData = await ordersRes.json();
        const lowStockData = await lowStockRes.json();
        const orders = ordersData.orders || [];

        const todayStr = new Date().toISOString().split('T')[0];
        let todayRevenue = 0, todayCount = 0;

        const todayOrders = orders.filter(o => {
            const d = new Date(o.created_at).toISOString().split('T')[0];
            const valid = d === todayStr && o.status !== 'cancelled' && o.status !== 'rejected';
            if (valid) { todayRevenue += Number(o.total) || 0; todayCount++; }
            return valid;
        });

        $('repRevenue').textContent = rupee(todayRevenue);
        $('repTxns').textContent = todayCount;
        $('repAvg').textContent = todayCount ? rupee(todayRevenue / todayCount) : '₹0';
        $('repLowStock').textContent = (lowStockData.products || []).length;

        const tbody = $('repTableBody');
        const recent = orders.slice(0, 30);
        if (!recent.length) {
            tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><p>No transactions yet</p></div></td></tr>';
            return;
        }

        tbody.innerHTML = recent.map(o => {
            let itemText = '';
            try {
                const items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
                itemText = (items || []).map(i => `${i.quantity}× ${i.name}`).join(', ');
            } catch {}
            const ch = String(o.channel || 'delivery');
            const chLabel = ch === 'walk_in' ? '🏪 Walk-in' : ch === 'grocery' ? '🛒 Online' : '🚚 Delivery';

            return `<tr>
                <td style="font-weight:600; color:var(--text-tertiary);">#${o.id}</td>
                <td>${new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td><span style="font-size:0.8rem;">${chLabel}</span></td>
                <td style="max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.8rem; color:var(--text-secondary);" title="${escHtml(itemText)}">${escHtml(itemText)}</td>
                <td style="text-align:right; font-weight:700; color:var(--primary);">${rupee(o.total)}</td>
            </tr>`;
        }).join('');
    } catch (e) {
        console.error('loadReports', e);
    }
}

// ─── Boot ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
