'use strict';
// Storage. Uses PostgreSQL when DATABASE_URL is set; otherwise an in-memory store
// (fine for local testing, but everything is lost when the server restarts).
const fs = require('fs');
const path = require('path');

const toUser = (r) => r && ({ id: r.id, provider: r.provider, displayName: r.display_name, phone: r.phone, email: r.email });

class PgStore {
  constructor(url) {
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString: url, max: 10 });
  }

  async init() {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await this.pool.query(sql);
  }

  async upsertUser({ uid, provider, displayName, phone, email }) {
    const { rows } = await this.pool.query(
      `INSERT INTO users (id, provider, display_name, phone, email) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET last_seen_at = now(),
         phone = COALESCE(EXCLUDED.phone, users.phone), email = COALESCE(EXCLUDED.email, users.email)
       RETURNING id, provider, display_name, phone, email`,
      [uid, provider, displayName, phone, email],
    );
    return toUser(rows[0]);
  }

  async setDisplayName(id, name) {
    const { rows } = await this.pool.query(
      'UPDATE users SET display_name = $2 WHERE id = $1 RETURNING id, provider, display_name, phone, email', [id, name]);
    return toUser(rows[0]);
  }

  async saveGame(g) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO games (room_code, rules, rounds, winner_user_id, started_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [g.roomCode, g.rules, g.rounds, g.winnerUserId, g.startedAt]);
      for (const p of g.players) {
        await client.query(
          'INSERT INTO game_players (game_id, seat, user_id, bot_name, final_score, place) VALUES ($1, $2, $3, $4, $5, $6)',
          [rows[0].id, p.seat, p.userId, p.botName, p.finalScore, p.place]);
      }
      await client.query('COMMIT');
      return rows[0].id;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getStats(userId) {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS games_played, count(*) FILTER (WHERE place = 1)::int AS wins, max(final_score) AS best_score
       FROM game_players WHERE user_id = $1`, [userId]);
    const r = rows[0];
    return { gamesPlayed: r.games_played, wins: r.wins, bestScore: r.best_score };
  }

  async leaderboard(limit = 20) {
    const { rows } = await this.pool.query(
      `SELECT u.display_name, count(*) FILTER (WHERE gp.place = 1)::int AS wins, count(*)::int AS games_played
       FROM game_players gp JOIN users u ON u.id = gp.user_id
       GROUP BY u.id ORDER BY wins DESC, games_played ASC LIMIT $1`, [limit]);
    return rows.map((r) => ({ displayName: r.display_name, wins: r.wins, gamesPlayed: r.games_played }));
  }

  async close() { await this.pool.end(); }
}

class MemoryStore {
  constructor() { this.users = new Map(); this.games = []; }
  async init() {}

  async upsertUser({ uid, provider, displayName, phone, email }) {
    const u = this.users.get(uid) || { id: uid, provider, displayName, phone: null, email: null };
    u.phone = phone || u.phone;
    u.email = email || u.email;
    this.users.set(uid, u);
    return { ...u };
  }

  async setDisplayName(id, name) {
    const u = this.users.get(id);
    if (u) u.displayName = name;
    return u && { ...u };
  }

  async saveGame(g) { this.games.push(g); return this.games.length; }

  async getStats(userId) {
    const mine = this.games.flatMap((g) => g.players).filter((p) => p.userId === userId);
    return {
      gamesPlayed: mine.length,
      wins: mine.filter((p) => p.place === 1).length,
      bestScore: mine.length ? Math.max(...mine.map((p) => p.finalScore)) : null,
    };
  }

  async leaderboard(limit = 20) {
    const by = new Map();
    for (const p of this.games.flatMap((g) => g.players)) {
      if (!p.userId) continue;
      const e = by.get(p.userId) || { displayName: this.users.get(p.userId)?.displayName || 'Player', wins: 0, gamesPlayed: 0 };
      e.gamesPlayed++;
      if (p.place === 1) e.wins++;
      by.set(p.userId, e);
    }
    return [...by.values()].sort((a, b) => b.wins - a.wins || a.gamesPlayed - b.gamesPlayed).slice(0, limit);
  }

  async close() {}
}

function createStore(url) {
  if (url) return new PgStore(url);
  console.warn('[db] DATABASE_URL not set: using in-memory storage (data is lost on restart)');
  return new MemoryStore();
}

module.exports = { createStore, PgStore, MemoryStore };
