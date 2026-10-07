# Mini Toronto

A real-time visualization of Toronto: live public transit vehicle positions, landmarks, and other city data streams on an interactive map. Inspired by [Mini Tokyo 3D](https://github.com/nagix/mini-tokyo-3d).

## Status

First milestone: live TTC buses and streetcars as moving dots on a 2D map. Not yet done: route shapes and snapping vehicles to them (needs static GTFS), subway, GO/UP Express, landmarks, 3D.

## Stack

TypeScript throughout. Client: Vite, MapLibre GL (OpenFreeMap "dark" basemap, no key), deck.gl for the vehicle layer. Server: Hono on Node, run with tsx. Tests: Vitest.

## Layout

- `shared/types.ts` — the normalized data model (`Vehicle`, `SourceInfo`, `VehicleSnapshot`) used by both sides
- `server/` — proxy that fetches upstream feeds, normalizes and caches them
  - `sources/` — one module per data source, registered in `sources/index.ts`
  - `sources/gtfsRealtime.ts` — reusable GTFS-realtime VehiclePosition decoder
  - `cache.ts` — TTL cache with stale fallback; `app.ts` — routes; `index.ts` — entry point
- `src/` — browser client; `vehicleTracker.ts` interpolates between snapshots, `main.ts` wires map, layers and panel
- `public/` — static assets served as-is
- `data/` — static datasets (route geometry, stops, landmarks); raw downloads go in `data/raw/`

## Commands

- `npm run dev` — API server on :8787 and Vite on :5173 (open the Vite URL; it proxies `/api`)
- `npm test` — unit tests
- `npm run typecheck` — TypeScript check
- `npm run build` — typecheck and build the client to `dist/`
- `npm start` — production: serves the API and the built `dist/` on :8787 (run `npm run build` first)

In development, open the Vite URL (:5173), not :8787; the API server only serves the client in production.

MapLibre's worker script must be passed through the bundler (`setWorkerUrl` with a `?url` import in `src/main.ts`), or the basemap silently fails to render while the deck.gl dots still appear.

## Architecture

The browser never talks to an agency directly (the TTC feed has no CORS header, and some sources need secret keys). The server exposes:

- `GET /api/sources` — list of `SourceInfo`
- `GET /api/sources/:id/vehicles` — `VehicleSnapshot`

The client is source-agnostic: it lists sources, then for each one polls at its `pollIntervalMs`, draws a layer, adds a panel row and shows its attribution. It contains no agency-specific code.

## Adding a data source

1. Create `server/sources/<name>.ts` exporting a `VehicleSource` (`info` plus `fetchVehicles()` returning normalized `Vehicle[]`). For a GTFS-realtime feed, call `fetchVehiclePositions` with the URL and a `modeOf` classifier, as `ttc.ts` does.
2. Append it to the array in `server/sources/index.ts`. The client picks it up with no changes.
3. Set `info.attribution` to whatever the data licence requires, and record the licence under "Data sources" below.
4. Read API keys from `process.env` and leave the source out of the array when the key is missing.

For data that is not vehicles (stations, alerts, landmarks): add a new `kind` to `SourceInfo` in `shared/types.ts`, a matching snapshot type and route in `server/app.ts`, and a renderer in the client keyed on `kind`.

## Data sources

### TTC real-time (GTFS-realtime)

Base URL: https://bustime.ttc.ca/gtfsrt/ — no API key needed. Responses are protobuf (`application/x-google-protobuf`); append `?debug` for a human-readable text dump.

- `/gtfsrt/vehicles` — VehiclePosition feed
- `/gtfsrt/trips` — TripUpdate feed
- `/gtfsrt/alerts` — Alert feed

Endpoints confirmed responding on 2026-10-06. Terms of use and rate limits not checked yet.

Observed in the vehicle feed on 2026-10-06 (one sample, 1,482 vehicles):

- No `Access-Control-Allow-Origin` header, so browsers cannot fetch it directly; the app needs a server-side proxy
- Buses and streetcars only. No subway routes (1, 2, 4) appeared, so subway trains need another source or schedule-based simulation
- Each vehicle has position, bearing, speed and timestamp; only 854 carried a trip/route, the rest were unassigned
- Some `trip_id`s are negative with `schedule_relationship: NEW` and will not match the static GTFS; join on `route_id` in that case

### TTC static (GTFS)

Dataset page: https://open.toronto.ca/dataset/merged-gtfs-ttc-routes-and-schedules/

Covers all TTC modes; needed to resolve the route/trip/stop IDs in the real-time feeds and to draw route shapes. Published by the TTC, refreshed quarterly (last refreshed 2026-09-30).

- One resource, "Complete GTFS": ZIP, about 84 MB
- Metadata (including the current download URL) via CKAN: `https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=merged-gtfs-ttc-routes-and-schedules`
- Download to `data/raw/` (gitignored) and commit only the processed subset the app needs
- CKAN lists this dataset's licence as "not specified"; we treat it as covered by the portal-wide licence below

### Licence (City of Toronto Open Data)

Open Government Licence – Toronto v1.0: https://open.toronto.ca/open-data-licence/

- Allows copying, modifying, publishing and distributing, including commercially
- Requires attribution wherever the data is used, with a link to the licence where possible. Default statement: "Contains information licensed under the Open Government Licence – Toronto."
- Does not cover City or TTC names, crests, logos or trade-marks, so don't use official logos or imply endorsement
- Applies to data from the Open Data portal. The real-time feeds at bustime.ttc.ca are not on the portal, so their terms are still unconfirmed

### Metrolinx static (GO Transit and UP Express GTFS)

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
