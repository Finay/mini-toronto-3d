# Mini Toronto

A real-time visualization of Toronto, combining live public transit vehicle positions, landmarks, and other city data streams. Inspired by [Mini Tokyo 3D](https://github.com/nagix/mini-tokyo-3d).

Work in progress. It currently shows live TTC buses and streetcars following their routes, subway and light rail trains placed from the timetable, and 3D buildings.

## Running

Requires Node 20 or later.

```sh
npm install
npm run data
npm run dev
```

Then open http://localhost:5173.

`npm run data` downloads the TTC's schedule data (about 84 MB) and prepares route lines and the subway timetable. Run it again with `-- --refresh` when the TTC publishes a new schedule, roughly monthly; subway trains disappear once the downloaded schedule expires.

## Data attribution

Contains information licensed under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/).

Data used in this product or service is provided with the permission of Metrolinx. Metrolinx makes no representations or warranties of any kind, express or implied, with respect to the Data and assumes no responsibility for the accuracy or currency of the data used in this product or service.
