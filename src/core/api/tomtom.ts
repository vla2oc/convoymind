import type { RouteRequest, RouteResponse } from './types';

/**
 * TomTom Orbis Maps Routing API v2 — calculateRoute (POST).
 * Имена параметров — из документации, см. api/types.ts и DECISIONS.md (2026-09-05):
 *   путь  /maps/orbis/routing/calculateRoute/{routePlanningLocations}/{contentType}
 *   query key, apiVersion=2, departAt, traffic, vehicleWeight, travelMode, routeRepresentation
 *   тело  { legs: [{ routeStop: { pauseTimeInSeconds } }, …] }, legs.length = waypoints + 1, последнее плечо — 0
 */
export const TOMTOM_CALCULATE_ROUTE_BASE = 'https://api.tomtom.com/maps/orbis/routing/calculateRoute';

export function buildCalculateRouteUrl(req: RouteRequest, key: string): URL {
  const locations = [req.origin, ...(req.waypoints ?? []), req.destination]
    .map((p) => `${p.lat},${p.lon}`)
    .join(':');
  const url = new URL(`${TOMTOM_CALCULATE_ROUTE_BASE}/${locations}/json`);
  url.searchParams.set('key', key);
  url.searchParams.set('apiVersion', '2');
  url.searchParams.set('departAt', req.departAt);
  url.searchParams.set('traffic', 'live');
  url.searchParams.set('vehicleWeight', String(Math.round(req.vehicleWeightKg)));
  url.searchParams.set('travelMode', 'car');
  url.searchParams.set('routeRepresentation', 'polyline');
  return url;
}

export function buildCalculateRouteBody(req: RouteRequest): { legs: { routeStop: { pauseTimeInSeconds: number } }[] } {
  const stops = req.waypoints?.length ?? 0;
  const pause = req.pauseTimeInSeconds ?? 0;
  const legs = Array.from({ length: stops }, () => ({ routeStop: { pauseTimeInSeconds: pause } }));
  legs.push({ routeStop: { pauseTimeInSeconds: 0 } }); // «It must be 0 in the last leg (the destination).»
  return { legs };
}

export async function calculateRoute(req: RouteRequest): Promise<RouteResponse> {
  const key = process.env.EXPO_PUBLIC_TOMTOM_KEY;
  if (!key) throw new Error('EXPO_PUBLIC_TOMTOM_KEY is not set');

  const res = await fetch(buildCalculateRouteUrl(req, key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(buildCalculateRouteBody(req)),
  });
  if (!res.ok) throw new Error(`TomTom calculateRoute: HTTP ${res.status}`);

  const data = (await res.json()) as RouteResponse;
  if (!Array.isArray(data.routes) || data.routes.length === 0) {
    throw new Error('TomTom calculateRoute: response has no routes');
  }
  return data;
}
