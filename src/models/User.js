import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Common track schema for reuse
const trackSchema = {
  id: { type: String, required: true },
  title: { type: String, required: true },
  artwork: {
    '480x480': String,
    '150x150': String,
    '1000x1000': String
  },
  user: {
    id: String,
    name: String,
    handle: String,
    profile_picture: {
      '150x150': String,
      '480x480': String,
      '1000x1000': String
    }
  },
  duration: Number,
  genre: String,
  mood: String,
  release_date: String,
  repost_count: Number,
  favorite_count: Number,
  play_count: Number,
  permalink: String,
  source: String, // for Audius or JioSaavn
  url: String,    // for JioSaavn direct stream
  addedAt: { type: Date, default: Date.now }
};

const externalArtistSchema = {
  platform: { type: String, required: true }, // e.g., 'audius'
  id: { type: String, required: true },
  name: String,
  handle: String,
  profilePicture: {
    '150x150': String,
    '480x480': String,
    '1000x1000': String
  },
  followedAt: { type: Date, default: Date.now }
};

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    name: {
      type: String,
      trim: true,
    },
    profilePicture: {
      type: String,
      default: '',
    },
    externalFollowing: {
      type: [externalArtistSchema],
      default: []
    },
    likedSongs: {
      type: [trackSchema],
      default: [],
    },
    playlists: [{
      name: { type: String, required: true },
      description: { type: String, default: '' },
      coverImage: { type: String, default: '' },
      tracks: {
        type: [trackSchema],
        default: [],
      },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now }
    }],
    recentlyPlayed: {
      type: [{
        track: trackSchema,
        playedAt: { type: Date, default: Date.now }
      }],
      default: [],
      validate: [arrayLimit, '{PATH} exceeds the limit of 50']
    },
    isGoogleUser: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Validate array length for recently played
function arrayLimit(val) {
  return val.length <= 50;
}

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

const User = mongoose.model('User', userSchema);

export default User; 