// =====================================================================
// แบ่งชำระ (Split payment) ของเครื่อง POS : บันทึกการชำระแต่ละส่วนลง server ทันที
//   POST /api/pos/paymentstart        เริ่มแบ่งชำระ 2-3 ส่วน (ทุกส่วนมี transactionid)
//   POST /api/pos/paymentstatus       ดูสถานะการชำระของออเดอร์
//   PUT  /api/pos/paymentlineupdate   บันทึกผลแต่ละส่วน (สำเร็จ / ไม่สำเร็จ / คืนเงินแล้ว)
//   PUT  /api/pos/paymentsplitupdate  เปลี่ยนสัดส่วน / ช่องทางของยอดที่ยังไม่ชำระ
//   PUT  /api/pos/paymentcancel       ยกเลิกการชำระก่อนครบยอด
//   PUT  /api/pos/orderrefund         ยกเลิก / คืนเงินทั้งใบ (บิลช่องทางเดียวและแบ่งชำระ)
// บิลช่องทางเดียวไม่ต้องเรียก paymentstart : ส่ง transactionid มากับ /api/pos/receiptcreate
// =====================================================================
const { db } = require("../../db/postgresql");
const jwt = require("jsonwebtoken");
const { uuid } = require("uuidv4");
const { checkString, validateApiKey, checkAuthorizetion, eventlog } = require("../../modules/fun");
const SP = require("../../modules/splitPayment");

require("dotenv").config();

const timeout = 60000;
const CANCELLED_ORDERSTATUS = [3, 4, 8, 9];
const now = () => Math.floor(Date.now() / 1000);
const str = (v, max = 255) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);

function run(res, logic, onSuccess) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );
  Promise.race([logic(), timeoutPromise])
    .then(async (data) => {
      if (onSuccess) {
        try {
          await onSuccess(data);
        } catch (e) {
          console.error("eventlog error:", e && e.message);
        }
      }
      res.json(data);
    })
    .catch((error) => {
      if (error && error.status) {
        const msg = typeof error.message === "string" ? error.message : "Unauthorized";
        res.status(error.status).json({ message: msg });
      } else if (error && error.message === "Request timed out") {
        res.status(402).json({ message: "Request timed out" });
      } else if (error && error.code === "23505") {
        // ชน unique : transactionid ซ้ำ หรือเริ่มชำระซ้ำพร้อมกัน
        res.status(409).json({ message: "transactionid already exists or payment is already in progress" });
      } else {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error", error: error && error.message });
      }
    });
}

// key + token -> uinfoid
async function auth(req) {
  await validateApiKey(req);
  await checkAuthorizetion(req);
  const { uinfoid } = jwt.verify(req.headers.authorization.split(" ")[1], process.env.JWT_SECRET);
  return uinfoid;
}

function requireOrdernumber(body) {
  const ordernumber = str(body.ordernumber, 100);
  if (!ordernumber || !checkString(ordernumber)) throw { status: 400, message: "ordernumber is required" };
  return ordernumber;
}

function netOf(order) {
  const net = order.orderpricenet;
  if (net !== null && net !== undefined && net !== "" && !Number.isNaN(Number(net))) return Number(net);
  return Math.max(Number(order.ordertotalprice || 0) - Number(order.ordertotaldiscount || 0), 0);
}

// ตรวจรายการส่วนใหม่ [{ transactionid, paymenttype, amount }]
function parseLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw { status: 400, message: "lines must be a non-empty array" };
  const seen = new Set();
  return lines.map((l, i) => {
    if (!l || typeof l !== "object") throw { status: 400, message: `lines[${i}] is invalid` };
    const transactionid = str(l.transactionid, 100);
    if (!transactionid || !SP.TXN_REGEX.test(transactionid)) {
      throw { status: 400, message: `lines[${i}].transactionid is required (a-z, 0-9, _ , - ; max 100)` };
    }
    if (seen.has(transactionid)) throw { status: 400, message: `lines[${i}].transactionid is duplicated` };
    seen.add(transactionid);
    const paymenttype = l.paymenttype !== undefined ? l.paymenttype : l.paymentType;
    if (!Number.isInteger(paymenttype) || !SP.PAYMENT_TYPES[paymenttype]) {
      throw { status: 400, message: `lines[${i}].paymenttype must be 1-4` };
    }
    if (!SP.isMoney(l.amount) || l.amount <= 0) {
      throw { status: 400, message: `lines[${i}].amount must be a number > 0 (max 2 decimals)` };
    }
    return { transactionid, paymenttype, amount: l.amount };
  });
}

