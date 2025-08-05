import express from 'express';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Create a new playlist
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Playlist name is required' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const newPlaylist = {
      name,
      description: description || '',
      coverImage: '', // Add default empty coverImage
      tracks: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    user.playlists.push(newPlaylist);
    await user.save();

    res.status(201).json({ playlist: newPlaylist }); // Wrap in playlist object to match frontend expectation
  } catch (error) {
    console.error('Error creating playlist:', error);
    res.status(500).json({ message: 'Error creating playlist' });
  }
});

// Get all playlists for a user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ playlists: user.playlists });
  } catch (error) {
    console.error('Error fetching playlists:', error);
    res.status(500).json({ message: 'Error fetching playlists' });
  }
});

// Get a single playlist by ID
router.get('/:playlistId', authenticateToken, async (req, res) => {
  try {
    const { playlistId } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const playlist = user.playlists.id(playlistId);
    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found' });
    }

    res.json({ playlist });
  } catch (error) {
    console.error('Error fetching playlist:', error);
    res.status(500).json({ message: 'Error fetching playlist' });
  }
});

// Add track to playlist
router.post('/:playlistId/tracks', authenticateToken, async (req, res) => {
  try {
    const { playlistId } = req.params;
    const { track } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const playlist = user.playlists.id(playlistId);
    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found' });
    }

    track.addedAt = new Date();
    playlist.tracks.push(track);
    playlist.updatedAt = new Date();
    await user.save();

    res.json(playlist);
  } catch (error) {
    console.error('Error adding track to playlist:', error);
    res.status(500).json({ message: 'Error adding track to playlist' });
  }
});

// Remove track from playlist
router.delete('/:playlistId/tracks/:trackId', authenticateToken, async (req, res) => {
  try {
    const { playlistId, trackId } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const playlist = user.playlists.id(playlistId);
    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found' });
    }

    playlist.tracks = playlist.tracks.filter(track => track.id !== trackId);
    playlist.updatedAt = new Date();
    await user.save();

    res.json(playlist);
  } catch (error) {
    console.error('Error removing track from playlist:', error);
    res.status(500).json({ message: 'Error removing track from playlist' });
  }
});

// Delete playlist
router.delete('/:playlistId', authenticateToken, async (req, res) => {
  try {
    const { playlistId } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.playlists = user.playlists.filter(playlist => playlist._id.toString() !== playlistId);
    await user.save();

    res.json({ message: 'Playlist deleted successfully' });
  } catch (error) {
    console.error('Error deleting playlist:', error);
    res.status(500).json({ message: 'Error deleting playlist' });
  }
});

export default router; 