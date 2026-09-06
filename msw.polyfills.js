// Полифиллы для msw/native в приложении. Импортировать ДО src/core/mocks/native (см. src/app/_layout.tsx).
// 1–2: официальная инструкция MSW для React Native — https://mswjs.io/docs/integrations/react-native/
// 3: DOM-классы, которых нет в Hermes, но которые msw 2.15 требует при загрузке (MessageEvent для `rettime`,
//    BroadcastChannel для `msw/lib/core/ws`); без них — «Property 'MessageEvent' doesn't exist» на телефоне.
// 4: шим `Response.prototype.body` — глобальный Response в RN из whatwg-fetch и стримов не знает,
//    из-за чего мок-ответ приходил с пустым телом: «JSON Parse error: Unexpected end of input».
// Оба — из src/core/mocks/domPolyfills.ts, см. DECISIONS.md (2026-09-06). В браузере (web) оба — no-op.
// В Jest не используется: в Node всё это есть нативно.
import 'fast-text-encoding';
import 'react-native-url-polyfill/auto';
import { installMswDomPolyfills, installMswResponseBodyShim } from './src/core/mocks/domPolyfills';

installMswDomPolyfills(globalThis);
installMswResponseBodyShim(globalThis);
