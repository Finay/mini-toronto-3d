// Types shared by the server (which normalizes upstream feeds into them) and
// the client (which renders them). Every data source is reduced to these
// shapes so the client never needs to know about a specific agency's format.

export type VehicleMode = 'bus' | 'streetcar' | 'subway' | 'train' | 'other';

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
  /** What the source provides. Add new kinds here as other data streams arrive. */
  kind: 'vehicles';
  /** Shown on the map; most data licences require it. */
  attribution: Attribution;
  /** How often the client should ask for fresh data. */
  pollIntervalMs: number;
}

export interface VehicleSnapshot {
  sourceId: string;
  /** Epoch milliseconds at which the server fetched this from upstream. */
  fetchedAt: number;
  /** True when upstream failed and this is the last good response. */
  stale: boolean;
  vehicles: Vehicle[];
}
