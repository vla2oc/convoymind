## Цель MVP
Водитель вводит А → Б, время выезда и вес авто — получает ленту обязательных остановок на реальных (мок) парковках по нормам AETR с ETA, либо сигнал конфликта заранее. Все внешние API через MSW.

## Для следующего агента (прочитать первым)

### Где мы
**Фаза 3 (`docs/PHASE3_MAP.md`) ЗАВЕРШЕНА: 8 шагов из 8.** Итог — раздел «Итог фазы 3» ниже. Не проверено одно: запуск в Expo Go на телефоне (симуляторов на машине нет). Журнал шагов фазы 3 — раздел «Фаза 3: журнал шагов» ниже, читать его первым.

**Фаза 1 (`docs/PHASE1_CORE.md`) завершена, фаза 2 (`docs/PHASE2_APP.md`) завершена: 7 шагов из 7.** Три экрана в `src/app/` поверх `planTrip()` из `src/core`, моки `msw/native` под `__DEV__`, тесты экранов через `@testing-library/react-native` + MSW. Не проверено только одно: запуск в Expo Go на телефоне (на машине разработчика нет симуляторов) — всё сквозное проверялось на web (`expo start --web`, Chrome). В git ничего не закоммичено (по решению пользователя — после фазы 2).

### С чего начать (по порядку)
1. `npm test && npm run typecheck` — ожидается **17 suites / 132 tests passed** и **exit 0** у tsc (было 14/101 до фазы 3). Если не так — чинить, дальше не идти.
2. Прочитать `docs/DECISIONS.md` и `docs/NOT_NOW.md`. Там — каждое отклонение от `PHASE1_CORE.md`/`PHASE2_APP.md` и почему. Главные:
   - Jest: два проекта — `core` (`jest-expo/node`, `__tests__/core/**`, `__tests__/ui/**`) и `screens` (`jest-expo/ios`, `__tests__/screens/**`). В `screens` `msw/node` идёт через `moduleNameMapper` на CJS, а `fetch` восстанавливается из `globalThis.originalfetch` (`jest.setup.screens.ts`).
   - `babel.config.js` обязателен для Jest; три ESM-only зависимости msw транспилируются (список в `jest.config.js`).
   - Имена TomTom — из документации: `pauseTimeInSeconds`, query `vehicleWeight`, координаты в пути URL через двоеточие.
   - Мок TomTom — генератор `routeGenerator.ts` (прямые, 100 км/ч); мок парковок — сетка 0.3°, день/ночь по UTC.
   - Сценарии мока: `setMockScenario('all-full')` (все заняты, на экране 1 это dev-`Switch`) и `setMockScenario('live')` (дрейф занятости по минутам, фаза 3, шаг 3). Оба выключены по умолчанию.
   - `planTrip(input, options?)` с `onProgress(stage)` — единственная правка ядра в фазе 2.
   - Expo Router в `src/app/`, стек `index → planning → result`, состояние между экранами — `src/ui/tripStore.ts`.
3. Пересказать пользователю состояние в 5 строках и **ждать подтверждения** (правило из `CLAUDE.md`).
4. Дальше — по «Следующий шаг» ниже. Один шаг за раз: диф → команда проверки → реальный вывод → обновить этот файл.

### Команды
- `npm test` — Jest, проекты `core` и `screens`; MSW в `jest.setup.ts` / `jest.setup.screens.ts` с `onUnhandledRequest: 'error'` (любой запрос мимо handlers валит тест). Один проект: `npx jest --selectProjects screens`.
- `npm run typecheck` — `tsc --noEmit`, покрывает и тесты.
- `npx expo start` — приложение (Expo Go / симулятор); `npx expo start --web` — в браузере. В консоли Metro перехваченные запросы видны как `[msw] METHOD URL`. Metro WARN «Falling back to file-based resolution» для msw — ожидаемы (DECISIONS).
- Ключ TomTom: `.env` в корне (в `.gitignore`) — `EXPO_PUBLIC_TOMTOM_KEY=<значение локально, в документы не пишем>`; с моками годится любое непустое, там сейчас настоящий ключ (фаза 3, шаг 4). Без файла `planTrip` бросает до сети. В тестах ключ задаётся в setup-файлах.
- Parking-API ключа не требует; в тестах и в приложении его целиком отдаёт MSW-handler.

