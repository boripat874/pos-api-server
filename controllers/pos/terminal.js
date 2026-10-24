// =====================================================================
// POST /api/pos/terminalheartbeat
// เครื่อง POS ยิงเข้ามาเรื่อยๆ (แนะนำทุก 60 วินาที) ขณะที่ user login อยู่
//   headers : X-API-KEY, Authorization: Bearer <token จาก /api/pos/signin>
//   body    : { terminalid: "T01", shopid?: "SHOP01", appversion?: "1.0.0", status?: "online" | "logout" }
// ไม่มีอัปเดตภายใน 5 นาที -> Backoffice แสดงสีเทา และ openApi ไม่ส่ง slot ให้ App
// =====================================================================
const { db } = require("../../db/postgresql");
const jwt = require("jsonwebtoken");
const { checkString, validateApiKey, checkAuthorizetion } = require("../../modules/fun");
const { handleError } = require("../error_funtion");
const { ONLINE_WINDOW_SEC, nowSec } = require("../../modules/terminalStatus");

require("dotenv").config();

const timeout = 60000;

exports.terminalheartbeat = (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const logic = new Promise(async (resolve, reject) => {
    try {
      await validateApiKey(req);       // เช็ค API key
      await checkAuthorizetion(req);   // เช็ค user login (JWT ยังไม่หมดอายุ / ไม่ถูก revoke / user มีอยู่)

      const { uinfoid } = jwt.verify(req.headers.authorization.split(" ")[1], process.env.JWT_SECRET);
      const user = await db("userinfo")
        .select("uinfoid", "shopid", "ugroupid", "level", "status")
        .where({ uinfoid })
        .first();
      if (!user || user.status === false) {
        return reject({ status: 401, message: "User is not active" });
      }

      const terminalid = String(req.body.terminalid || "").trim();
      const shopid = String(req.body.shopid || user.shopid || "").trim();
      const action = String(req.body.status || "online").toLowerCase();
      const appversion = req.body.appversion ? String(req.body.appversion).slice(0, 50) : null;

      if (!terminalid || !checkString(terminalid)) {
        return reject({ status: 400, message: "terminalid is required (a-z, 0-9, _ , -)" });
      }
      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "shopid is required" });
      }
      if (!["online", "logout"].includes(action)) {
        return reject({ status: 400, message: 'status must be "online" or "logout"' });
      }

      const shop = await db("shopinfo").select("shopid", "ugroupid", "status").where({ shopid }).first();
      if (!shop || shop.status === false) {
        return reject({ status: 404, message: "shopid not found" });
      }

      // user ต้องมีสิทธิ์ในร้านนี้
      const allowed =
        user.level === "Admin" ||
        (user.level === "Owner" && user.ugroupid === shop.ugroupid) ||
        user.shopid === shopid;
      if (!allowed) {
        return reject({ status: 403, message: "User is not allowed for this shop" });
      }

      const now = nowSec();
      await db("terminal_heartbeat")
        .insert({
          shopid,
          terminalid,
          uinfoid,
          ipaddress: req.ip,
          appversion,
          logged_in: action === "online",
          last_seen: now,
        })
        .onConflict(["shopid", "terminalid"])
        .merge(["uinfoid", "ipaddress", "appversion", "logged_in", "last_seen"]);

      resolve({
        shopid,
        terminalid,
        status: action === "online" ? "online" : "offline",
        server_time: now,
        online_window_sec: ONLINE_WINDOW_SEC,
        message: "Heartbeat received",
      });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([logic, timeoutPromise])
    .then((data) => res.json(data))
    .catch((error) => {
      if (error.status) {
        const msg = typeof error.message === "string" ? error.message : (error.message && error.message.message) || "Unauthorized";
        res.status(error.status).json({ message: msg });
      } else if (error.message === "Request timed out") {
        res.status(402).json({ message: "Request timed out" });
      } else {
        console.error(error);
        handleError(error, res);
      }
    });
};

// เรียกตอน POS signout: ให้ไฟเป็นสีเทาทันที ไม่ต้องรอ 5 นาที
exports.markUserTerminalsLoggedOut = async (uinfoid) => {
  if (!uinfoid) return;
  try {
    await db("terminal_heartbeat").where({ uinfoid }).update({ logged_in: false });
  } catch (e) {
    console.warn("terminal_heartbeat logout update failed:", e.message);
  }
};
