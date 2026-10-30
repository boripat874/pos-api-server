const {db} = require("../../db/postgresql");
const fs = require("fs");
const date = require("date-and-time");
const { uuid } = require("uuidv4");
const multer = require("multer");
const path = require("path");
// const { console } = require("inspector");
const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT

const {checkAuthorizetion} = require("../../modules/fun");
const {convertTotimestamp} = require("../../modules/convertTotimestamp");

require("dotenv").config();
 
const timeout = 60000; // Timeout in milliseconds (e.g., 60 seconds)

// ตั้งค่าการจัดเก็บไฟล์
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // โฟลเดอร์สำหรับเก็บไฟล์
  },

  // ตั้งชื่อไฟล์
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9); // สร้างชื่อไฟล์ที่ไม่ซ้ำกัน
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)); // ตั้งชื่อไฟล์ใหม่
  },
});

// ฟิลเตอร์ไฟล์ (อนุญาตเฉพาะไฟล์รูปภาพ)
const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only JPEG, PNG, and GIF are allowed."));
  }
};

// สร้าง middleware สำหรับอัปโหลด
const upload = multer({ storage, fileFilter });

const regex = /^[0-9a-zA-Z_-]+$/;

// ฟังก์ชันสําหรับตรวจสอบข้อความ
function checkString(str) {
    return regex.test(str);
}

// ฟังก์ชันสําหรับจัดการข้อผิดพลาด
function handleError(error, res) {
  console.error(error); // แสดงข้อผิดพลาดใน console
  res.status(500).json({ message: "Internal Server Error", error: error.message });
}

// ฟังก์ชันสําหรับตรวจสอบ API key
async function validateApiKey(req) {
  const X_API_KEY = req.headers["x-api-key"]||"";

  const autihorized = await db.select("apikey").where({ "apikey": X_API_KEY }).from("shopinfo");

  if (!autihorized.length) {

    // return res.status(401).json({ message: "Unauthorized" });
    throw { status: 401, message: "Unauthorized" };
    
  }
}

// ฟังก์ชันสําหรับลบไฟล์ที่อัปโหลด
async function deleteUploadedFile(filePath) {
  if (filePath) {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error("Failed to delete uploaded file:", err);
      } else {
        // console.log("Uploaded file deleted successfully:", filePath);
      }
    });
  }
}


