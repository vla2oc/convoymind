// Публичный вход ядра для экранов (фаза 2). Контракт: docs/API_CONTRACT.md.
// Моки здесь намеренно не экспортируются — иначе msw попадёт в прод-бандл;
// приложение подключает их по прямому пути src/core/mocks/native.ts (см. контракт).

export { planTrip } from './planner/schedule';
export type { Conflict, ConflictCode, PlanOptions, PlanResult, PlanStage, Stop, TripInput } from './planner/schedule';
export { getParkingsAlongRoute, CORRIDOR_RADIUS_KM, CORRIDOR_STEP_KM } from './planner/corridor';
export type { GetParkingsAlongRouteInput, RoutedParking } from './planner/corridor';
export type { Anchor } from './planner/breaks';
export type { Parking } from './api/types';
export type { GeoPoint } from './types';
