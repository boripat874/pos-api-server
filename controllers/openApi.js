const {db} = require("../db/postgresql");
// const knex = require("knex");
const date = require("date-and-time");
const { uuid } = require("uuidv4");

const {

  checkString,
  validateApiKey,
  handleError,
  eventlogOpenAPI,
  notificationOpenAPI

} = require("../modules/fun"); // ใช้บันทึก log
const { default: th } = require("date-and-time/locale/th");

require("dotenv").config();

const timeout = 60000; // Timeout in milliseconds (e.g., 60 seconds)


//shop list ✓
exports.shoplist = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const shopListLogic = new Promise(async (resolve, reject) => {

    try {

      // Validate API key
      await validateApiKey(req);

      const shoplist = await db.select("*").from("shopinfo");
      let shoplist_data = [];

      shoplist.forEach((element) => {
        shoplist_data.push({
          shopid: element.shopid,
          merid: element.merid,
          shopnameth: element.shopnameth,
          shopnameeng: element.shopnameeng,
        });
      });

      // Add delay before sending the response
      setTimeout(() => {
        resolve({
          total: shoplist_data.length,
          result: shoplist_data,
        });
      }, 10);

      // resolve(
      //   res.send({
      //     total: shoplist_data.length,
      //     result: shoplist_data,
      //   })
      // );
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([shopListLogic, timeoutPromise])
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

//shop detail ✓
exports.shopdetail = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const { shopid } = req.body;

  const shopDetailLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

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
        };
      });

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
        res.status(error.status).json({ message: error.message });
      } else if (error.message === "Request timed out") {
        res.status(402).json({ message: "Request timed out" });
      } else {
        handleError(error, res);
      }
  });
};

