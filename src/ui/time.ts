// Время для экрана: ядро отдаёт ISO-строки (мок — UTC), водителю показываем локальное время устройства.

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** RFC 3339 с оффсетом устройства, без миллисекунд: 2026-09-07T06:00:00+02:00 (формат из API_CONTRACT.md § 4). */
export function toRfc3339Local(date: Date): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

/** HH:MM в локальном времени устройства. Неразбираемая строка → «--:--». */
export function formatClock(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '--:--';
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Длительность «4 ч 25 мин» / «45 мин» / «0 мин»; секунды округляются вниз до минут. */
export function formatDurationHm(sec: number): string {
  const totalMin = Math.max(0, Math.floor(sec / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} мин`;
  return `${h} ч ${pad2(m)} мин`;
}

/** Компактно для карточки: «8:10». */
export function formatHm(sec: number): string {
  const totalMin = Math.max(0, Math.floor(sec / 60));
  return `${Math.floor(totalMin / 60)}:${pad2(totalMin % 60)}`;
}

/** HH:MM:SS в локальном времени устройства — для подписи «обновлено» на карте. */
export function formatClockSec(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

