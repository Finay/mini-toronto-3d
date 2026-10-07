import { describe, expect, it, vi } from 'vitest';
import type { RouteNetwork, Vehicle, VehicleSnapshot } from '../shared/types';
import { createApp } from './app';
import type { CameraSource, VehicleSource } from './sources/types';

const bus: Vehicle = { id: '1', lat: 43.65, lon: -79.38, mode: 'bus' };

function fakeSource(fetchVehicles: () => Promise<Vehicle[]>, network?: RouteNetwork): VehicleSource {
  return {
    info: {
      id: 'fake',
      name: 'Fake',
      group: 'Test',
      kind: 'vehicles',
      attributions: [{ text: 'Fake data' }],
      pollIntervalMs: 15_000,
      simulated: false,
    },
    fetchVehicles,
    network,
  };
}

describe('API', () => {
  it('lists sources', async () => {
    const source = fakeSource(async () => [bus]);
    const response = await createApp([source]).request('/api/sources');

    expect(await response.json()).toEqual([{ ...source.info, hasRoutes: false }]);
  });

  it('serves route data for sources that have it', async () => {
    const network: RouteNetwork = { routes: [], stops: [], shapes: { a: '_p~iF~ps|U' }, shapeStops: {} };
    const app = createApp([fakeSource(async () => [bus], network)]);

    const sources = (await (await app.request('/api/sources')).json()) as { hasRoutes: boolean }[];
    const routes = await app.request('/api/sources/fake/routes');

    expect(sources[0]?.hasRoutes).toBe(true);
    expect(await routes.json()).toEqual(network);
  });

  it('lets the browser reuse route data it already has', async () => {
    const network: RouteNetwork = { routes: [], stops: [], shapes: { a: '_p~iF~ps|U' }, shapeStops: {} };
    const app = createApp([fakeSource(async () => [bus], network)]);

    const first = await app.request('/api/sources/fake/routes');
    const tag = first.headers.get('ETag');
    const again = await app.request('/api/sources/fake/routes', { headers: { 'If-None-Match': tag ?? '' } });
    const vehicles = await app.request('/api/sources/fake/vehicles');

    expect(first.headers.get('Cache-Control')).toBe('no-cache');
    expect(tag).toBeTruthy();
    expect(again.status).toBe(304);
    expect(vehicles.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 404 for routes of a source without any', async () => {
    const response = await createApp([fakeSource(async () => [bus])]).request('/api/sources/fake/routes');

    expect(response.status).toBe(404);
  });

  it('serves a snapshot and reuses it within the cache window', async () => {
    const fetchVehicles = vi.fn(async () => [bus]);
    const app = createApp([fakeSource(fetchVehicles)]);

    const first = (await (await app.request('/api/sources/fake/vehicles')).json()) as VehicleSnapshot;
    await app.request('/api/sources/fake/vehicles');

    expect(first).toMatchObject({ sourceId: 'fake', stale: false, vehicles: [bus] });
    expect(fetchVehicles).toHaveBeenCalledTimes(1);
  });

  it('serves cameras from a camera source, and only from one', async () => {
    const camera = { id: '8001', name: 'York St', lat: 43.64, lon: -79.38, group: 'Arterial', imageUrl: 'https://example.test/8001.jpg' };
    const cameras: CameraSource = {
      info: { id: 'cams', name: 'Cameras', group: 'Test', kind: 'cameras', attributions: [], pollIntervalMs: 600_000, simulated: false },
      fetchCameras: async () => [camera],
    };
    const app = createApp([cameras, fakeSource(async () => [bus])]);

    expect(await (await app.request('/api/sources/cams/cameras')).json()).toMatchObject({ sourceId: 'cams', cameras: [camera] });
    expect((await app.request('/api/sources/cams/vehicles')).status).toBe(404);
    expect((await app.request('/api/sources/fake/cameras')).status).toBe(404);
  });

  it('returns 404 for an unknown source', async () => {
    const response = await createApp([]).request('/api/sources/nope/vehicles');

    expect(response.status).toBe(404);
  });

  it('returns 502 when upstream fails and nothing is cached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = createApp([fakeSource(async () => Promise.reject(new Error('down')))]);

    expect((await app.request('/api/sources/fake/vehicles')).status).toBe(502);
  });
});
