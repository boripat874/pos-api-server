const {db} = require("../../db/postgresql");
const fs = require("fs");
const date = require("date-and-time");
const { uuid } = require("uuidv4");
const multer = require("multer");
const path = require("path");
// const { console } = require("inspector");

const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT

const {checkAuthorizetion} = require("../../modules/fun"); // ใช้บันทึก log

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

// dashboard total list
exports.dashboardlistAll = (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const dashboardtotallistLogic = new Promise(async (resolve, reject) => {
        try {

            await validateApiKey(req); // ตรวจสอบ API key

            // ตรวจสอบการอนุญาตเข้าสู่ระบบ
            await checkAuthorizetion(req);

            // --- ส่วนนี้คือการคำนวณ timestamp สำหรับวันนี้ ---
            // const today = new Date("2025-01-27");
            const today = new Date(); // สร้าง object Date สำหรับวันนี้
            today.setHours(0, 0, 0, 0); // ตั้งเวลาเป็นจุดเริ่มต้นของวัน (00:00:00.000) ตามเวลาท้องถิ่น
            const startOfDayTimestamp = Math.floor(today.getTime() / 1000); // แปลงเป็น Unix timestamp (วินาที) และปัดเศษลง

            const tomorrow = new Date(today); // สร้าง object Date ใหม่จาก today
            tomorrow.setDate(tomorrow.getDate() + 1); // เลื่อนไปเป็นวันพรุ่งนี้
            const startOfNextDayTimestamp = Math.floor(tomorrow.getTime() / 1000); // แปลงเป็น Unix timestamp (วินาที) สำหรับจุดเริ่มต้นของวันพรุ่งนี้
            // --- สิ้นสุดการคำนวณ timestamp ---


            // --- ส่วนนี้คือการ Query ข้อมูลจากฐานข้อมูล ---

            // คำนวณผลรวมของ 'ordertotalprice' และตั้งชื่อผลลัพธ์เป็น 'totalprice'
            const result_totalprice = await db("orderinfo") // เลือกตาราง 'orderinfo'
            .sum("ordertotalprice as totalprice") // คำนวณผลรวมของคอลัมน์ 'ordertotalprice' และตั้งชื่อผลลัพธ์ว่า 'totalprice'
            // กรองข้อมูลเฉพาะรายการที่ 'ordertimestamp' อยู่ภายในวันนี้
            .where("ordertimestamp", ">=", startOfDayTimestamp) // เลือกรายการที่ timestamp มากกว่าหรือเท่ากับจุดเริ่มต้นของวันนี้
            .andWhere("ordertimestamp", "<", startOfNextDayTimestamp) // และ timestamp น้อยกว่าจุดเริ่มต้นของวันพรุ่งนี้
            .first(); // ดึงผลลัพธ์เพียงแถวเดียว (sum จะคืนค่า array ที่มี object เดียว)

            // จัดการกรณีที่ไม่มีข้อมูลสำหรับวันนี้ (ผลรวมอาจเป็น null)
            const totalprice = result_totalprice && result_totalprice.totalprice ? Number(result_totalprice.totalprice) : 0; // ถ้ามีผลลัพธ์และ totalprice ไม่ใช่ null ให้แปลงเป็นตัวเลข, มิฉะนั้นให้เป็น 0

            // คำนวณผลรวมของ 'qty' และตั้งชื่อผลลัพธ์เป็น 'totalitem'
            const result_totalitem = await db("orderdetail") // เลือกตาราง 'orderdetail'
            .sum("orderdetail.qty as totalitem") // คำนวณผลรวมของคอลัมน์ 'qty' และตั้งชื่อผลลัพธ์ว่า 'totalitem'
            .join("orderinfo", "orderinfo.orderid", "orderdetail.orderid")
            // กรองข้อมูลเฉพาะรายการที่ 'ordertimestamp' อยู่ภายในวันนี้
            .where("orderinfo.ordertimestamp", ">=", startOfDayTimestamp) // เลือกรายการที่ timestamp มากกว่าหรือเท่ากับจุดเริ่มต้นของวันนี้
            .andWhere("orderinfo.ordertimestamp", "<", startOfNextDayTimestamp) // และ timestamp น้อยกว่าจุดเริ่มต้นของวันพรุ่งนี้
            .first(); 

            const totalitem = result_totalitem && result_totalitem.totalitem ? Number(result_totalitem.totalitem) : 0;


            // รายการสินค้าที่มีการสั่งซื้อมากที่สุด (10 รายการ) และตั้งชื่อผลลัพธ์เป็น 'popular_items'
            const result_popular_items = await db("orderdetail")
            .join("productinfo", "productinfo.productid", "orderdetail.productid")
            .join("orderinfo", "orderinfo.orderid", "orderdetail.orderid")
            // .join("shopinfo", "shopinfo.shopid", "productinfo.shopid")
            .where("orderinfo.ordertimestamp", ">=", startOfDayTimestamp)
            .andWhere("orderinfo.ordertimestamp", "<", startOfNextDayTimestamp)
            .groupBy("productinfo.productid" ,"productinfo.productnameth")
            .select("productinfo.productid" ,"productinfo.productnameth")
            // .having("shopinfo.shopnameth", "like", "%ร้าน%")
            .count("orderdetail.qty as totalitem")
            .orderBy("totalitem", "desc")
            .limit(10)
            // .orderBy("orderinfo.orderid", "desc")

            const popular_items = result_popular_items.map((item) => {
                return {
                    productid: item.productid,
                    productnameth: item.productnameth,
                    totalitem: Number(item.totalitem),
                };
            });

            // รายการสั่งซื้อ และตั้งชื่อผลลัพธ์เป็น 'itemlist'
            result_orderlist = await db("orderinfo")
            .select(
                "orderinfo.ordernumber as ordernumber",
                "orderinfo.ordertimestamp as ordertimestamp",
                // "productinfo.productnameth as productnameth",
                "orderinfo.ordertotalprice as ordertotalprice",
                "orderinfo.ordertotaldiscount as ordertotaldiscount",
                "orderinfo.vat7pc as vat7pc",
                "orderinfo.orderpricenet as orderpricenet",
                "orderinfo.orderpaytype as orderpaytype"
            )
            .where("orderinfo.ordertimestamp", ">=", startOfDayTimestamp)
            .andWhere("orderinfo.ordertimestamp", "<", startOfNextDayTimestamp)
            .orderBy("ordertimestamp", "desc")

            const orderlist = result_orderlist.map((order) => {
                return {
                    ordertimestamp: date.format(new Date(order.ordertimestamp * 1000), "YYYY-MM-DD HH:mm"),
                    ordernumber: order.ordernumber,
                    // product: order.productnameth,
                    ordertotalprice: Number(order.ordertotalprice),
                    ordertotaldiscount: Number(order.ordertotaldiscount),    
                    vat7pc: Number(order.vat7pc),
                    orderpricenet: Number(order.orderpricenet),
                    orderpaytype: Number(order.orderpaytype),
                };
            })

            // ส่งผลลัพธ์กลับไปในรูปแบบ object
            resolve({ 
                totalprice: totalprice,
                totalitem: totalitem,
                popular_items: popular_items,
                orderlist: orderlist
            });
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([dashboardtotallistLogic, timeoutPromise])
    .then((result) => {
        res.status(200).json(result);
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
}

// dashboard total
exports.dashboardtotal = (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const dashboardtotallistLogic = new Promise(async (resolve, reject) => {
        try {

            await validateApiKey(req); // ตรวจสอบ API key

            let period = req.query.period || "today"; // ค่าที่เป็นไปได้: "today", "thisweek", "thismonth", "thisyear"

            let startTimestamp;
            let endTimestamp;
            const now = new Date(); // รับวันที่และเวลาปัจจุบัน *เมื่อโค้ดทำงาน*

            // --- คำนวณ timestamp เริ่มต้นและสิ้นสุดตามช่วงเวลา (period) ---

            if (period === "thisyear") {
                // จุดเริ่มต้นของปีปัจจุบัน (1 มกราคม, 00:00:00)
                const startOfYear = new Date(now.getFullYear(), 0, 1); // เดือนเป็นแบบ 0-indexed (0 = มกราคม)
                startOfYear.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfYear.getTime() / 1000);

                // จุดเริ่มต้นของปีถัดไป (1 มกราคม ของปีถัดไป, 00:00:00)
                const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1);
                startOfNextYear.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextYear.getTime() / 1000);

            } else if (period === "thismonth") {
                // จุดเริ่มต้นของเดือนปัจจุบัน (วันที่ 1, 00:00:00)
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                startOfMonth.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfMonth.getTime() / 1000);

                // จุดเริ่มต้นของเดือนถัดไป (วันที่ 1 ของเดือนถัดไป, 00:00:00)
                const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1); // JS จัดการการเปลี่ยนเดือน/ปีอัตโนมัติ
                startOfNextMonth.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextMonth.getTime() / 1000);

            } else if (period === "thisweek") {
                // จุดเริ่มต้นของสัปดาห์ปัจจุบัน (สมมติว่าวันอาทิตย์เป็นวันแรก, วันที่ 0)
                const currentDayOfWeek = now.getDay(); // 0 สำหรับวันอาทิตย์, 1 สำหรับวันจันทร์, ..., 6 สำหรับวันเสาร์
                const startOfWeek = new Date(now); // สร้างสำเนา
                startOfWeek.setDate(now.getDate() - currentDayOfWeek); // ย้อนกลับไปหาวันอาทิตย์ล่าสุด
                startOfWeek.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfWeek.getTime() / 1000);

                // จุดเริ่มต้นของสัปดาห์ถัดไป (วันอาทิตย์หน้า, 00:00:00)
                const startOfNextWeek = new Date(startOfWeek);
                startOfNextWeek.setDate(startOfWeek.getDate() + 7); // เพิ่ม 7 วัน
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(startOfNextWeek.getTime() / 1000);

            } else { // กรณีเริ่มต้น, รวมถึง period === "today"
                // จุดเริ่มต้นของวันนี้ (00:00:00)
                const today = new Date(now); // สร้างสำเนา
                today.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(today.getTime() / 1000);

                // จุดเริ่มต้นของวันพรุ่งนี้ (00:00:00)
                const tomorrow = new Date(today);
                tomorrow.setDate(today.getDate() + 1);
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(tomorrow.getTime() / 1000);
            }

            // console.log("startTimestamp:", startTimestamp);
            // console.log("endTimestamp:", endTimestamp);

            // --- ส่วนนี้คือการ Query ข้อมูลจากฐานข้อมูล ---
            // คำนวณผลรวมของ 'ordertotalprice' และตั้งชื่อผลลัพธ์เป็น 'totalprice'
            const result_totalprice = await db("orderinfo") // เลือกตาราง 'orderinfo'
            .sum("ordertotalprice as totalprice") // คำนวณผลรวมของคอลัมน์ 'ordertotalprice' และตั้งชื่อผลลัพธ์ว่า 'totalprice'
            // กรองข้อมูลเฉพาะรายการที่ 'ordertimestamp' อยู่ภายในวันนี้
            .where("ordertimestamp", ">=", startTimestamp) // เลือกรายการที่ timestamp มากกว่าหรือเท่ากับจุดเริ่มต้นของวันนี้
            .andWhere("ordertimestamp", "<", endTimestamp) // และ timestamp น้อยกว่าจุดเริ่มต้นของวันพรุ่งนี้
            .first(); // ดึงผลลัพธ์เพียงแถวเดียว (sum จะคืนค่า array ที่มี object เดียว)

            // จัดการกรณีที่ไม่มีข้อมูลสำหรับวันนี้ (ผลรวมอาจเป็น null)
            const totalprice = result_totalprice && result_totalprice.totalprice ? Number(result_totalprice.totalprice) : 0; // ถ้ามีผลลัพธ์และ totalprice ไม่ใช่ null ให้แปลงเป็นตัวเลข, มิฉะนั้นให้เป็น 0

            const result_totalitem = await db("orderdetail") // เลือกตาราง 'orderdetail'
            .sum("orderdetail.qty as totalitem") // คำนวณผลรวมของคอลัมน์ 'qty' และตั้งชื่อผลลัพธ์ว่า 'totalitem'
            .join("orderinfo", "orderinfo.orderid", "orderdetail.orderid")
            // กรองข้อมูลเฉพาะรายการที่ 'ordertimestamp' อยู่ภายในวันนี้
            .where("orderinfo.ordertimestamp", ">=", startTimestamp) // เลือกรายการที่ timestamp มากกว่าหรือเท่ากับจุดเริ่มต้นของวันนี้
            .andWhere("orderinfo.ordertimestamp", "<", endTimestamp) // และ timestamp น้อยกว่าจุดเริ่มต้นของวันพรุ่งนี้
            .first(); 

            const totalitem = result_totalitem && result_totalitem.totalitem ? Number(result_totalitem.totalitem) : 0;

            // ส่งผลลัพธ์กลับไปในรูปแบบ object
            resolve({ 
                totalprice: totalprice,
                totalitem: totalitem,
            });
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([dashboardtotallistLogic, timeoutPromise])
    .then((result) => {
        res.status(200).json(result);
    })
    .catch((error) => {
        
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        } else if (error.message === "Request timed out") {
            return res.status(402).json({ message: "Request timed out" });
        } else {
            handleError(error, res);
        }

    });
}

