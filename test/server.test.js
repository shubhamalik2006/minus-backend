'use strict';
// End-to-end: real server + real socket connection, one human seat (auto-played on timeout) and 3 bots.
process.env.DEV_AUTH = 'true';
process.env.DATABASE_URL = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../src/server');

test('a full game runs over sockets and is saved', async () => {
  const { server, rooms, store } = await createServer({ botDelayMs: 1, turnTimeoutMs: 5, roundPauseMs: 1 });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;

  const health = await fetch(`${url}/health`).then((r) => r.json());
  assert.equal(health.ok, true);
  const unauth = await fetch(`${url}/api/me`);
  assert.equal(unauth.status, 401);

  const socket = connect(url, { auth: { token: 'dev:alice:Alice' }, transports: ['websocket'] });
  const ask = (ev, data) => new Promise((r) => socket.emit(ev, data, r));
  try {
    const created = await ask('room:create', { rules: { target: 15, trump: 'bidder' } });
    assert.equal(created.ok, true, created.message);
    const code = created.state.code;
    assert.match(code, /^[A-Z2-9]{6}$/);

    const bad = await ask('room:create', { rules: { target: 2 } });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'BAD_RULES');

    let sawCardsOfOthers = false;
    const finished = new Promise((resolve) => {
      socket.on('room:state', ({ state }) => {
        const g = state.game;
        if (g && g.players.some((p, i) => i !== state.you && p.hand)) sawCardsOfOthers = true;
        if (state.status === 'finished') resolve(state);
      });
    });

    const started = await ask('room:start', { code });
    assert.equal(started.ok, true, started.message);

    const outOfTurn = await ask('game:action', { code, action: { type: 'bid', value: 99 } });
    assert.equal(outOfTurn.ok, false);

    const final = await finished;
    assert.equal(final.game.phase, 'gameOver');
    assert.equal(sawCardsOfOthers, false);
    await new Promise((r) => setTimeout(r, 20));
    const stats = await store.getStats('dev_alice');
    assert.equal(stats.gamesPlayed, 1);

    const me = await fetch(`${url}/api/me/stats`, { headers: { Authorization: 'Bearer dev:alice:Alice' } }).then((r) => r.json());
    assert.equal(me.stats.gamesPlayed, 1);
  } finally {
    socket.close();
    rooms.stop();
    await new Promise((r) => server.close(r));
  }
});
