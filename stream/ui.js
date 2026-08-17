export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

export function safeImageUrl(value, fallback, kind = 'poster') {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return fallback;
    if (url.hostname === 'metahub.space' || url.hostname.endsWith('.metahub.space')) {
      return `/api/image?url=${encodeURIComponent(url.href)}&amp;kind=${kind === 'thumb' ? 'thumb' : 'poster'}`;
    }
    return escapeHtml(url.href);
  } catch {
    return fallback;
  }
}

const POSTER_FALLBACK = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450"%3E%3Crect width="300" height="450" fill="%23111"/%3E%3Ctext x="150" y="225" text-anchor="middle" fill="%23666" font-family="sans-serif" font-size="22"%3ENo Poster%3C/text%3E%3C/svg%3E';
const THUMB_FALLBACK = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"%3E%3Crect width="160" height="90" fill="%23111"/%3E%3C/svg%3E';

export function renderSearchView() {
  return `
    <main id="search-view" class="view-container view-visible flex min-h-[100dvh] flex-col items-center px-3 pb-16 pt-6 sm:px-4 sm:pt-10 md:justify-center md:pt-32">
      <div class="flex w-full max-w-2xl flex-col items-center">
        <h1 class="mb-5 text-center text-2xl font-light tracking-wider text-gray-200 sm:text-3xl md:mb-8 md:text-4xl">What do you want to watch?</h1>
        <div id="debrid-status" class="mb-4 min-h-5 text-center text-xs text-gray-500" role="status"></div>
        <form id="search-form" class="relative w-full px-2 md:px-0">
          <label for="search-input" class="sr-only">Search movies and series</label>
          <input type="search" id="search-input" class="w-full rounded-full border border-gray-800 bg-black px-5 py-3 text-base text-white shadow-lg outline-none transition-all focus:border-gray-500 focus:ring-1 focus:ring-gray-500 md:px-6 md:py-4 md:text-lg" placeholder="Search movies, series…" autocomplete="off" autocorrect="off" spellcheck="false">
          <div id="loading-spinner" class="absolute right-5 top-4 hidden" aria-hidden="true"><div class="spinner"></div></div>
        </form>
        <div id="search-message" class="mt-5 hidden w-full rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-center text-sm text-red-300" role="alert"></div>
        <div id="results-container" class="custom-scrollbar mt-5 grid max-h-[72dvh] w-full grid-cols-2 gap-2 overflow-y-auto pb-12 sm:grid-cols-3 sm:gap-4 md:grid-cols-4" aria-live="polite"></div>
      </div>
    </main>`;
}

export function renderSearchResults(results) {
  const container = document.getElementById('results-container');
  if (!results.length) {
    container.innerHTML = '<p class="col-span-full mt-8 text-center text-gray-500">No results found.</p>';
    return;
  }
  container.innerHTML = results.map((item) => {
    const id = escapeHtml(item.imdb_id || item.id);
    const name = escapeHtml(item.name || 'Untitled');
    const type = item.type === 'series' ? 'series' : 'movie';
    const poster = safeImageUrl(item.poster, POSTER_FALLBACK);
    const year = escapeHtml(item.year || item.releaseInfo || 'Unknown');
    return `<button type="button" class="result-card flex cursor-pointer flex-col overflow-hidden rounded-md bg-black p-2 text-left" data-id="${id}" data-type="${type}">
      <span class="relative mb-2 aspect-[2/3] w-full overflow-hidden rounded-md bg-gray-900"><img src="${poster}" alt="" class="h-full w-full object-cover" loading="lazy"><span class="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs uppercase text-gray-300">${type}</span></span>
      <span class="truncate text-sm font-semibold text-gray-200">${name}</span><span class="text-xs text-gray-500">${year}</span>
    </button>`;
  }).join('');
}

export function setSearchLoading(loading) {
  document.getElementById('loading-spinner')?.classList.toggle('hidden', !loading);
}

export function setSearchError(message = '') {
  const element = document.getElementById('search-message');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('hidden', !message);
}

