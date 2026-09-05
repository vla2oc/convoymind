import { useCallback, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker, Polyline, type LatLng, type Region } from 'react-native-maps';

import type { Conflict, GeoPoint, RoutedParking, Stop } from '@/core';
import { freeLine, parkingCallout } from './text';
import { formatClock } from './time';
import type { ThemeColors } from './theme';

// Карта маршрута на react-native-maps (фаза 3, шаг 6). Пара к routeMap.web.tsx.
//
// ВАЖНО: react-native-maps не работает под react-native-web — Marker/Polyline импортируют
// `codegenNativeComponent` из 'react-native', которого в react-native-web нет, и падает ВЕСЬ
// бандл, а не только карта (Expo Router валидирует экспорты всех маршрутов при старте).
// Поэтому пакет импортируется только здесь, а Metro на web подставляет routeMap.web.tsx.
// См. DECISIONS.md (2026-09-06). Jest-проект `screens` идёт по пресету ios и берёт этот файл
// (react-native-maps там замокан, см. __tests__/screens/maps-mock.tsx).

// MVP: hardcoded, see NOT_NOW.md — отступы, чтобы маршрут не упирался в края экрана
const MAP_EDGE_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };
// MVP: hardcoded, see NOT_NOW.md — запас вокруг маршрута для initialRegion (доля от габарита)
const REGION_MARGIN = 0.25;
const REGION_MIN_DELTA = 0.05;

export interface RouteMapViewProps {
  /** PlanResult.route.points. */
  points: GeoPoint[];
  parkings: RoutedParking[];
  stops: Stop[];
  originName: string;
  destinationName: string;
  departureAt: string;
  arrivalAt: string;
  t: ThemeColors;
}

export function RouteMapView({
  points,
  parkings,
  stops,
  originName,
  destinationName,
  departureAt,
  arrivalAt,
  t,
}: RouteMapViewProps) {
  const mapRef = useRef<MapView>(null);
  const coords = useMemo(() => points.map(toLatLng), [points]);
  const stopById = useMemo(() => new Map(stops.map((s) => [s.parking.id, s])), [stops]);

  // Кадр по всему маршруту строится один раз, по готовности карты. Колбэк стабилен по ссылке,
  // иначе он перезапускался бы при каждом ре-рендере (например, когда приезжают парковки).
  const onMapReady = useCallback(() => {
    mapRef.current?.fitToCoordinates(coords, { edgePadding: MAP_EDGE_PADDING, animated: false });
  }, [coords]);

  return (
    <MapView
      testID="route-map"
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={regionFor(points)}
      onMapReady={onMapReady}>
      <Polyline testID="route-polyline" coordinates={coords} strokeColor={t.primary} strokeWidth={4} />
      <Marker
        testID="marker-origin"
        coordinate={coords[0]}
        pinColor={t.text}
        title={originName}
        description={`Выезд ${formatClock(departureAt)}`}
      />
      <Marker
        testID="marker-destination"
        coordinate={coords[coords.length - 1]}
        pinColor={t.text}
        title={destinationName}
        description={`Прибытие ${formatClock(arrivalAt)}`}
      />
      {parkings.map((p) => (
        <Marker
          key={p.id}
          testID={`marker-parking-${p.id}`}
          coordinate={toLatLng(p)}
          pinColor={markerColor(p, t)}
          title={p.name}
          description={parkingCallout(p, stopById.get(p.id))}
        />
      ))}
    </MapView>
  );
}

/** При конфликте геометрии маршрута нет (PlanResult.conflict без route) — якорь и запасная парковка. */
export function ConflictMapView({ conflict, t }: { conflict: Conflict; t: ThemeColors }) {
  const points = [conflict.anchor as GeoPoint, ...(conflict.nearestFreeParking ? [conflict.nearestFreeParking] : [])];
  return (
    <MapView testID="conflict-map" style={StyleSheet.absoluteFill} initialRegion={regionFor(points)}>
      <Marker
        testID="marker-anchor"
        coordinate={toLatLng(conflict.anchor)}
        pinColor={t.danger}
        title="Плановая остановка"
        description={`Приезд ${formatClock(conflict.anchor.plannedArrivalAt)} · свободных мест нет`}
      />
      {conflict.nearestFreeParking && (
        <Marker
          testID={`marker-parking-${conflict.nearestFreeParking.id}`}
          coordinate={toLatLng(conflict.nearestFreeParking)}
          pinColor={t.success}
          title={conflict.nearestFreeParking.name}
          description={`Ближайшая свободная · ${freeLine(conflict.nearestFreeParking)}`}
        />
      )}
    </MapView>
  );
}

/** Зелёный — свободна, красный — занята, синий — выбрана планировщиком как остановка. */
export function markerColor(p: RoutedParking, t: ThemeColors): string {
  if (p.chosen) return t.primary;
  return p.status === 'free' ? t.success : t.danger;
}

function toLatLng(p: GeoPoint): LatLng {
  return { latitude: p.lat, longitude: p.lon };
}

/** Прямоугольник вокруг точек с запасом — стартовый кадр до того, как отработает fitToCoordinates. */
function regionFor(points: GeoPoint[]): Region {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * (1 + REGION_MARGIN), REGION_MIN_DELTA),
    longitudeDelta: Math.max((maxLon - minLon) * (1 + REGION_MARGIN), REGION_MIN_DELTA),
  };
}
