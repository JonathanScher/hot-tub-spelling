/**
 * Google Identity Services (GIS) Authentication & Family Allowlist Gate
 *
 * Features:
 * - Gates game access on the Welcome screen using Google Sign-In (OAuth 2.0 Web Client ID).
 * - Restricts access to the family email allowlist (stored as SHA-256 hashes + optional parent additions).
 * - Persists verified login sessions in localStorage so a child's tablet stays signed in across sessions
 *   (including offline play after initial sign-in).
 */

export const GOOGLE_CLIENT_ID =
  '184637909898-fn9mmeq70sbdfn78u5890hbd3df2nksp.apps.googleusercontent.com';

const AUTH_SESSION_STORAGE_KEY = 'hottub_google_auth_session_v1';
const EXTRA_ALLOWED_EMAILS_KEY = 'hottub_extra_allowed_emails_v1';

/**
 * SHA-256 hashes of the default authorized family email addresses (trimmed & lowercased):
 * - scher.jonathan@gmail.com
 * - williams.evamary@gmail.com
 * - jonathan.scher.office@gmail.com
 */
const DEFAULT_ALLOWED_EMAIL_HASHES = new Set([
  '0ea5a47b28e11f6f02f6585cc6df42e4488e6793505f85911245b71cc1217b21',
  'f0dd963b08241ce2eba75d86e63f3e27f2f2185fdc585577e5379ced119915f0',
  '3b134eab7a36f8af11346f89b33768868431deb1af084dffcc7f40791c8773cb'
]);

const DEFAULT_ALLOWED_LABELS = [
  'scher.jonathan@gmail.com',
  'williams.evamary@gmail.com',
  'jonathan.scher.office@gmail.com'
];

class AuthManager {
  constructor() {
    this.session = this._loadSession();
    this.listeners = new Set();
    this.gisInitialized = false;
    this.gisLoadError = false;
  }

