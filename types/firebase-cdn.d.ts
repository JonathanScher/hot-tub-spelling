declare module 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js' {
  export function initializeApp(config: Record<string, any>): any;
}

declare module 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js' {
  export function getAuth(app?: any): any;
  export class GoogleAuthProvider {
    setCustomParameters(params: Record<string, any>): void;
  }
  export function signInWithPopup(auth: any, provider: any): Promise<any>;
  export function signInWithRedirect(auth: any, provider: any): Promise<any>;
  export function getRedirectResult(auth: any): Promise<any>;
  export function onAuthStateChanged(auth: any, cb: (user: any) => void): () => void;
  export function signOut(auth: any): Promise<void>;
  export function setPersistence(auth: any, persistence: any): Promise<void>;
  export const browserLocalPersistence: any;
}

declare module 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js' {
  export function initializeFirestore(app: any, settings?: Record<string, any>): any;
  export function getFirestore(app?: any): any;
  export function persistentLocalCache(settings?: Record<string, any>): any;
  export function collection(db: any, path: string, ...pathSegments: string[]): any;
  export function doc(db: any, path: string, ...pathSegments: string[]): any;
  export function getDoc(ref: any): Promise<any>;
  export function getDocs(query: any): Promise<any>;
  export function setDoc(ref: any, data: any, options?: any): Promise<void>;
  export function deleteDoc(ref: any): Promise<void>;
  export function writeBatch(db: any): {
    set(ref: any, data: any, options?: any): void;
    update(ref: any, data: any): void;
    delete(ref: any): void;
    commit(): Promise<void>;
  };
}
