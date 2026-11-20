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

      // ---- SANITIZE THINKING EFFORT FOR NIM ----
      if (req.body) {
        // 1. Remove any fields that NIM rejects
        delete req.body.chat_template_kwargs;
        delete req.body.thinking;

        // 2. Read the effort JanitorAI sent (it may be in different cases)
        let incomingEffort = req.body.reasoning_effort;
        if (typeof incomingEffort === 'string') {
          incomingEffort = incomingEffort.toLowerCase().trim();
        }

        // 3. Map Janitor's values to NIM's accepted values
        const effortMap = {
          'off':         'none',
          'minimal':     'low',
          'low':         'low',
          'medium':      'high',   // Kimi only has low/high/max
          'extra high':  'max',
          'extra_high':  'max',
          'extra-high':  'max',
          'max':         'max',
          'high':        'high',
          'none':        'none'
        };

        const mappedEffort = effortMap[incomingEffort] || null;

        if (mappedEffort) {
          if (mappedEffort === 'none') {
            // Kimi always reasons; "none" is the lowest allowed
            req.body.reasoning_effort = 'none';
          } else {
            req.body.reasoning_effort = mappedEffort;
          }
          console.log(`🎛️  Effort "${incomingEffort}" → sent as "${req.body.reasoning_effort}"`);
        } else {
          // No effort field from Janitor – let NIM use its default (max)
          delete req.body.reasoning_effort;
          console.log('ℹ️  No reasoning_effort sent – NIM will use its default');
        }

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
app.get('/', (req, res) => res.send('Proxy OK'));
app.use('/', proxy);

const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, '0.0.0.0', () =>
  console.log(`CORS proxy running on port ${PORT}`)
);
server.timeout = 0;
