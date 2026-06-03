// ============================================
// DOM Elements
// ============================================
const navbar = document.getElementById('navbar');
const hamburger = document.getElementById('hamburger');
const navMenu = document.getElementById('navMenu');
// These will be queried dynamically after menu loads
let categoryTabs = null;
let menuCategories = null;
const categoryTabsContainer = document.getElementById('categoryTabs');
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxCaption = document.getElementById('lightboxCaption');
const lightboxClose = document.querySelector('.lightbox-close');
const navLinks = document.querySelectorAll('a.app-tab[href^="#"], a.nav-link[href^="#"]');

// ============================================
// Session & My orders (Neon backend)
// ============================================
const SESSION_STORAGE_KEY = 'balojiCustomerToken';
const CUSTOMER_PROFILE_KEY = 'balojiCustomerProfile';

function getCustomerToken() {
    return localStorage.getItem(SESSION_STORAGE_KEY);
}

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

function getCustomerProfile() {
    try {
        const raw = localStorage.getItem(CUSTOMER_PROFILE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch {
        return null;
    }
}

function getAuthHeaders() {
    const t = getCustomerToken();
    const h = { 'Content-Type': 'application/json' };
    if (t) h.Authorization = `Bearer ${t}`;
    const profile = currentCustomer || getCustomerProfile();
    if (profile && profile.mobile) h['x-customer-mobile'] = String(profile.mobile);
    return h;
}

function apiFailureMessage(res, rawText, data) {
    const errField =
        data && typeof data.error === 'string' && data.error.trim() ? data.error.trim() : '';
    if (errField) return errField;
    const status = res.status;
    const text = String(rawText || '').trim();
    if (text.startsWith('<')) {
        if (status === 404) {
            return 'Could not reach the login service. Refresh the page or update the app and try again.';
        }
        return `Something went wrong (${status}). Please try again.`;
    }
    if (status === 404) {
        return 'Could not reach the login service (404). Refresh and try again.';
    }
    if (status === 502 || status === 503) {
        return 'Server is busy. Please try again in a moment.';
    }
    if (status >= 500) {
        return 'Server error. Please try again later.';
    }
    return text.slice(0, 280) || `Could not continue (${status}).`;
}

/** @type {{ customerId?: string, name: string, city: string, mobile: string } | null} */
let currentCustomer = null;

function getCustomerAddresses() {
    return Array.isArray(currentCustomer?.addresses) ? currentCustomer.addresses : [];
}

function getDefaultCustomerAddress() {
    const addresses = getCustomerAddresses();
    return addresses.find((address) => address && address.isDefault) || addresses[0] || null;
}

function formatSavedAddress(address) {
    if (!address || typeof address !== 'object') return '';
    return String(address.addressLine || address.address_line || '').trim();
}

/** Hides the delivery line when we already have a saved row (by id); prefills if saved line exists but no id yet. */
function refreshCheckoutAddressUI() {
    const wrap = document.getElementById('checkoutAddressWrap');
    const input = document.getElementById('addressLine');
    if (!wrap || !input) return;

    const def = getDefaultCustomerAddress();
    const savedLine = def ? formatSavedAddress(def) : '';
    const hasSavedRow = !!(def && def.id != null && String(def.id).trim() !== '');

    wrap.hidden = hasSavedRow;
    input.required = !hasSavedRow;
    if (hasSavedRow) {
        input.value = '';
    } else {
        input.value = savedLine;
    }

    renderCheckoutDeliveryCard();
}

function renderCheckoutDeliveryCard() {
    const cityEl = document.getElementById('checkoutDeliveryCityDisplay');
    const addrEl = document.getElementById('checkoutDeliveryAddressDisplay');
    if (!cityEl || !addrEl) return;

    const city =
        (document.getElementById('customerCity')?.value || currentCustomer?.city || '').trim() ||
        'Select city';
    cityEl.textContent = city;

    const wrap = document.getElementById('checkoutAddressWrap');
    const input = document.getElementById('addressLine');
    const savedLine = formatSavedAddress(getDefaultCustomerAddress());

    if (wrap?.hidden) {
        addrEl.textContent = savedLine || 'Saved delivery address';
    } else {
        addrEl.textContent = (input?.value || '').trim() || 'Enter street / landmark below';
    }
}

async function refreshCurrentCustomerProfile() {
    const token = getCustomerToken();
    if (!token) return null;
    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Could not refresh your profile.');
    const data = await res.json();
    currentCustomer = data.customer || null;
    setCustomerProfile(currentCustomer);
    updateCheckoutProfileUI();
    return currentCustomer;
}

function hideSessionGate() {
    const gate = document.getElementById('sessionGate');
    if (gate) gate.classList.add('session-gate--hidden');
    document.body.classList.remove('session-gate-open');
}

function goToMenuScreen() {
    if (window.location.pathname !== '/menu') {
        window.location.assign('/menu');
    }
}

function showGateError(msg) {
    const el = document.getElementById('gateError');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
}

function clearGateError() {
    const el = document.getElementById('gateError');
    if (el) {
        el.textContent = '';
        el.hidden = true;
    }
}

async function restoreSession() {
    const token = getCustomerToken();
    if (!token) return false;
    currentCustomer = getCustomerProfile();
    updateCheckoutProfileUI();
    try {
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            setCustomerToken(null);
            setCustomerProfile(null);
            return false;
        }
        const data = await res.json();
        currentCustomer = data.customer;
        setCustomerProfile(currentCustomer);
        hideSessionGate();
        updateCheckoutProfileUI();
        return true;
    } catch {
        return false;
    }
}

function updateCheckoutProfileUI() {
    const fallback = document.getElementById('checkoutFieldsFallback');
    const nameInput = document.getElementById('customerName');
    const mobileInput = document.getElementById('mobileNumber');
    const citySelect = document.getElementById('customerCity');
    if (!fallback) return;

    const lockFields = (locked) => {
        if (nameInput) nameInput.readOnly = locked;
        if (mobileInput) mobileInput.readOnly = locked;
        if (citySelect) citySelect.disabled = locked;
    };

    if (currentCustomer) {
        const profileComplete = !!(
            currentCustomer.name &&
            currentCustomer.mobile &&
            currentCustomer.city
        );
        fallback.hidden = profileComplete;
        if (nameInput) nameInput.value = currentCustomer.name || '';
        if (mobileInput) mobileInput.value = currentCustomer.mobile || '';
        if (citySelect) citySelect.value = currentCustomer.city || '';
        lockFields(true);
    } else {
        fallback.hidden = false;
        lockFields(false);
    }

    if (document.getElementById('checkoutModal')?.classList.contains('active')) {
        refreshCheckoutAddressUI();
    }
}

function initSessionGate() {
    const gateMobileBtn = document.getElementById('gateContinueMobile');
    const gateRegisterBtn = document.getElementById('gateRegister');
    const stepMobile = document.getElementById('gateStepMobile');
    const stepProfile = document.getElementById('gateStepProfile');

    gateMobileBtn?.addEventListener('click', async () => {
        clearGateError();
        const mobile = (document.getElementById('gateMobile')?.value || '')
            .replace(/\D/g, '')
            .slice(-10);
        if (mobile.length !== 10) {
            showGateError('Enter a valid 10-digit mobile number.');
            return;
        }
        gateMobileBtn.disabled = true;
        try {
            const res = await fetch('/api/auth/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mobile })
            });
            const raw = await res.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch {
                data = {};
            }
            if (!res.ok) throw new Error(apiFailureMessage(res, raw, data));
            if (data.exists && data.token) {
                setCustomerToken(data.token);
                currentCustomer = data.customer;
                hideSessionGate();
                updateCheckoutProfileUI();
                goToMenuScreen();
                return;
            }
            stepMobile.hidden = true;
            stepProfile.hidden = false;
        } catch (e) {
            showGateError(e.message || 'Something went wrong.');
        } finally {
            gateMobileBtn.disabled = false;
        }
    });

    gateRegisterBtn?.addEventListener('click', async () => {
        clearGateError();
        const mobile = (document.getElementById('gateMobile')?.value || '')
            .replace(/\D/g, '')
            .slice(-10);
        const name = (document.getElementById('gateName')?.value || '').trim();
        const city = document.getElementById('gateCity')?.value || '';
        const addressLine = (document.getElementById('gateAddress')?.value || '').trim();
        if (mobile.length !== 10) {
            showGateError('Invalid mobile number.');
            return;
        }
        if (!name || !city) {
            showGateError('Please enter your name and select a city.');
            return;
        }
        if (!addressLine) {
            showGateError('Please enter your delivery address (street or landmark).');
            return;
        }
        gateRegisterBtn.disabled = true;
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mobile, name, city, addressLine })
            });
            const raw = await res.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch {
                data = {};
            }
            if (!res.ok) throw new Error(apiFailureMessage(res, raw, data));
            setCustomerToken(data.token);
            currentCustomer = data.customer;
            hideSessionGate();
            updateCheckoutProfileUI();
            goToMenuScreen();
        } catch (e) {
            showGateError(e.message || 'Registration failed.');
        } finally {
            gateRegisterBtn.disabled = false;
        }
    });
}

// ============================================
// Sticky Navigation
// ============================================
let stickyNavInitialized = false;
let stickyNavScrollHandler = null;

function initStickyNav() {
    if (stickyNavInitialized) return;
    
    if (!stickyNavScrollHandler) {
        stickyNavScrollHandler = throttle(() => {
            const currentScroll = window.pageYOffset;
            
            if (currentScroll > 100) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        }, 150);
        
        window.addEventListener('scroll', stickyNavScrollHandler, { passive: true });
    }
    
    stickyNavInitialized = true;
}

// ============================================
// Mobile Menu Toggle
// ============================================
function initMobileMenu() {
    if (!hamburger || !navMenu) return;

    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
        document.body.style.overflow = navMenu.classList.contains('active') ? 'hidden' : '';
    });

    navLinks.forEach((link) => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
            document.body.style.overflow = '';
        });
    });

    document.addEventListener('click', (e) => {
        if (!hamburger.contains(e.target) && !navMenu.contains(e.target)) {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
            document.body.style.overflow = '';
        }
    });
}

// ============================================
// Smooth Scrolling
// ============================================
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href === '#') return;
            
            e.preventDefault();
            const target = document.querySelector(href);
            
            if (target) {
                const navEl = document.getElementById('navbar');
                const navH = navEl ? navEl.getBoundingClientRect().height : 80;
                const y =
                    target.getBoundingClientRect().top +
                    (window.pageYOffset || document.documentElement.scrollTop) -
                    navH -
                    12;
                window.scrollTo({
                    top: Math.max(0, y),
                    behavior: 'auto'
                });
            }
        });
    });
}

// ============================================
// Active Nav Link on Scroll
// ============================================
let activeNavLinkInitialized = false;
let activeNavLinkScrollHandler = null;

function initActiveNavLink() {
    if (activeNavLinkInitialized) return;
    
    const sections = document.querySelectorAll('section[id]');

    if (!activeNavLinkScrollHandler) {
        activeNavLinkScrollHandler = throttle(() => {
            const scrollY = window.pageYOffset;
            const navH = document.getElementById('navbar')
                ? document.getElementById('navbar').offsetHeight
                : 56;
            const offset = navH + 24;

            let currentId = sections.length ? sections[0].getAttribute('id') : null;
            sections.forEach((section) => {
                const top = section.offsetTop - offset;
                if (scrollY >= top) {
                    currentId = section.getAttribute('id');
                }
            });

            if (currentId) {
                navLinks.forEach((link) => {
                    const href = link.getAttribute('href');
                    const on = href === `#${currentId}`;
                    link.classList.toggle('active', on);
                    if (link.classList.contains('app-tab')) {
                        if (on) link.setAttribute('aria-current', 'page');
                        else link.removeAttribute('aria-current');
                    }
                });
            }
        }, 200);
        
        window.addEventListener('scroll', activeNavLinkScrollHandler, { passive: true });
    }

    activeNavLinkInitialized = true;
    requestAnimationFrame(() => {
        if (activeNavLinkScrollHandler) activeNavLinkScrollHandler();
    });
}

// ============================================
// Menu categories: continuous scroll + tab jump + scroll spy
// ============================================
let currentCategoryIndex = 0;
let menuCategoriesCache = null;
let categoryTabsCache = null;
let categoriesArrayCache = null;
let isInitialized = false;
let keyboardHandlerRef = null;
let categoryClickHandler = null;
let menuCategoryScrollSpyHandler = null;
let categoryMenuResizeHandler = null;
/** After a tab tap, ignore scroll-spy briefly so the active pill does not flicker */
let categoryTabProgrammaticUntil = 0;

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle function
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

function syncCategoryTabWithScrollPosition() {
    if (Date.now() < categoryTabProgrammaticUntil) return;

    const cats = document.querySelectorAll('#menuItemsContainer .menu-category');
    if (!cats.length) return;

    const navEl = document.getElementById('navbar');
    const navH = navEl ? navEl.offsetHeight : 72;
    const tabBar = categoryTabsContainer;
    const tabH =
        tabBar && tabBar.offsetParent !== null && tabBar.getClientRects().length
            ? tabBar.offsetHeight
            : 0;
    const line = navH + tabH + 16;

    let activeId = cats[0].id;
    cats.forEach((cat) => {
        if (cat.getBoundingClientRect().top <= line) {
            activeId = cat.id;
        }
    });

    const tabs = document.querySelectorAll('.category-tab');
    if (!tabs.length) return;

    let changed = false;
    tabs.forEach((t) => {
        const on = t.dataset.category === activeId;
        if (on !== t.classList.contains('active')) changed = true;
        t.classList.toggle('active', on);
        t.setAttribute('aria-current', on ? 'true' : 'false');
    });

    if (changed) {
        currentCategoryIndex = Array.from(cats).findIndex((c) => c.id === activeId);
        if (currentCategoryIndex < 0) currentCategoryIndex = 0;
    }
}

