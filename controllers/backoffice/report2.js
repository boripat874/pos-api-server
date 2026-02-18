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

// report user list
exports.reportuserlist = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reportuserListLogic = new Promise(async (resolve, reject) => {

    try {

      const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const shopid = req.body.shopid;

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const orderlist = await db("userinfo")
      .select(
        "userinfo.uinfoid",
        "shopinfo.shopnameth",
        "usergroup.ugroupname",
        "userinfo.uinfoname",
        "userinfo.uinfologinname",
        "userinfo.level",
        "userinfo.details"
      )
      .leftJoin("shopinfo", "userinfo.shopid", "shopinfo.shopid")
      .leftJoin("usergroup", "userinfo.ugroupid", "usergroup.ugroupid")
      .where("shopinfo.shopid", shopid)
      .andWhere(function () {
        this.where("shopinfo.shopnameth", "ilike", `%${search}%`)
        .orWhere("usergroup.ugroupname", "ilike", `%${search}%`)
        .orWhere("userinfo.uinfoname", "ilike", `%${search}%`)
        .orWhere("userinfo.uinfologinname", "ilike", `%${search}%`)
        .orWhere("userinfo.level", "ilike", `%${search}%`)
      })
      .orderBy("userinfo.create_at", "desc");

      const formattedResults = orderlist.map(item => {
        return {
          ...item, // Keep other properties like shop names, product names etc.
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

  Promise.race([reportuserListLogic, timeoutPromise])
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

