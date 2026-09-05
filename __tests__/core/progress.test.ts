// onProgress — единственная правка ядра в фазе 2 (DECISIONS.md, 2026-09-05). Тесты фазы 1 не тронуты.
import { setMockScenario } from '../../src/core/mocks/scenario';
import { planTrip, type PlanStage, type TripInput } from '../../src/core/planner/schedule';

const WARSAW = { lat: 52.2297, lon: 21.0122 };
const FRANKFURT = { lat: 50.1109, lon: 8.6821 };
const LODZ = { lat: 51.7592, lon: 19.456 };
const DEPART_AT = '2026-09-07T06:00:00+02:00';
const TRIP: TripInput = { origin: WARSAW, destination: FRANKFURT, departureAt: DEPART_AT, vehicleWeightKg: 40_000 };

async function stagesOf(input: TripInput) {
  const stages: PlanStage[] = [];
  const result = await planTrip(input, { onProgress: (s) => stages.push(s) });
  return { stages, result };
}

describe('planTrip onProgress', () => {
  test('happy path: route → anchors → parkings → schedule, по одному разу', async () => {
    const { stages, result } = await stagesOf(TRIP);
    expect(result.status).toBe('ok');
    expect(stages).toEqual(['route', 'anchors', 'parkings', 'schedule']);
  });

  test('короткий маршрут без остановок: все четыре стадии', async () => {
    const { stages, result } = await stagesOf({ ...TRIP, destination: LODZ });
    expect(result.status).toBe('ok');
    expect(stages).toEqual(['route', 'anchors', 'parkings', 'schedule']);
  });

  test('all-full → conflict на парковках: только route и anchors', async () => {
    setMockScenario('all-full');
    const { stages, result } = await stagesOf(TRIP);
    expect(result.status).toBe('conflict');
    expect(stages).toEqual(['route', 'anchors']);
  });

  test('плохой вход → reject до первой стадии', async () => {
    const stages: PlanStage[] = [];
    await expect(planTrip({ ...TRIP, vehicleWeightKg: 0 }, { onProgress: (s) => stages.push(s) })).rejects.toThrow();
    expect(stages).toEqual([]);
  });

  test('без options — прежняя сигнатура', async () => {
    await expect(planTrip(TRIP)).resolves.toMatchObject({ status: 'ok' });
  });
});
