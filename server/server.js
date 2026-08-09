/****
 * Simple static file server for the Shop AI UI.
 * No frameworks — uses only Node core modules (http, fs, path).
 *
 * Run:   node server.js
 * Open:  http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const agent = require('./services/agent');
const { chatStream } = require('./services/ai');
const vision = require('./services/vision');
const { uploadImage } = require('./services/upload'); // ADDED THIS IMPORT

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// Allows the frontend to be previewed from a different origin/port
function applyCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function respondToChat(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const userMessage = (payload.message || '').toString();
    const history = Array.isArray(payload.history) ? payload.history : [];
    const images = Array.isArray(payload.images) ? payload.images : [];

    let result;
    try {
      result = await agent(userMessage, history, images);
    } catch (err) {
      console.error('AI agent error:', err);
      result = {
        type: 'text',
        text: "Sorry, I couldn't generate a response right now. Please try again later.",
      };
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify(result));
  });
}

async function respondToChatStream(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const userMessage = (payload.message || '').toString();
    const history = Array.isArray(payload.history) ? payload.history : [];
    const images = Array.isArray(payload.images) ? payload.images : [];

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    res.write(': connected\n\n');

    try {
      const messages = await agent.buildMessages(userMessage, history, images);

      await chatStream(messages, chunk => {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      });
      res.write('event: done\ndata: done\n\n');
      res.end();
    } catch (err) {
      console.error('Stream error:', err);
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Streaming failed' })}\n\n`);
      res.end();
    }
  });
}

// Wardrobe upload -> vision analysis.
async function respondToVisionWardrobe(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const image = (payload.image || '').toString();
    if (!image) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing "image" (data URL) in request body' }));
      return;
    }

    const metadata = await vision.analyzeWardrobeItem(image).catch((err) => {
      console.error('Unexpected vision error:', err);
      return { category: 'top', confidence: 0 };
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify(metadata));
  });
}

const server = http.createServer((req, res) => {
  applyCorsHeaders(res);

  // Preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let requestUrl = decodeURIComponent(req.url.split('?')[0]);

  // --- NEW IMAGE UPLOAD ROUTE (Cloudinary) ---
  if (req.method === 'POST' && requestUrl === '/api/upload') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const { image } = JSON.parse(body || '{}');
        if (!image) throw new Error('Missing image data');
        
        const imageUrl = await uploadImage(image);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: imageUrl }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  // -------------------------------------------

  if (req.method === 'POST' && requestUrl === '/api/chat/stream') {
    respondToChatStream(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl === '/api/chat') {
    respondToChat(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl === '/api/vision/wardrobe') {
    respondToVisionWardrobe(req, res);
    return;
  }

  if (requestUrl === '/') {
    requestUrl = '/index.html';
  }

  const filePath = path.normalize(path.join(ROOT, requestUrl));

  // Prevent directory traversal outside the project root
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Shop AI running at http://localhost:${PORT}`);
});