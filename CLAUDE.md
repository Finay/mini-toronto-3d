# Mini Toronto

A real-time visualization of Toronto: live public transit vehicle positions, landmarks, and other city data streams on an interactive map. Inspired by [Mini Tokyo 3D](https://github.com/nagix/mini-tokyo-3d).

## Status

Working: live TTC buses and streetcars that follow their routes; TTC subway and light rail trains and GO and UP Express trains placed from timetables; route lines, stops and stations; City traffic cameras with their latest image; 3D buildings; a themed flyout menu; hover, click-to-select and camera tracking. Not yet done: detailed vehicle models (vehicles are plain boxes), depth occlusion between vehicles and buildings, underground rendering for the subway, live GO and UP Express positions, GO buses, landmarks.

## Stack

TypeScript throughout. Client: Vite, MapLibre GL (OpenFreeMap "dark" basemap, no key), deck.gl for the vehicle layer. Server: Hono on Node, run with tsx. Tests: Vitest.

## Layout

- `shared/types.ts` — the normalized data model (`Vehicle`, `SourceInfo`, `VehicleSnapshot`, `RouteNetwork`) used by both sides
- `shared/schedule.ts` — places vehicles from a timetable; used by the server and, in the static build, by the browser
- `shared/geometry.ts` — paths, projection, simplification and polyline encoding, used by all three parts below
- `scripts/build-gtfs-data.ts` — turns a static GTFS zip into the files in `data/processed/`
- `server/` — proxy that fetches upstream feeds, normalizes and caches them
  - `sources/` — one module per data source, registered in `sources/index.ts`
  - `sources/gtfsRealtime.ts` — reusable GTFS-realtime VehiclePosition decoder
  - `sources/gtfsSchedule.ts` — `createScheduledSource`, wrapping the timetable simulator in `shared/schedule.ts`
  - `cache.ts` — TTL cache with stale fallback; `app.ts` — routes; `index.ts` — entry point
- `src/` — browser client; `vehicleTracker.ts` interpolates between snapshots, `menu.ts` builds the flyout menu, `themes.ts` holds colours, `main.ts` wires the map, layers and menu together
- `worker/` — a Cloudflare Worker that proxies the live TTC feed with a CORS header, for a future static build of the site (see `worker/README.md`). Not part of the normal app; it has its own `tsconfig.json` and `npm run worker:dev`, `worker:check` and `worker:deploy`
- `public/` — static assets served as-is
- `data/raw/` — downloaded feeds; `data/processed/` — files generated from them. Both are gitignored

## Commands

- `npm run data` — download the TTC, GO and UP Express static GTFS if missing and regenerate `data/processed/` (about 5 seconds; add `-- --refresh` to download again). Needed once after cloning, and again whenever the TTC publishes a new feed
- `npm run dev` — API server on :8787 and Vite on :5173 (open the Vite URL; it proxies `/api`)
- `npm test` — unit tests
- `npm run typecheck` — TypeScript check
- `npm run build` — typecheck and build the client to `dist/`
- `npm run build:static` — build the site to run without the server, into `dist-static/` (needs `npm run data` first); `npm run preview:static` serves it locally
- `npm start` — production: serves the API and the built `dist/` on :8787 (run `npm run build` first)

In development, open the Vite URL (:5173), not :8787; the API server only serves the client in production.

MapLibre's worker script must be passed through the bundler (`setWorkerUrl` with a `?url` import in `src/main.ts`), or the basemap silently fails to render while the deck.gl dots still appear.

## Architecture

The browser never talks to an agency directly (the TTC feed has no CORS header, and some sources need secret keys). The server exposes:

- `GET /api/sources` — list of `SourceInfo`
- `GET /api/sources/:id/vehicles` — `VehicleSnapshot`
- `GET /api/sources/:id/routes` — `RouteNetwork` (only for sources with `hasRoutes`)
- `GET /api/sources/:id/cameras` — `CameraSnapshot` (only for sources of kind `cameras`)

The client is source-agnostic: it lists sources, then for each one loads its routes, polls at its `pollIntervalMs`, draws line and vehicle layers, adds a panel row and shows its attributions. It contains no agency-specific code.

Vehicle motion: `VehicleTracker` glides each vehicle from where it is drawn to its newest report, over the time between the two reports. When the vehicle's path is known (`Vehicle.shapeId`, or failing that the nearest shape of its route) it is snapped to the path and glides along it. Reports more than 50 m from any path, and glides that would be a long detour along the path, fall back to straight lines.

Scheduled sources: where there are no live positions to use (TTC subway and Lines 5 and 6, and GO and UP Express trains), `ScheduleSimulator` computes where each train should be from the timetable. These sources have `simulated: true` and the UI labels them as estimates. They show nothing once the feed's calendar has expired, so `npm run data -- --refresh` must be run when a new feed is published (the current TTC feed covers 2026-09-30 to 2026-10-31, the GO feed 2026-10-05 to 2026-11-27).

Without `data/processed/` the server still runs: live vehicles move in straight lines, with no route lines and no subway.

Vehicles are drawn as boxes (deck.gl `SimpleMeshLayer`, sizes in `VEHICLE_BOXES` in `src/main.ts`), oriented by the bearing `VehicleTracker` derives from the direction of travel along the path. Subway, light rail and train vehicles are a row of car boxes placed along the path so they bend with the track. Box sizes are stylized (half real width and height, a quarter of real length) and drawn 10 times larger at zoom 14 and below, shrinking to their listed size by zoom 17. Each box's edges are traced by a `PathLayer` outline so boxes stand apart from route lines of the same colour. Two display choices have no panel control and are constants in `src/main.ts`: `show3dVehicles` (false falls back to flat dots) and `showOutOfService` (true also draws vehicles with no route).

Stops: `RouteNetwork.stops` comes from the same build script. On-street stops are listed individually; a rapid transit station's platforms are merged into one marker. The client shows stations from zoom 10, streetcar stops from 13 and bus stops from 14.5 (`STOP_STYLES` in `src/main.ts`), since there are about 9,000 bus stops.

Menu styling is a "vibrant block" look, chosen with the ui-ux-pro-max plugin's style database: flat colour blocks (toned down from that style's neons), 3 px outlines, hard offset shadows and the Russo One display face (bundled from `@fontsource/russo-one`, so no font service is contacted). Its tokens are scoped to the menu and popup in `src/style.css`: two neutrals (`--paper`, `--ink`) that swap between themes, five accents taken from the map (`--sand`, `--park`, `--coral`, `--water`, `--slate`), and `--on-color` for text on any of them, which is always dark. Keep to those tokens when adding menu controls. The map's popup and MapLibre's zoom and compass buttons use the same tokens (they are declared for `.flyout`, `.popup-anchor` and `.maplibregl-ctrl-group` together).