### Карта файлов (что уже есть)
| Файл | Что внутри |
|---|---|
| `src/core/types.ts` | `GeoPoint { lat, lon }` — координаты внутри ядра и в публичном контракте |
| `src/core/geo.ts` | `haversineMeters(a, b)` — для моков и планировщика (шаг 6) |
| `src/core/api/types.ts` | TomTom: `RouteRequest`, `RouteResponse`, `RouteSummary`, `RouteLeg`, `TomTomPoint { latitude, longitude }` — только используемые поля, в JSDoc цитаты из документации. Parking: `Parking { id, name, lat, lon, capacityTotal, freeAt, confidence }`, `ParkingsResponse`, `ParkingsQuery { lat, lon, radiusKm, at }` |
| `src/core/api/tomtom.ts` | `calculateRoute(req)`, `buildCalculateRouteUrl(req, key)`, `buildCalculateRouteBody(req)`, `TOMTOM_CALCULATE_ROUTE_BASE` |
| `src/core/api/parking.ts` | `getParkingsNear(q): Promise<Parking[]>`, `buildParkingsUrl(q)`, `PARKING_API_BASE = 'https://mock.convoy-mind.local/v1'`; GET `…/parkings?lat&lon&radiusKm&at` |
| `src/core/mocks/handlers.ts` | именованные `tomtomCalculateRoute` / `parkingsNear`, массив `handlers`, `appHandlers({ tomtomLive })` и `isTomTomLive()` (фаза 3, шаг 4). Содержимое handlers: (1) TomTom POST `…/calculateRoute/:locations/json` — проверяет `key`, `apiVersion=2`, `legs.length = waypoints + 1`, последняя пауза 0; (2) Parking GET `PARKINGS_PATTERN` — 400 на плохие query, вызывает `generateParkings({ …, now: Date.now() })`, при сценарии `all-full` отдаёт те же парковки с `freeAt: 0` |
| `src/core/mocks/scenario.ts` | `MockScenario = 'all-full' \| 'live'`, `setMockScenario(s \| null)`, `getMockScenario()` — модульная переменная |
| `src/core/mocks/parkingGenerator.ts` | `generateParkings({ lat, lon, radiusKm, at, now })` → `Parking[]`; парковки — свойство географии: сетка `MOCK_CELL_DEG = 0.3`, в ячейке `MOCK_PARKINGS_PER_CELL_MIN/MAX = 1/2` парковки с seed FNV-1a от индексов ячейки (PRNG mulberry32), ответ — подмножество в радиусе, ближайшие первыми; `MOCK_CAPACITY_MIN/MAX = 20/80`, ночь `[22, 06)` UTC → занято 85–100 %, день 40–70 %, `MOCK_CONFIDENCE_NOW/FORECAST = 0.9/0.6` при `\|at − now\| ≤ 1 ч`; флаг `live` → дрейф занятости `±MOCK_LIVE_AMPLITUDE = 0.35` по слотам `MOCK_LIVE_TICK_MS = 60_000` мс, seed от `(id, слот)` |
| `src/core/mocks/routeGenerator.ts` | `generateRoute({ locations, departAt, pausesSec })` → `RouteResponse`; константы `MOCK_AVG_SPEED_KMH = 100`, `MOCK_POINT_SPACING_M = 5000` |
| `src/core/planner/aetr.ts` | `MAX_CONTINUOUS_DRIVING_SEC = 16200`, `BREAK_SEC = 2700`, `MAX_DAILY_DRIVING_SEC = 32400`; `nextRequiredBreak(drivenSinceBreakSec, drivenTodaySec): BreakRequirement { type: 'break45' \| 'dailyRest' \| null, remainingSec }` — пороги включительно, приоритет `dailyRest`, бросает на отрицательных и `sinceBreak > today` |
| `src/core/planner/breaks.ts` | `BREAK_LOOKAHEAD_MIN = 20`, `ANCHOR_THRESHOLD_SEC = 15000` (4:10); `placeBreakAnchors({ points: GeoPoint[], travelTimeSec, departureAt })` → `Anchor[]`, `Anchor { lat, lon, plannedArrivalAt (ISO UTC), drivenSecFromPrev, drivenSecFromStart }`; интерполяция внутри сегмента, очередной якорь не ставится, если от предыдущего до финиша < 4:30; суточный лимит не учитывает |
| `src/core/planner/schedule.ts` | `planTrip(input: TripInput): Promise<PlanResult>`; типы `TripInput`, `Stop`, `Conflict`, `ConflictCode`, `PlanResult`; константы `PARKING_SEARCH_RADIUS_KM = 25`, `CONFLICT_SEARCH_RADIUS_KM = 50`, `MAX_ARRIVAL_SHIFT_SEC = 1800`. Порядок: вызов 1 → `placeBreakAnchors` → (нет якорей → ok по вызову 1) → на каждый якорь `getParkingsNear(25 км)`, ближайшая по haversine с `freeAt ≥ 1`, нет → запрос 50 км только для `nearestFreeParking` и `conflict no-free-parking` → вызов 2 с `pauseTimeInSeconds = BREAK_SEC` → сдвиг приезда > 30 мин → один повторный `getParkingsNear` по новому `at`, выбранная занята → `parking-lost-after-reroute` → любое плечо > 4:30 → `leg-exceeds-continuous-limit` → ok |
| `src/core/index.ts` | публичный вход: `planTrip` + типы `TripInput`, `PlanResult`, `Stop`, `Conflict`, `ConflictCode`, `Anchor`, `Parking`, `GeoPoint`; моков и msw нет намеренно |
| `src/core/mocks/server.ts` / `native.ts` | `setupServer(...)` из `msw/node` (Jest, всегда полный набор) и `msw/native` (приложение, набор из `appHandlers` — при `EXPO_PUBLIC_TOMTOM_LIVE=1` без TomTom) |
| `.env.example` (корень, в git) | `EXPO_PUBLIC_TOMTOM_KEY=` и `EXPO_PUBLIC_TOMTOM_LIVE=0` с комментариями; реальные значения — только в `.env` (в `.gitignore`) |
| `__tests__/core/tomtom-live.test.ts` | 4 теста (фаза 3, шаг 4): набор при LIVE выкл/вкл; `isTomTomLive()` включается только точным `'1'`; с набором LIVE запрос к TomTom не перехвачен, парковки перехвачены |
| `src/core/mocks/fixtures/tomtom_route_example.json` | пример ответа из документации (1147 м / 161 с) |
| `msw.polyfills.js` (корень) | полифиллы для `msw/native`, только для фазы 2 |
| `docs/API_CONTRACT.md` | контракт ядра для фазы 2: импорт, сигнатура, типы, семантика, реальные JSON, пресеты, включение моков, ограничения |
| `__tests__/core/smoke.test.ts` | сетевой слой в Jest работает через MSW |
| `__tests__/core/no-react-in-core.test.ts` | `src/core` не импортирует react / react-native / expo |
| `__tests__/core/helpers.ts` | `recordRequests()` — записывает запросы, ушедшие в MSW (клоны), для проверки URL/query/тела |
| `__tests__/core/tomtom.test.ts` | 5 тестов на `calculateRoute` и мок |
| `__tests__/core/parking.test.ts` | 17 тестов (10 из фазы 1 + 7 из фазы 3, шаг 3): URL и query; схема, радиус, днём `freeAt ≥ 1`; детерминизм; ночь ≥ 85 %; `all-full`; сброс сценария; 400; стабильность (50 км ⊇ 25 км, соседний центр, ближайшие первыми); `confidence` по `now`; сценарий `'live'`: один слот → тот же ответ, разные слоты → другой `freeAt`, дрейфует только `freeAt`, `clamp [0, capacityTotal]`, `live: false` = без флага, через MSW — оба направления |
| `__tests__/core/aetr.test.ts` | 16 тестов без сети: константы; границы 4:29/4:30/4:31 и 8:59/9:00/9:01; приоритет `dailyRest`; `remainingSec` по ближайшему порогу; ошибки входа |
| `__tests__/core/breaks.test.ts` | 17 тестов без сети: меридиан 900 км / 9 ч (181 точка и 2 точки) → якоря 4:10 / 8:20; реальный вывод `generateRoute` Варшава → Франкфурт; границы 4:00…9:00 (`test.each`); вырожденный и плохой вход |
| `__tests__/core/index.test.ts` | 2 теста: `planTrip` из `src/core` проходит через MSW; в `index.ts` нет импортов `mocks`/`msw` |
| `__tests__/core/schedule.test.ts` | 9 сквозных тестов через MSW: happy path и конфликт `all-full` из критерия; `nearestFreeParking` через override parking-handler'а (радиус 25 → занято, `return undefined` → штатный); короткий маршрут без остановок; сдвиг > 30 мин через override TomTom (`delaySecondCall`) → повторный запрос → ok; то же + выбранная занята → `parking-lost-after-reroute`; плечо > 4:30 → `leg-exceeds-continuous-limit`; Варшава → Париж → 3 остановки, `requiresDailyRest`; плохой вход |
| `src/core/planner/corridor.ts` | `getParkingsAlongRoute({ points, departureAt, drivingTimeSec, stops, corridorKm = 15, stepKm = 25 })` → `RoutedParking[]` (`Parking` + `routeProgressM`, `etaAt`, `status`, `chosen`); константы `CORRIDOR_RADIUS_KM`, `CORRIDOR_STEP_KM`. Обход полилинии шагом 25 км, дедуп по `id`, сортировка по прогрессу |
| `__tests__/core/corridor.test.ts` | 9 тестов (фаза 3, шаг 2): 36 запросов = ⌈длина/25 км⌉ и растущий `at`; дедуп и порядок; `chosen`/`status`; `etaAt` = приезд, а не отъезд; `all-full` → все `full`; стабильность сетки; переопределение `stepKm`/`corridorKm`; плохой вход без сети; детерминизм |
| `__tests__/core/contract.test.ts` | 2 теста (фаза 3, шаг 1): § 5 `docs/API_CONTRACT.md` равен реальному выводу `planTrip` (кроме сокращённого `route.points` — сверяется число точек и начало/конец); `__tests__/screens/fixtures.ts` собран из тех же данных. `UPDATE_CONTRACT=1 npx jest --selectProjects core contract` перезаписывает § 5 и фикстуры |
| `__tests__/core/progress.test.ts` | 5 тестов на `onProgress`: порядок стадий, короткий маршрут, обрыв на конфликте, reject до стадий, старая сигнатура |
| `src/app/_layout.tsx` | `Stack` без хедера (`index`, `planning`, `result`); под `__DEV__` — полифиллы → `msw/native` → `listen({ onUnhandledRequest: 'bypass' })` + лог `[msw]` |
| `src/app/index.tsx` | Экран 1: чипы «Откуда/Куда» (`CITY_PRESETS`), выезд «Сейчас/+30 мин/+1 ч/+2 ч» или фиксированный `departureAt` из параметра маршрута (чип «в HH:MM»), вес `TextInput` (> 0), два взаимоисключающих dev-`Switch` («все парковки заняты» / «live») → `setMockScenario`, кнопка → `startPlanning` + `router.push('/planning')` |
| `src/app/planning.tsx` | Экран 2: «Откуда → Куда», четыре строки ●/○ по `stages` из стора, `done` → `router.replace('/result')` не раньше `PLANNING_MIN_VISIBLE_MS`, `error` → «Ошибка расчёта» + «К вводу» |
| `src/app/result.tsx` | Экран 3 (фаза 3): карточка ok / красная карточка conflict («Выехать раньше», «Другая парковка» → «Скоро»), ниже карта из `@/ui/routeMap`, бейдж «Парковок: N · остановок: M», `useRouteParkings` (загрузка коридора), «Новый маршрут» → `resetTrip` + `/`. Ленты времени больше нет — заменена картой |
| `src/ui/theme.ts` | Токены: `Palette.light/dark` (`ThemeColors`), `FontSize`, `Spacing`, `Radius`, `TouchTarget`, `useTheme()` |
| `src/ui/presets.ts` | `CITY_PRESETS` (Варшава, Лодзь, Франкфурт, Париж — координаты контракта § 5), `DEFAULT_ORIGIN_ID/DESTINATION_ID`, `DEFAULT_VEHICLE_WEIGHT_KG = 40000`, `DEPARTURE_OFFSETS` |
| `src/ui/planningStages.ts` | `PLAN_STAGES` (подписи стадий), `PLANNING_MIN_VISIBLE_MS = 1200` |
| `src/ui/tripStore.ts` | `TripState` (`idle | planning | done | error`, с `input`, `labels`, `stages`, `result`/`message`), `startPlanning(input, labels)`, `useTripState()`, `getTripState()`, `setTripState()`, `resetTrip()` |
| `src/ui/time.ts` | `toRfc3339Local`, `formatClock` (HH:MM локально), `formatDurationHm` («4 ч 11 мин»), `formatHm` («8:54»), `formatClockSec(ms)` (HH:MM:SS, фаза 3) |
| `src/ui/text.ts` | `pluralRu(n, [форма1, форма2, форма5])`; `freeLine(p, at?)`, `parkingCallout(p, stop?)` (фаза 3, шаг 6) |
| `src/ui/routeMap.tsx` / `routeMap.web.tsx` | `RouteMapView`, `ConflictMapView`, `markerColor`. Натив — `react-native-maps` (единственное место импорта); web — список тех же данных без пакета, Metro подставляет `.web` сам. **Пакет ломает web-бандл целиком, см. шаг 6** |
| `__tests__/screens/maps-mock.tsx` | мок `react-native-maps` для Jest (в тестовом окружении пакет падает на `TurboModuleRegistry`); подключён в `jest.setup.screens.ts`, `fitToCoordinatesCalls` для проверок |
| `jest.setup.screens.ts` | Setup проекта `screens`: ключ, восстановление `fetch` из `originalfetch`, MSW listen/reset/close |
| `__tests__/ui/time.test.ts` | 15 тестов хелперов времени и `pluralRu` (проект `core`) |
| `__tests__/screens/fixtures.ts` | `TRIP_INPUT`, `LABELS`, `OK_RESULT`, `CONFLICT_RESULT` — JSON из контракта § 5, сгенерировано скриптом |
| `__tests__/screens/expo-router-matchers.d.ts` | Типы матчеров `expo-router/testing-library` (`toHavePathname` и др.) |
| `__tests__/screens/input.test.tsx` | 5 тестов экрана 1 через `renderRouter`: кнопка → POST к TomTom с координатами пресетов → `/planning` → `/result`; Лодзь; `+1 ч`; dev-переключатель → красная карточка; невалидный вес |
| `__tests__/screens/planning.test.tsx` | 4 теста экрана 2: стадии по `onProgress` и переход после минимального времени; `all-full` — две стадии; ошибка; пустой стор |
| `__tests__/screens/result.test.tsx` | 6 тестов экрана 3 ok с фикстурой: карточка, лента (2 остановки, плечи 4 ч 11 / 4 ч 09 / 33 мин), `confidence`, `requiresDailyRest`, без остановок, пустой стор |
| `__tests__/screens/conflict.test.tsx` | 4 теста экрана 3 conflict: карточка, `nearestFreeParking`, «Выехать раньше» → `/?departureAt=…`, «Другая парковка» → «Скоро» |

