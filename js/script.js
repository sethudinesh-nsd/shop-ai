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

// ==========================================================================
// DOM REFS
// ==========================================================================
const hero = document.getElementById('hero');
const heroIntro = document.getElementById('heroIntro');
const features = document.getElementById('features');
const chatMessages = document.getElementById('chatMessages');
const searchInput = document.getElementById('searchInput');
const submitBtn = document.getElementById('submitBtn');
const messageTemplate = document.getElementById('messageTemplate');
const themeToggle = document.getElementById('themeToggle');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
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
// THEME TOGGLE
// ==========================================================================
function setTheme(button) {
  if (!button) return;
  document.documentElement.dataset.theme = button.dataset.theme;
  themeToggle.querySelectorAll('.theme-toggle__btn').forEach((btn) => {
    btn.classList.toggle('theme-toggle__btn--active', btn === button);
  });
}

if (themeToggle) {
  themeToggle.addEventListener('click', (event) => {
    const button = event.target.closest('.theme-toggle__btn');
    setTheme(button);
  });
}

// ==========================================================================
// NAV — "Home" resets back to the pre-chat state
// ==========================================================================
navItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navItems.forEach((i) => i.classList.remove('nav-item--active'));
    item.classList.add('nav-item--active');
    if (item.dataset.nav === 'home') resetToHome();
  });
});

// ==========================================================================
// HOME <-> CHAT MODE (this is the part that was missing)
// ==========================================================================
function enterChatMode() {
  if (chatModeActive) return;
  chatModeActive = true;
  hero.classList.add('hero--chat-mode');
  features.classList.add('features--hidden');
}

function resetToHome() {
  chatModeActive = false;
  hero.classList.remove('hero--chat-mode');
  features.classList.remove('features--hidden');
  chatMessages.innerHTML = '';
  conversationHistory.length = 0;
  searchInput.value = '';
  clearPendingFile();
}

// ==========================================================================
// RENDERING
// ==========================================================================
function scrollChatToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function timeNow() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ==========================================================================
// TEXT FORMATTING (markdown-lite -> safe HTML)
// ==========================================================================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Converts a limited, safe subset of markdown into HTML. Input is escaped
// FIRST, so nothing the model or user writes can become a live/unsafe tag.
function formatMessageHtml(rawText) {
  let safe = escapeHtml(rawText);

  // Links: [text](url)
  safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Bold: **text**
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Bare URLs not already turned into a link above
  safe = safe.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g, (match, before, url) => {
    return `${before}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });

  safe = safe.replace(/\n/g, '<br>');
  return safe;
}

/** Renders one message bubble from the <template>. Returns the .msg element. */
function renderMessage(role, text) {
  const node = messageTemplate.content.cloneNode(true);
  const msgEl = node.querySelector('.msg');
  const bubbleEl = node.querySelector('.msg__bubble');
  const timeEl = node.querySelector('.msg__time');
  const copyBtn = node.querySelector('.msg__copy');

  msgEl.classList.add(role === 'user' ? 'msg--user' : 'msg--assistant');

  if (role === 'user') {
    bubbleEl.textContent = text;
  } else {
    bubbleEl.innerHTML = formatMessageHtml(text);
  }

  timeEl.textContent = timeNow();
  copyBtn.addEventListener('click', () => navigator.clipboard?.writeText(bubbleEl.innerText));

  chatMessages.appendChild(node);
  scrollChatToBottom();
  return msgEl;
}

function renderTypingIndicator() {
  const node = messageTemplate.content.cloneNode(true);
  const msgEl = node.querySelector('.msg');
  const bubbleEl = node.querySelector('.msg__bubble');
  const metaEl = node.querySelector('.msg__meta');

  msgEl.classList.add('msg--assistant', 'msg--typing');
  bubbleEl.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
  metaEl.remove();

  chatMessages.appendChild(node);
  scrollChatToBottom();
  return msgEl;
}

// ==========================================================================
// BACKEND CALL — matches the { type: 'text', text } shape agent.js returns
// ==========================================================================
async function fetchAIResponse(userText) {
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userText, history: conversationHistory }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    const replyText = (data.text || '').trim() || "Sorry, I couldn't get a response from the backend.";

    conversationHistory.push({ role: 'user', content: userText });
    conversationHistory.push({ role: 'assistant', content: replyText });

    return replyText;
  } catch (err) {
    console.error('Chat request failed:', err);
    return "I couldn't reach the backend. Make sure `node server.js` is running, then open the app from http://localhost:3000.";
  }
}

// ==========================================================================
// SEND FLOW
// ==========================================================================
async function handleSend() {
  const value = searchInput.value.trim();
  if (!value || isSending) return;

  enterChatMode();
  renderMessage('user', value);
  searchInput.value = '';
  clearPendingFile();

  isSending = true;
  submitBtn.disabled = true;
  const typingEl = renderTypingIndicator();

  const replyText = await fetchAIResponse(value);
  typingEl.remove();
  renderMessage('assistant', replyText);

  submitBtn.disabled = false;
  isSending = false;
}

if (submitBtn) submitBtn.addEventListener('click', handleSend);

if (searchInput) {
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSend();
    }
  });
}

// ==========================================================================
// SUGGESTION CHIPS
// ==========================================================================
suggestionChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    searchInput.value = chip.dataset.prompt || '';
    handleSend();
  });
});

// ==========================================================================
// UPLOAD (+) BUTTON — attaches a file name to the next message
// ==========================================================================
let pendingFile = null;

function clearPendingFile() {
  pendingFile = null;
  if (fileInput) fileInput.value = '';
  if (uploadBtn) {
    uploadBtn.classList.remove('searchbar__icon-btn--active');
    uploadBtn.title = 'Add';
  }
}

if (uploadBtn && fileInput) {
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    pendingFile = file;
    uploadBtn.classList.add('searchbar__icon-btn--active');
    uploadBtn.title = `Attached: ${file.name}`;
    // Vision isn't wired up in tools.js yet — for now this just labels the
    // next message. Hook this into a real upload once tools.vision() works.
  });
}