import {
  bearingAt,
  bearingBetween,
  distanceMetres,
  pointAt,
  projectOnPath,
  type Path,
  type Position,
} from '../shared/geometry';
import type { Vehicle } from '../shared/types';

export interface TrackedVehicle {
  vehicle: Vehicle;
  position: Position;
  /** Which way the vehicle is facing, in degrees clockwise from north. */
  bearing: number;
  /** The path the vehicle is on and how far along it, when known. */
  along?: { path: Path; distance: number };
}

interface Track {
  vehicle: Vehicle;
  /** The raw position from the latest report, to recognize a repeated one. */
  reported: Position;
  from: Position;
  to: Position;
  start: number;
  duration: number;
  /** Facing direction when not on a path; on one, the path's direction is used. */
  heading: number;
  /** The bearing last handed out and when, which the next one eases on from. */
  shown?: { bearing: number; at: number };
  /** Set when the vehicle is on a known path: it then follows the path's curve. */
  along?: { path: Path; from: number; to: number };
}

// A jump this large is a reassignment or GPS correction, not travel.
const JUMP_DISTANCE_M = 2_000;
const MIN_DURATION_MS = 5_000;
const MAX_DURATION_MS = 60_000;
// A report farther than this from every candidate path is drawn where it was
// reported: the vehicle is on diversion or the trip match is wrong.
const MAX_PATH_OFFSET_M = 50;
// A glide along a path may be this much longer than the straight line between
// its ends. More means the two ends matched different passes of a path that
// doubles back on itself, and following it would send the vehicle on a detour.
const MAX_DETOUR_RATIO = 3;
const DETOUR_SLACK_M = 100;
// Below this, the direction between two reports is GPS noise, not a heading.
const MIN_HEADING_DISTANCE_M = 3;
// Vehicles ease toward a new bearing rather than snapping to it: each
// TURN_TIME_MS closes about 63% of the remaining angle.
const TURN_TIME_MS = 350;
// How long after a glide ends a turn may still be finishing.
const TURN_SETTLE_MS = 2_000;

