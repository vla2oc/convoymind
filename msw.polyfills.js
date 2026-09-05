// Полифиллы для msw/native в приложении (фаза 2). Источник:
// https://mswjs.io/docs/integrations/react-native/ — импортировать ДО src/core/mocks/native.
// В Jest не используется: в Node URL и TextEncoder есть нативно.
import 'fast-text-encoding';
import 'react-native-url-polyfill/auto';
