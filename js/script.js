// ==========================================================================
// CONFIG
// ==========================================================================
// Your Node server (server.js) serves both the static site AND /api/chat
// from the same process. If you're previewing this file through VS Code's
// "Live Server" (port 5500) instead of opening http://localhost:3000
// directly, a *relative* '/api/chat' would hit port 5500 (wrong server) and
// fail. Keeping the absolute URL here makes it work either way, as long as
// `node server.js` is running.
const API_ENDPOINT = 'http://localhost:3000/api/chat';
const STREAM_ENDPOINT = 'http://localhost:3000/api/chat/stream';

// ==========================================================================
// DOM REFS
// ==========================================================================
const hero = document.getElementById('hero');
const chatMessages = document.getElementById('chatMessages');
const chatScroll = document.getElementById('chatScroll');
const searchInput = document.getElementById('searchInput');
const submitBtn = document.getElementById('submitBtn');
const messageTemplate = document.getElementById('messageTemplate');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const attachmentsRow = document.getElementById('attachmentsRow');
const navItems = document.querySelectorAll('.nav-item');
const suggestionChips = document.querySelectorAll('.suggestion-chip');

// ==========================================================================
// STATE
// ==========================================================================
let chatModeActive = false;
let isSending = false;
// Sent to the backend as context on every request — agent.js spreads this
// straight into the messages array, so keep it to { role, content } pairs.
const conversationHistory = [];


// ==========================================================================
// NAV — "Home" resets back to the pre-chat state. Real links (e.g.
// wardrobe.html) navigate normally; only "#" placeholder items are
// handled in-page here.
// ==========================================================================
navItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    const href = item.getAttribute('href');
    if (href && href !== '#') return;

    e.preventDefault();
    navItems.forEach((i) => i.classList.remove('nav-item--active'));
    item.classList.add('nav-item--active');
    if (item.dataset.nav === 'home') resetToHome();
  });
});

// ==========================================================================
// HOME <-> CHAT MODE (this is the part that was missing)
// ==========================================================================
const mainEl = document.querySelector('.main');

function enterChatMode() {
  if (chatModeActive) return;
  chatModeActive = true;
  if (hero) hero.classList.add('hero--chat-mode');
  if (mainEl) mainEl.classList.add('main--chat-mode');
}

function resetToHome() {
  chatModeActive = false;
  if (hero) hero.classList.remove('hero--chat-mode');
  if (mainEl) mainEl.classList.remove('main--chat-mode');
  if (chatMessages) chatMessages.innerHTML = '';
  if (chatScroll) chatScroll.scrollTop = 0;
  conversationHistory.length = 0;
  if (searchInput) {
    searchInput.value = '';
    searchInput.style.height = 'auto';
  }
  clearPendingImages();
  window.ShopAIManageAccount?.close();
}

// ==========================================================================
// RENDERING
// ==========================================================================
// NOTE: the element that actually scrolls is #chatScroll (overflow-y: auto).
// #chatMessages inside it is just a flex column and never scrolls itself.

// True once the user is within `threshold`px of the bottom of the thread.
// Used to decide whether new content should pull the view down with it — 
// same rule ChatGPT uses so a manual scroll-up during streaming doesn't get
// yanked back down on the next token.
function isNearBottom(threshold = 140) {
  if (!chatScroll) return true;
  return chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < threshold;
}

function scrollToBottom(smooth = true) {
  if (!chatScroll) return;
  chatScroll.scrollTo({
    top: chatScroll.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto'
  });
}

// Only follows new content down if the user hasn't scrolled away to read
// something earlier — call this after every streamed chunk / render.
function stickToBottomIfNear() {
  if (isNearBottom()) scrollToBottom(false);
}

