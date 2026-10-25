import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 3000;
const rootDir = process.cwd();
const uploadsDir = path.resolve(rootDir, 'uploads');
const distDir = path.resolve(rootDir, 'dist');

fs.mkdirSync(uploadsDir, { recursive: true });

function resolveVideoExtension(contentType: string): string {
  const lower = contentType.toLowerCase();
  if (lower.includes('mp4')) return 'mp4';
  if (lower.includes('quicktime') || lower.includes('mov')) return 'mov';
  if (lower.includes('ogg')) return 'ogv';
  return 'webm';
}

function resolveAudioExtension(contentType: string, originalName = ''): string {
  const lower = `${contentType} ${originalName}`.toLowerCase();
  if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('aac')) return 'm4a';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('ogg') || lower.includes('opus')) return 'ogg';
  if (lower.includes('webm')) return 'webm';
  return 'mp3';
}

function resolveImageExtension(contentType: string): string {
  const lower = contentType.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  return 'jpg';
}

function sanitizeSafeMediaUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().slice(0, 600);
  if (/^(\/uploads\/[a-zA-Z0-9_.\-]+|https:\/\/.+)$/.test(trimmed)) {
    return trimmed;
  }
  return '';
}

interface CatalogTrack {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  coverUrl: string;
  albumName?: string;
  durationSec?: number;
}

const trendingCache = new Map<string, { expiresAt: number; tracks: CatalogTrack[] }>();

function upgradeItunesArtwork(url: unknown): string {
  if (typeof url !== 'string' || !url.startsWith('https://')) return '';
  return url.replace(/\/\d+x\d+bb\./, '/300x300bb.').slice(0, 580);
}

function parseItunesSearchTracks(payload: unknown): CatalogTrack[] {
  if (!payload || typeof payload !== 'object' || !('results' in payload)) return [];
  const results = (payload as { results?: unknown[] }).results;
  if (!Array.isArray(results)) return [];

  const tracks: CatalogTrack[] = [];
  const seenIds = new Set<string>();

  for (const raw of results) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const audioUrl = typeof item.previewUrl === 'string' ? item.previewUrl.trim() : '';
    const title = typeof item.trackName === 'string' ? item.trackName.trim() : '';
    const artist = typeof item.artistName === 'string' ? item.artistName.trim() : '';
    if (!audioUrl.startsWith('https://') || !title || !artist) continue;

    const id = String(item.trackId || `${title}_${artist}`).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    tracks.push({
      id,
      title: title.slice(0, 80),
      artist: artist.slice(0, 80),
      audioUrl: audioUrl.slice(0, 580),
      coverUrl: upgradeItunesArtwork(item.artworkUrl100 || item.artworkUrl60),
      albumName: typeof item.collectionName === 'string' ? item.collectionName.slice(0, 80) : '',
      durationSec:
        typeof item.trackTimeMillis === 'number'
          ? Math.max(1, Math.round(item.trackTimeMillis / 1000))
          : 30,
    });
  }

  return tracks;
}