### Контракты, на которые опираться дальше
- `RouteRequest = { origin, destination, waypoints?, departAt (ISO с оффсетом), vehicleWeightKg, pauseTimeInSeconds? }`.
- В ответе TomTom вождение считать по `routes[0].legs[i].summary.travelTimeInSeconds`, ETA брать из `routes[0].summary.arrivalTime`, геометрию из `legs[i].points[]`. Времени по точкам нет (пропорция по расстоянию — `NOT_NOW.md`).
- Даты из мока — ISO в UTC (`…Z`); сравнивать через `Date.parse`, не по строке.
- Parking: `getParkingsNear({ lat, lon, radiusKm, at })` → `Parking[]`; выбирать `freeAt ≥ 1`; парковки привязаны к ячейкам сетки, а не к запросу: тот же id всегда в той же точке с той же ёмкостью, запрос на 50 км ⊇ запрос на 25 км, занятость меняется только между днём и ночью (UTC). Днём при любых координатах `freeAt ≥ 6` — happy path шага 7 свободную парковку найдёт. `confidence` от планировщика не зависит (0.6 для будущих `at`).
- Публичный контракт (окончательно, шаг 8 только реэкспортирует): `TripInput { origin, destination, departureAt, vehicleWeightKg }`; `PlanResult = { status: 'ok', departureAt, arrivalAt, drivingTimeSec, stops: Stop[], requiresDailyRest } | { status: 'conflict', conflict: Conflict }`; `Stop { parking: Parking, arrivalAt, departAt, pauseSec, drivingSecFromPrev }`; `Conflict { code: ConflictCode, reason (англ.), anchor: Anchor, nearestFreeParking?: Parking }`; `ConflictCode = 'no-free-parking' | 'parking-lost-after-reroute' | 'leg-exceeds-continuous-limit'`. Плохой вход — `throw`, не conflict. Даты: `departureAt` — как передали, остальное — из TomTom (мок: UTC `Z`).
- Якоря: `placeBreakAnchors` принимает `GeoPoint[]` — шаг 7 сам склеивает `legs[].points` и конвертирует `TomTomPoint → GeoPoint` (`{ lat: p.latitude, lon: p.longitude }`, как в `breaks.test.ts`). Для Варшава → Франкфурт (8:54) якоря на 4:10 и 8:20 вождения — координаты см. «Сделано», шаг 6.
- AETR: планировщик берёт константы из `planner/aetr.ts`, не дублирует числа. `BREAK_SEC` = `pauseTimeInSeconds` для TomTom. `requiresDailyRest` в шаге 7 = `nextRequiredBreak(x, totalDrivingSec).type === 'dailyRest'` при любом `x ≤ total`, проще — `totalDrivingSec >= MAX_DAILY_DRIVING_SEC`.
- Тестовый маршрут: Варшава `{52.2297, 21.0122}` → Франкфурт `{50.1109, 8.6821}`, выезд `2026-09-07T06:00:00+02:00` — по прямой 890 км, 8 ч 54 мин вождения (≤ 9:00, что нужно happy path шага 7).

## Фаза 3: журнал шагов

Пошагово, чтобы было видно, на каком шаге могла появиться ошибка. Формат: шаг — что тронуто — чем проверено — реальный вывод.

### Решения перед стартом (подтверждены пользователем 2026-09-06)
- Ключ TomTom в `.env` — настоящий, но `EXPO_PUBLIC_TOMTOM_LIVE=0` по умолчанию; живой вызов проверяет пользователь на шаге 6.
- `route.points` в § 5 контракта — сокращён, сверка скриптом на остальные поля.
- Карта заменяет ленту; 6 тестов ленты будут переписаны на шаге 8.
- Второй Jest-проект не заводим (`screens` уже есть), тесты экрана — в `__tests__/screens/`.

### Шаг 1 — `route.points` в `PlanResult` — СДЕЛАН (2026-09-06)
**Тронуто:**
- `src/core/planner/schedule.ts` — в ветку `ok` типа `PlanResult` добавлено `route: { points: GeoPoint[] }`; заполняется в `okResult()` через уже существовавший `routePoints(route)`. Других изменений в ядре нет.
- `__tests__/core/schedule.test.ts` — **добавлены** 2 теста (`route.points` на happy path и на коротком маршруте) и 2 хелпера (`expectedRoutePoints`, `expectedRoutePointsAB`). Существующие тесты не менялись.
- `__tests__/core/contract.test.ts` — **новый файл**, 2 теста: § 5 контракта равен реальному выводу `planTrip`; `__tests__/screens/fixtures.ts` собран из тех же данных.
- `docs/API_CONTRACT.md` — § 2 (блок типов) и § 5 (оба JSON + маркер `<!-- contract:ok points=181 head=3 tail=1 -->` + пояснение про сокращение).
- `__tests__/screens/fixtures.ts` — перегенерирован (появился `route`, шапка получила команду обновления).

**Где искать ошибку, если что-то не так:**
- Расхождение § 5 и вывода ядра → упадёт `contract.test.ts`, в дифе будет видно поле. Починка: осознать причину, потом `UPDATE_CONTRACT=1 npx jest --selectProjects core contract`.
- `route.points` берётся из **последнего** вызова TomTom: happy path → маршрут через парковки (181 точка), маршрут без якорей → единственный вызов A → B. Если на карте полилиния не проходит через остановки — смотреть `okResult()` в `schedule.ts`.
- Сокращение `points` до 4 штук живёт **только** в документе и фикстурах; в рантайме массив полный.

**Проверено:**
- Сверка ловит расхождение: правка одной цифры в § 5 → `Tests: 2 failed, 84 passed` с дифом по `drivingTimeSec`; после отката — снова зелено.
- Реальный вывод: `route.points` = 181 точка, первая `{52.2297, 21.0122}`, последняя `{50.1109, 8.6821}`, обе остановки лежат на полилинии.
- `npm test` — **15 suites / 105 tests passed** (было 14/101: +2 в `schedule.test.ts`, +2 новых в `contract.test.ts`).
- `npm run typecheck` — exit 0.

### Шаг 2 — парковки вдоль маршрута — СДЕЛАН (2026-09-06)
**Тронуто:**
- `src/core/planner/corridor.ts` — **новый файл**: `getParkingsAlongRoute()`, тип `RoutedParking`, константы `CORRIDOR_RADIUS_KM = 15`, `CORRIDOR_STEP_KM = 25`.
- `src/core/index.ts` — экспорт функции, констант и типов `RoutedParking` / `GetParkingsAlongRouteInput`.
- `__tests__/core/corridor.test.ts` — **новый файл**, 9 тестов через MSW. Ничего существующего не тронуто.

