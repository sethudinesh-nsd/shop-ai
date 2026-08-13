require('dotenv').config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

async function chat(messages, maxTokens = 500) {
  if (GROQ_API_KEY) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Groq request failed');
    }

    return data.choices?.[0]?.message?.content || '';
  }

  if (OPENAI_API_KEY) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'OpenAI request failed');
    }

    return data.choices?.[0]?.message?.content || '';
  }

  const userMessage = messages[messages.length - 1]?.content || '';
  return `Got it — "${userMessage}". I'd love to style this for you, but I'm not connected to a model right now (no API key set). Once that's wired up, ask me about an outfit, an occasion, or a piece you want to build a look around.`;
}


// Streaming Groq support
async function chatStream(messages, onChunk, maxTokens = 500) {
  if (!GROQ_API_KEY) {
    // Fallback to non-streaming
    const text = await chat(messages, maxTokens);
    onChunk(text);
    return text;
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
      stream: true,
    }),
  });

  if (!response.ok) {
    let error = 'Groq request failed';
    try {
      const data = await response.json();
      error = data.error?.message || error;
    } catch {}
    throw new Error(error);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';
  let done = false;
  while (!done) {
    const { value, done: readerDone } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split('\n');
      buffer = lines.pop(); // keep last partial line if any
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') {
          done = true;
          break;
        }
        try {
          const json = JSON.parse(payload);
          const chunk = json.choices?.[0]?.delta?.content;
          if (chunk) {
            fullText += chunk;
            onChunk(chunk);
          }
        } catch (e) {
          // Ignore JSON parse errors for malformed lines
        }
      }
    }
    if (readerDone) break;
  }
  return fullText;
}

module.exports = { chat, chatStream };