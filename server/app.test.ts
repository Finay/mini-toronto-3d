import { describe, expect, it, vi } from 'vitest';
import type { Vehicle, VehicleSnapshot } from '../shared/types';
import { createApp } from './app';
import type { VehicleSource } from './sources/types';

const bus: Vehicle = { id: '1', lat: 43.65, lon: -79.38, mode: 'bus' };

function fakeSource(fetchVehicles: () => Promise<Vehicle[]>): VehicleSource {
  return {
    info: {
      id: 'fake',
      name: 'Fake',
      kind: 'vehicles',
      attribution: { text: 'Fake data' },
      pollIntervalMs: 15_000,
    },
    fetchVehicles,
  };
}

describe('API', () => {
  it('lists sources', async () => {
    const source = fakeSource(async () => [bus]);
    const response = await createApp([source]).request('/api/sources');

    expect(await response.json()).toEqual([source.info]);
  });

  it('serves a snapshot and reuses it within the cache window', async () => {
    const fetchVehicles = vi.fn(async () => [bus]);
    const app = createApp([fakeSource(fetchVehicles)]);

    const first = (await (await app.request('/api/sources/fake/vehicles')).json()) as VehicleSnapshot;
    await app.request('/api/sources/fake/vehicles');

    expect(first).toMatchObject({ sourceId: 'fake', stale: false, vehicles: [bus] });
    expect(fetchVehicles).toHaveBeenCalledTimes(1);
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
