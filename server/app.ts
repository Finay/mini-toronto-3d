import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import type { SourceInfo, VehicleSnapshot } from '../shared/types';
import { cached } from './cache';
import type { VehicleSource } from './sources/types';

// Upstream is hit at most once per this fraction of a source's poll interval,
// however many browsers are connected.
const CACHE_TTL_FRACTION = 0.9;

export function createApp(sources: VehicleSource[]): Hono {
  const app = new Hono();
  const byId = new Map(sources.map((source) => [source.info.id, source]));

  const loaders = new Map(
    sources.map((source) => [
      source.info.id,
      cached(source.info.pollIntervalMs * CACHE_TTL_FRACTION, async () => {
        try {
          return await source.fetchVehicles();
        } catch (error) {
          console.warn(`[${source.info.id}] upstream fetch failed:`, error);
          throw error;
        }
      }),
    ]),
  );

  app.use('/api/*', compress());
  app.use('/api/*', async (c, next) => {
    await next();
    // Live data must never be reused; handlers for anything else say so themselves.
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });
  // Route data is large and only changes when the data is rebuilt, so the
  // browser keeps it and just asks whether its copy is still current.
  app.use('/api/sources/:id/routes', etag());

  app.get('/api/sources', (c) => {
    const infos: SourceInfo[] = sources.map((source) => ({ ...source.info, hasRoutes: source.network !== undefined }));
    return c.json(infos);
  });

  app.get('/api/sources/:id/vehicles', async (c) => {
    const id = c.req.param('id');
    const load = loaders.get(id);
    if (!load) return c.json({ error: `Unknown source "${id}"` }, 404);

    try {
      const { value, fetchedAt, stale } = await load();
      const snapshot: VehicleSnapshot = { sourceId: id, fetchedAt, stale, vehicles: value };
      return c.json(snapshot);
    } catch {
      return c.json({ error: `Source "${id}" is unavailable` }, 502);
    }
  });

  app.get('/api/sources/:id/routes', (c) => {
    const id = c.req.param('id');
    const source = byId.get(id);
    if (!source) return c.json({ error: `Unknown source "${id}"` }, 404);
    if (!source.network) return c.json({ error: `Source "${id}" has no route data` }, 404);
    c.header('Cache-Control', 'no-cache');
    return c.json(source.network);
  });

  return app;
}
