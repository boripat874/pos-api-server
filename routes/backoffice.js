const express = require("express")
const router = express.Router()

const shopinfo = require("../controllers/backoffice/shop")
const productinfo = require("../controllers/backoffice/product")
const userinfo = require("../controllers/backoffice/user")
const reportorder = require("../controllers/backoffice/report1")
const reportuser = require("../controllers/backoffice/report2")
const eventloginfo = require("../controllers/backoffice/eventlog")
const notificationinfo = require("../controllers/backoffice/notification")
const dashboardinfo = require("../controllers/backoffice/dashboard")
const promotions = require("../controllers/backoffice/promotions")
const login = require("../controllers/backoffice/login")
const headerdata = require("../controllers/backoffice/headerData");
const managedataInpro = require("../controllers/backoffice/managedataInpro");
 
// headerdata
router.get("/backoffice/headerdatashopslist",headerdata.shopslist);

// login
router.get("/backoffice/checklogin",login.checklogin);


// shopinfo
router.get("/backoffice/groupshoplist",shopinfo.groupshoplist);
router.get("/backoffice/shoplist",shopinfo.shoplist);
router.post("/backoffice/shopcreate",shopinfo.shopcreate);
router.post("/backoffice/shopdetail",shopinfo.shopdetail);
router.put("/backoffice/shopdetailupdate",shopinfo.shopdetailupdate);
router.delete("/backoffice/shopdelete",shopinfo.shopdelete);
router.post("/backoffice/slotlist", shopinfo.slotlist);
router.put("/backoffice/slotupdate", shopinfo.slotupdate);
router.put("/backoffice/shoprestore",shopinfo.shoprestore);

// productinfo
router.get("/backoffice/productshoplist",productinfo.shoplist);
router.post("/backoffice/productlist",productinfo.productlist);
router.post("/backoffice/productcreate",productinfo.productcreate);
router.post("/backoffice/productdetail",productinfo.productdetail);
router.put("/backoffice/productupdate",productinfo.productupdate);
router.delete("/backoffice/productdelete",productinfo.productdelete);
router.post("/backoffice/productcategorylist",productinfo.productcategorylist);
router.put("/backoffice/productupdatestock",productinfo.productupdatestock);

router.post("/backoffice/productcategorycreate",productinfo.productcategorycreate);
router.put("/backoffice/productcategoryupdate",productinfo.productcategoryupdate);
router.post("/backoffice/productcategorydelete",productinfo.productcategorydelete);

// userinfo
router.get("/backoffice/usershoplist",userinfo.shoplist);
router.post("/backoffice/signin",userinfo.signin);
router.get("/backoffice/signout",userinfo.signout);
router.get("/backoffice/userinfo",userinfo.userinfo);
router.post("/backoffice/confirmaction",userinfo.confirmaction);
router.get("/backoffice/groupuserlist",userinfo.groupuserlist);
router.post("/backoffice/groupusercreate",userinfo.groupusercreate);
router.put("/backoffice/groupuseredit",userinfo.groupuseredit);
router.delete("/backoffice/groupuserdelete",userinfo.groupuserdelete);
router.get("/backoffice/userlistall",userinfo.userlistAll);
router.post("/backoffice/usercreate",userinfo.usercreate);
router.post("/backoffice/userdetail",userinfo.userdetail);
router.put("/backoffice/useredit",userinfo.useredit);
router.delete("/backoffice/userdelete",userinfo.userdelete);
router.post("/backoffice/forgotemail",userinfo.forgotemail);
router.post("/backoffice/updatepassword",userinfo.updatepassword);


// report order
router.post("/backoffice/reportorderlist",reportorder.reportorderlist);
router.post("/backoffice/reporttotalincome",reportorder.reporttotalincome);
router.post("/backoffice/reporttotalcreditcard",reportorder.reporttotalcreditcard);
router.post("/backoffice/reporttotalpromptpay",reportorder.reporttotalpromptpay);
router.post("/backoffice/reporttotalewallet",reportorder.reporttotalewallet);
router.post("/backoffice/reporttotalcash",reportorder.reporttotalcash);
router.post("/backoffice/reporttotalorder",reportorder.reporttotalorder);
router.post("/backoffice/reportproductsell",reportorder.reportproductsell);
router.post("/backoffice/receiptorder",reportorder.receiptorder);
// router.get("/backoffice/reportproductselllist",reportorder.reportproductselllist);


// report user
router.post("/backoffice/reportuserlist",reportuser.reportuserlist);

// eventloginfo
router.post("/backoffice/eventloglist",eventloginfo.eventloglist);
router.post("/backoffice/eventlogcreate",eventloginfo.eventlogCreate);

// notificationinfo
router.get("/backoffice/noticountbyshoplist",notificationinfo.notiCountByShoplist);
router.post("/backoffice/notificationlist",notificationinfo.notificationlist);
router.get("/backoffice/notificationunreadcount",notificationinfo.notificationUnreadCount);
router.delete("/backoffice/notificationdelete/:id",notificationinfo.notificationDelete);

// dashboard
router.get("/backoffice/dashboardlistall",dashboardinfo.dashboardlistAll);
router.get("/backoffice/dashboardtotal",dashboardinfo.dashboardtotal);
router.get("/backoffice/dashboardpopularstore",dashboardinfo.dashboardpopularstore);
router.get("/backoffice/dashboardbestsellingstore",dashboardinfo.dashboardbestsellingstore);
router.get("/backoffice/dashboardshoplist",dashboardinfo.dashboardshoplist);
router.post("/backoffice/dashboarddatalist",dashboardinfo.dashboardDataList);
router.get("/backoffice/dashboardOverview",dashboardinfo.dashboardOverview);
router.get("/backoffice/dashboardproductselllist",dashboardinfo.dashboardproductselllist);

// promotions
router.get("/backoffice/promotionshopslist",promotions.shopslist);
router.post("/backoffice/promotionproductslist",promotions.productslist);
router.post("/backoffice/promotioncreate",promotions.promotionCreate);
router.post("/backoffice/promotionslist",promotions.promotionslist);
router.post("/backoffice/promotiondetail",promotions.promotionDetail);
router.put("/backoffice/promotionupdate",promotions.promotionUpdate);
router.post("/backoffice/promotiondelete",promotions.promotionDelete);

// manager data in program
router.post("/backoffice/exportshops",managedataInpro.exportshop);
router.post("/backoffice/importshops",managedataInpro.shopcreateMultiple);
router.post("/backoffice/exportproducts",managedataInpro.exportproducts);
router.post("/backoffice/importproducts",managedataInpro.productcreateMultiple);
router.post("/backoffice/exportusers",managedataInpro.exportusers);
router.post("/backoffice/importusers",managedataInpro.usercreateMultiple);

module.exports = router

