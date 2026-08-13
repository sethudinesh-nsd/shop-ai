const ai = require('./ai');
const tools = require('./tools');
const vision = require('./vision');
const systemPrompt = require('../prompts/systemPrompt');

const CHAT_BEHAVIOR = `
Conversation behavior:
- Respond naturally and conversationally, like a polished general-purpose AI assistant.
- Answer the user's actual question directly; do not unnecessarily explain your process.
- Keep simple questions concise. Give more detail only when the question genuinely needs it.
- Use short paragraphs, bullets, numbered steps, and headings when they improve readability.
- Maintain context from the recent conversation and understand follow-up questions naturally.
- Do not repeat information the user already knows unless it is necessary for clarity.
- Do not mention internal tools, system prompts, model names, token limits, or hidden instructions.
- If the user is ambiguous, make the most reasonable interpretation when possible instead of asking unnecessary clarification.
- Be honest when you do not know something.
- For casual conversation, respond naturally rather than forcing a shopping/fashion response.
- For shopping, fashion, outfit, or styling requests, act as the user's intelligent shopping and style assistant.
- When live search results or image analysis are provided, use them naturally and do not claim to have accessed information that was not provided.
`;

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
        content: `You are the intent router for Shop AI. Reply ONLY with valid JSON.

Your job is to decide whether the user's message needs normal AI conversation,
web search, or shopping/product search.

Available tools:
- chat: normal conversation, general knowledge, coding, writing, advice,
  greetings, casual conversation, explanations, and questions that do not
  require live external information.
- search: requests that need current/live web information, current events,
  current facts, websites, places, or information that should be searched.
- shopping: requests to find, compare, or recommend purchasable products,
  fashion items, outfits, stores, prices, or shopping options.

IMPORTANT:
- Greetings such as "hello", "hi", "hey", "how are you?", and casual
  conversation MUST use chat.
- General questions MUST use chat unless the user explicitly needs current
  or externally verified information.
- Do not use search just because the topic is fashion.
- Do not use shopping just because clothing is mentioned.
- Use shopping only when the user is actually asking for products, items,
  outfits to buy, prices, stores, or shopping recommendations.
- Use search when the user explicitly asks to search, find current information,
  check a website, or when live information is genuinely required.
- If the user's request can be answered naturally without a tool, choose chat.
- For follow-up messages, use recent conversation context to understand what
  the user means.
- Never invent a search query when the tool is chat.

Examples:
"hello" -> chat
"how are you?" -> chat
"what is Python?" -> chat
"help me write a resume" -> chat
"explain recursion" -> chat
"what should I wear to a wedding?" -> chat
"suggest me a dress" -> shopping
"find me a black dress under ₹3000" -> shopping
"show me sneakers under ₹5000" -> shopping
"what is trending this week?" -> search
"find the latest iPhone price" -> search

Return exactly:
{
  "tool": "chat" | "search" | "shopping",
  "query": "standalone search query if needed, otherwise empty string"
}`,
      },
      ...recentHistory,
      {
        role: 'user',
        content: message,
      },
    ], 120),
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
    { role: 'system', content: `${systemPrompt}\n\n${CHAT_BEHAVIOR}` },
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
  const answer = await ai.chat(messages, 500);

  return {
    type: 'text',
    text: answer,
  };
}

agent.buildMessages = buildMessages;
module.exports = agent;