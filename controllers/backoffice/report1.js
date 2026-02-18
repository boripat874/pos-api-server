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


// report order list
exports.reportorderlist = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reportorderListLogic = new Promise(async (resolve, reject) => {

    try {

      const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      // console.log("timestart >>" + req.query.timestart);
      // console.log("timeend >>" + req.query.timeend);
      // console.log(timestamp);

      const shopid = req.body.shopid;

      const orderlist = await db("orderinfo")
      .select(
        "orderinfo.ordertimestamp as ordertimestamp",
        "orderinfo.ordernumber as ordernumber",
        "orderinfo.ordertotalprice as ordertotalprice",
        "orderinfo.vat7pc as vat7pc",
        "orderinfo.ordertotaldiscount as ordertotaldiscount",
        "orderinfo.orderpricenet as orderpricenet",
        "receiptinfo.paymentType as paymenttype",
        "receiptinfo.urlfile as urlfile",
      )
      // .join("shopinfo", "shopinfo.shopid", "orderinfo.shopid")
      .leftJoin("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
      .where("orderinfo.shopid", shopid)
      .andWhere({status: true})
      .andWhere("orderinfo.orderispay",">" ,0)
      .andWhereNot("receiptinfo.paymentType", null || 0)
      .andWhere(function () {
        // this.where("shopnameth", "ILIKE", `%${search}%`)
        // .orWhere("shopnameeng", "ILIKE", `%${search}%`)
        this.orWhere("orderinfo.ordernumber", "ILIKE", `%${search}%`)
      })
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })
      .orderBy("orderinfo.ordertimestamp", "desc");

      const formattedResults = orderlist.map(item => {
        let formattedTimestamp = "0000/00/00 00:00"; // Default value

        // Check if the timestamp exists and is valid
        if (item.ordertimestamp) {

          const orderDate = new Date(item.ordertimestamp*1000);
          // const orderDate = new Date(1737973730000);

          // Check if the created Date object is valid before formatting
          if (!isNaN(orderDate.getTime())) {
              // Use date.format with the required pattern
            formattedTimestamp = date.format(orderDate, 'YYYY-MM-DD HH:mm');

          } else {
            // Handle cases where the DB timestamp might be invalid
            console.warn(`Invalid date format encountered for order timestamp: ${item.ordertimestamp}`);
            formattedTimestamp = 'Invalid Date'; // Or keep original, or set to empty string
          }
        }

        return {
            // ...item, // Keep other properties like shop names, product names etc.
            ordertimestamp: formattedTimestamp, // Use the formatted timestamp
            ordernumber: item.ordernumber,
            ordertotalprice: Number(item.ordertotalprice),
            vat7pc: Number(item.vat7pc),
            ordertotaldiscount: Number(item.ordertotaldiscount),
            orderpricenet: Number(item.orderpricenet),
            paymenttype: item.paymenttype,
            urlfile: item.urlfile
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

  Promise.race([reportorderListLogic, timeoutPromise])
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

// report total income
exports.reporttotalincome = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reporttotalIncomeLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const { shopid } = req.body;

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const query_total_income = await db("orderinfo")
      .sum("orderpricenet as total_income")
      .where("shopid", shopid)
      .andWhere({status: true})
      .andWhere("orderispay",">" ,0)
      .andWhere(function () {
        this.where("ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("ordertimestamp", "<", timestamp.endTimestamp);
      })

      resolve({
        total_income: Number(query_total_income[0].total_income) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reporttotalIncomeLogic, timeoutPromise])
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
  })
}

// report total credit card
exports.reporttotalcreditcard = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reporttotalCreditCardLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const { shopid } = req.body;

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const query_total_creditcard = await db("orderinfo")
      .join("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
      .sum("orderinfo.orderpricenet as total_creditcard")
      .where({
        "orderinfo.shopid":shopid,
        "receiptinfo.paymentType": 1
      })
      .andWhere({status: true})
      .andWhere("orderinfo.orderispay",">" ,0)
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })

      resolve({
        total_creditcard: Number(query_total_creditcard[0].total_creditcard) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reporttotalCreditCardLogic, timeoutPromise])
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
  })
}

// report total PromptPay
exports.reporttotalpromptpay = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reporttotalPromptPayLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const { shopid } = req.body;

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const query_total_promptpay = await db("orderinfo")
      .join("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
      .sum("orderinfo.orderpricenet as total_promptpay")
      .where({
        "orderinfo.shopid":shopid,
        "receiptinfo.paymentType": 2
      })
      .andWhere({status: true})
      .andWhere("orderinfo.orderispay",">" ,0)
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })

      resolve({
        total_promptpay: Number(query_total_promptpay[0].total_promptpay) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reporttotalPromptPayLogic, timeoutPromise])
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
  })
}

