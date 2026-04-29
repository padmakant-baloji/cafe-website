'use strict';

const SESSION_STORAGE_SEEN = 'balojiAdminSeenPendingIds';
const SESSION_STORAGE_LAST_ORDER = 'balojiAdminLastOrderId';
const ringingOrderIds = new Set();
let ringingTimer = null;
let audioCtx = null;
let audioUnlocked = false;

function adminHeaders() {
    const user = 'balojicafe';
    const pass = 'admin';
    const token = btoa(`${user}:${pass}`);
    return {
        Authorization: `Basic ${token}`,
        Accept: 'application/json'
    };
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
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data.order;
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

function renderOrders(orders, container) {
    if (!orders.length) {
        container.innerHTML = '<p class="admin-empty">No orders yet.</p>';
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

function playNewOrderAlert() {
    try {
        const ctx = getAudioContext();
        if (!ctx || !audioUnlocked || ctx.state !== 'running') return;
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 0.02);
        master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.45);
        master.connect(ctx.destination);

        const makeTone = (freq, start, duration, type = 'sawtooth') => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, start);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.42, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
            osc.connect(gain);
            gain.connect(master);
            osc.start(start);
            osc.stop(start + duration + 0.02);
        };

        const t = ctx.currentTime;
        // Loud "ring ring" style cadence.
        makeTone(660, t, 0.22, 'square');
        makeTone(880, t, 0.22, 'triangle');
        makeTone(660, t + 0.12, 0.18, 'square');
        makeTone(990, t + 0.12, 0.18, 'triangle');

        makeTone(660, t + 0.52, 0.22, 'square');
        makeTone(880, t + 0.52, 0.22, 'triangle');
        makeTone(660, t + 0.64, 0.18, 'square');
        makeTone(990, t + 0.64, 0.18, 'triangle');

        makeTone(660, t + 1.02, 0.22, 'square');
        makeTone(880, t + 1.02, 0.22, 'triangle');
        makeTone(660, t + 1.14, 0.18, 'square');
        makeTone(990, t + 1.14, 0.18, 'triangle');
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
    btn.textContent = audioUnlocked ? 'Sound enabled' : 'Enable sound';
}

document.addEventListener('DOMContentLoaded', () => {
    const listEl = document.getElementById('adminOrderList');
    const banner = document.getElementById('adminNotifyBanner');
    const refreshBtn = document.getElementById('adminRefreshBtn');

    if (typeof Notification !== 'undefined' && Notification.permission === 'default' && banner) {
        banner.hidden = false;
        banner.querySelector('button')?.addEventListener('click', () => {
            Notification.requestPermission().then(() => {
                banner.hidden = true;
            });
        });
    }

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

    updateSoundButtonState();

    async function refresh() {
        try {
            const orders = await fetchOrders();
            renderOrders(orders, listEl);
            const pendingSet = new Set(
                orders.filter((o) => o.status === 'pending').map((o) => String(o.id))
            );

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
                }
            }
        } catch (e) {
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
            alert(err.message || 'Update failed');
        } finally {
            btn.disabled = false;
        }
    });

    if (refreshBtn) refreshBtn.addEventListener('click', () => refresh());

    refresh();
    setInterval(refresh, 2500);
});
