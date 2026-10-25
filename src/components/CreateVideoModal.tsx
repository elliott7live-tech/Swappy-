import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Disc3,
  FlipHorizontal2,
  Globe,
  Image as ImageIcon,
  LayoutGrid,
  Lock,
  LogIn,
  Music,
  Radio,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Trash2,
  Type,
  Upload,
  Users,
  Video,
  Volume2,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';
import { useLanguage } from '../i18n';
import { LiveAutoStartConfig, MusicTrack, PublicProfile } from '../types';
import {
  acquireWideCameraStream,
  buildCameraPreviewTransform,
  clampCameraZoom,
  computeZoomSplit,
  DEFAULT_CAMERA_ZOOM,
  drawZoomedVideoFrameToCanvas,
  formatZoomLabel,
  HardwareZoomCapabilities,
  LIVE_MIN_FOLLOWERS,
  readTrackZoomCapabilities,
} from '../utils/cameraZoom';
import {
  getVideoFilterCss,
  VIDEO_COLOR_FILTERS,
  VideoFilterId,
} from '../utils/videoFilters';
import { CameraZoomBar, useCameraGestureZoom } from './CameraZoomBar';
import { MusicPickerModal } from './MusicPickerModal';
import { UserAvatar } from './UserAvatar';

export interface NewVideoSubmission {
  caption: string;
  hashtags: string[];
  musicTitle: string;
  musicArtist: string;
  musicAudioUrl: string;
  musicCoverUrl: string;
  originalVolume: number;
  musicVolume: number;
  overlayText: string;
  colorFilter: VideoFilterId;
  visibility: 'public' | 'private';
  recordedBlob?: Blob | null;
  externalVideoUrl?: string;
}

interface CreateVideoModalProps {
  isOpen: boolean;
  isSignedIn: boolean;
  isPublishing: boolean;
  profile: PublicProfile | null;
  followersCount: number;
  onClose: () => void;
  onSignIn: () => void;
  onPublish: (payload: NewVideoSubmission) => Promise<void>;
  onStartLiveBroadcast: (config: LiveAutoStartConfig) => void;
}

type CaptureMode = '10m' | '60s' | '15s' | 'photo' | 'text';
type BottomTabMode = 'aparat' | 'stworz' | 'live';
type PreviewSheetMode = 'none' | 'text' | 'stickers' | 'filters' | 'audio' | 'settings';

const TEXT_BACKGROUNDS = [
  ['#FE2C55', '#7928CA'],
  ['#0F2027', '#2C5364'],
  ['#11998E', '#38EF7D'],
  ['#F7971E', '#FFD200'],
  ['#141418', '#27272A'],
];

const QUICK_STICKERS = ['🔥', '❤️', '😂', '✨', '🎵', '💯', '🙌', '😎', '🚀', '💎'];

// Prefer hardware-accelerated H.264 / MP4 or lightweight VP8 — NEVER slow software VP9!
function pickSupportedRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