// ตรวจกฎแบ่งชำระ: ส่วนที่ใช้งาน <= 3, ช่องทางไม่ซ้ำ, ยอดรวม = ยอดที่ต้องชำระ
function checkSplitRules(activeLines, totalamount) {
  if (activeLines.length > SP.MAX_SPLIT_LINES) {
    throw { status: 400, message: `split payment allows at most ${SP.MAX_SPLIT_LINES} parts` };
  }
  const types = activeLines.map((l) => Number(l.paymenttype));
  if (new Set(types).size !== types.length) {
    throw { status: 400, message: "each part must use a different paymenttype" };
  }
  const sum = activeLines.reduce((t, l) => t + SP.toCents(l.amount), 0);
  if (sum !== SP.toCents(totalamount)) {
    throw { status: 400, message: `sum of amount (${SP.fromCents(sum)}) must equal totalamount (${Number(totalamount)})` };
  }
}

async function terminalOk(trx, terminalid, shopid) {
  const t = await trx("terminalinfo").select("shopid", "status").where({ terminalid }).first();
  if (!t || t.status !== true) throw { status: 403, message: "terminalid is not registered or disabled" };
  if (t.shopid !== shopid) throw { status: 403, message: "terminalid does not belong to this shop" };
}

// ข้อมูลการชำระสำหรับตอบกลับ
async function statusView(trx, head) {
  const lines = await trx("orderpaymentline").where({ orderpaymentid: head.orderpaymentid }).orderBy("lineno", "asc");
  const views = lines.map(SP.lineView);
  const paid = lines.filter((l) => Number(l.linestatus) === SP.LINE.SUCCESS).reduce((t, l) => t + SP.toCents(l.amount), 0);
  const total = SP.toCents(head.totalamount);
  // ส่วนที่นับเป็นการชำระ : ระหว่างชำระ = รอชำระ + สำเร็จ ; หลังจากนั้น = สำเร็จ + คืนเงินแล้ว
  const activeSet = Number(head.paymentstatus) === SP.PAY.PAYING
    ? [SP.LINE.PENDING, SP.LINE.SUCCESS]
    : [SP.LINE.SUCCESS, SP.LINE.REFUNDED];
  const active = views.filter((l) => activeSet.includes(l.linestatus));
  return {
    orderpaymentid: head.orderpaymentid,
    ordernumber: head.ordernumber,
    issplit: head.issplit === true,
    paymentstatus: Number(head.paymentstatus),
    paymentstatusname: SP.PAY_NAME[Number(head.paymentstatus)],
    totalamount: SP.fromCents(total),
    paidamount: SP.fromCents(paid),
    remainingamount: Number(head.paymentstatus) === SP.PAY.PAYING ? SP.fromCents(Math.max(total - paid, 0)) : 0,
    paymenttype: active.length > 1 ? SP.PAYMENTTYPE_SPLIT : active.length === 1 ? active[0].paymenttype : null,
    paymenttext: SP.paymentText(active),
    receiptid: head.receiptid || null,
    refundreason: head.refundreason || null,
    refund_at: head.refund_at ? Number(head.refund_at) : null,
    lines: views,
  };
}