// report order list
exports.reportorderlist = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reportorderListLogic = new Promise(async (resolve, reject) => {

    try {

      const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      // console.log("timestart >>" + req.query.timestart);
      // console.log("timeend >>" + req.query.timeend);
      // console.log(timestamp);

      const shopid = req.body.shopid;

      const orderlist = await db("orderinfo")
      .select(
        "orderinfo.ordertimestamp as ordertimestamp",
        "orderinfo.ordernumber as ordernumber",
        "orderinfo.ordertotalprice as ordertotalprice",
        "orderinfo.vat7pc as vat7pc",
        "orderinfo.ordertotaldiscount as ordertotaldiscount",
        "orderinfo.orderpricenet as orderpricenet",
        "orderinfo.ordertype as ordertype",
        "orderinfo.orderpaytype as orderpaytype",
        "receiptinfo.paymentType as paymenttype",
        "receiptinfo.urlfile as urlfile",
      )
      // .join("shopinfo", "shopinfo.shopid", "orderinfo.shopid")
      .leftJoin("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
      .where("orderinfo.shopid", shopid)
      .andWhere({"orderinfo.status": true})
      .andWhere("orderinfo.orderispay",">" ,0)
      .andWhere(function () {
        // Online (ordertype = 0): ไม่มีใบเสร็จใน receiptinfo -> ใช้ข้อมูลจาก orderinfo อย่างเดียว
        this.where("orderinfo.ordertype", ORDERTYPE_ONLINE)
        // Offline (ordertype = 1): ต้องมีใบเสร็จที่ระบุประเภทการชำระ (เหมือนเดิม)
        .orWhere(function () {
          this.whereNot("orderinfo.ordertype", ORDERTYPE_ONLINE)
          .whereNotNull("receiptinfo.paymentType")
          .whereNot("receiptinfo.paymentType", 0);
        });
      })
      .andWhere(function () {
        // this.where("shopnameth", "ILIKE", `%${search}%`)
        // .orWhere("shopnameeng", "ILIKE", `%${search}%`)
        this.orWhere("orderinfo.ordernumber", "ILIKE", `%${search}%`)
      })
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })
      .orderBy("orderinfo.ordertimestamp", "desc");

      const formattedResults = orderlist.map(item => {
        let formattedTimestamp = "0000/00/00 00:00"; // Default value

        // Check if the timestamp exists and is valid
        if (item.ordertimestamp) {

          const orderDate = new Date(item.ordertimestamp*1000);
          // const orderDate = new Date(1737973730000);

          // Check if the created Date object is valid before formatting
          if (!isNaN(orderDate.getTime())) {
              // Use date.format with the required pattern
            formattedTimestamp = date.format(orderDate, 'YYYY-MM-DD HH:mm');

          } else {
            // Handle cases where the DB timestamp might be invalid
            console.warn(`Invalid date format encountered for order timestamp: ${item.ordertimestamp}`);
            formattedTimestamp = 'Invalid Date'; // Or keep original, or set to empty string
          }
        }

        const isOnline = Number(item.ordertype) === ORDERTYPE_ONLINE;
        const totalprice = toNumber(item.ordertotalprice);
        const discount = toNumber(item.ordertotaldiscount); // ไม่มีส่วนลด -> 0

        return {
            // ...item, // Keep other properties like shop names, product names etc.
            ordertimestamp: formattedTimestamp, // Use the formatted timestamp
            ordernumber: item.ordernumber,
            ordertype: isOnline ? ORDERTYPE_ONLINE : ORDERTYPE_OFFLINE,
            orderchannel: isOnline ? "Online" : "Offline", // สถานะรายการสั่งซื้อ
            ordertotalprice: totalprice,
            vat7pc: toNumber(item.vat7pc),
            ordertotaldiscount: discount,
            // orderpricenet: netPrice(item.orderpricenet, totalprice, discount),
            orderpricenet: Number(item.orderpricenet),
            // ไม่มีประเภทการชำระ -> null (หน้าเว็บแสดง "-")
            paymenttype: isOnline ? toPaymentType(item.orderpaytype) : toPaymentType(item.paymenttype),
            urlfile: item.urlfile || null,
            _ts: Number(item.ordertimestamp) || 0
        };
      });

      // ออเดอร์ Online จากระบบภายนอก (POST /api/orderinsert) เก็บแยกตาราง onlineorderinfo
      // แสดงเป็น ordertype = 0 ; paymenttype เป็นข้อความตามที่ส่งมา (payment.channel)
      const onlineRows = await db("onlineorderinfo as o")
      .leftJoin(
        db("onlineorderdetail")
          .select("onlineorderid", db.raw("SUM(quantity * unitprice) as gross"), db.raw("SUM(discount) as discount"))
          .groupBy("onlineorderid")
          .as("d"),
        "d.onlineorderid",
        "o.onlineorderid"
      )
      .select(
        "o.ordernumber", "o.receiptnumber", "o.referencenumber", "o.buyername", "o.ordertimestamp", "o.orderstatus",
        "o.deliveryoption", "o.netamount", "o.paymentchannel", "d.gross", "d.discount"
      )
      .where("o.shopid", shopid)
      .andWhere("o.status", true)
      .andWhere("o.ordernumber", "ILIKE", `%${search}%`)
      .andWhere("o.ordertimestamp", ">=", timestamp.startTimestamp)
      .andWhere("o.ordertimestamp", "<", timestamp.endTimestamp);

      const onlineResults = onlineRows.map((o) => ({
        ordertimestamp: date.format(new Date(Number(o.ordertimestamp) * 1000), "YYYY-MM-DD HH:mm"),
        ordernumber: o.ordernumber,
        ordertype: ORDERTYPE_ONLINE,
        orderchannel: "Online",
        ordertotalprice: o.gross !== null && o.gross !== undefined ? toNumber(o.gross) : toNumber(o.netamount),
        vat7pc: 0,
        ordertotaldiscount: toNumber(o.discount),                    // ไม่มีส่วนลด -> 0
        orderpricenet: toNumber(o.netamount),
        paymenttype: o.paymentchannel ? String(o.paymentchannel) : null, // text เช่น "Credit Card" ; ไม่มี -> null (หน้าเว็บแสดง "-")
        urlfile: null,
        receiptnumber: o.receiptnumber || null,
        referencenumber: o.referencenumber || null,
        buyername: o.buyername || null,
        orderstatus: o.orderstatus || null,
        deliveryoption: o.deliveryoption || null,
        _ts: Number(o.ordertimestamp) || 0,
      }));

      // รวมแล้วเรียงเวลาล่าสุดก่อน
      const allResults = formattedResults
        .concat(onlineResults)
        .sort((a, b) => b._ts - a._ts)
        .map(({ _ts, ...row }) => row);

      resolve({
        total: allResults.length,
        result: allResults,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reportorderListLogic, timeoutPromise])
  .then((data) => {

    res.send(data); // Send the response only once

  })
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

// ===================== Online / Offline helpers =====================
const ORDERTYPE_ONLINE = 0;   // ออเดอร์จาก ZooApp (openApi)
const ORDERTYPE_OFFLINE = 1;  // ออเดอร์จากเครื่อง POS

// orderstatus ที่ถือว่ายกเลิก / ชำระเงินไม่สำเร็จ -> ไม่นับในยอดรวม
//   3 = ยกเลิกโดยระบบ, 4 = ยกเลิกโดยลูกค้า, 8 = ยกเลิกโดยผู้ขาย, 9 = การจ่ายเงินล้มเหลว
const CANCELLED_ORDERSTATUS = [3, 4, 8, 9];

// ไม่นับออเดอร์ที่ยกเลิก (orderstatus เป็น null ยังนับตามเดิม)
function notCancelled(qb) {
  qb.where(function () {
    this.whereNull("orderinfo.orderstatus").orWhereNotIn("orderinfo.orderstatus", CANCELLED_ORDERSTATUS);
  });
}

// ยอดรวมในรายงาน: เฉพาะออเดอร์ Offline ที่มีใบเสร็จแล้ว (ระบุประเภทการชำระ) และไม่ถูกยกเลิก
// ใช้ whereExists เพื่อไม่ให้นับซ้ำ กรณี 1 ออเดอร์มีหลายใบเสร็จ
function offlineWithReceipt(qb) {
  qb.whereNot("orderinfo.ordertype", ORDERTYPE_ONLINE)
    .whereExists(function () {
      this.select(db.raw("1"))
        .from("receiptinfo")
        .whereRaw("receiptinfo.ordernumber = orderinfo.ordernumber")
        .whereNotNull("receiptinfo.paymentType")
        .whereNot("receiptinfo.paymentType", 0);
    })
    .modify(notCancelled);
}

// ราคาสุทธิ: online จาก openApi ไม่ได้บันทึก orderpricenet -> ใช้ ราคารวม - ส่วนลด
const NET_PRICE_SQL =
  "COALESCE(orderinfo.orderpricenet, GREATEST(COALESCE(orderinfo.ordertotalprice, 0) - COALESCE(orderinfo.ordertotaldiscount, 0), 0))";

function toNumber(v) {
  const n = Number(v);
  return v === null || v === undefined || v === "" || Number.isNaN(n) ? 0 : n;
}

function netPrice(pricenet, totalprice, discount) {
  if (pricenet !== null && pricenet !== undefined && pricenet !== "" && !Number.isNaN(Number(pricenet))) {
    return Number(pricenet);
  }
  return Math.max(totalprice - discount, 0);
}

// 1 = Credit Card, 2 = PromptPay, 3 = E-wallet, 4 = เงินสด ; อื่นๆ/ไม่มี -> null
function toPaymentType(v) {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}

// ใบเสร็จของออเดอร์ online (สร้างจาก orderinfo + orderdetail)
async function onlineReceipt(ordernumber) {
  const order = await db("orderinfo")
    .select("orderid", "ordernumber", "ordertimestamp", "ordertotalprice", "ordertotaldiscount", "orderpricenet", "orderpaytype", "create_at")
    .where({ ordernumber, ordertype: ORDERTYPE_ONLINE })
    .first();
  if (!order) return onlineInsertReceipt(ordernumber);

  const orderDetails = await db("orderdetail")
    .select(
      "orderdetail.productid",
      "orderdetail.qty",
      "orderdetail.productprice",
      "productinfo.productnameth",
      "productinfo.productnameeng"
    )
    .join("productinfo", "orderdetail.productid", "productinfo.productid")
    .where({ "orderdetail.orderid": order.orderid });

  const totalprice = toNumber(order.ordertotalprice);
  const discount = toNumber(order.ordertotaldiscount);
  const net = netPrice(order.orderpricenet, totalprice, discount);

  return {
    receiptid: null,
    ordernumber: order.ordernumber,
    receiptnumber: "-",
    paymenttype: toPaymentType(order.orderpaytype),
    receiptcash: net,          // online ชำระผ่านแอปเต็มจำนวน
    receiptchange: 0,
    receiptdiscount: discount,
    totalprice,
    totalpricenet: net,
    create_at: Math.floor(Number(order.ordertimestamp) || Number(order.create_at)),
    orderid: order.orderid,
    ordertype: ORDERTYPE_ONLINE,
    orderchannel: "Online",
    products: orderDetails.map((item) => ({
      productid: item.productid,
      productnameth: item.productnameth,
      productnameeng: item.productnameeng,
      qty: Number(item.qty),
      productprice: Number(item.productprice),
    })),
  };
}

// ใบเสร็จของออเดอร์ Online ที่รับผ่าน /api/orderinsert (ตาราง onlineorderinfo)
async function onlineInsertReceipt(ordernumber) {
  const o = await db("onlineorderinfo").select("*").where({ ordernumber, status: true }).first();
  if (!o) return null;

  const items = await db("onlineorderdetail")
    .select("productcode", "productname", "quantity", "unitprice", "discount")
    .where({ onlineorderid: o.onlineorderid })
    .orderBy("linenumber", "asc");

  const totalprice = items.reduce((t, it) => t + toNumber(it.quantity) * toNumber(it.unitprice), 0);
  const discount = items.reduce((t, it) => t + toNumber(it.discount), 0);
  const net = toNumber(o.netamount);

  return {
    receiptid: null,
    ordernumber: o.ordernumber,
    receiptnumber: o.receiptnumber || "-",
    referencenumber: o.referencenumber || null,
    buyername: o.buyername || null,
    paymenttype: o.paymentchannel || null,        // text
    paymenttransactionnumber: o.paymenttransactionnumber || null,
    receiptcash: net,
    receiptchange: 0,
    receiptdiscount: discount,
    totalprice: items.length ? totalprice : net,
    totalpricenet: net,
    create_at: Number(o.ordertimestamp),
    orderid: o.onlineorderid,
    ordertype: ORDERTYPE_ONLINE,
    orderchannel: "Online",
    orderstatus: o.orderstatus || null,
    deliveryoption: o.deliveryoption || null,
    products: items.map((it) => ({
      productid: it.productcode,
      productnameth: it.productname || it.productcode,
      productnameeng: it.productname || it.productcode,
      qty: toNumber(it.quantity),
      productprice: toNumber(it.unitprice),
    })),
  };
}

// report total income
exports.reporttotalincome = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reporttotalIncomeLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const { shopid } = req.body;

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      // รายได้รวม: เฉพาะ Offline ที่มีใบเสร็จแล้ว และไม่ถูกยกเลิก
      // (ออเดอร์ Online แสดงในตารางอย่างเดียว ไม่นับรวม)
      const query_total_income = await db("orderinfo")
      .select(db.raw(`SUM(${NET_PRICE_SQL}) as total_income`))
      .where("orderinfo.shopid", shopid)
      .andWhere("orderinfo.status", true)
      .andWhere("orderinfo.orderispay", ">", 0)
      .modify(offlineWithReceipt)
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })

      resolve({
        total_income: Number(query_total_income[0].total_income) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reporttotalIncomeLogic, timeoutPromise])
  .then((data) => {

    res.send(data); // Send the response only once

  })
  .catch((error) => {

    if (error.status) {

      res.status(error.status).json({ message: error.message });

    } else if (error.message === "Request timed out") {

      res.status(402).json({ message: "Request timed out" });

    } else {
      handleError(error, res);
    }
  })
}

