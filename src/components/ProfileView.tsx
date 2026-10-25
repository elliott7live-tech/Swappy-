import React, { useRef, useState } from 'react';
import {
  Bookmark,
  Camera,
  Check,
  Download,
  Edit3,
  Globe,
  Grid,
  Heart,
  ImagePlus,
  Loader2,
  LogIn,
  LogOut,
  Play,
  Plus,
  Share2,
  Trash2,
} from 'lucide-react';
import { useLanguage } from '../i18n';
import { PublicProfile, SwappyVideo } from '../types';
import { processAndUploadAvatar } from '../utils/avatarImage';
import { getVideoFilterCss } from '../utils/videoFilters';
import { UserAvatar } from './UserAvatar';
import { formatCompactCount } from './VideoCard';

interface ProfileViewProps {
  profile: PublicProfile | null;
  isSignedIn: boolean;
  videos: SwappyVideo[];
  likedIds: Set<string>;
  bookmarkedIds: Set<string>;
  followingCount: number;
  followersCount: number;
  onSignIn: () => void;
  onSignOut: () => void;
  onUpdateProfile: (updates: {
    handle: string;
    displayName: string;
    bio: string;
    avatarColor: string;
    avatarUrl: string;
  }) => Promise<void>;
  onOpenVideoInFeed: (videoId: string) => void;
  onOpenCreate: () => void;
  onShareProfile: () => void;
  onOpenLanguageModal: () => void;
  canInstallApp?: boolean;
  onOpenInstallModal?: () => void;
}

