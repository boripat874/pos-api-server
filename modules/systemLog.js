// =====================================================================
// Syslog ของระบบ (เก็บบน POS Server) : POS_Server 1.0.10 (Log Monitor 1.0.11)
//   - เก็บทุก request (method, path, status, เวลาตอบ, IP, ผู้ใช้) และ error / warning ของ server
//   - เขียนเป็นไฟล์รายวัน  <SYSTEM_LOG_DIR>/system-YYYY-MM-DD.log  (1 บรรทัด = 1 รายการ, รูปแบบ syslog + JSON)
//   - ลบไฟล์ที่เก็บเกิน SYSTEM_LOG_RETENTION_DAYS วัน (ค่าเริ่มต้น 7) ทุกวัน 00:15 และตอนเปิด server
//   - ไม่เก็บ body / header ทั้งก้อน (กันรหัสผ่าน, token, API key รั่ว) และตัด query ที่เป็นข้อมูลลับ
//   - เขียน log ล้มเหลวต้องไม่ทำให้ API ล้ม
// ตั้งค่าใน .env
//   SYSTEM_LOG_ENABLED=true            ปิดด้วย false
//   SYSTEM_LOG_DIR=./logs              โฟลเดอร์เก็บไฟล์ (pm2 watch ต้อง ignore โฟลเดอร์นี้)
//   SYSTEM_LOG_RETENTION_DAYS=7
// =====================================================================
const fs = require("fs");
const os = require("os");
const path = require("path");
const jwt = require("jsonwebtoken");

require("dotenv").config();

const ENABLED = String(process.env.SYSTEM_LOG_ENABLED || "true").toLowerCase() !== "false";
const LOG_DIR = path.resolve(process.env.SYSTEM_LOG_DIR || path.join(__dirname, "..", "logs"));
const RETENTION_DAYS = Math.max(parseInt(process.env.SYSTEM_LOG_RETENTION_DAYS, 10) || 7, 1);
const FILE_RE = /^system-(\d{4})-(\d{2})-(\d{2})\.log$/;
const HOST = os.hostname();
const APP = "POS_System";
const SECRET_QUERY = /(pass|password|token|apikey|api_key|secret|otp)/i;

// syslog severity (RFC 5424) ; facility local0 = 16
const SEVERITY = { ERROR: 3, WARN: 4, INFO: 6 };
const FACILITY = 16;

// console เดิม (ก่อน hook) ใช้แจ้งปัญหาของตัว log เอง
const origConsole = { error: console.error.bind(console), warn: console.warn.bind(console) };

const pad = (n, l = 2) => String(n).padStart(l, "0");

// เวลาท้องถิ่นของ server พร้อม offset เช่น 2026-11-06T12:10:05.123+07:00
function isoLocal(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function fileFor(d = new Date()) {
  return path.join(LOG_DIR, `system-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`);
}

let dirReady = false;
function ensureDir() {
  if (dirReady) return true;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    dirReady = true;
  } catch (e) {
    origConsole.warn("[SystemLog] cannot create log dir:", LOG_DIR, e.message);
  }
  return dirReady;
}

// เขียน 1 บรรทัด : <PRI>1 TIMESTAMP HOST APP PID LEVEL {json}
//   appendFile เปิดไฟล์แบบ O_APPEND -> หลาย process (pm2 cluster) เขียนไฟล์เดียวกันได้โดยบรรทัดไม่ทับกัน
function write(level, data) {
  if (!ENABLED || !ensureDir()) return;
  try {
    const d = new Date();
    const pri = FACILITY * 8 + (SEVERITY[level] !== undefined ? SEVERITY[level] : 6);
    let json;
    try {
      json = JSON.stringify(data);
    } catch (e) {
      json = JSON.stringify({ msg: String(data) });
    }
    const line = `<${pri}>1 ${isoLocal(d)} ${HOST} ${APP} ${process.pid} ${level} ${json}\n`;
    fs.appendFile(fileFor(d), line, (err) => {
      if (err) origConsole.warn("[SystemLog] write failed:", err.message);
    });
  } catch (e) {
    // log ห้ามทำให้ระบบล้ม
  }
}

// ---------------- request log ----------------

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || "";
}

// อ่าน uinfoid จาก token (ไม่ verify : ใช้เพื่อบันทึกเท่านั้น)
function userOf(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  try {
    const d = jwt.decode(h.split(" ")[1]);
    return d && d.uinfoid ? String(d.uinfoid) : null;
  } catch (e) {
    return null;
  }
}

// path + query (ซ่อนค่าที่เป็นข้อมูลลับ)
function safeUrl(req) {
  const url = req.originalUrl || req.url || "";
  const i = url.indexOf("?");
  if (i < 0) return url;
  const qs = url
    .slice(i + 1)
    .split("&")
    .map((kv) => {
      const [k] = kv.split("=");
      return SECRET_QUERY.test(decodeURIComponent(k || "")) ? `${k}=***` : kv;
    })
    .join("&");
  return `${url.slice(0, i)}?${qs}`;
}