export function renderDetailView(metadata) {
  const background = safeImageUrl(metadata.background, '');
  const poster = safeImageUrl(metadata.poster, POSTER_FALLBACK);
  const title = escapeHtml(metadata.name || 'Unknown title');
  const genres = Array.isArray(metadata.genre) ? metadata.genre.join(', ') : '';
  const facts = [metadata.year || metadata.releaseInfo, metadata.imdbRating ? `★ ${metadata.imdbRating}` : '', metadata.runtime, genres].filter(Boolean).map((fact) => `<span>${escapeHtml(fact)}</span>`).join('');
  return `<section id="detail-view" class="view-container view-hidden flex min-h-screen flex-col" aria-label="${title}">
    <div class="absolute inset-0 z-0 h-full w-full">${background ? `<img src="${background}" alt="" class="h-full w-full object-cover opacity-30">` : ''}<div class="hero-gradient absolute inset-0"></div></div>
    <div class="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col px-3 py-4 sm:px-6 sm:py-8 md:py-10">
      <button id="back-btn" type="button" class="mb-4 flex min-h-11 self-start items-center rounded-full bg-black/50 px-3 text-gray-300 backdrop-blur transition-colors hover:text-white sm:mb-8" aria-label="Back to search">← <span class="ml-2">Back to Search</span></button>
      <div class="flex flex-col gap-4 sm:gap-6 md:mt-4 md:flex-row md:gap-10">
        <div class="mx-auto w-32 shrink-0 shadow-2xl shadow-black sm:w-1/2 sm:max-w-sm md:mx-0 md:w-1/3"><img src="${poster}" alt="Poster for ${title}" class="w-full rounded-lg border border-gray-800"></div>
        <div class="flex w-full flex-col pt-2 text-center md:w-2/3 md:text-left">
          <h2 id="detail-title" class="mb-2 text-2xl font-bold text-white sm:text-3xl md:text-5xl">${title}</h2>
          <div class="mb-6 flex flex-wrap items-center justify-center gap-3 text-sm text-gray-400 md:justify-start md:gap-4 md:text-base">${facts}</div>
          <p class="mx-auto mb-6 max-w-3xl text-sm leading-relaxed text-gray-300 sm:text-base md:mx-0 md:mb-10 md:text-lg">${escapeHtml(metadata.description || 'No description available.')}</p>
          <div id="seasons-episodes-container" class="mb-8 mt-2 hidden"><div id="seasons-bar" class="custom-scrollbar mb-4 flex gap-3 overflow-x-auto pb-3"></div><div id="episodes-list" class="custom-scrollbar flex max-h-[400px] flex-col gap-3 overflow-y-auto pr-2"></div></div>
          <div class="mt-auto"><h3 class="mb-3 border-b border-gray-800 pb-2 text-lg font-semibold text-white sm:mb-4 sm:text-xl">Available sources <span class="block text-xs font-normal text-gray-500 sm:ml-2 sm:inline">Real-Debrid required</span></h3><div id="streams-container" class="rounded-lg border border-gray-800 bg-gray-900/50 p-3 text-center text-gray-400 sm:p-6"><div class="spinner mx-auto"></div><p class="mt-4">Loading sources…</p></div></div>
        </div>
      </div>
    </div>
  </section>`;
}

