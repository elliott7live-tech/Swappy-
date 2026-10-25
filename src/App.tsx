import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  Compass,
  Download,
  Film,
  Globe,
  Home,
  MessageSquare,
  Plus,
  Radio,
  Search,
  User as UserIcon,
} from 'lucide-react';
import { CommentsSheet } from './components/CommentsSheet';
import { CreateVideoModal, NewVideoSubmission } from './components/CreateVideoModal';
import { DiscoverView } from './components/DiscoverView';
import {
  InstallAppModal,
  OfflineIndicator,
  WebsiteInstallBanner,
} from './components/InstallAppModal';
import { InboxView } from './components/InboxView';
import { LanguageModal } from './components/LanguageModal';
import { LiveStreamView } from './components/LiveStreamView';
import { ProfileView } from './components/ProfileView';
import { SwappyLogo } from './components/SwappyLogo';
import { UserAvatar } from './components/UserAvatar';
import { VideoCard } from './components/VideoCard';
import {
  auth,
  db,
  generateSafeId,
  googleProvider,
  handleFirestoreError,
  OperationType,
  sanitizeAvatarColor,
  sanitizeBio,
  sanitizeCaption,
  sanitizeCommentText,
  sanitizeDisplayName,
  sanitizeHandle,
  sanitizeHashtags,
  sanitizeMusicArtist,
  sanitizeMusicTitle,
  sanitizeOptionalMediaUrl,
  sanitizeOverlayText,
  sanitizeVideoUrl,
  sanitizeVolumePercent,
} from './firebase';
import { copyTextSafe, usePWAInstall } from './hooks/usePWAInstall';
import { useLanguage } from './i18n';
import {
  FeedTab,
  LiveAutoStartConfig,
  LiveStreamSummary,
  NavTab,
  PublicProfile,
  SwappyComment,
  SwappyVideo,
} from './types';
import { loadLocalVideoUrl, saveLocalVideoBlob } from './utils/localVideoStore';
import { sanitizeColorFilter } from './utils/videoFilters';

