import { getParkingsNear } from '../api/parking';
import { calculateRoute } from '../api/tomtom';
import type { Parking, Route } from '../api/types';
import { haversineMeters } from '../geo';
import type { GeoPoint } from '../types';
import { BREAK_SEC, MAX_CONTINUOUS_DRIVING_SEC, MAX_DAILY_DRIVING_SEC } from './aetr';
import { placeBreakAnchors, type Anchor } from './breaks';

// planTrip() — оркестрация по диаграмме Convoy_mind_diagramm.pdf:
// построить маршрут → расставить остановки → парковка свободна в окне? → собрать расписание →
// учесть трафик (traffic=live в том же вызове) → всё сходится?
// См. docs/PHASE1_CORE.md, шаг 7. Сообщения об ошибках и conflict.reason — на английском.

// MVP: hardcoded, see NOT_NOW.md — радиус поиска парковок вокруг якоря
export const PARKING_SEARCH_RADIUS_KM = 25;
// MVP: hardcoded, see NOT_NOW.md — расширенный радиус, только чтобы заполнить conflict.nearestFreeParking
export const CONFLICT_SEARCH_RADIUS_KM = 50;
// MVP: hardcoded, see NOT_NOW.md — сдвиг приезда относительно плана, после которого парковка перепроверяется
export const MAX_ARRIVAL_SHIFT_SEC = 30 * 60;

export interface TripInput {
  origin: GeoPoint;
  destination: GeoPoint;
  /** Время выезда, ISO/RFC 3339 с оффсетом; уходит в TomTom как departAt без изменений. */
  departureAt: string;
  vehicleWeightKg: number;
}

export interface Stop {
  parking: Parking;
  /** Из legs[i].summary.arrivalTime второго вызова TomTom. */
  arrivalAt: string;
  /** arrivalAt + pauseSec (считается здесь, не берётся из следующего плеча). */
  departAt: string;
  pauseSec: number;
  /** legs[i].summary.travelTimeInSeconds — вождение от предыдущей остановки (или старта). */
  drivingSecFromPrev: number;
}

export type ConflictCode = 'no-free-parking' | 'parking-lost-after-reroute' | 'leg-exceeds-continuous-limit';

export interface Conflict {
  code: ConflictCode;
  /** Человекочитаемый текст (английский). */
  reason: string;
  /** Якорь остановки, на котором план не сошёлся. */
  anchor: Anchor;
  /** Ближайшая свободная парковка, если хоть где-то нашлась (радиус CONFLICT_SEARCH_RADIUS_KM или повторный запрос). */
  nearestFreeParking?: Parking;
}

/** Стадии planTrip в порядке выполнения — для экрана расчёта (фаза 2). */
export type PlanStage = 'route' | 'anchors' | 'parkings' | 'schedule';

export interface PlanOptions {
  /**
   * Вызывается после каждой завершённой стадии: route → anchors → parkings → schedule.
   * При conflict или ошибке последующие стадии не сообщаются. Колбэк не должен бросать.
   */
  onProgress?: (stage: PlanStage) => void;
}

export type PlanResult =
  | {
      status: 'ok';
      departureAt: string;
      /** routes[0].summary.arrivalTime последнего вызова TomTom. */
      arrivalAt: string;
      /** Сумма legs[].summary.travelTimeInSeconds — без пауз. */
      drivingTimeSec: number;
      stops: Stop[];
      /** drivingTimeSec >= 9:00 — суточный отдых нужен, но не планируется (NOT_NOW). */
      requiresDailyRest: boolean;
      /** Геометрия маршрута последнего вызова TomTom — для карты (фаза 3). */
      route: { points: GeoPoint[] };
    }
  | { status: 'conflict'; conflict: Conflict };

