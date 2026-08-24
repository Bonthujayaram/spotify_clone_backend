import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Common track schema for reuse
const trackSchema = {
  id: { type: String, required: true },
  title: { type: String, required: true },
  image: String, // primary artwork url (e.g., JioSaavn image)
  audioUrl: String,
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
  source: String, // source platform, e.g. 'jiosaavn'
  url: String,    // for JioSaavn direct stream
  addedAt: { type: Date, default: Date.now }
};

const externalArtistSchema = {
  platform: { type: String, default: 'external' }, // source platform, e.g., 'jiosaavn' or other
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

const creatorDailyStatSchema = {
  date: { type: String, required: true },
  plays: { type: Number, default: 0 },
  completePlays: { type: Number, default: 0 },
  listenSeconds: { type: Number, default: 0 },
};

const creatorTrackSchema = {
  id: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  genre: { type: String, default: '' },
  tags: { type: [String], default: [] },
  isPublic: { type: Boolean, default: true },
  coverImage: { type: String, default: '' },
  audioUrl: { type: String, required: true },
  mimeType: { type: String, default: 'audio/mpeg' },
  sizeBytes: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now },
  stats: {
    plays: { type: Number, default: 0 },
    completePlays: { type: Number, default: 0 },
    skips: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    totalListenSeconds: { type: Number, default: 0 },
    lastPlayedAt: { type: Date, default: null },
  },
  dailyStats: {
    type: [creatorDailyStatSchema],
    default: [],
  },
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
    following: {
      type: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      }],
      default: [],
    },
    followers: {
      type: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      }],
      default: [],
    },
    settings: {
      audioQuality: {
        type: String,
        enum: ['auto', 'low', 'medium', 'high'],
        default: 'auto',
      },
      autoplay: {
        type: Boolean,
        default: true,
      },
      accountPrivacy: {
        type: String,
        enum: ['public', 'friends', 'private'],
        default: 'friends',
      },
      notifications: {
        type: String,
        enum: ['all', 'push_email', 'push', 'email', 'none'],
        default: 'push_email',
      },
      connectedAccounts: {
        google: {
          type: Boolean,
          default: false,
        },
      },
    },
    externalFollowing: {
      type: [externalArtistSchema],
      default: []
    },
    likedSongs: {
      type: [trackSchema],
      default: [],
    },
    creatorTracks: {
      type: [creatorTrackSchema],
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
  if (!this.settings) this.settings = {};
  if (!this.settings.connectedAccounts) this.settings.connectedAccounts = {};
  if (this.isGoogleUser) {
    this.settings.connectedAccounts.google = true;
  }

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
