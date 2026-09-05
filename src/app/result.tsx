import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getParkingsAlongRoute, type Conflict, type PlanResult, type RoutedParking } from '@/core';
import { ConflictMapView, RouteMapView } from '@/ui/routeMap';
import { freeLine, pluralRu } from '@/ui/text';
import { FontSize, Radius, Spacing, TouchTarget, useTheme, type ThemeColors } from '@/ui/theme';
import { formatClock, formatClockSec, formatHm, toRfc3339Local } from '@/ui/time';
import { resetTrip, startPlanning, useTripState, type TripLabels } from '@/ui/tripStore';

// Экран 3 — Результат (PHASE3_MAP.md, шаг 6): карточка-ответ сверху, карта на весь остальной экран.
// Лента времени фазы 2 заменена картой — решение «карта вместо ленты» (DECISIONS.md, 2026-09-06).
//
// Сама карта — в `@/ui/routeMap`, у которого есть web-вариант без react-native-maps: этот пакет
// под react-native-web роняет весь бандл. Здесь остаётся всё платформонезависимое.

/** «Выехать раньше»: на сколько сдвигаем выезд назад (PHASE2_APP.md, экран 3). */
export const EARLIER_SHIFT_MIN = 30;

// MVP: hardcoded, see NOT_NOW.md — как часто перезапрашиваются парковки коридора (шаг 7)
export const MAP_REFRESH_MS = 30_000;

type OkResult = Extract<PlanResult, { status: 'ok' }>;

export default function ResultScreen() {
  const router = useRouter();
  const t = useTheme();
  const trip = useTripState();

  function onNewTrip() {
    resetTrip();
    router.replace('/');
  }

  if (trip.status !== 'done') {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]}>
        <View style={styles.center}>
          <Text style={[styles.body, { color: t.textMuted }]}>Нет результата</Text>
        </View>
        <BigButton label="Новый маршрут" onPress={onNewTrip} t={t} />
      </SafeAreaView>
    );
  }

  const { result, labels, input } = trip;

  // Перепланирование от старта с тем же входом — не от текущей позиции водителя (NOT_NOW.md).
  function onReplan() {
    startPlanning(input, labels);
    router.replace('/planning');
  }

  function onLeaveEarlier() {
    const earlier = toRfc3339Local(new Date(Date.parse(input.departureAt) - EARLIER_SHIFT_MIN * 60_000));
    resetTrip();
    router.replace({ pathname: '/', params: { departureAt: earlier } });
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]}>
      <View style={styles.header}>
        {result.status === 'ok' ? (
          <OkCard result={result} t={t} />
        ) : (
          <ConflictCard conflict={result.conflict} t={t} onLeaveEarlier={onLeaveEarlier} />
        )}
      </View>
      <View style={[styles.mapWrap, { borderColor: t.border }]}>
        {result.status === 'ok' ? (
          <RouteMap result={result} labels={labels} t={t} onReplan={onReplan} />
        ) : (
          <ConflictMapView conflict={result.conflict} t={t} />
        )}
      </View>
      <BigButton label="Новый маршрут" onPress={onNewTrip} t={t} />
    </SafeAreaView>
  );
}

// --- карта ---------------------------------------------------------------------------------------

function RouteMap({
  result,
  labels,
  t,
  onReplan,
}: {
  result: OkResult;
  labels: TripLabels;
  t: ThemeColors;
  onReplan: () => void;
}) {
  const { parkings, error, updatedAt } = useRouteParkings(result);
  // Остановка плана, которая к этому обновлению стала занятой.
  const lost = parkings.filter((p) => p.chosen && p.status === 'full');
  return (
    <>
      {lost.length > 0 && <LostParkingBanner names={lost.map((p) => p.name)} t={t} onReplan={onReplan} />}
      <RouteMapView
        points={result.route.points}
        parkings={parkings}
        stops={result.stops}
        originName={labels.originName}
        destinationName={labels.destinationName}
        departureAt={result.departureAt}
        arrivalAt={result.arrivalAt}
        t={t}
      />
      <MapBadge
        t={t}
        error={error}
        text={
          `Парковок: ${parkings.length} · остановок: ${result.stops.length}` +
          (updatedAt ? ` · обновлено ${formatClockSec(updatedAt)}` : '')
        }
      />
    </>
  );
}

/** Выбранная планировщиком парковка заполнилась к очередному обновлению. */
function LostParkingBanner({ names, t, onReplan }: { names: string[]; t: ThemeColors; onReplan: () => void }) {
  return (
    <View testID="lost-parking-banner" style={[styles.banner, { backgroundColor: t.danger }]}>
      <View style={styles.bannerText}>
        <Text style={[styles.cardLine, { color: t.onDanger }]}>Выбранная парковка занята</Text>
        <Text style={[styles.small, { color: t.onDanger }]}>{names.join(', ')}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onReplan}
        style={[styles.action, { backgroundColor: t.onDanger, flex: 0, paddingHorizontal: Spacing.md }]}>
        <Text style={[styles.actionText, { color: t.danger }]}>Перепланировать</Text>
      </Pressable>
    </View>
  );
}

/**
 * Парковки коридора для карты: первый запрос сразу, дальше раз в MAP_REFRESH_MS.
 * id парковок стабильны (сетка в parkingGenerator), поэтому маркеры не «прыгают» — меняются
 * только freeAt и status. Со сценарием мока 'live' это видно за минуту (см. API_CONTRACT.md § 6).
 */
