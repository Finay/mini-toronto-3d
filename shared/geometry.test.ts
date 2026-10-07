import { describe, expect, it } from 'vitest';
import {
  bearingAt,
  buildPath,
  decodePolyline,
  distanceMetres,
  encodePolyline,
  pointAt,
  projectOnPath,
  resample,
  simplify,
  smooth,
  type Position,
} from './geometry';

// An L: about 807 m east along Queen St, then about 1113 m north.
const corner: Position[] = [
  [-79.4, 43.65],
  [-79.39, 43.65],
  [-79.39, 43.66],
];

describe('distanceMetres', () => {
  it('measures a hundredth of a degree of latitude as about 1.1 km', () => {
    expect(distanceMetres([-79.39, 43.65], [-79.39, 43.66])).toBeCloseTo(1113.2, 0);
  });
});

describe('path functions', () => {
  const path = buildPath(corner);

  it('accumulates length', () => {
    expect(path.cumulative[1]).toBeCloseTo(805.5, 0);
    expect(path.length).toBeCloseTo(805.5 + 1113.2, 0);
  });

  it('finds points along the path and clamps beyond its ends', () => {
    expect(pointAt(path, -5)).toEqual(corner[0]);
    expect(pointAt(path, path.length + 5)).toEqual(corner[2]);
    const [lon, lat] = pointAt(path, path.cumulative[1]! + 556.6);
    expect(lon).toBeCloseTo(-79.39, 6);
    expect(lat).toBeCloseTo(43.655, 4);
  });

  it('reports the direction of travel', () => {
    expect(bearingAt(path, 100)).toBeCloseTo(90, 5);
    expect(bearingAt(path, path.length - 100)).toBeCloseTo(0, 5);
  });

  it('projects a nearby point onto the path', () => {
    // 20 m or so north of the first leg, halfway along it.
    const projection = projectOnPath(path, [-79.395, 43.6502]);

    expect(projection.distance).toBeCloseTo(path.cumulative[1]! / 2, 0);
    expect(projection.offset).toBeCloseTo(22.3, 0);
  });

  it('projects a point past the end onto the last point', () => {
    expect(projectOnPath(path, [-79.39, 43.67]).distance).toBeCloseTo(path.length, 3);
  });
});

describe('simplify', () => {
  it('drops points that are nearly on the line and keeps real corners', () => {
    const wobbly: Position[] = [corner[0]!, [-79.395, 43.65001], corner[1]!, [-79.39001, 43.655], corner[2]!];

    expect(simplify(wobbly, 3)).toEqual(corner);
  });
});

describe('polyline encoding', () => {
  it('matches the reference example from the format specification', () => {
    const points: Position[] = [
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ];

    expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(points);
  });

  it('round-trips Toronto coordinates to five decimal places', () => {
    expect(decodePolyline(encodePolyline(corner))).toEqual(corner);
  });
});

describe('resample', () => {
  it('spaces points evenly and keeps both ends', () => {
    // About 805 m, which does not divide evenly by 100.
    const street = [corner[0]!, corner[1]!];
    const points = resample(street, 100);
    const gaps = points.slice(1).map((point, i) => distanceMetres(points[i]!, point));

    expect(points).toHaveLength(9);
    expect(points[0]).toEqual(street[0]);
    expect(points.at(-1)).toEqual(street[1]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.01);
    expect(gaps[0]).toBeCloseTo(100.7, 0);
  });
});

describe('smooth', () => {
  const sharpestTurn = (points: Position[]) =>
    Math.max(
      ...points.slice(1, -1).map((point, i) => {
        const before = bearingAt(buildPath([points[i]!, point]), 0);
        const after = bearingAt(buildPath([point, points[i + 2]!]), 0);
        return Math.abs(((after - before + 540) % 360) - 180);
      }),
    );

  it('turns a right-angle corner into a gradual curve', () => {
    const smoothed = smooth(corner, 15);

    expect(sharpestTurn(corner)).toBeCloseTo(90, 5);
    expect(sharpestTurn(smoothed)).toBeLessThan(20);
  });

  it('keeps both ends in place and stays close to the original line', () => {
    const smoothed = smooth(corner, 15);
    const original = buildPath(corner);

    expect(smoothed[0]).toEqual(corner[0]);
    expect(smoothed.at(-1)).toEqual(corner[2]);
    // Cuts the corner by under 10 m and leaves straight stretches alone.
    const offsets = smoothed.map((point) => projectOnPath(original, point).offset);
    expect(Math.max(...offsets)).toBeLessThan(10);
    expect(projectOnPath(original, smoothed[5]!).offset).toBeLessThan(0.01);
  });

  it('irons out a zigzag', () => {
    // Steps of 15 m east, alternating 3 m north and south of a street.
    const zigzag: Position[] = Array.from({ length: 30 }, (_, i) => [-79.4 + i * 0.000186, 43.65 + (i % 2) * 0.000027]);

    const smoothed = smooth(zigzag, 15);

    const lats = smoothed.slice(10, -10).map((point) => point[1]);
    expect((Math.max(...lats) - Math.min(...lats)) * 111_320).toBeLessThan(0.5);
  });

  it('leaves a two-point line alone', () => {
    expect(smooth([corner[0]!, corner[1]!], 15)).toEqual([corner[0], corner[1]]);
  });
});