// คำนวณยอดที่ชำระแล้วใหม่ และปิดเป็น "ชำระครบ" เมื่อครบยอด
async function refreshPaid(trx, head) {
  const r = await trx("orderpaymentline")
    .where({ orderpaymentid: head.orderpaymentid, linestatus: SP.LINE.SUCCESS })
    .sum("amount as paid")
    .first();
  const paid = SP.toCents(r && r.paid ? r.paid : 0);
  const upd = { paidamount: SP.fromCents(paid), update_at: now() };
  if (Number(head.paymentstatus) === SP.PAY.PAYING && paid === SP.toCents(head.totalamount)) {
    upd.paymentstatus = SP.PAY.PAID;
  }
  await trx("orderpayment").where({ orderpaymentid: head.orderpaymentid }).update(upd);
  return Object.assign({}, head, upd);
}

// =====================================================================
// POST /api/pos/paymentstart
//   { ordernumber, terminalid, lines: [{ transactionid, paymenttype, amount }] }  (2-3 ส่วน)
//   มีรายการกำลังชำระค้างอยู่ -> ส่งรายการเดิมกลับ (resumed = true)
// =====================================================================
exports.paymentstart = (req, res) => {
  let logOrder;
  run(
    res,
    async () => {
      const uinfoid = await auth(req);
      const body = req.body || {};
      const ordernumber = requireOrdernumber(body);
      const terminalid = str(body.terminalid, 100);
      if (!terminalid || !checkString(terminalid)) throw { status: 402, message: "terminalid not found" };

      const lines = parseLines(body.lines);
      if (lines.length < 2) throw { status: 400, message: "split payment requires 2-3 parts (single payment: use receiptcreate with transactionid)" };

      return db.transaction(async (trx) => {
        const order = await trx("orderinfo")
          .select("ordernumber", "shopid", "orderstatus", "ordertotalprice", "ordertotaldiscount", "orderpricenet", "status")
          .where({ ordernumber })
          .first();
        if (!order || order.status === false) throw { status: 402, message: "ordernumber not found" };
        if (order.orderstatus !== null && CANCELLED_ORDERSTATUS.includes(Number(order.orderstatus))) {
          throw { status: 409, message: "The order has been canceled." };
        }
        await terminalOk(trx, terminalid, order.shopid);

        const heads = await trx("orderpayment").where({ ordernumber }).orderBy("create_at", "desc").forUpdate();
        if (heads.some((h) => Number(h.paymentstatus) === SP.PAY.PAID)) throw { status: 409, message: "order is already paid" };
        if (heads.some((h) => Number(h.paymentstatus) === SP.PAY.REFUNDED)) throw { status: 409, message: "order has been refunded" };
        const paying = heads.find((h) => Number(h.paymentstatus) === SP.PAY.PAYING);
        if (paying) {
          return Object.assign(await statusView(trx, paying), { resumed: true, message: "Payment in progress" });
        }

        const totalamount = netOf(order);
        if (!(totalamount > 0)) throw { status: 400, message: "order total must be greater than 0" };
        checkSplitRules(lines, totalamount);

        const orderpaymentid = uuid();
        const t = now();
        const head = {
          orderpaymentid,
          ordernumber,
          shopid: order.shopid,
          terminalid,
          uinfoid,
          totalamount,
          paidamount: 0,
          issplit: true,
          paymentstatus: SP.PAY.PAYING,
          create_at: t,
          update_at: t,
        };
        await trx("orderpayment").insert(head);
        await trx("orderpaymentline").insert(
          lines.map((l, i) => ({
            lineid: uuid(),
            orderpaymentid,
            ordernumber,
            lineno: i + 1,
            transactionid: l.transactionid,
            paymenttype: l.paymenttype,
            amount: l.amount,
            linestatus: SP.LINE.PENDING,
            create_at: t,
            update_at: t,
          }))
        );
        logOrder = ordernumber;
        return Object.assign(await statusView(trx, head), { resumed: false, message: "Start payment Success" });
      });
    },
    async (data) => {
      if (logOrder) await eventlog(req, `เริ่มแบ่งชำระ "${logOrder}" ${data.paymenttext || ""}`, "POS");
    }
  );
};

