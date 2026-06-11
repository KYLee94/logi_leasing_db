#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
};

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, Object.assign({ 'Cache-Control': 'no-store' }, headers));
  response.end(body);
}

const server = http.createServer((request, response) => {
  const urlPath = decodeURIComponent((request.url || '/').split('?')[0]);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(DOCS_DIR, relative);
  if (filePath !== DOCS_DIR && !filePath.startsWith(`${DOCS_DIR}${path.sep}`)) {
    send(response, 403, 'Forbidden');
    return;
  }
  fs.readFile(filePath, (error, body) => {
    if (error) {
      send(response, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    send(response, 200, body, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`docs server: http://${HOST}:${PORT}/`);
});