  /**
   * Subscribe to auth state changes: listener(session, errorInfo)
   */
  onAuthChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _emitChange(errorInfo = null) {
    for (const fn of this.listeners) {
      try {
        fn(this.session, errorInfo);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Returns the current authenticated user session if signed in and still on the allowlist.
   */
  getSession() {
    if (this.session && this.session.email) {
      if (!this.isEmailAllowed(this.session.email)) {
        this.signOut({ silent: true });
        return null;
      }
      return this.session;
    }
    return null;
  }

  isAuthenticated() {
    return Boolean(this.getSession());
  }

  /**
   * Normalizes an email address for allowlist comparison.
   */
  normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  /**
   * Checks whether an email address matches the built-in family allowlist (via SHA-256)
   * or any additional emails added in the Parent Dashboard.
   */
  isEmailAllowed(email) {
    const clean = this.normalizeEmail(email);
    if (!clean || !clean.includes('@')) return false;

    const hash = sha256Hex(clean);
    if (DEFAULT_ALLOWED_EMAIL_HASHES.has(hash)) {
      return true;
    }

    const extra = this.getExtraAllowedEmails();
    return extra.includes(clean);
  }

  getDefaultAllowedEmails() {
    return [...DEFAULT_ALLOWED_LABELS];
  }

  getExtraAllowedEmails() {
    try {
      const raw = localStorage.getItem(EXTRA_ALLOWED_EMAILS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map((e) => this.normalizeEmail(e)).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }

  addExtraAllowedEmail(email) {
    const clean = this.normalizeEmail(email);
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      return { ok: false, error: 'Please enter a valid email address.' };
    }
    if (this.isEmailAllowed(clean)) {
      return { ok: true, alreadyAllowed: true, email: clean };
    }
    const current = this.getExtraAllowedEmails();
    current.push(clean);
    try {
      localStorage.setItem(EXTRA_ALLOWED_EMAILS_KEY, JSON.stringify(current));
    } catch {
      // Ignore storage errors
    }
    return { ok: true, email: clean };
  }

  removeExtraAllowedEmail(email) {
    const clean = this.normalizeEmail(email);
    const filtered = this.getExtraAllowedEmails().filter((e) => e !== clean);
    try {
      localStorage.setItem(EXTRA_ALLOWED_EMAILS_KEY, JSON.stringify(filtered));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Initializes Google Identity Services and renders the Sign-In button into `buttonContainer`.
   */
  initGoogleIdentity(buttonContainer) {
    let attempts = 0;
    const maxAttempts = 25; // Wait up to ~5s if script is still loading

    const tryInit = () => {
      if (typeof window !== 'undefined' && window.google && window.google.accounts && window.google.accounts.id) {
        if (!this.gisInitialized) {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: (response) => this._handleCredentialResponse(response),
            auto_select: true,
            cancel_on_tap_outside: true
          });
          this.gisInitialized = true;
        }

        if (buttonContainer) {
          this.renderButton(buttonContainer);
        }

        // If not yet signed in on this device, offer One Tap prompt as well
        if (!this.isAuthenticated()) {
          try {
            window.google.accounts.id.prompt();
          } catch {
            // Ignore One Tap prompt suppression
          }
        }
        return;
      }

      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(tryInit, 200);
      } else {
        this.gisLoadError = true;
        this._emitChange({
          type: 'sdk_unavailable',
          message:
            navigator.onLine === false
              ? 'Offline — connect to the internet once to sign in with Google.'
              : 'Google Sign-In could not be loaded. Please check your connection or ad-blocker.'
        });
      }
    };

    tryInit();
  }

  renderButton(container) {
    if (!container) return;
    if (!(typeof window !== 'undefined' && window.google && window.google.accounts && window.google.accounts.id)) {
      return;
    }
    container.innerHTML = '';
    try {
      window.google.accounts.id.renderButton(container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        logo_alignment: 'left',
        width: 260
      });
    } catch (err) {
      console.warn('Error rendering Google Sign-In button:', err);
    }
  }

  /**
   * Validates the Google ID Token (JWT) returned by Google Identity Services.
   */
  _handleCredentialResponse(response) {
    if (!response || !response.credential) {
      this._emitChange({
        type: 'invalid_credential',
        message: 'Sign-in cancelled or failed. Please try again.'
      });
      return;
    }

    try {
      const payload = decodeJwtPayload(response.credential);
      if (!payload) {
        throw new Error('Could not decode Google credential.');
      }

      // Verify audience & issuer
      if (payload.aud !== GOOGLE_CLIENT_ID) {
        throw new Error('Credential audience mismatch.');
      }
      if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') {
        throw new Error('Credential issuer mismatch.');
      }
      if (!payload.email || payload.email_verified === false) {
        throw new Error('Google account email is not verified.');
      }

      const email = this.normalizeEmail(payload.email);

      // Verify against family allowlist
      if (!this.isEmailAllowed(email)) {
        if (window.google && window.google.accounts && window.google.accounts.id) {
          try {
            window.google.accounts.id.disableAutoSelect();
          } catch {
            // Ignore
          }
        }
        this._emitChange({
          type: 'unauthorized_email',
          email,
          message: `Access restricted: "${email}" is not on the authorized family list.`
        });
        return;
      }

      const sessionData = {
        sub: String(payload.sub || ''),
        email,
        name: String(payload.name || email.split('@')[0]),
        givenName: String(payload.given_name || payload.name || email.split('@')[0]),
        picture: String(payload.picture || ''),
        idToken: String(response.credential),
        signedInAt: new Date().toISOString()
      };

      this.session = sessionData;
      this._saveSession(sessionData);
      this._emitChange(null);
    } catch (err) {
      this._emitChange({
        type: 'auth_error',
        message: String(err && err.message ? err.message : 'Authentication error')
      });
    }
  }

  /**
   * Signs out the current user on this device and disables GIS auto-select.
   */
  signOut({ silent = false } = {}) {
    this.session = null;
    try {
      localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    } catch {
      // Ignore
    }

    if (typeof window !== 'undefined' && window.google && window.google.accounts && window.google.accounts.id) {
      try {
        window.google.accounts.id.disableAutoSelect();
      } catch {
        // Ignore
      }
    }

    if (!silent) {
      this._emitChange(null);
    }
  }

  _loadSession() {
    try {
      const raw = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.email) return null;
      if (!this.isEmailAllowed(parsed.email)) {
        localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  _saveSession(session) {
    try {
      localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Ignore storage quota errors
    }
  }
}

/**
 * Decodes a Base64URL-encoded JWT payload segment into a JSON object.
 */
function decodeJwtPayload(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length < 2) return null;
  const base64Url = parts[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const jsonStr = new TextDecoder().decode(bytes);
  return JSON.parse(jsonStr);
}

/**
 * Pure client-side synchronous SHA-256 implementation (FIPS 180-4).
 * Works across all browsers and contexts (including non-HTTPS local LAN testing on tablets).
 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotr(n, x) {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Hex(asciiStr) {
  const msgBytes = new TextEncoder().encode(String(asciiStr || ''));
  const bitLen = msgBytes.length * 8;

  const totalLen = (((msgBytes.length + 8) >>> 6) + 1) << 6;
  const buf = new Uint8Array(totalLen);
  buf.set(msgBytes);
  buf[msgBytes.length] = 0x80;

  const view = new DataView(buf.buffer);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

export const authManager = new AuthManager();
