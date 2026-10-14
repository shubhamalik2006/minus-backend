'use strict';
// One game of Minus: a server-authoritative state machine.
// Phases: new -> (auction -> trumpPick ->) bidding -> playing -> roundOver ... -> gameOver
const R = require('./rules');
const AI = require('./ai');

class GameError extends Error {
  constructor(code, message) { super(message); this.code = code; this.expose = true; }
}

class Game {
  constructor({ players, rules, rand = R.randInt, firstDealer = 3 }) {
    if (!Array.isArray(players) || players.length !== 4) throw new GameError('BAD_PLAYERS', 'A game needs exactly 4 players');
    this.rules = R.validateRules(rules);
    this.rand = rand;
    this.players = players.map((p) => ({
      id: p.id ?? null, name: String(p.name || 'Player').slice(0, 20), isBot: !!p.isBot,
      hand: [], rest: [], bid: null, won: 0, total: 0,
    }));
    this.phase = 'new';
    this.round = 0;
    this.dealer = firstDealer;
    this.history = [];
    this.trump = null;
    this.picker = null;
    this.auction = null;
    this.trick = [];
    this.lastTrick = null;
    this.turn = null;
    this.tricksDone = 0;
    this.winnerSeat = null;
    this.version = 0;
  }

  start() {
    if (this.phase !== 'new') throw new GameError('ALREADY_STARTED', 'The game has already started');
    this.round = 1;
    this._startRound();
    return [{ type: 'roundStarted', round: 1 }];
  }

  nextRound() {
    this._need('roundOver');
    this.round++;
    this.dealer = (this.dealer + 1) % 4;
    this._startRound();
    return [{ type: 'roundStarted', round: this.round }];
  }

  /** Seat whose move it is, or null when nobody needs to act. */
  get actor() {
    if (this.phase === 'trumpPick') return this.picker;
    if (['auction', 'bidding', 'playing'].includes(this.phase)) return this.turn;
    return null;
  }

  auctionMin() {
    return this.auction.highSeat == null ? R.AUCTION_MIN : this.auction.high + 1;
  }

  /** Apply a player's move. Throws GameError for anything invalid. Returns events. */
  act(seat, action) {
    if (!action || typeof action.type !== 'string') throw new GameError('BAD_ACTION', 'Missing action type');
    if (seat !== this.actor) throw new GameError('NOT_YOUR_TURN', 'It is not your turn');
    let events;
    switch (action.type) {
      case 'auctionBid': events = this._auctionBid(seat, action.value); break;
      case 'auctionPass': events = this._auctionPass(seat); break;
      case 'chooseTrump': events = this._chooseTrump(seat, action.suit); break;
      case 'bid': events = this._bid(seat, action.value); break;
      case 'play': events = this._play(seat, action.card); break;
      default: throw new GameError('BAD_ACTION', `Unknown action: ${action.type}`);
    }
    this.version++;
    return events;
  }

  /** The move a computer player would make for this seat right now. */
  botAction(seat) {
    const p = this.players[seat];
    switch (this.phase) {
      case 'auction': {
        const v = AI.aiAuction(p.hand, this.auction, this.auctionMin());
        return v == null ? { type: 'auctionPass' } : { type: 'auctionBid', value: v };
      }
      case 'trumpPick': return { type: 'chooseTrump', suit: AI.bestSuit(p.hand) };
      case 'bidding': return { type: 'bid', value: AI.aiBid(p.hand, this.trump) };
      case 'playing': return { type: 'play', card: AI.aiChoose(p.hand, this.trick, this.trump, this.rules.strict) };
      default: throw new GameError('WRONG_PHASE', 'No move is needed right now');
    }
  }

  legalFor(seat) {
    if (this.phase !== 'playing' || this.turn !== seat) return [];
    return R.legalCards(this.players[seat].hand, this.trick, this.trump, this.rules.strict);
  }

