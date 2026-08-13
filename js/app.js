/* ==========================================================================
   app.js — shared across every page (Home, Wardrobe, History, ...)
   Owns: profile-menu open/close, and opening/closing the manage-account
   overlay so it works identically no matter which page the user is on.

   Include this on every page that has the sidebar, e.g.:
     <script src="../js/app.js" defer></script>
     <script src="../js/manageaccount/index.js" defer></script>
   ========================================================================== */

(() => {
  'use strict';

  const PANEL_PARTIAL_URL = '../partials/manage-account-panel.html';

  let overlay = null;       // cached reference once the panel has been injected
  let loadingPromise = null; // guards against double-fetching on rapid clicks

  function openPanel() {
    if (overlay) {
      overlay.classList.add('manage-overlay--open');
      return;
    }
    if (loadingPromise) return; // already fetching

    loadingPromise = fetch(PANEL_PARTIAL_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load manage-account panel (${res.status})`);
        return res.text();
      })
      .then((html) => {
        document.body.insertAdjacentHTML('beforeend', html);
        overlay = document.getElementById('manageOverlay');

        overlay.addEventListener('click', (event) => {
          if (event.target.closest('[data-manage-close]')) closePanel();
        });

        if (typeof window.initManageAccountPanel === 'function') {
          window.initManageAccountPanel(overlay);
        }

        // Two rAFs: the first lets the browser paint the freshly-injected
        // (closed) styles; only in the second do we add --open, so the
        // transition always has a real starting state to animate from.
        // A single rAF here is what caused the first-open "blink".
        requestAnimationFrame(() => {
          requestAnimationFrame(() => overlay.classList.add('manage-overlay--open'));
        });
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        loadingPromise = null;
      });
  }

  function closePanel() {
    if (overlay) overlay.classList.remove('manage-overlay--open');
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanel();
  });

  /* ------------------------------------------------------------------ */
  /* Sidebar profile menu                                                */
  /* ------------------------------------------------------------------ */
  const profileButton = document.querySelector('.sidebar__user');
  const profileMenu = document.getElementById('profileMenu');
  if (!profileButton || !profileMenu) return;

  const setMenuOpen = (open) => {
    profileMenu.classList.toggle('profile-menu--open', open);
    profileMenu.setAttribute('aria-hidden', String(!open));
    profileButton.setAttribute('aria-expanded', String(open));
  };

  profileButton.setAttribute('role', 'button');
  profileButton.setAttribute('tabindex', '0');
  profileButton.setAttribute('aria-expanded', 'false');
  profileButton.setAttribute('aria-controls', 'profileMenu');

  profileButton.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenuOpen(!profileMenu.classList.contains('profile-menu--open'));
  });

  profileButton.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setMenuOpen(!profileMenu.classList.contains('profile-menu--open'));
    }
  });

  profileMenu.addEventListener('click', (event) => {
    event.stopPropagation();

    if (event.target.closest('[data-profile-action="manage-account"]')) {
      event.preventDefault();
      setMenuOpen(false);
      openPanel();
      return;
    }

    if (event.target.closest('[data-profile-action="logout"]')) {
      // No auth yet — wire this up once a backend/session exists.
      setMenuOpen(false);
    }
  });

  document.addEventListener('click', () => setMenuOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenuOpen(false);
  });
})();