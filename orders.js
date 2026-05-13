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

/** Same 1-minute window as the API: pending (from created_at) or accepted (from updated_at). */
const CUSTOMER_CANCEL_MS = 1 * 60 * 1000;

function customerCancelCanSubmit(order) {
    const st = String(order?.status ?? '')
        .trim()
        .toLowerCase();
    if (st === 'pending') {
        const raw = order.created_at ?? order.createdAt;
        if (!raw) return true;
        const t = new Date(raw).getTime();
        if (!Number.isFinite(t)) return true;
        return Date.now() - t < CUSTOMER_CANCEL_MS;
    }
    if (st === 'accepted') {
        const raw = order.updated_at ?? order.updatedAt;
        if (!raw) return true;
        const t = new Date(raw).getTime();
        if (!Number.isFinite(t)) return true;
        return Date.now() - t < CUSTOMER_CANCEL_MS;
    }
    return false;
}

function cancelDeadlineMs(order) {
    const st = String(order?.status ?? '')
        .trim()
        .toLowerCase();
    if (st === 'accepted') {
        const raw = order.updated_at ?? order.updatedAt;
        if (!raw) return Date.now() + CUSTOMER_CANCEL_MS;
        const t = new Date(raw).getTime();
        if (!Number.isFinite(t)) return Date.now() + CUSTOMER_CANCEL_MS;
        return t + CUSTOMER_CANCEL_MS;
    }
    const raw = order?.created_at ?? order?.createdAt;
    if (!raw) return Date.now() + CUSTOMER_CANCEL_MS;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) return Date.now() + CUSTOMER_CANCEL_MS;
    return t + CUSTOMER_CANCEL_MS;
}

