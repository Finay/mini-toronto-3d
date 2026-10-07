import { ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { AttributionControl, Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Attribution, SourceInfo, Vehicle, VehicleMode } from '../shared/types';
import { getSources, getVehicles } from './api';
import './style.css';
import { VehicleTracker, type TrackedVehicle } from './vehicleTracker';

const TORONTO: [number, number] = [-79.3832, 43.6532];
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';

type Color = [number, number, number, number];

const MODE_COLORS: Record<VehicleMode, Color> = {
  streetcar: [255, 82, 70, 255],
  bus: [72, 176, 255, 255],
  subway: [255, 204, 41, 255],
  train: [96, 214, 130, 255],
  other: [200, 200, 200, 255],
};
const OUT_OF_SERVICE_COLOR: Color = [140, 140, 140, 150];

interface SourceState {
  info: SourceInfo;
  tracker: VehicleTracker;
  visible: boolean;
  statusElement: HTMLElement;
}

const states: SourceState[] = [];
let showOutOfService = false;
// Set whenever something other than animation changes what should be drawn.
let needsRedraw = true;

// MapLibre looks for its worker script next to its own module, which no
// longer exists once bundled, so point it at the copy Vite emits.
setWorkerUrl(maplibreWorkerUrl);

const map = new MapLibreMap({
  container: 'map',
  style: BASEMAP_STYLE,
  center: TORONTO,
  zoom: 11.5,
  attributionControl: false,
});
map.addControl(new NavigationControl(), 'top-right');

const overlay = new MapboxOverlay({
  interleaved: false,
  layers: [],
  getTooltip: ({ object }) => (object ? { text: describe((object as TrackedVehicle).vehicle) } : null),
});
map.addControl(overlay);

const inService = (vehicle: Vehicle) => vehicle.routeId !== undefined;

function describe(vehicle: Vehicle): string {
  const lines = [
    inService(vehicle) ? `Route ${vehicle.routeId} · ${vehicle.mode}` : `Out of service · ${vehicle.mode}`,
    `Vehicle ${vehicle.id}`,
  ];
  const details: string[] = [];
  if (vehicle.speed !== undefined) details.push(`${Math.round(vehicle.speed * 3.6)} km/h`);
  if (vehicle.occupancy) details.push(vehicle.occupancy.toLowerCase().replaceAll('_', ' '));
  if (details.length > 0) lines.push(details.join(' · '));
  return lines.join('\n');
}

function buildLayers(now: number) {
  return states
    .filter((state) => state.visible)
    .map((state) => {
      const tracked = state.tracker.positions(now);
      return new ScatterplotLayer<TrackedVehicle>({
        id: `vehicles-${state.info.id}`,
        data: showOutOfService ? tracked : tracked.filter((item) => inService(item.vehicle)),
        getPosition: (item) => item.position,
        getFillColor: (item) => (inService(item.vehicle) ? MODE_COLORS[item.vehicle.mode] : OUT_OF_SERVICE_COLOR),
        getRadius: 30,
        radiusUnits: 'meters',
        radiusMinPixels: 2.5,
        radiusMaxPixels: 12,
        pickable: true,
      });
    });
}

let wasAnimating = false;

function frame() {
  const now = performance.now();
  const animating = states.some((state) => state.visible && state.tracker.isAnimating(now));
  // One extra frame after animation ends so vehicles land exactly on target.
  if (needsRedraw || animating || wasAnimating) {
    overlay.setProps({ layers: buildLayers(now) });
    needsRedraw = false;
  }
  wasAnimating = animating;
  requestAnimationFrame(frame);
}

async function refresh(state: SourceState) {
  try {
    const snapshot = await getVehicles(state.info.id);
    state.tracker.update(snapshot.vehicles, performance.now());
    needsRedraw = true;

    const active = snapshot.vehicles.filter(inService).length;
    const time = new Date(snapshot.fetchedAt).toLocaleTimeString();
    state.statusElement.textContent =
      `${active.toLocaleString()} in service · ${snapshot.vehicles.length.toLocaleString()} total · ` +
      (snapshot.stale ? `feed unavailable, showing ${time}` : `updated ${time}`);
    state.statusElement.classList.toggle('warning', snapshot.stale);
  } catch (error) {
    console.error(`[${state.info.id}]`, error);
    state.statusElement.textContent = 'Could not load data; retrying';
    state.statusElement.classList.add('warning');
  }
}

async function poll(state: SourceState) {
  // Don't spend upstream requests on a tab nobody is looking at.
  if (!document.hidden) await refresh(state);
  setTimeout(() => void poll(state), state.info.pollIntervalMs);
}

function checkbox(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLLabelElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => {
    onChange(input.checked);
    needsRedraw = true;
  });
  const element = document.createElement('label');
  element.append(input, label);
  return element;
}

function legendItem(mode: VehicleMode): HTMLElement {
  const [r, g, b] = MODE_COLORS[mode];
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = `rgb(${r} ${g} ${b})`;
  const item = document.createElement('span');
  item.className = 'legend-item';
  item.append(swatch, mode);
  return item;
}

function buildPanel(panel: HTMLElement) {
  const title = document.createElement('h1');
  title.textContent = 'Mini Toronto';
  panel.append(title);

  for (const state of states) {
    const row = document.createElement('div');
    row.className = 'source';
    row.append(
      checkbox(state.info.name, state.visible, (checked) => (state.visible = checked)),
      state.statusElement,
    );
    panel.append(row);
  }

  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.append(legendItem('streetcar'), legendItem('bus'));
  panel.append(
    legend,
    checkbox('Show out-of-service vehicles', showOutOfService, (checked) => (showOutOfService = checked)),
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function attributionHtml({ text, url }: Attribution): string {
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>` : escapeHtml(text);
}

async function start() {
  const panel = document.getElementById('panel')!;
  let infos: SourceInfo[];
  try {
    infos = await getSources();
  } catch (error) {
    console.error(error);
    panel.textContent = 'Could not reach the Mini Toronto server.';
    return;
  }

  for (const info of infos) {
    const statusElement = document.createElement('div');
    statusElement.className = 'status';
    statusElement.textContent = 'Loading…';
    states.push({ info, tracker: new VehicleTracker(info.pollIntervalMs), visible: true, statusElement });
  }

  buildPanel(panel);
  map.addControl(
    new AttributionControl({
      compact: true,
      customAttribution: infos.map((info) => attributionHtml(info.attribution)),
    }),
  );

  for (const state of states) void poll(state);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) for (const state of states) void refresh(state);
  });
  requestAnimationFrame(frame);
}

void start();
