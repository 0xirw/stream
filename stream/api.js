/**
 * api.js
 * Handles all network requests to the Stremio Cinemeta API and the TorBox Proxy.
 */

const BASE_URL = 'https://v3-cinemeta.strem.io';
const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const TORRENTIO_BASE = 'https://torrentio.strem.fun';
// Cloudflare Worker URL
const TORBOX_BASE = 'https://torbox-proxy.rakanfaisalbu.workers.dev'; 

/**
 * Searches for movies/series based on a query string.
 * @param {string} query - The search query.
 * @returns {Promise<Array>} - Array of result objects.
 */
export async function searchMovies(query) {
  if (!query) return [];
  try {
    const encodedQuery = encodeURIComponent(query);
    
    // Fetch from both Movie and Series catalogs concurrently
    const [movieRes, seriesRes] = await Promise.allSettled([
      fetch(`${BASE_URL}/catalog/movie/top/search=${encodedQuery}.json`),
      fetch(`${BASE_URL}/catalog/series/top/search=${encodedQuery}.json`)
    ]);

    let results = [];

    if (movieRes.status === 'fulfilled' && movieRes.value.ok) {
      const movieData = await movieRes.value.json();
      results = results.concat(movieData.metas || []);
    }

    if (seriesRes.status === 'fulfilled' && seriesRes.value.ok) {
      const seriesData = await seriesRes.value.json();
      results = results.concat(seriesData.metas || []);
    }

    return results;
  } catch (error) {
    console.error("Error searching media:", error);
    return [];
  }
}

/**
 * Fetches full metadata for a specific item.
 * @param {string} type - Usually 'movie' or 'series'.
 * @param {string} imdb_id - The IMDb ID of the item.
 * @returns {Promise<Object|null>} - The metadata object.
 */
export async function getMetadata(type, imdb_id) {
  try {
    const valid_type = type || 'movie';
    const response = await fetch(`${BASE_URL}/meta/${valid_type}/${imdb_id}.json`);
    if (!response.ok) throw new Error('Network response was not ok');
    const data = await response.json();
    return data.meta || null;
  } catch (error) {
    console.error("Error fetching metadata:", error);
    return null;
  }
}

/**
 * Fetches streams from Torrentio with a timeout.
 * @param {string} type - 'movie' or 'series'
 * @param {string} id - The IMDb ID (e.g., 'tt1234567' or 'tt1234567:1:1')
 * @returns {Promise<Array>} - Array of stream objects.
 */
export async function fetchTorrentioStreams(type, id) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20-second timeout

  try {
    const response = await fetch(`${TORRENTIO_BASE}/stream/${type}/${id}.json`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error('Network response was not ok');
    const data = await response.json();
    return data.streams || [];
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error("Torrentio request timed out after 20 seconds.");
      return [{ error: true, message: "Torrentio timed out. The servers are currently overloaded." }];
    }
    console.error("Error fetching Torrentio streams:", error);
    return [];
  }
}

/**
 * Checks if multiple torrents are cached on TorBox.
 * @param {Array<string>} hashes - Array of infoHashes.
 * @returns {Promise<Set<string>>} - A Set of hashes that are cached.
 */
export async function checkTorboxCacheBulk(hashes) {
  if (!hashes || hashes.length === 0) return new Set();
  try {
    const hashString = hashes.join(',');
    const res = await fetch(`${TORBOX_BASE}/torrents/checkcached?hash=${hashString}&format=list`);
    const json = await res.json();
    
    const cachedSet = new Set();
    if (json.success && Array.isArray(json.data)) {
      json.data.forEach(item => {
        if (item && item.hash) {
          cachedSet.add(item.hash.toLowerCase());
        }
      });
    }
    return cachedSet;
  } catch (error) {
    console.error("TorBox bulk check cache error:", error);
    return new Set();
  }
}

/**
 * Creates a torrent on TorBox from a magnet link.
 * @param {string} magnet - The magnet link.
 * @returns {Promise<number|null>} - The torrent_id if successful.
 */
export async function createTorboxTorrent(magnet) {
  try {
    const body = new URLSearchParams();
    body.append('magnet', magnet);

    const res = await fetch(`${TORBOX_BASE}/torrents/createtorrent`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });
    const json = await res.json();
    if (json.success && json.data && json.data.torrent_id) {
      return json.data.torrent_id;
    }
    return null;
  } catch (error) {
    console.error("TorBox create torrent error:", error);
    return null;
  }
}

/**
 * Requests the direct CDN download link from TorBox.
 * @param {number} torrent_id - The ID from createTorboxTorrent.
 * @param {number} file_id - The file index (default 0).
 * @returns {Promise<string|null>} - The direct URL.
 */
export async function getTorboxStream(torrent_id, file_id = 0) {
  try {
    const res = await fetch(`${TORBOX_BASE}/torrents/requestdl?torrent_id=${torrent_id}&file_id=${file_id}&zip=false`);
    const json = await res.json();
    if (json.success && json.data) {
      return json.data;
    }
    return null;
  } catch (error) {
    console.error("TorBox requestdl error:", error);
    return null;
  }
}
