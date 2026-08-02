// SHOP AI — backend server
// Talks to Groq's API (genuinely free tier, no credit card, 14,400
// requests/day) so the chat widget gives real AI responses, plus
// live web search via Tavily for shopping/trend/price questions.
//
// SETUP:
//   1. Groq key (chat model): https://console.groq.com/keys
//   2. Tavily key (web search): https://app.tavily.com — free tier,
//      1,000 searches/month, no credit card
//   3. cd server
//   4. npm install
//   5. copy .env.example to .env and paste BOTH keys in
//   6. node server.js
//   7. Open pages/index.html or pages/aipage.html through a local server
//      (e.g. VS Code "Live Server" extension) — NOT as a file:// path,
//      or the browser will block the request to localhost:3000.

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const agent = require('./services/agent');

app.use(cors());
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY is missing from server/.env' });
  }

  try {
    const result = await agent(message, history || []);
    res.json(result);

  } catch (err) {
    console.error('Server error:', err.message);
    res.status(500).json({ error: 'Something went wrong talking to the AI. Check your API key and try again.' });
  }
});

app.listen(PORT, () => {
  console.log(`Shop AI backend running at http://localhost:${PORT}`);
});