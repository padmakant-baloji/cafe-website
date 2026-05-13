'use strict';

/**
 * Shared Google review prompt.
 *
 * Behavior: when any order transitions to "completed" while the user has the
 * site open, we persist a flag in localStorage. The prompt then appears on
 * every page load (menu, orders, profile) until the user clicks one of the
 * two buttons in the modal. Clicking the dimmed backdrop only hides the
 * modal for now and keeps the pending flag so it re-appears next visit.
 */

const GOOGLE_REVIEW_URL = 'https://g.page/r/CfqeWB2FX2doEBM/review';
const PENDING_KEY = 'balojiGoogleReviewPending';

function readPending() {
    try {
        const raw = localStorage.getItem(PENDING_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function writePending(payload) {
    try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(payload || {}));
    } catch {
        /* localStorage may be unavailable in private mode */
    }
}

function clearPending() {
    try {
        localStorage.removeItem(PENDING_KEY);
    } catch {
        /* no-op */
    }
}

function ensureModalMarkup() {
    if (document.getElementById('googleReviewModal')) return;
    const modal = document.createElement('div');
    modal.className = 'checkout-modal google-review-modal';
    modal.id = 'googleReviewModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'googleReviewTitle');
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="checkout-modal-content google-review-modal-content" tabindex="-1">
            <div class="google-review-modal-inner">
                <p class="google-review-eyebrow" aria-hidden="true">Thank you</p>
                <h2 id="googleReviewTitle">How was your order?</h2>
                <p class="google-review-lead" id="googleReviewLead">We’d love a quick Google review — it helps more neighbors find Baloji’s Cafe.</p>
                <div class="google-review-actions">
                    <a class="btn btn-primary google-review-link" id="googleReviewOpenBtn" href="${GOOGLE_REVIEW_URL}" target="_blank" rel="noopener noreferrer">Leave a Google review</a>
                    <button type="button" class="btn btn-secondary" id="googleReviewDismissBtn">Maybe later</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

function hideModal() {
    const modal = document.getElementById('googleReviewModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

function dismissModal({ clear }) {
    hideModal();
    if (clear) clearPending();
}

function showModal(payload) {
    ensureModalMarkup();
    const modal = document.getElementById('googleReviewModal');
    if (!modal) return;
    if (modal.classList.contains('active')) return;

    const lead = document.getElementById('googleReviewLead');
    if (lead) {
        const id = payload && payload.orderId != null ? String(payload.orderId).trim() : '';
        lead.textContent = id
            ? `Order #${id} is complete. We’d love a quick Google review — it helps more neighbors find Baloji’s Cafe.`
            : 'We’d love a quick Google review — it helps more neighbors find Baloji’s Cafe.';
    }

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function bindHandlersOnce(modal) {
    if (modal.dataset.boundReviewHandlers === 'true') return;
    modal.dataset.boundReviewHandlers = 'true';

    document.getElementById('googleReviewDismissBtn')?.addEventListener('click', () => {
        dismissModal({ clear: true });
    });

    document.getElementById('googleReviewOpenBtn')?.addEventListener('click', () => {
        // Clear pending; the link still opens via its href in a new tab.
        dismissModal({ clear: true });
    });

    modal.addEventListener('click', (e) => {
        // Backdrop click only hides; pending flag stays so the prompt
        // appears again next time per spec.
        if (e.target === modal) hideModal();
    });
}

function initReviewPrompt() {
    ensureModalMarkup();
    const modal = document.getElementById('googleReviewModal');
    if (!modal) return;
    bindHandlersOnce(modal);
}

function maybeShowPending() {
    initReviewPrompt();
    const pending = readPending();
    if (pending) showModal(pending);
}

/**
 * @param {{ orderId?: string | number, completedAt?: number }} [info]
 */
function markPending(info) {
    const payload = {
        orderId: info && info.orderId != null ? String(info.orderId) : '',
        completedAt: (info && Number(info.completedAt)) || Date.now()
    };
    writePending(payload);
    initReviewPrompt();
    showModal(payload);
}

window.GoogleReviewPrompt = {
    markPending,
    maybeShowPending,
    clear: clearPending,
    show: showModal,
    isPending: () => !!readPending()
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeShowPending);
} else {
    maybeShowPending();
}