function setActiveCategoryTabAndScrollChip(categoryId) {
    const tabs = document.querySelectorAll('.category-tab');
    const categoryTabsList = document.getElementById('categoryTabsList');
    tabs.forEach((t) => {
        const on = t.dataset.category === categoryId;
        t.classList.toggle('active', on);
        t.setAttribute('aria-current', on ? 'true' : 'false');
    });
    const targetTab = Array.from(tabs).find((t) => t.dataset.category === categoryId);
    if (targetTab && categoryTabsList) {
        requestAnimationFrame(() => {
            const tr = targetTab.getBoundingClientRect();
            const lr = categoryTabsList.getBoundingClientRect();
            if (tr.left < lr.left + 8 || tr.right > lr.right - 8) {
                targetTab.scrollIntoView({
                    inline: 'center',
                    block: 'nearest',
                    behavior: 'auto'
                });
            }
        });
    }
    const cats = document.querySelectorAll('#menuItemsContainer .menu-category');
    const idx = Array.from(cats).findIndex((c) => c.id === categoryId);
    currentCategoryIndex = idx >= 0 ? idx : 0;
}

function scrollMenuToCategory(categoryId) {
    const el = document.getElementById(categoryId);
    if (!el) return;
    categoryTabProgrammaticUntil = Date.now() + 750;
    setActiveCategoryTabAndScrollChip(categoryId);
    el.scrollIntoView({ behavior: 'auto', block: 'start' });
}

function initMenuCategories() {
    const menuCategories = document.querySelectorAll('.menu-category');
    const categoryTabsList = document.getElementById('categoryTabsList');

    menuCategoriesCache = menuCategories;
    categoriesArrayCache = Array.from(menuCategories);
    categoryTabsCache = document.querySelectorAll('.category-tab');

    if (menuCategories.length === 0 || !categoryTabsList) {
        return;
    }

    if (isInitialized) {
        syncCategoryTabWithScrollPosition();
        return;
    }

    categoryClickHandler = (e) => {
        const tab = e.target.closest('.category-tab');
        if (!tab) return;
        const categoryId = tab.dataset.category;
        if (!categoryId) return;
        scrollMenuToCategory(categoryId);
    };
    categoryTabsList.addEventListener('click', categoryClickHandler);

    menuCategoryScrollSpyHandler = throttle(syncCategoryTabWithScrollPosition, 80);
    window.addEventListener('scroll', menuCategoryScrollSpyHandler, { passive: true });

    if (!categoryMenuResizeHandler) {
        categoryMenuResizeHandler = debounce(syncCategoryTabWithScrollPosition, 200);
        window.addEventListener('resize', categoryMenuResizeHandler, { passive: true });
    }

    keyboardHandlerRef = (e) => {
        if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        const cats =
            categoriesArrayCache.length > 0
                ? categoriesArrayCache
                : Array.from(document.querySelectorAll('#menuItemsContainer .menu-category'));
        if (!cats.length) return;
        let idx = currentCategoryIndex;
        if (idx < 0 || idx >= cats.length) idx = 0;
        if (e.key === 'ArrowLeft' && idx > 0) {
            scrollMenuToCategory(cats[idx - 1].id);
        } else if (e.key === 'ArrowRight' && idx < cats.length - 1) {
            scrollMenuToCategory(cats[idx + 1].id);
        }
    };
    document.addEventListener('keydown', keyboardHandlerRef);

    isInitialized = true;

    if (!categoryTabsList.dataset.indicatorsInitialized) {
        initCategoryScrollIndicators();
        categoryTabsList.dataset.indicatorsInitialized = 'true';
    }

    requestAnimationFrame(() => {
        syncCategoryTabWithScrollPosition();
    });
}

// ============================================
// Category Scroll Indicators
// ============================================
let scrollIndicatorsInitialized = false;
let scrollIndicatorUpdateHandler = null;
let resizeIndicatorHandler = null;

function initCategoryScrollIndicators() {
    if (scrollIndicatorsInitialized) return;
    
    const categoryTabs = document.getElementById('categoryTabsList');
    const scrollLeft = document.getElementById('scrollLeft');
    const scrollRight = document.getElementById('scrollRight');
    
    if (!categoryTabs || !scrollLeft || !scrollRight) return;
    
    function updateScrollIndicators() {
        const isScrollable = categoryTabs.scrollWidth > categoryTabs.clientWidth;
        const isAtStart = categoryTabs.scrollLeft <= 10;
        const isAtEnd = categoryTabs.scrollLeft >= categoryTabs.scrollWidth - categoryTabs.clientWidth - 10;
        
        if (isScrollable) {
            scrollLeft.classList.toggle('visible', !isAtStart);
            scrollRight.classList.toggle('visible', !isAtEnd);
        } else {
            scrollLeft.classList.remove('visible');
            scrollRight.classList.remove('visible');
        }
    }
    
    // Initial check
    updateScrollIndicators();
    
    // Update on scroll - use throttled version
    if (!scrollIndicatorUpdateHandler) {
        scrollIndicatorUpdateHandler = throttle(updateScrollIndicators, 200);
        categoryTabs.addEventListener('scroll', scrollIndicatorUpdateHandler, { passive: true });
    }
    
    // Update on resize - use debounced version
    if (!resizeIndicatorHandler) {
        resizeIndicatorHandler = debounce(updateScrollIndicators, 250);
        window.addEventListener('resize', resizeIndicatorHandler);
    }
    
    // Scroll left
    scrollLeft.addEventListener('click', () => {
        categoryTabs.scrollBy({
            left: -200,
            behavior: 'auto'
        });
    });
    
    // Scroll right
    scrollRight.addEventListener('click', () => {
        categoryTabs.scrollBy({
            left: 200,
            behavior: 'auto'
        });
    });
    
    scrollIndicatorsInitialized = true;
}

// ============================================
// Sticky Category Tabs
// ============================================
let stickyTabsInitialized = false;
let stickyTabsScrollHandler = null;
let cachedMenuTop = null;

function initStickyCategoryTabs() {
    if (stickyTabsInitialized) return;
    
    const menuSection = document.getElementById('menu');
    if (!menuSection || !categoryTabsContainer) return;
    
    // Cache menu top position (only recalculate on resize)
    function updateMenuTop() {
        cachedMenuTop = menuSection.offsetTop;
    }
    updateMenuTop();
    
    // Recalculate on resize
    window.addEventListener('resize', debounce(updateMenuTop, 250), { passive: true });
    
    if (!stickyTabsScrollHandler) {
        let lastPosition = null;
        
        stickyTabsScrollHandler = throttle(() => {
            // Ensure we have a cached value (calculate once if missing)
            if (cachedMenuTop === null) {
                cachedMenuTop = menuSection.offsetTop;
            }
            
            const scrollY = window.pageYOffset;
            
            // Use cached value instead of recalculating
            const threshold = cachedMenuTop - 80;
            const shouldBeSticky = scrollY >= threshold;
            
            // Only update if position changed to avoid unnecessary style updates
            if (lastPosition !== shouldBeSticky) {
                // Use requestAnimationFrame to batch style updates
                requestAnimationFrame(() => {
                    if (shouldBeSticky) {
                        categoryTabsContainer.style.position = 'sticky';
                    } else {
                        categoryTabsContainer.style.position = 'relative';
                    }
                });
                lastPosition = shouldBeSticky;
            }
        }, 200); // Increased throttle time
        
        window.addEventListener('scroll', stickyTabsScrollHandler, { passive: true });
    }
    
    stickyTabsInitialized = true;
}

// ============================================
// Gallery Lightbox
// ============================================
function initGallery() {
    const galleryItems = document.querySelectorAll('.gallery-item');
    if (!galleryItems.length || !lightbox || !lightboxClose || !lightboxImage) return;

    galleryItems.forEach(item => {
        item.addEventListener('click', () => {
            const img = item.querySelector('img');
            const caption = item.getAttribute('data-item');

            lightboxImage.src = img.src;
            lightboxImage.alt = img.alt;
            if (lightboxCaption) lightboxCaption.textContent = caption;
            lightbox.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    });

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            closeLightbox();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.classList.contains('active')) {
            closeLightbox();
        }
    });
}

function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
}

function initTestimonials() {
    const testimonialSlides = document.querySelectorAll('.testimonial-slide');
    const testimonialDots = document.querySelectorAll('.testimonial-dots .dot');
    if (!testimonialSlides.length) return;

    let currentSlide = 0;
    const totalSlides = testimonialSlides.length;

    function showSlide(index) {
        testimonialSlides.forEach(slide => slide.classList.remove('active'));
        testimonialDots.forEach(dot => dot.classList.remove('active'));

        testimonialSlides[index].classList.add('active');
        if (testimonialDots[index]) testimonialDots[index].classList.add('active');

        currentSlide = index;
    }

    testimonialDots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            showSlide(index);
        });
    });

    function nextSlide() {
        currentSlide = (currentSlide + 1) % totalSlides;
        showSlide(currentSlide);
    }

    setInterval(nextSlide, 5000);

    let touchStartX = 0;
    let touchEndX = 0;
    const carousel = document.querySelector('.testimonials-carousel');

    if (carousel) {
        carousel.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        });

        carousel.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            const diff = touchStartX - touchEndX;

            if (Math.abs(diff) > 50) {
                if (diff > 0 && currentSlide < totalSlides - 1) {
                    showSlide(currentSlide + 1);
                } else if (diff < 0 && currentSlide > 0) {
                    showSlide(currentSlide - 1);
                }
            }
        });
    }
}

// ============================================
// Cart System
// ============================================
let cart = [];
let appliedCoupon = null; // { code: string, discount: number, subtotal: number }

/** Keep in sync with `lib/order-window.js` (Asia/Kolkata, 9:00–22:00). */
const ORDER_ONLINE_IST_TZ = 'Asia/Kolkata';
const ORDER_ONLINE_START_SEC = 9 * 3600;
const ORDER_ONLINE_END_SEC = 22 * 3600;

function getSecondsSinceMidnightInTimeZone(date, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    });
    let h = 0;
    let m = 0;
    let s = 0;
    for (const p of dtf.formatToParts(date)) {
        if (p.type === 'hour') h = parseInt(p.value, 10) || 0;
        else if (p.type === 'minute') m = parseInt(p.value, 10) || 0;
        else if (p.type === 'second') s = parseInt(p.value, 10) || 0;
    }
    return h * 3600 + m * 60 + s;
}

function isOnlineOrderingWindowOpenIST(date = new Date()) {
    const sec = getSecondsSinceMidnightInTimeZone(date, ORDER_ONLINE_IST_TZ);
    return sec >= ORDER_ONLINE_START_SEC && sec < ORDER_ONLINE_END_SEC;
}

function getOrderingWindowClosedMessage() {
    return 'Online ordering is open 9 AM–10 PM (India time). Try again after 9 AM tomorrow.';
}

/** Updates cart/checkout notices; returns whether the online ordering window is open (IST). */
function syncOrderingWindowUI() {
    const open = isOnlineOrderingWindowOpenIST();
    const msg = getOrderingWindowClosedMessage();
    const cartNote = document.getElementById('orderingClosedNoteCart');
    const checkoutNote = document.getElementById('orderingClosedNoteCheckout');
    if (cartNote) {
        cartNote.textContent = msg;
        cartNote.hidden = open;
    }
    if (checkoutNote) {
        checkoutNote.textContent = msg;
        checkoutNote.hidden = open;
    }
    return open;
}

function updateOrderingAvailability() {
    const open = isOnlineOrderingWindowOpenIST();
    const orderButtons = document.querySelectorAll('.order-btn');
    const sizeButtons = document.querySelectorAll('.size-chip');
    const sizeHints = document.querySelectorAll('.menu-item-note');

    orderButtons.forEach((button) => {
        button.disabled = !open;
        button.setAttribute('aria-disabled', open ? 'false' : 'true');
        button.title = open ? '' : getOrderingWindowClosedMessage();

        const label = button.querySelector('.order-btn-label');
        if (label) {
            label.textContent = open ? 'Add' : 'Closed';
        }
    });

    sizeButtons.forEach((button) => {
        button.disabled = !open;
        button.setAttribute('aria-disabled', open ? 'false' : 'true');
        button.title = open ? '' : getOrderingWindowClosedMessage();
    });

    sizeHints.forEach((hint) => {
        hint.textContent = open
            ? 'Tap a size to add to cart'
            : 'Ordering on this site: 9 AM–10 PM (India time).';
    });
}

function initOrderingAvailability() {
    updateOrderingAvailability();
    setInterval(() => {
        updateOrderingAvailability();
        updateCartUI();
    }, 60000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            updateOrderingAvailability();
            updateCartUI();
        }
    });
}

// ============================================
// "Not accepting orders" overlay (admin controlled)
// ============================================
let storeAcceptingOrders = true;

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text || '';
}

function applyStoreClosedOverlay(status) {
    const overlay = document.getElementById('storeClosedOverlay');
    if (!overlay) return;

    const accepting = !status || status.acceptingOrders !== false;
    storeAcceptingOrders = accepting;

    if (accepting || !status || !status.notice) {
        overlay.hidden = true;
        document.body.classList.remove('store-closed-locked');
        return;
    }

    const notice = status.notice;
    setText('storeClosedIcon', notice.icon || '🏪');
    setText('storeClosedTitleEn', notice.titleEn || 'We are not accepting orders right now');
    setText('storeClosedTitleHi', notice.titleHi || 'हम अभी ऑर्डर स्वीकार नहीं कर रहे हैं');
    setText('storeClosedReasonEn', notice.reasonEn || '');
    setText('storeClosedReasonHi', notice.reasonHi || '');
    setText('storeClosedMessageEn', notice.messageEn || '');
    setText('storeClosedMessageHi', notice.messageHi || '');

    overlay.hidden = false;
    document.body.classList.add('store-closed-locked');
}

