import { http, HttpResponse, type RequestHandler } from 'msw';
import { PARKING_API_BASE } from '../api/parking';
import { TOMTOM_CALCULATE_ROUTE_BASE } from '../api/tomtom';
import type { GeoPoint } from '../types';
import { generateParkings } from './parkingGenerator';
import { generateRoute } from './routeGenerator';
import { getMockScenario } from './scenario';

// Общие MSW-handlers для тестов (msw/node) и приложения (msw/native).

/** Паттерн для MSW: координаты маршрута — один сегмент пути. */
export const TOMTOM_CALCULATE_ROUTE_PATTERN = `${TOMTOM_CALCULATE_ROUTE_BASE}/:locations/json`;

interface CalculateRouteBody {
  legs?: { routeStop?: { pauseTimeInSeconds?: number } }[];
}

/** «Colon-delimited locations», location = «Latitude, longitude pair». */
function parseLocations(raw: string): GeoPoint[] {
  return raw.split(':').map((pair) => {
    const [lat, lon] = pair.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`mock tomtom: bad location "${pair}"`);
    return { lat, lon };
  });
}

// Формат ошибок — наш, мок только проверяет документированные ограничения; ядро смотрит лишь на res.ok.
const badRequest = (error: string) => HttpResponse.json({ error }, { status: 400 });

export const tomtomCalculateRoute = http.post(TOMTOM_CALCULATE_ROUTE_PATTERN, async ({ request, params }) => {
  const url = new URL(request.url);
  if (!url.searchParams.get('key')) return HttpResponse.json({ error: 'missing key' }, { status: 403 });
  if (url.searchParams.get('apiVersion') !== '2') return badRequest('apiVersion: only allowed value is 2');

  const locations = parseLocations(String(params.locations));
  if (locations.length < 2) return badRequest('at least two locations must be provided');

  const body = (await request.json()) as CalculateRouteBody;
  const legs = body.legs ?? [];
  if (legs.length !== locations.length - 1) {
    return badRequest(`legs must equal waypoints + 1 (${locations.length - 1}), got ${legs.length}`);
  }
  const pausesSec = legs.map((leg) => leg.routeStop?.pauseTimeInSeconds ?? 0);
  if (pausesSec[pausesSec.length - 1] !== 0) return badRequest('pauseTimeInSeconds must be 0 in the last leg');

  const departAt = url.searchParams.get('departAt') ?? new Date().toISOString();
  return HttpResponse.json(generateRoute({ locations, departAt, pausesSec }));
});

/** Parking-API: GET /v1/parkings?lat&lon&radiusKm&at — схема наша, см. api/types.ts. */
export const PARKINGS_PATTERN = `${PARKING_API_BASE}/parkings`;

export const parkingsNear = http.get(PARKINGS_PATTERN, ({ request }) => {
  const q = new URL(request.url).searchParams;
  const lat = Number(q.get('lat'));
  const lon = Number(q.get('lon'));
  const radiusKm = Number(q.get('radiusKm'));
  const at = q.get('at') ?? '';
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return badRequest('lat and lon must be numbers');
  if (!(radiusKm > 0)) return badRequest('radiusKm must be a positive number');
  if (Number.isNaN(Date.parse(at))) return badRequest('at must be an ISO dateTime');

  // Сценарий 'live' — свойство мока: генератор получает его флагом и остаётся чистым.
  const parkings = generateParkings({ lat, lon, radiusKm, at, now: Date.now(), live: getMockScenario() === 'live' });
  // Сценарий «все парковки заняты» накладывается поверх генератора, генератор остаётся чистым.
  if (getMockScenario() === 'all-full') {
    return HttpResponse.json({ parkings: parkings.map((p) => ({ ...p, freeAt: 0 })) });
  }
  return HttpResponse.json({ parkings });
});

export const handlers: RequestHandler[] = [tomtomCalculateRoute, parkingsNear];

/**
 * Набор handlers для приложения (фаза 3, шаг 4).
 *
 * `tomtomLive` — при `true` TomTom-handler НЕ регистрируется, и запрос к api.tomtom.com уходит
 * в настоящий API: MSW в приложении поднят с `onUnhandledRequest: 'bypass'` (см. API_CONTRACT § 6).
 * Parking-API мокается всегда — реального сервиса не существует (`mock.convoy-mind.local`).
 *
 * Чистая функция, чтобы выбор набора можно было проверить тестом: `mocks/native.ts` импортирует
 * `msw/native`, который в Jest-проекте `core` не грузится.
 */
export function appHandlers({ tomtomLive }: { tomtomLive: boolean }): RequestHandler[] {
  return tomtomLive ? [parkingsNear] : handlers;
}

/** `EXPO_PUBLIC_TOMTOM_LIVE=1` в `.env` — единственный способ включить реальный TomTom. См. `.env.example`. */
export function isTomTomLive(): boolean {
  return process.env.EXPO_PUBLIC_TOMTOM_LIVE === '1';
}
