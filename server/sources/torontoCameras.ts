import type { Camera } from '../../shared/types';
import type { CameraSource } from './types';

// The City's own list, which it updates within two minutes of a camera being
// added, changed or removed. It is JSON wrapped in a callback (JSONP).
const LIST_URL = 'https://opendata.toronto.ca/transportation/tmc/rescucameraimages/Data/tmcearthcameras.json';
const IMAGE_BASE_URL = 'https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages';
const FETCH_TIMEOUT_MS = 10_000;

interface ListedCamera {
  Number: string;
  Name: string;
  Latitude: string;
  Longitude: string;
  Group?: string;
}

/** Reads the City's camera list, skipping any entry without a usable number or position. */
export function parseCameraList(text: string): Camera[] {
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start === -1 || end <= start) throw new Error('Camera list is not in the expected callback wrapper');
  const { Data: listed } = JSON.parse(text.slice(start + 1, end)) as { Data: ListedCamera[] };

  const cameras: Camera[] = [];
  for (const camera of listed) {
    const lat = Number(camera.Latitude);
    const lon = Number(camera.Longitude);
    // The number goes into the image address, so it must be nothing but digits.
    if (!/^\d+$/.test(camera.Number) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    cameras.push({
      id: camera.Number,
      name: camera.Name,
      lat,
      lon,
      group: camera.Group ?? '',
      imageUrl: `${IMAGE_BASE_URL}/loc${camera.Number}.jpg`,
    });
  }
  return cameras;
}

export const trafficCameras: CameraSource = {
  info: {
    id: 'toronto-cameras',
    name: 'City of Toronto cameras',
    group: 'Traffic cameras',
    kind: 'cameras',
    attributions: [
      {
        text: 'Contains information licensed under the Open Government Licence – Toronto',
        url: 'https://open.toronto.ca/open-data-licence/',
      },
    ],
    // Only the list of cameras comes through here, and it seldom changes;
    // browsers load the images themselves, straight from the City.
    pollIntervalMs: 10 * 60_000,
    simulated: false,
  },
  async fetchCameras() {
    const response = await fetch(LIST_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${LIST_URL} responded ${response.status}`);
    return parseCameraList(await response.text());
  },
};
