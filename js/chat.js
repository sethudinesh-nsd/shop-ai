/* =========================================================
   SHOP AI — Premium Chat UI logic
   The ONLY backend-related code is inside getAIResponse() —
   it still calls http://localhost:3000/api/chat exactly as
   before. Everything else here is presentation/interaction.
   ========================================================= */

const emptyState = document.getElementById('emptyState');
const conversation = document.getElementById('conversation');
const composerInput = document.getElementById('composerInput');
const sendBtn = document.getElementById('sendBtn');
const suggestionButtons = document.querySelectorAll('.suggestion');
const plusBtn = document.getElementById('plusBtn');
const uploadMenu = document.getElementById('uploadMenu');

let hasStarted = false;
let lastRole = null; // tracks who sent the last message, for avatar grouping

// ---------- Helpers ----------

function timeNow() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
  const main = document.querySelector('.chat-main');
  main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Turns a limited, safe subset of markdown into HTML:
// ![alt](url) -> image, [text](url) -> link, **bold** -> <strong>,
// bare URLs -> auto-linked, newlines -> <br>.
// Input is HTML-escaped FIRST, so anything inserted below is safe —
// no raw user/model text ever becomes a live tag.
function formatMessageHtml(rawText) {
  let safe = escapeHtml(rawText);

  // Images: ![alt](url)
  safe = safe.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_, alt, url) => {
    return `<img class="msg-image" src="${url}" alt="${alt}" loading="lazy">`;
  });

  // Links: [text](url)
  safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Bold: **text**
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Bare URLs that weren't already turned into a link/image above
  safe = safe.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g, (match, before, url) => {
    return `${before}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });

  // Line breaks
  safe = safe.replace(/\n/g, '<br>');

  return safe;
}

function autoGrowInput() {
  composerInput.style.height = 'auto';
  composerInput.style.height = Math.min(composerInput.scrollHeight, 140) + 'px';
}

function revealConversation() {
  if (hasStarted) return;
  hasStarted = true;
  emptyState.classList.add('hidden');
}

// ---------- Renderers ----------

function renderUserMessage(text) {
  const group = document.createElement('div');
  group.className = 'msg-group user';
  group.innerHTML = `
    <div class="msg-col">
      <div class="msg-text">${escapeHtml(text)}</div>
      <div class="msg-meta-row">
        <span class="msg-time">${timeNow()}</span>
      </div>
    </div>
  `;
  conversation.appendChild(group);
  lastRole = 'user';
  scrollToBottom();
}

function renderAIMessage(html) {
  const showAvatar = lastRole !== 'ai';
  const group = document.createElement('div');
  group.className = 'msg-group ai';
  group.innerHTML = `
    <div class="avatar-slot ${showAvatar ? '' : 'spacer'}">${showAvatar ? '✨' : ''}</div>
    <div class="msg-col">
      <div class="msg-text">${html}</div>
      <div class="msg-meta-row">
        <span class="msg-time">${timeNow()}</span>
        <div class="msg-actions">
          <button class="msg-action-btn" title="Copy" data-action="copy">📋</button>
          <button class="msg-action-btn" title="Helpful" data-action="like">👍</button>
          <button class="msg-action-btn" title="Not helpful" data-action="dislike">👎</button>
          <button class="msg-action-btn" title="Regenerate" data-action="regenerate">↻</button>
        </div>
      </div>
    </div>
  `;
  conversation.appendChild(group);
  lastRole = 'ai';

  // wire up the action buttons for this message
  const textEl = group.querySelector('.msg-text');
  group.querySelectorAll('.msg-action-btn').forEach(btn => {
    btn.addEventListener('click', () => handleMessageAction(btn.dataset.action, textEl, group));
  });

  scrollToBottom();
  return group;
}

function handleMessageAction(action, textEl, group) {
  if (action === 'copy') {
    navigator.clipboard?.writeText(textEl.innerText);
  } else if (action === 'like' || action === 'dislike') {
    console.log('Feedback:', action);
  } else if (action === 'regenerate') {
    console.log('Regenerate requested for message:', textEl.innerText);
    // Hook this up to re-send the previous user message if desired.
  }
}

function renderTyping() {
  const showAvatar = lastRole !== 'ai';
  const row = document.createElement('div');
  row.className = 'msg-group ai';
  row.id = 'typingRow';
  row.innerHTML = `
    <div class="avatar-slot ${showAvatar ? '' : 'spacer'}">${showAvatar ? '✨' : ''}</div>
    <div class="msg-col">
      <div class="typing-row"><span></span><span></span><span></span></div>
    </div>
  `;
  conversation.appendChild(row);
  scrollToBottom();
}

function removeTyping() {
  const row = document.getElementById('typingRow');
  if (row) row.remove();
}

// Reveals text progressively for a "streaming" feel, since the backend
// returns the full reply at once rather than token-by-token. Once the
// reveal finishes, the text is re-rendered through formatMessageHtml so
// markdown links/images/bold actually become real, clickable elements.
function streamText(container, fullText, onDone) {
  const words = fullText.split(' ');
  let i = 0;
  const interval = setInterval(() => {
    container.textContent = words.slice(0, i + 1).join(' ');
    i++;
    scrollToBottom();
    if (i >= words.length) {
      clearInterval(interval);
      container.innerHTML = formatMessageHtml(fullText);
      scrollToBottom();
      if (onDone) onDone();
    }
  }, 18);
}

function renderOutfitCards(outfits) {
  const scroll = document.createElement('div');
  scroll.className = 'outfit-scroll';
  scroll.innerHTML = outfits.map(o => `
    <div class="outfit-card">
      <div class="outfit-card-img" style="background-image:url('${o.image}')"></div>
      <div class="outfit-card-body">
        <ul class="outfit-card-list">
          ${o.items.map(it => `<li><span>${it.name}</span><span>₹${it.price}</span></li>`).join('')}
        </ul>
        <div class="outfit-card-total"><span>Total</span><span class="amt">₹${o.total}</span></div>
      </div>
    </div>
  `).join('');
  return scroll;
}

// ---------- Conversation history (sent to the backend for context) ----------

const conversationHistory = [];

// ---------- Real AI response — calls your backend server (unchanged) ----------

async function getAIResponse(userText) {
  try {
    const res = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userText,
        history: conversationHistory,
      }),
    });

    if (!res.ok) {
      throw new Error('Server responded with an error');
    }

    const data = await res.json();

    conversationHistory.push({ role: 'user', content: userText });
    conversationHistory.push({ role: 'assistant', content: data.text });

    return data; // { type: 'text', text: '...' }

  } catch (err) {
    console.error('Chat request failed:', err);
    return {
      type: 'text',
      text: "I couldn't reach the AI server. Make sure the backend is running (node server.js) and try again.",
    };
  }
}

// ---------- Send flow ----------

async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  revealConversation();
  renderUserMessage(trimmed);
  composerInput.value = '';
  autoGrowInput();
  sendBtn.disabled = true;

  renderTyping();
  const response = await getAIResponse(trimmed);
  removeTyping();

  if (response.type === 'outfits') {
    const group = renderAIMessage(`<p>${response.intro}</p>`);
    group.querySelector('.msg-col').appendChild(renderOutfitCards(response.outfits));
    if (response.followUp) {
      setTimeout(() => renderAIMessage(`<p>${escapeHtml(response.followUp)}</p>`), 400);
    }
  } else {
    const group = renderAIMessage('');
    const textEl = group.querySelector('.msg-text');
    streamText(textEl, response.text);
  }

  sendBtn.disabled = false;
}

// ---------- Event wiring ----------

sendBtn.addEventListener('click', () => sendMessage(composerInput.value));

composerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(composerInput.value);
  }
});

composerInput.addEventListener('input', autoGrowInput);

suggestionButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    sendMessage(btn.dataset.prompt);
  });
});

// "+" upload menu
plusBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  plusBtn.classList.toggle('open');
  uploadMenu.classList.toggle('open');
});

document.addEventListener('click', (e) => {
  if (!uploadMenu.contains(e.target) && e.target !== plusBtn) {
    uploadMenu.classList.remove('open');
    plusBtn.classList.remove('open');
  }
});

uploadMenu.querySelectorAll('.upload-menu-item').forEach(item => {
  item.addEventListener('click', () => {
    console.log('Upload action:', item.dataset.action);
    uploadMenu.classList.remove('open');
    plusBtn.classList.remove('open');
    // Hook up real file pickers / link paste modals here.
  });
});