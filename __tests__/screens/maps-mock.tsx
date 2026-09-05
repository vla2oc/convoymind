import * as React from 'react';
import { View, type ViewProps } from 'react-native';

// Мок `react-native-maps` для Jest (PHASE3_MAP.md, шаг 8). Настоящий пакет в тестовом окружении падает:
// `TurboModuleRegistry.getEnforcing('RNMapsAirModule')` — нативного модуля нет. Подключается один раз
// в jest.setup.screens.ts, поэтому в самих тестах `jest.mock('react-native-maps')` писать не нужно.
//
// Компоненты рендерятся как View с теми же пропсами: тесты находят их по testID и читают
// coordinate / pinColor / coordinates прямо из props.

/** Аргументы всех вызовов fitToCoordinates — тесты проверяют, что карта строит кадр по маршруту. */
export const fitToCoordinatesCalls: { coordinates: unknown; options: unknown }[] = [];

export function resetMapsMock(): void {
  fitToCoordinatesCalls.length = 0;
}

type AnyProps = ViewProps & Record<string, unknown>;

const MapView = React.forwardRef<unknown, AnyProps>((props, ref) => {
  const { onMapReady, children, ...rest } = props as AnyProps & { onMapReady?: () => void };
  React.useImperativeHandle(ref, () => ({
    fitToCoordinates: (coordinates: unknown, options: unknown) => {
      fitToCoordinatesCalls.push({ coordinates, options });
    },
  }));
  // Настоящий MapView зовёт onMapReady один раз, когда карта готова, — мок повторяет это,
  // иначе колбэк перезапускался бы на каждом ре-рендере (например, когда приезжают парковки).
  const ready = React.useRef(false);
  React.useEffect(() => {
    if (ready.current) return;
    ready.current = true;
    onMapReady?.();
  }, [onMapReady]);
  return <View {...rest}>{children}</View>;
});
MapView.displayName = 'MapView';

export const Marker = ({ children, ...props }: AnyProps) => <View {...props}>{children}</View>;
export const Polyline = (props: AnyProps) => <View {...props} />;
export const Callout = ({ children, ...props }: AnyProps) => <View {...props}>{children}</View>;

export default MapView;
