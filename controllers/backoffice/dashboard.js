const {db} = require("../../db/postgresql");
const fs = require("fs");
const date = require("date-and-time");
const { uuid } = require("uuidv4");
const multer = require("multer");
const path = require("path");
// const { console } = require("inspector");

const {checkAuthorizetion} = require("../../modules/fun");
const {convertTotimestamp} = require("../../modules/convertTotimestamp");

const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT

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

// dashboardDataList
exports.dashboardDataList = async (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const dashboardDataListLogic = new Promise(async (resolve, reject) => {
        try {

        await validateApiKey(req); // ตรวจสอบ API key

        await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

        const shopid = req.body.shopid || "";

        const timestamp = await convertTotimestamp(req); // แปลง timestamp

        if (!shopid || !checkString(shopid)) {
            return reject({ status: 400, message: "Invalid request" });
        }

        const shopdata = await db("shopinfo")
            .select("shopnameth","shoplogoimage")
            .where("shopid", shopid)
            .first();

        if (!shopdata) {
            return reject({ status: 402, message: "Shop not found" });
        }

        const query_total_income = await db("orderinfo")
            .sum("orderpricenet as total_income")
            .where("shopid", shopid)
            .andWhere("status", true)
            .andWhere("orderispay",">" ,0)
            .andWhere(function () {
                this.where("ordertimestamp", ">=", timestamp.startTimestamp)
                .andWhere("ordertimestamp", "<", timestamp.endTimestamp);
            })
        
        const query_total_creditcard = await db("orderinfo")
            .join("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
            .sum("orderinfo.orderpricenet as total_creditcard")
            .where({
                "orderinfo.shopid":shopid,
                "receiptinfo.paymentType": 1
            })
            .andWhere("orderinfo.status", true)
            .andWhere("orderinfo.orderispay", ">", 0)
            .andWhere(function () {
                this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
                .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
            })

        const query_total_promptpay = await db("orderinfo")
            .join("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
            .sum("orderinfo.orderpricenet as total_promptpay")
            .where({
                "orderinfo.shopid":shopid,
                "receiptinfo.paymentType": 2
            })
            .andWhere("orderinfo.status", true)
            .andWhere("orderinfo.orderispay", ">", 0)
            .andWhere(function () {
                this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
                .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
            })

        const query_total_ewallet = await db("orderinfo")
            .join("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
            .sum("orderinfo.orderpricenet as total_ewallet")
            .where({
                "orderinfo.shopid":shopid,
                "receiptinfo.paymentType": 3
            })
            .andWhere("orderinfo.status", true)
            .andWhere("orderinfo.orderispay", ">", 0)
            .andWhere(function () {
                this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
                .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
            })

        const query_total_cash = await db("orderinfo")
            .join("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
            .sum("orderinfo.orderpricenet as total_cash")
            .where({
                "orderinfo.shopid":shopid,
                "receiptinfo.paymentType": 4
            })
            .andWhere("orderinfo.status", true)
            .andWhere("orderinfo.orderispay", ">", 0)
            .andWhere(function () {
                this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
                .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
            })

        const query_total_order = await db("orderinfo")
            .count("orderid as total_order")
            .where("shopid", shopid)
            .andWhere("orderinfo.status", true)
            .andWhere("orderinfo.orderispay",">" ,0)
            .andWhere(function () {
                this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
                .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
            })

        const query_total_product = await db("orderinfo")
            .join("orderdetail", "orderinfo.orderid", "orderdetail.orderid")
            .sum("orderdetail.qty as total_product")
            .where("orderinfo.shopid", shopid)
            .andWhere("orderinfo.status", true)
            .andWhere("orderinfo.orderispay", ">", 0)
            .andWhere(function () {
                this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
                .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
            })

        const product_sales = await db("orderdetail")
            .join("productinfo", "productinfo.productid", "orderdetail.productid")
            .join("orderinfo", "orderinfo.orderid", "orderdetail.orderid")
            // .join("shopinfo", "shopinfo.shopid", "productinfo.shopid")
            .where("productinfo.shopid", shopid)
            .andWhere("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
            .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp)
            .andWhere("orderinfo.orderispay",">" ,0)
            .andWhere("orderinfo.status", true)
            .groupBy("productinfo.productid" ,"productinfo.productnameth")
            .select("productinfo.productid" ,"productinfo.productnameth")
            // .having("shopinfo.shopnameth", "like", "%ร้าน%")
            .sum("orderdetail.qty as totalitem")
            .orderBy("totalitem", "desc")

        const result_product_sales = product_sales.map((item) => {
            return {
                productid: item.productid,
                productnameth: item.productnameth,
                totalitem: Number(item.totalitem),
            };
        });

        resolve({
          result: {
            shopnameth: shopdata.shopnameth || "",
            shoplogoimage: shopdata.shoplogoimage,
            total_income: Number(query_total_income[0].total_income) || 0,
            total_creditcard:Number(query_total_creditcard[0].total_creditcard) || 0,
            total_promptpay:Number(query_total_promptpay[0].total_promptpay) || 0,
            total_ewallet: Number(query_total_ewallet[0].total_ewallet) || 0,
            total_cash: Number(query_total_cash[0].total_cash) || 0,
            total_order: Number(query_total_order[0].total_order) || 0,
            total_product: Number(query_total_product[0].total_product) || 0,
            product_sales: result_product_sales,
          },
        });

    } catch (error) {
        reject(error);
    }
    });

    Promise.race([dashboardDataListLogic, timeoutPromise])
        .then((result) => {
            res.json(result);
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

// dashboard Overview
exports.dashboardOverview = (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const dashboardOverviewLogic = new Promise(async (resolve, reject) => {
        try {

            await validateApiKey(req); // ตรวจสอบ API key

            await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

            const timestamp = await convertTotimestamp(req); // แปลง timestamp

            const headers = req.headers.authorization;
            const token = headers.split(" ")[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const uinfoid = decoded.uinfoid;
            const ugroupid = decoded.ugroupid;

            const level = await db("userinfo")
                .select("level")
                .where("uinfoid", uinfoid)
                .then((result) => {
                    return result[0].level;
                }) || "0";

            // console.log("level",level);

            const shoplist = await db("shopinfo")
                .select("shopid","shopnameth","shoplogoimage","create_at")
                .where({"status": true})
                .andWhere(function () {

                    if(level !== 'Admin'){
                        
                        this.where({"ugroupid": ugroupid})
                    }else{
                        this.where(true)
                    }
                })
                .orderBy("create_at", "desc");

                // console.log("shoplist",shoplist);

            const totalincome = async(shopid) => {

                return db("orderinfo")
                .sum("orderinfo.orderpricenet as total")
                .where("shopid", shopid)
                .andWhere("orderinfo.status", true)
                .andWhere("orderinfo.orderispay",">" ,0)
                .andWhere(function () {
                    this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
                    .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
                })
                .then((result) => {
                    return result[0].total;
                })
            }

            const totalorder = async(shopid) => {

                return db("orderinfo")
                .count("orderid as total")
                .where("shopid", shopid)
                .andWhere("orderinfo.status", true)
                .andWhere("orderinfo.orderispay",">" ,0)
                .andWhere(function () {
                    this.where("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
                    .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp);
                })
                .then((result) => {
                    return result[0].total;
                })
            }

            const totalproduct = async (shopid) => {
              return db("orderinfo")
                .join("orderdetail", "orderinfo.orderid", "orderdetail.orderid")
                .sum("orderdetail.qty as total")
                .where("orderinfo.shopid", shopid)
                .andWhere("orderinfo.status", true)
                .andWhere("orderinfo.orderispay", ">", 0)
                .andWhere(function () {
                  this.where(
                    "orderinfo.ordertimestamp",
                    ">=",
                    timestamp.startTimestamp
                  ).andWhere(
                    "orderinfo.ordertimestamp",
                    "<",
                    timestamp.endTimestamp
                  )
                })
                .then((result) => {
                    return result[0].total;
                })
            };

            let resultCard = [];

            if (shoplist.length > 0) {
                resultCard = await Promise.all(shoplist.map(async (item) => {

                    return {
                      shopid: item.shopid,
                      shopnameth: item.shopnameth,
                      shoplogoimage: item.shoplogoimage,
                      totalincome: Number(await totalincome(item.shopid)) || 0,
                      totalorder: Number(await totalorder(item.shopid)) || 0,
                      totalproduct: Number(await totalproduct(item.shopid)) || 0,
                    };
                    
                    })
                );
            }

            resolve({
                result: resultCard
            });
        }
        catch (error) {
            reject(error);
        }
    });

    Promise.race([dashboardOverviewLogic, timeoutPromise])
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


// dashboard product sell list
exports.dashboardproductselllist = (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const dashboardproductselllistLogic = new Promise(async (resolve, reject) => {
        try {

            await validateApiKey(req); // ตรวจสอบ API key

            await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

            const timestamp = await convertTotimestamp(req); // แปลง timestamp

            const headers = req.headers.authorization;
            const token = headers.split(" ")[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const uinfoid = decoded.uinfoid;
            const ugroupid = decoded.ugroupid;

            // const shoplist = await db("shopinfo")
            //     .select("shopid","shopnameth","shoplogoimage","create_at")
            //     .where({"status": true, "ugroupid": ugroupid})
            //     .orderBy("create_at", "desc");

            const product_sales = await db("orderdetail")
            .join("productinfo", "productinfo.productid", "orderdetail.productid")
            .join("orderinfo", "orderinfo.orderid", "orderdetail.orderid")
            .join("shopinfo", "shopinfo.shopid", "productinfo.shopid")
            .where("shopinfo.ugroupid", ugroupid)
            .andWhere("orderinfo.ordertimestamp", ">=", timestamp.startTimestamp)
            .andWhere("orderinfo.ordertimestamp", "<", timestamp.endTimestamp)
            .andWhere("orderinfo.orderispay",">" ,0)
            .andWhere("orderinfo.status", true)
            .groupBy("productinfo.productid" ,"productinfo.productnameth" ,"productinfo.shopid")
            .select("productinfo.productid" ,"productinfo.productnameth","productinfo.shopid")
            // .having("shopinfo.shopnameth", "like", "%ร้าน%")
            .sum("orderdetail.qty as totalitem")
            .orderBy("totalitem", "desc")

            // console.log("product_sales",product_sales);

            const result_product_sales = product_sales.map((item) => {
                return {
                    productid: item.productid,
                    productnameth: item.productnameth,
                    totalitem: Number(item.totalitem),
                    // totalitem: 0,

                    shopid: item.shopid,
                };
            });

            resolve({
                total: result_product_sales.length,
                result: result_product_sales
            });
        }
        catch (error) {
            reject(error);
        }
    });

    Promise.race([dashboardproductselllistLogic, timeoutPromise])
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
            

// dashboard total list
exports.dashboardlistAll = (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const dashboardtotallistLogic = new Promise(async (resolve, reject) => {
        try {

            await validateApiKey(req); // ตรวจสอบ API key

            await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

            // --- ส่วนนี้คือการคำนวณ timestamp สำหรับวันนี้ ---
            // const today = new Date("2025-01-27");
            const today = new Date(); // สร้าง object Date สำหรับวันนี้
            today.setHours(0, 0, 0, 0); // ตั้งเวลาเป็นจุดเริ่มต้นของวัน (00:00:00.000) ตามเวลาท้องถิ่น
            const startOfDayTimestamp = Math.floor(today.getTime() / 1000); // แปลงเป็น Unix timestamp (วินาที) และปัดเศษลง

            const tomorrow = new Date(today); // สร้าง object Date ใหม่จาก today
            tomorrow.setDate(tomorrow.getDate() + 1); // เลื่อนไปเป็นวันพรุ่งนี้
            const startOfNextDayTimestamp = Math.floor(tomorrow.getTime() / 1000); // แปลงเป็น Unix timestamp (วินาที) สำหรับจุดเริ่มต้นของวันพรุ่งนี้
            // --- สิ้นสุดการคำนวณ timestamp ---

            // --- ส่วนนี้คือการ Query ข้อมูลจากฐานข้อมูล ---
            // คำนวณผลรวมของ 'ordertotalprice' และตั้งชื่อผลลัพธ์เป็น 'totalprice'
            const result_totalprice = await db("orderinfo") // เลือกตาราง 'orderinfo'
            .sum("ordertotalprice as totalprice") // คำนวณผลรวมของคอลัมน์ 'ordertotalprice' และตั้งชื่อผลลัพธ์ว่า 'totalprice'
            // กรองข้อมูลเฉพาะรายการที่ 'ordertimestamp' อยู่ภายในวันนี้
            .where("ordertimestamp", ">=", startOfDayTimestamp) // เลือกรายการที่ timestamp มากกว่าหรือเท่ากับจุดเริ่มต้นของวันนี้
            .andWhere("ordertimestamp", "<", startOfNextDayTimestamp) // และ timestamp น้อยกว่าจุดเริ่มต้นของวันพรุ่งนี้
            .andWhere("orderispay", ">", 0)
            .andWhere("status", true)
            .first(); // ดึงผลลัพธ์เพียงแถวเดียว (sum จะคืนค่า array ที่มี object เดียว)

            // จัดการกรณีที่ไม่มีข้อมูลสำหรับวันนี้ (ผลรวมอาจเป็น null)
            const totalprice = result_totalprice && result_totalprice.totalprice ? Number(result_totalprice.totalprice) : 0; // ถ้ามีผลลัพธ์และ totalprice ไม่ใช่ null ให้แปลงเป็นตัวเลข, มิฉะนั้นให้เป็น 0

            const result_totalitem = await db("orderdetail") // เลือกตาราง 'orderdetail'
            .sum("orderdetail.qty as totalitem") // คำนวณผลรวมของคอลัมน์ 'qty' และตั้งชื่อผลลัพธ์ว่า 'totalitem'
            .join("orderinfo", "orderinfo.orderid", "orderdetail.orderid")
            // กรองข้อมูลเฉพาะรายการที่ 'ordertimestamp' อยู่ภายในวันนี้
            .where("orderinfo.ordertimestamp", ">=", startOfDayTimestamp) // เลือกรายการที่ timestamp มากกว่าหรือเท่ากับจุดเริ่มต้นของวันนี้
            .andWhere("orderinfo.ordertimestamp", "<", startOfNextDayTimestamp) // และ timestamp น้อยกว่าจุดเริ่มต้นของวันพรุ่งนี้
            .andWhere("orderinfo.orderispay",">" ,0)
            .andWhere("orderinfo.status", true)
            .first(); 

            const totalitem = result_totalitem && result_totalitem.totalitem ? Number(result_totalitem.totalitem) : 0;

            const result_popular_stores = await db("orderinfo")
            .join("shopinfo", "shopinfo.shopid", "orderinfo.shopid")
            .where("orderinfo.ordertimestamp", ">=", startOfDayTimestamp)
            .andWhere("orderinfo.ordertimestamp", "<", startOfNextDayTimestamp)
            .andWhere("orderinfo.orderispay",">" ,0)
            .andWhere("orderinfo.status", true)
            .groupBy("shopinfo.shopid", "shopinfo.shoptype","shopinfo.shopnameth","shopinfo.shopnameeng","shopinfo.shoplogoimage")
            .select("shopinfo.shopid", "shopinfo.shoptype","shopinfo.shopnameth","shopinfo.shopnameeng","shopinfo.shoplogoimage")
            .count("orderinfo.orderid as countorder","shopinfo.shopid")
            .orderBy("countorder", "desc")
            .limit(10)
            // .orderBy("orderinfo.orderid", "desc")

            const popular_stores = result_popular_stores.map((item) => {
                return {
                    shopid: item.shopid,
                    shopnameth: item.shopnameth,
                    shopnameeng: item.shopnameeng,
                    shoplogoimage: item.shoplogoimage,
                    countorder: item.countorder,
                };
            });

            
            const result_best_selling_store = await db("orderdetail")
            .join("productinfo", "productinfo.productid", "orderdetail.productid")
            .join("orderinfo", "orderinfo.orderid", "orderdetail.orderid")
            // .join("shopinfo", "shopinfo.shopid", "productinfo.shopid")
            .where("orderinfo.ordertimestamp", ">=", startOfDayTimestamp)
            .andWhere("orderinfo.ordertimestamp", "<", startOfNextDayTimestamp)
            .andWhere("orderinfo.orderispay",">" ,0)
            .andWhere("orderinfo.status", true)
            .groupBy("productinfo.productid" ,"productinfo.productnameth")
            .select("productinfo.productid" ,"productinfo.productnameth")
            // .having("shopinfo.shopnameth", "like", "%ร้าน%")
            .count("orderdetail.qty as totalitem")
            .orderBy("totalitem", "desc")
            .limit(10)

            const best_selling_store = result_best_selling_store.map((item) => {
                return {
                    productid: item.productid,
                    product: item.productnameth,
                    totalitem: item.totalitem,
                };
            });

            const result_shoplist = await db("shopinfo")
            .join("orderinfo", "orderinfo.shopid", "shopinfo.shopid")
            // .join("orderdetail", "orderdetail.orderid", "orderinfo.orderid")
            .where("orderinfo.ordertimestamp", ">=", startOfDayTimestamp)
            .andWhere("orderinfo.ordertimestamp", "<", startOfNextDayTimestamp)
            .andWhere("orderinfo.orderispay",">" ,0)
            .andWhere("orderinfo.status", true)
            .groupBy("shopinfo.shopid", "shopinfo.shoptype","shopinfo.shopnameth","shopinfo.shopnameeng","shopinfo.shoplogoimage")
            .select("shopinfo.shopid", "shopinfo.shoptype","shopinfo.shopnameth","shopinfo.shopnameeng","shopinfo.shoplogoimage")
            .sum("orderinfo.orderpricenet as totalprice")
            .count("orderinfo.orderid as countorder")
            .orderBy("countorder", "desc")

            const shoplist = result_shoplist.map((item) => {
                return {
                    shopid: item.shopid,
                    shoptype: item.shoptype,
                    shopnameth: item.shopnameth,
                    shopnameeng: item.shopnameeng,
                    totalprice: item.totalprice,
                    countorder: item.countorder
                };
            });


            // ส่งผลลัพธ์กลับไปในรูปแบบ object
            resolve({ 
                totalprice: totalprice,
                totalitem: totalitem,
                popular_stores: popular_stores,
                best_selling_store: best_selling_store,
                shoplist: shoplist
            });
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([dashboardtotallistLogic, timeoutPromise])
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

// dashboard total
exports.dashboardtotal = (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const dashboardtotallistLogic = new Promise(async (resolve, reject) => {
        try {

            await validateApiKey(req); // ตรวจสอบ API key

            await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

            let period = req.query.period || "today"; // ค่าที่เป็นไปได้: "today", "thisweek", "thismonth", "thisyear"

            let startTimestamp;
            let endTimestamp;
            const now = new Date(); // รับวันที่และเวลาปัจจุบัน *เมื่อโค้ดทำงาน*

            // --- คำนวณ timestamp เริ่มต้นและสิ้นสุดตามช่วงเวลา (period) ---

            if (period === "thisyear") {
                // จุดเริ่มต้นของปีปัจจุบัน (1 มกราคม, 00:00:00)
                const startOfYear = new Date(now.getFullYear(), 0, 1); // เดือนเป็นแบบ 0-indexed (0 = มกราคม)
                startOfYear.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfYear.getTime() / 1000);

                // จุดเริ่มต้นของปีถัดไป (1 มกราคม ของปีถัดไป, 00:00:00)
                const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1);
                startOfNextYear.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextYear.getTime() / 1000);

            } else if (period === "thismonth") {
                // จุดเริ่มต้นของเดือนปัจจุบัน (วันที่ 1, 00:00:00)
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                startOfMonth.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfMonth.getTime() / 1000);

                // จุดเริ่มต้นของเดือนถัดไป (วันที่ 1 ของเดือนถัดไป, 00:00:00)
                const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1); // JS จัดการการเปลี่ยนเดือน/ปีอัตโนมัติ
                startOfNextMonth.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextMonth.getTime() / 1000);

            } else if (period === "thisweek") {
                // จุดเริ่มต้นของสัปดาห์ปัจจุบัน (สมมติว่าวันอาทิตย์เป็นวันแรก, วันที่ 0)
                const currentDayOfWeek = now.getDay(); // 0 สำหรับวันอาทิตย์, 1 สำหรับวันจันทร์, ..., 6 สำหรับวันเสาร์
                const startOfWeek = new Date(now); // สร้างสำเนา
                startOfWeek.setDate(now.getDate() - currentDayOfWeek); // ย้อนกลับไปหาวันอาทิตย์ล่าสุด
                startOfWeek.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfWeek.getTime() / 1000);

                // จุดเริ่มต้นของสัปดาห์ถัดไป (วันอาทิตย์หน้า, 00:00:00)
                const startOfNextWeek = new Date(startOfWeek);
                startOfNextWeek.setDate(startOfWeek.getDate() + 7); // เพิ่ม 7 วัน
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(startOfNextWeek.getTime() / 1000);

            } else { // กรณีเริ่มต้น, รวมถึง period === "today"
                // จุดเริ่มต้นของวันนี้ (00:00:00)
                const today = new Date(now); // สร้างสำเนา
                today.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(today.getTime() / 1000);

                // จุดเริ่มต้นของวันพรุ่งนี้ (00:00:00)
                const tomorrow = new Date(today);
                tomorrow.setDate(today.getDate() + 1);
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(tomorrow.getTime() / 1000);
            }

            // console.log("startTimestamp:", startTimestamp);
            // console.log("endTimestamp:", endTimestamp);

            // --- ส่วนนี้คือการ Query ข้อมูลจากฐานข้อมูล ---
            // คำนวณผลรวมของ 'ordertotalprice' และตั้งชื่อผลลัพธ์เป็น 'totalprice'
            const result_totalprice = await db("orderinfo") // เลือกตาราง 'orderinfo'
            .sum("ordertotalprice as totalprice") // คำนวณผลรวมของคอลัมน์ 'ordertotalprice' และตั้งชื่อผลลัพธ์ว่า 'totalprice'
            // กรองข้อมูลเฉพาะรายการที่ 'ordertimestamp' อยู่ภายในวันนี้
            .where("ordertimestamp", ">=", startTimestamp) // เลือกรายการที่ timestamp มากกว่าหรือเท่ากับจุดเริ่มต้นของวันนี้
            .andWhere("ordertimestamp", "<", endTimestamp) // และ timestamp น้อยกว่าจุดเริ่มต้นของวันพรุ่งนี้
            .andWhere("orderispay", ">", 0)
            .andWhere("status", true)
            .first(); // ดึงผลลัพธ์เพียงแถวเดียว (sum จะคืนค่า array ที่มี object เดียว)

            // จัดการกรณีที่ไม่มีข้อมูลสำหรับวันนี้ (ผลรวมอาจเป็น null)
            const totalprice = result_totalprice && result_totalprice.totalprice ? Number(result_totalprice.totalprice) : 0; // ถ้ามีผลลัพธ์และ totalprice ไม่ใช่ null ให้แปลงเป็นตัวเลข, มิฉะนั้นให้เป็น 0

            const result_totalitem = await db("orderdetail") // เลือกตาราง 'orderdetail'
            .sum("orderdetail.qty as totalitem") // คำนวณผลรวมของคอลัมน์ 'qty' และตั้งชื่อผลลัพธ์ว่า 'totalitem'
            .join("orderinfo", "orderinfo.orderid", "orderdetail.orderid")
            // กรองข้อมูลเฉพาะรายการที่ 'ordertimestamp' อยู่ภายในวันนี้
            .where("orderinfo.ordertimestamp", ">=", startTimestamp) // เลือกรายการที่ timestamp มากกว่าหรือเท่ากับจุดเริ่มต้นของวันนี้
            .andWhere("orderinfo.ordertimestamp", "<", endTimestamp) // และ timestamp น้อยกว่าจุดเริ่มต้นของวันพรุ่งนี้
            .first(); 

            const totalitem = result_totalitem && result_totalitem.totalitem ? Number(result_totalitem.totalitem) : 0;

            // ส่งผลลัพธ์กลับไปในรูปแบบ object
            resolve({ 
                totalprice: totalprice,
                totalitem: totalitem,
            });
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([dashboardtotallistLogic, timeoutPromise])
    .then((result) => {
        res.status(200).json(result);
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
}

// dashboard popular store
exports.dashboardpopularstore = (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const dashboardtotallistLogic = new Promise(async (resolve, reject) => {
        try {

            await validateApiKey(req); // ตรวจสอบ API key

            await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

            let period = req.query.period || "today"; // ค่าที่เป็นไปได้: "today", "thisweek", "thismonth", "thisyear"

            let startTimestamp;
            let endTimestamp;
            const now = new Date(); // รับวันที่และเวลาปัจจุบัน *เมื่อโค้ดทำงาน*

            // --- คำนวณ timestamp เริ่มต้นและสิ้นสุดตามช่วงเวลา (period) ---

            if (period === "thisyear") {
                // จุดเริ่มต้นของปีปัจจุบัน (1 มกราคม, 00:00:00)
                const startOfYear = new Date(now.getFullYear(), 0, 1); // เดือนเป็นแบบ 0-indexed (0 = มกราคม)
                startOfYear.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfYear.getTime() / 1000);

                // จุดเริ่มต้นของปีถัดไป (1 มกราคม ของปีถัดไป, 00:00:00)
                const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1);
                startOfNextYear.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextYear.getTime() / 1000);

            } else if (period === "thismonth") {
                // จุดเริ่มต้นของเดือนปัจจุบัน (วันที่ 1, 00:00:00)
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                startOfMonth.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfMonth.getTime() / 1000);

                // จุดเริ่มต้นของเดือนถัดไป (วันที่ 1 ของเดือนถัดไป, 00:00:00)
                const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1); // JS จัดการการเปลี่ยนเดือน/ปีอัตโนมัติ
                startOfNextMonth.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextMonth.getTime() / 1000);

            } else if (period === "thisweek") {
                // จุดเริ่มต้นของสัปดาห์ปัจจุบัน (สมมติว่าวันอาทิตย์เป็นวันแรก, วันที่ 0)
                const currentDayOfWeek = now.getDay(); // 0 สำหรับวันอาทิตย์, 1 สำหรับวันจันทร์, ..., 6 สำหรับวันเสาร์
                const startOfWeek = new Date(now); // สร้างสำเนา
                startOfWeek.setDate(now.getDate() - currentDayOfWeek); // ย้อนกลับไปหาวันอาทิตย์ล่าสุด
                startOfWeek.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfWeek.getTime() / 1000);

                // จุดเริ่มต้นของสัปดาห์ถัดไป (วันอาทิตย์หน้า, 00:00:00)
                const startOfNextWeek = new Date(startOfWeek);
                startOfNextWeek.setDate(startOfWeek.getDate() + 7); // เพิ่ม 7 วัน
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(startOfNextWeek.getTime() / 1000);

            } else { // กรณีเริ่มต้น, รวมถึง period === "today"
                // จุดเริ่มต้นของวันนี้ (00:00:00)
                const today = new Date(now); // สร้างสำเนา
                today.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(today.getTime() / 1000);

                // จุดเริ่มต้นของวันพรุ่งนี้ (00:00:00)
                const tomorrow = new Date(today);
                tomorrow.setDate(today.getDate() + 1);
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(tomorrow.getTime() / 1000);
            }

            // --- ส่วนนี้คือการ Query ข้อมูลจากฐานข้อมูล ---
            const result_popular_stores = await db("orderinfo")
            .join("shopinfo", "shopinfo.shopid", "orderinfo.shopid")
            .where("orderinfo.ordertimestamp", ">=", startTimestamp)
            .andWhere("orderinfo.ordertimestamp", "<", endTimestamp)
            .andWhere("orderinfo.orderispay",">" ,0)
            .andWhere("orderinfo.status", true)
            .groupBy("shopinfo.shopid", "shopinfo.shoptype","shopinfo.shopnameth","shopinfo.shopnameeng","shopinfo.shoplogoimage")
            .select("shopinfo.shopid", "shopinfo.shoptype","shopinfo.shopnameth","shopinfo.shopnameeng","shopinfo.shoplogoimage")
            .count("orderinfo.orderid as countorder","shopinfo.shopid")
            .orderBy("countorder", "desc")
            .limit(10);
            // .orderBy("orderinfo.orderid", "desc")

            const popular_stores = result_popular_stores.map((item) => {
                return {
                    shopid: item.shopid,
                    shopnameth: item.shopnameth,
                    shopnameeng: item.shopnameeng,
                    shoplogoimage: item.shoplogoimage,
                    countorder: item.countorder,
                };
            });

            // ส่งผลลัพธ์กลับไปในรูปแบบ object
            resolve({ 
                popular_stores: popular_stores,
            });
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([dashboardtotallistLogic, timeoutPromise])
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

// dashboard best_selling_store
exports.dashboardbestsellingstore = (req, res) => {
    
    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const dashboardtotallistLogic = new Promise(async (resolve, reject) => {
        try {

            await validateApiKey(req); // ตรวจสอบ API key

            await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

            let period = req.query.period || "today"; // ค่าที่เป็นไปได้: "today", "thisweek", "thismonth", "thisyear"

            let startTimestamp;
            let endTimestamp;
            const now = new Date(); // รับวันที่และเวลาปัจจุบัน *เมื่อโค้ดทำงาน*

            // --- คำนวณ timestamp เริ่มต้นและสิ้นสุดตามช่วงเวลา (period) ---

            if (period === "thisyear") {
                // จุดเริ่มต้นของปีปัจจุบัน (1 มกราคม, 00:00:00)
                const startOfYear = new Date(now.getFullYear(), 0, 1); // เดือนเป็นแบบ 0-indexed (0 = มกราคม)
                startOfYear.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfYear.getTime() / 1000);

                // จุดเริ่มต้นของปีถัดไป (1 มกราคม ของปีถัดไป, 00:00:00)
                const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1);
                startOfNextYear.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextYear.getTime() / 1000);

            } else if (period === "thismonth") {
                // จุดเริ่มต้นของเดือนปัจจุบัน (วันที่ 1, 00:00:00)
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                startOfMonth.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfMonth.getTime() / 1000);

                // จุดเริ่มต้นของเดือนถัดไป (วันที่ 1 ของเดือนถัดไป, 00:00:00)
                const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1); // JS จัดการการเปลี่ยนเดือน/ปีอัตโนมัติ
                startOfNextMonth.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextMonth.getTime() / 1000);

            } else if (period === "thisweek") {
                // จุดเริ่มต้นของสัปดาห์ปัจจุบัน (สมมติว่าวันอาทิตย์เป็นวันแรก, วันที่ 0)
                const currentDayOfWeek = now.getDay(); // 0 สำหรับวันอาทิตย์, 1 สำหรับวันจันทร์, ..., 6 สำหรับวันเสาร์
                const startOfWeek = new Date(now); // สร้างสำเนา
                startOfWeek.setDate(now.getDate() - currentDayOfWeek); // ย้อนกลับไปหาวันอาทิตย์ล่าสุด
                startOfWeek.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfWeek.getTime() / 1000);

                // จุดเริ่มต้นของสัปดาห์ถัดไป (วันอาทิตย์หน้า, 00:00:00)
                const startOfNextWeek = new Date(startOfWeek);
                startOfNextWeek.setDate(startOfWeek.getDate() + 7); // เพิ่ม 7 วัน
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(startOfNextWeek.getTime() / 1000);

            } else { // กรณีเริ่มต้น, รวมถึง period === "today"
                // จุดเริ่มต้นของวันนี้ (00:00:00)
                const today = new Date(now); // สร้างสำเนา
                today.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(today.getTime() / 1000);

                // จุดเริ่มต้นของวันพรุ่งนี้ (00:00:00)
                const tomorrow = new Date(today);
                tomorrow.setDate(today.getDate() + 1);
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(tomorrow.getTime() / 1000);
            }

            // --- ส่วนนี้คือการ Query ข้อมูลจากฐานข้อมูล ---
            const result_best_selling_store = await db("orderdetail")
            .join("productinfo", "productinfo.productid", "orderdetail.productid")
            .join("orderinfo", "orderinfo.orderid", "orderdetail.orderid")
            // .join("shopinfo", "shopinfo.shopid", "productinfo.shopid")
            .where("orderinfo.ordertimestamp", ">=", startTimestamp)
            .andWhere("orderinfo.ordertimestamp", "<", endTimestamp)
            .andWhere("orderinfo.orderispay",">" ,0)
            .andWhere("orderinfo.status", true)
            .groupBy("productinfo.productid" ,"productinfo.productnameth")
            .select("productinfo.productid" ,"productinfo.productnameth")
            // .having("shopinfo.shopnameth", "like", "%ร้าน%")
            .count("orderdetail.qty as totalitem")
            .orderBy("totalitem", "desc")
            .limit(10);

            const best_selling_store = result_best_selling_store.map((item) => {
                return {
                    productid: item.productid,
                    product: item.productnameth,
                    totalitem: item.totalitem,
                };
            });


            // ส่งผลลัพธ์กลับไปในรูปแบบ object
            resolve({ 
                best_selling_store: best_selling_store,

            });
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([dashboardtotallistLogic, timeoutPromise])
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

// dashboard shoplist
exports.dashboardshoplist = (req, res) => {

    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const dashboardtotallistLogic = new Promise(async (resolve, reject) => {
        try {

            await validateApiKey(req); // ตรวจสอบ API key

            await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

            let period = req.query.period || "today"; // ค่าที่เป็นไปได้: "today", "thisweek", "thismonth", "thisyear"

            let startTimestamp;
            let endTimestamp;
            const now = new Date(); // รับวันที่และเวลาปัจจุบัน *เมื่อโค้ดทำงาน*

            // --- คำนวณ timestamp เริ่มต้นและสิ้นสุดตามช่วงเวลา (period) ---

            if (period === "thisyear") {
                // จุดเริ่มต้นของปีปัจจุบัน (1 มกราคม, 00:00:00)
                const startOfYear = new Date(now.getFullYear(), 0, 1); // เดือนเป็นแบบ 0-indexed (0 = มกราคม)
                startOfYear.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfYear.getTime() / 1000);

                // จุดเริ่มต้นของปีถัดไป (1 มกราคม ของปีถัดไป, 00:00:00)
                const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1);
                startOfNextYear.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextYear.getTime() / 1000);

            } else if (period === "thismonth") {
                // จุดเริ่มต้นของเดือนปัจจุบัน (วันที่ 1, 00:00:00)
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                startOfMonth.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfMonth.getTime() / 1000);

                // จุดเริ่มต้นของเดือนถัดไป (วันที่ 1 ของเดือนถัดไป, 00:00:00)
                const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1); // JS จัดการการเปลี่ยนเดือน/ปีอัตโนมัติ
                startOfNextMonth.setHours(0, 0, 0, 0);
                endTimestamp = Math.floor(startOfNextMonth.getTime() / 1000);

            } else if (period === "thisweek") {
                // จุดเริ่มต้นของสัปดาห์ปัจจุบัน (สมมติว่าวันอาทิตย์เป็นวันแรก, วันที่ 0)
                const currentDayOfWeek = now.getDay(); // 0 สำหรับวันอาทิตย์, 1 สำหรับวันจันทร์, ..., 6 สำหรับวันเสาร์
                const startOfWeek = new Date(now); // สร้างสำเนา
                startOfWeek.setDate(now.getDate() - currentDayOfWeek); // ย้อนกลับไปหาวันอาทิตย์ล่าสุด
                startOfWeek.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(startOfWeek.getTime() / 1000);

                // จุดเริ่มต้นของสัปดาห์ถัดไป (วันอาทิตย์หน้า, 00:00:00)
                const startOfNextWeek = new Date(startOfWeek);
                startOfNextWeek.setDate(startOfWeek.getDate() + 7); // เพิ่ม 7 วัน
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(startOfNextWeek.getTime() / 1000);

            } else { // กรณีเริ่มต้น, รวมถึง period === "today"
                // จุดเริ่มต้นของวันนี้ (00:00:00)
                const today = new Date(now); // สร้างสำเนา
                today.setHours(0, 0, 0, 0);
                startTimestamp = Math.floor(today.getTime() / 1000);

                // จุดเริ่มต้นของวันพรุ่งนี้ (00:00:00)
                const tomorrow = new Date(today);
                tomorrow.setDate(today.getDate() + 1);
                // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
                endTimestamp = Math.floor(tomorrow.getTime() / 1000);
            }

            // --- ส่วนนี้คือการ Query ข้อมูลจากฐานข้อมูล ---
            const result_shoplist = await db("shopinfo")
            .join("orderinfo", "orderinfo.shopid", "shopinfo.shopid")
            // .join("orderdetail", "orderdetail.orderid", "orderinfo.orderid")
            .where("orderinfo.ordertimestamp", ">=", startTimestamp)
            .andWhere("orderinfo.ordertimestamp", "<", endTimestamp)
            .andWhere("orderinfo.orderispay",">" ,0)
            .andWhere("orderinfo.status", true)
            .groupBy("shopinfo.shopid", "shopinfo.shoptype","shopinfo.shopnameth","shopinfo.shopnameeng")
            .select("shopinfo.shopid", "shopinfo.shoptype","shopinfo.shopnameth","shopinfo.shopnameeng")
            .sum("orderinfo.ordertotalprice as totalprice")
            .count("orderinfo.orderid as countorder")
            .orderBy("countorder", "desc")

            const shoplist = result_shoplist.map((item) => {
                return {
                    shopid: item.shopid,
                    shoptype: item.shoptype,
                    shopnameth: item.shopnameth,
                    shopnameeng: item.shopnameeng,
                    totalprice: item.totalprice,
                    countorder: item.countorder
                };
            });


            // ส่งผลลัพธ์กลับไปในรูปแบบ object
            resolve({ 
                shoplist: shoplist
            });
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([dashboardtotallistLogic, timeoutPromise])
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