// report total credit card
exports.reporttotalcreditcard = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reporttotalCreditCardLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const { shopid } = req.body;

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const query_total_creditcard = await db("orderinfo")
      .join("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
      .sum("orderinfo.orderpricenet as total_creditcard")
      .where({
        "orderinfo.shopid":shopid,
        "receiptinfo.paymentType": 1
      })
      .andWhere("orderinfo.status", true)
      .andWhere("orderinfo.orderispay",">" ,0)
      .modify(notCancelled) // ไม่นับออเดอร์ที่ยกเลิก
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })

      resolve({
        total_creditcard: Number(query_total_creditcard[0].total_creditcard) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reporttotalCreditCardLogic, timeoutPromise])
  .then((data) => {

    res.send(data); // Send the response only once

  })
  .catch((error) => {

    if (error.status) {

      res.status(error.status).json({ message: error.message });

    } else if (error.message === "Request timed out") {

      res.status(402).json({ message: "Request timed out" });

    } else {
      handleError(error, res);
    }
  })
}

// report total PromptPay
exports.reporttotalpromptpay = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reporttotalPromptPayLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const { shopid } = req.body;

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const query_total_promptpay = await db("orderinfo")
      .join("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
      .sum("orderinfo.orderpricenet as total_promptpay")
      .where({
        "orderinfo.shopid":shopid,
        "receiptinfo.paymentType": 2
      })
      .andWhere("orderinfo.status", true)
      .andWhere("orderinfo.orderispay",">" ,0)
      .modify(notCancelled) // ไม่นับออเดอร์ที่ยกเลิก
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })

      resolve({
        total_promptpay: Number(query_total_promptpay[0].total_promptpay) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reporttotalPromptPayLogic, timeoutPromise])
  .then((data) => {

    res.send(data); // Send the response only once

  })
  .catch((error) => {

    if (error.status) {

      res.status(error.status).json({ message: error.message });

    } else if (error.message === "Request timed out") {

      res.status(402).json({ message: "Request timed out" });

    } else {
      handleError(error, res);
    }
  })
}