function parseAppleRssTracks(payload: unknown): CatalogTrack[] {
  if (!payload || typeof payload !== 'object' || !('feed' in payload)) return [];
  const feed = (payload as { feed?: { entry?: unknown[] } }).feed;
  const entries = Array.isArray(feed?.entry) ? feed.entry : [];

  const tracks: CatalogTrack[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;

    const idObj = entry.id as { attributes?: { 'im:id'?: string } } | undefined;
    const id = String(idObj?.attributes?.['im:id'] || '').replace(/[^a-zA-Z0-9_-]/g, '');

    const nameObj = entry['im:name'] as { label?: string } | undefined;
    const artistObj = entry['im:artist'] as { label?: string } | undefined;
    const title = typeof nameObj?.label === 'string' ? nameObj.label.trim() : '';
    const artist = typeof artistObj?.label === 'string' ? artistObj.label.trim() : '';

    const images = Array.isArray(entry['im:image'])
      ? (entry['im:image'] as { label?: string }[])
      : [];
    const lastImg = images[images.length - 1]?.label || '';

    const links = Array.isArray(entry.link)
      ? (entry.link as { attributes?: { href?: string; type?: string; rel?: string } }[])
      : [];
    const audioLink = links.find(
      (l) =>
        l?.attributes?.href?.startsWith('https://') &&
        (l.attributes.type?.startsWith('audio/') || l.attributes.rel === 'enclosure')
    );
    const audioUrl = audioLink?.attributes?.href?.trim() || '';

    if (!id || !title || !artist || !audioUrl) continue;

    tracks.push({
      id,
      title: title.slice(0, 80),
      artist: artist.slice(0, 80),
      audioUrl: audioUrl.slice(0, 580),
      coverUrl: upgradeItunesArtwork(lastImg),
      durationSec: 30,
    });
  }

  return tracks;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 6500): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SwappyMusicProxy/1.0',
      },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface LiveChatMessage {
  id: string;
  streamId: string;
  authorHandle: string;
  authorName: string;
  authorAvatarColor: string;
  authorAvatarUrl: string;
  text: string;
  createdAtMs: number;
}

interface ServerLiveStream {
  id: string;
  hostClientId: string;
  hostUid: string;
  hostHandle: string;
  hostName: string;
  hostAvatarColor: string;
  hostAvatarUrl: string;
  title: string;
  colorFilter: string;
  startedAtMs: number;
  likesCount: number;
  viewerClientIds: Set<string>;
  recentMessages: LiveChatMessage[];
  latestFrameDataUrl: string | null;
}

const clients = new Map<string, WebSocket>();
const clientWatchingStream = new Map<string, string>();
const activeStreams = new Map<string, ServerLiveStream>();

function sanitizeShortText(raw: unknown, maxLen: number, fallback = ''): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim().slice(0, maxLen);
  return trimmed || fallback;
}

function sendJson(ws: WebSocket | undefined, payload: unknown) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Ignore transient socket write errors
  }
}

function broadcastAll(payload: unknown) {
  const serialized = JSON.stringify(payload);
  for (const ws of clients.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(serialized);
      } catch {
        // Ignore
      }
    }
  }
}

function broadcastToRoom(stream: ServerLiveStream, payload: unknown, excludeClientId?: string) {
  const serialized = JSON.stringify(payload);
  const targets = [stream.hostClientId, ...Array.from(stream.viewerClientIds)];
  for (const cid of targets) {
    if (cid === excludeClientId) continue;
    const sock = clients.get(cid);
    if (sock && sock.readyState === WebSocket.OPEN) {
      try {
        sock.send(serialized);
      } catch {
        // Ignore
      }
    }
  }
}

function serializeStreamSummary(s: ServerLiveStream) {
  return {
    id: s.id,
    hostUid: s.hostUid,
    hostHandle: s.hostHandle,
    hostName: s.hostName,
    hostAvatarColor: s.hostAvatarColor,
    hostAvatarUrl: s.hostAvatarUrl,
    title: s.title,
    colorFilter: s.colorFilter,
    startedAtMs: s.startedAtMs,
    likesCount: s.likesCount,
    viewersCount: s.viewerClientIds.size,
    previewFrameUrl: s.latestFrameDataUrl,
  };
}

function serializeStreamsList() {
  return Array.from(activeStreams.values())
    .sort((a, b) => b.startedAtMs - a.startedAtMs)
    .map(serializeStreamSummary);
}

function serializeStreamDetail(s: ServerLiveStream) {
  return {
    ...serializeStreamSummary(s),
    hostClientId: s.hostClientId,
    recentMessages: s.recentMessages,
  };
}

