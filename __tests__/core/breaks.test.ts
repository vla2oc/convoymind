import { haversineMeters } from '../../src/core/geo';
import { generateRoute } from '../../src/core/mocks/routeGenerator';
import { BREAK_SEC, MAX_CONTINUOUS_DRIVING_SEC } from '../../src/core/planner/aetr';
import { ANCHOR_THRESHOLD_SEC, BREAK_LOOKAHEAD_MIN, placeBreakAnchors } from '../../src/core/planner/breaks';
import type { GeoPoint } from '../../src/core/types';

const hm = (h: number, m: number) => h * 3600 + m * 60;
const DEPART_AT = '2026-09-07T06:00:00+02:00';
const DEPART_MS = Date.parse(DEPART_AT);
const START: GeoPoint = { lat: 50.0, lon: 10.0 };
// Метры на градус широты при радиусе Земли из geo.ts (6 371 008.8 м): по меридиану haversine линеен.
const M_PER_DEG_LAT = (Math.PI / 180) * 6_371_008.8;

/** Меридиан от START на север длиной km, точки через stepKm (обе концевые включены). */
function meridian(km: number, stepKm: number): GeoPoint[] {
  const n = Math.round(km / stepKm);
  return Array.from({ length: n + 1 }, (_, i) => ({ lat: START.lat + (i * stepKm * 1000) / M_PER_DEG_LAT, lon: START.lon }));
}

test('константы: порог якоря = 4:30 − 20 мин = 4:10', () => {
  expect(BREAK_LOOKAHEAD_MIN).toBe(20);
  expect(ANCHOR_THRESHOLD_SEC).toBe(MAX_CONTINUOUS_DRIVING_SEC - hm(0, 20));
  expect(ANCHOR_THRESHOLD_SEC).toBe(hm(4, 10));
});

describe('placeBreakAnchors — прямая 900 км за 9 ч (шаг 6)', () => {
  const points = meridian(900, 5);
  const travelTimeSec = hm(9, 0);

  test('дистанция синтетики ≈ 900 км', () => {
    expect(points).toHaveLength(181);
    expect(haversineMeters(points[0], points.at(-1)!)).toBeCloseTo(900_000, -2); // ±50 м
  });

  test('два якоря: 4:10 и 8:20 вождения, ≈ 416.7 и ≈ 833.3 км от старта', () => {
    const anchors = placeBreakAnchors({ points, travelTimeSec, departureAt: DEPART_AT });

    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toMatchObject({ drivenSecFromPrev: hm(4, 10), drivenSecFromStart: hm(4, 10) });
    expect(anchors[1]).toMatchObject({ drivenSecFromPrev: hm(4, 10), drivenSecFromStart: hm(8, 20) });

    expect(haversineMeters(START, anchors[0])).toBeCloseTo(416_667, -3); // ±500 м
    expect(haversineMeters(START, anchors[1])).toBeCloseTo(833_333, -3);
    expect(anchors[0].lon).toBe(START.lon);

    // Приезд на второй якорь учитывает 45 мин паузы на первом.
    expect(Date.parse(anchors[0].plannedArrivalAt)).toBe(DEPART_MS + hm(4, 10) * 1000);
    expect(Date.parse(anchors[1].plannedArrivalAt)).toBe(DEPART_MS + (hm(8, 20) + BREAK_SEC) * 1000);
    expect(anchors[0].plannedArrivalAt).toMatch(/Z$/);
  });

  test('те же 900 км двумя точками → те же якоря (интерполяция внутри одного сегмента)', () => {
    const two = [points[0], points.at(-1)!];
    const anchors = placeBreakAnchors({ points: two, travelTimeSec, departureAt: DEPART_AT });
    const dense = placeBreakAnchors({ points, travelTimeSec, departureAt: DEPART_AT });

    expect(anchors).toHaveLength(2);
    expect(anchors.map((a) => a.drivenSecFromStart)).toEqual([hm(4, 10), hm(8, 20)]);
    expect(anchors[0].lat).toBeCloseTo(dense[0].lat, 4);
    expect(anchors[1].lat).toBeCloseTo(dense[1].lat, 4);
  });
});

describe('placeBreakAnchors — реальный вывод мока TomTom Варшава → Франкфурт', () => {
  const WARSAW = { lat: 52.2297, lon: 21.0122 };
  const FRANKFURT = { lat: 50.1109, lon: 8.6821 };

  test('8:54 вождения → два якоря на 4:10 и 8:20, между стартом и финишем', () => {
    const route = generateRoute({ locations: [WARSAW, FRANKFURT], departAt: DEPART_AT, pausesSec: [0] }).routes[0];
    const points = route.legs.flatMap((leg) => leg.points.map((p) => ({ lat: p.latitude, lon: p.longitude })));
    const travelTimeSec = route.summary.travelTimeInSeconds;
    expect(travelTimeSec).toBeGreaterThan(hm(8, 40)); // иначе второго якоря не будет
    expect(travelTimeSec).toBeLessThan(hm(9, 0));

    const anchors = placeBreakAnchors({ points, travelTimeSec, departureAt: DEPART_AT });

    expect(anchors.map((a) => a.drivenSecFromStart)).toEqual([hm(4, 10), hm(8, 20)]);
    for (const a of anchors) {
      expect(a.lat).toBeLessThan(WARSAW.lat);
      expect(a.lat).toBeGreaterThan(FRANKFURT.lat);
      expect(a.lon).toBeLessThan(WARSAW.lon);
      expect(a.lon).toBeGreaterThan(FRANKFURT.lon);
    }
    expect(Date.parse(anchors[1].plannedArrivalAt)).toBe(DEPART_MS + (hm(8, 20) + BREAK_SEC) * 1000);
  });
});

describe('placeBreakAnchors — границы (правило: якорь не нужен, если до финиша < 4:30 от предыдущего)', () => {
  const points = meridian(1000, 5);
  const count = (travelTimeSec: number) =>
    placeBreakAnchors({ points, travelTimeSec, departureAt: DEPART_AT }).length;

  test.each([
    [hm(4, 0), 0],
    [hm(4, 29), 0],
    [hm(4, 30), 1],
    [hm(4, 31), 1],
    [hm(8, 39), 1],
    [hm(8, 40), 2],
    [hm(9, 0), 2],
  ])('вождение %i с → %i якорей', (travelTimeSec, expected) => {
    expect(count(travelTimeSec)).toBe(expected);
  });
});

describe('placeBreakAnchors — вырожденный и плохой вход', () => {
  test('нулевое время → []', () => {
    expect(placeBreakAnchors({ points: meridian(100, 5), travelTimeSec: 0, departureAt: DEPART_AT })).toEqual([]);
  });
  test('все точки совпадают → []', () => {
    expect(placeBreakAnchors({ points: [START, START, START], travelTimeSec: hm(9, 0), departureAt: DEPART_AT })).toEqual([]);
  });
  test('одна точка → ошибка', () => {
    expect(() => placeBreakAnchors({ points: [START], travelTimeSec: 1, departureAt: DEPART_AT })).toThrow('2 points');
  });
  test('отрицательное время → ошибка', () => {
    expect(() => placeBreakAnchors({ points: meridian(100, 5), travelTimeSec: -1, departureAt: DEPART_AT })).toThrow('travelTimeSec');
  });
  test('плохая дата → ошибка', () => {
    expect(() => placeBreakAnchors({ points: meridian(100, 5), travelTimeSec: 1, departureAt: 'nope' })).toThrow('departureAt');
  });
});
