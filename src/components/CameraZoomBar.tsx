import React, { useCallback, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import {
  CAMERA_ZOOM_PRESETS,
  clampCameraZoom,
  formatZoomLabel,
  MAX_CAMERA_ZOOM,
  MIN_CAMERA_ZOOM,
} from '../utils/cameraZoom';

interface CameraZoomBarProps {
  zoom: number;
  onChangeZoom: (nextZoom: number) => void;
  compact?: boolean;
}

export const CameraZoomBar: React.FC<CameraZoomBarProps> = ({
  zoom,
  onChangeZoom,
  compact = false,
}) => {
  const activePreset = CAMERA_ZOOM_PRESETS.reduce((best, curr) =>
    Math.abs(curr - zoom) < Math.abs(best - zoom) ? curr : best
  );

  const handleStep = (direction: -1 | 1) => {
    const stepSize = zoom < 1 || (zoom === 1 && direction === -1) ? 0.1 : 0.5;
    onChangeZoom(clampCameraZoom(zoom + direction * stepSize));
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      className="flex flex-col items-center gap-1.5 select-none z-30"
    >
      {/* Preset Pills: 0.5x | 1x | 2x | 5x | 10x */}
      <div className="rounded-full bg-black/50 backdrop-blur-md border border-white/15 p-0.5 flex items-center gap-0.5 shadow-lg">
        {CAMERA_ZOOM_PRESETS.map((preset) => {
          const isExact = Math.abs(zoom - preset) < 0.06;
          const isClosest = activePreset === preset;
          const label =
            isClosest && !isExact
              ? formatZoomLabel(zoom)
              : preset === 0.5
                ? '0.5x'
                : `${preset}x`;

          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChangeZoom(preset)}
              className={`min-h-[30px] min-w-[38px] px-2.5 rounded-full text-[11px] font-extrabold font-mono tabular-nums transition-all cursor-pointer ${
                isClosest
                  ? 'bg-white text-black shadow-sm scale-105'
                  : 'text-white/90 hover:text-white hover:bg-white/10'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Smooth Fine Slider: 0.5x -> 10.0x */}
      {!compact && (
        <div className="w-[244px] sm:w-[272px] rounded-full bg-black/45 backdrop-blur-md border border-white/10 px-2 py-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleStep(-1)}
            disabled={zoom <= MIN_CAMERA_ZOOM}
            aria-label="Zmniejsz przybliżenie kamery"
            className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-35 flex items-center justify-center text-white cursor-pointer shrink-0"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <input
            type="range"
            min={MIN_CAMERA_ZOOM}
            max={MAX_CAMERA_ZOOM}
            step={0.1}
            value={zoom}
            aria-label="Przybliżenie kamery od 0.5x do 10x"
            onChange={(e) => onChangeZoom(clampCameraZoom(Number(e.target.value)))}
            className="flex-1 h-1.5 accent-[#FE2C55] cursor-pointer"
          />

          <button
            type="button"
            onClick={() => handleStep(1)}
            disabled={zoom >= MAX_CAMERA_ZOOM}
            aria-label="Zwiększ przybliżenie kamery"
            className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-35 flex items-center justify-center text-white cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * Provides two-finger pinch-to-zoom (touch) and scroll-wheel zoom (desktop)
 * directly on any camera viewfinder container.
 */
export function useCameraGestureZoom(
  currentZoom: number,
  onChangeZoom: (nextZoom: number) => void,
  enabled = true
) {
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(currentZoom);
  const latestZoomRef = useRef<number>(currentZoom);
  latestZoomRef.current = currentZoom;

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || e.touches.length !== 2) return;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (dist > 8) {
        pinchStartDistRef.current = dist;
        pinchStartZoomRef.current = latestZoomRef.current;
      }
    },
    [enabled]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || e.touches.length !== 2 || !pinchStartDistRef.current) return;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (dist <= 4) return;
      const ratio = dist / pinchStartDistRef.current;
      onChangeZoom(clampCameraZoom(pinchStartZoomRef.current * ratio));
    },
    [enabled, onChangeZoom]
  );

  const onTouchEnd = useCallback(() => {
    pinchStartDistRef.current = null;
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!enabled) return;
      if (Math.abs(e.deltaY) < 1) return;
      const delta = -e.deltaY * 0.006;
      onChangeZoom(clampCameraZoom(latestZoomRef.current + delta));
    },
    [enabled, onChangeZoom]
  );

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: onTouchEnd,
    onWheel,
  };
}