Loading screen: the `#loader` element and all its styles are inline in `index.html`, so that it appears before the app's JavaScript and CSS arrive; a small inline script there reads the saved theme. It repeats the About tab's logo with spring animations. `hideLoader` in `main.ts` lifts it once the map has loaded and every vehicle source has answered once, after at least 1.4 s and at most 15 s.

Menu: `src/menu.ts` builds a flyout (closed by default, opened and closed by the pull tab on the left edge of the screen) with Appearance, Data and About tabs. It holds no map state: it reports changes through the callbacks passed to `createMenu`. The Appearance tab has the light mode toggle and a Live toggle; unticking Live stops polling and freezes vehicle motion (`setPaused` and `vehicleClock` in `main.ts`; the tracker runs on that clock so vehicles resume from where they stopped). The Data tab has one collapsible section per `SourceInfo.group`, with a checkbox beside its name that shows or hides the whole group on the map, each source's status, "Show route lines" and "Show stops" toggles for that group, and a searchable list of its lines (`matchesLine`: whole line number, or the start of a word in the name), plus the placeholder sections in `PLANNED_SECTIONS`. Lines are grouped by kind (Subway, Bus…), each kind a dropdown that starts closed and opens by itself while a search has matches in it. Each line's colour circle is its on/off switch, solid when shown and faint with a prohibition sign when hidden, and each kind's heading has one for all its lines; nothing else in a row toggles. Hiding a line adds it to that source's `hiddenRoutes`, and `applyRouteFilter` in `main.ts` drops its vehicles, route line and any stops no visible line serves. Pointing at a row, or typing a search, picks lines out: the map fades everything else (`onLinesHighlighted`, `highlightedRoutes`, `DIMMED_OPACITY`). Pointing at a vehicle or stop on the map does the same for its route, or the routes serving the stop (`Hovered.routeIds`, checked first in `isDimmed`). `menu.test.ts` runs in happy-dom.