**Как работает (чтобы было где искать ошибку):**
- Обход полилинии: запросы на прогрессе `0, 25 км, 50 км, …` пока прогресс `< totalM` → ровно `ceil(длина / шаг)` = **36** запросов на тестовом маршруте. Число 36 зафиксировано в тесте: если сменится геометрия мока, тест упадёт и покажет это.
- `routeProgressM` — прогресс ближайшей вершины полилинии. Дедуп по `id`, побеждает первый запрос по ходу маршрута. Сортировка по `routeProgressM`.
- `etaAt` = `departureAt + (прогресс/всего)·drivingTimeSec + 45 мин × число остановок **строго до** этой точки.
- `status` = `freeAt >= 1 ? 'free' : 'full'`; `chosen` = id есть в `stops`.

**Ошибка, найденная и исправленная внутри шага (важно, если поведение снова разъедется):**
первая версия считала паузы как `<= progressM`, из-за чего выбранной остановке засчитывалась её собственная пауза и `etaAt` был **отъездом** (08:56), а не **приездом** (08:11). Найдено не тестом, а глазами на реальном выводе. Исправлено на строгое `<`, закрыто тестом «etaAt выбранной парковки — приезд на остановку, а не отъезд после перерыва».

**Реальный вывод (Варшава → Франкфурт, выезд `2026-09-07T06:00:00+02:00`):**
```
ВСЕГО 45 парковок | free 44 | full 1 | chosen 2
ОСТАНОВКА mock-5fc8bd88-1  419 км  etaAt=2026-09-07T08:11:16Z  план приезд=08:11:15Z  отъезд=08:56:15Z
ОСТАНОВКА mock-481aea79-1  836 км  etaAt=2026-09-07T13:06:10Z  план приезд=13:06:09Z  отъезд=13:51:09Z
ЗАНЯТЫЕ: mock-b5896d57-1 0/36 @154 км
ФИНИШ: последняя парковка 886 км etaAt=14:21:20Z, план arrivalAt=14:24:21Z
```
45 парковок и 2 выделенных перекрывают критерий 3b («≥ 10 маркеров, 2 выделенных»). Расхождение `etaAt` с планом — 1 секунда (пропорция по расстоянию против реальных времён плеч).

**Проверено:** `npm test` — **16 suites / 114 tests passed**; `npm run typecheck` — exit 0.

### Шаг 3 — мок-сценарий `'live'` — СДЕЛАН (2026-09-06)
**Тронуто:**
- `src/core/mocks/scenario.ts` — `MockScenario = 'all-full' | 'live'` + JSDoc, что делает каждый.
- `src/core/mocks/parkingGenerator.ts` — константы `MOCK_LIVE_TICK_MS = 60_000`, `MOCK_LIVE_AMPLITUDE = 0.35`; необязательный флаг `live` во входе; дрейф занятости и `clamp` в `[0, capacityTotal]`.
- `src/core/mocks/handlers.ts` — одна строка: `live: getMockScenario() === 'live'` в вызов генератора.
- `__tests__/core/parking.test.ts` — **+7 тестов** в двух новых `describe` в конце файла и одна строка импорта. Существующие 10 тестов не тронуты.
- `__tests__/core/corridor.test.ts` — **+1 тест** (`'live'` за минуту меняет статус хотя бы одного маркера, id не прыгают) — заранее проверяет в ядре то, что на экране (шаг 7) проверить будет нечем.

**Как работает:**
дрейф = `(mulberry32(FNV-1a("<id>@<слот>"))() * 2 − 1) × 0.35`, слот = `floor(now / 60_000)`; прибавляется к доле занятости, результат зажимается в `[0, capacityTotal]`. Внутри одной минуты ответ идентичен, между минутами — другой. Влияет **только** на `freeAt`: id, координаты, ёмкость и `confidence` те же.

**Почему амплитуда именно 0.35 (не на глаз):** днём занято 40–70 %, дрейф 10–15 % не довёл бы парковку до нуля — `freeAt` менялся бы, а **цвет маркера нет**, и критерий 3b не выполнялся бы. Замер по 45 парковкам коридора:
```
слот 1: freeAt изменился у 40 из 45 | СТАТУС сменился у 5 | занятых 5
слот 2: freeAt изменился у 43 из 45 | СТАТУС сменился у 9 | занятых 4
слот 3: freeAt изменился у 43 из 45 | СТАТУС сменился у 3 | занятых 3
выбранная парковка по слотам: 25/57 → 36/57 → 44/57 → 30/57 → 24/57 → 36/57
```

**Где искать ошибку:**
- Сценарий не сбросили между тестами → `jest.setup.ts` делает `setMockScenario(null)` в `afterEach`; если тест «поплыл», смотреть туда.
- `live` не должен трогать вывод без сценария. Это охраняют: старые 10 тестов `parking.test.ts`, тест «`live: false` = без флага» и `contract.test.ts` (§ 5 равен реальному выводу `planTrip`).
- Дрейф зависит от `Date.now()`, а не от `at` — в тестах время подменяется `jest.spyOn(Date, 'now')`, не фейковыми таймерами.

**Проверено:** `npm test` — **16 suites / 122 tests passed** (было 114); `npm run typecheck` — exit 0.

### Шаг 4 — реальный TomTom по opt-in — СДЕЛАН (2026-09-06)
**Тронуто:**
- `src/core/mocks/handlers.ts` — `tomtomCalculateRoute` и `parkingsNear` стали именованными экспортами; добавлены `appHandlers({ tomtomLive })` (чистый выбор набора) и `isTomTomLive()` (чтение `EXPO_PUBLIC_TOMTOM_LIVE === '1'`). Массив `handlers` не менялся — тесты фаз 1–2 его используют как раньше.
- `src/core/mocks/native.ts` — `setupServer(...appHandlers({ tomtomLive: isTomTomLive() }))`.
- `.env.example` — **новый файл, в git** (`.gitignore` игнорирует ровно `.env`, проверено `git check-ignore`). Значение реального ключа в него не попадает.
- `__tests__/core/tomtom-live.test.ts` — **новый файл**, 4 теста.
- `jest.setup.ts` и `src/core/mocks/server.ts` **не тронуты**: тесты всегда на моке.

**Как это работает:** при `LIVE=1` TomTom-handler просто не регистрируется. MSW в приложении поднят с `onUnhandledRequest: 'bypass'` (контракт § 6), поэтому неперехваченный запрос уходит в настоящий API. Парковки мокаются всегда — хоста `mock.convoy-mind.local` не существует.

**Почему выбор набора — отдельная чистая функция:** `native.ts` импортирует `msw/native`, который в Jest-проекте `core` не грузится. Без вынесения логики шаг 4 остался бы непроверяемым «должно работать».

**Проверено, что тест не фальшиво-зелёный:** убрал фильтр (`appHandlers` стал всегда возвращать оба handler) → `Tests: 2 failed, 105 passed`; вернул → 107 passed.

**Где искать ошибку:**
- Приложение неожиданно ходит в интернет → смотреть `.env`: `EXPO_PUBLIC_TOMTOM_LIVE`. Включает **только точное `'1'`** (тест перебирает `'0'`, `''`, `'true'`, `'yes'`, `'01'`, отсутствие — все дают `false`).
- Ключ читается в `src/core/api/tomtom.ts` из `process.env.EXPO_PUBLIC_TOMTOM_KEY`; без него `planTrip` бросает до сети.
- Флаг читается **один раз при импорте** `native.ts`, то есть при старте приложения. Переключение на лету не предусмотрено — только перезапуск.

**Проверено:** `npm test` — **17 suites / 126 tests passed**; `npm run typecheck` — exit 0. Живой вызов настоящего TomTom из этой сессии **не делался** — по решению пользователя `LIVE=0`, ручная проверка на шаге 6.

**Открытое `[предположение]` (в `DECISIONS.md`):** тарифы TomTom. На https://docs.tomtom.com/pricing (2026-09-06) заявлено «Free monthly requests per API, no credit card needed», для Routing API — «Free 20K monthly» с тегом «TomTom Orbis Maps». Число 20K пришло выжимкой WebFetch и вторым источником не подтверждено. `planTrip` делает 1–2 вызова на расчёт, так что запас огромный в любом случае; точное число — в личном кабинете перед включением `LIVE=1`.

### Шаг 5 — документы — СДЕЛАН (2026-09-06)
**Тронуто:** `docs/API_CONTRACT.md` и `docs/NOT_NOW.md`. `STATE.md` и `DECISIONS.md` велись по шагам.

**Что в контракте (нумерация разделов НЕ менялась — на неё ссылаются этот файл и `contract.test.ts`):**
- шапка — контракт теперь для фаз 1 и 3, плюс правило «разделы не перенумеровывать»;
- § 1 — импорт `getParkingsAlongRoute`, `RoutedParking`, `CORRIDOR_*`;
- § 2 — подраздел «`getParkingsAlongRoute` (фаза 3)»: сигнатура, оба типа дословно из `corridor.ts`, готовый вызов из `ok`-результата, поведение на плохом входе. Поле `route` в `PlanResult` добавлено ещё на шаге 1;
- § 4 — подраздел «`RoutedParking`»: сортировка, порог `status`, `chosen`, что `etaAt` выбранной = приезд, 36 запросов → 45 парковок, пригодность для polling, и `[предположение]` про расхождение `at` запроса и `etaAt`;
- § 6 — оба мок-сценария (`all-full`, `live`) с замером дрейфа, ссылка на `.env.example`;
- § 7 — «чего не делать» переформулировано с «в фазе 2» на «при работе над экранами»;
- § 8 — «карты нет» → «карта показывает парковки коридором ±15 км»; парковки мокаются **всегда**, даже при LIVE=1;
- § 9 — константы `CORRIDOR_RADIUS_KM`, `CORRIDOR_STEP_KM`, `MOCK_LIVE_TICK_MS`, `MOCK_LIVE_AMPLITUDE`;
- **§ 10 — новый**: реальный TomTom по opt-in и таблица «что меняется в данных» (геометрия, скорость, даты, ошибки, лимиты).

**`NOT_NOW.md`:** убрана строка «карта — после фазы 2» (делаем). Добавлено 9 строк фазы 3: GPS-перепланирование, `expo-maps`, проекция на отрезок, параллельные запросы коридора, точное совпадение `at`/`etaAt`, коридор как настройка, переключение LIVE на лету, реальный API парковок, дрейф от `at` вместо `now`.

**Проверено:** `npm test` — 17 suites / 126 tests passed; `npm run typecheck` — exit 0. `contract.test.ts` не сломался — структура § 5 не тронута.

## Итог части 3a (по критерию `PHASE3_MAP.md`)

| Критерий | Статус |
|---|---|
| `npm test` зелёный, существующие тесты не менялись | ✅ 17 suites / 126 tests. Из старых файлов правились только дополнения: `schedule.test.ts` (+2 теста, +2 хелпера), `parking.test.ts` (+7 тестов, +1 импорт). Ни один существующий тест не изменён и не удалён |
| 3a.1 `route.points`: первая = origin, последняя = destination, ≥ 100 точек | ✅ 181 точка, тест в `schedule.test.ts` |
| 3a.2 `getParkingsAlongRoute`: ⌈длина/25 км⌉ запросов, без дублей, порядок, `status`, `chosen` | ✅ 36 запросов, 45 парковок, 9 тестов в `corridor.test.ts` |
| 3a.3 `'live'`: разные слоты → разный `freeAt`, без сценария — как раньше | ✅ 7 тестов в `parking.test.ts` + 1 в `corridor.test.ts` |
| 3a.4 JSON § 5 = реальный вывод `planTrip` (проверка скриптом) | ✅ `contract.test.ts`, проверен на ложный зелёный |

**Не входило в критерий, но сделано сверх:** opt-in реального TomTom (шаг 4) покрыт тестами `tomtom-live.test.ts`, тоже проверен негативным прогоном.

### Шаг 6 — карта на экране 3 — СДЕЛАН (2026-09-06)
**Тронуто:**
- `package.json` — `react-native-maps@1.27.2` (через `npx expo install`, версия под SDK 57).
- `src/ui/routeMap.tsx` — **новый**: `RouteMapView`, `ConflictMapView`, `markerColor`. Единственное место, где импортируется `react-native-maps`.
- `src/ui/routeMap.web.tsx` — **новый**: те же экспорты, без пакета — список парковок с цветной точкой.
- `src/ui/text.ts` — `freeLine` и `parkingCallout` переехали сюда из `result.tsx` (нужны обоим вариантам карты и карточке конфликта).
- `src/app/result.tsx` — лента заменена картой; остались экран, карточки ok/conflict, `useRouteParkings`, бейдж.
- `__tests__/screens/maps-mock.tsx` — **новый** мок пакета; подключён в `jest.setup.screens.ts`.
- `__tests__/screens/result.test.tsx` — 3 теста ленты заменены на 2 теста карты, «без остановок» переписан.
- `__tests__/screens/conflict.test.tsx` — **+2 теста** карты конфликта.
- `__tests__/screens/input.test.tsx` — в 2 тестах добавлено ожидание загрузки парковок.

**ГЛАВНОЕ, что нашлось (не повторять ошибку): `react-native-maps` не работает под `react-native-web` и роняет ВЕСЬ бандл.**
`src/specs/NativeComponent*.ts` импортируют `codegenNativeComponent` из `'react-native'`, которого в `react-native-web` нет. Expo Router валидирует экспорты всех маршрутов при старте, поэтому на web ложился и экран 1 — не только экран 3. Ошибка в html: `(0 , _reactNativeWebDistIndex.codegenNativeComponent) is not a function`.
Лечение: карта живёт в паре `routeMap.tsx` / `routeMap.web.tsx`, Metro подставляет `.web` сам. `result.tsx` пакет не импортирует.

**Ловушка проверки:** `npx expo export --platform web` **проходит** на сломанном коде, `npx expo start --web` — падает. Я на этом сначала ошибся. Проверять web только живым dev-сервером:
```
curl -s -o /dev/null -w "%{http_code}" http://localhost:PORT          # ждём 200
curl -s http://localhost:PORT | grep -o "_expo-static-error"          # не должно ничего найти
```

**API `react-native-maps` — прочитан по `node_modules`, не по памяти** (в `PHASE3_MAP.md` он был `[предположение]`):
`MapView` default, `initialRegion?: Region`, `onMapReady?`, ref-метод `fitToCoordinates(coords, { edgePadding, animated })`; `Marker`: `coordinate: LatLng`, `pinColor?`, `title?`, `description?`; `Polyline`: `coordinates: LatLng[]`, `strokeColor?`, `strokeWidth?`; `LatLng = { latitude, longitude }` (конвертируем из `GeoPoint { lat, lon }`). Callout — штатные `title`/`description`: по исходнику `MapMarker.tsx` они работают, только если нет дочернего `<Callout />`.

**Две ошибки, найденные и исправленные внутри шага:**
1. `fitToCoordinates` вызывался дважды — сначала из-за мока (перезапускал `onMapReady` на ре-рендере), потом из-за флага `fitted` как локальной переменной компонента (сбрасывался каждый рендер). Итог: `useRef` + `useCallback`, мок зовёт `onMapReady` один раз. Закрыто тестом `toHaveLength(1)`.
2. Предупреждения `An update to RouteMap inside a test was not wrapped in act(...)` — тесты не ждали асинхронной загрузки парковок. Не глушил, а добавил ожидание в 4 теста. Сейчас предупреждений **0**.

**Реальный вывод (браузер, `expo start --web`, сквозной сценарий Варшава → Франкфурт):**
```
Карточка: «Прибытие 11:13 · Вождение 8:54 · 2 перерыва · По норме»
Точек маршрута: 181
Парковок: 45 · остановок: 2
зелёные — свободные; красная Mock parking B589-1 «свободно 0 из 36 · занята · проезд 02:21»
синяя Mock parking 481A-1 «свободно 13 из 38 · приезд 09:55 · перерыв 45 мин · вождение от предыдущей 4:09»
финиш: Франкфурт · Прибытие 11:13
ошибок в консоли браузера — нет
```

**Что НЕ проверено:** сама карта (полилиния, маркеры, `fitToCoordinates`) в живом рантайме — на web её нет по определению, симуляторов на машине нет. Это остаётся за пользователем в Expo Go.

### Шаг 7 — динамика — СДЕЛАН (2026-09-06)
**Тронуто:**
- `src/app/result.tsx` — `MAP_REFRESH_MS = 30_000`; `useRouteParkings` перезапрашивает коридор по таймеру и отдаёт `updatedAt`; бейдж получил «· обновлено HH:MM:SS»; плашка `lost-parking-banner` («Выбранная парковка занята» + «Перепланировать») при `chosen && status === 'full'`.
- `src/app/index.tsx` — второй dev-`Switch` «Мок: live (занятость меняется)». Переключатели взаимоисключающие: одно состояние `scenario`, а не два булевых, потому что сценарий в моке один.
- `src/ui/time.ts` — `formatClockSec(ms)`.
- `__tests__/screens/result.test.tsx` — **+3 теста**; в трёх старых поправлен текст бейджа.
- `__tests__/screens/input.test.tsx` — поправлен текст бейджа в ожиданиях.

**Проверено, что таймерный тест не фальшиво-зелёный:** убрал `setInterval` → тест «таймер: через 30000 мс…» упал; вернул → зелено.

**Реальный вывод (браузер, `expo start --web`, сценарий `live` включён переключателем):**
```
00:55:27  Парковок: 41 · остановок: 2 · обновлено 00:55:27
00:55:58  бейдж обновился, данные ТЕ ЖЕ — оба момента в одном минутном слоте (так и задумано)
00:56:58  слот сменился, цвета поехали:
          7B91-1  21/58 свободна → 0/58 занята
          7891-1   5/47 свободна → 0/47 занята
          B589-1   0/36 занята   → 12/36 свободна
          57CA-2   1/72 свободна → 0/72 занята
