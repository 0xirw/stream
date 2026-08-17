import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = fileURLToPath(new URL('./stream/', import.meta.url));
const REAL_DEBRID_BASE = 'https://api.real-debrid.com/rest/1.0';
const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const TORRENTIO_BASE = 'https://torrentio.strem.fun';
const SUBDL_API_BASE = 'https://api.subdl.com/api/v1';
const SUBDL_DOWNLOAD_HOST = 'dl.subdl.com';
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v', '.ts']);
const mediaTickets = new Map();
const subtitleTickets = new Map();
const subtitleCache = new Map();
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' https: data:",
    "media-src 'self' https: blob: data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'"
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function extractInfoHash(magnet) {
  if (typeof magnet !== 'string' || magnet.length > 4096) return null;
  try {
    const url = new URL(magnet);
    if (url.protocol !== 'magnet:') return null;
    const exactTopic = url.searchParams.getAll('xt').find((value) => value.toLowerCase().startsWith('urn:btih:'));
    if (!exactTopic) return null;
    const hash = exactTopic.slice('urn:btih:'.length);
    return /^[a-f\d]{40}$/i.test(hash) || /^[a-z2-7]{32}$/i.test(hash) ? hash.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function selectVideoFile(files, requestedIndex) {
  if (!Array.isArray(files) || files.length === 0) return null;
  if (Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < files.length) {
    const requested = files[requestedIndex];
    if (VIDEO_EXTENSIONS.has(extname(requested.path || '').toLowerCase())) return requested;
  }
  return files
    .filter((file) => VIDEO_EXTENSIONS.has(extname(file.path || '').toLowerCase()))
    .sort((a, b) => Number(b.bytes || 0) - Number(a.bytes || 0))[0] || null;
}

export function pickLiveMp4(transcode) {
  const liveMp4 = transcode?.liveMP4;
  if (!liveMp4 || typeof liveMp4 !== 'object') return null;
  const qualities = Object.keys(liveMp4);
  const preferred = ['original', 'full', '2160', '1440', '1080', '720'].find((quality) => liveMp4[quality]) || qualities[0];
  return preferred && typeof liveMp4[preferred] === 'string' ? liveMp4[preferred] : null;
}

function json(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes = 16_384) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) throw new HttpError(413, 'Request body is too large.');
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20_000) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(url, { ...options, signal });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new HttpError(504, 'The upstream service timed out.');
    throw new HttpError(502, 'The upstream service could not be reached.');
  }
}

async function fetchStreamResponse(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new HttpError(504, 'The media host timed out while opening the stream.');
    throw new HttpError(502, 'The media host could not be reached.');
  } finally {
    // Only opening the response is timed. The media body may stream for hours.
    clearTimeout(timeout);
  }
}

async function upstreamJson(url, options = {}, timeoutMs = 20_000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpError(response.status >= 500 ? 502 : response.status, data?.error || 'An upstream request failed.', data?.error_code);
  }
  return data;
}

function requireToken() {
  const token = typeof process === 'undefined' ? '' : process.env.REAL_DEBRID_TOKEN?.trim();
  if (!token) throw new HttpError(503, 'Real-Debrid is not configured on the server.');
  return token;
}

function requireSubdlKey() {
  const key = typeof process === 'undefined' ? '' : process.env.SUBDL_API_KEY?.trim();
  if (!key) throw new HttpError(503, 'SubDL is not configured. Add SUBDL_API_KEY to .env.');
  return key;
}

function sanitizeSubtitleText(value) {
  return value
    .replace(/\{\\[^}]+\}/g, '')
    .replace(/<(?!\/?(?:i|b|u|c)(?:\.[\w-]+)?\b)[^>]*>/gi, '')
    .trim();
}

