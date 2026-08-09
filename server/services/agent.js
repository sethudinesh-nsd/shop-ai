const ai = require('./ai');
const tools = require('./tools');
const vision = require('./vision');
const systemPrompt = require('../prompts/systemPrompt');

// How many recent turns to give the tool-selector for context. Kept small —
// it only needs enough to resolve a follow-up like "show me in white", not
// the full conversation.
const TOOL_SELECTOR_HISTORY_TURNS = 3;

// Runs vision (if images were uploaded) + tool selection, then builds the
// final message array (system prompt + history + user message, with live
// search/vision context injected as needed). Shared by both the
// non-streaming and streaming chat endpoints, so images, search, and the
// system prompt all apply no matter which path the frontend uses.
//
// `images` is an array of data URLs (see js/script.js) — already-uploaded
// photos attached to this turn. Vision runs BEFORE the AI replies, so the
// stylist model always responds as if it had actually seen the photo,
// without the user needing to describe it.
async function buildMessages(message, history = [], images = []) {
  // Give the tool-selector the last few turns so it can resolve follow-ups
  // ("show me in white" after "black sneakers") into a real, standalone
  // search query — without this, it only ever sees the current message in
  // isolation and searches for whatever fragment the user just typed.
  const recentHistory = history.slice(-TOOL_SELECTOR_HISTORY_TURNS * 2);

  // Vision and tool-selection are independent of each other, so run them
  // in parallel rather than paying their latency back-to-back.
  const [visionContext, toolDecision] = await Promise.all([
    images && images.length > 0 ? vision.describeImagesForChat(images, message) : Promise.resolve(''),
    ai.chat([
      {
        role: 'system',
        content: `You are a tool selector for a fashion shopping assistant. Reply ONLY with valid JSON.

Available tools:
- chat
- search
- shopping

Use the recent conversation to resolve follow-ups into a complete, standalone
search query. Example: if the user previously asked about "black sneakers"
and now says "show me in white", the query should be "white sneakers", not
just "in white".

Return this format exactly:
{
  "tool": "chat" | "search" | "shopping",
  "query": "search query if needed"
}`,
      },
      ...recentHistory,
      {
        role: 'user',
        content: message,
      },
    ], 150),
  ]);

  let tool = 'chat';
  let query = message;

  try {
    const parsed = JSON.parse(toolDecision);
    tool = parsed.tool || 'chat';
    query = parsed.query || message;
  } catch {
    tool = 'chat';
  }

  let toolContext = '';

  if (tool === 'search' || tool === 'shopping') {
    const data = await tools[tool](query);

    toolContext = `LIVE SEARCH RESULTS:\n${JSON.stringify({
      results: data.results || [],
      images: data.images || [],
    }, null, 2)}`;
  }

  // Combine vision + search context into one block. Order matters: vision
  // first, since it's "what the user just showed you" and should frame how
  // any search results get used (e.g. styling around a garment they photographed).
  const contextBlocks = [];
  if (visionContext) {
    contextBlocks.push(`IMAGE ANALYSIS (from photo(s) the user just uploaded):\n${visionContext}`);
  }
  if (toolContext) {
    contextBlocks.push(toolContext);
  }
  const combinedContext = contextBlocks.join('\n\n');

  return [
    { role: 'system', content: systemPrompt },
    ...history,
    {
      role: 'user',
      content: combinedContext
        ? `${combinedContext}\n\nUser Question: ${message}`
        : message,
    },
  ];
}

async function agent(message, history = [], images = []) {
  const messages = await buildMessages(message, history, images);
  const answer = await ai.chat(messages, 900);

  return {
    type: 'text',
    text: answer,
  };
}

agent.buildMessages = buildMessages;
module.exports = agent;