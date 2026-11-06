// =====================================================================
// แบ่งชำระ (Split payment) : ค่าคงที่และฟังก์ชันที่ใช้ร่วมกัน (POS + Backoffice)
//   ตาราง orderpayment (หัวรายการ) / orderpaymentline (แต่ละส่วน)
// =====================================================================
const { db } = require("../db/postgresql");

const PAYMENT_TYPES = { 1: "Credit Card", 2: "PromptPay", 3: "E-wallet", 4: "เงินสด" };
const PAYMENTTYPE_CASH = 4;
const PAYMENTTYPE_SPLIT = 5; // receiptinfo.paymentType / orderinfo.orderpaytype ของบิลแบ่งชำระ
const MAX_SPLIT_LINES = 3;

// orderpayment.paymentstatus
const PAY = { PAYING: 0, PAID: 1, CANCELLED: 2, REFUNDED: 3 };
const PAY_NAME = { 0: "กำลังชำระ", 1: "ชำระครบ", 2: "ยกเลิกระหว่างชำระ", 3: "คืนเงินแล้ว" };

// orderpaymentline.linestatus
const LINE = { PENDING: 0, SUCCESS: 1, FAILED: 2, CANCELLED: 3, REFUNDED: 4 };
const LINE_NAME = { 0: "รอชำระ", 1: "สำเร็จ", 2: "ไม่สำเร็จ", 3: "ยกเลิก", 4: "คืนเงินแล้ว" };

const TXN_REGEX = /^[0-9a-zA-Z_-]{1,100}$/;

// เงินเป็นสตางค์ (จำนวนเต็ม) เพื่อเลี่ยงทศนิยมคลาดเคลื่อน
const toCents = (v) => Math.round(Number(v) * 100);
const fromCents = (c) => Math.round(c) / 100;

function isMoney(v) {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
}

function paymentTypeName(t) {
  return PAYMENT_TYPES[Number(t)] || null;
}

// "เงินสด 50 + PromptPay 50"
function paymentText(lines) {
  const ok = (lines || []).filter((l) => l.amount !== undefined);
  if (!ok.length) return null;
  if (ok.length === 1) return paymentTypeName(ok[0].paymenttype);
  return ok
    .map((l) => `${paymentTypeName(l.paymenttype)} ${Number(l.amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`)
    .join(" + ");
}

function lineView(l) {
  return {
    lineno: Number(l.lineno),
    transactionid: l.transactionid,
    paymenttype: Number(l.paymenttype),
    paymenttypename: paymentTypeName(l.paymenttype),
    amount: Number(l.amount),
    cashreceived: Number(l.cashreceived) || 0,
    cashchange: Number(l.cashchange) || 0,
    refno: l.refno || null,
    linestatus: Number(l.linestatus),
    linestatusname: LINE_NAME[Number(l.linestatus)] || null,
    failreason: l.failreason || null,
    paid_at: l.paid_at ? Number(l.paid_at) : null,
  };
}

// การชำระล่าสุดของแต่ละออเดอร์ (ที่ผูกกับใบเสร็จ หรือชำระครบ/คืนเงินแล้ว) + ส่วนที่ชำระสำเร็จ/คืนเงินแล้ว
//   คืนค่า Map<ordernumber, { paymentstatus, paymentstatusname, issplit, refund..., payments[] }>
async function loadPayments(ordernumbers, trx = db) {
  const out = new Map();
  const list = [...new Set((ordernumbers || []).filter(Boolean))];
  if (!list.length) return out;

  const heads = [];
  for (let i = 0; i < list.length; i += 1000) {
    const rows = await trx("orderpayment")
      .whereIn("ordernumber", list.slice(i, i + 1000))
      .whereIn("paymentstatus", [PAY.PAID, PAY.REFUNDED])
      .select("*")
      .orderBy("create_at", "asc");
    heads.push(...rows);
  }
  // ออเดอร์ละ 1 รายการ: ใช้รายการล่าสุด
  const headByOrder = new Map();
  heads.forEach((h) => headByOrder.set(h.ordernumber, h));
  const ids = [...headByOrder.values()].map((h) => h.orderpaymentid);

  const lines = [];
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await trx("orderpaymentline")
      .whereIn("orderpaymentid", ids.slice(i, i + 1000))
      .whereIn("linestatus", [LINE.SUCCESS, LINE.REFUNDED])
      .select("*")
      .orderBy("lineno", "asc");
    lines.push(...rows);
  }
  const linesById = new Map();
  lines.forEach((l) => {
    if (!linesById.has(l.orderpaymentid)) linesById.set(l.orderpaymentid, []);
    linesById.get(l.orderpaymentid).push(l);
  });

  headByOrder.forEach((h, ordernumber) => {
    const ls = (linesById.get(h.orderpaymentid) || []).map(lineView);
    out.set(ordernumber, {
      orderpaymentid: h.orderpaymentid,
      issplit: h.issplit === true,
      paymentstatus: Number(h.paymentstatus),
      paymentstatusname: PAY_NAME[Number(h.paymentstatus)] || null,
      isrefunded: Number(h.paymentstatus) === PAY.REFUNDED,
      refundreason: h.refundreason || null,
      refundby: h.refundby || null,
      refundapproveby: h.refundapproveby || null,
      refund_at: h.refund_at ? Number(h.refund_at) : null,
      paymenttext: paymentText(ls),
      payments: ls,
    });
  });
  return out;
}

// ---------------- query helpers สำหรับรายงาน (knex modify) ----------------

// ไม่นับออเดอร์ที่คืนเงินแล้ว (orderpayment.paymentstatus = 3)
function notRefunded(qb) {
  qb.whereNotExists(function () {
    this.select(db.raw("1"))
      .from("orderpayment")
      .whereRaw("orderpayment.ordernumber = orderinfo.ordernumber")
      .where("orderpayment.paymentstatus", PAY.REFUNDED);
  });
}

// ยอดรวมตามช่องทาง: รวม amount ของส่วนที่ชำระสำเร็จ ในการชำระที่ครบแล้ว (มีใบเสร็จ)
//   คืน knex query ที่ join orderinfo แล้ว เพื่อเติมเงื่อนไขร้าน/ช่วงเวลา/สถานะออเดอร์ต่อได้
function sumByPaymentTypeQuery(paymenttype, alias) {
  return db("orderpaymentline as pl")
    .join("orderpayment as op", "op.orderpaymentid", "pl.orderpaymentid")
    .join("orderinfo", "orderinfo.ordernumber", "op.ordernumber")
    .sum(`pl.amount as ${alias}`)
    .where("pl.paymenttype", paymenttype)
    .andWhere("pl.linestatus", LINE.SUCCESS)
    .andWhere("op.paymentstatus", PAY.PAID)
    .whereNotNull("op.receiptid");
}

module.exports = {
  PAYMENT_TYPES,
  PAYMENTTYPE_CASH,
  PAYMENTTYPE_SPLIT,
  MAX_SPLIT_LINES,
  PAY,
  PAY_NAME,
  LINE,
  LINE_NAME,
  TXN_REGEX,
  toCents,
  fromCents,
  isMoney,
  paymentTypeName,
  paymentText,
  lineView,
  loadPayments,
  notRefunded,
  sumByPaymentTypeQuery,
};
