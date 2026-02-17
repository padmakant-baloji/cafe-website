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
const galleryItems = document.querySelectorAll('.gallery-item');
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxCaption = document.getElementById('lightboxCaption');
const lightboxClose = document.querySelector('.lightbox-close');
const testimonialSlides = document.querySelectorAll('.testimonial-slide');
const testimonialDots = document.querySelectorAll('.dot');
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
                const offsetTop = target.offsetTop - 80;
                window.scrollTo({
                    top: offsetTop,
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
// Menu Category Switching
// ============================================
let currentCategoryIndex = 0;
let menuCategoriesCache = null;
let categoryTabsCache = null;
let categoriesArrayCache = null;
let isInitialized = false;
let keyboardHandlerRef = null;
let categoryClickHandler = null;
let touchStartHandler = null;
let touchEndHandler = null;
let isSwitching = false; // Prevent rapid switching

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

function initMenuCategories() {
    // Prevent multiple initializations
    if (isInitialized) {
        // Just update cache references
        menuCategoriesCache = document.querySelectorAll('.menu-category');
        categoriesArrayCache = Array.from(menuCategoriesCache);
        categoryTabsCache = document.querySelectorAll('.category-tab');
        return;
    }
    
    const menuCategories = document.querySelectorAll('.menu-category');
    const categoryTabsList = document.getElementById('categoryTabsList');
    
    if (menuCategories.length === 0 || !categoryTabsList) {
        return; // Menu not loaded yet
    }
    
    // Cache DOM references
    menuCategoriesCache = menuCategories;
    categoryTabsCache = document.querySelectorAll('.category-tab');
    categoriesArrayCache = Array.from(menuCategories);
    
    function switchCategory(categoryId) {
        // Prevent rapid switching
        if (isSwitching) return;
        isSwitching = true;
        
        // Use cached references instead of re-querying
        const allMenuCategories = menuCategoriesCache || document.querySelectorAll('.menu-category');
        const allCategoryTabs = categoryTabsCache || document.querySelectorAll('.category-tab');
        
        // Remove active class from all categories and tabs
        allMenuCategories.forEach(cat => cat.classList.remove('active'));
        allCategoryTabs.forEach(tab => tab.classList.remove('active'));
        
        // Find the category and tab by ID
        const targetCategory = document.getElementById(categoryId);
        const targetTab = Array.from(allCategoryTabs).find(tab => tab.dataset.category === categoryId);
        
        if (targetCategory && targetTab) {
            targetCategory.classList.add('active');
            targetTab.classList.add('active');
            
            // Update current index
            const categories = categoriesArrayCache || Array.from(allMenuCategories);
            currentCategoryIndex = categories.findIndex(cat => cat.id === categoryId);
            
            // Use requestAnimationFrame for smooth scrolling
            requestAnimationFrame(() => {
                // Scroll to top of menu section (only if not already visible)
                const menuSection = document.getElementById('menu');
                if (menuSection) {
                    const menuRect = menuSection.getBoundingClientRect();
                    if (menuRect.top < 80 || menuRect.bottom < window.innerHeight) {
                        const offsetTop = menuSection.offsetTop - 80;
                        window.scrollTo({
                            top: offsetTop,
                            behavior: 'auto'
                        });
                    }
                }
                
                // Scroll active tab into view (for mobile) - use instant scroll for better performance
                const tabRect = targetTab.getBoundingClientRect();
                const containerRect = categoryTabsList.getBoundingClientRect();
                if (tabRect.left < containerRect.left || tabRect.right > containerRect.right) {
                    targetTab.scrollIntoView({
                        behavior: 'auto',
                        block: 'nearest',
                        inline: 'center'
                    });
                }
            });
        }
        
        // Reset switching flag after a short delay
        setTimeout(() => {
            isSwitching = false;
        }, 300);
    }
    
    // Use event delegation - only add once
    if (!categoryClickHandler) {
        categoryClickHandler = (e) => {
            const tab = e.target.closest('.category-tab');
            if (tab) {
                const categoryId = tab.dataset.category;
                if (categoryId) {
                    switchCategory(categoryId);
                }
            }
        };
        categoryTabsList.addEventListener('click', categoryClickHandler);
    }
    
    // Touch swipe support for mobile - only add once
    const menuContainer = document.querySelector('.menu-items-container');
    let touchStartX = 0;
    let touchEndX = 0;
    
    if (menuContainer && !touchStartHandler) {
        touchStartHandler = (e) => {
            touchStartX = e.changedTouches[0].screenX;
        };
        touchEndHandler = (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        };
        
        menuContainer.addEventListener('touchstart', touchStartHandler, { passive: true });
        menuContainer.addEventListener('touchend', touchEndHandler, { passive: true });
    }
    
    function handleSwipe() {
        const swipeThreshold = 50;
        const diff = touchStartX - touchEndX;
        const categories = categoriesArrayCache || Array.from(menuCategoriesCache);
        
        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0 && currentCategoryIndex < categories.length - 1) {
                // Swipe left - next category
                const nextCategory = categories[currentCategoryIndex + 1];
                if (nextCategory) switchCategory(nextCategory.id);
            } else if (diff < 0 && currentCategoryIndex > 0) {
                // Swipe right - previous category
                const prevCategory = categories[currentCategoryIndex - 1];
                if (prevCategory) switchCategory(prevCategory.id);
            }
        }
    }
    
    // Keyboard navigation - only add once
    if (!keyboardHandlerRef) {
        keyboardHandlerRef = (e) => {
            const categories = categoriesArrayCache || Array.from(menuCategoriesCache);
            if (e.key === 'ArrowLeft' && currentCategoryIndex > 0) {
                const prevCategory = categories[currentCategoryIndex - 1];
                if (prevCategory) switchCategory(prevCategory.id);
            } else if (e.key === 'ArrowRight' && currentCategoryIndex < categories.length - 1) {
                const nextCategory = categories[currentCategoryIndex + 1];
                if (nextCategory) switchCategory(nextCategory.id);
            }
        };
        document.addEventListener('keydown', keyboardHandlerRef);
    }
    
    isInitialized = true;
    
    // Initialize scroll indicators (only once)
    if (!document.getElementById('categoryTabsList').dataset.indicatorsInitialized) {
        initCategoryScrollIndicators();
        document.getElementById('categoryTabsList').dataset.indicatorsInitialized = 'true';
    }
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

function initStickyCategoryTabs() {
    if (stickyTabsInitialized) return;
    
    const menuSection = document.getElementById('menu');
    if (!menuSection || !categoryTabsContainer) return;
    
    if (!stickyTabsScrollHandler) {
        stickyTabsScrollHandler = throttle(() => {
            const menuTop = menuSection.offsetTop;
            const scrollY = window.pageYOffset;
            
            if (scrollY >= menuTop - 80) {
                categoryTabsContainer.style.position = 'sticky';
            } else {
                categoryTabsContainer.style.position = 'relative';
            }
        }, 150);
        
        window.addEventListener('scroll', stickyTabsScrollHandler, { passive: true });
    }
    
    stickyTabsInitialized = true;
}

// ============================================
// Gallery Lightbox
// ============================================
function initGallery() {
    galleryItems.forEach(item => {
        item.addEventListener('click', () => {
            const img = item.querySelector('img');
            const caption = item.getAttribute('data-item');
            
            lightboxImage.src = img.src;
            lightboxImage.alt = img.alt;
            lightboxCaption.textContent = caption;
            lightbox.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    });
    
    // Close lightbox
    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            closeLightbox();
        }
    });
    
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.classList.contains('active')) {
            closeLightbox();
        }
    });
}

