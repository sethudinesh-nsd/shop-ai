/* ==========================================================================
   js/script.js — Home view: AI chat, search, suggestions, messages,
   attachments. Exposes window.ShopAIHome = { init, destroy, reset } so the
   app-shell router (js/app.js) can (re)initialize it every time Home is
   mounted, without leaking listeners on repeated navigation.

   Supabase additions (search "SUPABASE" below): each chat session gets a
   `conversations` row created on its first message, and every user/assistant
   turn is written to `messages`. history.js reads these back.
   ========================================================================== */

(() => {
  'use strict';

  const API_ENDPOINT = 'http://localhost:3000/api/chat';
  const STREAM_ENDPOINT = 'http://localhost:3000/api/chat/stream';
  const CONVERSATIONS_TABLE = 'conversations';
  const MESSAGES_TABLE = 'messages';

  // DOM refs — (re)queried fresh in init() every time this view is mounted,
  // since the router replaces .main's content wholesale on navigation.
  let hero, chatMessages, chatScroll, searchInput, submitBtn, messageTemplate,
      uploadBtn, fileInput, attachmentsRow, suggestionChips, mainEl;

  let chatModeActive = false;
  let isSending = false;
  let conversationHistory = [];
  let pendingImages = []; // { id, file, dataUrl }[]
  let spacer = null;

  // SUPABASE — id of the conversations row for the current chat session,
  // created lazily on the first message. Reset to null on resetToHome().
  let currentConversationId = null;

  // ==========================================================================
  // SUPABASE HELPERS
  // ==========================================================================
  async function getSupabase() {
    return window.ShopAISupabase.client || window.ShopAISupabase.ready;
  }

  function getClerkUserId() {
    const clerk = window.ShopAIAuth && window.ShopAIAuth.clerk;
    return clerk && clerk.user ? clerk.user.id : null;
  }

  // Creates the conversations row on first message of a session. Title is a
  // simple truncation of the opening message — swap in an AI-generated
  // title later if you want something nicer.
  async function ensureConversation(firstUserText) {
    if (currentConversationId) return currentConversationId;
    const clerkUserId = getClerkUserId();
    if (!clerkUserId) return null;

    try {
      const supabase = await getSupabase();
      const title = (firstUserText || 'New conversation').slice(0, 80);
      const { data, error } = await supabase
        .from(CONVERSATIONS_TABLE)
        .insert({ clerk_user_id: clerkUserId, title })
        .select('id')
        .single();
      if (error) throw error;
      currentConversationId = data.id;
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
    return currentConversationId;
  }

  async function persistMessage(role, content) {
    const clerkUserId = getClerkUserId();
    if (!currentConversationId || !clerkUserId) return;
    try {
      const supabase = await getSupabase();
      await supabase.from(MESSAGES_TABLE).insert({
        conversation_id: currentConversationId,
        clerk_user_id: clerkUserId,
        role,
        content,
      });
      await supabase
        .from(CONVERSATIONS_TABLE)
        .update({ updated_at: new Date().toISOString() })
        .eq('id', currentConversationId);
    } catch (err) {
      console.error(`Failed to save ${role} message:`, err);
    }
  }

  // Called by history.js when the user picks a past conversation.
  async function loadConversation(conversationId, messages) {
    resetToHome();
    currentConversationId = conversationId;
    if (!messages || !messages.length) return;

    enterChatMode();
    messages.forEach((msg) => {
      renderMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content);
      conversationHistory.push({ role: msg.role, content: msg.content });
    });
    requestAnimationFrame(() => scrollToBottom(false));
  }

  // ==========================================================================
  // HOME <-> CHAT MODE
  // ==========================================================================
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
    currentConversationId = null; // SUPABASE — next message starts a fresh conversation row
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

  function stickToBottomIfNear() {
    if (isNearBottom()) scrollToBottom(false);
  }

  function scrollMessageToTop(messageEl) {
    if (!messageEl) return;
    messageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ==========================================================================
  // SPACER
  // ==========================================================================
  function ensureSpacer() {
    if (!spacer || !spacer.isConnected) {
      spacer = document.createElement('div');
      spacer.className = 'chat-spacer';
      if (chatMessages) chatMessages.appendChild(spacer);
    } else {
      if (chatMessages) chatMessages.appendChild(spacer);
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
  // TEXT FORMATTING
  // ==========================================================================
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  let markedConfigured = false;
  function configureMarked() {
    if (markedConfigured || typeof marked === 'undefined') return;
    marked.setOptions({
      gfm: true,
      breaks: false,
      headerIds: false,
      mangle: false,
    });
    markedConfigured = true;
  }

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
      ADD_TAGS: ['input'],
      ADD_ATTR: ['target', 'rel', 'type', 'checked', 'disabled', 'class', 'align'],
    });
  }

  function enhanceTables(container) {
    container.querySelectorAll('table').forEach((table) => {
      if (table.parentElement.classList.contains('table-wrapper')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'table-wrapper';
      table.parentElement.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    });
  }

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
        return;
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

  function renderAssistantContent(contentEl, rawText) {
    contentEl.innerHTML = formatMessageHtml(rawText);
    enhanceCodeBlocks(contentEl);
    enhanceTables(contentEl);
  }

  function animateNewChildren(contentEl) {
    const children = Array.from(contentEl.children);
    const alreadyShown = Number(contentEl.dataset.shownCount || 0);

    children.forEach((child, i) => {
      if (i < alreadyShown) return;
      child.classList.add('content-block-enter');
      child.style.animationDelay = `${(i - alreadyShown) * 40}ms`;
    });

    contentEl.dataset.shownCount = children.length;
  }

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
        if (role === 'user') {
          navigator.clipboard?.writeText(contentEl.textContent);
        } else {
          navigator.clipboard?.writeText(contentEl.innerText);
        }
      });
    }

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
    if (spacer) chatMessages.appendChild(spacer);
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
  // OUTFIT CARDS
  // ==========================================================================
  const OUTFIT_BLOCK_RE = /```outfit-json\s*([\s\S]*?)```/;

  function stripOutfitBlock(text) {
    const idx = text.indexOf('```outfit-json');
    return idx === -1 ? text : text.slice(0, idx).trimEnd();
  }

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

  function renderOutfitCards(contentEl, items) {
    if (!items || !items.length) return;

    const grid = document.createElement('div');
    grid.className = 'outfit-grid';

    items.forEach((item, i) => {
      if (!item || !item.name) return;
      const bg = OUTFIT_CARD_GRADIENTS[i % OUTFIT_CARD_GRADIENTS.length];

      const card = document.createElement('div');
      card.className = 'outfit-card outfit-card-enter';
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

  // SUPABASE — shared by both exit paths of streamAIResponse below, so a
  // conversation row + both messages are saved exactly once per turn either
  // way the stream finishes (explicit "done" event, or the reader closing).
  async function finalizeTurn(userText, cleanText) {
    conversationHistory.push({ role: 'user', content: userText });
    conversationHistory.push({ role: 'assistant', content: cleanText });

    await ensureConversation(userText);
    await persistMessage('user', userText);
    await persistMessage('assistant', cleanText);
  }

  async function streamAIResponse(userText, messageEl, anchorEl, images = []) {
    const contentEl = messageEl.querySelector('.message__content');
    let fullText = '';

    const response = await fetch(STREAM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userText,
        history: conversationHistory,
        images,
        // The style profile rides along with every turn. Without it the
        // stylist gives the same answer to a 21-year-old in Chennai
        // shopping under 3k as it does to everyone else.
        profile: (window.ShopAIProfile && window.ShopAIProfile.brief()) || {}
      })
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
          updateSpacerFor(anchorEl);
          stickToBottomIfNear();
          await finalizeTurn(userText, cleanText);
          return;
        }

        if (!data) continue;

        try {
          const payload = JSON.parse(data);
          if (!payload.chunk) continue;

          fullText += payload.chunk;
          renderAssistantContent(contentEl, stripOutfitBlock(fullText));
          animateNewChildren(contentEl);
          updateSpacerFor(anchorEl);
          stickToBottomIfNear();
        } catch (err) {
          console.error('Stream parse error:', err);
        }
      }
    }

    const { cleanText, items } = extractOutfitBlock(fullText);
    renderAssistantContent(contentEl, cleanText);
    renderOutfitCards(contentEl, items);
    animateNewChildren(contentEl);
    await finalizeTurn(userText, cleanText);
  }

  // ==========================================================================
  // SEND FLOW
  // ==========================================================================
  async function handleSend() {
    if (!searchInput || !submitBtn || !chatMessages || !chatScroll) return;

    const value = searchInput.value.trim();
    if ((!value && pendingImages.length === 0) || isSending) return;

    enterChatMode();

    const images = pendingImages.map((item) => item.dataUrl);

    const userMsgEl = renderMessage('user', value, images);
    searchInput.value = '';
    searchInput.style.height = 'auto';
    clearPendingImages();

    ensureSpacer();
    updateSpacerFor(userMsgEl);

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

    const assistantEl = renderMessage('assistant', '');
    assistantEl.querySelector('.message__content').innerHTML = THINKING_HTML;
    updateSpacerFor(userMsgEl);

    try {
      await streamAIResponse(value, assistantEl, userMsgEl, images);
    } catch (err) {
      console.error(err);
      assistantEl.querySelector('.message__content').textContent = `Error: ${err.message}`;
    }

    updateSpacerFor(userMsgEl);

    submitBtn.disabled = false;
    isSending = false;
  }

  function onSearchKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function autoResize() {
    searchInput.style.height = 'auto';
    searchInput.style.height = `${searchInput.scrollHeight}px`;
  }

  function onResize() {
    if (!chatModeActive || !spacer || !chatMessages) return;
    const userMsgs = chatMessages.querySelectorAll('.message--user');
    const lastUserMsg = userMsgs[userMsgs.length - 1];
    if (lastUserMsg) updateSpacerFor(lastUserMsg);
  }

  // ==========================================================================
  // SUGGESTION CHIPS
  // ==========================================================================
  function onSuggestionClick(event) {
    if (!searchInput) return;
    const chip = event.currentTarget;
    searchInput.value = chip.dataset.prompt || '';
    handleSend();
  }

  // ==========================================================================
  // UPLOAD (+) BUTTON
  // ==========================================================================
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

  function onUploadBtnClick() {
    if (fileInput) fileInput.click();
  }

  async function onFileInputChange() {
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

    fileInput.value = '';
    renderAttachmentsRow();
    updateUploadBtnState();
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================
  function init() {
    hero = document.getElementById('hero');
    chatMessages = document.getElementById('chatMessages');
    chatScroll = document.getElementById('chatScroll');
    searchInput = document.getElementById('searchInput');
    submitBtn = document.getElementById('submitBtn');
    messageTemplate = document.getElementById('messageTemplate');
    uploadBtn = document.getElementById('uploadBtn');
    fileInput = document.getElementById('fileInput');
    attachmentsRow = document.getElementById('attachmentsRow');
    suggestionChips = document.querySelectorAll('.suggestion-chip');
    mainEl = document.querySelector('.main');

    chatModeActive = false;
    isSending = false;
    conversationHistory = [];
    pendingImages = [];
    spacer = null;
    currentConversationId = null;

    if (submitBtn) submitBtn.addEventListener('click', handleSend);

    if (searchInput) {
      searchInput.addEventListener('keydown', onSearchKeydown);
      searchInput.addEventListener('input', autoResize);
    }

    suggestionChips.forEach((chip) => chip.addEventListener('click', onSuggestionClick));

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', onUploadBtnClick);
      fileInput.addEventListener('change', onFileInputChange);
    }

    window.addEventListener('resize', onResize);
  }

  function destroy() {
    // Listeners on elements inside .main are discarded with that DOM when
    // the router swaps views — only the window-level one needs unwiring.
    window.removeEventListener('resize', onResize);
  }

  window.ShopAIHome = { init, destroy, reset: resetToHome, loadConversation };
})();