export function convertToVtt(input) {
  const text = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return 'WEBVTT\n\n';
  if (/^WEBVTT(?:\s|$)/i.test(text)) return `${text}\n`;

  if (/^\[Script Info\]/im.test(text) && /^\[Events\]/im.test(text)) {
    const eventText = text.split(/^\[Events\]\s*$/im)[1] || '';
    let columns = [];
    const cues = [];
    const toVttTime = (value) => {
      const match = /^(\d+):(\d{2}):(\d{2})[.](\d{2})$/.exec(value || '');
      return match ? `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}.${match[4]}0` : null;
    };
    for (const line of eventText.split('\n')) {
      if (/^Format:/i.test(line)) {
        columns = line.slice(line.indexOf(':') + 1).split(',').map((value) => value.trim().toLowerCase());
        continue;
      }
      if (!/^Dialogue:/i.test(line) || !columns.length) continue;
      let remaining = line.slice(line.indexOf(':') + 1);
      const fields = [];
      for (let index = 0; index < columns.length - 1; index += 1) {
        const comma = remaining.indexOf(',');
        if (comma < 0) break;
        fields.push(remaining.slice(0, comma));
        remaining = remaining.slice(comma + 1);
      }
      fields.push(remaining);
      if (fields.length !== columns.length) continue;
      const startTime = toVttTime(fields[columns.indexOf('start')]?.trim());
      const endTime = toVttTime(fields[columns.indexOf('end')]?.trim());
      const cueText = sanitizeSubtitleText(fields[columns.indexOf('text')]?.replace(/\\N/gi, '\n') || '');
      if (startTime && endTime && cueText) cues.push(`${startTime} --> ${endTime}\n${cueText}`);
    }
    return `WEBVTT\n\n${cues.join('\n\n')}\n`;
  }

  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => /\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+/.test(line));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].replace(/(\d{1,2}:\d{2}:\d{2}),([0-9]{3})/g, '$1.$2');
    const cueText = sanitizeSubtitleText(lines.slice(timingIndex + 1).join('\n'));
    if (cueText) cues.push(`${timing}\n${cueText}`);
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

function subdlDownloadUrl(path, language) {
  let downloadUrl;
  try {
    downloadUrl = new URL(path, `https://${SUBDL_DOWNLOAD_HOST}`);
  } catch {
    throw new HttpError(502, `SubDL returned an invalid ${language} subtitle link.`);
  }
  if (downloadUrl.protocol !== 'https:' || downloadUrl.hostname !== SUBDL_DOWNLOAD_HOST) {
    throw new HttpError(502, `SubDL returned an untrusted ${language} subtitle link.`);
  }
  return downloadUrl;
}

function decodeSubtitleBytes(bytes, language) {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const replacements = (utf8.match(/\uFFFD/g) || []).length;
  if (replacements <= Math.max(2, utf8.length / 500)) return utf8;
  return new TextDecoder(language === 'ar' ? 'windows-1256' : 'windows-1252').decode(bytes);
}

function createSubtitleTrack(text, language) {
  const vtt = convertToVtt(text);
  if (!vtt.includes('-->')) throw new HttpError(502, `The ${language} subtitle file had no playable captions.`);
  const ticket = randomUUID();
  subtitleTickets.set(ticket, { vtt, expiresAt: Date.now() + 4 * 60 * 60 * 1000 });
  return {
    label: language === 'ar' ? 'العربية' : 'English',
    srclang: language,
    src: `/api/subtitles/${ticket}.vtt`
  };
}

