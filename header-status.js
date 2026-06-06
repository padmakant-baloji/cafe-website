/**
 * Header "Open now / Closed" status pill.
 *
 * Shared by pages that don't load the main ordering script (orders, profile).
 * Uses `/api/store-status` so partner hotels with their own hours are reflected.
 */
(function () {
  'use strict';

  var accepting = true;

  function render() {
    var pill = document.getElementById('topbarStatus');
    var label = document.getElementById('topbarStatusLabel');
    if (!pill || !label) return;
    pill.classList.toggle('app-topbar-status--closed', !accepting);
    label.textContent = accepting ? 'Open now' : 'Closed';
  }

  function fetchStoreStatus() {
    fetch('/api/store-status', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (status) {
        accepting = !status || status.acceptingOrders !== false;
        render();
      })
      .catch(function () {
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
