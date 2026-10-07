import { describe, expect, it } from 'vitest';
import { buildPath } from '../shared/geometry';
import type { Vehicle } from '../shared/types';
import { VehicleTracker } from './vehicleTracker';

const at = (lon: number, lat: number, timestamp?: number): Vehicle => ({ id: 'a', lon, lat, timestamp, mode: 'bus' });

describe('VehicleTracker', () => {
  it('draws a new vehicle at its reported position', () => {
    const tracker = new VehicleTracker(10_000);
    tracker.update([at(-79.4, 43.65)], 0);

    expect(tracker.positions(0)[0]?.position).toEqual([-79.4, 43.65]);
    expect(tracker.isAnimating(0)).toBe(false);
  });

  it('glides to a new position over the gap between reports', () => {
    const tracker = new VehicleTracker(10_000);
    tracker.update([at(-79.4, 43.65, 1000)], 0);
    tracker.update([at(-79.398, 43.65, 1030)], 0);

    const [lon] = tracker.positions(15_000)[0]!.position;
    expect(lon).toBeCloseTo(-79.399, 6);
    expect(tracker.isAnimating(15_000)).toBe(true);
    expect(tracker.positions(30_000)[0]?.position).toEqual([-79.398, 43.65]);
    // Stays active a little past the end of the glide, for turns to finish.
    expect(tracker.isAnimating(32_001)).toBe(false);
  });

  it('uses the default duration when reports have no timestamps', () => {
    const tracker = new VehicleTracker(10_000);
    tracker.update([at(-79.4, 43.65)], 0);
    tracker.update([at(-79.398, 43.65)], 0);

    expect(tracker.positions(5_000)[0]!.position[0]).toBeCloseTo(-79.399, 6);
  });

  it('does not restart the glide when the same report arrives again', () => {
    const tracker = new VehicleTracker(10_000);
    tracker.update([at(-79.4, 43.65)], 0);
    tracker.update([at(-79.398, 43.65)], 0);
    tracker.update([at(-79.398, 43.65)], 5_000);

    expect(tracker.positions(10_000)[0]?.position).toEqual([-79.398, 43.65]);
  });

  it('snaps instead of gliding across an implausible jump', () => {
    const tracker = new VehicleTracker(10_000);
    tracker.update([at(-79.4, 43.65)], 0);
    tracker.update([at(-79.2, 43.75)], 0);

    expect(tracker.positions(1)[0]?.position).toEqual([-79.2, 43.75]);
  });

  it('drops vehicles missing from the latest snapshot', () => {
    const tracker = new VehicleTracker(10_000);
    tracker.update([at(-79.4, 43.65)], 0);
    tracker.update([], 1_000);

    expect(tracker.positions(1_000)).toEqual([]);
  });
});

describe('VehicleTracker on a path', () => {
  // East along a street for about 805 m, then north.
  const path = buildPath([
    [-79.4, 43.65],
    [-79.39, 43.65],
    [-79.39, 43.66],
  ]);
  const onPath = (defaultDurationMs = 10_000) => new VehicleTracker(defaultDurationMs, () => [path]);

  it('snaps a report near the path onto it', () => {
    const tracker = onPath();
    tracker.update([at(-79.395, 43.6501)], 0);

    const [lon, lat] = tracker.positions(0)[0]!.position;
    expect(lon).toBeCloseTo(-79.395, 6);
    expect(lat).toBeCloseTo(43.65, 6);
  });

  it('follows the path around a corner instead of cutting across it', () => {
    const tracker = onPath();
    tracker.update([at(-79.392, 43.65)], 0);
    tracker.update([at(-79.39, 43.6515)], 0);

    // Each leg of the trip to the new report is about 161 m and 167 m, so
    // halfway in time the vehicle is almost exactly at the corner.
    const [lon, lat] = tracker.positions(5_000)[0]!.position;
    expect(lon).toBeCloseTo(-79.39, 4);
    expect(lat).toBeCloseTo(43.65, 4);
  });

  it('leaves a report far from every path where it was reported', () => {
    const tracker = onPath();
    tracker.update([at(-79.395, 43.652)], 0);

    expect(tracker.positions(0)[0]?.position).toEqual([-79.395, 43.652]);
  });

  it('glides straight when the path between two reports would be a long detour', () => {
    // A hairpin: out 800 m and back along a parallel street 20 m away.
    const hairpin = buildPath([
      [-79.4, 43.65],
      [-79.39, 43.65],
      [-79.39, 43.6502],
      [-79.4, 43.6502],
    ]);
    const tracker = new VehicleTracker(10_000, () => [hairpin]);
    tracker.update([at(-79.399, 43.65)], 0);
    tracker.update([at(-79.399, 43.6502)], 0);

    // Along the path this is 1.6 km; the vehicle really moved 22 m.
    const [lon] = tracker.positions(5_000)[0]!.position;
    expect(lon).toBeCloseTo(-79.399, 5);
  });
});

