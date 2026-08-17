import { ApiError, getDebridStatus, getMetadata, getStreams, getSubtitles, getTorrentStatus, prepareMedia, resolveMagnet, searchMedia } from './api.js';
import { renderDetailView, renderEpisodes, renderSearchResults, renderSearchView, renderSeasons, renderStreams, renderStreamsError, renderVideoModal, setSearchError, setSearchLoading } from './ui.js';

const app = document.getElementById('app');
const state = {
  debounce: null,
  searchController: null,
  detailController: null,
  streamsController: null,
  playbackController: null,
  player: null,
  dashPlayer: null,
  requestSequence: 0,
  title: '',
  playbackTitle: '',
  media: null
};

function messageFor(error, fallback) {
  if (error?.name === 'AbortError') return '';
  return error instanceof ApiError ? error.message : fallback;
}

async function clearLegacyServiceWorker() {
  if (!('serviceWorker' in navigator)) return false;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if ('caches' in window) {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  }
  if (navigator.serviceWorker.controller) {
    location.reload();
    return true;
  }
  return false;
}

function init() {
  app.innerHTML = renderSearchView();
  const form = document.getElementById('search-form');
  const input = document.getElementById('search-input');
  form.addEventListener('submit', (event) => event.preventDefault());
  input.addEventListener('input', () => queueSearch(input.value.trim()));
  document.getElementById('results-container').addEventListener('click', (event) => {
    const card = event.target.closest('.result-card');
    if (card) openDetail(card.dataset.id, card.dataset.type);
  });
  updateDebridStatus();
}

async function updateDebridStatus() {
  const element = document.getElementById('debrid-status');
  try {
    const status = await getDebridStatus();
    element.textContent = `Real-Debrid connected · ${status.accountType} account`;
    element.className = 'mb-4 min-h-5 text-center text-xs text-green-500';
  } catch (error) {
    element.textContent = messageFor(error, 'Real-Debrid is unavailable.');
    element.className = 'mb-4 min-h-5 text-center text-xs text-yellow-500';
  }
}

function queueSearch(query) {
  clearTimeout(state.debounce);
  state.searchController?.abort();
  setSearchError();
  if (query.length < 2) {
    document.getElementById('results-container').replaceChildren();
    setSearchLoading(false);
    return;
  }
  setSearchLoading(true);
  state.debounce = setTimeout(() => runSearch(query), 350);
}

async function runSearch(query) {
  const controller = new AbortController();
  state.searchController = controller;
  try {
    renderSearchResults(await searchMedia(query, controller.signal));
  } catch (error) {
    const message = messageFor(error, 'Search failed. Please try again.');
    if (message) setSearchError(message);
  } finally {
    if (state.searchController === controller) setSearchLoading(false);
  }
}

async function openDetail(id, type) {
  const sequence = ++state.requestSequence;
  state.detailController?.abort();
  const controller = new AbortController();
  state.detailController = controller;
  setSearchLoading(true);
  setSearchError();
  try {
    const metadata = await getMetadata(type, id, controller.signal);
    if (!metadata || sequence !== state.requestSequence) return;
    state.title = metadata.name || 'Video';
    state.playbackTitle = state.title;
    document.getElementById('detail-view')?.remove();
    app.insertAdjacentHTML('beforeend', renderDetailView(metadata));
    const searchView = document.getElementById('search-view');
    searchView.classList.replace('view-visible', 'view-hidden');
    requestAnimationFrame(() => document.getElementById('detail-view')?.classList.replace('view-hidden', 'view-visible'));
    document.getElementById('back-btn').addEventListener('click', closeDetail);

    if (metadata.type === 'series' && metadata.videos?.length) {
      renderSeasons(metadata.videos, (season) => renderEpisodes(metadata.videos, season, (episodeId, episodeTitle) => {
        state.playbackTitle = `${state.title} — ${episodeTitle}`;
        loadStreams('series', episodeId);
      }));
    } else {
      loadStreams('movie', metadata.imdb_id || metadata.id);
    }
  } catch (error) {
    const message = messageFor(error, 'Could not load this title.');
    if (message) setSearchError(message);
  } finally {
    if (state.detailController === controller) setSearchLoading(false);
  }
}

function closeDetail() {
  ++state.requestSequence;
  state.detailController?.abort();
  state.streamsController?.abort();
  const detail = document.getElementById('detail-view');
  detail?.classList.replace('view-visible', 'view-hidden');
  document.getElementById('search-view')?.classList.replace('view-hidden', 'view-visible');
  setTimeout(() => detail?.remove(), 400);
  document.getElementById('search-input')?.focus();
}