//shop detail update ✓
exports.shopdetailupdate = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const {
    shopid,
    shopnameth,
    shopnameeng,
    shopopentime,
    shopclosetime,
    shopexpiredate,
  } = req.body;

  const shopDetailUpdateLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      if (!shopid || !checkString(shopid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      if (!shopnameth) {
        return reject({ status: 402, message: "shopnameth not found" });
      }

      if (!shopnameeng) {
        return reject({ status: 402, message: "shopnameeng not found" });
      }

      if (isNaN(Date.parse(`1970-01-01 ${shopopentime}`))) {
        return reject({ status: 402, message: "shopopentime format Invalid  ex: '08:00'" });
      }

      if (isNaN(Date.parse(`1970-01-01 ${shopclosetime}`))) {
        return reject({ status: 402, message: "shopclosetime format Invalid  ex: '17:00'" });
      }

      if (isNaN(Date.parse(shopexpiredate))) {
        return reject({ status: 402, message: "shopexpiredate format Invalid  ex: '2020-01-01'" });
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
          shopnameth,
          shopnameeng,
          shopopentime,
          shopclosetime,
          shopexpiredate: date.format(new Date(shopexpiredate), "YYYY-MM-DD"),
        });

      resolve({
        shopid,
        message: "Update store detail Success",
      });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([shopDetailUpdateLogic, timeoutPromise])
    .then(async(data) => {

      await eventlogOpenAPI(req, "แก้ไขรายการร้านค้า", "ZooApp"); // บันทึก log
      await notificationOpenAPI(req,'ร้านค้า', `มีการเปลี่ยนแปลงข้อมูลร้านค้า "${shopnameth}"`, "ZooApp"); // notification

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

//product list ✓
exports.productlist = (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );
  const { shopid } = req.body;

  const productListLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

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
        .where({ shopid });

      let productlist_data = [];
      productlist.forEach((element) => {
        productlist_data.push({
          productid: element.productid,
          shopid: element.shopid,
          productnameth: element.productnameth,
          productnameeng: element.productnameeng,
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

//product detail ✓
exports.productdetail = (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const { productid } = req.body;

  const productDetailLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      if (!productid || !checkString(productid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const db_productid = await db
        .select("productid")
        .from("productinfo")
        .where({ productid });

      if (!db_productid.length) {
        return reject({
          status: 402,
          message: `productid not found`,
        });
      }

      const productdetail = await db
        .select("*")
        .from("productinfo")
        .where({ productid });

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

// product create ✓
exports.productcreate = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const {
    productid,
    shopid,
    productnameth,
    productnameeng,
    productdatath,
    productdataeng,
    productprice,
  } = req.body;

  const productCreateLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      if (
        !productid ||
        !shopid ||
        !checkString(shopid) ||
        !checkString(productid)
      ) {
        return reject({ status: 400, message: "Invalid request" });
      }

      if (!productnameth) {
        return reject({ status: 402, message: "Not productnameth" });
      }

      if (!productnameeng) {
        return reject({ status: 402, message: "Not productnameeng" });
      }

      if (productprice === undefined) {
        return reject({ status: 402, message: "Not productprice" });
      }

      if (typeof productprice !== "number") {
        return reject({ status: 402, message: "productprice must be a number" });
      }

      const db_shopid = await db
        .select("shopid")
        .from("shopinfo")
        .where({ shopid });

      if (!db_shopid.length) {
        return reject({ status: 402, message: "shopid not found" });
      }

      const db_productid = await db
        .select("productid")
        .from("productinfo")
        .where({ productid });

      if (db_productid.length) {
        return reject({
          status: 402,
          productid: productid,
          message: "Product ID Dupplicate",
        });
      }

      await db("productinfo").insert({
        productid,
        shopid,
        productnameth,
        productnameeng,
        productdatath,
        productdataeng,
        productprice: Number(productprice),
        uomtext: "ชิ้น",
      });

      resolve({
        productid,
        message: "Create product Success",
      });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([productCreateLogic, timeoutPromise])
    .then(async(data) => {

      await eventlogOpenAPI(req, "เพิ่มรายการสินค้า","ZooApp"); // บันทึก log
      await notificationOpenAPI(req,'สินค้า', `"${productnameth}"`,"ZooApp"); // notification

      res.json(data); // Send the response only once
    })
    .catch((error) => {
      if (error.status) {

        res.status(error.status).json({ 
          productid: productid,
          message: error.message 
        });

      } else if (error.message === "Request timed out") {
        res.status(402).json({ message: "Request timed out" });
      } else {
        handleError(error, res);
      }
    });
};

// product update ✓
exports.productupdate = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const {
    productid,
    shopid,
    productprice,
    productnameth,
    productnameeng,
    productdatath,
    productdataeng,
  } = req.body;

  const productUpdateLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      if (
        !productid ||
        !shopid ||
        !checkString(shopid) ||
        !checkString(productid)
      ) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const db_productid = await db
        .select("productid")
        .from("productinfo")
        .where({ productid });

      if (!db_productid.length) {
        return reject({
          status: 402,
          message: "productid not found",
        });
      }

      const db_shopid = await db
        .select("shopid")
        .from("shopinfo")
        .where({ shopid });

      if (!db_shopid.length) {
        return reject({
          status: 402,
          message: "shopid not found",
        });
      }

      if (typeof productprice !== "number") {
        return reject({
          status: 402,
          message: "productprice must be a number",
        });
      }

      await db("productinfo")
        .where({ productid })
        .update({
          productnameth,
          productnameeng,
          productdatath,
          productdataeng,
          productprice: Number(productprice),
        });

      resolve({
        productid,
        message: "Update product Success",
      });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([productUpdateLogic, timeoutPromise])
    .then(async(data) => {

      await eventlogOpenAPI(req, "แก้ไขรายการสินค้า","ZooApp"); // บันทึก log
      await notificationOpenAPI(req,'สินค้า', `มีการเปลี่ยนแปลงข้อมูลสินค้า "${productnameth}"`,"ZooApp"); // notification
      
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

// product delete ✓
exports.productdelete = (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const productDeleteLogic = new Promise(async (resolve, reject) => {
    try {
      const { productid } = req.body;

      // Validate API key
      await validateApiKey(req);

      if (!productid || !checkString(productid)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      let productname = "This product is not available in the system!";

      const db_productid = await db
        .select("productid")
        .from("productinfo")
        .where({ productid });

      if (!db_productid.length) {

        // return reject({
        //   status: 402,
        //   message: "productid not found",
        // });

      }else{
        productname = db_productid[0].productnameeng;
        await db("productinfo").where({ productid }).del();
      }


      return resolve({
        productid,
        productnameth: productname,
        message: "Delete product Success",
      });

    } catch (error) {
      reject(error);
    }
  });

  Promise.race([productDeleteLogic, timeoutPromise])
    .then(async (data) => {

      await eventlogOpenAPI(req, "ลบรายการสินค้า","ZooApp"); // บันทึก log

      if(data.productnameth = 'This product is not available in the system!'){

        await notificationOpenAPI(req,'สินค้า', `มีการลบข้อมูลสินค้าที่ไม่มีอยู่ในระบบ`,"ZooApp"); // notification

      }else{
        
        await notificationOpenAPI(req,'สินค้า', `มีการลบข้อมูลสินค้า "${data.productnameth}"`,"ZooApp"); // notification
      }
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


// order list ✓
exports.orderlist = (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const { shopid } = req.body;

  const orderListLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

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

      const orderlist = await db
        .select("*")
        .from("orderinfo")
        .where({ shopid });

      let orderlist_data = [];
      orderlist.forEach((element) => {
        orderlist_data.push({
          orderid: element.orderid,
          shopid: element.shopid,
          ordernumber: element.ordernumber,
          ordertype: Number(element.ordertype),
          ordertimestamp: Number(element.ordertimestamp),
          orderstatus: Number(element.orderstatus),
          ordertotalprice: Number(element.ordertotalprice),
          pickupnow: Number(element.pickupnow),
          starttime: element.starttime,
          endtime: element.endtime,
        });
      });

      resolve({
        total: orderlist_data.length,
        result: orderlist_data,
      });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([orderListLogic, timeoutPromise])
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

// order detail ✓
exports.orderdetail = (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const { ordernumber } = req.body;

  const orderDetailLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      if (!ordernumber || !checkString(ordernumber)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const db_ordernumber = await db
        .select("ordernumber")
        .from("orderinfo")
        .where({ ordernumber });

      if (!db_ordernumber.length) {
        return reject({
          status: 402,
          message: "ordernumber not found",
        });
      }

      const orderListDetail = await db
        .select("*")
        .from("orderinfo")
        .where({ ordernumber });

      let orderdetail_data = {};
      orderListDetail.forEach((element) => {
        orderdetail_data = {
          orderid: element.orderid,
          shopid: element.shopid,
          ordernumber: element.ordernumber,
          ordertype: Number(element.ordertype),
          ordertimestamp: element.ordertimestamp,
          orderstatus: Number(element.orderstatus),
          orderpricenet: Number(element.orderpricenet),
          ordertotalprice: Number(element.ordertotalprice),
          ordertotaldiscount: Number(element.ordertotaldiscount),
          pickupnow: Number(element.pickupnow),
          starttime: element.starttime,
          endtime: element.endtime,
          productinorder: [],
        };
      });

      const orderdetail = await db("orderinfo")
        .join("orderdetail", "orderinfo.orderid", "orderdetail.orderid")
        .where({ ordernumber })
        .select();

      orderdetail.forEach((element2) => {
        if (element2.orderid === orderdetail_data.orderid) {
          orderdetail_data.productinorder.push({
            linenumber: element2.odetailid,
            productid: element2.productid,
            qty: Number(element2.qty),
            productprice: Number(element2.productprice),
            remark: element2.odetailremark,
          });
        }
      });

      resolve(orderdetail_data);
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([orderDetailLogic, timeoutPromise])
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

// order create ✓
exports.ordercreate = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const {
    shopid,
    ordertimestamp,
    ordertotalprice,
    ordertotaldiscount,
    productinorder,
    pickupnow,
    ordernumber,
  } = req.body;

  var starttime = req.body.starttime; 
  var endtime = req.body.endtime;

  const orderCreateLogic = new Promise(async (resolve, reject) => {

      try {
  
        // Validate API key
        await validateApiKey(req);

        let countQTY = 0;
  
        if (
          !shopid ||
          !ordernumber ||
          ordertimestamp === undefined ||
          ordertotalprice === undefined ||
          ordertotaldiscount === undefined ||
          !productinorder ||
          !checkString(shopid) ||
          !checkString(ordernumber)
        ) {
          return reject({ status: 400, message: "Invalid request" });
        }
  
        if (typeof ordertimestamp !== "number") {
          return reject({ status: 402, message: "ordertimestamp must be a number" });
        }
  
        if (typeof ordertotalprice !== "number") {
          return reject({ status: 402, message: "ordertotalprice must be a number" });
        }
  
        if (typeof ordertotaldiscount !== "number") {
          return reject({ status: 402, message: "ordertotaldiscount must be a number" });
        }
  
        if (pickupnow !== undefined && typeof pickupnow !== "number") {
  
          return reject({ status: 402, message: "pickupnow must be a number" });
  
        }else if(starttime || endtime){
  
          if (starttime && isNaN(Date.parse(`1970-01-01 ${starttime}`))) {
            return reject({ status: 402, message: "starttime format Invalid" });
          }
    
          if (endtime && isNaN(Date.parse(`1970-01-01 ${endtime}`))) {
            return reject({ status: 402, message: "endtime format Invalid" });
          }
        }else if(pickupnow === undefined && !starttime && !endtime){
          return reject({ status: 402, message: "pickupnow or (starttime , endtime) not found" });
        }

        const db_shopid = await db
          .select("shopid")
          .from("shopinfo")
          .where({ shopid });
  
        if (!db_shopid.length) {
          return reject({ status: 404, message: "shopid not found" });
        }
  
        const db_ordernumber = await db
          .select("ordernumber")
          .from("orderinfo")
          .where({ shopid, ordernumber });
  
        if (db_ordernumber.length) {
          return reject({ status: 402, message: "ordernumber already exists" });
        }

        
  
        for (const element of productinorder) {
          if (!checkString(element.productid)) {
            return reject({ status: 400, message: "Invalid request" });
          }
  
          if (typeof element.linenumber !== "number") {
            return reject({ status: 402, message: "linenumber must be a number" });
          }
  
          if (typeof element.qty !== "number") {
            return reject({ status: 402, message: "qty must be a number" });
          }
  
          if (typeof element.productprice !== "number") {
            return reject({ status: 402, message: "productprice must be a number" });
          }

          countQTY += element.qty;
  
          const db_productid = await db
            .select("productid")
            .from("productinfo")
            .where({ productid: element.productid });
  
          if (!db_productid.length) {
            return reject({
              status: 402,
              message: `Product "${element.productnameeng}" is not in the system!`,
            });
          }
        }
  
        // Convert starttime and endtime to timestamps
        const timeStampStart = Date.parse(`2000-01-01 ${starttime}`);
        const timeStampEnd = Date.parse(`2000-01-01 ${endtime}`);
  
        const dateNow = new Date();
        const hour = dateNow.getHours();
        const minute = dateNow.getMinutes();
        const second = dateNow.getSeconds();
  
        const timeStamp = Date.parse(`2000-01-01 ${hour}:${minute}:${second}`);
  
        // function updateSlot
        const updateSlot = async (slotid, slotsremaining,cqty) => {
          await db("shopslot")
            .where({ slotid })
            .update({ slotsremaining: (Number(slotsremaining) + cqty) });
        };

        // const countSlotcapacity = await db("shopslot")
        // .select("slotcapacity")
        // .where({ slotid })
  
        if( starttime || endtime ){

          if((timeStampEnd < timeStamp)){
            return reject({ status: 402, message: "Slot Full" });
          }
  
          // ดึง slot ของ shop
          const shopslots = await db
          .select("*")
          .from("shopslot")
          .where({ shopid })
          .where("slotsremaining", "<", db.ref("slotcapacity"))
          .where({"shopslot.status": true })
          .where("slottimestart", "=", timeStampStart)
          .where("slottimeend", "=", timeStampEnd)


          if (!shopslots.length) {
            return reject({ status: 402, message: "Slot Full" });
          }else{

            if(Number(shopslots[0].slotsremaining)+countQTY <= Number(shopslots[0].slotcapacity)){

              await updateSlot(shopslots[0].slotid, shopslots[0].slotsremaining, countQTY); // เพิ่ม slot

            }else{
              return reject({ status: 402, message: "Slot Full" });
            }
          }

  
  
        }else{
  
          // ดึง slot ของ shop
          const shopslots = await db
          .select("*")
          .from("shopslot")
          .where({ shopid })
          .where("slotsremaining", "<", db.ref("slotcapacity"))
          .where({"shopslot.status": true })
          .where("slottimestart", "<=", timeStamp)
          .where("slottimeend", ">", timeStamp)
          
          // console.log("shopslots1",shopslots)

          if (!shopslots.length) {
            console.log("shopslots2");
            return reject({ status: 402, message: "Slot Full" });

          }else{

            if(Number(shopslots[0].slotsremaining)+countQTY <= Number(shopslots[0].slotcapacity)){

              // console.log(shopslots)

              starttime = date.format(new Date(shopslots[0].slottimestart), "HH:mm");
              endtime = date.format(new Date(shopslots[0].slottimeend), "HH:mm");

              await updateSlot(shopslots[0].slotid, shopslots[0].slotsremaining, countQTY); // เพิ่ม slot

            }else{
              // console.log("shopslots3")

              return reject({ status: 402, message: "Slot Full" });
            }
          }
        }
        
        const uuid_orderid = uuid();

        const orderdetail_data = productinorder.map((element) => ({
          id: uuid(),
          odetailid: element.linenumber,
          orderid: uuid_orderid,
          productid: element.productid,
          qty: element.qty,
          productprice: element.productprice,
          additional: element.additional,
          odetailremark: element.remark,
        }));
  
        await db("orderinfo").insert({
          orderid: uuid_orderid,
          shopid,
          ordernumber,
          ordertimestamp,
          orderstatus: 0,
          ordertotalprice: Number(ordertotalprice),
          ordertotaldiscount: Number(ordertotaldiscount),
          orderispay: 0,
          pickupnow,
          starttime,
          endtime,
          ordertype: 1,
          
        });
  
        await db("orderdetail").insert(orderdetail_data);
  
        resolve({
          ordernumber,
          message: "Create order Success",
        });
      } catch (error) {
        reject(error);
      }
    });

  Promise.race([orderCreateLogic, timeoutPromise])
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


  //==================================================================================================

  // try {
  //   const {
  //     shopid,
  //     ordertimestamp,
  //     ordertotalprice,
  //     ordertotaldiscount,
  //     productinorder,
  //     pickupnow,
  //     starttime,
  //     endtime
  //   } = req.body;

  //   const ordernumber_ = req.body.ordernumber;

  //   const X_API_KEY = req.headers["x-api-key"];


  //   // check apikey
  //   db.select("apikey")
  //     .from("shopinfo")
  //     .then((apikey) => {
  //       let autihorize = false;

  //       apikey.forEach((element) => {
  //         if (element.apikey == X_API_KEY) {
  //           autihorize = true;
  //         }
  //       });

  //       if (!autihorize) {
  //         // throw new ErrorHandler(401, "Unauthorized");
  //         return res.json(401, {
  //           message: "Unauthorized",
  //         });
  //       }

  //       if (
  //         !shopid ||
  //         !ordernumber_ ||
  //         ordertimestamp == undefined ||
  //         ordertotalprice == undefined ||
  //         ordertotaldiscount == undefined ||
  //         !productinorder ||
  //         !checkString(shopid) ||
  //         !checkString(ordernumber_)
  //       ) {
  //         // console.log(req.body);
  //         // throw new ErrorHandler(400, "Invalid request");
  //         return res.json(400, {
  //           message: "Invalid request",
  //         });
  //       } else if (typeof ordertimestamp != "number") {
  //         return res.json(402, {
  //           message: "ordertimestamp must be a number",
  //         });
  //       } else if (typeof ordertotalprice != "number") {
  //         return res.json(402, {
  //           message: "ordertotalprice must be a number",
  //         });
  //       } else if (typeof ordertotaldiscount != "number") {
  //         return res.json(402, {
  //           message: "ordertotaldiscount must be a number",
  //         });
  //       }
        
  //       if(pickupnow || pickupnow != undefined || pickupnow != null){

  //         if (typeof pickupnow != "number") {
  //           return res.json(402, {
  //             message: "pickupnow must be a number",
  //           });
  //         }

  //       }else if(starttime || endtime){

  //         if (isNaN(Date.parse(`1970-01-01 ${starttime}`))) {
  //           // console.log(`1970-01-01 ${Date.parse(req.body.shopopentime)}`)
  //           // throw new ErrorHandler(402, "shopopentime format Invalid");
  //           return res.json(402, {
  //             message: "starttime format Invalid",
  //           });
  //         } else if (isNaN(Date.parse(`1970-01-01 ${endtime}`))) {
  //           // throw new ErrorHandler(402, "shopclosetime format Invalid");
  //           return res.json(402, {
  //             message: "endtime format Invalid",
  //           });
  //         }
  //       }else{
  //         return res.json(402, {
  //           message: "pickupnow or (starttime , endtime) not found",
  //         });
  //       }


  //       // check shopid
  //       db.select("shopid")
  //         .from("shopinfo")
  //         .where({ shopid: req.body.shopid })
  //         .then((db_shopid) => {
  //           if (db_shopid.find(({ shopid }) => shopid == shopid) == undefined) {
  //             return res.json(402, {
  //               shopid: req.body.shopid,
  //               message: "shopid not found",
  //             });
  //           }

  //           // check ordernumber
  //           db.select("shopid", "ordernumber")
  //             .from("orderinfo")
  //             .where({ shopid: req.body.shopid })
  //             .then(async (db_ordernumber) => {

  //               if (
  //                 db_ordernumber.find(
  //                   ({ ordernumber }) => ordernumber == ordernumber_
  //                 ) != undefined
  //               ) {
  //                 return res.json(402, {
  //                   ordernumber: req.body.ordernumber,
  //                   message: "ordernumber already exists",
  //                 });
  //               }

  //               // console.log("start1")
  //               // loop check productid
  //               await productinorder.forEach(async (element) => {
  //                 if (!checkString(!element.productid || element.productid)) {
  //                   // console.log(req.body)
  //                   // throw new ErrorHandler(400, "Invalid request");
  //                   return res.json(400, {
  //                     message: "Invalid request",
  //                   });
  //                 } else if (typeof element.linenumber != "number") {
  //                   return res.json(402, {
  //                     message: "linenumber must be a number",
  //                   });
  //                 } else if (typeof element.qty != "number") {
  //                   return res.json(402, {
  //                     message: "qty must be a number",
  //                   });
  //                 } else if (typeof element.productprice != "number") {
  //                   return res.json(402, {
  //                     message: "productprice must be a number",
  //                   });
  //                 }

  //                 // check productid
  //                 await db.select("productid")
  //                   .from("productinfo")
  //                   .where({ productid: element.productid })
  //                   .then((db_productid) => {
  //                     if (
  //                       db_productid.find(
  //                         ({ productid }) => productid == element.productid
  //                       ) == undefined
  //                     ) {
  //                       return res.json(402, {
  //                         productid: element.productid,
  //                         message: "productid not found",
  //                       });
  //                     }
  //                   });
  //               });

  //               let uuid_orderid = uuid().toString();
  //               let productinorder_data = req.body.productinorder;


  //               // ฟังก์ชั่นสร้าง orderdetail
  //               async function productinorder_order() {
  //                 let orderdetail_data = [];
                  
  //                 productinorder_data.forEach((element) => {
  //                   orderdetail_data.push({
  //                     odetailid: element.linenumber,
  //                     orderid: uuid_orderid,
  //                     productid: element.productid,
  //                     qty: element.qty,
  //                     productprice: element.productprice,
  //                     odetailremark: element.remark,
  //                     id: uuid().toString(),
  //                   });
  //                 });
                
  //                 return orderdetail_data;
  //               }

  //               // ดึงข้อมูล slot
  //               const listslot = await db.select().from("shopslot").where({shopid: shopid});
  //               let orderslotid = ' ';
  //               let orderslotsremaining = 0;
                
  //               // console.log("start2")
                
                
  //               // ฟังก์ชั่น check slot
  //               async function checkslot(){

  //                 listslot.some((element) => {
                    
  //                   let timeStampstart = Date.parse("2000" +"-" +"01" +"-" +"01" +" " +starttime);
  //                   let timeStampend = Date.parse("2000" +"-" +"01" +"-" +"01" +" " +endtime);
  //                   // console.log(timeStampstart)
  //                   // console.log(timeStampend)


  //                   if(starttime || endtime){



  //                     if (element.slottimestart == timeStampstart  && element.slottimeend == timeStampend){

  //                       // console.log("slotsremaining >>",element.slotsremaining)
  //                       // console.log("slotsremaining")


  //                       if(Number(element.slotsremaining) <= 0){
  //                         // throw new ErrorHandler(402, "shopclosetime format Invalid");
  //                         return false;
    
  //                       }else{
  //                         // console.log("endcheck")
  
  //                         orderslotid =  element.slotid;
  //                         orderslotsremaining = Number(element.slotsremaining)
  //                         return true;
  //                       }
  //                     }else{
  //                       // console.log("check No")
  
  //                     }
  //                   }else{

  //                     let dateNow = new Date();

  //                     let hour = dateNow.getHours();
  //                     let minute = dateNow.getMinutes();
  //                     let second = dateNow.getSeconds();

  //                     let timeStamp = Date.parse(
  //                       "2000" +
  //                         "-" +
  //                         "01" +
  //                         "-" +
  //                         "01" +
  //                         " " +
  //                         hour +
  //                         ":" +
  //                         minute +
  //                         ":" +
  //                         second
  //                     );

  //                     if (element.slottimestart <= timeStamp && element.slottimeend >= timeStamp)
  //                     {
  //                       // console.log("check time")
  //                       if(Number(element.slotsremaining) <= 0){
  //                         // throw new ErrorHandler(402, "shopclosetime format Invalid");
  //                         return false;
    
  //                       }else{
  //                         // console.log("endcheck")
  //                         orderslotid =  element.slotid;
  //                         orderslotsremaining = Number(element.slotsremaining)
  //                         return true;
  //                       }
  //                     }else{
  //                       // console.log("check No")
  
  //                     }
  //                   }
                    
  //                 });

  //                 if(orderslotid == ' '){
  //                    return false
  //                 }else{
  //                   return true
  //                 }
  //               }

  //               if(await checkslot() == true){
                  
  //                 // สร้าง order
  //                 await db("orderinfo")
  //                   .insert({
  //                     orderid: uuid_orderid,
  //                     shopid: req.body.shopid,
  //                     ordernumber: req.body.ordernumber,
  //                     ordertimestamp: req.body.ordertimestamp,
  //                     orderstatus: Number(0),
  //                     ordertotalprice: Number(req.body.ordertotalprice),
  //                     ordertotaldiscount: Number(req.body.ordertotaldiscount),
  //                     orderispay: 0,
  //                     pickupnow: pickupnow,
  //                     starttime: starttime,
  //                     endtime: endtime,
  //                   }).then(async () => {
  
  //                   // await db("shopslot").where({slotsremaining: (Number(orderslotid)-1)})
  //                   // อัพเดต slot
  //                   await db("shopslot")
  //                   .where({slotid: orderslotid})
  //                   .update({ slotsremaining: (Number(orderslotsremaining)-1)})

  //                   await db("orderdetail")
  //                     .insert(await productinorder_order())
  //                     .then(() => {

  //                       return res.json({
  //                         ordernumber: req.body.ordernumber,
  //                         msg: "Create order Success",
  //                       });

  //                   });
                        
  //                 });

  //               }else{

  //                 return res.json(402,{
  //                   msg: "The order quantity is full",
  //                 });
  //               }
  //           });
  //         });
  //     });
  // } catch (error) {
  //   return handleError(error, res);
  // }
};

// order update status ✓
exports.orderupdatestatus = (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const { ordernumber, orderstatus } = req.body;

  const orderUpdateStatusLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      if (!ordernumber || !orderstatus || !checkString(ordernumber)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const db_ordernumber = await db
        .select("ordernumber")
        .from("orderinfo")
        .where({ ordernumber });

      if (!db_ordernumber.length) {
        return reject({
          status: 402,
          message: `ordernumber not found`,
        });
      }

      if (typeof orderstatus !== "number") {
        return reject({
          status: 402,
          message: "orderstatus must be a number",
        });
      }


      const CheckOrderStatus = await db("orderinfo")
        .select("orderstatus")
        .where({ ordernumber })
        .first();
        
      if(CheckOrderStatus.orderstatus == 3 || CheckOrderStatus.orderstatus == 4){
        return reject({
          status: 402,
          message: `The order has been canceled.`,
        });
      }

      if (orderstatus == 3 || orderstatus == 4) {
        console.log("orderstatus = 3 || orderstatus = 4");

        const countordersqty = await db("orderinfo")
          .join("orderdetail", "orderdetail.orderid", "orderinfo.orderid")
          .where({ "orderinfo.ordernumber": ordernumber })
          .sum("orderdetail.qty").first();

        const orderslot = await db("orderinfo")
        .select(
          "orderinfo.shopid",
          "orderinfo.orderid",
          "orderinfo.ordernumber",
          "shopslot.slotid",
          "orderinfo.ordertimestamp",
          "orderinfo.starttime",
          "orderinfo.endtime",
          "shopslot.slotsremaining",
          "shopslot.slotcapacity",
          db.raw("CAST(EXTRACT(EPOCH FROM (DATE '2000-01-01' + orderinfo.starttime::time) AT TIME ZONE 'GMT-07') * 1000 AS BIGINT) as converted_starttime"),
          db.raw("CAST(EXTRACT(EPOCH FROM (DATE '2000-01-01' + orderinfo.endtime::time) AT TIME ZONE 'GMT-07') * 1000 AS BIGINT) as converted_endtime")
        )
        .join("shopslot", "shopslot.shopid", "orderinfo.shopid")
        .where({ "orderinfo.ordernumber": ordernumber })
        .andWhere(
          "shopslot.slottimestart",
          "=",
          db.raw("CAST(EXTRACT(EPOCH FROM (DATE '2000-01-01' + orderinfo.starttime::time) AT TIME ZONE 'GMT-07') * 1000 AS BIGINT)")
        )
        .andWhere(
          "shopslot.slottimeend",
          "=",
          db.raw("CAST(EXTRACT(EPOCH FROM (DATE '2000-01-01' + orderinfo.endtime::time) AT TIME ZONE 'GMT-07') * 1000 AS BIGINT)")
        );
          // .andWhere("shopslot.starttime","=",db.ref("orderinfo.starttime"))
          // .andWhere("shopslot.endtime","=",db.ref("orderinfo.endtime"))
          // .first();


        // console.log(Number(countordersqty.sum))
        // console.log(orderslot)

        await db("shopslot")
        .where({ slotid: orderslot[0].slotid })
        .update({ slotsremaining: (Number(orderslot[0].slotsremaining) - Number(countordersqty.sum)) });


        // return reject({
        //   status: 402,
        //   message: "END test",
        // });
        
        
      }
      
      await db("orderinfo")
        .where({ ordernumber })
        .update({ orderstatus: Number(orderstatus) });

      resolve({
        ordernumber,
        message: "Update order status Success",
      });

    } catch (error) {
      reject(error);
    }
  });

  Promise.race([orderUpdateStatusLogic, timeoutPromise])
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

// wallet update ✓
exports.walletupdate = (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const { ordernumber, walletpaymentstatus } = req.body;

  const walletUpdateLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

      if (!ordernumber || walletpaymentstatus === undefined || !checkString(ordernumber)) {
        return reject({ status: 400, message: "Invalid request" });
      }

      const db_ordernumber = await db
        .select("ordernumber")
        .from("orderinfo")
        .where({ ordernumber });

      if (!db_ordernumber.length) {
        return reject({
          status: 402,
          message: `ordernumber not found`,
        });
      }

      if (typeof walletpaymentstatus !== "number") {
        return reject({
          status: 402,
          message: "walletpaymentstatus must be a number",
        });
      }

      await db("orderinfo")
        .where({ ordernumber })
        .update({ orderispay: Number(walletpaymentstatus) });

      resolve({
        ordernumber,
        message: "Update wallet payment status Success",
      });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([walletUpdateLogic, timeoutPromise])
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

// receipt list ✓
exports.receiptlist = (req, res) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const { shopid } = req.body;

  const receiptListLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req);

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

      const orderlist = await db("orderinfo")
        .join("receiptinfo", "orderinfo.orderid", "receiptinfo.orderid")
        .where({ shopid })
        .andWhere("orderinfo.orderispay", ">", 0)
        .select(
          "orderinfo.orderid",
          "receiptinfo.receiptnumber",
          "orderinfo.ordernumber",
          "orderinfo.ordertotalprice"
        );

      let receiptlist_data = [];
      orderlist.forEach((element) => {
        receiptlist_data.push({
          receiptnumber: element.receiptnumber,
          ordernumber: element.ordernumber,
          totalprice: Number(element.ordertotalprice),
        });
      });

      resolve({
        total: receiptlist_data.length,
        result: receiptlist_data,
      });
    } catch (error) {
      reject(error);
    }
  });

  Promise.race([receiptListLogic, timeoutPromise])
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

// available slot
exports.availableslot = (req, res) => {

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  const { shopid, qty } = req.body;

  var pickupnowStatus = 0;
  
  const availableSlotLogic = new Promise(async (resolve, reject) => {
      try {
  
        // Validate API key
        await validateApiKey(req);
  
        if (!shopid || !checkString(shopid)) {
          return reject({ status: 400, message: "Invalid request" });
        }
  
        if (typeof qty !== "number") {
          return reject({ status: 400, message: "qty must be a number" });
        }
  
        const db_shopid = await db
          .select("shopid")
          .from("shopinfo")
          .where({ shopid });
  
        if (!db_shopid.length) {
          return reject({ status: 404, message: "shopid not found" });
        }
  
        const shopslist = await db("shopinfo")
          .join("shopslot", "shopinfo.shopid", "shopslot.shopid")
          .select(
            "shopslot.shopid",
            "shopslot.slottimestart",
            "shopslot.slottimeend",
            "shopslot.slotsremaining",
            "shopslot.slotcapacity",
            "shopinfo.shopclosetime"
          )
          .orderBy("shopslot.slottimestart", "asc")
          .where({ "shopslot.shopid": shopid, "shopslot.status": true });
  
        let shoplist_data = [];
        const dateNow = new Date();
        const hour = dateNow.getHours();
        const minute = dateNow.getMinutes();
        const second = dateNow.getSeconds();
  
        const timeStamp = Date.parse(`2000-01-01 ${hour}:${minute}:${second}`);
        const shopclosetime = Date.parse(`2000-01-01 ${shopslist[0].shopclosetime}`);
  
        shopslist.forEach((element) => {
          
          if (
  
            ((element.slottimestart >= timeStamp && element.slottimeend <= shopclosetime) ||
              (element.slottimestart <= timeStamp && element.slottimeend > timeStamp)) &&
            Number(element.slotsremaining)+qty <= Number(element.slotcapacity)
  
          ) {
  
            shoplist_data.push({
              
              remaining: Number(element.slotcapacity) - Number(element.slotsremaining),
              starttime: date.format(new Date(element.slottimestart), "HH:mm"),
              endtime: date.format(new Date(element.slottimeend), "HH:mm"),
              
            });
  
          }
        });

        // console.log("starttime >>",Date.parse(`2000-01-01 ${shoplist_data[0].starttime}`))
        // console.log("endtime >>",Date.parse(`2000-01-01 ${shoplist_data[0].endtime}`))
        // console.log("timeStamp >>",timeStamp)

        //  console.log("shoplist_data >>>",shoplist_data.length);

      if(shoplist_data.length > 0){

        // console.log(`2000-01-01 ${shoplist_data[0].starttime}`);
        // console.log(`2000-01-01 ${shoplist_data[0].endtime}`);

          
        if(Date.parse(`2000-01-01 ${shoplist_data[0].starttime}`) <= timeStamp && Date.parse(`2000-01-01 ${shoplist_data[0].endtime}`) > timeStamp){
          pickupnowStatus = 1;

        }
      }
        
  
        resolve({
          shopid,
          pickupnow: pickupnowStatus,
          availableslot: shoplist_data,
        });
      } catch (error) {
        reject(error);
      }
    });

  Promise.race([availableSlotLogic, timeoutPromise])
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

