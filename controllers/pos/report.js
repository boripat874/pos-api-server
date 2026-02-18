const {db} = require("../../db/postgresql");
const fs = require("fs");
const date = require("date-and-time");
const { uuid } = require("uuidv4");
const multer = require("multer");
const path = require("path");
const { console } = require("inspector");
const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT

const {
  checkAuthorizetion
} = require("../../modules/fun"); // ใช้บันทึก log

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

      // ตรวจสอบการอนุญาตเข้าสู่ระบบ
      await checkAuthorizetion(req);

      const orderlist = await db("orderinfo")
      .select(
        "orderinfo.ordertimestamp as ordertimestamp",
        "shopinfo.shopnameth as shopnameth",
        "shopinfo.shopnameeng as shopnameeng",
        "orderinfo.ordernumber as ordernumber",
        "orderinfo.orderpricenet as orderpricenet",
        "orderinfo.vat7pc as vat7pc",
        "orderinfo.ordertotaldiscount as ordertotaldiscount",
        "orderinfo.ordertotalprice as ordertotalprice",
      )
      .join("shopinfo", "shopinfo.shopid", "orderinfo.shopid")
      .andWhere(function () {
          this.where("shopnameth", "ILIKE", `%${search}%`)
          .orWhere("shopnameeng", "ILIKE", `%${search}%`)
          .orWhere("ordernumber", "ILIKE", `%${search}%`)
      })
      .orderBy("orderid", "desc");

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

        return {
            ...item, // Keep other properties like shop names, product names etc.
            ordertimestamp: formattedTimestamp, // Use the formatted timestamp
            orderpricenet: Number(item.orderpricenet),
            vat7pc: Number(item.vat7pc),
            ordertotaldiscount: Number(item.ordertotaldiscount),
            ordertotalprice: Number(item.ordertotalprice)
        };
      });

      resolve({
        total: formattedResults.length,
        result: formattedResults,
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

// report product sell list
exports.reportproductselllist = (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reportproductsellListLogic = new Promise(async (resolve, reject) => {
    try {

      const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา

      // Validate API key
      await validateApiKey(req);

      // ตรวจสอบการอนุญาตเข้าสู่ระบบ
      await checkAuthorizetion(req);

      const orderdetaillist = await db("orderdetail")
      .select(
        "orderdetail.id as id",
        "orderinfo.ordertimestamp as ordertimestamp",
        "shopinfo.shopnameth as shopnameth",
        "shopinfo.shopnameeng as shopnameeng",
        "productinfo.productnameth as productnameth",
        "productinfo.productnameeng as productnameeng",
        "orderdetail.qty as qty",
        "orderdetail.productprice as productprice",
        // Calculate totalprice directly in the database query and alias it
        db.raw('CAST(orderdetail.qty AS NUMERIC) * CAST(orderdetail.productprice AS NUMERIC) as totalprice')
      )
      .join("orderinfo", "orderinfo.orderid", "orderdetail.orderid")
      .join("productinfo", "productinfo.productid", "orderdetail.productid")
      .join('shopinfo', 'shopinfo.shopid', 'productinfo.shopid')
      // .where({ "status": true }) // เงื่อนไข status = true
      .andWhere(function () {
          this.where("productnameth", "ILIKE", `%${search}%`)
          .orWhere("productnameeng", "ILIKE", `%${search}%`)
          .orWhere("shopnameth", "ILIKE", `%${search}%`)
          .orWhere("shopnameeng", "ILIKE", `%${search}%`)
      })
      .orderBy("orderdetail.orderid", "desc");

      // Format results: Convert numbers and format the timestamp
      const formattedResults = orderdetaillist.map(item => {
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

        return {
            ...item, // Keep other properties like shop names, product names etc.
            ordertimestamp: formattedTimestamp, // Use the formatted timestamp
            productprice: Number(item.productprice),
            qty: Number(item.qty),
            totalprice: Number(item.totalprice)
        };
      });

      resolve({
        total: formattedResults.length, // Use the length of the results from the query
        result: formattedResults,      // Use the results directly
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reportproductsellListLogic, timeoutPromise])
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

}

