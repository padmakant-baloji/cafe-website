'use strict';

const SESSION_STORAGE_KEY = 'balojiCustomerToken';
const CUSTOMER_PROFILE_KEY = 'balojiCustomerProfile';
const PUSH_SUBSCRIBED_KEY = 'balojiPushSubscribed';

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
        preparing: 'Preparing your order',
        out_for_delivery: 'Out for delivery',
        completed: 'Order completed'
    };
    return map[status] || status;
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

function urlBase64ToUint8Array(base64String) {
    // base64url -> base64 -> binary -> Uint8Array
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function initPushNotifications() {
    const token = getCustomerToken();
    const profile = getCustomerProfile();
    const customerMobile = profile && profile.mobile ? String(profile.mobile) : '';

    if (!token || !customerMobile) return;
    if (localStorage.getItem(PUSH_SUBSCRIBED_KEY) === '1') return;

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!('Notification' in window)) return;

    if (Notification.permission !== 'granted') {
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return;
        } catch {
            return;
        }
    }

    const registration = await navigator.serviceWorker.register('/sw.js');
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
        const keyRes = await fetch('/api/push/vapid-public-key');
        const keyData = await keyRes.json().catch(() => ({}));
        if (!keyRes.ok || !keyData.publicKey) return;

        const applicationServerKey = urlBase64ToUint8Array(keyData.publicKey);
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey
        });
    }

    await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ subscription })
    });

    localStorage.setItem(PUSH_SUBSCRIBED_KEY, '1');
}

function renderMyOrders(orders) {
    const list = document.getElementById('ordersList');
    if (!list) return;

    if (!orders || orders.length === 0) {
        list.innerHTML =
            '<p class="my-orders-placeholder">Your orders will appear here after you place one.</p>';
        return;
    }

    list.innerHTML = orders
        .map((order) => {
            const items = normalizeOrderItems(order.items);
            const lines = items
                .map(
                    (row) =>
                        `<div class="my-order-line">${escapeHtml(row.name)} × ${row.quantity} · ₹${row.price * row.quantity}</div>`
                )
                .join('');
            const when = order.created_at ? new Date(order.created_at).toLocaleString() : '';
            const status = order.status || '';

            return `
                <div class="my-order-card my-order-card--${escapeHtml(status)}">
                    <div class="my-order-top">
                        <span class="my-order-id">#${escapeHtml(order.id)}</span>
                        <span class="my-order-status my-order-status--${escapeHtml(status)}">${escapeHtml(formatOrderStatus(status))}</span>
                    </div>
                    <div class="my-order-meta">${escapeHtml(when)}</div>
                    <div class="my-order-items">${lines}</div>
                    <div class="my-order-total">₹${Number(order.total) || 0}</div>
                </div>
            `;
        })
        .join('');
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
        renderMyOrders(data.orders || []);
    } catch {
        const list = document.getElementById('ordersList');
        if (!list) return;
        list.innerHTML =
            '<p class="my-orders-placeholder">Could not load your orders right now. Please try again.</p>';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const restored = await restoreSession();
    if (!restored) {
        window.location.replace('/login');
        return;
    }

    await initPushNotifications();
    fetchMyOrders();
    setInterval(fetchMyOrders, 3000);
});
