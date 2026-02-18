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

// ฟังก์ชันสําหรับตรวจสอบวันสิ้นสุดโปรโมชั่น
async function checkpromotion(params) {
  let calculatedStatus = "ใช้งาน"; // ค่าเริ่มต้น
  const today = new Date();
  today.setHours(0, 0, 0, 0); // ตั้งเวลาเป็น 00:00:00.000 ของวันปัจจุบัน

  let endDate;
  try {
    endDate = new Date(params); // แปลง input เป็น Date object
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
      return false; //
    }

    return true; // ถ้าไม่เกินเวลา
    // return calculatedStatus; // ถ้าไม่เกินเวลา
  } catch (dateError) {
    // console.error("Error parsing promotionend date:", dateError);
    return reject({
      status: 400,
      message: "Invalid request: Error processing promotionend date",
    });
  }
}

//product category list ✓
exports.productcategorylist = (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeout)
    );
  
    const productcategorylistLogic = new Promise(async (resolve, reject) => {
      try {
  
        // Validate API key
        await validateApiKey(req);
  
        await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

        const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา
        // const headers = req.headers.authorization;
        // const token = headers.split(" ")[1];
        // const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // const uinfoid = decoded.uinfoid;
        // const ugroupid = decoded.ugroupid;

        const {shopid} = req.body;

        if (!shopid) {
          return reject({ status: 402, message: "Shop not required" });
        }

        const db_shop = await db("shopinfo")
          .select("shopid")
          .where({ shopid: shopid, status: true })
          .first();
  
        if (db_shop === null) {
          return reject({ status: 402, message: "Shop not found" });
        }
  
        const db_productcategory = await db("productcategoryinfo")
          .select(
            "CgtyId",
            "productCgtyId",
            "shopid",
            "categoryname",
            "details",

            // "create_at",
            // "update_at"
          )
          .where({ shopid: shopid, status: true })
          .orderBy("create_at", "desc");

  
        return resolve({
          total: db_productcategory.length,
          result: db_productcategory,
        });
      } catch (error) {
        return reject(error);
      }
    });
  
    Promise.race([productcategorylistLogic, timeoutPromise])
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
      });
};

