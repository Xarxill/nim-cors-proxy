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

const proxy = createProxyMiddleware({
  target: nimTarget,
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq, req, res) => {
      // ---- Log every request ----
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

      // Forward required headers
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      if (req.headers['content-type']) {
        proxyReq.setHeader('Content-Type', req.headers['content-type']);
      }

      // ---- Handle client disconnect (stop generation) ----
      const onClientClose = () => {
        console.log('⚠️ Client disconnected, aborting upstream request');
        proxyReq.destroy(); // immediately terminate connection to NVIDIA
      };
      req.on('close', onClientClose);
      req.on('aborted', onClientClose);

      // Clean up listeners when proxyReq finishes to avoid memory leaks
      proxyReq.on('finish', () => {
        req.off('close', onClientClose);
        req.off('aborted', onClientClose);
      });

      // If body was parsed by Express, re-send it (unlikely, but safe)
      if (req.body) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
        proxyReq.end();
      }
    },
    proxyRes: (proxyRes, req, res) => {
      console.log(`← Response status: ${proxyRes.statusCode}`);

      // CORS on response
      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['access-control-allow-headers'] = 'Authorization, Content-Type';

      // Log error body for debugging
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

// Health check
app.get('/', (req, res) => res.send('Proxy OK'));

app.use('/', proxy);

const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, () =>
  console.log(`CORS proxy running on port ${PORT}`)
);
server.timeout = 0; // rely on Render's load balancer timeout