async function downloadSubtitle(path, language) {
  const downloadUrl = subdlDownloadUrl(path, language);
  const response = await fetchWithTimeout(downloadUrl, { headers: { 'x-api-key': requireSubdlKey() } }, 20_000);
  if (!response.ok) throw new HttpError(502, `The ${language} subtitle file could not be downloaded.`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 10 * 1024 * 1024) throw new HttpError(502, 'The subtitle file is unexpectedly large.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 10 * 1024 * 1024) throw new HttpError(502, 'The subtitle file is unexpectedly large.');
  return createSubtitleTrack(decodeSubtitleBytes(bytes, language), language);
}

async function downloadSubtitleArchive(path, names, language) {
  const response = await fetchWithTimeout(subdlDownloadUrl(path, language), {
    headers: { 'x-api-key': requireSubdlKey() }
  }, 30_000);
  if (!response.ok) throw new HttpError(502, `The ${language} subtitle archive could not be downloaded.`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 50 * 1024 * 1024) throw new HttpError(502, 'The subtitle archive is unexpectedly large.');
  const compressed = new Uint8Array(await response.arrayBuffer());
  if (compressed.length > 50 * 1024 * 1024) throw new HttpError(502, 'The subtitle archive is unexpectedly large.');
  let files;
  try {
    files = unzipSync(compressed);
  } catch {
    throw new HttpError(502, 'The subtitle archive could not be unpacked.');
  }
  const wanted = new Set(names.map((name) => String(name || '').toLowerCase()));
  const entry = Object.entries(files).find(([entryPath]) => wanted.has(entryPath.split('/').pop().toLowerCase()));
  if (!entry) throw new HttpError(502, `The ${language} episode was missing from its subtitle archive.`);
  return createSubtitleTrack(decodeSubtitleBytes(entry[1], language), language);
}

async function downloadFirstAvailable(candidates, language) {
  let lastError;
  for (const candidate of candidates.slice(0, 8)) {
    try {
      return await downloadSubtitle(candidate.url, language);
    } catch (error) {
      lastError = error;
    }
  }
  const archives = new Map();
  for (const candidate of candidates) {
    if (!candidate.archiveUrl) continue;
    const names = archives.get(candidate.archiveUrl) || [];
    names.push(candidate.name);
    archives.set(candidate.archiveUrl, names);
  }
  for (const [archiveUrl, names] of [...archives].slice(0, 4)) {
    try {
      return await downloadSubtitleArchive(archiveUrl, names, language);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new HttpError(404, `No ${language} subtitles were found.`);
}

async function searchSubdl({ imdbId, type, season, episode, language }) {
  const params = new URLSearchParams({
    api_key: requireSubdlKey(),
    imdb_id: imdbId,
    type: type === 'series' ? 'tv' : 'movie',
    languages: language.toUpperCase(),
    subs_per_page: '30',
    unpack: '1',
    client: 'stream_local'
  });
  if (type === 'series') {
    params.set('season_number', String(season));
    params.set('episode_number', String(episode));
  }
  const result = await upstreamJson(`${SUBDL_API_BASE}/subtitles?${params}`);
  const candidates = (result?.subtitles || []).flatMap((subtitle) => {
    const files = Array.isArray(subtitle.unpack_files) && subtitle.unpack_files.length
      ? subtitle.unpack_files
      : [subtitle];
    return files.map((file) => ({
      ...file,
      language: String(file.language || subtitle.language || '').toUpperCase(),
      season: file.season ?? subtitle.season,
      episode: file.episode ?? subtitle.episode,
      hi: file.hi ?? subtitle.hi,
      archiveUrl: file === subtitle ? null : subtitle.url
    }));
  }).filter((file) => file.url
    && file.language === language.toUpperCase()
    && ['srt', 'vtt', 'ass', 'ssa'].includes(String(file.format || '').toLowerCase()));

  const exactEpisode = type === 'series'
    ? candidates.filter((file) => Number(file.season) === season && Number(file.episode) === episode)
    : candidates;
  const pool = exactEpisode.length ? exactEpisode : candidates;
  pool.sort((a, b) => Number(Boolean(a.hi)) - Number(Boolean(b.hi)));
  return pool.filter((file, index) => pool.findIndex((candidate) => candidate.url === file.url) === index);
}

async function findSubtitles({ imdbId, type, season, episode }) {
  requireSubdlKey();
  const cacheKey = `${imdbId}:${type}:${season || 0}:${episode || 0}`;
  const cached = subtitleCache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.tracks;

  const searches = await Promise.allSettled(['ar', 'en'].map(async (language) => ({
    language,
    candidates: await searchSubdl({ imdbId, type, season, episode, language })
  })));
  const files = searches.flatMap((result) => result.status === 'fulfilled' && result.value.candidates.length ? [result.value] : []);
  const tracks = (await Promise.allSettled(
    files.map(({ candidates, language }) => downloadFirstAvailable(candidates, language))
  )).flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  subtitleCache.set(cacheKey, { tracks, expiresAt: Date.now() + 3 * 60 * 60 * 1000 });
  return tracks;
}

async function realDebrid(path, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${requireToken()}` };
  let requestBody;
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    requestBody = new URLSearchParams(body).toString();
  }
  return upstreamJson(`${REAL_DEBRID_BASE}${path}`, { method, headers, body: requestBody });
}

async function realDebridNoContent(path, body) {
  const response = await fetchWithTimeout(`${REAL_DEBRID_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireToken()}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(body).toString()
  });
  if (![200, 202, 204].includes(response.status)) {
    const data = await response.json().catch(() => null);
    throw new HttpError(response.status >= 500 ? 502 : response.status, data?.error || 'Real-Debrid rejected the request.', data?.error_code);
  }
}

async function findExistingTorrent(hash) {
  const torrents = await realDebrid('/torrents?limit=5000');
  return torrents.find((torrent) => torrent.hash?.toLowerCase() === hash.toLowerCase()) || null;
}

async function addMagnet(magnet, hash) {
  const existing = await findExistingTorrent(hash);
  if (existing) return existing;
  try {
    return await realDebrid('/torrents/addMagnet', { method: 'POST', body: { magnet } });
  } catch (error) {
    if (error.details !== 33 && error.status !== 451) throw error;
    const recovered = await findExistingTorrent(hash);
    if (!recovered) throw error;
    return recovered;
  }
}

async function torrentResult(torrentId) {
  const info = await realDebrid(`/torrents/info/${encodeURIComponent(torrentId)}`);
  if (info.status !== 'downloaded' || !info.links?.length) {
    const failed = ['magnet_error', 'error', 'virus', 'dead'].includes(info.status);
    return {
      ready: false,
      failed,
      status: info.status,
      progress: Number(info.progress || 0)
    };
  }
  const unrestricted = await realDebrid('/unrestrict/link', {
    method: 'POST',
    body: { link: info.links[0] }
  });
  if (!unrestricted?.download) throw new HttpError(502, 'Real-Debrid did not return a playable link.');

  let mediaUrl = unrestricted.download;
  let mimeType = unrestricted.mimeType || 'application/octet-stream';
  let transcodeCandidates = [];
  let dashUrl = null;
  if (unrestricted.id && unrestricted.streamable) {
    try {
      const transcode = await realDebrid(`/streaming/transcode/${encodeURIComponent(unrestricted.id)}`);
      if (typeof transcode?.dash?.full === 'string') dashUrl = transcode.dash.full;
      const liveMp4 = pickLiveMp4(transcode);
      const h264WebM = transcode?.h264WebM?.full;
      if (liveMp4 && !['video/mp4', 'video/webm'].includes(mimeType)) {
        mediaUrl = liveMp4;
        mimeType = 'video/mp4';
        transcodeCandidates = [
          { url: liveMp4, mimeType: 'video/mp4', isTranscode: true },
          ...(typeof h264WebM === 'string' ? [{ url: h264WebM, mimeType: 'video/webm', isTranscode: true }] : [])
        ];
      }
    } catch {
      // Some files have no transcode. The original unrestricted link remains usable.
    }
  }

  const ticket = randomUUID();
  mediaTickets.set(ticket, {
    url: mediaUrl,
    mimeType,
    candidates: [
      ...transcodeCandidates,
      { url: unrestricted.download, mimeType: unrestricted.mimeType || 'application/octet-stream', isTranscode: false }
    ],
    dashUrl,
    expiresAt: Date.now() + 4 * 60 * 60 * 1000
  });
  return {
    ready: true,
    url: dashUrl ? `/api/media/${ticket}/manifest.mpd` : `/api/media/${ticket}`,
    mimeType: dashUrl ? 'application/dash+xml' : mimeType,
    streamType: dashUrl ? 'dash' : 'file',
    filename: unrestricted.filename || info.filename || 'Video'
  };
}

async function proxyDashMedia(req, res, media, ticket, resourcePath, search) {
  const manifestUrl = new URL(media.dashUrl);
  const upstreamUrl = resourcePath === 'manifest.mpd'
    ? manifestUrl
    : resourcePath.startsWith('dash-origin/')
      ? new URL(`/${resourcePath.slice('dash-origin/'.length)}${search}`, manifestUrl.origin)
      : new URL(`${resourcePath}${search}`, manifestUrl);
  if (upstreamUrl.origin !== manifestUrl.origin) throw new HttpError(400, 'Invalid DASH resource path.');

  const requestHeaders = {};
  if (req.headers.range) requestHeaders.Range = req.headers.range;
  let upstream = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    upstream = await fetchStreamResponse(upstreamUrl, { method: req.method, headers: requestHeaders }, 20_000);
    if (upstream.status !== 503) break;
    await upstream.body?.cancel();
    upstream = null;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (!upstream || ![200, 206].includes(upstream.status)) {
    await upstream?.body?.cancel();
    throw new HttpError(502, 'Real-Debrid could not prepare the adaptive stream.');
  }
  if (resourcePath === 'manifest.mpd') {
    const manifest = await upstream.text();
    const localOriginPath = `/api/media/${ticket}/dash-origin/`;
    const rewritten = manifest.replaceAll(`${manifestUrl.origin}/`, localOriginPath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/dash+xml; charset=utf-8'
    });
    return res.end(rewritten);
  }
  const responseHeaders = {
    ...SECURITY_HEADERS,
    'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Type': resourcePath === 'manifest.mpd'
      ? 'application/dash+xml; charset=utf-8'
      : upstream.headers.get('content-type') || 'video/mp4'
  };
  for (const name of ['content-length', 'content-range']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  res.writeHead(upstream.status, responseHeaders);
  if (req.method === 'HEAD' || !upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}

async function proxyMedia(req, res, ticket, resourcePath = '', search = '') {
  const media = mediaTickets.get(ticket);
  if (!media || media.expiresAt < Date.now()) {
    mediaTickets.delete(ticket);
    throw new HttpError(404, 'This media link has expired. Please select the source again.');
  }
  if (media.dashUrl) return proxyDashMedia(req, res, media, ticket, resourcePath, search);
  if (resourcePath) throw new HttpError(404, 'Media resource not found.');
  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;
  let upstream = null;
  for (const candidate of media.candidates) {
    for (let attempt = 0; attempt < (candidate.isTranscode ? 8 : 1); attempt += 1) {
      try {
        upstream = await fetchStreamResponse(candidate.url, { method: req.method, headers }, 15_000);
      } catch (error) {
        upstream = null;
        if (!candidate.isTranscode) throw error;
        break;
      }
      if (upstream.status !== 503 || !candidate.isTranscode) break;
      await upstream.body?.cancel();
      upstream = null;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    if (upstream && [200, 206].includes(upstream.status)) {
      media.mimeType = candidate.mimeType;
      break;
    }
    await upstream?.body?.cancel();
    upstream = null;
  }
  if (!upstream) throw new HttpError(502, 'Real-Debrid could not prepare a browser-compatible stream.');
  const responseHeaders = {
    ...SECURITY_HEADERS,
    'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Type': ['application/force-download', 'application/octet-stream'].includes(upstream.headers.get('content-type'))
      ? media.mimeType
      : upstream.headers.get('content-type') || media.mimeType
  };
  for (const name of ['content-length', 'content-range']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  res.writeHead(upstream.status, responseHeaders);
  if (req.method === 'HEAD' || !upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}

function imagePlaceholder(kind) {
  const dimensions = kind === 'thumb' ? 'viewBox="0 0 160 90"' : 'viewBox="0 0 300 450"';
  return `<svg xmlns="http://www.w3.org/2000/svg" ${dimensions}><rect width="100%" height="100%" fill="#111"/><path d="M45 60h70v45H45z" fill="#222"/><circle cx="68" cy="76" r="8" fill="#555"/></svg>`;
}

async function proxyImage(req, res, url) {
  const source = url.searchParams.get('url');
  const kind = url.searchParams.get('kind') === 'thumb' ? 'thumb' : 'poster';
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new HttpError(400, 'Invalid image URL.');
  }
  if (parsed.protocol !== 'https:' || !(parsed.hostname === 'metahub.space' || parsed.hostname.endsWith('.metahub.space'))) {
    throw new HttpError(400, 'Image host is not allowed.');
  }
  try {
    const upstream = await fetchWithTimeout(parsed.href, {}, 8_000);
    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !contentType.startsWith('image/') || !upstream.body) throw new Error('Missing image');
    res.writeHead(200, { ...SECURITY_HEADERS, 'Cache-Control': 'public, max-age=86400', 'Content-Type': contentType });
    Readable.fromWeb(upstream.body).pipe(res);
  } catch {
    const placeholder = imagePlaceholder(kind);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'image/svg+xml; charset=utf-8' });
    res.end(placeholder);
  }
}

async function resolveMagnet(magnet, fileIndex) {
  const hash = extractInfoHash(magnet);
  if (!hash) throw new HttpError(400, 'A valid BitTorrent magnet link is required.');
  const added = await addMagnet(magnet, hash);
  if (!added?.id) throw new HttpError(502, 'Real-Debrid did not return a torrent identifier.');

  const info = await realDebrid(`/torrents/info/${encodeURIComponent(added.id)}`);
  if (info.status === 'waiting_files_selection') {
    const file = selectVideoFile(info.files, fileIndex);
    if (!file) throw new HttpError(422, 'This torrent does not contain a supported video file.');
    await realDebridNoContent(`/torrents/selectFiles/${encodeURIComponent(added.id)}`, { files: String(file.id) });
  }

  return { torrentId: String(added.id), ...(await torrentResult(added.id)) };
}

function validateMediaType(value) {
  if (!['movie', 'series'].includes(value)) throw new HttpError(400, 'Media type must be movie or series.');
  return value;
}

function validateMediaId(value) {
  if (!/^tt\d+(?::\d+:\d+)?$/.test(value || '')) throw new HttpError(400, 'Invalid IMDb media identifier.');
  return value;
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/search') {
    const query = url.searchParams.get('q')?.trim();
    if (!query || query.length < 2 || query.length > 100) throw new HttpError(400, 'Search query must contain 2–100 characters.');
    const encoded = encodeURIComponent(query);
    const paths = [`/catalog/movie/top/search=${encoded}.json`, `/catalog/series/top/search=${encoded}.json`];
    const results = await Promise.allSettled(paths.map((path) => upstreamJson(`${CINEMETA_BASE}${path}`)));
    const metas = results.flatMap((result) => result.status === 'fulfilled' ? result.value.metas || [] : []);
    if (!metas.length && results.every((result) => result.status === 'rejected')) throw new HttpError(502, 'Cinemeta is unavailable.');
    return json(res, 200, { results: metas });
  }

  if (req.method === 'GET' && url.pathname === '/api/meta') {
    const type = validateMediaType(url.searchParams.get('type'));
    const id = validateMediaId(url.searchParams.get('id'));
    const data = await upstreamJson(`${CINEMETA_BASE}/meta/${type}/${encodeURIComponent(id)}.json`);
    return json(res, 200, { metadata: data.meta || null });
  }

  if (req.method === 'GET' && url.pathname === '/api/streams') {
    const type = validateMediaType(url.searchParams.get('type'));
    const id = validateMediaId(url.searchParams.get('id'));
    const data = await upstreamJson(`${TORRENTIO_BASE}/stream/${type}/${encodeURIComponent(id)}.json`, {}, 25_000);
    return json(res, 200, { streams: data.streams || [] });
  }

  if (req.method === 'GET' && url.pathname === '/api/subtitles') {
    const type = validateMediaType(url.searchParams.get('type'));
    const imdbId = validateMediaId(url.searchParams.get('imdbId'))?.split(':')[0];
    const season = Number.parseInt(url.searchParams.get('season') || '', 10);
    const episode = Number.parseInt(url.searchParams.get('episode') || '', 10);
    if (type === 'series' && (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1)) {
      throw new HttpError(400, 'A valid season and episode are required for series subtitles.');
    }
    const tracks = await findSubtitles({ imdbId, type, season, episode });
    return json(res, 200, { tracks });
  }

  if (req.method === 'GET' && url.pathname === '/api/debrid/status') {
    const user = await realDebrid('/user');
    return json(res, 200, { configured: true, accountType: user.type, expiration: user.expiration });
  }

  if (req.method === 'POST' && url.pathname === '/api/debrid/resolve') {
    const body = await readJson(req);
    const fileIndex = Number.isInteger(body.fileIndex) ? body.fileIndex : null;
    try {
      const result = await resolveMagnet(body.magnet, fileIndex);
      return json(res, result.ready ? 200 : 202, result);
    } catch (error) {
      if (error instanceof HttpError && error.status === 451 && error.message === 'infringing_file') {
        return json(res, 200, { ready: false, failed: true, retryable: true, status: 'infringing_file' });
      }
      throw error;
    }
  }

  const torrentMatch = url.pathname.match(/^\/api\/debrid\/torrents\/([a-zA-Z0-9]+)$/);
  if (req.method === 'GET' && torrentMatch) {
    const result = await torrentResult(torrentMatch[1]);
    return json(res, result.ready ? 200 : 202, { torrentId: torrentMatch[1], ...result });
  }

  throw new HttpError(404, 'API endpoint not found.');
}

