# Swappy Firestore Security Specification

## 1. Data Invariants

1. **Zero PII in Public Profiles (`/profiles/{userId}`)**: Public profiles never store email addresses, phone numbers, or physical addresses. Creation and updates require a verified Google user (`request.auth.token.email_verified == true`) whose `request.auth.uid == userId` and `incoming().uid == userId`, with optional `avatarUrl` strictly bounded to `<= 600` chars matching `^(/uploads/[a-zA-Z0-9_.\\-]+|https://.+)$` or empty string.
2. **Author Existence & Ownership (`/videos/{videoId}`)**: Every video must be authored by an existing profile (`exists(/databases/$(database)/documents/profiles/$(request.auth.uid))`), start with `likesCount == 0`, `commentsCount == 0`, `lastCommentId == ''`, and enforce `createdAt == request.time` and `updatedAt == request.time`.
3. **Atomic Like Synchronization (`/likes/{likeId}` <-> `/videos/{videoId}`)**: A like document ID must strictly equal `request.auth.uid + '_' + videoId`. Creating a like requires atomically incrementing `videos/{videoId}.likesCount` by +1 in the same batch (`getAfter`), and deleting a like requires atomically decrementing `likesCount` by -1.
4. **Atomic Comment Synchronization (`/comments/{commentId}` <-> `/videos/{videoId}`)**: Creating a comment requires an existing public video and atomically incrementing `videos/{videoId}.commentsCount` by +1 while setting `videos/{videoId}.lastCommentId == commentId` in the same batch.
5. **Private Interaction Isolation (`/likes`, `/bookmarks`, `/follows`)**: List queries on interaction collections strictly verify ownership on `resource.data` (`userId == request.auth.uid` or `followerId == request.auth.uid`) without delegating filtering to the client.
6. **Strict Schema, Bounds & Terminal Live State**: Every string (including `avatarUrl`, `authorAvatarUrl`, `hostAvatarUrl`) has explicit `.size()` bounds and URL scheme guards, `colorFilter` must belong to `['normal', 'warm', 'cool', 'vivid', 'vintage', 'neon', 'mono']`, `/livestreams/{streamId}` enforces `existing().status == 'live'` before any update (terminal lock once `ended`), every array has explicit `.size() <= 8` bounds, and every update block wraps `isValid[Entity](incoming())` plus action-scoped `affectedKeys().hasOnly(...)`.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Shadow Field Injection on Profile**: `{ uid: "u1", handle: "jan", displayName: "Jan", bio: "", avatarColor: "#FE2C55", visibility: "public", isVerifiedBadge: true, createdAt: SERVER_TIME, updatedAt: SERVER_TIME }` -> Rejected by `hasOnly` key allowlist.
2. **Unverified Email Write Spoof**: Authenticated token with `email_verified: false` attempting `create` on `/videos/v1` -> Rejected by `isVerifiedUser()`.
3. **Identity Spoofing on Video Creation**: `{ authorId: "victim_uid", ... }` by `attacker_uid` -> Rejected by `data.authorId == request.auth.uid`.
4. **Inflated Initial Likes Counter**: Creating `/videos/v1` with `likesCount: 99999` -> Rejected by `incoming().likesCount == 0`.
5. **Standalone Like Counter Inflation**: Updating `/videos/v1` `{ likesCount: existing + 1 }` without creating `/likes/{uid}_{videoId}` in batch -> Rejected by `!exists(...) && existsAfter(...)`.
6. **Orphaned Like Without Counter Sync**: Creating `/likes/{uid}_{videoId}` without updating `/videos/{videoId}` -> Rejected by `getAfter(...).data.likesCount == get(...).data.likesCount + 1`.
7. **ID Poisoning Attack**: Targeting `/videos/` with a 500-char or special-char ID `a/b$c...` -> Rejected by `isValidId()`.
8. **Denial-of-Wallet Caption Flood**: Updating `/videos/v1` with a 50,000-char `caption` -> Rejected by `isValidVideoPost(incoming())` (`caption.size() <= 280`).
9. **Client Timestamp Forgery**: Creating `/comments/c1` with `createdAt: Timestamp(2020, 1, 1)` -> Rejected by `incoming().createdAt == request.time`.
10. **Immutable Field Mutation**: Updating `createdAt` or `authorId` on `/videos/v1` -> Rejected by `affectedKeys().hasOnly(...)` and `incoming().authorId == existing().authorId && incoming().createdAt == existing().createdAt`.
11. **Unauthorized Private Video Scrape**: Listing `/videos` without `where('visibility', '==', 'public')` -> Rejected by `allow list: if resource.data.visibility == 'public' || (isSignedIn() && resource.data.authorId == request.auth.uid)`.
12. **Self-Follow or Foreign Bookmark Creation**: Creating `/follows/u1_u1` (self-follow) or `/bookmarks/u2_v1` as `u1` -> Rejected by `followerId != followingId` and `bookmarkId == request.auth.uid + '_' + incoming().videoId`.