async function fetchStoreStatus() {
    try {
        const res = await fetch('/api/store-status', { cache: 'no-store' });
        if (!res.ok) return;
        const status = await res.json();
        applyStoreClosedOverlay(status);
    } catch {
        // Network/API issue: never block ordering on a failed status check.
        applyStoreClosedOverlay({ acceptingOrders: true });
    }
}

function initStoreStatus() {
    fetchStoreStatus();
    setInterval(fetchStoreStatus, 30000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') fetchStoreStatus();
    });
}

// Load cart from localStorage
function loadCart() {
    const savedCart = localStorage.getItem('balojiCart');
    if (savedCart) {
        cart = JSON.parse(savedCart);
        updateCartUI();
    }
}

// Save cart to localStorage
function saveCart() {
    localStorage.setItem('balojiCart', JSON.stringify(cart));
}

/** Override with absolute URL if the order API is hosted separately (set on window before script.js). */
function getOrderApiUrl() {
    if (typeof window !== 'undefined' && window.ORDER_API_URL) {
        return window.ORDER_API_URL;
    }
    return '/api/order';
}

// Add item to cart
function addToCart(itemName, price, options = {}) {
    // Price can be a number or string - handle both
    const itemPrice = typeof price === 'number' ? price : (parseInt(price) || 0);
    
    // Check if item already exists in cart
    const existingItem = cart.find(item => item.name === itemName);
    
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({
            name: itemName,
            price: itemPrice,
            quantity: 1
        });
    }
    
    saveCart();
    updateCartUI();
    if (options.skipToast) return;
    showCartNotification(itemName);
}

function getCartQuantityForLine(lineName) {
    const row = cart.find((c) => c.name === lineName);
    return row ? row.quantity : 0;
}

function adjustCartLineQuantity(lineName, delta) {
    if (!lineName || !delta) return;
    const idx = cart.findIndex((c) => c.name === lineName);
    if (idx < 0) return;
    cart[idx].quantity += delta;
    if (cart[idx].quantity <= 0) {
        cart.splice(idx, 1);
    }
    saveCart();
    updateCartUI();
}

function buildCartLineName(item, selectedSize, selectedAddons = []) {
    let itemName = item.name;
    if (selectedSize) {
        itemName += ` (${selectedSize.label})`;
    }
    if (selectedAddons.length > 0) {
        const addonLabels = selectedAddons.map((a) => a.label).join(', ');
        itemName += ` [${addonLabels}]`;
    }
    return itemName;
}

function buildCartLinePrice(item, selectedSize, selectedAddons = []) {
    let totalPrice = selectedSize ? selectedSize.price : item.price;
    selectedAddons.forEach((addon) => {
        totalPrice += addon.price;
    });
    return totalPrice;
}

function ensureAddonsModal() {
    if (document.getElementById('addonsModal')) return;
    const modal = document.createElement('div');
    modal.id = 'addonsModal';
    // Reuse existing modal styling (cart modal) so it actually displays.
    modal.className = 'cart-modal';
    modal.innerHTML = `
        <div class="cart-modal-content" role="dialog" aria-modal="true" aria-labelledby="addonsModalTitle">
            <div class="cart-modal-header">
                <h2 id="addonsModalTitle">Customize</h2>
                <button type="button" class="cart-close" id="addonsModalClose" aria-label="Close">&times;</button>
            </div>
            <div class="cart-items" style="max-height: 55vh;">
                <p id="addonsModalSubtitle" style="margin: 0 0 12px; color: var(--text-light);"></p>
                <div id="addonsModalOptions" style="display:grid; gap:10px;"></div>
            </div>
            <div class="cart-footer" style="padding: 1rem; border-top: 2px solid var(--beige-bg); display:flex; gap:10px; justify-content:flex-end;">
                <button type="button" class="btn" id="addonsModalCancel">Cancel</button>
                <button type="button" class="btn btn-primary" id="addonsModalAdd">Add to cart</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.classList.remove('active');
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
    modal.querySelector('#addonsModalClose')?.addEventListener('click', close);
    modal.querySelector('#addonsModalCancel')?.addEventListener('click', close);
}

function openAddonsModal({ title, subtitle, addons, onConfirm }) {
    ensureAddonsModal();
    const modal = document.getElementById('addonsModal');
    const titleEl = document.getElementById('addonsModalTitle');
    const subEl = document.getElementById('addonsModalSubtitle');
    const optionsEl = document.getElementById('addonsModalOptions');
    const addBtn = document.getElementById('addonsModalAdd');

    if (!modal || !titleEl || !subEl || !optionsEl || !addBtn) return;

    titleEl.textContent = title || 'Customize';
    subEl.textContent = subtitle || '';

    optionsEl.innerHTML = (addons || [])
        .map((a, idx) => {
            const price = Number(a.price) || 0;
            const label = String(a.label || '').trim();
            const id = `addonModalOpt_${idx}`;
            return `
                <label class="addon-option" for="${id}">
                    <input type="checkbox" id="${id}" data-label="${label}" data-price="${price}">
                    <span class="addon-option-text">
                        <span class="addon-option-title">${label}${price > 0 ? ` · +₹${price}` : ''}</span>
                        <button type="button" class="addon-option-cta" data-for="${id}">Add</button>
                    </span>
                </label>
            `;
        })
        .join('');

    // Keep CTA button text in sync and allow clicking the CTA to toggle.
    const syncCtas = () => {
        optionsEl.querySelectorAll('.addon-option').forEach((wrap) => {
            const cb = wrap.querySelector('input[type="checkbox"]');
            const btn = wrap.querySelector('.addon-option-cta');
            if (!cb || !btn) return;
            btn.textContent = cb.checked ? 'Added' : 'Add';
            btn.setAttribute('aria-pressed', cb.checked ? 'true' : 'false');
        });
    };
    syncCtas();
    optionsEl.onchange = (e) => {
        const t = e.target;
        if (t && t.matches && t.matches('input[type="checkbox"]')) {
            syncCtas();
        }
    };
    optionsEl.onclick = (e) => {
        const btn = e.target.closest('.addon-option-cta');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-for');
        const cb = id ? optionsEl.querySelector(`#${CSS.escape(id)}`) : null;
        if (cb) {
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };

    const close = () => modal.classList.remove('active');
    const handleConfirm = () => {
        if (!isOnlineOrderingWindowOpenIST()) {
            showToast(getOrderingWindowClosedMessage(), { type: 'info' });
            return;
        }
        const selected = [];
        optionsEl.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
            selected.push({
                label: cb.dataset.label || '',
                price: parseInt(cb.dataset.price, 10) || 0
            });
        });
        close();
        onConfirm && onConfirm(selected);
    };

    // Replace any previous click handler safely
    addBtn.onclick = handleConfirm;

    modal.classList.add('active');
}

function parseSizeLabelFromLine(itemName, lineName) {
    const prefix = `${itemName} (`;
    if (!lineName.startsWith(prefix)) return '';
    const inner = lineName.slice(prefix.length);
    const close = inner.indexOf(')');
    return close >= 0 ? inner.slice(0, close) : '';
}

function parseAddonLabelFromLine(itemName, lineName) {
    // Example: "Margherita (Small) [Extra cheese]" or "Veg Burger [Extra cheese]"
    if (!lineName || !lineName.startsWith(itemName)) return '';
    const open = lineName.indexOf('[');
    const close = lineName.indexOf(']');
    if (open < 0 || close < 0 || close <= open) return '';
    return lineName.slice(open + 1, close).trim();
}

function syncMenuItemSteppers() {
    const container = document.getElementById('menuItemsContainer');
    if (!container) return;

    container.querySelectorAll('.menu-item').forEach((row) => {
        const itemId = row.dataset.itemId;
        const item = findMenuItemById(itemId);
        if (!item) return;

        const hasSizes = item.sizes && item.sizes.length > 0;

        if (!hasSizes) {
            const control = row.querySelector('.menu-cart-control');
            const addBtn = control && control.querySelector('.menu-cart-add');
            const qtyBar = control && control.querySelector('.menu-cart-qty-bar');
            const addonLines = row.querySelector('.menu-item-addon-lines');
            if (!addBtn || !qtyBar) return;

            const hasAddons = Array.isArray(item.addons) && item.addons.length > 0;
            if (hasAddons && addonLines) {
                addonLines.innerHTML = '';
                const entries = cart.filter(
                    (c) => c.name === item.name || c.name.startsWith(`${item.name} [`)
                );
                if (entries.length <= 1) {
                    // If there's only one variant in cart, behave like normal: Add -> Qty bar.
                    const only = entries[0] || null;
                    const lineName = only ? only.name : buildCartLineName(item, null, []);
                    const qty = only ? only.quantity : getCartQuantityForLine(lineName);
                    const minusBtn = qtyBar.querySelector('.menu-qty-minus');
                    const plusBtn = qtyBar.querySelector('.menu-qty-plus');
                    const qtyNum = qtyBar.querySelector('.menu-cart-qty-middle');

                    if (qty > 0) {
                        addBtn.hidden = true;
                        qtyBar.hidden = false;
                        qtyBar.setAttribute('aria-hidden', 'false');
                        qtyBar.dataset.cartLine = lineName;
                        qtyBar.setAttribute('aria-label', `Quantity in cart: ${qty}`);
                        if (qtyNum) qtyNum.textContent = String(qty);
                        if (minusBtn) {
                            minusBtn.setAttribute('aria-label', `Decrease quantity (${qty} in cart)`);
                        }
                        if (plusBtn) {
                            plusBtn.setAttribute('aria-label', `Increase quantity (${qty} in cart)`);
                        }
                    } else {
                        addBtn.hidden = false;
                        qtyBar.hidden = true;
                        qtyBar.setAttribute('aria-hidden', 'true');
                        delete qtyBar.dataset.cartLine;
                        qtyBar.removeAttribute('aria-label');
                        if (qtyNum) qtyNum.textContent = '0';
                        if (minusBtn) minusBtn.setAttribute('aria-label', 'Decrease quantity');
                        if (plusBtn) plusBtn.setAttribute('aria-label', 'Increase quantity');
                    }
                    return;
                }

                // Multiple variants in cart: show separate qty rows per variant (plain vs add-on).
                if (entries.length) {
                    entries.forEach((entry) => {
                        const addonLabel = parseAddonLabelFromLine(item.name, entry.name);
                        const labText = addonLabel ? addonLabel : 'Regular';

                        const wrap = document.createElement('div');
                        wrap.className = 'menu-size-qty-row';

                        const lab = document.createElement('span');
                        lab.className = 'menu-size-qty-label';
                        lab.textContent = labText;

                        const q = document.createElement('div');
                        q.className = 'menu-cart-qty-bar menu-cart-qty-bar--compact';
                        q.setAttribute('role', 'group');
                        q.dataset.cartLine = entry.name;
                        q.setAttribute('aria-label', `${labText}, ${entry.quantity} in cart`);

                        const minusBtn = document.createElement('button');
                        minusBtn.type = 'button';
                        minusBtn.className = 'menu-qty-minus';
                        minusBtn.setAttribute(
                            'aria-label',
                            `Decrease quantity (${entry.quantity} in cart)`
                        );
                        minusBtn.textContent = '−';

                        const qtyMid = document.createElement('span');
                        qtyMid.className = 'menu-cart-qty-middle';
                        qtyMid.setAttribute('aria-live', 'polite');
                        qtyMid.textContent = String(entry.quantity);

                        const plusBtn = document.createElement('button');
                        plusBtn.type = 'button';
                        plusBtn.className = 'menu-qty-plus';
                        plusBtn.setAttribute(
                            'aria-label',
                            `Increase quantity (${entry.quantity} in cart)`
                        );
                        plusBtn.textContent = '+';

                        q.append(minusBtn, qtyMid, plusBtn);
                        wrap.append(lab, q);
                        addonLines.appendChild(wrap);
                    });
                }

                // Multiple variants: keep Add button visible (opens customize popup),
                // and hide the single-line qty bar (we show per-variant rows instead).
                addBtn.hidden = false;
                qtyBar.hidden = true;
                qtyBar.setAttribute('aria-hidden', 'true');
                delete qtyBar.dataset.cartLine;
                qtyBar.removeAttribute('aria-label');
                const qtyNum = qtyBar.querySelector('.menu-cart-qty-middle');
                if (qtyNum) qtyNum.textContent = '0';
                return;
            }

            const lineName = buildCartLineName(item, null, []);
            const qty = getCartQuantityForLine(lineName);
            const minusBtn = qtyBar.querySelector('.menu-qty-minus');
            const plusBtn = qtyBar.querySelector('.menu-qty-plus');
            const qtyNum = qtyBar.querySelector('.menu-cart-qty-middle');
            if (qty > 0) {
                addBtn.hidden = true;
                qtyBar.hidden = false;
                qtyBar.setAttribute('aria-hidden', 'false');
                qtyBar.dataset.cartLine = lineName;
                qtyBar.setAttribute('aria-label', `Quantity in cart: ${qty}`);
                if (qtyNum) qtyNum.textContent = String(qty);
                if (minusBtn) {
                    minusBtn.setAttribute('aria-label', `Decrease quantity (${qty} in cart)`);
                }
                if (plusBtn) {
                    plusBtn.setAttribute('aria-label', `Increase quantity (${qty} in cart)`);
                }
            } else {
                addBtn.hidden = false;
                qtyBar.hidden = true;
                qtyBar.setAttribute('aria-hidden', 'true');
                delete qtyBar.dataset.cartLine;
                qtyBar.removeAttribute('aria-label');
                if (qtyNum) qtyNum.textContent = '0';
                if (minusBtn) minusBtn.setAttribute('aria-label', 'Decrease quantity');
                if (plusBtn) plusBtn.setAttribute('aria-label', 'Increase quantity');
            }
            return;
        }

        const linesWrap = row.querySelector('.menu-item-size-lines');
        if (!linesWrap) return;
        linesWrap.innerHTML = '';
        const entries = cart.filter((c) => c.name.startsWith(`${item.name} (`));
        entries.forEach((entry) => {
            const label = parseSizeLabelFromLine(item.name, entry.name);
            const wrap = document.createElement('div');
            wrap.className = 'menu-size-qty-row';

            const lab = document.createElement('span');
            lab.className = 'menu-size-qty-label';
            lab.textContent = label || '—';

            const qtyBar = document.createElement('div');
            qtyBar.className = 'menu-cart-qty-bar menu-cart-qty-bar--compact';
            qtyBar.setAttribute('role', 'group');
            qtyBar.dataset.cartLine = entry.name;
            qtyBar.setAttribute('aria-label', `${label || 'Item'}, ${entry.quantity} in cart`);

            const minusBtn = document.createElement('button');
            minusBtn.type = 'button';
            minusBtn.className = 'menu-qty-minus';
            minusBtn.setAttribute('aria-label', `Decrease quantity (${entry.quantity} in cart)`);
            minusBtn.textContent = '−';

            const qtyMid = document.createElement('span');
            qtyMid.className = 'menu-cart-qty-middle';
            qtyMid.setAttribute('aria-live', 'polite');
            qtyMid.textContent = String(entry.quantity);

            const plusBtn = document.createElement('button');
            plusBtn.type = 'button';
            plusBtn.className = 'menu-qty-plus';
            plusBtn.setAttribute('aria-label', `Increase quantity (${entry.quantity} in cart)`);
            plusBtn.textContent = '+';

            qtyBar.append(minusBtn, qtyMid, plusBtn);
            wrap.append(lab, qtyBar);
            linesWrap.appendChild(wrap);
        });
    });

    applyOnlineOrderingGateToSteppers(container);
}

