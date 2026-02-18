const {db} = require("../../db/postgresql");
const fs = require("fs");
const date = require("date-and-time");
const { uuid } = require("uuidv4");
const multer = require("multer");
const path = require("path");
// const { console } = require("inspector");
const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT

const {convertTotimestamp} = require("../../modules/convertTotimestamp");

const {
    checkAuthorizetion,
    eventlog, 
    notification,
    handleError,
    validateApiKey,
    checkString,
} = require("../../modules/fun");

require("dotenv").config();

const timeout = 60000; // Timeout in milliseconds (e.g., 60 seconds)

// exports shop
exports.exportshop = async (req, res) => {
    
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const exportshopLogic = new Promise(async (resolve, reject) => {

        try {

            // Validate API key
            await validateApiKey(req);

            await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

            const { ugroupid, shoptype } = req.body;

            // if(selectshop === "group"){

            if (!ugroupid) {
                return reject({ status: 400, message: "Invalid request" });
            }
            // }else if(selectshop === "getall"){
                
            // }else{

            //     return reject({ status: 400, message: "Invalid request" });

            // }

            const shoplist = await db("shopinfo")
            .select("*")
            .where({ ugroupid: ugroupid,shoptype:shoptype })
            // .where(function () {
                
            //     if (selectshop === "group") {
            //         this.where({ ugroupid: ugroupid,shoptype:shoptype });
            //     }else{
            //         this.where(true);
            //     }
            // })

            const shopresult = shoplist.map((shop) => {
                return {
                    ...shop,
                    shopexpiredate: date.format(new Date(shop.shopexpiredate), "YYYY-MM-DD"),
                };
            });

            resolve({
                total: shopresult.length,
                result: shopresult,
            });
        
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([exportshopLogic, timeoutPromise])
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

}

// Create multiple shops (batch create) with timeout
exports.shopcreateMultiple = async (req, res) => {

    // Define the timeoutPromise
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), timeout)
    );
    
    const multipleShopsLogic = new Promise(async (resolve, reject) => {
        try {

            // Validate API key and authorization for the whole batch request
            await validateApiKey(req);
            await checkAuthorizetion(req);

            const shops = req.body.shops;

            if (!Array.isArray(shops) || shops.length === 0) {
                return reject({ status: 400, message: "No shops provided" });
            }

            // console.log("shops -->",shops);

            // Begin transaction for batch creation
            await db.transaction(async (trx) => {

                // ตรวจสอบความถูกต้องของข้อมูล
                for (const shop of shops) {

                    // Basic validations for required fields
                    if (!checkString(shop.shopid)) {
                        return reject ({ status: 400, message: `Invalid shopid or merid for shop` });
                    }
                    
                    if (!shop.shoptype || !shop.shopnameth || !shop.shopnameeng) {
                        return reject ({ status: 400, message: `Missing required fields in shop` });
                    }

                    if (isNaN(Date.parse(`1970-01-01 ${shop.shopopentime}`))) {
                        return reject ({ status: 402, message: `shopopentime format invalid in shop` });
                    }

                    if (isNaN(Date.parse(`1970-01-01 ${shop.shopclosetime}`))) {
                        return reject ({ status: 402, message: `shopclosetime format invalid in shop` });
                    }

                    if (isNaN(Date.parse(shop.shopexpiredate))) {
                        return reject ({ status: 402, message: `shopexpiredate format invalid in shop` });
                    }

                    // Check if the shopid already exists
                    const existingShop = await trx("shopinfo").where({ ugroupid: shop.ugroupid })
                    if (existingShop > 0) {
                        return resolve({ status: 202, message: `ugroupid not found` });
                    }
                }

                // บันทึกข้อมูลในฐานข้อมูล
                for (const shop of shops) {

                    // Use provided logo path or default placeholder
                    let logoPath = shop.logoPath || "uploads/imageplacehold.png";

                    const Newshopid = uuid();

                    // Insert shop info row
                    await trx("shopinfo").insert({
                        shopid: Newshopid,
                        ugroupid: shop.ugroupid,
                        shoptype: shop.shoptype,
                        shopnameth: shop.shopnameth,
                        shopnameeng: shop.shopnameeng,
                        shopopentime: shop.shopopentime,
                        shopclosetime: shop.shopclosetime,
                        shopexpiredate: date.format(new Date(shop.shopexpiredate), "YYYY-MM-DD"),
                        shopdata1: shop.shopdata1,
                        shopdata2: shop.shopdata2,
                        apikey: '494eabae-b0f7-4d0d-a436-5af39c3abf62',
                        shoplogoimage: logoPath,
                    });

                    // Create shop slots
                    let startTime = 946688400000; // Example start time (in ms)
                    let endTime = 946690200000;   // Example end time (in ms)
                    const interval = 30 * 60 * 1000; // 30 minutes per slot
                    const endTimeLimit = 946731600000; // Example end time limit

                    while (startTime < endTimeLimit) {
                        await trx("shopslot").insert({
                            slotid: uuid(),
                            shopid: Newshopid,
                            slotremark: shop.slot || "-",
                            slottimestart: startTime,
                            slottimeend: endTime,
                            slotsremaining: shop.slotcapacity || 999,
                            slotcapacity: shop.slotcapacity || 999,
                        });
                        startTime += interval;
                        endTime += interval;
                    }
                }
            });

            
            
            resolve({ message: "Multiple shops created successfully" });
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([multipleShopsLogic, timeoutPromise])
    .then(async(result) => {
        
        if(!result.status){
            // Log event and send notification if required
            await eventlog(req, "นำเข้าข้อมูลรายการร้านค้าจากไฟล์ CSV");
            await notification(req, 'ร้านค้า', `นำเข้าข้อมูลรายการร้านค้าจากไฟล์ CSV`);
        }


        if (result.status) {

            res.status(result.status).json({ message: result.message });
            
        } else {
            res.send(result);
        }
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

// export products
exports.exportproducts = async (req, res) => {
    
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const exportproductsLogic = new Promise(async (resolve, reject) => {

        try {

            // Validate API key
            await validateApiKey(req);

            await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

            const { shopid , productCgtyId, selectproduct } = req.body;

            // if(selectproduct === "shop"){

                if (!shopid || !checkString(shopid)) {
                    return reject({ status: 400, message: "Invalid request" });
                }

                if (!productCgtyId) {
                    return reject({ status: 402, message: "productCgtyId not request" });
                }

                await db("productinfo")
                .select("*")
                .where({ shopid ,productCgtyId})
                .then((result) => {
                    resolve({
                        total: result.length,
                        result: result,
                    });
                })

            // }else if(selectproduct === "getall"){
                
            //     await db("productinfo")
            //     .select("*")
            //     .then((result) => {
            //         resolve(result);
            //     })
                
            // }else{
            //     return reject({ status: 400, message: "Invalid request" });
            // }
            
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([exportproductsLogic, timeoutPromise])
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
}

// create product
exports.productcreateMultiple = async (req, res) => {
    
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const productcreateMultipleLogic = new Promise(async (resolve, reject) => {

        try {
            // Validate API key
            await validateApiKey(req);

            await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

            const { products } = req.body;

            // console.log(req.body);
            // console.log(req.body.products);

            if (!Array.isArray(products) || products.length === 0) {
                return reject({ status: 400, message: "No products provided" });
            }

            const imagePath = "uploads/imageplacehold.png";

            await db.transaction(async (trx) => {

                // ตรวจสอบข้อมูลที่จำเป็น
                for (const product of products) {

                    if (!product.shopid || !checkString(product.shopid)) {
            
                        return reject({ status: 400, message: "Invalid request" });
                    }
            
                    if (!product.productnameth) {
                        return reject({ status: 402, message: "Not productnameth" });
                    }
            
                    if (!product.productnameeng) {
                        return reject({ status: 402, message: "Not productnameeng" });
                    }
            
                    if (product.productprice === undefined) {
                        return reject({ status: 402, message: "Not productprice" });
                    }
            
                    if (typeof Number(product.productprice) !== "number") {
                        return reject({ status: 402, message: "productprice must be a number" });
                    }

                    if (product.productremain === undefined) {
                        return reject({ status: 402, message: "Not productremain" });
                    }
            
                    if (typeof Number(product.productremain) !== "number") {
                        return reject({ status: 402, message: "productremain must be a number" });
                    }
            
                    const db_shopid = await db
                    .select("shopid")
                    .from("shopinfo")
                    .where({ shopid: product.shopid });
                    
                    if (!db_shopid.length) {
                        return reject({ status: 402, message: "shopid not found" });
                    }
                }

                // บันทึกข้อมูล
                for (const product of products) {

                    await trx("productinfo").insert({
                        productid: uuid(),
                        shopid: product.shopid,
                        productCgtyId : product.productCgtyId || "0",
                        productnameth : product.productnameth,
                        productnameeng : product.productnameeng,
                        productdatath : product.productdatath || "",
                        productdataeng : product.productdataeng || "",
                        productprice: Number(product.productprice) || 0,
                        uomtext: "ชิ้น",
                        productimage: imagePath, // เก็บ path ของไฟล์ที่อัปโหลด
                        productremain: Number(product.productremain) || 0
                    });
                }
            });

            
            
            resolve({ message: "Multiple products created successfully" });
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([productcreateMultipleLogic, timeoutPromise])
    .then(async(result) => {

        if(!result.status){
            // Log event and send notification if required
            await eventlog(req, "นำเข้าข้อมูลรายการสินค้าจากไฟล์ CSV");
            await notification(req, 'สินค้า', `นำเข้าข้อมูลรายการสินค้าจากไฟล์ CSV`);
        }

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

// exports users
exports.exportusers = async (req, res) => {
    
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const exportusersLogic = new Promise(async (resolve, reject) => {

        try {

            // Validate API key
            await validateApiKey(req);

            await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

            // const { shopid , ugroupid } = req.body;

            const shopid = req.body.shopid || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา

            const ugroupid = req.body.ugroupid || ""; // ค่าเริ่มต้นคือไม่มีคำค้นหา


            await db("userinfo")
            .select("*")
            // .where({ shopid , ugroupid})
            
            .where(function () {
                
                if(shopid == "" && ugroupid == ""){ // ดึงข้อมูลกลุ่มผู้ใช้และร้านค้าทั้งหมด

                    this.whereNot('ugroupid','=','0')
                    .andWhereNot('shopid','=','0')

                }else if(shopid == ""){ // ดึงข้อมูลร้านค้าทั้งหมด ตามกลุ่มผู้ใช้

                    this.where('ugroupid','=',ugroupid)

                }else if(ugroupid == "0" || shopid == "0"){ // ดึงข้อมูลผู้ดูแลระบบ

                    this.where('ugroupid','=',ugroupid)
                    .andWhere('shopid','=',shopid)
                    
                }else{ // ดึงข้อมูลร้านค้า ตามกลุ่มผู้ใช้

                    this.where('ugroupid','=',ugroupid)
                    .andWhere('shopid','=',shopid)
                }
            })
            .then((result) => {

                resolve({
                    total: result.length,
                    result: result
                });
            
            });
        
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([exportusersLogic, timeoutPromise])
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

}

// import users
exports.usercreateMultiple = async (req, res) => {
    
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), timeout)
    );

    const usercreateMultipleLogic = new Promise(async (resolve, reject) => {

        try {
            // Validate API key
            await validateApiKey(req);

            await checkAuthorizetion(req); // ตรวจสอบสิทธิ์การใช้งาน

            const { users } = req.body;

            if (!Array.isArray(users) || users.length === 0) {
                return reject({ status: 400, message: "No users provided" });
            }

            await db.transaction(async (trx) => {

                // ตรวจสอบข้อมูลที่จำเป็น
                for (const user of users) {

                    // ตรวจสอบข้อมูลที่จำเป็น
                    if (!user.uinfologinname || !user.uinfologinpass ) {
                        return resolve({ status: 202, message: "Invalid request" });
                    }

                    // ตรวจสอบว่า `uinfologinname` ซ้ำหรือไม่
                    const existingUser = await trx("userinfo")
                    .select("uinfologinname")
                    .where({ uinfologinname: user.uinfologinname });

                    if (existingUser.length > 0) {
                        return resolve({
                            status: 203,
                            message: "uinfologinname already exists",
                        });
                    }

                    // ตรวจสอบว่า `uinfoemail` ซ้ำหรือไม่
                    const existingEmail = await db("userinfo")
                    .select("uinfoemail")
                    .where({ uinfoemail: user.uinfoemail });

                    if (existingEmail.length > 0) {
                        return resolve({
                            status: 204,
                            message: "uinfoemail already exists",
                        });
                    }

                    if(user.shopid){
                    // ตรวจสอบว่า `shopid` มีอยู่ในฐานข้อมูลหรือไม่
                        const shopExists = await trx("shopinfo")
                        .select("shopid")
                        .where({ shopid: user.shopid });

                    if (shopExists.length === 0 && user.shopid !== "0") {
                        return resolve({

                            status: 205,
                            message: "shopid not found",

                            });
                        }
                    }

                    // ตรวจสอบว่า `ugroupid` มีอยู่ในฐานข้อมูลหรือไม่
                    if (user.ugroupid !== null  && user.ugroupid !== undefined && user.ugroupid !== "") {
                        const groupExists = await trx("usergroup")
                        .select("ugroupid")
                        .where({ ugroupid: user.ugroupid });

                            if (groupExists.length === 0 && user.ugroupid !== "0") {
                            return resolve({
                                status: 206,
                                message: "ugroupid not found",
                            });
                        }
                    }
                }   

                // บันทึกข้อมูลผู้ใช้ใหม่ลงในฐานข้อมูล
                for (const user of users) {
                    // บันทึกข้อมูลผู้ใช้ใหม่ลงในฐานข้อมูล
                    await trx("userinfo").insert({
                        uinfoid : uuid(),
                        shopid: user.shopid !== "" ? user.shopid : "0" || "0",
                        ugroupid: user.ugroupid !== "" ? user.ugroupid : "0" || "0",
                        uinfologinname: user.uinfologinname,
                        uinfologinpass: user.uinfologinpass,
                        uinfoname: user.uinfoname,
                        level: user.level,
                        uinfoemail: user.uinfoemail,
                        details: user.details,
                        status: user.status,
                        create_at: Math.floor(Date.now() / 1000),
                        update_at: Math.floor(Date.now() / 1000),
                    });
                }
                    
            });

            
            
            
            resolve({ message: "Users created successfully" });
        } catch (error) {
            reject(error);
        }
    });

    Promise.race([usercreateMultipleLogic, timeoutPromise])
    .then(async(result) => {

        if(!result.status){
            // Log event and send notification if required
            await eventlog(req, "นำเข้าข้อมูลรายการผู้ใช้จากไฟล์ CSV");
            await notification(req, 'บัญชีผู้ใช้', `นำเข้าข้อมูลรายการผู้ใช้จากไฟล์ CSV`);
        }

        
        if(result.status){

            res.status(result.status).json({ message: result.message });
        }else{
            res.send(result);
        }
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

