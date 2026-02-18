const express = require("express")
const router = express.Router()

const {
    shopcreate,
    shoplist, 
    shopdetail,
    shopdetailupdate,
    shopdelete,
    productlist,
    productdetail,
    productcreate,
    productupdate,
    productdelete,
    orderlist,
    orderdetail,
    ordercreate,
    orderupdatestatus,
    walletupdate,
    receiptlist,
    availableslot
} = require("../controllers/openApi")

// function response400(params) {
//   if(!params){

//     res.status(400)
//     res.send({
//       "message":"Invalid request"
//     });

//   }
// }

// Shop
// router.post("/shopcreate",shopcreate);
router.get("/shoplist",shoplist);
router.post("/shopdetail",shopdetail);
router.put("/shopdetailupdate",shopdetailupdate);
// router.delete("/shopdelete",shopdelete);

//Product
router.post("/productlist",productlist);
router.post("/productdetail",productdetail);
router.post("/productcreate",productcreate);
router.put("/productupdate",productupdate);
router.delete("/productdelete",productdelete)

//Order
router.post("/orderlist",orderlist);
router.post("/orderdetail",orderdetail);
router.post("/ordercreate",ordercreate);
router.put("/orderupdatestatus",orderupdatestatus);

//Wallet
router.put("/walletupdate",walletupdate);

//Receipt
router.post("/receiptlist",receiptlist);

//Available slot
router.post("/availableslot",availableslot);


module.exports = router