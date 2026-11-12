// =====================================================================
// ตัด / คืนสต็อกสินค้า (productinfo.productremain) ตามออเดอร์ : POS_Server 1.0.9
//   - สร้างออเดอร์สำเร็จ -> ลด productremain ตาม qty (ติดลบได้)
//   - แก้ไขออเดอร์      -> ปรับตามส่วนต่าง
//   - ยกเลิก (3,4,8,9) / คืนเงิน / ลบออเดอร์ -> บวกคืนเท่าที่ตัดไป
//   ทุกการเปลี่ยนแปลงบันทึกในตาราง productstockmovement (ใช้ตรวจสอบ และกันการคืนซ้ำ)
//   ออเดอร์ Online จากระบบภายนอก (/api/pos/orderinsert) ไม่ตัดสต็อก (แยก stock กัน)
//   ออเดอร์ ZooApp (ordertype 0) ของร้านของที่ระลึก (SOUVENIRS) และร้านขายตั๋ว (TICKET) ไม่ตัดสต็อก POS (แยก stock)
//   ร้านอาหารตัด / คืนตามปกติ
// =====================================================================
const { db } = require("../db/postgresql");
const { uuid } = require("uuidv4");

const CANCELLED_ORDERSTATUS = [3, 4, 8, 9];
const isCancelledStatus = (s) => s !== null && s !== undefined && CANCELLED_ORDERSTATUS.includes(Number(s));

const ORDERTYPE_ZOOAPP = 0;            // orderinfo.ordertype : 0 = Online (ZooApp), 1 = POS
const SHOPTYPE_SEPARATE_STOCK = ["SOUVENIRS", "TICKET"]; // ร้านที่ ZooApp แยก stock กับ POS (ของที่ระลึก, ขายตั๋ว)

// ออเดอร์นี้ต้องตัดสต็อก POS หรือไม่
async function isStockTracked(trx, { shopid, ordertype }) {
  if (ordertype === undefined || ordertype === null || Number(ordertype) !== ORDERTYPE_ZOOAPP) return true;
  const shop = await trx("shopinfo").select("shoptype").where({ shopid }).first();
  const type = String((shop && shop.shoptype) || "").trim().toUpperCase();
  return !SHOPTYPE_SEPARATE_STOCK.includes(type);
}

const MOVE = {
  CREATE: "ORDER_CREATE",
  UPDATE: "ORDER_UPDATE",
  CANCEL: "ORDER_CANCEL",
  REFUND: "ORDER_REFUND",
  DELETE: "ORDER_DELETE",
};

// รวม qty ต่อสินค้า (สินค้าเดียวกันหลายบรรทัด)
function sumByProduct(items) {
  const m = new Map();
  (items || []).forEach((it) => {
    const id = String(it.productid);
    m.set(id, (m.get(id) || 0) + Number(it.qty || 0));
  });
  return m;
}

// ตรวจว่าสินค้าทุกตัวมีอยู่ในร้าน (status = true) ; ไม่พบ -> สร้าง/แก้ไขออเดอร์ไม่ได้
async function assertProductsExist(trx, shopid, items) {
  const ids = [...sumByProduct(items).keys()];
  if (!ids.length) throw { status: 402, message: "productinorder is empty" };
  const rows = await trx("productinfo").select("productid").whereIn("productid", ids).where({ shopid, status: true });
  const found = new Set(rows.map((r) => String(r.productid)));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    const names = (items || [])
      .filter((it) => missing.includes(String(it.productid)))
      .map((it) => it.productnameeng || it.productnameth || it.productid);
    throw { status: 402, message: `Product not found: ${[...new Set(names)].join(", ")}` };
  }
}

// ยอดที่ตัดไปแล้วและยังไม่คืน ต่อสินค้า (บวก = ตัดอยู่)
async function deductedByProduct(trx, ordernumber) {
  const rows = await trx("productstockmovement")
    .select("productid")
    .sum("qty as qty")
    .where({ ordernumber })
    .groupBy("productid");
  const m = new Map();
  rows.forEach((r) => {
    const v = -Number(r.qty || 0);
    if (v !== 0) m.set(String(r.productid), v);
  });
  return m;
}

// ปรับสต็อกของออเดอร์ให้ "ตัดอยู่" เท่ากับ items (items ว่าง = คืนทั้งหมด)
//   คืนค่า [{ productid, change, productremain }]
//   ordertype = 0 (ZooApp) ของร้านของฝาก -> ไม่ตัด (การคืนอิงจากที่ตัดไว้จริง จึงคืนเป็น 0 เอง)
async function syncOrderStock(trx, { ordernumber, shopid, items, movementtype, source, ordertype }) {
  if ((items || []).length && !(await isStockTracked(trx, { shopid, ordertype }))) return [];

  // ล็อกต่อออเดอร์ กันตัด/คืนซ้ำเมื่อมีคำขอพร้อมกัน (ปลดเมื่อจบ transaction)
  await trx.raw("SELECT pg_advisory_xact_lock(hashtext(?))", [String(ordernumber)]);
  const target = sumByProduct(items);
  const current = await deductedByProduct(trx, ordernumber);
  const ids = new Set([...target.keys(), ...current.keys()]);
  const now = Math.floor(Date.now() / 1000);
  const changes = [];

  for (const productid of [...ids].sort()) {
    const want = target.get(productid) || 0;
    const have = current.get(productid) || 0;
    const change = have - want; // + = บวกคืน, - = ตัดเพิ่ม
    if (change === 0) continue;

    const upd = await trx("productinfo")
      .where({ productid })
      .update({ productremain: trx.raw("productremain + ?", [change]), update_PRemain: now, update_at: now })
      .returning(["productremain"]);
    const productremain = upd && upd[0] ? Number(upd[0].productremain) : null;

    await trx("productstockmovement").insert({
      id: uuid(),
      ordernumber,
      shopid: shopid || null,
      productid,
      qty: change,
      movementtype,
      source: source || "POS",
      remainafter: productremain,
      create_at: now,
    });
    changes.push({ productid, change, productremain });
  }
  return changes;
}

// คืนสต็อกทั้งหมดของออเดอร์ (ยกเลิก / คืนเงิน / ลบ) ; คืนไปแล้วจะไม่คืนซ้ำ
function restoreOrderStock(trx, { ordernumber, shopid, movementtype, source }) {
  return syncOrderStock(trx, { ordernumber, shopid, items: [], movementtype, source });
}

module.exports = {
  CANCELLED_ORDERSTATUS,
  ORDERTYPE_ZOOAPP,
  SHOPTYPE_SEPARATE_STOCK,
  isStockTracked,
  isCancelledStatus,
  MOVE,
  assertProductsExist,
  syncOrderStock,
  restoreOrderStock,
};
