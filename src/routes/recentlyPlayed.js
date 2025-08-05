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

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Add the track to recently played
    const recentlyPlayedTrack = {
      track,
      playedAt: new Date()
    };

    // Remove the track if it already exists
    user.recentlyPlayed = user.recentlyPlayed.filter(
      item => item.track.id !== track.id
    );

    // Add the track to the beginning of the array
    user.recentlyPlayed.unshift(recentlyPlayedTrack);

    // Keep only the last 50 tracks
    if (user.recentlyPlayed.length > 50) {
      user.recentlyPlayed = user.recentlyPlayed.slice(0, 50);
    }

    await user.save();
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
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.recentlyPlayed = [];
    await user.save();

    res.json({ message: 'Recently played tracks cleared successfully' });
  } catch (error) {
    console.error('Error clearing recently played tracks:', error);
    res.status(500).json({ message: 'Error clearing recently played tracks' });
  }
});

export default router; 