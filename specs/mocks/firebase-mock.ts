/**
 * In-memory Mock for Firebase App, Auth, and Firestore.
 * Used for testing auth.js, sync.js, and app.js in headless Node / Happy-DOM environments.
 */

export const mockFirestoreData = new Map<string, any>();
export let mockAuthCurrentUser: any = null;
const authListeners = new Set<(user: any) => void>();

export function setMockAuthUser(user: any) {
  mockAuthCurrentUser = user;
  authListeners.forEach((fn) => {
    try {
      fn(user);
    } catch {}
  });
}

export function resetMockFirebase() {
  mockFirestoreData.clear();
  mockAuthCurrentUser = null;
  authListeners.clear();
}

export const firebaseConfig = {
  apiKey: 'MOCK_API_KEY',
  authDomain: 'hot-tub-spelling-0.firebaseapp.com',
  projectId: 'hot-tub-spelling-0',
  storageBucket: 'hot-tub-spelling-0.firebasestorage.app',
  messagingSenderId: '1042820602560',
  appId: '1:1042820602560:web:mock',
  measurementId: 'G-MOCK'
};

export const app = { name: '[DEFAULT]', options: firebaseConfig };

export function initializeApp() {
  return app;
}

export const auth = {
  get currentUser() {
    return mockAuthCurrentUser;
  }
};

export function getAuth() {
  return auth;
}

export class GoogleAuthProvider {
  params: any = {};
  setCustomParameters(p: any) {
    this.params = p;
  }
}

export const browserLocalPersistence = 'LOCAL';

export async function setPersistence(_auth: any, _persistence: any) {
  return Promise.resolve();
}

export async function signInWithPopup(_auth: any, _provider: any) {
  if (!mockAuthCurrentUser) {
    throw new Error('Mock signInWithPopup: No user configured');
  }
  return { user: mockAuthCurrentUser };
}

export async function signInWithRedirect() {
  return Promise.resolve();
}

export async function getRedirectResult() {
  return Promise.resolve(mockAuthCurrentUser ? { user: mockAuthCurrentUser } : null);
}

export function onAuthStateChanged(_auth: any, callback: (user: any) => void) {
  authListeners.add(callback);
  // Initial fire
  setTimeout(() => callback(mockAuthCurrentUser), 0);
  return () => authListeners.delete(callback);
}

export async function fbSignOut(_auth: any) {
  mockAuthCurrentUser = null;
  authListeners.forEach((fn) => fn(null));
  return Promise.resolve();
}

export const signOut = fbSignOut;

export const db = { type: 'firestore', app };

export function initializeFirestore() {
  return db;
}

export function getFirestore() {
  return db;
}

export function persistentLocalCache() {
  return {};
}

export function collection(_db: any, path: string) {
  return { path, type: 'collection' };
}

export function doc(_db: any, colOrPath: string | any, id?: string) {
  let fullPath = '';
  if (typeof colOrPath === 'string') {
    fullPath = id ? `${colOrPath}/${id}` : colOrPath;
  } else if (colOrPath && colOrPath.path) {
    fullPath = `${colOrPath.path}/${id}`;
  }
  return { path: fullPath, id: id || fullPath.split('/').pop(), type: 'document' };
}

export async function getDoc(docRef: any) {
  const data = mockFirestoreData.get(docRef.path);
  return {
    id: docRef.id,
    exists: () => data !== undefined,
    data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined)
  };
}

export async function getDocs(query: any) {
  const prefix = query.path ? `${query.path}/` : '';
  const docs: any[] = [];
  for (const [key, val] of mockFirestoreData.entries()) {
    if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
      const docId = key.slice(prefix.length);
      docs.push({
        id: docId,
        exists: () => true,
        data: () => JSON.parse(JSON.stringify(val))
      });
    }
  }
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: (callback: (doc: any) => void) => docs.forEach(callback)
  };
}

function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return source;
  }
  const result = { ...(target || {}) };
  for (const key of Object.keys(source)) {
    const sVal = source[key];
    const tVal = result[key];
    if (sVal && typeof sVal === 'object' && !Array.isArray(sVal)) {
      if (Object.keys(sVal).length === 0) {
        result[key] = {};
      } else {
        result[key] = deepMerge(tVal, sVal);
      }
    } else {
      result[key] = sVal;
    }
  }
  return result;
}

export async function setDoc(docRef: any, data: any, options?: { merge?: boolean }) {
  if (options?.merge && mockFirestoreData.has(docRef.path)) {
    const existing = mockFirestoreData.get(docRef.path) || {};
    mockFirestoreData.set(docRef.path, deepMerge(existing, JSON.parse(JSON.stringify(data))));
  } else {
    mockFirestoreData.set(docRef.path, JSON.parse(JSON.stringify(data)));
  }
  return Promise.resolve();
}

export async function deleteDoc(docRef: any) {
  mockFirestoreData.delete(docRef.path);
  return Promise.resolve();
}

export function writeBatch(_db: any) {
  const operations: Array<() => void> = [];
  return {
    set(docRef: any, data: any, options?: { merge?: boolean }) {
      operations.push(() => {
        if (options?.merge && mockFirestoreData.has(docRef.path)) {
          const existing = mockFirestoreData.get(docRef.path) || {};
          mockFirestoreData.set(docRef.path, deepMerge(existing, JSON.parse(JSON.stringify(data))));
        } else {
          mockFirestoreData.set(docRef.path, JSON.parse(JSON.stringify(data)));
        }
      });
    },
    delete(docRef: any) {
      operations.push(() => {
        mockFirestoreData.delete(docRef.path);
      });
    },
    async commit() {
      operations.forEach((op) => op());
      return Promise.resolve();
    }
  };
}
