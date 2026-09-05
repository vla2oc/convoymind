# Фаза 1 — Ядро Convoy Mind (без UI)

Ты работаешь по `CLAUDE.md` в корне репозитория. Он важнее этого документа.
Первым делом прочитай `STATE.md`, `DECISIONS.md`, `NOT_NOW.md` и перескажи состояние в 5 строках. Не начинай, пока пользователь не подтвердил.

## Что делаем

Чистый TypeScript-модуль `src/core`, который по входу «А → Б, время выезда, вес авто» возвращает расписание обязательных остановок с ETA — или сигнал конфликта. Без React, без экранов. Все внешние API замоканы через MSW, тесты бьют по реальному сетевому слою (`fetch` → MSW).

Источник истины по логике — диаграмма `Convoy_mind_diagramm.pdf` (блоки: построить маршрут → расставить остановки → парковка свободна в окне? → собрать расписание → учесть трафик → всё сходится?).

## Критерий «работает» (формулируем до кода)

`npm test` зелёный, и в нём есть два сквозных теста, которые проходят ТОЛЬКО через MSW:

1. **Happy path.** `planTrip({ origin, destination, departureAt, vehicleWeightKg })` для маршрута ~9 часов возвращает `status: 'ok'`, ровно 2 остановки по 45 минут, ETA позже выезда, и при этом MSW зафиксировал: 2 вызова TomTom `calculateRoute` (первый без waypoints, второй с waypoints и `pauseDurationInSeconds: 2700`), ≥1 вызов parking-API с корректными query-параметрами.
2. **Конфликт.** Тот же вход, но parking-handler отвечает «все парковки заняты» → `status: 'conflict'`, в `conflict.reason` понятный текст, `conflict.nearestFreeParking` заполнен, если есть.

Плюс юнит-тесты на планировщик без сети.

## Стек (не расширять)

- Expo (managed, TypeScript). Проект создаётся здесь, потому что фаза 2 будет строить экраны в этом же репо; в фазе 1 ни одного экрана не трогаем.
- Jest (`jest-expo`), `@testing-library/react-native` НЕ ставим — не нужен в фазе 1.
- MSW v2: `msw/node` в тестах, `msw/native` — только настроить экспорт для фазы 2, не подключать к приложению.
- Никаких дополнительных пакетов без записи в `DECISIONS.md` и проверки в `package.json`.

Версии пакетов НЕ придумывать: ставить `npm i <pkg>` и фиксировать то, что реально встало.

## Структура

```
src/core/
  api/
    tomtom.ts          # calculateRoute(): fetch на реальный URL Orbis
    parking.ts         # getParkingsNear(): fetch на наш mock-URL
    types.ts           # только те поля ответов, которые используем
  planner/
    aetr.ts            # нормы — хардкод (// MVP: hardcoded, see NOT_NOW.md)
    breaks.ts          # где вдоль маршрута наступает 4:30
    schedule.ts        # planTrip() — оркестрация по диаграмме
  mocks/
    handlers.ts        # MSW handlers (общие для тестов и приложения)
    fixtures/          # реальные примеры ответов из документации
    parkingGenerator.ts# seeded-генератор занятости
    server.ts          # setupServer(...handlers) для Jest
    native.ts          # setupServer из 'msw/native' для фазы 2
  index.ts             # публичный контракт для фронтенда
__tests__/core/
docs/API_CONTRACT.md   # результат фазы 1, вход для фазы 2
```

Правило: файлы в `src/core` не импортируют `react`, `react-native`, `expo-*`. Это проверяется тестом на grep (шаг 1).

## Шаги (один за раз, каждый — диф + команда проверки + реальный вывод)

