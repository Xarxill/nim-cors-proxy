const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// ---- CORS ----
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const nimTarget = 'https://integrate.api.nvidia.com';

const proxy = createProxyMiddleware({
  target: nimTarget,
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq, req, res) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      if (req.headers['content-type']) {
        proxyReq.setHeader('Content-Type', req.headers['content-type']);
      }

      // Client disconnect handling
      const onClientClose = () => {
        console.log('⚠️ Client disconnected, aborting upstream request');
        proxyReq.destroy();
      };
      res.on('close', onClientClose);
      proxyReq.on('finish', () => res.off('close', onClientClose));

      // ---- DYNAMIC THINKING CONTROL (NIM-COMPATIBLE) ----
      if (req.body) {
        let rawModel = req.body.model || '';

        // Janitor style:  moonshotai/kimi-k3.1-pro[low]
        const effortMatch = rawModel.match(/\[(low|medium|high|max)\]/i);
        let effort = null;

        if (effortMatch) {
          effort = effortMatch[1].toLowerCase();
          // Strip the suffix before sending to NIM
          req.body.model = rawModel.replace(/\[(low|medium|high|max)\]/i, '').trim();
        } else {
          console.log('⚠️ No [effort] suffix found – using NIM default (low)');
        }

        // NIM for Kimi K3.1 Pro accepts a top-level reasoning_effort field.
        // Do NOT send chat_template_kwargs or a thinking object – NIM rejects them.
        if (effort) {
          req.body.reasoning_effort = effort;
          console.log(`🎛️  reasoning_effort set to "${effort}" (model: ${req.body.model})`);
        } else {
          // Let NIM apply its own default
          delete req.body.reasoning_effort;
        }

        // Clean up any accidental leftover fields that cause 400 errors
        delete req.body.chat_template_kwargs;
        delete req.body.thinking;

        const bodyData = JSON.stringify(req.body);
        console.log(`Request body size: ${bodyData.length} bytes`);
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
        proxyReq.end();
      }
    },
    proxyRes: (proxyRes, req, res) => {
      console.log(`← Response status: ${proxyRes.statusCode}`);
      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['access-control-allow-headers'] = 'Authorization, Content-Type';

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

// IMPORTANT: Do NOT parse the body before the proxy.
// The proxy rewrites req.body manually in proxyReq.
app.get('/', (req, res) => res.send('Proxy OK'));
app.use('/', proxy);

const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, '0.0.0.0', () =>
  console.log(`CORS proxy running on port ${PORT}`)
);
server.timeout = 0;
