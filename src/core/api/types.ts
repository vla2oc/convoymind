import type { GeoPoint } from '../types';

/**
 * TomTom Orbis Maps Routing API v2 — calculateRoute.
 * Схема ответа взята из https://docs.tomtom.com/routing-api/documentation/tomtom-orbis-maps/v2/calculate-route
 * (прочитано 2026-09-05, исходный текст страницы, см. DECISIONS.md). Здесь только поля, которые использует ядро.
 * Документация: «The summary object may be extended with new fields in the future;
 * clients should ignore fields they do not recognize».
 */

/** Точка на проводе TomTom: «...defined by its latitude and longitude fields». */
export interface TomTomPoint {
  latitude: number;
  longitude: number;
}

/** «The summary of a route, or of a route leg.» */
export interface RouteSummary {
  /** «The route or leg length in meters.» */
  lengthInMeters: number;
  /** «The estimated travel time in seconds depending on traffic.» */
  travelTimeInSeconds: number;
  /** «The estimated departure time for the route or leg. Specified as a dateTime.» Пример: 2015-04-02T15:01:57+02:00 */
  departureTime: string;
  /** «The estimated arrival time for the route or leg. Specified as a dateTime.» */
  arrivalTime: string;
}

/** «A description of a part of a route, comprised of an array of points.» */
export interface RouteLeg {
  summary: RouteSummary;
  /**
   * «Each object in the array is a location on the surface of the globe defined by its latitude and longitude fields.»
   * Присутствует при routeRepresentation=polyline (значение по умолчанию).
   */
  points: TomTomPoint[];
}

/** «Each object has at least a summary field and a legs field.» */
export interface Route {
  summary: RouteSummary;
  legs: RouteLeg[];
}

/** «The request may return more than one route.» Ядро использует routes[0]. */
export interface RouteResponse {
  formatVersion: string;
  routes: Route[];
}

/**
 * Вход calculateRoute() — внутренний тип ядра. Имена на проводе задаёт api/tomtom.ts по документации:
 * координаты — в пути URL (routePlanningLocations, «Colon-delimited locations»), departAt / vehicleWeight — query,
 * пауза — тело POST legs[i].routeStop.pauseTimeInSeconds («It must be 0 in the last leg (the destination)»).
 */
export interface RouteRequest {
  origin: GeoPoint;
  destination: GeoPoint;
  /** Промежуточные остановки (парковки) в порядке следования. */
  waypoints?: GeoPoint[];
  /** Время выезда: «Departure times apart from now must be specified as a dateTime» (RFC 3339 с оффсетом). */
  departAt: string;
  /** «Weight of the vehicle in kilograms.» */
  vehicleWeightKg: number;
  /** «Specifies the waiting time at route stops» — на каждой промежуточной остановке; последнее плечо всегда 0. */
  pauseTimeInSeconds?: number;
}

/**
 * Parking-API — схема наша (реального бесплатного общеевропейского API занятости нет, см. DECISIONS.md).
 * GET https://mock.convoy-mind.local/v1/parkings?lat&lon&radiusKm&at=<ISO> → ParkingsResponse.
 */
export interface Parking {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Всего мест для грузовиков. */
  capacityTotal: number;
  /** Свободных мест на момент `at` из запроса. */
  freeAt: number;
  /** 0..1: 0.9 — «сейчас» (at в пределах часа от текущего времени), 0.6 — прогноз. */
  confidence: number;
}

export interface ParkingsResponse {
  parkings: Parking[];
}

/** Вход getParkingsNear(); имена совпадают с query-параметрами. */
export interface ParkingsQuery {
  lat: number;
  lon: number;
  radiusKm: number;
  /** Момент, на который нужна занятость (ISO/RFC 3339, любой разбираемый Date.parse). */
  at: string;
}