Clicking a vehicle or stop pins the hover state (`pinned` in `main.ts`): the popup, glow and picked-out routes stay, and hover is ignored, until another object or empty map is clicked, Escape is pressed, or the object disappears or is hidden. Clicks are resolved with `overlay.pickObject` from the map's own click event. A clicked vehicle is also tracked: each frame `trackCamera` moves the map part of the way toward centring it in the area the menu leaves free (`Menu.coveredWidth`). The Appearance tab's tracking options (`TRACKING_MODES` in `menu.ts`, remembered in local storage) choose what else the camera does: nothing (Free), sit above and behind the vehicle or above and ahead of it by matching the map's bearing to the vehicle's, or circle it (Helicopter). The camera eases over to the vehicle and then locks on. The menu's width is given to the map as left padding (`syncMenuPadding`, and in `trackCamera` itself while tracking), which moves the map's centre and its perspective's vanishing point to the middle of the uncovered area; centring the vehicle by offset alone left it off the camera's line of sight in the turning modes. The stops still ahead of a clicked vehicle are ringed at 80% of the hover ring's strength (`upcomingStopHighlight`, `UPCOMING_STOP_STRENGTH`), using `RouteNetwork.shapeStops`: each shape's stops in order with their position along it, taken from one representative trip per shape. Dragging the map stops tracking but keeps the selection. Tracking pauses whenever a pointer is down or the wheel was just used, because `jumpTo` resets MapLibre's gesture handlers and would otherwise stop a drag or zoom from ever starting.

Hover popups are a DOM element, not deck.gl's tooltip: `handleHover` fills it, and `followHovered` re-pins it every frame to the hovered object's screen position (above it, or below when there is no room or the panel is in the way). The grow-out animation is CSS on the inner `.popup` element.

Bearings are eased inside `VehicleTracker` (`TURN_TIME_MS`), so `positions()` must be called with increasing times.

Route shapes: the published shapes are chains of straight segments that zigzag between stops, so the build script smooths each one (`smooth` in `shared/geometry.ts`, strength per mode in `SMOOTHING_M`), then simplifies to 0.25 m and stores it at six decimal places (`encodeShape`/`decodeShape`). Vehicles follow the smoothed shapes too. Every stop and station is then moved onto the nearest drawn line of its routes (`snapToLines`); minor branches are added to the drawn lines where they are the only line past a stop. The routes payload is about 1.5 MB compressed, so `/api/sources/:id/routes` is served with an ETag and revalidated instead of re-downloaded.

Themes: `src/themes.ts` holds every colour that differs between light and dark mode, including the basemap style (OpenFreeMap "fiord" for dark, "positron" for light). Switching calls `map.setStyle`, which discards custom map layers, so everything added to the basemap (water and park colours, grass layer, 3D buildings, tile LOD settings) is applied in the `style.load` handler in `src/main.ts`. Panel colours are CSS variables keyed on `data-theme`.

3D: buildings are a MapLibre `fill-extrusion` layer over the basemap's `building` tiles. Those tiles only contain buildings at zoom 13 and 14, so buildings cannot be shown when zoomed out past 13; `setSourceTileLodParams` keeps distant tiles detailed enough to have them in tilted views. The deck.gl overlay is not interleaved with the map, so route lines and vehicles are always drawn on top of buildings rather than hidden behind them.

## Static build

`npm run build:static` produces a copy of the site that needs no server, for GitHub Pages. It is the same client built with `vite build --mode static` (which sets `VITE_STATIC` from `.env.static`, a relative base and the `dist-static` output folder), followed by `scripts/build-static-data.ts`, which asks the server's own sources for their data and writes it to `dist-static/static-data/`.

- `src/api.ts` chooses the data layer: the server's `/api`, or `src/staticApi.ts` in a static build
- The static layer reads `manifest.json` (the sources, and a proxy address for each live one), `<id>/routes.json`, `<id>/schedule.json` and `<id>/cameras.json`
- Timetable-placed vehicles are computed in the browser by the same `ScheduleSimulator` the server uses, which is why it lives in `shared/schedule.ts`
- Live TTC vehicles come from the Cloudflare Worker in `worker/` (deployed at `https://mini-toronto-ttc.kian-benner.workers.dev/vehicles`; override with `TTC_FEED_URL` at build time). They arrive without `shapeId`, so vehicles follow the nearest path of their route
- A live source with no proxy, or a camera list that cannot be fetched at build time, is left out of the static site with a warning
- `.github/workflows/pages.yml` rebuilds and deploys on push to `main` and weekly; the camera list and timetables are only as fresh as the last build

