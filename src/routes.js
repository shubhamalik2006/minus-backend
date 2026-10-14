'use strict';
const express = require('express');
const { httpAuth } = require('./auth');
const R = require('./game/rules');

module.exports = function routes(store) {
  const r = express.Router();

  // Public: what the lobby can offer.
  r.get('/rules', (req, res) => res.json({
    defaults: R.DEFAULT_RULES,
    trumpModes: R.TRUMP_MODES,
    minBid: R.MIN_BID,
    maxBid: R.MAX_BID,
    auctionMin: R.AUCTION_MIN,
    target: { min: R.TARGET_MIN, max: R.TARGET_MAX, presets: [31, 51, 61, 71, 101] },
  }));

  // Everything below needs a signed-in player.
  r.use(httpAuth(store));

  r.get('/me', (req, res) => res.json({ user: req.user }));

  r.patch('/me', async (req, res, next) => {
    try {
      const name = String(req.body?.displayName ?? '').trim();
      if (name.length < 1 || name.length > 20) {
        return res.status(400).json({ error: 'BAD_NAME', message: 'Name must be 1 to 20 characters.' });
      }
      res.json({ user: await store.setDisplayName(req.user.id, name) });
    } catch (e) { next(e); }
  });

  r.get('/me/stats', async (req, res, next) => {
    try { res.json({ stats: await store.getStats(req.user.id) }); } catch (e) { next(e); }
  });

  r.get('/leaderboard', async (req, res, next) => {
    try { res.json({ leaderboard: await store.leaderboard(20) }); } catch (e) { next(e); }
  });

  return r;
};
