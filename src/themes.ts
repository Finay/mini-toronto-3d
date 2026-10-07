import type { VehicleMode } from '../shared/types';

export type Color = [number, number, number, number];

export type ThemeName = 'dark' | 'light';

/** Everything whose colour depends on whether the map is light or dark. */
export interface Theme {
  /** MapLibre style URL of the basemap. */
  basemap: string;
  water: string;
  waterLabel: { color: string; halo: string };
  park: string;
  parkOpacity: number;
  parkOutline: string;
  grassOpacity: number;
  wood: string;
  /** Building colour at ground level and at 250 m; heights between are blended. */
  buildings: [low: string, tall: string];
  /** Vehicles and route lines, except rapid transit, which uses each line's own colour. */
  modeColors: Record<VehicleMode, Color>;
  outOfService: Color;
  /** On-street bus and streetcar stops. */
  stop: Color;
  /** Rapid transit stations: a filled disc with a contrasting ring. */
  station: { fill: Color; outline: Color };
  /** Traffic cameras: a colour no vehicle or stop uses. */
  camera: { fill: Color; outline: Color };
  /** Outline of whatever the pointer is over. */
  highlight: Color;
  // Outlines keep dots distinct from the basemap and from each other.
  liveOutline: Color;
  simulatedOutline: Color;
}

export const THEMES: Record<ThemeName, Theme> = {
  dark: {
    // "fiord" is a mid-tone slate blue: dark enough for bright vehicles to
    // stand out, but with visibly lighter streets and labels (OpenFreeMap's
    // "dark" style is nearly black on black).
    basemap: 'https://tiles.openfreemap.org/styles/fiord',
    water: '#2b6a9e',
    waterLabel: { color: '#b5d6ef', halo: '#1f4f78' },
    park: '#4c9a6a',
    parkOpacity: 0.65,
    parkOutline: '#6dbb8a',
    grassOpacity: 0.4,
    wood: '#3a7d55',
    buildings: ['#66728f', '#b4bfd9'],
    modeColors: {
      streetcar: [255, 82, 70, 255],
      bus: [110, 215, 255, 255],
      lrt: [255, 150, 60, 255],
      subway: [255, 204, 41, 255],
      train: [96, 214, 130, 255],
      other: [200, 200, 200, 255],
    },
    outOfService: [205, 210, 220, 170],
    stop: [235, 240, 250, 200],
    station: { fill: [255, 255, 255, 255], outline: [18, 22, 34, 255] },
    camera: { fill: [214, 126, 255, 255], outline: [18, 22, 34, 255] },
    highlight: [255, 255, 255, 255],
    liveOutline: [18, 22, 34, 255],
    simulatedOutline: [255, 255, 255, 240],
  },
  light: {
    basemap: 'https://tiles.openfreemap.org/styles/positron',
    water: '#a5cdea',
    waterLabel: { color: '#2f5f8f', halo: '#ffffff' },
    park: '#a8d8a8',
    parkOpacity: 0.8,
    parkOutline: '#7fbf85',
    grassOpacity: 0.5,
    wood: '#8fc793',
    buildings: ['#dfe2e8', '#9aa3b8'],
    modeColors: {
      streetcar: [214, 40, 40, 255],
      bus: [20, 105, 200, 255],
      lrt: [225, 115, 20, 255],
      subway: [190, 150, 0, 255],
      train: [30, 145, 80, 255],
      other: [90, 90, 90, 255],
    },
    outOfService: [120, 125, 135, 170],
    stop: [70, 78, 95, 210],
    station: { fill: [255, 255, 255, 255], outline: [30, 34, 46, 255] },
    camera: { fill: [146, 62, 204, 255], outline: [255, 255, 255, 255] },
    highlight: [255, 122, 0, 255],
    liveOutline: [255, 255, 255, 255],
    simulatedOutline: [30, 34, 46, 255],
  },
};

const STORAGE_KEY = 'mini-toronto-theme';

export function loadThemeName(): ThemeName {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    // Storage can be unavailable (private windows, blocked site data).
    return 'dark';
  }
}

export function saveThemeName(name: ThemeName): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // The choice just won't be remembered.
  }
}
