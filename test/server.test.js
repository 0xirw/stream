import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { convertToVtt, createAppServer, extractInfoHash, pickLiveMp4, selectVideoFile } from '../server.js';

describe('server helpers', () => {
  it('extracts valid hex and base32 info hashes', () => {
    assert.equal(extractInfoHash('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'), '0123456789abcdef0123456789abcdef01234567');
    assert.equal(extractInfoHash('magnet:?xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'), 'abcdefghijklmnopqrstuvwxyz234567');
    assert.equal(extractInfoHash('https://example.com/file'), null);
    assert.equal(extractInfoHash('magnet:?xt=urn:btih:not-a-hash'), null);
  });

  it('uses a requested video index and otherwise picks the largest video', () => {
    const files = [
      { id: 1, path: '/readme.txt', bytes: 10 },
      { id: 2, path: '/small.mp4', bytes: 100 },
      { id: 3, path: '/large.mkv', bytes: 500 }
    ];
    assert.equal(selectVideoFile(files, 1).id, 2);
    assert.equal(selectVideoFile(files, 0).id, 3);
    assert.equal(selectVideoFile([{ id: 1, path: '/readme.txt' }], null), null);
  });

  it('chooses a browser-compatible Real-Debrid MP4 transcode', () => {
    assert.equal(pickLiveMp4({ liveMP4: { full: 'https://example.com/full.mp4' } }), 'https://example.com/full.mp4');
    assert.equal(pickLiveMp4({ liveMP4: {} }), null);
    assert.equal(pickLiveMp4({}), null);
  });

  it('converts SRT captions to sanitized WebVTT', () => {
    const vtt = convertToVtt(`1\n00:00:01,250 --> 00:00:03,500\n<i>Hello</i> <script>alert(1)</script>`);
    assert.match(vtt, /^WEBVTT/);
    assert.match(vtt, /00:00:01\.250 --> 00:00:03\.500/);
    assert.match(vtt, /<i>Hello<\/i> alert\(1\)/);
    assert.doesNotMatch(vtt, /<script>/);
  });

  it('converts ASS captions to sanitized WebVTT', () => {
    const vtt = convertToVtt(`[Script Info]\nTitle: Test\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.25,0:00:03.50,Default,,0,0,0,,{\\i1}Hello{\\i0}\\NWorld`);
    assert.match(vtt, /00:00:01\.250 --> 00:00:03\.500/);
    assert.match(vtt, /Hello\nWorld/);
  });
});

describe('HTTP server', () => {
  let server;
  let origin;

  before(async () => {
    server = createAppServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('serves the app with security headers', async () => {
    const response = await fetch(origin);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(response.headers.get('clear-site-data'), '"cache", "storage"');
    assert.match(await response.text(), /Stream Discovery/);
  });

  it('serves a favicon', async () => {
    const response = await fetch(`${origin}/favicon.svg`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
  });

  it('rejects arbitrary image proxy hosts', async () => {
    const response = await fetch(`${origin}/api/image?url=${encodeURIComponent('https://example.com/image.jpg')}`);
    assert.equal(response.status, 400);
  });

  it('does not expose Real-Debrid when no token is configured', async () => {
    const existing = process.env.REAL_DEBRID_TOKEN;
    delete process.env.REAL_DEBRID_TOKEN;
    const response = await fetch(`${origin}/api/debrid/status`);
    if (existing) process.env.REAL_DEBRID_TOKEN = existing;
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Real-Debrid is not configured on the server.' });
  });

  it('reports missing SubDL configuration without exposing credentials', async () => {
    const existing = process.env.SUBDL_API_KEY;
    delete process.env.SUBDL_API_KEY;
    const response = await fetch(`${origin}/api/subtitles?type=movie&imdbId=tt1375666`);
    if (existing) process.env.SUBDL_API_KEY = existing;
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'SubDL is not configured. Add SUBDL_API_KEY to .env.' });
  });

  it('marks an infringing Real-Debrid torrent as a retryable source failure', async () => {
    const originalFetch = globalThis.fetch;
    const existing = process.env.REAL_DEBRID_TOKEN;
    process.env.REAL_DEBRID_TOKEN = 'test-token';
    globalThis.fetch = async (input, options) => {
      if (String(input).startsWith('https://api.real-debrid.com/')) {
        return new Response(JSON.stringify({ error: 'infringing_file', error_code: 35 }), {
          status: 451,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return originalFetch(input, options);
    };
    try {
      const response = await originalFetch(`${origin}/api/debrid/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567' })
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ready: false,
        failed: true,
        retryable: true,
        status: 'infringing_file'
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (existing) process.env.REAL_DEBRID_TOKEN = existing;
      else delete process.env.REAL_DEBRID_TOKEN;
    }
  });

  it('reuses an existing Real-Debrid torrent instead of adding a duplicate magnet', async () => {
    const originalFetch = globalThis.fetch;
    const existingToken = process.env.REAL_DEBRID_TOKEN;
    const hash = '0123456789abcdef0123456789abcdef01234567';
    let addMagnetCalls = 0;
    process.env.REAL_DEBRID_TOKEN = 'test-token';
    globalThis.fetch = async (input, options) => {
      const url = String(input);
      if (url.endsWith('/torrents?limit=5000')) {
        return Response.json([{ id: 'EXISTING', hash, status: 'downloaded' }]);
      }
      if (url.endsWith('/torrents/info/EXISTING')) {
        return Response.json({ id: 'EXISTING', hash, status: 'downloaded', filename: 'episode.mkv', links: ['https://restricted.example/file'] });
      }
      if (url.endsWith('/unrestrict/link')) {
        return Response.json({ download: 'https://cdn.example/episode.mp4', filename: 'episode.mp4', mimeType: 'video/mp4', streamable: 0 });
      }
      if (url.endsWith('/torrents/addMagnet')) {
        addMagnetCalls += 1;
        return Response.json({ id: 'DUPLICATE' });
      }
      return originalFetch(input, options);
    };
    try {
      const response = await originalFetch(`${origin}/api/debrid/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet: `magnet:?xt=urn:btih:${hash}` })
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.ready, true);
      assert.equal(body.torrentId, 'EXISTING');
      assert.equal(addMagnetCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      if (existingToken) process.env.REAL_DEBRID_TOKEN = existingToken;
      else delete process.env.REAL_DEBRID_TOKEN;
    }
  });

  it('rejects malformed media identifiers', async () => {
    const response = await fetch(`${origin}/api/meta?type=movie&id=../../secret`);
    assert.equal(response.status, 400);
  });

  it('blocks path traversal attempts', async () => {
    const response = await fetch(`${origin}/..%2f..%2fpackage.json`);
    assert.equal(response.status, 404);
  });
});