function applyOnlineOrderingGateToSteppers(container) {
    if (!container) return;
    const open = isOnlineOrderingWindowOpenIST();
    const msg = getOrderingWindowClosedMessage();
    container.querySelectorAll('.menu-qty-minus, .menu-qty-plus').forEach((btn) => {
        btn.disabled = !open;
        if (!open) btn.setAttribute('title', msg);
        else btn.removeAttribute('title');
    });
}

// Remove item from cart (global for onclick handlers)
window.removeFromCart = function(index) {
    cart.splice(index, 1);
    saveCart();
    updateCartUI();
}

// Update item quantity (global for onclick handlers)
window.updateQuantity = function(index, change) {
    cart[index].quantity += change;
    if (cart[index].quantity <= 0) {
        window.removeFromCart(index);
    } else {
        saveCart();
        updateCartUI();
    }
}

// Calculate cart total
function getCartTotal() {
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
}

const MIN_NON_KUDACHI_ORDER_VALUE = 200;
// Flat delivery charge applied to every order, irrespective of order value.
const NON_KUDACHI_DELIVERY_FEE = 45;
const KUDACHI_DELIVERY_FEE = 20;

function getNormalizedCustomerCity() {
    return String(currentCustomer?.city || getCustomerProfile()?.city || '').trim().toLowerCase();
}

function getCheckoutSelectedCity() {
    const citySelect = document.getElementById('customerCity');
    const raw = (citySelect && citySelect.value) || currentCustomer?.city || getCustomerProfile()?.city || '';
    return String(raw).trim().toLowerCase();
}

function getDeliveryFee(subtotal, cityLower) {
    if (!cityLower || subtotal <= 0) return 0;
    // Flat delivery charge regardless of order value: ₹20 in Kudachi, ₹45 elsewhere.
    return cityLower === 'kudachi' ? KUDACHI_DELIVERY_FEE : NON_KUDACHI_DELIVERY_FEE;
}

function isCheckoutAllowed(subtotal, cityLower) {
    if (!cityLower) return true; // city might be selected in checkout
    if (cityLower === 'kudachi') return subtotal > 0;
    return subtotal >= MIN_NON_KUDACHI_ORDER_VALUE;
}

function setCouponFeedback(message, type = 'info') {
    const el = document.getElementById('couponFeedback');
    if (!el) return;
    if (!message) {
        el.textContent = '';
        el.hidden = true;
        el.classList.remove('coupon-feedback--error', 'coupon-feedback--success');
        return;
    }
    el.textContent = message;
    el.hidden = false;
    el.classList.remove('coupon-feedback--error', 'coupon-feedback--success');
    if (type === 'error') el.classList.add('coupon-feedback--error');
    else if (type === 'success') el.classList.add('coupon-feedback--success');
}

function clearAppliedCoupon(reasonMessage = '') {
    appliedCoupon = null;
    const codeInput = document.getElementById('couponCode');
    if (codeInput) codeInput.value = '';
    if (reasonMessage) setCouponFeedback(reasonMessage, 'info');
    const applyBtn = document.getElementById('applyCouponBtn');
    if (applyBtn) {
        applyBtn.hidden = true;
        applyBtn.textContent = 'Apply';
    }
    renderCheckoutTotals();
}

async function applyCouponFromCheckout() {
    const codeInput = document.getElementById('couponCode');
    const applyBtn = document.getElementById('applyCouponBtn');
    const code = (codeInput?.value || '').trim();
    const subtotal = getCartTotal();

    // Toggle: if a coupon is already applied, clicking again removes it.
    if (appliedCoupon?.code) {
        appliedCoupon = null;
        setCouponFeedback('Coupon removed.', 'info');
        if (applyBtn) applyBtn.textContent = 'Apply';
        renderCheckoutTotals();
        return;
    }

    if (!code) {
        setCouponFeedback('Enter a coupon code.', 'error');
        return;
    }
    if (!subtotal) {
        setCouponFeedback('Add items to cart before applying a coupon.', 'error');
        return;
    }

    const prevLabel = applyBtn ? applyBtn.textContent : '';
    setBtnLoading(applyBtn, true);

    try {
        const res = await fetch('/api/coupons/validate', {
            method: 'POST',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code, subtotal })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Invalid coupon.');
        }
        appliedCoupon = { code: String(data.code || '').trim(), discount: Number(data.discount || 0), subtotal };
        setCouponFeedback(data.message || `Coupon applied: -₹${appliedCoupon.discount}`, 'success');
        if (applyBtn) {
            applyBtn.hidden = false;
            applyBtn.textContent = 'Remove';
        }
        renderCheckoutTotals();
    } catch (err) {
        appliedCoupon = null;
        setCouponFeedback(err.message || 'Could not apply coupon.', 'error');
        renderCheckoutTotals();
    } finally {
        setBtnLoading(applyBtn, false);
        if (applyBtn) {
            // Preserve Apply/Remove label based on state.
            applyBtn.textContent = appliedCoupon?.code ? 'Remove' : (prevLabel || 'Apply');
        }
    }
}

function renderCartSummary() {
    const subtotalEl = document.getElementById('cartSubtotal');
    const deliveryEl = document.getElementById('cartDeliveryFee');
    const deliveryRow = document.getElementById('cartDeliveryRow');
    const totalEl = document.getElementById('cartTotal');

    const subtotal = getCartTotal();
    const cityLower = getNormalizedCustomerCity();
    const allowed = isCheckoutAllowed(subtotal, cityLower);
    const showDelivery = !!cityLower && subtotal > 0 && allowed;
    const deliveryFee = showDelivery ? getDeliveryFee(subtotal, cityLower) : 0;

    if (subtotalEl) subtotalEl.textContent = String(subtotal);
    if (deliveryEl) deliveryEl.textContent = String(deliveryFee);
    if (deliveryRow) deliveryRow.hidden = !showDelivery;
    if (totalEl) totalEl.textContent = String(subtotal + deliveryFee);
}

function renderCartDeliveryNote() {
    const el = document.getElementById('cartDeliveryNote');
    if (!el) return;

    const subtotal = getCartTotal();
    const cityLower = getNormalizedCustomerCity();
    el.classList.remove('delivery-note--error');

    if (subtotal && cityLower && cityLower !== 'kudachi' && subtotal < MIN_NON_KUDACHI_ORDER_VALUE) {
        const remaining = MIN_NON_KUDACHI_ORDER_VALUE - subtotal;
        el.classList.add('delivery-note--error');
        el.innerHTML = `Minimum order for delivery outside <strong>Kudachi</strong> is <strong>₹${MIN_NON_KUDACHI_ORDER_VALUE}</strong>. Add <strong>₹${remaining}</strong> more to checkout.`;
        el.hidden = false;
        return;
    }

    el.textContent = '';
    el.hidden = true;
}

function renderCheckoutTotals() {
    const orderingOpen = syncOrderingWindowUI();
    const subtotalEl = document.getElementById('checkoutSubtotal');
    const deliveryEl = document.getElementById('checkoutDeliveryFee');
    const noteEl = document.getElementById('checkoutDeliveryNote');
    const discountRow = document.getElementById('checkoutDiscountRow');
    const discountAmountEl = document.getElementById('checkoutDiscountAmount');
    const submitAmtEl = document.getElementById('checkoutSubmitAmount');
    const submitBtn = document.getElementById('checkoutSubmitBtn');

    const subtotal = getCartTotal();
    const cityLower = getCheckoutSelectedCity();
    const allowed = isCheckoutAllowed(subtotal, cityLower);
    const deliveryFee = allowed ? getDeliveryFee(subtotal, cityLower) : 0;
    const discount =
        appliedCoupon && appliedCoupon.code && appliedCoupon.subtotal === subtotal
            ? Math.max(0, Math.min(subtotal, Number(appliedCoupon.discount || 0)))
            : 0;
    const grandTotal = Math.max(0, subtotal - discount) + deliveryFee;

    if (subtotalEl) subtotalEl.textContent = String(subtotal);
    if (deliveryEl) deliveryEl.textContent = String(deliveryFee);
    if (submitAmtEl) submitAmtEl.textContent = String(grandTotal);

    if (discountRow && discountAmountEl) {
        if (discount > 0) {
            discountAmountEl.textContent = String(discount);
            discountRow.hidden = false;
        } else {
            discountAmountEl.textContent = '0';
            discountRow.hidden = true;
        }
    }

    if (submitBtn) {
        const cityOk = !!cityLower;
        submitBtn.disabled = subtotal === 0 || !cityOk || !allowed || !orderingOpen;
    }

    renderCheckoutDeliveryCard();

    if (noteEl) {
        if (cityLower && cityLower !== 'kudachi' && subtotal > 0 && subtotal < MIN_NON_KUDACHI_ORDER_VALUE) {
            const remaining = MIN_NON_KUDACHI_ORDER_VALUE - subtotal;
            noteEl.textContent = `Minimum order for delivery outside Kudachi is ₹${MIN_NON_KUDACHI_ORDER_VALUE}. Add ₹${remaining} more to place your order.`;
            noteEl.hidden = false;
        } else {
            noteEl.textContent = '';
            noteEl.hidden = true;
        }
    }
}

// Update cart UI
function updateCartUI() {
    const cartCount = document.getElementById('cartCount');
    const navCartCount = document.getElementById('navCartCount');
    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');
    const cartFloat = document.getElementById('cartFloat');
    const navCart = document.getElementById('navCart');
    
    // Update cart count
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    // Update floating cart count
    if (cartCount) {
        cartCount.textContent = totalItems;
    }
    
    // Update nav cart count
    if (navCartCount) {
        navCartCount.textContent = totalItems;
    }
    
    if (cartFloat) {
        cartFloat.style.display = 'flex';
        cartFloat.classList.toggle('cart-float-empty', totalItems === 0);
    }
    
    if (navCart) {
        navCart.classList.toggle('nav-cart-empty', totalItems === 0);
    }
    
    // Update cart items display
    if (cart.length === 0) {
        if (cartItems) {
            cartItems.innerHTML = '<p class="cart-empty">Your cart is empty</p>';
        }
        renderCartSummary();
        renderCartDeliveryNote();
    } else {
        if (cartItems) {
            cartItems.innerHTML = cart.map((item, index) => `
                <div class="cart-item">
                    <div class="cart-item-info">
                        <h4>${item.name}</h4>
                        <p class="cart-item-price">₹${item.price} × ${item.quantity} = ₹${item.price * item.quantity}</p>
                    </div>
                    <div class="cart-item-actions">
                        <button class="qty-btn" onclick="updateQuantity(${index}, -1)">−</button>
                        <span class="qty-value">${item.quantity}</span>
                        <button class="qty-btn" onclick="updateQuantity(${index}, 1)">+</button>
                        <button class="remove-btn" onclick="removeFromCart(${index})">🗑️</button>
                    </div>
                </div>
            `).join('');
        }
        renderCartSummary();
        renderCartDeliveryNote();
    }

    const orderingOpen = syncOrderingWindowUI();
    // Disable checkout when order minimum isn't met (non-Kudachi only; Kudachi has no cart minimum beyond a non-empty total).
    const checkoutBtn = document.getElementById('checkoutBtn');
    if (checkoutBtn) {
        const subtotal = getCartTotal();
        const cityLower = getNormalizedCustomerCity();
        const allow = isCheckoutAllowed(subtotal, cityLower);
        checkoutBtn.disabled = !allow || !orderingOpen;
    }

    // Keep checkout totals in sync if checkout is open.
    if (document.getElementById('checkoutModal')?.classList.contains('active')) {
        if (appliedCoupon && appliedCoupon.subtotal !== getCartTotal()) {
            appliedCoupon = null;
            setCouponFeedback('Coupon removed because cart total changed. Apply again.', 'info');
        }
        renderCheckoutTotals();
    }

    syncMenuItemSteppers();
}

// ============================================
// Toast / Snackbar — non-blocking feedback
// ============================================
let toastStack = null;

function ensureToastStack() {
    if (toastStack && document.body.contains(toastStack)) return toastStack;
    toastStack = document.createElement('div');
    toastStack.className = 'app-toast-stack';
    toastStack.setAttribute('role', 'status');
    toastStack.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastStack);
    return toastStack;
}

/**
 * Show a transient, non-blocking message.
 * @param {string} message
 * @param {{type?: 'success'|'error'|'info', duration?: number, key?: string,
 *          action?: {label: string, onClick: () => void}}} [options]
 */