function formatCancelTimeLabel(msLeft) {
    const s = Math.max(0, Math.ceil(msLeft / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}

const ACTIVE_ORDER_STATUSES = new Set(['pending', 'accepted', 'preparing', 'out_for_delivery']);

/** Seconds from local midnight; same as menu page, used so “before 2 PM” is strictly before 14:00:00. */
function getLocalSecondsFromMidnight(d) {
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/**
 * @param {number | Date} placedAt
 * @returns {{ deadlineMs: number, arrivalLabel: string, hint: string }}
 */
function getOrderArrivalPlan(placedAt) {
    const placed = placedAt instanceof Date ? placedAt : new Date(Number(placedAt) || Date.now());
    const sec = getLocalSecondsFromMidnight(placed);
    const twoPmSec = 14 * 3600;
    if (sec < twoPmSec) {
        const deadline = new Date(placed);
        deadline.setHours(14, 40, 0, 0);
        const arrivalLabel = deadline.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        return {
            deadlineMs: deadline.getTime(),
            arrivalLabel,
            hint: 'We open at 2 PM — first deliveries roll out then.'
        };
    }
    const deadlineMs = placed.getTime() + 30 * 60 * 1000;
    const arrivalLabel = new Date(deadlineMs).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
    return {
        deadlineMs,
        arrivalLabel,
        hint: 'Usually within about 30 minutes from when you placed this order.'
    };
}

function formatTimeUntilArrival(deadlineMs) {
    const ms = deadlineMs - Date.now();
    if (ms <= 0) return 'Any moment now';
    const sTotal = Math.floor(ms / 1000);
    const h = Math.floor(sTotal / 3600);
    const m = Math.floor((sTotal % 3600) / 60);
    const s = sTotal % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

let ordersCancelTickTimer = null;
let ordersArrivalTickTimer = null;

function scheduleOrdersCancelTick() {
    clearInterval(ordersCancelTickTimer);
    ordersCancelTickTimer = null;
    const list = document.getElementById('ordersList');
    if (!list || !list.querySelector('[data-cancel-deadline]')) return;

    ordersCancelTickTimer = setInterval(() => {
        const wraps = list.querySelectorAll('[data-cancel-deadline]');
        if (!wraps.length) {
            clearInterval(ordersCancelTickTimer);
            ordersCancelTickTimer = null;
            return;
        }
        let expired = false;
        wraps.forEach((wrap) => {
            const end = parseInt(wrap.dataset.cancelDeadline, 10);
            const ttl = wrap.querySelector('.my-order-cancel-note');
            const kind = wrap.dataset.cancelKind || 'pending';
            const left = end - Date.now();
            if (left <= 0) expired = true;
            else if (ttl) {
                ttl.textContent =
                    kind === 'accepted'
                        ? `Cancel within ${formatCancelTimeLabel(left)} after accept`
                        : `Cancel within ${formatCancelTimeLabel(left)}`;
            }
        });
        if (expired) fetchMyOrders();
    }, 1000);
}

function tickOrdersArrivalCountdowns() {
    const list = document.getElementById('ordersList');
    if (!list) return;
    const blocks = list.querySelectorAll('[data-arrival-deadline]');
    if (!blocks.length) {
        clearInterval(ordersArrivalTickTimer);
        ordersArrivalTickTimer = null;
        return;
    }
    blocks.forEach((block) => {
        const end = parseInt(block.dataset.arrivalDeadline, 10);
        if (!Number.isFinite(end)) return;
        const countdownEl = block.querySelector('.my-order-arrival-countdown');
        if (countdownEl) countdownEl.textContent = formatTimeUntilArrival(end);
    });
}

function scheduleOrdersArrivalTick() {
    clearInterval(ordersArrivalTickTimer);
    ordersArrivalTickTimer = null;
    const list = document.getElementById('ordersList');
    if (!list || !list.querySelector('[data-arrival-deadline]')) return;
    tickOrdersArrivalCountdowns();
    ordersArrivalTickTimer = setInterval(tickOrdersArrivalCountdowns, 1000);
}

async function cancelOrderRequest(orderId) {
    const token = getCustomerToken();
    const profile = getCustomerProfile();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (profile?.mobile) headers['x-customer-mobile'] = String(profile.mobile);

    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        headers
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not cancel order.');
    return data.order;
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
            const stLower = String(status).trim().toLowerCase();
            const canSubmitCancel = customerCancelCanSubmit(order);
            const deadline = cancelDeadlineMs(order);
            const cancelKind = stLower === 'accepted' ? 'accepted' : 'pending';
            const cancelHintDisplay =
                cancelKind === 'accepted'
                    ? `Cancel within ${formatCancelTimeLabel(Math.max(0, deadline - Date.now()))} after accept`
                    : `Cancel within ${formatCancelTimeLabel(Math.max(0, deadline - Date.now()))}`;
            const cancelBlock = canSubmitCancel
                ? `<div class="my-order-cancel" data-cancel-kind="${cancelKind}" data-cancel-deadline="${deadline}">
                        <p class="my-order-cancel-note">${escapeHtml(cancelHintDisplay)}</p>
                        <button type="button" class="btn btn-cancel-order" data-cancel-order-id="${escapeHtml(String(order.id))}">Cancel order</button>
                    </div>`
                : '';

            let arrivalBlock = '';
            if (ACTIVE_ORDER_STATUSES.has(stLower) && createdRaw) {
                const placedMs = new Date(createdRaw).getTime();
                if (Number.isFinite(placedMs)) {
                    const plan = getOrderArrivalPlan(placedMs);
                    arrivalBlock = `
                        <div class="my-order-arrival" data-arrival-deadline="${plan.deadlineMs}">
                            <div class="my-order-arrival-head">
                                <span class="my-order-arrival-label">Estimated arrival</span>
                                <span class="my-order-arrival-time">${escapeHtml(plan.arrivalLabel)}</span>
                            </div>
                            <div class="my-order-arrival-count">
                                <span class="my-order-arrival-count-label">Your order arrives in</span>
                                <strong class="my-order-arrival-countdown" aria-live="polite">${escapeHtml(formatTimeUntilArrival(plan.deadlineMs))}</strong>
                            </div>
                            <p class="my-order-arrival-hint">${escapeHtml(plan.hint)}</p>
                        </div>`;
                }
            }

            return `
                <article class="my-order-card my-order-card--${escapeHtml(status)}">
                    <div class="my-order-card-inner">
                        <header class="my-order-card-top">
                            <span class="my-order-status my-order-status--${escapeHtml(status)}">${escapeHtml(formatOrderStatus(status))}</span>
                            <time class="my-order-placed"${placedDtIso ? ` datetime="${escapeHtml(placedDtIso)}"` : ''}>${escapeHtml(placedLabel)}</time>
                        </header>
                        ${arrivalBlock}
                        <div class="my-order-items-block">
                            <p class="my-order-items-heading">Items</p>
                            <ul class="my-order-items-list">${lines}</ul>
                        </div>
                        <div class="my-order-total-row">
                            <span class="my-order-total-label">Total</span>
                            <span class="my-order-total-amt">₹${Number(order.total) || 0}</span>
                        </div>
                        ${cancelBlock}
                    </div>
                </article>
            `;
        })
        .join('');

    scheduleOrdersCancelTick();
    scheduleOrdersArrivalTick();
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

    const listEl = document.getElementById('ordersList');
    listEl?.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-cancel-order-id]');
        if (!btn) return;
        const id = btn.getAttribute('data-cancel-order-id');
        if (!id) return;
        if (
            !window.confirm(
                'Cancel this order? You can place a new order from the menu anytime.'
            )
        ) {
            return;
        }
        btn.disabled = true;
        try {
            await cancelOrderRequest(id);
            await fetchMyOrders();
        } catch (err) {
            alert(err && err.message ? err.message : 'Could not cancel order.');
            btn.disabled = false;
        }
    });

    fetchMyOrders();
    setInterval(fetchMyOrders, 3000);
});
