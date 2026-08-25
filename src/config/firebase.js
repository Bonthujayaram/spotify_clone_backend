import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Verifying an ID token only needs the project id -- the Admin SDK fetches
// Google's public signing certs itself. No service-account key, so there is no
// new secret to leak.
//
// Initialised lazily rather than at boot: if FIREBASE_PROJECT_ID is missing we
// want the one Firebase route to fail with a clear 503, not the whole server to
// crash-loop and take the rest of the API down with it.
let cachedAuth = null;

export const getFirebaseAuth = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) return null;

  if (!cachedAuth) {
    const app = getApps().find((a) => a.name === 'auth') ?? initializeApp({ projectId }, 'auth');
    cachedAuth = getAuth(app);
  }
  return cachedAuth;
};

/**
 * Verify a Firebase ID token and return the claims this app cares about.
 * Throws if the token is invalid, expired, or issued for another project.
 */
export const verifyFirebaseIdToken = async (idToken) => {
  const auth = getFirebaseAuth();
  if (!auth) {
    const error = new Error('FIREBASE_PROJECT_ID is not configured');
    error.code = 'firebase/not-configured';
    throw error;
  }

  const decoded = await auth.verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    email: decoded.email ? String(decoded.email).toLowerCase() : null,
    emailVerified: Boolean(decoded.email_verified),
    name: decoded.name || null,
    picture: decoded.picture || null,
    provider: decoded.firebase?.sign_in_provider || 'unknown',
  };
};