function showToast(message, options = {}) {
    const { type = 'info', key } = options;
    const stack = ensureToastStack();

    // Replace any existing toast that shares the same key (e.g. rapid add-to-cart).
    if (key) {
        stack.querySelectorAll(`[data-toast-key="${key}"]`).forEach((el) => el.remove());
    }

    const toast = document.createElement('div');
    toast.className = `app-toast app-toast--${type}`;
    if (key) toast.dataset.toastKey = key;

    const iconEl = document.createElement('span');
    iconEl.className = 'app-toast-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = type === 'success' ? '✓' : type === 'error' ? '!' : 'i';

    const msgEl = document.createElement('span');
    msgEl.className = 'app-toast-msg';
    msgEl.textContent = message;

    toast.append(iconEl, msgEl);

    let removed = false;
    const remove = () => {
        if (removed) return;
        removed = true;
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    };

    const action = options.action;
    if (action && action.label) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'app-toast-action';
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
            remove();
            try { action.onClick && action.onClick(); } catch { /* no-op */ }
        });
        toast.appendChild(btn);
    }

    stack.appendChild(toast);
    // Keep the stack tidy.
    while (stack.children.length > 3) stack.firstElementChild.remove();

    requestAnimationFrame(() => toast.classList.add('show'));

    const duration = options.duration || (action ? 4500 : 2600);
    setTimeout(remove, duration);
    return toast;
}

