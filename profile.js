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

function getInitials(name) {
    const parts = String(name || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);
    if (parts.length === 0) return 'B';
    return parts.map((part) => part[0].toUpperCase()).join('');
}

function renderProfile(profile) {
    const name = document.getElementById('profileName');
    const mobile = document.getElementById('profileMobile');
    const city = document.getElementById('profileCity');
    const subtitle = document.getElementById('profileSubtitle');
    const avatar = document.getElementById('profileAvatar');
    if (!name || !mobile || !city || !subtitle || !avatar) return;

    name.textContent = profile?.name || 'Customer';
    mobile.textContent = profile?.mobile || '-';
    city.textContent = profile?.city || '-';
    subtitle.textContent = 'These details will be used when you place and track your cafe orders.';
    avatar.textContent = getInitials(profile?.name);
    const editName = document.getElementById('profileEditName');
    const editCity = document.getElementById('profileEditCity');
    if (editName) editName.value = profile?.name || '';
    if (editCity) editCity.value = profile?.city || '';
}

function setFeedback(message, type = 'info') {
    const feedback = document.getElementById('profileFormFeedback');
    if (!feedback) return;
    if (!message) {
        feedback.textContent = '';
        feedback.hidden = true;
        feedback.className = 'profile-form-feedback';
        return;
    }
    feedback.textContent = message;
    feedback.hidden = false;
    feedback.className = `profile-form-feedback profile-form-feedback--${type}`;
}

function setEditMode(enabled) {
    const modal = document.getElementById('profileEditModal');
    const editBtn = document.getElementById('profileEditBtn');
    if (!modal || !editBtn) return;
    modal.classList.toggle('active', enabled);
    modal.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    editBtn.hidden = enabled;
    document.body.style.overflow = enabled ? 'hidden' : '';
    if (!enabled) {
        setFeedback('');
        renderProfile(getCustomerProfile());
    }
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
        renderProfile(data.customer || null);
        return true;
    } catch {
        return false;
    }
}

async function updateProfile(name, city) {
    const token = getCustomerToken();
    const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name, city })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || 'Could not update profile.');
    }
    return data.customer || null;
}

document.addEventListener('DOMContentLoaded', async () => {
    renderProfile(getCustomerProfile());

    const restored = await restoreSession();
    if (!restored) {
        window.location.replace('/login');
        return;
    }

    document.getElementById('profileEditBtn')?.addEventListener('click', () => {
        setEditMode(true);
    });

    document.getElementById('profileCancelBtn')?.addEventListener('click', () => {
        setEditMode(false);
    });

    document.getElementById('profileEditCloseBtn')?.addEventListener('click', () => {
        setEditMode(false);
    });

    document.getElementById('profileEditModal')?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) {
            setEditMode(false);
        }
    });

    document.getElementById('profileEditForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = (document.getElementById('profileEditName')?.value || '').trim();
        const city = document.getElementById('profileEditCity')?.value || '';
        const saveBtn = document.getElementById('profileSaveBtn');
        if (!name || !city) {
            setFeedback('Please enter your name and select your city.', 'error');
            return;
        }
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
        }
        setFeedback('');
        try {
            const customer = await updateProfile(name, city);
            setCustomerProfile(customer);
            renderProfile(customer);
            setEditMode(false);
        } catch (error) {
            setFeedback(error.message || 'Could not update profile.', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save changes';
            }
        }
    });

    document.getElementById('profileSignOutBtn')?.addEventListener('click', () => {
        setCustomerToken(null);
        setCustomerProfile(null);
        window.location.replace('/login');
    });
});