export async function planTrip(input: TripInput, options: PlanOptions = {}): Promise<PlanResult> {
  validateInput(input);
  const { origin, destination, departureAt, vehicleWeightKg } = input;
  const report = (stage: PlanStage) => options.onProgress?.(stage);

  // 1. Маршрут без остановок.
  const route1 = firstRoute(await calculateRoute({ origin, destination, departAt: departureAt, vehicleWeightKg }));
  report('route');

  // 2. Якоря остановок по геометрии и времени вызова 1.
  const anchors = placeBreakAnchors({
    points: routePoints(route1),
    travelTimeSec: route1.summary.travelTimeInSeconds,
    departureAt,
  });
  report('anchors');
  if (anchors.length === 0) {
    // Проверять и собирать нечего, но для экрана стадии считаются пройденными.
    report('parkings');
    report('schedule');
    return okResult(route1, [], departureAt);
  }

  // 3. Для каждого якоря — ближайшая свободная парковка в окне приезда.
  const chosen: Parking[] = [];
  for (const anchor of anchors) {
    const near = await getParkingsNear({ ...toQuery(anchor), radiusKm: PARKING_SEARCH_RADIUS_KM, at: anchor.plannedArrivalAt });
    const best = nearestFree(anchor, near);
    if (!best) {
      const wider = await getParkingsNear({ ...toQuery(anchor), radiusKm: CONFLICT_SEARCH_RADIUS_KM, at: anchor.plannedArrivalAt });
      return conflictResult({
        code: 'no-free-parking',
        reason:
          `No free parking within ${PARKING_SEARCH_RADIUS_KM} km of the planned break point ` +
          `(${anchor.lat}, ${anchor.lon}) at ${anchor.plannedArrivalAt}.`,
        anchor,
        nearestFreeParking: nearestFree(anchor, wider),
      });
    }
    chosen.push(best);
  }
  report('parkings');

  // 4. Маршрут через парковки с паузами.
  const route2 = firstRoute(
    await calculateRoute({
      origin,
      destination,
      waypoints: chosen.map(toGeoPoint),
      departAt: departureAt,
      vehicleWeightKg,
      pauseTimeInSeconds: BREAK_SEC,
    })
  );
  if (route2.legs.length !== chosen.length + 1) {
    throw new Error(`planTrip: expected ${chosen.length + 1} legs from TomTom, got ${route2.legs.length}`);
  }

  // 5. Всё сходится? Приезд сдвинулся от плана — один повторный запрос парковки по новому времени.
  for (let i = 0; i < chosen.length; i++) {
    const anchor = anchors[i];
    const actualArrivalAt = route2.legs[i].summary.arrivalTime;
    const shiftSec = Math.abs(Date.parse(actualArrivalAt) - Date.parse(anchor.plannedArrivalAt)) / 1000;
    if (shiftSec <= MAX_ARRIVAL_SHIFT_SEC) continue;

    const again = await getParkingsNear({ ...toQuery(anchor), radiusKm: PARKING_SEARCH_RADIUS_KM, at: actualArrivalAt });
    const same = again.find((p) => p.id === chosen[i].id);
    if (!same || same.freeAt < 1) {
      return conflictResult({
        code: 'parking-lost-after-reroute',
        reason:
          `Arrival at "${chosen[i].name}" moved by ${Math.round(shiftSec / 60)} min to ${actualArrivalAt}; ` +
          `it has no free places at that time.`,
        anchor,
        nearestFreeParking: nearestFree(anchor, again.filter((p) => p.id !== chosen[i].id)),
      });
    }
    chosen[i] = same; // свежая занятость на фактическое время
  }

  // Защитная проверка: ни одно плечо не длиннее 4:30 (парковки могли сместить остановку по маршруту).
  for (let i = 0; i < route2.legs.length; i++) {
    const legSec = route2.legs[i].summary.travelTimeInSeconds;
    if (legSec > MAX_CONTINUOUS_DRIVING_SEC) {
      return conflictResult({
        code: 'leg-exceeds-continuous-limit',
        reason:
          `Driving leg ${i + 1} takes ${formatHm(legSec)}, more than the ${formatHm(MAX_CONTINUOUS_DRIVING_SEC)} ` +
          `continuous driving limit.`,
        anchor: anchors[Math.min(i, anchors.length - 1)],
      });
    }
  }

  // 6. Расписание.
  const stops: Stop[] = chosen.map((parking, i) => {
    const leg = route2.legs[i].summary;
    return {
      parking,
      arrivalAt: leg.arrivalTime,
      departAt: new Date(Date.parse(leg.arrivalTime) + BREAK_SEC * 1000).toISOString(),
      pauseSec: BREAK_SEC,
      drivingSecFromPrev: leg.travelTimeInSeconds,
    };
  });
  report('schedule');
  return okResult(route2, stops, departureAt);
}

function validateInput(input: TripInput): void {
  for (const [name, p] of [
    ['origin', input.origin],
    ['destination', input.destination],
  ] as const) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
      throw new Error(`planTrip: ${name} must have numeric lat and lon`);
    }
  }
  if (Number.isNaN(Date.parse(input.departureAt))) throw new Error(`planTrip: bad departureAt "${input.departureAt}"`);
  if (!Number.isFinite(input.vehicleWeightKg) || input.vehicleWeightKg <= 0) {
    throw new Error(`planTrip: vehicleWeightKg must be > 0, got ${input.vehicleWeightKg}`);
  }
}

function firstRoute(res: { routes: Route[] }): Route {
  return res.routes[0];
}

function routePoints(route: Route): GeoPoint[] {
  return route.legs.flatMap((leg) => leg.points.map((p) => ({ lat: p.latitude, lon: p.longitude })));
}

function toQuery(p: GeoPoint): { lat: number; lon: number } {
  return { lat: p.lat, lon: p.lon };
}

function toGeoPoint(p: Parking): GeoPoint {
  return { lat: p.lat, lon: p.lon };
}

/** Ближайшая по haversine к якорю парковка с freeAt >= 1; undefined, если таких нет. */
function nearestFree(anchor: GeoPoint, parkings: Parking[]): Parking | undefined {
  let best: Parking | undefined;
  let bestM = Number.POSITIVE_INFINITY;
  for (const p of parkings) {
    if (p.freeAt < 1) continue;
    const m = haversineMeters(anchor, p);
    if (m < bestM) {
      best = p;
      bestM = m;
    }
  }
  return best;
}

function okResult(route: Route, stops: Stop[], departureAt: string): PlanResult {
  const drivingTimeSec = route.legs.reduce((s, leg) => s + leg.summary.travelTimeInSeconds, 0);
  return {
    status: 'ok',
    departureAt,
    arrivalAt: route.summary.arrivalTime,
    drivingTimeSec,
    stops,
    requiresDailyRest: drivingTimeSec >= MAX_DAILY_DRIVING_SEC,
    route: { points: routePoints(route) },
  };
}

function conflictResult(conflict: Conflict): PlanResult {
  return { status: 'conflict', conflict };
}

function formatHm(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