export function renderSeasons(videos, onSeasonClick) {
  const wrapper = document.getElementById('seasons-episodes-container');
  const bar = document.getElementById('seasons-bar');
  const seasons = [...new Set(videos.map((video) => Number(video.season)).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!wrapper || !bar || !seasons.length) return;
  wrapper.classList.remove('hidden');
  bar.innerHTML = seasons.map((season) => `<button type="button" class="season-btn whitespace-nowrap rounded-full border border-gray-700 bg-gray-900 px-5 py-2 text-sm font-medium text-gray-300" data-season="${season}">Season ${season}</button>`).join('');
  bar.addEventListener('click', (event) => {
    const button = event.target.closest('.season-btn');
    if (!button) return;
    bar.querySelectorAll('.season-btn').forEach((item) => item.classList.toggle('season-active', item === button));
    onSeasonClick(Number(button.dataset.season));
  });
  bar.querySelector('.season-btn')?.click();
}

export function renderEpisodes(videos, season, onEpisodeClick) {
  const list = document.getElementById('episodes-list');
  const episodes = videos.filter((video) => Number(video.season) === season).sort((a, b) => Number(a.episode || a.number) - Number(b.episode || b.number));
  if (!list) return;
  list.innerHTML = episodes.map((episode) => {
    const title = escapeHtml(episode.name || `Episode ${episode.episode || episode.number}`);
    const number = escapeHtml(episode.episode || episode.number || '');
    const thumb = safeImageUrl(episode.thumbnail, THUMB_FALLBACK, 'thumb');
    return `<button type="button" class="episode-card relative flex min-h-20 flex-row items-center gap-3 rounded-lg border border-transparent bg-gray-900/40 p-2 text-left transition-colors hover:border-gray-700 hover:bg-gray-800 sm:gap-4 sm:p-3" data-id="${escapeHtml(episode.id)}" data-title="${number}. ${title}">
      <img src="${thumb}" alt="" class="aspect-video w-24 shrink-0 rounded bg-gray-800 object-cover sm:w-32 md:w-40" loading="lazy"><span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-gray-200">${number}. ${title}</span>${episode.description ? `<span class="mt-1 line-clamp-2 hidden text-xs text-gray-500 sm:block">${escapeHtml(episode.description)}</span>` : ''}</span><span class="rounded-full bg-white px-3 py-2 text-xs font-bold text-black">Play</span>
    </button>`;
  }).join('');
  list.onclick = (event) => {
    const card = event.target.closest('.episode-card');
    if (!card) return;
    list.querySelectorAll('.episode-card').forEach((item) => item.classList.toggle('episode-active', item === card));
    onEpisodeClick(card.dataset.id, card.dataset.title);
  };
  list.querySelector('.episode-card')?.click();
}

export function renderStreams(streams, onStreamClick) {
  const container = document.getElementById('streams-container');
  if (!container) return;
  const playable = streams.filter((stream) => stream.infoHash);
  if (!playable.length) {
    container.innerHTML = '<p class="text-gray-500">No compatible torrent sources were found.</p>';
    return;
  }
  container.innerHTML = `<div class="custom-scrollbar flex max-h-[420px] flex-col gap-3 overflow-y-auto pr-2">${playable.map((stream, index) => {
    const parts = String(stream.title || '').split('\n');
    return `<button type="button" class="stream-item flex min-h-16 w-full items-center justify-between rounded-lg border border-gray-700 bg-gray-900/60 p-3 text-left transition-all hover:border-white hover:bg-gray-800 md:p-4" data-index="${index}"><span class="min-w-0 flex-1 pr-2 sm:pr-3"><span class="block truncate text-sm font-semibold text-white sm:text-base md:text-lg">${escapeHtml(stream.name || 'Torrentio')} — ${escapeHtml(parts[0] || 'Unknown quality')}</span><span class="mt-1 block truncate text-[11px] text-gray-400 sm:text-xs md:text-sm">${escapeHtml(parts.slice(1).join(' | '))}</span></span><span class="rounded-full bg-white px-3 py-2 text-xs font-bold text-black">Play</span></button>`;
  }).join('')}</div>`;
  container.onclick = (event) => {
    const button = event.target.closest('.stream-item');
    if (button) {
      const index = Number(button.dataset.index);
      onStreamClick(playable[index], playable, index);
    }
  };
}

export function renderStreamsError(message) {
  const container = document.getElementById('streams-container');
  if (container) container.innerHTML = `<p class="text-red-400">${escapeHtml(message)}</p>`;
}

export function renderVideoModal(title) {
  return `<div id="video-modal" class="mobile-video-modal fixed inset-0 z-50 flex items-center justify-center bg-black/95 opacity-0 transition-opacity duration-300" role="dialog" aria-modal="true" aria-label="Video player">
    <button id="close-modal-btn" type="button" class="mobile-close-button absolute z-[70] flex h-11 w-11 items-center justify-center rounded-full border border-gray-700 bg-gray-900 text-white" aria-label="Close player">✕</button>
    <div class="relative flex h-[100dvh] w-full flex-col justify-center overflow-hidden bg-black shadow-2xl md:h-auto md:max-w-6xl md:aspect-video md:rounded-xl md:border md:border-gray-800">
      <div id="video-error-overlay" class="plyr-error-overlay hidden"><h2 class="mb-2 text-2xl font-bold">Stream unavailable</h2><p id="video-error-text" class="text-gray-400"></p></div>
      <div id="video-loading-overlay" class="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gray-900"><div class="netflix-spinner mb-6"></div><p id="video-loading-text" class="px-6 text-center text-base font-medium text-white sm:text-lg">Connecting to Real-Debrid…</p><p id="subtitle-status" class="mt-3 px-5 text-center text-sm text-gray-400">Finding Arabic and English subtitles…</p></div>
      <div id="plyr-container" class="relative z-10 hidden h-full w-full"><div class="plyr__title-overlay">${escapeHtml(title)}</div><video id="native-video-player" playsinline></video></div>
    </div>
  </div>`;
}
