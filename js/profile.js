/* ==========================================================================
   js/profile.js — the style profile, in one place
   ==========================================================================
   The Manage Account panel collects 33 fields about how someone dresses.
   Until now every one of them was written to Clerk metadata and then went
   nowhere: the chat request carried only { message, history, images }, so
   the stylist answered every person identically no matter what they had
   filled in.

   This module is the missing link. It owns:

     FIELDS        the registry — key, label, section and weight for every
                   profile field, so the panel and the AI agree on what
                   exists and what matters
     read()        the stored profile, Clerk metadata first, local second
     brief()       a compact object for the request body: set fields only,
                   trimmed and capped, so we never ship empty keys or an
                   unbounded payload
     completeness()  what is filled, what it is worth, and the highest-value
                   thing still missing

   Exposed as window.ShopAIProfile. No dependencies, safe to load anywhere,
   and every accessor degrades to a sane empty value rather than throwing —
   a profile that fails to load must never take the composer down with it.
   ========================================================================== */

(function () {
  'use strict';

  var STORAGE_PREFIX = 'shopAIProfile';

  /* ------------------------------------------------------------------
     FIELD REGISTRY

     weight is how much a field changes the quality of a recommendation,
     and it drives both the completeness score and which gap we surface
     next:

       3  the stylist is guessing without it
       2  meaningfully sharpens what it suggests
       1  useful colour, not load-bearing
     ------------------------------------------------------------------ */

  var SECTIONS = [
    { id: 'basic',          title: 'About you',   caption: 'Sets the baseline — who the stylist is dressing.' },
    { id: 'fit',            title: 'Body & fit',  caption: 'Lets Shop AI rule out anything that will not fit you.' },
    { id: 'style',          title: 'Style',       caption: 'The biggest lever on what gets recommended.' },
    { id: 'lifestyle',      title: 'Lifestyle',   caption: 'Where the clothes actually have to work.' },
    { id: 'shopping',       title: 'Shopping',    caption: 'Keeps suggestions inside your budget and your shops.' },
    { id: 'ai-preferences', title: 'How it answers', caption: 'Tunes the stylist’s tone and what it leads with.' }
  ];

  var FIELDS = [
    // identity
    { key: 'displayName', label: 'Name',                 section: 'identity', weight: 0 },
    { key: 'bio',         label: 'Bio',                  section: 'identity', weight: 1 },

    // about you
    { key: 'age',         label: 'Age',                  section: 'basic', weight: 2 },
    { key: 'gender',      label: 'Gender',               section: 'basic', weight: 3 },
    { key: 'city',        label: 'City',                 section: 'basic', weight: 2 },
    { key: 'country',     label: 'Country',              section: 'basic', weight: 1 },
    { key: 'workStatus',  label: 'Work',                 section: 'basic', weight: 1 },

    // body & fit
    { key: 'height',      label: 'Height',               section: 'fit', weight: 1 },
    { key: 'weight',      label: 'Weight',               section: 'fit', weight: 1 },
    { key: 'bodyType',    label: 'Body type',            section: 'fit', weight: 3 },
    { key: 'topSize',     label: 'Top size',             section: 'fit', weight: 3 },
    { key: 'bottomSize',  label: 'Bottom size',          section: 'fit', weight: 3 },
    { key: 'shoeSize',    label: 'Shoe size',            section: 'fit', weight: 2 },

    // style
    { key: 'primaryStyle',           label: 'Primary style',    section: 'style', weight: 3 },
    { key: 'secondaryStyles',        label: 'Secondary styles', section: 'style', weight: 1 },
    { key: 'favoriteColors',         label: 'Favourite colours',section: 'style', weight: 2 },
    { key: 'colorsToAvoid',          label: 'Colours to avoid', section: 'style', weight: 2 },
    { key: 'preferredFits',          label: 'Preferred fits',   section: 'style', weight: 2 },
    { key: 'preferredClothingTypes', label: 'Clothing types',   section: 'style', weight: 1 },
    { key: 'favoriteBrands',         label: 'Favourite brands', section: 'style', weight: 1 },
    { key: 'brandsToAvoid',          label: 'Brands to avoid',  section: 'style', weight: 1 },

    // lifestyle
    { key: 'commonOccasions',    label: 'Common occasions', section: 'lifestyle', weight: 2 },
    { key: 'dressCode',          label: 'Dress code',       section: 'lifestyle', weight: 2 },
    { key: 'climatePreference',  label: 'Climate',          section: 'lifestyle', weight: 1 },

    // shopping
    { key: 'priceRange',          label: 'Price range',     section: 'shopping', weight: 3 },
    { key: 'clothingBudget',      label: 'Budget',          section: 'shopping', weight: 2 },
    { key: 'preferredBrands',     label: 'Preferred brands',section: 'shopping', weight: 1 },
    { key: 'shoppingPlatforms',   label: 'Where you shop',  section: 'shopping', weight: 1 },
    { key: 'wardrobePreference',  label: 'Wardrobe approach', section: 'shopping', weight: 1 },

    // how it answers
    { key: 'recommendationStyle', label: 'Answer style',    section: 'ai-preferences', weight: 1 },
    { key: 'aiPriorities',        label: 'What to prioritise', section: 'ai-preferences', weight: 1 },
    { key: 'explicitLikes',       label: 'Always consider', section: 'ai-preferences', weight: 1 },
    { key: 'explicitDislikes',    label: 'Never suggest',   section: 'ai-preferences', weight: 2 }
  ];

  var BY_KEY = {};
  FIELDS.forEach(function (f) { BY_KEY[f.key] = f; });

  /* ------------------------------------------------------------------
     VALUE HELPERS
     ------------------------------------------------------------------ */

  // A field counts as answered only if it holds real content. Empty
  // strings, empty arrays and the placeholder values the demo markup
  // ships with ("Not set", "None selected") all read as unanswered —
  // otherwise the completeness score congratulates people for blanks.
  var PLACEHOLDERS = ['', 'not set', 'none selected', 'none added', 'none', '—', '-', 'select'];

  function isAnswered(value) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.filter(isAnswered).length > 0;
    var text = String(value).trim();
    if (!text) return false;
    return PLACEHOLDERS.indexOf(text.toLowerCase()) === -1;
  }

  function clean(value) {
    if (Array.isArray(value)) {
      return value
        .map(function (v) { return String(v).trim(); })
        .filter(function (v) { return isAnswered(v); })
        .slice(0, 12);            // a tag list should inform, not flood
    }
    return String(value).trim().slice(0, 240);
  }

  /* ------------------------------------------------------------------
     READ

     Clerk metadata is the source of truth because it follows the account
     across devices. localStorage is the offline fallback, and is also
     what makes the profile available on first paint before Clerk has
     finished loading.
     ------------------------------------------------------------------ */

  function currentUser() {
    try {
      return (window.ShopAIAuth && window.ShopAIAuth.clerk && window.ShopAIAuth.clerk.user) || null;
    } catch (err) {
      return null;
    }
  }

  function storageKey(user) {
    return STORAGE_PREFIX + ':' + (user && user.id ? user.id : 'guest');
  }

  function read() {
    var user = currentUser();

    try {
      var fromClerk = user && user.unsafeMetadata && user.unsafeMetadata.shopAIProfile;
      if (fromClerk && typeof fromClerk === 'object') return Object.assign({}, fromClerk);
    } catch (err) { /* fall through to local */ }

    try {
      var raw = localStorage.getItem(storageKey(user));
      if (raw) return JSON.parse(raw) || {};
    } catch (err) { /* unreadable or private mode */ }

    return {};
  }

  /* ------------------------------------------------------------------
     BRIEF — what actually rides along with a chat request
     ------------------------------------------------------------------ */

  function brief(profile) {
    var source = profile || read();
    var out = {};

    FIELDS.forEach(function (field) {
      if (field.key === 'displayName') return;   // the stylist does not need a name to dress you
      var value = source[field.key];
      if (!isAnswered(value)) return;
      out[field.key] = clean(value);
    });

    return out;
  }

  function isEmpty(obj) {
    for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) return false; }
    return true;
  }

  /* ------------------------------------------------------------------
     COMPLETENESS

     Weighted, so filling in your sizes moves the needle further than
     filling in your preferred climate — and so the gap we point at next
     is genuinely the most useful thing left to answer.
     ------------------------------------------------------------------ */

  function completeness(profile) {
    var source = profile || read();
    var earned = 0;
    var possible = 0;
    var missing = [];

    FIELDS.forEach(function (field) {
      if (!field.weight) return;
      possible += field.weight;
      if (isAnswered(source[field.key])) {
        earned += field.weight;
      } else {
        missing.push(field);
      }
    });

    missing.sort(function (a, b) { return b.weight - a.weight; });

    return {
      percent: possible ? Math.round((earned / possible) * 100) : 0,
      earned: earned,
      possible: possible,
      answered: FIELDS.filter(function (f) { return f.weight && isAnswered(source[f.key]); }).length,
      total: FIELDS.filter(function (f) { return f.weight; }).length,
      missing: missing,
      next: missing.slice(0, 3)
    };
  }

  // Per-section progress, for the section headers in the panel.
  function sectionProgress(profile) {
    var source = profile || read();
    var out = {};
    SECTIONS.forEach(function (section) {
      var fields = FIELDS.filter(function (f) { return f.section === section.id && f.weight; });
      out[section.id] = {
        answered: fields.filter(function (f) { return isAnswered(source[f.key]); }).length,
        total: fields.length
      };
    });
    return out;
  }

  window.ShopAIProfile = {
    FIELDS: FIELDS,
    SECTIONS: SECTIONS,
    byKey: function (key) { return BY_KEY[key] || null; },
    read: read,
    brief: brief,
    isAnswered: isAnswered,
    isEmpty: isEmpty,
    completeness: completeness,
    sectionProgress: sectionProgress
  };
})();
