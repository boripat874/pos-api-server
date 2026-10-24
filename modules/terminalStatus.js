// =====================================================================
// สถานะเครื่อง POS (Terminal) ของแต่ละร้าน จาก heartbeat ที่เครื่อง POS ยิงเข้ามา
//   Online  = มี terminal ที่ login อยู่ และส่ง heartbeat ล่าสุดภายใน 5 นาที
//   Offline = ไม่มีอัปเดตเกิน 5 นาที / logout แล้ว / ไม่เคยส่ง
// ใช้กับ Dashboard (overview, shopdetail)
// =====================================================================
const { db } = require("../db/postgresql");

const ONLINE_WINDOW_SEC = Number(process.env.TERMINAL_ONLINE_WINDOW_SEC) || 300; // 5 นาที

// openApi availableslot ใช้ logic เดิม (ไม่ได้ตัด slot ตามสถานะ terminal)
// ค่านี้ใช้แค่แสดงผลบน Dashboard (slot_to_app) ; ค่าเริ่มต้น false = App ได้ slot เสมอ
const SLOT_REQUIRE_TERMINAL_ONLINE = String(process.env.SLOT_REQUIRE_TERMINAL_ONLINE ?? "false").toLowerCase() === "true";

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * สถานะ terminal ของหลายร้าน
 * @returns Map<shopid, { online, last_seen, last_seen_ago_sec, online_terminals, total_terminals, uinfoname, terminalid }>
 */
async function getTerminalStatus(shopIds) {
  const result = new Map();
  if (!shopIds || !shopIds.length) return result;

  const rows = await db("terminal_heartbeat as t")
    .leftJoin("userinfo as u", "u.uinfoid", "t.uinfoid")
    .whereIn("t.shopid", shopIds)
    .select("t.shopid", "t.terminalid", "t.last_seen", "t.logged_in", "u.uinfoname")
    .orderBy("t.last_seen", "desc");

  const now = nowSec();
  for (const shopid of shopIds) {
    result.set(shopid, {
      online: false,
      last_seen: null,
      last_seen_ago_sec: null,
      online_terminals: 0,
      total_terminals: 0,
      uinfoname: null,
      terminalid: null,
    });
  }

  for (const r of rows) {
    const s = result.get(r.shopid);
    if (!s) continue;
    const lastSeen = Number(r.last_seen) || 0;
    const isOnline = r.logged_in === true && now - lastSeen <= ONLINE_WINDOW_SEC;

    s.total_terminals++;
    if (isOnline) s.online_terminals++;
    // rows เรียง last_seen ล่าสุดก่อน -> แถวแรกของร้าน = เครื่องล่าสุด
    if (s.last_seen === null) {
      s.last_seen = lastSeen || null;
      s.last_seen_ago_sec = lastSeen ? now - lastSeen : null;
      s.uinfoname = r.uinfoname || null;
      s.terminalid = r.terminalid;
    }
  }
  for (const s of result.values()) s.online = s.online_terminals > 0;
  return result;
}

async function isShopTerminalOnline(shopid) {
  const m = await getTerminalStatus([shopid]);
  return m.get(shopid).online;
}

module.exports = {
  ONLINE_WINDOW_SEC,
  SLOT_REQUIRE_TERMINAL_ONLINE,
  getTerminalStatus,
  isShopTerminalOnline,
  nowSec,
};
