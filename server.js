const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// ---- CORS ----
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const nimTarget = 'https://integrate.api.nvidia.com';

// ---- Proxy (no truncation, full context, proper disconnect) ----
const proxy = createProxyMiddleware({
  target: nimTarget,
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq, req, res) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

      // Log request body size (just for info)
      if (req.body) {
        const bodyString = JSON.stringify(req.body);
        console.log(`Request body size: ${bodyString.length} bytes`);
      }

      // Forward headers
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      if (req.headers['content-type']) {
        proxyReq.setHeader('Content-Type', req.headers['content-type']);
      }

      // ---- Disconnect handling (stop generation) ----
      const onClientClose = () => {
        console.log('⚠️ Client disconnected, aborting upstream request');
        proxyReq.destroy();
      };
      res.on('close', onClientClose);
      proxyReq.on('finish', () => res.off('close', onClientClose));

      // If body was parsed by Express, re-send the full body as-is
      if (req.body) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
        proxyReq.end();
      }
      // If body not parsed (unlikely), the proxy will pipe the stream automatically
    },
    proxyRes: (proxyRes, req, res) => {
      console.log(`← Response status: ${proxyRes.statusCode}`);

      // CORS on response
      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['access-control-allow-headers'] = 'Authorization, Content-Type';

      // Log error body for debugging
      if (proxyRes.statusCode >= 400) {
        let body = '';
        proxyRes.on('data', (chunk) => { body += chunk.toString(); });
        proxyRes.on('end', () => console.error('NVIDIA error body:', body));
      }
    },
    error: (err, req, res) => {
      console.error('Proxy error:', err.message);
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'text/plain' });
        res.end('Proxy error: ' + err.message);
      }
    },
  },
});

// Parse JSON body so we can log its size (no truncation)
app.use(express.json({ limit: '5mb' }));

app.get('/', (req, res) => res.send('Proxy OK'));
app.use('/', proxy);

const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, () => console.log(`CORS proxy running on port ${PORT}`));
server.timeout = 0;
