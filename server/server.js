require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;
const PHOTO_KEY = process.env.PHOTO_KEY || null;

app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));

/* ===== In-memory rate limiter (per IP) ===== */
const hits = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const max = 5;
  const entry = hits.get(ip);
  if (!entry || now - entry.start > windowMs) {
    hits.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now - entry.start > 5 * 60 * 1000) hits.delete(ip);
  }
}, 60 * 1000);

/* ===== Mailer ===== */
const MAIL_ENABLED = !!process.env.SMTP_HOST;
const transporter = MAIL_ENABLED
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE) === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || "portfolio@localhost";
const MAIL_TO = process.env.MAIL_TO || MAIL_FROM;

function validateEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function clean(str, max) {
  return String(str || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max || 500);
}

app.post("/api/contact", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";

  if (!rateLimit(ip)) {
    return res.status(429).json({ ok: false, error: "rate_limited" });
  }

  const name = clean(req.body.name, 120);
  const email = clean(req.body.email, 200);
  const message = clean(req.body.message, 4000);

  if (!name || !email || !message) {
    return res.status(400).json({ ok: false, error: "All fields are required." });
  }
  if (!validateEmail(email)) {
    return res.status(400).json({ ok: false, error: "Invalid email format." });
  }
  if (name.length < 2 || message.length < 10) {
    return res.status(400).json({ ok: false, error: "Name too short or message too brief." });
  }

  if (!MAIL_ENABLED || !transporter) {
    return res.status(500).json({ ok: false, error: "Mail server is not configured." });
  }

  try {
    await transporter.sendMail({
      from: `"${name} via Portfolio" <${MAIL_FROM}>`,
      to: MAIL_TO,
      replyTo: `${name} <${email}>`,
      subject: `[Portfolio] Message from ${name} (${email})`,
      text: [
        `Name    : ${name}`,
        `Email   : ${email}`,
        `IP      : ${ip}`,
        `--------`,
        message,
      ].join("\n"),
      html: `
        <div style="font-family:monospace;color:#e8f0f7;background:#0a0d11;padding:24px;border-left:4px solid #00ff9c">
          <h2 style="color:#00ff9c;margin:0 0 16px">NEW TRANSMISSION</h2>
          <p><b style="color:#00e5ff">Name :</b> ${escapeHtml(name)}</p>
          <p><b style="color:#00e5ff">Email:</b> ${escapeHtml(email)}</p>
          <p><b style="color:#00e5ff">IP   :</b> ${escapeHtml(ip)}</p>
          <hr style="border-color:#1b2a33">
          <p style="white-space:pre-wrap;line-height:1.6">${escapeHtml(message)}</p>
        </div>`,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Mail send failed:", err.message);
    return res.status(500).json({ ok: false, error: "Transmission failed. Try again shortly." });
  }
});

function escapeHtml(v) {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ===== Serve the encrypted photo (raw image is never in the repo) ===== */
app.get("/assets/alinshan.jpg", (req, res) => {
  const encPath = path.join(__dirname, "..", "assets", "photo.enc");
  if (!PHOTO_KEY) {
    const plain = path.join(__dirname, "..", "assets", "alinshan.jpg");
    if (fs.existsSync(plain)) return res.sendFile(plain);
    return res.status(404).json({ ok: false, error: "PHOTO_KEY not set and no local image." });
  }
  try {
    const data = fs.readFileSync(encPath);
    const key = Buffer.from(PHOTO_KEY, "hex");
    if (key.length !== 32) throw new Error("PHOTO_KEY must be 32 bytes (64 hex chars)");
    const iv = data.slice(0, 12);
    const tag = data.slice(12, 28);
    const enc = data.slice(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
    res.type("jpeg");
    return res.send(plain);
  } catch (err) {
    console.error("Photo decrypt failed:", err.message);
    return res.status(500).json({ ok: false, error: "Photo unavailable." });
  }
});

/* ===== Serve the static portfolio ===== */
const STATIC_DIR = path.join(__dirname, "..");
app.use(express.static(STATIC_DIR, { extensions: ["html"] }));

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found." });
});

app.listen(PORT, () => {
  console.log(`[ OK ] Portfolio server live on http://localhost:${PORT}`);
  if (!MAIL_ENABLED) {
    console.log("[WARN] SMTP not configured — mail will be rejected. Add credentials to server/.env");
  }
});
