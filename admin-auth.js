'use strict';

/** Signed admin session token — shared across /admin and /admin/tables. */
const ADMIN_TOKEN_KEY = 'quickkartAdminToken';
/** @deprecated Legacy password storage; migrated to token on next login. */
const LEGACY_CREDS_KEY = 'quickkartAdminCredentials';

function injectAdminLoaderStyles() {
    if (document.getElementById('quickkartAdminLoaderStyles')) return;
    const style = document.createElement('style');
    style.id = 'quickkartAdminLoaderStyles';
    style.textContent = `
        .app-loader {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.85rem;
            padding: 2.25rem 1.25rem;
            color: var(--muted, #64748b);
            text-align: center;
            width: 100%;
            box-sizing: border-box;
        }
        .app-loader-ring {
            width: 2.25rem;
            height: 2.25rem;
            border: 3px solid rgba(148, 163, 184, 0.18);
            border-top-color: var(--accent, #059669);
            border-right-color: rgba(5, 150, 105, 0.35);
            border-radius: 50%;
            animation: app-loader-spin 0.72s cubic-bezier(0.55, 0.12, 0.45, 0.88) infinite;
            flex-shrink: 0;
            box-shadow: 0 0 0 4px rgba(5, 150, 105, 0.07);
        }
        .app-loader-text {
            font-size: 0.875rem;
            font-weight: 600;
            letter-spacing: 0.01em;
            line-height: 1.45;
            color: var(--muted, #64748b);
            max-width: 14rem;
        }
        .app-loader--section {
            min-height: 10rem;
            padding: 2rem 1rem 2.25rem;
        }
        .app-loader--section .app-loader-ring {
            width: 2.125rem;
            height: 2.125rem;
        }
        .app-loader--chip {
            flex-direction: row;
            justify-content: center;
            align-items: center;
            gap: 0.65rem;
            width: auto;
            min-height: 0;
            padding: 0.6rem 1rem 0.6rem 0.85rem;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.98);
            border: 1px solid rgba(148, 163, 184, 0.28);
            box-shadow:
                0 10px 28px rgba(15, 23, 42, 0.1),
                0 0 0 1px rgba(255, 255, 255, 0.85) inset;
            backdrop-filter: blur(8px);
        }
        .app-loader--chip .app-loader-ring {
            width: 1.125rem;
            height: 1.125rem;
            border-width: 2px;
            box-shadow: none;
        }
        .app-loader--chip .app-loader-text {
            font-size: 0.8125rem;
            max-width: none;
            white-space: nowrap;
        }
        .app-loader--compact,
        .app-loader--chip {
            flex-direction: row;
            justify-content: center;
            align-items: center;
        }
        .app-loader--compact {
            padding: 1rem 0.75rem;
            gap: 0.65rem;
        }
        .app-loader--compact .app-loader-ring {
            width: 1.25rem;
            height: 1.25rem;
            border-width: 2px;
            box-shadow: none;
        }
        .app-loader--compact .app-loader-text {
            font-size: 0.8125rem;
        }
        .app-loader-panel {
            border: 1px solid var(--border, rgba(148, 163, 184, 0.35));
            border-radius: 14px;
            background: var(--card, #fff);
            box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
        }
        .is-inline-section-loading {
            display: flex !important;
            align-items: center;
            justify-content: center;
            min-height: 10rem;
        }
        #adminOrderList.is-inline-section-loading {
            min-height: 14rem;
        }
        #adminTabs.is-inline-section-loading {
            min-height: 7.5rem;
        }
        #adminOrderList.is-inline-section-loading > .app-loader,
        #adminTabs.is-inline-section-loading > .app-loader {
            flex: 0 0 auto;
        }
        .floor-grid-wrap.is-loading {
            position: relative;
        }
        .floor-grid-wrap.is-loading > section {
            opacity: 0.45;
            pointer-events: none;
        }
        .section-loader-host {
            position: relative;
        }
        .section-loader-host > :not(.section-loader-overlay) {
            transition: opacity 0.18s ease;
        }
        .section-loader-host.is-section-loading > :not(.section-loader-overlay) {
            opacity: 0.42;
            pointer-events: none;
        }
        .section-loader-overlay {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 4;
            padding: 1rem;
            background: rgba(248, 250, 252, 0.82);
            backdrop-filter: blur(2px);
            border-radius: inherit;
            pointer-events: none;
        }
        .section-loader-overlay .app-loader {
            width: auto;
            padding: 0;
        }
        .floor-grid-loader {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2;
            pointer-events: none;
            padding: 1rem;
        }
        .floor-grid-loader .app-loader {
            width: auto;
            padding: 0;
        }
        @keyframes app-loader-spin {
            to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
            .app-loader-ring {
                animation: none;
                border-top-color: var(--accent, #059669);
                border-right-color: rgba(5, 150, 105, 0.35);
            }
        }
    `;
    document.head.appendChild(style);
}

function escapeLoaderText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function loaderVariantClass(options = {}) {
    if (options.variant === 'chip') return ' app-loader--chip';
    if (options.variant === 'section') return ' app-loader--section';
    if (options.variant === 'panel') return ' app-loader-panel app-loader--section';
    if (options.compact) return ' app-loader--chip';
    if (options.panel) return ' app-loader-panel app-loader--section';
    return '';
}

function loaderHtml(message = 'Loading…', options = {}) {
    injectAdminLoaderStyles();
    const variant = loaderVariantClass(options);
    const text = escapeLoaderText(message || 'Loading…');
    return `<div class="app-loader${variant}" role="status" aria-live="polite"><span class="app-loader-ring" aria-hidden="true"></span><span class="app-loader-text">${text}</span></div>`;
}

