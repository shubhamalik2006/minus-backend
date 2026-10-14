-- Minus database schema (PostgreSQL). Safe to run more than once.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,              -- Firebase user id
  provider      TEXT NOT NULL,                 -- google | apple | phone
  display_name  TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS games (
  id              BIGSERIAL PRIMARY KEY,
  room_code       TEXT NOT NULL,
  rules           JSONB NOT NULL,
  rounds          INT NOT NULL,
  winner_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_players (
  game_id      BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seat         INT NOT NULL CHECK (seat BETWEEN 0 AND 3),
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  bot_name     TEXT,
  final_score  INT NOT NULL,
  place        INT NOT NULL CHECK (place BETWEEN 1 AND 4),
  PRIMARY KEY (game_id, seat)
);

CREATE INDEX IF NOT EXISTS game_players_user_idx ON game_players (user_id);
