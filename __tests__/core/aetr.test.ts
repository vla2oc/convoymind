import {
  BREAK_SEC,
  MAX_CONTINUOUS_DRIVING_SEC,
  MAX_DAILY_DRIVING_SEC,
  nextRequiredBreak,
} from '../../src/core/planner/aetr';

const hm = (h: number, m: number) => h * 3600 + m * 60;

describe('нормы AETR (шаг 5) — константы из PHASE1_CORE.md', () => {
  test('4:30 / 45 мин / 9:00', () => {
    expect(MAX_CONTINUOUS_DRIVING_SEC).toBe(hm(4, 30));
    expect(BREAK_SEC).toBe(hm(0, 45));
    expect(MAX_DAILY_DRIVING_SEC).toBe(hm(9, 0));
  });
});

describe('nextRequiredBreak — непрерывное вождение (суточное далеко от порога)', () => {
  test('4:29 → ещё можно ехать 60 с', () => {
    expect(nextRequiredBreak(hm(4, 29), hm(4, 29))).toEqual({ type: null, remainingSec: 60 });
  });
  test('4:30 → перерыв 45 обязателен (порог включительно)', () => {
    expect(nextRequiredBreak(hm(4, 30), hm(4, 30))).toEqual({ type: 'break45', remainingSec: 0 });
  });
  test('4:31 → перерыв 45 обязателен', () => {
    expect(nextRequiredBreak(hm(4, 31), hm(4, 31))).toEqual({ type: 'break45', remainingSec: 0 });
  });
});

describe('nextRequiredBreak — суточное вождение (после перерыва, непрерывное мало)', () => {
  test('8:59 → ещё можно ехать 60 с', () => {
    expect(nextRequiredBreak(hm(1, 0), hm(8, 59))).toEqual({ type: null, remainingSec: 60 });
  });
  test('9:00 → суточный отдых (порог включительно)', () => {
    expect(nextRequiredBreak(hm(1, 0), hm(9, 0))).toEqual({ type: 'dailyRest', remainingSec: 0 });
  });
  test('9:01 → суточный отдых', () => {
    expect(nextRequiredBreak(hm(1, 0), hm(9, 1))).toEqual({ type: 'dailyRest', remainingSec: 0 });
  });
});

describe('nextRequiredBreak — приоритет и ближайший порог', () => {
  test('оба порога сразу (4:30, 9:00) → dailyRest', () => {
    expect(nextRequiredBreak(hm(4, 30), hm(9, 0))).toEqual({ type: 'dailyRest', remainingSec: 0 });
  });
  test('(4:30, 8:00) → break45', () => {
    expect(nextRequiredBreak(hm(4, 30), hm(8, 0))).toEqual({ type: 'break45', remainingSec: 0 });
  });
  test('(1:00, 8:30) → null, ближе суточный порог: 30 мин', () => {
    expect(nextRequiredBreak(hm(1, 0), hm(8, 30))).toEqual({ type: null, remainingSec: hm(0, 30) });
  });
  test('(4:00, 5:00) → null, ближе непрерывный порог: 30 мин', () => {
    expect(nextRequiredBreak(hm(4, 0), hm(5, 0))).toEqual({ type: null, remainingSec: hm(0, 30) });
  });
  test('(0, 0) → null, 4:30 в запасе', () => {
    expect(nextRequiredBreak(0, 0)).toEqual({ type: null, remainingSec: hm(4, 30) });
  });
});

describe('nextRequiredBreak — противоречивый вход', () => {
  test('отрицательное непрерывное', () => {
    expect(() => nextRequiredBreak(-1, 0)).toThrow('drivenSinceBreakSec');
  });
  test('отрицательное суточное', () => {
    expect(() => nextRequiredBreak(0, -1)).toThrow('drivenTodaySec');
  });
  test('непрерывное больше суточного', () => {
    expect(() => nextRequiredBreak(hm(2, 0), hm(1, 0))).toThrow('cannot exceed');
  });
  test('NaN', () => {
    expect(() => nextRequiredBreak(Number.NaN, 0)).toThrow();
  });
});
