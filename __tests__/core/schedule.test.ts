import { http, HttpResponse } from 'msw';
import type { Parking, RouteResponse } from '../../src/core/api/types';
import { haversineMeters } from '../../src/core/geo';
import { PARKINGS_PATTERN, TOMTOM_CALCULATE_ROUTE_PATTERN } from '../../src/core/mocks/handlers';
import { generateParkings } from '../../src/core/mocks/parkingGenerator';
import { generateRoute } from '../../src/core/mocks/routeGenerator';
import { setMockScenario } from '../../src/core/mocks/scenario';
import { server } from '../../src/core/mocks/server';
import { BREAK_SEC, MAX_CONTINUOUS_DRIVING_SEC, MAX_DAILY_DRIVING_SEC } from '../../src/core/planner/aetr';
import { placeBreakAnchors } from '../../src/core/planner/breaks';
import {
  CONFLICT_SEARCH_RADIUS_KM,
  MAX_ARRIVAL_SHIFT_SEC,
  PARKING_SEARCH_RADIUS_KM,
  planTrip,
  type PlanResult,
  type TripInput,
} from '../../src/core/planner/schedule';
import type { GeoPoint } from '../../src/core/types';
import { recordRequests } from './helpers';

const WARSAW = { lat: 52.2297, lon: 21.0122 };
const FRANKFURT = { lat: 50.1109, lon: 8.6821 };
const LODZ = { lat: 51.7592, lon: 19.456 };
const PARIS = { lat: 48.8566, lon: 2.3522 };
const DEPART_AT = '2026-09-07T06:00:00+02:00';
const TRIP: TripInput = { origin: WARSAW, destination: FRANKFURT, departureAt: DEPART_AT, vehicleWeightKg: 40_000 };

// --- helpers -----------------------------------------------------------------------------------

function split(requests: Request[]) {
  const byHost = (host: string) => requests.filter((r) => new URL(r.url).host === host);
  return { tomtom: byHost('api.tomtom.com'), parking: byHost('mock.convoy-mind.local') };
}

function locationsOf(req: Request): string[] {
  return new URL(req.url).pathname.split('/').at(-2)!.split(':');
}

function query(req: Request): Record<string, string> {
  return Object.fromEntries(new URL(req.url).searchParams);
}

/** Ожидаемые якоря — тем же путём, что внутри planTrip, но без сети. */
function expectedAnchors(origin: GeoPoint, destination: GeoPoint) {
  const route = generateRoute({ locations: [origin, destination], departAt: DEPART_AT, pausesSec: [0] }).routes[0];
  const points = route.legs.flatMap((l) => l.points.map((p) => ({ lat: p.latitude, lon: p.longitude })));
  return placeBreakAnchors({ points, travelTimeSec: route.summary.travelTimeInSeconds, departureAt: DEPART_AT });
}

/** Точки маршрута мока тем же путём, что внутри planTrip, но без сети. */
function expectedRoutePoints(locations: GeoPoint[], pausesSec: number[]): GeoPoint[] {
  const route = generateRoute({ locations, departAt: DEPART_AT, pausesSec }).routes[0];
  return route.legs.flatMap((l) => l.points.map((p) => ({ lat: p.latitude, lon: p.longitude })));
}

/** Маршрут A → B без waypoints — с ним сравнивается геометрия второго вызова. */
function expectedRoutePointsAB(): GeoPoint[] {
  return expectedRoutePoints([WARSAW, FRANKFURT], [0]);
}

function expectOk(result: PlanResult): Extract<PlanResult, { status: 'ok' }> {
  if (result.status !== 'ok') throw new Error(`expected ok, got conflict: ${result.conflict.reason}`);
  return result;
}

function expectConflict(result: PlanResult): Extract<PlanResult, { status: 'conflict' }> {
  if (result.status !== 'conflict') throw new Error('expected conflict, got ok');
  return result;
}

const shiftIso = (iso: string, sec: number) => new Date(Date.parse(iso) + sec * 1000).toISOString();

/** Удлиняет плечи маршрута на delaysSec[i] секунд, сдвигая все последующие времена (как трафик). */
function delayLegs(res: RouteResponse, delaysSec: number[]): RouteResponse {
  const route = res.routes[0];
  let acc = 0;
  for (const [i, leg] of route.legs.entries()) {
    leg.summary.departureTime = shiftIso(leg.summary.departureTime, acc);
    acc += delaysSec[i] ?? 0;
    leg.summary.travelTimeInSeconds += delaysSec[i] ?? 0;
    leg.summary.arrivalTime = shiftIso(leg.summary.arrivalTime, acc);
  }
  route.summary.travelTimeInSeconds += acc;
  route.summary.arrivalTime = shiftIso(route.summary.arrivalTime, acc);
  return res;
}

