/* ==========================================================================
   js/app.js — the application-shell controller.

   Owns: Clerk auth guard, identity population, sidebar profile menu,
   manage-account overlay, and the SPA router (Home <-> Wardrobe <-> History)
   using the History API. Page-specific behavior stays in script.js /
   wardrobe.js / history.js — this file only mounts/unmounts their view and
   calls their init()/destroy() lifecycle hooks.
   ========================================================================== */

(() => {
  'use strict';

  const LOGIN_URL = 'loginpage.html';
  const PANEL_PARTIAL_URL = '../partials/manage-account-panel.html';

  // View registry — maps a nav key to the page that owns it, the global
  // module it exposes, and the script that defines that module.
  const VIEWS = {
    home:     { url: 'index.html',    module: 'ShopAIHome',     script: '../js/script.js' },
    wardrobe: { url: 'wardrobe.html', module: 'ShopAIWardrobe', script: '../js/wardrobe.js' },
    history:  { url: 'history.html',  module: 'ShopAIHistory',  script: '../js/history.js' },
  };

  let currentView = null;
  let currentUser = null;
  let navigating = false;

  /* ------------------------------------------------------------------ */
  /* Identity — called once after auth resolves, and again after every
     view mount so freshly-swapped-in markup (e.g. Home's greeting) gets
     the signed-in user's name/email/avatar too.                        */
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
      currentUser = clerk.user;
      populateIdentity(currentUser);
      document.documentElement.style.visibility = '';
      initRouter();
    } catch (err) {
      console.error('Clerk auth check failed:', err);
      window.location.href = LOGIN_URL;
    }
  })();

  /* ------------------------------------------------------------------ */
  /* Manage-account overlay — unchanged architecture: fetch the partial,
     parse it, clone #manageOverlay, inject once, then just toggle it.   */
  /* ------------------------------------------------------------------ */
  let overlay = null;
  let loadingPromise = null;

  function openPanel() {
    if (overlay) {
      overlay.classList.add('manage-overlay--open');
      return;
    }
    if (loadingPromise) return;

    loadingPromise = fetch(PANEL_PARTIAL_URL, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load manage-account panel (${res.status})`);
        return res.text();
      })
      .then((html) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const fetchedOverlay = doc.getElementById('manageOverlay');

        if (!fetchedOverlay) {
          throw new Error('Manage account panel: #manageOverlay was not found.');
        }

        overlay = fetchedOverlay.cloneNode(true);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (event) => {
          if (event.target.closest('[data-manage-close]')) closePanel();
        });

        if (typeof window.initManageAccountPanel === 'function') {
          window.initManageAccountPanel(overlay);
        }

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
  /* Sidebar profile menu — lives in the persistent shell, wired once.   */
  /* ------------------------------------------------------------------ */
  const profileButton = document.querySelector('.sidebar__user');
  const profileMenu = document.getElementById('profileMenu');

  function setMenuOpen(open) {
    if (!profileMenu || !profileButton) return;
    profileMenu.classList.toggle('profile-menu--open', open);
    profileMenu.setAttribute('aria-hidden', String(!open));
    profileButton.setAttribute('aria-expanded', String(open));
  }

  if (profileButton && profileMenu) {
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
  }

  /* ======================================================================
     ROUTER — Home <-> Wardrobe <-> History without a full page reload.
     ====================================================================== */

  function viewFromPath(pathname) {
    const file = pathname.split('/').pop();
    for (const [key, cfg] of Object.entries(VIEWS)) {
      if (cfg.url === file) return key;
    }
    return 'home';
  }

  function getModule(name) {
    return window[name];
  }

  function setActiveNav(view) {
    document.querySelectorAll('.nav-item[data-nav]').forEach((item) => {
      item.classList.toggle('nav-item--active', item.dataset.nav === view);
    });
  }

  // Copies any <link rel="stylesheet">, <style>, or head <script src> the
  // target view needs but the current document doesn't have yet (e.g.
  // wardrobe.css only ships on wardrobe.html). Additive only — never removes
  // anything already loaded, so assets accumulate safely across navigations.
  function ensureHeadAssets(doc) {
    // Track any stylesheet we actually add so the caller can wait for it —
    // otherwise the swapped-in HTML paints unstyled for a frame (FOUC/blink)
    // before the CSS arrives.
    const cssLoadPromises = [];

    doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      const href = link.getAttribute('href');
      if (!href) return;
      const exists = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .some((l) => l.getAttribute('href') === href);
      if (!exists) {
        const clone = document.createElement('link');
        clone.rel = 'stylesheet';
        clone.href = href;
        cssLoadPromises.push(new Promise((resolve) => {
          clone.onload = resolve;
          clone.onerror = resolve; // don't block navigation forever on a bad/missing CSS file
        }));
        document.head.appendChild(clone);
      }
    });

    doc.querySelectorAll('style').forEach((styleEl) => {
      const already = Array.from(document.querySelectorAll('style[data-shopai-view]'))
        .some((s) => s.textContent === styleEl.textContent);
      if (!already) {
        const clone = document.createElement('style');
        clone.setAttribute('data-shopai-view', 'true');
        clone.textContent = styleEl.textContent;
        document.head.appendChild(clone);
      }
    });

    doc.head.querySelectorAll('script[src]').forEach((s) => {
      const src = s.getAttribute('src');
      if (!src) return;
      const exists = Array.from(document.querySelectorAll('script[src]'))
        .some((el) => el.getAttribute('src') === src);
      if (!exists) {
        const clone = document.createElement('script');
        clone.src = src;
        if (s.crossOrigin) clone.crossOrigin = s.crossOrigin;
        document.head.appendChild(clone);
      }
    });

    return cssLoadPromises;
  }

  // Loads a view's own module script exactly once — re-declaring a classic
  // script's top-level const/let a second time throws, so if the tag is
  // already on the page (either from the initial HTML or a previous
  // navigation) we just resolve immediately instead of re-injecting it.
  function ensureScriptLoaded(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(el);
    });
  }

  async function mountView(view, doc) {
    const cssLoadPromises = ensureHeadAssets(doc);

    const mainEl = document.querySelector('main.main');
    const newMain = doc.querySelector('main.main');
    if (!mainEl || !newMain) throw new Error(`main.main not found for view "${view}"`);

    // Hide before swapping so any newly-added stylesheet has time to apply
    // before the view is visible — mirrors the initial-load visibility trick.
    mainEl.style.visibility = 'hidden';
    if (cssLoadPromises.length) await Promise.all(cssLoadPromises);

    // Bring over any <template> the view needs (e.g. Home's #messageTemplate)
    // that isn't already sitting in the live document.
    doc.querySelectorAll('template[id]').forEach((tpl) => {
      if (!document.getElementById(tpl.id)) {
        document.body.appendChild(document.importNode(tpl, true));
      }
    });

    mainEl.className = newMain.className;
    mainEl.innerHTML = newMain.innerHTML;

    if (doc.title) document.title = doc.title;
    setActiveNav(view);

    const cfg = VIEWS[view];
    await ensureScriptLoaded(cfg.script);

    const mod = getModule(cfg.module);
    if (mod && typeof mod.init === 'function') mod.init();

    populateIdentity(currentUser);

    // Reveal on the next frame so layout has settled before it's shown —
    // avoids a second visible jump on top of the CSS-load wait above.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { mainEl.style.visibility = ''; });
    });
  }

  async function navigateTo(view, { push = true } = {}) {
    if (!VIEWS[view] || navigating) return;
    if (push && view === currentView) return;
    navigating = true;

    setMenuOpen(false);
    closePanel();

   const prevCfg = currentView ? VIEWS[currentView] : null;
    if (prevCfg) {
      const prevMod = getModule(prevCfg.module);
      if (prevMod && typeof prevMod.destroy === 'function') {
        try { prevMod.destroy(); } catch (err) { console.error(err); }
      }
    }

    // Hide the outgoing view right away — otherwise it stays fully visible
    // while cfg.url is being fetched (noticeable on slow connections), and
    // only gets hidden once mountView finally runs.
    const mainEl = document.querySelector('main.main');
    if (mainEl) mainEl.style.visibility = 'hidden';

    const cfg = VIEWS[view];
    try {
      const res = await fetch(cfg.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load ${cfg.url} (${res.status})`);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      await mountView(view, doc);
      currentView = view;
      if (push) history.pushState({ view }, '', cfg.url);
      document.dispatchEvent(new CustomEvent('shopai:view-mounted', { detail: { view } }));
    } catch (err) {
      console.error('Navigation failed, falling back to full reload:', err);
      window.location.href = cfg.url;
    } finally {
      navigating = false;
    }
  }

  function initRouter() {
    currentView = viewFromPath(window.location.pathname);
    history.replaceState({ view: currentView }, '', window.location.pathname);
    setActiveNav(currentView);

    const nav = document.querySelector('.sidebar__nav');
    if (nav) {
      nav.addEventListener('click', (e) => {
        const item = e.target.closest('.nav-item[data-nav]');
        if (!item || !VIEWS[item.dataset.nav]) return;
        e.preventDefault();

        const view = item.dataset.nav;
        if (view === currentView) {
          // Already on this view — let it reset itself if it supports that
          // (Home clears an in-progress chat back to the empty state).
          const mod = getModule(VIEWS[view].module);
          if (mod && typeof mod.reset === 'function') mod.reset();
          return;
        }
        navigateTo(view);
      });
    }

    window.addEventListener('popstate', (e) => {
      const view = (e.state && e.state.view) || viewFromPath(window.location.pathname);
      navigateTo(view, { push: false });
    });

    // The current page's own module script already ran synchronously
    // (it's a plain, non-deferred <script> tag) and defined its module by
    // now — this is the one and only call to its init() for this load.
    const cfg = VIEWS[currentView];
    const mod = getModule(cfg.module);
    if (mod && typeof mod.init === 'function') mod.init();
  }
})();