import express from 'express';
import { audiusService } from '../services/audiusService.js';

export const router = express.Router();

// Search endpoint
router.get('/search', async (req, res, next) => {
  try {
    const { query, type = 'tracks', limit = 10, offset = 0 } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }
    const result = await audiusService.search(query, type, parseInt(limit), parseInt(offset));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get track details
router.get('/tracks/:trackId', async (req, res, next) => {
  try {
    const { trackId } = req.params;
    const result = await audiusService.getTrack(trackId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get track stream URL
router.get('/tracks/:trackId/stream', async (req, res) => {
  try {
    const { trackId } = req.params;
    const result = await audiusService.getStreamUrl(trackId);
    res.json(result);
  } catch (error) {
    if (error.message && error.message.includes('Track not found')) {
      console.error(`Track not found: ${req.params.trackId}`);
      res.status(404).json({ message: 'Track not found' });
    } else {
      console.error('Error fetching stream URL:', error);
      res.status(500).json({ message: 'Failed to fetch stream URL', error: error.message });
    }
  }
});

// Get user details
router.get('/users/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const result = await audiusService.getUser(userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get user's tracks
router.get('/users/:userId/tracks', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { limit = 10 } = req.query;
    const result = await audiusService.getUserTracks(userId, limit);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get trending tracks
router.get('/trending', async (req, res, next) => {
  try {
    const { time = 'week', limit = 10 } = req.query;
    const result = await audiusService.getTrending(time, parseInt(limit));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get popular tracks
router.get('/popular', async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    const result = await audiusService.getPopular(parseInt(limit));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get recent tracks
router.get('/recent', async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    const result = await audiusService.getRecentTracks(parseInt(limit));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get trending artists
router.get('/trending-artists', async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    const result = await audiusService.getTrendingArtists(parseInt(limit));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get trending playlists
router.get('/trending-playlists', async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    const result = await audiusService.getTrendingPlaylists(parseInt(limit));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get playlist
router.get('/playlists/:playlistId', async (req, res, next) => {
  try {
    const { playlistId } = req.params;
    const result = await audiusService.getPlaylist(playlistId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}); 