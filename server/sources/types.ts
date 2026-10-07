import type { RouteNetwork, SourceInfo, Vehicle } from '../../shared/types';

/** A provider of vehicle positions, normalized to the shared model. */
export interface VehicleSource {
  /** `hasRoutes` is derived from `network` when the source is served. */
  info: Omit<SourceInfo, 'hasRoutes'>;
  fetchVehicles(): Promise<Vehicle[]>;
  /** Route lines and the paths vehicles follow, if the source has them. */
  network?: RouteNetwork;
}
