import { getParkingsNear } from '../../src/core/api/parking';
import { haversineMeters } from '../../src/core/geo';
import { MOCK_LIVE_TICK_MS } from '../../src/core/mocks/parkingGenerator';
import { setMockScenario } from '../../src/core/mocks/scenario';
import { BREAK_SEC } from '../../src/core/planner/aetr';
import {
  CORRIDOR_RADIUS_KM,
  CORRIDOR_STEP_KM,
  getParkingsAlongRoute,
  type RoutedParking,
} from '../../src/core/planner/corridor';
import { planTrip, type PlanResult } from '../../src/core/planner/schedule';
import type { GeoPoint } from '../../src/core/types';
import { recordRequests } from './helpers';

// Фаза 3, шаг 2: парковки вдоль всего маршрута для карты. Всё через MSW, как в фазе 1.

const WARSAW = { lat: 52.2297, lon: 21.0122 };
const FRANKFURT = { lat: 50.1109, lon: 8.6821 };
const DEPART_AT = '2026-09-07T06:00:00+02:00';
const TRIP = { origin: WARSAW, destination: FRANKFURT, departureAt: DEPART_AT, vehicleWeightKg: 40_000 };

type Ok = Extract<PlanResult, { status: 'ok' }>;

/** Реальный план Варшава → Франкфурт: 181 точка, 2 остановки (см. contract.test.ts). */
async function okPlan(): Promise<Ok> {
  const r = await planTrip(TRIP);
  if (r.status !== 'ok') throw new Error(`ожидался ok, получен conflict: ${r.conflict.reason}`);
  return r;
}

function alongRoute(plan: Ok, over: Partial<Parameters<typeof getParkingsAlongRoute>[0]> = {}) {
  return getParkingsAlongRoute({
    points: plan.route.points,
    departureAt: plan.departureAt,
    drivingTimeSec: plan.drivingTimeSec,
    stops: plan.stops,
    ...over,
  });
}

