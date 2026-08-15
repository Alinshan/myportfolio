const nodemailer = require("nodemailer");

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

function validateEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function clean(str, max) {
  return String(str || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max || 500);
}
function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";

  if (!rateLimit(ip)) {
    return res.status(429).json({ ok: false, error: "Too many transmissions. Retry in a few minutes." });
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

  if (!process.env.SMTP_HOST) {
    return res.status(500).json({ ok: false, error: "Mail server is not configured." });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || "portfolio@localhost";
  const MAIL_TO = process.env.MAIL_TO || MAIL_FROM;

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
};