// report total E-wallet
exports.reporttotalewallet = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reporttotalEwalletLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const { shopid } = req.body;

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const query_total_ewallet = await db("orderinfo")
      .join("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
      .sum("orderinfo.orderpricenet as total_ewallet")
      .where({
        "orderinfo.shopid":shopid,
        "receiptinfo.paymentType": 3
      })
      .andWhere({status: true})
      .andWhere("orderinfo.orderispay",">" ,0)
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })

      resolve({
        total_ewallet: Number(query_total_ewallet[0].total_ewallet) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reporttotalEwalletLogic, timeoutPromise])
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
  })
}

// report total Cash
exports.reporttotalcash = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reporttotalCashLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const { shopid } = req.body;

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const query_total_cash = await db("orderinfo")
      .join("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
      .sum("orderinfo.orderpricenet as total_cash")
      .where({
        "orderinfo.shopid":shopid,
        "receiptinfo.paymentType": 4
      })
      .andWhere({status: true})
      .andWhere("orderinfo.orderispay",">" ,0)
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })

      resolve({
        total_cash: Number(query_total_cash[0].total_cash) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reporttotalCashLogic, timeoutPromise])
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
  })

}

// report total order
exports.reporttotalorder = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reporttotalOrderLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const shopid = req.body.shopid || "";

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const query_total_order = await db("orderinfo")
      .count("orderid as total_order")
      .where("shopid", shopid)
      .andWhere({status: true})
      .andWhere("orderinfo.orderispay",">" ,0)
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })

      resolve({
        total_order: Number(query_total_order[0].total_order) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reporttotalOrderLogic, timeoutPromise])
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
  })
}

// report product sell
exports.reportproductsell = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const reportproductSellLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

      const shopid = req.body.shopid || "";

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const query_total_product = await db("orderinfo")
      .join("orderdetail", "orderinfo.orderid", "orderdetail.orderid")
      .sum("orderdetail.qty as total_product")
      .where("orderinfo.shopid", shopid)
      .andWhere({status: true})
      .andWhere("orderinfo.orderispay",">" ,0)
      .andWhere(function () {
        this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
        .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
      })

      // console.log(query_total_order);

      resolve({
        total_product: Number(query_total_product[0].total_product) || 0,
      });
    
    } catch (error) {
      
      reject(error);

    }
  });

  Promise.race([reportproductSellLogic, timeoutPromise])
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
  })
}

// // report product sell list
// exports.reportproductselllist = (req, res) => {
//   const timeoutPromise = new Promise((_, reject) =>
//     setTimeout(() => reject(new Error("Request timed out")), timeout)
//   );

//   const reportproductsellListLogic = new Promise(async (resolve, reject) => {
//     try {

//       const search = req.query.search || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา

//       // Validate API key
//       await validateApiKey(req);

//       await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

//       const timestamp = await convertTotimestamp(req); // แปลงค่า timestamp

//       const orderdetaillist = await db("orderdetail")
//       .select(
//         "orderdetail.id as id",
//         "orderinfo.ordertimestamp as ordertimestamp",
//         "shopinfo.shopnameth as shopnameth",
//         "shopinfo.shopnameeng as shopnameeng",
//         "productinfo.productnameth as productnameth",
//         "productinfo.productnameeng as productnameeng",
//         "orderdetail.qty as qty",
//         "orderdetail.productprice as productprice",
//         // Calculate totalprice directly in the database query and alias it
//         db.raw('CAST(orderdetail.qty AS NUMERIC) * CAST(orderdetail.productprice AS NUMERIC) as totalprice')
//       )
//       .join("orderinfo", "orderinfo.orderid", "orderdetail.orderid")
//       .join("productinfo", "productinfo.productid", "orderdetail.productid")
//       .join('shopinfo', 'shopinfo.shopid', 'productinfo.shopid')
//       // .where({ "status": true }) // เงื่อนไข status = true
//       .andWhere(function () {
//           this.where("productnameth", "ILIKE", `%${search}%`)
//           .orWhere("productnameeng", "ILIKE", `%${search}%`)
//           .orWhere("shopnameth", "ILIKE", `%${search}%`)
//           .orWhere("shopnameeng", "ILIKE", `%${search}%`)
//       })
//       .orderBy("orderdetail.orderid", "desc")
      

//       // Format results: Convert numbers and format the timestamp
//       const formattedResults = orderdetaillist.map(item => {
//         let formattedTimestamp = "0000/00/00 00:00"; // Default value