function totalMeters(points: GeoPoint[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += haversineMeters(points[i - 1], points[i]);
  return m;
}

function query(req: Request): Record<string, string> {
  return Object.fromEntries(new URL(req.url).searchParams);
}

function parkingRequests(requests: Request[]): Request[] {
  return requests.filter((r) => new URL(r.url).host === 'mock.convoy-mind.local');
}

describe('getParkingsAlongRoute (фаза 3, шаг 2) — критерий 3a.2', () => {
  test('число запросов = ceil(длина / stepKm), радиус = corridorKm, at растёт вдоль маршрута', async () => {
    const plan = await okPlan();
    const expectedCalls = Math.ceil(totalMeters(plan.route.points) / (CORRIDOR_STEP_KM * 1000));
    expect(expectedCalls).toBe(36); // 890 км / 25 км — зафиксировано, чтобы поймать смену геометрии мока

    const rec = recordRequests();
    try {
      await alongRoute(plan);
      const reqs = parkingRequests(rec.requests);
      expect(reqs).toHaveLength(expectedCalls);

      const ats = reqs.map((r) => Date.parse(query(r).at));
      for (const r of reqs) expect(query(r).radiusKm).toBe(String(CORRIDOR_RADIUS_KM));
      expect(ats).toEqual([...ats].sort((a, b) => a - b));
      expect(ats[0]).toBe(Date.parse(DEPART_AT));
      // Последний запрос — после обеих пауз, но раньше приезда.
      expect(ats[ats.length - 1]).toBeGreaterThan(Date.parse(DEPART_AT) + 2 * BREAK_SEC * 1000);
      expect(ats[ats.length - 1]).toBeLessThan(Date.parse(plan.arrivalAt));
    } finally {
      rec.stop();
    }
  });

  test('дедуп по id и сортировка по прогрессу вдоль маршрута', async () => {
    const plan = await okPlan();
    const result = await alongRoute(plan);

    expect(result.length).toBeGreaterThanOrEqual(10); // критерий 3b: на карте >= 10 маркеров
    expect(new Set(result.map((p) => p.id)).size).toBe(result.length);
    expect(result.map((p) => p.routeProgressM)).toEqual([...result].sort((a, b) => a.routeProgressM - b.routeProgressM).map((p) => p.routeProgressM));

    const totalM = totalMeters(plan.route.points);
    for (const p of result) {
      expect(p.routeProgressM).toBeGreaterThanOrEqual(0);
      expect(p.routeProgressM).toBeLessThanOrEqual(totalM);
      // etaAt внутри поездки.
      expect(Date.parse(p.etaAt)).toBeGreaterThanOrEqual(Date.parse(DEPART_AT));
      expect(Date.parse(p.etaAt)).toBeLessThanOrEqual(Date.parse(plan.arrivalAt));
    }
  });

  test('chosen — ровно парковки остановок плана; status — из freeAt', async () => {
    const plan = await okPlan();
    const result = await alongRoute(plan);

    const chosenIds = result.filter((p) => p.chosen).map((p) => p.id).sort();
    expect(chosenIds).toEqual(plan.stops.map((s) => s.parking.id).sort());
    expect(chosenIds).toHaveLength(2);

    for (const p of result) {
      expect(p.status).toBe(p.freeAt >= 1 ? 'free' : 'full');
    }
    // Выбранные планировщиком парковки на карте свободны (днём).
    for (const p of result.filter((x) => x.chosen)) expect(p.status).toBe('free');
  });

  test('etaAt выбранной парковки — приезд на остановку, а не отъезд после перерыва', async () => {
    const plan = await okPlan();
    const result = await alongRoute(plan);

    for (const stop of plan.stops) {
      const onMap = result.find((p) => p.id === stop.parking.id);
      expect(onMap).toBeDefined();
      // Пропорция по расстоянию против реальных времён плеч TomTom — расхождение секунды на моке,
      // допуск 5 мин на случай реального API (NOT_NOW: «точное время по точкам»).
      const deltaSec = Math.abs(Date.parse(onMap!.etaAt) - Date.parse(stop.arrivalAt)) / 1000;
      expect(deltaSec).toBeLessThan(5 * 60);
      // Отъезд с остановки на 45 мин позже — etaAt не должен совпасть с ним.
      expect(Math.abs(Date.parse(onMap!.etaAt) - Date.parse(stop.departAt)) / 1000).toBeGreaterThan(BREAK_SEC / 2);
    }
  });

  test("сценарий 'all-full' → все парковки коридора status 'full'", async () => {
    const plan = await okPlan();
    setMockScenario('all-full');
    const result = await alongRoute(plan);

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.status === 'full')).toBe(true);
    expect(result.every((p) => p.freeAt === 0)).toBe(true);
  });

  test('парковка коридора — та же, что отдаёт getParkingsNear по её же координатам (сетка стабильна)', async () => {
    const plan = await okPlan();
    const result = await alongRoute(plan);
    const sample = result[Math.floor(result.length / 2)];

    const near = await getParkingsNear({ lat: sample.lat, lon: sample.lon, radiusKm: 1, at: sample.etaAt });
    const same = near.find((p) => p.id === sample.id);
    expect(same).toBeDefined();
    expect(same!.capacityTotal).toBe(sample.capacityTotal);
    expect(same!.lat).toBe(sample.lat);
    expect(same!.lon).toBe(sample.lon);
  });

  test('stepKm и corridorKm переопределяются; меньший шаг — не меньше парковок', async () => {
    const plan = await okPlan();
    const rec = recordRequests();
    try {
      const dense = await alongRoute(plan, { stepKm: 50, corridorKm: 30 });
      const reqs = parkingRequests(rec.requests);
      expect(reqs).toHaveLength(Math.ceil(totalMeters(plan.route.points) / 50_000));
      for (const r of reqs) expect(query(r).radiusKm).toBe('30');

      const sparse = await alongRoute(plan);
      // Коридор 30 км шире, чем 15 км, — множество парковок не меньше.
      expect(dense.length).toBeGreaterThanOrEqual(sparse.length);
    } finally {
      rec.stop();
    }
  });

  test('плохой вход — throw, без сети', async () => {
    const plan = await okPlan();
    const rec = recordRequests();
    try {
      const base = { points: plan.route.points, departureAt: DEPART_AT, drivingTimeSec: 100, stops: [] };
      await expect(getParkingsAlongRoute({ ...base, points: [WARSAW] })).rejects.toThrow(/at least 2 points/);
      await expect(getParkingsAlongRoute({ ...base, drivingTimeSec: -1 })).rejects.toThrow(/drivingTimeSec/);
      await expect(getParkingsAlongRoute({ ...base, departureAt: 'nope' })).rejects.toThrow(/departureAt/);
      await expect(getParkingsAlongRoute({ ...base, stepKm: 0 })).rejects.toThrow(/stepKm/);
      await expect(getParkingsAlongRoute({ ...base, corridorKm: -5 })).rejects.toThrow(/corridorKm/);
      expect(parkingRequests(rec.requests)).toHaveLength(0);
    } finally {
      rec.stop();
    }
  });

  // Подготовка к шагу 7 (polling на карте): проверяем в ядре то, что на экране проверить нечем.
  test("сценарий 'live': за минуту меняется статус хотя бы одного маркера, id не прыгают", async () => {
    const plan = await okPlan();
    setMockScenario('live');
    const spy = jest.spyOn(Date, 'now');
    try {
      const t0 = Math.floor(Date.now() / MOCK_LIVE_TICK_MS) * MOCK_LIVE_TICK_MS;
      spy.mockReturnValue(t0);
      const before = await alongRoute(plan);
      spy.mockReturnValue(t0 + MOCK_LIVE_TICK_MS);
      const after = await alongRoute(plan);

      expect(after.map((p) => p.id)).toEqual(before.map((p) => p.id)); // маркеры остаются на местах
      const prev = new Map(before.map((p) => [p.id, p]));
      expect(after.filter((p) => prev.get(p.id)!.status !== p.status).length).toBeGreaterThanOrEqual(1);
      expect(after.filter((p) => prev.get(p.id)!.freeAt !== p.freeAt).length).toBeGreaterThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  test('повторный вызов с тем же входом даёт тот же набор id и порядок (мок детерминирован)', async () => {
    const plan = await okPlan();
    const a = await alongRoute(plan);
    const b = await alongRoute(plan);
    const ids = (r: RoutedParking[]) => r.map((p) => p.id);
    expect(ids(b)).toEqual(ids(a));
  });
});
