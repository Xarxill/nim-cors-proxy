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

      // ---- DYNAMIC THINKING CONTROL ----
      if (req.body) {
        let rawModel = req.body.model || '';

        // Janitor style:  moonshotai/kimi-k3.1-pro[low]
        const effortMatch = rawModel.match(/\[(minimal|low|medium|high|max|none)\]/i);
        let effort = null;

        if (effortMatch) {
          effort = effortMatch[1].toLowerCase();
          // Strip the suffix before sending to NIM
          req.body.model = rawModel.replace(/\[(minimal|low|medium|high|max|none)\]/i, '').trim();
        } else {
          console.log('⚠️ No [effort] suffix found in model name – using NIM default');
        }

        // NIM Kimi uses chat_template_kwargs for thinking control.
        if (effort) {
          req.body.chat_template_kwargs = req.body.chat_template_kwargs || {};
          req.body.chat_template_kwargs.thinking = {
            type: effort === 'none' ? 'disabled' : 'enabled',
            effort: effort === 'none' ? undefined : effort
          };

          // Some NIM layers also read top-level reasoning_effort.
          // Setting it here makes the translation more robust.
          if (effort !== 'none') {
            req.body.reasoning_effort = effort;
          } else {
            // Remove any stale value if thinking is disabled
            delete req.body.reasoning_effort;
          }

          console.log(`🎛️  Effort set to "${effort}" (model sent as "${req.body.model}")`);
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
// The proxy rewrites req.body manually in proxyReq.
app.get('/', (req, res) => res.send('Proxy OK'));
app.use('/', proxy);

const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, '0.0.0.0', () =>
  console.log(`CORS proxy running on port ${PORT}`)
);
server.timeout = 0;
