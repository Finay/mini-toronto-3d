# TTC feed proxy (Cloudflare Worker)

A small Cloudflare Worker for running Mini Toronto as a static site. The TTC's live vehicle feed sends no CORS header, so a browser on another site (GitHub Pages, say) cannot read it. This Worker fetches the feed, decodes it, and serves it as JSON with that header.

It is deployed at https://mini-toronto-ttc.kian-benner.workers.dev/vehicles and used by the static site at https://finay.github.io/mini-toronto-3d/. It is not used by `npm run dev` or `npm start`; the project's own server does this job there.

## What it serves

`GET /vehicles` returns the same shape as the server's `/api/sources/ttc/vehicles` (a `VehicleSnapshot`), reusing the decoder in `server/sources/gtfsRealtime.ts`. Answers are reused for 15 seconds. If the TTC cannot be reached it serves its last answer marked `stale`, or a 502 if it has none.

Vehicles do not carry a `shapeId` here: the server adds that from a 2 MB lookup file the Worker does not have. The client already falls back to the nearest path of the vehicle's route.

## Commands

Run from the project root.

- `npm run worker:dev` — run it locally at http://localhost:8787 (stop `npm run dev` first; it uses the same port, or add `-- --port 8799`)
- `npm run worker:check` — typecheck it
- `npm run worker:deploy` — publish it; prints its `workers.dev` address

Deploying needs a Cloudflare account (the free plan is enough) and a one-time `npx wrangler login`, which opens a browser.

## Before relying on it

- `ALLOWED_ORIGIN` in `wrangler.toml` is set to the static site's origin (`https://finay.github.io`), so other sites cannot use the Worker. That includes `npm run preview:static` on localhost: live TTC vehicles will not load there unless the Worker is redeployed with `"*"`.
- The free plan allows a limited number of requests a day (100,000 when this was written; check the current figure), counted even when the answer comes from cache. One open tab polling every 15 seconds makes about 5,800.
- The TTC feed's terms of use have not been confirmed.