/** Override TomTom только для вызова с waypoints: плечи удлиняются на delaysSec; остальное проваливается в штатный handler. */
function delaySecondCall(delaysSec: number[]) {
  server.use(
    http.post(TOMTOM_CALCULATE_ROUTE_PATTERN, async ({ request, params }) => {
      const locations = String(params.locations)
        .split(':')
        .map((pair) => {
          const [lat, lon] = pair.split(',').map(Number);
          return { lat, lon };
        });
      if (locations.length <= 2) return undefined;
      const body = (await request.json()) as { legs: { routeStop: { pauseTimeInSeconds: number } }[] };
      const departAt = new URL(request.url).searchParams.get('departAt')!;
      const res = generateRoute({ locations, departAt, pausesSec: body.legs.map((l) => l.routeStop.pauseTimeInSeconds) });
      return HttpResponse.json(delayLegs(res, delaysSec));
    })
  );
}

function parkingsFor(q: Record<string, string>): Parking[] {
  return generateParkings({ lat: Number(q.lat), lon: Number(q.lon), radiusKm: Number(q.radiusKm), at: q.at, now: Date.now() });
}

// --- criterion tests ---------------------------------------------------------------------------

describe('planTrip (шаг 7) — критерий «работает»', () => {
  test('happy path: ~9 ч → ok, ровно 2 остановки по 45 мин, 2 вызова TomTom, 2 вызова parking', async () => {
    const rec = recordRequests();
    try {
      const result = expectOk(await planTrip(TRIP));
      const anchors = expectedAnchors(WARSAW, FRANKFURT);
      expect(anchors).toHaveLength(2);

      // Результат.
      expect(result.departureAt).toBe(DEPART_AT);
      expect(result.stops).toHaveLength(2);
      expect(Date.parse(result.arrivalAt)).toBeGreaterThan(Date.parse(DEPART_AT));
      expect(result.requiresDailyRest).toBe(false);
      expect(result.drivingTimeSec).toBeGreaterThan(8.5 * 3600);
      expect(result.drivingTimeSec).toBeLessThan(MAX_DAILY_DRIVING_SEC);
      // Мок: приезд = выезд + вождение + две паузы.
      expect(Date.parse(result.arrivalAt)).toBe(Date.parse(DEPART_AT) + (result.drivingTimeSec + 2 * BREAK_SEC) * 1000);
      for (const [i, stop] of result.stops.entries()) {
        expect(stop.pauseSec).toBe(BREAK_SEC);
        expect(stop.parking.freeAt).toBeGreaterThanOrEqual(1);
        expect(Date.parse(stop.departAt)).toBe(Date.parse(stop.arrivalAt) + BREAK_SEC * 1000);
        expect(stop.drivingSecFromPrev).toBeLessThanOrEqual(MAX_CONTINUOUS_DRIVING_SEC);
        expect(haversineMeters(anchors[i], stop.parking)).toBeLessThanOrEqual(PARKING_SEARCH_RADIUS_KM * 1000 + 50);
        expect(Math.abs(Date.parse(stop.arrivalAt) - Date.parse(anchors[i].plannedArrivalAt)) / 1000).toBeLessThanOrEqual(
          MAX_ARRIVAL_SHIFT_SEC
        );
      }
      expect(Date.parse(result.stops[1].arrivalAt)).toBeGreaterThan(Date.parse(result.stops[0].departAt));

      // Сеть: ровно 2 вызова TomTom.
      const { tomtom, parking } = split(rec.requests);
      expect(tomtom).toHaveLength(2);
      expect(locationsOf(tomtom[0])).toEqual([`${WARSAW.lat},${WARSAW.lon}`, `${FRANKFURT.lat},${FRANKFURT.lon}`]);
      await expect(tomtom[0].json()).resolves.toEqual({ legs: [{ routeStop: { pauseTimeInSeconds: 0 } }] });
      expect(locationsOf(tomtom[1])).toEqual([
        `${WARSAW.lat},${WARSAW.lon}`,
        ...result.stops.map((s) => `${s.parking.lat},${s.parking.lon}`),
        `${FRANKFURT.lat},${FRANKFURT.lon}`,
      ]);
      await expect(tomtom[1].json()).resolves.toEqual({
        legs: [
          { routeStop: { pauseTimeInSeconds: BREAK_SEC } },
          { routeStop: { pauseTimeInSeconds: BREAK_SEC } },
          { routeStop: { pauseTimeInSeconds: 0 } },
        ],
      });
      for (const req of tomtom) expect(query(req)).toMatchObject({ key: 'test-key', apiVersion: '2', departAt: DEPART_AT, traffic: 'live' });

      // Сеть: ровно 2 вызова parking — по якорю, радиус 25, at = плановый приезд.
      expect(parking).toHaveLength(2);
      for (const [i, req] of parking.entries()) {
        expect(req.method).toBe('GET');
        expect(query(req)).toEqual({
          lat: String(anchors[i].lat),
          lon: String(anchors[i].lon),
          radiusKm: String(PARKING_SEARCH_RADIUS_KM),
          at: anchors[i].plannedArrivalAt,
        });
      }
    } finally {
      rec.stop();
    }
  });

  // Фаза 3, шаг 1: геометрия в результате — для карты на экране 3.
  test('route.points: первая точка = origin, последняя = destination, >= 100 точек', async () => {
    const result = expectOk(await planTrip(TRIP));
    const points = result.route.points;

    expect(points.length).toBeGreaterThanOrEqual(100);
    expect(points[0]).toEqual(WARSAW);
    expect(points[points.length - 1]).toEqual(FRANKFURT);
    // Геометрия — последнего вызова TomTom (через парковки), а не первого: каждая остановка
    // лежит на полилинии, поэтому точек больше, чем в маршруте A → B без waypoints.
    expect(points.length).toBeGreaterThan(expectedRoutePointsAB().length);
    for (const stop of result.stops) {
      expect(points).toContainEqual({ lat: stop.parking.lat, lon: stop.parking.lon });
    }
  });

  test('route.points на коротком маршруте без остановок — из единственного вызова TomTom', async () => {
    const result = expectOk(await planTrip({ ...TRIP, destination: LODZ }));

    expect(result.stops).toEqual([]);
    expect(result.route.points[0]).toEqual(WARSAW);
    expect(result.route.points[result.route.points.length - 1]).toEqual(LODZ);
    expect(result.route.points).toEqual(
      expectedRoutePoints([WARSAW, LODZ], [0])
    );
  });

  test("конфликт: все парковки заняты → status 'conflict', reason, без nearestFreeParking; второго вызова TomTom нет", async () => {
    setMockScenario('all-full');
    const rec = recordRequests();
    try {
      const { conflict } = expectConflict(await planTrip(TRIP));
      const [anchor1] = expectedAnchors(WARSAW, FRANKFURT);

      expect(conflict.code).toBe('no-free-parking');
      expect(conflict.reason).toContain(anchor1.plannedArrivalAt);
      expect(conflict.reason).toContain(`${PARKING_SEARCH_RADIUS_KM} km`);
      expect(conflict.anchor).toEqual(anchor1);
      expect(conflict.nearestFreeParking).toBeUndefined();

      const { tomtom, parking } = split(rec.requests);
      expect(tomtom).toHaveLength(1);
      expect(parking.map((r) => query(r).radiusKm)).toEqual([String(PARKING_SEARCH_RADIUS_KM), String(CONFLICT_SEARCH_RADIUS_KM)]);
      expect(query(parking[1])).toMatchObject({ lat: String(anchor1.lat), lon: String(anchor1.lon), at: anchor1.plannedArrivalAt });
    } finally {
      rec.stop();
    }
  });
});

