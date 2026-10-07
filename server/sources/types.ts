import type { SourceInfo, Vehicle } from '../../shared/types';

/** A provider of live vehicle positions, normalized to the shared model. */
export interface VehicleSource {
  info: SourceInfo;
  fetchVehicles(): Promise<Vehicle[]>;
}
