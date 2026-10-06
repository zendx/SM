export function postgresConfiguration(url, env = process.env) {
  const max = Number(env.DB_POOL_MAX || (env.VERCEL ? 1 : 10));
  if (!Number.isInteger(max) || max < 1 || max > 100)
    throw new Error("DB_POOL_MAX must be an integer from 1 to 100.");
  const config = { connectionString: url, max, connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000, allowExitOnIdle: true };
  if (env.DB_SSL_CA) {
    const connection = new URL(url);
    // node-postgres replaces the ssl object when SSL options occur in the URL.
    for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat", "ssl"])
      connection.searchParams.delete(name);
    config.connectionString = connection.toString();
    config.ssl = { ca: env.DB_SSL_CA.replace(/\\n/g, "\n"), rejectUnauthorized: true };
  }
  return config;
}
