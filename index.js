import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./server/db.js";
import { createApp } from "./server/app.js";
import { supabaseConfiguration } from "./server/supabase.js";
import { serveFrontend } from "./server/frontend.js";

supabaseConfiguration();

process.env.TRUST_PROXY_HOPS ||= "1";
const db = await openDatabase({
  url: process.env.DATABASE_URL,
  initialize: false,
});
const app = express();
app.use(await createApp(db, { production: true }));
serveFrontend(app, path.resolve(path.dirname(fileURLToPath(import.meta.url)), "public"));

export default app;
