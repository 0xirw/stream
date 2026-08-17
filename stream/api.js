const DEFAULT_TIMEOUT = 25_000;

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, options = {}, timeoutMs = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options.signal;
  const abort = () => controller.abort();
  externalSignal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...options.headers }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) {
      throw new ApiError(data.error || `Request failed with status ${response.status}.`, response.status);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      if (externalSignal?.aborted) throw error;
      throw new ApiError('The request timed out. Please try again.', 408);
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError('The server could not be reached.');
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abort);
  }
}

export async function searchMedia(query, signal) {
  const data = await request(`/api/search?q=${encodeURIComponent(query)}`, { signal });
  return data.results || [];
}

export async function getMetadata(type, id, signal) {
  const data = await request(`/api/meta?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`, { signal });
  return data.metadata || null;
}

export async function getStreams(type, id, signal) {
  const data = await request(`/api/streams?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`, { signal }, 30_000);
  return data.streams || [];
}

export function getDebridStatus(signal) {
  return request('/api/debrid/status', { signal });
}

export function resolveMagnet(magnet, fileIndex, signal) {
  return request('/api/debrid/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnet, fileIndex }),
    signal
  }, 30_000);
}

export function getTorrentStatus(torrentId, signal) {
  return request(`/api/debrid/torrents/${encodeURIComponent(torrentId)}`, { signal });
}

export async function getSubtitles(media, signal) {
  const params = new URLSearchParams({
    imdbId: media.imdbId,
    type: media.type
  });
  if (media.type === 'series') {
    params.set('season', String(media.season));
    params.set('episode', String(media.episode));
  }
  const data = await request(`/api/subtitles?${params}`, { signal }, 45_000);
  return data.tracks || [];
}

export async function prepareMedia(url, signal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-1023' },
      signal: controller.signal
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new ApiError(data.error || `The media proxy returned HTTP ${response.status}.`, response.status);
    }
    const reader = response.body?.getReader();
    if (reader) {
      const chunk = await reader.read();
      await reader.cancel();
      if (!chunk.value?.byteLength) throw new ApiError('The media host returned an empty stream.');
    }
  } catch (error) {
    if (error instanceof ApiError || error.name === 'AbortError') throw error;
    throw new ApiError('The browser could not open the prepared media stream.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
