// =====================================================================
// Log Monitor : หน้าดู syslog ของระบบ (logs/system-YYYY-MM-DD.log) : POS_Server 1.0.11
//   GET  /logmonitor              หน้าเว็บ (ล็อกอินด้วยบัญชีผู้ดูแลระบบ)
//   POST /logmonitor/api/login    { username, password } -> { token, expires_at }
//   GET  /logmonitor/api/logs     ?from=&to=&q=&level=&type=&limit=   (Authorization: Bearer <token>)
// บัญชีผู้ดูแลตั้งใน .env : LOGVIEW_USER, LOGVIEW_PASSWORD (ไม่ตั้ง = ปิดหน้า monitor)
// =====================================================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { db } = require("../db/postgresql");
const { LOG_DIR, write } = require("../modules/systemLog");

require("dotenv").config();

const TOKEN_TTL_SEC = 8 * 60 * 60; // 8 ชั่วโมง
const MAX_LIMIT = 2000;
const LINE_RE = /^<(\d+)>1 (\S+) (\S+) (\S+) (\S+) (INFO|WARN|ERROR) (.*)$/;
const FILE_RE = /^system-(\d{4})-(\d{2})-(\d{2})\.log$/;

const secret = () => process.env.LOGVIEW_SECRET || process.env.JWT_SECRET || "logmonitor";
const enabled = () => !!(process.env.LOGVIEW_USER && process.env.LOGVIEW_PASSWORD);

// ---------------- auth ----------------

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (data) => crypto.createHmac("sha256", secret()).update(data).digest("base64url");

function issueToken(username) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  const body = b64(JSON.stringify({ u: username, exp }));
  return { token: `${body}.${sign(body)}`, exp };
}

function verifyToken(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = sign(body);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
    if (p.u !== process.env.LOGVIEW_USER) return null; // เปลี่ยนชื่อผู้ใช้ใน .env -> token เดิมใช้ไม่ได้
    return p;
  } catch (e) {
    return null;
  }
}

// กันเดารหัส : ผิด 5 ครั้งใน 15 นาทีต่อ IP -> ล็อก 15 นาที (ต่อ process)
const FAIL_LIMIT = 5;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const fails = new Map();
function ipOf(req) {
  const xf = req.headers["x-forwarded-for"];
  return xf ? String(xf).split(",")[0].trim() : req.ip || (req.socket && req.socket.remoteAddress) || "";
}
function isLocked(ip) {
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > FAIL_WINDOW_MS) {
    fails.delete(ip);
    return false;
  }
  return f.count >= FAIL_LIMIT;
}
function addFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.first > FAIL_WINDOW_MS) fails.set(ip, { count: 1, first: Date.now() });
  else f.count += 1;
}

