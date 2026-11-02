import mongoose from 'mongoose';

const getMongoUriAdvice = (uri) => {
  const value = String(uri || '').trim();

  if (!value) {
    return 'MONGODB_URI is not set. Copy .env.example to .env and provide a valid MongoDB connection string.';
  }

  if (value.startsWith('mongodb+srv://')) {
    return 'MongoDB Atlas SRV lookup failed. Copy the exact connection string from Atlas > Connect > Drivers and verify the cluster is reachable from this environment. A stale or wrong hostname is the usual cause of querySrv ENOTFOUND.';
  }

  if (value.startsWith('mongodb://')) {
    return 'MongoDB TCP connection failed. Check the host, port, username, password, and network access for the target database.';
  }

  return 'The MONGODB_URI format is invalid. Use a MongoDB connection string such as mongodb://host:27017/db or mongodb+srv://user:pass@host/db.';
};

const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.error(getMongoUriAdvice(mongoUri));
    return false;
  }

  mongoose.set('strictQuery', true);

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 15000,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return true;
  } catch (error) {
    console.error(`MongoDB connection failed: ${error.message}`);
    console.error(getMongoUriAdvice(mongoUri));
    return false;
  }
};

export default connectDB;
