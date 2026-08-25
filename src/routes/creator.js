import express from 'express';
import crypto from 'crypto';
import User from '../models/User.js';
import CreatorTrackAsset from '../models/CreatorTrackAsset.js';
import { authenticateToken } from '../middleware/auth.js';
import { cacheGet, cacheSet } from '../config/cache.js';

const router = express.Router();

// Short: a new upload should show up in browse quickly. Long enough to absorb
// the repeat hits from someone paging through or re-running the same search.
const PUBLIC_TRACKS_TTL_SECONDS = 60;

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_TRACKS_PER_USER = 200;
const ALLOWED_EVENTS = new Set(['play', 'skip', 'complete', 'like']);

const createTrackId = () => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `trk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const parseDataUrlBytes = (dataUrl = '') => {
  const separatorIndex = dataUrl.indexOf(',');
  if (separatorIndex === -1) return 0;
  const base64Part = dataUrl.slice(separatorIndex + 1);
  return Math.floor((base64Part.length * 3) / 4);
};

const parseDataUrlContent = (dataUrl = '') => {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(?:;(base64))?,([\s\S]*)$/i.exec(dataUrl);
  if (!match) return null;

  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = match[2] === 'base64';
  const payload = match[3] || '';

  try {
    const buffer = isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');

    return { buffer, mimeType };
  } catch {
    return null;
  }
};

const buildTrackStreamUrl = (req, trackId) =>
  `${req.protocol}://${req.get('host')}/api/creator/tracks/${encodeURIComponent(trackId)}/stream`;

const toCreatorTrackResponse = (req, track) => {
  const payload = track?.toObject ? track.toObject() : { ...track };
  return {
    ...payload,
    audioUrl: buildTrackStreamUrl(req, payload.id),
  };
};

const normalizeTags = (tags) => {
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => String(tag || '').trim())
      .filter(Boolean)
      .slice(0, 10);
  }
  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 10);
  }
  return [];
};