  /** What one seat is allowed to see. Other players' cards are never included. */
  viewFor(seat) {
    const me = seat != null ? this.players[seat] : null;
    return {
      phase: this.phase,
      round: this.round,
      dealer: this.dealer,
      rules: { ...this.rules, minBid: R.MIN_BID, maxBid: R.MAX_BID, auctionMin: R.AUCTION_MIN },
      trump: this.trump,
      turn: this.actor,
      picker: this.picker,
      auction: this.auction ? {
        high: this.auction.high, highSeat: this.auction.highSeat, calls: [...this.auction.calls],
        min: this.phase === 'auction' ? this.auctionMin() : null,
      } : null,
      trick: this.trick.map((t) => ({ seat: t.seat, card: { ...t.card } })),
      lastTrick: this.lastTrick,
      tricksDone: this.tricksDone,
      players: this.players.map((p, i) => ({
        seat: i, name: p.name, isBot: p.isBot, bid: p.bid, won: p.won, total: p.total, cards: p.hand.length,
      })),
      history: this.history,
      winnerSeat: this.winnerSeat,
      you: seat ?? null,
      hand: me ? me.hand.map((c) => ({ ...c })) : [],
      legal: seat != null ? this.legalFor(seat) : [],
    };
  }

  standings() {
    return this.players.map((p, seat) => ({ seat, id: p.id, name: p.name, isBot: p.isBot, total: p.total }))
      .sort((a, b) => b.total - a.total)
      .map((p, i) => ({ ...p, place: i + 1 }));
  }

  // ---------- internals ----------
  _need(phase) {
    if (this.phase !== phase) throw new GameError('WRONG_PHASE', `That move is not allowed during ${this.phase}`);
  }

  _startRound() {
    const deck = R.shuffle(R.newDeck(), this.rand);
    const auction = this.rules.trump === 'bidder';
    this.players.forEach((p, i) => {
      const cards = deck.slice(i * R.HAND_SIZE, (i + 1) * R.HAND_SIZE);
      p.hand = R.sortHand(auction ? cards.slice(0, R.AUCTION_CARDS) : cards);
      p.rest = auction ? cards.slice(R.AUCTION_CARDS) : [];
      p.bid = null;
      p.won = 0;
    });
    this.trick = [];
    this.lastTrick = null;
    this.tricksDone = 0;
    this.picker = null;
    this.auction = null;
    this.trump = this.rules.trump === 'spades' ? 'S'
      : this.rules.trump === 'random' ? R.SUITS[this.rand(4)] : null;
    this.turn = (this.dealer + 1) % 4;
    if (auction) {
      this.phase = 'auction';
      this.auction = { high: 0, highSeat: null, calls: [null, null, null, null], passed: [false, false, false, false] };
    } else {
      this.phase = 'bidding';
    }
    this.version++;
  }

  _auctionBid(seat, v) {
    this._need('auction');
    const min = this.auctionMin();
    if (!Number.isInteger(v) || v < min || v > R.MAX_BID) throw new GameError('BAD_BID', `Bid must be from ${min} to ${R.MAX_BID}`);
    const A = this.auction;
    A.high = v; A.highSeat = seat; A.calls[seat] = v;
    return [{ type: 'auctionBid', seat, value: v }, ...this._auctionAdvance(seat)];
  }

  _auctionPass(seat) {
    this._need('auction');
    const A = this.auction;
    if (A.highSeat == null) throw new GameError('MUST_OPEN', `The first player must bid at least ${R.AUCTION_MIN}`);
    A.passed[seat] = true; A.calls[seat] = 'pass';
    return [{ type: 'auctionPass', seat }, ...this._auctionAdvance(seat)];
  }

  _auctionAdvance(seat) {
    const A = this.auction;
    let n = seat;
    for (let k = 0; k < 4; k++) { n = (n + 1) % 4; if (!A.passed[n]) break; }
    if (n === A.highSeat || A.high >= R.MAX_BID) {
      this.phase = 'trumpPick';
      this.picker = A.highSeat;
      this.turn = null;
      return [{ type: 'auctionWon', seat: A.highSeat, value: A.high }];
    }
    this.turn = n;
    return [];
  }

