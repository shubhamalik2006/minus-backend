'use strict';
// Computer players. Used for empty seats and when a player runs out of time.
const R = require('./rules');

function bestSuit(hand) {
  let bs = 'S', bv = -1;
  for (const s of R.SUITS) {
    const cs = hand.filter((c) => c.s === s);
    const v = cs.length * 1.2 + cs.filter((c) => c.r >= 12).length;
    if (v > bv) { bv = v; bs = s; }
  }
  return bs;
}

// Rough count of tricks a hand should take.
function estimate(hand, trump) {
  let e = 0;
  const n = {};
  hand.forEach((c) => { n[c.s] = (n[c.s] || 0) + 1; });
  for (const c of hand) {
    if (trump && c.s === trump) e += c.r >= 12 ? 1 : c.r >= 10 ? 0.5 : (n[trump] >= 4 ? 0.4 : 0);
    else if (c.r === 14) e += n[c.s] <= 5 ? 1 : 0.7;
    else if (c.r === 13) e += (n[c.s] >= 2 && n[c.s] <= 4) ? 0.7 : 0.3;
    else if (c.r === 12 && n[c.s] >= 3 && n[c.s] <= 4) e += 0.25;
  }
  if (trump) for (const s of R.SUITS) if (s !== trump && !n[s] && (n[trump] || 0) >= 2) e += 0.6;
  return e;
}

function aiBid(hand, trump) {
  return Math.max(R.MIN_BID, Math.min(R.MAX_BID, Math.round(estimate(hand, trump))));
}

// Returns a number to bid, or null to pass.
function aiAuction(hand5, auction, minBid) {
  if (auction.highSeat == null) return minBid; // opener must bid
  if (minBid > R.MAX_BID) return null;
  const s = bestSuit(hand5);
  const count = hand5.filter((c) => c.s === s).length;
  const projected = estimate(hand5, s) * 2.3 + count * 0.6;
  return projected >= minBid ? minBid : null;
}

function aiChoose(hand, trick, trump, strict) {
  const L = R.legalCards(hand, trick, trump, strict);
  const ord = (a, b) => ((a.s === trump) - (b.s === trump)) * 100 + a.r - b.r;
  if (!trick.length) {
    const ace = L.find((c) => c.r === 14 && c.s !== trump);
    return ace || [...L].sort(ord)[0];
  }
  const best = R.bestOf(trick, trump).card;
  const win = L.filter((c) => R.beats(c, best, trump)).sort(ord);
  const lose = L.filter((c) => !R.beats(c, best, trump)).sort(ord);
  if (win.length) {
    if (trick.length === 3) return win[0];
    const nonTrump = win.filter((c) => c.s !== trump);
    return nonTrump.length ? nonTrump[nonTrump.length - 1] : win[0];
  }
  return lose[0];
}

module.exports = { bestSuit, estimate, aiBid, aiAuction, aiChoose };
