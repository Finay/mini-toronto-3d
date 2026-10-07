import { describe, expect, it, vi } from 'vitest';
import { encodeShape } from '../shared/geometry';
import type { GtfsSchedule } from '../shared/schedule';
import type { RouteNetwork, SourceInfo, StaticManifest } from '../shared/types';
import { createStaticApi } from './staticApi';

const info = (id: string, simulated: boolean): SourceInfo => ({
  id,
  name: id,
  group: 'Test',
  kind: 'vehicles',
  attributions: [],
  pollIntervalMs: 5_000,
  simulated,
  hasRoutes: true,
});

const network: RouteNetwork = {
  routes: [{ id: '1', shortName: '1', longName: 'Line', mode: 'subway', color: '#D5C82B', shapeIds: ['s'], displayShapeIds: ['s'] }],
  stops: [],
  shapeStops: {},
  shapes: { s: encodeShape([[-79.4, 43.65], [-79.4, 43.67]]) },
};

// One trip that is always under way: it starts at midnight and takes two days.
const schedule: GtfsSchedule = {
  timezone: 'America/Toronto',
  feedVersion: 'test',
  startDate: 20000101,
  endDate: 20991231,
  services: [{ id: 'daily', days: Array<boolean>(7).fill(true), startDate: 20000101, endDate: 20991231, added: [], removed: [] }],
  patterns: [{ routeId: '1', shapeId: 's', headsign: 'North', stops: [[0, 0, 0], [172_800, 172_800, 1]] }],
  trips: [[0, 0, 0]],
};

function setup(files: Record<string, unknown>) {
  const getJson = vi.fn(async (url: string) => {
    if (!(url in files)) throw new Error(`${url} responded 404`);
    return files[url];
  });
  return { api: createStaticApi('data/', getJson as <T>(url: string) => Promise<T>), getJson };
}

const manifest: StaticManifest = {
  builtAt: '2026-10-07T00:00:00Z',
  sources: [info('live', false), info('timetabled', true)],
  live: { live: 'https://proxy.test/vehicles' },
};

describe('static data layer', () => {
  it('lists the sources named in the manifest', async () => {
    const { api } = setup({ 'data/manifest.json': manifest });

    expect((await api.getSources()).map((source) => source.id)).toEqual(['live', 'timetabled']);
  });

  it('fetches live vehicles from the proxy the manifest names', async () => {
    const bus = { id: '1', lat: 43.65, lon: -79.38, mode: 'bus' };
    const { api } = setup({
      'data/manifest.json': manifest,
      'https://proxy.test/vehicles': { sourceId: 'ttc', fetchedAt: 5, stale: false, vehicles: [bus] },
    });

    expect(await api.getVehicles('live')).toEqual({ sourceId: 'live', fetchedAt: 5, stale: false, vehicles: [bus] });
  });

  it('places timetabled vehicles itself, loading the timetable and routes only once', async () => {
    const { api, getJson } = setup({
      'data/manifest.json': manifest,
      'data/timetabled/schedule.json': schedule,
      'data/timetabled/routes.json': network,
    });

    const first = await api.getVehicles('timetabled');
    await api.getVehicles('timetabled');
    await api.getRoutes('timetabled');

    expect(first.vehicles.length).toBeGreaterThanOrEqual(1);
    expect(first.vehicles[0]).toMatchObject({ routeId: '1', shapeId: 's', mode: 'subway' });
    expect(getJson.mock.calls.map(([url]) => url).sort()).toEqual([
      'data/manifest.json',
      'data/timetabled/routes.json',
      'data/timetabled/schedule.json',
    ]);
  });

  it('tries a failed load again next time', async () => {
    const files: Record<string, unknown> = { 'data/manifest.json': manifest };
    const { api } = setup(files);

    await expect(api.getRoutes('timetabled')).rejects.toThrow('404');
    files['data/timetabled/routes.json'] = network;
    await expect(api.getRoutes('timetabled')).resolves.toBe(network);
  });

  it('reads cameras from their file', async () => {
    const snapshot = { sourceId: 'cams', fetchedAt: 1, stale: false, cameras: [] };
    const { api } = setup({ 'data/manifest.json': manifest, 'data/cams/cameras.json': snapshot });

    expect(await api.getCameras('cams')).toBe(snapshot);
  });
});
