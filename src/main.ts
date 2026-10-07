import type { Layer, PickingInfo } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { CubeGeometry } from '@luma.gl/engine';
import { AttributionControl, Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import {
  bearingAt,
  buildPath,
  decodeShape,
  offsetPosition,
  pointAt,
  type Path,
  type Position,
} from '../shared/geometry';
import type { Attribution, Route, SourceInfo, Stop, Vehicle, VehicleMode } from '../shared/types';
import { getRoutes, getSources, getVehicles } from './api';
import { createMenu, TRACKING_MODES, type Menu, type TrackingMode } from './menu';
// The menu's display font, bundled so that nothing is fetched from a font service.
import '@fontsource/russo-one';
import './style.css';
import { loadThemeName, saveThemeName, THEMES, type Color, type ThemeName } from './themes';
import { VehicleTracker, type TrackedVehicle } from './vehicleTracker';

const TORONTO: [number, number] = [-79.3832, 43.6532];
// Toronto's street grid is rotated about 17 degrees from true north.
const GRID_BEARING = -17;
// Source name in the basemap style; its tiles follow the OpenMapTiles schema.
const BASEMAP_SOURCE = 'openmaptiles';
// The tiles only contain buildings at zoom 13 and 14, so nothing can be
// extruded when the map is zoomed out further than this.
const BUILDINGS_MIN_ZOOM = 13;
// In a tilted view MapLibre loads coarser tiles toward the horizon, and tiles
// coarser than zoom 13 have no buildings, so the skyline is cut off not far
// from the camera. These keep distant tiles within one zoom level of the
// nearest ones (the default allows about nine), and let three times as many
// tiles load as the default does to pay for it.
const MAX_ZOOM_LEVELS_ON_SCREEN = 2;
const TILE_COUNT_MAX_MIN_RATIO = 9;
const MODE_LABELS: Record<VehicleMode, string> = {
  streetcar: 'streetcar',
  bus: 'bus',
  lrt: 'light rail',
  subway: 'subway',
  train: 'train',
  other: 'vehicle',
};

// Rapid transit lines have their own well-known colours; buses and streetcars
// all share one agency colour, so those are coloured by mode instead.
const usesRouteColor = (mode: VehicleMode) => mode === 'subway' || mode === 'lrt' || mode === 'train';

// How each mode's route lines are drawn, and in what order (later on top).
const LINE_STYLES: Record<VehicleMode, { width: number; alpha: number; order: number }> = {
  other: { width: 1, alpha: 110, order: 0 },
  bus: { width: 2, alpha: 110, order: 1 },
  streetcar: { width: 2, alpha: 110, order: 2 },
  lrt: { width: 4, alpha: 255, order: 3 },
  train: { width: 4, alpha: 255, order: 4 },
  subway: { width: 5, alpha: 255, order: 5 },
};

// Vehicles are drawn as boxes, sized in metres. They are deliberately smaller
// than the real things (half as wide and tall, a quarter as long), because
// they are enlarged on screen and real proportions crowd the streets. Trains
// are a row of cars so that they bend with the track.
const VEHICLE_BOXES: Record<VehicleMode, { cars: number; length: number; width: number; height: number }> = {
  other: { cars: 1, length: 2.5, width: 1.25, height: 1.5 },
  bus: { cars: 1, length: 3, width: 1.3, height: 1.6 },
  streetcar: { cars: 1, length: 7.5, width: 1.3, height: 1.8 },
  lrt: { cars: 2, length: 5.5, width: 1.35, height: 1.85 },
  train: { cars: 4, length: 5, width: 1.5, height: 2.25 },
  subway: { cars: 4, length: 4.25, width: 1.55, height: 1.85 },
};
const CAR_GAP_M = 0.4;
// Boxes this small are specks on a city-wide map, so they are drawn this
// many times larger at ENLARGED_ZOOM and below, shrinking smoothly to the
// sizes above by TRUE_SIZE_ZOOM.
const ENLARGEMENT = 10;
const ENLARGED_ZOOM = 14;
const TRUE_SIZE_ZOOM = 17;
// Box edges are traced in a dark line so that boxes stand out from route
// lines of the same colour. The outline sits slightly outside the box so the
// box's own faces do not hide it.
const OUTLINE_COLOR: Color = [14, 17, 26, 255];
const OUTLINE_WIDTH_PX = 0.75;
const OUTLINE_MARGIN = 1.05;
// The hovered object's outline is redrawn in the highlight colour: a crisp
// line with a wide, faint one beneath it for a glow.
const HIGHLIGHT_WIDTH_PX = 2;
const GLOW_WIDTH_PX = 3.4;
const GLOW_ALPHA = 45;
// How strongly the stops ahead of a clicked vehicle are ringed, next to the ring on a hovered stop.
const UPCOMING_STOP_STRENGTH = 0.8;
// While lines are picked out in the menu (by search, or by pointing at a
// row), everything that is not on one of them keeps this share of its opacity.
const DIMMED_OPACITY = 0.4;
// A cube spanning -1 to 1 on each axis, so scaling it takes half-dimensions.
const BOX = new CubeGeometry();
const BOX_MATERIAL = { ambient: 0.55, diffuse: 0.6, shininess: 12 };

// Stops are hidden until the map is zoomed in far enough for them not to
// blanket it: there are about 9,000 bus stops but only about 100 stations.
// Sizes are in metres on the ground, clamped to a range of pixels.
const STOP_STYLES: Record<VehicleMode, { minZoom: number; radius: number; pixels: [min: number, max: number]; station: boolean }> = {
  other: { minZoom: 14.5, radius: 7, pixels: [1.5, 5], station: false },
  bus: { minZoom: 14.5, radius: 7, pixels: [1.5, 5], station: false },
  streetcar: { minZoom: 13, radius: 8, pixels: [2, 5], station: false },
  lrt: { minZoom: 11, radius: 40, pixels: [3, 9], station: true },
  train: { minZoom: 10, radius: 50, pixels: [3.5, 10], station: true },
  subway: { minZoom: 10, radius: 50, pixels: [3.5, 10], station: true },
};

/** One box to draw: a whole vehicle, or one car of a train. */
interface VehicleBox {
  vehicle: Vehicle;
  position: Position;
  bearing: number;
  /** Half-dimensions in metres, as [across, along, up]. */
  half: [number, number, number];
}

interface RouteLine {
  path: Position[];
  route: Route;
}

interface SourceState {
  info: SourceInfo;
  tracker: VehicleTracker;
  visible: boolean;
  showRouteLines: boolean;
  showStops: boolean;
  /** Routes switched off in the menu: their vehicles, lines and stops are not drawn. */
  hiddenRoutes: Set<string>;
  /** Routes picked out in the menu, by search or by pointing; everything else is faded. Unset when none are. */
  highlightedRoutes?: Set<string>;
  routes: Map<string, Route>;
  paths: Map<string, Path>;
  /** Candidate paths per route, for vehicles whose exact path is unknown. */
  routePaths: Map<string, Path[]>;
  lines: RouteLine[];
  /** Stops grouped by mode, as each mode appears at a different zoom. */
  stops: Map<VehicleMode, Stop[]>;
  /** `lines` and `stops` without those of hidden routes; see `applyRouteFilter`. */
  visibleLines: RouteLine[];
  visibleStops: Map<VehicleMode, Stop[]>;
  /** Where each vehicle was last drawn, so a popup can stay attached to it. */
  drawn: Map<string, Position>;
  /** Which way each vehicle was last drawn facing, for cameras that follow from behind or ahead. */
  drawnBearings: Map<string, number>;
  /** The stops along each shape, in order, with how far along it (0 to 1) each one is. */
  shapeStops: Map<string, { stop: Stop; fraction: number }[]>;
  /** Which shape each path is, to look up the stops along the path a vehicle is on. */
  shapeIds: Map<Path, string>;
}

/** What the pointer is over (or was clicked on), and the map position its popup is attached to. */
interface Hovered {
  kind: 'vehicles' | 'stops';
  state: SourceState;
  id: string;
  anchor: Position;
  /** Set when the object is a stop, for drawing its highlight. */
  stop?: Stop;
  /** The hovered vehicle's route, or the routes serving the hovered stop: picked out on the map. */
  routeIds: string[];
}

// Display choices with no control in the panel; change them here.
const showOutOfService = false;
const show3dVehicles = true;

const states: SourceState[] = [];
let themeName = loadThemeName();
let theme = THEMES[themeName];
document.documentElement.dataset.theme = themeName;
applyThemeVariables();
// Set whenever something other than animation changes what should be drawn.
let needsRedraw = true;
let hovered: Hovered | undefined;
// While paused, nothing is fetched and vehicles stay put. Their motion runs
// on a clock of its own that stops with the pause, so that on resuming they
// carry on from where they were rather than leaping ahead.
let paused = false;
let pausedAt = 0;
let pausedTotal = 0;
const vehicleClock = () => (paused ? pausedAt : performance.now()) - pausedTotal;
// True once the hovered object has been clicked, which keeps it selected when the pointer moves on.
let pinned = false;
// True while the camera is following the pinned vehicle.
let tracking = false;
let trackedAt = 0;
// False while the camera is still swinging over to the vehicle; once it has
// arrived it holds the vehicle exactly in place instead of trailing it.
let trackLocked = false;
// The left padding last given to the map for the menu; see `syncMenuPadding`.
let appliedPadding = 0;
let trackingMode = loadTrackingMode();
// Whether the user has a hand on the map: a button or finger down, or a recent turn of the wheel.
let pointerDown = false;
let wheelUntil = 0;
let menu: Menu | undefined;
// Changes whenever the picked-out routes do, to tell deck.gl that colours need recomputing.
let highlightVersion = 0;

// The popup is two elements: the outer one is pinned to the hovered object's
// position on screen every frame, and the inner one runs the grow and fade
// animation, so that following a moving vehicle is not itself animated.
// How near a click must land to count as on a vehicle or stop.
const CLICK_RADIUS_PX = 4;
// The camera closes about 63% of its distance to a tracked vehicle in this
// time, which makes both the first swing over to it and the following smooth.
const TRACK_TIME_MS = 220;
// How long after the last wheel movement a zoom is taken to be still going.
const WHEEL_SETTLE_MS = 400;
// How close, in pixels, the camera must get before it locks on.
const TRACK_LOCK_PX = 2;
// The tilt the camera settles at in every mode but Free, and how quickly it
// swings round to a new heading or tilt (the time to close about 63% of the gap).
const TRACKING_PITCH = 62;
const TRACK_TURN_TIME_MS = 700;
// One circuit of the helicopter view takes a minute and a half.
const HELICOPTER_DEGREES_PER_S = 4;
const TRACKING_STORAGE_KEY = 'mini-toronto-tracking';

function loadTrackingMode(): TrackingMode {
  try {
    const saved = localStorage.getItem(TRACKING_STORAGE_KEY);
    return TRACKING_MODES.find((mode) => mode.id === saved)?.id ?? 'free';
  } catch {
    // Storage can be unavailable (private windows, blocked site data).
    return 'free';
  }
}

function setTrackingMode(mode: TrackingMode) {
  trackingMode = mode;
  try {
    localStorage.setItem(TRACKING_STORAGE_KEY, mode);
  } catch {
    // The choice just won't be remembered.
  }
}
const POPUP_GAP_PX = 14;
const POPUP_EDGE_MARGIN_PX = 8;
const popupAnchor = document.createElement('div');
popupAnchor.className = 'popup-anchor';
const popup = document.createElement('div');
popup.className = 'popup';
popupAnchor.append(popup);
document.body.append(popupAnchor);

// MapLibre looks for its worker script next to its own module, which no
// longer exists once bundled, so point it at the copy Vite emits.
setWorkerUrl(maplibreWorkerUrl);

const map = new MapLibreMap({
  container: 'map',
  style: theme.basemap,
  center: TORONTO,
  // Close enough that the 3D buildings are visible from the start.
  zoom: 14,
  pitch: 50,
  bearing: GRID_BEARING,
  maxPitch: 75,
  attributionControl: false,
});
map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
// Fires for the first style and again after every theme change, each of
// which replaces the whole style and with it the layers added here.
map.on('style.load', () => {
  map.setSourceTileLodParams(MAX_ZOOM_LEVELS_ON_SCREEN, TILE_COUNT_MAX_MIN_RATIO, BASEMAP_SOURCE);
  colorNaturalFeatures();
  addBuildings();
});

const overlay = new MapboxOverlay({
  interleaved: false,
  layers: [],
  onHover: handleHover,
});
map.addControl(overlay);
map.on('click', (event) => handleClick(event.point));
// Dragging the map away from a tracked vehicle lets go of it; it stays selected.
map.on('dragstart', () => (tracking = false));
map.getCanvasContainer().addEventListener('pointerdown', () => (pointerDown = true));
for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, () => (pointerDown = false));
map.getCanvasContainer().addEventListener('wheel', () => (wheelUntil = performance.now() + WHEEL_SETTLE_MS), {
  passive: true,
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && pinned) hidePopup();
});
// Stops appear and disappear with zoom.
map.on('zoom', () => (needsRedraw = true));

