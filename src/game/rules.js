'use strict';
// Pure rules for Minus. No I/O here, so it is easy to test and reuse.
const crypto = require('crypto');

const SUITS = ['S', 'H', 'C', 'D'];
const MIN_BID = 1;
const MAX_BID = 10;
const AUCTION_MIN = 5;      // first player in a 5-card auction must open at 5+
const HAND_SIZE = 13;
const AUCTION_CARDS = 5;    // cards dealt before the trump auction
const TARGET_MIN = 10;
const TARGET_MAX = 500;
const TRUMP_MODES = ['spades', 'random', 'bidder', 'none']; // 'bidder' = 5-card auction

const DEFAULT_RULES = Object.freeze({ target: 51, trump: 'spades', strict: true, bigBid: false });

class RulesError extends Error {
  constructor(message) { super(message); this.code = 'BAD_RULES'; this.expose = true; }
}

function validateRules(input = {}) {
  if (input === null || typeof input !== 'object') throw new RulesError('Rules must be an object');
  const r = { ...DEFAULT_RULES };
  if (input.target !== undefined) {
    const t = Number(input.target);
    if (!Number.isInteger(t) || t < TARGET_MIN || t > TARGET_MAX) {
      throw new RulesError(`Target score must be a whole number from ${TARGET_MIN} to ${TARGET_MAX}`);
    }
    r.target = t;
  }
  if (input.trump !== undefined) {
    if (!TRUMP_MODES.includes(input.trump)) throw new RulesError(`Trump mode must be one of: ${TRUMP_MODES.join(', ')}`);
    r.trump = input.trump;
  }
  for (const k of ['strict', 'bigBid']) {
    if (input[k] !== undefined) {
      if (typeof input[k] !== 'boolean') throw new RulesError(`${k} must be true or false`);
      r[k] = input[k];
    }
  }
  return r;
}

// Cryptographically secure shuffle so deals can't be predicted.
const randInt = (n) => crypto.randomInt(n);

function newDeck() {
  const d = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ s, r });
  return d;
}

function shuffle(deck, rand = randInt) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const SORT = { S: 0, H: 1, C: 2, D: 3 };
const sortHand = (h) => h.sort((a, b) => SORT[a.s] - SORT[b.s] || b.r - a.r);
const sameCard = (a, b) => a.s === b.s && a.r === b.r;
const isCard = (c) => !!c && SUITS.includes(c.s) && Number.isInteger(c.r) && c.r >= 2 && c.r <= 14;

// Does card a beat card b? (b is always the current best: led suit or trump)
function beats(a, b, trump) {
  if (a.s === b.s) return a.r > b.r;
  return !!trump && a.s === trump;
}

// trick: [{seat, card}] -> the winning entry so far
function bestOf(trick, trump) {
  let best = trick[0];
  for (const t of trick.slice(1)) if (beats(t.card, best.card, trump)) best = t;
  return best;
}

// Which cards may be played from `hand` onto `trick`?
// strict = Call Break rule: beat the table if you can, trump when void if you can.
function legalCards(hand, trick, trump, strict) {
  if (!trick.length) return hand.slice();
  const led = trick[0].card.s;
  const best = bestOf(trick, trump).card;
  const follow = hand.filter((c) => c.s === led);
  if (follow.length) {
    if (strict && best.s === led) {
      const higher = follow.filter((c) => c.r > best.r);
      return higher.length ? higher : follow;
    }
    return follow;
  }
  if (trump && strict) {
    const trumps = hand.filter((c) => c.s === trump);
    if (trumps.length) {
      if (best.s === trump) {
        const over = trumps.filter((c) => c.r > best.r);
        return over.length ? over : hand.slice();
      }
      return trumps;
    }
  }
  return hand.slice();
}

// Minus scoring: make your bid -> +bid (extra tricks count for nothing).
// Miss it -> -bid. Optional big-bid bonus: make 8 or more -> 13.
function roundPoints(bid, won, rules) {
  if (won < bid) return -bid;
  if (rules.bigBid && bid >= 8) return 13;
  return bid;
}

module.exports = {
  SUITS, MIN_BID, MAX_BID, AUCTION_MIN, HAND_SIZE, AUCTION_CARDS, TARGET_MIN, TARGET_MAX,
  TRUMP_MODES, DEFAULT_RULES, RulesError, validateRules, randInt, newDeck, shuffle,
  sortHand, sameCard, isCard, beats, bestOf, legalCards, roundPoints,
};
