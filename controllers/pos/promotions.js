const {db} = require("../../db/postgresql");
const fs = require("fs");
const date = require("date-and-time");
const { uuid } = require("uuidv4");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT

// const { console } = require("inspector");
const {
  checkAuthorizetion,
  eventlog,
  notification,
} = require("../../modules/fun"); // ใช้บันทึก log

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

// shops list
exports.shopslist = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const shopsListLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      // ตรวจสอบการอนุญาตเข้าสู่ระบบ
      await checkAuthorizetion(req);

      const shops = await db("shopinfo")
      .select("shopid", "shopnameth", "create_at")
      .where({"status": true})
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

      if (!shops.length) {
        return reject({ status: 402, message: "shopid not found" });
      }
    }catch (error) {
      reject(error);
    }

  });

  Promise.race([timeoutPromise, shopsListLogic])
    .then((data) => {
        return res.send(data); // ส่ง response และหยุดการทำงาน
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
};

// products list
exports.productslist = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const productsListLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      // ตรวจสอบการอนุญาตเข้าสู่ระบบ
      await checkAuthorizetion(req);

      const products = await db("productinfo")
      .select("productid", "productnameth","create_at")
      .where({"status": true})
      .orderBy("create_at", "desc");

      const resultproducts = products.map((product) => ({
        productid: product.productid,
        productnameth: product.productnameth,
        create_at: Number(product.create_at),
      }))

      resolve({
        total: resultproducts.length,
        result: resultproducts,
      });

      if (!products.length) {
        return reject({ status: 402, message: "productid not found" });
      }

    }catch (error) {
      reject(error);
    }

  });

  Promise.race([timeoutPromise, productsListLogic])
    .then((data) => {
        return res.send(data); // ส่ง response และหยุดการทำงาน
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
};

// promotions create
exports.promotionCreate = async (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const {
      promotionname,
      shopid,
      typepromotions,
      productid,
      discount,
      promotionstart,
      promotionend,
      promotiondetail,
  } = req.body;

  const promotionCreateLogic = new Promise(async (resolve, reject) => {

    // console.log(req.body.shopid);
    
    try {

      // Validate API key
      await validateApiKey(req);

      // ตรวจสอบการอนุญาตเข้าสู่ระบบ
      await checkAuthorizetion(req);

      if (shopid == undefined || !checkString(shopid) || !promotionname || !typepromotions) {
        return reject({ status: 400, message: "Invalid request" });
      }

      if(productid == undefined){
        if(checkString(productid)){
          return reject({ status: 400, message: "productid not request" });
        }
      }

      await db("promoinfo").insert({
          datepromotion : date.format(new Date(), "YYYY-MM-DD HH:mm"),
          promoid : uuid(),
          shopid : shopid,
          typepromotions,
          productid : productid || null,
          promoname :promotionname,
          discount,
          datepromostart :promotionstart,
          datepromoend :promotionend,
          promoremark :promotiondetail || null,
          status : "ใช้งาน",
      }) 

      resolve({ status: 200, message: "Promotion created successfully" });

    } catch (error) {
      reject(error);
    }
  });

  Promise.race([promotionCreateLogic, timeoutPromise])
    .then(async(data) => {

      await eventlog(req, "เพิ่มโปรโมชั่น"); // บันทึก log
      await notification(req,'โปรโมชั่น', `"${promotionname}" โปรโมชั่นใหม่`); // notification

      return res.send(data); // ส่ง response และหยุดการทำงาน
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
};

// promotions list
exports.promotionslist = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const promotionsListLogic = new Promise(async (resolve, reject) => {
    
    try {

      // console.log("body:", req.query);

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลง timestamp

      const shopid = req.body.shopid || ""; // ค่าเริ่มต้นคือไม่มีค่า
      const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา
      const page = parseInt(req.query.page) || 1; // ค่าเริ่มต้นคือหน้า 1
      const limit = parseInt(req.query.limit) || 11; // ค่าเริ่มต้นคือ 10 รายการต่อหน้า
      const offset = (page - 1) * limit;

      const headers = req.headers.authorization;
      const token = headers.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const uinfoid = decoded.uinfoid;
      const ugroupid = decoded.ugroupid || "";

      // console.log("ugroupid >> ", ugroupid);
      // console.log("timestamp >> ", timestamp);
      // console.log("shopid >> ", shopid);

      // console.log("shopid >> ",shopid);
      // console.log("timestamp.startTimestamp >> ",timestamp.startTimestamp);
      // console.log("timestamp.endTimestamp >> ",timestamp.endTimestamp);

      const promotions = await db("promoinfo")
        .select("*")
        .whereNot({ status: "ยกเลิก" })
        .andWhere({"shopid":shopid})
        .andWhere("create_at", ">=", timestamp.startTimestamp)
        .andWhere("create_at", "<", timestamp.endTimestamp)
        .andWhere(function () {
          this.where("promoname", "ILIKE", `%${search}%`);
          // .orWhere("shopid", "ILIKE", `%${search}%`);
        })
        // .limit(limit)
        // .offset(offset)
        .orderBy("create_at", "desc");

      // console.log("promotions >> ", promotions);

      const pdpromoidlist = async(promoid_fk) => {
        return await db("pdpromotions")
        .select(
          "pdpromotions.pdpromotionid as pdpromotionid",
          "pdpromotions.productid as productid",
          "productinfo.productnameth as productnameth"
        )
        .join("productinfo", "productinfo.productid", "pdpromotions.productid")
        .where({ "pdpromotions.status": true })
        .andWhere({"pdpromotions.promoid":promoid_fk})}

      const promotionslist = await Promise.all(promotions.map(async(promotion) => {
        // console.log("promotion >> ", promotion);
        // 3. Determine Status based on Date Comparison
        let calculatedStatus = "ใช้งาน"; // ค่าเริ่มต้น
        const today = new Date();
        today.setHours(0, 0, 0, 0); // ตั้งเวลาเป็น 00:00:00.000 ของวันปัจจุบัน

        let endDate;
        try {
          endDate = new Date(promotion.datepromoend); // แปลง input เป็น Date object
          if (isNaN(endDate.getTime())) {
            // ตรวจสอบว่าแปลงเป็นวันที่ที่ถูกต้องหรือไม่
            return reject({
              status: 400,
              message: "Invalid request: Invalid promotionend date format",
            });
          }
          endDate.setHours(0, 0, 0, 0); // ตั้งเวลาของวันสิ้นสุดเป็น 00:00:00.000

          // เปรียบเทียบเฉพาะวันที่
          if (today.getTime() > endDate.getTime()) {
            calculatedStatus = "หมดเวลา"; // ถ้าวันปัจจุบันเลยวันสิ้นสุดไปแล้ว
          }
        } catch (dateError) {
          // console.error("Error parsing promotionend date:", dateError);
          return reject({
            status: 402,
            message: "Invalid request: Error processing promotionend date",
          });
        }

        const product = await pdpromoidlist(promotion.promoid);

        return {
          datepromotion: date.format(new Date(promotion.create_at*1000), 'YYYY-MM-DD HH:mm'),
          promoid: promotion.promoid,
          shopid: promotion.shopid,
          promoname: promotion.promoname,
          shopid: promotion.shopid,
          typepromotions: promotion.typepromotions,
          discount: promotion.discount,
          datepromostart: promotion.datepromostart,
          datepromoend: promotion.datepromoend,
          promoremark: promotion.promoremark,
          status: calculatedStatus,
          initial: promotion.initial,
          productidlist: product,
        }
      }));

      resolve({
        total: Number(promotionslist.length), // จํานวนรายการทั้งหมด/
        // page, // หน้าปัจจุบัน
        // limit, // จำนวนรายการต่อหน้า
        result: promotionslist,
      });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([promotionsListLogic, timeoutPromise])
    .then((data) => {
      return res.send(data); // ส่ง response และหยุดการทำงาน
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
};

// promotions update
exports.promotionUpdate = async (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const {
      promoid,
      promotionname,
      shopid,
      typepromotions,
      productid,
      discount,
      promotionstart,
      promotionend,
      promotiondetail,
  } = req.body;

  const promotionUpdateLogic = new Promise(async (resolve, reject) => {

    try {

      // Validate API key
      await validateApiKey(req);

      // ตรวจสอบการอนุญาตเข้าสู่ระบบ
      await checkAuthorizetion(req);

      if (
        !promoid ||
        !checkString(promoid) ||
        !promotionname ||
        !shopid ||
        !checkString(shopid) ||
        !typepromotions
      ) {
        return reject({ status: 400, message: "Invalid request" });
      }

      if(productid == undefined){
        if(!checkString(productid)){
          return reject({ status: 400, message: "Invalid request" });
        }
      }

      let updateData = {
        datepromotion: date.format(new Date(), "YYYY-MM-DD HH:mm"),
        shopid,
        typepromotions,
        promoname: promotionname,
        discount,
        datepromostart: promotionstart,
        datepromoend: promotionend,
        promoremark: promotiondetail,
      };

      if(productid != undefined){

        updateData.productid = productid;
        
      }

      await db("promoinfo").where({ promoid }).update(updateData) 

      resolve({ status: 200, message: "Promotion updated successfully" });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([promotionUpdateLogic, timeoutPromise])
    .then(async(data) => {

      await eventlog(req,"แก้ไขโปรโมชั่น") // บันทึก log
      await notification(req,'โปรโมชั่น', `มีการเปลี่ยนแปลงข้อมูลโปรโมชั่น "${promotionname}"`); // notification

      return res.send(data); // ส่ง response และหยุดการทำงาน
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
};

// products delete
exports.promotionDelete = async (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const promoid = req.params.id;

  const promotionDeleteLogic = new Promise(async (resolve, reject) => {

    try {

      // Validate API key
      await validateApiKey(req);

      // ตรวจสอบการอนุญาตเข้าสู่ระบบ
      await checkAuthorizetion(req);

      if (!promoid || !checkString(promoid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      await db("promoinfo").where({ promoid }).update({
        status : "ยกเลิก"
      })

      const promoname = await db("promoinfo").where({ promoid }).select("promoname");

      resolve({
        promoname: promoname[0].promoname,
        message: "Promotion deleted successfully",
      });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([promotionDeleteLogic, timeoutPromise])
    .then(async(data) => {

      await eventlog(req,"ลบโปรโมชั่น") // บันทึก log
      await notification(req,'โปรโมชั่น', `โปรโมชั่น "${data.promoname}" ถูกยกเลิก`); // notification

      return res.send(data); // ส่ง response และหยุดการทำงาน
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
};