//shop list ✓
exports.productshoplist = (req, res) => {

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

      const resultshops = shoplist.map((shop) => ({
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

//product list ✓
exports.productlist = (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeout)
    );
  
    const { shopid } = req.body;
    const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา

    const productListLogic = new Promise(async (resolve, reject) => {
      try {

        // console.log(shopid);
        // Validate API key
        await validateApiKey(req);

        // ตรวจสอบการอนุญาตเข้าสู่ระบบ
        await checkAuthorizetion(req);
  
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
  
        const productlist = await db
          .select("*")
          .from("productinfo")
          .where({ shopid , status: true })
          .andWhere(function () {
                this.where("productnameth", "ILIKE", `%${search}%`)
                .orWhere("productnameeng", "ILIKE", `%${search}%`)
            })
          .orderBy("create_at", "desc");
  
        let productlist_data = [];
        productlist.forEach((element) => {
          productlist_data.push({
            productid: element.productid,
            shopid: element.shopid,
            productCgtyId: element.productCgtyId,
            productnameth: element.productnameth,
            productnameeng: element.productnameeng,
            productimage: element.productimage,
          });
        });
  
        resolve({
          total: productlist_data.length,
          result: productlist_data,
        });
      } catch (error) {
        reject(error);
      }
    });
  
    Promise.race([productListLogic, timeoutPromise])
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

// product update stock ✓
exports.productupdatestock = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const { productid, productremain } = req.body;

  const productUpdateStockLogic = new Promise(async (resolve, reject) => {

    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      if (!checkString(productid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      if (productremain === undefined) {
        return reject({ status: 402, message: "not request productstock" });
      }

      if (typeof Number(productremain) !== "number") {
        return reject({ status: 402, message: "productremain must be a number" });
      }

      await db("productinfo")
          .update({ productremain , update_PRemain: Math.floor(Date.now() / 1000) })
          .where({ productid });

      resolve({
        productid,
        message: "Update product stock Success",
      });
    }

    catch (error) {
      reject(error);
    }
  });

  Promise.race([productUpdateStockLogic, timeoutPromise])

  .then(async(data) => {

    const db_productname = await db("productinfo")
      .select("productnameth")
      .where({ productid: data.productid })
      .first();
      // console.log("db_productname >>",db_productname);

    await eventlog(req, "แก้ไขจํานวนสินค้า"); // บันทึก log
    await notification(req, "สินค้า", `แก้ไขจํานวนสินค้า "${db_productname.productnameth}"`); // notification

    return res.json(data); // Send the response only oncethe promise is resolved

  }).catch((error) => {

    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    } else if (error.message === "Request timed out") {
      res.status(402).json({ message: "Request timed out" });
    } else {
      return handleError(error, res);
    }
    
  });
};  
  
//product detail ✓
exports.productdetail = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const productDetailLogic = new Promise(async (resolve, reject) => {

    try {
      const { productid } = req.body;

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      if (!productid || !checkString(productid)) {
          return reject({ status: 400, message: "Invalid request" });
      }

      let shopid = "";

      await db("productinfo")
        .select("productid", "shopid")
        .where({ productid })
        .then((result) => {

          if (result.length == 0) {
            return reject({
              status: 402,
              message: `productid not found`,
            });
          }
          
          shopid = result[0].shopid;
        })

      const productdetail = await db("productinfo")
        .select("*")
        .where({ productid });

      const promoinfo = await db("promoinfo")
        .select(
          "promoinfo.promoid as promoid",
          "promoinfo.typepromotions as typepromotions",
          "promoinfo.promoname as promoname",
          "promoinfo.datepromostart as datepromostart",
          "promoinfo.datepromoend as datepromoend",
          "promoinfo.discount as discount",
          "promoinfo.initial as initial",
          "pdpromotions.productid as productid"
        )
        .leftJoin("pdpromotions", "pdpromotions.promoid", "promoinfo.promoid")
        .whereNot({ "promoinfo.status": "ยกเลิก" })
        .where({ "shopid": shopid});

        // console.log("promoinfo",promoinfo);
      const promotionslist = promoinfo
        .filter(element => element.productid === productid || element.productid === "" || element.productid === null && checkpromotion(element.datepromoend))
        .map((element) => (

          {
            promotionid: element.promoid,
            typepromotions: element.typepromotions,
            promoname: element.promoname,
            datepromostart: element.datepromostart,
            datepromoend: element.datepromoend,
            discount: element.discount,
            initial: element.initial,
            productid: element.productid,
          }

        ));
      
      // console.log("promotionslist >>",promotionslist);
      let productdetail_data = {};

      productdetail.forEach((element) => {

        productdetail_data = {

          productid: element.productid,
          shopid: element.shopid,
          productnameth: element.productnameth,
          productnameeng: element.productnameeng,
          productdatath: element.productdatath,
          productdataeng: element.productdataeng,
          productprice: Number(element.productprice),
          uomtext: element.uomtext,
          productimage: element.productimage,
          productCgtyId: element.productCgtyId,
          additional: element.additional,
          productremain: Number(element.productremain),
          update_PRemain: date.format(new Date(element.update_PRemain*1000), "YYYY-MM-DD HH:mm"),
          promotion: promotionslist,
        };

      });

      resolve(productdetail_data);
    } catch (error) {
    reject(error);
    }
});

Promise.race([productDetailLogic, timeoutPromise])
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

// // product create ✓
// exports.productcreate = [

//     upload.single("productimage"), 
    
//     (req, res) => {

//          // ตรวจสอบว่ามีไฟล์อัปโหลดหรือไม่
//         let imagePath = null;
//         if (req.file) {
//             imagePath = req.file.path; // เก็บ path ของไฟล์ที่อัปโหลด
//         }

//         const timeoutPromise = new Promise((_, reject) =>
//             setTimeout(() => reject(new Error("Request timed out")), timeout)
//         );

//         const {
//             productid,
//             shopid,
//             productnameth,
//             productnameeng,
//             productdatath,
//             productdataeng,
//             productprice,
//         } = req.body;
        
//         const productCreateLogic = new Promise(async (resolve, reject) => {
//             try {

//             // Validate API key
//             await validateApiKey(req);

//             if (
//                 !productid ||
//                 !shopid ||
//                 !checkString(shopid) ||
//                 !checkString(productid)
//             ) {

//                 return reject({ status: 400, message: "Invalid request" });
//             }

//             if (!productnameth) {
//                 return reject({ status: 402, message: "Not productnameth" });
//             }

//             if (!productnameeng) {
//                 return reject({ status: 402, message: "Not productnameeng" });
//             }

//             if (productprice === undefined) {
//                 return reject({ status: 402, message: "Not productprice" });
//             }

//             if (typeof Number(productprice) !== "number") {
//                 return reject({ status: 402, message: "productprice must be a number" });
//             }

//             const db_shopid = await db
//                 .select("shopid")
//                 .from("shopinfo")
//                 .where({ shopid });

//             if (!db_shopid.length) {
//                 return reject({ status: 402, message: "shopid not found" });
//             }

//             const db_productid = await db
//                 .select("productid")
//                 .from("productinfo")
//                 .where({ productid });

//             if (db_productid.length) {

//                 return reject({status: 402,message: "productid already exists",});

//             }

//             await db("productinfo").insert({
//                 productid,
//                 shopid,
//                 productnameth,
//                 productnameeng,
//                 productdatath,
//                 productdataeng,
//                 productprice: Number(productprice),
//                 uomtext: "ชิ้น",
//                 productimage: imagePath, // เก็บ path ของไฟล์ที่อัปโหลด
//             });

//             resolve({productid, message: "Create product Success",});

//             } catch (error) {
//                 reject(error);
//             }
//         });

//         Promise.race([productCreateLogic, timeoutPromise])

//         .then(async(data) => {

//           await eventlog(req,"เพิ่มรายการสินค้า") // บันทึก log
//           await notification(req,'สินค้า', `"${productnameth}" สินค้าใหม่`); // notification
          
//           res.json(data); // Send the response only once

//         })

//         .catch((error) => {

//             if (imagePath) {

//                 deleteUploadedFile(imagePath); // ลบไฟล์ที่อัปโหลดหากเกิดข้อผิดพลาด
//             }

//             if (error.status) {

//                 res.status(error.status).json({ message: error.message });

//             } else if (error.message === "Request timed out") {

//                 res.status(402).json({ message: "Request timed out" });

//             } else {

//                 handleError(error, res);
//             }
//         });
//     }
// ];

// // product update ✓
// exports.productupdate = [

//     upload.single("productimage"), // ใช้ multer สำหรับอัปโหลดไฟล์

//     (req, res) => {

//     const timeoutPromise = new Promise((_, reject) =>
//         setTimeout(() => reject(new Error("Request timed out")), timeout)
//     );

//     const {
//         productid,
//         shopid,
//         productprice,
//         productnameth,
//         productnameeng,
//         productdatath,
//         productdataeng,
//         productimageold,
//     } = req.body;

//     // ตรวจสอบว่ามีไฟล์อัปโหลดหรือไม่
//     let imagePath = null;

//     if (req.file) {
//         imagePath = req.file.path; // เก็บ path ของไฟล์ที่อัปโหลด
//     }else{
//         imagePath = productimageold
//     }

//     const productUpdateLogic = new Promise(async (resolve, reject) => {
//         try {

//         // Validate API key
//         await validateApiKey(req);

//         if (
//             !productid ||
//             !shopid ||
//             !checkString(shopid) ||
//             !checkString(productid)
//         ) {
//             return reject({ status: 400, message: "Invalid request" });
//         }

//         const db_productid = await db
//             .select("productid")
//             .from("productinfo")
//             .where({ productid });

//         if (!db_productid.length) {
//             return reject({
//             status: 402,
//             message: "productid not found",
//             });
//         }

//         const db_shopid = await db
//             .select("shopid")
//             .from("shopinfo")
//             .where({ shopid });

//         if (!db_shopid.length) {
//             return reject({
//             status: 402,
//             message: "shopid not found",
//             });
//         }

//         if (typeof Number(productprice) !== "number") {
//             return reject({
//             status: 402,
//             message: "productprice must be a number",
//             });
//         }

//         await db("productinfo")
//             .where({ productid })
//             .update({
//             productnameth,
//             productnameeng,
//             productdatath,
//             productdataeng,
//             productprice: Number(productprice),
//             productimage: imagePath, // เก็บ path ของไฟล์ที่อัปโหลด
//             });

//         resolve({
//             productid,
//             message: "Update product Success",
//         });
//         } catch (error) {
//             reject(error);
//         }
//     });

//     Promise.race([productUpdateLogic, timeoutPromise])
//         .then(async(data) => {
//             if (req.file) {

//               await deleteUploadedFile(productimageold); // ลบไฟล์เก่าหากมีการอัปโหลดใหม่
//             }

//             await eventlog(req,"แก้ไขรายการสินค้า") // บันทึก log
//             await notification(req,'สินค้า', `มีการเปลี่ยนแปลงข้อมูลสินค้า "${productnameth}" `); // notification

//             res.json(data); // Send the response only once
//         })
//         .catch((error) => {

//             if(req.file){
//                 deleteUploadedFile(imagePath); // ลบไฟล์ที่อัปโหลดหากเกิดข้อผิดพลาด
//             }

//             if (error.status) {
//                 res.status(error.status).json({ message: error.message });
//             } else if (error.message === "Request timed out") {
//                 res.status(402).json({ message: "Request timed out" });
//             } else {
//                 handleError(error, res);
//             }
//         });
//     }
// ];
    
// // product delete ✓
// exports.productdelete = (req, res) => {
// const timeoutPromise = new Promise((_, reject) =>
//     setTimeout(() => reject(new Error("Request timed out")), timeout)
// );

// const productDeleteLogic = new Promise(async (resolve, reject) => {
//     try {
//     const { productid } = req.body;

//     // Validate API key
//     await validateApiKey(req);

//     if (!productid || !checkString(productid)) {
//         return reject({ status: 400, message: "Invalid request" });
//     }

//     const db_productid = await db
//         .select("*")
//         .from("productinfo")
//         .where({ productid });

//     if (!db_productid.length) {
//         return reject({
//         status: 402,
//         message: "productid not found",
//         });
//     }

//     await db("productinfo")
//     .where({ productid })
//     .update({status: false});
//     // .del();

//     resolve({
//       productid,
//       productnameth: db_productid[0].productnameth,
//       message: "Delete product Success",
//     });
//     } catch (error) {
//     reject(error);
//     }
// });

// Promise.race([productDeleteLogic, timeoutPromise])
//     .then(async(data) => {

//       await eventlog(req,"ลบรายการสินค้า") // บันทึก log
//       await notification(req,'สินค้า', `มีการลบข้อมูลสินค้า "${data.productnameth}" `); // notification

//       res.json(data); // Send the response only once
//     })
//     .catch((error) => {
//     if (error.status) {
//         res.status(error.status).json({ message: error.message });
//     } else if (error.message === "Request timed out") {
//         res.status(402).json({ message: "Request timed out" });
//     } else {
//         handleError(error, res);
//     }
//     });
// };