Anything added to the server's API needs a counterpart in `DataApi`, `staticApi.ts` and `build-static-data.ts`, or it will not exist in the static site.

## Adding a data source

1. Create `server/sources/<name>.ts` exporting a `VehicleSource` (`info` plus `fetchVehicles()` returning normalized `Vehicle[]`). For a GTFS-realtime feed, call `fetchVehiclePositions` with the URL and a `modeOf` classifier, as `ttc.ts` does.
2. Append it to the array in `server/sources/index.ts`. The client picks it up with no changes.
3. Set `info.group` to the agency name (sources sharing a group share a section in the menu) and `info.attributions` to whatever the data licence requires, and record the licence under "Data sources" below.
4. Read API keys from `process.env` and export `undefined` instead of a source when the key is missing; the registry skips it.
5. For route lines and route-following, add the agency's static GTFS as a `FeedConfig` in `scripts/build-gtfs-data.ts`, load the generated files with `readProcessed`, set `network` on the source and pass live vehicles through `withShapes`.
6. For an agency with a timetable but no live positions, use `createScheduledSource` (see `ttcRapidTransit` in `ttc.ts`).

For data that is not vehicles: follow the camera kind as the worked example. It added `'cameras'` to `SourceInfo.kind` and a `Camera`/`CameraSnapshot` pair in `shared/types.ts`, a `CameraSource` in `server/sources/types.ts`, a loader map and endpoint in `server/app.ts`, and on the client a `CameraState` list, a marker layer (an `IconLayer` whose triangle is drawn on a canvas once per theme) and a branch in `showFor` for its popup. The menu needs nothing: any source gets a section from its `group`.

## Data sources

### TTC real-time (GTFS-realtime)

Base URL: https://bustime.ttc.ca/gtfsrt/ — no API key needed. Responses are protobuf (`application/x-google-protobuf`); append `?debug` for a human-readable text dump.

- `/gtfsrt/vehicles` — VehiclePosition feed
- `/gtfsrt/trips` — TripUpdate feed
- `/gtfsrt/alerts` — Alert feed

Endpoints confirmed responding on 2026-10-06. Terms of use and rate limits not checked yet.

Observed in the vehicle feed on 2026-10-06 (one sample, 1,482 vehicles):

- No `Access-Control-Allow-Origin` header, so browsers cannot fetch it directly; the app needs a server-side proxy
- Buses and streetcars only. Subway Lines 1, 2 and 4 and light rail Lines 5 and 6 never appear, so those are simulated from the timetable
- Each vehicle has position, bearing, speed and timestamp; only 854 carried a trip/route, the rest were unassigned
- About 99% of `trip_id`s match the current static GTFS, and matched vehicles sit a median 0.4 m from their trip's shape. A few are negative with `schedule_relationship: NEW` and match nothing; those fall back to the shapes of their `route_id`

### TTC static (GTFS)

Dataset page: https://open.toronto.ca/dataset/merged-gtfs-ttc-routes-and-schedules/

Covers all TTC modes; needed to resolve the route/trip/stop IDs in the real-time feeds and to draw route shapes. Published by the TTC, refreshed quarterly (last refreshed 2026-09-30).

- One resource, "Complete GTFS": ZIP, about 84 MB
- Metadata (including the current download URL) via CKAN: `https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=merged-gtfs-ttc-routes-and-schedules`
- `npm run data` downloads it to `data/raw/` and writes about 3 MB of processed files; neither is committed, because feeds are replaced about monthly
- Shape distances are in metres for bus and streetcar shapes but kilometres for subway shapes; the build script only uses them as fractions of each shape's length
- Despite the "quarterly" label, each feed's calendar covers about one month
- CKAN lists this dataset's licence as "not specified"; we treat it as covered by the portal-wide licence below

### Traffic cameras (City of Toronto)

Dataset page: https://open.toronto.ca/dataset/traffic-cameras/ — 336 cameras (253 arterial, the rest on Lake Shore, the Gardiner, the DVP and Allen Road), no key needed. `server/sources/torontoCameras.ts` serves the list; nothing else passes through the server.

