const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// ---- CORS headers ----
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const nimTarget = 'https://integrate.api.nvidia.com';

const proxy = createProxyMiddleware({
  target: nimTarget,
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq, req, res) => {
      // Log outgoing URL
      console.log('→ Proxying to:', nimTarget + req.url);

      // Forward necessary headers
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      if (req.headers['content-type']) {
        proxyReq.setHeader('Content-Type', req.headers['content-type']);
      }

      // If body was parsed by Express (not using express.json() here, but just in case)
      if (req.body) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
        proxyReq.end();
      }
    },
    proxyRes: (proxyRes, req, res) => {
      console.log('← Response status:', proxyRes.statusCode);

      // CORS headers on response
      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['access-control-allow-headers'] = 'Authorization, Content-Type';

      // ---- NEW: capture the body on error responses ----
      if (proxyRes.statusCode >= 400) {
        let body = '';
        proxyRes.on('data', (chunk) => {
          body += chunk.toString();
        });
        proxyRes.on('end', () => {
          console.error('NVIDIA error body:', body);
        });
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

app.use('/', proxy);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`CORS proxy running on port ${PORT}`));
