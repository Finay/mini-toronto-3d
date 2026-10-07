import type { VehicleMode } from '../../shared/types';
import { fetchVehiclePositions } from './gtfsRealtime';
import type { VehicleSource } from './types';

const VEHICLES_URL = 'https://bustime.ttc.ca/gtfsrt/vehicles';

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
    name: 'TTC buses and streetcars',
    kind: 'vehicles',
    attribution: { text: 'Vehicle positions: TTC', url: 'https://www.ttc.ca/' },
    // The upstream feed regenerates about every 30 seconds.
    pollIntervalMs: 15_000,
  },
  fetchVehicles: () => fetchVehiclePositions({ url: VEHICLES_URL, modeOf: ttcModeOf }),
};
