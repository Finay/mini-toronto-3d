// Turns an agency's static GTFS feed into the compact files the server reads
// from data/processed/. Run with `npm run data` (add `-- --refresh` to
// download the feed again). Re-run whenever the agency publishes a new feed:
// timetables expire, and real-time trip ids only match the current one.
//
// Per feed it writes:
//   realtime-network.json   routes, shapes and stops for vehicles reported live
//   trip-shapes.json        trip id -> shape, to put live vehicles on a path
//   scheduled-network.json  routes, shapes and stations for timetable-placed vehicles
//   schedule.json           the timetable for those routes

import { createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import StreamZip from 'node-stream-zip';
import type { TripShapes } from '../server/sources/gtfsRealtime';
import type { GtfsSchedule, SchedulePattern, ScheduleService } from '../server/sources/gtfsSchedule';
import {
  buildPath,
  distanceMetres,
  encodeShape,
  pointAt,
  projectOnPath,
  simplify,
  smooth,
  type Path,
  type Position,
} from '../shared/geometry';
import type { Route, RouteNetwork, Stop, VehicleMode } from '../shared/types';

interface FeedConfig {
  /** Output folder under data/processed/. */
  name: string;
  /** Where the feed zip is kept under data/raw/. */
  zipName: string;
  resolveDownloadUrl(): Promise<string>;
  modeOf(route: { id: string; type: string }): VehicleMode;
  /** Routes whose vehicles are placed from the timetable instead of reported live. */
  isScheduled(mode: VehicleMode): boolean;
}

const ttc: FeedConfig = {
  name: 'ttc',
  zipName: 'ttc-gtfs.zip',
  async resolveDownloadUrl() {
    const api =
      'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=merged-gtfs-ttc-routes-and-schedules';
    const response = await fetch(api);
    if (!response.ok) throw new Error(`${api} responded ${response.status}`);
    const body = (await response.json()) as { result: { resources: { format: string; url: string }[] } };
    const zip = body.result.resources.find((resource) => resource.format.toUpperCase() === 'ZIP');
    if (!zip) throw new Error('No ZIP resource in the TTC GTFS dataset');
    return zip.url;
  },
  modeOf({ id, type }) {
    if (type === '1') return 'subway';
    // Lines 5 and 6 are published as type 0 (tram) alongside the streetcars.
    if (id === '5' || id === '6') return 'lrt';
    if (type === '0') return 'streetcar';
    return type === '3' ? 'bus' : 'other';
  },
  // Neither appears in the TTC's real-time vehicle feed.
  isScheduled: (mode) => mode === 'subway' || mode === 'lrt',
};

const FEEDS = [ttc];

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
// Published shapes are chains of straight segments: sharp at street corners,
// and visibly polygonal on rail curves, where points are 40 m or more apart.
// Each shape is smoothed by this many metres (see `smooth`): little for
// street routes, whose corners should stay at their intersections, and more
// for rail, whose curves are broad.
const SMOOTHING_M: Record<VehicleMode, number> = {
  other: 15,
  bus: 15,
  streetcar: 15,
  lrt: 40,
  train: 50,
  subway: 50,
};
// Points closer than this to the smoothed line are dropped as redundant.
const SIMPLIFY_TOLERANCE_M = 0.25;
// A shape is drawn on the map if it carries at least this share of the trips
// of the busiest shape in the same direction; the rest are short turns and
// garage runs that would only add clutter. Branches too minor to qualify
// are then added back wherever they are the only line past some stop.
const DISPLAY_SHARE = 0.25;
// A stop served by several modes is listed under the last of these that applies.
// A station is only moved onto its line if the line passes this close to it.
const MAX_STATION_SNAP_M = 400;
// An on-street stop is only moved onto a line that passes this close to it.
// Lines are added to the map until every stop has one (see DISPLAY_SHARE).
const MAX_STOP_SNAP_M = 40;
const MODE_RANK: VehicleMode[] = ['other', 'bus', 'streetcar', 'lrt', 'train', 'subway'];

type Row = (column: string) => string;

function parseCsvLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (line[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      fields.push(field);
      field = '';
    } else field += char;
  }
  fields.push(field);
  return fields;
}

