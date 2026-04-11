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
const navLinks = document.querySelectorAll('.nav-link');

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
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
        document.body.style.overflow = navMenu.classList.contains('active') ? 'hidden' : '';
    });
    
    // Close menu when clicking on a link
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
            document.body.style.overflow = '';
        });
    });
    
    // Close menu when clicking outside
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
            
            sections.forEach(section => {
                const sectionHeight = section.offsetHeight;
                const sectionTop = section.offsetTop - 100;
                const sectionId = section.getAttribute('id');
                
                if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
                    navLinks.forEach(link => {
                        link.classList.remove('active');
                        if (link.getAttribute('href') === `#${sectionId}`) {
                            link.classList.add('active');
                        }
                    });
                }
            });
        }, 200);
        
        window.addEventListener('scroll', activeNavLinkScrollHandler, { passive: true });
    }
    
    activeNavLinkInitialized = true;
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

// Add item to cart
function addToCart(itemName, price) {
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
    showCartNotification();
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
        if (cartTotal) {
            cartTotal.textContent = '0';
        }
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
        if (cartTotal) {
            cartTotal.textContent = getCartTotal();
        }
    }
}

// Show cart notification
function showCartNotification() {
    const notification = document.createElement('div');
    notification.className = 'cart-notification';
    notification.textContent = 'Item added to cart!';
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 2000);
}

// ============================================
// Menu Loading from JSON
// ============================================
let menuData = null;