/** Recolours water, parks, woods and grass, which the basemaps draw in near-background tones. */
function colorNaturalFeatures() {
  try {
    const paint = (layer: string, property: Parameters<MapLibreMap['setPaintProperty']>[1], value: string | number) => {
      if (map.getLayer(layer)) map.setPaintProperty(layer, property, value);
    };
    paint('water', 'fill-color', theme.water);
    paint('waterway', 'line-color', theme.water);
    paint('waterway', 'line-opacity', 1);
    // Water labels have different layer names in the two basemaps.
    for (const layer of ['water_name', 'water_name_point_label', 'water_name_line_label']) {
      paint(layer, 'text-color', theme.waterLabel.color);
      paint(layer, 'text-halo-color', theme.waterLabel.halo);
    }
    paint('park', 'fill-color', theme.park);
    paint('park', 'fill-opacity', theme.parkOpacity);
    paint('park_outline', 'line-color', theme.parkOutline);
    paint('landcover_wood', 'fill-color', theme.wood);

    // Neither basemap has a layer for grass, which covers lawns, fields and
    // the parts of parks that are not mapped as a park polygon.
    map.addLayer(
      {
        id: 'landcover_grass',
        type: 'fill',
        source: BASEMAP_SOURCE,
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'grass'],
        paint: { 'fill-color': theme.park, 'fill-opacity': theme.grassOpacity },
      },
      map.getLayer('park') ? 'park' : undefined,
    );
  } catch (error) {
    console.warn('Could not recolour water and green space:', error);
  }
}

