/* ==========================================================================
   js/auth.js — shared Clerk bootstrap, loaded on every page that needs to
   know whether a user is signed in (loginpage.html, index.html,
   sso-callback.html, and the manage-account panel it injects into).

   Loads Clerk's JS SDK straight from Clerk's CDN — the officially
   documented <script>-tag path for plain HTML/CSS/JS apps with no
   bundler (https://clerk.com/docs/js-frontend/getting-started/quickstart).
   No npm install, no build step.

   Exposes:
     window.ShopAIAuth.ready  -> Promise<Clerk>  (resolves once loaded)
     window.ShopAIAuth.clerk  -> Clerk instance   (set once ready resolves,
                                                    so later code can read
                                                    it synchronously)
   ========================================================================== */

(function () {
  'use strict';

  // -------------------------------------------------------------------
  // REQUIRED: paste your Clerk Publishable Key from the Clerk Dashboard
  // -> API keys (starts with pk_test_ or pk_live_). This is the public
  // key — safe for frontend code. NEVER put the Secret Key here.
  // -------------------------------------------------------------------
  const CLERK_PUBLISHABLE_KEY = 'pk_test_dG9wLXNwaWRlci00LmNsZXJrLmFjY291bnRzLmRldiQ';

  const CLERK_JS_VERSION = '6';

  function deriveFrontendApi(publishableKey) {
    const encoded = publishableKey.split('_')[2];
    if (!encoded) throw new Error('Invalid Clerk publishable key format.');
    return atob(encoded).slice(0, -1);
  }

  function loadClerk() {
    return new Promise((resolve, reject) => {
      if (!CLERK_PUBLISHABLE_KEY || CLERK_PUBLISHABLE_KEY.includes('REPLACE_ME')) {
        reject(new Error('Set CLERK_PUBLISHABLE_KEY in js/auth.js before using authentication.'));
        return;
      }

      let frontendApi;
      try {
        frontendApi = deriveFrontendApi(CLERK_PUBLISHABLE_KEY);
      } catch (err) {
        reject(err);
        return;
      }

      const script = document.createElement('script');
      script.src = `https://${frontendApi}/npm/@clerk/clerk-js@${CLERK_JS_VERSION}/dist/clerk.browser.js`;
      script.setAttribute('data-clerk-publishable-key', CLERK_PUBLISHABLE_KEY);
      script.crossOrigin = 'anonymous';
      script.async = true;

      script.onload = async () => {
        try {
          await window.Clerk.load();
          window.ShopAIAuth.clerk = window.Clerk;
          resolve(window.Clerk);
        } catch (err) {
          reject(err);
        }
      };
      script.onerror = () => reject(new Error('Failed to load the Clerk SDK script.'));

      document.head.appendChild(script);
    });
  }

  window.ShopAIAuth = {
    ready: loadClerk(),
    clerk: null,
  };
})();