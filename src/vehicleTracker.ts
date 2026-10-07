import type { Vehicle } from '../shared/types';

/** [longitude, latitude] */
export type Position = [number, number];

export interface TrackedVehicle {
  vehicle: Vehicle;
  position: Position;
}

interface Track {
  vehicle: Vehicle;
  from: Position;
  to: Position;
  start: number;
  duration: number;
}

// A jump this large is a reassignment or GPS correction, not travel.
const SNAP_DISTANCE_M = 2_000;
const MIN_DURATION_MS = 5_000;
const MAX_DURATION_MS = 60_000;

const METRES_PER_DEGREE = 111_320;

function distanceMetres(a: Position, b: Position): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * Math.cos(meanLat) * METRES_PER_DEGREE;
  const dy = (b[1] - a[1]) * METRES_PER_DEGREE;
  return Math.hypot(dx, dy);
}

function positionAt(track: Track, now: number): Position {
  if (track.duration <= 0) return track.to;
  const t = Math.min(1, Math.max(0, (now - track.start) / track.duration));
  return [
    track.from[0] + (track.to[0] - track.from[0]) * t,
    track.from[1] + (track.to[1] - track.from[1]) * t,
  ];
}

/**
 * Turns periodic position snapshots into smooth motion. Each time a vehicle
 * reports a new position it glides there from wherever it is currently drawn,
 * taking as long as the gap between the two reports, so it is always moving
 * one report behind reality rather than jumping.
 */
export class VehicleTracker {
  private tracks = new Map<string, Track>();
  private animatingUntil = 0;

  /** @param defaultDurationMs glide time when reports carry no timestamps. */
  constructor(private readonly defaultDurationMs: number) {}

  /** Applies a fresh snapshot. `now` is any monotonic millisecond clock. */
  update(vehicles: Vehicle[], now: number): void {
    const next = new Map<string, Track>();

    for (const vehicle of vehicles) {
      const to: Position = [vehicle.lon, vehicle.lat];
      const previous = this.tracks.get(vehicle.id);

      if (!previous) {
        next.set(vehicle.id, { vehicle, from: to, to, start: now, duration: 0 });
        continue;
      }
      if (previous.to[0] === to[0] && previous.to[1] === to[1]) {
        // Same report as last time; let any glide in progress continue.
        next.set(vehicle.id, { ...previous, vehicle });
        continue;
      }

      const from = positionAt(previous, now);
      const duration =
        distanceMetres(from, to) > SNAP_DISTANCE_M ? 0 : this.durationBetween(previous.vehicle, vehicle);
      next.set(vehicle.id, { vehicle, from, to, start: now, duration });
      this.animatingUntil = Math.max(this.animatingUntil, now + duration);
    }

    this.tracks = next;
  }

  /** Where every vehicle should be drawn at `now`. */
  positions(now: number): TrackedVehicle[] {
    const result: TrackedVehicle[] = [];
    for (const track of this.tracks.values()) {
      result.push({ vehicle: track.vehicle, position: positionAt(track, now) });
    }
    return result;
  }

  isAnimating(now: number): boolean {
    return now < this.animatingUntil;
  }

  private durationBetween(older: Vehicle, newer: Vehicle): number {
    if (older.timestamp === undefined || newer.timestamp === undefined || newer.timestamp <= older.timestamp) {
      return this.defaultDurationMs;
    }
    const gapMs = (newer.timestamp - older.timestamp) * 1000;
    return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, gapMs));
  }
}
