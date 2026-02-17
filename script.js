// ============================================
// DOM Elements
// ============================================
const navbar = document.getElementById('navbar');
const hamburger = document.getElementById('hamburger');
const navMenu = document.getElementById('navMenu');
const darkModeToggle = document.getElementById('darkModeToggle');
const categoryTabs = document.querySelectorAll('.category-tab');
const menuCategories = document.querySelectorAll('.menu-category');
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
// Dark Mode Toggle
// ============================================
function initDarkMode() {
    const isDarkMode = localStorage.getItem('darkMode') === 'true';
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
    }
    
    darkModeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
    });
}

// ============================================
// Sticky Navigation
// ============================================
function initStickyNav() {
    let lastScroll = 0;
    
    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;
        
        if (currentScroll > 100) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
        
        lastScroll = currentScroll;
    });
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
                    behavior: 'smooth'
                });
            }
        });
    });
}

// ============================================
// Active Nav Link on Scroll
// ============================================
function initActiveNavLink() {
    const sections = document.querySelectorAll('section[id]');
    
    window.addEventListener('scroll', () => {
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
    });
}

// ============================================
// Menu Category Switching
// ============================================
function initMenuCategories() {
    let touchStartX = 0;
    let touchEndX = 0;
    let currentCategoryIndex = 0;
    
    const categories = Array.from(menuCategories);
    const tabs = Array.from(categoryTabs);
    
    function switchCategory(index) {
        // Remove active class from all categories and tabs
        menuCategories.forEach(cat => cat.classList.remove('active'));
        categoryTabs.forEach(tab => tab.classList.remove('active'));
        
        // Add active class to selected category and tab
        categories[index].classList.add('active');
        tabs[index].classList.add('active');
        
        // Scroll to top of menu section
        const menuSection = document.getElementById('menu');
        if (menuSection) {
            const offsetTop = menuSection.offsetTop - 80;
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }
        
        // Scroll active tab into view (for mobile)
        tabs[index].scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center'
        });
        
        currentCategoryIndex = index;
    }
    
    // Tab click handlers
    categoryTabs.forEach((tab, index) => {
        tab.addEventListener('click', () => {
            switchCategory(index);
        });
    });
    
    // Touch swipe support for mobile
    const menuContainer = document.querySelector('.menu-items-container');
    if (menuContainer) {
        menuContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        });
        
        menuContainer.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        });
    }
    
    function handleSwipe() {
        const swipeThreshold = 50;
        const diff = touchStartX - touchEndX;
        
        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0 && currentCategoryIndex < categories.length - 1) {
                // Swipe left - next category
                switchCategory(currentCategoryIndex + 1);
            } else if (diff < 0 && currentCategoryIndex > 0) {
                // Swipe right - previous category
                switchCategory(currentCategoryIndex - 1);
            }
        }
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' && currentCategoryIndex > 0) {
            switchCategory(currentCategoryIndex - 1);
        } else if (e.key === 'ArrowRight' && currentCategoryIndex < categories.length - 1) {
            switchCategory(currentCategoryIndex + 1);
        }
    });
}

// ============================================
// Sticky Category Tabs
// ============================================
function initStickyCategoryTabs() {
    const menuSection = document.getElementById('menu');
    if (!menuSection) return;
    
    window.addEventListener('scroll', () => {
        const menuTop = menuSection.offsetTop;
        const scrollY = window.pageYOffset;
        
        if (scrollY >= menuTop - 80) {
            categoryTabsContainer.style.position = 'sticky';
        } else {
            categoryTabsContainer.style.position = 'relative';
        }
    });
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
    // Extract numeric price (handle formats like "₹50 / ₹80" or "₹99")
    const priceMatch = price.match(/₹(\d+)/);
    const itemPrice = priceMatch ? parseInt(priceMatch[1]) : 0;
    
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
// Order Button Handlers
// ============================================
function initOrderButtons() {
    const orderButtons = document.querySelectorAll('.order-btn');
    
    orderButtons.forEach(button => {
        button.addEventListener('click', () => {
            const menuItem = button.closest('.menu-item');
            const itemName = menuItem.querySelector('h3').textContent;
            const price = menuItem.querySelector('.price').textContent;
            
            addToCart(itemName, price);
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
function initScrollAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
    // Observe menu items
    document.querySelectorAll('.menu-item').forEach(item => {
        item.style.opacity = '0';
        item.style.transform = 'translateY(30px)';
        item.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(item);
    });
    
    // Observe gallery items
    document.querySelectorAll('.gallery-item').forEach(item => {
        item.style.opacity = '0';
        item.style.transform = 'translateY(30px)';
        item.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(item);
    });
}

// ============================================
// Performance Optimization
// ============================================
function initPerformanceOptimizations() {
    // Debounce function for scroll events
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
    
    // Throttle function for scroll events
    function throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
    
    // Optimize scroll handlers
    const optimizedScrollHandler = throttle(() => {
        // Scroll-based functions here
    }, 100);
    
    window.addEventListener('scroll', optimizedScrollHandler);
}

// ============================================
// Initialize Everything
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initDarkMode();
    initStickyNav();
    initMobileMenu();
    initSmoothScroll();
    initActiveNavLink();
    initMenuCategories();
    initStickyCategoryTabs();
    initGallery();
    initTestimonials();
    loadCart();
    initOrderButtons();
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
