import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  ArrowLeft,
  Check,
  Heart,
  Lock,
  LogIn,
  Mic,
  MicOff,
  Radio,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Users,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  auth,
  db,
  generateSafeId,
  sanitizeAvatarColor,
  sanitizeDisplayName,
  sanitizeHandle,
  sanitizeOptionalMediaUrl,
  sanitizeStreamTitle,
} from '../firebase';
import {
  LiveAutoStartConfig,
  LiveChatMessage,
  LiveStreamDetail,
  LiveStreamSummary,
  PublicProfile,
} from '../types';
import {
  acquireWideCameraStream,
  buildCameraPreviewTransform,
  clampCameraZoom,
  computeZoomSplit,
  DEFAULT_CAMERA_ZOOM,
  drawZoomedVideoFrameToCanvas,
  HardwareZoomCapabilities,
  LIVE_MIN_FOLLOWERS,
  readTrackZoomCapabilities,
} from '../utils/cameraZoom';
import {
  getVideoFilterCss,
  sanitizeColorFilter,
  VIDEO_COLOR_FILTERS,
  VideoFilterId,
} from '../utils/videoFilters';
import { useLanguage } from '../i18n';
import { CameraZoomBar, useCameraGestureZoom } from './CameraZoomBar';
import { UserAvatar } from './UserAvatar';
import { formatCompactCount } from './VideoCard';

interface LiveStreamViewProps {
  isSignedIn: boolean;
  profile: PublicProfile | null;
  followersCount: number;
  initialMode?: 'lobby' | 'setup';
  initialJoinStreamId?: string | null;
  autoStartConfig?: LiveAutoStartConfig | null;
  onResetInitialMode?: () => void;
  onConsumeAutoStart?: () => void;
  onClearInitialJoin?: () => void;
  onSignIn: () => void;
  onBackToFeed: () => void;
  onStreamsCountChange?: (count: number) => void;
}

