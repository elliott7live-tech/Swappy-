import React, { useMemo, useState } from 'react';
import { Film, Heart, Music2, Play, Plus, Radio, Search, Users, X } from 'lucide-react';
import { LiveStreamSummary, SwappyVideo } from '../types';
import { useLanguage } from '../i18n';
import { getVideoFilterCss } from '../utils/videoFilters';
import { UserAvatar } from './UserAvatar';
import { formatCompactCount } from './VideoCard';

interface DiscoverViewProps {
  videos: SwappyVideo[];
  liveStreams: LiveStreamSummary[];
  initialHashtag: string | null;
  onClearHashtag: () => void;
  onOpenVideoInFeed: (videoId: string) => void;
  onOpenCreate: () => void;
  onOpenLiveLobby: () => void;
  onStartLiveSetup: () => void;
  onJoinLiveStream: (streamId: string) => void;
}

export const DiscoverView: React.FC<DiscoverViewProps> = ({
  videos,
  liveStreams,
  initialHashtag,
  onClearHashtag,
  onOpenVideoInFeed,
  onOpenCreate,
  onOpenLiveLobby,
  onStartLiveSetup,
  onJoinLiveStream,
}) => {
  const { t } = useLanguage();
  const [query, setQuery] = useState(initialHashtag ? `#${initialHashtag}` : '');

  const publicVideos = useMemo(
    () => videos.filter((v) => v.visibility === 'public'),
    [videos]
  );

  const filteredVideos = useMemo(() => {
    const normalized = query.trim().toLowerCase().replace(/^#+/, '');
    if (!normalized) return publicVideos;
    return publicVideos.filter(
      (v) =>
        v.caption.toLowerCase().includes(normalized) ||
        v.authorHandle.toLowerCase().includes(normalized) ||
        v.authorName.toLowerCase().includes(normalized) ||
        v.musicTitle.toLowerCase().includes(normalized) ||
        (v.musicArtist && v.musicArtist.toLowerCase().includes(normalized)) ||
        v.hashtags.some((t) => t.toLowerCase().includes(normalized))
    );
  }, [publicVideos, query]);

  const popularHashtags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of publicVideos) {
      for (const t of v.hashtags) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [publicVideos]);

  return (
    <div className="h-full w-full overflow-y-auto bg-[#0A0A0C] text-white pb-24 no-scrollbar">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 space-y-6">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value && initialHashtag) {
                  onClearHashtag();
                }
              }}
              placeholder={t('discoverPlaceholder')}
              aria-label={t('discoverPlaceholder')}
              className="w-full min-h-[46px] rounded-2xl bg-white/[0.06] border border-white/10 pl-11 pr-10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#25F4EE]"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  onClearHashtag();
                }}
                aria-label="Wyczyść wyszukiwanie"
                className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Dedicated Transmisje na żywo (LIVE) Showcase Section */}
        <section className="rounded-3xl bg-[#111116] border border-white/10 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-[#FE2C55] shrink-0" />
                <h2 className="text-sm sm:text-base font-extrabold text-white truncate">
                  {t('navLive')}
                </h2>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5 truncate">
                {liveStreams.length > 0
                  ? `LIVE: ${liveStreams.length}`
                  : t('liveSubIdle')}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {liveStreams.length > 0 && (
                <button
                  type="button"
                  onClick={onOpenLiveLobby}
                  className="min-h-[40px] px-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] text-xs font-bold text-white whitespace-nowrap cursor-pointer"
                >
                  LIVE ({liveStreams.length})
                </button>
              )}
              <button
                type="button"
                onClick={onStartLiveSetup}
                className="min-h-[42px] px-3.5 rounded-xl bg-[#FE2C55] hover:bg-[#e6254b] text-xs font-bold text-white flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>{t('goLiveBtn')}</span>
              </button>
            </div>
          </div>

          {liveStreams.length > 0 && (
            <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pt-1">
              {liveStreams.map((stream) => (
                <button
                  key={stream.id}
                  type="button"
                  onClick={() => onJoinLiveStream(stream.id)}
                  className="w-40 sm:w-44 aspect-[9/14] rounded-2xl overflow-hidden relative bg-zinc-900 border border-[#FE2C55]/45 shrink-0 text-left group cursor-pointer"
                >
                  {stream.previewFrameUrl ? (
                    <img
                      src={stream.previewFrameUrl}
                      alt={`LIVE @${stream.hostHandle}`}
                      referrerPolicy="no-referrer"
                      style={
                        stream.colorFilter !== 'normal'
                          ? { filter: getVideoFilterCss(stream.colorFilter) }
                          : undefined
                      }
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-zinc-800 to-zinc-950">
                      <Radio className="w-7 h-7 text-[#FE2C55]" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/35" />
                  <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
                    <span className="rounded bg-[#FE2C55] px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                      LIVE
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-white bg-black/50 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Users className="w-2.5 h-2.5 text-[#25F4EE]" />
                      {formatCompactCount(stream.viewersCount)}
                    </span>
                  </div>
                  <div className="absolute inset-x-2.5 bottom-2.5 space-y-1">
                    <p className="text-xs font-bold text-white truncate">{stream.title}</p>
                    <div className="flex items-center gap-1.5">
                      <UserAvatar
                        src={stream.hostAvatarUrl}
                        name={stream.hostName}
                        color={stream.hostAvatarColor}
                        className="w-4 h-4 shrink-0"
                        textClassName="text-[8px]"
                      />
                      <p className="text-[11px] text-zinc-300 truncate">@{stream.hostHandle}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Popular Hashtags Bar (only shown once users post videos with hashtags) */}
        {popularHashtags.length > 0 && (
          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar border-b border-white/10 pb-3">
            <span className="text-xs font-semibold text-zinc-500 whitespace-nowrap shrink-0">
              Hashtagi społeczności:
            </span>
            {popularHashtags.map(([tag, count]) => (
              <button
                key={tag}
                type="button"
                onClick={() => setQuery(`#${tag}`)}
                className="text-xs font-semibold text-zinc-300 hover:text-[#25F4EE] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                #{tag} <span className="text-zinc-500 font-mono tabular-nums">· {count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Video Discovery Grid */}
        {publicVideos.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center px-4 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.05] border border-white/10 flex items-center justify-center text-zinc-400">
              <Film className="w-7 h-7" />
            </div>
            <div className="space-y-1 max-w-sm">
              <h2 className="text-base font-bold text-white">
                {t('discoverEmptyTitle')}
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {t('discoverEmptyDesc')}
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenCreate}
              className="min-h-[46px] px-5 rounded-xl bg-[#FE2C55] hover:bg-[#e6254b] text-xs font-bold text-white inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{t('navPostVideo')}</span>
            </button>
          </div>
        ) : filteredVideos.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <p className="text-base font-bold text-zinc-200">Brak pasujących filmów</p>
            <p className="text-xs text-zinc-500">
              Spróbuj wpisać inną frazę, piosenkę lub nazwę twórcy.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {filteredVideos.map((video) => {
              const videoSrc = video.localVideoUrl || video.videoUrl;
              return (
                <button
                  key={video.id}
                  type="button"
                  onClick={() => onOpenVideoInFeed(video.id)}
                  className="group relative aspect-[9/16] rounded-2xl overflow-hidden bg-[#141418] border border-white/10 text-left cursor-pointer focus-visible:ring-2 focus-visible:ring-[#25F4EE]"
                >
                  <video
                    src={`${videoSrc}#t=0.1`}
                    preload="metadata"
                    muted
                    playsInline
                    style={
                      video.colorFilter !== 'normal'
                        ? { filter: getVideoFilterCss(video.colorFilter) }
                        : undefined
                    }
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

                  <div className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/45 backdrop-blur-xs flex items-center justify-center text-white opacity-90 group-hover:bg-[#FE2C55] transition-colors">
                    <Play className="w-3.5 h-3.5 fill-white ml-0.5" />
                  </div>

                  <div className="absolute inset-x-3 bottom-3 space-y-1">
                    <p className="text-xs font-medium text-white/95 line-clamp-2 leading-snug">
                      {video.caption}
                    </p>
                    {video.musicAudioUrl && (
                      <div className="flex items-center gap-1 text-[10px] text-[#25F4EE] truncate">
                        <Music2 className="w-3 h-3 shrink-0" />
                        <span className="truncate">{video.musicTitle}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-300 pt-0.5">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <UserAvatar
                          src={video.authorAvatarUrl}
                          name={video.authorName}
                          color={video.authorAvatarColor}
                          className="w-4 h-4 shrink-0"
                          textClassName="text-[8px]"
                        />
                        <span className="truncate font-semibold">@{video.authorHandle}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums shrink-0">
                        <Heart className="w-3 h-3 text-[#FE2C55] fill-[#FE2C55]" />
                        {formatCompactCount(video.likesCount)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
