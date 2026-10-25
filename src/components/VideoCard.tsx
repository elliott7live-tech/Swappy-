import React, { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  Film,
  Heart,
  MessageCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Share2,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useLanguage } from '../i18n';
import { SwappyVideo } from '../types';
import { getVideoFilterCss } from '../utils/videoFilters';
import { UserAvatar } from './UserAvatar';

export function formatCompactCount(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1).replace('.', ',')} mln`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1).replace('.', ',')} tys.`;
  }
  return String(Math.max(0, num));
}

interface HeartBurst {
  id: number;
  x: number;
  y: number;
  angle: number;
}

interface VideoCardProps {
  video: SwappyVideo;
  isActive: boolean;
  isMuted: boolean;
  isLiked: boolean;
  isBookmarked: boolean;
  isFollowingCreator: boolean;
  isOwnVideo: boolean;
  onToggleMute: () => void;
  onToggleLike: (video: SwappyVideo, forceLike?: boolean) => void;
  onToggleBookmark: (video: SwappyVideo) => void;
  onToggleFollow: (authorId: string, authorHandle: string) => void;
  onOpenComments: (video: SwappyVideo) => void;
  onOpenShare: (video: SwappyVideo) => void;
  onDeleteVideo?: (video: SwappyVideo) => void;
  onSelectHashtag: (tag: string) => void;
  onSelectCreator: (authorId: string, authorHandle: string) => void;
}