выбранная 5FC8-2 остаётся синей: «свободно 20 из 78 · приезд 05:04 · перерыв 45 мин · вождение от предыдущей 4:09»
```
Это закрывает критерий 3b «со сценарием live через минуту цвет хотя бы одного маркера меняется» — не тестом, а живьём.

**Где искать ошибку:**
- Данные не меняются между тиками — сначала посмотреть на минутный слот: `MOCK_LIVE_TICK_MS = 60_000`, два обновления внутри одной минуты обязаны совпадать. Это не баг.
- Плашка «Выбранная парковка занята» появляется только когда `chosen && status === 'full'`. Живьём её воспроизвести переключателем нельзя: при `all-full` планировщик отдаёт `conflict`, а не `ok` с занятой остановкой. Покрыта Jest-тестом (фикстура `ok` + сценарий `all-full`).
- Таймер живёт в `useEffect` с зависимостью `[result]`: смена результата перезапускает и первый запрос, и интервал.

**Проверено:** `npm test` — **17 suites / 131 tests passed**; `npm run typecheck` — exit 0; предупреждений `act(...)` — 0.

### Шаг 8 — тесты экрана и отчёт — СДЕЛАН (2026-09-06)
**Тронуто:** `__tests__/screens/result.test.tsx` (**+1 тест** — единственная дыра в покрытии критерия 3b), `docs/API_CONTRACT.md` (§ 6, § 8, § 9 — экранная часть фазы 3), `docs/STATE.md`.
Новый Jest-проект **не заводился**: `screens` существует с фазы 2, `jest.config.js` не тронут.

**Добавленный тест** — «сценарий `'live'`: после обновлений по таймеру цвет хотя бы одного маркера меняется». `jest.useFakeTimers({ now })` двигает и `Date.now`, от которого зависит минутный слот дрейфа: старт на границе минуты, два тика по 30 с — первый обязан дать **тот же** ответ (та же минута), второй **другой**. Проверяет оба свойства сразу и что набор id не меняется.

**Проверено на ложный зелёный:** заглушил дрейф в `parkingGenerator` (`live ?` → `false ?`) — тест упал; вернул — зелено.

## Итог фазы 3 (финальный отчёт по `PHASE3_MAP.md`)

### Критерий части 3a
| | Статус |
|---|---|
| `npm test` зелёный, существующие тесты не менялись | ✅ Из старых файлов — только дополнения: `schedule.test.ts` +2, `parking.test.ts` +7. Ни один существующий тест не изменён и не удалён |
| 3a.1 `route.points`: origin → destination, ≥ 100 точек | ✅ 181 точка |
| 3a.2 `getParkingsAlongRoute`: ⌈длина/25 км⌉ запросов, дедуп, порядок, `status`, `chosen` | ✅ 36 запросов → 45 парковок |
| 3a.3 `'live'`: разные слоты → разный `freeAt`; без сценария — как раньше | ✅ |
| 3a.4 JSON § 5 = реальный вывод `planTrip` (скриптом) | ✅ `contract.test.ts`, проверен на ложный зелёный |

### Критерий части 3b
| | Статус |
|---|---|
| Карточка «Прибытие … · 2 перерыва · По норме» | ✅ тест + браузер |
| Полилиния маршрута | ✅ тест (`Polyline` получает все 181/4 точки фикстуры); **на устройстве не видел** |
| ≥ 10 маркеров парковок, 2 выделенных | ✅ тест (44 маркера, 2 синих) + браузер (45/2) |
| `'live'`: за минуту меняется цвет хотя бы одного маркера | ✅ тест + **живьём в браузере** (00:55:27 → 00:56:58, поменялись 4+ парковки) |
| «все заняты» → красная карточка и маркер якоря | ✅ `conflict.test.tsx` |
| Реальный ключ + `LIVE=1` → полилиния по дорогам | ❌ **не проверено**: по решению владельца `LIVE=0`, живой вызов TomTom не делался |

### Реальный вывод `npm test` 2026-09-06
```
PASS core    __tests__/core/aetr.test.ts
PASS core    __tests__/core/breaks.test.ts
PASS core    __tests__/core/contract.test.ts
PASS core    __tests__/core/corridor.test.ts
PASS core    __tests__/core/index.test.ts
PASS core    __tests__/core/no-react-in-core.test.ts
PASS core    __tests__/core/parking.test.ts
PASS core    __tests__/core/progress.test.ts
PASS core    __tests__/core/schedule.test.ts
PASS core    __tests__/core/smoke.test.ts
PASS core    __tests__/core/tomtom-live.test.ts
PASS core    __tests__/core/tomtom.test.ts
PASS core    __tests__/ui/time.test.ts
PASS screens __tests__/screens/conflict.test.tsx
PASS screens __tests__/screens/input.test.tsx
PASS screens __tests__/screens/planning.test.tsx
PASS screens __tests__/screens/result.test.tsx
Test Suites: 17 passed, 17 total
Tests:       132 passed, 132 total
```
`npm run typecheck` (`tsc --noEmit`) — exit 0. Предупреждений `act(...)` — 0.
Было до фазы 3: 14 suites / 101 test.

### Отклонения от `PHASE3_MAP.md` (все в `DECISIONS.md`)
- Сверка § 5 — Jest-тест `contract.test.ts`, а не отдельный скрипт: ядро использует безрасширенные импорты, которые Node ESM не резолвит, а ставить загрузчик TS запрещено правилом про пакеты.
- Новый Jest-проект не заводился — `screens` уже был; тесты экрана в `__tests__/screens/`, а не `__tests__/app/`.
- Выбор набора handlers вынесен в чистую `appHandlers()` — иначе шаг 4 не проверить (`native.ts` тянет `msw/native`, который в проекте `core` не грузится).
- Карта разделена на `routeMap.tsx` / `routeMap.web.tsx` — `react-native-maps` роняет web-бандл целиком. Подтверждено владельцем.
- Callout — штатные `title`/`description`, а не дочерний `<Callout>`.

### Что осталось `[предположение]` после фазы 3
- **Expo Go на телефоне** — единственная непроверенная платформа с фазы 2. Карта, полилиния, `fitToCoordinates`, маркеры и `msw/native` на iOS/Android не запускались ни разу. Это главный открытый пункт.
- **Реальный TomTom** — код opt-in есть и покрыт тестами, живой вызов не делался. Что изменится — таблица в `API_CONTRACT.md` § 10.
- **Тарифы TomTom** — «Free 20K monthly» для Routing API прочитано на docs.tomtom.com/pricing 2026-09-06 выжимкой WebFetch, вторым источником не подтверждено.
- **Плашка «Выбранная парковка занята»** — покрыта Jest-тестом, но живьём не воспроизводится переключателем: при `all-full` планировщик отдаёт `conflict`, а не `ok` с занятой остановкой.
- **`etaAt` парковки vs `at` запроса** — расхождение до ~9 мин (радиус коридора / скорость). На моке невидимо, помечено в коде и контракте.

## Сделано
- 2026-09-05 — Шаг 1: скелет Expo SDK 57 (шаблон default, Expo Router в `src/app/`), Jest `projects` + `jest-expo/node`, MSW 2.15 (`msw/node` в тестах, `msw/native` — только экспорт), `babel.config.js`, `tsconfig` с `types`. Файлы: `package.json`, `jest.config.js`, `jest.setup.ts`, `babel.config.js`, `msw.polyfills.js`, `src/core/mocks/{handlers,server,native}.ts`, `__tests__/core/{smoke,no-react-in-core}.test.ts`, `.gitignore` (+`.env`). Вывод: `npm test` — 2 suites, 3 tests passed; `npm run typecheck` — exit 0.
- 2026-09-05 — Шаг 2: схема TomTom прочитана из исходного HTML документации (точные цитаты — в `DECISIONS.md` и в JSDoc). Файлы: `src/core/types.ts`, `src/core/api/types.ts`, `src/core/mocks/fixtures/tomtom_route_example.json` (из примера убраны 5 плейсхолдеров `...further...`, добавлены 2 запятые — опечатка документации), `__tests__/core/tomtom.test.ts`. Вывод: `npm test` — 3 suites, 4 tests passed; `npm run typecheck` — exit 0.
- 2026-09-05 — Шаг 3: `src/core/api/tomtom.ts`, `src/core/geo.ts`, `src/core/mocks/routeGenerator.ts`, handler TomTom в `mocks/handlers.ts`, `__tests__/core/tomtom.test.ts` (5 тестов: без waypoints; с 2 waypoints и паузой 2700 → тело `[2700, 2700, 0]`, 3 плеча, даты с паузами; без ключа; валидация мока; фикстура). Вывод: `npm test` — 3 suites, 8 tests passed; `npm run typecheck` — exit 0.
- 2026-09-05 — Шаг 4: Parking-API. Файлы: `src/core/api/types.ts` (+`Parking`, `ParkingsResponse`, `ParkingsQuery`), `src/core/api/parking.ts`, `src/core/mocks/scenario.ts`, `src/core/mocks/parkingGenerator.ts`, handler в `mocks/handlers.ts`, `jest.setup.ts` (сброс сценария в `afterEach`), `__tests__/core/helpers.ts` (вынесен `recordRequests`), `__tests__/core/parking.test.ts` (7 тестов). Реальный вывод генератора для якоря `{51.4, 16.2}` (после перевода на сетку, см. ниже): днём 3 парковки в 25 км, cap 33–80, free 14–45; ночью free 2–10; в 50 км — 19; `all-full` — все 0. Вывод: `npm test` — 4 suites, 15 tests passed; `npm run typecheck` — exit 0.
- 2026-09-05 — Шаг 5: `src/core/planner/aetr.ts` (константы 4:30 / 45 мин / 9:00, `nextRequiredBreak`), `__tests__/core/aetr.test.ts` (16 тестов). Вывод: `npm test` — 5 suites, 31 tests passed; `npm run typecheck` — exit 0.
- 2026-09-05 — Шаг 8: `src/core/index.ts`, `__tests__/core/index.test.ts` (2 теста), `docs/API_CONTRACT.md` (267 строк; JSON-примеры — реальный вывод `planTrip` из временного теста, блок типов вырезан скриптом из `schedule.ts` дословно). Проверено по `node_modules/msw`: `onUnhandledRequest: 'bypass' | 'warn' | 'error'`, `msw/native` экспортирует `listen`. Вывод: `npm test` — 8 suites, 59 tests passed; `npm run typecheck` — exit 0.
- 2026-09-05 — Шаг 7: `src/core/planner/schedule.ts` (`planTrip`, типы, 3 константы), `__tests__/core/schedule.test.ts` (9 тестов). Реальный happy path Варшава → Франкфурт (после перевода парковок на сетку): остановки `mock-5fc8bd88-1` (приезд 08:11:15Z) и `mock-481aea79-1` (13:06:09Z), плечи 15075 / 14994 / 1992 с, `drivingTimeSec = 32061`, `arrivalAt = 14:24:21Z`, `requiresDailyRest: false`; конфликт `all-full`: 1 вызов TomTom, parking 25 + 50 км, `nearestFreeParking` пуст. Вывод: `npm test` — 7 suites, 57 tests passed; `npm run typecheck` — exit 0.
- 2026-09-05 — Шаг 6: `src/core/planner/breaks.ts` (`placeBreakAnchors`, `BREAK_LOOKAHEAD_MIN`, `ANCHOR_THRESHOLD_SEC`), `__tests__/core/breaks.test.ts` (17 тестов). Реальные якоря мока Варшава → Франкфурт: `travelTimeSec = 32044`, `lengthM = 890119`; якорь 1 `{51.226587, 15.174708}`, приезд `2026-09-07T08:10:00Z` (4:10); якорь 2 `{50.243409, 9.453218}`, приезд `2026-09-07T13:05:00Z` (8:20 вождения + 45 мин паузы). Оба днём по UTC → у парковок `freeAt ≥ 6`. Вывод: `npm test` — 6 suites, 48 tests passed; `npm run typecheck` — exit 0.

- 2026-09-05 — Аудит фазы 1 (роль тестера) и исправление находки 1: `src/core/mocks/parkingGenerator.ts` переведён на сетку (парковки — свойство географии, запрос на 50 км ⊇ 25 км), `__tests__/core/parking.test.ts` (+3 теста, «3–6» → «≥ 1»), JSON в `docs/API_CONTRACT.md` § 5 перегенерирован из реального вывода, `NOT_NOW.md`/`DECISIONS.md` обновлены. Остальные находки аудита (низкие) не чинились: тест «core без React» не ловит side-effect импорты `import 'x'`; parking-мок принимает отсутствующие `lat`/`lon` как 0; `calculateRoute` не валидирует `vehicleWeightKg` (валидирует `planTrip`); `round6` продублирован в трёх файлах; `PHASE2_APP.md` называет `app/` вместо `src/app/`. Вывод: `npm test` — 8 suites, 62 tests passed; `npm run typecheck` — exit 0.

- 2026-09-05 — Фаза 2, шаг 1: `docs/PHASE2_APP.md` пути `app/` → `src/app/` (3 строки); `src/ui/theme.ts` (палитра light/dark, `FontSize`, `Spacing`, `Radius`, `TouchTarget`, `useTheme`), `src/ui/presets.ts` (`CITY_PRESETS` Варшава/Лодзь/Франкфурт/Париж — координаты из контракта § 5, `DEFAULT_VEHICLE_WEIGHT_KG = 40000`, `DEPARTURE_OFFSETS_MIN`); `src/app/_layout.tsx` → `Stack` без хедера, экраны-заглушки `index` / `planning` / `result` с кнопками переходов; удалены `explore.tsx`, `app-tabs.tsx`, `app-tabs.web.tsx`. Проверено: `tsc` exit 0, `npm test` 8/62, `expo start --web` в Chrome — переходы `/` → `/planning` → `/result` → `/` работают. Симуляторов iOS/Android на машине нет — Expo Go проверяет пользователь.

- 2026-09-05 — Фаза 2, шаг 2: `src/app/_layout.tsx` — блок `if (__DEV__)` по контракту § 6 (полифиллы → `msw/native` → `listen({ onUnhandledRequest: 'bypass' })`) + лог `[msw] METHOD URL` на `request:start`. Проверено на web: `fetch` из страницы на `https://mock.convoy-mind.local/v1/parkings?…` → 200, 3 парковки, в логе Metro `Web LOG [msw] GET …`. Metro WARN про fallback резолва msw — ожидаемы. Expo Go — не проверено (нет устройства).