export const CreateVideoModal: React.FC<CreateVideoModalProps> = ({
  isOpen,
  isSignedIn,
  isPublishing,
  profile,
  followersCount,
  onClose,
  onSignIn,
  onPublish,
  onStartLiveBroadcast,
}) => {
  const { t } = useLanguage();
  const canGoLive = isSignedIn && followersCount >= LIVE_MIN_FOLLOWERS;
  const missingLiveFollowers = Math.max(0, LIVE_MIN_FOLLOWERS - followersCount);
  const liveFollowerProgressPct = Math.min(
    100,
    Math.round((followersCount / LIVE_MIN_FOLLOWERS) * 100)
  );

  // 3-step TikTok flow:
  // 'capture' (Camera/Upload/LIVE) -> 'preview' (1:1 TikTok Post-Recording Preview with Story 24h & Dalej) -> 'details' (Caption & Opublikuj)
  const [step, setStep] = useState<'capture' | 'preview' | 'details'>('capture');
  const [bottomTab, setBottomTab] = useState<BottomTabMode>('aparat');
  const [captureMode, setCaptureMode] = useState<CaptureMode>('15s');

  // Right-rail & 0.5x–10x camera zoom state
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [countdownSetting, setCountdownSetting] = useState<0 | 3 | 10>(0);
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  const [gridEnabled, setGridEnabled] = useState(false);
  // Default retouchEnabled to false so mobile camera stays on zero-copy hardware video plane without stutter!
  const [retouchEnabled, setRetouchEnabled] = useState(false);
  const [activeFilterIndex, setActiveFilterIndex] = useState(0);
  const [mirrorEnabled, setMirrorEnabled] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [cameraZoom, setCameraZoom] = useState<number>(DEFAULT_CAMERA_ZOOM);
  const [hwZoomCaps, setHwZoomCaps] = useState<HardwareZoomCapabilities | null>(null);

  // LIVE tab inside '+' camera state
  const [liveDraftTitle, setLiveDraftTitle] = useState('Na żywo na Swappy!');

  // Global Internet Music & Audio Mixer state
  const [isMusicPickerOpen, setIsMusicPickerOpen] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<MusicTrack | null>(null);
  const [musicTitle, setMusicTitle] = useState('Oryginalny dźwięk');
  const [originalVolume, setOriginalVolume] = useState(100);
  const [musicVolume, setMusicVolume] = useState(90);

  // Text mode story composer
  const [textStoryBody, setTextStoryBody] = useState('');
  const [textBgIndex, setTextBgIndex] = useState(0);

  // Recording & Media state
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isGeneratingClip, setIsGeneratingClip] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [externalUrl, setExternalUrl] = useState('');

  // Step 2 ('preview' — TikTok Post-Recording Screen) & Step 3 ('details') state
  const [previewSheet, setPreviewSheet] = useState<PreviewSheetMode>('none');
  const [previewToolsExpanded, setPreviewToolsExpanded] = useState(true);
  const [previewFitContain, setPreviewFitContain] = useState(false);
  const [previewPlaybackRate, setPreviewPlaybackRate] = useState<1 | 1.25 | 0.75>(1);
  const [autoCutActive, setAutoCutActive] = useState(false);
  const [selectedSticker, setSelectedSticker] = useState<string>('');
  const [postFilterId, setPostFilterId] = useState<VideoFilterId>('normal');
  const [caption, setCaption] = useState('');
  const [hashtagsInput, setHashtagsInput] = useState('swappy dlaciebie');
  const [overlayText, setOverlayText] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [formError, setFormError] = useState<string | null>(null);
  const [toolToast, setToolToast] = useState<string | null>(null);

  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const detailsVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const cameraSongAudioRef = useRef<HTMLAudioElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const recordCanvasCleanupRef = useRef<(() => void) | null>(null);
  const liveCssScaleRef = useRef<number>(1);
  const shouldMirrorRef = useRef<boolean>(false);
  const isApplyingHwZoomRef = useRef<boolean>(false);
  const pendingHwZoomRef = useRef<number | null>(null);

  const maxDurationSeconds =
    captureMode === '10m' ? 600 : captureMode === '60s' ? 60 : 15;

  const activeCameraFilter =
    VIDEO_COLOR_FILTERS[activeFilterIndex] ?? VIDEO_COLOR_FILTERS[0];
  const combinedCssFilterParts = [
    activeCameraFilter.id !== 'normal' ? activeCameraFilter.cssFilter : '',
    retouchEnabled ? 'brightness(1.04) contrast(1.02)' : '',
  ].filter(Boolean);
  const combinedCssFilter =
    combinedCssFilterParts.length > 0 ? combinedCssFilterParts.join(' ') : undefined;

  const { hwZoom: desiredHwZoom, cssScale: cameraCssScale } = computeZoomSplit(
    cameraZoom,
    hwZoomCaps
  );
  liveCssScaleRef.current = cameraCssScale;

  const preferUltraWideRearLens =
    facingMode === 'environment' &&
    cameraZoom < 0.85 &&
    (!hwZoomCaps || hwZoomCaps.min >= 0.98);

  const showQuickHint = (msg: string) => {
    setToolToast(msg);
    window.setTimeout(() => {
      setToolToast((prev) => (prev === msg ? null : prev));
    }, 1600);
  };

  const stopCameraStream = () => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (recordCanvasCleanupRef.current) {
      recordCanvasCleanupRef.current();
      recordCanvasCleanupRef.current = null;
    }
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (cameraSongAudioRef.current) {
      cameraSongAudioRef.current.pause();
      cameraSongAudioRef.current.currentTime = 0;
    }
    setCountdownRemaining(null);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setHwZoomCaps(null);
    pendingHwZoomRef.current = null;
    isApplyingHwZoomRef.current = false;
    setIsRecording(false);
  };

  // Reset modal cleanly when opened
  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
      previewAudioRef.current?.pause();
      setIsMusicPickerOpen(false);
      return;
    }
    setStep('capture');
    setBottomTab('aparat');
    setCameraZoom(DEFAULT_CAMERA_ZOOM);
    setPreviewSheet('none');
    setAutoCutActive(false);
    setFormError(null);
  }, [isOpen]);

  // Acquire uncropped 30fps native sensor stream (no portrait height>width pre-crop!)
  useEffect(() => {
    const needsCamera =
      isOpen &&
      step === 'capture' &&
      ((bottomTab === 'live' && canGoLive) ||
        (bottomTab === 'aparat' && captureMode !== 'text'));

    if (!needsCamera) {
      stopCameraStream();
      return;
    }

    let cancelled = false;
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'Przeglądarka nie udostępnia podglądu kamery — wybierz wideo z galerii na dole po lewej.'
      );
      return;
    }

    void acquireWideCameraStream({
      facingMode,
      withAudio: true,
      preferUltraWideDevice: preferUltraWideRearLens,
    })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const prev = streamRef.current;
        streamRef.current = stream;
        if (prev && prev !== stream) {
          prev.getTracks().forEach((t) => t.stop());
        }

        const track = stream.getVideoTracks()[0];
        const caps = readTrackZoomCapabilities(track);
        setHwZoomCaps(caps);

        if (track && caps) {
          const split = computeZoomSplit(cameraZoom, caps);
          if (split.hwZoom !== null) {
            void track
              .applyConstraints({
                advanced: [{ zoom: split.hwZoom } as MediaTrackConstraintSet],
              })
              .catch(() => {});
          }
        }

        if (liveVideoRef.current) {
          liveVideoRef.current.srcObject = stream;
          void liveVideoRef.current.play().catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCameraError(
            'Zezwól na dostęp do aparatu lub stuknij miniaturę galerii w lewym dolnym rogu, aby wgrać film z telefonu.'
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, step, bottomTab, captureMode, facingMode, canGoLive, preferUltraWideRearLens]);

  // Clean up camera stream when leaving capture step
  useEffect(() => {
    const needsCamera =
      isOpen &&
      step === 'capture' &&
      ((bottomTab === 'live' && canGoLive) ||
        (bottomTab === 'aparat' && captureMode !== 'text'));
    if (!needsCamera) {
      stopCameraStream();
    }
  }, [isOpen, step, bottomTab, captureMode, canGoLive]);

  // Latest-wins hardware zoom constraint applier for butter-smooth 0.5x–10x zooming
  useEffect(() => {
    if (desiredHwZoom === null) return;
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (!track || typeof track.applyConstraints !== 'function') return;

    pendingHwZoomRef.current = desiredHwZoom;
    if (isApplyingHwZoomRef.current) return;

    isApplyingHwZoomRef.current = true;
    void (async () => {
      while (pendingHwZoomRef.current !== null) {
        const target = pendingHwZoomRef.current;
        pendingHwZoomRef.current = null;
        try {
          await track.applyConstraints({
            advanced: [{ zoom: target } as MediaTrackConstraintSet],
          });
        } catch {
          // Ignore unsupported intermediate zoom step
        }
      }
      isApplyingHwZoomRef.current = false;
    })();
  }, [desiredHwZoom]);

  // Hardware torch toggle when supported on mobile rear camera
  useEffect(() => {
    const videoTrack = streamRef.current?.getVideoTracks()?.[0];
    if (!videoTrack) return;
    const capabilities = videoTrack.getCapabilities?.() as
      | (MediaTrackCapabilities & { torch?: boolean })
      | undefined;
    if (capabilities?.torch) {
      void videoTrack
        .applyConstraints({
          advanced: [{ torch: flashEnabled } as MediaTrackConstraintSet],
        })
        .catch(() => {});
    }
  }, [flashEnabled, facingMode]);

  // Sync Step 2 ('preview') & Step 3 ('details') video volume + playback rate + internet song audio
  useEffect(() => {
    if (step !== 'preview' && step !== 'details') {
      previewAudioRef.current?.pause();
      return;
    }

    const vid = step === 'preview' ? previewVideoRef.current : detailsVideoRef.current;
    const aud = previewAudioRef.current;

    if (vid) {
      vid.volume = Math.max(0, Math.min(1, originalVolume / 100));
      vid.muted = originalVolume === 0;
      vid.playbackRate = previewPlaybackRate;
    }

    if (aud) {
      aud.volume = Math.max(0, Math.min(1, musicVolume / 100));
      aud.muted = musicVolume === 0;
      if (selectedTrack?.audioUrl && !isMusicPickerOpen) {
        if (!vid || !vid.paused) {
          void aud.play().catch(() => {});
        }
      } else {
        aud.pause();
      }
    }
  }, [step, selectedTrack, originalVolume, musicVolume, isMusicPickerOpen, previewPlaybackRate]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const cameraGestureHandlers = useCameraGestureZoom(
    cameraZoom,
    (next) => setCameraZoom(clampCameraZoom(next)),
    step === 'capture' &&
      ((bottomTab === 'aparat' && captureMode !== 'text') ||
        (bottomTab === 'live' && canGoLive))
  );

  if (!isOpen) return null;

  const handleToggleWideZoomShortcut = () => {
    const next = Math.abs(cameraZoom - 0.5) < 0.08 ? 1 : 0.5;
    setCameraZoom(next);
    showQuickHint(`Zoom kamery: ${formatZoomLabel(next)}`);
  };

  const handleTrackChosen = (track: MusicTrack | null) => {
    setSelectedTrack(track);
    if (track) {
      setMusicTitle(track.title);
      if (originalVolume === 100) {
        setOriginalVolume(50);
      }
      setMusicVolume(95);
      showQuickHint(`♪ ${track.title}`);
    } else {
      setMusicTitle('Oryginalny dźwięk');
      setOriginalVolume(100);
    }
  };

  const moveToPreviewStep = (blob: Blob | null, initialFilter: VideoFilterId) => {
    setVideoBlob(blob);
    setPostFilterId(initialFilter);
    setPreviewSheet('none');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(blob ? URL.createObjectURL(blob) : null);
    stopCameraStream();
    setStep('preview');
  };

  const beginActualVideoRecording = () => {
    const stream = streamRef.current;
    if (!stream) {
      galleryInputRef.current?.click();
      return;
    }

    const chosenCameraFilterId = activeCameraFilter.id;
    chunksRef.current = [];
    const mimeType = pickSupportedRecorderMime();
    const options: MediaRecorderOptions = {
      videoBitsPerSecond: 2_200_000,
    };
    if (mimeType) {
      options.mimeType = mimeType;
    }

    const videoEl = liveVideoRef.current;
    let recordingStream: MediaStream = stream;
    let stopCanvasPump: (() => void) | null = null;

    if (videoEl && typeof HTMLCanvasElement.prototype.captureStream === 'function') {
      try {
        const recCanvas = document.createElement('canvas');
        recCanvas.width = 540;
        recCanvas.height = 960;
        const recCtx = recCanvas.getContext('2d', { alpha: false });
        if (recCtx) {
          drawZoomedVideoFrameToCanvas(
            recCtx,
            videoEl,
            recCanvas.width,
            recCanvas.height,
            liveCssScaleRef.current,
            shouldMirrorRef.current
          );
          const pumpId = window.setInterval(() => {
            if (liveVideoRef.current) {
              drawZoomedVideoFrameToCanvas(
                recCtx,
                liveVideoRef.current,
                recCanvas.width,
                recCanvas.height,
                liveCssScaleRef.current,
                shouldMirrorRef.current
              );
            }
          }, 33);
          const canvasStream = recCanvas.captureStream(30);
          stopCanvasPump = () => {
            window.clearInterval(pumpId);
            canvasStream.getVideoTracks().forEach((tr) => tr.stop());
          };
          recordCanvasCleanupRef.current = stopCanvasPump;
          recordingStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...stream.getAudioTracks(),
          ]);
        }
      } catch {
        stopCanvasPump?.();
        stopCanvasPump = null;
        recordCanvasCleanupRef.current = null;
        recordingStream = stream;
      }
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(recordingStream, options);
    } catch {
      try {
        recorder = new MediaRecorder(recordingStream);
      } catch {
        stopCanvasPump?.();
        stopCanvasPump = null;
        recordCanvasCleanupRef.current = null;
        recorder = new MediaRecorder(stream);
      }
    }

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        chunksRef.current.push(ev.data);
      }
    };

    recorder.onstop = () => {
      if (recordCanvasCleanupRef.current) {
        recordCanvasCleanupRef.current();
        recordCanvasCleanupRef.current = null;
      }
      if (cameraSongAudioRef.current) {
        cameraSongAudioRef.current.pause();
        cameraSongAudioRef.current.currentTime = 0;
      }
      const finalBlob = new Blob(chunksRef.current, {
        type: recorder.mimeType || mimeType || 'video/webm',
      });
      if (finalBlob.size > 0) {
        moveToPreviewStep(finalBlob, chosenCameraFilterId);
      }
    };

    mediaRecorderRef.current = recorder;
    // 1000ms chunk interval avoids main-thread GC stalls during recording on mobile devices
    recorder.start(1000);
    setIsRecording(true);
    setRecordSeconds(0);

    if (selectedTrack?.audioUrl && cameraSongAudioRef.current) {
      cameraSongAudioRef.current.currentTime = 0;
      cameraSongAudioRef.current.volume = 0.85;
      void cameraSongAudioRef.current.play().catch(() => {});
    }

    recordTimerRef.current = window.setInterval(() => {
      setRecordSeconds((prev) => {
        if (prev + 1 >= maxDurationSeconds) {
          stopVideoRecording();
          return maxDurationSeconds;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const stopVideoRecording = () => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (cameraSongAudioRef.current) {
      cameraSongAudioRef.current.pause();
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const recordCanvasAsVideoClip = async (
    drawFrame: (ctx: CanvasRenderingContext2D, w: number, h: number, elapsed: number) => void,
    initialFilter: VideoFilterId = 'normal'
  ) => {
    setIsGeneratingClip(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 1280;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setIsGeneratingClip(false);
        return;
      }

      const canvasStream = canvas.captureStream(30);
      const mimeType = pickSupportedRecorderMime();
      const recorder = mimeType
        ? new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 2_200_000 })
        : new MediaRecorder(canvasStream);

      const parts: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) parts.push(e.data);
      };

      const donePromise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(parts, { type: recorder.mimeType || 'video/webm' }));
        };
      });

      const start = performance.now();
      recorder.start(500);

      await new Promise<void>((resolve) => {
        const tick = (now: number) => {
          const elapsed = (now - start) / 1000;
          drawFrame(ctx, canvas.width, canvas.height, elapsed);
          if (elapsed < 3.0) {
            window.requestAnimationFrame(tick);
          } else {
            resolve();
          }
        };
        window.requestAnimationFrame(tick);
      });

      recorder.stop();
      const clipBlob = await donePromise;
      setIsGeneratingClip(false);
      moveToPreviewStep(clipBlob, initialFilter);
    } catch {
      setIsGeneratingClip(false);
      showQuickHint('Nie udało się zapisać ujęcia');
    }
  };

  const handleShutterPress = () => {
    if (isGeneratingClip) return;

    if (isRecording) {
      stopVideoRecording();
      return;
    }

    if (countdownRemaining !== null) {
      if (countdownTimerRef.current) {
        window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      setCountdownRemaining(null);
      return;
    }

    if (captureMode === 'text') {
      const textToRender = textStoryBody.trim() || 'Swappy';
      const [c1, c2] = TEXT_BACKGROUNDS[textBgIndex % TEXT_BACKGROUNDS.length];
      void recordCanvasAsVideoClip((ctx, w, h) => {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, c1);
        grad.addColorStop(1, c2);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 54px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const words = textToRender.split(/\s+/);
        const lines: string[] = [];
        let current = '';
        for (const word of words) {
          const test = current ? `${current} ${word}` : word;
          if (ctx.measureText(test).width > w - 120) {
            if (current) lines.push(current);
            current = word;
          } else {
            current = test;
          }
        }
        if (current) lines.push(current);

        const lineHeight = 72;
        const startY = h / 2 - ((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, idx) => {
          ctx.fillText(line, w / 2, startY + idx * lineHeight);
        });
      }, 'normal');
      return;
    }

    if (captureMode === 'photo') {
      const videoEl = liveVideoRef.current;
      if (!videoEl || !streamRef.current) {
        galleryInputRef.current?.click();
        return;
      }
      const snapCanvas = document.createElement('canvas');
      snapCanvas.width = 720;
      snapCanvas.height = 1280;
      const snapCtx = snapCanvas.getContext('2d', { alpha: false });
      if (snapCtx) {
        drawZoomedVideoFrameToCanvas(
          snapCtx,
          videoEl,
          snapCanvas.width,
          snapCanvas.height,
          liveCssScaleRef.current,
          shouldMirrorRef.current
        );
      }
      void recordCanvasAsVideoClip((ctx, w, h) => {
        ctx.drawImage(snapCanvas, 0, 0, w, h);
      }, activeCameraFilter.id);
      return;
    }

    if (countdownSetting > 0 && streamRef.current) {
      let left = countdownSetting;
      setCountdownRemaining(left);
      countdownTimerRef.current = window.setInterval(() => {
        left -= 1;
        if (left <= 0) {
          if (countdownTimerRef.current) {
            window.clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          setCountdownRemaining(null);
          beginActualVideoRecording();
        } else {
          setCountdownRemaining(left);
        }
      }, 1000);
      return;
    }

    beginActualVideoRecording();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 60 * 1024 * 1024) {
      showQuickHint('Maksymalny rozmiar wideo to 60 MB');
      return;
    }
    setFormError(null);
    moveToPreviewStep(file, activeCameraFilter.id);
    e.target.value = '';
  };

  const handleLaunchLiveFromCamera = () => {
    if (!isSignedIn) {
      onSignIn();
      return;
    }
    if (followersCount < LIVE_MIN_FOLLOWERS) {
      showQuickHint(
        `Transmisje LIVE dostępne od ${LIVE_MIN_FOLLOWERS} obserwujących (${followersCount}/${LIVE_MIN_FOLLOWERS})`
      );
      return;
    }
    const chosenFilter = activeCameraFilter.id;
    const chosenFacing: 'user' | 'environment' = facingMode;
    const chosenZoom = cameraZoom;
    stopCameraStream();
    onClose();
    onStartLiveBroadcast({
      title: liveDraftTitle.trim() || 'Na żywo na Swappy!',
      colorFilter: chosenFilter,
      facingMode: chosenFacing,
      initialZoom: chosenZoom,
    });
  };

  const buildCombinedOverlayText = () => {
    const parts = [selectedSticker, overlayText.trim()].filter(Boolean);
    return parts.join(' ');
  };

  // Instant 1-tap "Story 24h" publish right from the post-recording preview screen
  const handleQuickPublishStory = async () => {
    if (isPublishing) return;
    if (!isSignedIn) {
      onSignIn();
      return;
    }
    if (!videoBlob && !externalUrl.trim().startsWith('https://')) {
      return;
    }
    previewAudioRef.current?.pause();
    await onPublish({
      caption: caption.trim() || 'Story 24h',
      hashtags: ['story', '24h', 'swappy'],
      musicTitle: selectedTrack?.title || musicTitle.trim() || t('originalSound'),
      musicArtist: selectedTrack?.artist || '',
      musicAudioUrl: selectedTrack?.audioUrl || '',
      musicCoverUrl: selectedTrack?.coverUrl || '',
      originalVolume,
      musicVolume: selectedTrack?.audioUrl ? musicVolume : 0,
      overlayText: buildCombinedOverlayText(),
      colorFilter: postFilterId,
      visibility: 'public',
      recordedBlob: videoBlob,
      externalVideoUrl: !videoBlob ? externalUrl.trim() : undefined,
    });
  };

  const handleSubmitPublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSignedIn || isPublishing) return;

    setFormError(null);

    if (!videoBlob && !externalUrl.trim().startsWith('https://')) {
      setFormError('Nagraj wideo lub wybierz plik z urządzenia.');
      return;
    }

    const parsedTags = hashtagsInput
      .split(/[\s,#]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8);

    previewAudioRef.current?.pause();

    await onPublish({
      caption: caption.trim() || 'Nowy film na Swappy',
      hashtags: parsedTags.length > 0 ? parsedTags : ['swappy'],
      musicTitle: selectedTrack?.title || musicTitle.trim() || t('originalSound'),
      musicArtist: selectedTrack?.artist || '',
      musicAudioUrl: selectedTrack?.audioUrl || '',
      musicCoverUrl: selectedTrack?.coverUrl || '',
      originalVolume,
      musicVolume: selectedTrack?.audioUrl ? musicVolume : 0,
      overlayText: buildCombinedOverlayText(),
      colorFilter: postFilterId,
      visibility,
      recordedBlob: videoBlob,
      externalVideoUrl: !videoBlob ? externalUrl.trim() : undefined,
    });
  };

  const handleToggleAutoCut = () => {
    setAutoCutActive((prev) => {
      const next = !prev;
      if (next) {
        if (postFilterId === 'normal') {
          setPostFilterId('vivid');
        }
        if (selectedTrack) {
          setOriginalVolume(35);
          setMusicVolume(100);
        }
        showQuickHint('AutoCut: dopasowano styl i dźwięk');
      } else {
        setPostFilterId('normal');
        showQuickHint('AutoCut: wyłączono');
      }
      return next;
    });
  };

  const shouldMirrorPreview =
    (facingMode === 'user' && !mirrorEnabled) ||
    (facingMode === 'environment' && mirrorEnabled);
  shouldMirrorRef.current = shouldMirrorPreview;

  const cameraPreviewTransform = buildCameraPreviewTransform(
    cameraCssScale,
    shouldMirrorPreview
  );

  const selectedPostFilter =
    VIDEO_COLOR_FILTERS.find((f) => f.id === postFilterId) ?? VIDEO_COLOR_FILTERS[0];

  const previewFilterCss =
    postFilterId !== 'normal' ? getVideoFilterCss(postFilterId) : undefined;

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex items-center justify-center select-none overflow-hidden">
      {/* Hidden Gallery Input for Bottom-Left Picker & Upload */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Audio element playing chosen internet song during live camera recording */}
      {selectedTrack?.audioUrl && step === 'capture' && (
        <audio
          ref={cameraSongAudioRef}
          src={selectedTrack.audioUrl}
          loop
          preload="auto"
          className="hidden"
        />
      )}

      {/* Synchronized Song Audio Preview on Step 2 ('preview') & Step 3 ('details') */}
      {selectedTrack?.audioUrl && step !== 'capture' && (
        <audio
          ref={previewAudioRef}
          src={selectedTrack.audioUrl}
          loop
          preload="auto"
          className="hidden"
        />
      )}

      {step === 'capture' ? (
        /* =====================================================================
           STEP 1: SMOOTH, UN-ZOOMED CAMERA / UPLOAD / LIVE SCREEN
           ===================================================================== */
        <div className="w-full h-dvh sm:max-w-[440px] bg-black flex flex-col overflow-hidden relative">
          {toolToast && (
            <div className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 z-40 rounded-full bg-black/75 backdrop-blur-md px-4 py-1.5 text-xs font-semibold text-white whitespace-nowrap">
              {toolToast}
            </div>
          )}

          {/* ROUNDED CAMERA VIEWFINDER STAGE (supports two-finger pinch & wheel zoom 0.5x–10x) */}
          <div
            {...cameraGestureHandlers}
            className="relative flex-1 w-full rounded-[28px] overflow-hidden bg-[#101014]"
          >
            {bottomTab === 'stworz' ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 pt-16 text-center space-y-4 bg-gradient-to-b from-zinc-900 to-[#0E0E12] overflow-y-auto no-scrollbar">
                <div className="w-15 h-15 rounded-3xl bg-white/[0.07] border border-white/15 flex items-center justify-center text-[#25F4EE]">
                  <Upload className="w-7 h-7" />
                </div>
                <div className="space-y-1 max-w-xs">
                  <h2 className="text-lg font-extrabold text-white">
                    Dodaj film i muzykę z internetu
                  </h2>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Wybierz film z pamięci urządzenia oraz dodaj dowolną piosenkę z całego świata przed publikacją.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsMusicPickerOpen(true)}
                  className="w-full max-w-[300px] min-h-[52px] px-4 rounded-2xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/15 flex items-center justify-between gap-2.5 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[#FE2C55]/20 flex items-center justify-center text-[#FE2C55] shrink-0">
                      <Globe className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        {selectedTrack
                          ? `${selectedTrack.title} — ${selectedTrack.artist}`
                          : 'Wybierz piosenkę z internetu'}
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate">
                        {selectedTrack
                          ? 'Stuknij, aby zmienić utwór'
                          : 'Wszystkie piosenki świata + własne MP3'}
                      </div>
                    </div>
                  </div>
                  <Music className="w-4 h-4 text-[#25F4EE] shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="w-full max-w-[300px] min-h-[50px] rounded-full bg-[#FE2C55] hover:bg-[#e6254b] text-sm font-bold text-white flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                >
                  <ImageIcon className="w-4 h-4" />
                  <span>Wybierz film z galerii telefonu</span>
                </button>

                <div className="w-full max-w-[300px] pt-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      value={externalUrl}
                      onChange={(e) => setExternalUrl(e.target.value)}
                      placeholder="Lub wklej https://.../film.mp4"
                      className="flex-1 min-w-0 min-h-[42px] rounded-full bg-white/10 border border-white/15 px-4 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#25F4EE]"
                    />
                    <button
                      type="button"
                      disabled={!externalUrl.trim().startsWith('https://')}
                      onClick={() => moveToPreviewStep(null, 'normal')}
                      className="min-h-[42px] px-4 rounded-full bg-white text-black disabled:opacity-40 text-xs font-bold cursor-pointer shrink-0"
                    >
                      {t('next')}
                    </button>
                  </div>
                </div>
              </div>
            ) : bottomTab === 'aparat' && captureMode === 'text' ? (
              <div
                style={{
                  background: `linear-gradient(135deg, ${
                    TEXT_BACKGROUNDS[textBgIndex % TEXT_BACKGROUNDS.length][0]
                  }, ${TEXT_BACKGROUNDS[textBgIndex % TEXT_BACKGROUNDS.length][1]})`,
                }}
                className="w-full h-full flex flex-col items-center justify-center px-8 pb-28 relative"
              >
                <button
                  type="button"
                  onClick={() => setTextBgIndex((i) => i + 1)}
                  className="absolute top-16 left-4 z-20 min-h-[38px] px-3.5 rounded-full bg-black/35 backdrop-blur-md text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
                >
                  <Type className="w-3.5 h-3.5" />
                  <span>Zmień tło</span>
                </button>
                <textarea
                  rows={4}
                  value={textStoryBody}
                  onChange={(e) => setTextStoryBody(e.target.value)}
                  maxLength={140}
                  placeholder="Wpisz tekst..."
                  className="w-full bg-transparent text-center text-2xl sm:text-3xl font-extrabold text-white placeholder:text-white/55 focus:outline-none resize-none leading-snug"
                />
              </div>
            ) : bottomTab === 'live' && !canGoLive ? (
              /* 500-Follower Eligibility Gate on LIVE Tab */
              <div className="w-full h-full flex flex-col items-center justify-center px-6 pt-14 pb-8 text-center bg-gradient-to-b from-[#16161D] via-[#101015] to-black">
                <div className="w-full max-w-[330px] rounded-3xl bg-white/[0.05] border border-white/15 p-5 space-y-4 shadow-2xl">
                  <div className="mx-auto w-14 h-14 rounded-2xl bg-[#FE2C55]/15 border border-[#FE2C55]/35 flex items-center justify-center text-[#FE2C55]">
                    <Lock className="w-6 h-6" />
                  </div>

                  <div className="space-y-1.5">
                    <h2 className="text-lg font-extrabold text-white text-balance">
                      Transmisje LIVE od {LIVE_MIN_FOLLOWERS} obserwujących
                    </h2>
                    <p className="text-xs text-zinc-300 leading-relaxed text-balance">
                      Nadawanie własnej transmisji na żywo jest dostępne dopiero po zdobyciu co najmniej{' '}
                      <span className="font-bold text-white">{LIVE_MIN_FOLLOWERS}</span>{' '}
                      obserwujących.
                    </p>
                  </div>

                  <div className="rounded-2xl bg-black/45 border border-white/10 p-3.5 space-y-2 text-left">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-300 font-semibold flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-[#25F4EE]" />
                        <span>{t('followersCountLabel')}</span>
                      </span>
                      <span className="font-mono tabular-nums font-extrabold text-white">
                        {followersCount} / {LIVE_MIN_FOLLOWERS}
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        style={{ width: `${liveFollowerProgressPct}%` }}
                        className="h-full rounded-full bg-gradient-to-r from-[#FE2C55] to-[#25F4EE] transition-all duration-300"
                      />
                    </div>

                    <p className="text-[11px] text-zinc-400">
                      {!isSignedIn
                        ? 'Zaloguj się, aby sprawdzić liczbę obserwujących na koncie.'
                        : `Brakuje jeszcze ${missingLiveFollowers} obserwujących do odblokowania LIVE.`}
                    </p>
                  </div>

                  {!isSignedIn ? (
                    <button
                      type="button"
                      onClick={onSignIn}
                      className="w-full min-h-[48px] rounded-full bg-[#25F4EE] text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <LogIn className="w-4 h-4" />
                      <span>{t('signInGoogle')}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setBottomTab('aparat')}
                      className="w-full min-h-[48px] rounded-full bg-[#FE2C55] hover:bg-[#e6254b] text-white font-extrabold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Video className="w-4 h-4" />
                      <span>Nagraj film i zdobądź obserwujących</span>
                    </button>
                  )}
                </div>
              </div>
            ) : cameraError ? (
              <div className="w-full h-full flex flex-col items-center justify-center px-8 pb-28 text-center space-y-4 bg-gradient-to-b from-zinc-800/90 via-zinc-900 to-black">
                <Video className="w-11 h-11 text-white/50" />
                <p className="text-xs text-white/80 leading-relaxed max-w-[250px]">
                  {cameraError}
                </p>
                {bottomTab !== 'live' && (
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="min-h-[44px] px-5 rounded-full bg-white text-black text-xs font-bold cursor-pointer"
                  >
                    Wgraj wideo z galerii
                  </button>
                )}
              </div>
            ) : (
              /* Uncropped 30fps Live Camera Feed with 0.5x–10x Optical/GPU Zoom */
              <>
                <video
                  ref={liveVideoRef}
                  muted
                  playsInline
                  autoPlay
                  style={{
                    ...(combinedCssFilter ? { filter: combinedCssFilter } : {}),
                    transform: cameraPreviewTransform,
                    transformOrigin: 'center center',
                  }}
                  className="w-full h-full object-contain bg-black transition-transform duration-75"
                />

                {flashEnabled && facingMode === 'user' && isRecording && (
                  <div
                    className="pointer-events-none absolute inset-0 border-[18px] border-white/85 rounded-[28px]"
                    aria-hidden="true"
                  />
                )}
              </>
            )}

            {/* Framing Grid Overlay */}
            {gridEnabled && bottomTab === 'aparat' && (
              <div
                className="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-2"
                aria-hidden="true"
              >
                <div className="border-r border-b border-white/35" />
                <div className="border-b border-white/35" />
                <div className="border-r border-white/35" />
                <div />
              </div>
            )}

            {/* Big Countdown Overlay */}
            {countdownRemaining !== null && (
              <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/25">
                <span className="text-8xl font-extrabold font-mono tabular-nums text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)] animate-ping">
                  {countdownRemaining}
                </span>
              </div>
            )}

            {/* Top & Bottom Legibility Vignettes */}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/45 to-transparent"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/75 via-black/25 to-transparent"
              aria-hidden="true"
            />

            {/* TOP-LEFT CLOSE (X) BUTTON */}
            <button
              type="button"
              onClick={() => {
                stopCameraStream();
                onClose();
              }}
              aria-label="Zamknij aparat"
              className="absolute top-3.5 left-3 z-30 min-h-[44px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md active:scale-90 transition-transform cursor-pointer"
            >
              <X className="w-7 h-7 stroke-[2.2]" />
            </button>

            {/* TOP-CENTER: "♪ Dodaj dźwięk" OR Recording Timer */}
            <div className="absolute top-3.5 inset-x-16 z-30 flex justify-center pointer-events-none">
              {bottomTab === 'live' ? (
                <div className="rounded-full bg-[#FE2C55] px-4 py-1.5 flex items-center gap-1.5 text-xs font-extrabold tracking-wide uppercase text-white shadow-lg">
                  <Radio className="w-3.5 h-3.5" />
                  <span>STUDIO LIVE</span>
                </div>
              ) : isRecording ? (
                <div className="pointer-events-auto rounded-full bg-[#FE2C55]/90 backdrop-blur-md px-4 py-2 flex items-center gap-2 text-sm font-bold font-mono tabular-nums text-white shadow-lg">
                  <span className="w-2 h-2 rounded-full bg-white" />
                  <span>
                    {String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:
                    {String(recordSeconds % 60).padStart(2, '0')}
                  </span>
                </div>
              ) : (
                <div className="pointer-events-auto min-h-[42px] max-w-full rounded-full bg-black/45 hover:bg-black/65 backdrop-blur-md px-3.5 py-2 flex items-center gap-2 text-[14px] font-bold text-white shadow-md transition-colors">
                  <button
                    type="button"
                    onClick={() => setIsMusicPickerOpen(true)}
                    className="flex items-center gap-2 min-w-0 cursor-pointer"
                  >
                    <Music className="w-4 h-4 fill-white shrink-0" />
                    <span className="truncate max-w-[155px]">
                      {selectedTrack ? selectedTrack.title : t('addSound')}
                    </span>
                  </button>
                  {selectedTrack && (
                    <>
                      <span className="w-px h-3.5 bg-white/35 shrink-0" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => handleTrackChosen(null)}
                        aria-label="Usuń dźwięk"
                        className="p-0.5 text-white/85 hover:text-white cursor-pointer shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* TOP-RIGHT VERTICAL CAMERA TOOLS RAIL */}
            {(bottomTab === 'aparat' || (bottomTab === 'live' && canGoLive)) &&
              !isRecording && (
                <div className="absolute top-3.5 right-2.5 z-30 flex flex-col items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      const next = facingMode === 'environment' ? 'user' : 'environment';
                      setFacingMode(next);
                      setCameraZoom(DEFAULT_CAMERA_ZOOM);
                      showQuickHint(next === 'user' ? 'Przedni aparat' : 'Tylny aparat');
                    }}
                    aria-label="Obróć aparat"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md active:scale-90 transition-transform cursor-pointer"
                  >
                    <RefreshCw className="w-6 h-6 stroke-[2.1]" />
                  </button>

                  {bottomTab === 'aparat' && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setFlashEnabled((f) => {
                            const next = !f;
                            showQuickHint(
                              next ? 'Lampa błyskowa: WŁ.' : 'Lampa błyskowa: WYŁ.'
                            );
                            return next;
                          });
                        }}
                        aria-label="Lampa błyskowa"
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md active:scale-90 transition-transform cursor-pointer"
                      >
                        {flashEnabled ? (
                          <Zap className="w-6 h-6 stroke-[2.1] fill-amber-300 text-amber-300" />
                        ) : (
                          <ZapOff className="w-6 h-6 stroke-[2.1]" />
                        )}
                      </button>

                      <div className="w-5 h-px bg-white/30 my-0.5" aria-hidden="true" />

                      {/* Quick 0.5x <-> 1x Wide Angle Shortcut */}
                      <button
                        type="button"
                        onClick={handleToggleWideZoomShortcut}
                        aria-label="Kąt widzenia obiektywu"
                        className="min-h-[40px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md active:scale-90 transition-transform cursor-pointer"
                      >
                        <span className="rounded-full bg-black/45 border border-white/30 px-2 py-0.5 text-[11px] font-extrabold font-mono tabular-nums">
                          {formatZoomLabel(cameraZoom)}
                        </span>
                      </button>

                    <button
                      type="button"
                      onClick={() => {
                        const next: 0 | 3 | 10 =
                          countdownSetting === 0 ? 3 : countdownSetting === 3 ? 10 : 0;
                        setCountdownSetting(next);
                        showQuickHint(
                          next === 0 ? 'Odliczanie: WYŁ.' : `Odliczanie: ${next} s`
                        );
                      }}
                      aria-label="Minutnik odliczania"
                      className="relative min-h-[44px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md active:scale-90 transition-transform cursor-pointer"
                    >
                      <Timer className="w-6 h-6 stroke-[2.1]" />
                      {countdownSetting > 0 && (
                        <span className="absolute -bottom-0.5 right-0.5 rounded-full bg-[#FE2C55] px-1.5 text-[9px] font-extrabold font-mono text-white">
                          {countdownSetting}s
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setGridEnabled((g) => {
                          const next = !g;
                          showQuickHint(next ? 'Siatka kadru: WŁ.' : 'Siatka kadru: WYŁ.');
                          return next;
                        });
                      }}
                      aria-label="Siatka kadrowania"
                      className={`min-h-[44px] min-w-[44px] flex items-center justify-center drop-shadow-md active:scale-90 transition-transform cursor-pointer ${
                        gridEnabled ? 'text-[#25F4EE]' : 'text-white'
                      }`}
                    >
                      <LayoutGrid className="w-6 h-6 stroke-[2.1]" />
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setRetouchEnabled((r) => {
                      const next = !r;
                      showQuickHint(next ? 'Upiększanie: WŁ.' : 'Upiększanie: WYŁ.');
                      return next;
                    });
                  }}
                  aria-label="Retusz obrazu"
                  className="relative min-h-[44px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md active:scale-90 transition-transform cursor-pointer"
                >
                  <Sparkles className="w-6 h-6 stroke-[2.1]" />
                  {retouchEnabled && (
                    <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-[#FE2C55] flex items-center justify-center shadow">
                      <Check className="w-2.5 h-2.5 text-white stroke-[3.5]" />
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const nextIdx = (activeFilterIndex + 1) % VIDEO_COLOR_FILTERS.length;
                    setActiveFilterIndex(nextIdx);
                    showQuickHint(`Filtr: ${VIDEO_COLOR_FILTERS[nextIdx].name}`);
                  }}
                  aria-label="Filtry kolorów"
                  className="relative min-h-[44px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md active:scale-90 transition-transform cursor-pointer"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="w-6 h-6"
                  >
                    <circle cx="12" cy="8.5" r="5" />
                    <circle cx="8.5" cy="14.5" r="5" />
                    <circle cx="15.5" cy="14.5" r="5" />
                  </svg>
                  {activeFilterIndex > 0 && (
                    <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-[#FE2C55] flex items-center justify-center shadow">
                      <Check className="w-2.5 h-2.5 text-white stroke-[3.5]" />
                    </span>
                  )}
                </button>

                {bottomTab === 'aparat' && toolsExpanded && (
                  <button
                    type="button"
                    onClick={() => {
                      setMirrorEnabled((m) => {
                        const next = !m;
                        showQuickHint(
                          next ? 'Lustrzane odbicie: WŁ.' : 'Lustrzane odbicie: WYŁ.'
                        );
                        return next;
                      });
                    }}
                    aria-label="Lustrzane odbicie"
                    className={`min-h-[44px] min-w-[44px] flex items-center justify-center drop-shadow-md active:scale-90 transition-transform cursor-pointer ${
                      mirrorEnabled ? 'text-[#25F4EE]' : 'text-white'
                    }`}
                  >
                    <FlipHorizontal2 className="w-6 h-6 stroke-[2.1]" />
                  </button>
                )}

                {bottomTab === 'aparat' && (
                  <button
                    type="button"
                    onClick={() => setToolsExpanded((e) => !e)}
                    aria-label={toolsExpanded ? 'Zwiń narzędzia' : 'Więcej narzędzi'}
                    className="min-h-[40px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md cursor-pointer"
                  >
                    {toolsExpanded ? (
                      <ChevronUp className="w-6 h-6 stroke-[2.3]" />
                    ) : (
                      <ChevronDown className="w-6 h-6 stroke-[2.3]" />
                    )}
                  </button>
                )}
              </div>
            )}

            {/* TIKTOK LIVE BROADCAST CARD & START CTA INSIDE '+' CAMERA (ONLY >= 500 FOLLOWERS) */}
            {bottomTab === 'live' && canGoLive && (
              <div className="absolute inset-x-4 bottom-5 z-30 space-y-3">
                {!cameraError && (
                  <CameraZoomBar zoom={cameraZoom} onChangeZoom={setCameraZoom} />
                )}

                <div className="rounded-2xl bg-black/55 backdrop-blur-md border border-white/15 p-3.5 flex items-center gap-3">
                  <UserAvatar
                    src={profile?.avatarUrl}
                    name={profile?.displayName || 'S'}
                    color={profile?.avatarColor || '#FE2C55'}
                    className="w-11 h-11 shrink-0"
                    textClassName="text-sm"
                  />
                  <div className="flex-1 min-w-0">
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-[#25F4EE]">
                      Tytuł transmisji na żywo
                    </label>
                    <input
                      type="text"
                      value={liveDraftTitle}
                      onChange={(e) => setLiveDraftTitle(e.target.value)}
                      maxLength={80}
                      placeholder="Dodaj tytuł transmisji LIVE..."
                      className="w-full bg-transparent text-sm font-bold text-white placeholder:text-white/60 focus:outline-none mt-0.5"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={Boolean(cameraError)}
                  onClick={handleLaunchLiveFromCamera}
                  className="w-full min-h-[54px] rounded-full bg-[#FE2C55] hover:bg-[#e6254b] disabled:opacity-45 active:scale-[0.98] transition-all text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-[0_6px_28px_rgba(254,44,85,0.5)] cursor-pointer"
                >
                  <Radio className="w-5 h-5" />
                  <span>{t('startLiveStream')}</span>
                </button>
              </div>
            )}

            {/* LOWER VIEWFINDER CONTROLS: ZOOM (0.5x–10x) + DURATION SELECTOR + SHUTTER + FILTER BUBBLES */}
            {bottomTab === 'aparat' && (
              <div className="absolute inset-x-0 bottom-4 z-30 flex flex-col items-center gap-3">
                {captureMode !== 'text' && !cameraError && (
                  <CameraZoomBar
                    zoom={cameraZoom}
                    onChangeZoom={setCameraZoom}
                    compact={isRecording}
                  />
                )}

                {!isRecording && (
                  <div className="flex items-center justify-center gap-3 sm:gap-4 px-4 overflow-x-auto no-scrollbar max-w-full">
                    {(
                      [
                        { id: '10m', label: '10 min' },
                        { id: '60s', label: '60 s' },
                        { id: '15s', label: '15 s' },
                        { id: 'photo', label: t('photoMode') },
                        { id: 'text', label: t('textMode') },
                      ] as const
                    ).map((item) => {
                      const active = captureMode === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setCaptureMode(item.id)}
                          className={`min-h-[34px] px-3.5 rounded-full text-[13px] font-bold tracking-tight whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                            active
                              ? 'bg-white text-black shadow-md'
                              : 'text-white/90 hover:text-white drop-shadow'
                          }`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="relative w-full flex items-center justify-center h-[86px]">
                  <button
                    type="button"
                    onClick={handleShutterPress}
                    disabled={isGeneratingClip}
                    aria-label={isRecording ? 'Zatrzymaj nagrywanie' : 'Nagraj'}
                    className="relative z-10 w-[82px] h-[82px] rounded-full border-[4.5px] border-white flex items-center justify-center shadow-[0_4px_24px_rgba(0,0,0,0.45)] active:scale-95 transition-transform cursor-pointer"
                  >
                    <span
                      className={`transition-all duration-150 ${
                        isRecording
                          ? 'w-8 h-8 rounded-lg bg-[#FE2C55]'
                          : captureMode === 'photo'
                            ? 'w-[66px] h-[66px] rounded-full bg-white'
                            : 'w-[66px] h-[66px] rounded-full bg-[#FE2C55]'
                      }`}
                    />
                  </button>

                  {!isRecording && (
                    <div className="absolute left-[calc(50%+54px)] right-0 flex items-center gap-3 overflow-x-auto no-scrollbar pr-4">
                      {VIDEO_COLOR_FILTERS.slice(1).map((preset, idx) => {
                        const realIdx = idx + 1;
                        const isSelected = activeFilterIndex === realIdx;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => {
                              const next = isSelected ? 0 : realIdx;
                              setActiveFilterIndex(next);
                              showQuickHint(`Filtr: ${VIDEO_COLOR_FILTERS[next].name}`);
                            }}
                            aria-label={`Filtr ${preset.name}`}
                            className={`w-[54px] h-[54px] rounded-full shrink-0 p-0.5 transition-transform active:scale-95 cursor-pointer ${
                              isSelected
                                ? 'border-2 border-white scale-105'
                                : 'border border-white/55 opacity-90'
                            }`}
                          >
                            <span
                              className={`w-full h-full rounded-full bg-gradient-to-br ${preset.previewGradient} flex items-center justify-center text-[10px] font-bold text-white shadow-inner`}
                            >
                              {preset.name.slice(0, 4)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* BOTTOM SOLID BLACK BAR: [Gallery Square]  ---  APARAT | STWÓRZ | LIVE */}
          <div className="h-[72px] w-full bg-black px-5 flex items-center justify-between shrink-0 relative">
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              aria-label="Wybierz film z galerii urządzenia"
              className="w-11 h-11 rounded-xl border-2 border-white/85 bg-zinc-900 hover:bg-zinc-800 overflow-hidden flex flex-col items-center justify-center text-white shadow active:scale-95 transition-transform cursor-pointer shrink-0"
            >
              <ImageIcon className="w-5 h-5 text-white/90" />
            </button>

            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-5">
              <button
                type="button"
                onClick={() => setBottomTab('aparat')}
                className={`min-h-[44px] text-[14px] font-extrabold tracking-wide uppercase transition-colors whitespace-nowrap cursor-pointer relative flex items-center ${
                  bottomTab === 'aparat' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span>{t('cameraTab')}</span>
                {bottomTab === 'aparat' && (
                  <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-white" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setBottomTab('stworz')}
                className={`min-h-[44px] text-[14px] font-extrabold tracking-wide uppercase transition-colors whitespace-nowrap cursor-pointer relative flex items-center ${
                  bottomTab === 'stworz' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span>{t('createTab')}</span>
                {bottomTab === 'stworz' && (
                  <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-white" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFacingMode('user');
                  setBottomTab('live');
                }}
                className={`min-h-[44px] text-[14px] font-extrabold tracking-wide uppercase flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer relative ${
                  bottomTab === 'live'
                    ? 'text-[#FE2C55]'
                    : 'text-[#FE2C55]/80 hover:text-[#FE2C55]'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span>LIVE</span>
                {bottomTab === 'live' && (
                  <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-[#FE2C55]" />
                )}
              </button>
            </div>

            <div className="w-11 shrink-0" aria-hidden="true" />
          </div>
        </div>
      ) : step === 'preview' ? (
        /* =====================================================================
           STEP 2: 1:1 TIKTOK POST-RECORDING PREVIEW SCREEN
           Matches user's screenshot: [<] [♪ Song ... | ×] [Right Rail] [✦ AutoCut]
           Bottom bar: [Avatar Story 24h]   [Dalej]
           ===================================================================== */
        <div className="w-full h-dvh sm:max-w-[440px] bg-black flex flex-col overflow-hidden relative">
          {toolToast && (
            <div className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 z-40 rounded-full bg-black/75 backdrop-blur-md px-4 py-1.5 text-xs font-semibold text-white whitespace-nowrap">
              {toolToast}
            </div>
          )}

          {/* ROUNDED RECORDED VIDEO STAGE */}
          <div
            onClick={() => {
              if (previewSheet !== 'none') setPreviewSheet('none');
            }}
            className="relative flex-1 w-full rounded-[28px] overflow-hidden bg-[#141418]"
          >
            {(previewUrl || externalUrl) && (
              <video
                ref={previewVideoRef}
                src={previewUrl || externalUrl}
                autoPlay
                loop
                playsInline
                muted={originalVolume === 0}
                onPlay={() => {
                  if (selectedTrack?.audioUrl && !isMusicPickerOpen) {
                    void previewAudioRef.current?.play().catch(() => {});
                  }
                }}
                style={previewFilterCss ? { filter: previewFilterCss } : undefined}
                className={`w-full h-full ${
                  previewFitContain ? 'object-contain' : 'object-cover'
                } bg-black`}
              />
            )}

            {/* Subtle Top & Bottom Contrast Scrims */}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/45 to-transparent"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/55 to-transparent"
              aria-hidden="true"
            />

            {/* Placed Text / Sticker Overlays on Video */}
            {(overlayText.trim() || selectedSticker) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewSheet('text');
                }}
                className="absolute top-[24%] left-1/2 -translate-x-1/2 z-20 max-w-[82%] rounded-2xl bg-black/65 backdrop-blur-md border border-white/15 px-4 py-2 text-center shadow-lg cursor-pointer"
              >
                {selectedSticker && (
                  <span className="block text-3xl mb-1 leading-none">{selectedSticker}</span>
                )}
                {overlayText.trim() && (
                  <span className="block text-base font-extrabold text-white break-words">
                    {overlayText}
                  </span>
                )}
              </button>
            )}

            {/* TOP-LEFT BACK CHEVRON (<) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                previewAudioRef.current?.pause();
                setStep('capture');
              }}
              aria-label="Wróć do aparatu"
              className="absolute top-3.5 left-3 z-30 min-h-[44px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md active:scale-90 transition-transform cursor-pointer"
            >
              <ChevronLeft className="w-8 h-8 stroke-[2.2]" />
            </button>

            {/* TOP-CENTER MUSIC CAPSULE: [ ♪ Song Title ... | × ] */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute top-3.5 inset-x-16 z-30 flex justify-center pointer-events-none"
            >
              <div className="pointer-events-auto min-h-[44px] max-w-[235px] rounded-full bg-black/45 hover:bg-black/60 backdrop-blur-md px-4 py-2 flex items-center gap-2.5 text-[15px] font-bold text-white shadow-lg transition-colors">
                <button
                  type="button"
                  onClick={() => setIsMusicPickerOpen(true)}
                  className="flex items-center gap-2 min-w-0 cursor-pointer"
                >
                  <Music className="w-4 h-4 fill-white shrink-0" />
                  <span className="truncate max-w-[145px]">
                    {selectedTrack ? selectedTrack.title : t('addSound')}
                  </span>
                </button>
                {selectedTrack && (
                  <>
                    <span className="w-px h-4 bg-white/35 shrink-0" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => handleTrackChosen(null)}
                      aria-label="Usuń wybrany dźwięk"
                      className="p-0.5 text-white/90 hover:text-white cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4 stroke-[2.4]" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* RIGHT-SIDE VERTICAL PREVIEW TOOL RAIL (Exact Icons from Screenshot) */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute top-3.5 right-2.5 z-30 flex flex-col items-center gap-2"
            >
              {/* 1. Settings Gear */}
              <button
                type="button"
                onClick={() =>
                  setPreviewSheet((s) => (s === 'settings' ? 'none' : 'settings'))
                }
                aria-label="Ustawienia prywatności"
                className="min-h-[42px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md active:scale-90 transition-transform cursor-pointer"
              >
                <Settings className="w-6 h-6 stroke-[2]" />
              </button>

              <div className="w-5 h-px bg-white/35 my-0.5" aria-hidden="true" />

              {/* 2. Canvas Fit/Fill Phone Frame Icon */}
              <button
                type="button"
                onClick={() => {
                  setPreviewFitContain((f) => {
                    const next = !f;
                    showQuickHint(next ? 'Dopasowano cały kadr' : 'Wypełniono ekran');
                    return next;
                  });
                }}
                aria-label="Dopasowanie kadru"
                className={`min-h-[42px] min-w-[44px] flex items-center justify-center drop-shadow-md active:scale-90 transition-transform cursor-pointer ${
                  previewFitContain ? 'text-[#25F4EE]' : 'text-white'
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-6 h-6"
                >
                  <rect x="3" y="6" width="18" height="12" rx="2.5" />
                  <path d="M6.5 10.5L5 12l1.5 1.5" />
                  <path d="M17.5 10.5L19 12l-1.5 1.5" />
                </svg>
              </button>

              {/* 3. Studio Clips / Playback Speed Icon */}
              <button
                type="button"
                onClick={() => {
                  const nextSpeed: 1 | 1.25 | 0.75 =
                    previewPlaybackRate === 1
                      ? 1.25
                      : previewPlaybackRate === 1.25
                        ? 0.75
                        : 1;
                  setPreviewPlaybackRate(nextSpeed);
                  showQuickHint(`Tempo klipu: ${nextSpeed}x`);
                }}
                aria-label="Edycja klipu i tempo"
                className="relative min-h-[42px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md active:scale-90 transition-transform cursor-pointer"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-6 h-6"
                >
                  <rect
                    x="4"
                    y="6"
                    width="13"
                    height="13"
                    rx="3"
                    transform="rotate(-8 10.5 12.5)"
                  />
                  <polygon points="9.5,10 13.5,12.5 9.5,15" fill="currentColor" stroke="none" />
                  <path d="M18 7.5l2 10.5-3 1" />
                </svg>
                {previewPlaybackRate !== 1 && (
                  <span className="absolute -bottom-0.5 right-0 rounded-full bg-[#FE2C55] px-1 text-[9px] font-extrabold font-mono">
                    {previewPlaybackRate}x
                  </span>
                )}
              </button>

              {/* 4. Aa Text Overlay Button */}
              <button
                type="button"
                onClick={() => setPreviewSheet((s) => (s === 'text' ? 'none' : 'text'))}
                aria-label="Dodaj tekst na filmie"
                className={`min-h-[42px] min-w-[44px] flex items-center justify-center drop-shadow-md active:scale-90 transition-transform cursor-pointer ${
                  overlayText.trim() ? 'text-[#25F4EE]' : 'text-white'
                }`}
              >
                <span className="text-[20px] font-extrabold tracking-tight leading-none">
                  Aa
                </span>
              </button>

              {/* 5. Sticker Peel Icon */}
              <button
                type="button"
                onClick={() =>
                  setPreviewSheet((s) => (s === 'stickers' ? 'none' : 'stickers'))
                }
                aria-label="Naklejki"
                className={`min-h-[42px] min-w-[44px] flex items-center justify-center drop-shadow-md active:scale-90 transition-transform cursor-pointer ${
                  selectedSticker ? 'text-[#25F4EE]' : 'text-white'
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-6 h-6"
                >
                  <path d="M5 4h14a2 2 0 0 1 2 2v9l-6 6H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
                  <path d="M15 21v-4a2 2 0 0 1 2-2h4" />
                  <circle cx="9.5" cy="10" r="1" fill="currentColor" />
                  <circle cx="14.5" cy="10" r="1" fill="currentColor" />
                </svg>
              </button>

              {previewToolsExpanded && (
                <>
                  {/* 6. Sparkles Effects Panel Trigger */}
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewSheet((s) => (s === 'filters' ? 'none' : 'filters'))
                    }
                    aria-label={t('effects')}
                    className={`min-h-[42px] min-w-[44px] flex items-center justify-center drop-shadow-md active:scale-90 transition-transform cursor-pointer ${
                      postFilterId !== 'normal' ? 'text-[#25F4EE]' : 'text-white'
                    }`}
                  >
                    <Sparkles className="w-6 h-6 stroke-[2]" />
                  </button>

                  {/* 7. Interlocking 3-Circles Color Filters Trigger */}
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewSheet((s) => (s === 'filters' ? 'none' : 'filters'))
                    }
                    aria-label={t('filters')}
                    className="relative min-h-[42px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md active:scale-90 transition-transform cursor-pointer"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="w-6 h-6"
                    >
                      <circle cx="12" cy="8.5" r="5" />
                      <circle cx="8.5" cy="14.5" r="5" />
                      <circle cx="15.5" cy="14.5" r="5" />
                    </svg>
                    {postFilterId !== 'normal' && (
                      <span className="absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full bg-[#FE2C55] flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-white stroke-[3.5]" />
                      </span>
                    )}
                  </button>

                  {/* 8. Microphone + Audio Mixer Trigger */}
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewSheet((s) => (s === 'audio' ? 'none' : 'audio'))
                    }
                    aria-label={t('audioMixer')}
                    className="min-h-[42px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md active:scale-90 transition-transform cursor-pointer"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-6 h-6"
                    >
                      <rect x="9" y="3" width="6" height="11" rx="3" />
                      <path d="M5 11a7 7 0 0 0 14 0" />
                      <line x1="12" y1="18" x2="12" y2="21" />
                    </svg>
                  </button>
                </>
              )}

              {/* 9. Collapse / Expand Chevron */}
              <button
                type="button"
                onClick={() => setPreviewToolsExpanded((e) => !e)}
                aria-label={previewToolsExpanded ? 'Zwiń ikony' : 'Rozwiń ikony'}
                className="min-h-[38px] min-w-[44px] flex items-center justify-center text-white drop-shadow-md cursor-pointer"
              >
                {previewToolsExpanded ? (
                  <ChevronDown className="w-6 h-6 stroke-[2.3]" />
                ) : (
                  <ChevronUp className="w-6 h-6 stroke-[2.3]" />
                )}
              </button>
            </div>

            {/* BOTTOM-CENTER [ ✦ AutoCut ] PILL */}
            {previewSheet === 'none' && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleAutoCut();
                  }}
                  className={`min-h-[38px] px-4 rounded-full backdrop-blur-md flex items-center gap-1.5 text-[13px] font-semibold shadow-lg transition-all active:scale-95 cursor-pointer ${
                    autoCutActive
                      ? 'bg-white text-black'
                      : 'bg-black/50 hover:bg-black/65 text-white'
                  }`}
                >
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>AutoCut</span>
                </button>
              </div>
            )}

            {/* SLIDE-UP INTERACTIVE TOOL DRAWERS ON PREVIEW STAGE */}
            {previewSheet !== 'none' && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-x-3 bottom-3 z-40 rounded-3xl bg-black/80 backdrop-blur-xl border border-white/15 p-4 space-y-3 shadow-2xl"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-white">
                    {previewSheet === 'filters'
                      ? `${t('effects')} · ${selectedPostFilter.name}`
                      : previewSheet === 'text'
                        ? 'Napis na filmie (Aa)'
                        : previewSheet === 'stickers'
                          ? 'Wybierz naklejkę na film'
                          : previewSheet === 'audio'
                            ? t('audioMixer')
                            : 'Ustawienia klipu'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPreviewSheet('none')}
                    className="min-h-[32px] px-3 rounded-full bg-white/15 text-xs font-bold text-white cursor-pointer"
                  >
                    Gotowe
                  </button>
                </div>

                {previewSheet === 'filters' && (
                  <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar py-1">
                    {VIDEO_COLOR_FILTERS.map((preset) => {
                      const isSelected = postFilterId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setPostFilterId(preset.id)}
                          className={`min-w-[64px] min-h-[68px] px-2 py-1.5 rounded-xl flex flex-col items-center justify-center gap-1.5 shrink-0 cursor-pointer border ${
                            isSelected
                              ? 'bg-white/[0.15] border-[#FE2C55] text-white'
                              : 'bg-white/[0.05] border-white/10 text-zinc-300'
                          }`}
                        >
                          <span
                            className={`w-8 h-8 rounded-full bg-gradient-to-br ${preset.previewGradient} flex items-center justify-center border border-white/25`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                          </span>
                          <span className="text-[11px] font-semibold whitespace-nowrap">
                            {preset.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {previewSheet === 'text' && (
                  <input
                    type="text"
                    autoFocus
                    value={overlayText}
                    onChange={(e) => setOverlayText(e.target.value)}
                    maxLength={100}
                    placeholder="Wpisz tekst widoczny na wideo..."
                    className="w-full min-h-[44px] rounded-xl bg-white/10 border border-white/15 px-3.5 text-sm text-white placeholder:text-zinc-400 focus:outline-none focus:border-[#25F4EE]"
                  />
                )}

                {previewSheet === 'stickers' && (
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                    <button
                      type="button"
                      onClick={() => setSelectedSticker('')}
                      className={`min-h-[44px] px-3 rounded-xl text-xs font-bold shrink-0 cursor-pointer ${
                        !selectedSticker ? 'bg-white text-black' : 'bg-white/10 text-white'
                      }`}
                    >
                      Brak
                    </button>
                    {QUICK_STICKERS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setSelectedSticker(emoji)}
                        className={`min-h-[44px] min-w-[44px] rounded-xl text-xl flex items-center justify-center shrink-0 cursor-pointer ${
                          selectedSticker === emoji
                            ? 'bg-[#FE2C55] scale-105'
                            : 'bg-white/10 hover:bg-white/20'
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                {previewSheet === 'audio' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-zinc-200">
                        <span className="flex items-center gap-1.5 font-semibold">
                          <Volume2 className="w-3.5 h-3.5 text-[#25F4EE]" />
                          Dźwięk z mikrofonu
                        </span>
                        <span className="font-mono tabular-nums font-bold">
                          {originalVolume}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={originalVolume}
                        onChange={(e) => setOriginalVolume(Number(e.target.value))}
                        className="w-full accent-[#25F4EE] cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-zinc-200">
                        <span className="flex items-center gap-1.5 font-semibold">
                          <Music className="w-3.5 h-3.5 text-[#FE2C55]" />
                          Muzyka z internetu
                        </span>
                        <span className="font-mono tabular-nums font-bold">
                          {selectedTrack ? `${musicVolume}%` : 'Brak utworu'}
                        </span>
                      </div>
                      {selectedTrack ? (
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={musicVolume}
                          onChange={(e) => setMusicVolume(Number(e.target.value))}
                          className="w-full accent-[#FE2C55] cursor-pointer"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setPreviewSheet('none');
                            setIsMusicPickerOpen(true);
                          }}
                          className="w-full min-h-[38px] rounded-xl bg-[#FE2C55] text-xs font-bold text-white cursor-pointer"
                        >
                          {t('addSound')}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {previewSheet === 'settings' && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setVisibility('public')}
                      className={`min-h-[42px] rounded-xl text-xs font-bold cursor-pointer ${
                        visibility === 'public'
                          ? 'bg-white text-black'
                          : 'bg-white/10 text-zinc-300'
                      }`}
                    >
                      {t('everyone')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibility('private')}
                      className={`min-h-[42px] rounded-xl text-xs font-bold cursor-pointer ${
                        visibility === 'private'
                          ? 'bg-white text-black'
                          : 'bg-white/10 text-zinc-300'
                      }`}
                    >
                      {t('onlyMe')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* BOTTOM SOLID BLACK ACTION BAR: [ (Avatar) Story 24h ]   [ Dalej ] */}
          <div className="h-[78px] w-full bg-black px-3.5 flex items-center gap-3 shrink-0">
            <button
              type="button"
              disabled={isPublishing}
              onClick={() => void handleQuickPublishStory()}
              className="flex-1 h-[52px] rounded-full bg-white hover:bg-zinc-100 disabled:opacity-60 active:scale-[0.98] transition-all px-3 flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <span className="p-[2px] rounded-full bg-gradient-to-tr from-[#25F4EE] via-[#10B981] to-[#25F4EE] shrink-0">
                <UserAvatar
                  src={profile?.avatarUrl}
                  name={profile?.displayName ?? 'S'}
                  color={profile?.avatarColor ?? '#FE2C55'}
                  className="w-7 h-7 border border-white"
                  textClassName="text-[11px]"
                />
              </span>
              <span className="text-[15px] font-extrabold tracking-tight text-slate-950 whitespace-nowrap">
                {t('story')}
              </span>
              <span className="rounded-md bg-[#E0FBF9] px-1.5 py-0.5 text-[11px] font-extrabold text-[#0CA6A0] leading-none shrink-0">
                24h
              </span>
            </button>

            <button
              type="button"
              disabled={isPublishing}
              onClick={() => setStep('details')}
              className="flex-1 h-[52px] rounded-full bg-[#FE2C55] hover:bg-[#e6254b] disabled:opacity-60 active:scale-[0.98] transition-all px-4 flex items-center justify-center text-[15px] font-extrabold text-white cursor-pointer shadow-md whitespace-nowrap"
            >
              {t('next')}
            </button>
          </div>
        </div>
      ) : (
        /* =====================================================================
           STEP 3: FINAL PUBLISH SCREEN (CAPTION, #HASHTAGS, COVER & OPUBLIKUJ)
           ===================================================================== */
        <div className="w-full h-dvh sm:h-auto sm:max-h-[94dvh] sm:max-w-3xl sm:rounded-3xl bg-[#121216] border border-white/10 flex flex-col overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
            <button
              type="button"
              onClick={() => setStep('preview')}
              className="min-h-[44px] px-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-300 hover:text-white cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>{t('back')}</span>
            </button>
            <h2 className="text-sm font-bold text-white">{t('publish')}</h2>
            <button
              type="button"
              onClick={() => {
                previewAudioRef.current?.pause();
                onClose();
              }}
              aria-label="Zamknij"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form
            onSubmit={handleSubmitPublish}
            className="flex-1 overflow-y-auto p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-12 gap-5 no-scrollbar"
          >
            {/* Left Column: Video Cover Preview + Color Filter Effects Panel */}
            <div className="sm:col-span-5 flex flex-col items-center space-y-4">
              <div className="relative w-full max-w-[200px] aspect-[9/16] rounded-2xl overflow-hidden bg-black border border-white/15 shadow-lg">
                {(previewUrl || externalUrl) && (
                  <video
                    ref={detailsVideoRef}
                    src={previewUrl || externalUrl}
                    autoPlay
                    loop
                    playsInline
                    muted={originalVolume === 0}
                    style={previewFilterCss ? { filter: previewFilterCss } : undefined}
                    className={`w-full h-full ${
                      previewFitContain ? 'object-contain' : 'object-cover'
                    }`}
                  />
                )}
                {buildCombinedOverlayText() && (
                  <div className="pointer-events-none absolute top-5 inset-x-3 flex justify-center">
                    <span className="rounded-lg bg-black/70 px-2.5 py-1 text-[11px] font-extrabold text-white text-center">
                      {buildCombinedOverlayText()}
                    </span>
                  </div>
                )}
              </div>

              {/* Color Effects Strip */}
              <div className="w-full rounded-2xl bg-white/[0.04] border border-white/10 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-[#25F4EE] shrink-0" />
                    <span>{t('effects')}</span>
                  </div>
                  {postFilterId !== 'normal' && (
                    <button
                      type="button"
                      onClick={() => setPostFilterId('normal')}
                      className="text-[11px] font-semibold text-zinc-400 hover:text-white cursor-pointer whitespace-nowrap"
                    >
                      Resetuj
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar py-1">
                  {VIDEO_COLOR_FILTERS.map((preset) => {
                    const isSelected = postFilterId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setPostFilterId(preset.id)}
                        className={`min-w-[62px] min-h-[64px] px-2 py-1.5 rounded-xl flex flex-col items-center justify-center gap-1.5 shrink-0 cursor-pointer border ${
                          isSelected
                            ? 'bg-white/[0.12] border-[#FE2C55] text-white'
                            : 'bg-black/35 border-white/10 text-zinc-400 hover:text-white'
                        }`}
                      >
                        <span
                          className={`w-7 h-7 rounded-full bg-gradient-to-br ${preset.previewGradient} flex items-center justify-center border border-white/25`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                        </span>
                        <span className="text-[11px] font-semibold whitespace-nowrap">
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right Column: Music + Caption + Hashtags + Publish */}
            <div className="sm:col-span-7 space-y-4">
              <div className="rounded-2xl bg-white/[0.05] border border-white/15 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-white">
                    <Globe className="w-4 h-4 text-[#FE2C55] shrink-0" />
                    <span>Muzyka do filmu</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep('preview')}
                    className="text-[11px] font-semibold text-[#25F4EE] hover:underline whitespace-nowrap cursor-pointer"
                  >
                    Edytuj podgląd
                  </button>
                </div>

                {selectedTrack ? (
                  <div className="p-2.5 rounded-xl bg-black/45 border border-[#FE2C55]/40 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {selectedTrack.coverUrl ? (
                        <img
                          src={selectedTrack.coverUrl}
                          alt={selectedTrack.title}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-lg object-cover shrink-0 border border-white/15"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-[#25F4EE] shrink-0">
                          <Disc3 className="w-5 h-5" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">
                          {selectedTrack.title}
                        </div>
                        <div className="text-[11px] text-zinc-400 truncate">
                          {selectedTrack.artist}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setIsMusicPickerOpen(true)}
                        className="min-h-[36px] px-3 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold text-white whitespace-nowrap cursor-pointer"
                      >
                        Zmień
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTrackChosen(null)}
                        aria-label="Usuń wybrany utwór"
                        className="min-h-[36px] min-w-[36px] rounded-lg bg-white/5 hover:bg-[#FE2C55]/30 flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsMusicPickerOpen(true)}
                    className="w-full min-h-[48px] px-4 rounded-xl bg-[#FE2C55]/15 hover:bg-[#FE2C55]/25 border border-[#FE2C55]/45 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Music className="w-4 h-4 text-[#FE2C55] shrink-0" />
                      <span className="text-xs font-bold text-white truncate">
                        {t('addSound')}
                      </span>
                    </span>
                    <span className="rounded-lg bg-[#FE2C55] px-2.5 py-1 text-[11px] font-extrabold text-white whitespace-nowrap shrink-0">
                      Szukaj
                    </span>
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  {t('captionLabel')}
                </label>
                <textarea
                  rows={3}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={280}
                  placeholder={t('captionPlaceholder')}
                  className="w-full rounded-xl bg-white/[0.05] border border-white/10 p-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#25F4EE] resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    Napis na ekranie (Aa)
                  </label>
                  <input
                    type="text"
                    value={overlayText}
                    onChange={(e) => setOverlayText(e.target.value)}
                    maxLength={100}
                    placeholder="Np. Zobaczcie do końca!"
                    className="w-full min-h-[42px] rounded-xl bg-white/[0.05] border border-white/10 px-3.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#25F4EE]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    #Hashtagi
                  </label>
                  <input
                    type="text"
                    value={hashtagsInput}
                    onChange={(e) => setHashtagsInput(e.target.value)}
                    placeholder="swappy dlaciebie"
                    className="w-full min-h-[42px] rounded-xl bg-white/[0.05] border border-white/10 px-3.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#25F4EE]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Kto może obejrzeć ten film
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibility('public')}
                    className={`min-h-[40px] rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                      visibility === 'public'
                        ? 'bg-white text-black border-white'
                        : 'bg-white/[0.03] text-zinc-400 border-white/10'
                    }`}
                  >
                    {t('everyone')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibility('private')}
                    className={`min-h-[40px] rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                      visibility === 'private'
                        ? 'bg-white text-black border-white'
                        : 'bg-white/[0.03] text-zinc-400 border-white/10'
                    }`}
                  >
                    {t('onlyMe')}
                  </button>
                </div>
              </div>

              {formError && (
                <div className="rounded-xl bg-[#FE2C55]/15 border border-[#FE2C55]/40 px-3.5 py-2.5 text-xs text-rose-200">
                  {formError}
                </div>
              )}

              <div className="pt-1">
                {!isSignedIn ? (
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="w-full min-h-[48px] rounded-xl bg-[#25F4EE] text-slate-950 font-bold text-sm flex items-center justify-center gap-2 hover:opacity-95 cursor-pointer"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>{t('signInGoogle')}</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        previewAudioRef.current?.pause();
                        setStep('capture');
                      }}
                      className="min-h-[48px] px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-bold text-white cursor-pointer whitespace-nowrap"
                    >
                      {t('reRecord')}
                    </button>
                    <button
                      type="submit"
                      disabled={isPublishing}
                      className="flex-1 min-h-[48px] rounded-xl bg-[#FE2C55] hover:bg-[#e6254b] disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <span>{isPublishing ? t('publishing') : t('publish')}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Worldwide Song & Music Picker Modal */}
      <MusicPickerModal
        isOpen={isMusicPickerOpen}
        selectedTrack={selectedTrack}
        isSignedIn={isSignedIn}
        profile={profile}
        onSelectTrack={handleTrackChosen}
        onClose={() => setIsMusicPickerOpen(false)}
      />
    </div>
  );
};
