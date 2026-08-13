/* ==========================================================================
   manageaccount/index.js
   Unlike a normal page script, this panel doesn't exist in the DOM at
   load time — app.js fetches partials/manage-account-panel.html and
   injects it the first time the user opens it. So instead of running on
   DOMContentLoaded, everything here is wrapped in an init function that
   app.js calls once, right after injection, passing the overlay element.
   ========================================================================== */

window.initManageAccountPanel = function initManageAccountPanel(root) {
  if (!root || root.dataset.initialized === 'true') return; // avoid double-binding
  root.dataset.initialized = 'true';

  /* ------------------------------------------------------------------ */
  /* Tabs                                                                */
  /* ------------------------------------------------------------------ */
  const tabs = root.querySelectorAll('.manage-tab');
  const sections = root.querySelectorAll('.manage-section');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      tabs.forEach((t) => {
        t.classList.toggle('manage-tab--active', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      });

      sections.forEach((section) => {
        section.classList.toggle('manage-section--active', section.id === `tab-${target}`);
      });
    });
  });

  /* ------------------------------------------------------------------ */
  /* Inline edit / save / cancel                                        */
  /* Each .manage-card holds display <span class="manage-field__value">
     elements and matching <input>/<select> editors. Entering edit mode
     is purely a CSS class toggle (see manageaccount/index.css); save
     copies editor values back into the display spans, cancel discards
     whatever was typed and restores the editors to the last saved value. */
  /* ------------------------------------------------------------------ */
  root.querySelectorAll('.manage-card').forEach((card) => {
    const editBtn = card.querySelector('[data-edit-toggle]');
    const saveBtn = card.querySelector('[data-edit-save]');
    const cancelBtn = card.querySelector('[data-edit-cancel]');
    if (!editBtn) return; // card has no editable fields

    const fields = () => card.querySelectorAll('.manage-field');

    const syncEditorsFromValues = () => {
      fields().forEach((field) => {
        const value = field.querySelector('.manage-field__value');
        const input = field.querySelector('.manage-field__input');
        const select = field.querySelector('.manage-field__select');
        if (!value) return;
        const text = value.textContent.trim();
        if (input) input.value = text;
        if (select) {
          const match = Array.from(select.options).find((o) => o.text.trim() === text);
          if (match) select.value = match.value;
        }
      });
    };

    editBtn.addEventListener('click', () => {
      syncEditorsFromValues();
      card.classList.add('manage-card--editing');
      const firstInput = card.querySelector('.manage-field__input, .manage-field__select');
      if (firstInput) firstInput.focus();
    });

    cancelBtn?.addEventListener('click', () => {
      card.classList.remove('manage-card--editing');
    });

    saveBtn?.addEventListener('click', () => {
      fields().forEach((field) => {
        const value = field.querySelector('.manage-field__value');
        const input = field.querySelector('.manage-field__input');
        const select = field.querySelector('.manage-field__select');
        if (!value) return;
        if (select) value.textContent = select.options[select.selectedIndex].text;
        else if (input) value.textContent = input.value.trim() || value.textContent;
      });

      // TODO: replace with a real API call, e.g.
      // fetch('/api/profile', { method: 'PATCH', body: JSON.stringify(payload) })
      card.classList.remove('manage-card--editing');
    });
  });

  /* ------------------------------------------------------------------ */
  /* Avatar photo picker                                                 */
  /* ------------------------------------------------------------------ */
  const avatarEdit = root.querySelector('.manage-avatar__edit');
  const avatarImg = root.querySelector('.manage-avatar img');
  if (avatarEdit && avatarImg) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.hidden = true;
    document.body.appendChild(fileInput);

    avatarEdit.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      avatarImg.src = URL.createObjectURL(file);
      avatarImg.style.display = '';
    });
  }
};