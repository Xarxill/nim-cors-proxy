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

// ---- Raw body capture for proxy ----
// Important: do NOT use express.json() – that would consume the stream.
// We'll just let the proxy pipe the request body as-is.

const nimTarget = 'https://integrate.api.nvidia.com';

const proxy = createProxyMiddleware({
  target: nimTarget,
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq, req, res) => {
      // Log the outgoing URL for debugging
      console.log('→ Proxying to:', nimTarget + req.url);

      // Forward headers
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      if (req.headers['content-type']) {
        proxyReq.setHeader('Content-Type', req.headers['content-type']);
      }

      // If the body has been partially consumed, re-send it
      if (req.body) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
        proxyReq.end();
      }
    },
    proxyRes: (proxyRes, req, res) => {
      console.log('← Response status:', proxyRes.statusCode);
      // CORS on response
      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['access-control-allow-headers'] = 'Authorization, Content-Type';
    },
    error: (err, req, res) => {
      console.error('Proxy error:', err.message);
      res.status(500).send('Proxy error');
    },
  },
});

app.use('/', proxy);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`CORS proxy running on port ${PORT}`));