// =====================================================================
// POST /api/pos/paymentstatus   { ordernumber }
// =====================================================================
exports.paymentstatus = (req, res) => {
  run(res, async () => {
    await auth(req);
    const ordernumber = requireOrdernumber(req.body || {});
    // รายการที่ใช้งานอยู่ก่อน (กำลังชำระ > ชำระครบ > คืนเงินแล้ว > ยกเลิก) แล้วจึงล่าสุด
    const RANK = { [SP.PAY.PAYING]: 0, [SP.PAY.PAID]: 1, [SP.PAY.REFUNDED]: 2, [SP.PAY.CANCELLED]: 3 };
    const heads = await db("orderpayment").where({ ordernumber }).orderBy("create_at", "desc");
    const head = heads.sort((a, b) => (RANK[Number(a.paymentstatus)] - RANK[Number(b.paymentstatus)]) || (Number(b.create_at) - Number(a.create_at)))[0];
    if (!head) throw { status: 404, message: "payment not found" };
    return statusView(db, head);
  });
};

// =====================================================================
// PUT /api/pos/paymentlineupdate
//   { transactionid, linestatus: 1 | 2 | 4, cashreceived?, cashchange?, refno?, failreason? }
//   1 = สำเร็จ, 2 = ไม่สำเร็จ (ระหว่างชำระ) ; 4 = คืนเงินแล้ว (หลัง paymentcancel)
//   ส่งซ้ำด้วยสถานะเดิม -> ตอบผลเดิม ไม่บวกยอดซ้ำ
// =====================================================================
exports.paymentlineupdate = (req, res) => {
  let logText;
  run(
    res,
    async () => {
      await auth(req);
      const body = req.body || {};
      const transactionid = str(body.transactionid, 100);
      if (!transactionid || !SP.TXN_REGEX.test(transactionid)) throw { status: 400, message: "transactionid is required" };
      const target = body.linestatus;
      if (![SP.LINE.SUCCESS, SP.LINE.FAILED, SP.LINE.REFUNDED].includes(target)) {
        throw { status: 400, message: "linestatus must be 1 (success), 2 (failed) or 4 (refunded)" };
      }

      return db.transaction(async (trx) => {
        const line0 = await trx("orderpaymentline").where({ transactionid }).first();
        if (!line0) throw { status: 404, message: "transactionid not found" };
        const head = await trx("orderpayment").where({ orderpaymentid: line0.orderpaymentid }).forUpdate().first();
        const line = await trx("orderpaymentline").where({ lineid: line0.lineid }).forUpdate().first();
        const cur = Number(line.linestatus);
        const hs = Number(head.paymentstatus);

        // ส่งซ้ำ -> ตอบผลเดิม
        if (cur === target) {
          return Object.assign(await statusView(trx, head), { duplicate: true, message: "Already updated" });
        }

        const upd = { linestatus: target, update_at: now() };
        if (target === SP.LINE.SUCCESS || target === SP.LINE.FAILED) {
          if (cur !== SP.LINE.PENDING) {
            throw { status: 409, message: `line status is ${SP.LINE_NAME[cur]} (only pending can be updated)` };
          }
          if (hs !== SP.PAY.PAYING) throw { status: 409, message: `payment status is ${SP.PAY_NAME[hs]}` };
        }

        if (target === SP.LINE.SUCCESS) {
          if (Number(line.paymenttype) === SP.PAYMENTTYPE_CASH) {
            const received = body.cashreceived;
            if (!SP.isMoney(received) || SP.toCents(received) < SP.toCents(line.amount)) {
              throw { status: 400, message: "cashreceived must be a number >= amount" };
            }
            const change = SP.toCents(received) - SP.toCents(line.amount);
            if (body.cashchange !== undefined && body.cashchange !== null &&
                (!SP.isMoney(body.cashchange) || SP.toCents(body.cashchange) !== change)) {
              throw { status: 400, message: `cashchange must be ${SP.fromCents(change)}` };
            }
            upd.cashreceived = received;
            upd.cashchange = SP.fromCents(change);
          }
          upd.refno = str(body.refno, 100);
          upd.failreason = null;
          upd.paid_at = now();
        } else if (target === SP.LINE.FAILED) {
          upd.failreason = str(body.failreason, 500);
          upd.refno = str(body.refno, 100);
        } else {
          // คืนเงินส่วนที่ชำระแล้ว หลังยกเลิกระหว่างชำระ
          if (cur !== SP.LINE.SUCCESS || hs !== SP.PAY.CANCELLED) {
            throw { status: 409, message: "refund a part is allowed only for a successful part of a cancelled payment (use orderrefund for a paid bill)" };
          }
        }

        await trx("orderpaymentline").where({ lineid: line.lineid }).update(upd);
        const h2 = await refreshPaid(trx, head);
        logText = `แบ่งชำระ "${head.ordernumber}" ส่วนที่ ${line.lineno} ${SP.paymentTypeName(line.paymenttype)} ${Number(line.amount)} : ${SP.LINE_NAME[target]}`;
        return Object.assign(await statusView(trx, h2), { message: "Update payment line Success" });
      });
    },
    async () => {
      if (logText) await eventlog(req, logText, "POS");
    }
  );
};

