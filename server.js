const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// Manual CORS headers for every response
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Proxy all requests to NVIDIA NIM
const nimTarget = 'https://integrate.api.nvidia.com';

app.use(
  '/',
  createProxyMiddleware({
    target: nimTarget,
    changeOrigin: true,
    on: {
      proxyRes: (proxyRes, req, res) => {
        // Ensure CORS headers are present in the final response
        proxyRes.headers['access-control-allow-origin'] = '*';
        proxyRes.headers['access-control-allow-headers'] = 'Authorization, Content-Type';
      },
      proxyReq: (proxyReq, req, res) => {
        // Forward the Authorization header (your API key) from JanitorAI
        if (req.headers.authorization) {
          proxyReq.setHeader('Authorization', req.headers.authorization);
        }
        if (req.headers['content-type']) {
          proxyReq.setHeader('Content-Type', req.headers['content-type']);
        }
      },
    },
  })
);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`CORS proxy running on port ${PORT}`));
