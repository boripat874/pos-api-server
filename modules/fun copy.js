//lib ที่ต้องใช้
const {db} = require("../db/postgresql");

const {uuid} = require("uuidv4");
// const fs = require("fs");
const multer = require("multer");
const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT
const { default: tr } = require("date-and-time/locale/tr");
// const path = require("path");

// ตั้งค่าการจัดเก็บไฟล์
const storage = ()=>{
  multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "uploads/"); // โฟลเดอร์สำหรับเก็บไฟล์
    },
  
    // ตั้งชื่อไฟล์
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9); // สร้างชื่อไฟล์ที่ไม่ซ้ำกัน
      cb(
        null,
        file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
      ); // ตั้งชื่อไฟล์ใหม่
    },
  });
}

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
exports.upload = multer({ storage, fileFilter });

const regex = /^[0-9a-zA-Z_-]+$/;

// ฟังก์ชันสําหรับตรวจสอบข้อความ
exports.checkString = function checkString(str) {
    return regex.test(str);
}

// ฟังก์ชันสําหรับจัดการข้อผิดพลาด
exports.handleError = function handleError(error, res) {
  console.error(error); // แสดงข้อผิดพลาดใน console
  res.status(500).json({ message: "Internal Server Error", error: error.message });
}

// ฟังก์ชันสําหรับตรวจสอบ API key
exports.validateApiKey = async function validateApiKey(req) {
  const X_API_KEY = req.headers["x-api-key"]||"";

  const autihorized = await db.select("apikey").where({ "apikey": X_API_KEY }).from("shopinfo");

  if (!autihorized.length) {

    // return res.status(401).json({ message: "Unauthorized" });
    return Promise.reject({ status: 401, message: "Unauthorized" });
    
  }
}

// ฟังก์ชันสําหรับลบไฟล์ที่อัปโหลด
exports.deleteUploadedFile = async function deleteUploadedFile(filePath) {
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

// eventlog add
exports.eventlog = async function eventlog(req,details,type_input = 'Backoffice') {

    try {
  
      const headers = req.headers.authorization;
      let token;
      let decoded;
      let uinfoid = null;
      let type = type_input;

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

            // ไม่ reject แต่ปล่อยให้ uinfoid เป็น null หรือค่าเริ่มต้น
          }
        }


  
        if (uinfoid) {
          
          await db("eventloginfo").insert({
            id: uuid(),
            uinfoid,
            ipaddress: req.ip,
            details,
            type
          }).then(()=>{
            // console.log(uinfoid)
            // console.log("Log Success")
            return "Log Success";
          }
            
          );

        }else{

          console.warn("User not found (ignored)");
          return "User not found";
        }

      }

  
    } catch (error) {
      return error;
    }
}


// notification ต้องส่ง shopid มาด้วย
exports.notification = async function notification(req,title,details,type_input = 'Backoffice') {
  try{

    const headers = req.headers.authorization;
    let token;
    let decoded;
    let uinfoid = null;
    let ugroupid = null;
    let shopid = req.body.shopid || '0';
    let type = type_input;

    if (headers && headers.startsWith("Bearer ")) 
    {

      token = headers.split(" ")[1];
      
      if (token) {

        try {
          // พยายาม verify แต่ถ้า error ก็ไม่ reject ทันที
          decoded = jwt.verify(token, process.env.JWT_SECRET);
          uinfoid = decoded?.uinfoid; // ใช้ optional chaining
          ugroupid = decoded?.ugroupid; // ใช้ optional chaining

        } catch (jwtError) {
          // *** จุดที่ "ข้าม" error ***
          console.warn("JWT verification failed (ignored):", jwtError.message);
          // ไม่ reject แต่ปล่อยให้ uinfoid เป็น null หรือค่าเริ่มต้น
        }
      }

      let results = [];

      if(shopid == '0' && req.body.ugroupid){

        const ugroupidOwener = req.body.ugroupid;

        results = await db("userinfo")
        .select("uinfoid")
        .where({ ugroupid: ugroupidOwener })
        .andWhere("level", "=", "Owner")

      }else{
        
        results = await db("userinfo")
          .select("uinfoid")
          .where({ ugroupid })
          .andWhere(function () {
            this.where("level", "=", "Owner")
            .orWhere({ shopid });
          });
      }

      // console.log("userinfo shopid ====>>", shopid);
      // console.log("userinfo length ====>>", results.length);
      // console.log("userinfo results ====>>", results);

      if (results.length > 0) {
        // console.log("create notification");

        const insertnotification = async () => {
          const notificationid = uuid();

          // console.log("notificationid ====>>", notificationid);
          // console.log("title ====>>", title);
          // console.log("details ====>>", details);

          await db("notificationinfo")
          .insert({
            id: notificationid,
            title,
            details,
            shopid,
            type
          })

          const userNotificationsToInsert = results.map(result => ({
            id: uuid(), // PK for notificationuser table
            notificationid, // FK to notificationinfo table
            uinfoid: result.uinfoid, // uinfoid of the user to be notified
            ugroupid, // ugroupid of the sender (context of the notification group)
          }));

          // console.log("userNotificationsToInsert length ====>>", userNotificationsToInsert.length);
          // console.log("userNotificationsToInsert ====>>", userNotificationsToInsert);


          if (userNotificationsToInsert.length > 0) {
            await db("notificationuser").insert(userNotificationsToInsert);
            console.log(`Notification '${title}' sent to ${userNotificationsToInsert.length} users in group ${ugroupid}.`);
            return `Notification sent to ${userNotificationsToInsert.length} users.`;
          }
        };

        await insertnotification();

      } else {
        console.warn("User not found (ignored)");
        // Throw an error object to be caught by the outer try...catch
        throw { status: 402, message: "User not found" };
      }

      // The commented-out block below seems like an alternative or older logic path.
      // if (uinfoid) {
      //   const notificationid = uuid();
      //   await db("notificationinfo").insert({ id: notificationid, title, details });
      //   await db("notificationuser").insert({ id: uuid(), notificationid, uinfoid, ugroupid });
      // } else {
      //   console.warn("User not found (ignored)");
      //   return "User not found";
      // }
    }

  }catch(error){
    return error;
  }
}

