import React, { useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  Check,
  Disc3,
  Globe,
  Loader2,
  Music,
  Pause,
  Play,
  Search,
  Upload,
  VolumeX,
  X,
} from 'lucide-react';
import {
  auth,
  db,
  generateSafeId,
  handleFirestoreError,
  OperationType,
  sanitizeHandle,
  sanitizeMusicArtist,
  sanitizeMusicTitle,
  sanitizeOptionalMediaUrl,
} from '../firebase';
import { MusicTrack, PublicProfile } from '../types';

interface MusicPickerModalProps {
  isOpen: boolean;
  selectedTrack: MusicTrack | null;
  isSignedIn: boolean;
  profile: PublicProfile | null;
  onSelectTrack: (track: MusicTrack | null) => void;
  onClose: () => void;
}

type MusicCategoryTab = 'pl' | 'global' | 'phonk' | 'rap' | 'pop' | 'custom';

const CATEGORY_TABS: { id: MusicCategoryTab; label: string; query?: string }[] = [
  { id: 'pl', label: 'Hity Polska' },
  { id: 'global', label: 'Światowe Top' },
  { id: 'phonk', label: 'Phonk & Viral', query: 'phonk viral' },
  { id: 'rap', label: 'Polski Rap', query: 'polski rap hip hop' },
  { id: 'pop', label: 'Pop & Dance', query: 'dance pop hits' },
  { id: 'custom', label: 'Własne MP3' },
];

