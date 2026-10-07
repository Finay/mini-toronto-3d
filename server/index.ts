import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app';
import { sources } from './sources';

const app = createApp(sources);

// In development Vite serves the client and proxies /api here. In production
// (`npm start`) this server serves the built client as well.
if (process.env.NODE_ENV === 'production') {
  if (!existsSync('dist')) throw new Error('dist/ not found; run `npm run build` first');
  app.use('*', serveStatic({ root: './dist' }));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`mini-toronto server listening on http://localhost:${info.port}`);
});
