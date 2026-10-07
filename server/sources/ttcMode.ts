import type { VehicleMode } from '../../shared/types';

// The feed has no mode field, and route numbers are unreliable for this
// because buses often substitute on streetcar routes. Fleet numbers are
// stable: streetcars are 4400-4699, everything else in the feed is a bus.
// Kept in a file of its own so that the Cloudflare Worker can use it without
// pulling in the rest of ttc.ts, which reads files from disk.
export function ttcModeOf(vehicle: { id: string }): VehicleMode {
  const fleetNumber = Number(vehicle.id);
  return fleetNumber >= 4400 && fleetNumber <= 4699 ? 'streetcar' : 'bus';
}