// dashboard popular item
exports.dashboardpopularitem = (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const dashboardtotallistLogic = new Promise(async (resolve, reject) => {
        try {

            await validateApiKey(req); // ตรวจสอบ API key

            let period = req.query.period || "today"; // ค่าที่เป็นไปได้: "today", "thisweek", "thismonth", "thisyear"

            let startTimestamp;
            let endTimestamp;
            const now = new Date(); // รับวันที่และเวลาปัจจุบัน *เมื่อโค้ดทำงาน*

            // --- คำนวณ timestamp เริ่มต้นและสิ้นสุดตามช่วงเวลา (period) ---

            if (period === "thisyear") {
                // จุดเริ่มต้นของปีปัจจุบัน (1 มกราคม, 00:00:00)
                const startOfYear = new Date(now.getFullYear(), 0, 1); // เดือนเป็นแบบ 0-indexed (0 = มกราคม)
                startOfYear.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfYear.getTime() / 1000);

                // จุดเริ่มต้นของปีถัดไป (1 มกราคม ของปีถัดไป, 00:00:00)
                const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1);
                startOfNextYear.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextYear.getTime() / 1000);

            } else if (period === "thismonth") {
                // จุดเริ่มต้นของเดือนปัจจุบัน (วันที่ 1, 00:00:00)
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                startOfMonth.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfMonth.getTime() / 1000);

                // จุดเริ่มต้นของเดือนถัดไป (วันที่ 1 ของเดือนถัดไป, 00:00:00)
                const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1); // JS จัดการการเปลี่ยนเดือน/ปีอัตโนมัติ
                startOfNextMonth.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextMonth.getTime() / 1000);

            } else if (period === "thisweek") {
                // จุดเริ่มต้นของสัปดาห์ปัจจุบัน (สมมติว่าวันอาทิตย์เป็นวันแรก, วันที่ 0)
                const currentDayOfWeek = now.getDay(); // 0 สำหรับวันอาทิตย์, 1 สำหรับวันจันทร์, ..., 6 สำหรับวันเสาร์
                const startOfWeek = new Date(now); // สร้างสำเนา
                startOfWeek.setDate(now.getDate() - currentDayOfWeek); // ย้อนกลับไปหาวันอาทิตย์ล่าสุด
                startOfWeek.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfWeek.getTime() / 1000);

                // จุดเริ่มต้นของสัปดาห์ถัดไป (วันอาทิตย์หน้า, 00:00:00)
                const startOfNextWeek = new Date(startOfWeek);
                startOfNextWeek.setDate(startOfWeek.getDate() + 7); // เพิ่ม 7 วัน
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(startOfNextWeek.getTime() / 1000);

            } else { // กรณีเริ่มต้น, รวมถึง period === "today"
                // จุดเริ่มต้นของวันนี้ (00:00:00)
                const today = new Date(now); // สร้างสำเนา
                today.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(today.getTime() / 1000);

                // จุดเริ่มต้นของวันพรุ่งนี้ (00:00:00)
                const tomorrow = new Date(today);
                tomorrow.setDate(today.getDate() + 1);
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(tomorrow.getTime() / 1000);
            }

            // รายการสินค้าที่มีการสั่งซื้อมากที่สุด (10 รายการ) และตั้งชื่อผลลัพธ์เป็น 'popular_items'
            const result_popular_items = await db("orderdetail")
            .join("productinfo", "productinfo.productid", "orderdetail.productid")
            .join("orderinfo", "orderinfo.orderid", "orderdetail.orderid")
            // .join("shopinfo", "shopinfo.shopid", "productinfo.shopid")
            .where("orderinfo.ordertimestamp", ">=", startTimestamp)
            .andWhere("orderinfo.ordertimestamp", "<", endTimestamp)
            .groupBy("productinfo.productid" ,"productinfo.productnameth")
            .select("productinfo.productid" ,"productinfo.productnameth")
            // .having("shopinfo.shopnameth", "like", "%ร้าน%")
            .count("orderdetail.qty as totalitem")
            .orderBy("totalitem", "desc")
            .limit(10)
            // .orderBy("orderinfo.orderid", "desc")

            const popular_items = result_popular_items.map((item) => {
                return {
                    productid: item.productid,
                    productnameth: item.productnameth,
                    totalitem: Number(item.totalitem),
                };
            });

            // ส่งผลลัพธ์กลับไปในรูปแบบ object
            resolve({ 
                popular_items: popular_items,
            });
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([dashboardtotallistLogic, timeoutPromise])
    .then((result) => {
        res.status(200).json(result);
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
}

// dashboard shoplist
exports.dashboardorderlist = (req, res) => {

    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const dashboardtotallistLogic = new Promise(async (resolve, reject) => {
        try {

            await validateApiKey(req); // ตรวจสอบ API key

            let period = req.query.period || "today"; // ค่าที่เป็นไปได้: "today", "thisweek", "thismonth", "thisyear"

            let startTimestamp;
            let endTimestamp;
            const now = new Date(); // รับวันที่และเวลาปัจจุบัน *เมื่อโค้ดทำงาน*

            // --- คำนวณ timestamp เริ่มต้นและสิ้นสุดตามช่วงเวลา (period) ---

            if (period === "thisyear") {
                // จุดเริ่มต้นของปีปัจจุบัน (1 มกราคม, 00:00:00)
                const startOfYear = new Date(now.getFullYear(), 0, 1); // เดือนเป็นแบบ 0-indexed (0 = มกราคม)
                startOfYear.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfYear.getTime() / 1000);

                // จุดเริ่มต้นของปีถัดไป (1 มกราคม ของปีถัดไป, 00:00:00)
                const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1);
                startOfNextYear.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextYear.getTime() / 1000);

            } else if (period === "thismonth") {
                // จุดเริ่มต้นของเดือนปัจจุบัน (วันที่ 1, 00:00:00)
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                startOfMonth.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfMonth.getTime() / 1000);

                // จุดเริ่มต้นของเดือนถัดไป (วันที่ 1 ของเดือนถัดไป, 00:00:00)
                const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1); // JS จัดการการเปลี่ยนเดือน/ปีอัตโนมัติ
                startOfNextMonth.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextMonth.getTime() / 1000);

            } else if (period === "thisweek") {
                // จุดเริ่มต้นของสัปดาห์ปัจจุบัน (สมมติว่าวันอาทิตย์เป็นวันแรก, วันที่ 0)
                const currentDayOfWeek = now.getDay(); // 0 สำหรับวันอาทิตย์, 1 สำหรับวันจันทร์, ..., 6 สำหรับวันเสาร์
                const startOfWeek = new Date(now); // สร้างสำเนา
                startOfWeek.setDate(now.getDate() - currentDayOfWeek); // ย้อนกลับไปหาวันอาทิตย์ล่าสุด
                startOfWeek.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfWeek.getTime() / 1000);

                // จุดเริ่มต้นของสัปดาห์ถัดไป (วันอาทิตย์หน้า, 00:00:00)
                const startOfNextWeek = new Date(startOfWeek);
                startOfNextWeek.setDate(startOfWeek.getDate() + 7); // เพิ่ม 7 วัน
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(startOfNextWeek.getTime() / 1000);

            } else { // กรณีเริ่มต้น, รวมถึง period === "today"
                // จุดเริ่มต้นของวันนี้ (00:00:00)
                const today = new Date(now); // สร้างสำเนา
                today.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(today.getTime() / 1000);

                // จุดเริ่มต้นของวันพรุ่งนี้ (00:00:00)
                const tomorrow = new Date(today);
                tomorrow.setDate(today.getDate() + 1);
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(tomorrow.getTime() / 1000);
            }

            // รายการสั่งซื้อ และตั้งชื่อผลลัพธ์เป็น 'orderlist'
            result_orderlist = await db("orderinfo")
            .select(
                "orderinfo.ordernumber as ordernumber",
                "orderinfo.ordertimestamp as ordertimestamp",
                // "productinfo.productnameth as productnameth",
                "orderinfo.ordertotalprice as ordertotalprice",
                "orderinfo.ordertotaldiscount as ordertotaldiscount",
                "orderinfo.vat7pc as vat7pc",
                "orderinfo.orderpricenet as orderpricenet",
                "orderinfo.orderpaytype as orderpaytype"
            )
            .where("orderinfo.ordertimestamp", ">=", startTimestamp)
            .andWhere("orderinfo.ordertimestamp", "<", endTimestamp)
            .orderBy("ordertimestamp", "desc")

            const orderlist = result_orderlist.map((item) => {
                return {
                    ordertimestamp: date.format(new Date(item.ordertimestamp * 1000), "YYYY-MM-DD HH:mm"),
                    ordernumber: item.ordernumber,
                    // product: item.productnameth,
                    ordertotalprice: item.ordertotalprice,
                    ordertotaldiscount: item.ordertotaldiscount,
                    vat7pc: item.vat7pc,
                    orderpricenet: item.orderpricenet,
                    orderpaytype: Number(item.orderpaytype),
                };
            })


            // ส่งผลลัพธ์กลับไปในรูปแบบ object
            resolve({ 
                orderlist: orderlist
            });
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([dashboardtotallistLogic, timeoutPromise])
    .then((result) => {
        res.status(200).json(result);
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
}