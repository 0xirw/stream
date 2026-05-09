/**
 * app.js
 * Main entry point and state manager for the application.
 */

import { searchMovies, getMetadata, fetchTorrentioStreams, checkTorboxCacheBulk, createTorboxTorrent, getTorboxStream } from './api.js';
import { 
  renderSearchView, 
  renderSearchResults, 
  showLoadingSpinner, 
  hideLoadingSpinner, 
  clearSearchResults,
  renderDetailView,
  renderSeasons,
  renderEpisodes,
  renderStreams,
  renderVideoModal
} from './ui.js';

// Application State
const state = {
  currentView: 'search', // 'search' or 'detail'
  searchQuery: '',
  debounceTimeout: null,
  currentVideos: []
};

// DOM Elements
const appContainer = document.getElementById('app');

/**
 * Initialize the application
 */
function init() {
  // Render the initial Search View
  appContainer.innerHTML = renderSearchView();
  setupSearchListeners();
}

/**
 * Sets up event listeners for the Search View
 */
function setupSearchListeners() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    state.searchQuery = query;

    clearTimeout(state.debounceTimeout);

    if (query.length < 2) {
      clearSearchResults();
      hideLoadingSpinner();
      return;
    }

    showLoadingSpinner();

    // Debounce API calls by 500ms
    state.debounceTimeout = setTimeout(async () => {
      const results = await searchMovies(query);
      
      // Only render if the current query matches what was searched
      if (state.searchQuery === query) {
        renderSearchResults(results);
        hideLoadingSpinner();
        attachResultClickListeners();
      }
    }, 500);
  });
}

/**
 * Attaches click events to the dynamically generated result cards
 */
function attachResultClickListeners() {
  const cards = document.querySelectorAll('.result-card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      const imdb_id = card.getAttribute('data-id');
      const type = card.getAttribute('data-type');
      if (imdb_id) {
        openDetailPage(imdb_id, type);
      }
    });
  });
}

/**
 * Transitions from Search View to Detail View
 * @param {string} imdb_id 
 * @param {string} type 
 */
async function openDetailPage(imdb_id, type) {
  // 1. Fetch metadata
  // We can show a global loading state here if desired, 
  // but for a smooth feel, we'll wait for data, then transition.
  const metadata = await getMetadata(type, imdb_id);
  if (!metadata) {
    alert("Could not load details for this item.");
    return;
  }

  // 2. Hide Search View
  const searchView = document.getElementById('search-view');
  if (searchView) {
    searchView.classList.remove('view-visible');
    searchView.classList.add('view-hidden');
  }

  // 3. Inject Detail View HTML (append to app container)
  // Remove existing detail view if it exists
  const existingDetail = document.getElementById('detail-view');
  if (existingDetail) {
    existingDetail.remove();
  }

  const detailHTML = renderDetailView(metadata);
  appContainer.insertAdjacentHTML('beforeend', detailHTML);

  // Render Seasons and Episodes if applicable
  if (metadata.type === 'series' && metadata.videos && metadata.videos.length > 0) {
    state.currentVideos = metadata.videos;
    renderSeasons(state.currentVideos, (season) => {
      renderEpisodes(state.currentVideos, season);
      attachEpisodeClickListeners();
    });
  } else {
    // For movies, fetch streams immediately
    const id = metadata.imdb_id || metadata.id;
    
    // Start dynamic loading text
    startDynamicLoadingText();
    
    fetchTorrentioStreams(metadata.type || 'movie', id).then(async streams => {
      // Mass Cache Check for the top 15 results
      const hashes = streams.filter(s => s.infoHash).map(s => s.infoHash).slice(0, 15);
      const cachedHashes = await checkTorboxCacheBulk(hashes);
      renderStreams(streams, cachedHashes);
      attachStreamClickListeners();
    });
  }

  // 4. Show Detail View
  // Small delay to allow DOM update before applying CSS transition classes
  setTimeout(() => {
    const detailView = document.getElementById('detail-view');
    if (detailView) {
      detailView.classList.remove('view-hidden');
      detailView.classList.add('view-visible');
      
      // Setup back button listener
      document.getElementById('back-btn').addEventListener('click', closeDetailPage);
    }
  }, 50);

  state.currentView = 'detail';
}

