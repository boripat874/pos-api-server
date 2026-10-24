// รายงานสินค้าคงเหลือ (Backoffice)
const { db } = require("../../db/postgresql");
const date = require("date-and-time");
const jwt = require("jsonwebtoken");

const { checkString, validateApiKey, checkAuthorizetion, handleError } = require("../../modules/fun");

require("dotenv").config();

const timeout = 60000;

// "#เผ็ดมาก#เผ็ดน้อย#ไม่ผัก" -> "เผ็ดมาก, เผ็ดน้อย, ไม่ผัก"
function formatAdditional(str) {
  if (!str) return "";
  return String(str)
    .split("#")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

// รองรับทั้ง epoch วินาที (ตัวเลข/สตริง) และ timestamp จาก DB
function toEpochSeconds(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Math.floor(v.getTime() / 1000);
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n); // กันกรณีเก็บเป็น ms
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

function fmt(ts) {
  return ts ? date.format(new Date(ts * 1000), "YYYY-MM-DD HH:mm") : "-";
}

// ร้านที่ผู้ใช้มีสิทธิ์ดู
//   Admin            -> ทุกร้าน
//   Owner            -> ร้านในกลุ่มร้านของตัวเอง (ugroupid)
//   Manager/Employee -> เฉพาะร้านตัวเอง
async function allowedShops(req) {
  const token = req.headers.authorization.split(" ")[1];
  const { uinfoid } = jwt.verify(token, process.env.JWT_SECRET);

  const user = await db("userinfo").select("level", "shopid", "ugroupid").where({ uinfoid }).first();
  if (!user) throw { status: 402, message: "User not found" };

  const q = db("shopinfo").select("shopid", "shopnameth").where({ status: true });
  if (user.level === "Admin") {
    // ทุกร้าน
  } else if (user.level === "Owner") {
    q.andWhere({ ugroupid: user.ugroupid });
  } else if (user.level === "Manager" || user.level === "Employee") {
    q.andWhere({ shopid: user.shopid });
  } else {
    throw { status: 403, message: "Forbidden" };
  }
  return { level: user.level, shops: await q };
}

// POST /backoffice/reportinventorylist   body: { shopid: "<shopid>" | "all" }   query: ?search=
exports.reportinventorylist = (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const logic = new Promise(async (resolve, reject) => {
    try {
      await validateApiKey(req);
      await checkAuthorizetion(req);

      const search = String(req.query.search || "").trim();
      const shopid = String(req.body.shopid || "");
      if (!shopid || (shopid !== "all" && !checkString(shopid))) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const { level, shops } = await allowedShops(req);
      const allowedIds = shops.map((s) => s.shopid);

      let shopIds;
      if (shopid === "all") {
        shopIds = allowedIds;
      } else if (allowedIds.includes(shopid)) {
        shopIds = [shopid];
      } else {
        return reject({ status: 403, message: "ไม่มีสิทธิ์ดูรายงานของร้านนี้" });
      }
      if (!shopIds.length) return resolve({ level, total: 0, result: [] });

      const rows = await db("productinfo as p")
        .leftJoin("productcategoryinfo as c", function () {
          this.on("c.productCgtyId", "=", "p.productCgtyId").andOn("c.shopid", "=", "p.shopid");
        })
        .leftJoin("shopinfo as s", "s.shopid", "p.shopid")
        .whereIn("p.shopid", shopIds)
        .andWhere("p.status", true)
        .modify((qb) => {
          if (search) {
            qb.andWhere(function () {
              this.where("p.productnameth", "ilike", `%${search}%`)
                .orWhere("p.productnameeng", "ilike", `%${search}%`)
                .orWhere("c.categoryname", "ilike", `%${search}%`);
            });
          }
        })
        .select(
          "p.productid",
          "p.shopid",
          "s.shopnameth",
          "c.categoryname",
          "p.productnameth",
          "p.productnameeng",
          "p.productdatath",
          "p.productdataeng",
          "p.productprice",
          "p.additional",
          "p.productremain",
          "p.create_at",
          "p.update_at",
          "p.update_PRemain"
        )
        .orderBy([{ column: "s.shopnameth" }, { column: "c.categoryname" }, { column: "p.productnameth" }]);

      const result = rows.map((r) => {
        const created = toEpochSeconds(r.create_at);
        // อัพเดตล่าสุด = ล่าสุดระหว่าง แก้ไขข้อมูลสินค้า (update_at) กับ ปรับจำนวนคงเหลือ (update_PRemain)
        const updated = Math.max(toEpochSeconds(r.update_at) || 0, toEpochSeconds(r.update_PRemain) || 0) || null;
        return {
          productid: r.productid,
          shopid: r.shopid,
          shopnameth: r.shopnameth || "",
          create_at: fmt(created),
          update_at: fmt(updated),
          categoryname: r.categoryname || "-",
          productnameth: r.productnameth || "",
          productnameeng: r.productnameeng || "",
          productdatath: r.productdatath || "",
          productdataeng: r.productdataeng || "",
          productprice: Number(r.productprice) || 0,
          additional: formatAdditional(r.additional),
          productremain: Number(r.productremain) || 0,
        };
      });

      resolve({ level, total: result.length, result });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([logic, timeoutPromise])
    .then((data) => res.send(data))
    .catch((error) => {
      if (error.status) {
        res.status(error.status).json({ message: error.message });
      } else if (error.message === "Request timed out") {
        res.status(402).json({ message: "Request timed out" });
      } else {
        handleError(error, res);
      }
    });
};

exports._test = { formatAdditional, toEpochSeconds };
