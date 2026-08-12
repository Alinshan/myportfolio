// Encrypts assets/alinshan.jpg -> assets/photo.enc (AES-256-GCM, zero extra deps).
// Usage: node encrypt-image.js <32-byte-hex-key>   (or set PHOTO_KEY env var)
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const keyHex = process.argv[2] || process.env.PHOTO_KEY;
if (!keyHex || keyHex.length !== 64) {
  console.error("Usage: node encrypt-image.js <32-byte-hex-key>  (or set PHOTO_KEY)");
  process.exit(1);
}

const input = path.join(__dirname, "..", "assets", "alinshan.jpg");
const output = path.join(__dirname, "..", "assets", "photo.enc");
if (!fs.existsSync(input)) {
  console.error("Missing " + input);
  process.exit(1);
}

const key = Buffer.from(keyHex, "hex");
const plain = fs.readFileSync(input);
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
const tag = cipher.getAuthTag();

const payload = Buffer.concat([iv, tag, enc]);
fs.writeFileSync(output, payload);
console.log("[ OK ] Encrypted " + plain.length + " bytes -> " + output + " (" + payload.length + " bytes)");