// Fallback menu data (embedded in script for file:// protocol support)
const fallbackMenuData = {
  "categories": [
    {
      "id": "starters",
      "name": "Starters",
      "items": [
        {
          "id": "gobi-manchurian",
          "name": "Gobi Manchurian",
          "image": "images/quickBites/gobimanchurian.jpg",
          "alt": "Gobi Manchurian",
          "price": 65
        },
        {
          "id": "gobi-chilly",
          "name": "Gobi Chilly",
          "image": "images/quickBites/gobiChilly.jpg",
          "alt": "Gobi Chilly",
          "price": 65
        },
        {
          "id": "gobi-65",
          "name": "Gobi 65",
          "image": "images/quickBites/gobi65.jpg",
          "alt": "Gobi 65",
          "price": 65
        },
        {
          "id": "paneer-manchurian",
          "name": "Paneer Manchurian",
          "image": "images/quickBites/paneerManchuri.jpg",
          "alt": "Paneer Manchurian",
          "price": 75
        },
        {
          "id": "paneer-chilly",
          "name": "Paneer Chilly",
          "image": "images/quickBites/paneerchilly.jpg",
          "alt": "Paneer Chilly",
          "price": 75
        },
        {
          "id": "paneer-65",
          "name": "Paneer 65",
          "image": "images/quickBites/paneer65.jpg",
          "alt": "Paneer 65",
          "price": 75
        },
        {
          "id": "crispy-corn",
          "name": "Crispy corn",
          "image": "images/quickBites/americanbuttercorn.jpg",
          "alt": "Crispy corn",
          "price": 65
        },
        {
          "id": "french-fries-salted",
          "name": "French Fries (salted)",
          "image": "images/quickBites/frenchfries.jpg",
          "alt": "French Fries (salted)",
          "price": 65
        },
        {
          "id": "french-fries-peri-peri",
          "name": "French Fries (Peri Peri)",
          "image": "images/quickBites/frenchfries.jpg",
          "alt": "French Fries (Peri Peri)",
          "price": 75
        }
      ]
    },
    {
      "id": "momo",
      "name": "Momo (6 pc)",
      "items": [
        {
          "id": "steamed-momo",
          "name": "Steamed Momo (6 pc)",
          "image": "images/momo/momo.jpg",
          "alt": "Steamed Momo — 6 pieces",
          "price": 65
        },
        {
          "id": "cheesy-momo",
          "name": "Cheesy Momo (6 pc)",
          "image": "images/momo/momo.jpg",
          "alt": "Cheesy Momo — 6 pieces",
          "price": 95
        }
      ]
    },
    {
      "id": "burger",
      "name": "Burger",
      "items": [
        {
          "id": "burger",
          "name": "Burger",
          "image": "images/quickBites/burger.jpg",
          "alt": "Burger",
          "price": 95
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
          "subtitle": "Fried rice",
          "items": [
            {
              "id": "veg-fried",
              "name": "Veg Fried Rice",
              "image": "images/ricenoodles/vegfried.jpg",
              "alt": "Veg fried rice",
              "price": 65
            },
            {
              "id": "schezwan",
              "name": "Schezwan Fried Rice",
              "image": "images/ricenoodles/sehezwan.jpg",
              "alt": "Schezwan fried rice",
              "price": 65
            },
            {
              "id": "special",
              "name": "Special Fried Rice",
              "image": "images/ricenoodles/spcl.jpg",
              "alt": "Special fried rice",
              "price": 95
            }
          ]
        },
        {
          "id": "noodles",
          "title": "Noodles",
          "subtitle": "Stir-fried & hakka-style",
          "items": [
            {
              "id": "veg-hakka-noodles",
              "name": "Veg Hakka Noodles",
              "image": "images/ricenoodles/vegfried.jpg",
              "alt": "Veg hakka noodles",
              "price": 65
            },
            {
              "id": "schezwan-noodles",
              "name": "Schezwan Noodles",
              "image": "images/ricenoodles/sehezwan.jpg",
              "alt": "Schezwan noodles",
              "price": 65
            },
            {
              "id": "special-noodles",
              "name": "Special Noodles",
              "image": "images/ricenoodles/spcl.jpg",
              "alt": "Special noodles",
              "price": 95
            }
          ]
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
          "image": "images/pizza/margaretta.jpg",
          "alt": "Margherita",
          "sizes": [
            {
              "label": "Small",
              "price": 104
            },
            {
              "label": "Medium",
              "price": 155
            }
          ]
        },
        {
          "id": "farmhouse-cheese",
          "name": "Farmhouse & Cheese",
          "image": "images/pizza/farmhouse.jpg",
          "alt": "Farmhouse & Cheese",
          "sizes": [
            {
              "label": "Small",
              "price": 135
            },
            {
              "label": "Medium",
              "price": 185
            }
          ]
        },
        {
          "id": "paneer-cheese",
          "name": "Paneer & Cheese",
          "image": "images/pizza/paneertikka.jpg",
          "alt": "Paneer & Cheese",
          "sizes": [
            {
              "label": "Small",
              "price": 135
            },
            {
              "label": "Medium",
              "price": 185
            }
          ]
        },
        {
          "id": "corn-cheese",
          "name": "Corn & Cheese",
          "image": "images/pizza/corncheese.jpg",
          "alt": "Corn & Cheese",
          "sizes": [
            {
              "label": "Small",
              "price": 135
            },
            {
              "label": "Medium",
              "price": 185
            }
          ]
        },
        {
          "id": "gobi-manchuri-pizza",
          "name": "Gobi manchuri pizza",
          "image": "images/pizza/gobimanchurianpizza.jpg",
          "alt": "Gobi manchuri pizza",
          "sizes": [
            {
              "label": "Small",
              "price": 135
            },
            {
              "label": "Medium",
              "price": 185
            }
          ]
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
          "image": "images/soup/classic-manchow.jpg",
          "alt": "Manchow Soup",
          "price": 55
        },
        {
          "id": "roasted-garlic-soup",
          "name": "Roasted Garlic Soup",
          "image": "images/soup/garlic.jpg",
          "alt": "Roasted Garlic Soup",
          "price": 55
        },
        {
          "id": "vegetable-soup",
          "name": "Vegetable Soup",
          "image": "images/soup/tomato.jpg",
          "alt": "Vegetable Soup",
          "price": 55
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
          "image": "images/sandwich/veggrill.jpg",
          "alt": "Vegetable Sandwich",
          "price": 65
        },
        {
          "id": "paneer-sandwich",
          "name": "Paneer Sandwich",
          "image": "images/sandwich/paneertikaa.jpg",
          "alt": "Paneer Sandwich",
          "price": 75
        }
      ]
    },
    {
      "id": "coffee",
      "name": "Coffee",
      "items": [
        {
          "id": "hot-coffee",
          "name": "Hot Coffee",
          "image": "images/brewerages/hotcoffe.jpg",
          "alt": "Hot Coffee",
          "price": 20
        },
        {
          "id": "cold-coffee",
          "name": "Cold Coffee",
          "image": "images/brewerages/coldcoffe.jpg",
          "alt": "Cold Coffee",
          "price": 55
        }
      ]
    },
    {
      "id": "bun-special",
      "name": "Bun Special",
      "items": [
        {
          "id": "bun-maska",
          "name": "Bun Maska",
          "image": "images/sandwich/veggrill.jpg",
          "alt": "Bun Maska",
          "price": 20
        },
        {
          "id": "bun-gulkan",
          "name": "Bun Gulkan",
          "image": "images/sandwich/veggrill.jpg",
          "alt": "Bun Gulkan",
          "price": 20
        },
        {
          "id": "bun-jaam",
          "name": "Bun Jaam",
          "image": "images/sandwich/veggrill.jpg",
          "alt": "Bun Jaam",
          "price": 20
        },
        {
          "id": "bun-maska-gulkan",
          "name": "Bun Maska Gulkan",
          "image": "images/sandwich/veggrill.jpg",
          "alt": "Bun Maska Gulkan",
          "price": 35
        },
        {
          "id": "bun-maska-jaam",
          "name": "Bun Maska Jaam",
          "image": "images/sandwich/veggrill.jpg",
          "alt": "Bun Maska Jaam",
          "price": 35
        },
        {
          "id": "bun-gobi",
          "name": "Bun Gobi",
          "image": "images/sandwich/veggrill.jpg",
          "alt": "Bun Gobi",
          "price": 45
        },
        {
          "id": "bun-masala",
          "name": "Bun Masala",
          "image": "images/sandwich/veggrill.jpg",
          "alt": "Bun Masala",
          "price": 45
        },
        {
          "id": "bun-cutlet",
          "name": "Bun Cutlet",
          "image": "images/sandwich/veggrill.jpg",
          "alt": "Bun Cutlet",
          "price": 45
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
          "image": "images/esserts/softy.jpg",
          "alt": "Softy Ice Cream",
          "price": 25
        },
        {
          "id": "masala-butter-milk",
          "name": "Masala Butter Milk",
          "image": "images/brewerages/masalacoldrinks.jpg",
          "alt": "Masala Butter Milk",
          "price": 25
        },
        {
          "id": "lassi",
          "name": "Lassi",
          "image": "images/brewerages/masalacoldrinks.jpg",
          "alt": "Lassi",
          "price": 35
        },
        {
          "id": "badam-milk",
          "name": "Badam Milk",
          "image": "images/brewerages/masalacoldrinks.jpg",
          "alt": "Badam Milk",
          "price": 35
        },
        {
          "id": "masala-cold-drinks",
          "name": "Masala Cold Drinks",
          "image": "images/brewerages/masalacoldrinks.jpg",
          "alt": "Masala Cold Drinks",
          "price": 45
        },
        {
          "id": "mint-mojito",
          "name": "Mint Mojito",
          "image": "images/brewerages/masalacoldrinks.jpg",
          "alt": "Mint Mojito",
          "price": 45
        }
      ]
    }
  ]
};

