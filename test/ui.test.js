import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml, safeImageUrl } from '../stream/ui.js';

describe('UI sanitization', () => {
  it('escapes markup and attribute delimiters', () => {
    assert.equal(escapeHtml(`<img src=x onerror="alert('x')">`), '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;');
  });

  it('only accepts HTTPS image URLs', () => {
    assert.equal(safeImageUrl('javascript:alert(1)', 'fallback'), 'fallback');
    assert.equal(safeImageUrl('http://example.com/a.jpg', 'fallback'), 'fallback');
    assert.equal(safeImageUrl('https://example.com/a.jpg?a=1&b=2', 'fallback'), 'https://example.com/a.jpg?a=1&amp;b=2');
    assert.equal(safeImageUrl('https://episodes.metahub.space/example.jpg', 'fallback', 'thumb'), '/api/image?url=https%3A%2F%2Fepisodes.metahub.space%2Fexample.jpg&amp;kind=thumb');
  });
});
