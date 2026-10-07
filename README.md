# Mini Toronto

A real-time visualization of Toronto, combining live public transit vehicle positions, landmarks, and other city data streams. Inspired by [Mini Tokyo 3D](https://github.com/nagix/mini-tokyo-3d).

Work in progress. It currently shows live TTC buses and streetcars following their routes, TTC subway and light rail trains and GO and UP Express trains placed from their timetables, City traffic cameras, and 3D buildings.

## Running

Requires Node 20 or later.

```sh
npm install
npm run data
npm run dev
```

Then open http://localhost:5173.

`npm run data` downloads the TTC's, GO Transit's and UP Express's schedule data (about 100 MB) and prepares route lines and timetables. Downloading the GO Transit and UP Express data means accepting [Metrolinx's Access and Use Agreement](https://www.gotransit.com/en/partner-with-us/software-developers). Run it again with `-- --refresh` when a new schedule is published, roughly monthly; timetable-placed trains disappear once the downloaded schedule expires.

## Hosting as a static site

The site can also be built to run with no server of its own, for hosts that only serve files, such as GitHub Pages:

```sh
npm run data
npm run build:static     # writes dist-static/
npm run preview:static   # serves it locally to try it
```

In this form the timetable-placed trains are worked out in the browser, routes and cameras come from files written at build time, and live TTC vehicles come from a small Cloudflare Worker in `worker/` (the TTC's feed cannot be read directly from a browser). The Worker's address is set in `scripts/build-static-data.ts`, or with the `TTC_FEED_URL` environment variable.

`.github/workflows/pages.yml` builds and publishes this to GitHub Pages on every push to `main` and once a week, so that new timetables are picked up. To use it, push the repository to GitHub and set Pages' source to "GitHub Actions" in the repository settings.

## Data attribution

Contains information licensed under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/).

Data used in this product or service is provided with the permission of Metrolinx. Metrolinx makes no representations or warranties of any kind, express or implied, with respect to the Data and assumes no responsibility for the accuracy or currency of the data used in this product or service.
