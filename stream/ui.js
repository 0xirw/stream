/**
 * ui.js
 * Handles all DOM manipulation and rendering.
 */

import { fetchTorrentioStreams } from './api.js';

export function renderSearchView() {
  return `
    <div id="search-view" class="view-container view-visible flex flex-col items-center justify-start md:justify-center pt-10 md:pt-32 pb-20 px-4">
      <div class="w-full max-w-2xl flex flex-col items-center">
        <h1 class="text-3xl md:text-4xl font-light mb-6 md:mb-8 text-center tracking-wider text-gray-200">What do you want to watch?</h1>
        <form id="search-form" class="w-full relative px-2 md:px-0" onsubmit="event.preventDefault(); document.getElementById('search-input').blur();">
          <input 
            type="search" 
            id="search-input"
            class="w-full bg-black border border-gray-800 text-white rounded-full py-3 px-5 md:py-4 md:px-6 text-base md:text-lg outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500 transition-all shadow-lg"
            placeholder="Search movies, series..."
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
          />
          <div id="loading-spinner" class="absolute right-5 top-4 hidden">
            <div class="spinner"></div>
          </div>
        </form>
        
        <div id="results-container" class="w-full mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 custom-scrollbar max-h-[70vh] overflow-y-auto pb-12">
          <!-- Results will be injected here -->
        </div>
      </div>
    </div>
  `;
}