  _chooseTrump(seat, suit) {
    this._need('trumpPick');
    if (!R.SUITS.includes(suit)) throw new GameError('BAD_SUIT', 'Suit must be S, H, C or D');
    this.trump = suit;
    // Deal the remaining 8 cards; the caller's auction bid becomes their bid.
    this.players.forEach((p) => { p.hand = R.sortHand(p.hand.concat(p.rest)); p.rest = []; });
    this.players[seat].bid = this.auction.high;
    this.phase = 'bidding';
    this.turn = this._nextUnbid(seat);
    return [{ type: 'trumpChosen', seat, suit }];
  }

  _nextUnbid(from) {
    let n = from;
    for (let k = 0; k < 4; k++) { n = (n + 1) % 4; if (this.players[n].bid == null) return n; }
    return null;
  }

  _bid(seat, v) {
    this._need('bidding');
    if (!Number.isInteger(v) || v < R.MIN_BID || v > R.MAX_BID) throw new GameError('BAD_BID', `Bid must be from ${R.MIN_BID} to ${R.MAX_BID}`);
    this.players[seat].bid = v;
    const events = [{ type: 'bid', seat, value: v }];
    const next = this._nextUnbid(seat);
    if (next == null) {
      this.phase = 'playing';
      this.trick = [];
      this.turn = this.auction ? this.picker : (this.dealer + 1) % 4;
      events.push({ type: 'biddingDone', leader: this.turn });
    } else {
      this.turn = next;
    }
    return events;
  }

  _play(seat, card) {
    this._need('playing');
    if (!R.isCard(card)) throw new GameError('BAD_CARD', 'That is not a valid card');
    const hand = this.players[seat].hand;
    const i = hand.findIndex((c) => R.sameCard(c, card));
    if (i < 0) throw new GameError('NOT_IN_HAND', 'You do not have that card');
    if (!R.legalCards(hand, this.trick, this.trump, this.rules.strict).some((c) => R.sameCard(c, card))) {
      throw new GameError('ILLEGAL_CARD', 'That card cannot be played right now');
    }
    const played = hand.splice(i, 1)[0];
    this.trick.push({ seat, card: played });
    const events = [{ type: 'cardPlayed', seat, card: { ...played } }];
    if (this.trick.length < 4) {
      this.turn = (seat + 1) % 4;
      return events;
    }
    const w = R.bestOf(this.trick, this.trump).seat;
    this.players[w].won++;
    this.lastTrick = { cards: this.trick.map((t) => ({ seat: t.seat, card: { ...t.card } })), winner: w };
    this.trick = [];
    this.tricksDone++;
    this.turn = w;
    events.push({ type: 'trickWon', seat: w });
    if (this.tricksDone === R.HAND_SIZE) events.push(...this._scoreRound());
    return events;
  }

  _scoreRound() {
    const rows = this.players.map((p) => {
      const points = R.roundPoints(p.bid, p.won, this.rules);
      p.total += points;
      return { bid: p.bid, won: p.won, points };
    });
    this.history.push({ round: this.round, rows });
    this.turn = null;
    const totals = this.players.map((p) => p.total);
    const top = Math.max(...totals);
    const events = [{ type: 'roundScored', round: this.round, rows }];
    // Game ends after the round where someone reaches the target, with a single leader.
    if (top >= this.rules.target && totals.filter((t) => t === top).length === 1) {
      this.phase = 'gameOver';
      this.winnerSeat = totals.indexOf(top);
      events.push({ type: 'gameOver', winnerSeat: this.winnerSeat });
    } else {
      this.phase = 'roundOver';
    }
    return events;
  }
}

module.exports = { Game, GameError };