// =====================================================================
// PUT /api/pos/paymentsplitupdate
//   { ordernumber, lines: [{ transactionid, paymenttype, amount }] }
//   ส่วนที่สำเร็จแล้วคงไว้ ; ส่วนที่รอชำระ -> ยกเลิก ; สร้างส่วนใหม่ตาม lines (transactionid ใหม่)
//   ส่วนที่สำเร็จ + ส่วนใหม่ : <= 3 ส่วน, ช่องทางไม่ซ้ำ, ยอดรวม = ยอดที่ต้องชำระ
// =====================================================================
exports.paymentsplitupdate = (req, res) => {
  let logText;
  run(
    res,
    async () => {
      await auth(req);
      const body = req.body || {};
      const ordernumber = requireOrdernumber(body);
      const lines = parseLines(body.lines);

      return db.transaction(async (trx) => {
        const head = await trx("orderpayment").where({ ordernumber, paymentstatus: SP.PAY.PAYING }).forUpdate().first();
        if (!head) throw { status: 404, message: "no payment in progress for this order" };

        const all = await trx("orderpaymentline").where({ orderpaymentid: head.orderpaymentid }).forUpdate();
        const success = all.filter((l) => Number(l.linestatus) === SP.LINE.SUCCESS);
        checkSplitRules(success.concat(lines), head.totalamount);

        const t = now();
        await trx("orderpaymentline")
          .where({ orderpaymentid: head.orderpaymentid, linestatus: SP.LINE.PENDING })
          .update({ linestatus: SP.LINE.CANCELLED, update_at: t });

        let lineno = all.reduce((m, l) => Math.max(m, Number(l.lineno)), 0);
        await trx("orderpaymentline").insert(
          lines.map((l) => ({
            lineid: uuid(),
            orderpaymentid: head.orderpaymentid,
            ordernumber,
            lineno: ++lineno,
            transactionid: l.transactionid,
            paymenttype: l.paymenttype,
            amount: l.amount,
            linestatus: SP.LINE.PENDING,
            create_at: t,
            update_at: t,
          }))
        );
        await trx("orderpayment").where({ orderpaymentid: head.orderpaymentid }).update({ update_at: t });

        const view = await statusView(trx, head);
        logText = `เปลี่ยนสัดส่วนแบ่งชำระ "${ordernumber}" ${view.paymenttext || ""}`;
        return Object.assign(view, { message: "Update split payment Success" });
      });
    },
    async () => {
      if (logText) await eventlog(req, logText, "POS");
    }
  );
};