/** Streams a table out of the zip. Returns false if the feed has no such file. */
async function readTable(zip: StreamZip.StreamZipAsync, name: string, onRow: (row: Row) => void): Promise<boolean> {
  if (!(await zip.entry(name))) return false;
  const lines = createInterface({ input: await zip.stream(name), crlfDelay: Infinity });
  let columns: Map<string, number> | undefined;
  let fields: string[] = [];
  const row: Row = (column) => {
    const index = columns!.get(column);
    return index === undefined ? '' : (fields[index] ?? '').trim();
  };
  for await (const line of lines) {
    if (!columns) {
      const header = parseCsvLine(line.replace(/^﻿/, ''));
      columns = new Map(header.map((column, index) => [column.trim(), index]));
      continue;
    }
    if (line.length === 0) continue;
    fields = parseCsvLine(line);
    onRow(row);
  }
  return true;
}

function parseTime(text: string): number {
  const [hours, minutes, seconds] = text.split(':').map(Number);
  return hours! * 3600 + minutes! * 60 + (seconds ?? 0);
}

async function download(config: FeedConfig, zipPath: string): Promise<void> {
  const url = await config.resolveDownloadUrl();
  console.log(`[${config.name}] downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url} responded ${response.status}`);
  mkdirSync(dirname(zipPath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(zipPath));
}

interface Trip {
  routeId: string;
  serviceId: string;
  shapeId: string;
  headsign: string;
  direction: string;
}

interface Shape {
  /** In the feed's own units (metres for some shapes, kilometres for others). */
  feedLength: number;
  /** As published; `smoothed` is what is drawn and what vehicles follow. */
  full: Position[];
  smoothed: Position[];
}

async function build(config: FeedConfig, refresh: boolean): Promise<void> {
  const log = (message: string) => console.log(`[${config.name}] ${message}`);
  const zipPath = join(DATA_DIR, 'raw', config.zipName);
  if (refresh || !existsSync(zipPath)) await download(config, zipPath);

  const zip = new StreamZip.async({ file: zipPath });
  try {
    // Routes
    const modes = new Map<string, VehicleMode>();
    const routes = new Map<string, Route>();
    await readTable(zip, 'routes.txt', (row) => {
      const id = row('route_id');
      const mode = config.modeOf({ id, type: row('route_type') });
      modes.set(id, mode);
      routes.set(id, {
        id,
        shortName: row('route_short_name'),
        longName: row('route_long_name'),
        mode,
        color: `#${row('route_color') || '888888'}`,
        shapeIds: [],
        displayShapeIds: [],
      });
    });
    const scheduled = (routeId: string) => config.isScheduled(modes.get(routeId) ?? 'other');

    // Trips, and how many use each shape
    const trips = new Map<string, Trip>();
    const shapeUse = new Map<string, Map<string, { direction: string; count: number }>>();
    // One trip per shape, whose stops stand for the stops of every trip along it.
    const shapeTrips = new Map<string, string>();
    await readTable(zip, 'trips.txt', (row) => {
      const trip: Trip = {
        routeId: row('route_id'),
        serviceId: row('service_id'),
        shapeId: row('shape_id'),
        headsign: row('trip_headsign'),
        direction: row('direction_id'),
      };
      if (!trip.shapeId || !routes.has(trip.routeId)) return;
      trips.set(row('trip_id'), trip);
      if (!shapeTrips.has(trip.shapeId)) shapeTrips.set(trip.shapeId, row('trip_id'));
      const byShape = shapeUse.get(trip.routeId) ?? new Map<string, { direction: string; count: number }>();
      shapeUse.set(trip.routeId, byShape);
      const use = byShape.get(trip.shapeId) ?? { direction: trip.direction, count: 0 };
      byShape.set(trip.shapeId, use);
      use.count++;
    });
    log(`${routes.size} routes, ${trips.size} trips`);

    // Shapes
    const usedShapeIds = new Set([...trips.values()].map((trip) => trip.shapeId));
    const shapePoints = new Map<string, { sequence: number; position: Position; distance: number }[]>();
    await readTable(zip, 'shapes.txt', (row) => {
      const id = row('shape_id');
      if (!usedShapeIds.has(id)) return;
      const points = shapePoints.get(id) ?? [];
      shapePoints.set(id, points);
      points.push({
        sequence: Number(row('shape_pt_sequence')),
        position: [Number(row('shape_pt_lon')), Number(row('shape_pt_lat'))],
        distance: Number(row('shape_dist_traveled') || 0),
      });
    });
    const shapeModes = new Map<string, VehicleMode>();
    for (const trip of trips.values()) shapeModes.set(trip.shapeId, modes.get(trip.routeId) ?? 'other');
    const shapes = new Map<string, Shape>();
    for (const [id, points] of shapePoints) {
      if (points.length < 2) continue;
      points.sort((a, b) => a.sequence - b.sequence);
      const full = points.map((point) => point.position);
      shapes.set(id, {
        feedLength: points[points.length - 1]!.distance,
        full,
        smoothed: simplify(smooth(full, SMOOTHING_M[shapeModes.get(id) ?? 'other']), SIMPLIFY_TOLERANCE_M),
      });
    }
    log(`${shapes.size} shapes`);

    for (const [routeId, byShape] of shapeUse) {
      const route = routes.get(routeId)!;
      const busiest = new Map<string, number>();
      for (const { direction, count } of byShape.values()) {
        busiest.set(direction, Math.max(busiest.get(direction) ?? 0, count));
      }
      for (const [shapeId, { direction, count }] of byShape) {
        if (!shapes.has(shapeId)) continue;
        route.shapeIds.push(shapeId);
        if (count >= busiest.get(direction)! * DISPLAY_SHARE) route.displayShapeIds.push(shapeId);
      }
    }

    // Calendar
    const services = new Map<string, ScheduleService>();
    const service = (id: string) => {
      let entry = services.get(id);
      if (!entry) {
        entry = { id, days: Array<boolean>(7).fill(false), startDate: 0, endDate: 0, added: [], removed: [] };
        services.set(id, entry);
      }
      return entry;
    };
    const dayColumns = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    await readTable(zip, 'calendar.txt', (row) => {
      const entry = service(row('service_id'));
      entry.days = dayColumns.map((column) => row(column) === '1');
      entry.startDate = Number(row('start_date'));
      entry.endDate = Number(row('end_date'));
    });
    await readTable(zip, 'calendar_dates.txt', (row) => {
      const entry = service(row('service_id'));
      (row('exception_type') === '1' ? entry.added : entry.removed).push(Number(row('date')));
    });

    let timezone = 'UTC';
    await readTable(zip, 'agency.txt', (row) => {
      timezone = row('agency_timezone') || timezone;
    });
    let feedVersion = '';
    let feedStart = 0;
    let feedEnd = 0;
    await readTable(zip, 'feed_info.txt', (row) => {
      feedVersion = row('feed_version');
      feedStart = Number(row('feed_start_date'));
      feedEnd = Number(row('feed_end_date'));
    });

    const feedStops = new Map<string, { name: string; position: Position; parent: string }>();
    await readTable(zip, 'stops.txt', (row) => {
      feedStops.set(row('stop_id'), {
        name: row('stop_name'),
        position: [Number(row('stop_lon')), Number(row('stop_lat'))],
        parent: row('parent_station'),
      });
    });

    // Stop times: which routes serve each stop, and timings for scheduled routes
    log('reading stop times (this is the slow part)');
    interface StopTime {
      sequence: number;
      arrival: number;
      departure: number;
      stopId: string;
      distance: number | undefined;
    }
    const stopTimes = new Map<string, StopTime[]>();
    const stopRoutes = new Map<string, Set<string>>();
    const shapeCalls = new Map<string, { sequence: number; stopId: string; distance: number | undefined }[]>();
    await readTable(zip, 'stop_times.txt', (row) => {
      const tripId = row('trip_id');
      const trip = trips.get(tripId);
      if (!trip) return;
      const stopId = row('stop_id');
      let serving = stopRoutes.get(stopId);
      if (!serving) stopRoutes.set(stopId, (serving = new Set()));
      serving.add(trip.routeId);
      const shapeDistance = row('shape_dist_traveled');
      if (shapeTrips.get(trip.shapeId) === tripId) {
        const calls = shapeCalls.get(trip.shapeId) ?? [];
        shapeCalls.set(trip.shapeId, calls);
        calls.push({
          sequence: Number(row('stop_sequence')),
          stopId,
          distance: shapeDistance === '' ? undefined : Number(shapeDistance),
        });
      }
      if (!scheduled(trip.routeId)) return;
      const list = stopTimes.get(tripId) ?? [];
      stopTimes.set(tripId, list);
      const arrival = row('arrival_time') || row('departure_time');
      const departure = row('departure_time') || arrival;
      const distance = shapeDistance;
      list.push({
        sequence: Number(row('stop_sequence')),
        arrival: parseTime(arrival),
        departure: parseTime(departure),
        stopId,
        distance: distance === '' ? undefined : Number(distance),
      });
    });

    const serviceIndex = new Map<string, number>();
    const scheduleServices: ScheduleService[] = [];
    const patternIndex = new Map<string, number>();
    const patterns: SchedulePattern[] = [];
    const scheduleTrips: GtfsSchedule['trips'] = [];
    const fullPaths = new Map<string, ReturnType<typeof buildPath>>();

    for (const [tripId, list] of stopTimes) {
      const trip = trips.get(tripId)!;
      const shape = shapes.get(trip.shapeId);
      if (!shape || list.length < 2) continue;
      list.sort((a, b) => a.sequence - b.sequence);
      const start = list[0]!.arrival;

      let previousFraction = 0;
      const stops = list.map((stop, index): SchedulePattern['stops'][number] => {
        let fraction: number;
        if (stop.distance !== undefined && shape.feedLength > 0) {
          fraction = stop.distance / shape.feedLength;
        } else if (index === 0) {
          fraction = 0;
        } else {
          // No distance in the feed: find where the stop sits along the shape.
          const position = feedStops.get(stop.stopId)?.position;
          if (!position) throw new Error(`Stop ${stop.stopId} of trip ${tripId} has no position`);
          let path = fullPaths.get(trip.shapeId);
          if (!path) fullPaths.set(trip.shapeId, (path = buildPath(shape.full)));
          fraction = projectOnPath(path, position).distance / path.length;
        }
        // Rounding and feed quirks must never send a vehicle backwards.
        fraction = Math.min(1, Math.max(previousFraction, Math.round(fraction * 1e5) / 1e5));
        previousFraction = fraction;
        return [stop.arrival - start, stop.departure - start, fraction];
      });

      const key = [trip.routeId, trip.shapeId, trip.headsign, stops.flat().join(',')].join('|');
      let pattern = patternIndex.get(key);
      if (pattern === undefined) {
        pattern = patterns.length;
        patternIndex.set(key, pattern);
        patterns.push({ routeId: trip.routeId, shapeId: trip.shapeId, headsign: trip.headsign, stops });
      }
      let serviceAt = serviceIndex.get(trip.serviceId);
      if (serviceAt === undefined) {
        serviceAt = scheduleServices.length;
        serviceIndex.set(trip.serviceId, serviceAt);
        scheduleServices.push(service(trip.serviceId));
      }
      scheduleTrips.push([pattern, serviceAt, start]);
    }
    log(`${scheduleTrips.length} scheduled trips in ${patterns.length} patterns`);

    // Draw enough of each route that all its stops are on a drawn line: the
    // shape that reaches the most stranded stops is added, until none are left
    // or nothing helps.
    const shapePaths = new Map<string, Path>();
    const pathOf = (shapeId: string) => {
      let path = shapePaths.get(shapeId);
      if (!path) shapePaths.set(shapeId, (path = buildPath(shapes.get(shapeId)!.smoothed)));
      return path;
    };
    const reaches = (shapeId: string, position: Position) =>
      projectOnPath(pathOf(shapeId), position).offset <= MAX_STOP_SNAP_M;
    const routeStops = new Map<string, Position[]>();
    for (const [stopId, serving] of stopRoutes) {
      const position = feedStops.get(stopId)?.position;
      if (!position) continue;
      for (const routeId of serving) routeStops.set(routeId, [...(routeStops.get(routeId) ?? []), position]);
    }
    let addedShapes = 0;
    for (const route of routes.values()) {
      let stranded = (routeStops.get(route.id) ?? []).filter(
        (position) => !route.displayShapeIds.some((shapeId) => reaches(shapeId, position)),
      );
      while (stranded.length > 0) {
        let best: { shapeId: string; count: number } | undefined;
        for (const shapeId of route.shapeIds) {
          if (route.displayShapeIds.includes(shapeId)) continue;
          const count = stranded.filter((position) => reaches(shapeId, position)).length;
          if (count > (best?.count ?? 0)) best = { shapeId, count };
        }
        if (!best) break;
        const { shapeId } = best;
        route.displayShapeIds.push(shapeId);
        addedShapes++;
        stranded = stranded.filter((position) => !reaches(shapeId, position));
      }
    }
    log(`drew ${addedShapes} extra branch shapes so that every stop is on a line`);

    // Stops are published at the kerb or platform, beside the route. Their
    // markers are moved onto the drawn route lines: where several lines
    // serve one, by stepping between them until settling where they cross
    // (or, if they only run side by side, on the last line next to the other).
    const drawnPaths = new Map<string, Path[]>();
    const drawnPathsOf = (routeId: string) => {
      let paths = drawnPaths.get(routeId);
      if (!paths) {
        paths = routes.get(routeId)!.displayShapeIds.map((id) => buildPath(shapes.get(id)!.smoothed));
        drawnPaths.set(routeId, paths);
      }
      return paths;
    };
    const snapToLines = (position: Position, routeIds: string[], passes: number, maxMetres: number): Position => {
      let snapped = position;
      for (let pass = 0; pass < passes; pass++) {
        for (const routeId of routeIds) {
          let best: { path: Path; distance: number; offset: number } | undefined;
          for (const path of drawnPathsOf(routeId)) {
            const projection = projectOnPath(path, snapped);
            if (!best || projection.offset < best.offset) best = { path, ...projection };
          }
          if (best) snapped = pointAt(best.path, best.distance);
        }
      }
      return distanceMetres(position, snapped) <= maxMetres ? snapped : position;
    };

    // Stops
    const stopsFor = (selected: Route[], mergeStations: boolean): { stops: Stop[]; idOf: Map<string, string> } => {
      // The id each feed stop goes by in the output, where platforms share their station's.
      const idOf = new Map<string, string>();
      const selectedIds = new Set(selected.map((route) => route.id));
      const groups = new Map<string, { name: string; positions: Position[]; routeIds: Set<string> }>();
      for (const [stopId, serving] of stopRoutes) {
        const stop = feedStops.get(stopId);
        const routeIds = [...serving].filter((id) => selectedIds.has(id));
        if (!stop || routeIds.length === 0) continue;

        // A station's platforms are separate stops in the feed; show one marker.
        // Platforms with no station record are named "X Station - Y Platform"
        // and are matched up by that name and the lines they serve.
        const station = mergeStations ? feedStops.get(stop.parent) : undefined;
        const name = station?.name ?? (mergeStations ? stop.name.replace(/( Station)? - [^-]*Platform$/, '') : stop.name);
        const key = station ? stop.parent : mergeStations ? `${name}|${routeIds.sort().join(',')}` : stopId;
        idOf.set(stopId, key);
        let group = groups.get(key);
        if (!group) groups.set(key, (group = { name, positions: [], routeIds: new Set() }));
        group.positions.push(stop.position);
        for (const id of routeIds) group.routeIds.add(id);
      }

      const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
      const round = (degrees: number) => Math.round(degrees * 1e6) / 1e6;
      const stops = [...groups].map(([id, group]) => {
        const routeIds = [...group.routeIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const rank = Math.max(...routeIds.map((routeId) => MODE_RANK.indexOf(modes.get(routeId) ?? 'other')));
        const centre: Position = [
          mean(group.positions.map((position) => position[0])),
          mean(group.positions.map((position) => position[1])),
        ];
        const [lon, lat] = mergeStations
          ? snapToLines(centre, routeIds, 10, MAX_STATION_SNAP_M)
          : snapToLines(centre, routeIds, 2, MAX_STOP_SNAP_M);
        return {
          id,
          name: group.name,
          lon: round(lon),
          lat: round(lat),
          mode: MODE_RANK[rank] ?? 'other',
          routeIds,
        };
      });
      return { stops, idOf };
    };

    // Output
    const networkFor = (wanted: boolean): RouteNetwork => {
      const selected = [...routes.values()].filter((route) => route.shapeIds.length > 0 && scheduled(route.id) === wanted);
      const { stops, idOf } = stopsFor(selected, wanted);
      const network: RouteNetwork = { routes: selected, stops, shapes: {}, shapeStops: {} };
      for (const route of selected) {
        for (const shapeId of route.shapeIds) {
          const shape = shapes.get(shapeId)!;
          network.shapes[shapeId] = encodeShape(shape.smoothed);

          const calls = (shapeCalls.get(shapeId) ?? []).sort((a, b) => a.sequence - b.sequence);
          const along: [string, number][] = [];
          for (const [index, call] of calls.entries()) {
            const id = idOf.get(call.stopId);
            // Two platforms of one station in a row are a single stop here.
            if (id === undefined || along.at(-1)?.[0] === id) continue;
            let fraction: number;
            if (call.distance !== undefined && shape.feedLength > 0) fraction = call.distance / shape.feedLength;
            else if (index === 0) fraction = 0;
            else {
              const position = feedStops.get(call.stopId)!.position;
              const path = buildPath(shape.full);
              fraction = projectOnPath(path, position).distance / path.length;
            }
            along.push([id, Math.round(Math.min(1, Math.max(0, fraction)) * 1e4) / 1e4]);
          }
          network.shapeStops[shapeId] = along;
        }
      }
      return network;
    };

    const tripShapes: TripShapes = { shapeIds: [], trips: {} };
    const tripShapeIndex = new Map<string, number>();
    for (const [tripId, trip] of trips) {
      if (scheduled(trip.routeId) || !shapes.has(trip.shapeId)) continue;
      let index = tripShapeIndex.get(trip.shapeId);
      if (index === undefined) {
        index = tripShapes.shapeIds.length;
        tripShapeIndex.set(trip.shapeId, index);
        tripShapes.shapeIds.push(trip.shapeId);
      }
      tripShapes.trips[tripId] = index;
    }

    const schedule: GtfsSchedule = {
      timezone,
      feedVersion,
      startDate: feedStart,
      endDate: feedEnd,
      services: scheduleServices,
      patterns,
      trips: scheduleTrips,
    };

    const outDir = join(DATA_DIR, 'processed', config.name);
    mkdirSync(outDir, { recursive: true });
    const write = (name: string, value: unknown) => {
      const path = join(outDir, name);
      writeFileSync(path, JSON.stringify(value));
      log(`wrote ${name} (${(statSync(path).size / 1024).toFixed(0)} kB)`);
    };
    write('realtime-network.json', networkFor(false));
    write('trip-shapes.json', tripShapes);
    write('scheduled-network.json', networkFor(true));
    write('schedule.json', schedule);
    log(`feed ${feedVersion || '(no version)'} is valid ${feedStart} to ${feedEnd}`);
  } finally {
    await zip.close();
  }
}

const refresh = process.argv.includes('--refresh');
for (const feed of FEEDS) await build(feed, refresh);
