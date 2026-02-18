const {db} = require("../../db/postgresql");
const fs = require("fs");
const date = require("date-and-time");
const { uuid } = require("uuidv4");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT
// const { console } = require("inspector");

const {checkAuthorizetion} = require("../../modules/fun");
const {convertTotimestamp} = require("../../modules/convertTotimestamp");
const { default: tr } = require("date-and-time/locale/tr");

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

// event log
exports.eventloglist = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const eventlogLogic = new Promise(async (resolve, reject) => {
    try {

      const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา
      // console.log(req.ip); 
      
      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลง timestamp

      const shopid = req.body.shopid || "";
      const headers = req.headers.authorization;
      const token = headers.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const uinfoid = decoded.uinfoid;
      const ugroupid = decoded.ugroupid;

      // console.log("ugroupid >> ",ugroupid);
      if(!ugroupid){
        return reject({status: 402, message: "Ugroupid not found" });
      }

      // console.log("ugroupid >> ",ugroupid);
      let level = "";

      if(ugroupid !== "Admin"){  // ใน token ถ้า level = admin จะเป็น ugroupid = Admin

        await db("userinfo")
          .select("shopid","level")
          .where({ uinfoid, ugroupid })
          .first()
          .then(async(result) => {
            // console.log("result >> ", result);
            level  = result.level;

            if (result.length === 0) {
              return reject({ status: 402, message: "User not found" });
            }else{
              
              if (result.level !== "Owner" && result.level !== "Admin") {
                // console.log("ugroupid >> ",ugroupid);
                if (!result.shopid) {
                  return reject({ status: 402, message: "Shopid not found" });
                }
  
                // console.log("shopid >> ",shopid);
                // await db("userinfo")
                //   .select("shopid")
                //   .where({ shopid, uinfoid,ugroupid })
                //   .first()
                //   .then((result) => {
                //     // console.log("result >> ",result);
                //     if (result.length === 0) {
                //       return reject({ status: 402, message: "User not found" });
                //     }
                //   });
              }
  
            }
  
          });
      }else{
        level = "Admin";
      }

      const eventlogList = await db("eventloginfo")
      .select(
        "eventloginfo.id as id",
        "eventloginfo.timestamplog as timestamplog",
        // "eventloginfo.uinfoid as uinfoid",
        "userinfo.ugroupid as ugroupid",
        "userinfo.level as level",
        "userinfo.uinfologinname as uinfologinname",
        "userinfo.uinfoname as uinfoname",
        "userinfo.shopid as shopid",
        "shopinfo.shopnameth as shopnameth",
        "shopinfo.shopnameeng as shopnameeng",
        "eventloginfo.details as details",
      )

      .leftJoin("userinfo", "eventloginfo.uinfoid", "userinfo.uinfoid")
      .leftJoin("shopinfo", "userinfo.shopid", "shopinfo.shopid")
      // .where({"shopinfo.shopid":shopid})
      // .where({"userinfo.ugroupid": ugroupid})
      // .andWhere(function () {
      //     this.where("userinfo.level", "=", "Owner")
      //     .orWhere("userinfo.level", "=", "Admin")
      //     .orWhere({"shopinfo.shopid": shopid})
      //   })
      .andWhere(function () {

          if(level !== "Admin" ){

            this.where("userinfo.ugroupid", "=", ugroupid)
                .andWhere("userinfo.shopid", "ILIKE", `%${shopid}%`)

          }else if(level !== "Admin"  && level !== "Owner" ){

            this.where("userinfo.ugroupid", "=", ugroupid)
                .andWhere({"userinfo.shopid":shopid});

          }else{
            this.where("userinfo.shopid", "ILIKE", `%${shopid}%`)
          }
      })
      .andWhere("timestamplog", ">=", timestamp.startTimestamp)
      .andWhere("timestamplog", "<", timestamp.endTimestamp)
      // .andWhere("shopid", "ILIKE", `%${shopid}%`)
      .andWhere(function () {

        this.where("uinfologinname", "ILIKE", `%${search}%`)
        .orWhere("uinfoname", "ILIKE", `%${search}%`)
        .orWhere("shopnameth", "ILIKE", `%${search}%`)
        .orWhere("shopnameeng", "ILIKE", `%${search}%`)
        .orWhere("eventloginfo.details", "ILIKE", `%${search}%`)
        

      })
      .orderBy("timestamplog", "desc");

      // Format the timestamp within the fetched data
      const formattedResults = eventlogList.map(item => {

        let formattedTimestamp = '00/00/0000 00:00'; // Provide a default/fallback

        // Check if the timestamp exists and is valid
        if (item.timestamplog) {

          const orderDate = new Date(item.timestamplog*1000);
          // const orderDate = new Date(1737973730000);

          // Check if the created Date object is valid before formatting
          if (!isNaN(orderDate.getTime())) {
                // Use date.format with the required pattern
              formattedTimestamp = date.format(orderDate, 'YYYY-MM-DD HH:mm');

          } else {
              // Handle cases where the DB timestamp might be invalid
              console.warn(`Invalid date format encountered for order timestamp: ${item.timestamplog}`);
              formattedTimestamp = 'Invalid Date'; // Or keep original, or set to empty string
          }
        }

        return {
          ...item, // Keep all other properties from the log entry
          timestamplog: formattedTimestamp // Replace the original timestamp with the formatted string
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

  Promise.race([eventlogLogic, timeoutPromise])
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
};


// event log create (ไม่ได้ใช้)
exports.eventlogCreate = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const eventlogCreateLogic = new Promise(async (resolve, reject) => {
    try {
      const { uinfoid, details } = req.body;

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      if (!uinfoid) {
        return reject({ status: 400, message: "Invalid request" });
      }

      if (!details) {
        return reject({ status: 400, message: "Invalid request" });
      }

      // Insert data into the database
      await db("eventloginfo").insert({
        id: uuid(),
        uinfoid,
        timestamplog: Math.floor(Date.now() / 1000), // Convert to Unix timestamp
        details,
      });

      resolve({
        message: "created successfully",
      });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([eventlogCreateLogic, timeoutPromise])
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
};