// =====================================================================
// PUT /api/pos/paymentcancel   { ordernumber, reason? }
//   ยกเลิกก่อนครบยอด -> ส่ง refundlines (ส่วนที่ชำระแล้ว) ให้เครื่อง POS คืนเงิน / Void
//   แล้วแจ้งแต่ละส่วนด้วย paymentlineupdate (linestatus = 4)
// =====================================================================
exports.paymentcancel = (req, res) => {
  let logText;
  run(
    res,
    async () => {
      await auth(req);
      const body = req.body || {};
      const ordernumber = requireOrdernumber(body);

      return db.transaction(async (trx) => {
        const head = await trx("orderpayment").where({ ordernumber, paymentstatus: SP.PAY.PAYING }).forUpdate().first();
        if (!head) throw { status: 404, message: "no payment in progress for this order" };

        const t = now();
        await trx("orderpaymentline")
          .where({ orderpaymentid: head.orderpaymentid, linestatus: SP.LINE.PENDING })
          .update({ linestatus: SP.LINE.CANCELLED, update_at: t });
        const upd = { paymentstatus: SP.PAY.CANCELLED, refundreason: str(body.reason, 500), update_at: t };
        await trx("orderpayment").where({ orderpaymentid: head.orderpaymentid }).update(upd);

        const view = await statusView(trx, Object.assign({}, head, upd));
        const refundlines = view.lines.filter((l) => l.linestatus === SP.LINE.SUCCESS);
        logText = `ยกเลิกการแบ่งชำระ "${ordernumber}"` + (refundlines.length ? ` (ต้องคืนเงิน ${refundlines.length} ส่วน)` : "");
        return Object.assign(view, { refundlines, message: "Cancel payment Success" });
      });
    },
    async () => {
      if (logText) await eventlog(req, logText, "POS");
    }
  );
};

// =====================================================================
// PUT /api/pos/orderrefund   { ordernumber, reason, approveby? }
//   ยกเลิก / คืนเงินทั้งใบหลังออกใบเสร็จ : หัวรายการ -> คืนเงินแล้ว, ทุกส่วนที่สำเร็จ -> คืนเงินแล้ว
//   ใบเสร็จยังเก็บไว้ ; รายงานไม่นับยอดและแสดงว่า "คืนเงิน"
//   (สถานะออเดอร์ยังเปลี่ยนด้วย /api/pos/orderupdatestatus ตามเดิม)
// =====================================================================
exports.orderrefund = (req, res) => {
  let logText;
  run(
    res,
    async () => {
      const uinfoid = await auth(req);
      const body = req.body || {};
      const ordernumber = requireOrdernumber(body);
      const reason = str(body.reason, 500);
      if (!reason) throw { status: 400, message: "reason is required" };

      return db.transaction(async (trx) => {
        const heads = await trx("orderpayment")
          .where({ ordernumber })
          .whereIn("paymentstatus", [SP.PAY.PAID, SP.PAY.REFUNDED])
          .orderBy("create_at", "desc")
          .forUpdate();
        const head = heads.find((h) => Number(h.paymentstatus) === SP.PAY.PAID) || heads[0];
        if (!head) throw { status: 404, message: "paid payment not found for this order" };

        if (Number(head.paymentstatus) === SP.PAY.REFUNDED) {
          const v = await statusView(trx, head);
          return Object.assign(v, { duplicate: true, refundlines: v.lines.filter((l) => l.linestatus === SP.LINE.REFUNDED), message: "Already refunded" });
        }

        const t = now();
        const before = await statusView(trx, head);
        await trx("orderpaymentline")
          .where({ orderpaymentid: head.orderpaymentid, linestatus: SP.LINE.SUCCESS })
          .update({ linestatus: SP.LINE.REFUNDED, update_at: t });
        const upd = {
          paymentstatus: SP.PAY.REFUNDED,
          refundreason: reason,
          refundby: uinfoid,
          refundapproveby: str(body.approveby, 100),
          refund_at: t,
          update_at: t,
        };
        await trx("orderpayment").where({ orderpaymentid: head.orderpaymentid }).update(upd);

        const view = await statusView(trx, Object.assign({}, head, upd));
        logText = `คืนเงินบิล "${ordernumber}" ${before.paymenttext || ""} เหตุผล: ${reason}`;
        return Object.assign(view, {
          refundlines: view.lines.filter((l) => l.linestatus === SP.LINE.REFUNDED),
          message: "Refund order Success",
        });
      });
    },
    async () => {
      if (logText) await eventlog(req, logText, "POS");
    }
  );
};
