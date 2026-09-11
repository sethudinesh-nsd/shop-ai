/* ==========================================================================
   js/history.js — History view
   --------------------------------------------------------------------------
   Reads conversations/messages back from Supabase (written by script.js on
   the Home view) and renders them into #historyList in history.html.
   Exposes window.ShopAIHistory = { init, destroy } for the app-shell
   router (js/app.js) to call on mount/unmount, same pattern as
   window.ShopAIWardrobe.
   ========================================================================== */

(() => {
  'use strict';

  const CONVERSATIONS_TABLE = 'conversations';
  const MESSAGES_TABLE = 'messages';

  let historyListEl = null;
  let historyEmptyEl = null;
  let historySkeletonEl = null;
  let historyItems = [];
  let mountToken = 0; // bumped on every init/destroy so stale async work bails out

  async function getSupabase() {
    return window.ShopAISupabase.client || window.ShopAISupabase.ready;
  }

  async function fetchConversations() {
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from(CONVERSATIONS_TABLE)
        .select('id, title, summary, updated_at')
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Failed to load conversation history:', err);
      return [];
    }
  }

  async function fetchMessagesForConversation(conversationId) {
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from(MESSAGES_TABLE)
        .select('role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Failed to load conversation messages:', err);
      return [];
    }
  }

  // Explicit two-step delete — messages first, then the conversation row —
  // since we can't assume ON DELETE CASCADE is configured on the FK.
  async function deleteConversation(conversationId) {
    try {
      const supabase = await getSupabase();

      const { error: msgError } = await supabase
        .from(MESSAGES_TABLE)
        .delete()
        .eq('conversation_id', conversationId);
      if (msgError) throw msgError;

      const { error: convError } = await supabase
        .from(CONVERSATIONS_TABLE)
        .delete()
        .eq('id', conversationId);
      if (convError) throw convError;

      return true;
    } catch (err) {
      console.error('Failed to delete conversation:', err);
      return false;
    }
  }

  function formatRelativeDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  function renderHistoryItem(conversation) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'history-item';
    item.dataset.conversationId = conversation.id;

    const icon = document.createElement('span');
    icon.className = 'history-item__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.2-.67L5 20l1.67-4.3A7.5 7.5 0 1 1 20 11.5Z"/>
      </svg>`;

    const copy = document.createElement('span');
    copy.className = 'history-item__copy';

    const title = document.createElement('span');
    title.className = 'history-item__title';
    title.textContent = conversation.title || 'Untitled conversation';
    copy.appendChild(title);

    if (conversation.summary) {
      const preview = document.createElement('span');
      preview.className = 'history-item__preview';
      preview.textContent = conversation.summary;
      copy.appendChild(preview);
    }

    const date = document.createElement('span');
    date.className = 'history-item__date';
    date.textContent = formatRelativeDate(conversation.updated_at);

    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'history-item__delete';
    deleteBtn.setAttribute('role', 'button');
    deleteBtn.setAttribute('aria-label', 'Delete conversation');
    deleteBtn.title = 'Delete conversation';
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 7h16"/>
        <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>
        <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>
        <path d="M10 11v6M14 11v6"/>
      </svg>`;

    item.appendChild(icon);
    item.appendChild(copy);
    item.appendChild(date);
    item.appendChild(deleteBtn);

    return item;
  }

  async function handleHistoryItemClick(event) {
    const item = event.currentTarget;
    const conversationId = item.dataset.conversationId;

    item.classList.add('history-item--selected');
    setTimeout(() => {
      item.classList.remove('history-item--selected');
    }, 180);

    if (!conversationId) return;

    // Load the conversation messages from Supabase first.
    const messages = await fetchMessagesForConversation(conversationId);

    // Find the existing Home navigation item.
    const homeNav = document.querySelector(
      '.sidebar__nav .nav-item[data-nav="home"]'
    );

    if (!homeNav) {
      console.error('History: Home navigation item not found.');
      return;
    }

    // Wait for app.js to signal that Home has actually finished mounting
    // (not just that the function exists) before loading the conversation,
    // so ShopAIHome.init() can't run afterward and wipe it out.
    document.addEventListener('shopai:view-mounted', function onMount(e) {
      if (e.detail.view !== 'home') return;
      document.removeEventListener('shopai:view-mounted', onMount);
      if (window.ShopAIHome && typeof window.ShopAIHome.loadConversation === 'function') {
        window.ShopAIHome.loadConversation(conversationId, messages);
      }
    });

    // Navigate through the EXISTING app router.
    homeNav.click();
  }

  async function handleDeleteClick(event) {
    event.stopPropagation(); // don't trigger the item's open/click handler

    const deleteBtn = event.currentTarget;
    const item = deleteBtn.closest('.history-item');
    if (!item) return;
    const conversationId = item.dataset.conversationId;
    if (!conversationId) return;

    const confirmed = window.confirm('Delete this conversation? This cannot be undone.');
    if (!confirmed) return;

    deleteBtn.disabled = true;
    item.style.opacity = '0.5';

    const success = await deleteConversation(conversationId);

    if (!success) {
      item.style.opacity = '';
      deleteBtn.disabled = false;
      alert('Failed to delete conversation. Please try again.');
      return;
    }

    item.removeEventListener('click', handleHistoryItemClick);
    deleteBtn.removeEventListener('click', handleDeleteClick);
    item.remove();
    historyItems = historyItems.filter((el) => el !== item);

    if (historyEmptyEl) historyEmptyEl.hidden = historyItems.length > 0;
  }

  async function renderHistoryList() {
    if (!historyListEl) return;
    const token = mountToken;

    if (historySkeletonEl) historySkeletonEl.hidden = false;
    if (historyEmptyEl) historyEmptyEl.hidden = true;
    historyListEl.innerHTML = '';

    const conversations = await fetchConversations();

    // The view was unmounted (or re-mounted) while this fetch was in
    // flight — don't touch DOM that's no longer ours (or no longer exists).
    if (token !== mountToken || !historyListEl) return;

    if (historySkeletonEl) historySkeletonEl.hidden = true;

    historyListEl.innerHTML = '';
    historyItems = conversations.map((conversation) => {
      const el = renderHistoryItem(conversation);
      el.addEventListener('click', handleHistoryItemClick);
      const deleteBtn = el.querySelector('.history-item__delete');
      if (deleteBtn) deleteBtn.addEventListener('click', handleDeleteClick);
      historyListEl.appendChild(el);
      return el;
    });

    if (historyEmptyEl) historyEmptyEl.hidden = conversations.length > 0;
  }

  async function init() {
    mountToken += 1;
    historyListEl = document.getElementById('historyList');
    historyEmptyEl = document.getElementById('historyEmpty');
    historySkeletonEl = document.getElementById('historySkeleton');
    if (!historyListEl) {
      console.warn('history.js: #historyList not found — check history.html markup.');
      return;
    }
    await renderHistoryList();
  }

 function destroy() {
    mountToken += 1;
    historyItems.forEach((item) => {
      item.removeEventListener('click', handleHistoryItemClick);
      const deleteBtn = item.querySelector('.history-item__delete');
      if (deleteBtn) deleteBtn.removeEventListener('click', handleDeleteClick);
    });
    historyItems = [];
    historyListEl = null;
    historyEmptyEl = null;
    historySkeletonEl = null;
  }

  window.ShopAIHistory = {
    init,
    destroy
  };
})();