/** Extrudes the basemap's building footprints to their real heights. */
function addBuildings() {
  try {
    const firstLabel = map.getStyle().layers.find((layer) => layer.type === 'symbol');
    map.addLayer(
      {
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source: BASEMAP_SOURCE,
        'source-layer': 'building',
        minzoom: BUILDINGS_MIN_ZOOM,
        paint: {
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'render_height'], 0],
            0,
            theme.buildings[0],
            250,
            theme.buildings[1],
          ],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 4],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.9,
        },
      },
      firstLabel?.id,
    );
  } catch (error) {
    // The map is still usable flat if the basemap's schema ever changes.
    console.warn('Could not add 3D buildings:', error);
  }
}

const inService = (vehicle: Vehicle) => vehicle.routeId !== undefined;

function hexToColor(hex: string, alpha: number): Color {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(value)) return [136, 136, 136, alpha];
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff, alpha];
}

function withAlpha([r, g, b]: Color, alpha: number): Color {
  return [r, g, b, alpha];
}

/** True when lines are picked out in the menu and none of these routes are among them. */
function isDimmed(state: SourceState, routeIds: (string | undefined)[]): boolean {
  // Pointing at a vehicle or stop picks out its routes, over anything picked out in the menu.
  if (hovered && hovered.routeIds.length > 0) {
    const picked = hovered.routeIds;
    return hovered.state !== state || !routeIds.some((id) => id !== undefined && picked.includes(id));
  }
  const matches = state.highlightedRoutes;
  return matches !== undefined && !routeIds.some((id) => id !== undefined && matches.has(id));
}

/** Redraws everything after a change in which routes are picked out. */
function refreshHighlight() {
  highlightVersion++;
  for (const state of states) applyRouteFilter(state);
}

function dimIf(dimmed: boolean, color: Color): Color {
  return dimmed ? withAlpha(color, color[3] * DIMMED_OPACITY) : color;
}

function colorOf(vehicle: Vehicle, state: SourceState): Color {
  const dimmed = isDimmed(state, [vehicle.routeId]);
  if (!inService(vehicle)) return dimIf(dimmed, theme.outOfService);
  const route = state.routes.get(vehicle.routeId!);
  const color = route && usesRouteColor(vehicle.mode) ? hexToColor(route.color, 255) : theme.modeColors[vehicle.mode];
  return dimIf(dimmed, color);
}

function describe(vehicle: Vehicle, state: SourceState): string {
  const mode = MODE_LABELS[vehicle.mode];
  if (!inService(vehicle)) return `Out of service · ${mode}\nVehicle ${vehicle.id}`;

  const route = state.routes.get(vehicle.routeId!);
  const lines = [`${route ? `${route.shortName} ${route.longName}` : `Route ${vehicle.routeId}`} · ${mode}`];
  if (vehicle.headsign) lines.push(vehicle.headsign);
  // Timetable-placed trains have no fleet number, only a made-up id.
  if (!state.info.simulated) lines.push(`Vehicle ${vehicle.id}`);
  return lines.join('\n');
}

