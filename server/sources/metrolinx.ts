import type { Attribution, RouteNetwork } from '../../shared/types';
import { readProcessed } from '../processedData';
import { createScheduledSource, type GtfsSchedule } from './gtfsSchedule';
import type { VehicleSource } from './types';

// Metrolinx's Access and Use Agreement requires this legend, word for word,
// to be prominently displayed wherever its data is used.
const METROLINX_LEGEND: Attribution = {
  text:
    'Data used in this product or service is provided with the permission of Metrolinx. ' +
    'Metrolinx makes no representations or warranties of any kind, express or implied, with respect to the Data ' +
    'and assumes no responsibility for the accuracy or currency of the data used in this product or service.',
  url: 'https://www.gotransit.com/en/partner-with-us/software-developers',
};

const GROUP = 'GO Transit and UP Express';

// Metrolinx publishes no open feed of live train positions (its API needs a
// key and has terms that are not settled for this project; see CLAUDE.md), so
// trains are placed from the timetables, which `npm run data` processes.
function timetabledTrains(feed: string, id: string, name: string): VehicleSource | undefined {
  const network = readProcessed<RouteNetwork>(`${feed}/scheduled-network.json`);
  const schedule = readProcessed<GtfsSchedule>(`${feed}/schedule.json`);
  if (!network || !schedule) {
    console.warn(`[${id}] Processed GTFS data not found; run \`npm run data\` for ${name}.`);
    return undefined;
  }
  return createScheduledSource(
    {
      id,
      name,
      // The two services share a section in the menu.
      group: GROUP,
      kind: 'vehicles',
      attributions: [METROLINX_LEGEND],
      // Positions are computed, not fetched, so frequent updates are cheap.
      pollIntervalMs: 5_000,
    },
    schedule,
    network,
  );
}

export const goTrains = timetabledTrains('go', 'go-trains', 'GO trains');
export const upExpress = timetabledTrains('up', 'up-express', 'UP Express trains');