/**
 * Transitions from Detail View back to Search View
 */
function closeDetailPage() {
  const detailView = document.getElementById('detail-view');
  const searchView = document.getElementById('search-view');

  if (detailView) {
    detailView.classList.remove('view-visible');
    detailView.classList.add('view-hidden');
    
    // Remove detail view from DOM after transition completes (0.4s)
    setTimeout(() => {
      detailView.remove();
    }, 400);
  }

  if (searchView) {
    searchView.classList.remove('view-hidden');
    searchView.classList.add('view-visible');
    
    // Auto-focus search input
    const input = document.getElementById('search-input');
    if (input) input.focus();
  }

  state.currentView = 'search';
}

/**
 * Attaches click listeners to episode cards to fetch streams
 */
function attachEpisodeClickListeners() {
  const episodes = document.querySelectorAll('#episodes-list [data-id]');
  episodes.forEach(ep => {
    ep.addEventListener('click', async (e) => {
      // If clicked the Select Stream button
      const playBtn = e.target.closest('button');
      if (playBtn && playBtn.textContent.includes('Select Stream')) {
        e.stopPropagation();
        const container = document.getElementById('streams-container');
        if (container) container.scrollIntoView({ behavior: 'smooth' });
        return;
      }

      // visual feedback for selected episode
      episodes.forEach(el => {
        el.classList.remove('border-blue-500', 'bg-gray-800');
        el.classList.add('border-transparent');
      });
      e.currentTarget.classList.remove('border-transparent');
      e.currentTarget.classList.add('border-blue-500', 'bg-gray-800');
      
      const epId = e.currentTarget.getAttribute('data-id');
      const container = document.getElementById('streams-container');
      if (container) {
        container.innerHTML = `<div class="spinner mx-auto border-gray-500 border-l-white"></div><p id="torrentio-loading-text" class="mt-4 text-gray-500">Loading streams for Episode...</p>`;
        startDynamicLoadingText();
      }
      
      const streams = await fetchTorrentioStreams('series', epId);
      const hashes = streams.filter(s => s.infoHash).map(s => s.infoHash).slice(0, 15);
      const cachedHashes = await checkTorboxCacheBulk(hashes);
      renderStreams(streams, cachedHashes);
      attachStreamClickListeners();
    });
  });
}

/**
 * Starts the dynamic loading text interval to prevent UI from looking stuck
 */
function startDynamicLoadingText() {
  if (window.streamLoadingInterval) clearInterval(window.streamLoadingInterval);
  let dots = 0;
  let textIdx = 0;
  const texts = ["Scraping Torrentio...", "Still searching...", "This might take up to 20 seconds...", "Almost there..."];
  
  window.streamLoadingInterval = setInterval(() => {
    const el = document.getElementById('torrentio-loading-text');
    if (el) {
      dots = (dots + 1) % 4;
      if (dots === 0) {
        textIdx = (textIdx + 1) % texts.length;
      }
      el.textContent = texts[textIdx] + '.'.repeat(dots);
    }
  }, 1000);
}

/**
 * Attaches click listeners to the Torrentio stream rows to trigger TorBox
 */
