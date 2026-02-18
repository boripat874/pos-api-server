const {db} = require("../../db/postgresql");
const fs = require("fs");
const date = require("date-and-time");
const { uuid } = require("uuidv4");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT
const {eventlog, notification , checkAuthorizetion} = require("../../modules/fun"); // ใช้บันทึก log
const { default: tr } = require("date-and-time/locale/tr");

require("dotenv").config();

const timeout = 60000; // Timeout in milliseconds (e.g., 60 seconds)

// ตั้งค่าการจัดเก็บไฟล์
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // โฟลเดอร์สำหรับเก็บไฟล์
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
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

  const autihorized = await db
    .select("apikey")
    .where({ apikey: X_API_KEY })
    .from("shopinfo");

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

//groupshoplist user list ✓
exports.groupshoplist = async(req,res) =>{

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), timeout)
    );
    
    const groupuserListLogic = new Promise(async (resolve, reject) => {
        try {
            
          const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา
          // console.log(shopid);
          // Validate API key
          await validateApiKey(req);

          await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

          const headers = req.headers.authorization;
          const token = headers.split(" ")[1];
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const uinfoid = await decoded.uinfoid || "";
          const ugroupid = await decoded.ugroupid || "";

          const dbuser = await db("userinfo")
          .select("level", "shopid")
          .where({ uinfoid: uinfoid })
          .first();

          if(!dbuser){

            return reject({status: 402, message: "User not found"});

          }else if (

            dbuser.level !== "Admin" && dbuser.level !== "Owner"

          ) {
            return reject({
              status: 402,
              message: "You don't have permission to access",
            });
          }

          // const currentUserLevel = dbuser.level; 
    
          // Join userinfo กับ shopinfo
          const groupuserlist = await db("usergroup")
          .select("*")
          .where({ "status": true }) // เงื่อนไข status = true
          .andWhere(function () {
              this.where("ugroupname", "ILIKE", `%${search}%`);
              // .orWhere("usernameeng", "ILIKE", `%${search}%`)
          })
          .orderBy("create_at", "desc");
          
          // console.log(userlist)
          const groupuserlist_data = groupuserlist.map((user) => (
            {
              ugroupname: user.ugroupname,
              uinfoid: user.uinfoid,
              ugroupid: user.ugroupid,
            }
          ));
    
          resolve({
            total: groupuserlist.length,
            result: groupuserlist_data,
          });
        } catch (error) {
          reject(error);
        }
      });
    
      Promise.race([groupuserListLogic, timeoutPromise])
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

