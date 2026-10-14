'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, GameError } = require('../src/game/Game');
const R = require('../src/game/rules');

const bots = () => [0, 1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: true }));

// Play a whole game with computer moves, checking invariants along the way.
function playOut(rules) {
  const g = new Game({ players: bots(), rules });
  g.start();
  let steps = 0;
  while (g.phase !== 'gameOver') {
    if (++steps > 200000) throw new Error('game did not finish');
    if (g.phase === 'roundOver') {
      const totalWon = g.players.reduce((n, p) => n + p.won, 0);
      assert.equal(totalWon, 13, 'every round has 13 tricks');
      g.nextRound();
      continue;
    }
    const seat = g.actor;
    const before = g.phase;
    g.act(seat, g.botAction(seat));
    if (before === 'bidding' && g.phase === 'playing') {
      for (const p of g.players) assert.ok(p.bid >= R.MIN_BID && p.bid <= R.MAX_BID);
      for (const p of g.players) assert.equal(p.hand.length, 13);
    }
  }
  return g;
}

for (const trump of R.TRUMP_MODES) {
  test(`full game finishes with a single winner (trump: ${trump})`, () => {
    for (let i = 0; i < 5; i++) {
      const g = playOut({ trump, target: 31 });
      const top = Math.max(...g.players.map((p) => p.total));
      assert.ok(top >= 31);
      assert.equal(g.players[g.winnerSeat].total, top);
      assert.equal(g.players.filter((p) => p.total === top).length, 1);
      for (const h of g.history) for (const row of h.rows) {
        assert.equal(row.points, row.won >= row.bid ? row.bid : -row.bid);
      }
    }
  });
}

test('5-card auction: opener must bid at least 5, others must raise', () => {
  const g = new Game({ players: bots(), rules: { trump: 'bidder' } });
  g.start();
  assert.equal(g.phase, 'auction');
  for (const p of g.players) assert.equal(p.hand.length, 5);
  const opener = g.actor;
  assert.throws(() => g.act(opener, { type: 'auctionPass' }), (e) => e.code === 'MUST_OPEN');
  assert.throws(() => g.act(opener, { type: 'auctionBid', value: 4 }), (e) => e.code === 'BAD_BID');
  g.act(opener, { type: 'auctionBid', value: 5 });
  const next = g.actor;
  assert.throws(() => g.act(next, { type: 'auctionBid', value: 5 }), (e) => e.code === 'BAD_BID');
  g.act(next, { type: 'auctionBid', value: 6 });
  // everyone else passes
  while (g.phase === 'auction') g.act(g.actor, { type: 'auctionPass' });
  assert.equal(g.phase, 'trumpPick');
  assert.equal(g.picker, next);
  g.act(next, { type: 'chooseTrump', suit: 'H' });
  assert.equal(g.trump, 'H');
  assert.equal(g.players[next].bid, 6);
  for (const p of g.players) assert.equal(p.hand.length, 13);
  assert.equal(g.phase, 'bidding');
  while (g.phase === 'bidding') g.act(g.actor, { type: 'bid', value: 2 });
  assert.equal(g.actor, next, 'trump caller leads the first trick');
});

test('rejects out-of-turn, illegal and fake cards', () => {
  const g = new Game({ players: bots(), rules: {} });
  g.start();
  const notMe = (g.actor + 1) % 4;
  assert.throws(() => g.act(notMe, { type: 'bid', value: 3 }), GameError);
  assert.throws(() => g.act(g.actor, { type: 'bid', value: 11 }), (e) => e.code === 'BAD_BID');
  assert.throws(() => g.act(g.actor, { type: 'bid', value: 0 }), (e) => e.code === 'BAD_BID');
  while (g.phase === 'bidding') g.act(g.actor, { type: 'bid', value: 3 });
  const leader = g.actor;
  const other = g.players[(leader + 1) % 4].hand[0];
  assert.throws(() => g.act(leader, { type: 'play', card: other }), (e) => e.code === 'NOT_IN_HAND');
  assert.throws(() => g.act(leader, { type: 'play', card: { s: 'X', r: 99 } }), (e) => e.code === 'BAD_CARD');
});

test('a player view never contains other players’ cards', () => {
  const g = new Game({ players: bots(), rules: {} });
  g.start();
  const v = g.viewFor(1);
  assert.equal(v.hand.length, 13);
  assert.deepEqual(v.hand, g.players[1].hand);
  for (const p of v.players) assert.equal(p.hand, undefined);
  assert.ok(!JSON.stringify(v).includes('"rest"'));
});
