// Geometry helpers shared by the data build script, the server (schedule
// simulation) and the client (moving vehicles along routes). Distances use a
// local flat-earth approximation, which is accurate to well under a metre
// over the few kilometres these functions are used for.

/** [longitude, latitude] */
export type Position = [number, number];

/** A polyline with the running distance to each point precomputed. */
export interface Path {
  points: Position[];
  /** Metres from the start of the path to each point. */
  cumulative: number[];
  /** Total length in metres. */
  length: number;
}

const METRES_PER_DEGREE = 111_320;
const RADIANS = Math.PI / 180;

export function distanceMetres(a: Position, b: Position): number {
  const meanLat = ((a[1] + b[1]) / 2) * RADIANS;
  const dx = (b[0] - a[0]) * Math.cos(meanLat) * METRES_PER_DEGREE;
  const dy = (b[1] - a[1]) * METRES_PER_DEGREE;
  return Math.hypot(dx, dy);
}

/** The position `eastMetres` east and `northMetres` north of `origin`. */
export function offsetPosition(origin: Position, eastMetres: number, northMetres: number): Position {
  return [
    origin[0] + eastMetres / (METRES_PER_DEGREE * Math.cos(origin[1] * RADIANS)),
    origin[1] + northMetres / METRES_PER_DEGREE,
  ];
}

export function buildPath(points: Position[]): Path {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1]! + distanceMetres(points[i - 1]!, points[i]!));
  }
  return { points, cumulative, length: cumulative[cumulative.length - 1] ?? 0 };
}

/** Index of the segment containing `distance`: the last point at or before it. */
function segmentAt(path: Path, distance: number): number {
  let low = 0;
  let high = path.points.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (path.cumulative[middle]! <= distance) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
}

/** The position `distance` metres along the path, clamped to its ends. */
export function pointAt(path: Path, distance: number): Position {
  const { points, cumulative } = path;
  if (points.length === 0) throw new Error('Cannot take a point on an empty path');
  if (points.length === 1 || distance <= 0) return points[0]!;
  if (distance >= path.length) return points[points.length - 1]!;

  const i = segmentAt(path, distance);
  const a = points[i]!;
  const b = points[i + 1]!;
  const span = cumulative[i + 1]! - cumulative[i]!;
  const t = span > 0 ? (distance - cumulative[i]!) / span : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Direction from `a` to `b`, in degrees clockwise from north. */
export function bearingBetween(a: Position, b: Position): number {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * RADIANS);
  const dy = b[1] - a[1];
  return (Math.atan2(dx, dy) / RADIANS + 360) % 360;
}

/** Direction of travel at `distance`, in degrees clockwise from north. */
export function bearingAt(path: Path, distance: number): number {
  const { points } = path;
  if (points.length < 2) return 0;
  const i = segmentAt(path, Math.min(Math.max(distance, 0), path.length));
  return bearingBetween(points[i]!, points[i + 1]!);
}

export interface Projection {
  /** Metres along the path of the closest point. */
  distance: number;
  /** Metres between the given point and the path. */
  offset: number;
}

/** Finds the closest point on the path to `point`. */
export function projectOnPath(path: Path, point: Position): Projection {
  const { points, cumulative } = path;
  if (points.length === 0) throw new Error('Cannot project onto an empty path');
  if (points.length === 1) return { distance: 0, offset: distanceMetres(points[0]!, point) };

  // Work in metres on a plane centred on the point being projected.
  const scaleX = Math.cos(point[1] * RADIANS) * METRES_PER_DEGREE;
  const scaleY = METRES_PER_DEGREE;
  let best: Projection = { distance: 0, offset: Infinity };

  let ax = (points[0]![0] - point[0]) * scaleX;
  let ay = (points[0]![1] - point[1]) * scaleY;
  for (let i = 0; i < points.length - 1; i++) {
    const bx = (points[i + 1]![0] - point[0]) * scaleX;
    const by = (points[i + 1]![1] - point[1]) * scaleY;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    const offset = Math.hypot(ax + dx * t, ay + dy * t);
    if (offset < best.offset) {
      best = { distance: cumulative[i]! + (cumulative[i + 1]! - cumulative[i]!) * t, offset };
    }
    ax = bx;
    ay = by;
  }
  return best;
}

