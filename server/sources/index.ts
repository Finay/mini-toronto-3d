import { ttc } from './ttc';
import type { VehicleSource } from './types';

// Every source listed here is served at /api/sources/:id/vehicles and picked
// up by the client automatically. To add one, create a module that exports a
// VehicleSource and append it; see "Adding a data source" in CLAUDE.md.
export const sources: VehicleSource[] = [ttc];
