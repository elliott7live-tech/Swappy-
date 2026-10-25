import React, { useState } from 'react';
import { LogIn, MessageCircle, Send, X } from 'lucide-react';
import { useLanguage } from '../i18n';
import { SwappyComment, SwappyVideo } from '../types';
import { UserAvatar } from './UserAvatar';

interface CommentsPanelProps {
  video: SwappyVideo;
  comments: SwappyComment[];
  isSignedIn: boolean;
  isSubmitting: boolean;
  onAddComment: (video: SwappyVideo, text: string) => Promise<void>;
  onSignIn: () => void;
  onClose?: () => void;
  mode: 'sheet' | 'sidebar';
}

export const CommentsPanel: React.FC<CommentsPanelProps> = ({
  video,
  comments,
  isSignedIn,
  isSubmitting,
  onAddComment,
  onSignIn,
  onClose,
  mode,
}) => {
  const { t } = useLanguage();
  const [draft, setDraft] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || isSubmitting) return;
    setDraft('');
    await onAddComment(video, trimmed);
  };

  return (
    <div className="flex flex-col h-full bg-[#141418] text-white">
      {mode === 'sheet' && (
        <div className="w-10 h-1.5 bg-white/20 rounded-full mx-auto mt-3 mb-1 shrink-0" />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">{t('commentsTitle')}</span>
          <span aria-hidden="true" className="text-zinc-500">
            ·
          </span>
          <span className="text-xs font-mono tabular-nums text-zinc-400">
            {Math.max(video.commentsCount, comments.length)}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij komentarze"
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Scrollable Comments List */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 no-scrollbar">
        {comments.length === 0 ? (
          <div className="h-44 flex flex-col items-center justify-center text-center px-4">
            <MessageCircle className="w-8 h-8 text-zinc-600 mb-2" />
            <p className="text-sm font-semibold text-zinc-300">{t('noComments')}</p>
            <p className="text-xs text-zinc-500 mt-1">@{video.authorHandle}</p>
          </div>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="flex items-start gap-3">
              <UserAvatar
                src={comment.authorAvatarUrl}
                name={comment.authorName}
                color={comment.authorAvatarColor}
                className="w-9 h-9 shrink-0 mt-0.5"
                textClassName="text-xs"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <span className="font-semibold text-zinc-200 truncate">
                    @{comment.authorHandle}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="whitespace-nowrap">{comment.createdAtLabel}</span>
                </div>
                <p className="mt-1 text-sm text-zinc-100 leading-snug break-words">
                  {comment.text}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Bottom Input */}
      <div className="p-3.5 border-t border-white/10 bg-[#101014] shrink-0">
        {!isSignedIn ? (
          <button
            type="button"
            onClick={onSignIn}
            className="w-full min-h-[44px] rounded-xl bg-white/10 hover:bg-white/15 px-4 py-2.5 text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <LogIn className="w-4 h-4 text-[#25F4EE]" />
            <span>{t('signInGoogle')}</span>
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={240}
              placeholder={t('addCommentPlaceholder')}
              aria-label={t('addCommentPlaceholder')}
              className="flex-1 min-w-0 min-h-[44px] rounded-full bg-white/[0.07] border border-white/10 px-4 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#25F4EE]"
            />
            <button
              type="submit"
              disabled={!draft.trim() || isSubmitting}
              aria-label="Wyślij komentarz"
              className="min-h-[44px] min-w-[44px] rounded-full bg-[#FE2C55] disabled:bg-zinc-800 disabled:text-zinc-500 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

interface CommentsSheetProps {
  video: SwappyVideo | null;
  comments: SwappyComment[];
  isSignedIn: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onAddComment: (video: SwappyVideo, text: string) => Promise<void>;
  onSignIn: () => void;
}

export const CommentsSheet: React.FC<CommentsSheetProps> = ({
  video,
  comments,
  isSignedIn,
  isSubmitting,
  onClose,
  onAddComment,
  onSignIn,
}) => {
  if (!video) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[430px] h-[68dvh] rounded-t-3xl overflow-hidden border-t border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CommentsPanel
          video={video}
          comments={comments}
          isSignedIn={isSignedIn}
          isSubmitting={isSubmitting}
          onAddComment={onAddComment}
          onSignIn={onSignIn}
          onClose={onClose}
          mode="sheet"
        />
      </div>
    </div>
  );
};
