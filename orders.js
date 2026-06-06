'use strict';

const SESSION_STORAGE_KEY = 'balojiCustomerToken';
const CUSTOMER_PROFILE_KEY = 'balojiCustomerProfile';
function getCustomerToken() {
    return localStorage.getItem(SESSION_STORAGE_KEY);
}

function setCustomerToken(token) {
    if (token) localStorage.setItem(SESSION_STORAGE_KEY, token);
    else localStorage.removeItem(SESSION_STORAGE_KEY);
}

function getCustomerProfile() {
    try {
        const raw = localStorage.getItem(CUSTOMER_PROFILE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function setCustomerProfile(profile) {
    if (profile && typeof profile === 'object') {
        localStorage.setItem(CUSTOMER_PROFILE_KEY, JSON.stringify(profile));
    } else {
        localStorage.removeItem(CUSTOMER_PROFILE_KEY);
    }
}

function formatOrderStatus(status) {
    const map = {
        pending: 'Waiting for restaurant',
        accepted: 'Order accepted',
        rejected: 'Order declined',
        cancelled: 'You cancelled this order',
        preparing: 'Preparing your order',
        out_for_delivery: 'Out for delivery',
        completed: 'Order completed'
    };
    return map[status] || status;
}

/** order id (string) → last seen normalized status (for detecting transitions to completed) */
let lastOrderStatusById = new Map();

function maybePromptGoogleReviewAfterOrdersRender(orders) {
    if (!orders || !orders.length) return;
    const newlyCompleted = [];
    for (const o of orders) {
        const id = String(o.id);
        const st = String(o.status || '')
            .trim()
            .toLowerCase();
        const prev = lastOrderStatusById.get(id);
        if (st === 'completed' && prev !== undefined && prev !== 'completed') {
            newlyCompleted.push(o);
        }
    }
    for (const o of orders) {
        lastOrderStatusById.set(
            String(o.id),
            String(o.status || '')
                .trim()
                .toLowerCase()
        );
    }
    const idsNow = new Set(orders.map((o) => String(o.id)));
    for (const key of [...lastOrderStatusById.keys()]) {
        if (!idsNow.has(key)) lastOrderStatusById.delete(key);
    }
    if (newlyCompleted.length > 0 && window.GoogleReviewPrompt) {
        const o = newlyCompleted[0];
        window.GoogleReviewPrompt.markPending({ orderId: o.id, completedAt: Date.now() });
    }
}

function normalizeOrderItems(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        } catch {
            return [];
        }
    }
    return [];
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function formatFriendlyPlacedAt(iso) {
    if (!iso) return 'Recent order';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return 'Recent order';
    const diffMs = Date.now() - d.getTime();
    const diffM = Math.floor(diffMs / 60000);
    if (diffM < 1) return 'Placed just now';
    if (diffM < 60) return `Placed ${diffM} min ago`;
    return d.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function normalizeMyOrder(o) {
    if (!o || typeof o !== 'object') return o;
    const status = String(o.status ?? '')
        .trim()
        .toLowerCase();
    const created_at = o.created_at ?? o.createdAt ?? null;
    const updated_at = o.updated_at ?? o.updatedAt ?? null;
    return { ...o, status, created_at, updated_at };
}

function normalizeMyOrders(orders) {
    return (orders || []).map(normalizeMyOrder);
}

function showOrdersLoadingState() {
    const list = document.getElementById('ordersList');
    if (!list) return;
    list.setAttribute('aria-busy', 'true');
    list.innerHTML = `<div class="orders-loading" role="status">
        <span class="visually-hidden">Loading your orders…</span>
        <div class="orders-skeleton-stack" aria-hidden="true">
            ${Array.from({ length: 4 }, () => '<div class="orders-skeleton-card"></div>').join('')}
        </div>
    </div>`;
}

function renderMyOrders(orders) {
    const list = document.getElementById('ordersList');
    if (!list) return;

    list.removeAttribute('aria-busy');

    if (!orders || orders.length === 0) {
        lastOrderStatusById.clear();
        list.innerHTML = `
            <div class="my-orders-empty">
                <div class="my-orders-empty-visual" aria-hidden="true">
                    <svg class="my-orders-empty-icon" xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 11V6a3 3 0 0 1 6 0v5"/><rect x="5" y="11" width="14" height="10" rx="2"/></svg>
                </div>
                <p class="my-orders-empty-title">No orders yet</p>
                <p class="my-orders-empty-text">Pick something from the menu—we’ll show progress here after you check out.</p>
                <a href="/menu" class="btn btn-primary my-orders-empty-cta">Browse menu</a>
            </div>`;
        return;
    }

    list.innerHTML = orders
        .map((order) => {
            const items = normalizeOrderItems(order.items);
            const lines = items
                .map((row) => {
                    const lineTotal = row.price * row.quantity;
                    return `<li class="my-order-item">
                        <span class="my-order-item-name">${escapeHtml(row.name)}</span>
                        <span class="my-order-item-meta"><span class="my-order-item-qty">×${escapeHtml(String(row.quantity))}</span><span class="my-order-item-price">₹${lineTotal}</span></span>
                    </li>`;
                })
                .join('');
            const createdRaw = order.created_at ?? order.createdAt;
            const placedDtIso =
                createdRaw && Number.isFinite(new Date(createdRaw).getTime())
                    ? new Date(createdRaw).toISOString()
                    : '';
            const placedLabel = formatFriendlyPlacedAt(createdRaw);
            const status = order.status || '';

            return `
                <article class="my-order-card my-order-card--${escapeHtml(status)}">
                    <div class="my-order-card-inner">
                        <header class="my-order-card-top">
                            <span class="my-order-status my-order-status--${escapeHtml(status)}">${escapeHtml(formatOrderStatus(status))}</span>
                            <time class="my-order-placed"${placedDtIso ? ` datetime="${escapeHtml(placedDtIso)}"` : ''}>${escapeHtml(placedLabel)}</time>
                        </header>
                        <div class="my-order-items-block">
                            <p class="my-order-items-heading">Items</p>
                            <ul class="my-order-items-list">${lines}</ul>
                        </div>
                        <div class="my-order-total-row">
                            <span class="my-order-total-label">Total</span>
                            <span class="my-order-total-amt">₹${Number(order.total) || 0}</span>
                        </div>
                    </div>
                </article>
            `;
        })
        .join('');

    maybePromptGoogleReviewAfterOrdersRender(orders);
}

async function restoreSession() {
    const token = getCustomerToken();
    if (!token) return false;

    try {
        const res = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
            setCustomerToken(null);
            setCustomerProfile(null);
            return false;
        }

        const data = await res.json();
        setCustomerProfile(data.customer || null);
        return true;
    } catch {
        return false;
    }
}

async function fetchMyOrders() {
    const token = getCustomerToken();
    const profile = getCustomerProfile();
    if (!token && !profile?.mobile) return;

    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (profile?.mobile) headers['x-customer-mobile'] = String(profile.mobile);

    try {
        const res = await fetch('/api/orders/my', { headers });
        if (!res.ok) return;
        const data = await res.json();
        renderMyOrders(normalizeMyOrders(data.orders || []));
    } catch {
        const list = document.getElementById('ordersList');
        if (!list) return;
        list.removeAttribute('aria-busy');
        list.innerHTML =
            '<p class="my-orders-placeholder">Could not load your orders right now. Please try again.</p>';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    showOrdersLoadingState();

    const restored = await restoreSession();
    if (!restored) {
        window.location.replace('/login');
        return;
    }

    const refreshBtn = document.getElementById('refreshOrdersBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            if (refreshBtn.dataset.loading === '1') return;
            refreshBtn.dataset.loading = '1';
            refreshBtn.classList.add('is-refreshing');
            const original = refreshBtn.dataset.label || refreshBtn.textContent;
            refreshBtn.dataset.label = original;
            refreshBtn.textContent = 'Refreshing…';
            try {
                await fetchMyOrders();
            } finally {
                refreshBtn.dataset.loading = '0';
                refreshBtn.classList.remove('is-refreshing');
                refreshBtn.textContent = original;
            }
        });
    }

    fetchMyOrders();
});