function describeStop(stop: Stop, state: SourceState): string {
  const names = stop.routeIds.map((id) => {
    const route = state.routes.get(id);
    // Rapid transit lines are known by name, surface routes by number.
    return route && usesRouteColor(route.mode) ? `${route.shortName} ${route.longName}` : (route?.shortName ?? id);
  });
  const kind = STOP_STYLES[stop.mode].station ? 'station' : `${MODE_LABELS[stop.mode]} stop`;
  return `${stop.name}\n${kind[0]!.toUpperCase()}${kind.slice(1)} · ${names.join(', ')}`;
}

function handleHover(info: PickingInfo) {
  // A hand over anything that can be clicked.
  map.getCanvas().style.cursor = info.object ? 'pointer' : '';
  // While something is pinned, moving the pointer over other things changes nothing.
  if (!pinned) showFor(info);
}

/**
 * Clicking a vehicle or stop pins it: its popup, glow and picked-out routes
 * stay until something else is clicked, or anywhere off them.
 */
function handleClick(point: { x: number; y: number }) {
  const info = overlay.pickObject({ x: point.x, y: point.y, radius: CLICK_RADIUS_PX });
  pinned = false;
  if (info) showFor(info);
  else hidePopup();
  pinned = hovered !== undefined;
  // A clicked vehicle is also brought to the middle of the map and followed.
  tracking = pinned && hovered?.kind === 'vehicles';
  trackedAt = performance.now();
  trackLocked = false;
}

/** Shows the popup, glow and routes for whatever a pick found, or clears them if it found nothing. */
function showFor({ object, layer }: Pick<PickingInfo, 'object' | 'layer'>) {
  // Layer ids are "<kind>:<source id>" or "<kind>:<source id>:<mode>".
  const [kind, sourceId] = layer?.id.split(':') ?? [];
  const state = states.find((candidate) => candidate.info.id === sourceId);
  if (!object || !state || (kind !== 'vehicles' && kind !== 'stops')) {
    hidePopup();
    return;
  }

  let id: string;
  let anchor: Position;
  let text: string;
  let stop: Stop | undefined;
  let routeIds: string[];
  if (kind === 'stops') {
    stop = object as Stop;
    routeIds = stop.routeIds;
    id = stop.id;
    anchor = [stop.lon, stop.lat];
    text = describeStop(stop, state);
  } else {
    // Dots and boxes both carry the vehicle they stand for. A train's popup
    // is attached to the middle of the train, whichever car is hovered.
    const { vehicle, position } = object as { vehicle: Vehicle; position: Position };
    routeIds = vehicle.routeId === undefined ? [] : [vehicle.routeId];
    id = vehicle.id;
    anchor = state.drawn.get(id) ?? position;
    text = describe(vehicle, state);
  }

  const sameTarget = hovered?.kind === kind && hovered.state === state && hovered.id === id;
  const routeChanged =
    (hovered?.routeIds ?? []).join() !== routeIds.join() || (routeIds.length > 0 && hovered?.state !== state);
  hovered = { kind, state, id, anchor, stop, routeIds };
  if (routeChanged) refreshHighlight();
  if (sameTarget) {
    placePopup();
    return;
  }

  needsRedraw = true;
  const [title = '', ...details] = text.split('\n');
  const titleElement = document.createElement('div');
  titleElement.className = 'popup-title';
  titleElement.textContent = title;
  popup.replaceChildren(
    titleElement,
    ...details.map((line) => {
      const element = document.createElement('div');
      element.textContent = line;
      return element;
    }),
  );
  // Snap back to the collapsed state at the new object, then grow from there.
  popup.classList.add('instant');
  popup.classList.remove('visible');
  placePopup();
  void popup.offsetWidth;
  popup.classList.remove('instant');
  popup.classList.add('visible');
}

function hidePopup() {
  pinned = false;
  tracking = false;
  const pickedOut = hovered !== undefined && hovered.routeIds.length > 0;
  if (hovered) needsRedraw = true;
  hovered = undefined;
  if (pickedOut) refreshHighlight();
  // The popup stays where it was and shrinks back into the object.
  popup.classList.remove('visible');
}

/** Pins the popup above the hovered object, or below it when there is no room above. */
function placePopup() {
  if (!hovered) return;
  const point = map.project(hovered.anchor);
  const width = popup.offsetWidth;
  const top = point.y - POPUP_GAP_PX - popup.offsetHeight;
  const covered = menu?.occupied();
  const underMenu =
    covered !== undefined &&
    top < covered.bottom &&
    point.y - POPUP_GAP_PX > covered.top &&
    point.x - width / 2 < covered.right &&
    point.x + width / 2 > covered.left;
  const below = top < POPUP_EDGE_MARGIN_PX || underMenu;
  popupAnchor.classList.toggle('below', below);
  popupAnchor.style.transform = `translate(${point.x}px, ${point.y + (below ? POPUP_GAP_PX : -POPUP_GAP_PX)}px)`;
}

/** Keeps the popup on its object as vehicles and the map move. */
function followHovered() {
  if (!hovered) return;
  if (hovered.kind === 'vehicles') {
    const position = hovered.state.visible ? hovered.state.drawn.get(hovered.id) : undefined;
    if (!position) {
      hidePopup();
      return;
    }
    hovered.anchor = position;
  }
  trackCamera();
  placePopup();
}

const hoveredVehicleId = (state: SourceState) =>
  hovered?.kind === 'vehicles' && hovered.state === state ? hovered.id : undefined;

/** A glowing outline around the boxes of the hovered vehicle. */
function outlineHighlight(state: SourceState, boxes: VehicleBox[]): Layer[] {
  if (boxes.length === 0) return [];
  const [r, g, b] = theme.highlight;
  const line = (id: string, width: number, alpha: number) =>
    new PathLayer<VehicleBox>({
      id: `highlight-${id}:${state.info.id}`,
      data: boxes,
      getPath: outlineOf,
      getColor: [r, g, b, alpha],
      getWidth: width,
      widthUnits: 'pixels',
      billboard: true,
      capRounded: true,
      jointRounded: true,
    });
  return [line('glow', GLOW_WIDTH_PX, GLOW_ALPHA), line('line', HIGHLIGHT_WIDTH_PX, 255)];
}

