/* ==========================================================================
   js/wardrobe.js — Wardrobe view: Supabase-backed items, Cloudinary
   upload, vision analysis, edit/delete. Exposes
   window.ShopAIWardrobe = { init, destroy } for the app-shell router.
   ========================================================================== */

(() => {
  'use strict';

  const THEME_STORAGE_KEY = 'shopai_theme';
  const WARDROBE_TABLE = 'wardrobe_items';
  const VISION_ENDPOINT = 'http://localhost:3000/api/vision/wardrobe';
  const UPLOAD_ENDPOINT = 'http://localhost:3000/api/upload';
  const WARDROBE_CATEGORIES = ['top', 'bottom', 'footwear', 'outerwear', 'accessory'];

  const WARDROBE_DETAIL_FIELDS = [
    { key: 'subcategory', label: 'Subcategory', placeholder: 'e.g. t-shirt' },
    { key: 'colors', label: 'Colors', placeholder: 'e.g. olive, black', isList: true },
    { key: 'material', label: 'Material', placeholder: 'e.g. cotton' },
    { key: 'pattern', label: 'Pattern', placeholder: 'e.g. striped' },
    { key: 'fit', label: 'Fit', placeholder: 'e.g. slim' },
    { key: 'sleeve', label: 'Sleeve', placeholder: 'e.g. full' },
    { key: 'neckline', label: 'Neckline', placeholder: 'e.g. crew' },
    { key: 'style', label: 'Style', placeholder: 'e.g. casual' },
    { key: 'season', label: 'Season', placeholder: 'e.g. summer' },
    { key: 'occasion', label: 'Occasion', placeholder: 'e.g. everyday' },
    { key: 'brand', label: 'Brand', placeholder: 'optional' },
  ];

  // DOM refs — (re)queried in init() every time this view is mounted.
  let themeToggle, themeButtons;
  let wardrobeGrid, wardrobeEmpty, wardrobeLoading, wardrobeAddBtn, wardrobeEmptyAddBtn, wardrobeFileInput;

  // In-memory cache, kept in sync with Supabase so renders stay synchronous.
  let wardrobeItemsCache = [];
  let hasFetchedOnce = false;

  function applyTheme(theme) {
    document.body.classList.toggle('theme-dark', theme === 'dark');
    themeButtons.forEach((btn) => {
      btn.classList.toggle('theme-toggle__btn--active', btn.dataset.theme === theme);
    });
  }

  function onThemeClick(e) {
    const theme = e.currentTarget.dataset.theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    applyTheme(theme);
  }

  // ==========================================================================
  // SUPABASE <-> APP SHAPE MAPPING
  // (DB uses image_url; the rest of this file keeps using item.image, same
  // as before, to minimize changes to the rendering code below.)
  // ==========================================================================
  function dbRowToItem(row) {
    return {
      id: row.id,
      image: row.image_url,
      name: row.name || '',
      category: row.category || 'top',
      subcategory: row.subcategory || '',
      colors: Array.isArray(row.colors) ? row.colors : [],
      material: row.material || '',
      pattern: row.pattern || '',
      fit: row.fit || '',
      sleeve: row.sleeve || '',
      neckline: row.neckline || '',
      style: row.style || '',
      season: row.season || '',
      occasion: row.occasion || '',
      brand: row.brand || '',
      confidence: row.confidence || 0,
      status: row.status || 'ready',
      createdAt: row.created_at,
    };
  }

  function itemPatchToDbPatch(patch) {
    const out = {};
    if ('image' in patch) out.image_url = patch.image;
    for (const key of ['name', 'category', 'subcategory', 'colors', 'material', 'pattern',
      'fit', 'sleeve', 'neckline', 'style', 'season', 'occasion', 'brand', 'confidence', 'status']) {
      if (key in patch) out[key] = patch[key];
    }
    return out;
  }

  async function getSupabase() {
    return window.ShopAISupabase.client || window.ShopAISupabase.ready;
  }

  function getClerkUserId() {
    const clerk = window.ShopAIAuth && window.ShopAIAuth.clerk;
    return clerk && clerk.user ? clerk.user.id : null;
  }

  // ==========================================================================
  // WARDROBE — Supabase-backed CRUD
  // ==========================================================================
  async function fetchWardrobeItems() {
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from(WARDROBE_TABLE)
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      wardrobeItemsCache = (data || []).map(dbRowToItem);
    } catch (err) {
      console.error('Wardrobe fetch error:', err);
      wardrobeItemsCache = [];
    }
    return wardrobeItemsCache;
  }

  // Synchronous read of whatever's currently cached — used by render code
  // that was written assuming a synchronous localStorage read.
  function loadWardrobeItems() {
    return wardrobeItemsCache;
  }

  async function insertWardrobeItem(item) {
    const clerkUserId = getClerkUserId();
    if (!clerkUserId) {
      console.error('Cannot save wardrobe item: no signed-in Clerk user.');
      return null;
    }
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from(WARDROBE_TABLE)
        .insert({
          clerk_user_id: clerkUserId,
          image_url: item.image,
          name: item.name,
          category: item.category,
          subcategory: item.subcategory,
          colors: item.colors,
          material: item.material,
          pattern: item.pattern,
          fit: item.fit,
          sleeve: item.sleeve,
          neckline: item.neckline,
          style: item.style,
          season: item.season,
          occasion: item.occasion,
          brand: item.brand,
          confidence: item.confidence,
          status: item.status,
        })
        .select()
        .single();
      if (error) throw error;
      const inserted = dbRowToItem(data);
      wardrobeItemsCache.push(inserted);
      return inserted;
    } catch (err) {
      // err.message here is the actual Postgres/PostgREST/RLS reason
      // (e.g. "new row violates row-level security policy", a check
      // constraint on `status`, a type mismatch on `colors`, etc.) —
      // check the console for this on any failed save.
      console.error('Wardrobe insert error:', err && err.message ? err.message : err, err);
      alert('Could not save item to your wardrobe. Please try again.');
      return null;
    }
  }

  async function updateWardrobeItem(id, patch) {
    // Optimistic local update so the UI feels instant.
    const target = wardrobeItemsCache.find((i) => i.id === id);
    if (target) Object.assign(target, patch);

    try {
      const supabase = await getSupabase();
      const { error } = await supabase
        .from(WARDROBE_TABLE)
        .update({ ...itemPatchToDbPatch(patch), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Wardrobe update error:', err);
      alert('Could not save your change. Please try again.');
    }
  }

  async function deleteWardrobeItem(id) {
    wardrobeItemsCache = wardrobeItemsCache.filter((i) => i.id !== id);
    renderWardrobeGrid();
    try {
      const supabase = await getSupabase();
      const { error } = await supabase.from(WARDROBE_TABLE).delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Wardrobe delete error:', err);
      alert('Could not delete this item. Refreshing your wardrobe.');
      await fetchWardrobeItems();
      renderWardrobeGrid();
    }
  }

  function makeWardrobeCategorySelect(item) {
    const select = document.createElement('select');
    select.className = 'wardrobe-item__category-select';
    WARDROBE_CATEGORIES.forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      if (cat === item.category) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      updateWardrobeItem(item.id, { category: select.value });
    });
    return select;
  }

  function makeConfidenceBadge(item) {
    const badge = document.createElement('span');
    badge.className = 'wardrobe-item__confidence';
    if (item.status === 'manual' || !item.confidence) {
      badge.textContent = 'Added manually';
      badge.classList.add('wardrobe-item__confidence--manual');
    } else {
      const pct = Math.round((item.confidence || 0) * 100);
      badge.textContent = `${pct}% match`;
      if (pct < 50) badge.classList.add('wardrobe-item__confidence--low');
    }
    return badge;
  }

  function makeWardrobeDetails(item) {
    const details = document.createElement('details');
    details.className = 'wardrobe-item__details';

    const summary = document.createElement('summary');
    summary.textContent = 'Edit details';
    details.appendChild(summary);

    const fieldsWrap = document.createElement('div');
    fieldsWrap.className = 'wardrobe-item__fields';

    WARDROBE_DETAIL_FIELDS.forEach(({ key, label, placeholder, isList }) => {
      const row = document.createElement('label');
      row.className = 'wardrobe-item__field';

      const labelText = document.createElement('span');
      labelText.className = 'wardrobe-item__field-label';
      labelText.textContent = label;
      row.appendChild(labelText);

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = placeholder || '';
      const rawValue = item[key];
      input.value = isList
        ? (Array.isArray(rawValue) ? rawValue.join(', ') : rawValue || '')
        : (rawValue && rawValue !== 'N/A' ? rawValue : '');
      input.addEventListener('change', () => {
        const value = isList
          ? input.value.split(',').map((v) => v.trim()).filter(Boolean)
          : input.value.trim();
        updateWardrobeItem(item.id, { [key]: value });
      });
      row.appendChild(input);

      fieldsWrap.appendChild(row);
    });

    details.appendChild(fieldsWrap);
    return details;
  }

  function makeWardrobeCard(item) {
    const card = document.createElement('div');
    card.className = 'wardrobe-item';
    if (item.status === 'uploading' || item.status === 'analyzing') card.classList.add('wardrobe-item--analyzing');
    card.dataset.id = item.id;

    const imgWrap = document.createElement('div');
    imgWrap.className = 'wardrobe-item__img-wrap';

    const img = document.createElement('img');
    img.className = 'wardrobe-item__img';
    img.src = item.image;
    img.alt = item.name || 'Wardrobe item';
    imgWrap.appendChild(img);

    if (item.status === 'uploading' || item.status === 'analyzing') {
      const overlay = document.createElement('div');
      overlay.className = 'wardrobe-item__analyzing-overlay';
      overlay.innerHTML = `
        <span class="wardrobe-item__analyzing-spinner"></span>
        <span>${item.status === 'uploading' ? 'Uploading…' : 'Analyzing…'}</span>
      `;
      imgWrap.appendChild(overlay);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'wardrobe-item__delete';
    deleteBtn.setAttribute('aria-label', 'Remove item');
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    deleteBtn.addEventListener('click', () => {
      deleteWardrobeItem(item.id);
    });
    imgWrap.appendChild(deleteBtn);

    const body = document.createElement('div');
    body.className = 'wardrobe-item__body';

    const nameInput = document.createElement('input');
    nameInput.className = 'wardrobe-item__name-input';
    nameInput.type = 'text';
    nameInput.value = item.name || '';
    nameInput.placeholder = item.status === 'uploading' ? 'Uploading…'
      : item.status === 'analyzing' ? 'Naming it…' : 'Name this item';
    nameInput.disabled = item.status === 'uploading' || item.status === 'analyzing';
    nameInput.addEventListener('change', () => {
      updateWardrobeItem(item.id, { name: nameInput.value.trim() });
    });

    body.appendChild(nameInput);
    body.appendChild(makeWardrobeCategorySelect(item));

    if (item.status !== 'uploading' && item.status !== 'analyzing') {
      body.appendChild(makeConfidenceBadge(item));
      body.appendChild(makeWardrobeDetails(item));
    }

    card.appendChild(imgWrap);
    card.appendChild(body);

    return card;
  }

  // Updates an existing card's DOM in place instead of replacing it, so
  // cards that haven't changed never get removed/reinserted — which is
  // what was replaying every card's entrance animation on every render
  // during the upload -> analyzing -> ready flow.
  function updateWardrobeCardContent(card, item) {
    const isBusy = item.status === 'uploading' || item.status === 'analyzing';
    card.classList.toggle('wardrobe-item--analyzing', isBusy);

    const img = card.querySelector('.wardrobe-item__img');
    if (img) {
      if (img.src !== item.image) img.src = item.image;
      img.alt = item.name || 'Wardrobe item';
    }

    const imgWrap = card.querySelector('.wardrobe-item__img-wrap');
    let overlay = card.querySelector('.wardrobe-item__analyzing-overlay');
    if (isBusy) {
      if (!overlay && imgWrap) {
        overlay = document.createElement('div');
        overlay.className = 'wardrobe-item__analyzing-overlay';
        imgWrap.insertBefore(overlay, imgWrap.querySelector('.wardrobe-item__delete'));
      }
      if (overlay) {
        overlay.innerHTML = `
          <span class="wardrobe-item__analyzing-spinner"></span>
          <span>${item.status === 'uploading' ? 'Uploading…' : 'Analyzing…'}</span>
        `;
      }
    } else if (overlay) {
      overlay.remove();
    }

    const nameInput = card.querySelector('.wardrobe-item__name-input');
    if (nameInput) {
      if (document.activeElement !== nameInput) nameInput.value = item.name || '';
      nameInput.placeholder = item.status === 'uploading' ? 'Uploading…'
        : item.status === 'analyzing' ? 'Naming it…' : 'Name this item';
      nameInput.disabled = isBusy;
    }

    const categorySelect = card.querySelector('.wardrobe-item__category-select');
    if (categorySelect && document.activeElement !== categorySelect) {
      categorySelect.value = item.category;
    }

    const body = card.querySelector('.wardrobe-item__body');
    const existingBadge = card.querySelector('.wardrobe-item__confidence');
    const existingDetails = card.querySelector('.wardrobe-item__details');

    if (!isBusy) {
      if (existingBadge) {
        body.replaceChild(makeConfidenceBadge(item), existingBadge);
      } else if (body) {
        body.appendChild(makeConfidenceBadge(item));
      }
      // Leave an already-present details block alone rather than replacing
      // it — that would blow away an open <details> or in-progress edits.
      if (!existingDetails && body) {
        body.appendChild(makeWardrobeDetails(item));
      }
    } else {
      if (existingBadge) existingBadge.remove();
      if (existingDetails) existingDetails.remove();
    }
  }

  function renderWardrobeGrid() {
    if (!wardrobeGrid) return;
    const items = loadWardrobeItems();

    if (wardrobeEmpty) wardrobeEmpty.hidden = items.length > 0;

    // Reconcile by id instead of wiping and rebuilding everything: reuse
    // each existing card's DOM node when its item is still present (update
    // its content in place), only creating a brand-new node — which plays
    // the entrance animation — for items that are actually new.
    const existingCards = new Map();
    Array.from(wardrobeGrid.children).forEach((card) => {
      if (card.dataset && card.dataset.id) existingCards.set(card.dataset.id, card);
    });

    let previousNode = null;
    items.forEach((item) => {
      let card = existingCards.get(item.id);
      if (card) {
        updateWardrobeCardContent(card, item);
        existingCards.delete(item.id);
      } else {
        card = makeWardrobeCard(item);
      }

      const desiredNext = previousNode ? previousNode.nextSibling : wardrobeGrid.firstChild;
      if (desiredNext !== card) {
        wardrobeGrid.insertBefore(card, desiredNext);
      }
      previousNode = card;
    });

    // Anything left in existingCards is for an item no longer in the list
    // (deleted, or the temp placeholder swapped for its real row).
    existingCards.forEach((card) => card.remove());
  }

  async function analyzeWardrobeImage(dataUrl) {
    try {
      const response = await fetch(VISION_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (!response.ok) throw new Error(`Vision endpoint returned ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error('Wardrobe vision request failed:', err);
      return { category: 'top', confidence: 0 };
    }
  }

  function titleCase(str) {
    if (!str || str === 'N/A') return '';
    return str.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function fileToNormalizedDataUrl(file, maxDim = 1600, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const scale = maxDim / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error(`Couldn't read "${file.name}" — try a JPG or PNG.`));
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function addWardrobeItemFromFile(file) {
    if (!file) return;

    let dataUrl;
    try {
      dataUrl = await fileToNormalizedDataUrl(file);
    } catch (err) {
      console.error('Failed to read wardrobe image:', err);
      alert(err.message || 'Failed to read that image — try a JPG or PNG.');
      return;
    }

    // Show an instant placeholder card with the actual photo + a spinner,
    // before the upload/insert round-trip even starts, so the click feels
    // immediate instead of hanging until the network call resolves.
    const tempId = `temp-${Date.now()}`;
    wardrobeItemsCache.push({
      id: tempId,
      image: dataUrl,
      name: '',
      category: 'top',
      colors: [],
      confidence: 0,
      status: 'uploading',
    });
    renderWardrobeGrid();

    let imageUrl = dataUrl;
    try {
      const uploadRes = await fetch(UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl })
      });
      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        imageUrl = uploadData.url;
      } else {
        console.error('Upload failed with status:', uploadRes.status);
      }
    } catch (err) {
      console.error('Upload failed, falling back to local data URL:', err);
    }

    const inserted = await insertWardrobeItem({
      image: imageUrl,
      name: '',
      category: 'top',
      subcategory: '',
      colors: [],
      material: '',
      pattern: '',
      fit: '',
      sleeve: '',
      neckline: '',
      style: '',
      season: '',
      occasion: '',
      brand: '',
      confidence: 0,
      status: 'analyzing',
    });

    // Placeholder's job is done either way — swap it out for the real row,
    // or drop it if the save failed (the alert in insertWardrobeItem already
    // told the user).
    wardrobeItemsCache = wardrobeItemsCache.filter((i) => i.id !== tempId);

    if (!inserted) {
      renderWardrobeGrid();
      return;
    }
    const id = inserted.id;
    renderWardrobeGrid();

    const metadata = await analyzeWardrobeImage(dataUrl);
    const category = WARDROBE_CATEGORIES.includes(metadata.category) ? metadata.category : 'top';
    const autoName = titleCase(metadata.subcategory) || titleCase(category);

    await updateWardrobeItem(id, {
      category,
      subcategory: metadata.subcategory || '',
      colors: Array.isArray(metadata.colors) ? metadata.colors : [],
      material: metadata.material || '',
      pattern: metadata.pattern || '',
      fit: metadata.fit || '',
      sleeve: metadata.sleeve || '',
      neckline: metadata.neckline || '',
      style: metadata.style || '',
      season: metadata.season || '',
      occasion: metadata.occasion || '',
      confidence: metadata.confidence || 0,
      name: autoName,
      status: metadata.confidence ? 'ready' : 'manual',
    });
    renderWardrobeGrid();

    const nameInput = wardrobeGrid.querySelector(`[data-id="${id}"] .wardrobe-item__name-input`);
    if (nameInput) nameInput.focus();
  }

  function onFileInputChange() {
    const file = wardrobeFileInput.files && wardrobeFileInput.files[0];
    addWardrobeItemFromFile(file);
    wardrobeFileInput.value = '';
  }

  function onAddBtnClick() {
    if (wardrobeFileInput) wardrobeFileInput.click();
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================
  async function init() {
    themeToggle = document.getElementById('themeToggle');
    themeButtons = themeToggle ? themeToggle.querySelectorAll('.theme-toggle__btn') : [];
    applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || 'light');
    themeButtons.forEach((btn) => btn.addEventListener('click', onThemeClick));

    wardrobeGrid = document.getElementById('wardrobeGrid');
    wardrobeEmpty = document.getElementById('wardrobeEmpty');
    wardrobeLoading = document.getElementById('wardrobeLoading');
    wardrobeAddBtn = document.getElementById('wardrobeAddBtn');
    wardrobeEmptyAddBtn = document.getElementById('wardrobeEmptyAddBtn');
    wardrobeFileInput = document.getElementById('wardrobeFileInput');

    if (wardrobeFileInput) wardrobeFileInput.addEventListener('change', onFileInputChange);
    [wardrobeAddBtn, wardrobeEmptyAddBtn].forEach((btn) => {
      if (btn) btn.addEventListener('click', onAddBtnClick);
    });

    if (!hasFetchedOnce && wardrobeItemsCache.length === 0) {
      // First-ever load this session: nothing cached yet, so don't paint
      // the empty state only to immediately replace it once the fetch
      // resolves — show a spinner instead and render once, after data
      // arrives.
      if (wardrobeEmpty) wardrobeEmpty.hidden = true;
      if (wardrobeLoading) wardrobeLoading.hidden = false;

      await fetchWardrobeItems();
      hasFetchedOnce = true;

      if (wardrobeLoading) wardrobeLoading.hidden = true;
      renderWardrobeGrid();
    } else {
      // Repeat visit — show whatever's cached immediately, then refresh
      // from Supabase in the background. Only re-render if the fetch
      // actually returned different data, so identical cards don't
      // replay their entrance animation for no reason.
      renderWardrobeGrid();
      const previousSnapshot = JSON.stringify(wardrobeItemsCache);
      await fetchWardrobeItems();
      hasFetchedOnce = true;
      const freshSnapshot = JSON.stringify(wardrobeItemsCache);
      if (freshSnapshot !== previousSnapshot) {
        renderWardrobeGrid();
      }
    }
  }

  function destroy() {
    // Every listener above is attached to elements inside <main>, which is
    // discarded wholesale on the next navigation — nothing global to unwire.
  }

  window.ShopAIWardrobe = { init, destroy };
})();