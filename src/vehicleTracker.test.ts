import { describe, expect, it } from 'vitest';
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
    expect(tracker.isAnimating(30_000)).toBe(false);
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