/** Open the cart modal from anywhere (used by toast actions). */
function openCartModalGlobal() {
    const cartModal = document.getElementById('cartModal');
    if (!cartModal) return;
    cartModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// Show cart notification (item added)
function showCartNotification(itemName) {
    const message = itemName ? `Added ${itemName}` : 'Added to cart';
    showToast(message, {
        type: 'success',
        key: 'cart-add',
        action: { label: 'View cart', onClick: openCartModalGlobal }
    });
}

// ============================================
// Menu Loading from JSON
// ============================================
let menuData = null;

// Fallback menu data (embedded in script for file:// protocol support)
const FALLBACK_MENU_JSON = `{
  "categories": [
    {
      "id": "combo-offers",
      "name": "Combo Offers",
      "items": [
        {
          "id": "combo-rice-gobi-manchurian",
          "name": "Rice + Gobi Manchurian",
          "image": "images/combos/combo-rice-campa.png",
          "alt": "Fried rice with Gobi Manchurian",
          "price": 105
        },
        {
          "id": "combo-noodles-gobi-manchurian",
          "name": "Noodles + Gobi Manchurian",
          "image": "images/combos/combo-noodles-campa.png",
          "alt": "Noodles with Gobi Manchurian",
          "price": 105
        },
        {
          "id": "combo-burger-french-fries",
          "name": "Burger + French Fries",
          "image": "images/combos/combo-burger-fries.png",
          "alt": "Burger with French Fries",
          "price": 125
        },
        {
          "id": "combo-sandwich-french-fries",
          "name": "Sandwich + French Fries",
          "image": "images/combos/combo-fries-campa.png",
          "alt": "Sandwich with French Fries",
          "price": 105
        },
        {
          "id": "combo-burger-cold-coffee",
          "name": "Burger + Cold Coffee",
          "image": "images/combos/combo-burger-cold-coffee.png",
          "alt": "Burger with Cold Coffee",
          "price": 135
        },
        {
          "id": "combo-momo",
          "name": "Momo Combo (2pc Kurkure + 2pc Cheesy + 2pc Schezwan Momo)",
          "image": "images/Cheesy%20Momo.jpg",
          "alt": "Momo Combo",
          "price": 135
        },
        {
          "id": "combo-burger-meal",
          "name": "Burger Meal (Burger + French Fries + Cold drinks)",
          "image": "images/combos/combo-burger-fries.png",
          "alt": "Burger meal with French fries and cold drink",
          "price": 135
        },
        {
          "id": "combo-sandwich-meal",
          "name": "Sandwich Meal (Sandwich + French Fries + cold drinks)",
          "image": "images/combos/combo-fries-campa.png",
          "alt": "Sandwich meal with French fries and cold drink",
          "price": 125
        }
      ]
    },
    {
      "id": "coffee-tea",
      "name": "Coffee & Tea",
      "items": [
        {
          "id": "tea",
          "name": "Tea",
          "image": "images/tea.jpg",
          "alt": "Tea",
          "price": 15
        },
        {
          "id": "coffee",
          "name": "Coffee",
          "image": "images/cofee.jpg",
          "alt": "Coffee",
          "price": 20
        },
        {
          "id": "badam-milk",
          "name": "Badam Milk",
          "image": "images/Badam%20Milk.jpg",
          "alt": "Badam Milk",
          "price": 25
        },
        {
          "id": "boost",
          "name": "Boost",
          "image": "images/Boost.jpg",
          "alt": "Boost",
          "price": 25
        }
      ]
    },
    {
      "id": "pizza",
      "name": "Pizza",
      "items": [
        {
          "id": "margherita",
          "name": "Margherita",
          "image": "images/Margherita%20pizza.jpg",
          "alt": "Margherita",
          "addons": [
            {
              "label": "Extra cheese",
              "price": 30
            }
          ],
          "sizes": [
            {
              "label": "Small",
              "price": 125
            },
            {
              "label": "Regular",
              "price": 175
            }
          ]
        },
        {
          "id": "farmhouse-cheese",
          "name": "Farmhouse & Cheese",
          "image": "images/Farmhouse%20%26%20Cheese%20pizza.jpg",
          "alt": "Farmhouse & Cheese",
          "addons": [
            {
              "label": "Extra cheese",
              "price": 30
            }
          ],
          "sizes": [
            {
              "label": "Small",
              "price": 165
            },
            {
              "label": "Regular",
              "price": 215
            }
          ]
        },
        {
          "id": "paneer-cheese",
          "name": "Paneer & Cheese",
          "image": "images/Paneer%20%26%20Cheese%20pizza.jpg",
          "alt": "Paneer & Cheese",
          "addons": [
            {
              "label": "Extra cheese",
              "price": 30
            }
          ],
          "sizes": [
            {
              "label": "Small",
              "price": 155
            },
            {
              "label": "Regular",
              "price": 205
            }
          ]
        },
        {
          "id": "corn-cheese",
          "name": "Corn & Cheese",
          "image": "images/Corn%20%26%20Cheese%20pizza.jpg",
          "alt": "Corn & Cheese",
          "addons": [
            {
              "label": "Extra cheese",
              "price": 30
            }
          ],
          "sizes": [
            {
              "label": "Small",
              "price": 145
            },
            {
              "label": "Regular",
              "price": 195
            }
          ]
        },
        {
          "id": "gobi-manchuri-pizza",
          "name": "Gobi Manchuri Pizza",
          "image": "images/Gobi%20Manchuri%20Pizza.jpg",
          "alt": "Gobi Manchuri Pizza",
          "addons": [
            {
              "label": "Extra cheese",
              "price": 30
            }
          ],
          "sizes": [
            {
              "label": "Small",
              "price": 155
            },
            {
              "label": "Regular",
              "price": 205
            }
          ]
        },
        {
          "id": "mushroom-cheese-pizza",
          "name": "Mushroom & Cheese Pizza",
          "image": "images/mushroompizza.png",
          "alt": "Mushroom & Cheese Pizza",
          "addons": [
            {
              "label": "Extra cheese",
              "price": 30
            }
          ],
          "sizes": [
            {
              "label": "Small",
              "price": 155
            },
            {
              "label": "Regular",
              "price": 205
            }
          ]
        },
        {
          "id": "mini-pizza",
          "name": "Mini Pizza",
          "image": "images/Margherita%20pizza.jpg",
          "alt": "Mini Pizza",
          "addons": [
            {
              "label": "Extra cheese",
              "price": 30
            }
          ],
          "price": 95
        }
      ]
    },
    {
      "id": "starters",
      "name": "Starters",
      "items": [
        {
          "id": "gobi-manchuri",
          "name": "Gobi Manchuri",
          "image": "images/Gobi%20Manchuri.jpg",
          "alt": "Gobi Manchuri",
          "price": 65
        },
        {
          "id": "gobi-chilly",
          "name": "Gobi Chilly",
          "image": "images/Gobi%20Chilly.jpg",
          "alt": "Gobi Chilly",
          "price": 65
        },
        {
          "id": "gobi-65",
          "name": "Gobi 65",
          "image": "images/Gobi%2065.jpg",
          "alt": "Gobi 65",
          "price": 65
        },
        {
          "id": "gobi-schezwan",
          "name": "Gobi Schezwan",
          "image": "images/Gobi%20Schezwan.jpg",
          "alt": "Gobi Schezwan",
          "price": 65
        },
        {
          "id": "paneer-manchuri",
          "name": "Paneer Manchuri",
          "image": "images/Paneer%20Manchuri.jpg",
          "alt": "Paneer Manchuri",
          "price": 95
        },
        {
          "id": "paneer-chilly",
          "name": "Paneer Chilly",
          "image": "images/Paneer%20Chilly.jpg",
          "alt": "Paneer Chilly",
          "price": 95
        },
        {
          "id": "paneer-65",
          "name": "Paneer 65",
          "image": "images/Paneer%2065.jpg",
          "alt": "Paneer 65",
          "price": 95
        },
        {
          "id": "paneer-schezwan",
          "name": "Paneer Schezwan",
          "image": "images/Paneer%20Schezwan.jpg",
          "alt": "Paneer Schezwan",
          "price": 95
        },
        {
          "id": "baby-corn-manchuri",
          "name": "Baby Corn Manchuri",
          "image": "images/Baby%20Corn%20Manchuri.jpg",
          "alt": "Baby Corn Manchuri",
          "price": 95
        },
        {
          "id": "baby-corn-chilly",
          "name": "Baby Corn Chilly",
          "image": "images/Baby%20Corn%20Chilly.jpg",
          "alt": "Baby Corn Chilly",
          "price": 95
        },
        {
          "id": "baby-corn-65",
          "name": "Baby Corn 65",
          "image": "images/Baby%20Corn%2065.jpg",
          "alt": "Baby Corn 65",
          "price": 95
        },
        {
          "id": "baby-corn-schezwan",
          "name": "Baby Corn Schezwan",
          "image": "images/Baby%20Corn%20Schezwan.jpg",
          "alt": "Baby Corn Schezwan",
          "price": 95
        },
        {
          "id": "mushroom-manchuri",
          "name": "Mushroom Manchuri",
          "image": "images/Mushroom%20Manchuri.jpg",
          "alt": "Mushroom Manchuri",
          "price": 95
        },
        {
          "id": "mushroom-chilly",
          "name": "Mushroom Chilly",
          "image": "images/Mushroom%20Chilly.jpg",
          "alt": "Mushroom Chilly",
          "price": 95
        },
        {
          "id": "mushroom-65",
          "name": "Mushroom 65",
          "image": "images/Mushroom%2065.jpg",
          "alt": "Mushroom 65",
          "price": 95
        },
        {
          "id": "mushroom-schezwan",
          "name": "Mushroom Schezwan",
          "image": "images/Mushroom%20Schezwan.jpg",
          "alt": "Mushroom Schezwan",
          "price": 95
        },
        {
          "id": "kurkure-corn",
          "name": "Kurkure Corn",
          "image": "images/Crispy%20Corn.jpg",
          "alt": "Kurkure Corn",
          "price": 75
        },
        {
          "id": "french-fries-salted",
          "name": "French Fries Salted",
          "image": "images/French%20Fries%20Salted.jpg",
          "alt": "French Fries Salted",
          "price": 75
        },
        {
          "id": "peri-peri-french-fries",
          "name": "Peri Peri French Fries",
          "image": "images/Peri%20Peri%20French%20Fries.jpg",
          "alt": "Peri Peri French Fries",
          "price": 85
        }
      ]
    },
    {
      "id": "soups",
      "name": "Soup",
      "items": [
        {
          "id": "manchow-soup",
          "name": "Manchow Soup",
          "image": "images/Manchow%20Soup.jpg",
          "alt": "Manchow Soup",
          "price": 55
        },
        {
          "id": "roasted-garlic-soup",
          "name": "Roasted Garlic Soup",
          "image": "images/Roasted%20Garlic%20Soup.jpg",
          "alt": "Roasted Garlic Soup",
          "price": 55
        },
        {
          "id": "vegetable-soup",
          "name": "Vegetable Soup",
          "image": "images/Vegetable%20Soup.jpg",
          "alt": "Vegetable Soup",
          "price": 55
        }
      ]
    },
    {
      "id": "rice-noodles",
      "name": "Rice & Noodles",
      "subsections": [
        {
          "id": "rice",
          "title": "Rice",
          "subtitle": "Fried rice & combos",
          "items": [
            {
              "id": "veg-fried-rice",
              "name": "Veg Fried Rice",
              "image": "images/Veg%20Fried%20Rice.jpg",
              "alt": "Veg Fried Rice",
              "price": 65
            },
            {
              "id": "schezwan-rice",
              "name": "Schezwan Rice",
              "image": "images/Schezwan%20Rice.jpg",
              "alt": "Schezwan Rice",
              "price": 65
            },
            {
              "id": "butter-garlic-rice",
              "name": "Butter Garlic Rice",
              "image": "images/Butter%20Garlic%20Rice.jpg",
              "alt": "Butter Garlic Rice",
              "price": 85
            },
            {
              "id": "paneer-fried-rice",
              "name": "Paneer Fried Rice",
              "image": "images/Paneer%20Fried%20Rice.jpg",
              "alt": "Paneer Fried Rice",
              "price": 95
            },
            {
              "id": "manchurian-rice",
              "name": "Manchurian Rice",
              "image": "images/Manchurian%20Rice.jpg",
              "alt": "Manchurian Rice",
              "price": 85
            },
            {
              "id": "special-rice",
              "name": "Special Rice",
              "image": "images/Special%20Rice.jpg",
              "alt": "Special Rice",
              "price": 95
            }
          ]
        },
        {
          "id": "noodles",
          "title": "Noodles",
          "subtitle": "Hakka & stir-fried",
          "items": [
            {
              "id": "veg-fried-noodles",
              "name": "Veg Fried Noodles",
              "image": "images/Veg%20Fried%20Noodles.jpg",
              "alt": "Veg Fried Noodles",
              "price": 65
            },
            {
              "id": "schezwan-noodles",
              "name": "Schezwan Noodles",
              "image": "images/Schezwan%20Noodles.jpg",
              "alt": "Schezwan Noodles",
              "price": 65
            },
            {
              "id": "butter-garlic-noodles",
              "name": "Butter Garlic Noodles",
              "image": "images/Butter%20Garlic%20Noodles.jpg",
              "alt": "Butter Garlic Noodles",
              "price": 85
            },
            {
              "id": "paneer-fried-noodles",
              "name": "Paneer Fried Noodles",
              "image": "images/Paneer%20Fried%20Noodles.jpg",
              "alt": "Paneer Fried Noodles",
              "price": 95
            },
            {
              "id": "rice-noodles-combo",
              "name": "Rice Noodles Combo",
              "image": "images/Rice%20Noodles%20Combo.jpg",
              "alt": "Rice Noodles Combo",
              "price": 85
            },
            {
              "id": "special-noodles",
              "name": "Special Noodles",
              "image": "images/Special%20Noodles.jpg",
              "alt": "Special Noodles",
              "price": 95
            }
          ]
        }
      ]
    },
    {
      "id": "sandwich",
      "name": "Sandwich",
      "items": [
        {
          "id": "vegetable-sandwich",
          "name": "Vegetable Sandwich",
          "image": "images/Vegetable%20Sandwich.jpg",
          "alt": "Vegetable Sandwich",
          "addons": [
            {
              "label": "Extra cheese",
              "price": 30
            }
          ],
          "price": 75
        },
        {
          "id": "paneer-sandwich",
          "name": "Paneer Sandwich",
          "image": "images/Paneer%20Sandwich.jpg",
          "alt": "Paneer Sandwich",
          "addons": [
            {
              "label": "Extra cheese",
              "price": 30
            }
          ],
          "price": 85
        }
      ]
    },
    {
      "id": "burger",
      "name": "Burger",
      "items": [
        {
          "id": "veg-burger",
          "name": "Veg Burger",
          "image": "images/Veg%20Burger.jpg",
          "alt": "Veg Burger",
          "addons": [
            {
              "label": "Extra cheese",
              "price": 30
            }
          ],
          "price": 95
        },
        {
          "id": "paneer-burger",
          "name": "Paneer Burger",
          "image": "images/Paneer%20Burger.jpg",
          "alt": "Paneer Burger",
          "addons": [
            {
              "label": "Extra cheese",
              "price": 30
            }
          ],
          "price": 105
        }
      ]
    },
    {
      "id": "momo",
      "name": "Momo",
      "items": [
        {
          "id": "steam-momo",
          "name": "Steam Momo",
          "image": "images/Steamed%20Momo.jpg",
          "alt": "Steam Momo",
          "price": 85
        },
        {
          "id": "kurkure-momo",
          "name": "Kurkure Momo",
          "image": "images/Crispy%20Momo.jpg",
          "alt": "Kurkure Momo",
          "price": 95
        },
        {
          "id": "cheesy-momo",
          "name": "Cheesy Momo",
          "image": "images/Cheesy%20Momo.jpg",
          "alt": "Cheesy Momo",
          "price": 105
        }
      ]
    },
    {
      "id": "cold-special",
      "name": "Cold Special",
      "items": [
        {
          "id": "softy-ice-cream",
          "name": "Softy Ice Cream",
          "image": "images/Softy%20Ice%20Cream.jpg",
          "alt": "Softy Ice Cream",
          "price": 25
        },
        {
          "id": "lassi",
          "name": "Lassi",
          "image": "images/Lassi.jpg",
          "alt": "Lassi",
          "price": 45
        },
        {
          "id": "cold-badam-milk",
          "name": "Cold Badam Milk",
          "image": "images/Badam%20Milk.jpg",
          "alt": "Cold Badam Milk",
          "price": 45
        },
        {
          "id": "masala-cold-drinks",
          "name": "Masala Cold Drinks",
          "image": "images/Masala%20Cold%20Drinks.jpg",
          "alt": "Masala Cold Drinks",
          "price": 45
        },
        {
          "id": "mint-mojito",
          "name": "Mint Mojito",
          "image": "images/Mint%20Mojito.jpg",
          "alt": "Mint Mojito",
          "price": 45
        },
        {
          "id": "cold-coffee",
          "name": "Cold Coffee",
          "image": "images/cold%20coffee.jpg",
          "alt": "Cold Coffee",
          "price": 55
        }
      ]
    },
    {
      "id": "cafe-special",
      "name": "Cafe Special",
      "items": [
        {
          "id": "kurkure-paneer",
          "name": "Kurkure Paneer",
          "image": "images/Crispy%20Paneer.jpg",
          "alt": "Kurkure Paneer",
          "price": 115
        },
        {
          "id": "paneer-finger",
          "name": "Paneer Finger",
          "image": "images/Paneer%20Finger.jpg",
          "alt": "Paneer Finger",
          "price": 115
        },
        {
          "id": "baby-corn-finger",
          "name": "Baby Corn Finger",
          "image": "images/Baby%20Corn%20Manchuri.jpg",
          "alt": "Baby Corn Finger",
          "price": 115
        },
        {
          "id": "paneer-saute",
          "name": "Paneer Saute",
          "image": "images/Paneer%20Saute.jpg",
          "alt": "Paneer Saute",
          "price": 115
        },
        {
          "id": "triple-fried-rice",
          "name": "Triple Fried Rice",
          "image": "images/Triple%20Fried%20Rice.jpg",
          "alt": "Triple Fried Rice",
          "price": 115
        },
        {
          "id": "special-pizza",
          "name": "Special Pizza",
          "image": "images/Special%20Pizza.jpg",
          "alt": "Special Pizza",
          "addons": [
            {
              "label": "Extra cheese",
              "price": 30
            }
          ],
          "price": 255
        },
        {
          "id": "honey-chilly-potato",
          "name": "Honey Chilly Potato",
          "image": "images/Honey%20Chilly%20Potato.jpg",
          "alt": "Honey Chilly Potato",
          "price": 105
        },
        {
          "id": "kurkure-chilly-potato",
          "name": "Kurkure Chilly Potato",
          "image": "images/Crispy%20Chilly%20Potato.jpg",
          "alt": "Kurkure Chilly Potato",
          "price": 105
        },
        {
          "id": "stuffing-mushroom",
          "name": "Stuffing Mushroom",
          "image": "images/Stuffing%20Mushroom.jpg",
          "alt": "Stuffing Mushroom",
          "price": 105
        }
      ]
    }
  ]
}
`;
const fallbackMenuData = JSON.parse(FALLBACK_MENU_JSON);

/** Started on DOMContentLoaded so `menu.json` downloads in parallel with session restore. */
let menuBootstrapFetch = null;

function setMenuLoading(loading) {
    const container = document.getElementById('menuItemsContainer');
    const menuSection = document.getElementById('menu');
    if (menuSection) {
        menuSection.setAttribute('aria-busy', loading ? 'true' : 'false');
    }
    if (!container) return;
    if (!loading) {
        if (menuSection) menuSection.removeAttribute('aria-busy');
        container.removeAttribute('aria-busy');
        container.classList.remove('menu-items-container--loading');
        return;
    }
    container.setAttribute('aria-busy', 'true');
    container.classList.add('menu-items-container--loading');
    const bars = Array.from({ length: 6 }, () => '<div class="menu-skeleton-card" aria-hidden="true"></div>').join('');
    container.innerHTML = `<div class="menu-loading-root" role="status">
            <span class="visually-hidden">Loading menu…</span>
            <div class="menu-skeleton-grid">${bars}</div>
        </div>`;
}

async function loadMenu() {
    setMenuLoading(true);
    try {
        let res = menuBootstrapFetch ? await menuBootstrapFetch : null;
        menuBootstrapFetch = null;
        if (!res || !res.ok) {
            res = await fetch('menu.json', { priority: 'high', cache: 'no-store' });
        }
        if (res.ok) {
            menuData = await res.json();
            if (menuData && Array.isArray(menuData.categories) && menuData.categories.length) {
                renderMenu();
                return;
            }
        }
        throw new Error('menu.json empty or unavailable');
    } catch (error) {
        console.warn('Could not load menu.json, using embedded data:', error);
        menuData = fallbackMenuData;
        renderMenu();
    } finally {
        setMenuLoading(false);
    }
}

const CATEGORY_TAB_ICONS = {
    'coffee-tea': '\u2615',
    pizza: '\u{1F355}',
    starters: '\u{1F331}',
    soups: '\u{1F372}',
    'rice-noodles': '\u{1F35A}',
    'sandwich-burger': '\u{1F96A}',
    momo: '\u{1F95F}',
    'bun-special': '\u{1F956}',
    'cold-special': '\u{1F9CA}',
    'cafe-special': '\u2B50'
};


function buildCategoryTabs() {
    const list = document.getElementById('categoryTabsList');
    if (!list || !menuData) return;
    list.innerHTML = menuData.categories.map((cat, i) => {
        const icon = CATEGORY_TAB_ICONS[cat.id] || '🍽';
        return `<button type="button" class="category-tab${i === 0 ? ' active' : ''}" data-category="${cat.id}"${i === 0 ? ' aria-current="true"' : ''}>
            <span class="category-icon" aria-hidden="true">${icon}</span>
            <span class="category-text">${cat.name}</span>
        </button>`;
    }).join('');
}

function itemIsListed(item) {
    return item && item.enabled !== false;
}

// ============================================
// Floating category switcher (jump bottom-sheet)
// ============================================
let categoryJumpInitialized = false;

function getCategoryListedCount(category) {
    if (Array.isArray(category.subsections) && category.subsections.length > 0) {
        return category.subsections.reduce(
            (n, sub) => n + (sub.items || []).filter(itemIsListed).length,
            0
        );
    }
    return (category.items || []).filter(itemIsListed).length;
}

function buildCategorySheet() {
    const list = document.getElementById('categorySheetList');
    if (!list || !menuData) return;
    list.innerHTML = menuData.categories
        .map((cat) => {
            const icon = CATEGORY_TAB_ICONS[cat.id] || '🍽';
            const count = getCategoryListedCount(cat);
            return `<li>
                <button type="button" class="category-sheet-item" data-category="${cat.id}">
                    <span class="category-sheet-item-icon" aria-hidden="true">${icon}</span>
                    <span class="category-sheet-item-name">${cat.name}</span>
                    <span class="category-sheet-item-count">${count}</span>
                </button>
            </li>`;
        })
        .join('');
}

function markActiveCategorySheetItem() {
    const list = document.getElementById('categorySheetList');
    if (!list) return;
    const activeTab = document.querySelector('.category-tab.active');
    const activeId = activeTab ? activeTab.dataset.category : null;
    list.querySelectorAll('.category-sheet-item').forEach((btn) => {
        const on = btn.dataset.category === activeId;
        btn.classList.toggle('active', on);
        if (on) {
            requestAnimationFrame(() => btn.scrollIntoView({ block: 'nearest' }));
        }
    });
}

function initCategoryJump() {
    if (categoryJumpInitialized) return;
    const fab = document.getElementById('categoryJumpFab');
    const sheet = document.getElementById('categorySheet');
    const backdrop = document.getElementById('categorySheetBackdrop');
    const closeBtn = document.getElementById('categorySheetClose');
    const list = document.getElementById('categorySheetList');
    const menuSection = document.getElementById('menu');
    if (!fab || !sheet || !menuSection) return;
    categoryJumpInitialized = true;

    let lastFocused = null;

    const openSheet = () => {
        buildCategorySheet();
        markActiveCategorySheetItem();
        lastFocused = document.activeElement;
        sheet.hidden = false;
        fab.classList.remove('visible');
        requestAnimationFrame(() => sheet.classList.add('open'));
        document.body.style.overflow = 'hidden';
        closeBtn?.focus();
    };

    const closeSheet = () => {
        sheet.classList.remove('open');
        document.body.style.overflow = '';
        const finish = () => {
            sheet.hidden = true;
            sheet.removeEventListener('transitionend', finish);
        };
        sheet.addEventListener('transitionend', finish);
        setTimeout(finish, 320);
        // Restore the FAB if the menu is still on screen.
        const r = menuSection.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) {
            fab.classList.add('visible');
        }
        if (lastFocused && typeof lastFocused.focus === 'function') {
            try { lastFocused.focus(); } catch { /* no-op */ }
        }
    };

    fab.addEventListener('click', openSheet);
    backdrop?.addEventListener('click', closeSheet);
    closeBtn?.addEventListener('click', closeSheet);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !sheet.hidden) {
            e.preventDefault();
            closeSheet();
        }
    });

    list?.addEventListener('click', (e) => {
        const btn = e.target.closest('.category-sheet-item');
        if (!btn) return;
        const categoryId = btn.dataset.category;
        if (!categoryId) return;
        closeSheet();
        // Let the sheet begin closing before scrolling for a smoother feel.
        requestAnimationFrame(() => scrollMenuToCategory(categoryId));
    });

    // Only surface the FAB while the menu is actually on screen.
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    const show = entry.isIntersecting && sheet.hidden;
                    fab.hidden = false;
                    fab.classList.toggle('visible', show);
                });
            },
            { threshold: 0, rootMargin: '-10% 0px -15% 0px' }
        );
        observer.observe(menuSection);
    } else {
        fab.hidden = false;
        fab.classList.add('visible');
    }
}

