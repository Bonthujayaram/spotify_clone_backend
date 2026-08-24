import express from 'express';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Follow a user or external artist
router.post('/:userId', authenticateToken, async (req, res) => {
  try {
    const { artistData } = req.body;
    const currentUser = await User.findById(req.user.id);

    if (!currentUser) {
      return res.status(404).json({ message: 'Current user not found' });
    }

    // If artistData is provided, treat as external artist follow
    if (artistData && artistData.id) {
      const isAlreadyFollowing = currentUser.externalFollowing.some(
        (artist) => artist.id === String(artistData.id)
      );

      if (isAlreadyFollowing) {
        return res.status(400).json({ message: 'Already following this artist' });
      }

      currentUser.externalFollowing.push({
        platform: artistData.platform || 'external',
        id: String(artistData.id),
        name: artistData.name,
        handle: artistData.handle,
        profilePicture: artistData.profile_picture || {},
        followedAt: new Date(),
      });

      await currentUser.save();

      return res.json({
        message: 'Successfully followed artist',
        followersCount: artistData.follower_count || 0,
        followingCount: currentUser.following.length + currentUser.externalFollowing.length,
      });
    }

    // Otherwise, handle internal user follow
    const userToFollow = await User.findById(req.params.userId);

    if (!userToFollow) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (userToFollow._id.toString() === currentUser._id.toString()) {
      return res.status(400).json({ message: 'Cannot follow yourself' });
    }

    if (currentUser.following.includes(userToFollow._id)) {
      return res.status(400).json({ message: 'Already following this user' });
    }

    currentUser.following.push(userToFollow._id);
    userToFollow.followers.push(currentUser._id);

    await Promise.all([currentUser.save(), userToFollow.save()]);

    res.json({
      message: 'Successfully followed user',
      followersCount: userToFollow.followers.length,
      followingCount: currentUser.following.length + currentUser.externalFollowing.length,
    });
  } catch (error) {
    console.error('Error following user:', error);
    res.status(500).json({ message: 'Error following user' });
  }
});

// Unfollow a user or external artist
router.delete('/:userId', authenticateToken, async (req, res) => {
  try {
    const { platform } = req.query;
    const currentUser = await User.findById(req.user.id);

    if (!currentUser) {
      return res.status(404).json({ message: 'Current user not found' });
    }

    // If platform or explicit external flag is present, remove by external id
    if (platform || req.query.external) {
      currentUser.externalFollowing = currentUser.externalFollowing.filter(
        (artist) => artist.id !== req.params.userId
      );

      await currentUser.save();

      return res.json({
        message: 'Successfully unfollowed artist',
        followingCount: currentUser.following.length + currentUser.externalFollowing.length,
      });
    }

    // Handle internal user unfollow
    const userToUnfollow = await User.findById(req.params.userId);

    if (!userToUnfollow) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Remove from following and followers
    currentUser.following = currentUser.following.filter(
      id => id.toString() !== userToUnfollow._id.toString()
    );
    userToUnfollow.followers = userToUnfollow.followers.filter(
      id => id.toString() !== currentUser._id.toString()
    );

    await Promise.all([currentUser.save(), userToUnfollow.save()]);

    res.json({
      message: 'Successfully unfollowed user',
      followersCount: userToUnfollow.followers.length,
      followingCount: currentUser.following.length + currentUser.externalFollowing.length
    });
  } catch (error) {
    console.error('Error unfollowing user:', error);
    res.status(500).json({ message: 'Error unfollowing user' });
  }
});

// Get follow status and counts
router.get('/:userId/status', authenticateToken, async (req, res) => {
  try {
    const { platform } = req.query;
    const currentUser = await User.findById(req.user.id);

    if (!currentUser) {
      return res.status(404).json({ message: 'Current user not found' });
    }

    // If platform or external query present, check externalFollowing by id
    if (platform || req.query.external) {
      const isFollowing = currentUser.externalFollowing.some(
        (artist) => artist.id === req.params.userId
      );

      return res.json({
        isFollowing,
        followingCount: currentUser.following.length + currentUser.externalFollowing.length,
      });
    }

    // Handle internal user status check
    const userToCheck = await User.findById(req.params.userId);

    if (!userToCheck) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isFollowing = currentUser.following.includes(userToCheck._id);

    res.json({
      isFollowing,
      followersCount: userToCheck.followers.length,
      followingCount: currentUser.following.length + currentUser.externalFollowing.length
    });
  } catch (error) {
    console.error('Error getting follow status:', error);
    res.status(500).json({ message: 'Error getting follow status' });
  }
});

export default router; 