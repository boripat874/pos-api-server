const express = require("express")
const router = express.Router()

const productinfo = require("../controllers/pos/product") 
const userinfo = require("../controllers/pos/user")
const reportinfo = require("../controllers/pos/report")
const eventloginfo = require("../controllers/pos/eventlog")
const notificationinfo = require("../controllers/pos/notification")
const dashboardinfo = require("../controllers/pos/dashboard")
const promotions = require("../controllers/pos/promotions")
const login = require("../controllers/pos/login")
const order = require("../controllers/pos/order")
const shopinfo = require("../controllers/pos/shop")

// login
router.get("/pos/checklogin",login.checklogin);
 
// userinfo
// router.get("/pos/usershoplist",userinfo.shoplist);
router.post("/pos/signin",userinfo.signin);
router.get("/pos/signout",userinfo.signout);
router.get("/pos/userinfo",userinfo.userinfo);
// router.get("/pos/groupuserlist",userinfo.groupuserlist);
// router.post("/pos/groupusercreate",userinfo.groupusercreate);
// router.put("/pos/groupuseredit",userinfo.groupuseredit);
// router.delete("/pos/groupuserdelete",userinfo.groupuserdelete);
// router.get("/pos/userlistall",userinfo.userlistAll);
// router.post("/pos/usercreate",userinfo.usercreate);
// router.put("/pos/useredit",userinfo.useredit);
// router.delete("/pos/userdelete",userinfo.userdelete);

// shop
router.get("/pos/shopslist",shopinfo.shoplist);
router.post("/pos/shopdetail",shopinfo.shopdetail);

// Order
router.post("/pos/orderlist",order.orderlist);
router.post("/pos/orderdetail",order.orderdetail);
router.post("/pos/ordercreate",order.ordercreate);
router.put("/pos/orderupdate", order.orderupdate);
router.put("/pos/orderupdatestatus",order.orderupdatestatus);
router.post("/pos/orderdelete", order.orderdelete);


// Wallet
router.put("/pos/walletupdate",order.walletupdate);

// Receipt
router.post("/pos/receiptlist",order.receiptlist);
router.post("/pos/receiptcreate",order.receiptcreate);
router.post("/pos/receiptdelete", order.receiptdelete);


// Available slot
router.post("/pos/availableslot",order.availableslot);


// reportinfo
router.get("/pos/reportorderlist",reportinfo.reportorderlist);
router.get("/pos/reportproductselllist",reportinfo.reportproductselllist);

// productinfo
router.post("/pos/productcategorylist",productinfo.productcategorylist);
router.get("/pos/productshoplist",productinfo.productshoplist);
router.post("/pos/productlist",productinfo.productlist);
router.post("/pos/productdetail",productinfo.productdetail);
router.put("/pos/productupdatestock",productinfo.productupdatestock);

// eventloginfo
router.get("/pos/eventloglist",eventloginfo.eventloglist);

// notificationinfo
router.get("/pos/notificationlist",notificationinfo.notificationlist);
router.get("/pos/notificationunreadcount",notificationinfo.notificationUnreadCount);
router.delete("/pos/notificationdelete/:id",notificationinfo.notificationDelete);

// dashboard
router.get("/pos/dashboardlistall",dashboardinfo.dashboardlistAll);
router.get("/pos/dashboardtotal",dashboardinfo.dashboardtotal);
router.get("/pos/dashboardpopularitem",dashboardinfo.dashboardpopularitem);
router.get("/pos/dashboardorderlist",dashboardinfo.dashboardorderlist);

// promotions
// router.get("/pos/promotionshopslist",promotions.shopslist);
// router.get("/pos/promotionproductslist",promotions.productslist);
router.post("/pos/promotionslist",promotions.promotionslist);
// router.post("/pos/promotioncreate",promotions.promotionCreate);
// router.put("/pos/promotionupdate",promotions.promotionUpdate);
// router.delete("/pos/promotiondelete/:id",promotions.promotionDelete);




module.exports = router

