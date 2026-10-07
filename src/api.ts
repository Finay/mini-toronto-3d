import type { CameraSnapshot, RouteNetwork, SourceInfo, VehicleSnapshot } from '../shared/types';
import { createStaticApi } from './staticApi';

/** Where the map gets its data: the project's own server, or files when built without one. */
export interface DataApi {
  getSources(): Promise<SourceInfo[]>;
  getVehicles(sourceId: string): Promise<VehicleSnapshot>;
  getRoutes(sourceId: string): Promise<RouteNetwork>;
  getCameras(sourceId: string): Promise<CameraSnapshot>;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return (await response.json()) as T;
}

const source = (sourceId: string) => `/api/sources/${encodeURIComponent(sourceId)}`;

const serverApi: DataApi = {
  getSources: () => getJson('/api/sources'),
  getVehicles: (sourceId) => getJson(`${source(sourceId)}/vehicles`),
  getRoutes: (sourceId) => getJson(`${source(sourceId)}/routes`),
  getCameras: (sourceId) => getJson(`${source(sourceId)}/cameras`),
};

// Set by `vite build --mode static` (see .env.static).
const api =
  import.meta.env.VITE_STATIC === 'true'
    ? createStaticApi(`${import.meta.env.BASE_URL}static-data/`, getJson)
    : serverApi;

export const { getSources, getVehicles, getRoutes, getCameras } = api;
