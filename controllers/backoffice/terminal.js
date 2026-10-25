// =====================================================================
// ตั้งค่าเครื่อง POS (terminalid ผูกกับร้าน)  — เฉพาะสิทธิ์ Admin
//   GET  /api/backoffice/terminallist     ?search=&shopid=
//   POST /api/backoffice/terminalcreate   { terminalid, shopid, terminalname?, details?, status? }
//   PUT  /api/backoffice/terminalupdate   { terminalid, newterminalid?, shopid?, terminalname?, details?, status? }
// ใช้คู่กับ /api/pos/signin : ล็อกอินได้เฉพาะเครื่องของร้านตัวเอง
// =====================================================================
const { db } = require("../../db/postgresql");
const date = require("date-and-time");
const jwt = require("jsonwebtoken");
const { checkString, validateApiKey, checkAuthorizetion, eventlog } = require("../../modules/fun");

require("dotenv").config();

const timeout = 60000;

const fmt = (ts) => (ts ? date.format(new Date(Number(ts) * 1000), "YYYY-MM-DD HH:mm") : null);

// ตรวจ key + token + ต้องเป็น Admin
async function requireAdmin(req) {
  await validateApiKey(req);
  await checkAuthorizetion(req);
  const { uinfoid } = jwt.verify(req.headers.authorization.split(" ")[1], process.env.JWT_SECRET);
  const user = await db("userinfo").select("level").where({ uinfoid, status: true }).first();
  if (!user || user.level !== "Admin") {
    throw { status: 403, message: "Admin only" };
  }
}

function toBool(v, def) {
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "boolean") return v;
  return ["true", "1", "active"].includes(String(v).toLowerCase());
}

function run(res, logic, onSuccess) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );
  Promise.race([logic(), timeoutPromise])
    .then(async (data) => {
      if (onSuccess) await onSuccess(data);
      res.json(data);
    })
    .catch((error) => {
      if (error && error.status) {
        const msg = typeof error.message === "string" ? error.message : "Unauthorized";
        res.status(error.status).json({ message: msg });
      } else if (error && error.message === "Request timed out") {
        res.status(402).json({ message: "Request timed out" });
      } else {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error", error: error && error.message });
      }
    });
}

// รายการเครื่อง POS ทั้งหมด (พร้อมชื่อร้าน และสถานะ online จาก heartbeat)
exports.terminallist = (req, res) => {
  run(res, async () => {
    await requireAdmin(req);

    const search = String(req.query.search || "").trim();
    const shopid = String(req.query.shopid || "").trim();

    const rows = await db("terminalinfo as t")
      .leftJoin("shopinfo as s", "s.shopid", "t.shopid")
      .modify((q) => {
        if (shopid) q.where("t.shopid", shopid);
        if (search) {
          q.andWhere(function () {
            this.where("t.terminalid", "ilike", `%${search}%`)
              .orWhere("t.terminalname", "ilike", `%${search}%`)
              .orWhere("s.shopnameth", "ilike", `%${search}%`)
              .orWhere("t.shopid", "ilike", `%${search}%`);
          });
        }
      })
      .select("t.terminalid", "t.shopid", "s.shopnameth", "t.terminalname", "t.details", "t.status", "t.create_at", "t.update_at")
      .orderBy([{ column: "t.shopid" }, { column: "t.terminalid" }]);

    // สถานะ online ต่อเครื่อง (heartbeat ภายใน 5 นาที)
    const hb = rows.length
      ? await db("terminal_heartbeat")
          .whereIn("terminalid", rows.map((r) => r.terminalid))
          .select("shopid", "terminalid", "last_seen", "logged_in")
      : [];
    const now = Math.floor(Date.now() / 1000);
    const hbMap = new Map(hb.map((h) => [`${h.shopid}|${h.terminalid}`, h]));

    const result = rows.map((r) => {
      const h = hbMap.get(`${r.shopid}|${r.terminalid}`);
      const lastSeen = h ? Number(h.last_seen) : null;
      return {
        terminalid: r.terminalid,
        shopid: r.shopid,
        shopnameth: r.shopnameth || "-",
        terminalname: r.terminalname || "",
        details: r.details || "",
        status: r.status === true,
        online: !!(h && h.logged_in === true && now - lastSeen <= 300),
        last_seen: lastSeen ? fmt(lastSeen) : null,
        create_at: fmt(r.create_at),
        update_at: fmt(r.update_at),
      };
    });

    return { total: result.length, result };
  });
};

