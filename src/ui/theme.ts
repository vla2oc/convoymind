// Токены UI. Единственный файл стилевых констант фазы 2 (PHASE2_APP.md, «Стек»).
// Водитель смотрит на телефон 3 секунды — крупный текст, высокий контраст, большие цели нажатия.
import { useColorScheme } from 'react-native';

export interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  danger: string;
  onDanger: string;
  success: string;
  border: string;
}

export const Palette: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    background: '#FFFFFF',
    surface: '#F2F3F5',
    text: '#111111',
    textMuted: '#5F6368',
    primary: '#1F6FEB',
    onPrimary: '#FFFFFF',
    danger: '#C62828',
    onDanger: '#FFFFFF',
    success: '#2E7D32',
    border: '#D5D8DC',
  },
  dark: {
    background: '#000000',
    surface: '#1C1D20',
    text: '#FFFFFF',
    textMuted: '#B0B4BA',
    primary: '#4C8DFF',
    onPrimary: '#FFFFFF',
    danger: '#EF5350',
    onDanger: '#000000',
    success: '#66BB6A',
    border: '#3A3D42',
  },
};

export const FontSize = {
  hero: 40,
  title: 28,
  body: 20,
  small: 16,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const Radius = {
  md: 12,
  lg: 20,
} as const;

/** Минимальная высота нажимаемого элемента (палец в перчатке). */
export const TouchTarget = 56;

export function useTheme(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? Palette.dark : Palette.light;
}
