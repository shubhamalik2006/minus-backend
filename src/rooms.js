'use strict';
// Rooms: players gather with a 6-letter code, the host starts, bots fill empty seats.
const crypto = require('crypto');
const { Game } = require('./game/Game');
const { validateRules } = require('./game/rules');

const BOT_NAMES = ['Ravi', 'Meera', 'Kabir', 'Anaya', 'Dev', 'Isha'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
const WAITING_TTL_MS = 30 * 60 * 1000;
const FINISHED_TTL_MS = 10 * 60 * 1000;

class RoomError extends Error {
  constructor(code, message) { super(message); this.code = code; this.expose = true; }
}

class RoomManager {
  constructor({ io, store, botDelayMs = 900, turnTimeoutMs = 30000, roundPauseMs = 5000, logger = console }) {
    this.io = io;
    this.store = store;
    this.botDelayMs = botDelayMs;
    this.turnTimeoutMs = turnTimeoutMs;
    this.roundPauseMs = roundPauseMs;
    this.logger = logger;
    this.rooms = new Map();
    this.sweeper = setInterval(() => this.sweep(), 60 * 1000);
    this.sweeper.unref?.();
  }

  stop() {
    clearInterval(this.sweeper);
    for (const r of this.rooms.values()) clearTimeout(r.timer);
  }

  // ---------- room lifecycle ----------
  create(user, rulesInput) {
    const rules = validateRules(rulesInput || {});
    const room = {
      code: this._code(), hostId: user.id, rules, status: 'waiting',
      seats: [this._humanSeat(user), null, null, null],
      game: null, timer: null, turnDeadline: null, createdAt: Date.now(), startedAt: null, finishedAt: null,
    };
    this.rooms.set(room.code, room);
    this._broadcast(room, [{ type: 'roomCreated' }]);
    return { state: this.viewFor(room, 0) };
  }

  join(user, codeInput) {
    const room = this._get(codeInput);
    let seat = this._seatOf(room, user.id);
    if (seat >= 0) {
      room.seats[seat].connected = true;
      room.seats[seat].left = false;
    } else {
      if (room.status !== 'waiting') throw new RoomError('IN_PROGRESS', 'This game has already started');
      seat = room.seats.findIndex((s) => s === null);
      if (seat < 0) throw new RoomError('ROOM_FULL', 'This table is full');
      room.seats[seat] = this._humanSeat(user);
      this._broadcast(room, [{ type: 'playerJoined', seat }]);
    }
    return { state: this.viewFor(room, seat) };
  }

  leave(user, codeInput) {
    const room = this._get(codeInput);
    const seat = this._seatOf(room, user.id);
    if (seat < 0) return {};
    if (room.status === 'waiting') {
      room.seats[seat] = null;
      const humans = room.seats.filter((s) => s && !s.isBot);
      if (!humans.length) { this._delete(room); return {}; }
      if (room.hostId === user.id) room.hostId = humans[0].userId;
      this._broadcast(room, [{ type: 'playerLeft', seat }]);
    } else {
      // During a game the seat stays; the computer plays it from now on.
      room.seats[seat].left = true;
      room.seats[seat].connected = false;
      this._broadcast(room, [{ type: 'playerLeft', seat }]);
      if (room.game && room.game.actor === seat) this._schedule(room);
    }
    return {};
  }

  start(user, codeInput) {
    const room = this._get(codeInput);
    if (room.hostId !== user.id) throw new RoomError('NOT_HOST', 'Only the host can start the game');
    if (room.status !== 'waiting') throw new RoomError('IN_PROGRESS', 'The game has already started');
    const used = new Set(room.seats.filter(Boolean).map((s) => s.name));
    const names = BOT_NAMES.filter((n) => !used.has(n));
    room.seats = room.seats.map((s, i) => s || { userId: null, name: names[i] || `Bot ${i + 1}`, isBot: true, connected: true, left: false });
    room.game = new Game({ players: room.seats.map((s) => ({ id: s.userId, name: s.name, isBot: s.isBot })), rules: room.rules });
    room.status = 'playing';
    room.startedAt = new Date();
    this._after(room, room.game.start());
    return {};
  }

  act(user, codeInput, action) {
    const room = this._get(codeInput);
    if (room.status !== 'playing' || !room.game) throw new RoomError('NOT_PLAYING', 'There is no game running at this table');
    const seat = this._seatOf(room, user.id);
    if (seat < 0) throw new RoomError('NOT_SEATED', 'You are not at this table');
    const events = room.game.act(seat, action);
    this._after(room, events);
    return {};
  }

  stateFor(user, codeInput) {
    const room = this._get(codeInput);
    const seat = this._seatOf(room, user.id);
    if (seat < 0) throw new RoomError('NOT_SEATED', 'You are not at this table');
    return { state: this.viewFor(room, seat) };
  }

  disconnected(userId) {
    for (const room of this.rooms.values()) {
      const seat = this._seatOf(room, userId);
      if (seat >= 0) { room.seats[seat].connected = false; this._broadcast(room, [{ type: 'playerOffline', seat }]); }
    }
  }

  viewFor(room, seat) {
    return {
      code: room.code,
      status: room.status,
      rules: room.rules,
      you: seat,
      isHost: room.seats[seat] ? room.seats[seat].userId === room.hostId : false,
      seats: room.seats.map((s) => s && {
        name: s.name, isBot: s.isBot, isHost: !!s.userId && s.userId === room.hostId,
        connected: s.connected, left: !!s.left,
      }),
      turnDeadline: room.turnDeadline,
      game: room.game ? room.game.viewFor(seat) : null,
    };
  }

  sweep(now = Date.now()) {
    for (const room of this.rooms.values()) {
      if (room.status === 'waiting' && now - room.createdAt > WAITING_TTL_MS) this._delete(room);
      else if (room.status === 'finished' && now - room.finishedAt > FINISHED_TTL_MS) this._delete(room);
    }
  }

  // ---------- internals ----------
  _humanSeat(user) {
    return { userId: user.id, name: user.displayName, isBot: false, connected: true, left: false };
  }

  _code() {
    let c;
    do { c = Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); }
    while (this.rooms.has(c));
    return c;
  }

  _get(codeInput) {
    const code = String(codeInput || '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('NO_ROOM', 'No table with that code');
    return room;
  }

  _seatOf(room, userId) {
    return room.seats.findIndex((s) => s && s.userId === userId);
  }

  _delete(room) {
    clearTimeout(room.timer);
    this.rooms.delete(room.code);
  }

  _after(room, events) {
    this._schedule(room);
    this._broadcast(room, events);
  }

  // Bots move after a short pause; humans get TURN_TIMEOUT before the computer plays for them.
  _schedule(room) {
    clearTimeout(room.timer);
    room.turnDeadline = null;
    const g = room.game;
    if (!g) return;
    if (g.phase === 'gameOver') { this._finish(room); return; }
    if (g.phase === 'roundOver') {
      room.timer = setTimeout(() => this._run(room, () => g.nextRound()), this.roundPauseMs);
      return;
    }
    const seat = g.actor;
    if (seat == null) return;
    const s = room.seats[seat];
    const auto = s.isBot || s.left;
    const delay = auto ? this.botDelayMs : this.turnTimeoutMs;
    if (!auto) room.turnDeadline = Date.now() + delay;
    room.timer = setTimeout(() => this._run(room, () => g.act(seat, g.botAction(seat))), delay);
  }

  _run(room, fn) {
    if (!this.rooms.has(room.code)) return;
    try { this._after(room, fn()); }
    catch (e) { this.logger.error(`[room ${room.code}]`, e); }
  }

  _finish(room) {
    if (room.status === 'finished') return;
    room.status = 'finished';
    room.finishedAt = Date.now();
    const g = room.game;
    const standings = g.standings();
    const winner = standings[0];
    Promise.resolve(this.store?.saveGame({
      roomCode: room.code,
      rules: room.rules,
      rounds: g.round,
      startedAt: room.startedAt,
      winnerUserId: winner.isBot ? null : winner.id,
      players: standings.map((p) => ({ seat: p.seat, userId: p.isBot ? null : p.id, botName: p.isBot ? p.name : null, finalScore: p.total, place: p.place })),
    })).catch((e) => this.logger.error(`[room ${room.code}] could not save game`, e));
  }

  _broadcast(room, events) {
    if (!this.io) return;
    room.seats.forEach((s, i) => {
      if (s && !s.isBot) this.io.to(`u:${s.userId}`).emit('room:state', { events, state: this.viewFor(room, i) });
    });
  }
}

module.exports = { RoomManager, RoomError };