// ChatGPT/Claude-style send behavior: the just-sent user message jumps to
// (near) the top of the scroll viewport, leaving the rest of the space
// free for the reply to stream into below it — rather than pinning to the
// bottom. scrollIntoView handles finding the right scrollable ancestor and
// respects `scroll-margin-top` in CSS for the offset, so it's more robust
// than computing the scroll position by hand.
function scrollMessageToTop(messageEl) {
  if (!messageEl) return;
  messageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ==========================================================================
// SPACER — the actual mechanism behind "new message jumps to the top"
// ==========================================================================
// scrollIntoView can only scroll a message as far as there's room below it.
// A single trailing element (kept as the LAST child of #chatMessages)
// reserves just enough blank space after the newest content for that
// content to reach the top of the viewport — and shrinks automatically as
// the reply streams in, so a finished turn never leaves a stray gap behind.
// This is the real difference from a fixed per-turn min-height: only the
// *current* turn ever has slack, and it collapses back down once the reply
// fills the screen (or is short and done).
let spacer = null;

function ensureSpacer() {
  if (!spacer || !spacer.isConnected) {
    spacer = document.createElement('div');
    spacer.className = 'chat-spacer';
    if (chatMessages) chatMessages.appendChild(spacer);
  } else {
    if (chatMessages) chatMessages.appendChild(spacer); // re-pin it as the last child
  }
  return spacer;
}

function updateSpacerFor(anchorEl) {
  if (!spacer || !anchorEl || !chatScroll) return;
  const viewportH = chatScroll.clientHeight;
  if (!viewportH) return;
  const anchorTop = anchorEl.getBoundingClientRect().top;
  const lastContentEl = spacer.previousElementSibling || anchorEl;
  const contentBottom = lastContentEl.getBoundingClientRect().bottom;
  const used = contentBottom - anchorTop;
  const needed = Math.max(0, viewportH - used - 24);
  spacer.style.height = `${needed}px`;
}

// ==========================================================================
// TEXT FORMATTING — real markdown -> sanitized, semantic HTML
// ==========================================================================
// User bubbles stay plain text (set via .textContent elsewhere), so this
// pipeline only ever runs on assistant output. It still gets sanitized
// because the assistant text originates from a network response.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let markedConfigured = false;
function configureMarked() {
  if (markedConfigured || typeof marked === 'undefined') return;
  marked.setOptions({
    gfm: true,          // tables, task lists, strikethrough, autolinks
    breaks: false,       // real paragraphs, not <br>-per-newline
    headerIds: false,
    mangle: false,
  });
  markedConfigured = true;
}

// Renders full markdown -> semantic HTML, then strips anything unsafe.
// Falls back to escaped plain text if the CDN libraries didn't load, so a
// blocked network never turns into an XSS hole or a raw-HTML dump.
function formatMessageHtml(rawText) {
  if (typeof marked === 'undefined') {
    return escapeHtml(rawText).replace(/\n/g, '<br>');
  }
  configureMarked();
  const dirty = marked.parse(rawText || '');
  if (typeof DOMPurify === 'undefined') {
    return dirty;
  }
  return DOMPurify.sanitize(dirty, {
    ADD_TAGS: ['input'], // needed for GFM task-list checkboxes
    ADD_ATTR: ['target', 'rel', 'type', 'checked', 'disabled', 'class', 'align'],
  });
}

// Wraps every rendered <table> in a horizontally-scrollable container so
// wide tables don't blow out the reading column on narrow screens.
function enhanceTables(container) {
  container.querySelectorAll('table').forEach((table) => {
    if (table.parentElement.classList.contains('table-wrapper')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    table.parentElement.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
}

// Adds syntax highlighting plus a ChatGPT-style header (language label +
// Copy button) around every fenced code block.
function enhanceCodeBlocks(container) {
  container.querySelectorAll('pre code').forEach((codeEl) => {
    const langClass = [...codeEl.classList].find((c) => c.startsWith('language-'));
    const lang = langClass ? langClass.replace('language-', '') : '';

    if (typeof hljs !== 'undefined') {
      try {
        hljs.highlightElement(codeEl);
      } catch (err) {
        /* unrecognized language — leave as plain text */
      }
    }

    const preEl = codeEl.parentElement;
    if (preEl.parentElement && preEl.parentElement.classList.contains('code-block')) {
      return; // already wrapped
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    preEl.parentElement.insertBefore(wrapper, preEl);

    const header = document.createElement('div');
    header.className = 'code-block__header';

    const langLabel = document.createElement('span');
    langLabel.className = 'code-block__lang';
    langLabel.textContent = lang || 'text';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'code-block__copy';
    copyBtn.textContent = 'Copy code';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(codeEl.textContent);
      copyBtn.textContent = 'Copied';
      copyBtn.classList.add('code-block__copy--copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy code';
        copyBtn.classList.remove('code-block__copy--copied');
      }, 1500);
    });

    header.appendChild(langLabel);
    header.appendChild(copyBtn);
    wrapper.appendChild(header);
    wrapper.appendChild(preEl);
  });
}

// Single entry point: parse markdown, sanitize, inject, then enhance
// (syntax highlighting, code-block chrome, responsive tables).
function renderAssistantContent(contentEl, rawText) {
  contentEl.innerHTML = formatMessageHtml(rawText);
  enhanceCodeBlocks(contentEl);
  enhanceTables(contentEl);
}

// Marks only the content blocks that are new since the last render with an
// entrance animation — already-visible paragraphs/headings/etc. are left
// alone so re-parsing the markdown on every streamed chunk doesn't make the
// whole reply flicker. Call this after any innerHTML swap on contentEl.
function animateNewChildren(contentEl) {
  const children = Array.from(contentEl.children);
  const alreadyShown = Number(contentEl.dataset.shownCount || 0);

  children.forEach((child, i) => {
    if (i < alreadyShown) return; // already rendered on a previous pass
    child.classList.add('content-block-enter');
    child.style.animationDelay = `${(i - alreadyShown) * 40}ms`;
  });

  contentEl.dataset.shownCount = children.length;
}

/** Renders one message bubble from the <template>. `images` is an optional
 * array of data URLs — only ever populated on user messages that had
 * photos attached. Returns the .message element. */
function renderMessage(role, text, images = []) {
  const node = messageTemplate.content.cloneNode(true);
  const messageEl = node.querySelector('.message');
  const labelEl = node.querySelector('.message__label-text');
  const contentEl = node.querySelector('.message__content');
  const actionsEl = node.querySelector('.message__actions');
  const copyBtn = node.querySelector('[data-action="copy"]');

  if (role === 'user') {
    messageEl.classList.add('message--user');
    labelEl.textContent = 'You';

    if (images && images.length > 0) {
      const imagesRow = document.createElement('div');
      imagesRow.className = 'message__images';
      images.forEach((src) => {
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'Attached photo';
        imagesRow.appendChild(img);
      });
      contentEl.appendChild(imagesRow);
    }

    const textEl = document.createElement('span');
    textEl.className = 'message__text';
    textEl.textContent = text;
    contentEl.appendChild(textEl);
    // User messages only get Copy — Regenerate/Like/Dislike are assistant-only
    if (actionsEl) {
      ['regenerate', 'like', 'dislike'].forEach((action) => {
        const btn = actionsEl.querySelector(`[data-action="${action}"]`);
        if (btn) btn.remove();
      });
    }
  } else {
    messageEl.classList.add('message--assistant');
    labelEl.textContent = 'Shop AI';
    if (text) renderAssistantContent(contentEl, text);
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      // Only copy the visible message text
      if (role === 'user') {
        navigator.clipboard?.writeText(contentEl.textContent);
      } else {
        // Copy visible (rendered) text, but not HTML tags
        navigator.clipboard?.writeText(contentEl.innerText);
      }
    });
  }

  // Like/Dislike: lightweight visual toggle, mutually exclusive, no backend call
  const likeBtn = actionsEl && actionsEl.querySelector('[data-action="like"]');
  const dislikeBtn = actionsEl && actionsEl.querySelector('[data-action="dislike"]');
  if (likeBtn && dislikeBtn) {
    likeBtn.addEventListener('click', () => {
      const active = likeBtn.classList.toggle('message__action--active');
      dislikeBtn.classList.remove('message__action--active');
      if (active) likeBtn.classList.add('message__action--like');
    });
    dislikeBtn.addEventListener('click', () => {
      const active = dislikeBtn.classList.toggle('message__action--active');
      likeBtn.classList.remove('message__action--active');
      likeBtn.classList.remove('message__action--like');
      if (active) dislikeBtn.classList.add('message__action--dislike');
    });
  }

  chatMessages.appendChild(node);
  if (spacer) chatMessages.appendChild(spacer); // keep spacer pinned last
  // User messages get positioned explicitly by handleSend (scrolled to the
  // top of the viewport); assistant messages just follow the bottom if the
  // user hasn't scrolled away to read something earlier.
  if (role !== 'user') stickToBottomIfNear();
  return messageEl;
}

