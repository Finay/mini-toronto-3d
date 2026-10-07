// A Cloudflare Worker that makes the TTC's live vehicle feed usable from a
// static copy of this site. The feed sends no CORS header, so a browser on
// another origin cannot read it; this fetches it, decodes it into the same
// JSON the site's own server gives (a VehicleSnapshot), and adds the header.
//
// It serves one address, GET /vehicles. See README.md here for how to run
// and deploy it.

import { fetchVehiclePositions } from '../server/sources/gtfsRealtime';
import { ttcModeOf } from '../server/sources/ttcMode';
import type { VehicleSnapshot } from '../shared/types';

const FEED_URL = 'https://bustime.ttc.ca/gtfsrt/vehicles';
// The feed regenerates about every 30 seconds. Answers are reused for this
// long, so the TTC is asked at most four times a minute however many people
// are watching.
const CACHE_SECONDS = 15;

interface Env {
  /** The site allowed to read the response, e.g. "https://someone.github.io", or "*" for any. */
  ALLOWED_ORIGIN?: string;
}

// Kept between requests for as long as Cloudflare keeps this instance alive,
// which also lets an old answer stand in when the TTC cannot be reached.
let latest: VehicleSnapshot | undefined;

function reply(body: unknown, status: number, env: Env, cacheSeconds = 0): Response {
  return Response.json(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
    },
  });
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/vehicles') {
      return reply({ error: 'Not found; the only address here is GET /vehicles' }, 404, env);
    }

    // Cloudflare's own cache, shared by every instance in a data centre.
    const cacheKey = new Request(`${url.origin}/vehicles`);
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached;

    if (latest && Date.now() - latest.fetchedAt < CACHE_SECONDS * 1000) {
      return reply(latest, 200, env, CACHE_SECONDS);
    }

    try {
      const vehicles = await fetchVehiclePositions({ url: FEED_URL, modeOf: ttcModeOf });
      latest = { sourceId: 'ttc', fetchedAt: Date.now(), stale: false, vehicles };
    } catch (error) {
      console.warn('TTC feed could not be fetched:', error);
      if (!latest) return reply({ error: 'The TTC feed is unavailable' }, 502, env);
      // The site shows a warning for a stale snapshot instead of an empty map.
      return reply({ ...latest, stale: true }, 200, env);
    }

    const response = reply(latest, 200, env, CACHE_SECONDS);
    context.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  },
};