// report total E-wallet
exports.reporttotalewallet = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reporttotalEwalletLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const { shopid } = req.body;

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const query_total_ewallet = await db("orderinfo")
      .join("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
      .sum("orderinfo.orderpricenet as total_ewallet")
      .where({
        "orderinfo.shopid":shopid,
        "receiptinfo.paymentType": 3
      })
      .andWhere("orderinfo.status", true)
      .andWhere("orderinfo.orderispay",">" ,0)
      .modify(notCancelled) // ไม่นับออเดอร์ที่ยกเลิก
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })

      resolve({
        total_ewallet: Number(query_total_ewallet[0].total_ewallet) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reporttotalEwalletLogic, timeoutPromise])
  .then((data) => {

    res.send(data); // Send the response only once

  })
  .catch((error) => {

    if (error.status) {

      res.status(error.status).json({ message: error.message });

    } else if (error.message === "Request timed out") {

      res.status(402).json({ message: "Request timed out" });

    } else {
      handleError(error, res);
    }
  })
}

// report total Cash
exports.reporttotalcash = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reporttotalCashLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const { shopid } = req.body;

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const query_total_cash = await db("orderinfo")
      .join("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
      .sum("orderinfo.orderpricenet as total_cash")
      .where({
        "orderinfo.shopid":shopid,
        "receiptinfo.paymentType": 4
      })
      .andWhere("orderinfo.status", true)
      .andWhere("orderinfo.orderispay",">" ,0)
      .modify(notCancelled) // ไม่นับออเดอร์ที่ยกเลิก
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })

      resolve({
        total_cash: Number(query_total_cash[0].total_cash) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reporttotalCashLogic, timeoutPromise])
  .then((data) => {

    res.send(data); // Send the response only once

  })
  .catch((error) => {

    if (error.status) {

      res.status(error.status).json({ message: error.message });

    } else if (error.message === "Request timed out") {

      res.status(402).json({ message: "Request timed out" });

    } else {
      handleError(error, res);
    }
  })

}

