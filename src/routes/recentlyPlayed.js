import express from 'express';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Add a track to recently played
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { track } = req.body;
    if (!track) {
      return res.status(400).json({ message: 'Track data is required' });
    }

    const recentlyPlayedTrack = {
      track,
      playedAt: new Date()
    };

    const normalizedTrackId = typeof track.id === 'string' ? track.id.trim() : '';
    if (normalizedTrackId) {
      await User.updateOne(
        { _id: req.user.id },
        { $pull: { recentlyPlayed: { 'track.id': normalizedTrackId } } },
      );
    }

    const pushResult = await User.updateOne(
      { _id: req.user.id },
      {
        $push: {
          recentlyPlayed: {
            $each: [recentlyPlayedTrack],
            $position: 0,
            $slice: 50,
          },
        },
      },
    );

    if (pushResult.matchedCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(201).json({ recentlyPlayed: [recentlyPlayedTrack] });
  } catch (error) {
    console.error('Error adding recently played track:', error);
    res.status(500).json({ message: 'Error adding recently played track' });
  }
});

// Get recently played tracks
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ recentlyPlayed: user.recentlyPlayed });
  } catch (error) {
    console.error('Error fetching recently played tracks:', error);
    res.status(500).json({ message: 'Error fetching recently played tracks' });
  }
});

// Clear recently played tracks
router.delete('/', authenticateToken, async (req, res) => {
  try {
    const result = await User.updateOne(
      { _id: req.user.id },
      { $set: { recentlyPlayed: [] } },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'Recently played tracks cleared successfully' });
  } catch (error) {
    console.error('Error clearing recently played tracks:', error);
    res.status(500).json({ message: 'Error clearing recently played tracks' });
  }
});

export default router; 
