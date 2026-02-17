# Baloji's Cafe Website 🍕☕

A stunning, modern, and fully responsive website for Baloji's Cafe featuring a cinematic hero section, interactive menu, food gallery, testimonials, and contact information.

## 🎨 Features

- **Cinematic Hero Section** with video background
- **Interactive Menu** with smooth category switching
- **Food Gallery** with lightbox preview
- **Auto-sliding Testimonials** carousel
- **Contact Section** with Google Maps integration
- **Fully Responsive** design (mobile-first)
- **Smooth Animations** and transitions
- **WhatsApp Integration** for easy ordering
- **SEO Optimized** with schema markup
- **Performance Optimized** with lazy loading

## 🚀 Getting Started

### Prerequisites

- A modern web browser
- A local web server (optional, for development)

### Installation

1. Clone or download this repository
2. Open `index.html` in your web browser
3. For development, use a local server:
   ```bash
   # Using Python
   python -m http.server 8000
   
   # Using Node.js (http-server)
   npx http-server
   ```

## 📁 Project Structure

```
cafe-web/
├── index.html      # Main HTML file
├── styles.css      # All CSS styles and animations
├── script.js       # JavaScript functionality
└── README.md       # This file
```

## 🎯 Customization

### Video Background

Replace the video source in `index.html` (line ~45) with your own video:

```html
<source src="your-video.mp4" type="video/mp4">
```

**Recommended video specifications:**
- Format: MP4
- Resolution: 1920x1080 or higher
- Duration: 10-30 seconds (looping)
- Content: Pizza cheese pull, burger assembly, noodles, coffee pouring

### Google Maps

Update the Google Maps embed URL in `index.html` (line ~680) with your actual location coordinates:

1. Go to [Google Maps](https://www.google.com/maps)
2. Find your location
3. Click "Share" → "Embed a map"
4. Copy the iframe code and replace the existing one

### Menu Items

All menu items are in the HTML file. To add or modify items:

1. Find the relevant category section (e.g., `#soups`, `#pizza`)
2. Copy a menu item structure
3. Update the image, name, and price
4. Add your own food images or use Unsplash URLs

### Images

Replace placeholder images with your own:

- **Menu Items**: Update `src` attributes in `.menu-item-image img`
- **Gallery**: Update `src` attributes in `.gallery-item img`
- **Recommended**: Use WebP format for better performance

### Colors

Customize the color scheme in `styles.css` (CSS variables section):

```css
:root {
    --primary-red: #d32f2f;
    --primary-orange: #ff6b35;
    --cream-bg: #faf8f3;
    /* ... */
}
```

## 📱 Mobile Features

- **Touch Swipe**: Swipe left/right to switch menu categories
- **Responsive Navigation**: Hamburger menu for mobile
- **Optimized Images**: Lazy loading for better performance
- **Touch-Friendly**: Large tap targets and smooth scrolling

## 🔧 Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## 📞 Contact Information

Update contact details in the HTML:

- Phone numbers (lines ~700-710)
- Address (line ~715)
- Website URL (line ~720)
- WhatsApp number (multiple locations)

## 🎨 Design Features

- **Glassmorphism**: Frosted glass effects on navigation and category tabs
- **Smooth Animations**: Fade-in, slide-up, and hover effects
- **Modern Typography**: Playfair Display (headings) + Poppins (body)
- **Color Palette**: Red/orange accents with cream/beige backgrounds

## ⚡ Performance Tips

1. **Optimize Images**: Use WebP format and compress images
2. **Video Optimization**: Compress video file size while maintaining quality
3. **Lazy Loading**: Images load as you scroll (already implemented)
4. **CDN**: Consider using a CDN for faster loading

## 🐛 Troubleshooting

### Video not playing
- Check video file format (MP4 recommended)
- Ensure video file path is correct
- Check browser console for errors

### Menu categories not switching
- Check browser console for JavaScript errors
- Ensure all category IDs match between tabs and content

### Images not loading
- Verify image URLs are correct
- Check network connectivity
- Ensure images are accessible

## 📝 License

This project is created for Baloji's Cafe. All rights reserved.

## 🙏 Credits

- Fonts: Google Fonts (Playfair Display, Poppins)
- Images: Unsplash (replace with your own)
- Icons: Emoji (native browser support)

---

**Built with ❤️ for Baloji's Cafe**

*Eat. Sip. Repeat.*
