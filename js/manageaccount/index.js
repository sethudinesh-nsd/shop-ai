/* ==========================================================================
   js/manageaccount/index.js
   Shop AI — Manage Account
   ========================================================================== */

(function () {
  'use strict';

  const PROFILE_KEY = 'shopAIProfile';

  /* ------------------------------------------------------------------
     LOCAL PROFILE STORAGE
     ------------------------------------------------------------------ */

  function getProfileKey(user) {
    return `${PROFILE_KEY}:${user && user.id ? user.id : 'guest'}`;
  }

  function getStoredProfile(user) {
    try {
      const clerkProfile =
        user &&
        user.unsafeMetadata &&
        user.unsafeMetadata.shopAIProfile;

      if (clerkProfile && typeof clerkProfile === 'object') {
        return { ...clerkProfile };
      }

      const local = localStorage.getItem(
        getProfileKey(user)
      );

      return local ? JSON.parse(local) : {};

    } catch {
      return {};
    }
  }

  /* ------------------------------------------------------------------
     IDENTITY
     ------------------------------------------------------------------ */

  function displayName(user, profile) {
    return (
      profile.displayName ||
      user.fullName ||
      user.firstName ||
      'Account'
    );
  }

  function populateIdentity(root, user, profile = {}) {

    const nameEl =
      root.querySelector('#manageProfileName');

    const nameInput =
      root.querySelector('#manageProfileNameInput');

    const emailEl =
      root.querySelector('#manageProfileEmail');

    const bioEl =
      root.querySelector('#manageProfileBio');

    const bioInput =
      root.querySelector('#manageProfileBioInput');

    const avatarImg =
      root.querySelector('.manage-avatar img');

    if (!user) {
      if (nameEl) {
        nameEl.textContent = 'Signed out';
      }

      return;
    }

    const name =
      displayName(user, profile);

    const bio =
      profile.bio || '';

    const email =
      user.primaryEmailAddress &&
      user.primaryEmailAddress.emailAddress
        ? user.primaryEmailAddress.emailAddress
        : '';

    const avatarUrl =
      user.imageUrl || '';

    if (nameEl) {
      nameEl.textContent = name;
    }

    if (nameInput) {
      nameInput.value = name;
    }

    if (emailEl) {
      emailEl.textContent = email;
    }

    if (bioEl) {
      bioEl.textContent =
        bio || 'Add a short bio so Shop AI (and anyone who sees your profile) knows your style.';
    }

    if (bioInput) {
      bioInput.value = bio;
    }

    if (avatarImg) {

      if (avatarUrl) {

        avatarImg.src =
          `${avatarUrl}${avatarUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;

        avatarImg.alt = name;
        avatarImg.style.display = '';

      } else {

        avatarImg.removeAttribute('src');
        avatarImg.style.display = 'none';

      }
    }
  }

  /* ------------------------------------------------------------------
     TABS
     ------------------------------------------------------------------ */

  function activateTab(root, target) {

    const tabs =
      Array.from(
        root.querySelectorAll('.manage-tab')
      );

    tabs.forEach((item) => {

      const active =
        item.getAttribute('data-tab') === target;

      item.classList.toggle(
        'manage-tab--active',
        active
      );

      item.setAttribute(
        'aria-selected',
        String(active)
      );

    });

    root
      .querySelectorAll('.manage-section')
      .forEach((section) => {

        section.classList.toggle(
          'manage-section--active',
          section.id === `tab-${target}`
        );

      });

  }

  function initTabs(root) {

    const tabs =
      Array.from(
        root.querySelectorAll('.manage-tab')
      );

    if (!tabs.length) return;

    tabs.forEach((tab) => {

      tab.addEventListener('click', () => {

        activateTab(
          root,
          tab.getAttribute('data-tab')
        );

      });

      // Standard ARIA tablist keyboard pattern: Left/Right (and
      // Up/Down, since the rail is vertical on desktop) move focus
      // between tabs and activate the newly focused one, matching
      // how the chip-picker option groups already behave.
      tab.addEventListener('keydown', (event) => {

        const key = event.key;
        const isNext = key === 'ArrowRight' || key === 'ArrowDown';
        const isPrev = key === 'ArrowLeft' || key === 'ArrowUp';

        if (!isNext && !isPrev) return;

        event.preventDefault();

        const currentIndex = tabs.indexOf(tab);
        const delta = isNext ? 1 : -1;
        const nextIndex =
          (currentIndex + delta + tabs.length) % tabs.length;

        const nextTab = tabs[nextIndex];
        nextTab.focus();
        activateTab(root, nextTab.getAttribute('data-tab'));

      });

    });

  }

  /*
   * The panel is only initialized once and then stays mounted in
   * the DOM (closing just toggles manage-overlay--open) so that
   * reopening is instant. That means tab selection would otherwise
   * carry over from whatever the person was last looking at. This
   * watches the overlay's open state and always resets to Profile
   * each time it's opened, without app.js needing to know about it.
   */
  function watchOverlayOpen(root) {

    const overlay =
      (root.classList && root.classList.contains('manage-overlay'))
        ? root
        : root.querySelector('.manage-overlay') || root.closest('.manage-overlay');

    if (!overlay) return;

    const observer = new MutationObserver((mutations) => {

      for (const mutation of mutations) {

        if (
          mutation.attributeName === 'class' &&
          overlay.classList.contains('manage-overlay--open')
        ) {
          activateTab(root, 'profile');
          break;
        }

      }

    });

    observer.observe(overlay, {
      attributes: true,
      attributeFilter: ['class']
    });

  }

  /* ------------------------------------------------------------------
     REVERIFICATION
     ------------------------------------------------------------------
     Clerk requires a fresh "reverification" (re-entering your
     password, within the last 10 minutes) before sensitive actions --
     changing your password, connecting/disconnecting an external
     account, revoking a device, deleting the account. See:
     https://clerk.com/docs/guides/secure/reverification

     This app is plain JS (no React), so the useReverification() hook
     isn't available -- this is the same flow built by hand on top of
     clerk.session.startVerification()/attemptFirstFactorVerification().
     withReverification() wraps any sensitive Clerk call: it runs the
     call, and if Clerk comes back asking for reverification, it opens
     the password modal and retries the call once the person verifies.
     ------------------------------------------------------------------ */

  function isReverificationError(error) {

    if (!error) return false;

    const code =
      error.code ||
      (error.errors && error.errors[0] && error.errors[0].code) ||
      '';

    if (/reverif/i.test(code)) return true;

    const message =
      error.message ||
      (error.errors && error.errors[0] && (error.errors[0].longMessage || error.errors[0].message)) ||
      '';

    return /additional verification/i.test(message);

  }

  function requestReverification(root, state) {

    const modal = root.querySelector('[data-reverify-modal]');
    const input = root.querySelector('[data-reverify-password]');
    const hint = root.querySelector('[data-reverify-hint]');
    const submit = root.querySelector('[data-reverify-submit]');

    return new Promise((resolve, reject) => {

      if (!modal || !input || !submit) {
        reject(new Error('Reverification isn\u2019t available right now.'));
        return;
      }

      // A prior request that never resolved (e.g. the person navigated
      // away) shouldn't hang around waiting for a modal that's about
      // to be reused for a new one.
      if (state.reverifyState && state.reverifyState.active) {
        state.reverifyState.active = false;
        state.reverifyState.reject(new Error('Reverification cancelled'));
      }

      input.value = '';
      input.type = 'password';
      if (hint) { hint.textContent = ''; hint.classList.remove('manage-inline-form__hint--error'); }

      modal.classList.add('manage-photo-modal--open');
      modal.setAttribute('aria-hidden', 'false');
      input.focus();

      state.reverifyState = { resolve, reject, active: true };

    });

  }

  async function withReverification(root, state, action) {

    try {
      return await action();
    } catch (error) {
      if (!isReverificationError(error)) throw error;
    }

    await requestReverification(root, state);
    return action();

  }

  function initReverifyModal(root, state) {

    const modal = root.querySelector('[data-reverify-modal]');
    if (!modal) return;

    const input = root.querySelector('[data-reverify-password]');
    const hint = root.querySelector('[data-reverify-hint]');
    const submit = root.querySelector('[data-reverify-submit]');
    const eyeBtn = root.querySelector('[data-reverify-eye]');

    const closeModal = () => {
      modal.classList.remove('manage-photo-modal--open');
      modal.setAttribute('aria-hidden', 'true');
      if (input) { input.value = ''; input.type = 'password'; }
      if (hint) { hint.textContent = ''; hint.classList.remove('manage-inline-form__hint--error'); }
      if (eyeBtn) eyeBtn.classList.remove('pw-field__eye--active');
    };

    root.querySelectorAll('[data-reverify-cancel]').forEach((button) => {
      button.addEventListener('click', () => {
        const pending = state.reverifyState;
        closeModal();
        if (pending && pending.active) {
          pending.active = false;
          pending.reject(new Error('Reverification cancelled'));
        }
      });
    });

    if (eyeBtn && input) {
      eyeBtn.addEventListener('click', () => {
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        eyeBtn.classList.toggle('pw-field__eye--active', !showing);
      });
    }

    if (input && submit) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit.click();
        }
      });
    }

    if (submit) {

      submit.addEventListener('click', async () => {

        const pending = state.reverifyState;
        if (!pending || !pending.active) return;

        const password = (input && input.value) || '';

        if (!password) {
          if (hint) {
            hint.textContent = 'Enter your password.';
            hint.classList.add('manage-inline-form__hint--error');
          }
          return;
        }

        submit.disabled = true;
        const originalLabel = submit.textContent;
        submit.innerHTML = '<span class="pw-btn-spinner" aria-hidden="true"></span>Verifying…';

        try {

          const verification = await state.clerk.session.startVerification({ level: 'first_factor' });

          const supportsPassword =
            !verification.supportedFirstFactors ||
            verification.supportedFirstFactors.some((factor) => factor.strategy === 'password');

          if (!supportsPassword) {
            throw new Error('Password verification isn\u2019t available for this account.');
          }

          const result = await state.clerk.session.attemptFirstFactorVerification({
            strategy: 'password',
            password
          });

          if (result.status !== 'complete') {
            throw new Error('Could not verify your password. Please try again.');
          }

          pending.active = false;
          closeModal();
          pending.resolve();

        } catch (error) {

          if (hint) {
            hint.textContent =
              error?.errors?.[0]?.longMessage ||
              error?.message ||
              'Could not verify your password. Please try again.';
            hint.classList.add('manage-inline-form__hint--error');
          }

        } finally {
          submit.disabled = false;
          submit.textContent = originalLabel;
        }

      });

    }

  }

  /* ------------------------------------------------------------------
     CARD EDITING
     ------------------------------------------------------------------ */

  function setCardEditing(card, editing) {

    if (!card) return;

    card.classList.toggle(
      'manage-card--editing',
      editing
    );
  }

  /* ------------------------------------------------------------------
     EDIT-MODE TYPING DETAIL
     ------------------------------------------------------------------
     Small native-feeling behaviors that only matter once you're
     actually typing: the caret lands somewhere sensible the moment
     Edit is pressed (instead of you having to click a field first),
     Enter commits the same way Save does, Escape backs out the same
     way Cancel does, and the bio textarea grows with the text like
     Notes instead of showing a scrollbar.
     ------------------------------------------------------------------ */

  // Focuses the field a person would expect to start typing in the
  // instant Edit is pressed — the Name field for the Identity card
  // (it's first, and it's what "editing your profile" means first),
  // otherwise the first editable control in the card.
  function focusFirstEditable(card) {

    if (!card) return;

    const preferred =
      card.querySelector('.manage-field--name .manage-field__input');

    const target =
      preferred ||
      card.querySelector(
        '.manage-field__input, .manage-field__select, .manage-field__textarea'
      );

    if (!target) return;

    target.focus({ preventScroll: false });

    // Land the caret at the end of any existing text rather than
    // selecting it all — matches how macOS/iOS Settings hands you
    // back a field you're revisiting, not a blank slate.
    if (
      typeof target.setSelectionRange === 'function' &&
      target.type !== 'number'
    ) {
      const end = target.value.length;
      try { target.setSelectionRange(end, end); } catch (err) { /* not all input types support this */ }
    }

  }

  // Grows a textarea to fit its content, the way Notes/Messages do,
  // instead of relying on a manual resize handle or an inner scrollbar.
  function autosizeTextarea(textarea) {

    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;

  }

  // Sizes a single-line profile-row input to hug its own value, the
  // way a native macOS pop-up button's hover/pressed background hugs
  // just its label rather than the whole control's hit area. Modern
  // Chrome/Edge do this natively via `field-sizing: content` in CSS;
  // this is the fallback (and the source of truth everywhere else)
  // so Safari/Firefox don't get a hover/focus box that's wider than
  // the text sitting inside it.
  let measureCanvas = null;
  function measureTextWidth(text, font) {
    if (!measureCanvas) measureCanvas = document.createElement('canvas');
    const ctx = measureCanvas.getContext('2d');
    ctx.font = font;
    return ctx.measureText(text || '').width;
  }

  function autosizeFieldInput(input) {

    if (!input || input.tagName !== 'INPUT') return;
    // Native field-sizing (Chrome/Edge 123+) already does the right
    // thing without any inline width getting in its way.
    if (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('field-sizing', 'content')) {
      return;
    }

    const cs = getComputedStyle(input);
    const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    // Measure the longer of the current value and the placeholder so
    // the box doesn't jump narrower than an empty-state hint.
    const sample = input.value || input.placeholder || '';
    const textWidth = measureTextWidth(sample, font);

    const min = parseFloat(cs.minWidth) || 40;
    const max = parseFloat(cs.maxWidth) || 220;
    // Small buffer so the caret has breathing room past the last
    // character instead of sitting flush against the edge.
    const next = Math.min(max, Math.max(min, Math.ceil(textWidth) + 10));

    input.style.width = `${next}px`;

  }

  function initEditModeTyping(root) {

    root
      .querySelectorAll('.manage-field--bio textarea')
      .forEach((textarea) => {

        autosizeTextarea(textarea);

        textarea.addEventListener('input', () => {
          autosizeTextarea(textarea);
        });

      });

    root
      .querySelectorAll('#tab-profile .manage-grid .manage-field__input')
      .forEach((input) => {

        autosizeFieldInput(input);

        input.addEventListener('input', () => autosizeFieldInput(input));
        // Value can also change programmatically (e.g. Escape
        // restoring the original text) — re-measure after those too.
        input.addEventListener('focus', () => autosizeFieldInput(input));
        input.addEventListener('blur', () => autosizeFieldInput(input));

      });

  }

  /* ------------------------------------------------------------------
     INLINE ROW EDITING — Apple Settings interaction model
     ------------------------------------------------------------------
     Every text/number field in the Profile tab is now *always* live —
     there is no separate "enter edit mode" step and no per-card
     Edit/Cancel/Save. The visible "value" for these fields IS the real
     <input>/<textarea> (styled with no border/background so it reads
     as plain text at rest); clicking it just places a caret, exactly
     like tapping a row in iOS/macOS Settings.

     This works by applying the existing `.manage-card--editing` class
     permanently to every Profile card instead of toggling it from an
     Edit button — every rule already written around that class (the
     value/input swap, the boxless name/bio treatment, the chip-row
     chevron + popover gating, the tag list) keeps working unchanged.
     Chip and tag fields already have their own commit logic
     (initChipAndTagFields); this function only owns plain
     text/number/textarea fields, and the debounced autosave.
     ------------------------------------------------------------------ */

  function initInlineRowEditing(root, state, scheduleSave) {

    // Every Profile card's fields are live all the time now — no
    // "Edit profile" step required. (Security tab, and the photo /
    // password / delete-account modals, are untouched by this class.)
    root
      .querySelectorAll('#tab-profile .manage-card')
      .forEach((card) => card.classList.add('manage-card--editing'));

    const controls = Array.from(
      root.querySelectorAll(
        '#tab-profile .manage-field__input, ' +
        '#tab-profile .manage-field__select, ' +
        '#tab-profile .manage-field__textarea'
      )
      // Tag-input fields (brand chips etc.) already have their own
      // Enter/blur commit flow in initChipAndTagFields — don't
      // double-handle them here.
    ).filter((el) => !el.hasAttribute('data-tag-input') && el.type !== 'hidden');

    controls.forEach((control) => {

      // A plain row's clickable area is really the whole
      // .manage-field__body — the input itself hugs just its text
      // (field-sizing: content), so clicking the row's padding or
      // label area shouldn't feel dead. Skip textareas (bio already
      // fills its row) and anything that already owns its own click
      // behavior.
      const fieldEl = control.closest('.manage-field');

      // One row is editable at a time, the way Settings does it: a row
      // shows its value as text until you tap it, then it swaps to a
      // control. Leaving it swaps back. Previously every row was a
      // permanently-open input, which made the tab read as a form and
      // left the Age row blank (its control is type="hidden", so hiding
      // the text value left nothing behind).
      const beginEditing = () => {
        if (!fieldEl || fieldEl.classList.contains('manage-field--editing')) return;
        root
          .querySelectorAll('#tab-profile .manage-field--editing')
          .forEach((other) => {
            if (other !== fieldEl) other.classList.remove('manage-field--editing');
          });
        fieldEl.classList.add('manage-field--editing');
      };

      const endEditing = () => {
        if (fieldEl) fieldEl.classList.remove('manage-field--editing');
      };

      const body = control.closest('.manage-field__body');
      if (body && control.tagName !== 'TEXTAREA') {
        body.addEventListener('click', (event) => {
          beginEditing();
          if (event.target === control) return;
          // The control only exists after the class swap paints it in.
          requestAnimationFrame(() => control.focus());
        });
      }

      control.addEventListener('focus', () => {
        beginEditing();
        control.dataset.originalValue = control.value;
      });

      const commit = () => {

        const field = control.closest('.manage-field');

        // Keep the collapsed .manage-field__value text in sync too
        // (it's hidden while the field is this kind of always-live,
        // but other code — readFields(), a future non-live state —
        // may still read it).
        const valueEl =
          field && field.querySelector('.manage-field__value');

        if (valueEl) {
          valueEl.textContent =
            control.tagName === 'SELECT'
              ? (control.options[control.selectedIndex]
                  ? control.options[control.selectedIndex].text
                  : control.value)
              : control.value;
        }

        if (control.value !== control.dataset.originalValue) {
          scheduleSave();
        }

      };

      control.addEventListener('blur', () => {
        commit();
        endEditing();
      });

      control.addEventListener('keydown', (event) => {

        if (event.key === 'Escape') {
          // Restore, then blur — blur's commit() sees value === the
          // just-restored originalValue, so nothing gets saved.
          event.preventDefault();
          event.stopPropagation();
          control.value = control.dataset.originalValue ?? control.value;
          control.blur();
          return;
        }

        if (event.key === 'Enter') {
          if (control.tagName === 'TEXTAREA') {
            // Bio is multiline: plain Enter must still make a new
            // line. Only Cmd/Ctrl+Enter commits.
            if (!(event.metaKey || event.ctrlKey)) return;
          }
          event.preventDefault();
          control.blur();
        }

      });

    });

  }

  /* ------------------------------------------------------------------
     CHIP-SELECT + TAG-INPUT FIELDS
     ------------------------------------------------------------------
     UI-only for now — selections/tags live in the DOM (button classes,
     rendered tag chips) and are reflected into each field's collapsed
     .manage-field__value text. Nothing here reads from or writes to
     Clerk/Supabase yet; that gets wired up once the profile-fields
     table exists.
     ------------------------------------------------------------------ */

  function initChipAndTagFields(root, state, scheduleSave) {

    /* ---------------- Chip-select fields ----------------
       Each chip group renders as a floating popover, positioned off
       the field that opened it and reparented onto <body> while open
       so it can't be clipped by the scrolling panel and never pushes
       surrounding fields around. Only one popover is open at a time. */

    let closeActivePopover = null;
    let repositionActivePopover = null;

    const closeAnyPopover = () => {
      repositionActivePopover = null;
      if (closeActivePopover) {
        const close = closeActivePopover;
        closeActivePopover = null;
        close();
      }
    };

    document.addEventListener('click', (event) => {
      if (!closeActivePopover) return;
      if (
        event.target.closest('.manage-field__chips') ||
        event.target.closest('.manage-field--chip') ||
        event.target.closest('.manage-field--dob')
      ) {
        return;
      }
      closeAnyPopover();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeAnyPopover();
    });

    // This used to close the popover on ANY scroll, in capture phase, which
    // caught two things it should not have:
    //
    //   1. the date wheels scrolling inside the popover itself, and
    //   2. the panel scrolling as a side effect of open() focusing a wheel —
    //      so the picker dismissed itself the instant it appeared.
    //
    // A menu should follow the row it belongs to rather than vanish, so a
    // scroll now repositions it. Scrolling inside the popover is ignored
    // entirely.
    window.addEventListener(
      'scroll',
      (event) => {
        if (!closeActivePopover) return;
        const node = event.target && event.target.nodeType === 1 ? event.target : null;
        if (node && node.closest && node.closest('.manage-field__chips')) return;
        if (repositionActivePopover) {
          repositionActivePopover();
          return;
        }
        closeAnyPopover();
      },
      true
    );
    window.addEventListener('resize', () => closeAnyPopover());

    Array.from(
      root.querySelectorAll('[data-chip-group]')
    ).forEach((group) => {

      const field = group.closest('.manage-field');
      const body = field ? field.querySelector('.manage-field__body') : null;
      const valueEl = field ? field.querySelector('[data-chip-value]') : null;
      const labelText = field ? field.querySelector('.manage-field__label') : null;
      const mode = group.dataset.chipMode === 'multi' ? 'multi' : 'single';
      if (!field || !body) return;

      const homeParent = body;

      /* Wrap the existing chip buttons and add a small header
         (field name + a Done button for multi-select) so the
         popover reads clearly on its own, detached from the field. */
      const optionButtons = Array.from(group.children);
      const optionsWrap = document.createElement('div');
      optionsWrap.className = 'manage-field__chips-options';
      optionButtons.forEach((btn) => optionsWrap.appendChild(btn));

      const header = document.createElement('div');
      header.className = 'manage-field__chips-header';

      const headerLabel = document.createElement('span');
      headerLabel.className = 'manage-field__chips-label';
      headerLabel.textContent = labelText ? labelText.textContent : '';
      header.appendChild(headerLabel);

      let doneBtn = null;
      if (mode === 'multi') {
        doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'manage-field__chips-done';
        doneBtn.textContent = 'Done';
        header.appendChild(doneBtn);
      }

      group.appendChild(header);
      group.appendChild(optionsWrap);

      const syncValueText = () => {
        if (!valueEl) return;
        const selected = Array.from(
          group.querySelectorAll('.manage-field__chip--selected')
        ).map((btn) => btn.textContent.trim());

        if (selected.length === 0) {
          valueEl.textContent = mode === 'multi' ? 'None selected' : 'Not set';
        } else {
          valueEl.textContent = selected.join(', ');
        }
      };

      const position = () => {
        // Anchor to the value text itself (where the current answer
        // reads, e.g. "Male") rather than the whole row — a System
        // Settings pop-up menu emerges from the control you clicked,
        // not from the row's left edge past the icon.
        const anchor = valueEl || field;
        const rect = anchor.getBoundingClientRect();
        const popW = group.offsetWidth || 300;

        // Menus in Settings sit tight against the control, overlapping
        // it by a few pixels rather than floating clear of it.
        const GAP = 4;

        let left = rect.left - 6;
        const maxLeft = window.innerWidth - popW - 12;
        if (left > maxLeft) left = Math.max(12, maxLeft);
        if (left < 12) left = 12;

        group.style.left = `${left}px`;
        group.style.top = `${rect.bottom + GAP}px`;

        const popH = group.offsetHeight || 0;
        if (rect.bottom + GAP + popH > window.innerHeight - 12) {
          group.style.top = `${Math.max(12, rect.top - popH - GAP)}px`;
        }
      };

      const close = () => {
        group.classList.remove('manage-field__chips--open');
        field.classList.remove('manage-field--chip-open');
        if (group.parentNode && group.parentNode !== homeParent) {
          homeParent.appendChild(group);
        }
      };

      const open = () => {
        closeAnyPopover();
        /* Reparent onto the overlay root (not document.body) — the
           root carries the --ink / --field-border / etc. custom
           properties everything here is themed with, and unlike
           .manage-panel it has no transform/overflow:hidden of its
           own, so a position:fixed popover placed here still lines
           up with true viewport coordinates and is never clipped. */
        root.appendChild(group);
        group.classList.add('manage-field__chips--open');
        field.classList.add('manage-field--chip-open');
        position();
        closeActivePopover = close;
        repositionActivePopover = position;

        /* Accessibility: land keyboard focus on the current
           selection (or the first option) so arrow keys work
           immediately without an extra Tab press. */
        const currentlySelected = group.querySelector('.manage-field__chip--selected');
        requestAnimationFrame(() => {
          (currentlySelected || optionButtons[0])?.focus();
        });
      };

      /* Accessibility: Up/Down/Home/End move focus between options
         while the popover is open. Enter/Space already work via
         native <button> click behavior — this only adds movement,
         it doesn't change selection/save logic. */
      group.addEventListener('keydown', (event) => {
        const currentIndex = optionButtons.indexOf(document.activeElement);
        const focusAt = (index) => {
          const clamped = Math.max(0, Math.min(optionButtons.length - 1, index));
          optionButtons[clamped]?.focus();
        };
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          focusAt(currentIndex < 0 ? 0 : currentIndex + 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          focusAt(currentIndex < 0 ? 0 : currentIndex - 1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          focusAt(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          focusAt(optionButtons.length - 1);
        }
      });

      if (doneBtn) {
        doneBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          closeAnyPopover();
        });
      }

      const toggleFromBody = () => {
        // Profile cards carry .manage-card--editing permanently now
        // (see initInlineRowEditing), so this is effectively always
        // true — kept as a guard rather than removed outright in case
        // a future card is intentionally not made live.
        const card = field.closest('.manage-card');
        if (!card || !card.classList.contains('manage-card--editing')) return;

        if (group.classList.contains('manage-field__chips--open')) {
          closeAnyPopover();
        } else {
          open();
        }
      };

      body.addEventListener('click', toggleFromBody);

      // Same target as every other interactive row in edit mode:
      // reachable by Tab, opens with Enter or Space, exactly like a
      // native <button> — without changing it into one, since the
      // markup/JS elsewhere still expects a plain field body.
      body.setAttribute('tabindex', '0');
      body.setAttribute('role', 'button');

      body.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleFromBody();
      });

      optionButtons.forEach((btn) => {

        btn.addEventListener('click', (event) => {
          event.stopPropagation();

          if (mode === 'single') {
            group.querySelectorAll('.manage-field__chip--selected').forEach((el) => {
              if (el !== btn) el.classList.remove('manage-field__chip--selected');
            });
            btn.classList.add('manage-field__chip--selected');
            syncValueText();
            closeAnyPopover();
          } else {
            btn.classList.toggle('manage-field__chip--selected');
            syncValueText();
          }

          if (typeof scheduleSave === 'function') scheduleSave();
        });

      });

      syncValueText();

    });

    /* ---------------- Tag-input fields ---------------- */

    Array.from(
      root.querySelectorAll('[data-tag-group]')
    ).forEach((group) => {

      const field = group.closest('.manage-field');
      const valueEl = field ? field.querySelector('[data-tag-value]') : null;
      const list = group.querySelector('[data-tag-list]');
      const input = group.querySelector('[data-tag-input]');
      if (!list || !input) return;

      const syncValueText = () => {
        if (!valueEl) return;
        const tags = Array.from(list.children).map((el) => el.dataset.tagText || '');
        valueEl.textContent = tags.length ? tags.join(', ') : 'None added';
      };

      const addTag = (text) => {
        const trimmed = text.trim();
        if (!trimmed) return;

        const already = Array.from(list.children).some(
          (el) => (el.dataset.tagText || '').toLowerCase() === trimmed.toLowerCase()
        );
        if (already) return;

        const chip = createTagChip(trimmed, () => {
          syncValueText();
          if (typeof scheduleSave === 'function') scheduleSave();
        });

        list.appendChild(chip);
        syncValueText();
        if (typeof scheduleSave === 'function') scheduleSave();
      };

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',') {
          event.preventDefault();
          addTag(input.value);
          input.value = '';
        }
      });

      input.addEventListener('blur', () => {
        if (input.value.trim()) {
          addTag(input.value);
          input.value = '';
        }
      });

    });

    /* ---------------- Date-of-birth wheel field (Age) ----------------
       Renders as a chip-style row (click opens a popover, same single-
       active-popover coordination as the chip fields above) but the
       popover holds three scrolling month/day/year wheels instead of a
       list. Only the *computed age* is persisted (data-field="age", so
       it rides the existing generic save/restore path with no backend
       schema change) — the exact day/month picked only shapes what the
       wheel shows next time it's opened in this session. */

    let dobApi = null;

    const dobField = root.querySelector('.manage-field--dob[data-field="age"]');

    if (dobField) {
      dobApi = initDobWheelField(
        root,
        dobField,
        closeAnyPopover,
        (closeFn, repositionFn) => {
          closeActivePopover = closeFn;
          repositionActivePopover = repositionFn || null;
        }
      );
    }

    return {
      resyncDobFromAge: dobApi ? dobApi.resyncFromAge : null
    };

  }

  // The wheel's row height lives in CSS (.manage-field__wheel-item). Hard
  // coding it here too means one file can be restyled and the other keeps
  // computing scroll offsets from a number that is no longer true, which
  // silently lands the wheel on the wrong value. Measure it instead, and
  // fall back to the CSS default if measurement is not possible yet.
  const DOB_ITEM_HEIGHT_FALLBACK = 32;

  function dobItemHeight(track) {
    const first = track && track.firstElementChild;
    if (!first) return DOB_ITEM_HEIGHT_FALLBACK;
    const h = first.getBoundingClientRect().height;
    return h > 0 ? h : DOB_ITEM_HEIGHT_FALLBACK;
  }
  const DOB_MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  function daysInMonth(month, year) {
    return new Date(year, month, 0).getDate();
  }

  // Age as of *today* from a birth year/month/day — subtracts a year
  // if this year's birthday hasn't happened yet.
  function computeAgeFromParts(year, month, day) {
    const today = new Date();
    let age = today.getFullYear() - year;
    const beforeBirthdayThisYear =
      (today.getMonth() + 1 < month) ||
      (today.getMonth() + 1 === month && today.getDate() < day);
    if (beforeBirthdayThisYear) age -= 1;
    return Math.max(0, age);
  }

  function buildDobWheelItems(track, count, formatter) {
    track.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'manage-field__wheel-item';
      el.textContent = formatter(i);
      el.dataset.index = String(i);
      track.appendChild(el);
    }
  }

  function initDobWheelField(root, field, closeAnyPopoverFn, setActivePopover) {

    const popover = field.querySelector('[data-dob-popover]');
    const trigger = field.querySelector('[data-dob-trigger]');
    const ageValueEl = field.querySelector('[data-dob-age-value]');
    const ageInput = field.querySelector('[data-dob-age-input]');

    if (!popover || !trigger || !ageInput) return null;

    const homeParent = popover.parentNode;

    const monthTrack = popover.querySelector('[data-dob-track="month"]');
    const dayTrack = popover.querySelector('[data-dob-track="day"]');
    const yearTrack = popover.querySelector('[data-dob-track="year"]');
    const monthWheel = monthTrack.closest('.manage-field__wheel');
    const dayWheel = dayTrack.closest('.manage-field__wheel');
    const yearWheel = yearTrack.closest('.manage-field__wheel');

    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 100;
    const maxYear = currentYear;
    const yearCount = maxYear - minYear + 1;

    let year = parseInt(popover.dataset.dobYear, 10) || (currentYear - 21);
    let month = parseInt(popover.dataset.dobMonth, 10) || 1;
    let day = parseInt(popover.dataset.dobDay, 10) || 1;

    // Moving a wheel from code has to be distinguishable from the user
    // dragging it. Without this flag the programmatic scroll fires the
    // wheel's own scroll listener, which settles, which scrolls again —
    // and with `scroll-snap-type: y mandatory` also snapping, the JS and
    // the browser end up fighting over the same pixels. That fight is why
    // the picker jumped around and landed on the wrong value.
    const scrollWheelTo = (wheel, index, smooth) => {
      const h = dobItemHeight(wheel.querySelector('.manage-field__wheel-track'));
      wheel.dataset.dobProgrammatic = '1';
      clearTimeout(wheel._dobRelease);
      wheel.scrollTo({ top: index * h, behavior: smooth ? 'smooth' : 'auto' });
      wheel._dobRelease = setTimeout(function () {
        delete wheel.dataset.dobProgrammatic;
      }, smooth ? 450 : 80);
    };

    const highlightSelected = (wheel, index) => {
      Array.from(wheel.querySelectorAll('.manage-field__wheel-item')).forEach((el, i) => {
        el.classList.toggle('manage-field__wheel-item--selected', i === index);
      });
    };

    const updateAgeDisplay = () => {
      const age = computeAgeFromParts(year, month, day);
      if (ageValueEl) ageValueEl.textContent = String(age);
      ageInput.value = String(age);
      popover.dataset.dobYear = String(year);
      popover.dataset.dobMonth = String(month);
      popover.dataset.dobDay = String(day);
    };

    // The day wheel's length depends on the month/year in play (28–31
    // days) — rebuilt whenever either changes, clamping the selected
    // day down instead of leaving it pointing at, say, Feb 30.
    const rebuildDayTrack = (preserveDay, instant) => {
      const max = daysInMonth(month, year);
      const nextDay = Math.min(preserveDay, max);

      // Only touch the DOM when the month actually has a different number
      // of days. This used to blow away and rebuild all 31 day elements on
      // every settle of the month or year wheel — including the repeat
      // settles caused by the scroll fight above — so the day wheel was
      // being torn down mid-interaction.
      if (dayTrack.children.length !== max) {
        buildDobWheelItems(dayTrack, max, (i) => String(i + 1));
      }

      const dayChanged = nextDay !== day;
      day = nextDay;

      // Nothing to re-land unless the day itself moved (Jan 31 -> Feb 28).
      if (instant || dayChanged) {
        scrollWheelTo(dayWheel, day - 1, !instant);
      }
      highlightSelected(dayWheel, day - 1);
    };

    buildDobWheelItems(monthTrack, 12, (i) => DOB_MONTH_NAMES[i]);
    buildDobWheelItems(yearTrack, yearCount, (i) => String(minYear + i));
    rebuildDayTrack(day, true);

    scrollWheelTo(monthWheel, month - 1, false);
    scrollWheelTo(yearWheel, year - minYear, false);
    highlightSelected(monthWheel, month - 1);
    highlightSelected(yearWheel, year - minYear);
    updateAgeDisplay();

    const wireWheel = (wheel, track, onSettle) => {

      let settleTimer = null;

      // Read where the wheel came to rest and report it. Deliberately does
      // NOT scroll: `scroll-snap-type: y mandatory` in the CSS already
      // lands the wheel on an item, so calling scrollTo here only restarts
      // the scroll it is reacting to.
      const settle = () => {
        const count = track.children.length;
        if (!count) return;
        let index = Math.round(wheel.scrollTop / dobItemHeight(track));
        index = Math.max(0, Math.min(count - 1, index));
        highlightSelected(wheel, index);
        onSettle(index);
      };

      // `scrollend` fires once, when the wheel has genuinely stopped —
      // exactly the signal this needs. Where it is unsupported, fall back
      // to the debounce, but skip anything we caused ourselves.
      if ('onscrollend' in wheel) {
        wheel.addEventListener('scrollend', () => {
          if (wheel.dataset.dobProgrammatic) return;
          settle();
        });
      } else {
        wheel.addEventListener('scroll', () => {
          if (wheel.dataset.dobProgrammatic) return;
          clearTimeout(settleTimer);
          settleTimer = setTimeout(settle, 120);
        });
      }

      // Keyboard and pointer support: the wheel is a real control, so it
      // takes focus and answers to arrow keys.
      wheel.setAttribute('tabindex', '0');
      wheel.setAttribute('role', 'listbox');

      track.addEventListener('click', (event) => {
        const item = event.target.closest('.manage-field__wheel-item');
        if (!item) return;
        const index = Array.from(track.children).indexOf(item);
        scrollWheelTo(wheel, index, true);
        highlightSelected(wheel, index);
        onSettle(index);
      });

      wheel.addEventListener('keydown', (event) => {
        const count = track.children.length;
        let index = Math.round(wheel.scrollTop / dobItemHeight(track));
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          index = Math.min(count - 1, index + 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          index = Math.max(0, index - 1);
        } else {
          return;
        }
        scrollWheelTo(wheel, index, true);
        highlightSelected(wheel, index);
        onSettle(index);
      });

    };

    wireWheel(monthWheel, monthTrack, (index) => {
      month = index + 1;
      rebuildDayTrack(day, false);
      updateAgeDisplay();
    });

    wireWheel(yearWheel, yearTrack, (index) => {
      year = minYear + index;
      rebuildDayTrack(day, false);
      updateAgeDisplay();
    });

    wireWheel(dayWheel, dayTrack, (index) => {
      day = index + 1;
      updateAgeDisplay();
    });

    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const popW = popover.offsetWidth || 260;
      const GAP = 4;
      let left = rect.left - 6;
      const maxLeft = window.innerWidth - popW - 12;
      if (left > maxLeft) left = Math.max(12, maxLeft);
      if (left < 12) left = 12;
      popover.style.left = `${left}px`;
      popover.style.top = `${rect.bottom + GAP}px`;
      const popH = popover.offsetHeight || 0;
      if (rect.bottom + GAP + popH > window.innerHeight - 12) {
        popover.style.top = `${Math.max(12, rect.top - popH - GAP)}px`;
      }
    };

    const close = () => {
      popover.classList.remove('manage-field__chips--open');
      field.classList.remove('manage-field--dob-open');
      if (popover.parentNode && popover.parentNode !== homeParent) {
        homeParent.appendChild(popover);
      }
    };

    const open = () => {
      closeAnyPopoverFn();
      root.appendChild(popover);
      popover.classList.add('manage-field__chips--open');
      field.classList.add('manage-field--dob-open');
      position();
      setActivePopover(close, position);
      // Re-land every wheel on its current value instantly — the
      // popover was just reparented/repositioned, and a fresh
      // requestAnimationFrame avoids scrolling mid-transition.
      requestAnimationFrame(() => {
        scrollWheelTo(monthWheel, month - 1, false);
        scrollWheelTo(dayWheel, day - 1, false);
        scrollWheelTo(yearWheel, year - minYear, false);
        monthWheel.focus();
      });
    };

    const toggle = () => {
      const card = field.closest('.manage-card');
      if (!card || !card.classList.contains('manage-card--editing')) return;
      if (popover.classList.contains('manage-field__chips--open')) {
        closeAnyPopoverFn();
      } else {
        open();
      }
    };

    trigger.addEventListener('click', toggle);
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('role', 'button');
    trigger.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    });

    return {
      // Called after a saved profile loads: if the stored age doesn't
      // match what the wheels currently imply (e.g. this is a
      // returning user whose age was saved in an earlier session),
      // re-derive a year from it so reopening the picker lands
      // somewhere sensible instead of the shipped 2005 default.
      resyncFromAge(storedAgeValue) {
        const parsedAge = parseInt(storedAgeValue, 10);
        if (Number.isNaN(parsedAge)) return;
        if (parsedAge === computeAgeFromParts(year, month, day)) return;

        year = currentYear - parsedAge;
        month = 1;
        day = 1;

        buildDobWheelItems(yearTrack, yearCount, (i) => String(minYear + i));
        rebuildDayTrack(day, true);
        scrollWheelTo(monthWheel, month - 1, false);
        scrollWheelTo(yearWheel, year - minYear, false);
        highlightSelected(monthWheel, month - 1);
        highlightSelected(yearWheel, year - minYear);
        updateAgeDisplay();
      }
    };

  }

  function initCardEditing(root, state) {

    const cards =
      Array.from(
        root.querySelectorAll('.manage-card')
      );

    cards.forEach((card) => {

      const editBtn =
        card.querySelector('[data-edit-toggle]');

      const cancelBtn =
        card.querySelector('[data-edit-cancel]');

      const saveBtn =
        card.querySelector('[data-edit-save]');

      if (!editBtn) return;

      let snapshot = [];

      const takeSnapshot = () => {

        snapshot =
          Array.from(
            card.querySelectorAll(
              '.manage-field__input, .manage-field__select'
            )
          ).map(
            (element) => element.value
          );

      };

      const restoreSnapshot = () => {

        card
          .querySelectorAll(
            '.manage-field__input, .manage-field__select'
          )
          .forEach((element, index) => {

            if (
              snapshot[index] !== undefined
            ) {
              element.value =
                snapshot[index];
            }

          });

      };

      const syncDisplayedValues = () => {

        card
          .querySelectorAll('.manage-field')
          .forEach((field) => {

            const value =
              field.querySelector(
                '.manage-field__value'
              );

            const input =
              field.querySelector(
                '.manage-field__input, .manage-field__select'
              );

            if (!value || !input) return;

            if (input.tagName === 'SELECT') {

              value.textContent =
                input.options[
                  input.selectedIndex
                ]
                  ? input.options[
                      input.selectedIndex
                    ].text
                  : input.value;

            } else {

              value.textContent =
                input.value;

            }

          });

      };

      /* --------------------------------------------------------------
         EDIT
         -------------------------------------------------------------- */

      editBtn.addEventListener('click', () => {

        takeSnapshot();

        /*
         * Profile Edit only ever opens its own card (the
         * "1. Profile" identity card — name, bio, avatar).
         * The other profile cards (Basic information, Body & fit,
         * Style, Lifestyle) are informational here and are not
         * toggled into editing mode by this button.
         *
         * `data-profile-edit-all` is kept on the button only as a
         * marker for Save/Cancel below, so the identity card still
         * gets its full Clerk-aware save (name, photo, bio) instead
         * of the plain local-field save every other card would get.
         */

        if (
          editBtn.hasAttribute(
            'data-profile-edit-all'
          )
        ) {

          setCardEditing(card, true);

          state.editingAll = true;

          root.classList.add(
            'manage-profile-editing'
          );

          requestAnimationFrame(() => {
            card.querySelectorAll('.manage-field--bio textarea')
              .forEach(autosizeTextarea);
            focusFirstEditable(card);
          });

          return;
        }

        setCardEditing(
          card,
          true
        );

        requestAnimationFrame(() => {
          card.querySelectorAll('.manage-field--bio textarea')
            .forEach(autosizeTextarea);
          focusFirstEditable(card);
        });

      });

      // Enter commits the same way clicking Save does; Escape backs
      // out the same way clicking Cancel does. Both are scoped so
      // they never hijack a keystroke that already has a job: Enter
      // inside the bio textarea still makes a new line, Enter inside
      // a brand/tag input still adds a tag, and Escape while a chip
      // popover is open just closes that popover first (its own
      // document-level handler owns that) rather than also bailing
      // out of the whole card.
      card.addEventListener('keydown', (event) => {

        if (!card.classList.contains('manage-card--editing')) return;

        const target = event.target;

        if (event.key === 'Enter') {

          const tag = target.tagName;
          if (tag !== 'INPUT' && tag !== 'SELECT') return;
          if (target.hasAttribute('data-tag-input')) return;

          event.preventDefault();
          if (saveBtn) saveBtn.click();
          return;

        }

        if (event.key === 'Escape') {

          if (root.querySelector('.manage-field__chips--open')) return;

          event.preventDefault();
          if (cancelBtn) cancelBtn.click();

        }

      });

      /* --------------------------------------------------------------
         CANCEL
         -------------------------------------------------------------- */

      if (cancelBtn) {

        cancelBtn.addEventListener(
          'click',
          () => {

            restoreSnapshot();

            setCardEditing(
              card,
              false
            );

            /*
             * Cancelling Profile only ever needs to close its own
             * card — the other cards were never opened by Edit
             * profile in the first place.
             */

            if (
              editBtn.hasAttribute(
                'data-profile-edit-all'
              )
            ) {

              state.editingAll = false;

              root.classList.remove(
                'manage-profile-editing'
              );

              state.photoDraft = null;

              if (state.currentUser) {

                populateIdentity(
                  root,
                  state.currentUser,
                  state.profile
                );

              }

            }

          }
        );

      }

      /* --------------------------------------------------------------
         SAVE
         -------------------------------------------------------------- */

      if (saveBtn) {

        saveBtn.addEventListener(
          'click',
          async () => {

            syncDisplayedValues();

            if (
              editBtn.hasAttribute(
                'data-profile-edit-all'
              )
            ) {

              await saveWholeProfile(
                root,
                state
              );

            } else {

              setCardEditing(
                card,
                false
              );

            }

          }
        );

      }

    });

  }

  /* ------------------------------------------------------------------
     READ PROFILE FIELDS
     ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------
     FIELD <-> PROFILE-KEY MAPPING
     ------------------------------------------------------------------
     Every editable row in the Profile tab (text, chip-select, or tag
     field) carries a `data-field="kebab-case-id"` attribute. This is
     the single source of truth for both reading values off the DOM
     (readFields) and writing saved values back onto it
     (populateProfileFields) — add a field to the HTML with a
     data-field attribute and it's automatically saved/restored, no
     JS changes needed on either side.

     `name` is the one deliberate exception: it's stored under
     `displayName` in the profile object (saveWholeProfile splits it
     into Clerk's separate firstName/lastName), matching the property
     name used everywhere else in this file.
     ------------------------------------------------------------------ */

  // Announces that the profile on screen has changed, so anything layered
  // on top of the panel (the completeness header in profile-insights.js)
  // can recompute. Fired after a save and after the fields are repopulated.
  function announceProfileChange() {
    try {
      document.dispatchEvent(new CustomEvent('shopai:profile-change'));
    } catch (err) { /* never let a listener break a save */ }
  }

  function profileKeyForField(dataField) {
    if (dataField === 'name') return 'displayName';
    return dataField.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
  }

  // Builds a fresh <span class="manage-field__tag"> chip, wired with
  // its own remove button. Shared by initChipAndTagFields (typing a
  // new tag) and populateProfileFields (restoring saved tags) so
  // there's exactly one place that knows what a tag chip looks like.
  function createTagChip(text, onRemove) {

    const chip = document.createElement('span');
    chip.className = 'manage-field__tag';
    chip.dataset.tagText = text;

    const label = document.createElement('span');
    label.textContent = text;
    chip.appendChild(label);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'manage-field__tag-remove';
    removeBtn.setAttribute('aria-label', `Remove ${text}`);
    removeBtn.textContent = '\u00d7';
    removeBtn.addEventListener('click', () => {
      chip.remove();
      onRemove();
    });
    chip.appendChild(removeBtn);

    return chip;

  }

  // Reads every data-field row in the Profile tab into a flat
  // { profileKey: value } object. Text/number/select/textarea fields
  // read .value; single-select chip fields read the one selected
  // chip's label (or '' if none); multi-select chip fields and tag
  // fields read an array of labels.
  function readFields(root) {

    const profile = {};
    const scope = root.querySelector('#tab-profile') || root;

    scope.querySelectorAll('.manage-field[data-field]').forEach((field) => {

      const dataField = field.dataset.field;
      if (!dataField) return;
      const key = profileKeyForField(dataField);

      if (field.classList.contains('manage-field--chip')) {

        const group = field.querySelector('[data-chip-group]');
        if (!group) return;

        const mode = group.dataset.chipMode === 'multi' ? 'multi' : 'single';
        const selected = Array.from(
          group.querySelectorAll('.manage-field__chip--selected')
        ).map((btn) => btn.textContent.trim());

        profile[key] = mode === 'multi' ? selected : (selected[0] || '');
        return;

      }

      if (field.classList.contains('manage-field--tags')) {

        const list = field.querySelector('[data-tag-list]');
        profile[key] = list
          ? Array.from(list.children).map((el) => el.dataset.tagText || '')
          : [];
        return;

      }

      const control = field.querySelector(
        '.manage-field__input, .manage-field__select, .manage-field__textarea'
      );
      if (control) profile[key] = control.value;

    });

    return profile;

  }

  // The inverse of readFields — restores a saved profile object onto
  // the DOM: sets input/select/textarea values, marks the matching
  // chip(s) selected, rebuilds tag chip lists, and keeps every
  // collapsed .manage-field__value / [data-chip-value] / [data-tag-value]
  // label in sync with what was just restored. Fields with no saved
  // value are left exactly as the HTML shipped them (e.g. the
  // Gender/Body type/Top size demo defaults) rather than being blanked.
  function populateProfileFields(root, profile) {

    if (!profile) return;

    // Let the completeness header recompute once the DOM reflects the
    // restored values rather than the markup's demo defaults.
    setTimeout(announceProfileChange, 0);
    const scope = root.querySelector('#tab-profile') || root;

    scope.querySelectorAll('.manage-field[data-field]').forEach((field) => {

      const dataField = field.dataset.field;
      if (!dataField) return;
      const key = profileKeyForField(dataField);
      const stored = profile[key];
      if (stored === undefined || stored === null) return;

      if (field.classList.contains('manage-field--chip')) {

        const group = field.querySelector('[data-chip-group]');
        const valueEl = field.querySelector('[data-chip-value]');
        if (!group) return;

        const mode = group.dataset.chipMode === 'multi' ? 'multi' : 'single';
        const wantedList = Array.isArray(stored) ? stored : [stored];
        const wanted = new Set(
          wantedList
            .filter(Boolean)
            .map((text) => String(text).trim().toLowerCase())
        );

        // Nothing saved yet for this field (empty string / empty
        // array) — leave the shipped HTML default alone rather than
        // clearing a placeholder selection to nothing.
        if (wanted.size === 0) return;

        Array.from(group.querySelectorAll('.manage-field__chip')).forEach((btn) => {
          const match = wanted.has(btn.textContent.trim().toLowerCase());
          btn.classList.toggle('manage-field__chip--selected', match);
        });

        if (valueEl) {
          const selectedText = Array.from(
            group.querySelectorAll('.manage-field__chip--selected')
          ).map((btn) => btn.textContent.trim());
          valueEl.textContent = selectedText.length
            ? selectedText.join(', ')
            : (mode === 'multi' ? 'None selected' : 'Not set');
        }

        return;

      }

      if (field.classList.contains('manage-field--tags')) {

        const list = field.querySelector('[data-tag-list]');
        const valueEl = field.querySelector('[data-tag-value]');
        if (!list) return;

        const tags = (Array.isArray(stored) ? stored : [])
          .map((text) => String(text).trim())
          .filter(Boolean);

        if (tags.length === 0) return;

        list.innerHTML = '';
        tags.forEach((text) => {
          const chip = createTagChip(text, () => {
            if (!valueEl) return;
            const remaining = Array.from(list.children).map((el) => el.dataset.tagText || '');
            valueEl.textContent = remaining.length ? remaining.join(', ') : 'None added';
          });
          list.appendChild(chip);
        });

        if (valueEl) valueEl.textContent = tags.join(', ');
        return;

      }

      const control = field.querySelector(
        '.manage-field__input, .manage-field__select, .manage-field__textarea'
      );
      const valueEl = field.querySelector('.manage-field__value');

      if (stored === '') return;
      if (control) control.value = stored;
      if (valueEl) valueEl.textContent = stored;

    });

  }

  // Shared debounced autosave: multiple fields (text blur, a chip
  // click, a tag Enter) can all fire in quick succession, so every
  // caller schedules through this one timer instead of each owning
  // its own — coalesces bursts of edits into a single Clerk/Supabase
  // write instead of one request per field.
  function createAutosave(root, state, delay = 600) {
    let timer = null;
    return function scheduleSave() {
      if (!state.clerkUser) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        saveWholeProfile(root, state);
      }, delay);
    };
  }

  /* ------------------------------------------------------------------
     SAVE WHOLE PROFILE
     ------------------------------------------------------------------ */

  async function saveWholeProfile(
    root,
    state
  ) {

    const saveButtons =
      Array.from(
        root.querySelectorAll(
          '[data-edit-save]'
        )
      );

    saveButtons.forEach(
      (button) => {

        button.disabled = true;
        button.dataset.originalText =
          button.textContent;

        button.textContent =
          'Saving…';

      }
    );

    try {

      const profile = {
        ...state.profile,
        ...readFields(root)
      };

      /* --------------------------------------------------------------
         SAVE NAME TO CLERK'S REAL PROFILE FIELDS

         Shop AI only has a single "Name" input, but Clerk stores
         first/last name separately (and that's what shows up in the
         Clerk Dashboard's "Personal information" panel). Split on the
         first space: everything before it is firstName, the rest is
         lastName. Only call update() if the name actually changed, to
         avoid an unnecessary request every save.
         -------------------------------------------------------------- */

      const trimmedName =
        (profile.displayName || '').trim();

      if (trimmedName) {

        const [firstName, ...rest] =
          trimmedName.split(/\s+/);

        const lastName =
          rest.join(' ');

        const nameChanged =
          firstName !== (state.clerkUser.firstName || '') ||
          lastName !== (state.clerkUser.lastName || '');

        if (nameChanged) {

          await state.clerkUser.update({
            firstName,
            lastName
          });

        }

      }

      /* --------------------------------------------------------------
         SAVE PHOTO TO CLERK
         -------------------------------------------------------------- */

      if (state.photoDraft) {

        if (!state.photoDraft.file) {
          throw new Error(
            'Prepared photo is missing.'
          );
        }

        const result =
          await state.clerkUser.setProfileImage({
            file: state.photoDraft.file
          });

        if (result?.publicUrl) {

          const image =
            root.querySelector(
              '.manage-avatar img'
            );

          if (image) {

            image.src =
              `${result.publicUrl}${result.publicUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;

            image.style.display = '';

          }

        }

        state.photoDraft = null;

      }

      /* --------------------------------------------------------------
         SAVE SHOP AI PROFILE DATA
         -------------------------------------------------------------- */

      const metadata = {
        ...(state.clerkUser.unsafeMetadata || {}),
        shopAIProfile: profile
      };

      if (
        typeof state.clerkUser.updateMetadata ===
        'function'
      ) {

        await state.clerkUser.updateMetadata({
          unsafeMetadata: {
            shopAIProfile: profile
          }
        });

      } else if (
        typeof state.clerkUser.update ===
        'function'
      ) {

        await state.clerkUser.update({
          unsafeMetadata: metadata
        });

      }

      state.profile = profile;
      announceProfileChange();

      /* Push the updated Clerk + Shop AI profile data into Supabase right
         away, instead of waiting for the automatic sync on next load. */
      if (window.ShopAISupabase && typeof window.ShopAISupabase.syncProfile === 'function') {
        window.ShopAISupabase.syncProfile(state.clerkUser, profile);
      }

      /* Local fallback */

      try {

        localStorage.setItem(
          getProfileKey(
            state.clerkUser
          ),
          JSON.stringify(profile)
        );

      } catch {}

      /* Profile rows are always live — the tab has no edit mode, the way
         Settings has no edit mode. This used to strip
         .manage-card--editing off EVERY card once a save landed, which
         hid every input and made every picker refuse to open: type one
         thing, and 600ms later the whole tab was frozen until reload.
         Only cards that genuinely have an edit/save cycle get reset. */

      root
        .querySelectorAll('.manage-card')
        .forEach((card) => {

          if (card.closest('#tab-profile')) return;

          setCardEditing(
            card,
            false
          );

        });

      root.classList.remove(
        'manage-profile-editing'
      );

      state.editingAll = false;

      populateIdentity(
        root,
        state.clerkUser,
        state.profile
      );

      /* Update sidebar identity */

      const name =
        displayName(
          state.clerkUser,
          state.profile
        );

      document
        .querySelectorAll(
          '.user-name, .profile-menu__name'
        )
        .forEach((element) => {

          element.textContent =
            name;

        });

      /* Update avatar everywhere */

      if (state.clerkUser.imageUrl) {

        const avatarUrl =
          state.clerkUser.imageUrl;

        document
          .querySelectorAll(
            '.user-avatar img, .profile-menu__avatar img'
          )
          .forEach((image) => {

            image.src =
              `${avatarUrl}${avatarUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;

          });

      }

    } catch (error) {

      console.error(
        'Could not save profile:',
        error
      );

      alert(
        error?.errors?.[0]?.longMessage ||
        error?.message ||
        'Could not save your profile. Please try again.'
      );

    } finally {

      saveButtons.forEach(
        (button) => {

          button.disabled = false;

          button.textContent =
            button.dataset.originalText ||
            'Save';

        }
      );

    }

  }

  /* ------------------------------------------------------------------
     PHOTO EDITOR
     ------------------------------------------------------------------ */
  function initPhotoEditor(root, state) {

  const input =
    root.querySelector('[data-photo-input]');

  const modal =
    root.querySelector('[data-photo-modal]');

  const stage =
    root.querySelector('[data-photo-stage]');

  const image =
    root.querySelector('[data-photo-crop-image]');

  const zoom =
    root.querySelector('[data-photo-zoom]');

  const changeButton =
    root.querySelector('[data-photo-change]');

  const applyButton =
    root.querySelector('[data-photo-apply]');

  const cancelButtons =
    root.querySelectorAll('[data-photo-cancel]');


  /* --------------------------------------------------------------
     SAFETY CHECK
     -------------------------------------------------------------- */

  if (
    !input ||
    !modal ||
    !stage ||
    !image ||
    !zoom ||
    !changeButton
  ) {

    console.warn(
      'Shop AI: Photo editor could not initialize.',
      {
        input: !!input,
        modal: !!modal,
        stage: !!stage,
        image: !!image,
        zoom: !!zoom,
        changeButton: !!changeButton
      }
    );

    return;
  }


  /* --------------------------------------------------------------
     CROP STATE
     -------------------------------------------------------------- */

  const crop = {

    baseScale: 1,

    scale: 1,

    x: 0,

    y: 0,

    naturalWidth: 0,

    naturalHeight: 0,

    dragging: false,

    startX: 0,

    startY: 0,

    originX: 0,

    originY: 0

  };


  /* --------------------------------------------------------------
     SHOW / HIDE PHOTO BUTTON
     -------------------------------------------------------------- */

  const updatePhotoButton = () => {

    const editing =
      root.classList.contains(
        'manage-profile-editing'
      );

    changeButton.style.display =
      editing ? 'flex' : 'none';

    changeButton.disabled =
      !editing;

  };


  updatePhotoButton();


  /*
   * Watch the manage panel class.
   *
   * Profile Edit adds:
   * .manage-profile-editing
   *
   * Profile Cancel / Save removes it.
   */

  const editingObserver =
    new MutationObserver(() => {

      updatePhotoButton();

    });


  editingObserver.observe(
    root,
    {
      attributes: true,
      attributeFilter: ['class']
    }
  );


  /* --------------------------------------------------------------
     RENDER PHOTO
     -------------------------------------------------------------- */

  const render = () => {

    const width =
      crop.naturalWidth *
      crop.baseScale *
      crop.scale;

    const height =
      crop.naturalHeight *
      crop.baseScale *
      crop.scale;


    image.style.width =
      `${width}px`;

    image.style.height =
      `${height}px`;

    image.style.left =
      `${crop.x}px`;

    image.style.top =
      `${crop.y}px`;

  };


  /* --------------------------------------------------------------
     OPEN MODAL
     -------------------------------------------------------------- */

  const open = () => {

    modal.classList.add(
      'manage-photo-modal--open'
    );

    modal.setAttribute(
      'aria-hidden',
      'false'
    );

  };


  /* --------------------------------------------------------------
     CLOSE MODAL
     -------------------------------------------------------------- */

  const close = () => {

    modal.classList.remove(
      'manage-photo-modal--open'
    );

    modal.setAttribute(
      'aria-hidden',
      'true'
    );

    input.value = '';

    crop.dragging = false;

  };


  /* --------------------------------------------------------------
     CHANGE PHOTO
     -------------------------------------------------------------- */

  changeButton.addEventListener(
    'click',
    (event) => {

      event.preventDefault();
      event.stopPropagation();


      if (
        !root.classList.contains(
          'manage-profile-editing'
        )
      ) {

        return;

      }


      input.click();

    }
  );


  /* --------------------------------------------------------------
     FILE SELECT
     -------------------------------------------------------------- */

  input.addEventListener(
    'change',
    () => {

      const file =
        input.files?.[0];


      if (
        !file ||
        !file.type.startsWith('image/')
      ) {

        return;

      }


      /*
       * Limit extremely large files before
       * sending anything to Clerk.
       */

      const MAX_FILE_SIZE =
        15 * 1024 * 1024;


      if (
        file.size > MAX_FILE_SIZE
      ) {

        alert(
          'Please choose an image smaller than 15 MB.'
        );

        input.value = '';

        return;

      }


      const url =
        URL.createObjectURL(file);


        image.onload = () => {

          crop.naturalWidth =
            image.naturalWidth;

          crop.naturalHeight =
            image.naturalHeight;

          /*
           * Show the modal FIRST — the stage has
           * no real width/height while display:none,
           * so measuring it before open() collapses
           * the photo to 0x0.
           */

          open();

          requestAnimationFrame(() => {

            const stageWidth =
              stage.clientWidth;

            const stageHeight =
              stage.clientHeight;


            /*
             * Cover the complete crop stage.
             */

            crop.baseScale =
              Math.max(
                stageWidth /
                  crop.naturalWidth,

                stageHeight /
                  crop.naturalHeight
              );


            crop.scale = 1;


            zoom.value = '1';


            const width =
              crop.naturalWidth *
              crop.baseScale;


            const height =
              crop.naturalHeight *
              crop.baseScale;


            /*
             * Center image.
             */

            crop.x =
              (stageWidth - width) / 2;

            crop.y =
              (stageHeight - height) / 2;


            render();

          });

          URL.revokeObjectURL(url);

        };


      image.onerror = () => {

        URL.revokeObjectURL(url);

        alert(
          'This image could not be loaded. Please choose another photo.'
        );

      };


      image.src = url;

    }
  );


  /* --------------------------------------------------------------
     ZOOM
     -------------------------------------------------------------- */

  zoom.addEventListener(
    'input',
    () => {

      const oldScale =
        crop.scale;

      const newScale =
        Number(zoom.value);


      if (
        !Number.isFinite(newScale) ||
        newScale <= 0
      ) {

        return;

      }


      const centerX =
        stage.clientWidth / 2;

      const centerY =
        stage.clientHeight / 2;


      /*
       * Keep the zoom centered around
       * the middle of the crop area.
       */

      crop.x =
        centerX -
        (
          centerX -
          crop.x
        ) *
        (
          newScale /
          oldScale
        );


      crop.y =
        centerY -
        (
          centerY -
          crop.y
        ) *
        (
          newScale /
          oldScale
        );


      crop.scale =
        newScale;


      render();

    }
  );


  /* --------------------------------------------------------------
     DRAG PHOTO
     -------------------------------------------------------------- */

  stage.addEventListener(
    'pointerdown',
    (event) => {

      if (
        !image.src ||
        !image.naturalWidth
      ) {

        return;

      }


      crop.dragging = true;


      crop.startX =
        event.clientX;

      crop.startY =
        event.clientY;


      crop.originX =
        crop.x;

      crop.originY =
        crop.y;


      stage.setPointerCapture(
        event.pointerId
      );


      stage.style.cursor =
        'grabbing';

    }
  );


  stage.addEventListener(
    'pointermove',
    (event) => {

      if (
        !crop.dragging
      ) {

        return;

      }


      crop.x =
        crop.originX +
        event.clientX -
        crop.startX;


      crop.y =
        crop.originY +
        event.clientY -
        crop.startY;


      render();

    }
  );


  const stopDragging = () => {

    crop.dragging = false;

    stage.style.cursor =
      '';

  };


  stage.addEventListener(
    'pointerup',
    stopDragging
  );


  stage.addEventListener(
    'pointercancel',
    stopDragging
  );


  stage.addEventListener(
    'lostpointercapture',
    stopDragging
  );


  /* --------------------------------------------------------------
     CANCEL
     -------------------------------------------------------------- */

  cancelButtons.forEach(
    (button) => {

      button.addEventListener(
        'click',
        (event) => {

          event.preventDefault();

          close();

        }
      );

    }
  );


  /* --------------------------------------------------------------
     APPLY PHOTO
     -------------------------------------------------------------- */

  if (applyButton) {

    applyButton.addEventListener(
      'click',
      () => {

        if (
          !image.naturalWidth ||
          !image.naturalHeight
        ) {

          return;

        }


        const outputSize =
          640;


        /*
         * The circular ring represents
         * approximately 84% of the stage.
         */

        const cropSize =
          Math.min(
            stage.clientWidth,
            stage.clientHeight
          ) * 0.84;


        const cropLeft =
          (
            stage.clientWidth -
            cropSize
          ) / 2;


        const cropTop =
          (
            stage.clientHeight -
            cropSize
          ) / 2;


        const displayedScale =
          crop.baseScale *
          crop.scale;


        /*
         * Convert screen coordinates
         * back into original image pixels.
         */

        const sx =
          Math.max(
            0,
            (
              cropLeft -
              crop.x
            ) /
            displayedScale
          );


        const sy =
          Math.max(
            0,
            (
              cropTop -
              crop.y
            ) /
            displayedScale
          );


        const sw =
          Math.min(
            image.naturalWidth -
            sx,

            cropSize /
            displayedScale
          );


        const sh =
          Math.min(
            image.naturalHeight -
            sy,

            cropSize /
            displayedScale
          );


        if (
          sw <= 0 ||
          sh <= 0
        ) {

          return;

        }


        const canvas =
          document.createElement(
            'canvas'
          );


        canvas.width =
          outputSize;

        canvas.height =
          outputSize;


        const ctx =
          canvas.getContext('2d');


        if (!ctx) {

          return;

        }


        /*
         * High quality square crop.
         */

        ctx.imageSmoothingEnabled =
          true;

        ctx.imageSmoothingQuality =
          'high';


        ctx.drawImage(
          image,

          sx,
          sy,

          sw,
          sh,

          0,
          0,

          outputSize,
          outputSize
        );


        canvas.toBlob(
          (blob) => {

            if (!blob) {

              alert(
                'Could not prepare the photo.'
              );

              return;

            }


            const file =
              new File(
                [blob],

                'shop-ai-profile.jpg',

                {
                  type:
                    'image/jpeg'
                }
              );


            /*
             * Remove previous temporary
             * preview URL if one exists.
             */

            if (
              state.photoDraft?.previewUrl
            ) {

              URL.revokeObjectURL(
                state.photoDraft.previewUrl
              );

            }


            const previewUrl =
              URL.createObjectURL(
                blob
              );


            state.photoDraft = {

              file,

              previewUrl

            };


            /*
             * Immediately show the new
             * photo in Manage Account.
             *
             * It is NOT uploaded to Clerk
             * until Save is pressed.
             */

            const avatar =
              root.querySelector(
                '.manage-avatar img'
              );


            if (avatar) {

              avatar.src =
                previewUrl;

              avatar.style.display =
                '';

            }


            close();

          },

          'image/jpeg',

          0.92

        );

      }
    );

  }

}
            
  /* ==================================================================
     SECURITY TAB
     Everything here reads/writes the *real* Clerk User object — this
     is the same data you see in the Clerk Dashboard's Users > Profile
     screen (email addresses, password, social accounts, devices).
     Shop AI's own field styling (.manage-list, .manage-inline-form) is
     reused so it looks native to this panel, not like an embed.
     ================================================================== */

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function timeAgo(dateLike) {
    if (!dateLike) return '';
    const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
    if (isNaN(date.getTime())) return '';
    const diffMs = Date.now() - date.getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  const CONNECT_PROVIDERS = {
    oauth_google: { label: 'Google' }
  };

  const providerLabel = (provider) =>
    (CONNECT_PROVIDERS[provider] && CONNECT_PROVIDERS[provider].label) ||
    String(provider || '').replace(/^oauth_/, '').replace(/^\w/, (c) => c.toUpperCase());

  const ICONS = {
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15 15 9"/><path d="M11 6l1-1a3.5 3.5 0 0 1 5 5l-1 1"/><path d="M13 18l-1 1a3.5 3.5 0 0 1-5-5l1-1"/></svg>',
    device: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>'
  };

  /* ------------------------------------------------------------------
     EMAIL ADDRESSES
     ------------------------------------------------------------------ */

  function renderEmails(root, state) {

    const list = root.querySelector('#securityEmailList');
    if (!list) return;

    const clerkUser = state.clerkUser;
    const emails = (clerkUser && clerkUser.emailAddresses) || [];
    const primaryId = clerkUser && clerkUser.primaryEmailAddressId;

    if (!emails.length) {
      list.innerHTML = '<div class="manage-list__empty">No email addresses on file.</div>';
      return;
    }

    list.innerHTML = emails.map((email) => {

      const isPrimary = email.id === primaryId;
      const isVerified = email.verification && email.verification.status === 'verified';

      const pills = [
        isPrimary ? '<span class="manage-pill manage-pill--primary">Primary</span>' : '',
        isVerified
          ? '<span class="manage-pill manage-pill--verified">Verified</span>'
          : '<span class="manage-pill manage-pill--unverified">Unverified</span>'
      ].join('');

      const actions = [
        !isVerified
          ? `<button type="button" class="manage-list__link-btn" data-email-action="verify" data-email-id="${email.id}">Verify</button>`
          : '',
        (isVerified && !isPrimary)
          ? `<button type="button" class="manage-list__link-btn" data-email-action="primary" data-email-id="${email.id}">Make primary</button>`
          : '',
        !isPrimary
          ? `<button type="button" class="manage-list__link-btn manage-list__link-btn--danger" data-email-action="remove" data-email-id="${email.id}">Remove</button>`
          : ''
      ].join('');

      return `
        <div class="manage-list__row" data-email-row="${email.id}">
          <span class="manage-list__icon">${ICONS.mail}</span>
          <div class="manage-list__body">
            <div class="manage-list__title">
              <span class="manage-list__value">${escapeHtml(email.emailAddress)}</span>
              ${pills}
            </div>
          </div>
          <div class="manage-list__actions">${actions}</div>
        </div>`;

    }).join('');

  }

  function findEmailObject(state, id) {
    return (state.clerkUser.emailAddresses || []).find((e) => e.id === id);
  }

  function wireEmailAddresses(root, state) {

    const verifyForm = root.querySelector('[data-email-verify-form]');
    const verifyInput = root.querySelector('[data-email-verify-input]');
    const verifySubmit = root.querySelector('[data-email-verify-submit]');
    const verifyCancel = root.querySelector('[data-email-verify-cancel]');
    const verifyHint = root.querySelector('[data-email-verify-hint]');

    const list = root.querySelector('#securityEmailList');

    const closeVerifyForm = () => {
      if (verifyForm) verifyForm.hidden = true;
      if (verifyInput) verifyInput.value = '';
      if (verifyHint) verifyHint.classList.remove('manage-inline-form__hint--error');
      state.pendingEmail = null;
    };

    const openVerifyFor = (emailObject) => {
      state.pendingEmail = emailObject;
      if (verifyForm) verifyForm.hidden = false;
      if (verifyHint) {
        verifyHint.textContent = `Enter the code we sent to ${emailObject.emailAddress}.`;
        verifyHint.classList.remove('manage-inline-form__hint--error');
      }
      if (verifyInput) verifyInput.focus();
    };

    if (verifyCancel) {
      verifyCancel.addEventListener('click', closeVerifyForm);
    }

    if (verifySubmit) {
      verifySubmit.addEventListener('click', async () => {

        const code = (verifyInput && verifyInput.value || '').trim();

        if (!state.pendingEmail || !code) return;

        verifySubmit.disabled = true;
        verifySubmit.textContent = 'Verifying…';

        try {

          await state.pendingEmail.attemptVerification({ code });
          await state.clerkUser.reload();

          renderEmails(root, state);
          closeVerifyForm();

        } catch (error) {

          if (verifyHint) {
            verifyHint.textContent =
              error?.errors?.[0]?.longMessage ||
              error?.message ||
              'That code didn\'t work. Please try again.';
            verifyHint.classList.add('manage-inline-form__hint--error');
          }

        } finally {
          verifySubmit.disabled = false;
          verifySubmit.textContent = 'Verify';
        }

      });
    }

    if (list) {

      list.addEventListener('click', async (event) => {

        const button = event.target.closest('[data-email-action]');
        if (!button) return;

        const action = button.getAttribute('data-email-action');
        const id = button.getAttribute('data-email-id');
        const emailObject = findEmailObject(state, id);
        if (!emailObject) return;

        if (action === 'primary') {

          button.disabled = true;

          try {
            await state.clerkUser.update({ primaryEmailAddressId: id });
            await state.clerkUser.reload();
            renderEmails(root, state);
          } catch (error) {
            alert(error?.errors?.[0]?.longMessage || error?.message || 'Could not update primary email.');
            button.disabled = false;
          }

        } else if (action === 'remove') {

          if (!confirm(`Remove ${emailObject.emailAddress}?`)) return;

          button.disabled = true;

          try {
            await emailObject.destroy();
            await state.clerkUser.reload();
            renderEmails(root, state);
          } catch (error) {
            alert(error?.errors?.[0]?.longMessage || error?.message || 'Could not remove that email.');
            button.disabled = false;
          }

        } else if (action === 'verify') {

          button.disabled = true;

          try {
            await emailObject.prepareVerification({ strategy: 'email_code' });
            openVerifyFor(emailObject);
          } catch (error) {
            alert(error?.errors?.[0]?.longMessage || error?.message || 'Could not resend the code.');
          } finally {
            button.disabled = false;
          }

        }

      });

    }

  }

  /* ------------------------------------------------------------------
     PASSWORD
     ------------------------------------------------------------------ */

  function renderPassword(root, state) {

    const status = root.querySelector('#securityPasswordStatus');
    const toggle = root.querySelector('[data-password-toggle]');
    const currentWrap = root.querySelector('[data-password-current-wrap]');

    const hasPassword = !!(state.clerkUser && state.clerkUser.passwordEnabled);

    if (status) {
      status.innerHTML = hasPassword
        ? '<span class="manage-pill manage-pill--verified">Set</span> Your account has a password.'
        : '<span class="manage-pill manage-pill--unverified">Not set</span> You\'re currently signing in another way (e.g. Google).';
    }

    if (toggle) {
      toggle.textContent = hasPassword ? 'Change password' : 'Set password';
    }

    if (currentWrap) {
      currentWrap.hidden = !hasPassword;
    }

  }

  /*
   * Step 1 ("details"): current password (if one is already set) +
   * new password, live-checked against the length/letter/number
   * requirements. Mirrors loginpage.js's signup "details" step, which
   * also gates its Continue button on live validation before moving on.
   */
  function checkPasswordDetailsStep(root) {

    const newInput = root.querySelector('[data-password-new]');
    const currentInput = root.querySelector('[data-password-current]');
    const currentWrap = root.querySelector('[data-password-current-wrap]');
    const continueBtn = root.querySelector('[data-password-continue]');
    const reqList = root.querySelector('[data-password-requirements]');

    const value = (newInput && newInput.value) || '';
    const needsCurrent = currentWrap && !currentWrap.hidden;

    const checks = {
      length: value.length >= 8,
      letter: /[a-zA-Z]/.test(value),
      number: /[0-9]/.test(value)
    };

    if (reqList) {
      Object.entries(checks).forEach(([key, passed]) => {
        const item = reqList.querySelector(`[data-req="${key}"]`);
        if (item) item.classList.toggle('pw-requirements__item--met', passed);
      });
    }

    const currentOk = !needsCurrent || !!(currentInput && currentInput.value);
    const allMet = Object.values(checks).every(Boolean) && currentOk;

    if (continueBtn) continueBtn.disabled = !allMet;

    return allMet;

  }

  /*
   * Step 2 ("confirm"): current + new password have already been
   * hidden away by this point -- only "Confirm new password" is on
   * screen, same as loginpage.js never shows email + password +
   * verification code all at once.
   */
  function checkPasswordConfirmStep(root) {

    const newInput = root.querySelector('[data-password-new]');
    const confirmInput = root.querySelector('[data-password-confirm]');
    const submit = root.querySelector('[data-password-submit]');
    const matchHint = root.querySelector('[data-req="match"]');

    const newValue = (newInput && newInput.value) || '';
    const confirmValue = (confirmInput && confirmInput.value) || '';
    const matches = confirmValue.length > 0 && confirmValue === newValue;

    if (matchHint) {
      matchHint.classList.toggle('pw-match-hint--met', matches);
      matchHint.classList.toggle('pw-match-hint--error', confirmValue.length > 0 && !matches);
      matchHint.textContent = confirmValue.length > 0 && !matches
        ? 'Passwords don\u2019t match.'
        : 'Passwords must match.';
    }

    if (submit) submit.disabled = !matches;

    return matches;

  }

  function wirePassword(root, state) {

    const toggle = root.querySelector('[data-password-toggle]');
    const modal = root.querySelector('[data-password-modal]');
    const modalTitle = root.querySelector('[data-password-modal-title]');
    const detailsStep = root.querySelector('[data-password-step="details"]');
    const confirmStep = root.querySelector('[data-password-step="confirm"]');

    const currentInput = root.querySelector('[data-password-current]');
    const newInput = root.querySelector('[data-password-new]');
    const confirmInput = root.querySelector('[data-password-confirm]');

    const continueBtn = root.querySelector('[data-password-continue]');
    const submit = root.querySelector('[data-password-submit]');
    const backBtn = root.querySelector('[data-password-back]');
    const hint = root.querySelector('[data-password-hint]');

    /* Every element that closes the modal shares this attribute --
       the backdrop, the × button, and each step's "Cancel" text
       button -- same fan-out as data-reverify-cancel on the
       reverification modal. */
    const cancelTargets = root.querySelectorAll('[data-password-cancel]');

    const resetInputs = () => {
      if (currentInput) currentInput.value = '';
      if (newInput) newInput.value = '';
      if (confirmInput) confirmInput.value = '';
      root.querySelectorAll('[data-password-eye]').forEach((btn) => {
        const input = root.querySelector(`[data-password-${btn.getAttribute('data-password-eye')}]`);
        if (input) input.type = 'password';
        btn.classList.remove('pw-field__eye--active');
        btn.setAttribute('aria-label', 'Show password');
      });
    };

    /* Swaps which step is visible -- the two steps are never shown
       at the same time, same as the sign-up flow swapping its field
       group instead of stacking every step on screen at once. */
    const showStep = (step) => {

      if (detailsStep) detailsStep.hidden = step !== 'details';
      if (confirmStep) confirmStep.hidden = step !== 'confirm';

      if (hint) {
        hint.textContent = '';
        hint.classList.remove('manage-inline-form__hint--error', 'manage-inline-form__hint--success');
      }

      if (step === 'details') {
        checkPasswordDetailsStep(root);
        const focusTarget = (currentInput && !currentInput.closest('[hidden]')) ? currentInput : newInput;
        if (focusTarget) focusTarget.focus();
      } else {
        checkPasswordConfirmStep(root);
        if (confirmInput) confirmInput.focus();
      }

    };

    /* Opens as a popup over the panel -- the backdrop only dims the
       page (see .manage-password-modal in index.css), it never blurs
       it, and the fields inside keep the exact glass treatment from
       loginpage.css. */
    const openModal = () => {
      if (!modal) return;
      renderPassword(root, state);
      const hasPassword = !!(state.clerkUser && state.clerkUser.passwordEnabled);
      if (modalTitle) modalTitle.textContent = hasPassword ? 'Change password' : 'Set password';
      resetInputs();
      showStep('details');
      modal.classList.add('manage-photo-modal--open');
      modal.setAttribute('aria-hidden', 'false');
    };

    const closeModal = () => {
      if (!modal) return;
      modal.classList.remove('manage-photo-modal--open');
      modal.setAttribute('aria-hidden', 'true');
      resetInputs();
      showStep('details');
    };

    if (toggle && modal) {
      toggle.addEventListener('click', openModal);
    }

    cancelTargets.forEach((el) => el.addEventListener('click', closeModal));
    if (backBtn) backBtn.addEventListener('click', () => showStep('details'));

    [currentInput, newInput].forEach((input) => {
      if (!input) return;
      input.addEventListener('input', () => checkPasswordDetailsStep(root));
    });

    if (confirmInput) {
      confirmInput.addEventListener('input', () => checkPasswordConfirmStep(root));
    }

    /* Show/hide toggles for each password field */
    root.querySelectorAll('[data-password-eye]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.getAttribute('data-password-eye');
        const input = root.querySelector(`[data-password-${key}]`);
        if (!input) return;
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        button.classList.toggle('pw-field__eye--active', !showing);
        button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      });
    });

    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        if (!checkPasswordDetailsStep(root)) return;
        showStep('confirm');
      });
    }

    if (submit) {

      submit.addEventListener('click', async () => {

        if (!checkPasswordConfirmStep(root)) return;

        const hasPassword = !!(state.clerkUser && state.clerkUser.passwordEnabled);

        const current = (currentInput && currentInput.value) || '';
        const next = (newInput && newInput.value) || '';

        submit.disabled = true;
        const originalLabel = submit.textContent;
        submit.innerHTML = '<span class="pw-btn-spinner" aria-hidden="true"></span>Saving…';

        try {

          const payload = hasPassword
            ? { currentPassword: current, newPassword: next, signOutOfOtherSessions: false }
            : { newPassword: next };

          // Setting/changing a password is one of Clerk's sensitive
          // actions -- it may ask for reverification first.
          await withReverification(root, state, () => state.clerkUser.updatePassword(payload));
          await state.clerkUser.reload();

          renderPassword(root, state);

          if (hint) {
            hint.textContent = 'Password saved.';
            hint.classList.remove('manage-inline-form__hint--error');
            hint.classList.add('manage-inline-form__hint--success');
          }

          setTimeout(closeModal, 900);

        } catch (error) {

          if (hint) {
            hint.textContent =
              error?.errors?.[0]?.longMessage ||
              error?.message ||
              'Could not update your password.';
            hint.classList.remove('manage-inline-form__hint--success');
            hint.classList.add('manage-inline-form__hint--error');
          }

          submit.disabled = false;

        } finally {
          submit.textContent = originalLabel;
        }

      });

    }

  }

  /* ------------------------------------------------------------------
     CONNECTED ACCOUNTS
     ------------------------------------------------------------------ */

  function renderConnectedAccounts(root, state) {

    const list = root.querySelector('#securityConnectedList');
    if (!list) return;

    const accounts = (state.clerkUser && state.clerkUser.externalAccounts) || [];

    const connectBtn = root.querySelector('[data-connect-google]');
    if (connectBtn) {
      const hasGoogle = accounts.some((a) => a.provider === 'oauth_google');
      connectBtn.hidden = hasGoogle;
    }

    if (!accounts.length) {
      list.innerHTML = '<div class="manage-list__empty">No accounts connected.</div>';
      return;
    }

    list.innerHTML = accounts.map((account) => {

      const verified =
        !account.verification || account.verification.status === 'verified';

      return `
        <div class="manage-list__row">
          <span class="manage-list__icon">${ICONS.link}</span>
          <div class="manage-list__body">
            <div class="manage-list__title">
              <span class="manage-list__value">${escapeHtml(providerLabel(account.provider))}</span>
              ${verified ? '<span class="manage-pill manage-pill--verified">Connected</span>' : '<span class="manage-pill manage-pill--unverified">Pending</span>'}
            </div>
            <div class="manage-list__meta">${escapeHtml(account.emailAddress || account.username || '')}</div>
          </div>
          <div class="manage-list__actions">
            <button type="button" class="manage-list__link-btn manage-list__link-btn--danger" data-external-action="disconnect" data-external-id="${account.id}">Disconnect</button>
          </div>
        </div>`;

    }).join('');

  }

  function wireConnectedAccounts(root, state) {

    const list = root.querySelector('#securityConnectedList');
    if (!list) return;

    list.addEventListener('click', async (event) => {

        const button = event.target.closest('[data-external-action="disconnect"]');
        if (!button) return;

        const id = button.getAttribute('data-external-id');
        const account = (state.clerkUser.externalAccounts || []).find((a) => a.id === id);
        if (!account) return;

        if (!confirm(`Disconnect ${providerLabel(account.provider)}?`)) return;

        button.disabled = true;

        try {
          await withReverification(root, state, () => account.destroy());
          await state.clerkUser.reload();
          renderConnectedAccounts(root, state);
        } catch (error) {
          if (!/reverification cancelled/i.test(error?.message || '')) {
            alert(error?.errors?.[0]?.longMessage || error?.message || 'Could not disconnect that account.');
          }
          button.disabled = false;
        }

      });

  }

  function wireConnectGoogle(root, state) {

    const button = root.querySelector('[data-connect-google]');
    if (!button) return;

    button.addEventListener('click', async () => {

      button.disabled = true;
      button.classList.add('is-loading');

      try {

        // Connecting an external account is one of Clerk's sensitive
        // actions -- this is what the "additional verification" error
        // was: Clerk was refusing the request outright because nothing
        // handled that requirement. withReverification() opens the
        // password modal and retries once the person verifies.
        const account = await withReverification(root, state, () =>
          state.clerkUser.createExternalAccount({
            strategy: 'oauth_google',
            redirectUrl: window.location.href
          })
        );

        const redirectUrl =
          account &&
          account.verification &&
          account.verification.externalVerificationRedirectURL;

        if (redirectUrl) {
          window.location.href = redirectUrl;
          return; // navigating away
        }

        await state.clerkUser.reload();
        renderConnectedAccounts(root, state);

      } catch (error) {

        // Don't alert when the person just closed the reverification
        // modal -- that's a deliberate cancel, not a failure.
        if (!/reverification cancelled/i.test(error?.message || '')) {
          alert(
            error?.errors?.[0]?.longMessage ||
            error?.message ||
            'Could not connect Google right now.'
          );
        }

      } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
      }

    });

  }

  /* ------------------------------------------------------------------
     ACTIVE DEVICES (sessions)
     ------------------------------------------------------------------ */

  async function renderSessions(root, state) {

    const list = root.querySelector('#securitySessionsList');
    if (!list) return;

    try {

      const sessions = await state.clerkUser.getSessions();
      const currentSessionId = state.clerk && state.clerk.session && state.clerk.session.id;

      if (!sessions || !sessions.length) {
        list.innerHTML = '<div class="manage-list__empty">No active devices found.</div>';
        return;
      }

      list.innerHTML = sessions.map((session) => {

        const activity = session.latestActivity || {};
        const isCurrent = session.id === currentSessionId;

        const deviceLabel = [activity.deviceType, activity.browserName]
          .filter(Boolean).join(' · ') || 'Unknown device';

        const location = [activity.city, activity.country]
          .filter(Boolean).join(', ');

        const lastActive =
          session.lastActiveAt ? timeAgo(session.lastActiveAt) : '';

        return `
          <div class="manage-list__row">
            <span class="manage-list__icon">${ICONS.device}</span>
            <div class="manage-list__body">
              <div class="manage-list__title">
                <span class="manage-list__value">${escapeHtml(deviceLabel)}</span>
                ${isCurrent ? '<span class="manage-pill manage-pill--current">This device</span>' : ''}
              </div>
              <div class="manage-list__meta">${[location, lastActive ? `active ${lastActive}` : ''].filter(Boolean).join(' · ') || 'Active session'}</div>
            </div>
            <div class="manage-list__actions">
              ${isCurrent ? '' : `<button type="button" class="manage-list__link-btn manage-list__link-btn--danger" data-session-action="revoke" data-session-id="${session.id}">Sign out</button>`}
            </div>
          </div>`;

      }).join('');

    } catch (error) {

      console.error('Could not load sessions:', error);
      list.innerHTML = '<div class="manage-list__empty">Could not load your active devices.</div>';

    }

  }

  function wireSessions(root, state) {

    const list = root.querySelector('#securitySessionsList');
    if (!list) return;

    list.addEventListener('click', async (event) => {

      const button = event.target.closest('[data-session-action="revoke"]');
      if (!button) return;

      if (!confirm('Sign out this device?')) return;

      const id = button.getAttribute('data-session-id');

      button.disabled = true;

      try {

        const sessions = await state.clerkUser.getSessions();
        const session = sessions.find((s) => s.id === id);

        if (session) {
          await withReverification(root, state, () => session.revoke());
        }

        await renderSessions(root, state);

      } catch (error) {
        if (!/reverification cancelled/i.test(error?.message || '')) {
          alert(error?.errors?.[0]?.longMessage || error?.message || 'Could not sign that device out.');
        }
        button.disabled = false;
      }

    });

  }

  /* ------------------------------------------------------------------
     DELETE ACCOUNT
     ------------------------------------------------------------------ */

  function wireDeleteAccount(root, state) {

    const toggle = root.querySelector('[data-delete-account-toggle]');
    const modal = root.querySelector('[data-delete-account-modal]');
    const input = root.querySelector('[data-delete-account-input]');
    const submit = root.querySelector('[data-delete-account-submit]');

    /* Backdrop, × button, and the "Cancel" action all share this
       attribute -- same fan-out pattern as the password and
       reverification modals. */
    const cancelTargets = root.querySelectorAll('[data-delete-account-cancel]');

    const openModal = () => {
      if (!modal) return;
      if (input) input.value = '';
      modal.classList.add('manage-photo-modal--open');
      modal.setAttribute('aria-hidden', 'false');
      if (input) input.focus();
    };

    const closeModal = () => {
      if (!modal) return;
      modal.classList.remove('manage-photo-modal--open');
      modal.setAttribute('aria-hidden', 'true');
      if (input) input.value = '';
    };

    if (toggle && modal) {
      toggle.addEventListener('click', openModal);
    }

    cancelTargets.forEach((el) => el.addEventListener('click', closeModal));

    if (submit) {

      submit.addEventListener('click', async () => {

        const value = ((input && input.value) || '').trim().toLowerCase();

        if (value !== 'delete') {
          alert('Type "delete" to confirm.');
          return;
        }

        if (!confirm('This permanently deletes your account. Continue?')) return;

        submit.disabled = true;
        submit.textContent = 'Deleting…';

        try {

          await withReverification(root, state, () => state.clerkUser.delete());

          // '/' has no index.html on this server (or in prod, may not
          // point anywhere meaningful) -- it was falling back to a raw
          // directory listing. loginpage.html is the sibling page in
          // /pages/, same relative-path convention loginpage.js uses
          // for its own HOME_URL redirect. replace() (not href=) also
          // drops this page from history, so pressing Back afterward
          // can't land back on a stale, pre-deletion snapshot of the
          // account panel.
          window.location.replace('loginpage.html');

        } catch (error) {

          if (!/reverification cancelled/i.test(error?.message || '')) {
            alert(error?.errors?.[0]?.longMessage || error?.message || 'Could not delete your account.');
          }
          submit.disabled = false;
          submit.textContent = 'Delete permanently';

        }

      });

    }

  }

  /* ------------------------------------------------------------------
     SECURITY TAB — entry point
     ------------------------------------------------------------------ */

  async function initSecurityTab(root, state) {

    if (!state.clerkUser) return;

    renderEmails(root, state);
    wireEmailAddresses(root, state);

    renderPassword(root, state);
    wirePassword(root, state);

    renderConnectedAccounts(root, state);
    wireConnectedAccounts(root, state);
    wireConnectGoogle(root, state);

    wireSessions(root, state);
    await renderSessions(root, state);

    wireDeleteAccount(root, state);

  }

  /* ------------------------------------------------------------------
     MODAL ACCESSIBILITY (focus trap, Escape-to-close, focus restore)
     ------------------------------------------------------------------
     Generic, additive layer that applies to every .manage-photo-modal
     (photo crop, reverify, password, delete-account) without touching
     any of their individual open/close logic above. It:
       - remembers whichever element had focus right before a modal
         opened, so focus returns there when the modal closes
       - traps Tab / Shift+Tab inside the modal card while it's open
       - lets Escape trigger the modal's own cancel/close button, so
         existing cancel behavior (clearing fields, rejecting pending
         promises, etc.) still runs exactly as it did before
     ------------------------------------------------------------------ */

  function initModalAccessibility(root) {

    const modals =
      Array.from(root.querySelectorAll('.manage-photo-modal'));

    if (!modals.length) return;

    let lastFocusedOutside = null;

    document.addEventListener('focusin', (event) => {
      const insideModal =
        event.target.closest &&
        event.target.closest('.manage-photo-modal');
      if (!insideModal) lastFocusedOutside = event.target;
    });

    const restoreTargets = new WeakMap();

    modals.forEach((modal) => {

      const observer = new MutationObserver(() => {

        const isOpen =
          modal.classList.contains('manage-photo-modal--open');

        if (isOpen) {

          if (!restoreTargets.has(modal)) {
            restoreTargets.set(modal, lastFocusedOutside);
          }

        } else if (restoreTargets.has(modal)) {

          const target = restoreTargets.get(modal);
          restoreTargets.delete(modal);

          if (target && typeof target.focus === 'function') {
            target.focus();
          }

        }

      });

      observer.observe(modal, {
        attributes: true,
        attributeFilter: ['class']
      });

    });

    document.addEventListener('keydown', (event) => {

      const openModal =
        modals.find((modal) =>
          modal.classList.contains('manage-photo-modal--open')
        );

      if (!openModal) return;

      if (event.key === 'Escape') {

        const closer =
          openModal.querySelector(
            '[data-photo-cancel], [data-reverify-cancel], [data-password-cancel], [data-delete-account-cancel], .manage-photo-modal__close'
          );

        if (closer) {
          event.preventDefault();
          closer.click();
        }

        return;

      }

      if (event.key !== 'Tab') return;

      const card =
        openModal.querySelector('.manage-photo-modal__card');

      if (!card) return;

      const focusable =
        Array.from(
          card.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null);

      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }

    });

  }

  /* ------------------------------------------------------------------
     INITIALIZE
     ------------------------------------------------------------------ */

  window.initManageAccountPanel =
    async function initManageAccountPanel(root) {

      if (!root) return;

      const state = {

        clerk: null,

        clerkUser: null,

        currentUser: null,

        profile: {},

        photoDraft: null,

        editingAll: false,

        pendingEmail: null,

        reverifyState: null

      };

      initTabs(root);
      watchOverlayOpen(root);
      initModalAccessibility(root);

      initCardEditing(
        root,
        state
      );

      // One shared debounced-save function for every Profile
      // interaction (text blur, chip click, tag add/remove) so a
      // burst of edits coalesces into a single Clerk/Supabase write.
      const scheduleSave = createAutosave(root, state);

      // Makes every Profile row (text/number/textarea) always-live —
      // see the function for why this also happens to be what makes
      // chip and tag fields interactive (they key off the same
      // .manage-card--editing class, applied permanently here instead
      // of by an Edit button click).
      initInlineRowEditing(
        root,
        state,
        scheduleSave
      );

      const chipFieldsApi = initChipAndTagFields(root, state, scheduleSave);
      initEditModeTyping(root);

      initReverifyModal(
        root,
        state
      );

      try {

        const clerk =
          window.ShopAIAuth.clerk ||
          await window.ShopAIAuth.ready;

        state.clerk = clerk;

        state.clerkUser =
          clerk.user;

        state.currentUser =
          clerk.user;

        state.profile =
          getStoredProfile(
            clerk.user
          );

        /* Restore every saved Shop AI field — text rows, chip
           selections, and tag lists alike — from state.profile.
           See profileKeyForField for how each row's data-field
           attribute maps to a key in this object. */
        populateProfileFields(
          root,
          state.profile
        );

        if (chipFieldsApi && typeof chipFieldsApi.resyncDobFromAge === 'function') {
          const ageInput = root.querySelector(
            '.manage-field--dob[data-field="age"] [data-dob-age-input]'
          );
          if (ageInput) chipFieldsApi.resyncDobFromAge(ageInput.value);
        }

        populateIdentity(
          root,
          clerk.user,
          state.profile
        );

        initPhotoEditor(
          root,
          state
        );

        await initSecurityTab(
          root,
          state
        );

      } catch (error) {

        console.error(
          'Could not load account details:',
          error
        );

        populateIdentity(  
          root,
          null
        );

      }

    };

})();