export const MusicPickerModal: React.FC<MusicPickerModalProps> = ({
  isOpen,
  selectedTrack,
  isSignedIn,
  profile,
  onSelectTrack,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<MusicCategoryTab>('pl');
  const [catalogTracks, setCatalogTracks] = useState<MusicTrack[]>([]);
  const [communityTracks, setCommunityTracks] = useState<MusicTrack[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [brokenCoverIds, setBrokenCoverIds] = useState<Set<string>>(new Set());

  // Custom MP3 upload state
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customArtist, setCustomArtist] = useState('');
  const [directAudioUrl, setDirectAudioUrl] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);

  const stopPreviewAudio = () => {
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current.currentTime = 0;
    }
    setPlayingTrackId(null);
  };

  useEffect(() => {
    if (!isOpen) {
      stopPreviewAudio();
      return;
    }
    setUploadError(null);
  }, [isOpen]);

  // Listen to community-uploaded sounds in Firestore
  useEffect(() => {
    if (!isOpen) return;
    const soundsQuery = query(
      collection(db, 'sounds'),
      where('visibility', '==', 'public')
    );
    const unsub = onSnapshot(
      soundsQuery,
      (snap) => {
        const loaded: MusicTrack[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            title: String(data.title || 'Utwór społeczności'),
            artist: String(data.artistName || `@${String(data.authorHandle || 'swappy')}`),
            audioUrl: String(data.audioUrl || ''),
            coverUrl: '',
            source: 'community',
          };
        });
        setCommunityTracks(loaded.filter((t) => Boolean(t.audioUrl)));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'sounds');
      }
    );
    return () => unsub();
  }, [isOpen]);

  // Fetch global music catalog whenever searchQuery or activeCategory changes
  useEffect(() => {
    if (!isOpen) return;
    const trimmed = searchQuery.trim();

    if (!trimmed && activeCategory === 'custom') {
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const timer = window.setTimeout(
      async () => {
        try {
          let endpoint = '/api/music/trending?chart=pl';
          if (trimmed) {
            endpoint = `/api/music/search?q=${encodeURIComponent(trimmed)}`;
          } else if (activeCategory === 'global') {
            endpoint = '/api/music/trending?chart=global';
          } else {
            const tabConfig = CATEGORY_TABS.find((t) => t.id === activeCategory);
            if (tabConfig?.query) {
              endpoint = `/api/music/search?q=${encodeURIComponent(tabConfig.query)}`;
            }
          }

          const resp = await fetch(endpoint);
          if (!resp.ok) throw new Error('Network error');
          const data = (await resp.json()) as { tracks?: MusicTrack[] };
          if (!cancelled) {
            setCatalogTracks(
              Array.isArray(data.tracks)
                ? data.tracks.map((t) => ({ ...t, source: 'catalog' }))
                : []
            );
          }
        } catch {
          if (!cancelled) {
            setCatalogTracks([]);
          }
        } finally {
          if (!cancelled) {
            setIsLoading(false);
          }
        }
      },
      trimmed ? 280 : 10
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, searchQuery, activeCategory]);

  if (!isOpen) return null;

  const togglePreviewTrack = (track: MusicTrack) => {
    const audioEl = audioPreviewRef.current;
    if (!audioEl || !track.audioUrl) return;

    if (playingTrackId === track.id) {
      audioEl.pause();
      setPlayingTrackId(null);
      return;
    }

    audioEl.src = track.audioUrl;
    audioEl.currentTime = 0;
    setPlayingTrackId(track.id);
    void audioEl.play().catch(() => {
      setPlayingTrackId(null);
    });
  };

  const handleChooseTrack = (track: MusicTrack | null) => {
    stopPreviewAudio();
    onSelectTrack(track);
    onClose();
  };

  const handleUploadCustomAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 24 * 1024 * 1024) {
      setUploadError('Maksymalny rozmiar pliku MP3/M4A to 24 MB.');
      return;
    }

    setUploadError(null);
    setIsUploadingAudio(true);

    try {
      const soundId = generateSafeId('snd');
      const resp = await fetch('/api/audio/upload', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'audio/mpeg',
          'X-Sound-Id': soundId,
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: file,
      });

      if (!resp.ok) {
        throw new Error('Nie udało się przesłać pliku muzycznego.');
      }

      const { audioUrl } = (await resp.json()) as { audioUrl: string };
      const baseFileName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
      const resolvedTitle = sanitizeMusicTitle(customTitle.trim() || baseFileName || 'Własny utwór');
      const resolvedArtist =
        sanitizeMusicArtist(
          customArtist.trim() || profile?.displayName || 'Własny dźwięk'
        ) || 'Własny dźwięk';

      // Save to public community sounds if user is signed in with verified Google account
      if (isSignedIn && auth.currentUser?.uid && auth.currentUser.emailVerified) {
        try {
          await setDoc(doc(db, 'sounds', soundId), {
            authorId: auth.currentUser.uid,
            authorHandle: sanitizeHandle(profile?.handle || 'tworca'),
            title: resolvedTitle,
            artistName: resolvedArtist,
            audioUrl: sanitizeOptionalMediaUrl(audioUrl),
            visibility: 'public',
            createdAt: serverTimestamp(),
          });
        } catch {
          // Even if community listing save is skipped, user can still use the uploaded audio directly
        }
      }

      handleChooseTrack({
        id: soundId,
        title: resolvedTitle,
        artist: resolvedArtist,
        audioUrl,
        coverUrl: '',
        source: 'community',
      });
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Wystąpił błąd podczas wgrywania pliku audio.'
      );
    } finally {
      setIsUploadingAudio(false);
    }
  };

  const handleUseDirectAudioUrl = () => {
    const cleanedUrl = sanitizeOptionalMediaUrl(directAudioUrl);
    if (!cleanedUrl) {
      setUploadError('Podaj prawidłowy bezpośredni link HTTPS do pliku MP3 lub M4A.');
      return;
    }
    const resolvedTitle = sanitizeMusicTitle(customTitle.trim() || 'Piosenka z linku');
    const resolvedArtist = sanitizeMusicArtist(customArtist.trim() || 'Internet Audio');
    handleChooseTrack({
      id: generateSafeId('url'),
      title: resolvedTitle,
      artist: resolvedArtist || 'Internet Audio',
      audioUrl: cleanedUrl,
      coverUrl: '',
      source: 'community',
    });
  };

  const displayedTracks =
    !searchQuery.trim() && activeCategory === 'custom' ? communityTracks : catalogTracks;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 select-none"
      onClick={() => {
        stopPreviewAudio();
        onClose();
      }}
    >
      <audio
        ref={audioPreviewRef}
        onEnded={() => setPlayingTrackId(null)}
        onError={() => setPlayingTrackId(null)}
        className="hidden"
      />

      <input
        ref={audioFileInputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg"
        onChange={handleUploadCustomAudio}
        className="hidden"
      />

      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full h-[88dvh] sm:h-[82dvh] sm:max-w-xl rounded-t-3xl sm:rounded-3xl bg-[#141419] border border-white/15 flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#FE2C55]/15 border border-[#FE2C55]/30 flex items-center justify-center text-[#FE2C55] shrink-0">
              <Globe className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-extrabold text-white truncate">
                Muzyka z internetu — cały świat
              </h2>
              <p className="text-[11px] text-zinc-400 truncate">
                Wyszukaj dowolną piosenkę, artystę lub wgraj własne MP3
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              stopPreviewAudio();
              onClose();
            }}
            aria-label="Zamknij wybór muzyki"
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Worldwide Search Input */}
        <div className="px-4 pt-3 pb-2 space-y-3 shrink-0 bg-[#141419]">
          <div className="relative">
            <Search className="w-4 h-4 text-[#25F4EE] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Wpisz dowolny tytuł piosenki lub wykonawcę na świecie..."
              aria-label="Szukaj piosenki z internetu"
              className="w-full min-h-[46px] rounded-2xl bg-white/[0.07] border border-white/15 pl-10 pr-10 text-sm text-white placeholder:text-zinc-400 focus:outline-none focus:border-[#25F4EE]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Wyczyść wyszukiwanie"
                className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Category Filter Tabs */}
          {!searchQuery.trim() && (
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
              {CATEGORY_TABS.map((tab) => {
                const active = activeCategory === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveCategory(tab.id)}
                    className={`min-h-[36px] px-3.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      active
                        ? 'bg-white text-black'
                        : 'bg-white/[0.06] text-zinc-300 hover:bg-white/[0.11] hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Scrollable Track Results & Custom Upload */}
        <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-2.5 no-scrollbar">
          {/* Option to keep Original Video Audio without extra music */}
          <button
            type="button"
            onClick={() => handleChooseTrack(null)}
            className={`w-full min-h-[52px] px-3.5 py-2 rounded-2xl border flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
              !selectedTrack
                ? 'bg-white/[0.09] border-[#25F4EE]/60 text-white'
                : 'bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/[0.06]'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-300 shrink-0">
                <VolumeX className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">
                  Oryginalny dźwięk z wideo
                </div>
                <div className="text-[11px] text-zinc-400 truncate">
                  Bez dodatkowego podkładu muzycznego
                </div>
              </div>
            </div>
            {!selectedTrack && <Check className="w-4 h-4 text-[#25F4EE] shrink-0" />}
          </button>

          {/* Custom MP3 / Audio Upload Panel when on 'custom' tab */}
          {!searchQuery.trim() && activeCategory === 'custom' && (
            <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 space-y-3">
              <div className="text-xs font-bold text-white">
                Wgraj dowolny plik MP3 / M4A z telefonu lub wklej link
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  maxLength={80}
                  placeholder="Tytuł utworu (opcjonalnie)"
                  className="min-h-[40px] rounded-xl bg-black/45 border border-white/10 px-3 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#25F4EE]"
                />
                <input
                  type="text"
                  value={customArtist}
                  onChange={(e) => setCustomArtist(e.target.value)}
                  maxLength={80}
                  placeholder="Wykonawca (opcjonalnie)"
                  className="min-h-[40px] rounded-xl bg-black/45 border border-white/10 px-3 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#25F4EE]"
                />
              </div>

              <button
                type="button"
                disabled={isUploadingAudio}
                onClick={() => audioFileInputRef.current?.click()}
                className="w-full min-h-[46px] rounded-xl bg-[#FE2C55] hover:bg-[#e6254b] disabled:opacity-50 text-xs font-bold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {isUploadingAudio ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Przesyłanie pliku audio...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span>Wybierz plik MP3 / M4A z urządzenia</span>
                  </>
                )}
              </button>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="url"
                  value={directAudioUrl}
                  onChange={(e) => setDirectAudioUrl(e.target.value)}
                  placeholder="Lub wklej https://.../piosenka.mp3"
                  className="flex-1 min-w-0 min-h-[40px] rounded-xl bg-black/45 border border-white/10 px-3 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#25F4EE]"
                />
                <button
                  type="button"
                  onClick={handleUseDirectAudioUrl}
                  className="min-h-[40px] px-3.5 rounded-xl bg-white text-black text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
                >
                  Dodaj link
                </button>
              </div>

              {uploadError && (
                <p className="text-xs text-rose-300 font-medium">{uploadError}</p>
              )}
            </div>
          )}

          {/* Track List */}
          {isLoading ? (
            <div className="py-14 flex flex-col items-center justify-center gap-2.5 text-zinc-400">
              <Loader2 className="w-7 h-7 animate-spin text-[#FE2C55]" />
              <span className="text-xs font-medium">
                Wyszukiwanie piosenek w światowym katalogu...
              </span>
            </div>
          ) : displayedTracks.length === 0 ? (
            <div className="py-12 text-center space-y-1.5 px-4">
              <Music className="w-8 h-8 text-zinc-600 mx-auto" />
              <p className="text-sm font-bold text-zinc-200">
                {activeCategory === 'custom' && !searchQuery.trim()
                  ? 'Brak wgranych plików MP3 społeczności'
                  : 'Brak wyników dla wpisanej frazy'}
              </p>
              <p className="text-xs text-zinc-500">
                {activeCategory === 'custom' && !searchQuery.trim()
                  ? 'Wgraj wyżej dowolny plik MP3 z telefonu lub wpisz nazwę piosenki w wyszukiwarkę.'
                  : 'Wpisz inną nazwę utworu, wykonawcę lub przełącz na zakładkę Własne MP3.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2 pt-1">
              {displayedTracks.map((track) => {
                const isPreviewing = playingTrackId === track.id;
                const isChosen = selectedTrack?.id === track.id;
                const showCover =
                  Boolean(track.coverUrl) && !brokenCoverIds.has(track.id);

                return (
                  <div
                    key={track.id}
                    className={`min-h-[64px] p-2.5 rounded-2xl border flex items-center justify-between gap-3 transition-colors ${
                      isChosen
                        ? 'bg-[#FE2C55]/15 border-[#FE2C55]/60'
                        : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.07]'
                    }`}
                  >
                    {/* Left: Cover + Play/Pause Preview Trigger */}
                    <button
                      type="button"
                      onClick={() => togglePreviewTrack(track)}
                      aria-label={
                        isPreviewing
                          ? `Zatrzymaj odsłuch ${track.title}`
                          : `Odsłuchaj ${track.title}`
                      }
                      className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer group"
                    >
                      <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-gradient-to-br from-zinc-800 to-zinc-950 border border-white/15 shrink-0 flex items-center justify-center">
                        {showCover ? (
                          <img
                            src={track.coverUrl}
                            alt={`Okładka ${track.title}`}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setBrokenCoverIds((prev) => new Set(prev).add(track.id))
                            }
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Disc3 className="w-6 h-6 text-[#25F4EE]" />
                        )}

                        <div
                          className={`absolute inset-0 flex items-center justify-center transition-colors ${
                            isPreviewing
                              ? 'bg-black/55'
                              : 'bg-black/30 group-hover:bg-black/50'
                          }`}
                        >
                          {isPreviewing ? (
                            <Pause className="w-5 h-5 fill-white text-white" />
                          ) : (
                            <Play className="w-5 h-5 fill-white text-white ml-0.5" />
                          )}
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-bold text-white truncate">
                          {track.title}
                        </div>
                        <div className="text-[11px] sm:text-xs text-zinc-400 truncate mt-0.5">
                          {track.artist}
                          {isPreviewing && (
                            <span className="ml-2 text-[#25F4EE] font-semibold">
                              · Odtwarzanie...
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Right: Primary "Użyj" CTA */}
                    <button
                      type="button"
                      onClick={() => handleChooseTrack(track)}
                      className={`min-h-[40px] px-4 rounded-xl text-xs font-extrabold whitespace-nowrap shrink-0 transition-transform active:scale-95 cursor-pointer flex items-center gap-1.5 ${
                        isChosen
                          ? 'bg-white text-black'
                          : 'bg-[#FE2C55] hover:bg-[#e6254b] text-white'
                      }`}
                    >
                      {isChosen ? (
                        <>
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                          <span>Wybrano</span>
                        </>
                      ) : (
                        <span>Użyj</span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