//         // Check if the timestamp exists and is valid
//         if (item.ordertimestamp) {
//             const orderDate = new Date(item.ordertimestamp*1000);
//             // const orderDate = new Date(1737973730000);

//             // Check if the created Date object is valid before formatting
//             if (!isNaN(orderDate.getTime())) {
//                  // Use date.format with the required pattern
//                 formattedTimestamp = date.format(orderDate, 'YYYY-MM-DD HH:mm');

//             } else {
//                 // Handle cases where the DB timestamp might be invalid
//                 console.warn(`Invalid date format encountered for order timestamp: ${item.ordertimestamp}`);
//                 formattedTimestamp = 'Invalid Date'; // Or keep original, or set to empty string
//             }
//         }

//         return {
//             ...item, // Keep other properties like shop names, product names etc.
//             ordertimestamp: formattedTimestamp, // Use the formatted timestamp
//             productprice: Number(item.productprice),
//             qty: Number(item.qty),
//             totalprice: Number(item.totalprice)
//         };
//       });

//       resolve({
//         total: formattedResults.length, // Use the length of the results from the query
//         result: formattedResults,      // Use the results directly
//       });
    
//     } catch (error) {
      
//       reject(error);

//     }
//   });

//   Promise.race([reportproductsellListLogic, timeoutPromise])
//   .then((data) => {

//     res.send(data); // Send the response only once

//   })
//   .catch((error) => {

//     if (error.status) {

//       res.status(error.status).json({ message: error.message });

//     } else if (error.message === "Request timed out") {

//       res.status(402).json({ message: "Request timed out" });

//     } else {
//       handleError(error, res);
//     }
//   });

// }

exports.receiptorder = async (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const receiptInfoLogic = new Promise(async (resolve, reject) => {
    try {
      // Validate API key
      await validateApiKey(req);
      await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

      const { ordernumber } = req.body;

      if (!ordernumber) {
        return reject({ status: 402, message: "ordernumber is not required" });
      }

      // ดึงข้อมูลใบเสร็จและ orderinfo
      const receiptRows = await db("receiptinfo")
        .select(
          "receiptinfo.receiptid as receiptid",
          "receiptinfo.ordernumber as ordernumber",
          "receiptinfo.receiptnumber as receiptnumber",
          "receiptinfo.paymentType as paymenttype",
          "receiptinfo.receiptcash as receiptcash",
          "receiptinfo.receiptchange as receiptchange",
          "receiptinfo.receiptdiscount as receiptdiscount",
          "receiptinfo.totalprice as totalprice",
          "receiptinfo.create_at as create_at",
          "orderinfo.orderid as orderid"
        )
        .join("orderinfo", "receiptinfo.ordernumber", "orderinfo.ordernumber")
        .where({ "receiptinfo.ordernumber": ordernumber })
        .orderBy("receiptinfo.create_at", "desc");

      if (receiptRows.length === 0) {
        return reject({ status: 402, message: "receiptinfo not found" });
      }

      const orderid = receiptRows[0].orderid;

      // ดึง orderdetail ทั้งหมดที่ orderid ตรงกับ orderinfo
      const orderDetails = await db("orderdetail")
        .select(
          "orderdetail.productid",
          "orderdetail.qty",
          "orderdetail.productprice",
          "productinfo.productnameth",
          "productinfo.productnameeng"
        )
        .join("productinfo", "orderdetail.productid", "productinfo.productid")
        .where({ "orderdetail.orderid": orderid });

      const pricenet = Number(receiptRows[0].totalprice) - Number(receiptRows[0].receiptdiscount)

      // สร้าง object หลักสำหรับใบเสร็จ
      const mainInfo = {
        ...receiptRows[0],
        receiptid: receiptRows[0].receiptid,
        ordernumber: receiptRows[0].ordernumber,
        receiptnumber: receiptRows[0].receiptnumber,
        paymenttype: Number(receiptRows[0].paymenttype),
        receiptcash: Number(receiptRows[0].receiptcash),
        receiptchange: Number(receiptRows[0].receiptchange),
        receiptdiscount: Number(receiptRows[0].receiptdiscount),
        totalprice: Number(receiptRows[0].totalprice),
        totalpricenet: pricenet > 0 ? pricenet : 0,
        create_at: receiptRows[0].create_at,
        orderid: orderid,
        products: orderDetails.map((item) => ({
          productid: item.productid,
          productnameth: item.productnameth,
          productnameeng: item.productnameeng,
          qty: Number(item.qty),
          productprice: Number(item.productprice),
        })),
      };

      return resolve(mainInfo);
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([receiptInfoLogic, timeoutPromise])
    .then((data) => {
      res.send(data);
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


      