// --- edge cases --------------------------------------------------------------------------------

describe('planTrip (шаг 7) — краевые случаи', () => {
  test('конфликт с nearestFreeParking: в 25 км всё занято, в 50 км есть свободная', async () => {
    server.use(
      http.get(PARKINGS_PATTERN, ({ request }) => {
        const q = query(request);
        if (q.radiusKm !== String(PARKING_SEARCH_RADIUS_KM)) return undefined; // 50 км — штатный handler
        return HttpResponse.json({ parkings: parkingsFor(q).map((p) => ({ ...p, freeAt: 0 })) });
      })
    );
    const rec = recordRequests();
    try {
      const { conflict } = expectConflict(await planTrip(TRIP));
      const [anchor1] = expectedAnchors(WARSAW, FRANKFURT);

      expect(conflict.code).toBe('no-free-parking');
      expect(conflict.nearestFreeParking).toBeDefined();
      expect(conflict.nearestFreeParking!.freeAt).toBeGreaterThanOrEqual(1);
      expect(haversineMeters(anchor1, conflict.nearestFreeParking!)).toBeLessThanOrEqual(CONFLICT_SEARCH_RADIUS_KM * 1000 + 50);
      expect(split(rec.requests).parking).toHaveLength(2);
    } finally {
      rec.stop();
    }
  });

  test('короткий маршрут (Варшава → Лодзь): ok без остановок, 1 вызов TomTom, 0 вызовов parking', async () => {
    const rec = recordRequests();
    try {
      const result = expectOk(await planTrip({ ...TRIP, destination: LODZ }));

      expect(result.stops).toEqual([]);
      expect(result.requiresDailyRest).toBe(false);
      expect(result.drivingTimeSec).toBeLessThan(MAX_CONTINUOUS_DRIVING_SEC);
      expect(Date.parse(result.arrivalAt)).toBe(Date.parse(DEPART_AT) + result.drivingTimeSec * 1000);

      const { tomtom, parking } = split(rec.requests);
      expect(tomtom).toHaveLength(1);
      expect(parking).toHaveLength(0);
    } finally {
      rec.stop();
    }
  });

  test('сдвиг приезда > 30 мин на второй остановке → повторный запрос parking по новому времени → ok', async () => {
    // +15 мин на первом плече, +16 на втором: остановка 1 сдвинута < 30 мин, остановка 2 — > 30 мин, оба плеча ≤ 4:30.
    delaySecondCall([15 * 60, 16 * 60]);
    const rec = recordRequests();
    try {
      const result = expectOk(await planTrip(TRIP));
      const anchors = expectedAnchors(WARSAW, FRANKFURT);

      expect(result.stops).toHaveLength(2);
      const shift2 = (Date.parse(result.stops[1].arrivalAt) - Date.parse(anchors[1].plannedArrivalAt)) / 1000;
      expect(shift2).toBeGreaterThan(MAX_ARRIVAL_SHIFT_SEC);

      const { tomtom, parking } = split(rec.requests);
      expect(tomtom).toHaveLength(2);
      expect(parking).toHaveLength(3);
      expect(query(parking[2])).toEqual({
        lat: String(anchors[1].lat),
        lon: String(anchors[1].lon),
        radiusKm: String(PARKING_SEARCH_RADIUS_KM),
        at: result.stops[1].arrivalAt,
      });
    } finally {
      rec.stop();
    }
  });

  test("сдвиг > 30 мин и выбранная парковка занята на новое время → 'parking-lost-after-reroute' с nearestFreeParking", async () => {
    delaySecondCall([15 * 60, 16 * 60]);
    let parkingCalls = 0;
    server.use(
      http.get(PARKINGS_PATTERN, ({ request }) => {
        parkingCalls++;
        if (parkingCalls !== 3) return undefined; // штатный handler; третий вызов — повторная проверка остановки 2
        const q = query(request);
        const anchor = { lat: Number(q.lat), lon: Number(q.lon) };
        const parkings = parkingsFor(q);
        const nearest = parkings.reduce((a, b) => (haversineMeters(anchor, a) <= haversineMeters(anchor, b) ? a : b));
        return HttpResponse.json({ parkings: parkings.map((p) => (p.id === nearest.id ? { ...p, freeAt: 0 } : p)) });
      })
    );

    const { conflict } = expectConflict(await planTrip(TRIP));
    const anchors = expectedAnchors(WARSAW, FRANKFURT);

    expect(conflict.code).toBe('parking-lost-after-reroute');
    expect(conflict.anchor).toEqual(anchors[1]);
    expect(conflict.reason).toMatch(/moved by \d+ min/);
    expect(conflict.nearestFreeParking).toBeDefined();
    expect(conflict.nearestFreeParking!.freeAt).toBeGreaterThanOrEqual(1);
    expect(parkingCalls).toBe(3);
  });

  test("плечо длиннее 4:30 после перестроения → 'leg-exceeds-continuous-limit'", async () => {
    delaySecondCall([40 * 60]); // первое плечо ≈ 4:13 + 40 мин > 4:30; сдвиг остановки 1 > 30 мин → повторный запрос (свободно) → проверка плеч
    const { conflict } = expectConflict(await planTrip(TRIP));
    const anchors = expectedAnchors(WARSAW, FRANKFURT);

    expect(conflict.code).toBe('leg-exceeds-continuous-limit');
    expect(conflict.anchor).toEqual(anchors[0]);
    expect(conflict.reason).toMatch(/Driving leg 1 takes 4:5\d, more than the 4:30/);
    expect(conflict.nearestFreeParking).toBeUndefined();
  });

  test('маршрут дольше 9 ч (Варшава → Париж): ok, 3 остановки, requiresDailyRest: true', async () => {
    const result = expectOk(await planTrip({ ...TRIP, destination: PARIS }));

    expect(result.stops).toHaveLength(3);
    expect(result.requiresDailyRest).toBe(true);
    expect(result.drivingTimeSec).toBeGreaterThanOrEqual(MAX_DAILY_DRIVING_SEC);
    for (const stop of result.stops) expect(stop.drivingSecFromPrev).toBeLessThanOrEqual(MAX_CONTINUOUS_DRIVING_SEC);
  });

  test('плохой вход — ошибка до сети', async () => {
    const rec = recordRequests();
    try {
      await expect(planTrip({ ...TRIP, departureAt: 'nope' })).rejects.toThrow('departureAt');
      await expect(planTrip({ ...TRIP, vehicleWeightKg: 0 })).rejects.toThrow('vehicleWeightKg');
      await expect(planTrip({ ...TRIP, origin: { lat: Number.NaN, lon: 1 } })).rejects.toThrow('origin');
      expect(rec.requests).toHaveLength(0);
    } finally {
      rec.stop();
    }
  });
});