// ไม่บันทึกการดึง log ของหน้า Log Monitor เอง (อัปเดตทุก 10 วินาที จะทำให้ log รก)
const SKIP_PATHS = ["/logmonitor/api/logs"];

function requestLogger(req, res, next) {
  if (!ENABLED) return next();
  const p = String(req.originalUrl || req.url || "").split("?")[0];
  if (SKIP_PATHS.includes(p)) return next();
  const start = process.hrtime.bigint();
  let done = false;
  const finish = (aborted) => {
    if (done) return;
    done = true;
    try {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const status = aborted ? 499 : res.statusCode;
      const body = req.body || {};
      write(status >= 500 ? "ERROR" : status >= 400 ? "WARN" : "INFO", {
        type: "request",
        method: req.method,
        url: safeUrl(req),
        status,
        ms: Math.round(ms * 10) / 10,
        ip: clientIp(req),
        uinfoid: userOf(req),
        shopid: body.shopid || (req.query && req.query.shopid) || undefined,
        ordernumber: body.ordernumber || undefined,
        terminalid: body.terminalid || undefined,
        bytes: Number(res.getHeader("content-length")) || undefined,
        ua: req.headers["user-agent"] ? String(req.headers["user-agent"]).slice(0, 200) : undefined,
        aborted: aborted || undefined,
      });
    } catch (e) {
      // ignore
    }
  };
  res.on("finish", () => finish(false));
  res.on("close", () => finish(!res.writableFinished));
  next();
}

// ---------------- error / warning ของ server ----------------

function fmtArgs(args) {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (a && typeof a === "object") {
        try {
          return JSON.stringify(a);
        } catch (e) {
          return String(a);
        }
      }
      return String(a);
    })
    .join(" ")
    .slice(0, 8000);
}

let consoleHooked = false;
// เก็บ console.error / console.warn (เช่น handleError, error ของ cron) ลงไฟล์ด้วย
function hookConsole() {
  if (consoleHooked || !ENABLED) return;
  consoleHooked = true;
  console.error = (...args) => {
    origConsole.error(...args);
    write("ERROR", { type: "error", msg: fmtArgs(args) });
  };
  console.warn = (...args) => {
    origConsole.warn(...args);
    write("WARN", { type: "warn", msg: fmtArgs(args) });
  };
  process.on("uncaughtException", (err) => {
    write("ERROR", { type: "uncaughtException", msg: fmtArgs([err]) });
    origConsole.error(err);
    // คงพฤติกรรมเดิมของ Node : ปิด process แล้วให้ pm2 เปิดใหม่
    setTimeout(() => process.exit(1), 200);
  });
  process.on("unhandledRejection", (reason) => {
    write("ERROR", { type: "unhandledRejection", msg: fmtArgs([reason]) });
  });
}

// ---------------- ลบไฟล์เกิน N วัน ----------------

// ลบไฟล์ system-YYYY-MM-DD.log ที่วันที่ในชื่อไฟล์เก่ากว่า N วัน (เก็บวันนี้ + N วันย้อนหลัง)
function cleanupOldLogs(now = new Date()) {
  const result = { dir: LOG_DIR, retentionDays: RETENTION_DAYS, deleted: [], kept: 0 };
  if (!fs.existsSync(LOG_DIR)) return result;
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - RETENTION_DAYS);
  for (const name of fs.readdirSync(LOG_DIR)) {
    const m = name.match(FILE_RE);
    if (!m) continue;
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (day < cutoff) {
      try {
        fs.unlinkSync(path.join(LOG_DIR, name));
        result.deleted.push(name);
      } catch (e) {
        if (e.code !== "ENOENT") origConsole.warn("[SystemLog] delete failed:", name, e.message);
      }
    } else {
      result.kept += 1;
    }
  }
  if (result.deleted.length) write("INFO", { type: "cleanup", deleted: result.deleted, retentionDays: RETENTION_DAYS });
  return result;
}

// เรียกตอนเปิด server : hook console + ลบไฟล์เก่า + ตั้ง cron ลบทุกวัน 00:15
function startSystemLog(cron) {
  if (!ENABLED) {
    origConsole.warn("[SystemLog] disabled (SYSTEM_LOG_ENABLED=false)");
    return;
  }
  hookConsole();
  try {
    cleanupOldLogs();
  } catch (e) {
    origConsole.warn("[SystemLog] cleanup failed:", e.message);
  }
  if (cron) {
    cron.schedule("15 0 * * *", () => {
      try {
        cleanupOldLogs();
      } catch (e) {
        origConsole.warn("[SystemLog] cleanup failed:", e.message);
      }
    });
  }
  write("INFO", { type: "start", msg: "POS Server started", dir: LOG_DIR, retentionDays: RETENTION_DAYS });
}

module.exports = { requestLogger, startSystemLog, cleanupOldLogs, write, LOG_DIR, RETENTION_DAYS };
