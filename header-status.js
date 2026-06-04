/**
 * Header "Open now / Closed" status pill.
 *
 * Shared by pages that don't load the main ordering script (orders, profile).
 * Mirrors the logic in script.js: the cafe is "Open now" only when BOTH the
 * online ordering window (9 AM–10 PM IST) is open AND the admin store status
 * (`/api/store-status` → acceptingOrders) is accepting orders.
 */
(function () {
  'use strict';

  var IST_TZ = 'Asia/Kolkata';
  var START_SEC = 9 * 3600;
  var END_SEC = 22 * 3600;
  var accepting = true;

  function secondsSinceMidnightIST(date) {
    var dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: IST_TZ,
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    var h = 0;
    var m = 0;
    var s = 0;
    dtf.formatToParts(date).forEach(function (p) {
      if (p.type === 'hour') h = parseInt(p.value, 10) || 0;
      else if (p.type === 'minute') m = parseInt(p.value, 10) || 0;
      else if (p.type === 'second') s = parseInt(p.value, 10) || 0;
    });
    return h * 3600 + m * 60 + s;
  }

  function isWindowOpen() {
    var sec = secondsSinceMidnightIST(new Date());
    return sec >= START_SEC && sec < END_SEC;
  }

  function render() {
    var pill = document.getElementById('topbarStatus');
    var label = document.getElementById('topbarStatusLabel');
    if (!pill || !label) return;
    var open = isWindowOpen() && accepting;
    pill.classList.toggle('app-topbar-status--closed', !open);
    label.textContent = open ? 'Open now' : 'Closed';
  }

  function fetchStoreStatus() {
    fetch('/api/store-status', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (status) {
        accepting = !status || status.acceptingOrders !== false;
        render();
      })
      .catch(function () {
        // Never block on a failed status check.
        accepting = true;
        render();
      });
  }

  function initScrollShadow() {
    var navbar = document.getElementById('navbar');
    if (!navbar) return;
    var ticking = false;
    function update() {
      navbar.classList.toggle('scrolled', window.pageYOffset > 100);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    }, { passive: true });
    update();
  }

  function init() {
    render();
    fetchStoreStatus();
    initScrollShadow();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') fetchStoreStatus();
    });
    // Re-evaluate the time window roughly each minute so the pill flips at open/close.
    setInterval(render, 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
