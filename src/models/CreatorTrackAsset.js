import mongoose from 'mongoose';

const creatorTrackAssetSchema = new mongoose.Schema(
  {
    trackId: { type: String, required: true, unique: true, index: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    audioBuffer: { type: Buffer, required: true },
    mimeType: { type: String, default: 'audio/mpeg' },
    sizeBytes: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

const CreatorTrackAsset = mongoose.model('CreatorTrackAsset', creatorTrackAssetSchema);

export default CreatorTrackAsset;
