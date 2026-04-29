'use strict';

const SESSION_STORAGE_KEY = 'balojiCustomerToken';
const CUSTOMER_PROFILE_KEY = 'balojiCustomerProfile';
const PUSH_SUBSCRIBED_KEY = 'balojiPushSubscribed';

function getCustomerToken() {
    return localStorage.getItem(SESSION_STORAGE_KEY);
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

document.addEventListener('DOMContentLoaded', () => {
    initPushNotifications().catch(() => ({}));
});

