'use strict';

/**
 * Download / Install page logic.
 *
 * - Detects the visitor's OS (Android / iOS / Desktop).
 * - Android & desktop (Chromium): the Install button triggers the native PWA
 *   install dialog directly, shows live "Installing…" status, and once the
 *   `appinstalled` event fires it swaps to an "Open app" button.
 * - iOS (Safari has no programmatic install): shows "Add to Home Screen" steps.
 * - If the app is already installed (running standalone), shows the Open button.
 */
(function () {
  function byId(id) {
    return document.getElementById(id);
  }

  function show(el, on) {
    if (el) el.hidden = !on;
  }

  var promptWaitTimer = null;

  function isStandalone() {
    return (
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true
    );
  }

  function supportsInstallPrompt() {
    return 'onbeforeinstallprompt' in window;
  }

  function detectOS() {
    var ua = navigator.userAgent || '';
    var iOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (iOS) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
  }

  function isIOSSafari() {
    var ua = navigator.userAgent || '';
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
  }

  function setNote(message) {
    var note = byId('downloadNote');
    if (!note) return;
    if (message) {
      note.textContent = message;
      show(note, true);
    } else {
      show(note, false);
    }
  }

  /** Status pill: state = 'busy' (spinner) | 'done' (check) | 'hidden'. */
  function setStatus(state, message) {
    var wrap = byId('downloadStatus');
    var spinner = byId('downloadStatusSpinner');
    var check = byId('downloadStatusCheck');
    var text = byId('downloadStatusText');
    if (!wrap) return;
    if (state === 'hidden') {
      show(wrap, false);
      return;
    }
    if (text) text.textContent = message || '';
    show(spinner, state === 'busy');
    show(check, state === 'done');
    wrap.classList.toggle('download-status--done', state === 'done');
    show(wrap, true);
  }

  function setInstallLabel(label) {
    var l = byId('installBtnLabel');
    if (l) l.textContent = label;
  }

  function manualHint(os) {
    setNote(
      os === 'desktop'
        ? 'If nothing happens, use your browser menu → “Install Baloji’s Cafe”. (Chrome or Edge support one-tap install.)'
        : 'If nothing happens, open your browser menu (⋮) → “Install app” / “Add to Home screen”.'
    );
  }

  function showOpenButton() {
    show(byId('installBtn'), false);
    show(byId('openBtn'), true);
  }

  function onInstalled() {
    if (promptWaitTimer) {
      clearTimeout(promptWaitTimer);
      promptWaitTimer = null;
    }
    window.__deferredInstallPrompt = null;
    setStatus('done', 'Installed');
    setNote('');
    showOpenButton();
  }

  function renderIOS() {
    show(byId('downloadActions'), false);
    show(byId('iosSteps'), true);
    if (!isIOSSafari()) {
      setNote('Tip: open this page in Safari, then add the app to your home screen.');
    }
  }

  function renderInstallable(os) {
    var btn = byId('installBtn');
    show(byId('downloadActions'), true);

    function markReady() {
      if (promptWaitTimer) {
        clearTimeout(promptWaitTimer);
        promptWaitTimer = null;
      }
      if (btn) btn.disabled = false;
      setInstallLabel('Install app');
      setStatus('hidden');
      setNote('');
    }

    if (window.__deferredInstallPrompt) {
      markReady();
    } else if (supportsInstallPrompt()) {
      // The browser may fire the prompt a moment after load — wait briefly.
      setStatus('busy', 'Preparing install…');
      promptWaitTimer = setTimeout(function () {
        setStatus('hidden');
        manualHint(os);
      }, 4000);
    } else {
      // Browser without programmatic install (e.g. Firefox/Safari desktop).
      manualHint(os);
    }

    window.addEventListener('pwa-install-available', markReady);

    if (!btn) return;
    btn.addEventListener('click', function () {
      var dp = window.__deferredInstallPrompt;
      if (!dp) {
        manualHint(os);
        return;
      }
      setStatus('busy', 'Opening installer…');
      try {
        dp.prompt();
        Promise.resolve(dp.userChoice)
          .then(function (choice) {
            if (choice && choice.outcome === 'accepted') {
              // Native install accepted — wait for the appinstalled event.
              setStatus('busy', 'Installing…');
              setInstallLabel('Installing…');
              if (btn) btn.disabled = true;
            } else {
              setStatus('hidden');
              setNote('Installation cancelled — tap Install to try again.');
            }
          })
          .catch(function () {
            setStatus('hidden');
            manualHint(os);
          });
      } catch (err) {
        setStatus('hidden');
        manualHint(os);
      } finally {
        window.__deferredInstallPrompt = null;
      }
    });
  }

  function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    }

    var os = detectOS();

    // Always react to a real install, regardless of how it happened.
    window.addEventListener('pwa-installed', onInstalled);

    if (isStandalone()) {
      setStatus('done', 'Installed');
      showOpenButton();
      return;
    }

    if (os === 'ios') {
      renderIOS();
    } else {
      renderInstallable(os);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