const AVATAR_COLORS = ['#FE2C55', '#25F4EE', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899'];

export const ProfileView: React.FC<ProfileViewProps> = ({
  profile,
  isSignedIn,
  videos,
  likedIds,
  bookmarkedIds,
  followingCount,
  followersCount,
  onSignIn,
  onSignOut,
  onUpdateProfile,
  onOpenVideoInFeed,
  onOpenCreate,
  onShareProfile,
  onOpenLanguageModal,
  canInstallApp = false,
  onOpenInstallModal,
}) => {
  const { currentLanguage, t } = useLanguage();
  const [subTab, setSubTab] = useState<'own' | 'saved' | 'liked'>('own');
  const [isEditing, setIsEditing] = useState(false);
  const [editHandle, setEditHandle] = useState(profile?.handle ?? '');
  const [editName, setEditName] = useState(profile?.displayName ?? '');
  const [editBio, setEditBio] = useState(profile?.bio ?? '');
  const [editColor, setEditColor] = useState(profile?.avatarColor ?? '#FE2C55');
  const [editAvatarUrl, setEditAvatarUrl] = useState(profile?.avatarUrl ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const quickPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const editorPhotoInputRef = useRef<HTMLInputElement | null>(null);

  const ownVideos = videos.filter((v) => profile && v.authorId === profile.uid);
  const savedVideos = videos.filter((v) => bookmarkedIds.has(v.id));
  const likedVideos = videos.filter((v) => likedIds.has(v.id));

  const totalOwnLikes = ownVideos.reduce((acc, v) => acc + v.likesCount, 0);

  const activeGridVideos =
    subTab === 'own' ? ownVideos : subTab === 'saved' ? savedVideos : likedVideos;

  const openEditor = () => {
    if (!profile) return;
    setEditHandle(profile.handle);
    setEditName(profile.displayName);
    setEditBio(profile.bio);
    setEditColor(profile.avatarColor);
    setEditAvatarUrl(profile.avatarUrl ?? '');
    setAvatarError(null);
    setIsEditing(true);
  };

  // Direct 1-tap photo change from the main profile avatar circle
  const handleQuickAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profile) return;

    setAvatarError(null);
    setIsUploadingAvatar(true);
    try {
      const uploadedUrl = await processAndUploadAvatar(file);
      setEditAvatarUrl(uploadedUrl);
      await onUpdateProfile({
        handle: profile.handle,
        displayName: profile.displayName,
        bio: profile.bio,
        avatarColor: profile.avatarColor,
        avatarUrl: uploadedUrl,
      });
    } catch (err) {
      setAvatarError(
        err instanceof Error ? err.message : 'Nie udało się zmienić zdjęcia profilowego.'
      );
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // Photo picker inside the Edit Profile form
  const handleEditorAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setAvatarError(null);
    setIsUploadingAvatar(true);
    try {
      const uploadedUrl = await processAndUploadAvatar(file);
      setEditAvatarUrl(uploadedUrl);
    } catch (err) {
      setAvatarError(
        err instanceof Error ? err.message : 'Nie udało się wgrać wybranego zdjęcia.'
      );
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onUpdateProfile({
        handle: editHandle,
        displayName: editName,
        bio: editBio,
        avatarColor: editColor,
        avatarUrl: editAvatarUrl,
      });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-[#0A0A0C] text-white pb-24 no-scrollbar">
      {/* Hidden File Inputs for Gallery / Camera Selfie Selection */}
      <input
        ref={quickPhotoInputRef}
        type="file"
        accept="image/*"
        onChange={handleQuickAvatarChange}
        className="hidden"
      />
      <input
        ref={editorPhotoInputRef}
        type="file"
        accept="image/*"
        onChange={handleEditorAvatarPick}
        className="hidden"
      />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-5 sm:pt-7 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <span className="text-base font-extrabold tracking-tight truncate">
            {profile ? `@${profile.handle}` : t('navProfile')}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenLanguageModal}
              aria-label={t('languageLabel')}
              className="min-h-[44px] px-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Globe className="w-4 h-4 text-[#25F4EE] shrink-0" />
              <span className="max-w-[110px] truncate">{currentLanguage.nativeName}</span>
            </button>
            {isSignedIn && (
              <button
                type="button"
                onClick={onSignOut}
                aria-label={t('signOut')}
                className="min-h-[44px] min-w-[44px] rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 flex items-center justify-center text-zinc-300 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center text-center space-y-3 pt-1">
          {/* Interactive TikTok-Style Profile Avatar with Camera Overlay */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                if (!isSignedIn) {
                  onSignIn();
                } else {
                  quickPhotoInputRef.current?.click();
                }
              }}
              disabled={isUploadingAvatar}
              aria-label="Zmień zdjęcie profilowe"
              className="group relative rounded-full focus:outline-none cursor-pointer active:scale-95 transition-transform"
            >
              <UserAvatar
                src={profile?.avatarUrl}
                name={profile?.displayName ?? 'S'}
                color={profile?.avatarColor ?? '#FE2C55'}
                className="w-24 h-24 border-2 border-white/25 shadow-xl"
                textClassName="text-3xl"
              />

              {isUploadingAvatar ? (
                <span className="absolute inset-0 rounded-full bg-black/65 flex items-center justify-center">
                  <Loader2 className="w-7 h-7 text-[#25F4EE] animate-spin" />
                </span>
              ) : (
                <span className="absolute -bottom-0.5 -right-0.5 w-8 h-8 rounded-full bg-[#25F4EE] text-slate-950 border-2 border-[#0A0A0C] flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                  <Camera className="w-4 h-4 stroke-[2.4]" />
                </span>
              )}
            </button>
          </div>

          {avatarError && (
            <p className="text-xs font-semibold text-[#FE2C55]">{avatarError}</p>
          )}

          <div>
            <h1 className="text-xl font-extrabold text-white">
              {profile?.displayName ?? t('guestProfileTitle')}
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              {profile ? `@${profile.handle}` : t('guestProfileSub')}
            </p>
          </div>

          <div className="flex items-center justify-center gap-7 pt-1">
            <div className="text-center">
              <div className="text-base font-extrabold font-mono tabular-nums text-white">
                {followingCount}
              </div>
              <div className="text-xs text-zinc-400">{t('followingCountLabel')}</div>
            </div>
            <div className="h-5 w-px bg-white/10" aria-hidden="true" />
            <div className="text-center">
              <div className="text-base font-extrabold font-mono tabular-nums text-white">
                {followersCount}
              </div>
              <div className="text-xs text-zinc-400">{t('followersCountLabel')}</div>
            </div>
            <div className="h-5 w-px bg-white/10" aria-hidden="true" />
            <div className="text-center">
              <div className="text-base font-extrabold font-mono tabular-nums text-white">
                {formatCompactCount(totalOwnLikes)}
              </div>
              <div className="text-xs text-zinc-400">{t('likesCountLabel')}</div>
            </div>
          </div>

          {profile?.bio ? (
            <p className="text-xs text-zinc-300 max-w-md leading-relaxed">{profile.bio}</p>
          ) : null}

          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            {!isSignedIn ? (
              <button
                type="button"
                onClick={onSignIn}
                className="min-h-[46px] px-6 rounded-xl bg-[#FE2C55] hover:bg-[#e6254b] text-sm font-bold text-white flex items-center gap-2 transition-colors cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>{t('signInGoogle')}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => quickPhotoInputRef.current?.click()}
                  disabled={isUploadingAvatar}
                  className="min-h-[44px] px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-semibold text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5 text-[#25F4EE]" />
                  <span>{isUploadingAvatar ? 'Wgrywanie...' : t('changePhoto')}</span>
                </button>
                <button
                  type="button"
                  onClick={openEditor}
                  className="min-h-[44px] px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-semibold text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>{t('editProfile')}</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenCreate}
                  className="min-h-[44px] px-4 rounded-xl bg-[#FE2C55] hover:bg-[#e6254b] text-xs font-bold text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('navPostVideo')}</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onShareProfile}
              className="min-h-[44px] px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-semibold text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5 text-[#25F4EE]" />
              <span>{t('share')}</span>
            </button>
            {canInstallApp && onOpenInstallModal && (
              <button
                type="button"
                onClick={onOpenInstallModal}
                className="min-h-[44px] px-4 rounded-xl bg-[#25F4EE] hover:bg-[#20dbd5] text-slate-950 text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>{t('installApp')}</span>
              </button>
            )}
          </div>
        </div>

        {isEditing && profile && (
          <form
            onSubmit={handleSaveProfile}
            className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4"
          >
            <h2 className="text-sm font-bold text-white">Edycja profilu twórcy</h2>

            {/* Profile Photo Picker inside Edit Modal */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl bg-black/35 border border-white/10 p-3.5">
              <UserAvatar
                src={editAvatarUrl}
                name={editName || profile.displayName}
                color={editColor}
                className="w-16 h-16 border border-white/20 shrink-0"
                textClassName="text-xl"
              />
              <div className="flex-1 space-y-2">
                <div className="text-xs font-bold text-white">Zdjęcie profilowe</div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => editorPhotoInputRef.current?.click()}
                    disabled={isUploadingAvatar}
                    className="min-h-[38px] px-3.5 rounded-xl bg-[#25F4EE] hover:bg-[#20dbd5] text-slate-950 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                  >
                    {isUploadingAvatar ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="w-3.5 h-3.5" />
                    )}
                    <span>Wybierz zdjęcie z telefonu</span>
                  </button>

                  {editAvatarUrl && (
                    <button
                      type="button"
                      onClick={() => setEditAvatarUrl('')}
                      className="min-h-[38px] px-3 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-[#FE2C55]" />
                      <span>Usuń zdjęcie</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Nazwa użytkownika (@)</label>
                <input
                  type="text"
                  value={editHandle}
                  onChange={(e) => setEditHandle(e.target.value)}
                  maxLength={32}
                  required
                  className="w-full min-h-[42px] rounded-xl bg-black/50 border border-white/10 px-3 text-sm text-white focus:outline-none focus:border-[#25F4EE]"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Wyświetlana nazwa</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={50}
                  required
                  className="w-full min-h-[42px] rounded-xl bg-black/50 border border-white/10 px-3 text-sm text-white focus:outline-none focus:border-[#25F4EE]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Bio (do 160 znaków)</label>
              <input
                type="text"
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                maxLength={160}
                placeholder="Opowiedz o swoich filmach..."
                className="w-full min-h-[42px] rounded-xl bg-black/50 border border-white/10 px-3 text-sm text-white focus:outline-none focus:border-[#25F4EE]"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">
                Kolor tła awatara (gdy brak zdjęcia)
              </label>
              <div className="flex items-center gap-2.5">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setEditColor(color)}
                    style={{ backgroundColor: color }}
                    className="w-9 h-9 rounded-full flex items-center justify-center border-2 border-white/20 cursor-pointer"
                  >
                    {editColor === color && <Check className="w-4 h-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="min-h-[42px] px-4 rounded-xl bg-white/10 text-xs font-semibold text-zinc-300 cursor-pointer"
              >
                Anuluj
              </button>
              <button
                type="submit"
                disabled={isSaving || isUploadingAvatar}
                className="min-h-[42px] px-5 rounded-xl bg-[#FE2C55] text-xs font-bold text-white cursor-pointer"
              >
                {isSaving ? 'Zapisywanie...' : 'Zapisz zmiany'}
              </button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-3 border-b border-white/10">
          <button
            type="button"
            onClick={() => setSubTab('own')}
            className={`min-h-[46px] flex items-center justify-center gap-2 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              subTab === 'own'
                ? 'border-white text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Grid className="w-4 h-4" />
            <span>
              {t('videosTab')} ({ownVideos.length})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('saved')}
            className={`min-h-[46px] flex items-center justify-center gap-2 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              subTab === 'saved'
                ? 'border-white text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Bookmark className="w-4 h-4" />
            <span>
              {t('savedTab')} ({savedVideos.length})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('liked')}
            className={`min-h-[46px] flex items-center justify-center gap-2 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              subTab === 'liked'
                ? 'border-white text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Heart className="w-4 h-4" />
            <span>
              {t('likedTab')} ({likedVideos.length})
            </span>
          </button>
        </div>

        {activeGridVideos.length === 0 ? (
          <div className="py-14 text-center space-y-3">
            <p className="text-sm font-semibold text-zinc-300">
              {subTab === 'own'
                ? t('noOwnVideos')
                : subTab === 'saved'
                  ? t('noSavedVideos')
                  : t('noLikedVideos')}
            </p>
            {subTab === 'own' && (
              <button
                type="button"
                onClick={onOpenCreate}
                className="min-h-[44px] px-5 rounded-xl bg-[#FE2C55] text-xs font-bold text-white inline-flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{t('navPostVideo')}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {activeGridVideos.map((v) => {
              const videoSrc = v.localVideoUrl || v.videoUrl;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onOpenVideoInFeed(v.id)}
                  className="group relative aspect-[9/16] rounded-xl overflow-hidden bg-[#141418] border border-white/10 cursor-pointer"
                >
                  <video
                    src={`${videoSrc}#t=0.1`}
                    preload="metadata"
                    muted
                    playsInline
                    style={{ filter: getVideoFilterCss(v.colorFilter) }}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                  <div className="absolute left-2 bottom-2 flex items-center gap-1 text-[11px] font-mono tabular-nums font-semibold text-white">
                    <Play className="w-3 h-3 fill-white" />
                    <span>{formatCompactCount(v.likesCount)}</span>
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
