// Моки внешних API в dev-сборке (docs/API_CONTRACT.md § 6). Порядок важен:
// полифиллы → msw/native, поэтому require внутри блока, а не import наверху.
if (__DEV__) {
  require('../../msw.polyfills');
  const { server } = require('@/core/mocks/native');
  server.events.on('request:start', ({ request }: { request: Request }) => {
    // Ключ TomTom едет в query (?key=…). Без замены он попадал в Metro-логи, в .expo/dev/logs
    // и в любую вставку этих строк в docs/. Остальные параметры оставляем — по ним и отлаживаем.
    const url = new URL(request.url);
    if (url.searchParams.has('key')) url.searchParams.set('key', '***');
    console.log(`[msw] ${request.method} ${url}`);
  });
  server.listen({ onUnhandledRequest: 'bypass' });
}

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="planning" />
        <Stack.Screen name="result" />
      </Stack>
    </ThemeProvider>
  );
}
