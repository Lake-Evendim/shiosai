const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 8192);
const publicFiles = new Set([
  '/index.html', '/site.css', '/site.js', '/controls.css', '/controls.js',
  '/scene-engine.js', '/vendor/three.module.js',
  '/vendor/controls/OrbitControls.js', '/vendor/utils/BufferGeometryUtils.js'
]);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method not allowed');
    return;
  }

  let route;
  try {
    route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  if (route === '/') route = '/index.html';
  if (!publicFiles.has(route)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  try {
    const data = await fs.readFile(path.join(root, route.slice(1)));
    res.writeHead(200, {
      'Content-Type': types[path.extname(route)],
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end(error.code === 'ENOENT' ? 'Not found' : 'Could not read file');
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Set PORT to a different port.`
    : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`shiosai° · http://127.0.0.1:${port}/`);
});
