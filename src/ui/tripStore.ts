// Состояние текущей поездки между экранами: ввод → расчёт → результат.
// Модульный стор + useSyncExternalStore; без библиотек (PHASE2_APP.md, «Стек»).
import { useSyncExternalStore } from 'react';

import { planTrip, type PlanResult, type PlanStage, type TripInput } from '@/core';

export interface TripLabels {
  originName: string;
  destinationName: string;
}

export type TripState =
  | { status: 'idle' }
  | { status: 'planning'; input: TripInput; labels: TripLabels; stages: PlanStage[] }
  | { status: 'done'; input: TripInput; labels: TripLabels; stages: PlanStage[]; result: PlanResult }
  | { status: 'error'; input: TripInput; labels: TripLabels; stages: PlanStage[]; message: string };

let state: TripState = { status: 'idle' };
let runId = 0;
const listeners = new Set<() => void>();

function setState(next: TripState): void {
  state = next;
  listeners.forEach((l) => l());
}

/** Прямая установка состояния (тесты экранов с фикстурами). Текущий расчёт, если шёл, отбрасывается. */
export function setTripState(next: TripState): void {
  runId++;
  setState(next);
}

export function getTripState(): TripState {
  return state;
}

export function subscribeTrip(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTripState(): TripState {
  return useSyncExternalStore(subscribeTrip, getTripState, getTripState);
}

/** Запускает planTrip; стадии, результат и ошибка попадают в стор. Поздний ответ от предыдущего запуска игнорируется. */
export function startPlanning(input: TripInput, labels: TripLabels): void {
  const id = ++runId;
  let stages: PlanStage[] = [];
  setState({ status: 'planning', input, labels, stages });
  planTrip(input, {
    onProgress: (stage) => {
      if (id !== runId) return;
      stages = [...stages, stage];
      setState({ status: 'planning', input, labels, stages });
    },
  }).then(
    (result) => {
      if (id === runId) setState({ status: 'done', input, labels, stages, result });
    },
    (err: unknown) => {
      if (id === runId) {
        setState({ status: 'error', input, labels, stages, message: err instanceof Error ? err.message : String(err) });
      }
    }
  );
}

export function resetTrip(): void {
  runId++;
  setState({ status: 'idle' });
}
