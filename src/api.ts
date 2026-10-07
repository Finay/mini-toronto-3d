import type { CameraSnapshot, RouteNetwork, SourceInfo, VehicleSnapshot } from '../shared/types';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return (await response.json()) as T;
}

export const getSources = () => getJson<SourceInfo[]>('/api/sources');

export const getVehicles = (sourceId: string) =>
  getJson<VehicleSnapshot>(`/api/sources/${encodeURIComponent(sourceId)}/vehicles`);

export const getRoutes = (sourceId: string) =>
  getJson<RouteNetwork>(`/api/sources/${encodeURIComponent(sourceId)}/routes`);

export const getCameras = (sourceId: string) =>
  getJson<CameraSnapshot>(`/api/sources/${encodeURIComponent(sourceId)}/cameras`);