const THINKING_HTML = `
  <div class="thinking-indicator">
    <svg class="thinking-indicator__mark" viewBox="0 0 24 24" fill="none">
      <path d="M12 2 L14 9 L21 11 L14 13 L12 20 L10 13 L3 11 L10 9 Z" fill="url(#thinkGrad)"/>
      <defs>
        <linearGradient id="thinkGrad" x1="3" y1="2" x2="21" y2="20" gradientUnits="userSpaceOnUse">
          <stop stop-color="#a855f7"/>
          <stop offset="1" stop-color="#7c3aed"/>
        </linearGradient>
      </defs>
    </svg>
    <span class="thinking-indicator__text">Curating your look…</span>
  </div>
`;



// ==========================================================================
// OUTFIT CARDS — the model ends recommendation replies with a fenced
// ```outfit-json block (see systemPrompt.js). We strip it from the visible
// text and render it as a real card grid instead.
// ==========================================================================
const OUTFIT_BLOCK_RE = /```outfit-json\s*([\s\S]*?)```/;

// Used WHILE streaming: hides the raw fence the instant it starts appearing,
// so the user never sees raw JSON flash on screen before the stream ends.
function stripOutfitBlock(text) {
  const idx = text.indexOf('```outfit-json');
  return idx === -1 ? text : text.slice(0, idx).trimEnd();
}