/** Points evenly spaced about `spacingMetres` apart along a line, keeping both ends. */
export function resample(points: Position[], spacingMetres: number): Position[] {
  const path = buildPath(points);
  const steps = Math.max(1, Math.round(path.length / spacingMetres));
  return Array.from({ length: steps + 1 }, (_, i) => pointAt(path, (path.length * i) / steps));
}

/**
 * Rounds a line's corners and irons out its kinks, by replacing each point
 * with a Gaussian-weighted average of the line around it. `sigmaMetres` sets
 * how far along the line that average reaches: a right-angle corner is pulled
 * inwards by about half of it. Both ends stay where they are.
 */
export function smooth(points: Position[], sigmaMetres: number): Position[] {
  if (points.length < 3 || sigmaMetres <= 0) return points.slice();
  const samples = resample(points, Math.max(1, sigmaMetres / 3));
  const spacing = buildPath(samples).length / (samples.length - 1);
  const reach = Math.ceil((3 * sigmaMetres) / spacing);
  const weights = Array.from({ length: reach + 1 }, (_, k) => Math.exp(-((k * spacing) ** 2) / (2 * sigmaMetres ** 2)));

  return samples.map((sample, i) => {
    // A window that shrinks toward each end keeps the average centred there.
    const window = Math.min(reach, i, samples.length - 1 - i);
    let lon = sample[0];
    let lat = sample[1];
    let total = 1;
    for (let k = 1; k <= window; k++) {
      const weight = weights[k]!;
      lon += (samples[i - k]![0] + samples[i + k]![0]) * weight;
      lat += (samples[i - k]![1] + samples[i + k]![1]) * weight;
      total += 2 * weight;
    }
    return [lon / total, lat / total];
  });
}

/** Douglas-Peucker simplification: drops points within `toleranceMetres` of the line. */
export function simplify(points: Position[], toleranceMetres: number): Position[] {
  if (points.length <= 2) return points.slice();

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last - first < 2) continue;
    const chord = buildPath([points[first]!, points[last]!]);
    let farthest = -1;
    let farthestOffset = toleranceMetres;
    for (let i = first + 1; i < last; i++) {
      const { offset } = projectOnPath(chord, points[i]!);
      if (offset > farthestOffset) {
        farthest = i;
        farthestOffset = offset;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

// Google's encoded polyline format: roughly a fifth the size of JSON arrays.
// https://developers.google.com/maps/documentation/utilities/polylinealgorithm

function encodeSigned(value: number): string {
  let bits = value < 0 ? ~(value << 1) : value << 1;
  let text = '';
  while (bits >= 0x20) {
    text += String.fromCharCode((0x20 | (bits & 0x1f)) + 63);
    bits >>= 5;
  }
  return text + String.fromCharCode(bits + 63);
}

export function encodePolyline(points: Position[], precision = 5): string {
  const factor = 10 ** precision;
  let previousLat = 0;
  let previousLon = 0;
  let text = '';
  for (const [lon, lat] of points) {
    const scaledLat = Math.round(lat * factor);
    const scaledLon = Math.round(lon * factor);
    text += encodeSigned(scaledLat - previousLat) + encodeSigned(scaledLon - previousLon);
    previousLat = scaledLat;
    previousLon = scaledLon;
  }
  return text;
}

export function decodePolyline(text: string, precision = 5): Position[] {
  const factor = 10 ** precision;
  const points: Position[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const nextDelta = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = text.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < text.length) {
    lat += nextDelta();
    lon += nextDelta();
    points.push([lon / factor, lat / factor]);
  }
  return points;
}

// Route shapes are stored to six decimal places (about 10 cm). At the usual
// five, the metre-sized rounding steps show up as jagged lines when zoomed in.
const SHAPE_PRECISION = 6;

export const encodeShape = (points: Position[]) => encodePolyline(points, SHAPE_PRECISION);
export const decodeShape = (text: string) => decodePolyline(text, SHAPE_PRECISION);
