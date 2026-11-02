/**
 * Firebase Configuration & Modular SDK Initialization (v11 CDN ES Modules)
 * Project: hot-tub-spelling-0
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut as fbSignOut,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyBfioR4YmJM8b7CANtjpBegMB6OLYCCTL4',
  authDomain: 'hot-tub-spelling-0.firebaseapp.com',
  projectId: 'hot-tub-spelling-0',
  storageBucket: 'hot-tub-spelling-0.firebasestorage.app',
  messagingSenderId: '1042820602560',
  appId: '1:1042820602560:web:fbc00350256d28c1c7eb25',
  measurementId: 'G-QTX5S65GHT'
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {
  // Ignore persistence errors in restricted private browsing modes
});

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

let firestoreDb;
try {
  firestoreDb = initializeFirestore(app, {
    localCache: persistentLocalCache()
  });
} catch {
  firestoreDb = getFirestore(app);
}

export const db = firestoreDb;

export {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  fbSignOut,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch
};
