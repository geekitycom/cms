/** Whether a theme is drawn light or dark. */
export type ColorScheme = 'light' | 'dark';

/** A theme choice reduced to what a surface outside the theme can follow. */
export type AdminColorScheme = ColorScheme | 'auto';

/** Every built-in DaisyUI theme, in DaisyUI's order, with its label and whether it is light or dark. */
export const ADMIN_THEMES = {
  light: { label: 'Light', scheme: 'light' },
  dark: { label: 'Dark', scheme: 'dark' },
  cupcake: { label: 'Cupcake', scheme: 'light' },
  bumblebee: { label: 'Bumblebee', scheme: 'light' },
  emerald: { label: 'Emerald', scheme: 'light' },
  corporate: { label: 'Corporate', scheme: 'light' },
  synthwave: { label: 'Synthwave', scheme: 'dark' },
  retro: { label: 'Retro', scheme: 'light' },
  cyberpunk: { label: 'Cyberpunk', scheme: 'light' },
  valentine: { label: 'Valentine', scheme: 'light' },
  halloween: { label: 'Halloween', scheme: 'dark' },
  garden: { label: 'Garden', scheme: 'light' },
  forest: { label: 'Forest', scheme: 'dark' },
  aqua: { label: 'Aqua', scheme: 'dark' },
  lofi: { label: 'Lofi', scheme: 'light' },
  pastel: { label: 'Pastel', scheme: 'light' },
  fantasy: { label: 'Fantasy', scheme: 'light' },
  wireframe: { label: 'Wireframe', scheme: 'light' },
  black: { label: 'Black', scheme: 'dark' },
  luxury: { label: 'Luxury', scheme: 'dark' },
  dracula: { label: 'Dracula', scheme: 'dark' },
  cmyk: { label: 'CMYK', scheme: 'light' },
  autumn: { label: 'Autumn', scheme: 'light' },
  business: { label: 'Business', scheme: 'dark' },
  acid: { label: 'Acid', scheme: 'light' },
  lemonade: { label: 'Lemonade', scheme: 'light' },
  night: { label: 'Night', scheme: 'dark' },
  coffee: { label: 'Coffee', scheme: 'dark' },
  winter: { label: 'Winter', scheme: 'light' },
  dim: { label: 'Dim', scheme: 'dark' },
  nord: { label: 'Nord', scheme: 'light' },
  sunset: { label: 'Sunset', scheme: 'dark' },
  caramellatte: { label: 'Caramellatte', scheme: 'light' },
  abyss: { label: 'Abyss', scheme: 'dark' },
  silk: { label: 'Silk', scheme: 'light' },
} as const satisfies Record<string, { label: string; scheme: ColorScheme }>;

/** A built-in DaisyUI theme, by its DaisyUI name. */
export type AdminTheme = keyof typeof ADMIN_THEMES;

/** `value` as a theme when it names one in {@link ADMIN_THEMES}, otherwise `undefined`. */
export function adminTheme(value: unknown): AdminTheme | undefined {
  return typeof value === 'string' && Object.hasOwn(ADMIN_THEMES, value)
    ? (value as AdminTheme)
    : undefined;
}

/**
 * Whether a user's choice draws light or dark, or `auto` when they follow the
 * system, for what renders outside the theme's reach, such as the admin bar.
 */
export function adminColorScheme(theme: AdminTheme | undefined): AdminColorScheme {
  return theme === undefined ? 'auto' : ADMIN_THEMES[theme].scheme;
}
