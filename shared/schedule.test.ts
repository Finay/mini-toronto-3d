import { describe, expect, it } from 'vitest';
import { encodeShape } from './geometry';
import type { RouteNetwork } from './types';
import { ScheduleSimulator, type GtfsSchedule } from './schedule';

// A line running due north for 0.02 degrees of latitude.
const network: RouteNetwork = {
  routes: [
    { id: '1', shortName: '1', longName: 'Test Line', mode: 'subway', color: '#D5C82B', shapeIds: ['s'], displayShapeIds: ['s'] },
  ],
  stops: [],
  shapeStops: {},
  shapes: { s: encodeShape([[-79.4, 43.65], [-79.4, 43.67]]) },
};

function schedule(overrides: Partial<GtfsSchedule> = {}): GtfsSchedule {
  return {
    timezone: 'America/Toronto',
    feedVersion: 'test',
    startDate: 20261001,
    endDate: 20261031,
    services: [
      // Weekdays only.
      { id: 'wk', days: [true, true, true, true, true, false, false], startDate: 20261001, endDate: 20261031, added: [], removed: [] },
    ],
    patterns: [
      {
        routeId: '1',
        shapeId: 's',
        headsign: 'towards North',
        // Leaves at 0 s, reaches the midpoint at 100 s, waits 20 s, arrives at 220 s.
        stops: [[0, 0, 0], [100, 120, 0.5], [220, 220, 1]],
      },
    ],
    trips: [[0, 0, 8 * 3600]],
    ...overrides,
  };
}

// 2026-10-06 is a Tuesday. Toronto is on daylight time (UTC-4) all October.
const tuesdayAt = (time: string) => new Date(`2026-10-06T${time}-04:00`);

describe('ScheduleSimulator', () => {
  it('places a train between stops in proportion to elapsed time', () => {
    const [train, ...rest] = new ScheduleSimulator(schedule(), network).vehiclesAt(tuesdayAt('08:00:50'));

    expect(rest).toEqual([]);
    expect(train).toMatchObject({ routeId: '1', shapeId: 's', mode: 'subway', headsign: 'towards North', bearing: 0 });
    expect(train?.lat).toBeCloseTo(43.655, 5);
    expect(train?.lon).toBeCloseTo(-79.4, 5);
  });

  it('holds a train at a stop until its departure time', () => {
    const simulator = new ScheduleSimulator(schedule(), network);

    expect(simulator.vehiclesAt(tuesdayAt('08:01:50'))[0]?.lat).toBeCloseTo(43.66, 5);
    expect(simulator.vehiclesAt(tuesdayAt('08:02:50'))[0]?.lat).toBeCloseTo(43.665, 5);
  });

  it('shows nothing before a trip starts or after it ends', () => {
    const simulator = new ScheduleSimulator(schedule(), network);

    expect(simulator.vehiclesAt(tuesdayAt('07:59:59'))).toEqual([]);
    expect(simulator.vehiclesAt(tuesdayAt('08:03:41'))).toEqual([]);
  });

  it('keeps the same id for a train across updates', () => {
    const simulator = new ScheduleSimulator(schedule(), network);

    expect(simulator.vehiclesAt(tuesdayAt('08:00:10'))[0]?.id).toBe(simulator.vehiclesAt(tuesdayAt('08:02:00'))[0]?.id);
  });

  it('respects days of the week and the service date range', () => {
    const simulator = new ScheduleSimulator(schedule(), network);

    expect(simulator.vehiclesAt(new Date('2026-10-10T08:00:50-04:00'))).toEqual([]); // Saturday
    expect(simulator.vehiclesAt(new Date('2026-11-03T08:00:50-05:00'))).toEqual([]); // after the feed ends
  });

  it('applies calendar exceptions', () => {
    const removed = schedule();
    removed.services[0]!.removed = [20261006];
    const added = schedule();
    added.services[0]!.added = [20261010];

    expect(new ScheduleSimulator(removed, network).vehiclesAt(tuesdayAt('08:00:50'))).toEqual([]);
    expect(new ScheduleSimulator(added, network).vehiclesAt(new Date('2026-10-10T08:00:50-04:00'))).toHaveLength(1);
  });

  it('continues trips that run past midnight from the previous service day', () => {
    // Starts at 24:30 on Friday's timetable, which is 00:30 on Saturday.
    const simulator = new ScheduleSimulator(schedule({ trips: [[0, 0, 24 * 3600 + 1800]] }), network);

    expect(simulator.vehiclesAt(new Date('2026-10-10T00:30:50-04:00'))).toHaveLength(1);
    expect(simulator.vehiclesAt(new Date('2026-10-11T00:30:50-04:00'))).toEqual([]);
  });
});
