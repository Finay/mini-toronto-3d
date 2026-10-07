import type { Attribution, RouteNetwork, VehicleMode } from '../../shared/types';
import { readProcessed } from '../processedData';
import { fetchVehiclePositions, withShapes, type TripShapes } from './gtfsRealtime';
import { createScheduledSource, type GtfsSchedule } from './gtfsSchedule';
import type { VehicleSource } from './types';

const VEHICLES_URL = 'https://bustime.ttc.ca/gtfsrt/vehicles';

const OPEN_LICENCE: Attribution = {
  text: 'Contains information licensed under the Open Government Licence – Toronto',
  url: 'https://open.toronto.ca/open-data-licence/',
};

// Generated from the TTC's static GTFS by `npm run data`. Without them the
// live source still works, but has no route lines, and there is no timetable
// to place subway trains from.
const liveNetwork = readProcessed<RouteNetwork>('ttc/realtime-network.json');
const tripShapes = readProcessed<TripShapes>('ttc/trip-shapes.json');
const scheduledNetwork = readProcessed<RouteNetwork>('ttc/scheduled-network.json');
const schedule = readProcessed<GtfsSchedule>('ttc/schedule.json');

if (!liveNetwork || !tripShapes || !scheduledNetwork || !schedule) {
  console.warn('[ttc] Processed GTFS data not found; run `npm run data` for route lines and subway trains.');
}

// The feed has no mode field, and route numbers are unreliable for this
// because buses often substitute on streetcar routes. Fleet numbers are
// stable: streetcars are 4400-4699, everything else in the feed is a bus.
export function ttcModeOf(vehicle: { id: string }): VehicleMode {
  const fleetNumber = Number(vehicle.id);
  return fleetNumber >= 4400 && fleetNumber <= 4699 ? 'streetcar' : 'bus';
}

export const ttc: VehicleSource = {
  info: {
    id: 'ttc',
    name: 'Buses and streetcars',
    group: 'TTC',
    kind: 'vehicles',
    attributions: [{ text: 'Vehicle positions: TTC', url: 'https://www.ttc.ca/' }, ...(liveNetwork ? [OPEN_LICENCE] : [])],
    // The upstream feed regenerates about every 30 seconds.
    pollIntervalMs: 15_000,
    simulated: false,
  },
  network: liveNetwork,
  async fetchVehicles() {
    const vehicles = await fetchVehiclePositions({ url: VEHICLES_URL, modeOf: ttcModeOf });
    return tripShapes ? withShapes(vehicles, tripShapes) : vehicles;
  },
};

// Subway and light rail lines are absent from the live feed, so their trains
// are placed from the timetable instead.
export const ttcRapidTransit: VehicleSource | undefined =
  schedule && scheduledNetwork
    ? createScheduledSource(
        {
          id: 'ttc-rapid-transit',
          name: 'Subway and light rail',
          group: 'TTC',
          kind: 'vehicles',
          attributions: [OPEN_LICENCE],
          // Positions are computed, not fetched, so frequent updates are cheap.
          pollIntervalMs: 5_000,
        },
        schedule,
        scheduledNetwork,
      )
    : undefined;