// report total order
exports.reporttotalorder = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reporttotalOrderLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const shopid = req.body.shopid || "";

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      // บิลที่ขายได้ทั้งหมด: เฉพาะ Offline ที่มีใบเสร็จแล้ว และไม่ถูกยกเลิก
      const query_total_order = await db("orderinfo")
      .count("orderinfo.orderid as total_order")
      .where("orderinfo.shopid", shopid)
      .andWhere("orderinfo.status", true)
      .andWhere("orderinfo.orderispay", ">", 0)
      .modify(offlineWithReceipt)
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })

      resolve({
        total_order: Number(query_total_order[0].total_order) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reporttotalOrderLogic, timeoutPromise])
  .then((data) => {
    
    res.send(data); // Send the response only once

  })
  .catch((error) => {

    if (error.status) {

        res.status(error.status).json({ message: error.message });
  
      } else if (error.message === "Request timed out") {
  
        res.status(402).json({ message: "Request timed out" });
  
      } else {
        handleError(error, res);
      }
  })
}

// report product sell
exports.reportproductsell = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reportproductSellLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const shopid = req.body.shopid || "";

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      // สินค้าขายออกทั้งหมด: เฉพาะ Offline ที่มีใบเสร็จแล้ว และไม่ถูกยกเลิก
      const query_total_product = await db("orderinfo")
      .join("orderdetail", "orderinfo.orderid", "orderdetail.orderid")
      .sum("orderdetail.qty as total_product")
      .where("orderinfo.shopid", shopid)
      .andWhere("orderinfo.status", true)
      .andWhere("orderinfo.orderispay", ">", 0)
      .modify(offlineWithReceipt)
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })

      // console.log(query_total_order);

      resolve({
        total_product: Number(query_total_product[0].total_product) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reportproductSellLogic, timeoutPromise])
  .then((data) => {
    
    res.send(data); // Send the response only once

  })
  .catch((error) => {

    if (error.status) {

        res.status(error.status).json({ message: error.message });
  
      } else if (error.message === "Request timed out") {
  
        res.status(402).json({ message: "Request timed out" });
  
      } else {
        handleError(error, res);
      }
  })
}

