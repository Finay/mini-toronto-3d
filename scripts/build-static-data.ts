// Writes the data files for the site built to run without its server, into
// the folder given as the first argument. Run by `npm run build:static`,
// after `npm run data` has prepared the timetables and routes.
//
// It asks the server's own sources what they are and saves what the server
// would have sent: each source's routes, the timetable for sources placed
// from one, and the list of cameras. `src/staticApi.ts` reads these back.

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sources } from '../server/sources';
import type { SourceInfo, StaticManifest } from '../shared/types';

// Live feeds cannot be read from a browser on another site, so each needs a
// proxy that can be (see worker/). A live source without one is left out.
const LIVE_FEEDS: Record<string, string | undefined> = {
  ttc: process.env.TTC_FEED_URL ?? 'https://mini-toronto-ttc.kian-benner.workers.dev/vehicles',
};

const outDir = process.argv[2];
if (!outDir) throw new Error('Usage: build-static-data.ts <output folder>');

function write(path: string, value: unknown) {
  const file = join(outDir!, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
  console.log(`[static] wrote ${path} (${(statSync(file).size / 1024).toFixed(0)} kB)`);
}

const manifest: StaticManifest = { builtAt: new Date().toISOString(), sources: [], live: {} };

for (const source of sources) {
  const { id } = source.info;
  const info: SourceInfo = { ...source.info, hasRoutes: 'network' in source && source.network !== undefined };

  if (source.info.kind === 'cameras') {
    try {
      const cameras = await (source as Extract<typeof source, { fetchCameras: unknown }>).fetchCameras();
      write(`${id}/cameras.json`, { sourceId: id, fetchedAt: Date.now(), stale: false, cameras });
    } catch (error) {
      console.warn(`[static] left out ${id}: its camera list could not be fetched`, error);
      continue;
    }
  } else if ('fetchVehicles' in source) {
    if (source.schedule) {
      write(`${id}/schedule.json`, source.schedule);
    } else if (LIVE_FEEDS[id]) {
      manifest.live[id] = LIVE_FEEDS[id];
    } else {
      console.warn(`[static] left out ${id}: it is live and has no proxy in LIVE_FEEDS`);
      continue;
    }
    if (source.network) write(`${id}/routes.json`, source.network);
  }
  manifest.sources.push(info);
}

write('manifest.json', manifest);
console.log(`[static] ${manifest.sources.length} sources: ${manifest.sources.map((source) => source.id).join(', ')}`);
// The server's sources keep timers and sockets alive; the work is done.
process.exit(0);
