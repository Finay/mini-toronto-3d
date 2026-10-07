import { ScheduleSimulator, type GtfsSchedule } from '../shared/schedule';
import type { CameraSnapshot, RouteNetwork, StaticManifest, VehicleSnapshot } from '../shared/types';
import type { DataApi } from './api';

/** Remembers a load so it happens once, but tries again after a failure. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () =>
    (pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    }));
}

/**
 * The data layer for the site built to run without its server (`npm run
 * build:static`). Everything the server would compute or pass on comes from
 * files written at build time by `scripts/build-static-data.ts`, except:
 *
 * - timetable-placed vehicles, which are worked out here in the browser from
 *   the published timetable, exactly as the server does it; and
 * - live vehicles, which come from a proxy named in the manifest (the feeds
 *   themselves cannot be read from a browser).
 */
export function createStaticApi(base: string, getJson: <T>(url: string) => Promise<T>): DataApi {
  const manifest = once(() => getJson<StaticManifest>(`${base}manifest.json`));
  const networks = new Map<string, () => Promise<RouteNetwork>>();
  const simulators = new Map<string, () => Promise<ScheduleSimulator>>();

  const getRoutes = (sourceId: string) => {
    let load = networks.get(sourceId);
    if (!load) networks.set(sourceId, (load = once(() => getJson<RouteNetwork>(`${base}${sourceId}/routes.json`))));
    return load();
  };

  const simulatorFor = (sourceId: string) => {
    let load = simulators.get(sourceId);
    if (!load) {
      load = once(async () => {
        const [schedule, network] = await Promise.all([
          getJson<GtfsSchedule>(`${base}${sourceId}/schedule.json`),
          getRoutes(sourceId),
        ]);
        return new ScheduleSimulator(schedule, network);
      });
      simulators.set(sourceId, load);
    }
    return load();
  };

  return {
    getSources: async () => (await manifest()).sources,
    getRoutes,
    async getVehicles(sourceId): Promise<VehicleSnapshot> {
      const liveUrl = (await manifest()).live[sourceId];
      if (liveUrl) return { ...(await getJson<VehicleSnapshot>(liveUrl)), sourceId };
      const simulator = await simulatorFor(sourceId);
      return { sourceId, fetchedAt: Date.now(), stale: false, vehicles: simulator.vehiclesAt(new Date()) };
    },
    getCameras: (sourceId) => getJson<CameraSnapshot>(`${base}${sourceId}/cameras.json`),
  };
}
