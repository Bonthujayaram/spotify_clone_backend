import express from 'express';

const router = express.Router();

const LRCLIB_BASE = 'https://lrclib.net/api';
const LYRICS_OVH_BASE = 'https://api.lyrics.ovh/v1';

const decodeHtml = (value = '') =>
  String(value)
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&amp;', '&');

const normalizeTitle = (title = '') =>
  decodeHtml(title)
    .replace(/\(from[^)]*\)/gi, '')
    .replace(/\(feat\.[^)]*\)/gi, '')
    .replace(/\s*-\s*(telugu|hindi|tamil|punjabi|malayalam|kannada|bengali)\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeArtist = (artist = '') =>
  decodeHtml(artist)
    .split(',')[0]
    .split('&')[0]
    .trim();

const isPlaceholderArtist = (artist = '') => /^(unknown artist|you)$/i.test(normalizeArtist(artist));

const stripTimeTags = (lyrics = '') =>
  lyrics
    .split('\n')
    .map((line) => line.replace(/\[[0-9:.]+\]/g, '').trim())
    .filter(Boolean)
    .join('\n');

const isGoodLyrics = (lyrics = '') => lyrics.trim().length > 20;

const withTimeout = async (url, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const parseLrclibPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;

  const plainLyrics = typeof payload.plainLyrics === 'string' ? payload.plainLyrics.trim() : '';
  if (isGoodLyrics(plainLyrics)) {
    return { text: plainLyrics, source: 'lrclib', synced: false };
  }

  const syncedLyrics = typeof payload.syncedLyrics === 'string' ? payload.syncedLyrics.trim() : '';
  const cleanSynced = stripTimeTags(syncedLyrics);
  if (isGoodLyrics(cleanSynced)) {
    return { text: cleanSynced, source: 'lrclib', synced: true };
  }

  return null;
};

const fetchFromLrclib = async (trackTitle, artistName) => {
  const title = normalizeTitle(trackTitle);
  const artist = normalizeArtist(artistName);

  const exactUrl = `${LRCLIB_BASE}/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
  try {
    const exactRes = await withTimeout(exactUrl);
    if (exactRes.ok) {
      const exactJson = await exactRes.json();
      const exactLyrics = parseLrclibPayload(exactJson);
      if (exactLyrics) return exactLyrics;
    }
  } catch {
    // Ignore and fallback to search endpoint.
  }

  const searchUrl = `${LRCLIB_BASE}/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
  try {
    const searchRes = await withTimeout(searchUrl);
    if (!searchRes.ok) return null;
    const searchJson = await searchRes.json();
    if (!Array.isArray(searchJson)) return null;
    for (const candidate of searchJson) {
      const parsed = parseLrclibPayload(candidate);
      if (parsed) return parsed;
    }
  } catch {
    return null;
  }

  return null;
};

const fetchFromLyricsOvh = async (trackTitle, artistName) => {
  const title = normalizeTitle(trackTitle);
  const artist = normalizeArtist(artistName);
  const url = `${LYRICS_OVH_BASE}/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;

  try {
    const response = await withTimeout(url);
    if (!response.ok) return null;
    const json = await response.json();
    const lyrics = typeof json?.lyrics === 'string' ? json.lyrics.trim() : '';
    if (!isGoodLyrics(lyrics)) return null;
    if (lyrics.toLowerCase().includes('unfortunately, we are not authorized')) return null;
    return { text: lyrics, source: 'lyricsovh', synced: false };
  } catch {
    return null;
  }
};

router.get('/', async (req, res) => {
  try {
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();

    if (!title) {
      return res.status(400).json({ message: 'title is required', lyrics: null });
    }

    const normalizedArtist = artist || 'Unknown Artist';
    if (isPlaceholderArtist(normalizedArtist)) {
      return res.json({ lyrics: null });
    }

    const fromLrclib = await fetchFromLrclib(title, normalizedArtist);
    if (fromLrclib) {
      return res.json({ lyrics: fromLrclib });
    }

    const fromLyricsOvh = await fetchFromLyricsOvh(title, normalizedArtist);
    if (fromLyricsOvh) {
      return res.json({ lyrics: fromLyricsOvh });
    }

    return res.json({ lyrics: null });
  } catch (error) {
    console.error('Lyrics route error:', error);
    return res.status(500).json({ message: 'Error fetching lyrics', lyrics: null });
  }
});

export default router;