function removeViewerFromCurrentStream(clientId: string) {
  const currentStreamId = clientWatchingStream.get(clientId);
  if (!currentStreamId) return;
  clientWatchingStream.delete(clientId);

  const stream = activeStreams.get(currentStreamId);
  if (!stream) return;

  if (stream.viewerClientIds.delete(clientId)) {
    sendJson(clients.get(stream.hostClientId), {
      type: 'webrtc:viewer-left',
      streamId: stream.id,
      viewerClientId: clientId,
    });
    broadcastToRoom(stream, {
      type: 'stream:viewers',
      streamId: stream.id,
      viewersCount: stream.viewerClientIds.size,
    });
    broadcastAll({
      type: 'streams:update',
      streams: serializeStreamsList(),
    });
  }
}

function endHostStreams(hostClientId: string) {
  let changed = false;
  for (const [streamId, stream] of activeStreams.entries()) {
    if (stream.hostClientId === hostClientId) {
      for (const viewerId of stream.viewerClientIds) {
        clientWatchingStream.delete(viewerId);
        sendJson(clients.get(viewerId), {
          type: 'stream:ended',
          streamId,
        });
      }
      activeStreams.delete(streamId);
      changed = true;
    }
  }
  if (changed) {
    broadcastAll({
      type: 'streams:update',
      streams: serializeStreamsList(),
    });
  }
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);

  // Serve uploaded user videos & custom MP3 audio with HTTP Range support
  app.use(
    '/uploads',
    express.static(uploadsDir, {
      acceptRanges: true,
      maxAge: '7d',
    })
  );

  // Healthcheck endpoint for Cloud Run readiness probes
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Active live streams snapshot endpoint
  app.get('/api/live', (_req, res) => {
    res.json({ streams: serializeStreamsList() });
  });

  // Global Music Trending Charts (Poland & Worldwide)
  app.get('/api/music/trending', async (req, res) => {
    const chart = String(req.query.chart || 'pl').toLowerCase() === 'global' ? 'us' : 'pl';
    const cacheKey = `trending_${chart}`;
    const cached = trendingCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json({ tracks: cached.tracks });
      return;
    }

    const rssJson = await fetchJsonWithTimeout(
      `https://itunes.apple.com/${chart}/rss/topsongs/limit=35/json`
    );
    let tracks = parseAppleRssTracks(rssJson);

    if (tracks.length === 0) {
      const fallbackTerm = chart === 'pl' ? 'polskie hity' : 'top hits';
      const searchJson = await fetchJsonWithTimeout(
        `https://itunes.apple.com/search?term=${encodeURIComponent(
          fallbackTerm
        )}&country=${chart.toUpperCase()}&media=music&entity=song&limit=35`
      );
      tracks = parseItunesSearchTracks(searchJson);
    }

    if (tracks.length > 0) {
      trendingCache.set(cacheKey, {
        expiresAt: Date.now() + 10 * 60 * 1000,
        tracks,
      });
    }

    res.json({ tracks });
  });

  // Worldwide Song & Artist Search (searches Polish + Global catalogs simultaneously)
  app.get('/api/music/search', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (!q) {
      res.json({ tracks: [] });
      return;
    }

    const [plData, usData] = await Promise.all([
      fetchJsonWithTimeout(
        `https://itunes.apple.com/search?term=${encodeURIComponent(
          q
        )}&country=PL&media=music&entity=song&limit=30`
      ),
      fetchJsonWithTimeout(
        `https://itunes.apple.com/search?term=${encodeURIComponent(
          q
        )}&country=US&media=music&entity=song&limit=25`
      ),
    ]);

    const plTracks = parseItunesSearchTracks(plData);
    const usTracks = parseItunesSearchTracks(usData);

    const merged: CatalogTrack[] = [];
    const seen = new Set<string>();
    for (const t of [...plTracks, ...usTracks]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      merged.push(t);
      if (merged.length >= 45) break;
    }

    res.json({ tracks: merged });
  });

  // Upload custom user MP3 / M4A / WAV audio file from device
  app.post(
    '/api/audio/upload',
    express.raw({
      type: ['audio/*', 'video/mp4', 'application/octet-stream'],
      limit: '25mb',
    }),
    (req, res) => {
      const rawId = String(req.headers['x-sound-id'] || '').trim();
      if (!/^[a-zA-Z0-9_-]{3,120}$/.test(rawId)) {
        res.status(400).json({ error: 'Nieprawidłowy identyfikator pliku audio.' });
        return;
      }

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'Brak pliku audio w żądaniu.' });
        return;
      }

      const ext = resolveAudioExtension(
        String(req.headers['content-type'] || 'audio/mpeg'),
        String(req.headers['x-file-name'] || '')
      );
      const filename = `${rawId}.${ext}`;
      const targetPath = path.join(uploadsDir, filename);

      try {
        fs.writeFileSync(targetPath, body);
        res.status(201).json({ audioUrl: `/uploads/${filename}` });
      } catch (err) {
        console.error('Audio write error:', err);
        res.status(500).json({ error: 'Nie udało się zapisać pliku muzycznego.' });
      }
    }
  );

  // Upload user profile photo (cropped JPEG/PNG/WebP)
  app.post(
    '/api/avatars/upload',
    express.raw({
      type: ['image/*', 'application/octet-stream'],
      limit: '10mb',
    }),
    (req, res) => {
      const rawId = String(req.headers['x-avatar-id'] || '').trim();
      if (!/^[a-zA-Z0-9_-]{3,120}$/.test(rawId)) {
        res.status(400).json({ error: 'Nieprawidłowy identyfikator zdjęcia profilowego.' });
        return;
      }

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'Brak pliku obrazu w żądaniu.' });
        return;
      }

      const ext = resolveImageExtension(String(req.headers['content-type'] || 'image/jpeg'));
      const filename = `${rawId}.${ext}`;
      const targetPath = path.join(uploadsDir, filename);

      try {
        fs.writeFileSync(targetPath, body);
        res.status(201).json({ avatarUrl: `/uploads/${filename}` });
      } catch (err) {
        console.error('Avatar write error:', err);
        res.status(500).json({ error: 'Nie udało się zapisać zdjęcia profilowego.' });
      }
    }
  );

  // Upload raw user video recorded from camera or chosen from device gallery
  app.post(
    '/api/videos/upload',
    express.raw({
      type: ['video/*', 'application/octet-stream'],
      limit: '65mb',
    }),
    (req, res) => {
      const rawId = String(req.headers['x-video-id'] || '').trim();
      if (!/^[a-zA-Z0-9_-]{3,120}$/.test(rawId)) {
        res.status(400).json({ error: 'Nieprawidłowy identyfikator filmu.' });
        return;
      }

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'Brak pliku wideo w żądaniu.' });
        return;
      }

      const ext = resolveVideoExtension(String(req.headers['content-type'] || 'video/webm'));
      const filename = `${rawId}.${ext}`;
      const targetPath = path.join(uploadsDir, filename);

      try {
        fs.writeFileSync(targetPath, body);
        res.status(201).json({ videoUrl: `/uploads/${filename}` });
      } catch (err) {
        console.error('Video write error:', err);
        res.status(500).json({ error: 'Nie udało się zapisać pliku wideo.' });
      }
    }
  );

  // Optional cleanup when creator deletes their video
  app.delete('/api/videos/:videoId', (req, res) => {
    const rawId = String(req.params.videoId || '').trim();
    if (!/^[a-zA-Z0-9_-]{3,120}$/.test(rawId)) {
      res.status(400).json({ error: 'Nieprawidłowy identyfikator.' });
      return;
    }

    try {
      const files = fs.readdirSync(uploadsDir);
      for (const file of files) {
        if (file.startsWith(`${rawId}.`)) {
          fs.unlinkSync(path.join(uploadsDir, file));
        }
      }
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });

  // Real-time WebSocket signaling & live room server on /ws/live
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url?.startsWith('/ws/live')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws) => {
    const clientId = `cli_${crypto.randomBytes(6).toString('hex')}`;
    clients.set(clientId, ws);

    sendJson(ws, {
      type: 'welcome',
      clientId,
      streams: serializeStreamsList(),
    });

    ws.on('message', (rawBuf) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(rawBuf)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');

      if (type === 'stream:list') {
        sendJson(ws, {
          type: 'streams:update',
          streams: serializeStreamsList(),
        });
        return;
      }

      if (type === 'stream:start') {
        const followersCount =
          typeof msg.followersCount === 'number' && Number.isFinite(msg.followersCount)
            ? msg.followersCount
            : 0;
        if (followersCount < 500) {
          sendJson(ws, {
            type: 'stream:error',
            code: 'INSUFFICIENT_FOLLOWERS',
            message: 'Transmisje na żywo LIVE są dostępne dopiero od 500 obserwujących.',
          });
          return;
        }

        endHostStreams(clientId);
        removeViewerFromCurrentStream(clientId);

        const requestedId = sanitizeShortText(msg.streamId, 100);
        const validRequestedId =
          /^[a-zA-Z0-9_-]{4,100}$/.test(requestedId) && !activeStreams.has(requestedId)
            ? requestedId
            : `live_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

        const newStream: ServerLiveStream = {
          id: validRequestedId,
          hostClientId: clientId,
          hostUid: sanitizeShortText(msg.hostUid, 128, clientId),
          hostHandle: sanitizeShortText(msg.hostHandle, 32, 'tworca_live'),
          hostName: sanitizeShortText(msg.hostName, 50, 'Twórca Swappy'),
          hostAvatarColor: sanitizeShortText(msg.hostAvatarColor, 16, '#FE2C55'),
          hostAvatarUrl: sanitizeSafeMediaUrl(msg.hostAvatarUrl),
          title: sanitizeShortText(msg.title, 90, 'Transmisja na żywo'),
          colorFilter: sanitizeShortText(msg.colorFilter, 16, 'normal'),
          startedAtMs: Date.now(),
          likesCount: 0,
          viewerClientIds: new Set<string>(),
          recentMessages: [],
          latestFrameDataUrl: null,
        };

        activeStreams.set(validRequestedId, newStream);

        sendJson(ws, {
          type: 'stream:started',
          stream: serializeStreamDetail(newStream),
        });

        broadcastAll({
          type: 'streams:update',
          streams: serializeStreamsList(),
        });
        return;
      }

      if (type === 'stream:filter') {
        const streamId = sanitizeShortText(msg.streamId, 100);
        const stream = activeStreams.get(streamId);
        if (!stream || stream.hostClientId !== clientId) return;

        stream.colorFilter = sanitizeShortText(msg.colorFilter, 16, 'normal');
        broadcastToRoom(stream, {
          type: 'stream:filter',
          streamId: stream.id,
          colorFilter: stream.colorFilter,
        });
        broadcastAll({
          type: 'streams:update',
          streams: serializeStreamsList(),
        });
        return;
      }

      if (type === 'stream:frame') {
        const streamId = sanitizeShortText(msg.streamId, 100);
        const stream = activeStreams.get(streamId);
        if (!stream || stream.hostClientId !== clientId) return;

        const frameDataUrl = typeof msg.frameDataUrl === 'string' ? msg.frameDataUrl : '';
        if (!frameDataUrl.startsWith('data:image/') || frameDataUrl.length > 350_000) return;

        stream.latestFrameDataUrl = frameDataUrl;
        for (const viewerId of stream.viewerClientIds) {
          sendJson(clients.get(viewerId), {
            type: 'stream:frame',
            streamId: stream.id,
            frameDataUrl,
          });
        }
        return;
      }

      if (type === 'stream:join') {
        const streamId = sanitizeShortText(msg.streamId, 100);
        const stream = activeStreams.get(streamId);
        if (!stream) {
          sendJson(ws, { type: 'stream:ended', streamId });
          return;
        }

        if (stream.hostClientId === clientId) return;

        removeViewerFromCurrentStream(clientId);
        stream.viewerClientIds.add(clientId);
        clientWatchingStream.set(clientId, stream.id);

        sendJson(ws, {
          type: 'stream:joined',
          stream: serializeStreamDetail(stream),
        });

        sendJson(clients.get(stream.hostClientId), {
          type: 'webrtc:viewer-joined',
          streamId: stream.id,
          viewerClientId: clientId,
        });

        broadcastToRoom(stream, {
          type: 'stream:viewers',
          streamId: stream.id,
          viewersCount: stream.viewerClientIds.size,
        });

        broadcastAll({
          type: 'streams:update',
          streams: serializeStreamsList(),
        });
        return;
      }

      if (type === 'stream:leave') {
        removeViewerFromCurrentStream(clientId);
        return;
      }

      if (type === 'stream:end') {
        endHostStreams(clientId);
        return;
      }

      if (type === 'stream:chat') {
        const streamId = sanitizeShortText(msg.streamId, 100);
        const stream = activeStreams.get(streamId);
        if (!stream) return;

        const isParticipant =
          stream.hostClientId === clientId || stream.viewerClientIds.has(clientId);
        if (!isParticipant) return;

        const text = sanitizeShortText(msg.text, 200);
        if (!text) return;

        const chatMessage: LiveChatMessage = {
          id: `lmsg_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
          streamId: stream.id,
          authorHandle: sanitizeShortText(msg.authorHandle, 32, 'widz'),
          authorName: sanitizeShortText(msg.authorName, 50, 'Widz'),
          authorAvatarColor: sanitizeShortText(msg.authorAvatarColor, 16, '#25F4EE'),
          authorAvatarUrl: sanitizeSafeMediaUrl(msg.authorAvatarUrl),
          text,
          createdAtMs: Date.now(),
        };

        stream.recentMessages.push(chatMessage);
        if (stream.recentMessages.length > 50) {
          stream.recentMessages.shift();
        }

        broadcastToRoom(stream, {
          type: 'stream:chat',
          streamId: stream.id,
          message: chatMessage,
        });
        return;
      }

      if (type === 'stream:heart') {
        const streamId = sanitizeShortText(msg.streamId, 100);
        const stream = activeStreams.get(streamId);
        if (!stream) return;

        stream.likesCount += 1;
        broadcastToRoom(stream, {
          type: 'stream:heart',
          streamId: stream.id,
          likesCount: stream.likesCount,
          burstId: `hb_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
          color: sanitizeShortText(msg.color, 16, '#FE2C55'),
        });
        return;
      }

      // Direct WebRTC signaling relay between broadcaster & viewer
      if (
        type === 'webrtc:offer' ||
        type === 'webrtc:answer' ||
        type === 'webrtc:ice-candidate'
      ) {
        const targetClientId = sanitizeShortText(msg.targetClientId, 80);
        const streamId = sanitizeShortText(msg.streamId, 100);
        const targetWs = clients.get(targetClientId);
        if (!targetWs) return;

        sendJson(targetWs, {
          type,
          streamId,
          fromClientId: clientId,
          sdp: msg.sdp ?? null,
          candidate: msg.candidate ?? null,
        });
      }
    });

    ws.on('close', () => {
      removeViewerFromCurrentStream(clientId);
      endHostStreams(clientId);
      clients.delete(clientId);
    });
  });

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Nie znaleziono endpointu API.' });
  });

  app.use((req, res, next) => {
    if (req.path === '/manifest.webmanifest') {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
    } else if (req.path === '/sw.js' || req.path === '/dev-sw.js') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  const isProd =
    process.env.NODE_ENV === 'production' ||
    (!process.env.NODE_ENV && fs.existsSync(path.join(distDir, 'index.html')));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Swappy server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
