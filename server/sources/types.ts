import type { Camera, RouteNetwork, SourceInfo, Vehicle } from '../../shared/types';

/** What every source says about itself. `hasRoutes` is derived when the source is served. */
type Info<Kind extends SourceInfo['kind']> = Omit<SourceInfo, 'hasRoutes' | 'kind'> & { kind: Kind };

/** A provider of vehicle positions, normalized to the shared model. */
export interface VehicleSource {
  info: Info<'vehicles'>;
  fetchVehicles(): Promise<Vehicle[]>;
  /** Route lines and the paths vehicles follow, if the source has them. */
  network?: RouteNetwork;
}

/** A provider of fixed cameras, each with a still image that is refreshed in place. */
export interface CameraSource {
  info: Info<'cameras'>;
  fetchCameras(): Promise<Camera[]>;
}

export type Source = VehicleSource | CameraSource;
