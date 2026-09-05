import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getMockScenario, setMockScenario, type MockScenario } from '@/core/mocks/scenario';
import {
  CITY_PRESETS,
  DEFAULT_DESTINATION_ID,
  DEFAULT_ORIGIN_ID,
  DEFAULT_VEHICLE_WEIGHT_KG,
  DEPARTURE_OFFSETS,
} from '@/ui/presets';
import { FontSize, Radius, Spacing, TouchTarget, useTheme, type ThemeColors } from '@/ui/theme';
import { formatClock, toRfc3339Local } from '@/ui/time';
import { startPlanning } from '@/ui/tripStore';

// Экран 1 — Ввод (PHASE2_APP.md). Геокодинга нет: пресеты городов с координатами.
export default function InputScreen() {
  const router = useRouter();
  const t = useTheme();
  // «Выехать раньше» с экрана 3 приходит сюда параметром departureAt (RFC 3339) — фиксированное время вместо сдвига.
  const params = useLocalSearchParams<{ departureAt: string }>();
  const [originId, setOriginId] = useState(DEFAULT_ORIGIN_ID);
  const [destinationId, setDestinationId] = useState(DEFAULT_DESTINATION_ID);
  const [offsetMin, setOffsetMin] = useState(0);
  const [fixedDepartureAt, setFixedDepartureAt] = useState<string | null>(
    typeof params.departureAt === 'string' && !Number.isNaN(Date.parse(params.departureAt)) ? params.departureAt : null
  );
  const [weightText, setWeightText] = useState(String(DEFAULT_VEHICLE_WEIGHT_KG));
  const [scenario, setScenario] = useState(getMockScenario());

  const weightKg = Number(weightText);
  const weightValid = weightText.trim() !== '' && Number.isFinite(weightKg) && weightKg > 0;
  const origin = CITY_PRESETS.find((c) => c.id === originId);
  const destination = CITY_PRESETS.find((c) => c.id === destinationId);
  const canBuild = weightValid && !!origin && !!destination;

  function onBuild() {
    if (!canBuild || !origin || !destination) return;
    const departureAt = fixedDepartureAt ?? toRfc3339Local(new Date(Date.now() + offsetMin * 60_000));
    startPlanning(
      { origin: origin.point, destination: destination.point, departureAt, vehicleWeightKg: weightKg },
      { originName: origin.name, destinationName: destination.name }
    );
    router.push('/planning');
  }

  // Сценарий в моке один, поэтому переключатели взаимоисключающие: включение одного гасит другой.
  function onToggleScenario(kind: MockScenario, value: boolean) {
    const next = value ? kind : null;
    setScenario(next);
    setMockScenario(next);
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: t.text }]}>Convoy Mind</Text>

        <Section title="Откуда" t={t}>
          <ChipRow>
            {CITY_PRESETS.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                selected={c.id === originId}
                onPress={() => setOriginId(c.id)}
                t={t}
                testID={`origin-${c.id}`}
              />
            ))}
          </ChipRow>
        </Section>

        <Section title="Куда" t={t}>
          <ChipRow>
            {CITY_PRESETS.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                selected={c.id === destinationId}
                onPress={() => setDestinationId(c.id)}
                t={t}
                testID={`destination-${c.id}`}
              />
            ))}
          </ChipRow>
        </Section>

        <Section title="Выезд" t={t}>
          <ChipRow>
            {fixedDepartureAt && (
              <Chip
                label={`в ${formatClock(fixedDepartureAt)}`}
                selected
                onPress={() => {}}
                t={t}
                testID="offset-fixed"
              />
            )}
            {DEPARTURE_OFFSETS.map((o) => (
              <Chip
                key={o.min}
                label={o.label}
                selected={!fixedDepartureAt && o.min === offsetMin}
                onPress={() => {
                  setFixedDepartureAt(null);
                  setOffsetMin(o.min);
                }}
                t={t}
                testID={`offset-${o.min}`}
              />
            ))}
          </ChipRow>
        </Section>

        <Section title="Вес авто, кг (Фура 40 т)" t={t}>
          <TextInput
            accessibilityLabel="Вес авто, кг"
            value={weightText}
            onChangeText={setWeightText}
            inputMode="numeric"
            keyboardType="number-pad"
            style={[
              styles.input,
              { color: t.text, backgroundColor: t.surface, borderColor: weightValid ? t.border : t.danger },
            ]}
          />
          {!weightValid && <Text style={[styles.hint, { color: t.danger }]}>Введите вес больше 0</Text>}
        </Section>

        {__DEV__ && (
          <>
            <View style={[styles.devRow, { borderColor: t.border }]}>
              <Text style={[styles.devLabel, { color: t.textMuted }]}>Мок: все парковки заняты</Text>
              <Switch
                accessibilityLabel="Мок: все парковки заняты"
                value={scenario === 'all-full'}
                onValueChange={(v) => onToggleScenario('all-full', v)}
              />
            </View>
            <View style={[styles.devRow, { borderColor: t.border }]}>
              <Text style={[styles.devLabel, { color: t.textMuted }]}>Мок: live (занятость меняется)</Text>
              <Switch
                accessibilityLabel="Мок: live (занятость меняется)"
                value={scenario === 'live'}
                onValueChange={(v) => onToggleScenario('live', v)}
              />
            </View>
          </>
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canBuild }}
        disabled={!canBuild}
        onPress={onBuild}
        style={[styles.button, { backgroundColor: t.primary, opacity: canBuild ? 1 : 0.4 }]}>
        <Text style={[styles.buttonText, { color: t.onPrimary }]}>Построить маршрут</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function Section({ title, t, children }: { title: string; t: ThemeColors; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: t.textMuted }]}>{title}</Text>
      {children}
    </View>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

function Chip({
  label,
  selected,
  onPress,
  t,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  t: ThemeColors;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      testID={testID}
      style={[
        styles.chip,
        { backgroundColor: selected ? t.primary : t.surface, borderColor: selected ? t.primary : t.border },
      ]}>
      <Text style={[styles.chipText, { color: selected ? t.onPrimary : t.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  content: { gap: Spacing.lg, paddingVertical: Spacing.md },
  title: { fontSize: FontSize.title, fontWeight: '700' },
  section: { gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.small, fontWeight: '600', textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    minHeight: TouchTarget - 8,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 2,
    justifyContent: 'center',
  },
  chipText: { fontSize: FontSize.body, fontWeight: '600' },
  input: {
    minHeight: TouchTarget,
    borderRadius: Radius.md,
    borderWidth: 2,
    paddingHorizontal: Spacing.md,
    fontSize: FontSize.body,
  },
  hint: { fontSize: FontSize.small },
  devRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: Spacing.md,
  },
  devLabel: { fontSize: FontSize.small },
  button: {
    minHeight: TouchTarget,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: FontSize.body, fontWeight: '700' },
});
