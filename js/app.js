/* ==========================================================================
   app.js — shared across every page (Home, Wardrobe, History, ...)
   Owns: the Clerk auth guard for this page, populating the sidebar/
   profile-menu identity from the signed-in Clerk user, wiring sign-out to
   Clerk, and the profile-menu open/close + manage-account overlay logic.

   Include this on every page that has the sidebar, e.g.:
     <script src="../js/auth.js"></script>
     <script src="../js/app.js" defer></script>
     <script src="../js/manageaccount/index.js" defer></script>
   ========================================================================== */

(() => {
  'use strict';

  const LOGIN_URL = 'loginpage.html';

  /* ------------------------------------------------------------------ */
  /* Auth guard — redirect to loginpage.html if there's no Clerk session,
     otherwise populate identity and reveal the page (see the inline
     visibility:hidden set at the top of index.html's <body>). */
  /* ------------------------------------------------------------------ */
  function populateIdentity(user) {
    if (!user) return;
    const name = user.fullName || user.firstName || 'Account';
    const email = (user.primaryEmailAddress && user.primaryEmailAddress.emailAddress) || '';
    const avatarUrl = user.imageUrl || '';

    document.querySelectorAll('.user-name').forEach((el) => { el.textContent = name; });
    document.querySelectorAll('.profile-menu__name').forEach((el) => { el.textContent = name; });
    document.querySelectorAll('.profile-menu__email').forEach((el) => { el.textContent = email; });
    document.querySelectorAll('.user-avatar img, .profile-menu__avatar img').forEach((img) => {
      if (avatarUrl) {
        img.src = avatarUrl;
        img.alt = name;
        img.style.display = '';
        img.parentElement.classList.remove('user-avatar--fallback');
      }
    });

    const heroName = document.querySelector('.hero__name');
    if (heroName) heroName.textContent = user.firstName || name;
  }

  (async () => {
    try {
      const clerk = await window.ShopAIAuth.ready;
      if (!clerk.isSignedIn) {
        window.location.href = LOGIN_URL;
        return;
      }
      populateIdentity(clerk.user);
      document.documentElement.style.visibility = '';
    } catch (err) {
      console.error('Clerk auth check failed:', err);
      window.location.href = LOGIN_URL;
    }
  })();

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
      setMenuOpen(false);
      (async () => {
        try {
          const clerk = window.ShopAIAuth.clerk || await window.ShopAIAuth.ready;
          await clerk.signOut();
        } catch (err) {
          console.error('Sign out failed:', err);
        } finally {
          window.location.href = LOGIN_URL;
        }
      })();
    }
  });

  document.addEventListener('click', () => setMenuOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenuOpen(false);
  });
})();