function attachStreamClickListeners() {
  const streamItems = document.querySelectorAll('.stream-item');
  streamItems.forEach(item => {
    item.addEventListener('click', async (e) => {
      e.preventDefault();
      
      const hash = item.getAttribute('data-hash');
      const magnet = item.getAttribute('data-magnet');
      const url = item.getAttribute('data-url');
      const fileIdx = parseInt(item.getAttribute('data-fileidx') || '0', 10);

      // If it's a direct HTTP URL from a Debrid API, just open it
      if (url && !hash) {
        window.open(url, '_blank');
        return;
      }

      if (!hash) {
        alert("This stream cannot be processed by TorBox.");
        return;
      }

      // 1. Grab Title Metadata
      const mainTitle = document.querySelector('h1').textContent;
      let fullTitle = mainTitle;
      const activeEp = document.querySelector('#episodes-list .border-blue-500');
      if (activeEp) {
        const epText = activeEp.querySelector('span.truncate').textContent;
        fullTitle = `${mainTitle} - ${epText}`;
      }

      // 2. Open the video modal in loading state
      openNativeVideoModal(fullTitle);
      const loadingText = document.getElementById('video-loading-text');
      const loadingOverlay = document.getElementById('video-loading-overlay');

      // 3. Check TorBox Cache (via data attribute from Mass Check)
      loadingText.textContent = "Verifying Cache...";
      const isCached = item.getAttribute('data-cached') === 'true';
      
      if (!isCached) {
        loadingText.textContent = "Torrent is uncached. Adding to TorBox cloud...";
        const tId = await createTorboxTorrent(magnet);
        
        if (tId) {
          loadingText.textContent = "Added to TorBox! It is downloading in the background. Please try playing it again in a few minutes.";
          loadingText.classList.replace('text-white', 'text-yellow-400');
        } else {
          loadingText.textContent = "This stream is not cached on TorBox and failed to add.";
          loadingText.classList.replace('text-white', 'text-red-400');
        }
        
        const spinner = document.querySelector('.netflix-spinner') || document.querySelector('.spinner');
        if (spinner) spinner.classList.add('hidden');
        return;
      }

      // 3. Create Torrent on TorBox
      loadingText.textContent = "Cache hit! Generating Direct Link...";
      const torrentId = await createTorboxTorrent(magnet);
      
      if (!torrentId) {
        loadingText.textContent = "Failed to add torrent to TorBox.";
        loadingText.classList.add('text-red-400');
        const spinner = document.querySelector('.netflix-spinner') || document.querySelector('.spinner');
        if (spinner) spinner.classList.add('hidden');
        return;
      }

      // 4. Request Direct Download Link
      const cdnUrl = await getTorboxStream(torrentId, fileIdx);
      if (!cdnUrl) {
        loadingText.textContent = "Failed to retrieve stream URL from TorBox.";
        loadingText.classList.add('text-red-400');
        const spinner = document.querySelector('.netflix-spinner') || document.querySelector('.spinner');
        if (spinner) spinner.classList.add('hidden');
        return;
      }

      // 6. Play Video!
      loadingOverlay.classList.add('hidden');
      document.getElementById('plyr-container').classList.remove('hidden');
      
      if (window.playerInstance) {
        window.playerInstance.source = {
          type: 'video',
          sources: [
            {
              src: cdnUrl,
              type: 'video/mp4',
            }
          ]
        };
        window.playerInstance.play().catch(err => {
          console.error("Auto-play failed:", err);
        });
      }
    });
  });
}

// Boot the app
document.addEventListener('DOMContentLoaded', init);

/**
 * Opens the native fullscreen video modal
 */
function openNativeVideoModal(titleText) {
  const modalHTML = renderVideoModal('');
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  const modal = document.getElementById('video-modal');
  const closeBtn = document.getElementById('close-modal-btn');
  const titleOverlay = document.getElementById('plyr-title-overlay');
  
  if (titleOverlay && titleText) {
    titleOverlay.textContent = titleText;
  }
  
  // Initialize Plyr.io
  window.playerInstance = new Plyr('#native-video-player', {
    controls: ['play-large', 'rewind', 'play', 'fast-forward', 'progress', 'current-time', 'mute', 'volume', 'settings', 'fullscreen'],
    settings: ['quality', 'speed', 'loop'],
    speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
    hideControls: true,
  });

  // Handle playback errors (e.g. dead CDN links)
  window.playerInstance.on('error', () => {
    document.getElementById('video-error-overlay').classList.remove('hidden');
    document.getElementById('video-loading-overlay').classList.add('hidden');
    document.getElementById('plyr-container').classList.add('hidden');
  });

  // Fade in
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    modal.classList.add('opacity-100');
  }, 10);
  
  closeBtn.addEventListener('click', () => {
    if (window.playerInstance) {
      window.playerInstance.destroy();
      window.playerInstance = null;
    }
    
    modal.classList.remove('opacity-100');
    modal.classList.add('opacity-0');
    setTimeout(() => {
      modal.remove();
    }, 300);
  });
}
