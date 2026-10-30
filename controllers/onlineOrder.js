// =====================================================================
// POST /api/orderinsert  — รับออเดอร์ Online จากระบบภายนอก
//   เก็บแยกจาก order หลัก (orderinfo) ลงตาราง onlineorderinfo + onlineorderdetail
//   ไม่เก็บ buyerName (ข้อมูลส่วนบุคคล)
//   ร้านของออเดอร์: body.shopid -> ร้านเจ้าของ X-API-KEY -> ร้านของ productCode ใน items
// =====================================================================
const { db } = require("../db/postgresql");
const { uuid } = require("uuidv4");
const { checkString, validateApiKey, handleError, eventlogOpenAPI } = require("../modules/fun");

require("dotenv").config();

const timeout = 60000;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v, max = 255) => (v === undefined || v === null ? null : String(v).trim().slice(0, max));

// หา shopid ของออเดอร์
async function resolveShopId(req, items) {
  const bodyShop = str(req.body.shopid, 100);
  if (bodyShop) {
    if (!checkString(bodyShop)) throw { status: 400, message: "shopid is invalid" };
    const shop = await db("shopinfo").select("shopid").where({ shopid: bodyShop, status: true }).first();
    if (!shop) throw { status: 404, message: "shopid not found" };
    return bodyShop;
  }

  // API key ของร้านใดร้านหนึ่ง
  const key = req.headers["x-api-key"] || "";
  const byKey = await db("shopinfo").select("shopid").where({ apikey: key, status: true });
  if (byKey.length === 1) return byKey[0].shopid;

  // productCode ตรงกับสินค้าของร้านเดียว
  const codes = [...new Set(items.map((i) => String(i.productCode || "")).filter(Boolean))];
  if (codes.length) {
    const shops = await db("productinfo").distinct("shopid").whereIn("productid", codes).andWhere({ status: true });
    if (shops.length === 1) return shops[0].shopid;
  }

  throw { status: 400, message: "shopid is required (cannot determine shop from API key or productCode)" };
}

function validate(body) {
  const errors = [];
  if (!str(body.orderNumber)) errors.push("orderNumber is required");
  if (!str(body.orderDateTime) || Number.isNaN(Date.parse(body.orderDateTime))) errors.push("orderDateTime is invalid (ISO 8601)");
  if (!isNum(body.netAmount)) errors.push("netAmount must be a number");
  if (!Array.isArray(body.items) || body.items.length === 0) {
    errors.push("items must be a non-empty array");
  } else {
    body.items.forEach((it, i) => {
      if (!it || typeof it !== "object") return errors.push(`items[${i}] is invalid`);
      if (!str(it.productCode)) errors.push(`items[${i}].productCode is required`);
      if (!isNum(it.quantity)) errors.push(`items[${i}].quantity must be a number`);
      if (!isNum(it.unitPrice)) errors.push(`items[${i}].unitPrice must be a number`);
      if (it.discount !== undefined && it.discount !== null && !isNum(it.discount)) errors.push(`items[${i}].discount must be a number`);
    });
  }
  const p = body.payment;
  if (p !== undefined && p !== null) {
    if (typeof p !== "object") errors.push("payment must be an object");
    else if (p.time && Number.isNaN(Date.parse(p.time))) errors.push("payment.time is invalid (ISO 8601)");
  }
  return errors;
}

exports.orderinsert = (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const logic = (async () => {
    await validateApiKey(req);

    const body = req.body || {};
    const errors = validate(body);
    if (errors.length) throw { status: 400, message: errors.join(", ") };

    const items = body.items;
    const shopid = await resolveShopId(req, items);
    const ordernumber = str(body.orderNumber);

    const exists = await db("onlineorderinfo").select("onlineorderid").where({ ordernumber }).first();
    if (exists) throw { status: 409, message: "orderNumber already exists" };

    const payment = body.payment || {};
    const onlineorderid = uuid();
    const now = Math.floor(Date.now() / 1000);

    await db.transaction(async (trx) => {
      await trx("onlineorderinfo").insert({
        onlineorderid,
        shopid,
        ordernumber,
        receiptnumber: str(body.receiptNumber),
        referencenumber: str(body.referenceNumber),
        orderdatetime: body.orderDateTime,                                   // PostgreSQL เก็บเป็น timestamptz (รองรับ microsecond)
        ordertimestamp: Math.floor(Date.parse(body.orderDateTime) / 1000),   // epoch วินาที ใช้กรองช่วงเวลา
        orderstatus: str(body.orderStatus, 50),
        deliveryoption: str(body.deliveryOption, 50),
        netamount: body.netAmount,
        paymentchannel: str(payment.channel, 100),
        paymenttime: payment.time || null,
        paymenttransactionnumber: str(payment.transactionNumber),
        create_at: now,
        update_at: now,
      });

      await trx("onlineorderdetail").insert(
        items.map((it, i) => ({
          id: uuid(),
          onlineorderid,
          linenumber: i + 1,
          productcode: str(it.productCode),
          productname: str(it.productName),
          quantity: it.quantity,
          unitprice: it.unitPrice,
          discount: isNum(it.discount) ? it.discount : 0,
          create_at: now,
        }))
      );
    });

    return { orderNumber: ordernumber, shopid, message: "Insert order Success" };
  })();

  Promise.race([logic, timeoutPromise])
    .then(async (data) => {
      await eventlogOpenAPI(req, `รับออเดอร์ Online "${data.orderNumber}"`);
      res.json(data);
    })
    .catch((error) => {
      if (error && error.status) {
        res.status(error.status).json({ message: error.message });
      } else if (error && error.message === "Request timed out") {
        res.status(402).json({ message: "Request timed out" });
      } else if (error && error.code === "23505") {
        // ยิงซ้ำพร้อมกัน -> ชน unique ordernumber
        res.status(409).json({ message: "orderNumber already exists" });
      } else {
        handleError(error, res);
      }
    });
};