### Шаг 1. Скелет и тестовая инфраструктура
- `npx create-expo-app` с TypeScript-шаблоном.
- Подключить Jest + MSW по официальной инструкции MSW для React Native (https://mswjs.io/docs/integrations/react-native/) — прочитать, не по памяти. Полифиллы, которые там требуются, поставить как написано.
- Тест-«дымовуха»: `fetch('https://example.test/ping')` перехватывается MSW и возвращает `{ok:true}`. Это доказывает, что сетевой слой в Jest работает.
- Тест «core не импортирует React»: читает файлы `src/core/**` и падает при `from 'react'` / `react-native` / `expo`.
- Обновить `STATE.md`.

### Шаг 2. Схема TomTom — зафиксировать, не придумывать
- Через web-fetch прочитать документацию Orbis Routing v2 `calculateRoute` (POST): https://developer.tomtom.com/routing-api/documentation/tomtom-orbis-maps/v2/calculate-route
- Из раздела Response взять документированный пример JSON и сохранить как `fixtures/tomtom_route_example.json` без правок.
- В `api/types.ts` описать только поля, которые нужны: суммарные `lengthInMeters`, `travelTimeInSeconds`, `departureTime`, `arrivalTime`; массив `legs[]` с теми же суммами и геометрией точек. Точные имена полей — из документации, с пометкой в `DECISIONS.md`: «схема ответа взята из <URL>, дата».
- Если в документации не находится поле с координатами точек маршрута или время по точкам — остановиться и спросить, не додумывать.

### Шаг 3. `api/tomtom.ts` + MSW-handler
- `calculateRoute(req: RouteRequest): Promise<RouteResponse>` — `fetch` POST на `https://api.tomtom.com/maps/orbis/routing/calculateRoute/json?key=...&apiVersion=...`. Тело: `origin`, `destination`, опционально `waypoints` (MultiPoint) и `legs[]` с `routeStop.pauseDurationInSeconds`, `departureDateTime`, `traffic: 'live'`, `vehicleWeightInKilograms`. Пути и имена параметров — из документации, шаг 2.
- Ключ читать из `process.env.EXPO_PUBLIC_TOMTOM_KEY`; в тестах — фиктивный.
- Handler отдаёт фикстуру; для второго вызова (с waypoints) — вторую фикстуру с `legs.length === waypoints.length + 1`. Если в доке нет примера с несколькими плечами — собрать из одноплечевого, пометив в `DECISIONS.md` как синтетическую.
- Тест: проверить метод, URL, наличие `key` и `apiVersion`, тело запроса (`legs[i].routeStop.pauseDurationInSeconds === 2700` для остановок и `0` для последнего плеча — дока требует 0 в последнем), и что ответ распарсился в наши типы.

### Шаг 4. Parking-API (мок по дизайну, схема — наша)
- Реального бесплатного общеевропейского API нет, поэтому схема наша:
  `GET https://mock.convoy-mind.local/v1/parkings?lat&lon&radiusKm&at=<ISO>` →
  `{ parkings: [{ id, name, lat, lon, capacityTotal, freeAt: number, confidence: 0..1 }] }`.
- `parkingGenerator.ts`: детерминированный (seed) генератор: 3–6 парковок в радиусе, занятость по простому распределению: ночью (22–06) занято 85–100%, днём 40–70%. Параметры вынести в константы с пометкой MVP. `confidence` = 0.6 для «прогноз», 0.9 для «сейчас».
- Handler + тест: query-параметры дошли, ответ детерминирован при одном seed, при `X-Mock-Scenario: all-full` (заголовок или отдельный handler через `server.use`) все `freeAt === 0`.

### Шаг 5. Нормы AETR — `planner/aetr.ts`
Хардкод, только то, что нужно MVP:
- после 4:30 непрерывного вождения — перерыв ≥ 45 мин;
- суточное вождение ≤ 9:00; при превышении — суточный отдых 11 ч (в MVP: просто помечаем `requiresDailyRest: true` и не планируем дальше, см. `NOT_NOW.md`).
- Функция `nextRequiredBreak(drivenSinceBreakSec, drivenTodaySec): { type: 'break45' | 'dailyRest' | null, ... }`. Юнит-тесты на границы (4:29, 4:30, 4:31; 8:59, 9:00).
- Разбиение 15+30, недельные лимиты, экипаж из двух — НЕ делать, записать в `NOT_NOW.md`.

### Шаг 6. `planner/breaks.ts` — где на маршруте наступает 4:30
- Вход: геометрия маршрута + суммарное время из вызова 1.
- MVP-допущение (пометить): время распределено пропорционально расстоянию вдоль точек. Идём по точкам, накапливаем дистанцию, переводим в время, ставим «якорь остановки» там, где накопилось 4:30 минус запас 20 мин (константа `BREAK_LOOKAHEAD_MIN = 20`, с пометкой MVP).
- Выход: массив якорей `{ lat, lon, plannedArrivalAt }`.
- Юнит-тест на синтетической прямой: 900 км за 9 ч → два якоря на ~430 км и ~860 км от старта.

### Шаг 7. `planner/schedule.ts` — `planTrip()` по диаграмме
1. `calculateRoute(A→B)` без waypoints.
2. `breaks.ts` → якоря.
3. Для каждого якоря: `getParkingsNear(якорь, radiusKm=25, at=plannedArrivalAt)`; выбрать ближайшую по маршруту с `freeAt >= 1`. Нет свободных → `status: 'conflict'` с причиной и `nearestFreeParking` (если хоть где-то есть).
4. `calculateRoute(A → parkings → B)` с `pauseDurationInSeconds: 2700` на плечах остановок.
5. Проверка «всё сходится»: по времени плеч из вызова 2 пересчитать фактические приезды на парковки; если приезд сдвинулся более чем на 30 мин от `plannedArrivalAt` — один повторный запрос парковок по новому времени; если снова занято → conflict. Больше одной итерации не делать (MVP).
6. Вернуть `PlanResult`.

Сквозные тесты из критерия «работает» — здесь.

### Шаг 8. `docs/API_CONTRACT.md` и `src/core/index.ts`
Экспортировать: `planTrip`, типы `TripInput`, `PlanResult`, `Stop`, `Conflict`, и `mocks/native` для включения MSW в приложении. В `API_CONTRACT.md` — сигнатуры, пример JSON результата (реальный вывод теста, скопированный из консоли, не написанный от руки), и раздел «Как включить моки в приложении» со ссылкой на файл. Этот документ — единственное, что будет читать агент фазы 2.

## Отчёт по завершении

В `STATE.md`: что сделано, вывод `npm test` (реальный), список `[предположение]`, которые остались непроверенными.
