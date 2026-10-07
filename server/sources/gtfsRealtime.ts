import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import type { Vehicle, VehicleMode } from '../../shared/types';

const { FeedMessage, VehiclePosition } = GtfsRealtimeBindings.transit_realtime;

const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = 'mini-toronto/0.1';

export interface GtfsRealtimeOptions {
  url: string;
  headers?: Record<string, string>;
  /** Classifies a vehicle; GTFS-realtime itself does not carry the mode. */
  modeOf?: (vehicle: Omit<Vehicle, 'mode'>) => VehicleMode;
}

// Decoded messages only have own properties for fields present on the wire;
// absent fields fall through to prototype defaults (0, ""), which would be
// indistinguishable from real values such as a bearing of 0.
function present<T extends object, K extends keyof T>(message: T, key: K): NonNullable<T[K]> | undefined {
  if (!Object.hasOwn(message, key)) return undefined;
  return message[key] ?? undefined;
}

function toNumber(value: number | { toNumber(): number } | undefined): number | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? value : value.toNumber();
}

// Feeds carry 32-bit floats, which widen to noisy 17-digit doubles. Six
// decimal places is about 10 cm, well beyond GPS accuracy.
function roundCoordinate(degrees: number): number {
  return Math.round(degrees * 1e6) / 1e6;
}

/** Decodes a GTFS-realtime VehiclePosition feed into the shared vehicle model. */
export function decodeVehiclePositions(
  body: Uint8Array,
  modeOf: NonNullable<GtfsRealtimeOptions['modeOf']> = () => 'other',
): Vehicle[] {
  const feed = FeedMessage.decode(body);
  const vehicles: Vehicle[] = [];

  for (const entity of feed.entity) {
    const report = entity.vehicle;
    const position = report?.position;
    if (!report || !position) continue;

    const partial: Omit<Vehicle, 'mode'> = {
      id: report.vehicle?.id || entity.id,
      lat: roundCoordinate(position.latitude),
      lon: roundCoordinate(position.longitude),
      bearing: present(position, 'bearing'),
      speed: present(position, 'speed'),
      routeId: (report.trip && present(report.trip, 'routeId')) || undefined,
      tripId: (report.trip && present(report.trip, 'tripId')) || undefined,
      timestamp: toNumber(present(report, 'timestamp')),
      occupancy: Object.hasOwn(report, 'occupancyStatus')
        ? VehiclePosition.OccupancyStatus[report.occupancyStatus as number]
        : undefined,
    };
    vehicles.push({ ...partial, mode: modeOf(partial) });
  }

  return vehicles;
}

export async function fetchVehiclePositions(options: GtfsRealtimeOptions): Promise<Vehicle[]> {
  const response = await fetch(options.url, {
    headers: { 'User-Agent': USER_AGENT, ...options.headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${options.url} responded ${response.status}`);
  }
  return decodeVehiclePositions(new Uint8Array(await response.arrayBuffer()), options.modeOf);
}
