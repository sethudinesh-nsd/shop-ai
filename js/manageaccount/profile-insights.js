/* ==========================================================================
   js/manageaccount/profile-insights.js
   ==========================================================================
   Adds the one thing the Profile tab was missing: a sense of how much of it
   is filled in, and a way to get to the most useful gap.

   Written to Settings' rules, not a dashboard's. Settings never explains
   itself — there is no prose under a section header telling you what the
   section is for, because a row labelled "Shoe size" does not need a
   caption. So this contributes exactly one group at the top of the tab: a
   labelled row with a value, a hairline rule, and one more row that behaves
   like every other row in the list.

   It decorates; it never owns state. Every value still lives in the same
   inputs, chips and tag lists that readFields() reads, so saving is
   untouched.
   ========================================================================== */

(function () {
  'use strict';

  var PLACEHOLDER = /^(not set|none selected|none added|none|—|-|select)$/i;

  function api() {
    return window.ShopAIProfile || null;
  }

  /* ------------------------------------------------------------------
     Reads the profile straight off the DOM rather than from storage, so
     the number stays honest while someone is mid-edit and nothing has
     been saved yet.
     ------------------------------------------------------------------ */
  function keyFor(dataField) {
    return dataField === 'name'
      ? 'displayName'
      : dataField.replace(/-([a-z0-9])/g, function (_, c) { return c.toUpperCase(); });
  }

  function readFromDom(root) {
    var scope = root.querySelector('#tab-profile') || root;
    var profile = {};

    scope.querySelectorAll('.manage-field[data-field]').forEach(function (field) {
      var name = field.dataset.field;
      if (!name) return;
      var key = keyFor(name);

      if (field.classList.contains('manage-field--chip')) {
        var group = field.querySelector('[data-chip-group]');
        if (!group) return;
        var selected = Array.prototype.map.call(
          group.querySelectorAll('.manage-field__chip--selected'),
          function (b) { return b.textContent.trim(); }
        );
        profile[key] = group.dataset.chipMode === 'multi' ? selected : (selected[0] || '');
        return;
      }

      if (field.classList.contains('manage-field--tags')) {
        var list = field.querySelector('[data-tag-list]');
        profile[key] = list
          ? Array.prototype.map.call(list.children, function (el) { return el.dataset.tagText || ''; })
          : [];
        return;
      }

      var control = field.querySelector(
        '.manage-field__input, .manage-field__select, .manage-field__textarea'
      );
      if (control) profile[key] = control.value;
    });

    return profile;
  }

  /* ------------------------------------------------------------------
     The group
     ------------------------------------------------------------------ */

  function build() {
    var el = document.createElement('section');
    el.className = 'profile-strength';
    el.setAttribute('data-profile-strength', '');
    el.innerHTML =
      '<div class="profile-strength__row">' +
        '<span class="profile-strength__label">Profile strength</span>' +
        '<span class="profile-strength__value" data-ps-value>0%</span>' +
      '</div>' +
      '<div class="profile-strength__track" role="progressbar" ' +
           'aria-valuemin="0" aria-valuemax="100" aria-label="Profile strength" data-ps-track>' +
        '<span class="profile-strength__fill" data-ps-fill></span>' +
      '</div>' +
      '<button type="button" class="profile-strength__next" data-ps-next hidden>' +
        '<span data-ps-next-label></span>' +
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
             'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="m9 18 6-6-6-6"/>' +
        '</svg>' +
      '</button>';
    return el;
  }

  /* Takes you to the row that matters next: scrolls it to the middle of
     the panel, opens it, and leaves a brief highlight so the row you were
     sent to is obvious on arrival. */
  function jumpTo(root, fieldKey) {
    var dataField = fieldKey === 'displayName'
      ? 'name'
      : fieldKey.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });

    var field = root.querySelector('.manage-field[data-field="' + dataField + '"]');
    if (!field) return;

    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field.classList.add('manage-field--spotlight');
    setTimeout(function () { field.classList.remove('manage-field--spotlight'); }, 1500);

    setTimeout(function () {
      var opener =
        field.querySelector('[data-dob-trigger]') ||
        field.querySelector('.manage-field__body') ||
        field;
      opener.click();
      var input = field.querySelector(
        '.manage-field__input:not([type="hidden"]), .manage-field__textarea, .manage-field__select'
      );
      if (input && typeof input.focus === 'function') input.focus();
    }, 400);
  }

  /* ------------------------------------------------------------------
     Rows: an unanswered row should read as somewhere to go
     ------------------------------------------------------------------ */

  function decorateRows(root, profile) {
    var api_ = api();
    if (!api_) return;

    root.querySelectorAll('#tab-profile .manage-field[data-field]').forEach(function (field) {
      var key = keyFor(field.dataset.field);
      var answered = api_.isAnswered(profile[key]);

      field.classList.toggle('manage-field--empty', !answered);

      // "None selected", in the same grey as a real answer, makes a blank
      // look like a value — and eight in a row look like the page failed to
      // load. Safe to rewrite: readFields() reads the inputs, chips and tag
      // lists, never this label.
      var value = field.querySelector('.manage-field__value');
      if (value && !answered) {
        var text = value.textContent.trim();
        if (!text || PLACEHOLDER.test(text)) value.textContent = 'Add';
      }
    });
  }

  /* ------------------------------------------------------------------
     Render
     ------------------------------------------------------------------ */

  function render(root) {
    var api_ = api();
    var tab = root.querySelector('#tab-profile');
    if (!api_ || !tab) return;

    var profile = readFromDom(root);
    var stats = api_.completeness(profile);

    var group = tab.querySelector('[data-profile-strength]');
    if (!group) {
      group = build();
      var identity = tab.querySelector('.manage-card[data-card="identity"]');
      if (identity && identity.nextSibling) {
        identity.parentNode.insertBefore(group, identity.nextSibling);
      } else {
        tab.insertBefore(group, tab.firstChild);
      }
      group.querySelector('[data-ps-next]').addEventListener('click', function () {
        if (this.dataset.target) jumpTo(root, this.dataset.target);
      });
    }

    group.querySelector('[data-ps-value]').textContent = stats.percent + '%';
    group.querySelector('[data-ps-track]').setAttribute('aria-valuenow', String(stats.percent));
    group.querySelector('[data-ps-fill]').style.width = stats.percent + '%';
    group.classList.toggle('profile-strength--complete', stats.percent >= 100);

    var next = stats.next[0];
    var button = group.querySelector('[data-ps-next]');
    if (next) {
      button.hidden = false;
      button.querySelector('[data-ps-next-label]').textContent = 'Add ' + next.label.toLowerCase();
      button.dataset.target = next.key;
    } else {
      button.hidden = true;
      button.removeAttribute('data-target');
    }

    decorateRows(root, profile);
  }

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */

  var scheduled = null;
  function schedule(root) {
    clearTimeout(scheduled);
    scheduled = setTimeout(function () { render(root); }, 120);
  }

  function attach(root) {
    if (!root || root.dataset.psAttached) return;
    root.dataset.psAttached = '1';

    render(root);

    document.addEventListener('shopai:profile-change', function () { schedule(root); });

    ['click', 'input', 'change'].forEach(function (type) {
      root.addEventListener(type, function (event) {
        if (event.target.closest && event.target.closest('#tab-profile')) schedule(root);
      }, true);
    });
  }

  function boot() {
    var root = document.getElementById('manageOverlay') || document.querySelector('.manage-overlay');
    if (root) { attach(root); return true; }
    return false;
  }

  if (!boot()) {
    var observer = new MutationObserver(function () { if (boot()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.ShopAIProfileInsights = { render: render };
})();