/**
 * A glowing ring around round markers (stops, and vehicles drawn as dots):
 * at full `strength` for the one being pointed at, less for related ones.
 */
function ringHighlight(
  id: string,
  positions: Position[],
  marker: { radius: number; pixels: [min: number, max: number] },
  strength = 1,
): Layer[] {
  if (positions.length === 0) return [];
  const [r, g, b] = theme.highlight;
  const ring = (name: string, width: number, alpha: number) =>
    new ScatterplotLayer<Position>({
      id: `highlight-${name}:${id}`,
      data: positions,
      getPosition: (position) => position,
      // Just outside the marker's own edge.
      getRadius: marker.radius,
      radiusUnits: 'meters',
      radiusMinPixels: marker.pixels[0] + 2,
      radiusMaxPixels: marker.pixels[1] + 2,
      filled: false,
      stroked: true,
      getLineColor: [r, g, b, alpha * strength],
      getLineWidth: width,
      lineWidthUnits: 'pixels',
    });
  return [ring('glow', GLOW_WIDTH_PX, GLOW_ALPHA), ring('line', HIGHLIGHT_WIDTH_PX, 255)];
}

/** True while the user is working the map: moving it from code then would cancel their gesture. */
function userHasHandOnMap(now: number): boolean {
  return pointerDown || now < wheelUntil || map.isMoving();
}

/** The map's padding for the part of the screen the menu covers. */
function menuPadding() {
  return { left: Math.round(menu?.coveredWidth() ?? 0), top: 0, right: 0, bottom: 0 };
}

/**
 * Tells the map how much of the screen the menu covers, so that its centre,
 * and the point its perspective converges on, is the middle of what is left.
 * Without this a tracked vehicle would sit off the camera's line of sight
 * whenever the menu is open. What is on screen is held where it is.
 */
function syncMenuPadding() {
  const padding = menuPadding();
  if (padding.left === appliedPadding || (tracking && hovered) || userHasHandOnMap(performance.now())) return;
  const { clientWidth, clientHeight } = map.getContainer();
  // The spot that will be the new centre keeps the ground it is showing now.
  const center = map.unproject([(padding.left + clientWidth) / 2, clientHeight / 2]);
  map.jumpTo({ center, padding });
  appliedPadding = padding.left;
}

/**
 * Keeps the tracked vehicle in the middle of the part of the screen the menu
 * does not cover, and in every mode but Free also turns and tilts the camera:
 * behind the vehicle, ahead of it, or circling it.
 */
function trackCamera() {
  const now = performance.now();
  const elapsed = now - trackedAt;
  trackedAt = now;
  // Stands back while the user has a hand on the map. Zooming, tilting and
  // turning are caught up with afterwards; dragging lets go of the vehicle
  // altogether.
  const userBusy = userHasHandOnMap(now);
  if (userBusy) trackLocked = false;
  if (!tracking || !hovered || userBusy) return;

  const padding = menuPadding();
  const { clientWidth, clientHeight } = map.getContainer();
  const vehicle = map.project(hovered.anchor);
  const off = Math.hypot(vehicle.x - (padding.left + clientWidth) / 2, vehicle.y - clientHeight / 2);
  if (off <= TRACK_LOCK_PX) trackLocked = true;

  // Eases over to the vehicle at first; once there, holds it exactly.
  const share = trackLocked ? 1 : 1 - Math.exp(-elapsed / TRACK_TIME_MS);
  const from = map.getCenter();
  const center: Position = [
    from.lng + (hovered.anchor[0] - from.lng) * share,
    from.lat + (hovered.anchor[1] - from.lat) * share,
  ];

  let bearing = map.getBearing();
  let pitch = map.getPitch();
  if (trackingMode !== 'free') {
    const turnShare = 1 - Math.exp(-elapsed / TRACK_TURN_TIME_MS);
    if (trackingMode === 'helicopter') {
      // Circling is motion too, so it stops with everything else when paused.
      if (!paused) bearing += (HELICOPTER_DEGREES_PER_S * elapsed) / 1000;
    } else {
      // Looking along the vehicle's heading puts the camera behind it.
      const heading = hovered.state.drawnBearings.get(hovered.id) ?? bearing;
      const wanted = trackingMode === 'top-back' ? heading : heading + 180;
      bearing += (((wanted - bearing + 540) % 360) - 180) * turnShare;
    }
    pitch += (TRACKING_PITCH - pitch) * turnShare;
  }

  const still =
    off < 0.05 &&
    padding.left === appliedPadding &&
    Math.abs(bearing - map.getBearing()) < 0.01 &&
    Math.abs(pitch - map.getPitch()) < 0.01;
  if (still) return;
  // One move for everything, so that the turn pivots on the vehicle.
  map.jumpTo({ center, bearing, pitch, padding });
  appliedPadding = padding.left;
}

/**
 * Rings, a little fainter than the hover ring, around the stops a clicked
 * vehicle has still to call at: those further along its path than it is.
 */
function upcomingStopHighlight(state: SourceState, { vehicle, along }: TrackedVehicle): Layer[] {
  const shapeId = along && state.shapeIds.get(along.path);
  const calls = shapeId === undefined ? undefined : state.shapeStops.get(shapeId);
  if (!along || !calls) return [];

  const progress = along.path.length > 0 ? along.distance / along.path.length : 0;
  const ahead = calls.filter(({ stop, fraction }) => fraction > progress && !stop.routeIds.every((id) => state.hiddenRoutes.has(id)));
  // Each kind of stop is drawn at its own size, so each gets its own ring layer.
  const byMode = new Map<VehicleMode, Position[]>();
  for (const { stop } of ahead) byMode.set(stop.mode, [...(byMode.get(stop.mode) ?? []), [stop.lon, stop.lat]]);
  return [...byMode].flatMap(([mode, positions]) =>
    ringHighlight(`upcoming:${state.info.id}:${vehicle.id}:${mode}`, positions, STOP_STYLES[mode], UPCOMING_STOP_STRENGTH),
  );
}

