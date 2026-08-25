import express from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import { authenticateToken, signToken } from '../middleware/auth.js';
import { verifyFirebaseIdToken } from '../config/firebase.js';

export const router = express.Router();

// Credential endpoints only. Brute-force / enumeration guard.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Try again in 15 minutes.' },
});

const DEFAULT_SETTINGS = {
  audioQuality: 'auto',
  autoplay: true,
  accountPrivacy: 'friends',
  notifications: 'push_email',
  connectedAccounts: {
    google: false,
  },
};

const ALLOWED_AUDIO_QUALITY = new Set(['auto', 'low', 'medium', 'high']);
const ALLOWED_PRIVACY = new Set(['public', 'friends', 'private']);
const ALLOWED_NOTIFICATIONS = new Set(['all', 'push_email', 'push', 'email', 'none']);

const formatSettings = (settings = {}, isGoogleUser = false) => ({
  audioQuality: settings?.audioQuality || DEFAULT_SETTINGS.audioQuality,
  autoplay: typeof settings?.autoplay === 'boolean' ? settings.autoplay : DEFAULT_SETTINGS.autoplay,
  accountPrivacy: settings?.accountPrivacy || DEFAULT_SETTINGS.accountPrivacy,
  notifications: settings?.notifications || DEFAULT_SETTINGS.notifications,
  connectedAccounts: {
    google: Boolean(settings?.connectedAccounts?.google || isGoogleUser),
  },
});

const formatUserResponse = (user) => ({
  id: user._id,
  email: user.email,
  name: user.name,
  profilePicture: user.profilePicture,
  isGoogleUser: Boolean(user.isGoogleUser),
  following: user.following || [],
  followers: user.followers || [],
  externalFollowing: user.externalFollowing || [],
  settings: formatSettings(user.settings, user.isGoogleUser),
});

// Newest first, with an artwork fallback for tracks saved before `image` existed.
const formatLikedSongs = (likedSongs = []) =>
  [...likedSongs]
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    .map((song) => {
      const obj = song.toObject ? song.toObject() : song;
      if (!obj.image) {
        obj.image =
          obj.artwork?.['480x480'] ||
          obj.artwork?.['150x150'] ||
          obj.user?.profile_picture?.['150x150'] ||
          '';
      }
      return obj;
    });

// Register a new user
router.post('/signup', credentialLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = new User({
      email: normalizedEmail,
      password,
      name: name || normalizedEmail.split('@')[0],
    });

    await user.save();

    res.status(201).json({
      token: signToken(user._id),
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error('Signup error:', error.message);
    res.status(500).json({ message: 'Error creating user' });
  }
});

// Login user
router.post('/login', credentialLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user || !(await user.comparePassword(password))) {
      // Same response either way: don't reveal which emails are registered.
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    res.json({
      token: signToken(user._id),
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ message: 'Error logging in' });
  }
});

// Get current user
router.get('/me', authenticateToken, (req, res) => {
  res.json(formatUserResponse(req.user));
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, profilePicture } = req.body || {};
    if (name !== undefined) req.user.name = name;
    if (profilePicture !== undefined) req.user.profilePicture = profilePicture;

    await req.user.save();
    res.json({ user: formatUserResponse(req.user) });
  } catch (error) {
    console.error('Profile update error:', error.message);
    res.status(500).json({ message: 'Error updating profile' });
  }
});

// Get user settings
router.get('/settings', authenticateToken, (req, res) => {
  res.json({ settings: formatSettings(req.user.settings, req.user.isGoogleUser) });
});

// Update user settings
router.put('/settings', authenticateToken, async (req, res) => {
  try {
    const { audioQuality, autoplay, accountPrivacy, notifications, connectedAccounts } = req.body || {};
    const user = req.user;

    if (!user.settings) user.settings = {};
    if (!user.settings.connectedAccounts) user.settings.connectedAccounts = {};

    if (audioQuality !== undefined) {
      if (!ALLOWED_AUDIO_QUALITY.has(audioQuality)) {
        return res.status(400).json({ message: 'Invalid audio quality' });
      }
      user.settings.audioQuality = audioQuality;
    }

    if (autoplay !== undefined) {
      user.settings.autoplay = Boolean(autoplay);
    }

    if (accountPrivacy !== undefined) {
      if (!ALLOWED_PRIVACY.has(accountPrivacy)) {
        return res.status(400).json({ message: 'Invalid account privacy setting' });
      }
      user.settings.accountPrivacy = accountPrivacy;
    }

    if (notifications !== undefined) {
      if (!ALLOWED_NOTIFICATIONS.has(notifications)) {
        return res.status(400).json({ message: 'Invalid notifications setting' });
      }
      user.settings.notifications = notifications;
    }

    if (connectedAccounts && typeof connectedAccounts === 'object' && connectedAccounts.google !== undefined) {
      user.settings.connectedAccounts.google = Boolean(connectedAccounts.google);
    }

    await user.save();

    res.json({
      message: 'Settings updated',
      settings: formatSettings(user.settings, user.isGoogleUser),
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error('Update settings error:', error.message);
    res.status(500).json({ message: 'Error updating settings' });
  }
});

// Change password
router.put('/change-password', credentialLimiter, authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const user = req.user;
    if (!user.isGoogleUser) {
      if (!currentPassword) {
        return res.status(400).json({ message: 'Current password is required' });
      }
      if (!(await user.comparePassword(currentPassword))) {
        return res.status(401).json({ message: 'Current password is incorrect' });
      }
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error.message);
    res.status(500).json({ message: 'Error changing password' });
  }
});

