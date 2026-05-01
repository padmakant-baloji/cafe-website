'use strict';

const SESSION_STORAGE_KEY = 'balojiCustomerToken';
const CUSTOMER_PROFILE_KEY = 'balojiCustomerProfile';

function setCustomerToken(token) {
    if (token) localStorage.setItem(SESSION_STORAGE_KEY, token);
    else localStorage.removeItem(SESSION_STORAGE_KEY);
}

function setCustomerProfile(profile) {
    if (profile && typeof profile === 'object') {
        localStorage.setItem(CUSTOMER_PROFILE_KEY, JSON.stringify(profile));
    } else {
        localStorage.removeItem(CUSTOMER_PROFILE_KEY);
    }
}

function showError(message) {
    const el = document.getElementById('gateError');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
}

function clearError() {
    const el = document.getElementById('gateError');
    if (!el) return;
    el.textContent = '';
    el.hidden = true;
}

function goToMenu() {
    window.location.assign('/menu');
}

document.addEventListener('DOMContentLoaded', () => {
    const mobileBtn = document.getElementById('gateContinueMobile');
    const registerBtn = document.getElementById('gateRegister');
    const stepMobile = document.getElementById('gateStepMobile');
    const stepProfile = document.getElementById('gateStepProfile');

    mobileBtn?.addEventListener('click', async () => {
        clearError();
        const mobile = (document.getElementById('gateMobile')?.value || '')
            .replace(/\D/g, '')
            .slice(-10);
        if (mobile.length !== 10) {
            showError('Enter a valid 10-digit mobile number.');
            return;
        }
        mobileBtn.disabled = true;
        try {
            const res = await fetch('/api/auth/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mobile })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Could not continue');
            if (data.exists && data.token) {
                setCustomerToken(data.token);
                setCustomerProfile(data.customer || null);
                goToMenu();
                return;
            }
            stepMobile.hidden = true;
            stepProfile.hidden = false;
        } catch (err) {
            showError(err.message || 'Something went wrong.');
        } finally {
            mobileBtn.disabled = false;
        }
    });

    registerBtn?.addEventListener('click', async () => {
        clearError();
        const mobile = (document.getElementById('gateMobile')?.value || '')
            .replace(/\D/g, '')
            .slice(-10);
        const name = (document.getElementById('gateName')?.value || '').trim();
        const city = document.getElementById('gateCity')?.value || '';
        const addressLine = (document.getElementById('gateAddress')?.value || '').trim();

        if (mobile.length !== 10) {
            showError('Invalid mobile number.');
            return;
        }
        if (!name || !city) {
            showError('Please enter your name and select a city.');
            return;
        }
        if (!addressLine) {
            showError('Please enter your delivery address (street or landmark).');
            return;
        }

        registerBtn.disabled = true;
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mobile, name, city, addressLine })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Could not register');
            setCustomerToken(data.token);
            setCustomerProfile(data.customer || null);
            goToMenu();
        } catch (err) {
            showError(err.message || 'Registration failed.');
        } finally {
            registerBtn.disabled = false;
        }
    });
});