function formatRelativePolishTime(ms: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'przed chwilą';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min temu`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} godz. temu`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} dni temu`;
}

function readTimestampMs(raw: unknown): number {
  if (raw instanceof Timestamp) {
    return raw.toMillis();
  }
  if (raw && typeof raw === 'object' && 'seconds' in raw && typeof raw.seconds === 'number') {
    return raw.seconds * 1000;
  }
  return Date.now();
}

function mapDocToSwappyVideo(id: string, d: Record<string, unknown>): SwappyVideo {
  const createdMs = readTimestampMs(d.createdAt);
  return {
    id,
    authorId: String(d.authorId),
    authorHandle: String(d.authorHandle),
    authorName: String(d.authorName),
    authorAvatarColor: String(d.authorAvatarColor || '#FE2C55'),
    authorAvatarUrl: typeof d.authorAvatarUrl === 'string' ? d.authorAvatarUrl : '',
    videoUrl: String(d.videoUrl),
    caption: String(d.caption),
    hashtags: Array.isArray(d.hashtags) ? d.hashtags.map(String) : [],
    musicTitle: String(d.musicTitle || 'Oryginalny dźwięk'),
    musicArtist: typeof d.musicArtist === 'string' ? d.musicArtist : '',
    musicAudioUrl: typeof d.musicAudioUrl === 'string' ? d.musicAudioUrl : '',
    musicCoverUrl: typeof d.musicCoverUrl === 'string' ? d.musicCoverUrl : '',
    originalVolume:
      typeof d.originalVolume === 'number'
        ? Math.max(0, Math.min(100, d.originalVolume))
        : 100,
    musicVolume:
      typeof d.musicVolume === 'number'
        ? Math.max(0, Math.min(100, d.musicVolume))
        : 85,
    overlayText: String(d.overlayText || ''),
    colorFilter: sanitizeColorFilter(String(d.colorFilter || 'normal')),
    visibility: d.visibility === 'private' ? 'private' : 'public',
    likesCount: Number(d.likesCount ?? 0),
    commentsCount: Number(d.commentsCount ?? 0),
    bookmarksCount: 0,
    createdAtLabel: formatRelativePolishTime(createdMs),
    createdAtMs: createdMs,
  };
}

export default function App() {
  const { lang, t, currentLanguage } = useLanguage();

  // Navigation & Feed State
  const [navTab, setNavTab] = useState<NavTab>(NavTab.HOME);
  const [feedTab, setFeedTab] = useState<FeedTab>(FeedTab.FOR_YOU);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [discoverHashtag, setDiscoverHashtag] = useState<string | null>(null);

  // Modals, Drawers & Live Stream Navigation State
  const { isInstalled, isRunningInApp } = usePWAInstall();
  const canShowWebInstallOption = !isRunningInApp && !isInstalled;
  const [isInstallModalOpen, setIsInstallModalOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('auto') === '1';
    } catch {
      return false;
    }
  });
  const [isInstallBannerDismissed, setIsInstallBannerDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return sessionStorage.getItem('swappy_web_install_dismissed') === '1';
    } catch {
      return false;
    }
  });
  const [commentsTargetVideoId, setCommentsTargetVideoId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [apiLiveStreams, setApiLiveStreams] = useState<LiveStreamSummary[]>([]);
  const [firestoreLiveStreams, setFirestoreLiveStreams] = useState<LiveStreamSummary[]>([]);
  const [liveInitialMode, setLiveInitialMode] = useState<'lobby' | 'setup'>('lobby');
  const [liveAutoStartConfig, setLiveAutoStartConfig] = useState<LiveAutoStartConfig | null>(
    null
  );
  const [liveJoinStreamId, setLiveJoinStreamId] = useState<string | null>(null);

  // Auth & Profile State
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [publicProfilesMap, setPublicProfilesMap] = useState<Record<string, PublicProfile>>({});

  // Real-time Firestore Data (100% user-created content — zero pre-populated AI videos)
  const [videosLoading, setVideosLoading] = useState(true);
  const [remotePublicVideos, setRemotePublicVideos] = useState<SwappyVideo[]>([]);
  const [remoteOwnVideos, setRemoteOwnVideos] = useState<SwappyVideo[]>([]);
  const [localBlobUrls, setLocalBlobUrls] = useState<Record<string, string>>({});
  const [remoteComments, setRemoteComments] = useState<SwappyComment[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [followersCount, setFollowersCount] = useState(0);

  const [isPublishing, setIsPublishing] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  const feedScrollRef = useRef<HTMLDivElement | null>(null);

  const activeLiveStreams = useMemo<LiveStreamSummary[]>(() => {
    const merged = new Map<string, LiveStreamSummary>();
    for (const s of firestoreLiveStreams) {
      const latestProf = publicProfilesMap[s.hostUid];
      merged.set(s.id, {
        ...s,
        hostHandle: latestProf?.handle || s.hostHandle,
        hostName: latestProf?.displayName || s.hostName,
        hostAvatarColor: latestProf?.avatarColor || s.hostAvatarColor,
        hostAvatarUrl: latestProf?.avatarUrl ?? s.hostAvatarUrl,
      });
    }
    for (const s of apiLiveStreams) {
      const latestProf = publicProfilesMap[s.hostUid];
      merged.set(s.id, {
        ...s,
        hostHandle: latestProf?.handle || s.hostHandle,
        hostName: latestProf?.displayName || s.hostName,
        hostAvatarColor: latestProf?.avatarColor || s.hostAvatarColor,
        hostAvatarUrl: latestProf?.avatarUrl ?? s.hostAvatarUrl,
      });
    }
    return Array.from(merged.values()).sort((a, b) => b.startedAtMs - a.startedAtMs);
  }, [apiLiveStreams, firestoreLiveStreams, publicProfilesMap]);

  const liveStreamsCount = activeLiveStreams.length;

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  const ensureUserProfile = useCallback(async (user: User): Promise<PublicProfile> => {
    const profileRef = doc(db, 'profiles', user.uid);
    let existingSnap;
    try {
      existingSnap = await getDoc(profileRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `profiles/${user.uid}`);
    }

    if (existingSnap.exists()) {
      const data = existingSnap.data();
      const loaded: PublicProfile = {
        uid: String(data.uid),
        handle: String(data.handle),
        displayName: String(data.displayName),
        bio: String(data.bio ?? ''),
        avatarColor: String(data.avatarColor ?? '#FE2C55'),
        avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : '',
        visibility: 'public',
      };
      setProfile(loaded);
      return loaded;
    }

    const baseHandle = sanitizeHandle(
      user.email ? user.email.split('@')[0] : user.displayName || 'tworca'
    );
    const initialAvatarUrl = sanitizeOptionalMediaUrl(user.photoURL || '');
    const newProfile: PublicProfile = {
      uid: user.uid,
      handle: baseHandle,
      displayName: sanitizeDisplayName(user.displayName || baseHandle),
      bio: 'Twórca na Swappy',
      avatarColor: '#FE2C55',
      avatarUrl: initialAvatarUrl,
      visibility: 'public',
    };

    try {
      await setDoc(profileRef, {
        ...newProfile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `profiles/${user.uid}`);
    }
    setProfile(newProfile);
    return newProfile;
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthReady(true);
      if (user) {
        void ensureUserProfile(user);
      } else {
        setProfile(null);
        setLikedIds(new Set());
        setBookmarkedIds(new Set());
        setFollowingIds(new Set());
        setFollowersCount(0);
        setRemoteOwnVideos([]);
      }
    });
    return () => unsub();
  }, [ensureUserProfile]);

  // Real-time Public Videos, Public Comments & Public Livestreams Listeners
  useEffect(() => {
    const publicVideosQuery = query(
      collection(db, 'videos'),
      where('visibility', '==', 'public')
    );

    const unsubVideos = onSnapshot(
      publicVideosQuery,
      (snap) => {
        const list: SwappyVideo[] = snap.docs
          .filter((docSnap) => Boolean(docSnap.data().videoUrl))
          .map((docSnap) => mapDocToSwappyVideo(docSnap.id, docSnap.data()));
        setRemotePublicVideos(list);
        setVideosLoading(false);

        list.forEach((v) => {
          void loadLocalVideoUrl(v.id).then((blobUrl) => {
            if (blobUrl) {
              setLocalBlobUrls((prev) => (prev[v.id] ? prev : { ...prev, [v.id]: blobUrl }));
            }
          });
        });
      },
      (error) => {
        setVideosLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'videos');
      }
    );

    const publicCommentsQuery = query(
      collection(db, 'comments'),
      where('visibility', '==', 'public')
    );

    const unsubComments = onSnapshot(
      publicCommentsQuery,
      (snap) => {
        const list: SwappyComment[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          const createdMs = readTimestampMs(d.createdAt);
          return {
            id: docSnap.id,
            videoId: String(d.videoId),
            authorId: String(d.authorId),
            authorHandle: String(d.authorHandle),
            authorName: String(d.authorName),
            authorAvatarColor: String(d.authorAvatarColor || '#25F4EE'),
            authorAvatarUrl:
              typeof d.authorAvatarUrl === 'string' ? d.authorAvatarUrl : '',
            text: String(d.text),
            createdAtLabel: formatRelativePolishTime(createdMs),
            createdAtMs: createdMs,
          };
        });
        list.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setRemoteComments(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'comments');
      }
    );

    const publicProfilesQuery = query(
      collection(db, 'profiles'),
      where('visibility', '==', 'public')
    );

    const unsubProfiles = onSnapshot(
      publicProfilesQuery,
      (snap) => {
        const nextMap: Record<string, PublicProfile> = {};
        snap.docs.forEach((docSnap) => {
          const d = docSnap.data();
          const uid = String(d.uid || docSnap.id);
          nextMap[uid] = {
            uid,
            handle: String(d.handle || 'tworca'),
            displayName: String(d.displayName || 'Twórca'),
            bio: String(d.bio ?? ''),
            avatarColor: String(d.avatarColor ?? '#FE2C55'),
            avatarUrl: typeof d.avatarUrl === 'string' ? d.avatarUrl : '',
            visibility: 'public',
          };
        });
        setPublicProfilesMap(nextMap);
      },
      () => {}
    );

    const publicLiveQuery = query(
      collection(db, 'livestreams'),
      where('visibility', '==', 'public')
    );

    const unsubLive = onSnapshot(
      publicLiveQuery,
      (snap) => {
        const cutoff = Date.now() - 3 * 60 * 60 * 1000;
        const list: LiveStreamSummary[] = snap.docs
          .filter((d) => d.data().status === 'live')
          .map((d) => {
            const data = d.data();
            const startedAtMs = readTimestampMs(data.createdAt);
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
              startedAtMs,
              likesCount: 0,
              viewersCount: 0,
              previewFrameUrl: null,
            };
          })
          .filter((s) => s.startedAtMs >= cutoff);
        setFirestoreLiveStreams(list);
      },
      () => {}
    );

    return () => {
      unsubVideos();
      unsubComments();
      unsubProfiles();
      unsubLive();
    };
  }, []);

  // Poll active WebSocket live streams snapshot
  useEffect(() => {
    let active = true;
    const fetchLiveSnapshot = () => {
      fetch('/api/live')
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { streams?: Record<string, unknown>[] } | null) => {
          if (active && data && Array.isArray(data.streams)) {
            const parsed: LiveStreamSummary[] = data.streams.map((item) => ({
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
            setApiLiveStreams(parsed);
          }
        })
        .catch(() => {});
    };
    fetchLiveSnapshot();
    const id = window.setInterval(fetchLiveSnapshot, 5000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  // User-specific Firestore listeners
  useEffect(() => {
    if (!authReady || !currentUser) return;
    const uid = currentUser.uid;

    const ownVideosQ = query(collection(db, 'videos'), where('authorId', '==', uid));
    const unsubOwn = onSnapshot(
      ownVideosQ,
      (snap) => {
        const list: SwappyVideo[] = snap.docs
          .filter((docSnap) => Boolean(docSnap.data().videoUrl))
          .map((docSnap) => mapDocToSwappyVideo(docSnap.id, docSnap.data()));
        setRemoteOwnVideos(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'videos')
    );

    const likesQ = query(collection(db, 'likes'), where('userId', '==', uid));
    const unsubLikes = onSnapshot(
      likesQ,
      (snap) => {
        setLikedIds(new Set(snap.docs.map((d) => String(d.data().videoId))));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'likes')
    );

    const bookmarksQ = query(collection(db, 'bookmarks'), where('userId', '==', uid));
    const unsubBookmarks = onSnapshot(
      bookmarksQ,
      (snap) => {
        setBookmarkedIds(new Set(snap.docs.map((d) => String(d.data().videoId))));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'bookmarks')
    );

    const followingQ = query(collection(db, 'follows'), where('followerId', '==', uid));
    const unsubFollowing = onSnapshot(
      followingQ,
      (snap) => {
        setFollowingIds(new Set(snap.docs.map((d) => String(d.data().followingId))));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'follows')
    );

    const followersQ = query(collection(db, 'follows'), where('followingId', '==', uid));
    const unsubFollowers = onSnapshot(
      followersQ,
      (snap) => {
        setFollowersCount(snap.size);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'follows')
    );

    return () => {
      unsubOwn();
      unsubLikes();
      unsubBookmarks();
      unsubFollowing();
      unsubFollowers();
    };
  }, [authReady, currentUser]);

  // Strictly user-submitted videos (no AI/seed content), enriched with latest creator profile photo
  const allVideos = useMemo<SwappyVideo[]>(() => {
    const mergedMap = new Map<string, SwappyVideo>();

    const enrichVideo = (v: SwappyVideo): SwappyVideo => {
      const latestProf =
        currentUser && v.authorId === currentUser.uid && profile
          ? profile
          : publicProfilesMap[v.authorId];
      return {
        ...v,
        authorHandle: latestProf?.handle || v.authorHandle,
        authorName: latestProf?.displayName || v.authorName,
        authorAvatarColor: latestProf?.avatarColor || v.authorAvatarColor,
        authorAvatarUrl: latestProf?.avatarUrl ?? v.authorAvatarUrl,
        localVideoUrl: localBlobUrls[v.id] || v.localVideoUrl,
      };
    };

    for (const v of remotePublicVideos) {
      mergedMap.set(v.id, enrichVideo(v));
    }
    for (const v of remoteOwnVideos) {
      mergedMap.set(v.id, enrichVideo(v));
    }

    return Array.from(mergedMap.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [remotePublicVideos, remoteOwnVideos, localBlobUrls, publicProfilesMap, currentUser, profile]);

  const enrichedComments = useMemo<SwappyComment[]>(() => {
    return remoteComments.map((c) => {
      const latestProf =
        currentUser && c.authorId === currentUser.uid && profile
          ? profile
          : publicProfilesMap[c.authorId];
      if (!latestProf) return c;
      return {
        ...c,
        authorHandle: latestProf.handle || c.authorHandle,
        authorName: latestProf.displayName || c.authorName,
        authorAvatarColor: latestProf.avatarColor || c.authorAvatarColor,
        authorAvatarUrl: latestProf.avatarUrl ?? c.authorAvatarUrl,
      };
    });
  }, [remoteComments, publicProfilesMap, currentUser, profile]);

  const feedVideos = useMemo<SwappyVideo[]>(() => {
    const publicOrOwn = allVideos.filter(
      (v) => v.visibility === 'public' || (currentUser && v.authorId === currentUser.uid)
    );
    if (feedTab === FeedTab.FOLLOWING) {
      return publicOrOwn.filter((v) => followingIds.has(v.authorId));
    }
    return publicOrOwn;
  }, [allVideos, feedTab, followingIds, currentUser]);

  const activeVideo = feedVideos[activeIndex] ?? feedVideos[0] ?? null;

  const getCommentsForVideo = useCallback(
    (videoId: string): SwappyComment[] => {
      return enrichedComments.filter((c) => c.videoId === videoId);
    },
    [enrichedComments]
  );

  const handleFeedScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    if (container.clientHeight <= 0) return;
    const nextIdx = Math.round(container.scrollTop / container.clientHeight);
    if (nextIdx !== activeIndex && nextIdx >= 0 && nextIdx < feedVideos.length) {
      setActiveIndex(nextIdx);
    }
  };

  const scrollToSlide = useCallback(
    (index: number) => {
      if (feedVideos.length === 0) return;
      const clamped = Math.max(0, Math.min(feedVideos.length - 1, index));
      setActiveIndex(clamped);
      if (feedScrollRef.current) {
        feedScrollRef.current.scrollTo({
          top: clamped * feedScrollRef.current.clientHeight,
          behavior: 'smooth',
        });
      }
    },
    [feedVideos.length]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        navTab !== NavTab.HOME ||
        isCreateOpen ||
        isLanguageModalOpen ||
        commentsTargetVideoId
      ) {
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        scrollToSlide(activeIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        scrollToSlide(activeIndex - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    navTab,
    activeIndex,
    scrollToSlide,
    isCreateOpen,
    isLanguageModalOpen,
    commentsTargetVideoId,
  ]);

  const handleSignIn = async () => {
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await ensureUserProfile(cred.user);
      showToast('Zalogowano w Swappy');
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
      if (code === 'auth/unauthorized-domain') {
        showToast(`Dodaj domenę ${window.location.hostname} w Firebase → Authorized domains`);
      } else {
        showToast('Logowanie zostało przerwane');
      }
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    showToast('Wylogowano z konta');
  };

  const handleToggleLike = async (video: SwappyVideo, forceLike = false) => {
    if (!currentUser) {
      await handleSignIn();
      return;
    }

    const currentlyLiked = likedIds.has(video.id);
    if (forceLike && currentlyLiked) return;

    const uid = currentUser.uid;
    const likeId = `${uid}_${video.id}`;
    const likeRef = doc(db, 'likes', likeId);

    try {
      const batch = writeBatch(db);
      if (currentlyLiked && !forceLike) {
        batch.delete(likeRef);
        batch.update(doc(db, 'videos', video.id), {
          likesCount: increment(-1),
          updatedAt: serverTimestamp(),
        });
      } else if (!currentlyLiked) {
        batch.set(likeRef, {
          userId: uid,
          videoId: video.id,
          createdAt: serverTimestamp(),
        });
        batch.update(doc(db, 'videos', video.id), {
          likesCount: increment(1),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `likes/${likeId}`);
    }
  };

  const handleToggleBookmark = async (video: SwappyVideo) => {
    if (!currentUser) {
      await handleSignIn();
      return;
    }

    const currentlySaved = bookmarkedIds.has(video.id);
    const bookmarkId = `${currentUser.uid}_${video.id}`;
    const bookmarkRef = doc(db, 'bookmarks', bookmarkId);

    try {
      if (currentlySaved) {
        await deleteDoc(bookmarkRef);
        showToast('Usunięto z zapisanych');
      } else {
        await setDoc(bookmarkRef, {
          userId: currentUser.uid,
          videoId: video.id,
          createdAt: serverTimestamp(),
        });
        showToast('Zapisano film w ulubionych');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `bookmarks/${bookmarkId}`);
    }
  };

  const handleToggleFollow = async (authorId: string, authorHandle: string) => {
    if (!currentUser) {
      await handleSignIn();
      return;
    }
    if (authorId === currentUser.uid) return;

    await ensureUserProfile(currentUser);
    const isFollowing = followingIds.has(authorId);
    const followId = `${currentUser.uid}_${authorId}`;
    const followRef = doc(db, 'follows', followId);

    try {
      if (isFollowing) {
        await deleteDoc(followRef);
        showToast(`Przestano obserwować @${authorHandle}`);
      } else {
        await setDoc(followRef, {
          followerId: currentUser.uid,
          followingId: authorId,
          createdAt: serverTimestamp(),
        });
        showToast(`Obserwujesz @${authorHandle}`);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `follows/${followId}`);
    }
  };

  const handleAddComment = async (video: SwappyVideo, rawText: string) => {
    if (!currentUser) {
      await handleSignIn();
      return;
    }
    const text = sanitizeCommentText(rawText);
    if (!text) return;

    setIsSubmittingComment(true);
    try {
      const userProf = profile ?? (await ensureUserProfile(currentUser));
      const commentId = generateSafeId('cmt');
      const commentPayload = {
        videoId: video.id,
        authorId: currentUser.uid,
        authorHandle: sanitizeHandle(userProf.handle),
        authorName: sanitizeDisplayName(userProf.displayName),
        authorAvatarColor: sanitizeAvatarColor(userProf.avatarColor),
        authorAvatarUrl: sanitizeOptionalMediaUrl(userProf.avatarUrl || ''),
        text,
        visibility: 'public' as const,
        createdAt: serverTimestamp(),
      };

      const batch = writeBatch(db);
      batch.set(doc(db, 'comments', commentId), commentPayload);
      batch.update(doc(db, 'videos', video.id), {
        commentsCount: increment(1),
        lastCommentId: commentId,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'comments');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handlePublishVideo = async (submission: NewVideoSubmission) => {
    if (!currentUser) return;
    setIsPublishing(true);

    try {
      const userProf = profile ?? (await ensureUserProfile(currentUser));
      const videoId = generateSafeId('vid');

      let resolvedVideoUrl = submission.externalVideoUrl || '';

      if (submission.recordedBlob) {
        const uploadResp = await fetch('/api/videos/upload', {
          method: 'POST',
          headers: {
            'Content-Type': submission.recordedBlob.type || 'video/webm',
            'X-Video-Id': videoId,
          },
          body: submission.recordedBlob,
        });

        if (!uploadResp.ok) {
          throw new Error('Nie udało się przesłać pliku wideo na serwer.');
        }

        const uploadData = (await uploadResp.json()) as { videoUrl: string };
        resolvedVideoUrl = uploadData.videoUrl;

        const localUrl = await saveLocalVideoBlob(videoId, submission.recordedBlob);
        setLocalBlobUrls((prev) => ({ ...prev, [videoId]: localUrl }));
      }

      const sanitizedAudioUrl = sanitizeOptionalMediaUrl(submission.musicAudioUrl);
      const sanitizedCoverUrl = sanitizeOptionalMediaUrl(submission.musicCoverUrl);

      const payload = {
        authorId: currentUser.uid,
        authorHandle: sanitizeHandle(userProf.handle),
        authorName: sanitizeDisplayName(userProf.displayName),
        authorAvatarColor: sanitizeAvatarColor(userProf.avatarColor),
        authorAvatarUrl: sanitizeOptionalMediaUrl(userProf.avatarUrl || ''),
        videoUrl: sanitizeVideoUrl(resolvedVideoUrl),
        caption: sanitizeCaption(submission.caption),
        hashtags: sanitizeHashtags(submission.hashtags),
        musicTitle: sanitizeMusicTitle(submission.musicTitle),
        musicArtist: sanitizeMusicArtist(submission.musicArtist),
        musicAudioUrl: sanitizedAudioUrl,
        musicCoverUrl: sanitizedCoverUrl,
        originalVolume: sanitizeVolumePercent(submission.originalVolume, 100),
        musicVolume: sanitizedAudioUrl
          ? sanitizeVolumePercent(submission.musicVolume, 90)
          : 0,
        overlayText: sanitizeOverlayText(submission.overlayText),
        colorFilter: sanitizeColorFilter(submission.colorFilter),
        visibility: submission.visibility,
        likesCount: 0,
        commentsCount: 0,
        lastCommentId: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'videos', videoId), payload);
      setIsCreateOpen(false);
      setNavTab(NavTab.HOME);
      setFeedTab(FeedTab.FOR_YOU);
      setActiveIndex(0);
      if (feedScrollRef.current) {
        feedScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      showToast('Twój film został opublikowany na Swappy!');
    } catch (error) {
      if (error instanceof Error && error.message.includes('przesłać pliku')) {
        showToast(error.message);
      } else {
        handleFirestoreError(error, OperationType.CREATE, 'videos');
      }
    } finally {
      setIsPublishing(false);
    }
  };

  const handleDeleteVideo = async (video: SwappyVideo) => {
    if (!currentUser || video.authorId !== currentUser.uid) return;
    try {
      await deleteDoc(doc(db, 'videos', video.id));
      void fetch(`/api/videos/${video.id}`, { method: 'DELETE' }).catch(() => {});
      setActiveIndex(0);
      showToast('Usunięto Twój film');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `videos/${video.id}`);
    }
  };

  const handleUpdateProfile = async (updates: {
    handle: string;
    displayName: string;
    bio: string;
    avatarColor: string;
    avatarUrl: string;
  }) => {
    if (!currentUser) return;
    const sanitizedAvatarUrl = sanitizeOptionalMediaUrl(updates.avatarUrl);
    const sanitized = {
      handle: sanitizeHandle(updates.handle),
      displayName: sanitizeDisplayName(updates.displayName),
      bio: sanitizeBio(updates.bio),
      avatarColor: sanitizeAvatarColor(updates.avatarColor),
      avatarUrl: sanitizedAvatarUrl,
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, 'profiles', currentUser.uid), sanitized);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              handle: sanitized.handle,
              displayName: sanitized.displayName,
              bio: sanitized.bio,
              avatarColor: sanitized.avatarColor,
              avatarUrl: sanitized.avatarUrl,
            }
          : null
      );
      showToast('Zaktualizowano profil');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `profiles/${currentUser.uid}`);
    }
  };

  const handleOpenVideoFromGrid = (videoId: string) => {
    setFeedTab(FeedTab.FOR_YOU);
    setNavTab(NavTab.HOME);
    const idx = allVideos.findIndex((v) => v.id === videoId);
    if (idx >= 0) {
      window.setTimeout(() => {
        scrollToSlide(idx);
      }, 40);
    }
  };

  const handleShareVideo = async (video: SwappyVideo) => {
    const shareUrl = `${window.location.origin}/`;
    const shareTitle = `@${video.authorHandle} na Swappy`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: video.caption || shareTitle,
          url: shareUrl,
        });
        return;
      } catch {
        // User cancelled share sheet
      }
    }
    await copyTextSafe(shareUrl);
    showToast('Skopiowano link do filmu');
  };

  const handleShareProfile = async () => {
    const shareUrl = `${window.location.origin}/`;
    const shareTitle = profile ? `@${profile.handle} na Swappy` : 'Swappy';
    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareTitle,
          url: shareUrl,
        });
        return;
      } catch {
        // User cancelled share sheet
      }
    }
    await copyTextSafe(shareUrl);
    showToast('Skopiowano link do profilu');
  };

  const commentsSheetVideo = commentsTargetVideoId
    ? allVideos.find((v) => v.id === commentsTargetVideoId) ?? null
    : null;

  return (
    <div
      key={lang}
      translate="no"
      className="notranslate h-dvh w-full bg-[#050507] text-white flex justify-center overflow-hidden"
    >
      <div className="relative h-dvh w-full max-w-[430px] bg-[#0A0A0C] flex flex-col overflow-hidden sm:border-x sm:border-white/10 shadow-2xl">
        <OfflineIndicator />

        {toastMessage && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 max-w-[90%] rounded-xl bg-zinc-900/95 border border-white/15 px-4 py-2 text-xs font-semibold text-white text-center shadow-xl backdrop-blur-md pointer-events-none">
            {toastMessage}
          </div>
        )}

        {/* MOBILE APPLICATION VIEWPORT STAGE */}
        <main className="relative flex-1 h-full overflow-hidden flex items-center justify-center bg-[#0A0A0C]">
          {navTab === NavTab.HOME ? (
            <div className="relative w-full h-full flex items-center justify-center">
              <WebsiteInstallBanner
                dismissed={isInstallBannerDismissed}
                onDismiss={() => {
                  setIsInstallBannerDismissed(true);
                  try {
                    sessionStorage.setItem('swappy_web_install_dismissed', '1');
                  } catch {
                    // Ignore storage restrictions
                  }
                }}
                onOpenModal={() => setIsInstallModalOpen(true)}
              />

              {/* Mobile Floating Top Bar: [LIVE]   Obserwowane | Dla Ciebie   [Instaluj?][Język][Szukaj] */}
              <header className="absolute top-0 inset-x-0 z-30 h-13 px-2.5 flex items-center justify-between pointer-events-none">
                <button
                  type="button"
                  onClick={() => {
                    setLiveInitialMode('lobby');
                    setNavTab(NavTab.LIVE);
                  }}
                  aria-label="Transmisje na żywo LIVE"
                  className="pointer-events-auto min-h-[38px] px-2.5 rounded-full bg-[#FE2C55] hover:bg-[#e6254b] shadow-md flex items-center gap-1.5 text-white cursor-pointer active:scale-95 transition-transform"
                >
                  <Radio className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[12px] font-extrabold tracking-wide uppercase">
                    LIVE
                  </span>
                  {liveStreamsCount > 0 && (
                    <span className="rounded-full bg-white text-[#FE2C55] px-1.5 text-[10px] font-mono tabular-nums font-extrabold">
                      {liveStreamsCount}
                    </span>
                  )}
                </button>

                <div className="pointer-events-auto flex items-center gap-3.5">
                  <button
                    type="button"
                    onClick={() => setFeedTab(FeedTab.FOLLOWING)}
                    className={`min-h-[44px] text-[14px] sm:text-[15px] font-bold tracking-tight transition-opacity whitespace-nowrap cursor-pointer relative flex items-center ${
                      feedTab === FeedTab.FOLLOWING
                        ? 'text-white'
                        : 'text-white/65 hover:text-white/90'
                    }`}
                  >
                    <span>{t('navFollowing')}</span>
                    {feedTab === FeedTab.FOLLOWING && (
                      <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-7 h-[3px] rounded-full bg-white" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setFeedTab(FeedTab.FOR_YOU)}
                    className={`min-h-[44px] text-[14px] sm:text-[15px] font-bold tracking-tight transition-opacity whitespace-nowrap cursor-pointer relative flex items-center ${
                      feedTab === FeedTab.FOR_YOU
                        ? 'text-white'
                        : 'text-white/65 hover:text-white/90'
                    }`}
                  >
                    <span>{t('navForYou')}</span>
                    {feedTab === FeedTab.FOR_YOU && (
                      <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-7 h-[3px] rounded-full bg-white" />
                    )}
                  </button>
                </div>

                <div className="pointer-events-auto flex items-center">
                  {canShowWebInstallOption && isInstallBannerDismissed && (
                    <button
                      type="button"
                      onClick={() => setIsInstallModalOpen(true)}
                      aria-label={t('installApp')}
                      title={t('installApp')}
                      className="min-h-[44px] min-w-[36px] flex items-center justify-center text-[#25F4EE] hover:text-white cursor-pointer"
                    >
                      <Download className="w-4.5 h-4.5 drop-shadow" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsLanguageModalOpen(true)}
                    aria-label={t('changeLanguage')}
                    className="min-h-[44px] min-w-[36px] flex items-center justify-center text-white/90 hover:text-white cursor-pointer"
                  >
                    <Globe className="w-4.5 h-4.5 drop-shadow" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setNavTab(NavTab.DISCOVER)}
                    aria-label={t('navDiscover')}
                    className="min-h-[44px] min-w-[36px] flex items-center justify-center text-white/90 hover:text-white cursor-pointer"
                  >
                    <Search className="w-4.5 h-4.5 drop-shadow" />
                  </button>
                </div>
              </header>

              {videosLoading ? (
                <div className="flex flex-col items-center justify-center text-center px-6 space-y-3">
                  <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-[#FE2C55] animate-spin" />
                  <p className="text-xs font-medium text-zinc-400">{t('loadingVideos')}</p>
                </div>
              ) : feedVideos.length === 0 ? (
                <div className="w-full h-full bg-[#0F0F14] flex flex-col items-center justify-center text-center px-7 pb-14">
                  {activeLiveStreams.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setLiveJoinStreamId(activeLiveStreams[0].id);
                        setNavTab(NavTab.LIVE);
                      }}
                      className="mb-5 px-4 py-2 rounded-2xl bg-[#FE2C55]/20 border border-[#FE2C55]/50 flex items-center gap-2 text-xs font-extrabold text-white cursor-pointer hover:bg-[#FE2C55]/30 transition-colors"
                    >
                      <Radio className="w-4 h-4 text-[#FE2C55]" />
                      <span>LIVE: @{activeLiveStreams[0].hostHandle}</span>
                    </button>
                  )}

                  <div className="mb-5">
                    <SwappyLogo showWordmark={false} size="lg" />
                  </div>

                  <h1 className="text-xl font-extrabold tracking-tight text-white text-balance">
                    {feedTab === FeedTab.FOLLOWING
                      ? t('emptyFollowingTitle')
                      : t('emptyForYouTitle')}
                  </h1>

                  <p className="mt-2 text-sm text-zinc-400 leading-relaxed max-w-xs text-balance">
                    {feedTab === FeedTab.FOLLOWING
                      ? t('emptyFollowingDesc')
                      : t('emptyForYouDesc')}
                  </p>

                  <div className="mt-6 w-full max-w-[275px] space-y-2.5">
                    <button
                      type="button"
                      onClick={() => setIsCreateOpen(true)}
                      className="w-full min-h-[48px] rounded-xl bg-[#FE2C55] hover:bg-[#e6254b] active:scale-[0.98] transition-all px-5 text-sm font-bold text-white flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Film className="w-4 h-4 shrink-0" />
                      <span className="truncate">{t('postVideoWithMusic')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setLiveInitialMode('setup');
                        setNavTab(NavTab.LIVE);
                      }}
                      className="w-full min-h-[46px] rounded-xl bg-white/[0.09] hover:bg-white/[0.15] border border-[#FE2C55]/45 px-4 text-xs font-extrabold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Radio className="w-4 h-4 text-[#FE2C55] shrink-0" />
                      <span className="truncate">{t('startLiveStream')}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  ref={feedScrollRef}
                  onScroll={handleFeedScroll}
                  className="w-full h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar"
                >
                  {feedVideos.map((video, idx) => (
                    <div key={video.id} className="w-full h-full snap-start snap-always">
                      <VideoCard
                        video={video}
                        isActive={idx === activeIndex && navTab === NavTab.HOME}
                        isMuted={isMuted}
                        isLiked={likedIds.has(video.id)}
                        isBookmarked={bookmarkedIds.has(video.id)}
                        isFollowingCreator={followingIds.has(video.authorId)}
                        isOwnVideo={Boolean(currentUser && video.authorId === currentUser.uid)}
                        onToggleMute={() => setIsMuted((m) => !m)}
                        onToggleLike={handleToggleLike}
                        onToggleBookmark={handleToggleBookmark}
                        onToggleFollow={handleToggleFollow}
                        onOpenComments={(v) => setCommentsTargetVideoId(v.id)}
                        onOpenShare={handleShareVideo}
                        onDeleteVideo={handleDeleteVideo}
                        onSelectHashtag={(tag) => {
                          setDiscoverHashtag(tag);
                          setNavTab(NavTab.DISCOVER);
                        }}
                        onSelectCreator={() => {
                          if (currentUser && video.authorId === currentUser.uid) {
                            setNavTab(NavTab.PROFILE);
                          } else {
                            setDiscoverHashtag(video.authorHandle);
                            setNavTab(NavTab.DISCOVER);
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : navTab === NavTab.LIVE ? (
            <LiveStreamView
              isSignedIn={Boolean(currentUser)}
              profile={profile}
              followersCount={followersCount}
              initialMode={liveInitialMode}
              initialJoinStreamId={liveJoinStreamId}
              autoStartConfig={liveAutoStartConfig}
              onResetInitialMode={() => setLiveInitialMode('lobby')}
              onConsumeAutoStart={() => setLiveAutoStartConfig(null)}
              onClearInitialJoin={() => setLiveJoinStreamId(null)}
              onSignIn={handleSignIn}
              onBackToFeed={() => setNavTab(NavTab.HOME)}
            />
          ) : navTab === NavTab.DISCOVER ? (
            <DiscoverView
              videos={allVideos}
              liveStreams={activeLiveStreams}
              initialHashtag={discoverHashtag}
              onClearHashtag={() => setDiscoverHashtag(null)}
              onOpenVideoInFeed={handleOpenVideoFromGrid}
              onOpenCreate={() => setIsCreateOpen(true)}
              onOpenLiveLobby={() => {
                setLiveInitialMode('lobby');
                setNavTab(NavTab.LIVE);
              }}
              onStartLiveSetup={() => {
                setLiveInitialMode('setup');
                setNavTab(NavTab.LIVE);
              }}
              onJoinLiveStream={(streamId) => {
                setLiveJoinStreamId(streamId);
                setNavTab(NavTab.LIVE);
              }}
            />
          ) : navTab === NavTab.INBOX ? (
            <InboxView
              likedIds={likedIds}
              followingIds={followingIds}
              recentComments={enrichedComments}
              videos={allVideos}
              onOpenVideoInFeed={handleOpenVideoFromGrid}
            />
          ) : (
            <ProfileView
              profile={profile}
              isSignedIn={Boolean(currentUser)}
              videos={allVideos}
              likedIds={likedIds}
              bookmarkedIds={bookmarkedIds}
              followingCount={followingIds.size}
              followersCount={followersCount}
              onSignIn={handleSignIn}
              onSignOut={handleSignOut}
              onUpdateProfile={handleUpdateProfile}
              onOpenVideoInFeed={handleOpenVideoFromGrid}
              onOpenCreate={() => setIsCreateOpen(true)}
              onShareProfile={handleShareProfile}
              onOpenLanguageModal={() => setIsLanguageModalOpen(true)}
              canInstallApp={canShowWebInstallOption}
              onOpenInstallModal={() => setIsInstallModalOpen(true)}
            />
          )}
        </main>

        {/* MOBILE APPLICATION BOTTOM NAVIGATION BAR */}
        <nav
          aria-label="Główna nawigacja mobilna"
          className="absolute bottom-0 inset-x-0 z-40 h-14 bg-[#0A0A0C]/95 backdrop-blur-md border-t border-white/10 grid grid-cols-6 items-center px-1"
        >
          <button
            type="button"
            onClick={() => setNavTab(NavTab.HOME)}
            className={`min-h-[48px] flex flex-col items-center justify-center cursor-pointer px-0.5 ${
              navTab === NavTab.HOME ? 'text-white' : 'text-zinc-500'
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[10px] font-semibold mt-0.5 truncate max-w-full">
              {t('navHome')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setNavTab(NavTab.DISCOVER)}
            className={`min-h-[48px] flex flex-col items-center justify-center cursor-pointer px-0.5 ${
              navTab === NavTab.DISCOVER ? 'text-white' : 'text-zinc-500'
            }`}
          >
            <Compass className="w-5 h-5" />
            <span className="text-[10px] font-semibold mt-0.5 truncate max-w-full">
              {t('navDiscover')}
            </span>
          </button>

          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              aria-label={t('navPostVideo')}
              className="relative w-12 h-8 flex items-center justify-center active:scale-95 transition-transform cursor-pointer"
            >
              <span
                className="absolute inset-y-0 left-0 w-9 rounded-lg bg-[#25F4EE]"
                aria-hidden="true"
              />
              <span
                className="absolute inset-y-0 right-0 w-9 rounded-lg bg-[#FE2C55]"
                aria-hidden="true"
              />
              <span className="relative z-10 w-10 h-full rounded-lg bg-white text-black flex items-center justify-center">
                <Plus className="w-5 h-5 stroke-[2.8]" />
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setLiveInitialMode('lobby');
              setNavTab(NavTab.LIVE);
            }}
            className={`min-h-[48px] flex flex-col items-center justify-center relative cursor-pointer px-0.5 ${
              navTab === NavTab.LIVE ? 'text-[#FE2C55]' : 'text-zinc-400'
            }`}
          >
            <Radio className="w-5 h-5 text-[#FE2C55]" />
            <span className="text-[10px] font-bold mt-0.5 whitespace-nowrap">LIVE</span>
            {liveStreamsCount > 0 && (
              <span className="absolute top-1 right-2 rounded-full bg-[#FE2C55] px-1 text-[9px] font-mono tabular-nums font-extrabold text-white">
                {liveStreamsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setNavTab(NavTab.INBOX)}
            className={`min-h-[48px] flex flex-col items-center justify-center cursor-pointer px-0.5 ${
              navTab === NavTab.INBOX ? 'text-white' : 'text-zinc-500'
            }`}
          >
            <MessageSquare className="w-5 h-5" />
            <span className="text-[10px] font-semibold mt-0.5 truncate max-w-full">
              {t('navInbox')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setNavTab(NavTab.PROFILE)}
            className={`min-h-[48px] flex flex-col items-center justify-center cursor-pointer px-0.5 ${
              navTab === NavTab.PROFILE ? 'text-white' : 'text-zinc-500'
            }`}
          >
            {currentUser && profile?.avatarUrl ? (
              <UserAvatar
                src={profile.avatarUrl}
                name={profile.displayName}
                color={profile.avatarColor}
                className={`w-5 h-5 ${
                  navTab === NavTab.PROFILE ? 'ring-1.5 ring-white' : 'opacity-85'
                }`}
                textClassName="text-[9px]"
              />
            ) : (
              <UserIcon className="w-5 h-5" />
            )}
            <span className="text-[10px] font-semibold mt-0.5 truncate max-w-full">
              {t('navProfile')}
            </span>
          </button>
        </nav>

        {/* Mobile Comments Slide-Up Sheet */}
        <CommentsSheet
          video={commentsSheetVideo}
          comments={commentsSheetVideo ? getCommentsForVideo(commentsSheetVideo.id) : []}
          isSignedIn={Boolean(currentUser)}
          isSubmitting={isSubmittingComment}
          onClose={() => setCommentsTargetVideoId(null)}
          onAddComment={handleAddComment}
          onSignIn={handleSignIn}
        />

        {/* Creator Camera, Upload, Worldwide Music & LIVE Modal */}
        <CreateVideoModal
          isOpen={isCreateOpen}
          isSignedIn={Boolean(currentUser)}
          isPublishing={isPublishing}
          profile={profile}
          followersCount={followersCount}
          onClose={() => setIsCreateOpen(false)}
          onSignIn={handleSignIn}
          onPublish={handlePublishVideo}
          onStartLiveBroadcast={(config) => {
            if (!currentUser || followersCount < 500) {
              showToast('Transmisje LIVE są dostępne dopiero od 500 obserwujących');
              setLiveAutoStartConfig(null);
              setLiveInitialMode('setup');
              setNavTab(NavTab.LIVE);
              return;
            }
            setLiveAutoStartConfig(config);
            setLiveInitialMode('setup');
            setNavTab(NavTab.LIVE);
          }}
        />

        {/* Global Language Switcher Modal (Original Polish + All World Languages) */}
        <LanguageModal
          isOpen={isLanguageModalOpen}
          onClose={() => setIsLanguageModalOpen(false)}
          onLanguageSelected={(msg) => showToast(msg)}
        />

        {/* Website-Only App Installation Modal (Hidden in Installed Standalone App) */}
        <InstallAppModal
          isOpen={isInstallModalOpen}
          onClose={() => setIsInstallModalOpen(false)}
        />
      </div>
    </div>
  );
}
