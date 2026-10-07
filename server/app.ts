import { Hono } from 'hono';
import type { VehicleSnapshot } from '../shared/types';
import { cached } from './cache';
import type { VehicleSource } from './sources/types';

// Upstream is hit at most once per this fraction of a source's poll interval,
// however many browsers are connected.
const CACHE_TTL_FRACTION = 0.9;

export function createApp(sources: VehicleSource[]): Hono {
  const app = new Hono();

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

  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.get('/api/sources', (c) => c.json(sources.map((source) => source.info)));

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

  return app;
}
