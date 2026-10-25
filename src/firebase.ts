import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function isQuotaExceededError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('Quota exceeded');
}

export function getFirebaseUpgradeUrl(): string {
  return `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseConfig.firestoreDatabaseId}/data?openUpgradeDialog=true`;
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

// Defensive payload sanitization synced verbatim with firebase-blueprint.json & firestore.rules
const POLISH_CHAR_MAP: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
  Ą: 'a',
  Ć: 'c',
  Ę: 'e',
  Ł: 'l',
  Ń: 'n',
  Ó: 'o',
  Ś: 's',
  Ź: 'z',
  Ż: 'z',
};

export function sanitizeHandle(raw: string): string {
  const transliterated = raw
    .split('')
    .map((ch) => POLISH_CHAR_MAP[ch] ?? ch)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '');
  const trimmed = transliterated.slice(0, 32);
  if (trimmed.length >= 2) return trimmed;
  return `tworca_${Math.random().toString(36).slice(2, 7)}`;
}

export function sanitizeDisplayName(raw: string): string {
  const cleaned = raw.trim().slice(0, 50);
  return cleaned.length >= 1 ? cleaned : 'Twórca Swappy';
}

export function sanitizeBio(raw: string): string {
  return raw.trim().slice(0, 160);
}

export function sanitizeAvatarColor(raw: string): string {
  if (/^#[0-9a-fA-F]{3,8}$/.test(raw)) {
    return raw;
  }
  return '#FE2C55';
}

export function sanitizeCaption(raw: string): string {
  const cleaned = raw.trim().slice(0, 280);
  return cleaned.length >= 1 ? cleaned : 'Nowy klip na Swappy';
}

export function sanitizeOverlayText(raw: string): string {
  return raw.trim().slice(0, 100);
}

export function sanitizeMusicTitle(raw: string): string {
  const cleaned = raw.trim().slice(0, 80);
  return cleaned.length >= 1 ? cleaned : 'Oryginalny dźwięk';
}

export function sanitizeMusicArtist(raw: string): string {
  return raw.trim().slice(0, 80);
}

export function sanitizeOptionalMediaUrl(raw: string): string {
  const cleaned = raw.trim().slice(0, 600);
  if (!cleaned) return '';
  if (/^(\/uploads\/[a-zA-Z0-9_.\-]+|https:\/\/.+)$/.test(cleaned)) {
    return cleaned;
  }
  return '';
}

export function sanitizeVolumePercent(raw: number | undefined, fallback: number): number {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return fallback;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function sanitizeStreamTitle(raw: string): string {
  const cleaned = raw.trim().slice(0, 90);
  return cleaned.length >= 1 ? cleaned : 'Transmisja na żywo';
}

export function sanitizeVideoUrl(raw: string): string {
  const cleaned = raw.trim().slice(0, 500);
  if (/^(\/uploads\/[a-zA-Z0-9_.\-]+|https:\/\/.+)$/.test(cleaned)) {
    return cleaned;
  }
  throw new Error('Nieprawidłowy adres pliku wideo.');
}

export function sanitizeHashtags(rawTags: string[]): string[] {
  const normalized = rawTags
    .map((t) => t.replace(/^#+/, '').trim().slice(0, 32))
    .filter((t) => t.length >= 1);
  return Array.from(new Set(normalized)).slice(0, 8);
}

export function sanitizeCommentText(raw: string): string {
  return raw.trim().slice(0, 240);
}

export function generateSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}