/** How many times real size boxes are drawn at a zoom level. */
function enlargement(zoom: number): number {
  const t = Math.min(1, Math.max(0, (TRUE_SIZE_ZOOM - zoom) / (TRUE_SIZE_ZOOM - ENLARGED_ZOOM)));
  return ENLARGEMENT ** t;
}

/** The boxes that make up a vehicle: one, or one per car laid out along its path. */
function boxesFor(item: TrackedVehicle, scale: number): VehicleBox[] {
  const { vehicle } = item;
  const shape = VEHICLE_BOXES[vehicle.mode];
  const half: [number, number, number] = [
    (shape.width * scale) / 2,
    (shape.length * scale) / 2,
    (shape.height * scale) / 2,
  ];
  if (shape.cars === 1) return [{ vehicle, position: item.position, bearing: item.bearing, half }];

  const spacing = (shape.length + CAR_GAP_M) * scale;
  const radians = (item.bearing * Math.PI) / 180;
  return Array.from({ length: shape.cars }, (_, index) => {
    // Metres ahead of (or behind) the middle of the train.
    const ahead = (index - (shape.cars - 1) / 2) * spacing;
    if (item.along) {
      const { path, distance } = item.along;
      const at = Math.min(path.length, Math.max(0, distance + ahead));
      return { vehicle, position: pointAt(path, at), bearing: bearingAt(path, at), half };
    }
    const position = offsetPosition(item.position, Math.sin(radians) * ahead, Math.cos(radians) * ahead);
    return { vehicle, position, bearing: item.bearing, half };
  });
}

/** A single line that runs along all twelve edges of a box. */
function outlineOf({ position, bearing, half }: VehicleBox): [number, number, number][] {
  const radians = (bearing * Math.PI) / 180;
  const across = half[0] * OUTLINE_MARGIN;
  const along = half[1] * OUTLINE_MARGIN;
  const top = half[2] * 2 * OUTLINE_MARGIN;
  const corner = (side: number, end: number, z: number): [number, number, number] => {
    const east = Math.cos(radians) * across * side + Math.sin(radians) * along * end;
    const north = -Math.sin(radians) * across * side + Math.cos(radians) * along * end;
    const [lon, lat] = offsetPosition(position, east, north);
    return [lon, lat, z];
  };
  const [a, b, c, d] = [corner(-1, -1, 0), corner(1, -1, 0), corner(1, 1, 0), corner(-1, 1, 0)];
  const [a2, b2, c2, d2] = [corner(-1, -1, top), corner(1, -1, top), corner(1, 1, top), corner(-1, 1, top)];
  // Around the base, up, around the top, then the three remaining uprights
  // (retracing an edge to reach each one).
  return [a, b, c, d, a, a2, b2, c2, d2, a2, b2, b, c, c2, d2, d];
}

function pathsFor(state: SourceState, vehicle: Vehicle): Path[] {
  const exact = vehicle.shapeId === undefined ? undefined : state.paths.get(vehicle.shapeId);
  if (exact) return [exact];
  if (vehicle.routeId === undefined) return [];

  let candidates = state.routePaths.get(vehicle.routeId);
  if (!candidates) {
    const shapeIds = state.routes.get(vehicle.routeId)?.shapeIds ?? [];
    candidates = shapeIds.map((id) => state.paths.get(id)).filter((path) => path !== undefined);
    state.routePaths.set(vehicle.routeId, candidates);
  }
  return candidates;
}

