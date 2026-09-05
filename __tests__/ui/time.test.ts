import { pluralRu } from '../../src/ui/text';
import { formatClock, formatDurationHm, formatHm, toRfc3339Local } from '../../src/ui/time';

describe('toRfc3339Local', () => {
  test('формат RFC 3339 с оффсетом устройства, без миллисекунд', () => {
    const d = new Date(2026, 8, 7, 6, 0, 0); // локальное 2026-09-07 06:00:00
    const s = toRfc3339Local(d);
    expect(s).toMatch(/^2026-09-07T06:00:00[+-]\d{2}:\d{2}$/);
    expect(Date.parse(s)).toBe(d.getTime());
  });
});

describe('formatClock', () => {
  test('локальные часы и минуты', () => {
    const d = new Date(2026, 8, 7, 15, 42, 9);
    expect(formatClock(d.toISOString())).toBe('15:42');
  });
  test('плохая строка → --:--', () => {
    expect(formatClock('nope')).toBe('--:--');
  });
});

describe('formatDurationHm / formatHm', () => {
  test.each([
    [0, '0 мин', '0:00'],
    [2700, '45 мин', '0:45'],
    [15075, '4 ч 11 мин', '4:11'],
    [32061, '8 ч 54 мин', '8:54'],
    [-5, '0 мин', '0:00'],
  ])('%i с', (sec, long, short) => {
    expect(formatDurationHm(sec)).toBe(long);
    expect(formatHm(sec)).toBe(short);
  });
});

describe('pluralRu', () => {
  const forms: [string, string, string] = ['перерыв', 'перерыва', 'перерывов'];
  test.each([
    [1, 'перерыв'],
    [2, 'перерыва'],
    [4, 'перерыва'],
    [5, 'перерывов'],
    [11, 'перерывов'],
    [21, 'перерыв'],
    [0, 'перерывов'],
  ])('%i', (n, expected) => {
    expect(pluralRu(n, forms)).toBe(expected);
  });
});