function renderMenu(searchQuery = '') {
    if (!menuData) return;
    
    const container = document.getElementById('menuItemsContainer');
    container.innerHTML = '';
    
    let totalResults = 0;
    let hasResults = false;
    
    menuData.categories.forEach((category) => {
        const query = searchQuery.trim();
        const hasSubsections =
            Array.isArray(category.subsections) && category.subsections.length > 0;

        const itemMatchesQuery = (item) => {
            if (!query) return true;
            const q = query.toLowerCase();
            const nameMatch = item.name.toLowerCase().includes(q);
            const categoryMatch = category.name.toLowerCase().includes(q);
            const altMatch = item.alt && item.alt.toLowerCase().includes(q);
            return nameMatch || categoryMatch || altMatch;
        };

        if (hasSubsections) {
            let subsectionsRender = category.subsections.map((sub) => ({
                ...sub,
                items: query
                    ? (sub.items || []).filter(
                          (item) => itemIsListed(item) && itemMatchesQuery(item)
                      )
                    : (sub.items || []).filter(itemIsListed)
            }));
            if (query) {
                subsectionsRender = subsectionsRender.filter((sub) => sub.items.length > 0);
                if (subsectionsRender.length === 0) return;
            }

            const sellableCount = category.subsections.reduce(
                (n, sub) => n + (sub.items || []).filter(itemIsListed).length,
                0
            );
            const matchedCount = subsectionsRender.reduce((n, sub) => n + sub.items.length, 0);
            totalResults += query ? matchedCount : sellableCount;
            hasResults = true;

            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'menu-category';
            categoryDiv.id = category.id;

            const header = document.createElement('div');
            header.className = 'menu-category-header';

            const titleEl = document.createElement('h3');
            titleEl.className = 'menu-category-title';
            titleEl.textContent = category.name;

            const countEl = document.createElement('span');
            countEl.className = 'menu-category-count';
            countEl.textContent = `${sellableCount} item${sellableCount !== 1 ? 's' : ''}`;

            header.appendChild(titleEl);
            header.appendChild(countEl);
            categoryDiv.appendChild(header);

            subsectionsRender.forEach((sub) => {
                const subWrap = document.createElement('div');
                subWrap.className = `menu-subsection menu-subsection--${sub.id}`;

                const head = document.createElement('div');
                head.className = 'menu-subsection-head';

                const subTitle = document.createElement('h4');
                subTitle.className = 'menu-subsection-title';
                subTitle.textContent = sub.title;
                head.appendChild(subTitle);

                if (sub.subtitle) {
                    const subLead = document.createElement('p');
                    subLead.className = 'menu-subsection-subtitle';
                    subLead.textContent = sub.subtitle;
                    head.appendChild(subLead);
                }

                subWrap.appendChild(head);

                if (sub.items.length === 0) {
                    const empty = document.createElement('p');
                    empty.className = 'menu-subsection-empty';
                    empty.textContent =
                        sub.emptyMessage ||
                        'More dishes coming soon — ask when you order.';
                    subWrap.appendChild(empty);
                } else {
                    const grid = document.createElement('div');
                    grid.className = 'menu-grid menu-subsection-grid';
                    sub.items.forEach((item) => {
                        grid.appendChild(createMenuItem(item, category.id));
                    });
                    subWrap.appendChild(grid);
                }

                categoryDiv.appendChild(subWrap);
            });

            container.appendChild(categoryDiv);
            return;
        }

        let filteredItems = (category.items || []).filter(itemIsListed);
        if (query) {
            filteredItems = filteredItems.filter(itemMatchesQuery);
        }

        if (filteredItems.length === 0 && query) {
            return;
        }

        totalResults += filteredItems.length;
        hasResults = true;

        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'menu-category';
        categoryDiv.id = category.id;

        const header = document.createElement('div');
        header.className = 'menu-category-header';

        const titleEl = document.createElement('h3');
        titleEl.className = 'menu-category-title';
        titleEl.textContent = category.name;

        const countEl = document.createElement('span');
        countEl.className = 'menu-category-count';
        countEl.textContent = `${filteredItems.length} item${filteredItems.length !== 1 ? 's' : ''}`;

        header.appendChild(titleEl);
        header.appendChild(countEl);

        const menuGrid = document.createElement('div');
        menuGrid.className = 'menu-grid';

        filteredItems.forEach((item) => {
            menuGrid.appendChild(createMenuItem(item, category.id));
        });

        categoryDiv.appendChild(header);
        categoryDiv.appendChild(menuGrid);
        container.appendChild(categoryDiv);
    });
    
    // Update search results info
    const searchResultsInfo = document.getElementById('searchResultsInfo');
    if (searchQuery.trim()) {
        if (totalResults > 0) {
            searchResultsInfo.style.display = 'block';
            searchResultsInfo.innerHTML = `<strong>${totalResults}</strong> ${totalResults === 1 ? 'item' : 'items'} found for "<strong>${searchQuery}</strong>"`;
        } else {
            searchResultsInfo.style.display = 'block';
            searchResultsInfo.innerHTML = `No items found for "<strong>${searchQuery}</strong>". Try a different search term.`;
        }
    } else {
        searchResultsInfo.style.display = 'none';
    }
    
    // Re-initialize menu categories for tab switching (after menu is loaded)
    // This will update cache references without re-adding event listeners
    if (!searchQuery.trim()) {
        buildCategoryTabs();
        buildCategorySheet();
        initMenuCategories();
        initCategoryJump();
    }
    
    // Update cached menu top position after menu is rendered (if sticky tabs initialized)
    if (cachedMenuTop !== null) {
        setTimeout(() => {
            const menuSection = document.getElementById('menu');
            if (menuSection) {
                cachedMenuTop = menuSection.offsetTop;
            }
        }, 100);
    }

    updateOrderingAvailability();
    syncMenuItemSteppers();
}

function createMenuItem(item, categoryId) {
    const menuItem = document.createElement('div');
    menuItem.className = 'menu-item';
    menuItem.dataset.itemId = item.id;

    let priceHTML = '';
    const hasSizes = item.sizes && item.sizes.length > 0;

    if (hasSizes) {
        const minPrice = Math.min(...item.sizes.map(s => s.price));
        priceHTML = `
            <p class="price price--multi">
                <span class="price-main">From ₹${minPrice}</span>
            </p>
        `;
    } else {
        priceHTML = `
            <p class="price">
                <span class="price-main">₹${item.price}</span>
            </p>
        `;
    }

    const actionsBlock = hasSizes
        ? `<div class="menu-item-actions menu-item-actions--sizes">
                <p class="menu-item-note" id="size-hint-${item.id}">Tap a size to add to cart</p>
                <div class="size-chips" role="group" aria-labelledby="size-hint-${item.id}"></div>
                <div class="menu-item-size-lines" aria-live="polite"></div>
            </div>`
        : `<div class="menu-item-actions menu-item-actions--simple">
                <div class="menu-cart-control">
                    <button type="button" class="order-btn order-btn--primary-add menu-cart-add" data-item-id="${item.id}">
                        <span class="order-btn-label">Add</span>
                        <span class="order-btn-price">₹${item.price}</span>
                    </button>
                    <div class="menu-cart-qty-bar" hidden aria-hidden="true" role="group">
                        <button type="button" class="menu-qty-minus" aria-label="Decrease quantity">−</button>
                        <span class="menu-cart-qty-middle" aria-live="polite">0</span>
                        <button type="button" class="menu-qty-plus" aria-label="Increase quantity">+</button>
                    </div>
                </div>
                <div class="menu-item-addon-lines" aria-live="polite"></div>
            </div>`;

    menuItem.innerHTML = `
        <div class="menu-item-image">
            <img src="${item.image}" alt="${item.alt}" loading="lazy" decoding="async" width="400" height="300" onerror="this.onerror=null; this.src='images/placeholder-icon.svg';">
        </div>
        <div class="menu-item-content">
            <div class="menu-item-header">
                <h3 class="menu-item-name">${item.name}</h3>
                ${priceHTML}
            </div>
            ${actionsBlock}
        </div>
    `;

    if (hasSizes) {
        const chipsWrap = menuItem.querySelector('.size-chips');
        item.sizes.forEach((size) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'size-chip';
            btn.dataset.label = size.label;
            btn.dataset.price = String(size.price);
            btn.setAttribute(
                'aria-label',
                `Add ${item.name}, ${size.label} size, ${size.price} rupees`
            );
            const lab = document.createElement('span');
            lab.className = 'size-chip-label';
            lab.textContent = size.label;
            const pr = document.createElement('span');
            pr.className = 'size-chip-price';
            pr.textContent = `₹${size.price}`;
            btn.append(lab, pr);
            chipsWrap.appendChild(btn);
        });
    }

    return menuItem;
}

// ============================================
// Handle Add to Cart with size and addons
// ============================================
function handleAddToCart(item, selectedSize = null) {
    if (!isOnlineOrderingWindowOpenIST()) {
        showToast(getOrderingWindowClosedMessage(), { type: 'info' });
        return;
    }
    const menuItem = document.querySelector(`[data-item-id="${item.id}"]`);
    if (!menuItem) return;

    const addons = Array.isArray(item.addons) ? item.addons : [];
    if (addons.length > 0) {
        const title = selectedSize || (item.sizes && item.sizes.length) ? 'Customize pizza' : 'Customize';
        const subtitle = selectedSize ? `${item.name} · ${selectedSize.label}` : item.name;
        openAddonsModal({
            title,
            subtitle,
            addons,
            onConfirm: (selectedAddons) => {
                const itemName = buildCartLineName(item, selectedSize, selectedAddons);
                const totalPrice = buildCartLinePrice(item, selectedSize, selectedAddons);
                addToCart(itemName, totalPrice);
            }
        });
        return;
    }

    const itemName = buildCartLineName(item, selectedSize, []);
    const totalPrice = buildCartLinePrice(item, selectedSize, []);
    addToCart(itemName, totalPrice);
}

// ============================================
// Menu item taps (delegation — one listener, no duplicate handlers on re-render)
// ============================================
let menuItemActionsInitialized = false;

function findMenuItemById(itemId) {
    if (!menuData || !itemId) return null;
    for (const category of menuData.categories) {
        if (Array.isArray(category.subsections) && category.subsections.length > 0) {
            for (const sub of category.subsections) {
                const found = sub.items.find((i) => i.id === itemId);
                if (found) return found;
            }
        } else if (Array.isArray(category.items)) {
            const found = category.items.find((i) => i.id === itemId);
            if (found) return found;
        }
    }
    return null;
}

function initMenuItemActions() {
    const container = document.getElementById('menuItemsContainer');
    if (!container || menuItemActionsInitialized) return;
    menuItemActionsInitialized = true;

    container.addEventListener('click', (e) => {
        const chip = e.target.closest('.size-chip');
        const addBtn = e.target.closest('.order-btn');
        const row = e.target.closest('.menu-item');
        if (!row) return;
        const itemId = row.dataset.itemId;
        const item = findMenuItemById(itemId);
        if (!item) return;

        if (chip) {
            e.preventDefault();
            const selectedSize = {
                label: chip.dataset.label,
                price: parseInt(chip.dataset.price, 10)
            };
            if (Number.isNaN(selectedSize.price)) return;
            handleAddToCart(item, selectedSize);
            return;
        }

        if (addBtn) {
            e.preventDefault();
            if (item.sizes && item.sizes.length) return;
            handleAddToCart(item);
            return;
        }

        const qtySeg = e.target.closest('.menu-cart-qty-bar .menu-qty-minus, .menu-cart-qty-bar .menu-qty-plus');
        if (qtySeg) {
            const bar = qtySeg.closest('.menu-cart-qty-bar');
            const line = bar && bar.dataset.cartLine;
            if (!line) return;
            e.preventDefault();
            const delta = qtySeg.classList.contains('menu-qty-plus') ? 1 : -1;
            adjustCartLineQuantity(line, delta);
        }
    });

    // (No inline add-ons selector; pizza add-ons are chosen after clicking add.)
}

// ============================================
// Cart Modal
// ============================================
function initCartModal() {
    const cartFloat = document.getElementById('cartFloat');
    const navCart = document.getElementById('navCart');
    const cartModal = document.getElementById('cartModal');
    const cartClose = document.getElementById('cartClose');
    const checkoutBtn = document.getElementById('checkoutBtn');
    
    function openCartModal() {
        cartModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
    
    // Floating cart button
    if (cartFloat) {
        cartFloat.addEventListener('click', openCartModal);
    }
    
    // Nav cart button
    if (navCart) {
        navCart.addEventListener('click', openCartModal);
        navCart.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openCartModal();
            }
        });
    }
    
    if (cartClose) {
        cartClose.addEventListener('click', () => {
            cartModal.classList.remove('active');
            document.body.style.overflow = '';
        });
    }
    
    if (cartModal) {
        cartModal.addEventListener('click', (e) => {
            if (e.target === cartModal) {
                cartModal.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }
    
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', () => {
            if (!isOnlineOrderingWindowOpenIST()) {
                showToast(getOrderingWindowClosedMessage(), { type: 'info' });
                return;
            }
            if (cart.length === 0) {
                showToast('Your cart is empty. Add a few items to continue.', { type: 'info' });
                return;
            }
            const subtotal = getCartTotal();
            const cityLower = getNormalizedCustomerCity();
            if (!isCheckoutAllowed(subtotal, cityLower)) {
                if (cityLower !== 'kudachi') {
                    const remaining = MIN_NON_KUDACHI_ORDER_VALUE - subtotal;
                    showToast(`Add ₹${remaining} more — minimum order for delivery outside Kudachi is ₹${MIN_NON_KUDACHI_ORDER_VALUE}.`, { type: 'error' });
                }
                return;
            }
            cartModal.classList.remove('active');
            void openCheckoutModal();
        });
    }
}

