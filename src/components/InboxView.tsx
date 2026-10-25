import React from 'react';
import { Bell, Heart, MessageCircle, UserPlus } from 'lucide-react';
import { SwappyComment, SwappyVideo } from '../types';
import { useLanguage } from '../i18n';
import { UserAvatar } from './UserAvatar';

interface InboxViewProps {
  likedIds: Set<string>;
  followingIds: Set<string>;
  recentComments: SwappyComment[];
  videos: SwappyVideo[];
  onOpenVideoInFeed: (videoId: string) => void;
}

export const InboxView: React.FC<InboxViewProps> = ({
  likedIds,
  followingIds,
  recentComments,
  videos,
  onOpenVideoInFeed,
}) => {
  const { t } = useLanguage();
  const videoMap = new Map<string, SwappyVideo>(videos.map((v) => [v.id, v]));

  return (
    <div className="h-full w-full overflow-y-auto bg-[#0A0A0C] text-white pb-24 no-scrollbar">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-5 sm:pt-7 space-y-6">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">{t('inboxTitle')}</h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              {t('inboxSub')}
            </p>
          </div>
        </div>

        {/* Summary Counters */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-[#141418] border border-white/10 p-4">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Heart className="w-4 h-4 text-[#FE2C55]" />
              <span>{t('likedTab')}</span>
            </div>
            <p className="mt-2 text-2xl font-extrabold font-mono tabular-nums text-white">
              {likedIds.size}
            </p>
          </div>

          <div className="rounded-2xl bg-[#141418] border border-white/10 p-4">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <UserPlus className="w-4 h-4 text-[#25F4EE]" />
              <span>{t('followingCountLabel')}</span>
            </div>
            <p className="mt-2 text-2xl font-extrabold font-mono tabular-nums text-white">
              {followingIds.size}
            </p>
          </div>

          <div className="rounded-2xl bg-[#141418] border border-white/10 p-4">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <MessageCircle className="w-4 h-4 text-amber-400" />
              <span>{t('commentsTitle')}</span>
            </div>
            <p className="mt-2 text-2xl font-extrabold font-mono tabular-nums text-white">
              {recentComments.length}
            </p>
          </div>
        </div>

        {/* Live Community Comments Activity */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-zinc-200">{t('commentsTitle')}</h2>
          {recentComments.length === 0 ? (
            <div className="rounded-2xl bg-[#141418] border border-white/10 p-8 text-center">
              <Bell className="w-7 h-7 text-zinc-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-zinc-300">{t('noNotifications')}</p>
            </div>
          ) : (
            <div className="rounded-2xl bg-[#141418] border border-white/10 divide-y divide-white/5 overflow-hidden">
              {recentComments.slice(0, 15).map((item) => {
                const targetVideo = videoMap.get(item.videoId);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenVideoInFeed(item.videoId)}
                    className="w-full min-h-[64px] px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-white/[0.04] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <UserAvatar
                        src={item.authorAvatarUrl}
                        name={item.authorName}
                        color={item.authorAvatarColor}
                        className="w-10 h-10 shrink-0"
                        textClassName="text-xs"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                          <span className="font-bold text-white truncate">
                            @{item.authorHandle}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="whitespace-nowrap">{item.createdAtLabel}</span>
                        </div>
                        <p className="text-xs text-zinc-300 truncate mt-0.5">
                          Skomentował(a): „{item.text}”
                        </p>
                      </div>
                    </div>
                    {targetVideo && (
                      <span className="text-[11px] font-semibold text-[#25F4EE] whitespace-nowrap shrink-0">
                        Zobacz film
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
