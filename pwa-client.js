'use strict';

let deferredPromptEvent = null;

function getInstallBannerElements() {
    const banner = document.getElementById('pwaInstallBanner');
    const installBtn = document.getElementById('pwaInstallBtn');
    const dismissBtn = document.getElementById('pwaInstallDismissBtn');
    return { banner, installBtn, dismissBtn };
}

function hideBanner() {
    const { banner } = getInstallBannerElements();
    if (banner) banner.hidden = true;
}

function showBanner() {
    const { banner } = getInstallBannerElements();
    if (banner) banner.hidden = false;
}

async function ensureServiceWorkerRegistered() {
    if (!('serviceWorker' in navigator)) return;
    try {
        await navigator.serviceWorker.register('/sw.js');
    } catch {
        // ignore; banner still works for browsers that fire beforeinstallprompt regardless
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await ensureServiceWorkerRegistered();

    if (!('BeforeInstallPromptEvent' in window) && !('onbeforeinstallprompt' in window)) {
        return;
    }

    const dismissedKey = 'quickkartPwaInstallDismissed';
    if (localStorage.getItem(dismissedKey) === '1') {
        hideBanner();
        return;
    }

    window.addEventListener('beforeinstallprompt', (event) => {
        // Prevent the mini-infobar from appearing on mobile.
        event.preventDefault();
        deferredPromptEvent = event;
        showBanner();
    });

    window.addEventListener('appinstalled', () => {
        localStorage.setItem(dismissedKey, '1');
        hideBanner();
    });

    const { installBtn, dismissBtn } = getInstallBannerElements();

    installBtn?.addEventListener('click', async () => {
        if (!deferredPromptEvent) return;
        try {
            deferredPromptEvent.prompt();
            const choice = await deferredPromptEvent.userChoice;
            if (choice && choice.outcome) {
                localStorage.setItem(dismissedKey, '1');
            }
        } catch {
            // ignore
        } finally {
            deferredPromptEvent = null;
            hideBanner();
        }
    });

    dismissBtn?.addEventListener('click', () => {
        localStorage.setItem(dismissedKey, '1');
        deferredPromptEvent = null;
        hideBanner();
    });
});