// ============================================
// Checkout Modal
// ============================================
async function openCheckoutModal() {
    const checkoutModal = document.getElementById('checkoutModal');

    // Ensure profile data is fresh right before showing checkout.
    // This avoids rare cases where checkout fields render before session/profile refresh completes.
    if (!currentCustomer || !currentCustomer.name || !currentCustomer.mobile || !currentCustomer.city) {
        try {
            await refreshCurrentCustomerProfile();
        } catch {
            /* ignore; UI will fall back to editable fields */
        }
    }

    updateCheckoutProfileUI();
    refreshCheckoutAddressUI();

    // Will set subtotal/delivery/total payable based on city.
    renderCheckoutTotals();

    checkoutModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function initCheckoutModal() {
    const checkoutModal = document.getElementById('checkoutModal');
    const checkoutClose = document.getElementById('checkoutClose');
    const checkoutForm = document.getElementById('checkoutForm');
    const citySelect = document.getElementById('customerCity');
    const applyCouponBtn = document.getElementById('applyCouponBtn');
    const couponInput = document.getElementById('couponCode');
    
    checkoutClose.addEventListener('click', () => {
        checkoutModal.classList.remove('active');
        document.body.style.overflow = '';
    });
    
    checkoutModal.addEventListener('click', (e) => {
        if (e.target === checkoutModal) {
            checkoutModal.classList.remove('active');
            document.body.style.overflow = '';
        }
    });
    
    checkoutForm.addEventListener('submit', (e) => {
        e.preventDefault();
        placeOrder();
    });

    citySelect?.addEventListener('change', () => {
        renderCheckoutTotals();
    });

    document.getElementById('addressLine')?.addEventListener('input', () => {
        renderCheckoutDeliveryCard();
    });

    applyCouponBtn?.addEventListener('click', () => {
        void applyCouponFromCheckout();
    });

    couponInput?.addEventListener('input', () => {
        couponInput.value = couponInput.value.toUpperCase();
        const hasText = !!couponInput.value.trim();
        if (applyCouponBtn) {
            applyCouponBtn.hidden = !hasText && !appliedCoupon?.code;
        }
        if (appliedCoupon?.code) {
            appliedCoupon = null;
            applyCouponBtn.textContent = 'Apply';
            applyCouponBtn.hidden = !hasText;
            setCouponFeedback('Coupon removed because code changed.', 'info');
            renderCheckoutTotals();
        }
    });

    couponInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            void applyCouponFromCheckout();
        }
    });

}

/** Seconds from local midnight; used so “before 1 PM” is strictly before 13:00:00. */
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
    const openSec = 13 * 3600;
    if (sec < openSec) {
        const deadline = new Date(placed);
        deadline.setHours(13, 20, 0, 0);
        const arrivalLabel = deadline.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        return {
            deadlineMs: deadline.getTime(),
            arrivalLabel,
            hint: 'We open at 1 PM — your order is queued for one of the first deliveries after opening.'
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

function getOrderSuccessMessage() {
    return 'We’ll notify you as your order moves along. The countdown above is a friendly estimate — open My orders anytime for live status.';
}

/** Target time (ms) for the order-success arrival countdown. */
let orderSuccessArrivalDeadlineMs = 0;
let orderSuccessArrivalIntervalId = null;

function clearOrderSuccessArrivalTimer() {
    if (orderSuccessArrivalIntervalId != null) {
        clearInterval(orderSuccessArrivalIntervalId);
        orderSuccessArrivalIntervalId = null;
    }
    orderSuccessArrivalDeadlineMs = 0;
}

function tickOrderSuccessArrivalCountdown() {
    const el = document.getElementById('orderSuccessArrivalCountdown');
    if (!el || !orderSuccessArrivalDeadlineMs) return;
    el.textContent = formatTimeUntilArrival(orderSuccessArrivalDeadlineMs);
}

function resetOrderSuccessModalChrome() {
    const title = document.getElementById('orderSuccessTitle');
    const eyebrow = document.getElementById('orderSuccessEyebrow');
    const icon = document.querySelector('#orderSuccessModal .order-success-icon');
    if (title) title.textContent = 'Order placed';
    if (eyebrow) eyebrow.textContent = 'You’re all set';
    if (icon) icon.removeAttribute('hidden');
}

function showOrderSuccessModal(placedAtMs) {
    const successModal = document.getElementById('orderSuccessModal');
    const successCopy = document.getElementById('orderSuccessCopy');
    if (!successModal) {
        window.location.assign('/orders');
        return;
    }
    resetOrderSuccessModalChrome();
    clearOrderSuccessArrivalTimer();

    const placedMs = Number.isFinite(Number(placedAtMs)) ? Number(placedAtMs) : Date.now();
    const plan = getOrderArrivalPlan(placedMs);
    orderSuccessArrivalDeadlineMs = plan.deadlineMs;

    const waitBlock = document.getElementById('orderSuccessWaitBlock');
    const waitRange = document.getElementById('orderSuccessWaitRange');
    const waitHint = document.getElementById('orderSuccessWaitHint');
    const arrivalLabelEl = document.getElementById('orderSuccessArrivalLabel');
    if (waitBlock && waitRange && waitHint) {
        waitRange.textContent = plan.arrivalLabel;
        waitHint.textContent = plan.hint;
        waitBlock.hidden = false;
        if (arrivalLabelEl) arrivalLabelEl.textContent = 'Estimated arrival';
    }
    tickOrderSuccessArrivalCountdown();
    orderSuccessArrivalIntervalId = setInterval(tickOrderSuccessArrivalCountdown, 1000);
    if (successCopy) {
        successCopy.textContent = getOrderSuccessMessage();
    }

    successModal.classList.add('active');
    successModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeOrderSuccessModal() {
    clearOrderSuccessArrivalTimer();
    const successModal = document.getElementById('orderSuccessModal');
    if (!successModal) return;
    successModal.classList.remove('active');
    successModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

function initOrderSuccessModal() {
    const successModal = document.getElementById('orderSuccessModal');
    const closeBtn = document.getElementById('orderSuccessCloseBtn');
    const trackBtn = document.getElementById('trackOrderBtn');
    if (!successModal) return;

    closeBtn?.addEventListener('click', () => {
        closeOrderSuccessModal();
    });

    trackBtn?.addEventListener('click', () => {
        window.location.assign('/orders');
    });

    successModal.addEventListener('click', (e) => {
        if (e.target === successModal) {
            closeOrderSuccessModal();
        }
    });
}

// ============================================
// Loading helpers
// ============================================
function setBtnLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
        btn.classList.add('is-loading');
        btn.dataset.wasDisabled = btn.disabled ? '1' : '0';
        btn.disabled = true;
    } else {
        btn.classList.remove('is-loading');
        btn.disabled = btn.dataset.wasDisabled === '1';
        delete btn.dataset.wasDisabled;
    }
}

function showAppLoading(text = 'Working…') {
    let el = document.getElementById('appLoadingOverlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'appLoadingOverlay';
        el.className = 'app-loading-overlay';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.innerHTML = '<div class="app-loading-spinner" aria-hidden="true"></div><p class="app-loading-text"></p>';
        document.body.appendChild(el);
    }
    const textEl = el.querySelector('.app-loading-text');
    if (textEl) textEl.textContent = text;
    requestAnimationFrame(() => {
        el.dataset.show = '1';
    });
}

function hideAppLoading() {
    const el = document.getElementById('appLoadingOverlay');
    if (el) el.dataset.show = '0';
}

// ============================================
// Place Order
// ============================================
async function placeOrder() {
    const token = getCustomerToken();
    if (!token) {
        showToast('Please sign in with your mobile number first.', { type: 'error' });
        return;
    }

    if (!isOnlineOrderingWindowOpenIST()) {
        showToast(getOrderingWindowClosedMessage(), { type: 'info' });
        return;
    }

    if (!cart.length) {
        showToast('Your cart is empty.', { type: 'info' });
        return;
    }

    const subtotal = getCartTotal();
    const cityLower = getCheckoutSelectedCity();
    if (!isCheckoutAllowed(subtotal, cityLower)) {
        if (cityLower !== 'kudachi') {
            const remaining = MIN_NON_KUDACHI_ORDER_VALUE - subtotal;
            showToast(`Add ₹${remaining} more — minimum order for delivery outside Kudachi is ₹${MIN_NON_KUDACHI_ORDER_VALUE}.`, { type: 'error' });
        }
        return;
    }
    const deliveryFee = getDeliveryFee(subtotal, cityLower);
    const discount =
        appliedCoupon && appliedCoupon.code && appliedCoupon.subtotal === subtotal
            ? Math.max(0, Math.min(subtotal, Number(appliedCoupon.discount || 0)))
            : 0;
    const total = Math.max(0, subtotal - discount) + deliveryFee;
    const citySelect = document.getElementById('customerCity');
    const city = (citySelect && citySelect.value) || currentCustomer?.city || '';
    if (!city) {
        showToast('Please select your city.', { type: 'error' });
        return;
    }

    const addressWrap = document.getElementById('checkoutAddressWrap');
    const usingSavedAddressOnly = addressWrap?.hidden;
    const payload = {
        items: cart.map((item) => ({
            name: item.name,
            price: item.price,
            quantity: item.quantity
        })),
        total,
        couponCode: appliedCoupon?.code || ''
    };

    if (usingSavedAddressOnly) {
        const def = getDefaultCustomerAddress();
        if (!def?.id) {
            showToast('We could not load your saved delivery spot. Add one line in the box below, then try again.', { type: 'error', duration: 4000 });
            return;
        }
        payload.addressId = String(def.id);
    } else {
        const addressLine = (document.getElementById('addressLine')?.value || '').trim();
        if (!addressLine) {
            showToast('Add a short delivery location (street or landmark), then place your order.', { type: 'error', duration: 4000 });
            const addressInput = document.getElementById('addressLine');
            if (addressInput) {
                try { addressInput.focus({ preventScroll: false }); } catch { addressInput.focus(); }
            }
            return;
        }
        payload.address = {
            label: 'Delivery',
            addressLine,
            city
        };
    }

    const submitBtn = document.getElementById('checkoutSubmitBtn');
    const prevSubmitHtml = submitBtn ? submitBtn.innerHTML : '';
    setBtnLoading(submitBtn, true);
    showAppLoading('Placing your order…');

    try {
        const res = await fetch(getOrderApiUrl(), {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || `Could not place order (${res.status})`);
        }

        cart = [];
        saveCart();
        updateCartUI();

        await refreshCurrentCustomerProfile();

        document.getElementById('checkoutModal').classList.remove('active');
        document.getElementById('cartModal').classList.remove('active');
        document.body.style.overflow = '';

        document.getElementById('checkoutForm').reset();
        updateCheckoutProfileUI();

        const createdRaw = data.created_at ?? data.createdAt;
        let createdMs =
            createdRaw != null && createdRaw !== ''
                ? new Date(createdRaw).getTime()
                : Date.now();
        if (!Number.isFinite(createdMs)) {
            createdMs = Date.now();
        }
        showOrderSuccessModal(createdMs);
    } catch (err) {
        const hint =
            window.location.protocol === 'file:'
                ? ' Open this site using the local server: run `yarn install` then `yarn start` in the project folder.'
                : '';
        showToast((err.message || 'Could not place order.') + hint, { type: 'error', duration: 5000 });
    } finally {
        hideAppLoading();
        setBtnLoading(submitBtn, false);
        if (submitBtn) {
            submitBtn.innerHTML = prevSubmitHtml;
            renderCheckoutTotals();
        }
    }
}

// ============================================
// Lazy Loading Images
// ============================================
function initLazyLoading() {
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                    }
                    observer.unobserve(img);
                }
            });
        });
        
        document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
        });
    }
}

// ============================================
// Initialize Everything
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    menuBootstrapFetch = fetch('menu.json', { priority: 'high', cache: 'no-store' }).catch(() => null);

    currentCustomer = getCustomerProfile();
    updateCheckoutProfileUI();

    const restored = await restoreSession();
    if (!restored) {
        window.location.replace('/login');
        return;
    }
    document.documentElement.classList.remove('route-menu-auth-pending');
    updateCheckoutProfileUI();

    initStickyNav();
    initMobileMenu();
    initSmoothScroll();
    initActiveNavLink();
    loadMenu(); // Load menu from JSON first
    initMenuCategories();
    initStickyCategoryTabs();
    initMenuSearch();
    initMenuItemActions();
    initOrderingAvailability();
    initStoreStatus();
    initGallery();
    initTestimonials();
    loadCart();
    initCartModal();
    initCheckoutModal();
    initOrderSuccessModal();
    initLazyLoading();

    // Add loaded class to body for CSS transitions
    document.body.classList.add('loaded');
});

// ============================================
// Menu Search Functionality
// ============================================
function initMenuSearch() {
    const searchInput = document.getElementById('menuSearchInput');
    const searchClearBtn = document.getElementById('searchClearBtn');

    if (!searchInput) return;

    function getCategoryTabs() {
        return document.querySelectorAll('.category-tab');
    }
    
    let searchTimeout;
    
    // Search input handler
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        // Show/hide clear button
        if (query) {
            searchClearBtn.style.display = 'flex';
        } else {
            searchClearBtn.style.display = 'none';
        }
        
        // Debounce search (balance responsiveness vs work per keystroke)
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            renderMenu(query);

            getCategoryTabs().forEach((tab) => {
                tab.style.display = query ? 'none' : '';
            });
        }, 200);
    });
    
    // Clear button handler
    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            searchInput.value = '';
            searchClearBtn.style.display = 'none';
            renderMenu('');

            getCategoryTabs().forEach((tab) => {
                tab.style.display = '';
            });

            const firstCat = document.querySelector('.menu-category');
            if (firstCat) {
                scrollMenuToCategory(firstCat.id);
            } else {
                syncCategoryTabWithScrollPosition();
            }

            searchInput.focus();
        });
    }
    
    // Escape key to clear search
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && searchInput.value) {
            searchInput.value = '';
            searchClearBtn.style.display = 'none';
            renderMenu('');
            getCategoryTabs().forEach((tab) => {
                tab.style.display = '';
            });
            const firstCat = document.querySelector('.menu-category');
            if (firstCat) scrollMenuToCategory(firstCat.id);
        }
    });
}

// ============================================
// Error Handling
// ============================================
window.addEventListener('error', (e) => {
    console.error('Error:', e.error);
});