// shop list ✓
exports.shoplist = async(req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const shopListLogic = new Promise(async (resolve, reject) => {
    try {

      // รับค่าพารามิเตอร์ page และ limit จาก query string
      const page = parseInt(req.query.page) || 1; // ค่าเริ่มต้นคือหน้า 1
      const limit = parseInt(req.query.limit) || 12; // ค่าเริ่มต้นคือ 10 รายการต่อหน้า
      const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา
      const offset = (page - 1) * limit;

      // console.log("search :", search);

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const headers = req.headers.authorization;
      const token = headers.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const uinfoid = await decoded.uinfoid || "";
      const ugroupid = await decoded.ugroupid || "";

      const dbuser = await db("userinfo")
        .select("level", "shopid")
        .where({ uinfoid: uinfoid })
        .first();

        if(!dbuser){

          return reject({status: 402, message: "User not found"});

        }else if (

          dbuser.level !== "Admin" && dbuser.level !== "Owner"

        ) {
          return reject({
            status: 402,
            message: "You don't have permission to access",
          });
        }

      // ดึงข้อมูลทั้งหมดเพื่อคำนวณ total
      const totalShopsQuery = db("shopinfo").count("shopid as count").where("status", true).andWhere(function () {
        this.where("shopnameth", "ILIKE", `%${search}%`)
        .orWhere("shopnameeng", "ILIKE", `%${search}%`);
      });
      
      let shoplist = [];
      

      // ดึงข้อมูลเฉพาะหน้าที่ต้องการ
      shoplist = await db("shopinfo")
        .select(
          "shopid",
          "merid",
          "shopnameth",
          "shopnameeng",
          "create_at",
          "status"
        )
        .where(function () {
          if (dbuser.level === "Admin") {
            this.where(true);
          } else {
            this.where("status", true);
          }
        })
        .andWhere(function () {
          this.where("shopnameth", "ILIKE", `%${search}%`).orWhere(
            "shopnameeng",
            "ILIKE",
            `%${search}%`
          );
        })
        .limit(limit)
        .offset(offset)
        .orderBy("create_at", "desc");

      const totalShops = await totalShopsQuery;
      const total = totalShops[0].count; // จำนวนร้านค้าทั้งหมด

      // เตรียมข้อมูลสำหรับ response
      resolve({
        total, // จำนวนรายการทั้งหมด
        page, // หน้าปัจจุบัน
        limit, // จำนวนรายการต่อหน้า
        result: shoplist, // รายการในหน้านั้น
      });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([shopListLogic, timeoutPromise])
    .then((data) => {
      res.send(data); // ส่ง response
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

//shop create ✓
exports.shopcreate = [

  upload.single("logo"), // รับไฟล์จากฟิลด์ชื่อ "logo"

  async(req, res) => {

  // ตรวจสอบว่ามีไฟล์อัปโหลดหรือไม่
  let logoPath = "uploads/imageplacehold.png";
  if (req.file) {
    logoPath = req.file.path; // เก็บ path ของไฟล์ที่อัปโหลด
  }

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );
  

  const {
    shopid,
    merid,
    shoptype,
    shopnameth,
    shopnameeng,
    shopopentime,
    shopclosetime,
    shopexpiredate,
    shopdata1,
    shopdata2,
    ugroupid
  } = req.body;

  const shopCreateLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      if (!shopid || !merid || !checkString(shopid) || !checkString(merid)) {
        // return res.status(400).json({ message: "Invalid request" });
        return reject({ status: 400, message: "Invalid request" });
      }

      if (!shopnameth) {
        // return res.status(402).json({ message: "shopnameth not found" });
        return reject({ status: 402, message: "shopnameth not found" });
      }

      if (!shopnameeng) {
        // return res.status(402).json({ message: "shopnameeng not found" });
        return reject({ status: 402, message: "shopnameeng not found" });
      }

      if (isNaN(Date.parse(`1970-01-01 ${shopopentime}`))) {
        // return res.status(402).json({ message: "shopopentime format Invalid" });
        return reject({ status: 402, message: "shopopentime format Invalid" });
      }

      if (isNaN(Date.parse(`1970-01-01 ${shopclosetime}`))) {
        // return res.status(402).json({ message: "shopclosetime format Invalid" });
        return reject({ status: 402, message: "shopclosetime format Invalid" });
      }

      if (isNaN(Date.parse(shopexpiredate))) {
        // return res.status(402).json({ message: "shopexpiredate format Invalid" });
        return reject({ status: 402, message: "shopexpiredate format Invalid" });
      }

      const db_shopid = await db
        .select("shopid")
        .from("shopinfo")
        .where({ shopid });

      if (db_shopid.find(({ shopid: id }) => id === shopid)) {

        return reject({
          status: 402,
          shopid: shopid,
          message: "shopid already exists",
        });
      }

      await db("shopinfo").insert({
        shopid,
        merid,
        shoptype,
        shopnameth,
        shopnameeng,
        shopopentime,
        shopclosetime,
        shopexpiredate: date.format(new Date(shopexpiredate), "YYYY-MM-DD"),
        shopdata1,
        shopdata2,
        apikey: '494eabae-b0f7-4d0d-a436-5af39c3abf62',
        shoplogoimage: logoPath,
        ugroupid
      }).then(async () => {

        let startTime = 946688400000; // 08:00:00 GMT, January 1, 2000
        let endTime = 946690200000; // 08:30:00 GMT, January 1, 2000
        const interval = 30 * 60 * 1000; // 30 minutes in milliseconds
        const endTimeLimit = 946731600000; // 20:00:00 GMT, January 1, 2000

        while (startTime < endTimeLimit) {
          await db("shopslot").insert({
            slotid: uuid(),
            shopid: shopid,
            slotremark: req.body.slot || "-",
            slottimestart: startTime,
            slottimeend: endTime,
            slotsremaining: req.body.slotsremaining || 999,
            slotcapacity: req.body.slotcapacity || 999,
          });

          startTime += interval;
          endTime += interval;
        }
      });

      resolve({ shopid, msg: "Create shop Success" });

    } catch (error) {

      reject(error);
      
    }
  });
 
  Promise.race([shopCreateLogic, timeoutPromise])
  .then(async(data) => {

    await eventlog(req,"เพิ่มรายการร้านค้า") // บันทึก log
    await notification(req,'ร้านค้า', `"${shopnameth}" ร้านค้าใหม่`); // notification

    return res.send(data); // ส่ง response และหยุดการทำงาน 
  })
  .catch((error) => {

    deleteUploadedFile(logoPath); // ลบไฟล์ที่อัปโหลดหากเกิดข้อผิดพลาด

    if (error.status) {

      if(error.shopid !== undefined){
        
        return res.status(error.status).json({ shopid: error.shopid, message: error.message });
      }else{
        return res.status(error.status).json({ message: error.message });
      }

    } else if (error.message === "Request timed out") {

      return res.status(402).json({ message: "Request timed out" });

    } else {

      return handleError(error, res);
    }
  });
}];

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

        const headers = req.headers.authorization;
        const token = headers.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const uinfoid = await decoded.uinfoid || "";
        const ugroupid = await decoded.ugroupid || "";

        const dbuser = await db("userinfo")
          .select("level", "shopid")
          .where({ uinfoid: uinfoid })
          .first();

          if(!dbuser){

            return reject({status: 402, message: "User not found"});

          }else if (

            dbuser.level !== "Admin" && dbuser.level !== "Owner"

          ) {
            return reject({
              status: 402,
              message: "You don't have permission to access",
            });
          }
  
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
            ugroupid: element.ugroupid,
            status: element.status,
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
  
//shop detail update ✓
exports.shopdetailupdate = [

  upload.single("logo"), // รับไฟล์จากฟิลด์ชื่อ "logo"

  async(req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeout)
  );
  
  const {
    shopid,
    shoptype,
    shopnameth,
    shopnameeng,
    shopopentime,
    shopclosetime,
    shopexpiredate,
    shoplogoimage,
    shopdata1,
    shopdata2,
    ugroupid
  } = req.body;

  // console.log(req.body);

  // ตรวจสอบว่ามีไฟล์อัปโหลดหรือไม่
  let logoPath = null; // Will store the NEW path if a file is uploaded
  let hasNewLogo = false;
  if (req.file) {
    logoPath = req.file.path; // เก็บ path ของไฟล์ที่อัปโหลดใหม่
    hasNewLogo = true;
  }

  const shopDetailUpdateLogic = new Promise(async (resolve, reject) => {

    try {
      // --- Basic Validation ---
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน


      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request: shopid is required" });
      }

      if (isNaN(Date.parse(`1970-01-01 ${shopopentime}`))) {
        // return res.status(402).json({ message: "shopopentime format Invalid" });
        return reject({ status: 402, message: "shopopentime format Invalid  ex: '08:00'" });
      }

      if (isNaN(Date.parse(`1970-01-01 ${shopclosetime}`))) {
        // return res.status(402).json({ message: "shopclosetime format Invalid" });
        return reject({ status: 402, message: "shopclosetime format Invalid ex: '17:00'" });
      }

      if (shopnameth === undefined ) console.log("shopnameth undefined");

      console.log(shopnameth);
      
      // --- Check if shop exists ---
      const db_shopid = await db
        .select("shopid")
        .from("shopinfo")
        .where({ shopid });

      if (!db_shopid.length) {
        // If a new logo was uploaded but the shop doesn't exist, delete the uploaded file
        if (hasNewLogo && logoPath) {
           deleteUploadedFile(logoPath);
        }
        return reject({ status: 402, shopid: shopid, message: "shopid not found" });
      }

      // --- Build the update object dynamically ---
      let updateData = {};

      if (shoptype !== undefined) {
        if (!shoptype) {
          return reject({ status: 402, message: "shoptype cannot be empty" });
        }
        updateData.shoptype = shoptype;
      }

      if (shopnameth !== undefined) {
        if (!shopnameth) { // Add validation if needed (e.g., cannot be empty string)
           return reject({ status: 402, message: "shopnameth cannot be empty" });
        }
        updateData.shopnameth = shopnameth;
      }

      if (shopnameeng !== undefined) {
         if (!shopnameeng) {
           return reject({ status: 402, message: "shopnameeng cannot be empty" });
        }
        updateData.shopnameeng = shopnameeng;
      }

      if (shopopentime !== undefined) {
        if (isNaN(Date.parse(`1970-01-01 ${shopopentime}`))) {
          return reject({ status: 402, message: "shopopentime format Invalid" });
        }
        updateData.shopopentime = shopopentime;
      }

      if (shopclosetime !== undefined) {
        if (isNaN(Date.parse(`1970-01-01 ${shopclosetime}`))) {
          return reject({ status: 402, message: "shopclosetime format Invalid" });
        }
        updateData.shopclosetime = shopclosetime;
      }

      if (shopexpiredate !== undefined) {
        const expireDateObj = new Date(shopexpiredate);
        if (isNaN(expireDateObj.getTime())) { // Check if the date is valid
          return reject({ status: 402, message: "shopexpiredate format Invalid" });
        }
        updateData.shopexpiredate = date.format(expireDateObj, "YYYY-MM-DD");
      }

      // Only update the logo image if a NEW file was uploaded
      if (hasNewLogo && logoPath) {
        updateData.shoplogoimage = logoPath;
      }

      if (shopdata1 !== undefined) {
        updateData.shopdata1 = shopdata1;
      }

      if (shopdata2 !== undefined) {
        updateData.shopdata2 = shopdata2;
      }

      if (ugroupid !== undefined) {
        // Add validation for ugroupid if necessary (e.g., check if it exists in usergroup table)
        updateData.ugroupid = ugroupid; // Allow setting to null or empty if intended
      }

      // --- Perform the update only if there's something to update ---
      if (Object.keys(updateData).length > 0) {
        await db("shopinfo")
          .where({ shopid })
          .update(updateData); // Use the dynamically built object
      } else {
        // Optional: Handle the case where no data was provided to update
        // You could resolve with a specific message or just proceed
        console.log(`No fields to update for shopid: ${shopid}`);
      }

      // --- Resolve successfully ---
      resolve({
        shopid,
        message: "Update store detail Success",
      });

    } catch (error) {
      // If an error occurs after a new logo was uploaded, delete the new file
      if (hasNewLogo && logoPath) {
         deleteUploadedFile(logoPath);
      }
      return reject(error); // Reject the promise with the error
    }
  });

  Promise.race([shopDetailUpdateLogic, timeoutPromise])
      .then(async(data) => {

        // if (req.file) {

        //   await deleteUploadedFile(shoplogoimage); // ลบไฟล์ที่อัปโหลดหากมีการเปลี่ยนแปลง
        // }

        await eventlog(req,"แก้ไขรายการร้านค้า") // บันทึก log
        await notification(req,'ร้านค้า', `มีการเปลี่ยนแปลงข้อมูล "${shopnameth}" `); // notification

        res.json(data); // Send the response only once
      })
      .catch((error) => {

        if(req.file){
          deleteUploadedFile(logoPath); // ลบไฟล์ที่อัปโหลดหากเกิดข้อผิดพลาด
        }
      if (error.status) {
          if(error.shopid !== undefined){
            return res.status(error.status).json({shopid: error.shopid , message: error.message });
          }else{
            return res.status(error.status).json({ message: error.message });
          }
      } else if (error.message === "Request timed out") {
        return res.status(402).json({ message: "Request timed out" });
      } else {
          handleError(error, res);
      }
  });

}];

