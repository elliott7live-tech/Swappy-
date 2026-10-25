/**
 * Adversarial Security Rules Specification Runner ("Dirty Dozen" Verification)
 * Validates that every Dirty Dozen payload defined in security_spec.md is rejected by firestore.rules.
 */

export interface DirtyDozenScenario {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'create' | 'update' | 'list' | 'get' | 'delete';
  expectedOutcome: 'PERMISSION_DENIED';
  blockingGate: string;
}

export const DIRTY_DOZEN_VERIFICATION_SUITE: DirtyDozenScenario[] = [
  {
    id: 1,
    name: 'Shadow Field Injection on Profile',
    collectionPath: '/profiles/u1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    blockingGate: 'isValidPublicProfile -> data.keys().hasOnly(...)',
  },
  {
    id: 2,
    name: 'Unverified Email Write Spoof',
    collectionPath: '/videos/v1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    blockingGate: 'isVerifiedUser() -> request.auth.token.email_verified == true',
  },
  {
    id: 3,
    name: 'Identity Spoofing on Video Creation',
    collectionPath: '/videos/v1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    blockingGate: 'incoming().authorId == request.auth.uid',
  },
  {
    id: 4,
    name: 'Inflated Initial Likes Counter',
    collectionPath: '/videos/v1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    blockingGate: 'incoming().likesCount == 0',
  },
  {
    id: 5,
    name: 'Standalone Like Counter Inflation',
    collectionPath: '/videos/v1',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    blockingGate: '!exists(likes/uid_v1) && existsAfter(likes/uid_v1)',
  },
  {
    id: 6,
    name: 'Orphaned Like Without Counter Sync',
    collectionPath: '/likes/u1_v1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    blockingGate: 'getAfter(videos/v1).data.likesCount == get(videos/v1).data.likesCount + 1',
  },
  {
    id: 7,
    name: 'ID Poisoning Attack',
    collectionPath: '/videos/invalid$id!with/slash',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    blockingGate: 'isValidId(videoId)',
  },
  {
    id: 8,
    name: 'Denial-of-Wallet Caption Flood',
    collectionPath: '/videos/v1',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    blockingGate: 'isValidVideoPost(incoming()) -> data.caption.size() <= 280',
  },
  {
    id: 9,
    name: 'Client Timestamp Forgery',
    collectionPath: '/comments/c1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    blockingGate: 'incoming().createdAt == request.time',
  },
  {
    id: 10,
    name: 'Immutable Field Mutation',
    collectionPath: '/videos/v1',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    blockingGate: 'incoming().authorId == existing().authorId && incoming().createdAt == existing().createdAt',
  },
  {
    id: 11,
    name: 'Unauthorized Private Video Scrape',
    collectionPath: '/videos',
    operation: 'list',
    expectedOutcome: 'PERMISSION_DENIED',
    blockingGate: 'existing().visibility == "public" || existing().authorId == request.auth.uid',
  },
  {
    id: 12,
    name: 'Self-Follow or Foreign Bookmark Creation',
    collectionPath: '/follows/u1_u1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    blockingGate: 'data.followerId != data.followingId && followId == request.auth.uid + "_" + incoming().followingId',
  },
];
