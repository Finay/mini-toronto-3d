// Types shared by the server (which normalizes upstream feeds into them) and
// the client (which renders them). Every data source is reduced to these
// shapes so the client never needs to know about a specific agency's format.

export type VehicleMode = 'bus' | 'streetcar' | 'lrt' | 'subway' | 'train' | 'other';

export interface Vehicle {
  /** Unique within its source. */
  id: string;
  lat: number;
  lon: number;
  /** Degrees clockwise from north. */
  bearing?: number;
  /** Metres per second. */
  speed?: number;
  /** Absent when the vehicle is not assigned to a route (out of service). */
  routeId?: string;
  tripId?: string;
  /** Key into the source's `RouteNetwork.shapes`: the path this trip follows. */
  shapeId?: string;
  /** Destination shown to riders, e.g. "towards Kennedy Station". */
  headsign?: string;
  mode: VehicleMode;
  /** Epoch seconds at which the position was measured. */
  timestamp?: number;
  /** GTFS-realtime OccupancyStatus name, e.g. "FEW_SEATS_AVAILABLE". */
  occupancy?: string;
}

export interface Attribution {
  text: string;
  url?: string;
}

export interface SourceInfo {
  id: string;
  name: string;
  /** The agency or provider, used to group sources in the menu, e.g. "TTC". */
  group: string;
  /** What the source provides, which decides the endpoint its data is served from. */
  kind: 'vehicles' | 'cameras';
  /** Shown on the map; most data licences require them. */
  attributions: Attribution[];
  /** How often the client should ask for fresh data. */
  pollIntervalMs: number;
  /** True when positions are estimated from a timetable, not reported by vehicles. */
  simulated: boolean;
  /** True when `/api/sources/:id/routes` is available. */
  hasRoutes: boolean;
}

/**
 * What the site is told when it is built to run without its server: the
 * sources, and for live ones the address of a proxy to fetch them from.
 */
export interface StaticManifest {
  /** When the data files were written, as an ISO 8601 time. */
  builtAt: string;
  sources: SourceInfo[];
  /** Source id to the address of a `VehicleSnapshot`, for sources that are neither timetabled nor files. */
  live: Record<string, string>;
}

export interface VehicleSnapshot {
  sourceId: string;
  /** Epoch milliseconds at which the server fetched this from upstream. */
  fetchedAt: number;
  /** True when upstream failed and this is the last good response. */
  stale: boolean;
  vehicles: Vehicle[];
}

/** A fixed camera whose still image is replaced in place every few minutes. */
export interface Camera {
  /** Unique within its source. */
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** The road or kind of road it watches, e.g. "Gardiner" or "Arterial". */
  group: string;
  /** Always the latest image; loaded by the browser directly. */
  imageUrl: string;
}

export interface CameraSnapshot {
  sourceId: string;
  /** Epoch milliseconds at which the server fetched this from upstream. */
  fetchedAt: number;
  /** True when upstream failed and this is the last good response. */
  stale: boolean;
  cameras: Camera[];
}

export interface Route {
  id: string;
  shortName: string;
  longName: string;
  mode: VehicleMode;
  /** "#RRGGBB" as published by the agency. */
  color: string;
  /** Every path a trip on this route can follow. */
  shapeIds: string[];
  /** The few main paths, enough to draw the route without clutter. */
  displayShapeIds: string[];
}

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** The highest-capacity mode that serves the stop. */
  mode: VehicleMode;
  routeIds: string[];
}

export interface RouteNetwork {
  routes: Route[];
  stops: Stop[];
  /** Shape id to encoded polyline (see `decodeShape` in geometry.ts). */
  shapes: Record<string, string>;
  /**
   * Shape id to the stops a trip along it calls at, in order: each a stop id
   * and how far along the shape it is, from 0 to 1.
   */
  shapeStops: Record<string, [stopId: string, fraction: number][]>;
}