// // report product sell list
// exports.reportproductselllist = (req, res) => {
//   const timeoutPromise = new Promise((_, reject) =>
//     setTimeout(() => reject(new Error("Request timed out")), timeout)
//   );

//   const reportproductsellListLogic = new Promise(async (resolve, reject) => {
//     try {

//       const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา

//       // Validate API key
//       await validateApiKey(req);

//       await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

//       const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

//       const orderdetaillist = await db("orderdetail")
//       .select(
//         "orderdetail.id as id",
//         "orderinfo.ordertimestamp as ordertimestamp",
//         "shopinfo.shopnameth as shopnameth",
//         "shopinfo.shopnameeng as shopnameeng",
//         "productinfo.productnameth as productnameth",
//         "productinfo.productnameeng as productnameeng",
//         "orderdetail.qty as qty",
//         "orderdetail.productprice as productprice",
//         // Calculate totalprice directly in the database query and alias it
//         db.raw('CAST(orderdetail.qty AS NUMERIC) * CAST(orderdetail.productprice AS NUMERIC) as totalprice')
//       )
//       .join("orderinfo", "orderinfo.orderid", "orderdetail.orderid")
//       .join("productinfo", "productinfo.productid", "orderdetail.productid")
//       .join('shopinfo', 'shopinfo.shopid', 'productinfo.shopid')
//       // .where({ "status": true }) // เงื่อนไข status = true
//       .andWhere(function () {
//           this.where("productnameth", "ILIKE", `%${search}%`)
//           .orWhere("productnameeng", "ILIKE", `%${search}%`)
//           .orWhere("shopnameth", "ILIKE", `%${search}%`)
//           .orWhere("shopnameeng", "ILIKE", `%${search}%`)
//       })
//       .orderBy("orderdetail.orderid", "desc")
      

//       // Format results: Convert numbers and format the timestamp
//       const formattedResults = orderdetaillist.map(item => {
//         let formattedTimestamp = "0000/00/00 00:00"; // Default value

//         // Check if the timestamp exists and is valid
//         if (item.ordertimestamp) {
//             const orderDate = new Date(item.ordertimestamp*1000);
//             // const orderDate = new Date(1737973730000);

//             // Check if the created Date object is valid before formatting
//             if (!isNaN(orderDate.getTime())) {
//                  // Use date.format with the required pattern
//                 formattedTimestamp = date.format(orderDate, 'YYYY-MM-DD HH:mm');

//             } else {
//                 // Handle cases where the DB timestamp might be invalid
//                 console.warn(`Invalid date format encountered for order timestamp: ${item.ordertimestamp}`);
//                 formattedTimestamp = 'Invalid Date'; // Or keep original, or set to empty string
//             }
//         }