- 2026-09-05 — Фаза 2, шаг 3: экран 1 `src/app/index.tsx` (чипы «Откуда/Куда» из `CITY_PRESETS`, выезд «Сейчас/+30 мин/+1 ч/+2 ч», вес `TextInput` с валидацией > 0, dev-`Switch` «Мок: все парковки заняты» → `setMockScenario`, кнопка → `startPlanning` + `router.push('/planning')`); `src/ui/tripStore.ts` (стор на `useSyncExternalStore`: `idle | planning | done | error`, `startPlanning`, `useTripState`, `resetTrip`); `src/ui/time.ts` (`toRfc3339Local`, `formatClock`, `formatDurationHm`, `formatHm`) + `__tests__/ui/time.test.ts` (8 тестов); экран 2 минимальный (ждёт `done` → `router.replace('/result')`, ошибка → текст + «К вводу»). Jest: проект `screens` (`jest-expo/ios`, `jest.setup.screens.ts`, `moduleNameMapper` `msw/node` → CJS, `fetch` = `originalfetch`), devDeps `@testing-library/react-native@13.3.3` + `react-test-renderer@19.2.3`; `__tests__/screens/input.test.tsx` (4 теста через `renderRouter`: кнопка → POST к TomTom с `52.2297,21.0122:50.1109,8.6821` и `vehicleWeight=40000` → `/planning` → `/result`; Лодзь в пути URL; `+1 ч` в `departAt`; невалидный вес → без запросов). `.env` с `EXPO_PUBLIC_TOMTOM_KEY=mock-dev-key` (локально, в `.gitignore`). Проверено: `npm test` 10 suites / 74 tests; в браузере (web) кнопка → 4 запроса через MSW (TomTom A→B, 2× парковки, TomTom через парковки) → `/result`.

