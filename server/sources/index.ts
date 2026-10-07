import { ttc, ttcRapidTransit } from './ttc';
import type { VehicleSource } from './types';

// Every source listed here is served under /api/sources/:id and picked up by
// the client automatically. To add one, create a module that exports a
// VehicleSource and append it; see "Adding a data source" in CLAUDE.md.
// Sources that cannot run (missing data or API key) are undefined and skipped.
export const sources: VehicleSource[] = [ttc, ttcRapidTransit].filter((source) => source !== undefined);
