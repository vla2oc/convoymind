// Общие доменные типы ядра. Внутри ядра и в публичном контракте координаты — { lat, lon }.
// Типы на проводе (TomTom: latitude/longitude) живут в api/types.ts.
export interface GeoPoint {
  lat: number;
  lon: number;
}
