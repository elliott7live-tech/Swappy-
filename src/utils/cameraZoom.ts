export const LIVE_MIN_FOLLOWERS = 500;

export const MIN_CAMERA_ZOOM = 0.5;
export const MAX_CAMERA_ZOOM = 10;
export const DEFAULT_CAMERA_ZOOM = 1;

export const CAMERA_ZOOM_PRESETS = [0.5, 1, 2, 5, 10] as const;

export interface HardwareZoomCapabilities {
  min: number;
  max: number;
  step: number;
}

export function clampCameraZoom(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_CAMERA_ZOOM;
  const clamped = Math.max(MIN_CAMERA_ZOOM, Math.min(MAX_CAMERA_ZOOM, raw));
  return Math.round(clamped * 10) / 10;
}

export function formatZoomLabel(zoom: number): string {
  const z = clampCameraZoom(zoom);
  if (Math.abs(z - Math.round(z)) < 0.04) {
    return `${Math.round(z)}x`;
  }
  return `${z.toFixed(1)}x`;
}

export function readTrackZoomCapabilities(
  track: MediaStreamTrack | null | undefined
): HardwareZoomCapabilities | null {
  if (!track || typeof track.getCapabilities !== 'function') return null;
  try {
    const caps = track.getCapabilities() as MediaTrackCapabilities & {
      zoom?: { min?: number; max?: number; step?: number };
    };
    if (
      caps?.zoom &&
      typeof caps.zoom.min === 'number' &&
      typeof caps.zoom.max === 'number' &&
      caps.zoom.max > caps.zoom.min
    ) {
      return {
        min: caps.zoom.min,
        max: caps.zoom.max,
        step: typeof caps.zoom.step === 'number' && caps.zoom.step > 0 ? caps.zoom.step : 0.1,
      };
    }
  } catch {
    // Ignore browsers that do not expose zoom capabilities
  }
  return null;
}

/**
 * Splits requested camera zoom [0.5x .. 10x] into:
 * 1) Native optical/ISP hardware zoom (when supported by the camera track), and
 * 2) Smooth GPU/canvas scale factor for < 1x wide view or > hwMax up to 10x.
 *
 * Baseline 1.0x uses uncropped full-sensor framing (cssScale = 1.0 with object-contain)
 * so default camera view is never over-cropped.
 */
export function computeZoomSplit(
  desiredZoom: number,
  hwCaps: HardwareZoomCapabilities | null
): { hwZoom: number | null; cssScale: number } {
  const z = clampCameraZoom(desiredZoom);

  if (hwCaps) {
    const hwZoom = Math.max(hwCaps.min, Math.min(hwCaps.max, z));

    if (z < 1 && hwCaps.min >= 0.98) {
      // Single-lens hardware where min zoom is 1.0: smoothly widen out down to 0.5x
      const cssScale = 0.78 + ((z - MIN_CAMERA_ZOOM) / (1 - MIN_CAMERA_ZOOM)) * 0.22;
      return { hwZoom, cssScale };
    }

    if (z < hwZoom) {
      const cssScale = Math.max(0.78, z / hwZoom);
      return { hwZoom, cssScale };
    }

    const cssScale = z / hwZoom;
    return { hwZoom, cssScale };
  }

  // Fallback when browser/camera does not expose hardware zoom capability
  if (z < 1) {
    const cssScale = 0.78 + ((z - MIN_CAMERA_ZOOM) / (1 - MIN_CAMERA_ZOOM)) * 0.22;
    return { hwZoom: null, cssScale };
  }

  return { hwZoom: null, cssScale: z };
}

export async function findExplicitUltraWideRearDeviceId(): Promise<string | null> {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
    const ultra = videoInputs.find(
      (d) =>
        /ultra|0\.5x?|0\.6x?|wide[\s-]*angle|szeroko/i.test(d.label) &&
        !/front|user|selfie|przód|przedni/i.test(d.label)
    );
    return ultra?.deviceId ?? null;
  } catch {
    return null;
  }
}

/**
 * Acquires a smooth 30fps camera stream WITHOUT portrait width<height pre-cropping.
 * Uses native 4:3 sensor coordinates (960x720) + resizeMode: 'none' so mobile & desktop
 * browsers deliver the full, un-zoomed camera field of view.
 */
export async function acquireWideCameraStream(options: {
  facingMode: 'user' | 'environment';
  withAudio: boolean;
  preferUltraWideDevice?: boolean;
}): Promise<MediaStream> {
  const { facingMode, withAudio, preferUltraWideDevice = false } = options;

  let ultraDeviceId: string | null = null;
  if (facingMode === 'environment' && preferUltraWideDevice) {
    ultraDeviceId = await findExplicitUltraWideRearDeviceId();
  }

  const primaryVideoConstraints: MediaTrackConstraints & {
    resizeMode?: ConstrainDOMString;
  } = {
    ...(ultraDeviceId
      ? { deviceId: { exact: ultraDeviceId } }
      : { facingMode: { ideal: facingMode } }),
    width: { ideal: 960 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
    resizeMode: { ideal: 'none' },
  };

  const audioConstraints: MediaTrackConstraints | boolean = withAudio
    ? {
        echoCancellation: true,
        noiseSuppression: true,
      }
    : false;

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: primaryVideoConstraints,
      audio: audioConstraints,
    });
  } catch {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: audioConstraints,
      });
    } catch {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          frameRate: { ideal: 30, max: 30 },
        },
      });
    }
  }
}

export function buildCameraPreviewTransform(
  cssScale: number,
  mirror: boolean
): string | undefined {
  const roundedScale = Math.round(cssScale * 1000) / 1000;
  if (!mirror && Math.abs(roundedScale - 1) < 0.005) {
    return undefined;
  }
  const sx = mirror ? -roundedScale : roundedScale;
  return `scale(${sx}, ${roundedScale})`;
}

/**
 * Renders the current video frame onto a 9:16 recording/broadcast canvas
 * using uncropped object-contain framing scaled by cssScale around the center.
 */
export function drawZoomedVideoFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement,
  canvasW: number,
  canvasH: number,
  cssScale: number,
  mirror: boolean
): void {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) return;

  const fitScale = Math.min(canvasW / vw, canvasH / vh);
  const drawW = vw * fitScale * cssScale;
  const drawH = vh * fitScale * cssScale;

  if (drawW < canvasW || drawH < canvasH) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  ctx.save();
  ctx.translate(canvasW / 2, canvasH / 2);
  if (mirror) {
    ctx.scale(-1, 1);
  }
  ctx.drawImage(videoEl, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}
