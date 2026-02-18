const {db} = require("../../db/postgresql");
const fs = require("fs");
const date = require("date-and-time");
const { uuid } = require("uuidv4");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT
// const { console } = require("inspector");
// const {checkAuthorizetion} = require("../../modules/fun");

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

// ฟังก์ชันสําหรับตรวจสอบการเข้าสู่ระบบ
exports.checklogin = async (req, res) => {

    const timeoutPromise = new Promise((_, reject) => {

        setTimeout(() => {
        reject(new Error('Request timed out'));
        }, timeout);

    });
    
    const checkloginLogic = new Promise(async(resolve, reject) => {
      
      try {

        await validateApiKey(req);

        // await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

        if (!req.headers.authorization ) {
          return reject({ status: 401, message: "Unauthorized: Missing Authorization header" });
        }

        const headers = req.headers.authorization;
        let token;
        let decoded;
        let uinfoid = null;

        if (headers && headers.startsWith("Bearer ")) {
          token = headers.split(" ")[1];
          if (token) {
            try {
                // พยายาม verify แต่ถ้า error ก็ไม่ reject ทันที
                decoded = jwt.verify(token, process.env.JWT_SECRET);
                uinfoid = decoded?.uinfoid; // ใช้ optional chaining
            } catch (jwtError) {
                // *** จุดที่ "ข้าม" error ***
                console.warn("JWT verification failed (ignored):", jwtError.message);
                return reject({ status: 401, message: jwtError });
                // ไม่ reject แต่ปล่อยให้ uinfoid เป็น null หรือค่าเริ่มต้น
            }
          }
        }

        // *** ขั้นตอนที่ 2: ตรวจสอบ Denylist (ถ้า jwt.verify ผ่าน) ***
        const jti = decoded.jti;
        if (!jti) {
            // Token ไม่มี jti? อาจเป็น token เก่า หรือระบบมีปัญหา
            console.error("Token verification succeeded but 'jti' claim is missing.");
            return reject({ status: 401, message: "Unauthorized: Invalid token structure (missing jti)." });
        }

        const isRevoked = await db('revoked_tokens')
            .select('jti')
            .where({ jti: jti })
            .first(); // ใช้ first() เพื่อหาแค่ record เดียว

        if (isRevoked) {
            // *** ถ้า Token อยู่ใน Denylist -> Reject ***
            console.log(`Access denied: Token ${jti} is revoked.`);
            return reject({ status: 401, message: "Unauthorized: Token has been revoked" });
        }

        // --- ตรวจสอบ uinfoid ถ้ามี ---
        if (uinfoid) {
          const userExists = await db("userinfo")
            .select("*")
            .where({ uinfoid })
            .first(); // ใช้ first() เพื่อประสิทธิภาพที่ดีกว่า

        if (!userExists) {
            // ถ้า verify ผ่าน แต่หา user ไม่เจอ ก็ควร reject
            return reject({ status: 402, message: "User associated with token not found" });
        }

        // ถ้า verify ผ่าน และเจอ user
        resolve({
          message: "User is logged in",
          level: userExists.level,
          shopid: userExists.shopid,
          ugroupid: userExists.ugroupid
        });

      } else {
          // ถ้าไม่มี token หรือ verify ไม่ผ่าน (และเราเลือกที่จะข้าม error)
          // อาจจะ reject หรือ resolve ด้วยสถานะอื่น ขึ้นอยู่กับว่าต้องการให้ระบบทำงานต่ออย่างไร
          // ในที่นี้เลือก reject เพื่อบ่งบอกว่าการตรวจสอบไม่สำเร็จ
           return reject({ status: 401, message: "Unauthorized: Invalid or missing token" });
      }

      } catch (error) {

        return reject(error);

      }

    })

    Promise.race([checkloginLogic, timeoutPromise])
    .then((data) => {

        return res.send(data); // ส่ง response และหยุดการทำงาน
    })
    .catch((error) => {

      if (error.status) {

          return res.status(error.status).json({ message: error.message });

      } else if (error.message === "Request timed out") {

          return res.status(402).json({ message: "Request timed out" });

      } else {
          
        return handleError(error, res);
      }
    });

} 