const escapeRegex = (value = '') =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const migrateLegacyTrackAudioToAssets = async (req, user) => {
  if (!Array.isArray(user?.creatorTracks) || user.creatorTracks.length === 0) {
    return;
  }

  for (const track of user.creatorTracks) {
    if (!track?.id || typeof track.audioUrl !== 'string' || !track.audioUrl.startsWith('data:audio/')) {
      continue;
    }

    const parsedAudio = parseDataUrlContent(track.audioUrl);
    if (!parsedAudio?.buffer?.length) {
      continue;
    }

    const normalizedMimeType = String(track.mimeType || parsedAudio.mimeType || 'audio/mpeg');
    const normalizedSizeBytes = Math.max(Number(track.sizeBytes) || 0, parsedAudio.buffer.length);

    await CreatorTrackAsset.findOneAndUpdate(
      {
        trackId: track.id,
        ownerId: user._id,
      },
      {
        $set: {
          audioBuffer: parsedAudio.buffer,
          mimeType: normalizedMimeType,
          sizeBytes: normalizedSizeBytes,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );

    track.audioUrl = buildTrackStreamUrl(req, track.id);
    track.mimeType = normalizedMimeType;
    track.sizeBytes = normalizedSizeBytes;
  }
};

const getDateKey = (date = new Date()) => date.toISOString().slice(0, 10);

/**
 * Parse a single-range `Range: bytes=...` header per RFC 7233.
 * Returns { start, end } inclusive, or null if the range is unsatisfiable.
 * Multi-range requests are deliberately unsupported — audio players don't use
 * them, and the caller falls back to a 416 so the browser retries whole-file.
 */
export const parseByteRange = (rangeHeader = '', totalBytes = 0) => {
  if (totalBytes <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null; // "bytes=-" is meaningless

  // Suffix form "bytes=-500" means the LAST 500 bytes, not bytes 0..500.
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (suffixLength <= 0) return null;
    return { start: Math.max(0, totalBytes - suffixLength), end: totalBytes - 1 };
  }

  const start = Number(rawStart);
  if (start >= totalBytes) return null;

  const end = rawEnd ? Math.min(Number(rawEnd), totalBytes - 1) : totalBytes - 1;
  if (start > end) return null;

  return { start, end };
};

router.get('/public-tracks', async (req, res) => {
  try {
    const parsedLimit = Number(req.query.limit);
    const parsedOffset = Number(req.query.offset);
    const search = String(req.query.search || '').trim();
    const genre = String(req.query.genre || '').trim();

    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(Math.floor(parsedLimit), 1), 100)
      : 20;
    const offset = Number.isFinite(parsedOffset)
      ? Math.max(Math.floor(parsedOffset), 0)
      : 0;

    const match = {
      'creatorTracks.isPublic': true,
    };

    if (search) {
      const safeSearch = escapeRegex(search);
      match.$or = [
        { 'creatorTracks.title': { $regex: safeSearch, $options: 'i' } },
        { 'creatorTracks.description': { $regex: safeSearch, $options: 'i' } },
        { 'creatorTracks.genre': { $regex: safeSearch, $options: 'i' } },
        { 'creatorTracks.tags': { $elemMatch: { $regex: safeSearch, $options: 'i' } } },
      ];
    }

    if (genre) {
      const safeGenre = escapeRegex(genre);
      match['creatorTracks.genre'] = { $regex: `^${safeGenre}$`, $options: 'i' };
    }

    // Cache the aggregation rows, NOT the finished response: audioUrl is built
    // from the request host below, so a cached absolute URL would be wrong for
    // any other origin.
    const cacheKey = `public-tracks:${limit}:${offset}:${search.toLowerCase()}:${genre.toLowerCase()}`;
    let entries = await cacheGet(cacheKey);

    if (entries) {
      res.set('X-Cache', 'HIT');
    } else {
      res.set('X-Cache', 'MISS');
      entries = await User.aggregate([
      { $unwind: '$creatorTracks' },
      { $match: match },
      { $sort: { 'creatorTracks.uploadedAt': -1 } },
      { $skip: offset },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          owner: {
            id: '$_id',
            name: '$name',
            profilePicture: '$profilePicture',
          },
          track: '$creatorTracks',
        },
      },
      ]);
      await cacheSet(cacheKey, entries, PUBLIC_TRACKS_TTL_SECONDS);
    }

    const tracks = entries.map((entry) => ({
      ...toCreatorTrackResponse(req, entry.track),
      owner: entry.owner,
    }));

    return res.json({
      tracks,
      pagination: {
        offset,
        limit,
        count: tracks.length,
      },
    });
  } catch (error) {
    console.error('Public creator tracks error:', error);
    return res.status(500).json({ message: 'Error loading public creator tracks' });
  }
});

