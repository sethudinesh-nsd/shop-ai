// ==========================================================================
// THEME TOGGLE
// ==========================================================================
const THEME_STORAGE_KEY = 'shopai_theme';
const themeToggle = document.getElementById('themeToggle');
const themeButtons = themeToggle ? themeToggle.querySelectorAll('.theme-toggle__btn') : [];

function applyTheme(theme) {
  document.body.classList.toggle('theme-dark', theme === 'dark');
  themeButtons.forEach((btn) => {
    btn.classList.toggle('theme-toggle__btn--active', btn.dataset.theme === theme);
  });
}

const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'light';
applyTheme(savedTheme);

themeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    applyTheme(theme);
  });
});

// ==========================================================================
// WARDROBE — localStorage-backed. Now uploads to Cloudinary first!
// ==========================================================================
const WARDROBE_STORAGE_KEY = 'shopai_wardrobe_items';
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

const wardrobeGrid = document.getElementById('wardrobeGrid');
const wardrobeEmpty = document.getElementById('wardrobeEmpty');
const wardrobeAddBtn = document.getElementById('wardrobeAddBtn');
const wardrobeEmptyAddBtn = document.getElementById('wardrobeEmptyAddBtn');
const wardrobeFileInput = document.getElementById('wardrobeFileInput');

function loadWardrobeItems() {
  try {
    const raw = localStorage.getItem(WARDROBE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Wardrobe load error:', err);
    return [];
  }
}

function saveWardrobeItems(items) {
  try {
    localStorage.setItem(WARDROBE_STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.error('Wardrobe save error:', err);
    alert('Could not save item. Your wardrobe storage might be full.');
  }
}

function updateWardrobeItem(id, patch) {
  const items = loadWardrobeItems();
  const target = items.find((i) => i.id === id);
  if (!target) return;
  Object.assign(target, patch);
  saveWardrobeItems(items);
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
  if (item.status === 'analyzing') card.classList.add('wardrobe-item--analyzing');
  card.dataset.id = item.id;

  const imgWrap = document.createElement('div');
  imgWrap.className = 'wardrobe-item__img-wrap';

  const img = document.createElement('img');
  img.className = 'wardrobe-item__img';
  img.src = item.image;
  img.alt = item.name || 'Wardrobe item';
  imgWrap.appendChild(img);

  if (item.status === 'analyzing') {
    const overlay = document.createElement('div');
    overlay.className = 'wardrobe-item__analyzing-overlay';
    overlay.innerHTML = `
      <span class="wardrobe-item__analyzing-spinner"></span>
      <span>Analyzing…</span>
    `;
    imgWrap.appendChild(overlay);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'wardrobe-item__delete';
  deleteBtn.setAttribute('aria-label', 'Remove item');
  deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  deleteBtn.addEventListener('click', () => {
    const items = loadWardrobeItems().filter((i) => i.id !== item.id);
    saveWardrobeItems(items);
    renderWardrobeGrid();
  });
  imgWrap.appendChild(deleteBtn);

  const body = document.createElement('div');
  body.className = 'wardrobe-item__body';

  const nameInput = document.createElement('input');
  nameInput.className = 'wardrobe-item__name-input';
  nameInput.type = 'text';
  nameInput.value = item.name || '';
  nameInput.placeholder = item.status === 'analyzing' ? 'Naming it…' : 'Name this item';
  nameInput.disabled = item.status === 'analyzing';
  nameInput.addEventListener('change', () => {
    updateWardrobeItem(item.id, { name: nameInput.value.trim() });
  });

  body.appendChild(nameInput);
  body.appendChild(makeWardrobeCategorySelect(item));

  if (item.status !== 'analyzing') {
    body.appendChild(makeConfidenceBadge(item));
    body.appendChild(makeWardrobeDetails(item));
  }

  card.appendChild(imgWrap);
  card.appendChild(body);

  return card;
}

function renderWardrobeGrid() {
  if (!wardrobeGrid) return;
  const items = loadWardrobeItems();

  wardrobeGrid.innerHTML = '';
  if (wardrobeEmpty) wardrobeEmpty.hidden = items.length > 0;

  items.forEach((item) => {
    wardrobeGrid.appendChild(makeWardrobeCard(item));
  });
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

  // 1. Upload to Cloudinary FIRST to get a clean URL (prevents localStorage crash)
  let imageUrl = dataUrl; // fallback to dataUrl if upload fails
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

  // 2. Save immediately in an "analyzing" state using the Cloudinary URL
  const id = 'w' + Date.now() + Math.random().toString(36).slice(2, 7);
  const items = loadWardrobeItems();
  items.push({
    id,
    image: imageUrl, // <-- NOW STORING THE URL, NOT THE HEAVY BASE64 STRING
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
    createdAt: new Date().toISOString(),
  });
  saveWardrobeItems(items);
  renderWardrobeGrid();

  // 3. Run vision, then prefill every field it returned.
  const metadata = await analyzeWardrobeImage(dataUrl);
  const category = WARDROBE_CATEGORIES.includes(metadata.category) ? metadata.category : 'top';
  const autoName = titleCase(metadata.subcategory) || titleCase(category);

  updateWardrobeItem(id, {
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

if (wardrobeFileInput) {
  wardrobeFileInput.addEventListener('change', () => {
    const file = wardrobeFileInput.files && wardrobeFileInput.files[0];
    addWardrobeItemFromFile(file);
    wardrobeFileInput.value = '';
  });
}

[wardrobeAddBtn, wardrobeEmptyAddBtn].forEach((btn) => {
  if (btn) btn.addEventListener('click', () => wardrobeFileInput && wardrobeFileInput.click());
});

renderWardrobeGrid();