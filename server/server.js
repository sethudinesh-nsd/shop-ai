/**
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
// (e.g. VS Code Live Server on :5500) while the API stays on :3000.
// Without these headers, the browser blocks the response silently and
// fetch() just throws — which looks identical to "server not running".
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

    let result;
    try {
      result = await agent(userMessage, history);
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

const server = http.createServer((req, res) => {
  applyCorsHeaders(res);

  // Preflight requests: the browser sends OPTIONS before a cross-origin
  // POST with a JSON body. Must answer this or the real POST never fires.
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let requestUrl = decodeURIComponent(req.url.split('?')[0]);

  if (req.method === 'POST' && requestUrl === '/api/chat') {
    respondToChat(req, res);
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