// Placing vehicles from a timetable. Shared because it runs in two places:
// on the server, and in the browser when the site is built to run without one.

import { bearingAt, buildPath, decodeShape, pointAt, type Path } from './geometry';
import type { RouteNetwork, Vehicle, VehicleMode } from './types';

/**
 * A GTFS timetable reduced to what is needed to place vehicles: produced by
 * `scripts/build-gtfs-data.ts`. Dates are yyyymmdd numbers and times are
 * seconds, both in `timezone`.
 */
export interface GtfsSchedule {
  timezone: string;
  feedVersion: string;
  startDate: number;
  endDate: number;
  services: ScheduleService[];
  patterns: SchedulePattern[];
  /** [pattern index, service index, seconds after midnight the trip starts] */
  trips: [number, number, number][];
}

export interface ScheduleService {
  id: string;
  /** Monday first. */
  days: boolean[];
  startDate: number;
  endDate: number;
  /** Dates the service also runs, and dates it does not, overriding `days`. */
  added: number[];
  removed: number[];
}

/** Trips that visit the same stops with the same timings share a pattern. */
export interface SchedulePattern {
  routeId: string;
  shapeId: string;
  headsign: string;
  /** [arrival, departure (seconds after trip start), fraction of the shape travelled] */
  stops: [number, number, number][];
}

const SECONDS_PER_DAY = 86_400;

function toDateNumber(utc: Date): number {
  return utc.getUTCFullYear() * 10_000 + (utc.getUTCMonth() + 1) * 100 + utc.getUTCDate();
}

function runsOn(service: ScheduleService, utcDay: Date): boolean {
  const date = toDateNumber(utcDay);
  if (service.removed.includes(date)) return false;
  if (service.added.includes(date)) return true;
  if (date < service.startDate || date > service.endDate) return false;
  return service.days[(utcDay.getUTCDay() + 6) % 7] === true;
}

/** How far along its shape (0 to 1) a trip is, `elapsed` seconds after it started. */
function fractionAt(stops: SchedulePattern['stops'], elapsed: number): number {
  let i = 0;
  while (i + 1 < stops.length && stops[i + 1]![0] <= elapsed) i++;
  const [, departure, fraction] = stops[i]!;
  const next = stops[i + 1];
  if (!next || elapsed <= departure) return fraction;
  const [nextArrival, , nextFraction] = next;
  const t = nextArrival > departure ? (elapsed - departure) / (nextArrival - departure) : 1;
  return fraction + (nextFraction - fraction) * t;
}

/** Estimates where every scheduled vehicle is at a given moment. */
export class ScheduleSimulator {
  private readonly paths = new Map<string, Path>();
  private readonly modes = new Map<string, VehicleMode>();
  private readonly clock: Intl.DateTimeFormat;

  constructor(
    private readonly schedule: GtfsSchedule,
    network: RouteNetwork,
  ) {
    for (const route of network.routes) this.modes.set(route.id, route.mode);
    for (const pattern of schedule.patterns) {
      const encoded = network.shapes[pattern.shapeId];
      if (encoded !== undefined && !this.paths.has(pattern.shapeId)) {
        this.paths.set(pattern.shapeId, buildPath(decodeShape(encoded)));
      }
    }
    this.clock = new Intl.DateTimeFormat('en-CA', {
      timeZone: schedule.timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  vehiclesAt(when: Date): Vehicle[] {
    const parts = Object.fromEntries(this.clock.formatToParts(when).map((part) => [part.type, Number(part.value)]));
    const seconds = parts.hour! * 3600 + parts.minute! * 60 + parts.second! + when.getMilliseconds() / 1000;
    const timestamp = Math.floor(when.getTime() / 1000);
    const vehicles: Vehicle[] = [];

    // GTFS times run past 24:00 for trips that began the previous evening, so
    // yesterday's timetable is checked too, a day further along.
    for (const daysAgo of [0, 1]) {
      const serviceDay = new Date(Date.UTC(parts.year!, parts.month! - 1, parts.day! - daysAgo));
      const running = this.schedule.services.map((service) => runsOn(service, serviceDay));
      const clockSeconds = seconds + daysAgo * SECONDS_PER_DAY;

      this.schedule.trips.forEach(([patternIndex, serviceIndex, start], tripIndex) => {
        if (!running[serviceIndex] || clockSeconds < start) return;
        const pattern = this.schedule.patterns[patternIndex]!;
        const elapsed = clockSeconds - start;
        if (elapsed > pattern.stops[pattern.stops.length - 1]![1]) return;
        const path = this.paths.get(pattern.shapeId);
        if (!path) return;

        const distance = fractionAt(pattern.stops, elapsed) * path.length;
        const [lon, lat] = pointAt(path, distance);
        vehicles.push({
          id: `${toDateNumber(serviceDay)}-${tripIndex}`,
          lat: Math.round(lat * 1e6) / 1e6,
          lon: Math.round(lon * 1e6) / 1e6,
          bearing: Math.round(bearingAt(path, distance)),
          routeId: pattern.routeId,
          shapeId: pattern.shapeId,
          headsign: pattern.headsign || undefined,
          mode: this.modes.get(pattern.routeId) ?? 'other',
          timestamp,
        });
      });
    }

    return vehicles;
  }
}