function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
}

// ============================================
// Testimonials Carousel
// ============================================
function initTestimonials() {
    let currentSlide = 0;
    const totalSlides = testimonialSlides.length;
    
    function showSlide(index) {
        testimonialSlides.forEach(slide => slide.classList.remove('active'));
        testimonialDots.forEach(dot => dot.classList.remove('active'));
        
        testimonialSlides[index].classList.add('active');
        testimonialDots[index].classList.add('active');
        
        currentSlide = index;
    }
    
    // Dot click handlers
    testimonialDots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            showSlide(index);
        });
    });
    
    // Auto-slide
    function nextSlide() {
        currentSlide = (currentSlide + 1) % totalSlides;
        showSlide(currentSlide);
    }
    
    // Auto-advance every 5 seconds
    setInterval(nextSlide, 5000);
    
    // Touch swipe support
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
let map = null;
let marker = null;

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
    
    // Show/hide cart float
    if (cartFloat) {
        if (totalItems > 0) {
            cartFloat.style.display = 'flex';
        } else {
            cartFloat.style.display = 'none';
        }
    }
    
    // Show/hide nav cart
    if (navCart) {
        if (totalItems > 0) {
            navCart.classList.remove('hidden');
        } else {
            navCart.classList.add('hidden');
        }
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
      "id": "soups",
      "name": "Soups",
      "items": [
        {
          "id": "classic-manchow",
          "name": "Classic Manchow Soup",
          "image": "images/soup/classic-manchow.jpg",
          "alt": "Classic Manchow Soup",
          "sizes": [
            { "label": "Half", "price": 50 },
            { "label": "Full", "price": 80 }
          ]
        },
        {
          "id": "tomato-soup",
          "name": "Garden Fresh Tomato Soup",
          "image": "images/soup/tomato.jpg",
          "alt": "Garden Fresh Tomato Soup",
          "sizes": [
            { "label": "Half", "price": 60 },
            { "label": "Full", "price": 110 }
          ]
        },
        {
          "id": "mushroom-soup",
          "name": "Creamy Mushroom Delight",
          "image": "images/soup/mashroom.jpg",
          "alt": "Creamy Mushroom Delight",
          "sizes": [
            { "label": "Half", "price": 60 },
            { "label": "Full", "price": 110 }
          ]
        },
        {
          "id": "garlic-soup",
          "name": "Roasted Garlic Soup",
          "image": "images/soup/garlic.jpg",
          "alt": "Roasted Garlic Soup",
          "sizes": [
            { "label": "Half", "price": 60 },
            { "label": "Full", "price": 110 }
          ]
        }
      ]
    },
    {
      "id": "quick-bites",
      "name": "Quick Bites",
      "items": [
        {
          "id": "gobi65",
          "name": "Gobi 65",
          "image": "images/quickBites/gobi65.jpg",
          "alt": "Gobi 65",
          "sizes": [
            { "label": "Half", "price": 70 },
            { "label": "Full", "price": 120 }
          ]
        },
        {
          "id": "gobi-chilly",
          "name": "Gobi Chilly",
          "image": "images/quickBites/gobiChilly.jpg",
          "alt": "Gobi Chilly",
          "sizes": [
            { "label": "Half", "price": 60 },
            { "label": "Full", "price": 110 }
          ]
        },
        {
          "id": "gobi-manchurian",
          "name": "Gobi Manchurian",
          "image": "images/quickBites/gobimanchurian.jpg",
          "alt": "Gobi Manchurian",
          "sizes": [
            { "label": "Half", "price": 60 },
            { "label": "Full", "price": 110 }
          ]
        },
        {
          "id": "gobi-salt-pepper",
          "name": "Gobi Salt & Pepper",
          "image": "images/quickBites/gobiSaltAndPaper.jpg",
          "alt": "Gobi Salt & Pepper",
          "sizes": [
            { "label": "Half", "price": 60 },
            { "label": "Full", "price": 110 }
          ]
        },
        {
          "id": "paneer65",
          "name": "Paneer 65",
          "image": "images/quickBites/paneer65.jpg",
          "alt": "Paneer 65",
          "sizes": [
            { "label": "Half", "price": 100 },
            { "label": "Full", "price": 190 }
          ]
        },
        {
          "id": "paneer-chilly",
          "name": "Paneer Chilly",
          "image": "images/quickBites/paneerchilly.jpg",
          "alt": "Paneer Chilly",
          "sizes": [
            { "label": "Half", "price": 100 },
            { "label": "Full", "price": 190 }
          ]
        },
        {
          "id": "paneer-manchurian",
          "name": "Paneer Manchurian",
          "image": "images/quickBites/paneerManchuri.jpg",
          "alt": "Paneer Manchurian",
          "sizes": [
            { "label": "Half", "price": 100 },
            { "label": "Full", "price": 190 }
          ]
        },
        {
          "id": "paneer-salt-pepper",
          "name": "Paneer Salt & Pepper",
          "image": "images/quickBites/paneersaltandpaper.jpg",
          "alt": "Paneer Salt & Pepper",
          "sizes": [
            { "label": "Half", "price": 100 },
            { "label": "Full", "price": 190 }
          ]
        },
        {
          "id": "american-butter-corn",
          "name": "American Butter Corn",
          "image": "images/quickBites/americanbuttercorn.jpg",
          "alt": "American Butter Corn",
          "price": 99
        },
        {
          "id": "corn-basket",
          "name": "Corn Crunch Basket",
          "image": "images/quickBites/cornbasket.jpg",
          "alt": "Corn Crunch Basket",
          "price": 120
        },
        {
          "id": "french-fries",
          "name": "French Fries",
          "image": "images/quickBites/frenchfries.jpg",
          "alt": "French Fries",
          "price": 99,
          "addons": [
            { "label": "Masala", "price": 10 },
            { "label": "Peri-Peri", "price": 10 }
          ]
        }
      ]
    },
    {
      "id": "rice-noodles",
      "name": "Rice & Noodles",
      "items": [
        {
          "id": "schezwan-fried",
          "name": "Schezwan Fried Rice/Noodles",
          "image": "images/ricenoodles/sehezwan.jpg",
          "alt": "Schezwan Fried Rice/Noodles",
          "sizes": [
            { "label": "Half", "price": 80 },
            { "label": "Full", "price": 150 }
          ]
        },
        {
          "id": "chilli-garlic",
          "name": "Chilli Garlic Rice/Noodles",
          "image": "images/ricenoodles/chilly garlic.jpg",
          "alt": "Chilli Garlic Rice/Noodles",
          "sizes": [
            { "label": "Half", "price": 80 },
            { "label": "Full", "price": 150 }
          ]
        },
        {
          "id": "veg-fried",
          "name": "Veg Fried Rice/Noodles",
          "image": "images/ricenoodles/vegfried.jpg",
          "alt": "Veg Fried Rice/Noodles",
          "sizes": [
            { "label": "Half", "price": 70 },
            { "label": "Full", "price": 130 }
          ]
        },
        {
          "id": "hakka-noodles",
          "name": "Hakka Noodles",
          "image": "images/ricenoodles/hakkoNoodles.jpg",
          "alt": "Hakka Noodles",
          "sizes": [
            { "label": "Half", "price": 70 },
            { "label": "Full", "price": 130 }
          ]
        },
        {
          "id": "special-fried",
          "name": "Special Fried Rice/Noodles",
          "image": "images/ricenoodles/spcl.jpg",
          "alt": "Special Fried Rice/Noodles",
          "sizes": [
            { "label": "Half", "price": 90 },
            { "label": "Full", "price": 170 }
          ]
        }
      ]
    },
    {
      "id": "pasta",
      "name": "Pasta",
      "items": [
        {
          "id": "alfredo-pasta",
          "name": "Creamy Alfredo Pasta",
          "image": "images/pasta/alfredo-pasta.jpg",
          "alt": "Creamy Alfredo Pasta",
          "price": 150
        },
        {
          "id": "arrabiata-pasta",
          "name": "Arrabiata Fusion Pasta",
          "image": "images/pasta/arrabiate-pasta.jpg",
          "alt": "Arrabiata Fusion Pasta",
          "price": 150
        }
      ]
    },
    {
      "id": "rolls",
      "name": "Rolls",
      "items": [
        {
          "id": "kolkata-roll",
          "name": "Kolkata Style Veg Roll",
          "image": "images/rolls/kolkattaspcl.jpg",
          "alt": "Kolkata Style Veg Roll",
          "price": 99
        },
        {
          "id": "special-roll",
          "name": "Special Roll",
          "image": "images/rolls/spcl-roll.jpg",
          "alt": "Special Roll",
          "price": 150
        }
      ]
    },
    {
      "id": "pizza",
      "name": "Pizza",
      "items": [
        {
          "id": "margherita",
          "name": "Classic Margherita",
          "image": "images/pizza/margaretta.jpg",
          "alt": "Classic Margherita",
          "sizes": [
            { "label": "Small", "price": 99 },
            { "label": "Medium", "price": 150 }
          ]
        },
        {
          "id": "american-queen",
          "name": "American Queen",
          "image": "images/pizza/american-queen.jpg",
          "alt": "American Queen",
          "sizes": [
            { "label": "Small", "price": 120 },
            { "label": "Medium", "price": 170 }
          ]
        },
        {
          "id": "farmhouse",
          "name": "Farmhouse Feast",
          "image": "images/pizza/farmhouse.jpg",
          "alt": "Farmhouse Feast",
          "sizes": [
            { "label": "Small", "price": 130 },
            { "label": "Medium", "price": 180 }
          ]
        },
        {
          "id": "paneer-tikka-pizza",
          "name": "Paneer Tikka Pizza",
          "image": "images/pizza/paneertikka.jpg",
          "alt": "Paneer Tikka Pizza",
          "sizes": [
            { "label": "Small", "price": 130 },
            { "label": "Medium", "price": 180 }
          ]
        },
        {
          "id": "corn-cheese-pizza",
          "name": "Corn & Cheese Delight",
          "image": "images/pizza/corncheese.jpg",
          "alt": "Corn & Cheese Delight",
          "sizes": [
            { "label": "Small", "price": 120 },
            { "label": "Medium", "price": 170 }
          ]
        },
        {
          "id": "gobi-manchuri-pizza",
          "name": "Gobi Manchuri Pizza",
          "image": "images/pizza/gobimanchurianpizza.jpg",
          "alt": "Gobi Manchuri Pizza",
          "price": 130
        }
      ]
    },
    {
      "id": "burger",
      "name": "Burger",
      "items": [
        {
          "id": "classic-burger",
          "name": "Classic Veg Burger",
          "image": "images/burger/clasic.jpg",
          "alt": "Classic Veg Burger",
          "price": 99
        },
        {
          "id": "paneer-burger",
          "name": "Paneer Crunch Burger",
          "image": "images/burger/paneer.jpg",
          "alt": "Paneer Crunch Burger",
          "price": 120
        },
        {
          "id": "double-burger",
          "name": "Double Decker Burger",
          "image": "images/burger/doubledecker.jpg",
          "alt": "Double Decker Burger",
          "price": 180
        }
      ]
    },
    {
      "id": "sandwich",
      "name": "Sandwich",
      "items": [
        {
          "id": "grilled-sandwich",
          "name": "Grilled Veg Sandwich",
          "image": "images/sandwich/veggrill.jpg",
          "alt": "Grilled Veg Sandwich",
          "price": 100
        },
        {
          "id": "paneer-sandwich",
          "name": "Paneer Tikka Sandwich",
          "image": "images/sandwich/paneertikaa.jpg",
          "alt": "Paneer Tikka Sandwich",
          "price": 120
        },
        {
          "id": "bombay-sandwich",
          "name": "Bombay Masala Sandwich",
          "image": "images/sandwich/bombaymasal.jpg",
          "alt": "Bombay Masala Sandwich",
          "price": 120
        }
      ]
    },
    {
      "id": "momo",
      "name": "Momo",
      "items": [
        {
          "id": "veg-momos",
          "name": "Veg Momos",
          "image": "images/momo/momo.jpg",
          "alt": "Veg Momos",
          "sizes": [
            { "label": "Steamed", "price": 99 },
            { "label": "Fried", "price": 109 },
            { "label": "Schezwan", "price": 119 },
            { "label": "Cheesy", "price": 129 }
          ]
        }
      ]
    },
    {
      "id": "beverages",
      "name": "Beverages",
      "items": [
        {
          "id": "hot-coffee",
          "name": "Hot Coffee",
          "image": "images/brewerages/hotcoffe.jpg",
          "alt": "Hot Coffee",
          "sizes": [
            { "label": "Small", "price": 20 },
            { "label": "Medium", "price": 30 }
          ]
        },
        {
          "id": "cold-coffee",
          "name": "Cold Coffee",
          "image": "images/brewerages/coldcoffe.jpg",
          "alt": "Cold Coffee",
          "price": 70
        },
        {
          "id": "masala-chai",
          "name": "Masala Chai",
          "image": "images/brewerages/masalachai.jpg",
          "alt": "Masala Chai",
          "price": 20
        },
        {
          "id": "masala-coldrinks",
          "name": "Masala Coldrinks",
          "image": "images/brewerages/masalacoldrinks.jpg",
          "alt": "Masala Coldrinks",
          "price": 50
        }
      ]
    },
    {
      "id": "dessert",
      "name": "Dessert",
      "items": [
        {
          "id": "sizzling-brownie",
          "name": "Sizzling Brownie with Ice Cream",
          "image": "images/esserts/sizzlingbrownie.jpg",
          "alt": "Sizzling Brownie with Ice Cream",
          "price": 120
        },
        {
          "id": "gulab-jamun",
          "name": "Gulab Jamun with Ice Cream",
          "image": "images/esserts/gulabjamun.jpg",
          "alt": "Gulab Jamun with Ice Cream",
          "price": 99
        },
        {
          "id": "softy-icecream",
          "name": "Softy Ice Cream",
          "image": "images/esserts/softy.jpg",
          "alt": "Softy Ice Cream",
          "price": 20
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

function renderMenu() {
    if (!menuData) return;
    
    const container = document.getElementById('menuItemsContainer');
    container.innerHTML = '';
    
    menuData.categories.forEach((category, categoryIndex) => {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = `menu-category ${categoryIndex === 0 ? 'active' : ''}`;
        categoryDiv.id = category.id;
        
        const menuGrid = document.createElement('div');
        menuGrid.className = 'menu-grid';
        
        category.items.forEach(item => {
            const menuItem = createMenuItem(item, category.id);
            menuGrid.appendChild(menuItem);
        });
        
        categoryDiv.appendChild(menuGrid);
        container.appendChild(categoryDiv);
    });
    
    // Re-initialize order buttons after menu is rendered
    initOrderButtons();
    
    // Re-initialize menu categories for tab switching (after menu is loaded)
    // This will update cache references without re-adding event listeners
    initMenuCategories();
    
    // Re-observe menu items for scroll animations
    if (scrollAnimationsObserver) {
        setTimeout(() => {
            document.querySelectorAll('.menu-item').forEach(item => {
                if (item.style.opacity !== '1') {
                    item.style.opacity = '0';
                    item.style.transform = 'translateY(30px)';
                    item.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
                    scrollAnimationsObserver.observe(item);
                }
            });
        }, 100);
    }
}

function createMenuItem(item, categoryId) {
    const menuItem = document.createElement('div');
    menuItem.className = 'menu-item';
    menuItem.dataset.itemId = item.id;
    
    let priceHTML = '';
    let addonSelectorHTML = '';
    
    // Handle items with sizes (half/full or small/medium or momo options)
    if (item.sizes && item.sizes.length > 0) {
        // Show all prices
        const prices = item.sizes.map(s => s.price);
        const labels = item.sizes.map(s => s.label);
        
        if (prices.length === 2) {
            // For items with 2 options (Half/Full or Small/Medium)
            priceHTML = `<p class="price">₹${prices[0]} / ₹${prices[1]} <small>(${labels[0]} / ${labels[1]})</small></p>`;
        } else {
            // For items with multiple options (like momos with 4 options)
            const priceRange = prices.join(' / ₹');
            const labelRange = labels.join(' / ');
            priceHTML = `<p class="price">₹${priceRange} <small>(${labelRange})</small></p>`;
        }
    } else {
        // Single price item
        priceHTML = `<p class="price">₹${item.price}</p>`;
    }
    
    // Handle addons (for rolls and french fries)
    if (item.addons && item.addons.length > 0) {
        const addonOptions = item.addons.map((addon, index) => 
            `<label class="addon-option">
                <input type="checkbox" value="${addon.price}" data-label="${addon.label}" data-item-id="${item.id}">
                <span>${addon.label} ${addon.price > 0 ? `+₹${addon.price}` : ''}</span>
            </label>`
        ).join('');
        
        addonSelectorHTML = `
            <div class="addon-selector">
                <p class="addons-label">Add-ons:</p>
                <div class="addon-options">
                    ${addonOptions}
                </div>
            </div>
        `;
    }
    
    menuItem.innerHTML = `
        <div class="menu-item-image">
            <img src="${item.image}" alt="${item.alt}" loading="lazy">
        </div>
        <div class="menu-item-content">
            <h3>${item.name}</h3>
            ${priceHTML}
            ${addonSelectorHTML}
            <button class="order-btn" data-item-id="${item.id}">Add to Cart</button>
        </div>
    `;
    
    return menuItem;
}

// ============================================
// Size Selection Modal
// ============================================
function showSizeSelectionModal(item) {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.className = 'size-selection-modal';
    modal.id = 'sizeSelectionModal';
    
    // Create size buttons
    const sizeButtons = item.sizes.map(size => 
        `<button class="size-option-btn" data-label="${size.label}" data-price="${size.price}">
            ${size.label} - ₹${size.price}
        </button>`
    ).join('');
    
    modal.innerHTML = `
        <div class="size-modal-content">
            <div class="size-modal-header">
                <h3>Select Size for ${item.name}</h3>
                <button class="size-modal-close">&times;</button>
            </div>
            <div class="size-options">
                ${sizeButtons}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
    
    // Close modal handlers
    const closeBtn = modal.querySelector('.size-modal-close');
    const closeModal = () => {
        modal.remove();
        document.body.style.overflow = '';
    };
    
    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    
    // Size button handlers
    const sizeBtns = modal.querySelectorAll('.size-option-btn');
    sizeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const selectedSize = {
                label: btn.dataset.label,
                price: parseInt(btn.dataset.price)
            };
            closeModal();
            handleAddToCart(item, selectedSize);
        });
    });
    
    // Close on Escape key
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
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
// Order Button Handlers
// ============================================
function initOrderButtons() {
    const orderButtons = document.querySelectorAll('.order-btn');
    
    orderButtons.forEach(button => {
        button.addEventListener('click', () => {
            const itemId = button.dataset.itemId;
            
            // Find the item in menuData
            let item = null;
            for (const category of menuData.categories) {
                item = category.items.find(i => i.id === itemId);
                if (item) break;
            }
            
            if (!item) return;
            
            // If item has sizes, show size selection modal
            if (item.sizes && item.sizes.length > 0) {
                showSizeSelectionModal(item);
            } else {
                // No size selection needed, add directly to cart
                handleAddToCart(item);
            }
        });
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
    
    // Initialize map if not already done
    if (!map) {
        initMap();
    }
}

function initCheckoutModal() {
    const checkoutModal = document.getElementById('checkoutModal');
    const checkoutClose = document.getElementById('checkoutClose');
    const backToCartBtn = document.getElementById('backToCartBtn');
    const checkoutForm = document.getElementById('checkoutForm');
    const getLocationBtn = document.getElementById('getLocationBtn');
    
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
    
    getLocationBtn.addEventListener('click', getCurrentLocation);
    
    checkoutForm.addEventListener('submit', (e) => {
        e.preventDefault();
        placeOrder();
    });
}

// ============================================
// Location Services
// ============================================
function initMap() {
    const locationMap = document.getElementById('locationMap');
    
    // Check if Google Maps is available
    if (typeof google === 'undefined' || !google.maps) {
        locationMap.innerHTML = '<p style="padding: 2rem; text-align: center; color: var(--text-light);">Please add your Google Maps API key to enable map functionality. You can still enter your address manually.</p>';
        return;
    }
    
    try {
        // Initialize map centered on Kudachi
        map = new google.maps.Map(locationMap, {
            center: { lat: 16.1234, lng: 74.1234 }, // Approximate coordinates for Kudachi
            zoom: 15,
            mapTypeControl: false,
            streetViewControl: false
        });
        
        // Add marker
        marker = new google.maps.Marker({
            map: map,
            draggable: true
        });
        
        // Update location input when marker is dragged
        marker.addListener('dragend', () => {
            const position = marker.getPosition();
            updateLocationFromCoordinates(position.lat(), position.lng());
        });
        
        // Update marker when map is clicked
        map.addListener('click', (e) => {
            marker.setPosition(e.latLng);
            updateLocationFromCoordinates(e.latLng.lat(), e.latLng.lng());
        });
    } catch (error) {
        console.error('Error initializing map:', error);
        locationMap.innerHTML = '<p style="padding: 2rem; text-align: center; color: var(--text-light);">Map could not be loaded. Please enter your address manually.</p>';
    }
}

function getCurrentLocation() {
    const getLocationBtn = document.getElementById('getLocationBtn');
    getLocationBtn.textContent = '📍 Getting Location...';
    getLocationBtn.disabled = true;
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                
                updateLocationFromCoordinates(lat, lng);
                
                if (map) {
                    const location = new google.maps.LatLng(lat, lng);
                    map.setCenter(location);
                    marker.setPosition(location);
                }
                
                getLocationBtn.textContent = '📍 Get Current Location';
                getLocationBtn.disabled = false;
            },
            (error) => {
                alert('Unable to get your location. Please enter it manually.');
                getLocationBtn.textContent = '📍 Get Current Location';
                getLocationBtn.disabled = false;
            }
        );
    } else {
        alert('Geolocation is not supported by your browser. Please enter your location manually.');
        getLocationBtn.textContent = '📍 Get Current Location';
        getLocationBtn.disabled = false;
    }
}

function updateLocationFromCoordinates(lat, lng) {
    document.getElementById('latitude').value = lat;
    document.getElementById('longitude').value = lng;
    
    // Reverse geocode to get address
    if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
        try {
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: { lat, lng } }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    document.getElementById('deliveryLocation').value = results[0].formatted_address;
                }
            });
        } catch (error) {
            console.error('Geocoding error:', error);
        }
    }
}

// ============================================
// Place Order
// ============================================
function placeOrder() {
    const mobileNumber = document.getElementById('mobileNumber').value;
    const deliveryLocation = document.getElementById('deliveryLocation').value;
    const latitude = document.getElementById('latitude').value;
    const longitude = document.getElementById('longitude').value;
    
    if (!mobileNumber || !deliveryLocation) {
        alert('Please fill in all required fields');
        return;
    }
    
    // Build order message
    let message = `🍽️ *Order from Baloji's Cafe*\n\n`;
    message += `📱 *Mobile Number:* ${mobileNumber}\n`;
    message += `📍 *Delivery Location:* ${deliveryLocation}\n`;
    
    if (latitude && longitude) {
        const mapLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
        message += `🗺️ *Map Link:* ${mapLink}\n`;
    }
    
    message += `\n📋 *Order Details:*\n`;
    cart.forEach((item, index) => {
        message += `${index + 1}. ${item.name} × ${item.quantity} = ₹${item.price * item.quantity}\n`;
    });
    
    message += `\n💰 *Total Amount: ₹${getCartTotal()}*\n\n`;
    message += `Thank you for ordering from Baloji's Cafe! 🎉`;
    
    // Open WhatsApp
    const whatsappNumber = '919620538708';
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
// Scroll Animations
// ============================================
let scrollAnimationsObserver = null;
let scrollAnimationsInitialized = false;

function initScrollAnimations() {
    if (scrollAnimationsInitialized && scrollAnimationsObserver) return;
    
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    scrollAnimationsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                // Unobserve after animation to improve performance
                scrollAnimationsObserver.unobserve(entry.target);
            }
        });
    }, observerOptions);
    
    // Observe menu items (will be called after menu is rendered)
    function observeMenuItems() {
        document.querySelectorAll('.menu-item').forEach(item => {
            // Only observe if not already animated
            if (item.style.opacity !== '1') {
                item.style.opacity = '0';
                item.style.transform = 'translateY(30px)';
                item.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
                scrollAnimationsObserver.observe(item);
            }
        });
    }
    
    // Observe gallery items
    document.querySelectorAll('.gallery-item').forEach(item => {
        item.style.opacity = '0';
        item.style.transform = 'translateY(30px)';
        item.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        scrollAnimationsObserver.observe(item);
    });
    
    // Observe menu items after menu is loaded
    setTimeout(observeMenuItems, 100);
    
    scrollAnimationsInitialized = true;
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
    initGallery();
    initTestimonials();
    loadCart();
    initCartModal();
    initCheckoutModal();
    initLazyLoading();
    initScrollAnimations();
    initPerformanceOptimizations();
    
    // Add loaded class to body for CSS transitions
    document.body.classList.add('loaded');
});

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