async function loadStreams(type, id) {
  const sequence = ++state.requestSequence;
  state.streamsController?.abort();
  const controller = new AbortController();
  state.streamsController = controller;
  const [imdbId, season, episode] = id.split(':');
  state.media = {
    imdbId,
    type,
    season: season === undefined ? null : Number(season),
    episode: episode === undefined ? null : Number(episode)
  };
  const container = document.getElementById('streams-container');
  if (container) container.innerHTML = '<div class="spinner mx-auto"></div><p class="mt-4">Loading sources…</p>';
  try {
    const streams = await getStreams(type, id, controller.signal);
    if (sequence !== state.requestSequence) return;
    renderStreams(streams, playStream);
  } catch (error) {
    const message = messageFor(error, 'Could not load sources.');
    if (message) renderStreamsError(message);
  }
}

function orderedPlaybackSources(selected, available = []) {
  const unique = new Map();
  for (const stream of [selected, ...available]) {
    if (!stream?.infoHash) continue;
    const key = `${stream.infoHash.toLowerCase()}:${Number.isInteger(stream.fileIdx) ? stream.fileIdx : ''}`;
    if (!unique.has(key)) unique.set(key, stream);
  }
  return [...unique.values()].slice(0, 12);
}

function canTryAnotherSource(error) {
  if (error?.retryable) return true;
  if ([404, 409, 422, 451, 502, 503, 504].includes(error?.status)) return true;
  return /infringing_file|magnet_error|(?:torrent status|rejected this source): (?:dead|error|virus)/i.test(error?.message || '');
}

async function playStream(stream, availableStreams = [stream]) {
  state.playbackController?.abort();
  const modal = openPlayer(state.playbackTitle);
  const controller = new AbortController();
  state.playbackController = controller;
  const subtitlePromise = state.media
    ? getSubtitles({ ...state.media }, controller.signal).then((tracks) => {
        if (modal.isConnected) attachSubtitleTracks(tracks);
        return tracks;
      }).catch((error) => {
        const message = messageFor(error, 'Subtitles are unavailable.');
        if (message && modal.isConnected) updateSubtitleStatus(message, true);
        return [];
      })
    : Promise.resolve([]);
  try {
    const sources = orderedPlaybackSources(stream, availableStreams);
    let lastError;
    for (let index = 0; index < sources.length; index += 1) {
      const candidate = sources[index];
      const magnet = `magnet:?xt=urn:btih:${encodeURIComponent(candidate.infoHash)}`;
      const fileIndex = Number.isInteger(candidate.fileIdx) ? candidate.fileIdx : null;
      try {
        updatePlayerMessage(index
          ? `Trying alternate source ${index + 1} of ${sources.length}…`
          : 'Connecting to Real-Debrid…');
        let result = await resolveMagnet(magnet, fileIndex, controller.signal);
        while (!result.ready && !result.failed) {
          updatePlayerMessage(`Real-Debrid is downloading source ${index + 1}… ${result.progress || 0}%`);
          await delay(3_000, controller.signal);
          result = await getTorrentStatus(result.torrentId, controller.signal);
        }
        if (result.failed) {
          const sourceError = new ApiError(`Real-Debrid rejected this source: ${result.status}.`);
          sourceError.retryable = result.retryable || canTryAnotherSource(sourceError);
          throw sourceError;
        }
        if (!modal.isConnected) return;
        updatePlayerMessage('Verifying the browser-compatible stream…');
        await prepareMedia(result.url, controller.signal);
        if (!modal.isConnected) return;
        await Promise.race([subtitlePromise, delay(2_000, controller.signal).catch(() => [])]);
        startPlayback(result);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        lastError = error;
        if (!canTryAnotherSource(error) || index === sources.length - 1) throw error;
        updatePlayerMessage('That release is unavailable. Switching sources…');
      }
    }
    throw lastError || new ApiError('No playable torrent source was found.');
  } catch (error) {
    const message = messageFor(error, 'Playback could not be started.');
    if (message && modal.isConnected) showPlayerError(message);
  }
}

