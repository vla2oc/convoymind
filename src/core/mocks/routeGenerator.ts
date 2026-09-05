import type { RouteLeg, RouteResponse, TomTomPoint } from '../api/types';
import { haversineMeters } from '../geo';
import type { GeoPoint } from '../types';

// Детерминированный генератор ответа TomTom calculateRoute по схеме из api/types.ts.
// Геометрия — прямые между локациями запроса, время — по расстоянию, даты — от departAt с учётом пауз.
// См. DECISIONS.md (2026-09-05, «генератор вместо статичных фикстур»).

// MVP: hardcoded, see NOT_NOW.md
export const MOCK_AVG_SPEED_KMH = 100;
// MVP: hardcoded, see NOT_NOW.md — шаг между точками полилинии
export const MOCK_POINT_SPACING_M = 5_000;
const FORMAT_VERSION = '0.0.12'; // как в примере документации

export interface GenerateRouteInput {
  /** origin, waypoints…, destination — минимум две. */
  locations: GeoPoint[];
  /** Время выезда (query departAt), любой разбираемый Date.parse ISO/RFC 3339. */
  departAt: string;
  /** Пауза в конце каждого плеча, сек. Длина = locations.length − 1; последняя — 0 (как требует документация). */
  pausesSec: number[];
}

export function generateRoute(input: GenerateRouteInput): RouteResponse {
  const { locations, departAt, pausesSec } = input;
  if (locations.length < 2) throw new Error('generateRoute: need at least 2 locations');
  if (pausesSec.length !== locations.length - 1) {
    throw new Error(`generateRoute: pausesSec.length must be ${locations.length - 1}, got ${pausesSec.length}`);
  }
  const departMs = Date.parse(departAt);
  if (Number.isNaN(departMs)) throw new Error(`generateRoute: bad departAt "${departAt}"`);

  const metersPerSecond = (MOCK_AVG_SPEED_KMH * 1000) / 3600;
  const legs: RouteLeg[] = [];
  let cursorMs = departMs;

  for (let i = 0; i < locations.length - 1; i++) {
    const from = locations[i];
    const to = locations[i + 1];
    const lengthInMeters = Math.round(haversineMeters(from, to));
    const travelTimeInSeconds = Math.round(lengthInMeters / metersPerSecond);
    const arrivalMs = cursorMs + travelTimeInSeconds * 1000;

    legs.push({
      summary: {
        lengthInMeters,
        travelTimeInSeconds,
        departureTime: new Date(cursorMs).toISOString(),
        arrivalTime: new Date(arrivalMs).toISOString(),
      },
      points: interpolate(from, to, lengthInMeters),
    });

    cursorMs = arrivalMs + pausesSec[i] * 1000;
  }

  const first = legs[0].summary;
  const last = legs[legs.length - 1].summary;
  return {
    formatVersion: FORMAT_VERSION,
    routes: [
      {
        summary: {
          lengthInMeters: legs.reduce((s, l) => s + l.summary.lengthInMeters, 0),
          // Только время в движении, без пауз — [предположение] о поведении реального API, см. DECISIONS.md.
          travelTimeInSeconds: legs.reduce((s, l) => s + l.summary.travelTimeInSeconds, 0),
          departureTime: first.departureTime,
          arrivalTime: last.arrivalTime,
        },
        legs,
      },
    ],
  };
}

/** Точки по прямой от from до to с шагом ~MOCK_POINT_SPACING_M; обе концевые включены. */
function interpolate(from: GeoPoint, to: GeoPoint, lengthInMeters: number): TomTomPoint[] {
  const segments = Math.max(1, Math.round(lengthInMeters / MOCK_POINT_SPACING_M));
  const points: TomTomPoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push({
      latitude: round6(from.lat + (to.lat - from.lat) * t),
      longitude: round6(from.lon + (to.lon - from.lon) * t),
    });
  }
  return points;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
