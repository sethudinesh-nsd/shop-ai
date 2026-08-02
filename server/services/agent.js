

const ai = require('./ai');
const tools = require('./tools');
const systemPrompt = require('../prompts/systemPrompt');

async function agent(message, history = []) {
  // Step 1: Let the model decide which tool to use.
  const toolDecision = await ai.chat([
    {
      role: 'system',
      content: `You are a tool selector. Reply ONLY with valid JSON.\n\nAvailable tools:\n- chat\n- search\n- shopping\n\nReturn this format exactly:\n{\n  "tool": "chat" | "search" | "shopping",\n  "query": "search query if needed"\n}`,
    },
    {
      role: 'user',
      content: message,
    },
  ], 150);

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

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    {
      role: 'user',
      content: toolContext
        ? `${toolContext}\n\nUser Question: ${message}`
        : message,
    },
  ];

  const answer = await ai.chat(messages, 900);

  return {
    type: 'text',
    text: answer,
  };
}

module.exports = agent;