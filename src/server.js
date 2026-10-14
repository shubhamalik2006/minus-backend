'use strict';
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const { Server } = require('socket.io');

const config = require('./config');
const { createStore } = require('./db');
const { socketAuth } = require('./auth');
const routes = require('./routes');
const { RoomManager } = require('./rooms');

async function createServer(overrides = {}) {
  const store = overrides.store || createStore(config.databaseUrl);
  await store.init();

  const origin = config.corsOrigins.includes('*') ? true : config.corsOrigins;
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin }));
  app.use(express.json({ limit: '10kb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api', routes(store));
  app.use((req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Try again.' });
  });

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin } });
  const rooms = new RoomManager({
    io, store,
    botDelayMs: overrides.botDelayMs ?? config.botDelayMs,
    turnTimeoutMs: overrides.turnTimeoutMs ?? config.turnTimeoutMs,
    roundPauseMs: overrides.roundPauseMs ?? config.roundPauseMs,
  });

  io.use(socketAuth(store));
  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`u:${user.id}`);

    // Simple flood guard: at most 20 messages per second per connection.
    let windowStart = Date.now(), count = 0;
    const allowed = () => {
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; count = 0; }
      return ++count <= 20;
    };

    const handle = (fn) => async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!allowed()) return reply({ ok: false, error: 'SLOW_DOWN', message: 'Too many requests. Slow down.' });
      try {
        reply({ ok: true, ...(await fn(payload && typeof payload === 'object' ? payload : {})) });
      } catch (e) {
        if (e.expose) reply({ ok: false, error: e.code, message: e.message });
        else { console.error(e); reply({ ok: false, error: 'SERVER_ERROR', message: 'Something went wrong. Try again.' }); }
      }
    };

    socket.on('room:create', handle(({ rules }) => rooms.create(user, rules)));
    socket.on('room:join', handle(({ code }) => rooms.join(user, code)));
    socket.on('room:start', handle(({ code }) => rooms.start(user, code)));
    socket.on('room:leave', handle(({ code }) => rooms.leave(user, code)));
    socket.on('room:state', handle(({ code }) => rooms.stateFor(user, code)));
    socket.on('game:action', handle(({ code, action }) => rooms.act(user, code, action)));

    socket.on('disconnect', async () => {
      const others = await io.in(`u:${user.id}`).fetchSockets();
      if (!others.length) rooms.disconnected(user.id);
    });
  });

  return { app, server, io, rooms, store };
}

if (require.main === module) {
  createServer()
    .then(({ server }) => server.listen(config.port, () => console.log(`Minus server listening on port ${config.port}`)))
    .catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { createServer };