- 2026-09-05 — Фаза 2, шаг 4: `src/core/planner/schedule.ts` — `planTrip(input, options?)`, `options.onProgress(stage)`, типы `PlanStage`/`PlanOptions` (+ экспорт из `src/core/index.ts`), `__tests__/core/progress.test.ts` (5 тестов: порядок стадий, короткий маршрут, обрыв на конфликте, reject до стадий, старая сигнатура), `docs/API_CONTRACT.md` § 1–2 обновлены. `src/ui/planningStages.ts` (`PLAN_STAGES`, `PLANNING_MIN_VISIBLE_MS = 1200`), стор хранит `stages`, экран 2 `src/app/planning.tsx` — четыре строки ●/○ по стадиям, заголовок «Откуда → Куда», переход на `/result` по `done` не раньше минимального времени, ошибка → «Ошибка расчёта» + «К вводу». `__tests__/screens/planning.test.tsx` (4 теста), `__tests__/screens/expo-router-matchers.d.ts` (типы матчеров expo-router). Проверено: core 75/75, screens 8/8, `tsc` exit 0; в браузере: кнопка → экран 2 с четырьмя зажжёнными строками → `/result`.

- 2026-09-05 — Фаза 2, шаги 5–6: `src/app/result.tsx` — карточка ok («Прибытие HH:MM», «Вождение H:MM · N перерыва · По норме», при `requiresDailyRest` — «Нужен суточный отдых» + предупреждение), лента (старт, «↓ … вождения», остановки: время, парковка, «перерыв 45 мин», «свободно N из M на HH:MM», «сейчас/прогноз», последнее плечо, финиш), красная карточка conflict (`reason`, плановая остановка из `anchor`, `nearestFreeParking`, «Выехать раньше» → `/` с `departureAt − 30 мин`, «Другая парковка» → «Скоро»), «Новый маршрут» → `resetTrip` + `/`. Экран 1: параметр `departureAt` → чип «в HH:MM», `Switch` читает `getMockScenario()`. `src/ui/text.ts` (`pluralRu` + 7 тестов), стор `setTripState`. Тесты: `__tests__/screens/fixtures.ts` (JSON из контракта § 5, генерируется скриптом), `result.test.tsx` (6), `conflict.test.tsx` (4), в `input.test.tsx` + тест dev-переключателя через MSW (красная карточка). Проверено: `npm test` 14 suites / 101 tests, `tsc` exit 0; в браузере (web): кнопка → экран 2 → экран 3 с картой ответа и лентой на 2 остановки (реальный вывод мока, ночной выезд: «свободно 5 из 57»).