function buildLayers(now: number) {
  const visible = states.filter((state) => state.visible);

  const lineLayers = visible
    .filter((state) => state.showRouteLines && state.visibleLines.length > 0)
    .map(
      (state) =>
        new PathLayer<RouteLine>({
          id: `routes:${state.info.id}`,
          data: state.visibleLines,
          getPath: (line) => line.path,
          getColor: (line) => dimIf(isDimmed(state, [line.route.id]), lineColor(line.route)),
          getWidth: (line) => LINE_STYLES[line.route.mode].width,
          // The data never changes, so deck.gl must be told when colours do.
          updateTriggers: { getColor: [themeName, highlightVersion] },
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
        }),
    );

  const zoom = map.getZoom();
  const stopLayers = visible
    .filter((state) => state.showStops)
    .flatMap((state) =>
      [...state.visibleStops].map(([mode, stops]) => {
        const style = STOP_STYLES[mode];
        return new ScatterplotLayer<Stop>({
          id: `stops:${state.info.id}:${mode}`,
          data: stops,
          visible: zoom >= style.minZoom,
          getPosition: (stop) => [stop.lon, stop.lat],
          getRadius: style.radius,
          radiusUnits: 'meters',
          radiusMinPixels: style.pixels[0],
          radiusMaxPixels: style.pixels[1],
          getFillColor: (stop) => dimIf(isDimmed(state, stop.routeIds), style.station ? theme.station.fill : theme.stop),
          stroked: style.station,
          getLineColor: (stop) => dimIf(isDimmed(state, stop.routeIds), theme.station.outline),
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          updateTriggers: {
            getFillColor: [themeName, highlightVersion],
            getLineColor: [themeName, highlightVersion],
          },
          pickable: true,
        });
      }),
    );

  const upcomingStopLayers: Layer[] = [];
  const vehicleLayers = visible.flatMap((state): Layer[] => {
    const tracked = state.tracker.positions(now);
    const data = tracked.filter(({ vehicle }) =>
      inService(vehicle) ? !state.hiddenRoutes.has(vehicle.routeId!) : showOutOfService,
    );
    state.drawn = new Map(data.map((item) => [item.vehicle.id, item.position]));
    state.drawnBearings = new Map(data.map((item) => [item.vehicle.id, item.bearing]));
    if (pinned && state.showStops) {
      const clicked = data.find((item) => item.vehicle.id === hoveredVehicleId(state));
      if (clicked) upcomingStopLayers.push(...upcomingStopHighlight(state, clicked));
    }
    if (show3dVehicles) {
      const boxes = data.flatMap((item) => boxesFor(item, enlargement(zoom)));
      return [
        new SimpleMeshLayer<VehicleBox>({
          id: `vehicles:${state.info.id}`,
          data: boxes,
          mesh: BOX,
          getPosition: (box) => box.position,
          getColor: (box) => colorOf(box.vehicle, state),
          // The box's long side is its y axis, which points north before
          // rotation; yaw is anticlockwise, bearings are clockwise.
          getOrientation: (box) => [0, -box.bearing, 0],
          getScale: (box) => box.half,
          // Lifts the box, which is centred on its position, to sit on the ground.
          getTranslation: (box) => [0, 0, box.half[2]],
          material: BOX_MATERIAL,
          pickable: true,
        }),
        new PathLayer<VehicleBox>({
          id: `outlines:${state.info.id}`,
          data: boxes,
          getPath: outlineOf,
          getColor: (box) => dimIf(isDimmed(state, [box.vehicle.routeId]), OUTLINE_COLOR),
          getWidth: OUTLINE_WIDTH_PX,
          widthUnits: 'pixels',
          // Keeps the line a constant width from any angle.
          billboard: true,
        }),
        ...outlineHighlight(
          state,
          boxes.filter((box) => box.vehicle.id === hoveredVehicleId(state)),
        ),
      ];
    }
    return [
      new ScatterplotLayer<TrackedVehicle>({
        id: `vehicles:${state.info.id}`,
        data,
        getPosition: (item) => item.position,
        getFillColor: (item) => colorOf(item.vehicle, state),
        getRadius: (item) => (usesRouteColor(item.vehicle.mode) ? 60 : 30),
        radiusUnits: 'meters',
        radiusMinPixels: state.info.simulated ? 4.5 : 3,
        radiusMaxPixels: 14,
        stroked: true,
        getLineColor: state.info.simulated ? theme.simulatedOutline : theme.liveOutline,
        getLineWidth: state.info.simulated ? 1.5 : 1,
        lineWidthUnits: 'pixels',
        pickable: true,
      }),
      ...ringHighlight(
        `vehicles:${state.info.id}`,
        data.filter((item) => item.vehicle.id === hoveredVehicleId(state)).map((item) => item.position),
        { radius: 60, pixels: [4.5, 14] },
      ),
    ];
  });

  const stop = hovered?.kind === 'stops' && hovered.state.visible && hovered.state.showStops ? hovered.stop : undefined;
  const stopHighlight = stop ? ringHighlight('stops', [[stop.lon, stop.lat]], STOP_STYLES[stop.mode]) : [];

  return [...lineLayers, ...stopLayers, ...stopHighlight, ...upcomingStopLayers, ...vehicleLayers];
}

let wasAnimating = false;

function frame() {
  const now = vehicleClock();
  const animating = !paused && states.some((state) => state.visible && state.tracker.isAnimating(now));
  // One extra frame after animation ends so vehicles land exactly on target.
  if (needsRedraw || animating || wasAnimating) {
    overlay.setProps({ layers: buildLayers(now) });
    needsRedraw = false;
  }
  followHovered();
  syncMenuPadding();
  wasAnimating = animating;
  requestAnimationFrame(frame);
}

function statusText(state: SourceState, vehicles: Vehicle[], fetchedAt: number, stale: boolean): string {
  if (state.info.simulated) {
    return vehicles.length === 0
      ? 'No trains scheduled right now'
      : `${vehicles.length.toLocaleString()} trains · estimated from the timetable`;
  }
  const active = vehicles.filter(inService).length;
  const time = new Date(fetchedAt).toLocaleTimeString();
  return (
    `${active.toLocaleString()} in service · ${vehicles.length.toLocaleString()} total · ` +
    (stale ? `feed unavailable, showing ${time}` : `updated ${time}`)
  );
}

async function refresh(state: SourceState) {
  try {
    const snapshot = await getVehicles(state.info.id);
    state.tracker.update(snapshot.vehicles, vehicleClock());
    needsRedraw = true;
    menu?.setStatus(state.info.id, statusText(state, snapshot.vehicles, snapshot.fetchedAt, snapshot.stale), snapshot.stale);
  } catch (error) {
    console.error(`[${state.info.id}]`, error);
    menu?.setStatus(state.info.id, 'Could not load data; retrying', true);
  }
}

async function poll(state: SourceState) {
  // Don't spend upstream requests on a tab nobody is looking at, or while paused.
  if (!document.hidden && !paused) await refresh(state);
  setTimeout(() => void poll(state), state.info.pollIntervalMs);
}

/** Loads a source's routes: lines and stops to draw, and paths for its vehicles to follow. */
async function loadRoutes(state: SourceState) {
  try {
    const network = await getRoutes(state.info.id);
    for (const [shapeId, encoded] of Object.entries(network.shapes)) {
      const path = buildPath(decodeShape(encoded));
      state.paths.set(shapeId, path);
      state.shapeIds.set(path, shapeId);
    }

    const ordered = [...network.routes].sort((a, b) => LINE_STYLES[a.mode].order - LINE_STYLES[b.mode].order);
    for (const route of ordered) {
      state.routes.set(route.id, route);
      for (const shapeId of route.displayShapeIds) {
        const path = state.paths.get(shapeId);
        if (path) state.lines.push({ path: path.points, route });
      }
    }
    const stopsById = new Map(network.stops.map((stop) => [stop.id, stop]));
    for (const [shapeId, calls] of Object.entries(network.shapeStops)) {
      const stops = calls.flatMap(([stopId, fraction]) => {
        const stop = stopsById.get(stopId);
        return stop ? [{ stop, fraction }] : [];
      });
      state.shapeStops.set(shapeId, stops);
    }
    for (const stop of network.stops) {
      const group = state.stops.get(stop.mode);
      if (group) group.push(stop);
      else state.stops.set(stop.mode, [stop]);
    }
    applyRouteFilter(state);
    menu?.setRoutes(state.info.id, ordered);
    state.routePaths.clear();
    needsRedraw = true;
  } catch (error) {
    // Vehicles still show, moving in straight lines between reports.
    console.error(`[${state.info.id}] could not load routes`, error);
  }
}

