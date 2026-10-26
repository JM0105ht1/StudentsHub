import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

const netlifyFunctionsDevPlugin = (): Plugin => ({
  name: 'netlify-functions-dev',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url && req.url.startsWith('/api/')) {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', async () => {
          try {
            const fullUrl = req.url || '';
            const [urlPath, queryString] = fullUrl.replace('/api/', '').split('?');
            const endpoint = urlPath;
            const queryStringParameters: Record<string, string> = {};
            if (queryString) {
              const searchParams = new URLSearchParams(queryString);
              for (const [key, value] of searchParams.entries()) {
                queryStringParameters[key] = value;
              }
            }
            let fnHandler: any = null;

            if (endpoint === 'process-ocr') {
              const mod = await server.ssrLoadModule('./netlify/functions/process-ocr.ts');
              fnHandler = mod.handler;
            } else if (endpoint === 'confirm-note-page') {
              const mod = await server.ssrLoadModule('./netlify/functions/confirm-note-page.ts');
              fnHandler = mod.handler;
            } else if (endpoint === 'auth-check') {
              const mod = await server.ssrLoadModule('./netlify/functions/auth-check.ts');
              fnHandler = mod.handler;
            } else if (endpoint === 'generate-exercises') {
              const mod = await server.ssrLoadModule('./netlify/functions/generate-exercises.ts');
              fnHandler = mod.handler;
            } else if (endpoint === 'admin-exercises') {
              const mod = await server.ssrLoadModule('./netlify/functions/admin-exercises.ts');
              fnHandler = mod.handler;
            } else if (endpoint === 'admin-notes') {
              const mod = await server.ssrLoadModule('./netlify/functions/admin-notes.ts');
              fnHandler = mod.handler;
            } else if (endpoint === 'submit-session') {
              const mod = await server.ssrLoadModule('./netlify/functions/submit-session.ts');
              fnHandler = mod.handler;
            } else if (endpoint === 'session-results') {
              const mod = await server.ssrLoadModule('./netlify/functions/session-results.ts');
              fnHandler = mod.handler;
            } else if (endpoint === 'session-questions') {
              const mod = await server.ssrLoadModule('./netlify/functions/session-questions.ts');
              fnHandler = mod.handler;
            }

            if (fnHandler) {
              const result = await fnHandler(
                {
                  httpMethod: req.method || 'GET',
                  headers: req.headers,
                  queryStringParameters,
                  body,
                },
                {} as any
              );

              res.statusCode = result.statusCode || 200;
              if (result.headers) {
                for (const [k, v] of Object.entries(result.headers)) {
                  res.setHeader(k, v as string);
                }
              }
              res.end(result.body || '');
              return;
            }
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message || 'Erro no servidor de desenvolvimento.' }));
            return;
          }
          next();
        });
        return;
      }
      next();
    });
  },
});

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), netlifyFunctionsDevPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