interface FloatingHeart {
  id: string;
  offsetX: number;
  color: string;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function formatElapsedTime(startedAtMs: number, nowMs: number): string {
  const totalSec = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function readDocTimestampMs(raw: unknown): number {
  if (raw instanceof Timestamp) return raw.toMillis();
  if (raw && typeof raw === 'object' && 'seconds' in raw && typeof raw.seconds === 'number') {
    return raw.seconds * 1000;
  }
  return Date.now();
}

export const LiveStreamView: React.FC<LiveStreamViewProps> = ({
  isSignedIn,
  profile,
  followersCount,
  initialMode = 'lobby',
  initialJoinStreamId = null,
  autoStartConfig = null,
  onResetInitialMode,
  onConsumeAutoStart,
  onClearInitialJoin,
  onSignIn,
  onBackToFeed,
  onStreamsCountChange,
}) => {
  const { t } = useLanguage();
  const canGoLive = isSignedIn && followersCount >= LIVE_MIN_FOLLOWERS;
  const missingLiveFollowers = Math.max(0, LIVE_MIN_FOLLOWERS - followersCount);
  const liveFollowerProgressPct = Math.min(
    100,
    Math.max(0, Math.round((followersCount / LIVE_MIN_FOLLOWERS) * 100))
  );

  const [mode, setMode] = useState<'lobby' | 'setup' | 'broadcasting' | 'watching'>(
    autoStartConfig ? 'setup' : initialMode
  );
  const [wsStreams, setWsStreams] = useState<LiveStreamSummary[]>([]);
  const [firestoreStreams, setFirestoreStreams] = useState<LiveStreamSummary[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  // Broadcaster setup & studio state
  const [streamTitle, setStreamTitle] = useState(
    autoStartConfig?.title || 'Na żywo na Swappy!'
  );
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(
    autoStartConfig?.facingMode || 'user'
  );
  const [cameraZoom, setCameraZoom] = useState<number>(() =>
    clampCameraZoom(autoStartConfig?.initialZoom ?? DEFAULT_CAMERA_ZOOM)
  );
  const [hwZoomCaps, setHwZoomCaps] = useState<HardwareZoomCapabilities | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [liveFilterId, setLiveFilterId] = useState<VideoFilterId>(
    autoStartConfig?.colorFilter || 'normal'
  );
  const [showFilterBar, setShowFilterBar] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Active room state (shared by broadcasting & watching)
  const [activeRoom, setActiveRoom] = useState<LiveStreamDetail | null>(null);
  const [roomViewers, setRoomViewers] = useState(0);
  const [roomLikes, setRoomLikes] = useState(0);
  const [roomMessages, setRoomMessages] = useState<LiveChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [floatingHearts, setFloatingHearts] = useState<FloatingHeart[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Viewer playback state
  const [viewerMuted, setViewerMuted] = useState(false);
  const [hasWebRtcStream, setHasWebRtcStream] = useState(false);
  const [fallbackFrameUrl, setFallbackFrameUrl] = useState<string | null>(null);
  const [streamEndedNotice, setStreamEndedNotice] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const hostPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const viewerPeerRef = useRef<RTCPeerConnection | null>(null);
  const hostedStreamIdRef = useRef<string | null>(null);
  const autoStartedRef = useRef(false);
  const modeRef = useRef(mode);
  const activeRoomRef = useRef<LiveStreamDetail | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingHwZoomRef = useRef<number | null>(null);
  const isApplyingHwZoomRef = useRef(false);
  const liveCssScaleRef = useRef(1);

  modeRef.current = mode;
  activeRoomRef.current = activeRoom;

  const { hwZoom: desiredHwZoom, cssScale: cameraCssScale } = computeZoomSplit(
    cameraZoom,
    hwZoomCaps
  );
  liveCssScaleRef.current = cameraCssScale;
  const cameraPreviewTransform = buildCameraPreviewTransform(
    cameraCssScale,
    facingMode === 'user'
  );
  const preferUltraWideRearLens =
    facingMode === 'environment' &&
    cameraZoom < 0.85 &&
    (!hwZoomCaps || hwZoomCaps.min >= 0.98);

  // Merge live WebSocket rooms with Firestore active livestream sessions
  const streams = useMemo<LiveStreamSummary[]>(() => {
    const map = new Map<string, LiveStreamSummary>();
    for (const fsStream of firestoreStreams) {
      map.set(fsStream.id, fsStream);
    }
    for (const wsStream of wsStreams) {
      map.set(wsStream.id, wsStream);
    }
    return Array.from(map.values()).sort((a, b) => b.startedAtMs - a.startedAtMs);
  }, [wsStreams, firestoreStreams]);

  useEffect(() => {
    onStreamsCountChange?.(streams.length);
  }, [streams.length, onStreamsCountChange]);

  useEffect(() => {
    if (initialMode === 'setup') {
      setMode('setup');
      onResetInitialMode?.();
    }
  }, [initialMode, onResetInitialMode]);

  // Listen to Firestore /livestreams so active rooms sync across devices
  useEffect(() => {
    const q = query(
      collection(db, 'livestreams'),
      where('visibility', '==', 'public')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const cutoffMs = Date.now() - 3 * 60 * 60 * 1000;
        const active: LiveStreamSummary[] = snap.docs
          .filter((d) => d.data().status === 'live')
          .map((d) => {
            const data = d.data();
            const startedMs = readDocTimestampMs(data.createdAt);
            return {
              id: d.id,
              hostUid: String(data.hostId || ''),
              hostHandle: String(data.hostHandle || 'tworca'),
              hostName: String(data.hostName || 'Twórca Swappy'),
              hostAvatarColor: String(data.hostAvatarColor || '#FE2C55'),
              hostAvatarUrl:
                typeof data.hostAvatarUrl === 'string' ? data.hostAvatarUrl : '',
              title: String(data.title || 'Transmisja na żywo'),
              colorFilter: sanitizeColorFilter(String(data.colorFilter || 'normal')),
              startedAtMs: startedMs,
              likesCount: 0,
              viewersCount: 0,
              previewFrameUrl: null,
            };
          })
          .filter((s) => s.startedAtMs >= cutoffMs);
        setFirestoreStreams(active);
      },
      () => {
        // Non-fatal fallback to WS streams
      }
    );
    return () => unsub();
  }, []);

  // Live clock tick for elapsed stream duration
  useEffect(() => {
    if (mode !== 'broadcasting' && mode !== 'watching') return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [mode]);

  // Auto-scroll live chat to newest message
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [roomMessages]);

  const sendWs = useCallback((payload: Record<string, unknown>) => {
    const sock = wsRef.current;
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify(payload));
    }
  }, []);

  const markFirestoreStreamEnded = useCallback(async () => {
    const streamId = hostedStreamIdRef.current;
    if (!streamId) return;
    hostedStreamIdRef.current = null;
    if (!auth.currentUser?.uid) return;
    try {
      await deleteDoc(doc(db, 'livestreams', streamId));
    } catch {
      try {
        await updateDoc(doc(db, 'livestreams', streamId), {
          status: 'ended',
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Ignore cleanup errors
      }
    }
  }, []);

  const cleanupPeerConnections = useCallback(() => {
    for (const pc of hostPeersRef.current.values()) {
      try {
        pc.close();
      } catch {
        // Ignore
      }
    }
    hostPeersRef.current.clear();

    if (viewerPeerRef.current) {
      try {
        viewerPeerRef.current.close();
      } catch {
        // Ignore
      }
      viewerPeerRef.current = null;
    }
    setHasWebRtcStream(false);
  }, []);

  const stopLocalCamera = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setHwZoomCaps(null);
    pendingHwZoomRef.current = null;
    isApplyingHwZoomRef.current = false;
    setCameraReady(false);
  }, []);

  const spawnHeartBurst = useCallback((burstId: string, color: string) => {
    const offsetX = Math.round((Math.random() - 0.5) * 44);
    setFloatingHearts((prev) => [...prev.slice(-14), { id: burstId, offsetX, color }]);
    window.setTimeout(() => {
      setFloatingHearts((prev) => prev.filter((h) => h.id !== burstId));
    }, 1500);
  }, []);

  // Broadcaster creates RTCPeerConnection for a newly joined viewer
  const createOfferForViewer = useCallback(
    async (streamId: string, viewerClientId: string) => {
      const localStream = localStreamRef.current;
      if (!localStream) return;

      const existingPc = hostPeersRef.current.get(viewerClientId);
      if (existingPc) {
        existingPc.close();
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      hostPeersRef.current.set(viewerClientId, pc);

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendWs({
            type: 'webrtc:ice-candidate',
            streamId,
            targetClientId: viewerClientId,
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendWs({
          type: 'webrtc:offer',
          streamId,
          targetClientId: viewerClientId,
          sdp: pc.localDescription,
        });
      } catch {
        // Fallback frame relay remains active automatically
      }
    },
    [sendWs]
  );

  // Viewer handles incoming RTCPeerConnection offer from broadcaster
  const handleIncomingOffer = useCallback(
    async (streamId: string, hostClientId: string, sdp: RTCSessionDescriptionInit) => {
      if (viewerPeerRef.current) {
        viewerPeerRef.current.close();
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      viewerPeerRef.current = pc;

      pc.ontrack = (ev) => {
        const remoteStream = ev.streams?.[0];
        if (remoteStream && remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          remoteVideoRef.current.muted = viewerMuted;
          void remoteVideoRef.current
            .play()
            .then(() => setHasWebRtcStream(true))
            .catch(() => {
              if (remoteVideoRef.current) {
                remoteVideoRef.current.muted = true;
                setViewerMuted(true);
                void remoteVideoRef.current
                  .play()
                  .then(() => setHasWebRtcStream(true))
                  .catch(() => {});
              }
            });
        }
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendWs({
            type: 'webrtc:ice-candidate',
            streamId,
            targetClientId: hostClientId,
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendWs({
          type: 'webrtc:answer',
          streamId,
          targetClientId: hostClientId,
          sdp: pc.localDescription,
        });
      } catch {
        // Fallback frame relay continues seamlessly
      }
    },
    [sendWs, viewerMuted]
  );

  // Connect WebSocket to /ws/live
  useEffect(() => {
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${proto}//${window.location.host}/ws/live`);
      wsRef.current = socket;

      socket.onopen = () => {
        if (unmounted) return;
        setWsConnected(true);
      };

      socket.onmessage = (ev) => {
        if (unmounted) return;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(String(ev.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        const type = String(data.type || '');

        if (type === 'welcome' || type === 'streams:update') {
          const rawList = Array.isArray(data.streams) ? data.streams : [];
          const parsed: LiveStreamSummary[] = rawList.map((item: Record<string, unknown>) => ({
            id: String(item.id),
            hostUid: String(item.hostUid),
            hostHandle: String(item.hostHandle),
            hostName: String(item.hostName),
            hostAvatarColor: String(item.hostAvatarColor || '#FE2C55'),
            hostAvatarUrl:
              typeof item.hostAvatarUrl === 'string' ? item.hostAvatarUrl : '',
            title: String(item.title || 'Transmisja na żywo'),
            colorFilter: sanitizeColorFilter(String(item.colorFilter || 'normal')),
            startedAtMs: Number(item.startedAtMs || Date.now()),
            likesCount: Number(item.likesCount || 0),
            viewersCount: Number(item.viewersCount || 0),
            previewFrameUrl:
              typeof item.previewFrameUrl === 'string' ? item.previewFrameUrl : null,
          }));
          setWsStreams(parsed);
          return;
        }

        if (type === 'stream:started' || type === 'stream:joined') {
          const s = data.stream as Record<string, unknown>;
          if (!s) return;
          const detail: LiveStreamDetail = {
            id: String(s.id),
            hostClientId: String(s.hostClientId),
            hostUid: String(s.hostUid),
            hostHandle: String(s.hostHandle),
            hostName: String(s.hostName),
            hostAvatarColor: String(s.hostAvatarColor || '#FE2C55'),
            hostAvatarUrl:
              typeof s.hostAvatarUrl === 'string' ? s.hostAvatarUrl : '',
            title: String(s.title),
            colorFilter: sanitizeColorFilter(String(s.colorFilter || 'normal')),
            startedAtMs: Number(s.startedAtMs || Date.now()),
            likesCount: Number(s.likesCount || 0),
            viewersCount: Number(s.viewersCount || 0),
            previewFrameUrl:
              typeof s.previewFrameUrl === 'string' ? s.previewFrameUrl : null,
            recentMessages: Array.isArray(s.recentMessages)
              ? (s.recentMessages as LiveChatMessage[])
              : [],
          };
          setActiveRoom(detail);
          setRoomViewers(detail.viewersCount);
          setRoomLikes(detail.likesCount);
          setRoomMessages(detail.recentMessages);
          setLiveFilterId(detail.colorFilter);
          if (detail.previewFrameUrl) {
            setFallbackFrameUrl(detail.previewFrameUrl);
          }
          setStreamEndedNotice(false);
          return;
        }

        if (type === 'stream:viewers') {
          if (activeRoomRef.current && data.streamId === activeRoomRef.current.id) {
            setRoomViewers(Number(data.viewersCount || 0));
          }
          return;
        }

        if (type === 'stream:filter') {
          if (activeRoomRef.current && data.streamId === activeRoomRef.current.id) {
            setLiveFilterId(sanitizeColorFilter(String(data.colorFilter || 'normal')));
          }
          return;
        }

        if (type === 'stream:frame') {
          if (
            modeRef.current === 'watching' &&
            activeRoomRef.current &&
            data.streamId === activeRoomRef.current.id &&
            typeof data.frameDataUrl === 'string'
          ) {
            setFallbackFrameUrl(data.frameDataUrl);
          }
          return;
        }

        if (type === 'stream:chat') {
          if (activeRoomRef.current && data.streamId === activeRoomRef.current.id) {
            const incomingMsg = data.message as LiveChatMessage | undefined;
            if (incomingMsg && incomingMsg.id) {
              setRoomMessages((prev) =>
                prev.some((m) => m.id === incomingMsg.id)
                  ? prev
                  : [...prev.slice(-49), incomingMsg]
              );
            }
          }
          return;
        }

        if (type === 'stream:heart') {
          if (activeRoomRef.current && data.streamId === activeRoomRef.current.id) {
            setRoomLikes(Number(data.likesCount || 0));
            spawnHeartBurst(
              String(data.burstId || `${Date.now()}_${Math.random()}`),
              String(data.color || '#FE2C55')
            );
          }
          return;
        }

        if (type === 'stream:ended') {
          if (
            modeRef.current === 'watching' &&
            activeRoomRef.current &&
            data.streamId === activeRoomRef.current.id
          ) {
            cleanupPeerConnections();
            setStreamEndedNotice(true);
          }
          return;
        }

        if (type === 'stream:error') {
          void markFirestoreStreamEnded();
          cleanupPeerConnections();
          setActiveRoom(null);
          setMode('setup');
          return;
        }

        if (type === 'webrtc:viewer-joined' && modeRef.current === 'broadcasting') {
          const streamId = String(data.streamId || '');
          const viewerClientId = String(data.viewerClientId || '');
          if (activeRoomRef.current?.id === streamId && viewerClientId) {
            void createOfferForViewer(streamId, viewerClientId);
          }
          return;
        }

        if (type === 'webrtc:viewer-left' && modeRef.current === 'broadcasting') {
          const viewerClientId = String(data.viewerClientId || '');
          const pc = hostPeersRef.current.get(viewerClientId);
          if (pc) {
            pc.close();
            hostPeersRef.current.delete(viewerClientId);
          }
          return;
        }

        if (type === 'webrtc:offer' && modeRef.current === 'watching') {
          const streamId = String(data.streamId || '');
          const fromClientId = String(data.fromClientId || '');
          const sdp = data.sdp as RTCSessionDescriptionInit | null;
          if (activeRoomRef.current?.id === streamId && fromClientId && sdp) {
            void handleIncomingOffer(streamId, fromClientId, sdp);
          }
          return;
        }

        if (type === 'webrtc:answer' && modeRef.current === 'broadcasting') {
          const fromClientId = String(data.fromClientId || '');
          const sdp = data.sdp as RTCSessionDescriptionInit | null;
          const pc = hostPeersRef.current.get(fromClientId);
          if (pc && sdp) {
            void pc.setRemoteDescription(new RTCSessionDescription(sdp)).catch(() => {});
          }
          return;
        }

        if (type === 'webrtc:ice-candidate') {
          const fromClientId = String(data.fromClientId || '');
          const candidate = data.candidate as RTCIceCandidateInit | null;
          if (!candidate) return;

          if (modeRef.current === 'broadcasting') {
            const pc = hostPeersRef.current.get(fromClientId);
            if (pc) {
              void pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
            }
          } else if (modeRef.current === 'watching' && viewerPeerRef.current) {
            void viewerPeerRef.current
              .addIceCandidate(new RTCIceCandidate(candidate))
              .catch(() => {});
          }
        }
      };

      socket.onclose = () => {
        if (unmounted) return;
        setWsConnected(false);
        reconnectTimeoutRef.current = window.setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      void markFirestoreStreamEnded();
      cleanupPeerConnections();
      stopLocalCamera();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [
    cleanupPeerConnections,
    createOfferForViewer,
    handleIncomingOffer,
    markFirestoreStreamEnded,
    spawnHeartBurst,
    stopLocalCamera,
  ]);

  // Acquire uncropped 30fps broadcaster camera in 'setup' and 'broadcasting' modes (only when eligible >= 500 followers)
  useEffect(() => {
    if ((mode !== 'setup' && mode !== 'broadcasting') || !canGoLive) {
      stopLocalCamera();
      return;
    }

    let cancelled = false;
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Twoja przeglądarka nie obsługuje kamery do transmisji na żywo.');
      return;
    }

    void acquireWideCameraStream({
      facingMode,
      withAudio: true,
      preferUltraWideDevice: preferUltraWideRearLens,
    })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream.getAudioTracks().forEach((tr) => {
          tr.enabled = !micMuted;
        });

        const newVideoTrack = stream.getVideoTracks()[0];
        const caps = readTrackZoomCapabilities(newVideoTrack);
        setHwZoomCaps(caps);

        if (newVideoTrack && caps) {
          const split = computeZoomSplit(cameraZoom, caps);
          if (split.hwZoom !== null) {
            void newVideoTrack
              .applyConstraints({
                advanced: [{ zoom: split.hwZoom } as MediaTrackConstraintSet],
              })
              .catch(() => {});
          }
        }

        const previousStream = localStreamRef.current;
        localStreamRef.current = stream;
        setCameraReady(true);

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          void localVideoRef.current.play().catch(() => {});
        }

        if (newVideoTrack && hostPeersRef.current.size > 0) {
          for (const pc of hostPeersRef.current.values()) {
            const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
            if (sender) {
              void sender.replaceTrack(newVideoTrack).catch(() => {});
            }
          }
        }

        if (previousStream && previousStream !== stream) {
          previousStream.getTracks().forEach((tr) => tr.stop());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCameraError(
            'Zezwól na dostęp do kamery i mikrofonu, aby rozpocząć transmisję na żywo.'
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mode, facingMode, canGoLive, preferUltraWideRearLens, stopLocalCamera]);

  // Latest-wins hardware zoom constraint applier for smooth 0.5x–10x zooming
  useEffect(() => {
    if (desiredHwZoom === null) return;
    const track = localStreamRef.current?.getVideoTracks()?.[0];
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

  const startBroadcastSession = useCallback(
    async (overrideTitle?: string, overrideFilter?: VideoFilterId) => {
      if (!isSignedIn) {
        onSignIn();
        return;
      }
      if (!canGoLive) {
        return;
      }
      if (!localStreamRef.current) return;

      const streamId = generateSafeId('live');
      const finalTitle = sanitizeStreamTitle(
        overrideTitle ?? (streamTitle.trim() || 'Na żywo na Swappy!')
      );
      const finalFilter = overrideFilter ?? liveFilterId;
      const hostUid = auth.currentUser?.uid || profile?.uid || 'creator';
      const hostHandle = sanitizeHandle(profile?.handle || 'tworca');
      const hostName = sanitizeDisplayName(profile?.displayName || 'Twórca Swappy');
      const hostAvatarColor = sanitizeAvatarColor(profile?.avatarColor || '#FE2C55');
      const hostAvatarUrl = sanitizeOptionalMediaUrl(profile?.avatarUrl || '');

      hostedStreamIdRef.current = streamId;

      if (auth.currentUser?.uid && auth.currentUser.emailVerified) {
        try {
          await setDoc(doc(db, 'livestreams', streamId), {
            hostId: auth.currentUser.uid,
            hostHandle,
            hostName,
            hostAvatarColor,
            hostAvatarUrl,
            title: finalTitle,
            colorFilter: finalFilter,
            visibility: 'public',
            status: 'live',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Non-fatal if profile doc is still propagating; WS room still starts immediately
        }
      }

      sendWs({
        type: 'stream:start',
        streamId,
        hostUid,
        hostHandle,
        hostName,
        hostAvatarColor,
        hostAvatarUrl,
        title: finalTitle,
        colorFilter: finalFilter,
        followersCount,
      });
      setMode('broadcasting');
    },
    [
      canGoLive,
      followersCount,
      isSignedIn,
      liveFilterId,
      onSignIn,
      profile,
      sendWs,
      streamTitle,
    ]
  );

  // Auto-launch broadcast if user tapped "Rozpocznij LIVE" inside '+' CreateVideoModal
  useEffect(() => {
    if (!autoStartConfig || autoStartedRef.current) return;
    if (typeof autoStartConfig.initialZoom === 'number') {
      setCameraZoom(clampCameraZoom(autoStartConfig.initialZoom));
    }
    if (!canGoLive) {
      onConsumeAutoStart?.();
      return;
    }
    if (!wsConnected || !cameraReady || !isSignedIn) return;
    autoStartedRef.current = true;
    void startBroadcastSession(autoStartConfig.title, autoStartConfig.colorFilter);
    onConsumeAutoStart?.();
  }, [
    autoStartConfig,
    canGoLive,
    wsConnected,
    cameraReady,
    isSignedIn,
    startBroadcastSession,
    onConsumeAutoStart,
  ]);

  // Auto-join a specific stream if user tapped a LIVE card from Discover or Home
  useEffect(() => {
    if (!initialJoinStreamId || !wsConnected) return;
    const match = streams.find((s) => s.id === initialJoinStreamId);
    cleanupPeerConnections();
    setFallbackFrameUrl(match?.previewFrameUrl ?? null);
    if (match) setLiveFilterId(match.colorFilter);
    setStreamEndedNotice(false);
    setMode('watching');
    sendWs({
      type: 'stream:join',
      streamId: initialJoinStreamId,
    });
    onClearInitialJoin?.();
  }, [initialJoinStreamId, wsConnected, streams, cleanupPeerConnections, sendWs, onClearInitialJoin]);

  // Sync microphone mute flag without restarting video stream
  useEffect(() => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = !micMuted;
    });
  }, [micMuted]);

  // Sync viewer audio mute
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = viewerMuted;
    }
  }, [viewerMuted]);

  // Lightweight live preview frame relay from broadcaster -> server -> viewers/lobby
  useEffect(() => {
    if (mode !== 'broadcasting' || !activeRoom) return;

    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = 270;
    snapCanvas.height = 480;
    const ctx = snapCanvas.getContext('2d');

    const sendFrameSnapshot = () => {
      const videoEl = localVideoRef.current;
      if (!ctx || !videoEl || videoEl.readyState < 2) return;
      drawZoomedVideoFrameToCanvas(
        ctx,
        videoEl,
        snapCanvas.width,
        snapCanvas.height,
        liveCssScaleRef.current,
        facingMode === 'user'
      );
      const frameDataUrl = snapCanvas.toDataURL('image/jpeg', 0.48);
      sendWs({
        type: 'stream:frame',
        streamId: activeRoom.id,
        frameDataUrl,
      });
    };

    const initialTimer = window.setTimeout(sendFrameSnapshot, 500);
    const intervalId = window.setInterval(() => {
      sendFrameSnapshot();
    }, 650);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
    };
  }, [mode, activeRoom, facingMode, sendWs]);

  const cameraGestureHandlers = useCameraGestureZoom(
    cameraZoom,
    (next) => setCameraZoom(clampCameraZoom(next)),
    (mode === 'setup' && canGoLive) || mode === 'broadcasting'
  );

  const handleEndBroadcast = () => {
    sendWs({ type: 'stream:end' });
    void markFirestoreStreamEnded();
    cleanupPeerConnections();
    stopLocalCamera();
    setActiveRoom(null);
    setRoomMessages([]);
    autoStartedRef.current = false;
    setMode('lobby');
  };

  const handleJoinStream = (stream: LiveStreamSummary) => {
    cleanupPeerConnections();
    setFallbackFrameUrl(stream.previewFrameUrl ?? null);
    setLiveFilterId(stream.colorFilter);
    setStreamEndedNotice(false);
    setMode('watching');
    sendWs({
      type: 'stream:join',
      streamId: stream.id,
    });
  };

  const handleLeaveStream = () => {
    sendWs({ type: 'stream:leave' });
    cleanupPeerConnections();
    setActiveRoom(null);
    setFallbackFrameUrl(null);
    setStreamEndedNotice(false);
    setMode('lobby');
  };

  const handleChangeLiveFilter = (filterId: VideoFilterId) => {
    setLiveFilterId(filterId);
    if (mode === 'broadcasting' && activeRoom) {
      sendWs({
        type: 'stream:filter',
        streamId: activeRoom.id,
        colorFilter: filterId,
      });
      if (hostedStreamIdRef.current && auth.currentUser?.uid) {
        void updateDoc(doc(db, 'livestreams', hostedStreamIdRef.current), {
          colorFilter: filterId,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom) return;
    const text = chatDraft.trim();
    if (!text) return;

    sendWs({
      type: 'stream:chat',
      streamId: activeRoom.id,
      authorHandle: profile?.handle || 'widz_swappy',
      authorName: profile?.displayName || 'Widz',
      authorAvatarColor: profile?.avatarColor || '#25F4EE',
      authorAvatarUrl: sanitizeOptionalMediaUrl(profile?.avatarUrl || ''),
      text,
    });
    setChatDraft('');
  };

  const handleSendHeart = () => {
    if (!activeRoom) return;
    sendWs({
      type: 'stream:heart',
      streamId: activeRoom.id,
      color: profile?.avatarColor || '#FE2C55',
    });
  };

  /* =========================================================================
     VIEW 1: LIVE DISCOVERY LOBBY
     ========================================================================= */
  if (mode === 'lobby') {
    return (
      <div className="h-full w-full overflow-y-auto bg-[#0A0A0C] text-white pb-24 no-scrollbar">
        <div className="px-4 pt-4 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={onBackToFeed}
                aria-label="Wróć do filmów"
                className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-white truncate">
                  {t('navLive')}
                </h1>
                <p className="text-xs text-zinc-400 truncate">
                  {wsConnected
                    ? `Aktywne pokoje na żywo: ${streams.length}`
                    : 'Łączenie z serwerem transmisji...'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setMode('setup')}
              className="min-h-[46px] px-4 sm:px-5 rounded-xl bg-[#FE2C55] hover:bg-[#e6254b] active:scale-[0.98] transition-all text-xs sm:text-sm font-bold text-white flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Radio className="w-4 h-4 shrink-0" />
              <span>{t('goLiveBtn')}</span>
            </button>
          </div>

          {streams.length === 0 ? (
            <div className="py-20 rounded-3xl bg-[#111116] border border-white/10 flex flex-col items-center justify-center text-center px-6 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-[#FE2C55]/15 border border-[#FE2C55]/30 flex items-center justify-center text-[#FE2C55]">
                <Radio className="w-8 h-8" />
              </div>
              <div className="space-y-1.5 max-w-sm">
                <h2 className="text-base sm:text-lg font-extrabold text-white text-balance">
                  Brak aktywnych transmisji w tej chwili
                </h2>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed text-balance">
                  Oglądaj transmisje twórców w czasie rzeczywistym. Nadawanie własnej transmisji LIVE jest dostępne od {LIVE_MIN_FOLLOWERS} obserwujących.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMode('setup')}
                className="min-h-[48px] px-6 rounded-xl bg-[#FE2C55] hover:bg-[#e6254b] text-sm font-bold text-white inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Video className="w-4 h-4" />
                <span>{t('startLiveStream')}</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {streams.map((stream) => (
                <button
                  key={stream.id}
                  type="button"
                  onClick={() => handleJoinStream(stream)}
                  className="group relative aspect-[9/16] rounded-2xl overflow-hidden bg-[#141418] border border-white/10 text-left cursor-pointer focus-visible:ring-2 focus-visible:ring-[#FE2C55]"
                >
                  {stream.previewFrameUrl ? (
                    <img
                      src={stream.previewFrameUrl}
                      alt={`Transmisja @${stream.hostHandle}`}
                      referrerPolicy="no-referrer"
                      style={{ filter: getVideoFilterCss(stream.colorFilter) }}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-zinc-800 to-zinc-950">
                      <Radio className="w-8 h-8 text-[#FE2C55]" />
                    </div>
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/35" />

                  <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2">
                    <span className="rounded-md bg-[#FE2C55] px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white uppercase">
                      LIVE
                    </span>
                    <span className="rounded-md bg-black/55 backdrop-blur-xs px-2 py-0.5 text-[11px] font-mono tabular-nums text-white flex items-center gap-1">
                      <Users className="w-3 h-3 text-[#25F4EE]" />
                      {formatCompactCount(stream.viewersCount)}
                    </span>
                  </div>

                  <div className="absolute inset-x-3 bottom-3 space-y-1">
                    <p className="text-xs font-bold text-white line-clamp-2 leading-snug">
                      {stream.title}
                    </p>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <UserAvatar
                        src={stream.hostAvatarUrl}
                        name={stream.hostName}
                        color={stream.hostAvatarColor}
                        className="w-5 h-5 shrink-0"
                        textClassName="text-[10px]"
                      />
                      <span className="text-[11px] text-zinc-200 font-semibold truncate">
                        @{stream.hostHandle}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* =========================================================================
     VIEW 2: PRE-LIVE BROADCASTER CAMERA SETUP (500-FOLLOWER GATE + 0.5x–10x ZOOM)
     ========================================================================= */
  if (mode === 'setup') {
    if (!canGoLive) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-black">
          <div className="relative w-full h-full overflow-hidden bg-gradient-to-b from-[#16161D] via-[#101015] to-black flex flex-col justify-between">
            {/* Top Bar */}
            <div className="relative z-20 p-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMode('lobby')}
                aria-label="Wróć do listy LIVE"
                className="min-h-[44px] min-w-[44px] rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="rounded-full bg-[#FE2C55] px-4 py-1.5 flex items-center gap-1.5 text-xs font-extrabold tracking-wide uppercase text-white shadow-lg">
                <Radio className="w-3.5 h-3.5" />
                <span>STUDIO LIVE</span>
              </div>

              <div className="w-11" aria-hidden="true" />
            </div>

            {/* 500-Follower Eligibility Gate Card */}
            <div className="relative z-20 px-6 pb-20 flex-1 flex flex-col items-center justify-center text-center">
              <div className="w-full max-w-[340px] rounded-3xl bg-white/[0.05] border border-white/15 p-5 space-y-4 shadow-2xl">
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
                      ? 'Zaloguj się, aby sprawdzić liczbę obserwujących na swoim koncie.'
                      : `Brakuje jeszcze ${missingLiveFollowers} obserwujących do odblokowania transmisji LIVE.`}
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
                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setMode('lobby')}
                      className="w-full min-h-[46px] rounded-full bg-[#FE2C55] hover:bg-[#e6254b] text-white font-extrabold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Radio className="w-4 h-4" />
                      <span>Wróć do listy LIVE</span>
                    </button>
                    <button
                      type="button"
                      onClick={onBackToFeed}
                      className="w-full min-h-[44px] rounded-full bg-white/10 hover:bg-white/15 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <span>Wróć do filmów</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <div
          {...cameraGestureHandlers}
          className="relative w-full h-full overflow-hidden bg-black flex flex-col justify-between"
        >
          {cameraError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center space-y-3 bg-zinc-950">
              <Video className="w-10 h-10 text-zinc-500" />
              <p className="text-xs text-zinc-300 leading-relaxed">{cameraError}</p>
            </div>
          ) : (
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              style={{
                ...(liveFilterId !== 'normal' ? { filter: getVideoFilterCss(liveFilterId) } : {}),
                transform: cameraPreviewTransform,
                transformOrigin: 'center center',
              }}
              className="absolute inset-0 w-full h-full object-contain bg-black transition-transform duration-75"
            />
          )}

          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/75 to-transparent"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-black/90 via-black/50 to-transparent"
            aria-hidden="true"
          />

          {/* Top Bar */}
          <div className="relative z-20 p-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                stopLocalCamera();
                setMode('lobby');
              }}
              aria-label="Zamknij przygotowanie LIVE"
              className="min-h-[44px] min-w-[44px] rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <span className="text-xs font-extrabold tracking-wide uppercase text-white bg-black/45 backdrop-blur-md px-3.5 py-1.5 rounded-full">
              Przygotowanie LIVE
            </span>

            <button
              type="button"
              onClick={() => {
                setFacingMode((f) => (f === 'user' ? 'environment' : 'user'));
                setCameraZoom(DEFAULT_CAMERA_ZOOM);
              }}
              aria-label="Obróć aparat"
              className="min-h-[44px] min-w-[44px] rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center text-white cursor-pointer"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>

          {/* Setup Card, 0.5x–10x Zoom Controls & Start CTA */}
          <div className="relative z-20 p-5 pb-20 space-y-3.5">
            {!cameraError && (
              <CameraZoomBar zoom={cameraZoom} onChangeZoom={setCameraZoom} />
            )}

            <div className="rounded-2xl bg-black/55 backdrop-blur-md border border-white/15 p-3.5 space-y-3">
              <label className="block text-[11px] font-semibold text-zinc-300">
                Tytuł transmisji na żywo
              </label>
              <input
                type="text"
                value={streamTitle}
                onChange={(e) => setStreamTitle(e.target.value)}
                maxLength={80}
                placeholder="Wpisz tytuł swojego LIVE..."
                className="w-full min-h-[42px] rounded-xl bg-white/10 border border-white/15 px-3 text-sm font-semibold text-white placeholder:text-zinc-400 focus:outline-none focus:border-[#25F4EE]"
              />

              {/* Live Color Filter Picker */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-zinc-300">
                  Filtr kolorystyczny kamery
                </div>
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
                  {VIDEO_COLOR_FILTERS.map((preset) => {
                    const active = liveFilterId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setLiveFilterId(preset.id)}
                        className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer border ${
                          active
                            ? 'bg-white text-black border-white'
                            : 'bg-white/10 text-white border-white/10'
                        }`}
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded-full bg-gradient-to-br ${preset.previewGradient}`}
                        />
                        <span>{preset.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={Boolean(cameraError)}
              onClick={() => void startBroadcastSession()}
              className="w-full min-h-[52px] rounded-full bg-[#FE2C55] hover:bg-[#e6254b] disabled:opacity-45 active:scale-[0.98] transition-all text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-xl cursor-pointer"
            >
              <Radio className="w-4 h-4" />
              <span>Rozpocznij transmisję NA ŻYWO</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* =========================================================================
     VIEW 3: ACTIVE LIVE STREAM ROOM (BROADCASTER STUDIO OR VIEWER PLAYER)
     ========================================================================= */
  const isBroadcaster = mode === 'broadcasting';

  return (
    <div className="w-full h-full flex items-center justify-center bg-black select-none">
      <div
        {...(isBroadcaster ? cameraGestureHandlers : {})}
        className="relative w-full h-full overflow-hidden bg-black flex flex-col justify-between"
      >
        {/* Video Media Stage */}
        {isBroadcaster ? (
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            style={{
              ...(liveFilterId !== 'normal' ? { filter: getVideoFilterCss(liveFilterId) } : {}),
              transform: cameraPreviewTransform,
              transformOrigin: 'center center',
            }}
            className="absolute inset-0 w-full h-full object-contain bg-black transition-transform duration-75"
          />
        ) : (
          <div className="absolute inset-0 w-full h-full bg-black">
            {fallbackFrameUrl && !hasWebRtcStream && (
              <img
                src={fallbackFrameUrl}
                alt="Transmisja na żywo"
                referrerPolicy="no-referrer"
                style={
                  liveFilterId !== 'normal'
                    ? { filter: getVideoFilterCss(liveFilterId) }
                    : undefined
                }
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}

            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted={viewerMuted}
              style={
                liveFilterId !== 'normal'
                  ? { filter: getVideoFilterCss(liveFilterId) }
                  : undefined
              }
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
                hasWebRtcStream ? 'opacity-100' : 'opacity-0'
              }`}
            />

            {!fallbackFrameUrl && !hasWebRtcStream && !streamEndedNotice && (
              <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3">
                <div className="w-9 h-9 rounded-full border-2 border-white/20 border-t-[#FE2C55] animate-spin" />
                <span className="text-xs text-zinc-400">Łączenie ze strumieniem na żywo...</span>
              </div>
            )}

            {streamEndedNotice && (
              <div className="absolute inset-0 z-30 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center text-center px-6 space-y-4">
                <Radio className="w-10 h-10 text-zinc-500" />
                <div className="space-y-1">
                  <h3 className="text-lg font-extrabold text-white">
                    Transmisja LIVE została zakończona
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Twórca zakończył nadawanie na żywo.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleLeaveStream}
                  className="min-h-[44px] px-6 rounded-full bg-white text-black text-xs font-bold cursor-pointer"
                >
                  Wróć do listy LIVE
                </button>
              </div>
            )}
          </div>
        )}

        {/* Contrast Vignettes */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/75 to-transparent"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-black/90 via-black/45 to-transparent"
          aria-hidden="true"
        />

        {/* TOP LIVE HEADER */}
        <div className="relative z-20 p-3.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 bg-black/45 backdrop-blur-md rounded-full pl-1.5 pr-3 py-1 border border-white/10 min-w-0">
            <UserAvatar
              src={
                activeRoom?.hostAvatarUrl ||
                (isBroadcaster ? profile?.avatarUrl : '')
              }
              name={activeRoom?.hostName || profile?.displayName || 'T'}
              color={activeRoom?.hostAvatarColor || profile?.avatarColor || '#FE2C55'}
              className="w-8 h-8 shrink-0"
              textClassName="text-xs"
            />
            <div className="min-w-0">
              <div className="text-xs font-bold text-white truncate max-w-[120px]">
                @{activeRoom?.hostHandle || profile?.handle || 'tworca'}
              </div>
              <div className="text-[10px] text-zinc-300 font-mono tabular-nums flex items-center gap-1.5">
                <span className="text-[#FE2C55] font-extrabold">NA ŻYWO</span>
                <span>·</span>
                <span>
                  {formatElapsedTime(activeRoom?.startedAtMs || nowMs, nowMs)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="min-h-[36px] px-3 rounded-full bg-black/45 backdrop-blur-md border border-white/10 flex items-center gap-1.5 text-xs font-mono tabular-nums font-bold text-white">
              <Users className="w-3.5 h-3.5 text-[#25F4EE]" />
              <span>{formatCompactCount(roomViewers)}</span>
            </div>

            {isBroadcaster ? (
              <button
                type="button"
                onClick={handleEndBroadcast}
                className="min-h-[38px] px-3.5 rounded-full bg-[#FE2C55] hover:bg-[#e6254b] text-xs font-extrabold text-white cursor-pointer whitespace-nowrap"
              >
                Zakończ
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLeaveStream}
                aria-label="Opuść transmisję"
                className="min-h-[40px] min-w-[40px] rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Broadcaster Quick Camera/Audio/Filter Controls */}
        {isBroadcaster ? (
          <div className="relative z-20 px-3.5 flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => {
                setFacingMode((f) => (f === 'user' ? 'environment' : 'user'));
                setCameraZoom(DEFAULT_CAMERA_ZOOM);
              }}
              aria-label="Obróć kamerę"
              className="min-h-[42px] min-w-[42px] rounded-full bg-black/45 backdrop-blur-md border border-white/10 flex items-center justify-center text-white cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setMicMuted((m) => !m)}
              aria-label={micMuted ? 'Włącz mikrofon' : 'Wycisz mikrofon'}
              className="min-h-[42px] min-w-[42px] rounded-full bg-black/45 backdrop-blur-md border border-white/10 flex items-center justify-center text-white cursor-pointer"
            >
              {micMuted ? (
                <MicOff className="w-4 h-4 text-[#FE2C55]" />
              ) : (
                <Mic className="w-4 h-4 text-[#25F4EE]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowFilterBar((s) => !s)}
              aria-label="Filtry kolorystyczne na żywo"
              className={`min-h-[42px] min-w-[42px] rounded-full bg-black/45 backdrop-blur-md border border-white/10 flex items-center justify-center cursor-pointer ${
                liveFilterId !== 'normal' ? 'text-[#25F4EE]' : 'text-white'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="relative z-20 px-3.5 flex justify-end">
            <button
              type="button"
              onClick={() => setViewerMuted((m) => !m)}
              aria-label={viewerMuted ? 'Włącz dźwięk transmisji' : 'Wycisz transmisję'}
              className="min-h-[42px] min-w-[42px] rounded-full bg-black/45 backdrop-blur-md border border-white/10 flex items-center justify-center text-white cursor-pointer"
            >
              {viewerMuted ? (
                <VolumeX className="w-4 h-4 text-white/80" />
              ) : (
                <Volume2 className="w-4 h-4 text-[#25F4EE]" />
              )}
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* Floating Rising Hearts */}
        <div className="pointer-events-none absolute right-6 bottom-28 z-30 w-14 h-48 overflow-visible">
          {floatingHearts.map((h) => (
            <div
              key={h.id}
              style={{
                transform: `translate(${h.offsetX}px, -110px) scale(1.15)`,
              }}
              className="absolute bottom-0 right-2 transition-all duration-1000 opacity-0 animate-bounce"
            >
              <Heart
                style={{ color: h.color, fill: h.color }}
                className="w-7 h-7 drop-shadow-lg"
              />
            </div>
          ))}
        </div>

        {/* BOTTOM LIVE CHAT & INTERACTION BAR */}
        <div className="relative z-20 p-3.5 pb-18 space-y-2.5">
          {isBroadcaster && (
            <CameraZoomBar zoom={cameraZoom} onChangeZoom={setCameraZoom} />
          )}

          {showFilterBar && isBroadcaster && (
            <div className="rounded-2xl bg-black/65 backdrop-blur-md border border-white/15 p-2.5 flex items-center gap-2 overflow-x-auto no-scrollbar">
              {VIDEO_COLOR_FILTERS.map((preset) => {
                const selected = liveFilterId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleChangeLiveFilter(preset.id)}
                    className={`min-h-[36px] px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer ${
                      selected ? 'bg-white text-black' : 'bg-white/10 text-white'
                    }`}
                  >
                    <span
                      className={`w-3.5 h-3.5 rounded-full bg-gradient-to-br ${preset.previewGradient}`}
                    />
                    <span>{preset.name}</span>
                    {selected && <Check className="w-3 h-3" />}
                  </button>
                );
              })}
            </div>
          )}

          {activeRoom?.title && (
            <div className="text-xs font-bold text-white/95 drop-shadow truncate pr-14">
              {activeRoom.title}
            </div>
          )}

          {/* Scrolling Live Chat Messages */}
          <div
            ref={chatScrollRef}
            className="max-h-40 overflow-y-auto space-y-1.5 pr-12 no-scrollbar"
          >
            {roomMessages.length === 0 ? (
              <div className="text-xs text-white/70">
                Czat na żywo jest aktywny — przywitaj się!
              </div>
            ) : (
              roomMessages.map((m) => (
                <div
                  key={m.id}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-black/40 backdrop-blur-xs px-2.5 py-1 text-xs max-w-full"
                >
                  <UserAvatar
                    src={m.authorAvatarUrl}
                    name={m.authorName}
                    color={m.authorAvatarColor}
                    className="w-4 h-4 shrink-0"
                    textClassName="text-[8px]"
                  />
                  <span
                    style={{ color: m.authorAvatarColor }}
                    className="font-bold shrink-0"
                  >
                    @{m.authorHandle}:
                  </span>
                  <span className="text-white break-words">{m.text}</span>
                </div>
              ))
            )}
          </div>

          {/* Chat Input + Heart Trigger */}
          <div className="flex items-center gap-2 pt-1">
            <form onSubmit={handleSendChat} className="flex-1 flex items-center gap-2">
              <input
                type="text"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                maxLength={200}
                placeholder="Dodaj komentarz na żywo..."
                className="flex-1 min-w-0 min-h-[44px] rounded-full bg-black/50 backdrop-blur-md border border-white/15 px-4 text-xs text-white placeholder:text-white/60 focus:outline-none focus:border-[#25F4EE]"
              />
              <button
                type="submit"
                disabled={!chatDraft.trim()}
                aria-label="Wyślij wiadomość na czacie"
                className="min-h-[44px] min-w-[44px] rounded-full bg-white/15 hover:bg-white/25 disabled:opacity-40 flex items-center justify-center text-white cursor-pointer shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>

            <button
              type="button"
              onClick={handleSendHeart}
              aria-label="Wyślij serduszko na żywo"
              className="min-h-[44px] px-3.5 rounded-full bg-[#FE2C55]/90 hover:bg-[#FE2C55] active:scale-90 transition-transform flex items-center gap-1.5 text-xs font-mono tabular-nums font-bold text-white shadow-lg cursor-pointer shrink-0"
            >
              <Heart className="w-4 h-4 fill-white" />
              <span>{formatCompactCount(roomLikes)}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