exports.login = (req, res) => {
  if (!enabled()) return res.status(503).json({ message: "Log monitor is disabled (set LOGVIEW_USER / LOGVIEW_PASSWORD in .env)" });
  const ip = ipOf(req);
  if (isLocked(ip)) return res.status(429).json({ message: "ล็อกอินผิดหลายครั้ง กรุณารอ 15 นาที" });
  const { username, password } = req.body || {};
  const ok = typeof username === "string" && typeof password === "string" &&
    safeEqual(username, process.env.LOGVIEW_USER) && safeEqual(password, process.env.LOGVIEW_PASSWORD);
  if (!ok) {
    addFail(ip);
    write("WARN", { type: "logmonitor", msg: "login failed", ip, username: typeof username === "string" ? username.slice(0, 50) : null });
    return res.status(401).json({ message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
  }
  fails.delete(ip);
  write("INFO", { type: "logmonitor", msg: "login", ip, username });
  const t = issueToken(username);
  return res.json({ token: t.token, expires_at: t.exp });
};

// ---------------- อ่าน log ----------------

function parseTime(v, def) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  const d = Number.isFinite(n) && String(v).trim() !== "" && !/[-:T]/.test(String(v)) ? new Date(n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ไฟล์รายวันที่อยู่ในช่วง [from, to]
function filesInRange(from, to) {
  if (!fs.existsSync(LOG_DIR)) return [];
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return fs
    .readdirSync(LOG_DIR)
    .map((name) => {
      const m = name.match(FILE_RE);
      return m ? { name, day: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) } : null;
    })
    .filter((f) => f && f.day >= start && f.day <= end)
    .sort((a, b) => b.day - a.day) // ใหม่ก่อน
    .map((f) => path.join(LOG_DIR, f.name));
}

function parseLine(line) {
  const m = line.match(LINE_RE);
  if (!m) return null;
  let data;
  try {
    data = JSON.parse(m[7]);
  } catch (e) {
    data = { msg: m[7] };
  }
  return { time: m[2], ts: Date.parse(m[2]), host: m[3], pid: Number(m[5]), level: m[6], data };
}

// uinfoid ของผู้ใช้ที่ชื่อ / login name ตรงกับคำค้น
async function userIdsMatching(q) {
  try {
    const rows = await db("userinfo")
      .select("uinfoid")
      .where("uinfoname", "ilike", `%${q}%`)
      .orWhere("uinfologinname", "ilike", `%${q}%`)
      .limit(200);
    return new Set(rows.map((r) => String(r.uinfoid)));
  } catch (e) {
    return new Set();
  }
}

async function userNames(ids) {
  const list = [...ids].filter(Boolean);
  if (!list.length) return new Map();
  try {
    const rows = await db("userinfo").select("uinfoid", "uinfoname", "uinfologinname").whereIn("uinfoid", list.slice(0, 1000));
    return new Map(rows.map((r) => [String(r.uinfoid), r.uinfoname || r.uinfologinname || ""]));
  } catch (e) {
    return new Map();
  }
}

exports.logs = async (req, res) => {
  try {
    if (!enabled()) return res.status(503).json({ message: "Log monitor is disabled" });
    if (!verifyToken(req)) return res.status(401).json({ message: "Unauthorized" });

    const now = new Date();
    const to = parseTime(req.query.to, now);
    const from = parseTime(req.query.from, new Date(now.getTime() - 60 * 60 * 1000));
    if (!from || !to) return res.status(400).json({ message: "from / to is invalid" });
    if (from > to) return res.status(400).json({ message: "from must be before to" });

    const q = String(req.query.q || "").trim().toLowerCase().slice(0, 200);
    const levels = String(req.query.level || "").toUpperCase().split(",").filter((l) => ["INFO", "WARN", "ERROR"].includes(l));
    const type = String(req.query.type || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), MAX_LIMIT);
    const qUsers = q ? await userIdsMatching(q) : new Set();

    const fromMs = from.getTime();
    const toMs = to.getTime();
    const counts = { INFO: 0, WARN: 0, ERROR: 0 };
    let matched = 0;
    let scanned = 0;
    let truncated = false;
    let entries = [];

    for (const file of filesInRange(from, to)) {
      const fileEntries = [];
      const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
      for await (const line of rl) {
        scanned += 1;
        if (!line) continue;
        const e = parseLine(line);
        if (!e || !(e.ts >= fromMs && e.ts <= toMs)) continue;
        if (levels.length && !levels.includes(e.level)) continue;
        if (type && e.data.type !== type) continue;
        if (q && !line.toLowerCase().includes(q) && !(e.data.uinfoid && qUsers.has(String(e.data.uinfoid)))) continue;
        counts[e.level] += 1;
        matched += 1;
        fileEntries.push(e);
      }
      // ใหม่ก่อน ; เก็บแค่ limit รายการล่าสุด
      fileEntries.reverse();
      for (const e of fileEntries) {
        if (entries.length < limit) entries.push(e);
        else truncated = true;
      }
    }
    entries.sort((a, b) => b.ts - a.ts);

    const names = await userNames(new Set(entries.map((e) => e.data.uinfoid && String(e.data.uinfoid))));
    entries = entries.map((e) => ({
      time: e.time,
      level: e.level,
      host: e.host,
      pid: e.pid,
      username: e.data.uinfoid ? names.get(String(e.data.uinfoid)) || null : null,
      data: e.data,
    }));

    return res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      total: matched,
      returned: entries.length,
      truncated,
      counts,
      scanned,
      retention_days: Number(process.env.SYSTEM_LOG_RETENTION_DAYS) || 7,
      entries,
    });
  } catch (error) {
    console.error("[LogMonitor]", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------------- หน้าเว็บ ----------------

let pageCache = null;
exports.page = (req, res) => {
  if (!pageCache) pageCache = fs.readFileSync(path.join(__dirname, "..", "views", "logmonitor.html"), "utf8");
  res.set("Cache-Control", "no-store");
  res.set("X-Frame-Options", "DENY");
  res.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  res.type("html").send(pageCache);
};