export function renderSearchResults(results) {
  const container = document.getElementById('results-container');
  if (!container) return;

  if (results.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center text-gray-500 mt-8">
        <p>No results found.</p>
      </div>
    `;
    return;
  }

  const html = results.map(item => {
    // Some Cinemeta items might lack a poster
    const poster = item.poster || 'https://via.placeholder.com/300x450/111111/555555?text=No+Poster';
    const year = item.year || item.releaseInfo || 'Unknown';
    const type = item.type || 'movie';

    return `
      <div 
        class="result-card cursor-pointer flex flex-col rounded-md overflow-hidden bg-black p-2"
        data-id="${item.imdb_id || item.id}"
        data-type="${type}"
      >
        <div class="w-full aspect-[2/3] bg-gray-900 rounded-md overflow-hidden mb-2 relative">
          <img src="${poster}" alt="${item.name}" class="object-cover w-full h-full" loading="lazy" />
          <div class="absolute top-1 right-1 bg-black/70 text-xs px-1.5 py-0.5 rounded text-gray-300 uppercase">${type}</div>
        </div>
        <h3 class="text-sm font-semibold truncate text-gray-200">${item.name}</h3>
        <p class="text-xs text-gray-500">${year}</p>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

export function showLoadingSpinner() {
  const spinner = document.getElementById('loading-spinner');
  if (spinner) spinner.classList.remove('hidden');
}

export function hideLoadingSpinner() {
  const spinner = document.getElementById('loading-spinner');
  if (spinner) spinner.classList.add('hidden');
}

export function clearSearchResults() {
  const container = document.getElementById('results-container');
  if (container) container.innerHTML = '';
}

export function renderDetailView(metadata) {
  // Safe fallbacks
  const bgImage = metadata.background || '';
  const poster = metadata.poster || 'https://via.placeholder.com/300x450/111111/555555?text=No+Poster';
  const title = metadata.name || 'Unknown Title';
  const year = metadata.year || metadata.releaseInfo || '';
  const rating = metadata.imdbRating ? `★ ${metadata.imdbRating}` : '';
  const runtime = metadata.runtime || '';
  const description = metadata.description || 'No description available.';
  const genres = metadata.genre ? metadata.genre.join(', ') : '';
  
  // We will load streams dynamically
  const streamsPlaceholder = `<div class="spinner mx-auto border-gray-500 border-l-white"></div><p id="torrentio-loading-text" class="mt-4 text-gray-500">Scraping Torrentio...</p>`;

  return `
    <div id="detail-view" class="view-container view-hidden flex flex-col min-h-screen">
      
      <!-- Background Hero Image -->
      <div class="absolute inset-0 z-0 w-full h-full">
        ${bgImage ? `<img src="${bgImage}" class="object-cover w-full h-full opacity-30" />` : ''}
        <div class="absolute inset-0 hero-gradient"></div>
      </div>

      <!-- Content Container -->
      <div class="relative z-10 w-full max-w-6xl mx-auto px-6 py-10 flex flex-col min-h-screen">
        
        <!-- Back Button -->
        <button id="back-btn" class="self-start flex items-center text-gray-400 hover:text-white mb-8 transition-colors">
          <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          Back to Search
        </button>

        <!-- Main Detail Grid -->
        <div class="flex flex-col md:flex-row gap-6 md:gap-10 mt-4">
          
          <!-- Poster (Left) -->
          <div class="w-1/2 mx-auto md:mx-0 md:w-1/3 max-w-sm shrink-0 shadow-2xl shadow-black">
            <img src="${poster}" alt="${title}" class="w-full rounded-lg border border-gray-800" />
          </div>

          <!-- Metadata (Right) -->
          <div class="w-full md:w-2/3 flex flex-col pt-2 text-center md:text-left">
            <h1 class="text-3xl md:text-5xl font-bold text-white mb-2">${title}</h1>
            
            <div class="flex flex-wrap items-center justify-center md:justify-start text-sm md:text-base text-gray-400 gap-3 md:gap-4 mb-6">
              ${year ? `<span>${year}</span>` : ''}
              ${rating ? `<span class="text-yellow-500 font-medium">${rating}</span>` : ''}
              ${runtime ? `<span>${runtime}</span>` : ''}
              ${genres ? `<span>${genres}</span>` : ''}
            </div>

            ${metadata.type === 'movie' ? `
              <div class="flex justify-center md:justify-start gap-4 mb-8">
                <button class="flex items-center justify-center w-full md:w-auto bg-white text-black px-6 py-3 rounded-full font-bold hover:bg-gray-200 transition-colors shadow-lg" onclick="document.getElementById('streams-container').scrollIntoView({behavior: 'smooth'})">
                  <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4l12 6-12 6z"></path></svg>
                  Select Stream
                </button>
              </div>
            ` : ''}

            <p class="text-gray-300 text-base md:text-lg leading-relaxed mb-10 max-w-3xl mx-auto md:mx-0">
              ${description}
            </p>

            <!-- Seasons & Episodes Container -->
            <div id="seasons-episodes-container" class="mt-2 mb-8 hidden">
              <!-- Seasons List (Slide bar) -->
              <div id="seasons-bar" class="flex overflow-x-auto gap-3 custom-scrollbar pb-3 mb-4"></div>
              <!-- Episodes List -->
              <div id="episodes-list" class="flex flex-col gap-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2"></div>
            </div>

            <!-- Magnet Links Container -->
            <div class="mt-auto">
              <h3 class="text-xl font-semibold text-white mb-4 border-b border-gray-800 pb-2">Magnet Download Links <span class="text-xs text-gray-500 font-normal ml-2">(Requires Torrent Client)</span></h3>
              <div id="streams-container" class="bg-gray-900/50 border border-gray-800 rounded-lg p-6 text-center text-gray-400">
                ${streamsPlaceholder}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderSeasons(videos, onSeasonClick) {
  const container = document.getElementById('seasons-episodes-container');
  const seasonsBar = document.getElementById('seasons-bar');
  if (!container || !seasonsBar || !videos || videos.length === 0) return;

  container.classList.remove('hidden');

  // Extract unique seasons and sort them
  const seasons = [...new Set(videos.map(v => v.season))].sort((a,b) => a-b);
  
  seasonsBar.innerHTML = seasons.map(s => `
    <button class="season-btn px-5 py-2 bg-gray-900 border border-gray-700 hover:bg-gray-700 text-gray-300 rounded-full text-sm font-medium whitespace-nowrap transition-colors shadow-sm" data-season="${s}">
      Season ${s}
    </button>
  `).join('');

  // Attach click listeners
  const buttons = seasonsBar.querySelectorAll('.season-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // update active state
      buttons.forEach(b => {
        b.classList.remove('bg-white', 'text-black', 'border-white');
        b.classList.add('bg-gray-900', 'text-gray-300', 'border-gray-700');
      });
      e.currentTarget.classList.remove('bg-gray-900', 'text-gray-300', 'border-gray-700');
      e.currentTarget.classList.add('bg-white', 'text-black', 'border-white');
      
      const selectedSeason = parseInt(e.currentTarget.getAttribute('data-season'), 10);
      onSeasonClick(selectedSeason);
    });
  });

  // trigger click on first button by default
  if (buttons.length > 0) {
    buttons[0].click();
  }
}

export function renderEpisodes(videos, season) {
  const episodesList = document.getElementById('episodes-list');
  if (!episodesList) return;

  // Sometimes episode is missing, fallback to number
  const episodes = videos.filter(v => v.season === season).sort((a,b) => (a.episode || a.number) - (b.episode || b.number));
  
  episodesList.innerHTML = episodes.map(ep => {
    const thumb = ep.thumbnail || 'https://via.placeholder.com/150x84/111111/555555?text=No+Image';
    const title = ep.name || `Episode ${ep.episode || ep.number}`;
    const desc = ep.description ? `<p class="text-xs text-gray-500 mt-1 line-clamp-2">${ep.description}</p>` : '';
    const epNumber = ep.episode || ep.number;
    const imdbId = videos[0].id.split(':')[0]; // get base imdb id

    return `
      <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 p-3 bg-gray-900/40 rounded-lg hover:bg-gray-800 transition-colors cursor-pointer border border-transparent hover:border-gray-700 relative" data-id="${ep.id}">
        <img src="${thumb}" alt="${title}" class="w-full sm:w-32 md:w-40 aspect-video object-cover rounded bg-gray-800 shrink-0" loading="lazy" />
        <div class="flex flex-col flex-1 min-w-0 pr-2 pb-8 sm:pb-0 sm:pr-16">
          <span class="text-gray-200 font-medium text-sm truncate">${epNumber}. ${title}</span>
          ${desc}
        </div>
        <button class="absolute bottom-3 right-3 flex items-center bg-white text-black px-3 py-1.5 sm:px-4 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-bold shadow-md hover:bg-gray-200 z-10 transition-transform hover:scale-105" onclick="document.getElementById('streams-container').scrollIntoView({behavior: 'smooth'})">
          <svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4l12 6-12 6z"></path></svg>
          Select
        </button>
      </div>
    `;
  }).join('');
}

export function renderStreams(streams, cachedHashes = new Set()) {
  const container = document.getElementById('streams-container');
  if (!container) return;

  // Clear interval if we had dynamic loading text
  if (window.streamLoadingInterval) {
    clearInterval(window.streamLoadingInterval);
  }

  if (!streams || streams.length === 0) {
    container.innerHTML = `<p class="text-gray-500">No streams found for this item.</p>`;
    return;
  }

  if (streams[0] && streams[0].error) {
    container.innerHTML = `<p class="text-red-400">${streams[0].message}</p>`;
    return;
  }

  container.innerHTML = `
    <div class="flex flex-col gap-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
      ${streams.map(stream => {
        // stream.title usually contains resolution and size info
        const titleParts = (stream.title || '').split('\n');
        const quality = titleParts[0] || 'Unknown Quality';
        const details = titleParts.slice(1).join(' | ') || '';
        const name = stream.name || 'Torrentio';
        
        // Use magnet link if available, otherwise just use url
        const link = stream.infoHash ? `magnet:?xt=urn:btih:${stream.infoHash}` : (stream.url || '#');

        const fileIdx = stream.fileIdx !== undefined ? stream.fileIdx : 0;
        
        let isCached = false;
        if (stream.infoHash) {
          isCached = cachedHashes.has(stream.infoHash.toLowerCase());
        }

        // Direct HTTP URLs (no infoHash) are considered instantly playable
        const isDirect = !stream.infoHash && stream.url;
        
        // Uncached streams get grayed out so users don't click them by mistake
        const isPlayable = isCached || isDirect;
        const opacityClass = isPlayable ? '' : 'opacity-40 grayscale';
        const badge = isPlayable 
          ? `<span class="bg-green-600/20 text-green-500 text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider ml-3">Instant</span>`
          : `<span class="bg-gray-700/50 text-gray-400 text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider ml-3">Uncached</span>`;

        return `
          <button class="stream-item ${opacityClass} flex w-full items-center justify-between p-3 md:p-4 bg-gray-900/60 rounded-lg border border-gray-700 hover:border-white hover:bg-gray-800 transition-all group text-left cursor-pointer" data-hash="${stream.infoHash || ''}" data-magnet="${link}" data-url="${stream.url || ''}" data-fileidx="${fileIdx}" data-cached="${isPlayable}">
            <div class="flex flex-col min-w-0 flex-1 pr-3">
              <span class="text-white font-semibold text-base md:text-lg group-hover:text-blue-400 flex flex-wrap items-center gap-y-1">
                <span class="truncate max-w-full">${name} - ${quality}</span>
                ${badge}
              </span>
              <span class="text-gray-400 text-xs md:text-sm mt-1 truncate max-w-full block">${details}</span>
            </div>
            <svg class="w-6 h-6 text-gray-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

export function renderVideoModal(url) {
  return `
    <div id="video-modal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm opacity-0 transition-opacity duration-300">
      <button id="close-modal-btn" class="absolute top-4 right-4 md:top-6 md:right-6 text-white hover:text-gray-300 z-[70] bg-gray-900 p-2 md:p-3 rounded-full shadow-lg border border-gray-700">
        <svg class="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
      <div class="w-full h-full md:h-auto md:max-w-6xl md:aspect-video bg-black shadow-2xl md:rounded-xl overflow-hidden relative md:border border-gray-800 flex flex-col justify-center">
        
        <!-- Error Overlay -->
        <div id="video-error-overlay" class="plyr-error-overlay hidden">
          <svg class="w-16 h-16 text-red-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          <h2 class="text-2xl font-bold mb-2">Stream Unavailable</h2>
          <p class="text-gray-400">The direct link failed to load. Please try another stream.</p>
        </div>

        <!-- Loading Overlay -->
        <div id="video-loading-overlay" class="absolute inset-0 bg-gray-900 z-20 flex flex-col items-center justify-center">
          <div class="netflix-spinner mb-6"></div>
          <p id="video-loading-text" class="text-white text-xl font-medium tracking-wide">Starting Debrid Pipeline...</p>
        </div>
        
        <!-- Native Video Player Container -->
        <div id="plyr-container" class="w-full h-full relative z-10 hidden">
          <div id="plyr-title-overlay" class="plyr__title-overlay"></div>
          <video id="native-video-player" playsinline crossorigin></video>
        </div>
      </div>
    </div>
  `;
}
