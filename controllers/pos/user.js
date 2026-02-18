const {db} = require("../../db/postgresql");
const fs = require("fs");
const date = require("date-and-time");
const { uuid } = require("uuidv4");
const multer = require("multer");
const path = require("path");
// const { console } = require("inspector");
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
  const X_API_KEY = req.headers["x-api-key"] || "";

  const autihorized = await db.select("apikey").where({ "apikey": X_API_KEY }).from("shopinfo");

  // console.log(autihorized);
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

//signin ✓
exports.signin = async(req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  let userid_ = null;
  
  const signinLogic = new Promise(async (resolve, reject) => {
    try {

      // ตรวจสอบ API key
      await validateApiKey(req); 

      if(!req.body.uinfologinname){
        reject({ status: 402, message: "Username not required" });
      }

      if(!req.body.uinfologinpass){
          reject({ status: 402, message: "Password not required" });
      }

      const user = await db("userinfo")
      .select("*")
      .where({ "uinfologinname": req.body.uinfologinname })
      .andWhere({ "uinfologinpass": req.body.uinfologinpass })
      .andWhere({ "status": true })
      .first();

      if (!user) {
        reject({ status: 402, message: "User not found" });
      }
      const tokenId = uuid(); 
      userid_ = user.uinfoid;
      ugroupid_ = user.ugroupid || 'admin';

      const token = jwt.sign(
        {
          jti: tokenId,
          uinfoid: userid_,
          ugroupid: ugroupid_,
        },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
      );

      resolve({
        token: token,
        message:"Sign in successfully"
      });

    } catch (error) {
      reject(error, res);
    }
  });

  Promise.race([signinLogic, timeoutPromise])
    .then(async(result) => {

      // เก็บ eventlog
      await db("eventloginfo")
      .insert({
        id: uuid(),
        uinfoid: userid_,
        ipaddress: req.ip,
        details: "เข้าสู่ระบบ",
        type: "POS",
      })

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

exports.signout = async(req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const signoutLogic = new Promise(async (resolve, reject) => {
    try {

      // console.log("X-API-KEY >>",req.headers["x-api-key"]);

      // ตรวจสอบ API key
      await validateApiKey(req); 

      // ตรวจสอบการอนุญาตเข้าสู่ระบบ
      await checkAuthorizetion(req);

      const headers_ = req.headers.authorization;
      const token = headers_.split(" ")[1];

      let decoded = null;
      try {
          // *** ขั้นตอนที่ 1: ตรวจสอบ Token พื้นฐาน ***
          decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (jwtError) {
          // ถ้า jwt.verify ไม่ผ่าน (หมดอายุ, ลายเซ็นผิด) -> Reject ทันที
          console.warn(`JWT verification failed: ${jwtError.message}`);
          // ไม่ต้องเช็ค denylist เพราะ token ไม่ valid อยู่แล้ว
          return reject({ status: 401, message: `Unauthorized: ${jwtError.message}` });
      }

      const uinfoid = decoded.uinfoid;
      if (!uinfoid) {
          console.error("Token verification succeeded but 'uinfoid' claim is missing.");
          return reject({ status: 401, message: "Unauthorized: Invalid token structure (missing uinfoid)." });
      }

      let jti = decoded.jti;

      // console.log("jti >>", jti);
      if (!jti) {
          // Token นี้ไม่ได้สร้างด้วยระบบใหม่ที่ใส่ jti? หรือมีปัญหา?
          console.warn("Logout attempt with token missing 'jti' claim.");
          // อาจจะ reject หรือ แค่ log ไว้ ขึ้นอยู่กับนโยบาย
          return reject({ status: 400, message: "Token is missing required 'jti' claim for revocation." });
      }

      await db("revoked_tokens")
      .select("jti")
      .where({ jti })
      .first()
      .then((tokenExists) => {
          if (tokenExists) {
              console.warn(`Token ${jti} already exists in denylist.`);
              return reject({ status: 402, message: "Token has already been revoked." });
          }
      });
 
      // เพิ่ม token jti เข้าไปใน denylist
      await db('revoked_tokens')
      .insert({ jti: jti})
      .onConflict('jti') // ถ้ามี jti นี้อยู่แล้ว (อาจจะ logout ซ้ำ)
      .ignore();         // ไม่ต้องทำอะไร (หรือ .doNothing() ขึ้นอยู่กับเวอร์ชัน Knex/DB)

      await db("userinfo")
          .select("uinfoid")
          .where({ uinfoid: uinfoid, status: true }) // เช็ค status ด้วย
          .first()

      .then((userExists) => { 
          if(!userExists) {
          // User ที่เคยออก token ให้ อาจถูกลบ หรือ inactive ไปแล้ว
          console.warn(`User ${uinfoid} associated with token not found or inactive.`);
          return reject({ status: 401, message: "Unauthorized: User associated with token not found or inactive" });
      }});

      resolve({
        message: "Sign out successfully"
      });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([signoutLogic, timeoutPromise])
    .then(async (result) => {

      await eventlog(req,"ออกจากระบบ","POS") // บันทึก log

      res.status(200).json(result);

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
};

//user info ✓
exports.userinfo = async(req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const userinfoLogic = new Promise(async (resolve, reject) => {
    try {
      await validateApiKey(req); // ตรวจสอบ API key

      // ตรวจสอบการอนุญาตเข้าสู่ระบบ
      await checkAuthorizetion(req);

      const headers = req.headers.authorization;
      const token = headers.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const uinfoid = decoded.uinfoid;

      const user = await db("userinfo")
      .select("*")
      .where({ "uinfoid": uinfoid })
      .andWhere({ "status": true })
      .first();

      if (!user) {
        reject({ status: 402, message: "User not found" });
      }

      resolve({
        uinfoname: user.uinfoname,
        uinfologinname: user.uinfologinname,
        level: user.level
      });

    } catch (error) {
      reject(error, res);
    }
  });

  Promise.race([userinfoLogic, timeoutPromise])
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

//group user list ✓
exports.groupuserlist = async(req,res) =>{

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    
    const groupuserListLogic = new Promise(async (resolve, reject) => {
        try {
            
          const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา
          // console.log(shopid);

          // Validate API key
          await validateApiKey(req);

          // ตรวจสอบการอนุญาตเข้าสู่ระบบ
          await checkAuthorizetion(req);
    
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
              ugroupprivilege: user.ugroupprivilege,
              ugroupremark: user.ugroupremark,
              uinfoid: user.uinfoid,
              ugroupid: user.ugroupid,
          }));
    
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

//shop list ✓
exports.shoplist = async(req,res) =>{

  const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  
  const groupuserListLogic = new Promise(async (resolve, reject) => {
      try {
          
        // const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา
        // console.log(shopid);

        // Validate API key
        await validateApiKey(req);

        // ตรวจสอบการอนุญาตเข้าสู่ระบบ
        await checkAuthorizetion(req);
  
        // Join userinfo กับ shopinfo
        const shoplist = await db("shopinfo")
        .select("shopid","shopnameth","ugroupid")
        .where({ "status": true }) // เงื่อนไข status = true
        // .andWhere(function () {
        //     this.where("ugroupname", "ILIKE", `%${search}%`);
            // .orWhere("usernameeng", "ILIKE", `%${search}%`)
        // })
        .orderBy("create_at", "desc");
        
        // console.log(userlist)
        const shoplist_data = shoplist.map((user) => (
          {
            shopid: user.shopid,
            shopnameth: user.shopnameth,
            ugroupid: user.ugroupid,
          }
        ));
  
        resolve({
          total: shoplist_data.length,
          result: shoplist_data,
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

//group user create ✓
exports.groupusercreate = async (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeout)
    );
  
    const { ugroupname, ugroupprivilege, ugroupremark } = req.body;

    const groupUserCreateLogic = new Promise(async (resolve, reject) => {
      try {
  
        // ตรวจสอบ API Key
        await validateApiKey(req);

        // ตรวจสอบการอนุญาตเข้าสู่ระบบ
        await checkAuthorizetion(req);
  
        // ตรวจสอบข้อมูลที่จำเป็น
        if (!ugroupname) {
          return reject({ status: 400, message: "Invalid request: ugroupname is required" });
        }
  
        // ตรวจสอบว่า `ugroupname` ซ้ำหรือไม่
        const existingGroup = await db("usergroup")
          .select("ugroupname")
          .where({ ugroupname });
  
        if (existingGroup.length > 0) {
          return reject({
            status: 402,
            message: "ugroupname already exists",
          });
        }
  
        // บันทึกข้อมูลกลุ่มผู้ใช้ใหม่ลงในฐานข้อมูล
        const ugroupid = uuid(); // สร้าง UUID สำหรับ `ugroupid`
        await db("usergroup").insert({
          ugroupid,
          ugroupname,
          ugroupprivilege: ugroupprivilege || "-", // ค่าเริ่มต้นคือ "-"
          ugroupremark: ugroupremark || "-", // ค่าเริ่มต้นคือ "-"
        });
  
        resolve({
          message: "created successfully",
          ugroupid,
        });
      } catch (error) {
        reject(error);
      }
    });
  
    Promise.race([groupUserCreateLogic, timeoutPromise])
      .then(async(data) => {

        await eventlog(req, "เพิ่มรายการกลุ่ม User"); // บันทึก log
        await notification(req,"User", `"${ugroupname}" กลุ่ม User ใหม่`); // notification

        res.status(200).json(data); // ส่ง response พร้อมสถานะ 201 (Created)
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

//group user edit ✓
exports.groupuseredit = async (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeout)
    );
  
    const { ugroupid, ugroupname, ugroupprivilege, ugroupremark } = req.body;
    const groupUserEditLogic = new Promise(async (resolve, reject) => {

      try {
  
        // ตรวจสอบ API Key
        await validateApiKey(req);

        // ตรวจสอบการอนุญาตเข้าสู่ระบบ
        await checkAuthorizetion(req);
  
        // ตรวจสอบข้อมูลที่จำเป็น
        if (!ugroupid || !ugroupname) {
          return reject({ status: 400, message: "Invalid request" });
        }
  
        // ตรวจสอบว่า `ugroupid` มีอยู่ในฐานข้อมูลหรือไม่
        const existingGroup = await db("usergroup")
          .select("ugroupid")
          .where({ ugroupid });
  
        if (existingGroup.length === 0) {
          return reject({
            status: 402,
            message: "ugroupid not found",
          });
        }
  
        // อัปเดตข้อมูลกลุ่มผู้ใช้ในฐานข้อมูล
        await db("usergroup")
          .where({ ugroupid })
          .update({
            ugroupname,
            ugroupprivilege: ugroupprivilege || "-",
            ugroupremark: ugroupremark || "-",
          });
  
        resolve({
          message: "updated successfully",
          ugroupid,
        });
      } catch (error) {
        reject(error);
      }
    });
  
    Promise.race([groupUserEditLogic, timeoutPromise])
      .then(async(data) => {

        await eventlog(req,"แก้ไขรายการกลุ่ม User") // บันทึก log
        await notification(req,"User", `มีการแปลี่ยนแปลงข้อมูลรายการกลุ่ม User "${ugroupname}"`); // notification

        res.status(200).json(data); // ส่ง response พร้อมสถานะ 200 (OK)
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

//group user delete ✓
exports.groupuserdelete = async (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeout)
    );
  
    const groupUserDeleteLogic = new Promise(async (resolve, reject) => {
      try {
        const { ugroupid } = req.body;
  
        // ตรวจสอบ API Key
        await validateApiKey(req);

        // ตรวจสอบการอนุญาตเข้าสู่ระบบ
        await checkAuthorizetion(req);
  
        // ตรวจสอบข้อมูลที่จำเป็น
        if (!ugroupid) {
          return reject({ status: 400, message: "Invalid request" });
        }
  
        // ตรวจสอบว่า `ugroupid` มีอยู่ในฐานข้อมูลหรือไม่
        const existingGroup = await db("usergroup")
          .select("*")
          .where({ ugroupid });
  
        if (existingGroup.length === 0) {
          return reject({
            status: 402,
            message: "ugroupid not found",
          });
        }
  
        // อัปเดต `status` ให้เป็น `false`
        await db("usergroup")
          .where({ ugroupid })
          .update({ status: false });
  
        resolve({
          ugroupid,
          ugroupname: existingGroup[0].ugroupname,
          message: "deleted successfully",
        });
      } catch (error) {
        reject(error);
      }
    });
  
    Promise.race([groupUserDeleteLogic, timeoutPromise])
      .then(async(data) => {

        await eventlog(req,"ลบรายการกลุ่ม User") // บันทึก log
        await notification(req,"User", `มีการลบข้อมูลรายการกลุ่ม User "${data.ugroupname}"`); // notification

        res.status(200).json(data); // ส่ง response พร้อมสถานะ 200 (OK)
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

//user list ✓
exports.userlistAll = async(req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeout)
    );
    
    const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา

    const userListLogic = new Promise(async (resolve, reject) => {
      try {

        // console.log(shopid);
        // Validate API key
        await validateApiKey(req);

        // ตรวจสอบการอนุญาตเข้าสู่ระบบ
        await checkAuthorizetion(req);
  
        // Join userinfo กับ shopinfo
        const userlist = await db("userinfo")
          .select(
            "shopinfo.shopnameth as shopnameth", // เลือก shopnameth จาก shopinfo
            "shopinfo.shopnameeng as shopnameeng", // เลือก shopnameeng จาก shopinfo
            "usergroup.ugroupname as ugroupname", // เลือก ugroupname จาก usergroup
            "usergroup.ugroupprivilege as ugroupprivilege", // เลือก ugroupprivilege จาก usergroup
            "usergroup.ugroupremark as ugroupremark", // เลือก ugroupremark จาก usergroup
            "userinfo.uinfoid as uinfoid", // เลือก uinfoid จาก userinfo
            "userinfo.ugroupid as ugroupid", // เลือก ugroupid จาก userinfo
            "shopinfo.shopid as shopid", // เลือก uinfoid จาก userinfo
            "userinfo.uinfologinname as uinfologinname", // เลือก uinfologinname จาก userinfo
            "userinfo.uinfologinpass as uinfologinpass", // เลือก uinfologinpass จาก userinfo
            "userinfo.uinfoname as uinfoname", // เลือก uinfoname จาก userinfo
            "userinfo.level as level", // เลือก level จาก userinfo
          )
          .leftJoin("shopinfo", "userinfo.shopid", "shopinfo.shopid") // Join โดยใช้ uinfoid กับ shopid
          .leftJoin("usergroup", "userinfo.ugroupid", "usergroup.ugroupid") // Join userinfo กับ usergroup โดยใช้ ugroupid
          .where({ "userinfo.status": true }) // เงื่อนไข status = true
          .andWhere(function () {
            this.where("userinfo.uinfoname", "ILIKE", `%${search}%`);
            // .orWhere("usernameeng", "ILIKE", `%${search}%`)
          })
          .orderBy("userinfo.create_at", "desc");
        
        // console.log(userlist)
        const userlist_data = userlist.map((user) => (
            {
            shopnameth: user.shopnameth,
            shopnameeng: user.shopnameeng,
            ugroupname: user.ugroupname,
            ugroupprivilege: user.ugroupprivilege,
            ugroupremark: user.ugroupremark,
            uinfoid: user.uinfoid,
            ugroupid: user.ugroupid,
            shopid: user.shopid,
            uinfologinname: user.uinfologinname,
            uinfologinpass: user.uinfologinpass,
            uinfoname: user.uinfoname,
            level: user.level
        }));
  
        resolve({
          total: userlist_data.length,
          result: userlist_data,
        });
      } catch (error) {
        reject(error);
      }
    });
  
    Promise.race([userListLogic, timeoutPromise])
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

//user create ✓
exports.usercreate = async (req, res) => {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const {
      shopid,
      ugroupid,
      uinfologinname,
      uinfologinpass,
      uinfoname,
      level,

    } = req.body;
    

    const userCreateLogic = new Promise(async (resolve, reject) => {
      try {

        // ตรวจสอบ API Key
        await validateApiKey(req);

        // ตรวจสอบการอนุญาตเข้าสู่ระบบ
        await checkAuthorizetion(req);

        const uinfoid = uuid();

        // ตรวจสอบข้อมูลที่จำเป็น
        if (
          !uinfologinname ||
          !uinfologinpass
        ) {
          return reject({ status: 400, message: "Invalid request" });
        }

        // ตรวจสอบว่า `uinfologinname` ซ้ำหรือไม่
        const existingUser = await db("userinfo")
          .select("uinfologinname")
          .where({ uinfologinname });

        if (existingUser.length > 0) {
          return reject({
            status: 402,
            message: "uinfologinname already exists",
          });
        }

        if(shopid){

          // ตรวจสอบว่า `shopid` มีอยู่ในฐานข้อมูลหรือไม่
            const shopExists = await db("shopinfo")
            .select("shopid")
            .where({ shopid });

          if (shopExists.length === 0) {
            return reject({
              status: 402,
              message: "shopid not found",
            });
          }

        }

        // ตรวจสอบว่า `ugroupid` มีอยู่ในฐานข้อมูลหรือไม่
        const groupExists = await db("usergroup")
        .select("ugroupid")
        .where({ ugroupid });

          if (groupExists.length === 0) {
          return reject({
              status: 402,
              message: "ugroupid not found",
          });
        }

        // else if(ugroupname || ugroupprivilege || ugroupremark){

        //   const groupNameExists = await db('usergroup')
        //   .select("ugroupname")
        //   .where({ugroupname})

        //   if (groupNameExists.length === 0) {
        //       return reject({
        //         status: 402,
        //         message: "ugroupname already exists",
        //       });
        //   }
        // }

        //   if(!ugroupid){

          // บันทึกข้อมูลผู้ใช้ใหม่ลงในฐานข้อมูล
          // await db("userinfo").insert({
          //     uinfoid: uuid(),
          //     shopid,
          //     ugroupid: uuid(),
          //     uinfologinname,
          //     uinfologinpass,
          //     uinfoname,
          // });

          // await db('usergroup').insert({
          //     ugroupid: uuid(),
          //     ugroupname,
          //     ugroupprivilege,
          //     ugroupremark
          // })
        //   }else{

        // บันทึกข้อมูลผู้ใช้ใหม่ลงในฐานข้อมูล
        await db("userinfo").insert({
            uinfoid : uinfoid,
            shopid,
            ugroupid,
            uinfologinname,
            uinfologinpass,
            uinfoname,
            level
        });
        //   }

        resolve({
          message: "created successfully",
          uinfoid,
        });
      } catch (error) {
        reject(error);
      }
    });
  
    Promise.race([userCreateLogic, timeoutPromise])
      .then(async(data) => {

        await eventlog(req,"เพิ่มรายการ User") // บันทึก log
        await notification(req,"User", `"${uinfoname}" User ใหม่`); // notification

        res.status(200).json(data); // ส่ง response พร้อมสถานะ 200 (Created)
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

// user edit ✓
exports.useredit = async (req, res) => {
  
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeout)
    );
  
    const {
      uinfoid,
      shopid,
      ugroupid,
      uinfologinname,
      uinfologinpass,
      uinfoname,
      level
    } = req.body;
    
    const userEditLogic = new Promise(async (resolve, reject) => {
      try {
  
        // ตรวจสอบ API Key
        await validateApiKey(req);

        // ตรวจสอบการอนุญาตเข้าสู่ระบบ
        await checkAuthorizetion(req);
  
        // ตรวจสอบข้อมูลที่จำเป็น
        if (!uinfoid || !uinfologinname || !uinfologinpass) {
          return reject({ status: 400, message: "Invalid request" });
        } 
  
        // ตรวจสอบว่า `uinfoid` มีอยู่ในฐานข้อมูลหรือไม่
        const existingUser = await db("userinfo")
          .select("uinfoid")
          .where({ uinfoid });
  
        if (existingUser.length === 0) {
          return reject({
            status: 402,
            message: "uinfoid not found",
          });
        }
  
        // ตรวจสอบว่า `shopid` มีอยู่ในฐานข้อมูลหรือไม่
        if (shopid) {

          const shopExists = await db("shopinfo")
          .select("shopid")
          .where({ shopid });
  
          if (shopExists.length === 0) {
            return reject({
              status: 402,
              message: "shopid not found",
            });
          }
        }
  
        // ตรวจสอบว่า `ugroupid` มีอยู่ในฐานข้อมูลหรือไม่ (ถ้ามีการส่งมา)
        // if (ugroupid) {
        //   const groupExists = await db("usergroup")
        //     .select("ugroupid")
        //     .where({ ugroupid });
  
        //   if (groupExists.length === 0) {
        //     return reject({
        //       status: 402,
        //       message: "ugroupid not found",
        //     });
        //   }
        // }
  
        // อัปเดตข้อมูลผู้ใช้ในฐานข้อมูล
        await db("userinfo")
          .where({ uinfoid })
          .update({
            ugroupid,
            shopid,
            uinfologinname,
            uinfologinpass,
            uinfoname,
            level
          });
  
        resolve({
          message: "User updated successfully",
          uinfoid,
        });
      } catch (error) {
        reject(error);
      }
    });
  
    Promise.race([userEditLogic, timeoutPromise])
      .then(async(data) => {

        await eventlog(req,"แก้ไขรายการ User") // บันทึก log
        await notification(req,"User", `มีการแปลี่ยนแปลงข้อมูลรายการ User "${uinfoname}"`); // notification
        res.status(200).json(data); // ส่ง response พร้อมสถานะ 200 (OK)
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

// user delete ✓
exports.userdelete = async (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeout)
    );
  
    const userDeleteLogic = new Promise(async (resolve, reject) => {
      try {
        const { uinfoid } = req.body;
  
        // ตรวจสอบ API Key
        await validateApiKey(req);

        // ตรวจสอบการอนุญาตเข้าสู่ระบบ
        await checkAuthorizetion(req);
  
        // ตรวจสอบข้อมูลที่จำเป็น
        if (!uinfoid) {
          return reject({ status: 400, message: "Invalid request"});
        }
  
        // ตรวจสอบว่า `uinfoid` มีอยู่ในฐานข้อมูลหรือไม่
        const existingUser = await db("userinfo")
          .select("*")
          .where({ uinfoid });
  
        if (existingUser.length === 0) {
          return reject({
            status: 402,
            message: "uinfoid not found",
          });
        }
  
        // อัปเดต `status` ให้เป็น `false`
        await db("userinfo")
          .where({ uinfoid })
          .update({ status: false });
  
        resolve({
          uinfoid,
          uinfoname: existingUser[0].uinfoname,
          message: "deleted successfully",
        });
      } catch (error) {
        reject(error);
      }
    });
  
    Promise.race([userDeleteLogic, timeoutPromise])
      .then(async(data) => {

        await eventlog(req,"ลบรายการ User") // บันทึก log
        await notification(req,"User", `มีการลบข้อมูลรายการ User "${data.uinfoname}"`); // notification

        res.status(200).json(data); // ส่ง response พร้อมสถานะ 200 (OK)
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