//shop shopdelete ✓
exports.shopdelete = async(req, res) => {
  
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const shopDeleteLogic = new Promise(async (resolve, reject) => {
    try {

      const { shopid } = req.body;

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const db_shopid = await db
        .select("*")
        .from("shopinfo")
        .where({ shopid });

      if (!db_shopid.length) {
        return reject({ status: 402, shopid: shopid, message: "shopid not found" });
      }

      await db("shopinfo")
        .where({ shopid })
        .update({status: false});

      resolve({
        shopid,
        shopnameth: db_shopid[0].shopnameth,
        message: "Delete shop Success",
      });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([shopDeleteLogic, timeoutPromise])
    .then(async (data) => {

      await eventlog(req,"ลบรายการร้านค้า") // บันทึก log
      await notification(req,'ร้านค้า', `มีการลบข้อมูลร้านค้า "${data.shopnameth}" `); // notification

      res.json(data); // Send the response only once
    })
    .catch((error) => {
      if (error.status) {
        if(error.shopid !== undefined){

          res.status(error.status).json({shopid: error.shopid , message: error.message });

        }else{

          res.status(error.status).json({ message: error.message });

        }
      } else if (error.message === "Request timed out") {
        res.status(402).json({ message: "Request timed out" });
      } else {
        handleError(error, res);
      }
    });
};

//shop slot list ✓
exports.slotlist = async(req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const slotListLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const shopid = req.body.shopid || "";
      const headers = req.headers.authorization;
      const token = headers.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const uinfoid = await decoded.uinfoid || "";
      // const ugroupid = await decoded.ugroupid || "";

      const dbuser = await db("userinfo")
      .select("level", "shopid")
      .where({ uinfoid: uinfoid })
      .first();

      if(!dbuser){

        return reject({status: 402, message: "User not found"});

      }else if(dbuser.level !== "Owner" && dbuser.level !== "Manager" && dbuser.level !== "Admin"){

        return reject({status: 402, message: "You don't have permission to access"});

      }

      const slotlist = await db("shopslot")
        .select("*")
        .where({ shopid: shopid })
        .orderBy("slottimestart", "asc");

      const result_slotlist = slotlist.map((slot) => ({
        slotid: slot.slotid,
        shopid: slot.shopid,
        slotname: slot.slotname,
        slotremark: slot.slotremark,
        slotcapacity: slot.slotcapacity,
        slottimestart: date.format(new Date(slot.slottimestart), "HH:mm"),
        slottimeend: date.format(new Date(slot.slottimeend), "HH:mm"),
        status: slot.status,
      }));

      // Explicitly sort result_slotlist by the formatted slottimestart string in ascending order
      // result_slotlist.sort((a, b) => a.slottimestart.localeCompare(b.slottimestart));

      resolve({
        total: result_slotlist.length,
        result: result_slotlist,
      });

    } catch (error) {
      reject(error);
    }
  });

  Promise.race([slotListLogic, timeoutPromise])
    .then((data) => {
      res.json(data); // Send the response only once
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

//shop slot update ✓
exports.slotupdate = async(req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const slotUpdateLogic = new Promise(async (resolve, reject) => {
    try {

      const { slotdata } = req.body;

      // console.log(slotdata);

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      // const shopid = req.body.shopid || "";
      const headers = req.headers.authorization;
      const token = headers.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const uinfoid = await decoded.uinfoid || "";
      // const ugroupid = await decoded.ugroupid || "";

      const dbuser = await db("userinfo")
      .select("level", "shopid")
      .where({ uinfoid: uinfoid })
      .first();

      if(!dbuser){

        return reject({status: 402, message: "User not found"});

      }else if(dbuser.level !== "Owner" && dbuser.level !== "Manager"){

        return reject({status: 402, message: "You don't have permission to access"});

      }

      if (!slotdata) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const updateslot = slotdata.map(async(slot) => {
        
        await db("shopslot")
          .where({ slotid: slot.slotid })
          .update({
            slotcapacity: Number(slot.slotcapacity),
            status: slot.status,
            update_at: Math.floor(Date.now() / 1000),
          });
      })

      await Promise.all(updateslot);

      resolve({message: "Update slot Success"});

    } catch (error) {
      reject(error);
    }
  });

  Promise.race([slotUpdateLogic, timeoutPromise])
    .then(async (data) => {

      const db_shopinfo = await db("shopinfo")
        .select("shopid", "shopnameth")
        .where({ shopid: req.body.shopid })
        .first();
      
      await eventlog(req, "มีการเปลี่ยนแปลงข้อมูล slot"); // บันทึก log
      await notification(req,'ร้านค้า', `มีการเปลี่ยนแปลงข้อมูล slot ร้านค้า "${db_shopinfo && db_shopinfo.shopnameth ? db_shopinfo.shopnameth : ""}" `); // notification

      res.send(data); // Send the response only once
    })
    .catch((error) => {
      if (error.status) {
        if(error.slotid !== undefined){

          res.status(error.status).json({slotid: error.slotid , message: error.message });

        }else{

          res.status(error.status).json({ message: error.message });

        }
      } else if (error.message === "Request timed out") {
        res.status(402).json({ message: "Request timed out" });
      } else {
        handleError(error, res);
      }
    })
};

//shoprestore ✓
exports.shoprestore = async(req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const shopRestoreLogic = new Promise(async (resolve, reject) => {
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
        return reject({ status: 402, message: "shopid not found" });
      }

      await db("shopinfo")
        .where({ shopid })
        .update({
          status: true,
          update_at: Math.floor(Date.now() / 1000),
        });

      resolve({message: "Restore shop Success"});

    } catch (error) {
      reject(error);
    }
  });

  Promise.race([shopRestoreLogic, timeoutPromise])
    .then(async (data) => {

      await eventlog(req,"เปิดใช้งานร้านค้ากลับคืนมา") // บันทึก log

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
      