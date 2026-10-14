'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/game/rules');

const c = (s, r) => ({ s, r });
const trick = (...cards) => cards.map((card, seat) => ({ seat, card }));

test('scoring: make the bid -> +bid only, miss -> -bid', () => {
  const rules = R.validateRules({});
  assert.equal(R.roundPoints(3, 5, rules), 3);
  assert.equal(R.roundPoints(3, 3, rules), 3);
  assert.equal(R.roundPoints(3, 2, rules), -3);
  assert.equal(R.roundPoints(9, 9, rules), 9);
  assert.equal(R.roundPoints(9, 9, R.validateRules({ bigBid: true })), 13);
});

test('strict: must beat the led card when you can', () => {
  const hand = [c('H', 5), c('H', 12), c('S', 2)];
  const legal = R.legalCards(hand, trick(c('H', 10)), 'S', true);
  assert.deepEqual(legal, [c('H', 12)]);
  assert.equal(R.legalCards(hand, trick(c('H', 10)), 'S', false).length, 2);
});

test('strict: void in led suit must trump, and over-trump when possible', () => {
  const hand = [c('S', 4), c('S', 11), c('D', 9)];
  assert.deepEqual(R.legalCards(hand, trick(c('H', 10)), 'S', true), [c('S', 4), c('S', 11)]);
  assert.deepEqual(R.legalCards(hand, trick(c('H', 10), c('S', 8)), 'S', true), [c('S', 11)]);
  // cannot over-trump -> any card
  assert.equal(R.legalCards(hand, trick(c('H', 10), c('S', 13)), 'S', true).length, 3);
});

test('trick winner: trump beats led suit; off-suit never wins', () => {
  assert.equal(R.bestOf(trick(c('H', 10), c('H', 14), c('S', 2), c('D', 14)), 'S').seat, 2);
  assert.equal(R.bestOf(trick(c('H', 10), c('H', 14), c('S', 2), c('D', 14)), null).seat, 1);
});

test('rules validation', () => {
  assert.equal(R.validateRules({ target: 61 }).target, 61);
  assert.throws(() => R.validateRules({ target: 5 }), R.RulesError);
  assert.throws(() => R.validateRules({ trump: 'hearts' }), R.RulesError);
  assert.throws(() => R.validateRules({ strict: 'yes' }), R.RulesError);
});

test('deck has 52 unique cards and shuffles', () => {
  const d = R.shuffle(R.newDeck());
  assert.equal(new Set(d.map((x) => x.s + x.r)).size, 52);
});