//         return {
//             ...item, // Keep other properties like shop names, product names etc.
//             ordertimestamp: formattedTimestamp, // Use the formatted timestamp
//             productprice: Number(item.productprice),
//             qty: Number(item.qty),
//             totalprice: Number(item.totalprice)
//         };
//       });

//       resolve({
//         total: formattedResults.length, // Use the length of the results from the query
//         result: formattedResults,      // Use the results directly
//       });
    
//     } catch (error) {
      
//       reject(error);

//     }
//   });

//   Promise.race([reportproductsellListLogic, timeoutPromise])
//   .then((data) => {

//     res.send(data); // Send the response only once

//   })
//   .catch((error) => {

//     if (error.status) {

//       res.status(error.status).json({ message: error.message });

//     } else if (error.message === "Request timed out") {

//       res.status(402).json({ message: "Request timed out" });

//     } else {
//       handleError(error, res);
//     }
//   });

// }

exports.receiptorder = async (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const receiptInfoLogic = new Promise(async (resolve, reject) => {
    try {
      // Validate API key
      await validateApiKey(req);
      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const { ordernumber } = req.body;

      if (!ordernumber) {
        return reject({ status: 402, message: "ordernumber is not required" });
      }

      // ดึงข้อมูลใบเสร็จและ orderinfo
      const receiptRows = await db("receiptinfo")
        .select(
          "receiptinfo.receiptid as receiptid",
          "receiptinfo.ordernumber as ordernumber",
          "receiptinfo.receiptnumber as receiptnumber",
          "receiptinfo.paymentType as paymenttype",
          "receiptinfo.receiptcash as receiptcash",
          "receiptinfo.receiptchange as receiptchange",
          "receiptinfo.receiptdiscount as receiptdiscount",
          "receiptinfo.totalprice as totalprice",
          "receiptinfo.create_at as create_at",
          "orderinfo.orderid as orderid"
        )
        .join("orderinfo", "receiptinfo.ordernumber", "orderinfo.ordernumber")
        .where({ "receiptinfo.ordernumber": ordernumber })
        .orderBy("receiptinfo.create_at", "desc");

      if (receiptRows.length === 0) {
        // Online: ไม่มีใบเสร็จใน receiptinfo -> ใช้ข้อมูลจาก orderinfo
        const online = await onlineReceipt(ordernumber);
        if (online) return resolve(online);
        return reject({ status: 402, message: "receiptinfo not found" });
      }

      const orderid = receiptRows[0].orderid;

      // ดึง orderdetail ทั้งหมดที่ orderid ตรงกับ orderinfo
      const orderDetails = await db("orderdetail")
        .select(
          "orderdetail.productid",
          "orderdetail.qty",
          "orderdetail.productprice",
          "productinfo.productnameth",
          "productinfo.productnameeng"
        )
        .join("productinfo", "orderdetail.productid", "productinfo.productid")
        .where({ "orderdetail.orderid": orderid });

      const pricenet = Number(receiptRows[0].totalprice) - Number(receiptRows[0].receiptdiscount)
 
      // สร้าง object หลักสำหรับใบเสร็จ
      const mainInfo = {
        ...receiptRows[0],
        receiptid: receiptRows[0].receiptid,
        ordernumber: receiptRows[0].ordernumber,
        receiptnumber: receiptRows[0].receiptnumber,
        paymenttype: toPaymentType(receiptRows[0].paymenttype),
        ordertype: ORDERTYPE_OFFLINE,
        orderchannel: "Offline",
        receiptcash: Number(receiptRows[0].receiptcash),
        receiptchange: Number(receiptRows[0].receiptchange),
        receiptdiscount: Number(receiptRows[0].receiptdiscount),
        totalprice: Number(receiptRows[0].totalprice),
        totalpricenet: pricenet > 0 ? pricenet : 0,
        create_at: receiptRows[0].create_at,
        orderid: orderid,
        products: orderDetails.map((item) => ({
          productid: item.productid,
          productnameth: item.productnameth,
          productnameeng: item.productnameeng,
          qty: Number(item.qty),
          productprice: Number(item.productprice),
        })),
      };

      return resolve(mainInfo);
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([receiptInfoLogic, timeoutPromise])
    .then((data) => {
      res.send(data);
    })
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


      

