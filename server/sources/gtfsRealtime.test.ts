import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { describe, expect, it } from 'vitest';
import { decodeVehiclePositions } from './gtfsRealtime';
import { ttcModeOf } from './ttc';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;

function encodeFeed(entity: object[]): Uint8Array {
  return FeedMessage.encode(
    FeedMessage.fromObject({ header: { gtfsRealtimeVersion: '2.0', timestamp: 1791339351 }, entity }),
  ).finish();
}

describe('decodeVehiclePositions', () => {
  it('normalizes an in-service vehicle', () => {
    const body = encodeFeed([
      {
        id: '2',
        vehicle: {
          trip: { tripId: '123', routeId: '501' },
          position: { latitude: 43.647316, longitude: -79.40335, bearing: 339, speed: 4.5 },
          timestamp: 1791339331,
          vehicle: { id: '4521' },
          occupancyStatus: 'FEW_SEATS_AVAILABLE',
        },
      },
    ]);

    const [vehicle] = decodeVehiclePositions(body, ttcModeOf);

    expect(vehicle).toMatchObject({
      id: '4521',
      bearing: 339,
      speed: 4.5,
      routeId: '501',
      tripId: '123',
      mode: 'streetcar',
      timestamp: 1791339331,
      occupancy: 'FEW_SEATS_AVAILABLE',
    });
    expect(vehicle?.lat).toBeCloseTo(43.647316, 4);
    expect(vehicle?.lon).toBeCloseTo(-79.40335, 4);
  });

  it('leaves fields absent from the feed undefined instead of defaulting them', () => {
    const body = encodeFeed([
      { id: '1', vehicle: { position: { latitude: 43.7, longitude: -79.5 }, vehicle: { id: '3638' } } },
    ]);

    const [vehicle] = decodeVehiclePositions(body, ttcModeOf);

    expect(vehicle).toMatchObject({ id: '3638', mode: 'bus' });
    expect(vehicle?.routeId).toBeUndefined();
    expect(vehicle?.tripId).toBeUndefined();
    expect(vehicle?.bearing).toBeUndefined();
    expect(vehicle?.speed).toBeUndefined();
    expect(vehicle?.timestamp).toBeUndefined();
    expect(vehicle?.occupancy).toBeUndefined();
  });

  it('keeps a real zero bearing and speed', () => {
    const body = encodeFeed([
      { id: '1', vehicle: { position: { latitude: 43.7, longitude: -79.5, bearing: 0, speed: 0 }, vehicle: { id: '1' } } },
    ]);

    expect(decodeVehiclePositions(body)[0]).toMatchObject({ bearing: 0, speed: 0 });
  });

  it('skips entities without a position', () => {
    const body = encodeFeed([{ id: '1', vehicle: { vehicle: { id: '9' } } }, { id: '2', alert: {} }]);

    expect(decodeVehiclePositions(body)).toEqual([]);
  });
});