router.get('/tracks/:trackId/stream', async (req, res) => {
  try {
    const { trackId } = req.params;
    const owner = await User.findOne(
      { 'creatorTracks.id': trackId },
      { _id: 1, creatorTracks: { $elemMatch: { id: trackId } } },
    );

    const track = owner?.creatorTracks?.[0];
    if (!track) {
      return res.status(404).json({ message: 'Track not found' });
    }

    // ponytail: isPublic is the whole access check. <audio src> can't send an
    // Authorization header, so a private track has no streamable form here.
    // Upgrade path: short-lived signed URLs if owners need private playback.
    if (!track.isPublic) {
      return res.status(404).json({ message: 'Track not found' });
    }

    const asset = await CreatorTrackAsset.findOne({
      trackId,
      ownerId: owner._id,
    });

    let audioBuffer = null;
    let mimeType = track.mimeType || asset?.mimeType || 'audio/mpeg';

    if (asset?.audioBuffer?.length) {
      audioBuffer = Buffer.from(asset.audioBuffer);
      mimeType = asset.mimeType || mimeType;
    } else if (typeof track.audioUrl === 'string' && track.audioUrl.startsWith('data:')) {
      const parsedAudio = parseDataUrlContent(track.audioUrl);
      if (!parsedAudio) {
        return res.status(404).json({ message: 'Track audio is unavailable' });
      }
      audioBuffer = parsedAudio.buffer;
      mimeType = track.mimeType || parsedAudio.mimeType || mimeType;
    } else if (typeof track.audioUrl === 'string' && track.audioUrl) {
      const streamPath = `/api/creator/tracks/${encodeURIComponent(trackId)}/stream`;
      if (!track.audioUrl.includes(streamPath)) {
        // Legacy tracks pointing at an external host. Only http(s), so a stored
        // javascript:/data: value can never become an open redirect.
        try {
          const target = new URL(track.audioUrl);
          if (target.protocol === 'https:' || target.protocol === 'http:') {
            return res.redirect(target.href);
          }
        } catch {
          // Not a URL at all.
        }
        return res.status(404).json({ message: 'Track audio is unavailable' });
      }
    }

    if (!audioBuffer?.length) {
      return res.status(404).json({ message: 'Track audio is unavailable' });
    }

    const totalBytes = audioBuffer.length;
    const rangeHeader = req.headers.range;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');

    if (!rangeHeader) {
      res.setHeader('Content-Length', totalBytes);
      return res.status(200).end(audioBuffer);
    }

    const parsedRange = parseByteRange(rangeHeader, totalBytes);
    if (!parsedRange) {
      res.setHeader('Content-Range', `bytes */${totalBytes}`);
      return res.status(416).end();
    }
    const { start, end } = parsedRange;

    const chunk = audioBuffer.subarray(start, end + 1);
    res.status(206);
    res.setHeader('Content-Length', chunk.length);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalBytes}`);
    return res.end(chunk);
  } catch (error) {
    console.error('Creator track stream error:', error);
    return res.status(500).json({ message: 'Error streaming track audio' });
  }
});

router.post('/tracks', authenticateToken, async (req, res) => {
  try {
    const {
      title,
      description = '',
      genre = '',
      tags = [],
      isPublic = true,
      coverImage = '',
      audioDataUrl,
      mimeType = 'audio/mpeg',
      sizeBytes = 0,
      duration = 0,
    } = req.body || {};

    const normalizedTitle = String(title || '').trim();
    if (!normalizedTitle) {
      return res.status(400).json({ message: 'Track title is required' });
    }
    if (!audioDataUrl || typeof audioDataUrl !== 'string' || !audioDataUrl.startsWith('data:audio/')) {
      return res.status(400).json({ message: 'A valid audio data URL is required' });
    }

    const parsedAudio = parseDataUrlContent(audioDataUrl);
    if (!parsedAudio || !parsedAudio.mimeType.startsWith('audio/')) {
      return res.status(400).json({ message: 'Invalid audio content' });
    }

    const detectedBytes = parsedAudio.buffer.length || parseDataUrlBytes(audioDataUrl);
    const normalizedSize = Math.max(Number(sizeBytes) || 0, detectedBytes);
    if (normalizedSize > MAX_AUDIO_BYTES) {
      return res.status(413).json({ message: 'Audio file is too large. Max allowed size is 12MB.' });
    }

    const normalizedDuration = Number.isFinite(Number(duration)) ? Math.max(0, Number(duration)) : 0;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await migrateLegacyTrackAudioToAssets(req, user);

    const trackId = createTrackId();
    const newTrack = {
      id: trackId,
      title: normalizedTitle,
      description: String(description || '').trim(),
      genre: String(genre || '').trim(),
      tags: normalizeTags(tags),
      isPublic: Boolean(isPublic),
      coverImage: String(coverImage || ''),
      audioUrl: buildTrackStreamUrl(req, trackId),
      mimeType: String(mimeType || parsedAudio.mimeType || 'audio/mpeg'),
      sizeBytes: normalizedSize,
      duration: normalizedDuration,
      uploadedAt: new Date(),
      stats: {
        plays: 0,
        completePlays: 0,
        skips: 0,
        likes: 0,
        totalListenSeconds: 0,
        lastPlayedAt: null,
      },
      dailyStats: [],
    };

    await CreatorTrackAsset.findOneAndUpdate(
      {
        trackId,
        ownerId: user._id,
      },
      {
        $set: {
          audioBuffer: parsedAudio.buffer,
          mimeType: newTrack.mimeType,
          sizeBytes: normalizedSize,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );

    user.creatorTracks.unshift(newTrack);
    const overflowTrackIds = [];
    if (user.creatorTracks.length > MAX_TRACKS_PER_USER) {
      overflowTrackIds.push(
        ...user.creatorTracks
          .slice(MAX_TRACKS_PER_USER)
          .map((track) => track.id)
          .filter(Boolean),
      );
      user.creatorTracks = user.creatorTracks.slice(0, MAX_TRACKS_PER_USER);
    }

    try {
      await user.save();
    } catch (saveError) {
      await CreatorTrackAsset.deleteOne({ trackId, ownerId: user._id }).catch(() => {});
      throw saveError;
    }

    if (overflowTrackIds.length > 0) {
      await CreatorTrackAsset.deleteMany({
        ownerId: user._id,
        trackId: { $in: overflowTrackIds },
      });
    }

    return res.status(201).json({
      message: 'Track uploaded successfully',
      track: toCreatorTrackResponse(req, newTrack),
    });
  } catch (error) {
    console.error('Creator upload error:', error);
    return res.status(500).json({ message: 'Error uploading track' });
  }
});

router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const tracks = [...(user.creatorTracks || [])].sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );

    const summary = tracks.reduce(
      (acc, track) => {
        acc.totalTracks += 1;
        acc.totalPlays += track.stats?.plays || 0;
        acc.totalCompletePlays += track.stats?.completePlays || 0;
        acc.totalListenSeconds += track.stats?.totalListenSeconds || 0;
        return acc;
      },
      {
        totalTracks: 0,
        totalPlays: 0,
        totalCompletePlays: 0,
        totalListenSeconds: 0,
      }
    );

    const completionRate = summary.totalPlays
      ? Number(((summary.totalCompletePlays / summary.totalPlays) * 100).toFixed(1))
      : 0;

    const today = new Date();
    const last7Days = [];
    for (let index = 6; index >= 0; index -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - index);
      const dateKey = getDateKey(date);
      last7Days.push({
        date: dateKey,
        label: date.toLocaleDateString('en-US', { weekday: 'short' }),
        plays: 0,
        completePlays: 0,
        listenSeconds: 0,
      });
    }

    const dailyMap = new Map(last7Days.map((entry) => [entry.date, entry]));
    tracks.forEach((track) => {
      (track.dailyStats || []).forEach((stat) => {
        const row = dailyMap.get(stat.date);
        if (!row) return;
        row.plays += stat.plays || 0;
        row.completePlays += stat.completePlays || 0;
        row.listenSeconds += stat.listenSeconds || 0;
      });
    });

    return res.json({
      summary: {
        totalTracks: summary.totalTracks,
        totalPlays: summary.totalPlays,
        totalCompletePlays: summary.totalCompletePlays,
        completionRate,
        totalListenSeconds: summary.totalListenSeconds,
        totalListenHours: Number((summary.totalListenSeconds / 3600).toFixed(2)),
      },
      weeklySeries: last7Days,
      tracks: tracks.map((track) => toCreatorTrackResponse(req, track)),
    });
  } catch (error) {
    console.error('Creator dashboard error:', error);
    return res.status(500).json({ message: 'Error loading creator dashboard' });
  }
});

router.delete('/tracks/:trackId', authenticateToken, async (req, res) => {
  try {
    const { trackId } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const previousCount = user.creatorTracks.length;
    user.creatorTracks = user.creatorTracks.filter((track) => track.id !== trackId);

    if (user.creatorTracks.length === previousCount) {
      return res.status(404).json({ message: 'Track not found' });
    }

    await user.save();
    await CreatorTrackAsset.deleteOne({ trackId, ownerId: user._id });
    return res.json({ message: 'Track deleted successfully' });
  } catch (error) {
    console.error('Creator track delete error:', error);
    return res.status(500).json({ message: 'Error deleting track' });
  }
});

router.post('/tracks/:trackId/events', authenticateToken, async (req, res) => {
  try {
    const { trackId } = req.params;
    const { event, listenSeconds = 0 } = req.body || {};

    if (!ALLOWED_EVENTS.has(event)) {
      return res.status(400).json({ message: 'Invalid event type' });
    }

    const owner = await User.findOne(
      { 'creatorTracks.id': trackId },
      { _id: 1, creatorTracks: { $elemMatch: { id: trackId } } },
    );
    if (!owner) {
      return res.status(404).json({ message: 'Track not found' });
    }

    const track = owner.creatorTracks?.[0];
    if (!track) {
      return res.status(404).json({ message: 'Track not found' });
    }

    const isOwner = String(owner._id) === String(req.user.id);
    if (!track.isPublic && !isOwner) {
      return res.status(403).json({ message: 'Track is private' });
    }

    const normalizedListenSeconds = Number.isFinite(Number(listenSeconds))
      ? Math.max(0, Math.round(Number(listenSeconds)))
      : 0;

    const dateKey = getDateKey();
    const hasDailyStat = Array.isArray(track.dailyStats)
      && track.dailyStats.some((entry) => entry.date === dateKey);

    const inc = {};
    const set = {};
    const statsPath = 'creatorTracks.$.stats';

    if (event === 'play') {
      inc[`${statsPath}.plays`] = 1;
      set[`${statsPath}.lastPlayedAt`] = new Date();
    }
    if (event === 'skip') {
      inc[`${statsPath}.skips`] = 1;
    }
    if (event === 'complete') {
      inc[`${statsPath}.completePlays`] = 1;
    }
    if (event === 'like') {
      inc[`${statsPath}.likes`] = 1;
    }
    if (normalizedListenSeconds > 0) {
      inc[`${statsPath}.totalListenSeconds`] = normalizedListenSeconds;
    }

    const update = {};
    if (Object.keys(inc).length > 0) {
      update.$inc = inc;
    }
    if (Object.keys(set).length > 0) {
      update.$set = set;
    }

    if (hasDailyStat) {
      const dailyInc = {};
      if (event === 'play') {
        dailyInc['creatorTracks.$.dailyStats.$[day].plays'] = 1;
      }
      if (event === 'complete') {
        dailyInc['creatorTracks.$.dailyStats.$[day].completePlays'] = 1;
      }
      if (normalizedListenSeconds > 0) {
        dailyInc['creatorTracks.$.dailyStats.$[day].listenSeconds'] = normalizedListenSeconds;
      }
      if (Object.keys(dailyInc).length > 0) {
        update.$inc = {
          ...(update.$inc || {}),
          ...dailyInc,
        };
      }
    } else {
      update.$push = {
        'creatorTracks.$.dailyStats': {
          date: dateKey,
          plays: event === 'play' ? 1 : 0,
          completePlays: event === 'complete' ? 1 : 0,
          listenSeconds: normalizedListenSeconds > 0 ? normalizedListenSeconds : 0,
        },
      };
    }

    const updateOptions = hasDailyStat
      ? { arrayFilters: [{ 'day.date': dateKey }] }
      : undefined;

    const updateResult = await User.updateOne(
      { _id: owner._id, 'creatorTracks.id': trackId },
      update,
      updateOptions,
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ message: 'Track not found' });
    }

    const refreshedOwner = await User.findById(
      owner._id,
      { creatorTracks: { $elemMatch: { id: trackId } } },
    );
    const refreshedTrack = refreshedOwner?.creatorTracks?.[0];
    const dailyStat = refreshedTrack?.dailyStats?.find((item) => item.date === dateKey) || null;

    return res.json({
      message: 'Event recorded',
      stats: refreshedTrack?.stats || null,
      dailyStat,
    });
  } catch (error) {
    console.error('Creator event error:', error);
    return res.status(500).json({ message: 'Error recording track event' });
  }
});

export default router;