function attachSubtitleTracks(tracks) {
  const video = document.getElementById('native-video-player');
  if (!video) return;
  video.querySelectorAll('track[data-subtitle-provider]').forEach((track) => track.remove());
  for (const trackData of tracks) {
    const track = document.createElement('track');
    track.kind = 'captions';
    track.label = trackData.label;
    track.srclang = trackData.srclang;
    track.src = trackData.src;
    track.dataset.subtitleProvider = 'subdl';
    if (trackData.srclang === 'ar') track.default = true;
    video.append(track);
  }
  if (tracks.length) {
    state.player.language = tracks.some((track) => track.srclang === 'ar') ? 'ar' : tracks[0].srclang;
    state.player.toggleCaptions(true);
    updateSubtitleStatus(`${tracks.map((track) => track.label).join(' + ')} subtitles ready`);
  } else {
    updateSubtitleStatus('No Arabic or English subtitles were found.', true);
  }
}

function updateSubtitleStatus(message, isWarning = false) {
  const element = document.getElementById('subtitle-status');
  if (!element) return;
  element.textContent = message;
  element.className = `mt-3 px-5 text-center text-sm ${isWarning ? 'text-yellow-400' : 'text-green-400'}`;
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function openPlayer(title) {
  closePlayer();
  document.body.insertAdjacentHTML('beforeend', renderVideoModal(title));
  const modal = document.getElementById('video-modal');
  state.player = new window.Plyr('#native-video-player', {
    iconUrl: 'vendor/plyr.svg',
    blankVideo: 'data:video/mp4;base64,',
    controls: ['play-large', 'rewind', 'play', 'fast-forward', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'fullscreen'],
    settings: ['captions', 'speed', 'loop'],
    captions: { active: true, language: 'ar', update: true },
    hideControls: true
  });
  state.player.on('error', () => {
    const mediaError = document.getElementById('native-video-player')?.error;
    const reasons = {
      1: 'Playback was aborted.',
      2: 'The browser lost its connection to the local media proxy.',
      3: 'Brave could not decode the transcoded video.',
      4: 'Brave rejected the media format or source.'
    };
    showPlayerError(reasons[mediaError?.code] || 'The media player reported an unknown playback error.');
  });
  document.getElementById('close-modal-btn').addEventListener('click', closePlayer);
  document.addEventListener('keydown', closeOnEscape);
  requestAnimationFrame(() => modal.classList.add('opacity-100'));
  return modal;
}

function updatePlayerMessage(message) {
  const element = document.getElementById('video-loading-text');
  if (element) element.textContent = message;
}

function startPlayback(result) {
  updatePlayerMessage('Preparing a browser-compatible stream…');
  const video = document.getElementById('native-video-player');
  video?.addEventListener('canplay', () => {
    document.getElementById('video-loading-overlay')?.classList.add('hidden');
    document.getElementById('plyr-container')?.classList.remove('hidden');
    state.player?.play().catch((error) => {
      if (error.name !== 'NotAllowedError') showPlayerError('Brave blocked playback after loading the stream.');
    });
  }, { once: true });
  if (result.streamType === 'dash' && window.dashjs?.MediaPlayer) {
    state.dashPlayer = window.dashjs.MediaPlayer().create();
    state.dashPlayer.updateSettings({
      streaming: {
        abr: { autoSwitchBitrate: { audio: true, video: true } },
        buffer: { stableBufferTime: 20 }
      }
    });
    state.dashPlayer.on(window.dashjs.MediaPlayer.events.ERROR, (event) => {
      const detail = event?.error?.message || event?.event?.message || event?.message;
      showPlayerError(detail ? `Adaptive stream error: ${detail}` : 'The adaptive H.264 stream could not be loaded.');
    });
    state.dashPlayer.initialize(video, result.url, false);
  } else {
    state.player.source = { type: 'video', title: result.filename, sources: [{ src: result.url }] };
  }
}

function showPlayerError(message) {
  document.getElementById('video-loading-overlay')?.classList.add('hidden');
  document.getElementById('plyr-container')?.classList.add('hidden');
  const overlay = document.getElementById('video-error-overlay');
  overlay?.classList.remove('hidden');
  const text = document.getElementById('video-error-text');
  if (text) text.textContent = message;
}

function closeOnEscape(event) {
  if (event.key === 'Escape') closePlayer();
}

function closePlayer() {
  state.playbackController?.abort();
  state.playbackController = null;
  state.dashPlayer?.reset();
  state.dashPlayer = null;
  state.player?.destroy();
  state.player = null;
  document.getElementById('video-modal')?.remove();
  document.removeEventListener('keydown', closeOnEscape);
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    if (await clearLegacyServiceWorker()) return;
  } catch (error) {
    console.warn('Could not remove a legacy service worker.', error);
  }
  init();
});
