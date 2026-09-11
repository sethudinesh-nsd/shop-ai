/* ==========================================================================
   js/manageaccount/settings-nav.js
   ==========================================================================
   Rebuilds the panel's left rail as a System Settings sidebar.

   It was two tabs — Profile and Security — above a large empty column, with
   all seven Profile sections stacked into one long scroll on the right. That
   is not how Settings works. Settings puts every category in the sidebar and
   shows one of them at a time, with a search field at the top that finds a
   setting wherever it lives.

   So: an account row first, then the profile categories, then Security. Pick
   one and the detail pane shows that category alone. Type in the search field
   and it searches across all of them, showing the matching rows with the
   category they came from.

   Built on the existing markup — the same .manage-card sections, the same
   rows, the same tab panels. Nothing about how a field saves changes.
   ========================================================================== */

(function () {
  'use strict';

  var ICONS = {
    account:
      '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c1.4-3.6 4.2-5.5 7-5.5s5.6 1.9 7 5.5"/>',
    basic:
      '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
    fit:
      '<path d="M12 3v18M8 6l4-3 4 3M6 10h12M7 10v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-8"/>',
    style:
      '<path d="M12 3 14 9l6 2-6 2-2 6-2-6-6-2 6-2z"/>',
    lifestyle:
      '<path d="M3 21h18M5 21V8l7-5 7 5v13M10 21v-6h4v6"/>',
    shopping:
      '<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    'ai-preferences':
      '<path d="M12 4a8 8 0 1 0 8 8"/><path d="M12 8v4l3 2"/><path d="M18 3v4M16 5h4"/>',
    security:
      '<path d="M12 3l7 3v5.5c0 4.6-3 8.2-7 9.5-4-1.3-7-4.9-7-9.5V6z"/>'
  };

  function icon(name) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || ICONS.basic) +
      '</svg>'
    );
  }

  /* ------------------------------------------------------------------
     What the sidebar lists. Profile categories map to the .manage-card
     sections already in the markup; Security is the other tab panel.
     ------------------------------------------------------------------ */
  function buildModel(root) {
    var items = [{ id: 'account', label: 'Account', tab: 'profile', cards: ['identity'], account: true }];

    var titles = {
      basic: 'About you',
      fit: 'Body & fit',
      style: 'Style',
      lifestyle: 'Lifestyle',
      shopping: 'Shopping',
      'ai-preferences': 'How it answers'
    };

    Object.keys(titles).forEach(function (card) {
      if (root.querySelector('#tab-profile .manage-card[data-card="' + card + '"]')) {
        items.push({ id: card, label: titles[card], tab: 'profile', cards: [card] });
      }
    });

    if (root.querySelector('#tab-security')) {
      items.push({ id: 'security', label: 'Security', tab: 'security', cards: null, divided: true });
    }

    return items;
  }

  function buildSidebar(items) {
    var html =
      '<div class="settings-search">' +
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
             'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
          '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>' +
        '</svg>' +
        '<input type="search" class="settings-search__input" placeholder="Search" ' +
               'aria-label="Search settings" data-settings-search />' +
      '</div>' +
      '<div class="settings-list" role="tablist">';

    items.forEach(function (item) {
      html +=
        (item.divided ? '<div class="settings-list__divider"></div>' : '') +
        '<button type="button" class="settings-item' + (item.account ? ' settings-item--account' : '') + '" ' +
                'data-settings-item="' + item.id + '" role="tab" aria-selected="false">' +
          (item.account
            ? '<span class="settings-item__avatar" data-settings-avatar>' +
                '<img alt="" onerror="this.style.display=\'none\'" />' +
              '</span>'
            : '<span class="settings-item__icon">' + icon(item.id) + '</span>') +
          '<span class="settings-item__text">' +
            '<span class="settings-item__label" data-settings-label>' + item.label + '</span>' +
            (item.account ? '<span class="settings-item__sub" data-settings-sub></span>' : '') +
          '</span>' +
          '<span class="settings-item__count" data-settings-count></span>' +
        '</button>';
    });

    html += '</div>';
    return html;
  }

  /* ------------------------------------------------------------------
     Selection: show one category, hide the rest
     ------------------------------------------------------------------ */
  function select(ctx, id) {
    var item = ctx.items.filter(function (i) { return i.id === id; })[0];
    if (!item) return;

    ctx.current = id;
    ctx.root.querySelectorAll('[data-settings-item]').forEach(function (b) {
      var on = b.dataset.settingsItem === id;
      b.classList.toggle('settings-item--active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    // Swap tab panel when crossing between Profile and Security.
    ctx.root.querySelectorAll('.manage-section').forEach(function (section) {
      var on = section.id === 'tab-' + item.tab;
      section.classList.toggle('manage-section--active', on);
    });

    // The old tab buttons still drive some of the panel's own logic, so keep
    // them in step rather than leaving a stale aria-selected behind them.
    ctx.root.querySelectorAll('.manage-tab[data-tab]').forEach(function (t) {
      var on = t.dataset.tab === item.tab;
      t.classList.toggle('manage-tab--active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    if (item.tab === 'profile') {
      ctx.root.querySelectorAll('#tab-profile .manage-card').forEach(function (card) {
        card.hidden = item.cards.indexOf(card.dataset.card) === -1;
      });
      // Profile strength belongs with the account, not with every category.
      var strength = ctx.root.querySelector('[data-profile-strength]');
      if (strength) strength.hidden = !item.account;
    }

    var scroller = ctx.root.querySelector('.manage-content');
    if (scroller) scroller.scrollTop = 0;
  }

  /* ------------------------------------------------------------------
     Search: find a row wherever it lives
     ------------------------------------------------------------------ */
  function search(ctx, term) {
    var q = term.trim().toLowerCase();
    var results = ctx.root.querySelector('[data-settings-results]');

    if (!q) {
      if (results) results.hidden = true;
      ctx.root.querySelector('.manage-content').classList.remove('manage-content--searching');
      select(ctx, ctx.current || 'account');
      return;
    }

    ctx.root.querySelector('.manage-content').classList.add('manage-content--searching');
    ctx.root.querySelectorAll('#tab-profile .manage-card').forEach(function (c) { c.hidden = true; });
    var strength = ctx.root.querySelector('[data-profile-strength]');
    if (strength) strength.hidden = true;

    if (!results) {
      results = document.createElement('div');
      results.className = 'settings-results';
      results.setAttribute('data-settings-results', '');
      ctx.root.querySelector('#tab-profile').appendChild(results);
    }
    results.hidden = false;
    results.innerHTML = '';

    var found = 0;
    ctx.root.querySelectorAll('#tab-profile .manage-field[data-field]').forEach(function (field) {
      var label = field.querySelector('.manage-field__label');
      var text = label ? label.textContent.trim() : '';
      if (!text || text.toLowerCase().indexOf(q) === -1) return;

      var card = field.closest('.manage-card');
      var section = card
        ? (card.querySelector('.manage-card__title') || {}).textContent || ''
        : '';

      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'settings-result';
      row.innerHTML =
        '<span class="settings-result__label"></span>' +
        '<span class="settings-result__where"></span>';
      row.querySelector('.settings-result__label').textContent = text;
      row.querySelector('.settings-result__where').textContent = section.trim();
      row.addEventListener('click', function () {
        var input = ctx.root.querySelector('[data-settings-search]');
        if (input) input.value = '';
        select(ctx, card ? card.dataset.card : 'account');
        setTimeout(function () {
          field.scrollIntoView({ behavior: 'smooth', block: 'center' });
          field.classList.add('manage-field--spotlight');
          setTimeout(function () { field.classList.remove('manage-field--spotlight'); }, 1500);
        }, 60);
      });
      results.appendChild(row);
      found += 1;
    });

    if (!found) {
      var empty = document.createElement('p');
      empty.className = 'settings-results__empty';
      empty.textContent = 'No results';
      results.appendChild(empty);
    }
  }

  /* ------------------------------------------------------------------
     Per-category progress, shown the way Settings shows a badge
     ------------------------------------------------------------------ */
  function refreshCounts(ctx) {
    var api = window.ShopAIProfile;
    if (!api) return;
    var progress = api.sectionProgress();

    ctx.items.forEach(function (item) {
      if (!item.cards || item.account) return;
      var stat = progress[item.id];
      var badge = ctx.root.querySelector(
        '[data-settings-item="' + item.id + '"] [data-settings-count]'
      );
      if (!badge || !stat || !stat.total) return;
      var left = stat.total - stat.answered;
      badge.textContent = left ? String(left) : '';
      badge.classList.toggle('settings-item__count--visible', left > 0);
    });
  }

  function refreshAccount(ctx) {
    var nameEl = ctx.root.querySelector('.manage-profile__name, #manageProfileName');
    var emailEl = ctx.root.querySelector('#manageProfileEmail');
    var avatar = ctx.root.querySelector('.manage-avatar img');

    var label = ctx.root.querySelector('[data-settings-item="account"] [data-settings-label]');
    var sub = ctx.root.querySelector('[data-settings-item="account"] [data-settings-sub]');
    var img = ctx.root.querySelector('[data-settings-avatar] img');

    if (label && nameEl && nameEl.textContent.trim()) label.textContent = nameEl.textContent.trim();
    if (sub && emailEl) sub.textContent = emailEl.textContent.trim();
    if (img && avatar && avatar.src) { img.src = avatar.src; img.style.display = ''; }
  }

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */
  function attach(root) {
    if (!root || root.dataset.settingsNav) return;
    var nav = root.querySelector('.manage-nav');
    var tabs = root.querySelector('.manage-tabs');
    if (!nav || !tabs) return;
    root.dataset.settingsNav = '1';

    var ctx = { root: root, items: buildModel(root), current: 'account' };

    // The original tab buttons still back some of the panel's own logic, so
    // they stay in the DOM — moved out of sight rather than deleted.
    tabs.classList.add('manage-tabs--hidden');

    var host = document.createElement('div');
    host.className = 'settings-nav';
    host.innerHTML = buildSidebar(ctx.items);
    tabs.insertAdjacentElement('afterend', host);

    nav.classList.add('manage-nav--settings');

    host.querySelectorAll('[data-settings-item]').forEach(function (button) {
      button.addEventListener('click', function () {
        var input = root.querySelector('[data-settings-search]');
        if (input && input.value) input.value = '';
        var results = root.querySelector('[data-settings-results]');
        if (results) results.hidden = true;
        root.querySelector('.manage-content').classList.remove('manage-content--searching');
        select(ctx, button.dataset.settingsItem);
      });
    });

    var input = host.querySelector('[data-settings-search]');
    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var value = input.value;
      timer = setTimeout(function () { search(ctx, value); }, 90);
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { input.value = ''; search(ctx, ''); input.blur(); }
    });

    select(ctx, 'account');
    refreshCounts(ctx);
    refreshAccount(ctx);

    document.addEventListener('shopai:profile-change', function () {
      refreshCounts(ctx);
      refreshAccount(ctx);
    });
    root.addEventListener('input', function () { refreshCounts(ctx); }, true);
    root.addEventListener('click', function () {
      setTimeout(function () { refreshCounts(ctx); refreshAccount(ctx); }, 150);
    }, true);
  }

  function boot() {
    var root = document.getElementById('manageOverlay') || document.querySelector('.manage-overlay');
    if (root && root.querySelector('.manage-nav')) { attach(root); return true; }
    return false;
  }

  if (!boot()) {
    var observer = new MutationObserver(function () { if (boot()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