function lineColor(route: Route): Color {
  const { alpha } = LINE_STYLES[route.mode];
  return usesRouteColor(route.mode) ? hexToColor(route.color, alpha) : withAlpha(theme.modeColors[route.mode], alpha);
}

function setPaused(pause: boolean) {
  if (pause === paused) return;
  const now = performance.now();
  if (pause) pausedAt = now;
  else pausedTotal += now - pausedAt;
  paused = pause;
  // Also stops the menu's own animation.
  document.documentElement.toggleAttribute('data-paused', pause);
  for (const state of states) {
    if (pause) menu?.setStatus(state.info.id, 'Paused', false);
    else void refresh(state);
  }
}

/** Rebuilds the lists of lines and stops to draw after routes are shown, hidden or picked out. */
function applyRouteFilter(state: SourceState) {
  const shown = (routeId: string) => !state.hiddenRoutes.has(routeId);
  const lines = state.lines.filter((line) => shown(line.route.id));
  // Faded lines go first so that the picked-out lines are drawn over them.
  const faded = (line: RouteLine) => isDimmed(state, [line.route.id]);
  state.visibleLines = [...lines.filter(faded), ...lines.filter((line) => !faded(line))];
  state.visibleStops = new Map(
    // A stop stays while any route that serves it is shown.
    [...state.stops].map(([mode, stops]) => [mode, stops.filter((stop) => stop.routeIds.some(shown))]),
  );
  needsRedraw = true;
}

/** Publishes the mode colours to CSS, for the swatches in the menu. */
function applyThemeVariables() {
  for (const [mode, [r, g, b]] of Object.entries(theme.modeColors)) {
    document.documentElement.style.setProperty(`--mode-${mode}`, `rgb(${r} ${g} ${b})`);
  }
}

function setTheme(name: ThemeName) {
  themeName = name;
  theme = THEMES[name];
  saveThemeName(name);
  document.documentElement.dataset.theme = name;
  // A full replacement rather than a diff, so that 'style.load' fires and
  // the custom layers are rebuilt in the new colours.
  map.setStyle(theme.basemap, { diff: false });
  applyThemeVariables();
  needsRedraw = true;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function attributionHtml({ text, url }: Attribution): string {
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>` : escapeHtml(text);
}

function createState(info: SourceInfo): SourceState {
  const state: SourceState = {
    info,
    tracker: new VehicleTracker(info.pollIntervalMs, (vehicle) => pathsFor(state, vehicle)),
    visible: true,
    showRouteLines: true,
    showStops: true,
    hiddenRoutes: new Set(),
    routes: new Map(),
    paths: new Map(),
    routePaths: new Map(),
    lines: [],
    stops: new Map(),
    visibleLines: [],
    visibleStops: new Map(),
    drawn: new Map(),
    drawnBearings: new Map(),
    shapeStops: new Map(),
    shapeIds: new Map(),
  };
  return state;
}

async function start() {
  let infos: SourceInfo[];
  try {
    infos = await getSources();
  } catch (error) {
    console.error(error);
    const notice = document.createElement('div');
    notice.className = 'notice';
    notice.textContent = 'Could not reach the Mini Toronto server.';
    document.body.append(notice);
    return;
  }

  states.push(...infos.map(createState));
  const stateOf = (sourceId: string) => states.find((state) => state.info.id === sourceId);
  const setInGroup = (group: string, change: (state: SourceState) => void) => {
    for (const state of states) if (state.info.group === group) change(state);
    // Whatever was hovered may have just been hidden.
    hidePopup();
    needsRedraw = true;
  };
  menu = createMenu({
    sources: infos,
    lightMode: themeName === 'light',
    onLightMode: (on) => setTheme(on ? 'light' : 'dark'),
    onPaused: setPaused,
    trackingMode,
    onTrackingMode: setTrackingMode,
    onGroupVisible: (group, visible) => setInGroup(group, (state) => (state.visible = visible)),
    onGroupRouteLines: (group, shown) => setInGroup(group, (state) => (state.showRouteLines = shown)),
    onGroupStops: (group, shown) => setInGroup(group, (state) => (state.showStops = shown)),
    onLinesHighlighted: (sourceId, matches) => {
      // Has no visible effect while a hovered vehicle's or stop's routes are picked out; it applies once that ends.
      const state = stateOf(sourceId);
      if (!state) return;
      state.highlightedRoutes = matches;
      highlightVersion++;
      applyRouteFilter(state);
    },
    onRoutesVisible: (sourceId, routeIds, visible) => {
      const state = stateOf(sourceId);
      if (!state) return;
      for (const routeId of routeIds) {
        if (visible) state.hiddenRoutes.delete(routeId);
        else state.hiddenRoutes.add(routeId);
      }
      applyRouteFilter(state);
      // Whatever was hovered may have just been hidden.
      hidePopup();
    },
  });

  const attributions = new Map(infos.flatMap((info) => info.attributions).map((item) => [item.text, item]));
  map.addControl(
    new AttributionControl({ compact: true, customAttribution: [...attributions.values()].map(attributionHtml) }),
  );

  for (const state of states) {
    // Routes first, so the first vehicles drawn are already on their paths.
    void (state.info.hasRoutes ? loadRoutes(state) : Promise.resolve()).then(() => poll(state));
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !paused) for (const state of states) void refresh(state);
  });
  requestAnimationFrame(frame);
}

void start();
