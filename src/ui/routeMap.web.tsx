import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Conflict, RoutedParking, Stop } from '@/core';
import { freeLine, parkingCallout } from './text';
import { FontSize, Radius, Spacing, type ThemeColors } from './theme';
import { formatClock } from './time';
import type { RouteMapViewProps } from './routeMap';

// Web-вариант карты. react-native-maps под react-native-web не работает: Marker/Polyline импортируют
// `codegenNativeComponent` из 'react-native', которого в react-native-web нет, и падает весь бандл
// (Expo Router валидирует экспорты всех маршрутов при старте — ложится и экран 1). Поэтому здесь
// пакет не импортируется вовсе, а те же данные показываются списком.
// Metro подставляет этот файл на web автоматически по суффиксу .web. См. DECISIONS.md (2026-09-06).

const WEB_NOTE = 'Карта — только в приложении (Expo Go). В браузере показан список тех же данных.';

export function RouteMapView({ points, parkings, stops, originName, destinationName, departureAt, arrivalAt, t }: RouteMapViewProps) {
  const stopById = new Map(stops.map((s) => [s.parking.id, s]));
  return (
    <View style={[styles.wrap, { backgroundColor: t.background }]} testID="route-map-web">
      <Text style={[styles.note, { color: t.textMuted }]}>{WEB_NOTE}</Text>
      <Text style={[styles.line, { color: t.textMuted }]}>Точек маршрута: {points.length}</Text>
      <ScrollView contentContainerStyle={styles.list}>
        <Row color={t.text} title={originName} sub={`Выезд ${formatClock(departureAt)}`} t={t} />
        {parkings.map((p) => (
          <Row
            key={p.id}
            testID={`web-parking-${p.id}`}
            color={p.chosen ? t.primary : p.status === 'free' ? t.success : t.danger}
            title={p.name}
            sub={parkingCallout(p, stopById.get(p.id))}
            t={t}
          />
        ))}
        <Row color={t.text} title={destinationName} sub={`Прибытие ${formatClock(arrivalAt)}`} t={t} />
      </ScrollView>
    </View>
  );
}

export function ConflictMapView({ conflict, t }: { conflict: Conflict; t: ThemeColors }) {
  return (
    <View style={[styles.wrap, { backgroundColor: t.background }]} testID="conflict-map-web">
      <Text style={[styles.note, { color: t.textMuted }]}>{WEB_NOTE}</Text>
      <Row
        testID="web-anchor"
        color={t.danger}
        title="Плановая остановка"
        sub={`Приезд ${formatClock(conflict.anchor.plannedArrivalAt)} · свободных мест нет`}
        t={t}
      />
      {conflict.nearestFreeParking && (
        <Row
          testID={`web-parking-${conflict.nearestFreeParking.id}`}
          color={t.success}
          title={conflict.nearestFreeParking.name}
          sub={`Ближайшая свободная · ${freeLine(conflict.nearestFreeParking)}`}
          t={t}
        />
      )}
    </View>
  );
}

function Row({
  color,
  title,
  sub,
  t,
  testID,
}: {
  color: string;
  title: string;
  sub: string;
  t: ThemeColors;
  testID?: string;
}) {
  return (
    <View style={styles.row} testID={testID}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={styles.rowBody}>
        <Text style={[styles.title, { color: t.text }]}>{title}</Text>
        <Text style={[styles.line, { color: t.textMuted }]}>{sub}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: Spacing.md, gap: Spacing.sm },
  note: { fontSize: FontSize.small, fontStyle: 'italic' },
  list: { gap: Spacing.sm, paddingBottom: Spacing.md },
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  dot: { width: 14, height: 14, borderRadius: Radius.md, marginTop: 4 },
  rowBody: { flex: 1 },
  title: { fontSize: FontSize.small, fontWeight: '700' },
  line: { fontSize: FontSize.small },
});
