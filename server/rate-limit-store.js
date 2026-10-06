import { digest } from "./security.js";

// Atomic counters live in PostgreSQL, shared by every application instance.
export class PostgresRateLimitStore {
  constructor(db, scope) {
    this.db = db;
    this.scope = scope;
    this.localKeys = false;
  }
  init(options) {
    this.windowMs = options.windowMs;
  }
  key(value) {
    return digest(`${this.scope}:${value}`);
  }
  async increment(key) {
    const { rows } = await this.db.query(
      `INSERT INTO auth_rate_limits(key,hits,reset_at)
       VALUES($1,1,now()+$2*interval '1 millisecond')
       ON CONFLICT(key) DO UPDATE SET
         hits=CASE WHEN auth_rate_limits.reset_at<=now() THEN 1 ELSE auth_rate_limits.hits+1 END,
         reset_at=CASE WHEN auth_rate_limits.reset_at<=now() THEN EXCLUDED.reset_at ELSE auth_rate_limits.reset_at END
       RETURNING hits,reset_at`,
      [this.key(key), this.windowMs],
    );
    return {
      totalHits: Number(rows[0].hits),
      resetTime: new Date(rows[0].reset_at),
    };
  }
  async decrement(key) {
    await this.db.query(
      "UPDATE auth_rate_limits SET hits=greatest(0,hits-1) WHERE key=$1",
      [this.key(key)],
    );
  }
  async resetKey(key) {
    await this.db.query("DELETE FROM auth_rate_limits WHERE key=$1", [
      this.key(key),
    ]);
  }
}
