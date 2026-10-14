'use strict';
// Sign-in: the app signs players in with Firebase Authentication (Google, Apple or phone OTP)
// and sends the Firebase ID token. The server verifies it here and never sees passwords or OTPs.
const config = require('./config');

let admin = null;
function firebase() {
  if (admin) return admin;
  const fa = require('firebase-admin');
  const { projectId, clientEmail, privateKey } = config.firebase;
  if (projectId && clientEmail && privateKey) {
    fa.initializeApp({ credential: fa.credential.cert({ projectId, clientEmail, privateKey }) });
  } else {
    fa.initializeApp(); // falls back to GOOGLE_APPLICATION_CREDENTIALS
  }
  admin = fa;
  return admin;
}

function authError(message) {
  const e = new Error(message);
  e.code = 'UNAUTHENTICATED';
  return e;
}

async function verifyToken(token) {
  if (!token || typeof token !== 'string') throw authError('Missing sign-in token');

  // Local testing only: token "dev:<id>:<name>". Refused in production (see config.js).
  if (config.devAuth && token.startsWith('dev:')) {
    const [, id, name = 'Player'] = token.split(':');
    if (!id) throw authError('Bad dev token');
    return { uid: `dev_${id}`, provider: 'dev', displayName: name.slice(0, 20), phone: null, email: null };
  }

  const d = await firebase().auth().verifyIdToken(token, true);
  const provider = (d.firebase?.sign_in_provider || 'unknown').replace('.com', ''); // google, apple, phone
  const fallback = d.phone_number ? `Player ${d.phone_number.slice(-4)}` : 'Player';
  return {
    uid: d.uid,
    provider,
    displayName: String(d.name || fallback).slice(0, 20),
    phone: d.phone_number || null,
    email: d.email || null,
  };
}

function httpAuth(store) {
  return async (req, res, next) => {
    try {
      const h = req.headers.authorization || '';
      const identity = await verifyToken(h.startsWith('Bearer ') ? h.slice(7) : null);
      req.user = await store.upsertUser(identity);
      next();
    } catch {
      res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Sign in again to continue.' });
    }
  };
}

function socketAuth(store) {
  return async (socket, next) => {
    try {
      const identity = await verifyToken(socket.handshake.auth?.token);
      socket.data.user = await store.upsertUser(identity);
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  };
}

module.exports = { verifyToken, httpAuth, socketAuth };
