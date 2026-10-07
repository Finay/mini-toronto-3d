import { goTrains, upExpress } from './metrolinx';
import { trafficCameras } from './torontoCameras';
import { ttc, ttcRapidTransit } from './ttc';
import type { Source } from './types';

// Every source listed here is served under /api/sources/:id and picked up by
// the client automatically. To add one, create a module that exports a
// VehicleSource or CameraSource and append it; see "Adding a data source" in CLAUDE.md.
// Sources that cannot run (missing data or API key) are undefined and skipped.
export const sources: Source[] = [ttc, ttcRapidTransit, goTrains, upExpress, trafficCameras].filter((source) => source !== undefined);