// Delete account
router.delete('/delete-account', credentialLimiter, authenticateToken, async (req, res) => {
  try {
    const { password } = req.body || {};
    const user = req.user;

    if (!user.isGoogleUser) {
      if (!password) {
        return res.status(400).json({ message: 'Password is required to delete account' });
      }
      if (!(await user.comparePassword(password))) {
        return res.status(401).json({ message: 'Password is incorrect' });
      }
    }

    await User.findByIdAndDelete(user._id);
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error.message);
    res.status(500).json({ message: 'Error deleting account' });
  }
});

// Like/Unlike a song
router.post('/like-song', authenticateToken, async (req, res) => {
  try {
    const { track, action } = req.body || {};
    if (!track || !track.id || !track.title) {
      return res.status(400).json({ message: 'Invalid track data' });
    }
    if (action !== 'like' && action !== 'unlike') {
      return res.status(400).json({ message: "action must be 'like' or 'unlike'" });
    }

    const user = req.user;

    if (action === 'like') {
      if (!user.likedSongs.some((song) => song.id === track.id)) {
        // Newest first.
        user.likedSongs.unshift({
          id: track.id,
          title: track.title,
          image: track.image,
          audioUrl: track.audioUrl,
          artwork: track.artwork || {},
          user: {
            id: track.user?.id,
            name: track.user?.name,
            handle: track.user?.handle,
            profile_picture: track.user?.profile_picture || {},
          },
          duration: track.duration,
          genre: track.genre,
          mood: track.mood,
          release_date: track.release_date,
          repost_count: track.repost_count,
          favorite_count: track.favorite_count,
          play_count: track.play_count,
          permalink: track.permalink,
          source: track.source,
          url: track.url,
          addedAt: new Date(),
        });
      }
    } else {
      user.likedSongs = user.likedSongs.filter((song) => song.id !== track.id);
    }

    await user.save();
    res.json({ likedSongs: formatLikedSongs(user.likedSongs) });
  } catch (error) {
    console.error('Like/Unlike error:', error.message);
    res.status(500).json({ message: 'Error updating liked songs' });
  }
});

// Get liked songs
router.get('/liked-songs', authenticateToken, (req, res) => {
  res.json({ likedSongs: formatLikedSongs(req.user.likedSongs) });
});

// Firebase sign-in. The client authenticates with Firebase (email/password,
// Google, Apple) and posts the resulting ID token here; we verify it and hand
// back this app's own JWT, so every other route keeps working unchanged.
router.post('/firebase', credentialLimiter, async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ message: 'idToken is required' });

    let claims;
    try {
      claims = await verifyFirebaseIdToken(idToken);
    } catch (error) {
      if (error.code === 'firebase/not-configured') {
        console.error('Firebase sign-in attempted but FIREBASE_PROJECT_ID is unset');
        return res.status(503).json({ message: 'Firebase sign-in is not configured on the server' });
      }
      return res.status(401).json({ message: 'Invalid or expired Firebase token' });
    }

    if (!claims.email) {
      return res.status(400).json({ message: 'This sign-in method did not provide an email address' });
    }

    // Match on uid first, then fall back to email so accounts that predate
    // Firebase (or were created with a different provider) link up instead of
    // silently becoming a duplicate profile.
    let user = await User.findOne({ firebaseUid: claims.uid });
    if (!user) {
      user = await User.findOne({ email: claims.email });
    }

    if (!user) {
      user = new User({
        email: claims.email,
        name: claims.name || claims.email.split('@')[0],
        profilePicture: claims.picture || '',
        firebaseUid: claims.uid,
        isGoogleUser: claims.provider === 'google.com',
      });
    } else {
      if (!user.firebaseUid) user.firebaseUid = claims.uid;
      // Only fill gaps -- never overwrite a name or picture the user has set here.
      if (!user.name && claims.name) user.name = claims.name;
      if (!user.profilePicture && claims.picture) user.profilePicture = claims.picture;
      if (claims.provider === 'google.com') user.isGoogleUser = true;
    }

    if (!user.settings) user.settings = {};
    if (!user.settings.connectedAccounts) user.settings.connectedAccounts = {};
    if (claims.provider === 'google.com') user.settings.connectedAccounts.google = true;

    await user.save();

    res.json({ token: signToken(user._id), user: formatUserResponse(user) });
  } catch (error) {
    console.error('Firebase sign-in error:', error.message);
    res.status(500).json({ message: 'Error signing in' });
  }
});

// Google sign-in via ID token (from Google Identity Services)
router.post('/google', credentialLimiter, async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ message: 'idToken is required' });

    const googleResp = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!googleResp.ok) {
      return res.status(401).json({ message: 'Invalid Google token' });
    }
    const payload = await googleResp.json();

    if (process.env.GOOGLE_CLIENT_ID && payload.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(401).json({ message: 'Invalid token audience' });
    }
    if (!payload.email || payload.email_verified === 'false') {
      return res.status(401).json({ message: 'Google account email is not verified' });
    }

    const email = String(payload.email).toLowerCase();
    const name = payload.name || email.split('@')[0];

    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        email,
        password: crypto.randomUUID(), // unusable; Google users sign in via ID token
        name,
        profilePicture: payload.picture || '',
        isGoogleUser: true,
      });
      await user.save();
    } else if (!user.settings?.connectedAccounts?.google) {
      if (!user.settings) user.settings = {};
      if (!user.settings.connectedAccounts) user.settings.connectedAccounts = {};
      user.settings.connectedAccounts.google = true;
      user.isGoogleUser = true;
      await user.save();
    }

    res.json({ token: signToken(user._id), user: formatUserResponse(user) });
  } catch (error) {
    console.error('Google signin error:', error.message);
    res.status(500).json({ message: 'Error signing in with Google' });
  }
});