function setElementLoader(el, message, options = {}) {
    if (!el) return;
    injectAdminLoaderStyles();
    el.dataset.loaderActive = '1';
    el.dataset.loaderPrev = el.innerHTML;
    el.classList.add('is-inline-section-loading');
    const variant = options.variant || (options.compact ? 'chip' : options.panel ? 'panel' : 'section');
    el.innerHTML = loaderHtml(message, { variant });
}

function clearElementLoader(el) {
    if (!el || el.dataset.loaderActive !== '1') return;
    const stillShowingLoader = Boolean(el.querySelector(':scope > .app-loader'));
    delete el.dataset.loaderActive;
    el.classList.remove('is-inline-section-loading');
    if (stillShowingLoader && Object.prototype.hasOwnProperty.call(el.dataset, 'loaderPrev')) {
        el.innerHTML = el.dataset.loaderPrev;
    }
    delete el.dataset.loaderPrev;
}

function sectionHasContent(el) {
    if (!el) return false;
    if (el.dataset.loaderActive === '1') return false;
    return el.childElementCount > 0 || String(el.textContent || '').trim().length > 0;
}

/** Inline loader for empty sections; overlay keeps existing content visible (SPA-style refresh). */
function setSectionLoader(el, message, options = {}) {
    if (!el) return;
    injectAdminLoaderStyles();

    const useOverlay = options.overlay === true || (options.overlay !== false && sectionHasContent(el));
    if (useOverlay) {
        if (el.querySelector(':scope > .section-loader-overlay')) return;
        el.classList.add('section-loader-host', 'is-section-loading');
        const overlay = document.createElement('div');
        overlay.className = 'section-loader-overlay';
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-live', 'polite');
        overlay.innerHTML = loaderHtml(message, { variant: 'chip' });
        el.appendChild(overlay);
        return;
    }

    setElementLoader(el, message, { variant: 'section' });
}

function clearSectionLoader(el) {
    if (!el) return;
    el.querySelector(':scope > .section-loader-overlay')?.remove();
    el.classList.remove('is-section-loading');
    if (!el.querySelector(':scope > .section-loader-overlay')) {
        el.classList.remove('section-loader-host');
    }
    clearElementLoader(el);
}

if (typeof document !== 'undefined') {
    injectAdminLoaderStyles();
}

function loadAdminToken() {
    try {
        return String(localStorage.getItem(ADMIN_TOKEN_KEY) || '').trim();
    } catch {
        return '';
    }
}

function saveAdminToken(token) {
    const t = String(token || '').trim();
    if (!t) return;
    try {
        localStorage.setItem(ADMIN_TOKEN_KEY, t);
        localStorage.removeItem(LEGACY_CREDS_KEY);
    } catch {
        /* ignore */
    }
}

function clearAdminToken() {
    try {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        localStorage.removeItem(LEGACY_CREDS_KEY);
    } catch {
        /* ignore */
    }
}

function loadLegacyAdminCreds() {
    try {
        const raw = localStorage.getItem(LEGACY_CREDS_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (!p || !p.user || !p.pass) return null;
        return { user: String(p.user).trim(), pass: String(p.pass) };
    } catch {
        return null;
    }
}

function adminAuthHeaders(extra = {}) {
    const token = loadAdminToken();
    const headers = { Accept: 'application/json', ...extra };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

function applySessionPayload(data, hooks = {}) {
    if (!data || typeof data !== 'object') return data;
    if (data.token) saveAdminToken(data.token);
    if (data.venue && typeof hooks.onVenue === 'function') hooks.onVenue(data.venue);
    if (data.floorConfig && typeof hooks.onFloorConfig === 'function') {
        hooks.onFloorConfig(data.floorConfig);
    }
    return data;
}

async function fetchAdminSession(hooks = {}) {
    const token = loadAdminToken();
    if (!token) return null;
    const res = await fetch('/api/admin/session', {
        headers: adminAuthHeaders(),
        cache: 'no-store'
    });
    if (res.status === 401) {
        clearAdminToken();
        return null;
    }
    if (!res.ok) {
        throw new Error('Could not verify admin session.');
    }
    const data = await res.json().catch(() => ({}));
    if (!data || !data.ok) return null;
    return applySessionPayload(data, hooks);
}

async function adminLogin(user, pass, hooks = {}) {
    const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: String(user || '').trim(), pass: String(pass || '') }),
        cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error || 'Invalid admin credentials.');
        err.status = res.status;
        throw err;
    }
    if (!data.token) {
        throw new Error('Login did not return a session token.');
    }
    return applySessionPayload(data, hooks);
}

/**
 * Restore admin session from stored token, or migrate legacy saved password once.
 */
async function ensureAdminSession(hooks = {}) {
    if (loadAdminToken()) {
        return fetchAdminSession(hooks);
    }

    const legacy = loadLegacyAdminCreds();
    if (!legacy) return null;

    try {
        return await adminLogin(legacy.user, legacy.pass, hooks);
    } catch {
        return null;
    }
}

window.quickkartAdminAuth = {
    ADMIN_TOKEN_KEY,
    loadAdminToken,
    saveAdminToken,
    clearAdminToken,
    adminAuthHeaders,
    fetchAdminSession,
    adminLogin,
    ensureAdminSession,
    loaderHtml,
    setElementLoader,
    clearElementLoader,
    setSectionLoader,
    clearSectionLoader
};