// Used ONCE streaming is done: pulls the parsed items out for rendering.
function extractOutfitBlock(text) {
  const match = text.match(OUTFIT_BLOCK_RE);
  if (!match) return { cleanText: text, items: [] };

  const cleanText = text.slice(0, match.index).trimEnd();
  let items = [];
  try {
    const parsed = JSON.parse(match[1].trim());
    if (Array.isArray(parsed)) items = parsed;
  } catch (err) {
    console.error('Outfit block parse error:', err);
  }
  return { cleanText, items };
}

const OUTFIT_CARD_GRADIENTS = [
  'linear-gradient(145deg, #f4e2ce, #e8c9a8)',
  'linear-gradient(145deg, #dfe6f5, #b9c8ea)',
  'linear-gradient(145deg, #ece1f4, #d6c1ea)',
  'linear-gradient(145deg, #cdeee2, #a9dfc9)',
  'linear-gradient(145deg, #f0dede, #e3bcbc)',
];

// Appends a card grid inside the message bubble, after the prose.
// No real product images exist yet, so each card gets a soft gradient
// placeholder tinted by category — swap for real photos once you have them.
function renderOutfitCards(contentEl, items) {
  if (!items || !items.length) return;

  const grid = document.createElement('div');
  grid.className = 'outfit-grid';

  items.forEach((item, i) => {
    if (!item || !item.name) return;
    const bg = OUTFIT_CARD_GRADIENTS[i % OUTFIT_CARD_GRADIENTS.length];

    const card = document.createElement('div');
    card.className = 'outfit-card outfit-card-enter';   // was: 'outfit-card'
    card.style.animationDelay = `${i * 60}ms`;     
    card.innerHTML = `
      <div class="outfit-card__img" style="background:${bg}">
        ${item.category ? `<span class="outfit-card__tag">${escapeHtml(item.category)}</span>` : ''}
      </div>
      <div class="outfit-card__body">
        <p class="outfit-card__name">${escapeHtml(item.name)}</p>
        ${item.price ? `<p class="outfit-card__price">${escapeHtml(item.price)}</p>` : ''}
        ${item.why ? `<p class="outfit-card__why">${escapeHtml(item.why)}</p>` : ''}
      </div>
    `;
    grid.appendChild(card);
  });

  contentEl.appendChild(grid);
}