function progress(track: Track, now: number): number {
  if (track.duration <= 0) return 1;
  return Math.min(1, Math.max(0, (now - track.start) / track.duration));
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function positionAt(track: Track, now: number): Position {
  const t = progress(track, now);
  if (track.along) return pointAt(track.along.path, lerp(track.along.from, track.along.to, t));
  return [lerp(track.from[0], track.to[0], t), lerp(track.from[1], track.to[1], t)];
}

function bearingOf(track: Track, now: number): number {
  if (!track.along) return track.heading;
  const { path, from, to } = track.along;
  const bearing = bearingAt(path, lerp(from, to, progress(track, now)));
  // Paths are stored in one direction; a vehicle moving against it faces the other way.
  // A stopped vehicle's reports jitter by a metre or so, which must not spin it around.
  return to < from - MIN_HEADING_DISTANCE_M ? (bearing + 180) % 360 : bearing;
}

/**
 * Turns periodic position snapshots into smooth motion. Each time a vehicle
 * reports a new position it glides there from wherever it is currently drawn,
 * taking as long as the gap between the two reports, so it is always moving
 * one report behind reality rather than jumping. Vehicles on a known path are
 * snapped to it and glide along its curve instead of cutting corners.
 */
export class VehicleTracker {
  private tracks = new Map<string, Track>();
  private animatingUntil = 0;

  /**
   * @param defaultDurationMs glide time when reports carry no timestamps.
   * @param pathsFor the paths a vehicle might be following, best guess first.
   */
  constructor(
    private readonly defaultDurationMs: number,
    private readonly pathsFor: (vehicle: Vehicle) => Path[] = () => [],
  ) {}

  /** Applies a fresh snapshot. `now` is any monotonic millisecond clock. */
  update(vehicles: Vehicle[], now: number): void {
    const next = new Map<string, Track>();

    for (const vehicle of vehicles) {
      const reported: Position = [vehicle.lon, vehicle.lat];
      const previous = this.tracks.get(vehicle.id);

      if (previous && previous.reported[0] === reported[0] && previous.reported[1] === reported[1]) {
        // Same report as last time; let any glide in progress continue.
        next.set(vehicle.id, { ...previous, vehicle });
        continue;
      }

      const snapped = this.snap(vehicle, reported);
      const to = snapped ? pointAt(snapped.path, snapped.distance) : reported;

      if (!previous) {
        const along = snapped && { path: snapped.path, from: snapped.distance, to: snapped.distance };
        const heading = vehicle.bearing ?? 0;
        next.set(vehicle.id, { vehicle, reported, from: to, to, start: now, duration: 0, heading, along });
        continue;
      }

      const from = positionAt(previous, now);
      const straight = distanceMetres(from, to);
      const duration = straight > JUMP_DISTANCE_M ? 0 : this.durationBetween(previous.vehicle, vehicle);
      const heading =
        straight > MIN_HEADING_DISTANCE_M ? bearingBetween(from, to) : (vehicle.bearing ?? bearingOf(previous, now));
      const track: Track = { vehicle, reported, from, to, start: now, duration, heading, shown: previous.shown };

      if (snapped) {
        const startDistance = duration > 0 ? this.distanceOnPath(previous, snapped.path, from, now) : snapped.distance;
        const detour = startDistance === undefined ? Infinity : Math.abs(snapped.distance - startDistance);
        if (startDistance !== undefined && detour <= straight * MAX_DETOUR_RATIO + DETOUR_SLACK_M) {
          track.along = { path: snapped.path, from: startDistance, to: snapped.distance };
        }
      }

      next.set(vehicle.id, track);
      this.animatingUntil = Math.max(this.animatingUntil, now + duration + TURN_SETTLE_MS);
    }

    this.tracks = next;
  }

  /** Where every vehicle should be drawn at `now`. Call with increasing times: bearings ease from one call to the next. */
  positions(now: number): TrackedVehicle[] {
    const result: TrackedVehicle[] = [];
    for (const track of this.tracks.values()) {
      const along = track.along && {
        path: track.along.path,
        distance: lerp(track.along.from, track.along.to, progress(track, now)),
      };
      result.push({ vehicle: track.vehicle, position: positionAt(track, now), bearing: this.easedBearing(track, now), along });
    }
    return result;
  }

  isAnimating(now: number): boolean {
    return now < this.animatingUntil;
  }

  /** The bearing to draw now: part of the way from the last one drawn to where the vehicle is heading. */
  private easedBearing(track: Track, now: number): number {
    const target = bearingOf(track, now);
    const { shown } = track;
    if (!shown) {
      track.shown = { bearing: target, at: now };
      return target;
    }
    // The shorter way round, from -180 to 180 degrees.
    const turn = ((target - shown.bearing + 540) % 360) - 180;
    const share = 1 - Math.exp(-Math.max(0, now - shown.at) / TURN_TIME_MS);
    const bearing = (shown.bearing + turn * share + 360) % 360;
    track.shown = { bearing, at: now };
    return bearing;
  }

  /** The candidate path closest to a reported position, if any is close enough. */
  private snap(vehicle: Vehicle, reported: Position): { path: Path; distance: number } | undefined {
    let best: { path: Path; distance: number; offset: number } | undefined;
    for (const path of this.pathsFor(vehicle)) {
      const projection = projectOnPath(path, reported);
      if (projection.offset <= MAX_PATH_OFFSET_M && (!best || projection.offset < best.offset)) {
        best = { path, ...projection };
      }
    }
    return best;
  }

  /** How far along `path` the vehicle is currently drawn, if it is on it. */
  private distanceOnPath(previous: Track, path: Path, drawn: Position, now: number): number | undefined {
    if (previous.along?.path === path) {
      return lerp(previous.along.from, previous.along.to, progress(previous, now));
    }
    const projection = projectOnPath(path, drawn);
    return projection.offset <= MAX_PATH_OFFSET_M ? projection.distance : undefined;
  }

  private durationBetween(older: Vehicle, newer: Vehicle): number {
    if (older.timestamp === undefined || newer.timestamp === undefined || newer.timestamp <= older.timestamp) {
      return this.defaultDurationMs;
    }
    const gapMs = (newer.timestamp - older.timestamp) * 1000;
    return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, gapMs));
  }
}
