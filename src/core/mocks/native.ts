import { setupServer } from 'msw/native';
import { appHandlers, isTomTomLive } from './handlers';

// Для приложения (фаза 2+). Перед импортом этого файла должен быть импортирован
// msw.polyfills.js из корня проекта. В тестах используется mocks/server.ts, не этот файл.
//
// Фаза 3, шаг 4: при EXPO_PUBLIC_TOMTOM_LIVE=1 TomTom-handler не регистрируется и запросы к
// api.tomtom.com уходят в настоящий API (MSW поднимается с onUnhandledRequest: 'bypass').
// Parking-API мокается всегда — реального сервиса нет.
export const server = setupServer(...appHandlers({ tomtomLive: isTomTomLive() }));
