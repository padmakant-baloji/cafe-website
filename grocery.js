'use strict';

/**
 * Grocery (Instamart-style) storefront module.
 * Self-contained: owns its own cart (localStorage `quickkartGroceryCart`), rendering,
 * and checkout, so the existing food flow in script.js stays untouched.
 */
(function () {
    const TOKEN_KEY = 'quickkartCustomerToken';
    const PROFILE_KEY = 'quickkartCustomerProfile';
    const MODE_KEY = 'quickkartOrderMode';
    const CART_KEY = 'quickkartGroceryCart';

    const PLACEHOLDER = 'images/placeholder-icon.svg';

    const state = {
        loaded: false,
        loading: false,
        stores: [],
        categories: [],
        selectedStoreId: null,
        deliveryFee: 25,
        freeDeliveryOver: 199,
        minOrder: 49,
        searchQuery: '',
        cart: [],
        appliedCoupon: null,
        addresses: [],
        placing: false
    };

    function $(id) {
        return document.getElementById(id);
    }

    function rupee(n) {
        return '₹' + Math.max(0, Math.round(Number(n) || 0));
    }

    function getToken() {
        try {
            return localStorage.getItem(TOKEN_KEY) || '';
        } catch {
            return '';
        }
    }

    function getProfile() {
        try {
            return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
        } catch {
            return null;
        }
    }

    function authHeaders(extra) {
        const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
        const token = getToken();
        if (token) headers.Authorization = 'Bearer ' + token;
        const profile = getProfile();
        if (profile && profile.mobile) headers['x-customer-mobile'] = profile.mobile;
        return headers;
    }

    // ---------- cart persistence ----------

    function loadCart() {
        try {
            const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
            state.cart = Array.isArray(raw) ? raw : [];
        } catch {
            state.cart = [];
        }
    }

    function saveCart() {
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
        } catch {
            /* ignore quota */
        }
    }

    function cartCount() {
        return state.cart.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
    }

    function cartSubtotal() {
        return state.cart.reduce((sum, line) => sum + (Number(line.price) || 0) * (Number(line.quantity) || 0), 0);
    }

    function deliveryFeeFor(subtotal) {
        if (subtotal <= 0) return 0;
        return subtotal >= state.freeDeliveryOver ? 0 : state.deliveryFee;
    }

    // ---------- toast ----------

    let toastTimer = null;
    function toast(message) {
        const el = $('groceryToast');
        if (!el) return;
        el.textContent = message;
        el.hidden = false;
        el.classList.add('is-visible');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            el.classList.remove('is-visible');
            setTimeout(() => {
                el.hidden = true;
            }, 250);
        }, 2200);
    }

    // ---------- mode switching ----------

    function applyMode(mode, options) {
        const grocery = mode === 'grocery';
        document.body.classList.toggle('mode-grocery', grocery);

        const buttons = document.querySelectorAll('#appModeToggle .app-mode-btn');
        buttons.forEach((btn) => {
            const active = btn.getAttribute('data-mode') === (grocery ? 'grocery' : 'food');
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        // Hide grocery tab from bottom nav when not in grocery mode
        const martTab = document.querySelector('.app-tab[data-app-tab="grocery"]');
        if (martTab) {
            if (grocery) {
                martTab.removeAttribute('hidden');
            } else {
                martTab.setAttribute('hidden', '');
            }
        }

        try {
            localStorage.setItem(MODE_KEY, grocery ? 'grocery' : 'food');
        } catch {
            /* ignore */
        }

        if (grocery) {
            const section = $('grocery');
            if (section) section.hidden = false;
            if (!state.loaded && !state.loading) {
                loadStorefront();
            } else {
                updateCartUI();
            }
            if (!options || options.scroll !== false) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } else {
            updateCartUI();
        }

        if (typeof syncTopbarHeight === 'function') {
            requestAnimationFrame(syncTopbarHeight);
        }
    }

    function getSavedMode() {
        try {
            return localStorage.getItem(MODE_KEY) === 'grocery' ? 'grocery' : 'food';
        } catch {
            return 'food';
        }
    }

    function updateGroceryModeAvailability() {
        const toggle = $('appModeToggle');
        const groceryBtn = toggle?.querySelector('[data-mode="grocery"]');
        const hasStores = state.stores.length > 0;
        if (toggle) toggle.hidden = false;
        if (groceryBtn) {
            groceryBtn.hidden = false;
            groceryBtn.classList.toggle('is-unavailable', !hasStores);
            groceryBtn.setAttribute('aria-disabled', hasStores ? 'false' : 'true');
        }
    }

    function initModeToggle() {
        const toggle = $('appModeToggle');
        if (!toggle) return;

        function activate(btn) {
            if (!btn || btn.hidden) return;
            if (btn.classList.contains('is-unavailable')) {
                toast('Grocery is not available yet. Please check back soon.');
                return;
            }
            applyMode(btn.getAttribute('data-mode'));
        }

        toggle.querySelectorAll('.app-mode-btn').forEach((btn) => {
            btn.addEventListener('pointerup', (e) => {
                e.preventDefault();
                e.stopPropagation();
                activate(btn);
            });
        });

        if (typeof syncTopbarHeight === 'function') {
            syncTopbarHeight();
        }
    }

    // ---------- storefront load + render ----------

    async function loadStorefront() {
        state.loading = true;
        const container = $('groceryItemsContainer');
        if (container) {
            container.innerHTML = '<div class="grocery-loading">Loading store…</div>';
        }
        try {
            const res = await fetch('/api/grocery', { headers: { Accept: 'application/json' } });
            const data = await res.json();
            state.stores = Array.isArray(data.stores) ? data.stores : [];
            state.categories = Array.isArray(data.categories) ? data.categories : [];
            state.deliveryFee = Number(data.deliveryFee) || state.deliveryFee;
            state.freeDeliveryOver = Number(data.freeDeliveryOver) || state.freeDeliveryOver;
            state.minOrder = Number(data.minOrder) || state.minOrder;
            state.loaded = true;

            if (state.stores.length && !state.selectedStoreId) {
                state.selectedStoreId = state.stores[0].id;
            }
            // Reconcile cart store with available stores.
            if (state.cart.length) {
                const cartStore = Number(state.cart[0].venueId);
                if (state.stores.some((s) => s.id === cartStore)) {
                    state.selectedStoreId = cartStore;
                }
            }

            renderStoreFilter();
            renderCategories();
            renderProducts();
            updateLiveStatus();
            updateCartUI();
            updateGroceryModeAvailability();
        } catch (err) {
            if (container) {
                container.innerHTML =
                    '<div class="grocery-empty">Could not load the grocery store. Please try again.</div>';
            }
            console.error('grocery load:', err);
        } finally {
            state.loading = false;
        }
    }

    function selectedStore() {
        return state.stores.find((s) => s.id === Number(state.selectedStoreId)) || state.stores[0] || null;
    }

    function updateLiveStatus() {
        const el = $('groceryLiveStatus');
        const store = selectedStore();
        if (!el) return;
        if (!store) {
            el.textContent = '';
            return;
        }
        el.textContent = store.acceptingOrders ? 'Open now' : 'Currently closed';
        el.classList.toggle('is-closed', !store.acceptingOrders);

        const notice = $('groceryStoreClosedNotice');
        if (notice) {
            if (store.acceptingOrders) {
                notice.hidden = true;
            } else {
                notice.hidden = false;
                notice.textContent = `${store.name} is closed right now. You can browse but not order.`;
            }
        }
    }

    function renderStoreFilter() {
        const wrap = $('groceryStoreFilter');
        const list = $('groceryStoreFilterList');
        if (!wrap || !list) return;
        if (state.stores.length <= 1) {
            wrap.hidden = true;
            list.innerHTML = '';
            return;
        }
        wrap.hidden = false;
        list.innerHTML = state.stores
            .map((store) => {
                const active = store.id === Number(state.selectedStoreId);
                return `<button type="button" class="grocery-store-tab${active ? ' is-active' : ''}" data-store-id="${store.id}" role="tab" aria-selected="${active}">${escapeHtml(store.name)}</button>`;
            })
            .join('');
        list.querySelectorAll('.grocery-store-tab').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.selectedStoreId = Number(btn.getAttribute('data-store-id'));
                state.searchQuery = '';
                const search = $('grocerySearchInput');
                if (search) search.value = '';
                renderStoreFilter();
                renderCategories();
                renderProducts();
                updateLiveStatus();
            });
        });
    }

    function categoriesForStore() {
        const storeId = Number(state.selectedStoreId);
        return state.categories.filter((cat) => Number(cat.venueId) === storeId);
    }

    function renderCategories() {
        const tabs = $('groceryCatTabs');
        if (!tabs) return;
        const cats = categoriesForStore();
        if (!cats.length || state.searchQuery) {
            tabs.innerHTML = '';
            tabs.hidden = true;
            return;
        }
        tabs.hidden = false;
        tabs.innerHTML = cats
            .map((cat) => {
                const icon = cat.image
                    ? `<img src="${escapeAttr(cat.image)}" alt="" class="grocery-cat-img" loading="lazy">`
                    : '<span class="grocery-cat-emoji" aria-hidden="true">🛍️</span>';
                return `<button type="button" class="grocery-cat-tab" data-cat-anchor="grocat-${escapeAttr(String(cat.id))}">${icon}<span>${escapeHtml(cat.name)}</span></button>`;
            })
            .join('');
        tabs.querySelectorAll('.grocery-cat-tab').forEach((btn) => {
            btn.addEventListener('click', () => {
                const anchor = document.getElementById(btn.getAttribute('data-cat-anchor'));
                if (anchor) {
                    const top = anchor.getBoundingClientRect().top + window.scrollY - 120;
                    window.scrollTo({ top, behavior: 'smooth' });
                }
            });
        });
    }

    function matchesSearch(product, q) {
        if (!q) return true;
        const text = `${product.name || ''} ${product.sku || ''}`.toLowerCase();
        return text.includes(q);
    }

    function renderProducts() {
        const container = $('groceryItemsContainer');
        if (!container) return;
        const cats = categoriesForStore();
        const q = state.searchQuery.trim().toLowerCase();

        if (!state.stores.length) {
            container.innerHTML = '<div class="grocery-empty">No grocery stores available yet.</div>';
            return;
        }
        if (!cats.length) {
            container.innerHTML = '<div class="grocery-empty">This store has no products yet.</div>';
            return;
        }

        let html = '';
        let totalShown = 0;
        for (const cat of cats) {
            const products = (cat.products || []).filter((p) => matchesSearch(p, q));
            if (!products.length) continue;
            totalShown += products.length;
            html += `<div class="grocery-cat-block" id="grocat-${escapeAttr(String(cat.id))}">`;
            html += `<h3 class="grocery-cat-heading">${escapeHtml(cat.name)}</h3>`;
            html += '<div class="grocery-grid">';
            html += products.map((p) => productCardHtml(p)).join('');
            html += '</div></div>';
        }

        if (!totalShown) {
            container.innerHTML = `<div class="grocery-empty">No products${q ? ` for “${escapeHtml(q)}”` : ''}.</div>`;
            return;
        }
        container.innerHTML = html;
        syncSteppers();
    }

    function unitLabel(product) {
        const value = Number(product.unitValue);
        const unit = product.unit || 'pcs';
        if (!value || value === 1) {
            return unit === 'pcs' ? '1 pc' : `1 ${unit}`;
        }
        return `${value} ${unit}`;
    }

    function productCardHtml(p) {
        const oos = p.outOfStock;
        const inCart = state.cart.find((l) => Number(l.productId) === Number(p.id));
        const qty = inCart ? inCart.quantity : 0;
        const hasMrp = Number(p.mrp) > Number(p.price);
        const off = hasMrp ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
        const img = p.image || PLACEHOLDER;

        const stepper = oos
            ? '<span class="grocery-oos-badge">Out of stock</span>'
            : qty > 0
              ? `<div class="grocery-stepper" data-product-id="${p.id}">
                    <button type="button" class="grocery-step grocery-step--minus" data-grocery-dec="${p.id}" aria-label="Decrease">−</button>
                    <span class="grocery-step-qty" data-grocery-qty="${p.id}">${qty}</span>
                    <button type="button" class="grocery-step grocery-step--plus" data-grocery-inc="${p.id}" aria-label="Increase">+</button>
                 </div>`
              : `<button type="button" class="grocery-add-btn" data-grocery-add="${p.id}">ADD</button>`;

        return `<article class="grocery-card${oos ? ' is-oos' : ''}">
            ${off > 0 ? `<span class="grocery-off-badge">${off}% OFF</span>` : ''}
            <div class="grocery-card-img"><img src="${escapeAttr(img)}" alt="${escapeAttr(p.name)}" loading="lazy"></div>
            <div class="grocery-card-unit">${escapeHtml(unitLabel(p))}</div>
            <h4 class="grocery-card-name">${escapeHtml(p.name)}</h4>
            <div class="grocery-card-foot">
                <div class="grocery-card-price">
                    <span class="grocery-price">${rupee(p.price)}</span>
                    ${hasMrp ? `<span class="grocery-mrp">${rupee(p.mrp)}</span>` : ''}
                </div>
                <div class="grocery-card-action">${stepper}</div>
            </div>
        </article>`;
    }

    function findProduct(productId) {
        const id = Number(productId);
        for (const cat of state.categories) {
            const hit = (cat.products || []).find((p) => Number(p.id) === id);
            if (hit) return hit;
        }
        return null;
    }

    // ---------- cart mutations ----------

    function addToCart(productId) {
        const product = findProduct(productId);
        if (!product) return;
        if (product.outOfStock) {
            toast('Out of stock');
            return;
        }

        if (state.cart.length && Number(state.cart[0].venueId) !== Number(product.venueId)) {
            const ok = window.confirm('Your cart has items from another store. Clear it and start fresh?');
            if (!ok) return;
            state.cart = [];
        }

        const existing = state.cart.find((l) => Number(l.productId) === Number(product.id));
        const maxStock = Number(product.stockQty) || 0;
        if (existing) {
            if (existing.quantity >= maxStock) {
                toast(`Only ${maxStock} available`);
                return;
            }
            existing.quantity += 1;
        } else {
            state.cart.push({
                productId: Number(product.id),
                name: product.name,
                price: Number(product.price) || 0,
                mrp: Number(product.mrp) || 0,
                unit: product.unit || 'pcs',
                unitValue: Number(product.unitValue) || 1,
                image: product.image || PLACEHOLDER,
                quantity: 1,
                venueId: Number(product.venueId),
                venueName: product.venueName || (selectedStore() ? selectedStore().name : ''),
                stockQty: maxStock
            });
        }
        saveCart();
        afterCartChange();
    }

    function decFromCart(productId) {
        const idx = state.cart.findIndex((l) => Number(l.productId) === Number(productId));
        if (idx < 0) return;
        state.cart[idx].quantity -= 1;
        if (state.cart[idx].quantity <= 0) state.cart.splice(idx, 1);
        saveCart();
        afterCartChange();
    }

    function incFromCart(productId) {
        const line = state.cart.find((l) => Number(l.productId) === Number(productId));
        const product = findProduct(productId);
        const maxStock = product ? Number(product.stockQty) || 0 : line ? line.stockQty : 0;
        if (line && line.quantity >= maxStock) {
            toast(`Only ${maxStock} available`);
            return;
        }
        addToCart(productId);
    }

    function afterCartChange() {
        // Coupon may no longer apply once totals change; clear it to force re-validate.
        if (state.appliedCoupon && cartSubtotal() < (state.appliedCoupon.minSubtotal || 0)) {
            state.appliedCoupon = null;
        }
        syncSteppers();
        updateCartUI();
        renderCartModalItems();
        renderTotals();
    }

    function syncSteppers() {
        // Re-render only the action area of each visible card to reflect cart state.
        document.querySelectorAll('.grocery-card').forEach((card) => {
            const addBtn = card.querySelector('[data-grocery-add]');
            const stepper = card.querySelector('.grocery-stepper');
            const id = addBtn
                ? Number(addBtn.getAttribute('data-grocery-add'))
                : stepper
                  ? Number(stepper.getAttribute('data-product-id'))
                  : null;
            if (id == null) return;
            const line = state.cart.find((l) => Number(l.productId) === id);
            const action = card.querySelector('.grocery-card-action');
            if (!action) return;
            const product = findProduct(id);
            if (product && product.outOfStock) {
                action.innerHTML = '<span class="grocery-oos-badge">Out of stock</span>';
                return;
            }
            if (line && line.quantity > 0) {
                action.innerHTML = `<div class="grocery-stepper" data-product-id="${id}">
                    <button type="button" class="grocery-step grocery-step--minus" data-grocery-dec="${id}" aria-label="Decrease">−</button>
                    <span class="grocery-step-qty" data-grocery-qty="${id}">${line.quantity}</span>
                    <button type="button" class="grocery-step grocery-step--plus" data-grocery-inc="${id}" aria-label="Increase">+</button>
                </div>`;
            } else {
                action.innerHTML = `<button type="button" class="grocery-add-btn" data-grocery-add="${id}">ADD</button>`;
            }
        });
    }

    function clearCart() {
        state.cart = [];
        state.appliedCoupon = null;
        saveCart();
        afterCartChange();
    }

    // ---------- cart bar + modal ----------

    function updateCartUI() {
        const bar = $('groceryCartBar');
        if (!bar) return;
        const count = cartCount();
        const inGroceryMode = document.body.classList.contains('mode-grocery');
        if (count > 0 && inGroceryMode) {
            bar.classList.remove('cart-bar--hidden');
            bar.setAttribute('aria-hidden', 'false');
            document.body.classList.add('has-grocery-cart-bar');
        } else {
            bar.classList.add('cart-bar--hidden');
            bar.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('has-grocery-cart-bar');
        }
        const countEl = $('groceryCartBarCount');
        const itemsEl = $('groceryCartBarItems');
        const totalEl = $('groceryCartBarTotal');
        if (countEl) countEl.textContent = String(count);
        if (itemsEl) itemsEl.textContent = `${count} item${count === 1 ? '' : 's'}`;
        if (totalEl) totalEl.textContent = rupee(cartSubtotal());
    }

    function renderCartModalItems() {
        const list = $('groceryCartItems');
        const empty = $('groceryCartEmpty');
        const checkout = $('groceryCheckoutBlock');
        if (!list) return;
        if (!state.cart.length) {
            list.innerHTML = '';
            if (empty) empty.hidden = false;
            if (checkout) checkout.hidden = true;
            return;
        }
        if (empty) empty.hidden = true;
        if (checkout) checkout.hidden = false;
        list.innerHTML = state.cart
            .map(
                (line) => `<div class="grocery-cart-line">
                <img class="grocery-cart-line-img" src="${escapeAttr(line.image || PLACEHOLDER)}" alt="" loading="lazy">
                <div class="grocery-cart-line-info">
                    <span class="grocery-cart-line-name">${escapeHtml(line.name)}</span>
                    <span class="grocery-cart-line-unit">${escapeHtml(unitLabel(line))} · ${rupee(line.price)}</span>
                </div>
                <div class="grocery-stepper grocery-stepper--sm" data-product-id="${line.productId}">
                    <button type="button" class="grocery-step grocery-step--minus" data-grocery-dec="${line.productId}" aria-label="Decrease">−</button>
                    <span class="grocery-step-qty">${line.quantity}</span>
                    <button type="button" class="grocery-step grocery-step--plus" data-grocery-inc="${line.productId}" aria-label="Increase">+</button>
                </div>
                <span class="grocery-cart-line-total">${rupee(line.price * line.quantity)}</span>
            </div>`
            )
            .join('');
    }

    function renderTotals() {
        const subtotal = cartSubtotal();
        const discount = state.appliedCoupon ? Number(state.appliedCoupon.discount) || 0 : 0;
        const delivery = deliveryFeeFor(subtotal);
        const grand = Math.max(0, subtotal - discount) + delivery;

        const subEl = $('grocerySubtotal');
        const discRow = $('groceryDiscountRow');
        const discEl = $('groceryDiscount');
        const feeEl = $('groceryDeliveryFee');
        const feeLabel = $('groceryDeliveryLabel');
        const grandEl = $('groceryGrandTotal');

        if (subEl) subEl.textContent = rupee(subtotal);
        if (discRow) discRow.hidden = discount <= 0;
        if (discEl) discEl.textContent = '-' + rupee(discount);
        if (feeEl) feeEl.textContent = delivery === 0 ? 'FREE' : rupee(delivery);
        if (feeLabel) {
            feeLabel.textContent =
                delivery === 0 ? 'Delivery (free)' : `Delivery (free over ${rupee(state.freeDeliveryOver)})`;
        }
        if (grandEl) grandEl.textContent = rupee(grand);
        return { subtotal, discount, delivery, grand };
    }

    function openCartModal() {
        if (!state.cart.length) {
            toast('Your cart is empty');
            return;
        }
        renderCartModalItems();
        renderTotals();
        populateAddresses();
        const modal = $('groceryCartModal');
        if (modal) {
            modal.classList.add('active');
            modal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeCartModal() {
        const modal = $('groceryCartModal');
        if (modal) {
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
        }
        document.body.style.overflow = '';
    }

    // ---------- addresses + checkout ----------

    async function populateAddresses() {
        const select = $('groceryAddressSelect');
        if (!select) return;
        try {
            const res = await fetch('/api/auth/me', { headers: authHeaders() });
            if (res.ok) {
                const data = await res.json();
                state.addresses = (data.customer && data.customer.addresses) || [];
            }
        } catch {
            state.addresses = [];
        }
        const opts = state.addresses
            .map((a) => {
                const label = `${a.label || 'Address'} — ${a.addressLine || ''}${a.city ? ', ' + a.city : ''}`;
                return `<option value="${a.id}"${a.isDefault ? ' selected' : ''}>${escapeHtml(label)}</option>`;
            })
            .join('');
        select.innerHTML = opts + '<option value="__new__">+ Add a new address</option>';
        toggleNewAddress();
        select.onchange = toggleNewAddress;
    }

    function toggleNewAddress() {
        const select = $('groceryAddressSelect');
        const block = $('groceryNewAddress');
        if (!select || !block) return;
        block.hidden = select.value !== '__new__';
    }

    async function applyCoupon() {
        const input = $('groceryCouponInput');
        const msg = $('groceryCouponMsg');
        if (!input) return;
        const code = input.value.trim();
        if (!code) {
            state.appliedCoupon = null;
            renderTotals();
            return;
        }
        try {
            const res = await fetch('/api/coupons/validate', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ code, subtotal: cartSubtotal() })
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                state.appliedCoupon = { code: data.code, discount: data.discount };
                if (msg) {
                    msg.hidden = false;
                    msg.textContent = data.message || `Coupon applied: -${rupee(data.discount)}`;
                    msg.classList.remove('is-error');
                }
            } else {
                state.appliedCoupon = null;
                if (msg) {
                    msg.hidden = false;
                    msg.textContent = data.error || 'Invalid coupon.';
                    msg.classList.add('is-error');
                }
            }
        } catch {
            state.appliedCoupon = null;
            if (msg) {
                msg.hidden = false;
                msg.textContent = 'Could not validate coupon.';
                msg.classList.add('is-error');
            }
        }
        renderTotals();
    }

    async function placeOrder() {
        if (state.placing) return;
        const errEl = $('groceryCheckoutError');
        const showError = (m) => {
            if (errEl) {
                errEl.hidden = false;
                errEl.textContent = m;
            }
        };
        if (errEl) errEl.hidden = true;

        if (!state.cart.length) {
            showError('Your cart is empty.');
            return;
        }
        const store = selectedStore() || { acceptingOrders: true };
        if (store && store.acceptingOrders === false) {
            showError('This store is currently closed.');
            return;
        }
        if (!getToken() && !(getProfile() && getProfile().mobile)) {
            window.location.href = '/login';
            return;
        }

        const totals = renderTotals();
        if (totals.subtotal < state.minOrder) {
            showError(`Minimum grocery order is ${rupee(state.minOrder)}.`);
            return;
        }

        const select = $('groceryAddressSelect');
        const payload = {
            storeId: Number(state.cart[0].venueId),
            items: state.cart.map((l) => ({ productId: l.productId, quantity: l.quantity, name: l.name })),
            total: totals.grand,
            couponCode: state.appliedCoupon ? state.appliedCoupon.code : ''
        };

        if (select && select.value === '__new__') {
            const line = ($('groceryAddressLine') && $('groceryAddressLine').value.trim()) || '';
            const city = ($('groceryAddressCity') && $('groceryAddressCity').value.trim()) || '';
            if (!line) {
                showError('Please enter a delivery address.');
                return;
            }
            payload.address = { label: 'Delivery', addressLine: line, city };
        } else if (select && select.value) {
            payload.addressId = select.value;
        } else {
            showError('Please choose a delivery address.');
            return;
        }

        state.placing = true;
        const btn = $('groceryPlaceOrderBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Placing…';
        }

        try {
            const res = await fetch('/api/grocery/order', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                showError(data.error || 'Could not place order.');
                // Stock may have changed — refresh the storefront.
                if (res.status === 409) loadStorefront();
                return;
            }
            clearCart();
            closeCartModal();
            toast(`Order #${data.orderId} placed! ${data.venueName || ''}`.trim());
            // Refresh stock counts after a successful order.
            loadStorefront();
        } catch {
            showError('Network error. Please try again.');
        } finally {
            state.placing = false;
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Place order';
            }
        }
    }

    // ---------- search ----------

    function initSearch() {
        const input = $('grocerySearchInput');
        const clear = $('grocerySearchClear');
        if (!input) return;
        let t = null;
        input.addEventListener('input', () => {
            if (clear) clear.style.display = input.value ? 'flex' : 'none';
            if (t) clearTimeout(t);
            t = setTimeout(() => {
                state.searchQuery = input.value;
                renderCategories();
                renderProducts();
            }, 200);
        });
        if (clear) {
            clear.addEventListener('click', () => {
                input.value = '';
                clear.style.display = 'none';
                state.searchQuery = '';
                renderCategories();
                renderProducts();
                input.focus();
            });
        }
    }

    // ---------- global click delegation ----------

    function initDelegation() {
        document.addEventListener('click', (e) => {
            const add = e.target.closest('[data-grocery-add]');
            if (add) {
                addToCart(add.getAttribute('data-grocery-add'));
                return;
            }
            const inc = e.target.closest('[data-grocery-inc]');
            if (inc) {
                incFromCart(inc.getAttribute('data-grocery-inc'));
                return;
            }
            const dec = e.target.closest('[data-grocery-dec]');
            if (dec) {
                decFromCart(dec.getAttribute('data-grocery-dec'));
                return;
            }
            if (e.target.closest('[data-grocery-close]')) {
                closeCartModal();
                return;
            }
        });

        const bar = $('groceryCartBar');
        if (bar) bar.addEventListener('click', openCartModal);

        const couponBtn = $('groceryCouponBtn');
        if (couponBtn) couponBtn.addEventListener('click', applyCoupon);

        const placeBtn = $('groceryPlaceOrderBtn');
        if (placeBtn) placeBtn.addEventListener('click', placeOrder);
    }

    // ---------- utils ----------

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(value) {
        return escapeHtml(value);
    }

    // ---------- boot ----------

    async function probeGroceryStores() {
        try {
            const res = await fetch('/api/grocery', { headers: { Accept: 'application/json' } });
            if (!res.ok) return;
            const data = await res.json();
            state.stores = Array.isArray(data.stores) ? data.stores : [];
            updateGroceryModeAvailability();
        } catch {
            updateGroceryModeAvailability();
        }
    }

    function init() {
        loadCart();
        initModeToggle();
        initSearch();
        initDelegation();
        // Make the grocery section CSS-controlled (remove the static hidden attr).
        const section = $('grocery');
        if (section) section.hidden = false;
        probeGroceryStores().finally(() => {
            const hash = window.location.hash;
            const mode = (hash === '#grocery' && state.stores.length) ? 'grocery' : 'food';
            applyMode(mode, { scroll: false });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // Expose for external tab routing
    window.groceryApp = { applyMode };
})();