## Сейчас в работе
Ничего. Фаза 3 закрыта целиком (8/8). В git не закоммичено ничего (фазы 1–3 в рабочем дереве на `master`; `.env` в `.gitignore`, `.env.example` — в коммит). В git не закоммичено ничего (фазы 1–3 в рабочем дереве на `master`; `.env` в `.gitignore`, `.env.example` — в коммит). В git не закоммичено ничего (фазы 1–3 целиком в рабочем дереве на `master`; `.env` в `.gitignore`).

## Следующий шаг
Решает владелец. Открыто:
1. **Expo Go на телефоне** — `npx expo start`, пресет Варшава → Франкфурт. Закрывает главный `[предположение]` фаз 2 и 3 разом: `msw/native` на iOS/Android и вся карта (полилиния, маркеры, `fitToCoordinates`, callout, таймер, переключатель «Мок: live»).
2. **Коммит** фаз 1–3 (сейчас всё в рабочем дереве на `master`, ни одного коммита).
3. **Реальный TomTom**: проверить квоту в личном кабинете, поставить `EXPO_PUBLIC_TOMTOM_LIVE=1` в `.env`, перезапустить — полилиния должна пойти по дорогам.


## Итог фазы 2 (финальный отчёт по `PHASE2_APP.md`)
Критерий «работает» (5 пунктов) — проверено на web (Chrome, `expo start --web`), Expo Go — у пользователя:
1. Экран 1: пресеты, время, вес, «Построить маршрут» — есть; кнопка → 4 запроса через MSW (TomTom A→B, 2× парковки, TomTom через парковки) видны в консоли Metro как `[msw] …`.
2. Экран 2: четыре стадии по `onProgress` из ядра, минимум 1,2 с на экране.
3. Экран 3: «Прибытие 09:54 · Вождение 8:54 · 2 перерыва · По норме», лента: 23:30 Варшава → 4 ч 11 мин → 03:41 Mock parking 5FC8-1 (перерыв 45 мин, свободно 5 из 57, прогноз) → 4 ч 09 мин → 08:36 Mock parking 481A-1 → 33 мин → 09:54 Франкфурт (реальный вывод мока при ночном выезде).
4. Dev-переключатель → красная карточка «Не сходится» с `reason`, «Выехать раньше» → экран 1 с чипом «в 23:00» и `?departureAt=…`.
5. `npm test` зелёный, тесты фазы 1 не тронуты (добавлен только `progress.test.ts`), тесты экранов идут через MSW (`onUnhandledRequest: 'error'`), `jest.mock` для `planTrip` не используется.

Реальный вывод `npm test` 2026-09-05:
```
PASS core __tests__/core/no-react-in-core.test.ts
PASS core __tests__/core/breaks.test.ts
PASS core __tests__/core/tomtom.test.ts
PASS core __tests__/ui/time.test.ts
PASS core __tests__/core/progress.test.ts
PASS core __tests__/core/index.test.ts
PASS core __tests__/core/aetr.test.ts
PASS core __tests__/core/schedule.test.ts
PASS core __tests__/core/smoke.test.ts
PASS core __tests__/core/parking.test.ts
PASS screens __tests__/screens/conflict.test.tsx
PASS screens __tests__/screens/planning.test.tsx
PASS screens __tests__/screens/result.test.tsx
PASS screens __tests__/screens/input.test.tsx
Test Suites: 14 passed, 14 total
Tests:       101 passed, 101 total
```
`npm run typecheck` (`tsc --noEmit`) — exit 0.

Отклонения от `PHASE2_APP.md` (все в `DECISIONS.md`): экраны в `src/app/`; Париж в пресетах; `onProgress` в ядре вместо таймера; минимальное время показа экрана 2; «Другая парковка» → «Скоро» на кнопке, без тоста; последнее плечо ленты считается вычитанием на экране.

## Итог фазы 1 (финальный отчёт по `PHASE1_CORE.md`)
Реальный вывод `npm test` 2026-09-05:
```
PASS core __tests__/core/index.test.ts
PASS core __tests__/core/schedule.test.ts
PASS core __tests__/core/tomtom.test.ts
PASS core __tests__/core/breaks.test.ts
PASS core __tests__/core/smoke.test.ts
PASS core __tests__/core/parking.test.ts
PASS core __tests__/core/no-react-in-core.test.ts
PASS core __tests__/core/aetr.test.ts
Test Suites: 8 passed, 8 total
Tests:       62 passed, 62 total
```
`npm run typecheck` (`tsc --noEmit`) — exit 0. Критерий «работает» из `PHASE1_CORE.md`: оба сквозных теста (happy path, конфликт) — в `__tests__/core/schedule.test.ts`, только через MSW (`onUnhandledRequest: 'error'`).

## Открытые вопросы ко мне
- **Expo Go на телефоне.** Заводится ли `msw/native` на iOS/Android и как выглядит карта (полилиния, маркеры, `fitToCoordinates`, callout, таймер). Единственная непроверенная платформа с фазы 2. Если что-то не так — первый вопрос следующей сессии, не чинить молча.
- Коммитить ли фазы 1–3 одним коммитом или по фазам. Сейчас в репозитории один коммит `Initial commit`, всё остальное — рабочее дерево.
- Включать ли `EXPO_PUBLIC_TOMTOM_LIVE=1` (ключ в `.env` уже настоящий). Перед этим — проверить квоту в личном кабинете TomTom.
- Язык UI: экраны на русском, как в `PHASE2_APP.md`; при переводе проекта на английский строки разбросаны по трём экранам и `src/ui/{text,routeMap*}.ts(x)` (файла строк нет — MVP).
- Вопрос фазы 2 про «последнее плечо ленты» **снят**: ленты больше нет, её заменила карта.

## Оставшиеся `[предположение]` (проверить или оставить помеченными)
- В моке `routes[].summary.travelTimeInSeconds` не включает паузы; как в реальном API — неизвестно. Ядро от этого не зависит.
- Причина, по которой TypeScript 6.0.3 не подхватывал `@types/*` без явного `types` в tsconfig, не подтверждена; симптом и лечение проверены.
- `msw/native` на iOS/Android (Expo Go) не запускался: на web Metro резолвит его через fallback, на native condition `react-native` должен матчиться напрямую. Проверить в Expo Go.
- Реальный TomTom отдаёт даты с оффсетом точки отправления, а не в UTC, как мок; экран форматирует через `Date.parse` → локальное время, от этого не зависит.
- Параметр `departureAt` в URL (`+02:00` → `%2B`) на web проверен; на native deep-link не проверялся, но параметр приходит только из `router.replace` внутри приложения.

Добавлено фазой 3:
- **Карта на устройстве не запускалась вообще.** `MapView`, `Polyline`, `Marker`, `fitToCoordinates`, callout — только под Jest-моком и в web-варианте-списке. API прочитан по `node_modules`, но поведение на экране телефона не видел никто.
- **Реальный TomTom не вызывался.** Код opt-in покрыт тестами; что изменится в данных — таблица в `API_CONTRACT.md` § 10.
- **Тарифы TomTom**: «Free 20K monthly» для Routing API — выжимка WebFetch с docs.tomtom.com/pricing (2026-09-06), вторым источником не подтверждено.
- **Плашка «Выбранная парковка занята»** живьём не воспроизводится: при `all-full` планировщик отдаёт `conflict`, а не `ok` с занятой остановкой. Только Jest-тест.
- **`etaAt` парковки vs `at` запроса коридора** — расхождение до ~9 мин (радиус коридора / скорость). На моке невидимо (занятость зависит только от периода суток), помечено в `corridor.ts` и контракте § 4.

## Решения (кратко, с причиной)
- см. `DECISIONS.md`: 46 строк от 2026-09-05 (фазы 1–2) + 29 строк от 2026-09-06 (фаза 3)