async function streamAIResponse(userText, messageEl, anchorEl, images = []) {
  const contentEl = messageEl.querySelector('.message__content');
  let fullText = '';

  const response = await fetch(STREAM_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    // `images`: data URLs of any photos attached to this turn. The backend
    // runs these through the vision service before the model replies —
    // see server/services/agent.js.
    body: JSON.stringify({ message: userText, history: conversationHistory, images })
  });

  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      const lines = event.split('\n');

      let eventType = 'message';
      let data = '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          data += line.slice(5).trim();
        }
      }

      if (eventType === 'done') {
        const { cleanText, items } = extractOutfitBlock(fullText);
        renderAssistantContent(contentEl, cleanText);
        renderOutfitCards(contentEl, items);
        animateNewChildren(contentEl); 
        conversationHistory.push({
          role: 'user',
          content: userText
        });

        conversationHistory.push({
          role: 'assistant',
          content: cleanText
        });
        updateSpacerFor(anchorEl);
        stickToBottomIfNear();
        return;
      }

      if (!data) continue;

      try {
        const payload = JSON.parse(data);
        if (!payload.chunk) continue;

        fullText += payload.chunk;
        renderAssistantContent(contentEl, stripOutfitBlock(fullText));
        animateNewChildren(contentEl); 
        updateSpacerFor(anchorEl); // shrink the reserved gap as real content fills in
        stickToBottomIfNear();
      } catch (err) {
        console.error('Stream parse error:', err);
      }
    }
  }

  // Fallback: if the stream ended without an explicit 'done' event,
  // still extract and render any outfit cards from what we received.
  const { cleanText, items } = extractOutfitBlock(fullText);
  renderAssistantContent(contentEl, cleanText);
  renderOutfitCards(contentEl, items);
  animateNewChildren(contentEl);  
  conversationHistory.push({
    role: 'user',
    content: userText
  });

  conversationHistory.push({
    role: 'assistant',
    content: cleanText
  });
}


// ==========================================================================
// SEND FLOW
// ==========================================================================
async function handleSend() {
  if (!searchInput || !submitBtn || !chatMessages || !chatScroll) return;

  const value = searchInput.value.trim();
  if ((!value && pendingImages.length === 0) || isSending) return;

  enterChatMode();

  // Snapshot the attached images before clearing the composer.
  const images = pendingImages.map((item) => item.dataUrl);

  const userMsgEl = renderMessage('user', value, images);
  searchInput.value = '';
  searchInput.style.height = 'auto';
  clearPendingImages();

  ensureSpacer();
  updateSpacerFor(userMsgEl);

  // ChatGPT/Claude-style jump: jog the just-sent message up to the top of
  // the viewport instead of pinning to the bottom. Double rAF handles the
  // common case; the timeout is a safety net for the very first send, when
  // the .hero--chat-mode class also kicks off a CSS transition (0 ->
  // 100% height) that can still be mid-flight after two frames. Re-measuring
  // the spacer right before each scroll attempt is what actually makes the
  // scroll possible — see updateSpacerFor().
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      updateSpacerFor(userMsgEl);
      scrollMessageToTop(userMsgEl);
    });
  });
  setTimeout(() => {
    updateSpacerFor(userMsgEl);
    scrollMessageToTop(userMsgEl);
  }, 400);

  isSending = true;
  submitBtn.disabled = true;

  // Show the thinking state INSIDE the assistant bubble itself, so it's
  // actually visible during the gap before the first chunk arrives (tool
  // selection + search, if triggered, both happen before streaming starts).
  // Previously a separate typing bubble was created and removed on the next
  // line — before the request even went out — so nothing was ever shown.
  const assistantEl = renderMessage('assistant', '');
  assistantEl.querySelector('.message__content').innerHTML = THINKING_HTML;
  updateSpacerFor(userMsgEl);

  try {
    await streamAIResponse(value, assistantEl, userMsgEl, images);
  } catch (err) {
    console.error(err);
    assistantEl.querySelector('.message__content').textContent = `Error: ${err.message}`;
  }

  // Final settle: recalc once more now that the reply has stopped changing,
  // so the reserved gap matches exactly what the finished turn needs (0 if
  // the reply already filled the screen, a small remainder if it didn't).
  updateSpacerFor(userMsgEl);

  submitBtn.disabled = false;
  isSending = false;
}

