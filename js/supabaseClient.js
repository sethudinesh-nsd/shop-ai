/* ==========================================================================
   js/supabaseClient.js — shared Supabase client, loaded on any page that
   reads/writes Supabase data (wardrobe, chat history, profile).

   Loads @supabase/supabase-js from a CDN — same no-bundler approach as
   js/auth.js. Must load AFTER js/auth.js, since it awaits
   window.ShopAIAuth.ready to get the Clerk instance.

   Uses Supabase's native third-party auth (Clerk) integration via the
   `accessToken` client option — no Clerk JWT template needed. Requires:
   Clerk Dashboard -> Configure -> Integrations -> Supabase (enabled), and
   Supabase Dashboard -> Authentication -> Sign In / Providers ->
   Third Party Auth -> Clerk (issuer URL from the Clerk integration screen).

   Exposes:
     window.ShopAISupabase.ready  -> Promise<SupabaseClient>
     window.ShopAISupabase.client -> SupabaseClient (set once ready resolves)
   ========================================================================== */

(function () {
  'use strict';

  // Public, safe to expose in frontend code (this is the "publishable" key,
  // not the service_role secret — RLS policies do the real access control).
  const SUPABASE_URL = 'https://wqqwjhcuqeatbtkwhzcv.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_vuXTMo1lCmSfT-NgvR7W1g_61EbKmOu';
  const SUPABASE_JS_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';

  function loadSupabaseSdk() {
    return new Promise((resolve, reject) => {
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        resolve(window.supabase);
        return;
      }
      const script = document.createElement('script');
      script.src = SUPABASE_JS_CDN;
      script.async = true;
      script.onload = () => resolve(window.supabase);
      script.onerror = () => reject(new Error('Failed to load the Supabase SDK script.'));
      document.head.appendChild(script);
    });
  }

  // ------------------------------------------------------------------
  // PROFILE SYNC — mirrors the signed-in Clerk user into a `profiles`
  // row in Supabase (see profiles_table.sql), so name/email/avatar/bio
  // are queryable from SQL instead of living only inside Clerk.
  // ------------------------------------------------------------------
  async function syncProfileToSupabase(client, clerkUser, extraProfile) {
    if (!client || !clerkUser) return;
    try {
      const shopAIProfile =
        extraProfile || (clerkUser.unsafeMetadata && clerkUser.unsafeMetadata.shopAIProfile) || {};

      const row = {
        clerk_user_id: clerkUser.id,
        email: (clerkUser.primaryEmailAddress && clerkUser.primaryEmailAddress.emailAddress) || null,
        first_name: clerkUser.firstName || null,
        last_name: clerkUser.lastName || null,
        avatar_url: clerkUser.imageUrl || null,
        bio: shopAIProfile.bio || null,
        updated_at: new Date().toISOString(),
      };

      /* The whole style profile, not just the bio.
         This used to persist `bio` and nothing else, which meant the other
         32 fields someone filled in lived only in Clerk metadata and this
         browser's localStorage — so they could not be read server-side and
         a person who cleared their site data lost the lot. It goes in as a
         single jsonb column rather than 33 columns: the field list is still
         moving, and one column means one migration instead of one per new
         question we decide to ask. */
      const styleProfile =
        window.ShopAIProfile && typeof window.ShopAIProfile.brief === 'function'
          ? window.ShopAIProfile.brief(shopAIProfile)
          : shopAIProfile;

      const hasStyleProfile = styleProfile && Object.keys(styleProfile).length > 0;
      if (hasStyleProfile) row.style_profile = styleProfile;

      let { error } = await client
        .from('profiles')
        .upsert(row, { onConflict: 'clerk_user_id' });

      /* If the style_profile column has not been added yet, keep the rest of
         the sync working instead of failing the whole write. The migration
         lives in supabase/migrations/ — until it is applied, the app degrades
         to the old behaviour rather than silently losing the identity sync
         too. */
      if (error && hasStyleProfile && /style_profile/i.test(error.message || '')) {
        console.warn(
          'Supabase: profiles.style_profile column is missing — syncing identity only. ' +
            'Apply supabase/migrations/0001_profiles_style_profile.sql to persist the full profile.'
        );
        delete row.style_profile;
        ({ error } = await client
          .from('profiles')
          .upsert(row, { onConflict: 'clerk_user_id' }));
      }

      if (error) throw error;
    } catch (err) {
      console.error('Profile sync to Supabase failed:', err && err.message ? err.message : err, err);
    }
  }

  async function createSupabaseClient() {
    const [supabaseSdk, clerk] = await Promise.all([
      loadSupabaseSdk(),
      window.ShopAIAuth.ready,
    ]);

    const client = supabaseSdk.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      accessToken: async () => {
        try {
          return (await clerk.session?.getToken()) ?? null;
        } catch (err) {
          console.error('Failed to get Clerk session token for Supabase:', err);
          return null;
        }
      },
    });

    window.ShopAISupabase.client = client;

    // Fire-and-forget: don't block page load on this round trip.
    if (clerk.user) syncProfileToSupabase(client, clerk.user);

    return client;
  }

  window.ShopAISupabase = {
    ready: createSupabaseClient(),
    client: null,
    // Call after saving profile changes (e.g. from manageaccount/index.js)
    // to push them into Supabase immediately instead of waiting for the
    // next page load's automatic sync.
    syncProfile: async (clerkUser, extraProfile) => {
      const client = window.ShopAISupabase.client || (await window.ShopAISupabase.ready);
      return syncProfileToSupabase(client, clerkUser, extraProfile);
    },
  };
})();