- List: `https://opendata.toronto.ca/transportation/tmc/rescucameraimages/Data/tmcearthcameras.json`, JSON wrapped in a `jsonTMCEarthCamerasCallback(...)` call, updated by the City within two minutes of a change
- Image: `.../CameraImages/loc<number>.jpg`, 320 x 240, replaced in place every few minutes, `Cache-Control: max-age=60`. The browser loads it directly in the popup and adds `?t=<minute>` to get a fresh copy; an `<img>` needs no CORS header
- The images do not say which way the camera is pointing. The dataset's `ComparisonImages` (old reference stills per compass direction) are for working that out by eye and are not used
- Catalogue licence is "not specified"; treated as covered by the portal-wide licence below

### Licence (City of Toronto Open Data)

Open Government Licence – Toronto v1.0: https://open.toronto.ca/open-data-licence/

- Allows copying, modifying, publishing and distributing, including commercially
- Requires attribution wherever the data is used, with a link to the licence where possible. Default statement: "Contains information licensed under the Open Government Licence – Toronto."
- Does not cover City or TTC names, crests, logos or trade-marks, so don't use official logos or imply endorsement
- Applies to data from the Open Data portal. The real-time feeds at bustime.ttc.ca are not on the portal, so their terms are still unconfirmed

### Metrolinx static (GO Transit and UP Express GTFS)

In use for GO and UP Express trains: `server/sources/metrolinx.ts` places them from the timetables, and the `go` and `up` feeds in `scripts/build-gtfs-data.ts` build their data. For GO only rail routes (route type 2) are kept; GO buses are not included. UP Express is a single route with five stations, and its feed runs to 2027-03-02. The feed has no shape distances, so stops are located along shapes by projection, and its shapes have a point only every few hundred metres, so they get the strongest smoothing. Services are listed by date in `calendar_dates.txt` only. The required legend below is the source's attribution, shown in the map's attribution control and the About tab.

Developer page: https://www.gotransit.com/en/partner-with-us/software-developers — schedules only, no real-time data. Updated every few weeks; no key needed.

- GO Transit: https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip (about 17.6 MB, last updated 2026-10-05)
- UP Express: https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/UP-GTFS.zip (about 0.9 MB, last updated 2026-09-10)

Downloading accepts the Metrolinx Access and Use Agreement (on the developer page). It is a separate, stricter licence than the City's:

- Limited, revocable licence to use, reproduce and redistribute; Metrolinx can change or withdraw the data without notice
- This legend must be prominently displayed in the app (not necessarily on every view): "Data used in this product or service is provided with the permission of Metrolinx. Metrolinx makes no representations or warranties of any kind, express or implied, with respect to the Data and assumes no responsibility for the accuracy or currency of the data used in this product or service."
- No Metrolinx, GO, GO Transit or UP Express trademarks may be used in association with the data
- The user indemnifies Metrolinx for claims arising from their use of the data

### Metrolinx real-time (GO API)

Not set up. Real-time GO and UP Express data comes from the GO API at http://api.openmetrolinx.com/OpenDataAPI/ (docs at `/Help`), which requires registering for a key; linked from https://www.metrolinx.com/en/about-us/open-data. Endpoints and limits not examined yet. Store the key in `.env`.

Registering accepts the API Access and Use Agreement (https://api.openmetrolinx.com/OpenDataAPI/Help/RegisterAgreement), read 2026-10-06. Constraints that affect design:

- No redistributing the data "within your own API, or other feed" (7a), and no transferring it (7b). A public proxy endpoint that relays GO API data may breach this; unresolved
- No Metrolinx or GO Transit name, branding or trademarks, and no suggestion the app is official (3, 4)
- No press release or public announcement mentioning GO Transit without written consent (5)
- The app must not replicate a substantial number of GO Transit's features or look confusingly similar (7d)
- Call quotas may be imposed and must not be circumvented (6)
- Revocable at any time without notice; the user indemnifies Metrolinx (11, 13, 14)

### Candidates

Unverified — confirm availability, terms and rate limits before building on any of these.

- Bike Share Toronto: GBFS feed
- City of Toronto Open Data: landmarks, building footprints, road closures

## Conventions

- API keys and map tokens go in `.env` (gitignored), never in source.
