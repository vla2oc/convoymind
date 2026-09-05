import { calculateRoute } from '../../src/core/api/tomtom';
import type { RouteResponse } from '../../src/core/api/types';
import fixture from '../../src/core/mocks/fixtures/tomtom_route_example.json';
import { MOCK_AVG_SPEED_KMH } from '../../src/core/mocks/routeGenerator';
import { recordRequests } from './helpers';

const WARSAW = { lat: 52.2297, lon: 21.0122 };
const FRANKFURT = { lat: 50.1109, lon: 8.6821 };
const DEPART_AT = '2026-09-07T06:00:00+02:00';
const BASE_PATH = '/maps/orbis/routing/calculateRoute';

// Шаг 2: фикстура из документации TomTom парсится в наши типы (лишние поля документация велит игнорировать).
test('пример ответа из документации совместим с RouteResponse', () => {
  const res: RouteResponse = fixture;

  expect(res.formatVersion).toBe('0.0.12');
  expect(res.routes).toHaveLength(1);
  expect(res.routes[0].summary).toMatchObject({
    lengthInMeters: 1147,
    travelTimeInSeconds: 161,
    departureTime: '2015-04-02T15:01:57+02:00',
    arrivalTime: '2015-04-02T15:04:38+02:00',
  });
  expect(res.routes[0].legs[0].points[0]).toEqual({ latitude: 52.5093087, longitude: 13.4293737 });
});

describe('calculateRoute (шаг 3)', () => {
  test('без waypoints: POST, координаты в пути, query по документации, одно плечо с паузой 0', async () => {
    const rec = recordRequests();
    try {
      const res = await calculateRoute({
        origin: WARSAW,
        destination: FRANKFURT,
        departAt: DEPART_AT,
        vehicleWeightKg: 40_000,
      });

      expect(rec.requests).toHaveLength(1);
      const req = rec.requests[0];
      const url = new URL(req.url);
      expect(req.method).toBe('POST');
      expect(url.origin).toBe('https://api.tomtom.com');
      expect(url.pathname).toBe(`${BASE_PATH}/52.2297,21.0122:50.1109,8.6821/json`);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        key: 'test-key',
        apiVersion: '2',
        departAt: DEPART_AT,
        traffic: 'live',
        vehicleWeight: '40000',
        travelMode: 'car',
        routeRepresentation: 'polyline',
      });
      expect(req.headers.get('content-type')).toBe('application/json');
      await expect(req.json()).resolves.toEqual({ legs: [{ routeStop: { pauseTimeInSeconds: 0 } }] });

      const route = res.routes[0];
      expect(route.legs).toHaveLength(1);
      // Варшава — Франкфурт по прямой ≈ 890 км → ~9 ч при 100 км/ч.
      expect(route.summary.lengthInMeters).toBeGreaterThan(850_000);
      expect(route.summary.lengthInMeters).toBeLessThan(950_000);
      expect(route.summary.travelTimeInSeconds).toBe(
        Math.round(route.summary.lengthInMeters / ((MOCK_AVG_SPEED_KMH * 1000) / 3600))
      );
      expect(Date.parse(route.summary.departureTime)).toBe(Date.parse(DEPART_AT));
      expect(Date.parse(route.summary.arrivalTime)).toBe(
        Date.parse(DEPART_AT) + route.summary.travelTimeInSeconds * 1000
      );
      expect(route.legs[0].points.length).toBeGreaterThan(100);
      expect(route.legs[0].points[0]).toEqual({ latitude: WARSAW.lat, longitude: WARSAW.lon });
      expect(route.legs[0].points.at(-1)).toEqual({ latitude: FRANKFURT.lat, longitude: FRANKFURT.lon });
    } finally {
      rec.stop();
    }
  });

  test('с двумя waypoints и паузой 2700: тело legs = [2700, 2700, 0], три плеча, даты с учётом пауз', async () => {
    const stop1 = { lat: 51.4, lon: 16.2 };
    const stop2 = { lat: 50.5, lon: 10.9 };
    const rec = recordRequests();
    try {
      const res = await calculateRoute({
        origin: WARSAW,
        destination: FRANKFURT,
        waypoints: [stop1, stop2],
        departAt: DEPART_AT,
        vehicleWeightKg: 40_000,
        pauseTimeInSeconds: 2700,
      });

      expect(rec.requests).toHaveLength(1);
      const req = rec.requests[0];
      expect(new URL(req.url).pathname).toBe(
        `${BASE_PATH}/52.2297,21.0122:51.4,16.2:50.5,10.9:50.1109,8.6821/json`
      );
      await expect(req.json()).resolves.toEqual({
        legs: [
          { routeStop: { pauseTimeInSeconds: 2700 } },
          { routeStop: { pauseTimeInSeconds: 2700 } },
          { routeStop: { pauseTimeInSeconds: 0 } },
        ],
      });

      const route = res.routes[0];
      expect(route.legs).toHaveLength(3);
      const sumLength = route.legs.reduce((s, l) => s + l.summary.lengthInMeters, 0);
      const sumTravel = route.legs.reduce((s, l) => s + l.summary.travelTimeInSeconds, 0);
      expect(route.summary.lengthInMeters).toBe(sumLength);
      expect(route.summary.travelTimeInSeconds).toBe(sumTravel);
      // Следующее плечо стартует через паузу после приезда на остановку.
      expect(Date.parse(route.legs[1].summary.departureTime)).toBe(
        Date.parse(route.legs[0].summary.arrivalTime) + 2700 * 1000
      );
      expect(Date.parse(route.legs[2].summary.departureTime)).toBe(
        Date.parse(route.legs[1].summary.arrivalTime) + 2700 * 1000
      );
      expect(Date.parse(route.summary.arrivalTime)).toBe(
        Date.parse(DEPART_AT) + (sumTravel + 2 * 2700) * 1000
      );
    } finally {
      rec.stop();
    }
  });

  test('без EXPO_PUBLIC_TOMTOM_KEY — ошибка до запроса', async () => {
    const saved = process.env.EXPO_PUBLIC_TOMTOM_KEY;
    delete process.env.EXPO_PUBLIC_TOMTOM_KEY;
    const rec = recordRequests();
    try {
      await expect(
        calculateRoute({ origin: WARSAW, destination: FRANKFURT, departAt: DEPART_AT, vehicleWeightKg: 40_000 })
      ).rejects.toThrow('EXPO_PUBLIC_TOMTOM_KEY');
      expect(rec.requests).toHaveLength(0);
    } finally {
      rec.stop();
      process.env.EXPO_PUBLIC_TOMTOM_KEY = saved;
    }
  });

  test('мок отвергает legs.length ≠ waypoints + 1 (ограничение из документации)', async () => {
    const res = await fetch(
      `https://api.tomtom.com${BASE_PATH}/52.2297,21.0122:50.1109,8.6821/json?key=test-key&apiVersion=2`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ legs: [] }) }
    );
    expect(res.status).toBe(400);
  });
});