function useRouteParkings(result: OkResult): {
  parkings: RoutedParking[];
  error: string | null;
  updatedAt: number | null;
} {
  const [parkings, setParkings] = useState<RoutedParking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      getParkingsAlongRoute({
        points: result.route.points,
        departureAt: result.departureAt,
        drivingTimeSec: result.drivingTimeSec,
        stops: result.stops,
      })
        .then((list) => {
          if (!alive) return;
          setParkings(list);
          setUpdatedAt(Date.now());
          setError(null);
        })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        });
    };
    load();
    const timer = setInterval(load, MAP_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [result]);

  return { parkings, error, updatedAt };
}

function MapBadge({ text, error, t }: { text: string; error: string | null; t: ThemeColors }) {
  return (
    <View style={[styles.badge, { backgroundColor: error ? t.danger : t.surface }]} testID="map-badge">
      <Text style={[styles.small, { color: error ? t.onDanger : t.textMuted }]}>{error ? `Парковки: ${error}` : text}</Text>
    </View>
  );
}

// --- карточка-ответ ------------------------------------------------------------------------------

function OkCard({ result, t }: { result: OkResult; t: ThemeColors }) {
  const n = result.stops.length;
  const breaks = n === 0 ? 'без перерывов' : `${n} ${pluralRu(n, ['перерыв', 'перерыва', 'перерывов'])}`;
  const norm = result.requiresDailyRest ? 'Нужен суточный отдых' : 'По норме';
  return (
    <View testID="result-card-ok" style={[styles.card, { backgroundColor: t.surface }]}>
      <Text style={[styles.hero, { color: t.text }]}>Прибытие {formatClock(result.arrivalAt)}</Text>
      <Text style={[styles.cardLine, { color: t.text }]}>
        Вождение {formatHm(result.drivingTimeSec)} · {breaks} ·{' '}
        <Text style={{ color: result.requiresDailyRest ? t.danger : t.success }}>{norm}</Text>
      </Text>
      {result.requiresDailyRest && (
        <Text style={[styles.small, { color: t.danger }]}>
          Вождение 9 ч и больше: суточный отдых обязателен, в расписание не включён
        </Text>
      )}
    </View>
  );
}

function ConflictCard({
  conflict,
  t,
  onLeaveEarlier,
}: {
  conflict: Conflict;
  t: ThemeColors;
  onLeaveEarlier: () => void;
}) {
  const [soon, setSoon] = useState(false);
  return (
    <View testID="result-card-conflict" style={[styles.card, { backgroundColor: t.danger }]}>
      <Text style={[styles.hero, { color: t.onDanger }]}>Не сходится</Text>
      <Text style={[styles.cardLine, { color: t.onDanger }]}>{conflict.reason}</Text>
      <Text style={[styles.small, { color: t.onDanger }]}>
        Плановая остановка {formatClock(conflict.anchor.plannedArrivalAt)} · {conflict.anchor.lat.toFixed(4)},{' '}
        {conflict.anchor.lon.toFixed(4)}
      </Text>
      {conflict.nearestFreeParking && (
        <View style={styles.nearest}>
          <Text style={[styles.small, { color: t.onDanger }]}>Ближайшая свободная</Text>
          <Text style={[styles.cardLine, { color: t.onDanger }]}>{conflict.nearestFreeParking.name}</Text>
          <Text style={[styles.small, { color: t.onDanger }]}>{freeLine(conflict.nearestFreeParking)}</Text>
        </View>
      )}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onLeaveEarlier}
          style={[styles.action, { backgroundColor: t.onDanger }]}>
          <Text style={[styles.actionText, { color: t.danger }]}>Выехать раньше</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setSoon(true)}
          style={[styles.action, { borderColor: t.onDanger, borderWidth: 2 }]}>
          <Text style={[styles.actionText, { color: t.onDanger }]}>{soon ? 'Скоро' : 'Другая парковка'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function BigButton({ label, onPress, t }: { label: string; onPress: () => void; t: ThemeColors }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.button, { backgroundColor: t.surface }]}>
      <Text style={[styles.buttonText, { color: t.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, gap: Spacing.md },
  header: { paddingTop: Spacing.md },
  mapWrap: { flex: 1, borderRadius: Radius.lg, borderWidth: 1, overflow: 'hidden' },
  badge: {
    position: 'absolute',
    left: Spacing.sm,
    bottom: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
  },
  banner: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    right: Spacing.sm,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: Radius.md,
  },
  bannerText: { flex: 1, gap: Spacing.xs },
  center: { flex: 1, justifyContent: 'center' },
  card: { borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  hero: { fontSize: FontSize.hero, fontWeight: '800', lineHeight: FontSize.hero + 6 },
  cardLine: { fontSize: FontSize.body, fontWeight: '600' },
  small: { fontSize: FontSize.small },
  body: { fontSize: FontSize.body },
  nearest: { marginTop: Spacing.sm, gap: Spacing.xs },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  action: {
    flex: 1,
    minHeight: TouchTarget,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  actionText: { fontSize: FontSize.small, fontWeight: '700', textAlign: 'center' },
  button: {
    minHeight: TouchTarget,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: FontSize.body, fontWeight: '700' },
});
