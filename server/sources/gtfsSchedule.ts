import { ScheduleSimulator, type GtfsSchedule } from '../../shared/schedule';
import type { RouteNetwork } from '../../shared/types';
import type { VehicleSource } from './types';

export type { GtfsSchedule };

/** A source whose vehicles are placed by timetable rather than reported live. */
export function createScheduledSource(
  info: Omit<VehicleSource['info'], 'simulated'>,
  schedule: GtfsSchedule,
  network: RouteNetwork,
): VehicleSource {
  const simulator = new ScheduleSimulator(schedule, network);
  return {
    info: { ...info, simulated: true },
    network,
    schedule,
    fetchVehicles: async () => simulator.vehiclesAt(new Date()),
  };
}