// eventlog add
exports.eventlogOpenAPI = async function eventlog(req,details,type_input = 'ZooApp') {

  try {

    let type = type_input;
      
    await db("eventloginfo").insert({
        id: uuid(),
        "uinfoid": "zooapp",
        ipaddress: req.ip,
        details,
        type
      }).then(()=>{
        // console.log("Log Success")
        return "Log Success";
      }
        
    );

  } catch (error) {
    return error;
  }
}

// notification
exports.notificationOpenAPI = async function notification(req,title,details,type_input = 'ZooApp') {
  try{

    let shopid = req.body.shopid || '0';

    if(!req.body.shopid){
      
      const searchShopid = await db("productinfo").select(productid = req.body.productid).first();

      if(searchShopid){
        shopid = searchShopid.shopid;
      }
    }

    let type = type_input;

    const results = await db("userinfo")
      .select("uinfoid")
      .where(function () {
        this.where({ shopid }) // Condition 1: shopid must match the input
          .orWhere(function () {
              this.where({ shopid: '0' })  // Condition 2: if shopid in DB is '0'
                  .andWhere("level", "=", "Owner"); // level must equal 'Owner'
          })
    });

    if (results.length > 0) {
      // console.log("create notification");

      const insertnotification = async () => {
        const notificationid = uuid();

        await db("notificationinfo")
        .insert({
          id: notificationid,
          title,
          details,
          shopid,
          type
        }).then(async()=>{
          // console.log("Notification Success")
        })

        const userNotificationsToInsert = results.map(result => ({
          id: uuid(), // PK for notificationuser table
          notificationid, // FK to notificationinfo table
          uinfoid: result.uinfoid, // uinfoid of the user to be notified
          ugroupid, // ugroupid of the sender (context of the notification group)
        }));

        if (userNotificationsToInsert.length > 0) {
          await db("notificationuser").insert(userNotificationsToInsert);
          console.log(`Notification '${title}' sent to ${userNotificationsToInsert.length} users in group ${ugroupid}.`);
          return `Notification sent to ${userNotificationsToInsert.length} users.`;
        }
      };

      await insertnotification();

    } else {
      console.warn("User not found (ignored)");
      // Throw an error object to be caught by the outer try...catch
      throw { status: 402, message: "User not found" };
    }

  }catch(error){
    return error;
  }
}

// checkAuthorizetion
exports.checkAuthorizetion = async (req) => {

  try {

    if(!req.headers.authorization){

      return Promise.reject({ status: 401, message: "Token is missing." });
    }

    
    const headers = req.headers.authorization;
    let token;
    let decoded;
    let uinfoid = "";
    
    if (headers) {
      const parts = headers.split(" ");
      if (parts.length === 2 && parts[0] === "Bearer") {
        token = parts[1];
      }
    }
    
    if (token) {
      try {
        
        decoded = jwt.verify(token, process.env.JWT_SECRET);
        uinfoid = decoded.uinfoid; // ใช้ optional chaining
        
      } catch (jwtError) {
        
        return Promise.reject({ status: 401, message: `JWT verification failed (ignored):${jwtError.message}` });
        
      }
    }

    if (!uinfoid) {

      return Promise.reject({ status: 401, message: `Unauthorized: Invalid token structure (missing uinfoid).` });

    }

    let jti = decoded.jti;
    if (!jti) {

      return Promise.reject({ status: 401, message: `Token is missing required 'jti' claim for revocation.` });

    }

    await db("revoked_tokens")
      .select("jti")
      .where({ jti })
      .first()
      .then((tokenExists) => {
        if (tokenExists) {  

          return Promise.reject({ status: 401, message: `Token has already been revoked.` });
        }
      }
    );

    await db("userinfo")
      .select("uinfoid")
      .where({ uinfoid })
      .then((result) => {
        if (result.length === 0) {

          return Promise.reject({ status: 401, message: `uinfoid not found.` });
        }
      }
    );

    return ;

  } catch (error) {

    return Promise.reject({ status: 401, message: error });

  }
 
}
