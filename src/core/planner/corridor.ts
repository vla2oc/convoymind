import { getParkingsNear } from '../api/parking';
import type { Parking } from '../api/types';
import { haversineMeters } from '../geo';
import type { GeoPoint } from '../types';
import { BREAK_SEC } from './aetr';
import type { Stop } from './schedule';

// Парковки вдоль всего маршрута — для карты (фаза 3, шаг 2). В отличие от planTrip, который
// спрашивает парковки только у якорей перерывов, здесь опрашивается весь коридор: карта показывает
// и свободные, и занятые стоянки, и выбранные остановки.
//
// Экран вызывает это повторно по таймеру с новым `now` — id парковок стабильны (сетка в
// parkingGenerator.ts), поэтому маркеры не «прыгают», меняется только status.
//
// MVP-допущения (см. NOT_NOW.md «точное время по точкам»):
// - время распределено пропорционально расстоянию вдоль полилинии, плюс 45 мин на каждую
//   пройденную остановку;
// - routeProgressM парковки — прогресс ближайшей вершины полилинии (проекция на вершину, не на отрезок);
// - при попадании парковки в несколько запросов берётся первый по ходу маршрута; его `at` может
//   отличаться от etaAt самой парковки максимум на corridorKm / скорость (~9 мин на 100 км/ч).

// MVP: hardcoded, see NOT_NOW.md — полуширина коридора поиска вокруг точки маршрута
export const CORRIDOR_RADIUS_KM = 15;
// MVP: hardcoded, see NOT_NOW.md — шаг обхода полилинии между запросами
export const CORRIDOR_STEP_KM = 25;

export interface RoutedParking extends Parking {
  /** Расстояние от старта вдоль маршрута до ближайшей к парковке вершины полилинии, м. */
  routeProgressM: number;
  /** Расчётное время проезда мимо этой парковки, ISO. */
  etaAt: string;
  /** freeAt >= 1 — тот же порог, по которому planTrip выбирает остановку. */
  status: 'free' | 'full';
  /** Парковка выбрана планировщиком как остановка (её id есть в stops). */
  chosen: boolean;
}

export interface GetParkingsAlongRouteInput {
  /** Геометрия маршрута от старта до финиша — PlanResult.route.points. */
  points: GeoPoint[];
  /** Время выезда, ISO/RFC 3339 (любой разбираемый Date.parse). */
  departureAt: string;
  /** Суммарное вождение без пауз — PlanResult.drivingTimeSec. */
  drivingTimeSec: number;
  /** Остановки плана — по ним ставится chosen и добавляются паузы в ETA. */
  stops: Stop[];
  corridorKm?: number;
  stepKm?: number;
}

export async function getParkingsAlongRoute(input: GetParkingsAlongRouteInput): Promise<RoutedParking[]> {
  const { points, departureAt, drivingTimeSec, stops } = input;
  const corridorKm = input.corridorKm ?? CORRIDOR_RADIUS_KM;
  const stepKm = input.stepKm ?? CORRIDOR_STEP_KM;

  if (points.length < 2) throw new Error(`getParkingsAlongRoute: need at least 2 points, got ${points.length}`);
  if (!Number.isFinite(drivingTimeSec) || drivingTimeSec < 0) {
    throw new Error(`getParkingsAlongRoute: drivingTimeSec must be >= 0, got ${drivingTimeSec}`);
  }
  const departMs = Date.parse(departureAt);
  if (Number.isNaN(departMs)) throw new Error(`getParkingsAlongRoute: bad departureAt "${departureAt}"`);
  if (!(corridorKm > 0)) throw new Error(`getParkingsAlongRoute: corridorKm must be > 0, got ${corridorKm}`);
  if (!(stepKm > 0)) throw new Error(`getParkingsAlongRoute: stepKm must be > 0, got ${stepKm}`);

  const cumM = cumulativeMeters(points);
  const totalM = cumM[cumM.length - 1];
  if (totalM === 0) return [];

  // Прогресс каждой остановки — чтобы знать, сколько пауз уже позади в любой точке маршрута.
  const stopProgressM = stops.map((s) => nearestProgressM(cumM, points, s.parking));
  const etaAt = (progressM: number): string => {
    const drivenSec = (progressM / totalM) * drivingTimeSec;
    // Строго «до»: у самой остановки etaAt — это приезд, а не отъезд после перерыва.
    const pausesSec = stopProgressM.filter((m) => m < progressM).length * BREAK_SEC;
    return new Date(departMs + Math.round(drivenSec + pausesSec) * 1000).toISOString();
  };

  const chosenIds = new Set(stops.map((s) => s.parking.id));
  const stepM = stepKm * 1000;
  const byId = new Map<string, RoutedParking>();

  // Запросы на прогрессе 0, stepM, 2·stepM, … пока прогресс < totalM: ровно ceil(totalM / stepM) штук.
  for (let progressM = 0; progressM < totalM; progressM += stepM) {
    const center = pointAt(cumM, points, progressM);
    const near = await getParkingsNear({
      lat: center.lat,
      lon: center.lon,
      radiusKm: corridorKm,
      at: etaAt(progressM),
    });
    for (const parking of near) {
      if (byId.has(parking.id)) continue; // первый по ходу маршрута запрос выигрывает
      const routeProgressM = nearestProgressM(cumM, points, parking);
      byId.set(parking.id, {
        ...parking,
        routeProgressM,
        etaAt: etaAt(routeProgressM),
        status: parking.freeAt >= 1 ? 'free' : 'full',
        chosen: chosenIds.has(parking.id),
      });
    }
  }

  return [...byId.values()].sort((a, b) => a.routeProgressM - b.routeProgressM || (a.id < b.id ? -1 : 1));
}

/** Накопленная дистанция по вершинам полилинии. */
function cumulativeMeters(points: GeoPoint[]): number[] {
  const cumM = [0];
  for (let i = 1; i < points.length; i++) cumM.push(cumM[i - 1] + haversineMeters(points[i - 1], points[i]));
  return cumM;
}

/** Точка на полилинии на заданном прогрессе — линейная интерполяция внутри сегмента. */
function pointAt(cumM: number[], points: GeoPoint[], progressM: number): GeoPoint {
  if (progressM <= 0) return points[0];
  for (let i = 1; i < points.length; i++) {
    if (cumM[i] < progressM) continue;
    const segM = cumM[i] - cumM[i - 1];
    const f = segM === 0 ? 0 : (progressM - cumM[i - 1]) / segM;
    const from = points[i - 1];
    const to = points[i];
    return { lat: round6(from.lat + (to.lat - from.lat) * f), lon: round6(from.lon + (to.lon - from.lon) * f) };
  }
  return points[points.length - 1];
}

/** Прогресс ближайшей к точке вершины полилинии (проекция на вершину — MVP). */
function nearestProgressM(cumM: number[], points: GeoPoint[], target: GeoPoint): number {
  let bestI = 0;
  let bestM = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i++) {
    const m = haversineMeters(points[i], target);
    if (m < bestM) {
      bestM = m;
      bestI = i;
    }
  }
  return cumM[bestI];
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
