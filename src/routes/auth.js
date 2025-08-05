import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const router = express.Router();

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Register a new user
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create new user
    const user = new User({
      email,
      password,
      name: name || email.split('@')[0], // Use part of email as name if not provided
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        profilePicture: user.profilePicture,
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Error creating user' });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        profilePicture: user.profilePicture,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Error logging in' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { name, profilePicture } = req.body;

    // Update only the fields that are provided
    if (name !== undefined) user.name = name;
    if (profilePicture !== undefined) user.profilePicture = profilePicture;

    await user.save();

    res.json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        profilePicture: user.profilePicture,
      },
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Error updating profile' });
  }
});

// Like/Unlike a song
router.post('/like-song', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('User ID:', decoded.userId);
    
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    console.log('Found user:', user.email);

    const { track, action } = req.body;
    console.log('Received track:', track);
    console.log('Action:', action);

    if (!track || !track.id || !track.title) {
      console.log('Invalid track data:', track);
      return res.status(400).json({ message: 'Invalid track data' });
    }

    if (action === 'like') {
      // Check if song is already liked
      const isLiked = user.likedSongs.some(song => song.id === track.id);
      console.log('Is track already liked?', isLiked);
      
      if (!isLiked) {
        // Add all necessary track data
        const likedSong = {
          id: track.id,
          title: track.title,
          artwork: track.artwork || {},
          user: {
            id: track.user?.id,
            name: track.user?.name,
            handle: track.user?.handle,
            profile_picture: track.user?.profile_picture || {}
          },
          duration: track.duration,
          genre: track.genre,
          mood: track.mood,
          release_date: track.release_date,
          repost_count: track.repost_count,
          favorite_count: track.favorite_count,
          play_count: track.play_count,
          permalink: track.permalink,
          source: track.source, // add this
          url: track.url,       // add this
          addedAt: new Date()
        };
        
        // Add to the beginning of the array so newest likes appear first
        user.likedSongs.unshift(likedSong);
        console.log('Added new liked song:', likedSong);
      }
    } else if (action === 'unlike') {
      const beforeLength = user.likedSongs.length;
      user.likedSongs = user.likedSongs.filter(song => song.id !== track.id);
      console.log('Removed song from liked songs. Before:', beforeLength, 'After:', user.likedSongs.length);
    }

    await user.save();
    console.log('Saved user with updated liked songs. Count:', user.likedSongs.length);

    // Sort liked songs by addedAt in descending order (newest first)
    const sortedLikedSongs = user.likedSongs.sort((a, b) => 
      new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
    );

    res.json({ likedSongs: sortedLikedSongs });
  } catch (error) {
    console.error('Like/Unlike error:', error);
    res.status(500).json({ message: 'Error updating liked songs' });
  }
});

// Get liked songs
router.get('/liked-songs', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Sort liked songs by addedAt in descending order (newest first)
    const sortedLikedSongs = user.likedSongs.sort((a, b) => 
      new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
    );

    res.json({ likedSongs: sortedLikedSongs });
  } catch (error) {
    console.error('Get liked songs error:', error);
    res.status(500).json({ message: 'Error getting liked songs' });
  }
});

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create new user with initialized arrays
    const user = new User({
      email,
      password,
      name,
      likedSongs: [],
      isGoogleUser: false
    });

    console.log('Creating new user:', {
      email: user.email,
      name: user.name,
      likedSongsLength: user.likedSongs.length
    });

    await user.save();
    console.log('User saved successfully');

    // Create JWT token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        profilePicture: user.profilePicture
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Error registering user' });
  }
}); 