export const VideoCard: React.FC<VideoCardProps> = ({
  video,
  isActive,
  isMuted,
  isLiked,
  isBookmarked,
  isFollowingCreator,
  isOwnVideo,
  onToggleMute,
  onToggleLike,
  onToggleBookmark,
  onToggleFollow,
  onOpenComments,
  onOpenShare,
  onDeleteVideo,
  onSelectHashtag,
  onSelectCreator,
}) => {
  const { t } = useLanguage();
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [videoError, setVideoError] = useState(false);
  const [coverError, setCoverError] = useState(false);
  const [heartBursts, setHeartBursts] = useState<HeartBurst[]>([]);
  const [playIndicatorVisible, setPlayIndicatorVisible] = useState(false);

  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const musicElRef = useRef<HTMLAudioElement | null>(null);
  const lastTapRef = useRef<number>(0);
  const singleTapTimeoutRef = useRef<number | null>(null);

  const effectiveSrc = video.localVideoUrl || video.videoUrl;
  const hasAddedMusic = Boolean(video.musicAudioUrl);
  const origVolFraction = Math.max(0, Math.min(1, (video.originalVolume ?? 100) / 100));
  const musicVolFraction = Math.max(0, Math.min(1, (video.musicVolume ?? 85) / 100));

  const marqueeLabel = video.musicArtist
    ? `${video.musicTitle} — ${video.musicArtist}`
    : video.musicTitle;

  useEffect(() => {
    setVideoError(false);
    setCoverError(false);
  }, [effectiveSrc, video.musicCoverUrl]);

  // Synchronize video & attached internet music track lifecycle
  useEffect(() => {
    const el = videoElRef.current;
    const musicEl = musicElRef.current;
    if (!el) return;

    el.volume = origVolFraction;
    el.muted = isMuted || origVolFraction === 0;

    if (musicEl) {
      musicEl.volume = musicVolFraction;
      musicEl.muted = isMuted || musicVolFraction === 0;
    }

    if (isActive) {
      setIsPlaying(true);
      void el.play().catch(() => {
        setIsPlaying(false);
      });
      if (musicEl && hasAddedMusic) {
        musicEl.currentTime = 0;
        void musicEl.play().catch(() => {});
      }
    } else {
      el.pause();
      el.currentTime = 0;
      if (musicEl) {
        musicEl.pause();
        musicEl.currentTime = 0;
      }
      setIsPlaying(false);
      setProgress(0);
    }
  }, [isActive, effectiveSrc, hasAddedMusic, origVolFraction, musicVolFraction]);

  // Sync mute state across both video and attached music track
  useEffect(() => {
    const el = videoElRef.current;
    const musicEl = musicElRef.current;
    if (el) {
      el.volume = origVolFraction;
      el.muted = isMuted || origVolFraction === 0;
    }
    if (musicEl) {
      musicEl.volume = musicVolFraction;
      musicEl.muted = isMuted || musicVolFraction === 0;
      if (!isMuted && isActive && isPlaying && hasAddedMusic && musicEl.paused) {
        void musicEl.play().catch(() => {});
      }
    }
  }, [isMuted, origVolFraction, musicVolFraction, isActive, isPlaying, hasAddedMusic]);

  // Sync Play/Pause tap across both video and attached music track
  useEffect(() => {
    const el = videoElRef.current;
    const musicEl = musicElRef.current;
    if (!el || !isActive) return;
    if (isPlaying) {
      void el.play().catch(() => {});
      if (musicEl && hasAddedMusic) {
        void musicEl.play().catch(() => {});
      }
    } else {
      el.pause();
      musicEl?.pause();
    }
  }, [isPlaying, isActive, hasAddedMusic]);

  const handleStageTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const tapX = e.clientX - rect.left;
    const tapY = e.clientY - rect.top;

    if (now - lastTapRef.current < 280) {
      if (singleTapTimeoutRef.current) {
        window.clearTimeout(singleTapTimeoutRef.current);
        singleTapTimeoutRef.current = null;
      }
      const burstId = now + Math.random();
      const angle = (Math.random() - 0.5) * 28;
      setHeartBursts((prev) => [...prev, { id: burstId, x: tapX, y: tapY, angle }]);
      window.setTimeout(() => {
        setHeartBursts((prev) => prev.filter((b) => b.id !== burstId));
      }, 750);
      onToggleLike(video, true);
    } else {
      if (singleTapTimeoutRef.current) {
        window.clearTimeout(singleTapTimeoutRef.current);
      }
      singleTapTimeoutRef.current = window.setTimeout(() => {
        setIsPlaying((prev) => !prev);
        setPlayIndicatorVisible(true);
        window.setTimeout(() => setPlayIndicatorVisible(false), 450);
        singleTapTimeoutRef.current = null;
      }, 240);
    }
    lastTapRef.current = now;
  };

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setProgress(ratio);
    if (videoElRef.current && videoElRef.current.duration) {
      const targetSec = ratio * videoElRef.current.duration;
      videoElRef.current.currentTime = targetSec;
      if (musicElRef.current && musicElRef.current.duration) {
        musicElRef.current.currentTime = targetSec % musicElRef.current.duration;
      }
    }
  };

  return (
    <article className="snap-start snap-always relative w-full h-full bg-[#0A0A0C] overflow-hidden select-none">
      {/* Attached Internet Song Audio Track */}
      {hasAddedMusic && (
        <audio
          ref={musicElRef}
          src={video.musicAudioUrl}
          loop
          preload="auto"
          className="hidden"
        />
      )}

      {/* Full-Bleed Real HTML5 Video Stage */}
      <div
        onClick={handleStageTap}
        className="relative w-full h-full cursor-pointer overflow-hidden flex items-center justify-center bg-black"
      >
        {!videoError ? (
          <video
            ref={videoElRef}
            src={effectiveSrc}
            playsInline
            loop
            muted={isMuted || origVolFraction === 0}
            preload="metadata"
            onError={() => setVideoError(true)}
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              if (el.duration > 0) {
                setProgress(el.currentTime / el.duration);
              }
            }}
            style={
              video.colorFilter && video.colorFilter !== 'normal'
                ? { filter: getVideoFilterCss(video.colorFilter) }
                : undefined
            }
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-center px-6 space-y-2">
            <Film className="w-10 h-10 text-zinc-600" />
            <p className="text-sm font-semibold text-zinc-300">
              Plik wideo jest chwilowo niedostępny
            </p>
            <p className="text-xs text-zinc-500">@{video.authorHandle}</p>
          </div>
        )}

        {/* Optional Creator Text Overlay */}
        {video.overlayText && (
          <div className="pointer-events-none absolute top-[20%] inset-x-6 flex justify-center z-10">
            <div className="rounded-xl bg-black/65 backdrop-blur-md px-4 py-2 text-center shadow-lg border border-white/10 max-w-[85%]">
              <p className="text-sm sm:text-base font-extrabold tracking-tight text-white text-balance">
                {video.overlayText}
              </p>
            </div>
          </div>
        )}

        {/* Double-Tap Heart Burst Animations */}
        {heartBursts.map((burst) => (
          <div
            key={burst.id}
            style={{
              left: burst.x - 44,
              top: burst.y - 44,
              transform: `rotate(${burst.angle}deg) scale(1.15)`,
            }}
            className="pointer-events-none absolute z-30 w-22 h-22 flex items-center justify-center animate-ping"
          >
            <Heart className="w-20 h-20 fill-[#FE2C55] text-[#FE2C55] drop-shadow-[0_6px_24px_rgba(254,44,85,0.65)]" />
          </div>
        ))}

        {/* Play / Pause Center Indicator */}
        {(!isPlaying || playIndicatorVisible) && !videoError && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center text-white/95 transition-opacity duration-150">
              {isPlaying ? (
                <Play className="w-8 h-8 fill-white ml-0.5" />
              ) : (
                <Pause className="w-8 h-8 fill-white" />
              )}
            </div>
          </div>
        )}

        {/* Measured Contrast Scrims */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/90 via-black/45 to-transparent"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/65 to-transparent"
          aria-hidden="true"
        />
      </div>

      {/* Top-Right Controls: Mute/Unmute + Optional Creator Delete */}
      <div className="absolute top-14 right-3 z-20 flex flex-col gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMute();
          }}
          aria-label={isMuted ? 'Włącz dźwięk' : 'Wycisz dźwięk'}
          className="min-h-[44px] min-w-[44px] rounded-full bg-black/45 hover:bg-black/65 backdrop-blur-md border border-white/10 flex items-center justify-center text-white transition-colors cursor-pointer"
        >
          {isMuted ? (
            <VolumeX className="w-5 h-5 text-white/90" />
          ) : (
            <Volume2 className="w-5 h-5 text-[#25F4EE]" />
          )}
        </button>

        {isOwnVideo && onDeleteVideo && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteVideo(video);
            }}
            aria-label="Usuń swój film"
            className="min-h-[44px] min-w-[44px] rounded-full bg-black/45 hover:bg-[#FE2C55]/80 backdrop-blur-md border border-white/10 flex items-center justify-center text-white transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Right-Side Thumb-Zone Action Rail */}
      <div className="absolute right-2.5 bottom-18 z-20 flex flex-col items-center gap-3.5">
        <div className="relative mb-2 flex flex-col items-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectCreator(video.authorId, video.authorHandle);
            }}
            aria-label={`Profil twórcy @${video.authorHandle}`}
            className="w-12 h-12 rounded-full border-2 border-white overflow-hidden flex items-center justify-center shadow-lg cursor-pointer active:scale-95 transition-transform"
          >
            <UserAvatar
              src={video.authorAvatarUrl}
              name={video.authorName}
              color={video.authorAvatarColor}
              className="w-full h-full"
              textClassName="text-base"
            />
          </button>
          {!isOwnVideo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFollow(video.authorId, video.authorHandle);
              }}
              aria-label={
                isFollowingCreator
                  ? `Przestań obserwować @${video.authorHandle}`
                  : `Obserwuj @${video.authorHandle}`
              }
              className={`-mt-2.5 w-6 h-6 rounded-full flex items-center justify-center shadow-md transition-transform active:scale-90 cursor-pointer ${
                isFollowingCreator
                  ? 'bg-zinc-800 text-[#25F4EE] border border-white/20'
                  : 'bg-[#FE2C55] text-white'
              }`}
            >
              {isFollowingCreator ? (
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              ) : (
                <Plus className="w-3.5 h-3.5 stroke-[3]" />
              )}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleLike(video);
          }}
          aria-label="Polub film"
          className="min-h-[48px] min-w-[48px] flex flex-col items-center justify-center gap-1 cursor-pointer group"
        >
          <span className="w-11 h-11 rounded-full flex items-center justify-center group-active:scale-125 transition-transform duration-150">
            <Heart
              className={`w-8 h-8 drop-shadow-md transition-colors ${
                isLiked ? 'fill-[#FE2C55] text-[#FE2C55]' : 'text-white fill-white/10'
              }`}
            />
          </span>
          <span className="text-xs font-semibold text-white font-mono tabular-nums drop-shadow">
            {formatCompactCount(video.likesCount)}
          </span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenComments(video);
          }}
          aria-label="Otwórz komentarze"
          className="min-h-[48px] min-w-[48px] flex flex-col items-center justify-center gap-1 cursor-pointer group"
        >
          <span className="w-11 h-11 rounded-full flex items-center justify-center group-active:scale-110 transition-transform duration-150">
            <MessageCircle className="w-8 h-8 text-white fill-white/10 drop-shadow-md" />
          </span>
          <span className="text-xs font-semibold text-white font-mono tabular-nums drop-shadow">
            {formatCompactCount(video.commentsCount)}
          </span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleBookmark(video);
          }}
          aria-label="Zapisz do ulubionych"
          className="min-h-[48px] min-w-[48px] flex flex-col items-center justify-center gap-1 cursor-pointer group"
        >
          <span className="w-11 h-11 rounded-full flex items-center justify-center group-active:scale-110 transition-transform duration-150">
            <Bookmark
              className={`w-7 h-7 drop-shadow-md transition-colors ${
                isBookmarked ? 'fill-amber-400 text-amber-400' : 'text-white fill-white/10'
              }`}
            />
          </span>
          <span className="text-xs font-semibold text-white font-mono tabular-nums drop-shadow">
            {formatCompactCount(video.bookmarksCount + (isBookmarked ? 1 : 0))}
          </span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenShare(video);
          }}
          aria-label="Udostępnij film i link do aplikacji"
          className="min-h-[48px] min-w-[48px] flex flex-col items-center justify-center gap-1 cursor-pointer group"
        >
          <span className="w-11 h-11 rounded-full flex items-center justify-center group-active:scale-110 transition-transform duration-150">
            <Share2 className="w-7 h-7 text-white drop-shadow-md" />
          </span>
          <span className="text-[11px] font-semibold text-white drop-shadow whitespace-nowrap">
            {t('share')}
          </span>
        </button>

        {/* Spinning Album Art / Vinyl Disc */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMute();
          }}
          aria-label={`Dźwięk: ${marqueeLabel}`}
          className={`mt-1 w-11 h-11 rounded-full bg-gradient-to-tr from-zinc-950 via-zinc-700 to-zinc-900 p-1.5 border border-white/25 shadow-lg flex items-center justify-center cursor-pointer ${
            isActive && isPlaying ? 'animate-vinyl' : 'animate-vinyl-paused'
          }`}
        >
          {video.musicCoverUrl && !coverError ? (
            <img
              src={video.musicCoverUrl}
              alt={marqueeLabel}
              referrerPolicy="no-referrer"
              onError={() => setCoverError(true)}
              className="w-full h-full rounded-full object-cover"
            />
          ) : video.authorAvatarUrl ? (
            <UserAvatar
              src={video.authorAvatarUrl}
              name={video.authorName}
              color={video.authorAvatarColor}
              className="w-full h-full"
              textClassName="text-[9px]"
            />
          ) : (
            <span
              style={{ backgroundColor: video.authorAvatarColor }}
              className="w-full h-full rounded-full flex items-center justify-center text-[9px] font-bold text-white"
            >
              ♫
            </span>
          )}
        </button>
      </div>

      {/* Bottom-Left Creator & Caption Info */}
      <div className="absolute left-3.5 right-20 bottom-18 z-20 space-y-2 pointer-events-none">
        <div className="flex items-center gap-1.5 text-sm pointer-events-auto">
          <button
            type="button"
            onClick={() => onSelectCreator(video.authorId, video.authorHandle)}
            className="font-bold text-white hover:underline tracking-wide cursor-pointer truncate max-w-[200px]"
          >
            @{video.authorHandle}
          </button>
          <span aria-hidden="true" className="text-white/60">
            ·
          </span>
          <span className="text-xs text-white/75 whitespace-nowrap">
            {video.createdAtLabel}
          </span>
        </div>

        <p className="text-sm text-white/95 leading-snug line-clamp-3 drop-shadow">
          {video.caption}
        </p>

        {video.hashtags.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-white pointer-events-auto">
            {video.hashtags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onSelectHashtag(tag)}
                className="hover:text-[#25F4EE] transition-colors cursor-pointer whitespace-nowrap"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-0.5 text-xs text-white/90 overflow-hidden max-w-[260px]">
          <Music2 className="w-3.5 h-3.5 shrink-0 text-[#25F4EE]" />
          <div className="overflow-hidden whitespace-nowrap">
            <div className="animate-marquee gap-8">
              <span>{marqueeLabel}</span>
              <span aria-hidden="true">{marqueeLabel}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Scrubbable Timeline Progress Bar */}
      <div
        onClick={handleScrub}
        role="slider"
        aria-label="Postęp odtwarzania filmu"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={0}
        className="absolute inset-x-0 bottom-14 z-30 h-3 flex items-end cursor-pointer group"
      >
        <div className="w-full h-[3px] group-hover:h-1.5 bg-white/25 transition-all">
          <div
            style={{ transform: `scaleX(${progress})`, transformOrigin: 'left' }}
            className="h-full w-full bg-white group-hover:bg-[#FE2C55] will-change-transform"
          />
        </div>
      </div>
    </article>
  );
};