if (submitBtn) submitBtn.addEventListener('click', handleSend);

if (searchInput) {
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
    // Shift+Enter falls through and inserts a newline, like a normal textarea.
  });

  // Auto-grow the composer as the person types, capped by CSS max-height.
  const autoResize = () => {
    searchInput.style.height = 'auto';
    searchInput.style.height = `${searchInput.scrollHeight}px`;
  };
  searchInput.addEventListener('input', autoResize);
}

// Keep the reserved gap matching the visible thread area if the window is
// resized mid-conversation (e.g. rotating a tablet).
window.addEventListener('resize', () => {
  if (!chatModeActive || !spacer || !chatMessages) return;
  const userMsgs = chatMessages.querySelectorAll('.message--user');
  const lastUserMsg = userMsgs[userMsgs.length - 1];
  if (lastUserMsg) updateSpacerFor(lastUserMsg);
});

// ==========================================================================
// SUGGESTION CHIPS
// ==========================================================================
suggestionChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    if (!searchInput) return;
    searchInput.value = chip.dataset.prompt || '';
    handleSend();
  });
});

// ==========================================================================
// UPLOAD (+) BUTTON — attaches one or more images to the next message.
// Images are converted to data URLs client-side and sent alongside the
// message; the backend runs them through the vision service (see
// server/services/vision) before the AI generates its reply, so the user
// never has to describe what's in the photo themselves.
// ==========================================================================
let pendingImages = []; // { id, file, dataUrl }[]

function renderAttachmentsRow() {
  if (!attachmentsRow) return;
  attachmentsRow.innerHTML = '';
  attachmentsRow.hidden = pendingImages.length === 0;

  pendingImages.forEach((item) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';

    const img = document.createElement('img');
    img.src = item.dataUrl;
    img.alt = item.file.name;
    chip.appendChild(img);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'attachment-chip__remove';
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', `Remove ${item.file.name}`);
    removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    removeBtn.addEventListener('click', () => {
      pendingImages = pendingImages.filter((i) => i.id !== item.id);
      renderAttachmentsRow();
      updateUploadBtnState();
    });
    chip.appendChild(removeBtn);

    attachmentsRow.appendChild(chip);
  });
}

function updateUploadBtnState() {
  if (!uploadBtn) return;
  const has = pendingImages.length > 0;
  uploadBtn.classList.toggle('searchbar__icon-btn--active', has);
  uploadBtn.title = has
    ? `${pendingImages.length} photo${pendingImages.length > 1 ? 's' : ''} attached`
    : 'Add photo';
}

function clearPendingImages() {
  pendingImages = [];
  if (fileInput) fileInput.value = '';
  renderAttachmentsRow();
  updateUploadBtnState();
}

/**
 * Reads a file and re-encodes it as a clean JPEG data URL via canvas,
 * downscaling anything larger than 1600px on the long edge. This matters
 * for two reasons: (1) Groq's vision API rejects some raw formats/color
 * profiles (HEIC, odd EXIF orientation, etc.) with a generic "invalid
 * image data" error even though the browser renders them fine, and (2)
 * it keeps the request comfortably under Groq's 20MB request-size limit.
 * Re-encoding through <canvas> normalizes almost anything the browser can
 * display into a format the vision API reliably accepts.
 */
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
      // If the browser can't even decode it (e.g. true HEIC in Chrome),
      // fail clearly here instead of sending unreadable bytes to Groq.
      img.onerror = () => reject(new Error(`Couldn't read "${file.name}" — try a JPG or PNG.`));
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

if (uploadBtn && fileInput) {
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) return;

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const dataUrl = await fileToNormalizedDataUrl(file);
        pendingImages.push({ id: 'img' + Date.now() + Math.random().toString(36).slice(2, 7), file, dataUrl });
      } catch (err) {
        console.error('Failed to read image:', err);
        alert(err.message || 'Failed to read that image.');
      }
    }

    fileInput.value = ''; // allow re-picking the same file
    renderAttachmentsRow();
    updateUploadBtnState();
  });
}

