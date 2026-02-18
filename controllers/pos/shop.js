const {db} = require("../../db/postgresql");
const fs = require("fs");
const date = require("date-and-time");
const { uuid } = require("uuidv4");
const multer = require("multer");
const path = require("path");
const { console } = require("inspector");
const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT
const {checkAuthorizetion,eventlog, notification} = require("../../modules/fun"); // ใช้บันทึก log

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

//shop list ✓
exports.shoplist = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const shopListLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      // ตรวจสอบการอนุญาตเข้าสู่ระบบ
      await checkAuthorizetion(req);

      const shoplist = await db("shopinfo")
        .select("shopid", "shopnameth")
        .where({ status: true })
        .orderBy("create_at", "desc");

      const resultshops = shops.map((shop) => ({
        shopid: shop.shopid,
        shopnameth: shop.shopnameth,
        create_at: Number(shop.create_at),
      }))

      resolve({
        total: resultshops.length,
        result: resultshops,
      });

    } catch (error) {
      return reject(error);
    }
  });

  Promise.race([shopListLogic, timeoutPromise])
    .then((result) => {
      res.send(result); // Send the response only once
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

//shop detail ✓
exports.shopdetail = async(req, res) => {

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeout)
    );
  
    const shopDetailLogic = new Promise(async (resolve, reject) => {
      try {
        const { shopid } = req.body;
  
        // Validate API key
        await validateApiKey(req);

        await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน
  
        if (!shopid || !checkString(shopid)) {
          return reject({ status: 400, message: "Invalid request" });
        }
  
        const db_shopid = await db
          .select("shopid")
          .from("shopinfo")
          .where({ shopid });
  
        if (!db_shopid.length) {
          return reject({ status: 402 ,shopid: shopid, message: "shopid not found" });
        }
  
        const shopdetail = await db
          .select("*")
          .from("shopinfo")
          .where({ shopid });
  
        let shopdetail_data = {};
        shopdetail.forEach((element) => {
          shopdetail_data = {
            shopid: element.shopid,
            merid: element.merid,
            shoptype: element.shoptype,
            shopnameth: element.shopnameth,
            shopnameeng: element.shopnameeng,
            shopopentime: element.shopopentime,
            shopclosetime: element.shopclosetime,
            shopexpiredate: date.format(
              new Date(element.shopexpiredate),
              "YYYY-MM-DD"
            ),
            shopdata1: element.shopdata1,
            shopdata2: element.shopdata2,
            shoplogoimage: element.shoplogoimage,
            ugroupid: element.ugroupid
          };
        });
        // console.log(shopdetail_data)
  
        resolve(shopdetail_data);
      } catch (error) {
        reject(error);
      }
    });
  
    Promise.race([shopDetailLogic, timeoutPromise])
      .then((data) => {
        res.send(data); // Send the response only once
      })
      .catch((error) => {
        if (error.status) {
          if(error.shopid !== undefined){
            return res.status(error.status).json({shopid: error.shopid , message: error.message });
          }else{
            return res.status(error.status).json({ message: error.message });
          }
        } else if (error.message === "Request timed out") {
          res.status(402).json({ message: "Request timed out" });
        } else {
          handleError(error, res);
        }
    });
};