// เพิ่มเครื่อง POS
exports.terminalcreate = (req, res) => {
  let created;
  run(
    res,
    async () => {
      await requireAdmin(req);

      const terminalid = String(req.body.terminalid || "").trim();
      const shopid = String(req.body.shopid || "").trim();
      const terminalname = req.body.terminalname ? String(req.body.terminalname).trim().slice(0, 100) : null;
      const details = req.body.details ? String(req.body.details).slice(0, 500) : null;
      const status = toBool(req.body.status, true);

      if (!terminalid || !checkString(terminalid)) {
        throw { status: 400, message: "terminalid is required (a-z, 0-9, _ , -)" };
      }
      if (!shopid || !checkString(shopid)) {
        throw { status: 400, message: "shopid is required" };
      }

      const shop = await db("shopinfo").select("shopid", "shopnameth").where({ shopid, status: true }).first();
      if (!shop) throw { status: 404, message: "shopid not found" };

      const exists = await db("terminalinfo").select("terminalid", "shopid").where({ terminalid }).first();
      if (exists) throw { status: 409, message: `terminalid already exists (shop ${exists.shopid})` };

      const now = Math.floor(Date.now() / 1000);
      await db("terminalinfo").insert({ terminalid, shopid, terminalname, details, status, create_at: now, update_at: now });

      created = { terminalid, shopnameth: shop.shopnameth };
      return { terminalid, shopid, message: "Create terminal Success" };
    },
    async () => {
      await eventlog(req, `เพิ่มเครื่อง POS "${created.terminalid}" ร้าน ${created.shopnameth}`);
    }
  );
};

// แก้ไขเครื่อง POS (เปลี่ยนร้าน / ชื่อ / รายละเอียด / เปิด-ปิดใช้งาน / เปลี่ยน terminalid)
exports.terminalupdate = (req, res) => {
  let changed;
  run(
    res,
    async () => {
      await requireAdmin(req);

      const terminalid = String(req.body.terminalid || "").trim();
      if (!terminalid || !checkString(terminalid)) {
        throw { status: 400, message: "terminalid is required" };
      }

      const current = await db("terminalinfo").select("*").where({ terminalid }).first();
      if (!current) throw { status: 404, message: "terminalid not found" };

      const update = { update_at: Math.floor(Date.now() / 1000) };

      if (req.body.newterminalid !== undefined && String(req.body.newterminalid).trim() !== terminalid) {
        const newId = String(req.body.newterminalid).trim();
        if (!newId || !checkString(newId)) throw { status: 400, message: "newterminalid is invalid (a-z, 0-9, _ , -)" };
        const dup = await db("terminalinfo").select("terminalid").where({ terminalid: newId }).first();
        if (dup) throw { status: 409, message: "newterminalid already exists" };
        update.terminalid = newId;
      }

      if (req.body.shopid !== undefined) {
        const shopid = String(req.body.shopid).trim();
        if (!shopid || !checkString(shopid)) throw { status: 400, message: "shopid is invalid" };
        const shop = await db("shopinfo").select("shopid").where({ shopid, status: true }).first();
        if (!shop) throw { status: 404, message: "shopid not found" };
        update.shopid = shopid;
      }

      if (req.body.terminalname !== undefined) update.terminalname = String(req.body.terminalname || "").trim().slice(0, 100) || null;
      if (req.body.details !== undefined) update.details = String(req.body.details || "").slice(0, 500) || null;
      if (req.body.status !== undefined) update.status = toBool(req.body.status, current.status);

      await db("terminalinfo").where({ terminalid }).update(update);

      // ย้ายร้าน / ปิดใช้งาน -> ให้ไฟสถานะเครื่องเดิมเป็น offline ทันที
      if ((update.shopid && update.shopid !== current.shopid) || update.status === false || update.terminalid) {
        await db("terminal_heartbeat").where({ terminalid }).update({ logged_in: false });
      }

      const finalId = update.terminalid || terminalid;
      changed = finalId;
      return { terminalid: finalId, message: "Update terminal Success" };
    },
    async () => {
      await eventlog(req, `แก้ไขเครื่อง POS "${changed}"`);
    }
  );
};
