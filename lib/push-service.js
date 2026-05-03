'use strict';

const webpush = require('web-push');
const { query } = require('./db');

const PUSH_DEBUG = (() => {
    const v = process.env.PUSH_DEBUG;
    if (!v) return false;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
})();

function getEnv(name) {
    const v = process.env[name];
    return typeof v === 'string' && v.trim() ? v.trim() : '';
}

function getVapidSubject() {
    return (
        getEnv('VAPID_SUBJECT') ||
        getEnv('ORDER_FROM_EMAIL') ||
        'mailto:push@baloji-cafe.local'
    );
}

function urlSafeBase64ToUint8Array(base64String) {
    // Convert from base64url -> base64 -> Uint8Array
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = Buffer.from(base64, 'base64');
    return new Uint8Array(raw);
}

function assertVapidConfigured() {
    const publicKey = getEnv('VAPID_PUBLIC_KEY');
    const privateKey = getEnv('VAPID_PRIVATE_KEY');
    if (!publicKey || !privateKey) {
        const err = new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set to send push notifications.');
        err.statusCode = 500;
        throw err;
    }
    return { publicKey, privateKey, subject: getVapidSubject() };
}

async function upsertPushSubscription(customerMobile, subscription) {
    if (!customerMobile) throw Object.assign(new Error('Customer mobile is required'), { statusCode: 400 });
    if (!subscription || typeof subscription !== 'object') {
        throw Object.assign(new Error('Subscription is required'), { statusCode: 400 });
    }

    const endpoint = subscription.endpoint;
    const keys = subscription.keys || {};
    const p256dh = keys.p256dh;
    const auth = keys.auth;

    if (!endpoint || !p256dh || !auth) {
        throw Object.assign(new Error('Invalid subscription payload'), { statusCode: 400 });
    }

    // Store the full subscription payload so we can send directly later.
    // web-push needs endpoint + keys.{p256dh,auth}.
    if (PUSH_DEBUG) {
        console.log('[push] upsert subscription', {
            customerMobile,
            endpoint: String(endpoint).slice(0, 60) + '…'
        });
    }
    await query(
        `INSERT INTO push_subscriptions (customer_mobile, endpoint, subscription)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (endpoint) DO UPDATE SET
            customer_mobile = EXCLUDED.customer_mobile,
            subscription = EXCLUDED.subscription,
            updated_at = NOW()`,
        [customerMobile, endpoint, subscription]
    );
}

async function listPushSubscriptionsForCustomer(customerMobile) {
    const { rows } = await query(
        `SELECT subscription
         FROM push_subscriptions
         WHERE customer_mobile = $1`,
        [customerMobile]
    );
    return rows.map((r) => r.subscription);
}

function getNotificationContentForOrder(order) {
    const status = order.status || 'pending';
    const labelMap = {
        pending: 'Waiting for restaurant',
        accepted: 'Order accepted',
        rejected: 'Order declined',
        preparing: 'Preparing your order',
        out_for_delivery: 'Out for delivery',
        completed: 'Order completed'
    };
    const line = labelMap[status] || status;

    const orderId = order.id;
    return {
        title: 'Baloji\'s Cafe',
        body: `Order #${orderId}: ${line}`,
        data: {
            url: '/orders',
            orderId: String(orderId),
            status: String(status)
        },
        tag: `order-${orderId}`
    };
}

async function sendPushToSubscriptions(subscriptions, payload) {
    const { publicKey, privateKey, subject } = assertVapidConfigured();
    webpush.setVapidDetails(subject, publicKey, privateKey);

    // Iterate sequentially to keep load predictable for small scale.
    let sent = 0;
    for (const subscription of subscriptions) {
        if (!subscription || !subscription.endpoint) continue;
        try {
            await webpush.sendNotification(subscription, payload);
            sent += 1;
        } catch (err) {
            const statusCode = err && (err.statusCode || err.status || err.code);
            // 410 = gone, 404 = not found: subscription is dead -> delete.
            if (PUSH_DEBUG) {
                console.error('[push] send failed', {
                    customerSubscriptionEndpoint: String(subscription.endpoint).slice(0, 60) + '…',
                    statusCode: statusCode || null,
                    message: err && err.message ? err.message : String(err)
                });
            }
            if (statusCode === 410 || statusCode === 404) {
                if (subscription && subscription.endpoint) {
                    await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [subscription.endpoint]);
                }
            }
        }
    }
    return sent;
}

async function notifyCustomerOfOrderStatus({ customerMobile, order }) {
    if (!customerMobile || !order) return { sent: 0 };
    const subscriptions = await listPushSubscriptionsForCustomer(customerMobile);
    if (!subscriptions.length) return { sent: 0, skipped: true };

    if (PUSH_DEBUG) {
        console.log('[push] notifying customer', {
            customerMobile,
            orderId: order.id,
            status: order.status,
            subscriptions: subscriptions.length
        });
    }
    const content = getNotificationContentForOrder(order);
    const payload = JSON.stringify({
        title: content.title,
        body: content.body,
        tag: content.tag,
        data: content.data
    });

    return { sent: await sendPushToSubscriptions(subscriptions, payload) };
}

module.exports = {
    upsertPushSubscription,
    notifyCustomerOfOrderStatus
};