function serveSubtitle(res, ticket) {
  const subtitle = subtitleTickets.get(ticket);
  if (!subtitle || subtitle.expiresAt < Date.now()) {
    subtitleTickets.delete(ticket);
    throw new HttpError(404, 'This subtitle link has expired.');
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Cache-Control': 'private, max-age=3600',
    'Content-Type': 'text/vtt; charset=utf-8'
  });
  res.end(subtitle.vtt);
}

async function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
  let requested;
  try {
    requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new HttpError(400, 'Malformed URL.');
  }
  const relative = normalize(requested).replace(/^([.][.][\\/])+/, '');
  const filePath = join(ROOT, relative);
  if (!filePath.startsWith(ROOT)) throw new HttpError(403, 'Forbidden.');
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) throw new HttpError(404, 'File not found.');
  const headers = {
    ...SECURITY_HEADERS,
    'Cache-Control': ['.html', '.js', '.css'].includes(extname(filePath).toLowerCase()) ? 'no-cache' : 'public, max-age=3600',
    'Content-Length': info.size,
    'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream'
  };
  if (relative === 'index.html') headers['Clear-Site-Data'] = '"cache", "storage"';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
}

export function createAppServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const mediaMatch = url.pathname.match(/^\/api\/media\/([a-f\d-]{36})(?:\/(.+))?$/i);
      const subtitleMatch = url.pathname.match(/^\/api\/subtitles\/([a-f\d-]{36})\.vtt$/i);
      if (mediaMatch && ['GET', 'HEAD'].includes(req.method)) await proxyMedia(req, res, mediaMatch[1], mediaMatch[2] || '', url.search);
      else if (subtitleMatch && req.method === 'GET') serveSubtitle(res, subtitleMatch[1]);
      else if (req.method === 'GET' && url.pathname === '/api/image') await proxyImage(req, res, url);
      else if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else await serveStatic(req, res, url);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (!(error instanceof HttpError)) console.error(error);
      json(res, status, { error: status === 500 ? 'Internal server error.' : error.message });
    }
  });
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT || '4173', 10);
  const server = createAppServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Stream is running at http://localhost:${port}`);
  });
}
