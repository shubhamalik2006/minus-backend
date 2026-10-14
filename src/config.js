'use strict';
require('dotenv').config();

const bool = (v, d = false) => (v == null || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 8080),
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
  databaseUrl: process.env.DATABASE_URL || '',
  devAuth: bool(process.env.DEV_AUTH, false),
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
  botDelayMs: int(process.env.BOT_DELAY_MS, 900),
  turnTimeoutMs: int(process.env.TURN_TIMEOUT_MS, 30000),
  roundPauseMs: int(process.env.ROUND_PAUSE_MS, 5000),
};

if (config.env === 'production' && config.devAuth) {
  throw new Error('DEV_AUTH must be turned off in production');
}

module.exports = config;
