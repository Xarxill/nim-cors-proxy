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
  // Disable buffering, forward stream as-is
  selfHandleResponse: false,  // keep default
  on: {
    proxyReq: (proxyReq, req, res) => {
      console.log('→ Proxying to:', nimTarget + req.url);

      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      if (req.headers['content-type']) {
        proxyReq.setHeader('Content-Type', req.headers['content-type']);
      }

      // If body was parsed (unlikely), re-send
      if (req.body) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
        proxyReq.end();
      }
    },
    proxyRes: (proxyRes, req, res) => {
      console.log('← Response status:', proxyRes.statusCode);
      const startTime = Date.now();

      // CORS
      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['access-control-allow-headers'] = 'Authorization, Content-Type';

      // Intercept the stream to log first data arrival
      const originalWrite = res.write.bind(res);
      let firstChunk = true;
      res.write = function(chunk, ...args) {
        if (firstChunk) {
          console.log(`→ First chunk after ${Date.now() - startTime}ms`);
          firstChunk = false;
        }
        return originalWrite(chunk, ...args);
      };

      // Also log any error body
      if (proxyRes.statusCode >= 400) {
        let body = '';
        proxyRes.on('data', (chunk) => { body += chunk.toString(); });
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

// Increase server timeout to 110s to match Render's limit
const server = app.listen(process.env.PORT || 10000, () => {
  console.log('CORS proxy running');
});
server.timeout = 110000; // 110 seconds, just under Render's 100s? Actually Render's timeout is at the load balancer, we can't exceed that. This just prevents Node from closing early.
