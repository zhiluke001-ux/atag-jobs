// server/index.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { PrismaClient } from "@prisma/client";
import { registerPasswordResetRoutes } from "./routes/passwordReset.js";

const app = express();
const prisma = new PrismaClient();

// CORS: allow Cloudflare Pages + local dev
const allow = [
  process.env.APP_ORIGIN,                  // e.g. https://atag-jobs.pages.dev
  "http://localhost:5173",                 // Vite dev
  "http://localhost:3000",
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allow.includes(origin)),
  credentials: true,
}));
app.use(bodyParser.json());

// ... your other routes: /login, /register, etc.
registerPasswordResetRoutes(app, prisma);

// health
app.get("/healthz", (_, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API on :${port}`));
