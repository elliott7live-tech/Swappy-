import { VideoFilterId } from './utils/videoFilters';

export enum FeedTab {
  FOLLOWING = 'following',
  FOR_YOU = 'for_you',
}

export enum NavTab {
  HOME = 'home',
  DISCOVER = 'discover',
  LIVE = 'live',
  CREATE = 'create',
  INBOX = 'inbox',
  PROFILE = 'profile',
}

export interface PublicProfile {
  uid: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarColor: string;
  avatarUrl?: string;
  visibility: 'public';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  coverUrl: string;
  albumName?: string;
  durationSec?: number;
  source?: 'catalog' | 'community' | 'original';
}

export interface SwappyVideo {
  id: string;
  authorId: string;
  authorHandle: string;
  authorName: string;
  authorAvatarColor: string;
  authorAvatarUrl?: string;
  videoUrl: string;
  localVideoUrl?: string;
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
  likesCount: number;
  commentsCount: number;
  bookmarksCount: number;
  createdAtLabel: string;
  createdAtMs: number;
}

export interface SwappyComment {
  id: string;
  videoId: string;
  authorId: string;
  authorHandle: string;
  authorName: string;
  authorAvatarColor: string;
  authorAvatarUrl?: string;
  text: string;
  createdAtLabel: string;
  createdAtMs: number;
}

export interface LiveChatMessage {
  id: string;
  streamId: string;
  authorHandle: string;
  authorName: string;
  authorAvatarColor: string;
  authorAvatarUrl?: string;
  text: string;
  createdAtMs: number;
}

export interface LiveStreamSummary {
  id: string;
  hostUid: string;
  hostHandle: string;
  hostName: string;
  hostAvatarColor: string;
  hostAvatarUrl?: string;
  title: string;
  colorFilter: VideoFilterId;
  startedAtMs: number;
  likesCount: number;
  viewersCount: number;
  previewFrameUrl?: string | null;
}

export interface LiveStreamDetail extends LiveStreamSummary {
  hostClientId: string;
  recentMessages: LiveChatMessage[];
}

export interface LiveAutoStartConfig {
  title: string;
  colorFilter: VideoFilterId;
  facingMode: 'user' | 'environment';
  initialZoom?: number;
}