async function loadMenu() {
    try {
        const response = await fetch('menu.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        menuData = await response.json();
        renderMenu();
    } catch (error) {
        console.warn('Could not load menu.json, using embedded menu data:', error);
        // Use fallback menu data if fetch fails (e.g., when opening file directly)
        menuData = fallbackMenuData;
        renderMenu();
    }
}

const CATEGORY_TAB_ICONS = {
    starters: '🌱',
    momo: '🥟',
    burger: '🍔',
    'rice-noodles': '🍚',
    pizza: '🍕',
    soups: '🍲',
    sandwich: '🥪',
    coffee: '☕',
    'bun-special': '🥖',
    'cold-special': '🧊'
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
                items: query ? sub.items.filter(itemMatchesQuery) : [...sub.items]
            }));
            if (query) {
                subsectionsRender = subsectionsRender.filter((sub) => sub.items.length > 0);
                if (subsectionsRender.length === 0) return;
            }

            const sellableCount = category.subsections.reduce(
                (n, sub) => n + sub.items.length,
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

        let filteredItems = category.items || [];
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
        initMenuCategories();
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
    
}

function createMenuItem(item, categoryId) {
    const menuItem = document.createElement('div');
    menuItem.className = 'menu-item';
    menuItem.dataset.itemId = item.id;

    let priceHTML = '';
    let addonSelectorHTML = '';
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

    if (item.addons && item.addons.length > 0) {
        const addonOptions = item.addons.map((addon) =>
            `<label class="addon-option">
                <input type="checkbox" value="${addon.price}" data-label="${addon.label}" data-item-id="${item.id}">
                <span class="addon-option-text">${addon.label}${addon.price > 0 ? ` · +₹${addon.price}` : ''}</span>
            </label>`
        ).join('');

        addonSelectorHTML = `
            <div class="addon-selector">
                <p class="addons-label">Extras <span class="addons-hint">(optional)</span></p>
                <div class="addon-options">
                    ${addonOptions}
                </div>
            </div>
        `;
    }

    const actionsBlock = hasSizes
        ? `<div class="menu-item-actions">
                <p class="menu-item-note" id="size-hint-${item.id}">Tap a size to add to cart</p>
                <div class="size-chips" role="group" aria-labelledby="size-hint-${item.id}"></div>
            </div>`
        : `<div class="menu-item-actions">
                <button type="button" class="order-btn" data-item-id="${item.id}">
                    <span class="order-btn-label">Add to cart</span>
                    <span class="order-btn-price">₹${item.price}</span>
                </button>
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
            ${addonSelectorHTML}
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
    const menuItem = document.querySelector(`[data-item-id="${item.id}"]`);
    if (!menuItem) return;
    
    // Get selected addons
    const selectedAddons = [];
    const addonCheckboxes = menuItem.querySelectorAll(`input[type="checkbox"][data-item-id="${item.id}"]:checked`);
    addonCheckboxes.forEach(checkbox => {
        selectedAddons.push({
            label: checkbox.dataset.label,
            price: parseInt(checkbox.value)
        });
    });
    
    // Calculate total price
    let totalPrice = selectedSize ? selectedSize.price : item.price;
    selectedAddons.forEach(addon => {
        totalPrice += addon.price;
    });
    
    // Build item name with size and addons
    let itemName = item.name;
    if (selectedSize) {
        itemName += ` (${selectedSize.label})`;
    }
    if (selectedAddons.length > 0) {
        const addonLabels = selectedAddons.map(a => a.label).join(', ');
        itemName += ` [${addonLabels}]`;
    }
    
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
        }
    });
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
            if (cart.length === 0) {
                alert('Your cart is empty!');
                return;
            }
            cartModal.classList.remove('active');
            openCheckoutModal();
        });
    }
}

// ============================================
// Checkout Modal
// ============================================
function openCheckoutModal() {
    const checkoutModal = document.getElementById('checkoutModal');
    const orderSummary = document.getElementById('orderSummary');
    const checkoutTotal = document.getElementById('checkoutTotal');
    
    // Update order summary
    orderSummary.innerHTML = cart.map(item => `
        <div class="summary-item">
            <span>${item.name} × ${item.quantity}</span>
            <span>₹${item.price * item.quantity}</span>
        </div>
    `).join('');
    
    checkoutTotal.textContent = getCartTotal();
    
    checkoutModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function initCheckoutModal() {
    const checkoutModal = document.getElementById('checkoutModal');
    const checkoutClose = document.getElementById('checkoutClose');
    const backToCartBtn = document.getElementById('backToCartBtn');
    const checkoutForm = document.getElementById('checkoutForm');
    
    checkoutClose.addEventListener('click', () => {
        checkoutModal.classList.remove('active');
        document.body.style.overflow = '';
    });
    
    backToCartBtn.addEventListener('click', () => {
        checkoutModal.classList.remove('active');
        document.getElementById('cartModal').classList.add('active');
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
}

// ============================================
// Place Order
// ============================================
function placeOrder() {
    const customerName = document.getElementById('customerName').value;
    const mobileNumber = document.getElementById('mobileNumber').value;
    
    if (!customerName || !mobileNumber) {
        alert('Please fill in all required fields');
        return;
    }
    
    // Build order message
    let message = `🍽️ *Order from Baloji's Cafe*\n\n`;
    message += `👤 *Name:* ${customerName}\n`;
    message += `📱 *Mobile Number:* ${mobileNumber}\n`;
    
    message += `\n📋 *Order Details:*\n`;
    cart.forEach((item, index) => {
        message += `${index + 1}. ${item.name} × ${item.quantity} = ₹${item.price * item.quantity}\n`;
    });
    
    message += `\n💰 *Total Amount: ₹${getCartTotal()}*\n\n`;
    message += `Thank you for ordering from Baloji's Cafe! 🎉`;
    
    // Open WhatsApp
    const whatsappNumber = '919900582650';
    const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
    
    // Clear cart
    cart = [];
    saveCart();
    updateCartUI();
    
    // Close modals
    document.getElementById('checkoutModal').classList.remove('active');
    document.getElementById('cartModal').classList.remove('active');
    document.body.style.overflow = '';
    
    // Reset form
    document.getElementById('checkoutForm').reset();
    
    // Show success message
    alert('Order placed! Opening WhatsApp...');
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
// Performance Optimization
// ============================================
function initPerformanceOptimizations() {
    // Functions are now defined at module level and used throughout
    // This function can be used for additional optimizations if needed
}

// ============================================
// Initialize Everything
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initStickyNav();
    initMobileMenu();
    initSmoothScroll();
    initActiveNavLink();
    loadMenu(); // Load menu from JSON first
    initMenuCategories();
    initStickyCategoryTabs();
    initMenuSearch();
    initMenuItemActions();
    initGallery();
    initTestimonials();
    loadCart();
    initCartModal();
    initCheckoutModal();
    initLazyLoading();
    initPerformanceOptimizations();
    
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
        
        // Debounce search
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            renderMenu(query);

            getCategoryTabs().forEach((tab) => {
                tab.style.display = query ? 'none' : '';
            });
        }, 300);
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

// Handle video loading errors
document.querySelectorAll('video').forEach(video => {
    video.addEventListener('error', () => {
        console.warn('Video failed to load, using fallback');
        // You could add a fallback image here
    });
});
