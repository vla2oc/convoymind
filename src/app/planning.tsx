import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PLAN_STAGES, PLANNING_MIN_VISIBLE_MS } from '@/ui/planningStages';
import { FontSize, Radius, Spacing, TouchTarget, useTheme } from '@/ui/theme';
import { useTripState } from '@/ui/tripStore';

// Экран 2 — Расчёт (PHASE2_APP.md): не спиннер, четыре строки загораются по стадиям planTrip из стора.
export default function PlanningScreen() {
  const router = useRouter();
  const t = useTheme();
  const trip = useTripState();
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinElapsed(true), PLANNING_MIN_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (trip.status === 'done' && minElapsed) router.replace('/result');
  }, [trip.status, minElapsed, router]);

  const reached = trip.status === 'idle' ? [] : trip.stages;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]}>
      <View style={styles.content}>
        {trip.status === 'idle' ? (
          <Text style={[styles.body, { color: t.textMuted }]}>Нет данных для расчёта</Text>
        ) : (
          <>
            <Text style={[styles.title, { color: t.text }]}>
              {trip.labels.originName} → {trip.labels.destinationName}
            </Text>
            <View style={styles.stages}>
              {PLAN_STAGES.map((s) => {
                const done = reached.includes(s.id);
                return (
                  <View
                    key={s.id}
                    testID={`stage-${s.id}`}
                    accessibilityState={{ checked: done }}
                    style={styles.stageRow}>
                    <Text style={[styles.stageMark, { color: done ? t.success : t.border }]}>{done ? '●' : '○'}</Text>
                    <Text style={[styles.stageText, { color: done ? t.text : t.textMuted }]}>{s.label}</Text>
                  </View>
                );
              })}
            </View>
            {trip.status === 'error' && (
              <>
                <Text style={[styles.errorTitle, { color: t.danger }]}>Ошибка расчёта</Text>
                <Text style={[styles.body, { color: t.text }]}>{trip.message}</Text>
              </>
            )}
          </>
        )}
      </View>
      {trip.status !== 'planning' && trip.status !== 'done' && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/')}
          style={[styles.button, { backgroundColor: t.surface }]}>
          <Text style={[styles.buttonText, { color: t.text }]}>К вводу</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: Spacing.md },
  content: { flex: 1, justifyContent: 'center', gap: Spacing.lg },
  title: { fontSize: FontSize.title, fontWeight: '700' },
  stages: { gap: Spacing.md },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stageMark: { fontSize: FontSize.body, width: 24, textAlign: 'center' },
  stageText: { fontSize: FontSize.body, fontWeight: '600' },
  errorTitle: { fontSize: FontSize.body, fontWeight: '700' },
  body: { fontSize: FontSize.body },
  button: {
    minHeight: TouchTarget,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: FontSize.body, fontWeight: '700' },
});