describe('VehicleTracker bearing', () => {
  it('uses the reported bearing for a vehicle seen for the first time', () => {
    const tracker = new VehicleTracker(10_000);
    tracker.update([{ ...at(-79.4, 43.65), bearing: 73 }], 0);

    expect(tracker.positions(0)[0]?.bearing).toBe(73);
  });

  it('faces the direction of travel when gliding in a straight line', () => {
    const tracker = new VehicleTracker(10_000);
    tracker.update([{ ...at(-79.4, 43.65), bearing: 0 }], 0);
    tracker.update([{ ...at(-79.398, 43.65), bearing: 0 }], 0);

    expect(tracker.positions(5_000)[0]?.bearing).toBeCloseTo(90, 5);
  });

  it('turns with the path, and faces backwards along it when travelling against it', () => {
    const path = buildPath([
      [-79.4, 43.65],
      [-79.39, 43.65],
      [-79.39, 43.66],
    ]);
    const forwards = new VehicleTracker(10_000, () => [path]);
    forwards.update([at(-79.392, 43.65)], 0);
    forwards.update([at(-79.39, 43.6515)], 0);
    const backwards = new VehicleTracker(10_000, () => [path]);
    backwards.update([at(-79.39, 43.6515)], 0);
    backwards.update([at(-79.392, 43.65)], 0);

    expect(forwards.positions(1_000)[0]?.bearing).toBeCloseTo(90, 5);
    expect(forwards.positions(9_000)[0]?.bearing).toBeCloseTo(0, 5);
    expect(backwards.positions(1_000)[0]?.bearing).toBeCloseTo(180, 5);
    expect(backwards.positions(9_000)[0]?.bearing).toBeCloseTo(270, 5);
  });
});

describe('VehicleTracker path position', () => {
  it('reports how far along its path a vehicle is, for laying out train cars', () => {
    const path = buildPath([
      [-79.4, 43.65],
      [-79.39, 43.65],
    ]);
    const tracker = new VehicleTracker(10_000, () => [path]);
    tracker.update([at(-79.398, 43.65)], 0);
    tracker.update([at(-79.396, 43.65)], 0);

    const { along } = tracker.positions(5_000)[0]!;
    expect(along?.path).toBe(path);
    expect(along?.distance).toBeCloseTo(path.length * 0.3, 0);
  });

  it('reports no path for a vehicle that is not on one', () => {
    const tracker = new VehicleTracker(10_000);
    tracker.update([at(-79.398, 43.65)], 0);

    expect(tracker.positions(0)[0]?.along).toBeUndefined();
  });
});

describe('VehicleTracker turning', () => {
  it('eases to a new bearing instead of snapping to it', () => {
    const tracker = new VehicleTracker(10_000);
    tracker.update([{ ...at(-79.4, 43.65), bearing: 0 }], 0);
    expect(tracker.positions(0)[0]?.bearing).toBe(0);

    // Now heading east.
    tracker.update([{ ...at(-79.398, 43.65), bearing: 0 }], 0);
    const early = tracker.positions(100)[0]!.bearing;
    const later = tracker.positions(400)[0]!.bearing;

    expect(early).toBeGreaterThan(5);
    expect(early).toBeLessThan(45);
    expect(later).toBeGreaterThan(early);
    expect(tracker.positions(5_000)[0]?.bearing).toBeCloseTo(90, 3);
  });

  it('turns the short way round through north', () => {
    const tracker = new VehicleTracker(10_000);
    tracker.update([{ ...at(-79.4, 43.65), bearing: 350 }], 0);
    tracker.positions(0);
    // A small move north-north-east: a bearing of about 20 degrees.
    tracker.update([{ ...at(-79.39985, 43.6503), bearing: 350 }], 0);

    const bearing = tracker.positions(200)[0]!.bearing;
    expect(bearing > 350 || bearing < 20).toBe(true);
  });

  it('keeps animating briefly after a glide ends so the turn can finish', () => {
    const tracker = new VehicleTracker(10_000);
    tracker.update([at(-79.4, 43.65)], 0);
    tracker.update([at(-79.398, 43.65)], 0);

    expect(tracker.isAnimating(10_500)).toBe(true);
    expect(tracker.isAnimating(13_000)).toBe(false);
  });
});
