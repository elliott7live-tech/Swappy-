export type VideoFilterId =
  | 'normal'
  | 'warm'
  | 'cool'
  | 'vivid'
  | 'vintage'
  | 'neon'
  | 'mono';

export interface VideoFilterPreset {
  id: VideoFilterId;
  name: string;
  cssFilter: string;
  previewGradient: string;
}

export const VIDEO_COLOR_FILTERS: VideoFilterPreset[] = [
  {
    id: 'normal',
    name: 'Oryginał',
    cssFilter: 'none',
    previewGradient: 'from-zinc-500 via-zinc-700 to-zinc-900',
  },
  {
    id: 'warm',
    name: 'Złoty',
    cssFilter: 'saturate(1.28) contrast(1.06) sepia(0.18)',
    previewGradient: 'from-amber-300 via-orange-500 to-rose-700',
  },
  {
    id: 'cool',
    name: 'Chłodny',
    cssFilter: 'saturate(1.15) hue-rotate(-12deg) contrast(1.08)',
    previewGradient: 'from-cyan-300 via-sky-500 to-indigo-800',
  },
  {
    id: 'vivid',
    name: 'Żywy',
    cssFilter: 'saturate(1.5) contrast(1.12)',
    previewGradient: 'from-pink-400 via-rose-500 to-purple-800',
  },
  {
    id: 'vintage',
    name: 'Retro',
    cssFilter: 'sepia(0.38) contrast(1.08) brightness(0.97) saturate(1.12)',
    previewGradient: 'from-yellow-200 via-amber-600 to-stone-800',
  },
  {
    id: 'neon',
    name: 'Neon',
    cssFilter: 'contrast(1.18) saturate(1.45) hue-rotate(14deg)',
    previewGradient: 'from-[#25F4EE] via-fuchsia-500 to-[#FE2C55]',
  },
  {
    id: 'mono',
    name: 'Mono B&W',
    cssFilter: 'grayscale(1) contrast(1.22)',
    previewGradient: 'from-zinc-200 via-zinc-500 to-black',
  },
];

export const ALLOWED_VIDEO_FILTER_IDS: readonly VideoFilterId[] = [
  'normal',
  'warm',
  'cool',
  'vivid',
  'vintage',
  'neon',
  'mono',
];

export function sanitizeColorFilter(raw?: string | null): VideoFilterId {
  if (raw && (ALLOWED_VIDEO_FILTER_IDS as readonly string[]).includes(raw)) {
    return raw as VideoFilterId;
  }
  return 'normal';
}

export function getVideoFilterCss(filterId?: string | null): string {
  const found = VIDEO_COLOR_FILTERS.find((f) => f.id === filterId);
  return found ? found.cssFilter : 'none';
}
