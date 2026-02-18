const {db} = require("../../db/postgresql");
// const fs = require("fs");
// const date = require("date-and-time");
// const { uuid } = require("uuidv4");
// const multer = require("multer");
// const path = require("path");
const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT
const {checkAuthorizetion} = require("../../modules/fun");

require("dotenv").config();

const timeout = 60000; // Timeout in milliseconds (e.g., 60 seconds)

async function validateApiKey(req) {

  const X_API_KEY = req.headers["x-api-key"]||"";

  const autihorized = await db.select("apikey").where({ "apikey": X_API_KEY }).from("shopinfo");

  if (!autihorized.length) {

    // return res.status(401).json({ message: "Unauthorized" });
    throw { status: 401, message: "Unauthorized" };
    
  }
}

// ฟังก์ชันสําหรับจัดการข้อผิดพลาด
function handleError(error, res) {
  console.error(error); // แสดงข้อผิดพลาดใน console
  res.status(500).json({ message: "Internal Server Error", error: error.message });
}

// shops list
exports.shopslist = async(req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const shopsListLogic = new Promise(async (resolve, reject) => {
    try {

      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

        const headers = req.headers.authorization;
        const token = headers.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const uinfoid = decoded.uinfoid;
        const ugroupid = decoded.ugroupid;

        const dbuser = await db("userinfo")
          .select("level", "shopid")
          .where({ uinfoid: uinfoid })
          .first();

        if(!dbuser){
          return reject({status: 402, message: "User not found"});
        }
        
        const currentUserLevel = dbuser.level;
        const currentUserShopId = dbuser.shopid;

        const shoplist = await db("shopinfo")
        .select(
            "shopid",
            "ugroupid", 
            "shopnameth", 
            "create_at"
        )
        .where({"status": true})
        .andWhere(function () {

          if(currentUserLevel === "Admin") {

            this.whereRaw("1=1")


          }else if(currentUserLevel === "Owner"){
          
            this.where("ugroupid", "=", ugroupid)
            
          }else {

            this.where("shopid", "=", currentUserShopId)

          }
        })
        .orderBy("create_at", "desc");
      
      resolve({
        total: shoplist.length,
        result: shoplist,
      });

      if (!shoplist.length) {
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