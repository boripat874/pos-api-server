// =====================================================================
// ArcSight audit log: ส่ง log ทุก API ที่เป็น POST / PUT / DELETE
//   - ส่งหลังตอบ response แล้ว (res "finish") จึงไม่ทำให้ API ช้าลง
//   - ไม่ส่ง body ทั้งก้อน (กันรหัสผ่าน/ข้อมูลส่วนตัวรั่ว) ส่งเฉพาะรหัสอ้างอิง เช่น shopid, ordernumber
//   - heartbeat ของเครื่อง POS (ทุก 60 วินาที) ส่งเฉพาะตอนล้มเหลวหรือ logout
//     ถ้าต้องการส่งทุกครั้ง ตั้ง ARCSIGHT_LOG_HEARTBEAT=true
// =====================================================================
const jwt = require("jsonwebtoken");
const { sendlogArcSight } = require("./fun");

require("dotenv").config();

const LOG_METHODS = new Set(["POST", "PUT", "DELETE"]);
const LOG_HEARTBEAT = String(process.env.ARCSIGHT_LOG_HEARTBEAT || "").toLowerCase() === "true";

// [eventId, eventName] ต่อเส้น API  (POS 2xxx, Backoffice 3xxx, OpenAPI 4xxx)
const EVENTS = {
  // ---------------- POS ----------------
  "POST /api/pos/signin": [2001, "POS sign in"],
  "POST /api/pos/shopuserlist": [2002, "POS shop user list"],
  "POST /api/pos/terminalheartbeat": [2003, "POS terminal heartbeat"],
  "POST /api/pos/shopdetail": [2010, "POS shop detail"],
  "POST /api/pos/orderlist": [2020, "POS order list"],
  "POST /api/pos/orderdetail": [2021, "POS order detail"],
  "POST /api/pos/ordercreate": [2022, "POS order create"],
  "PUT /api/pos/orderupdate": [2023, "POS order update"],
  "PUT /api/pos/orderupdatestatus": [2024, "POS order update status"],
  "POST /api/pos/orderdelete": [2025, "POS order delete"],
  "PUT /api/pos/walletupdate": [2026, "POS wallet update"],
  "POST /api/pos/receiptlist": [2030, "POS receipt list"],
  "POST /api/pos/receiptcreate": [2031, "POS receipt create"],
  "POST /api/pos/receiptdelete": [2032, "POS receipt delete"],
  "POST /api/pos/availableslot": [2033, "POS available slot"],
  "POST /api/pos/productcategorylist": [2040, "POS product category list"],
  "POST /api/pos/productlist": [2041, "POS product list"],
  "POST /api/pos/productdetail": [2042, "POS product detail"],
  "PUT /api/pos/productupdatestock": [2043, "POS product update stock"],
  "DELETE /api/pos/notificationdelete/:id": [2050, "POS notification delete"],
  "POST /api/pos/promotionslist": [2060, "POS promotion list"],

  // ---------------- Backoffice ----------------
  "POST /api/backoffice/signin": [3001, "Backoffice sign in"],
  "POST /api/backoffice/confirmaction": [3002, "Backoffice confirm action"],
  "POST /api/backoffice/forgotemail": [3003, "Backoffice forgot password email"],
  "POST /api/backoffice/updatepassword": [3004, "Backoffice update password"],
  "POST /api/backoffice/shopcreate": [3010, "Backoffice shop create"],
  "POST /api/backoffice/shopdetail": [3011, "Backoffice shop detail"],
  "PUT /api/backoffice/shopdetailupdate": [3012, "Backoffice shop update"],
  "DELETE /api/backoffice/shopdelete": [3013, "Backoffice shop delete"],
  "PUT /api/backoffice/shoprestore": [3014, "Backoffice shop restore"],
  "POST /api/backoffice/slotlist": [3015, "Backoffice slot list"],
  "PUT /api/backoffice/slotupdate": [3016, "Backoffice slot update"],
  "POST /api/backoffice/productlist": [3020, "Backoffice product list"],
  "POST /api/backoffice/productcreate": [3021, "Backoffice product create"],
  "POST /api/backoffice/productdetail": [3022, "Backoffice product detail"],
  "PUT /api/backoffice/productupdate": [3023, "Backoffice product update"],
  "DELETE /api/backoffice/productdelete": [3024, "Backoffice product delete"],
  "PUT /api/backoffice/productupdatestock": [3025, "Backoffice product update stock"],
  "POST /api/backoffice/productcategorylist": [3026, "Backoffice product category list"],
  "POST /api/backoffice/productcategorycreate": [3027, "Backoffice product category create"],
  "PUT /api/backoffice/productcategoryupdate": [3028, "Backoffice product category update"],
  "POST /api/backoffice/productcategorydelete": [3029, "Backoffice product category delete"],
  "POST /api/backoffice/groupusercreate": [3030, "Backoffice user group create"],
  "PUT /api/backoffice/groupuseredit": [3031, "Backoffice user group update"],
  "DELETE /api/backoffice/groupuserdelete": [3032, "Backoffice user group delete"],
  "POST /api/backoffice/usercreate": [3033, "Backoffice user create"],
  "POST /api/backoffice/userdetail": [3034, "Backoffice user detail"],
  "PUT /api/backoffice/useredit": [3035, "Backoffice user update"],
  "DELETE /api/backoffice/userdelete": [3036, "Backoffice user delete"],
  "POST /api/backoffice/reportorderlist": [3040, "Backoffice report order list"],
  "POST /api/backoffice/reporttotalincome": [3041, "Backoffice report total income"],
  "POST /api/backoffice/reporttotalcreditcard": [3042, "Backoffice report total credit card"],
  "POST /api/backoffice/reporttotalpromptpay": [3043, "Backoffice report total PromptPay"],
  "POST /api/backoffice/reporttotalewallet": [3044, "Backoffice report total e-wallet"],
  "POST /api/backoffice/reporttotalcash": [3045, "Backoffice report total cash"],
  "POST /api/backoffice/reporttotalorder": [3046, "Backoffice report total order"],
  "POST /api/backoffice/reportproductsell": [3047, "Backoffice report product sell"],
  "POST /api/backoffice/receiptorder": [3048, "Backoffice receipt of order"],
  "POST /api/backoffice/reportinventorylist": [3049, "Backoffice report inventory"],
  "POST /api/backoffice/reportuserlist": [3050, "Backoffice report user list"],
  "POST /api/backoffice/eventloglist": [3060, "Backoffice event log list"],
  "POST /api/backoffice/eventlogcreate": [3061, "Backoffice event log create"],
  "POST /api/backoffice/notificationlist": [3070, "Backoffice notification list"],
  "DELETE /api/backoffice/notificationdelete/:id": [3071, "Backoffice notification delete"],
  "POST /api/backoffice/dashboarddatalist": [3080, "Backoffice dashboard shop data"],
  "POST /api/backoffice/promotionproductslist": [3090, "Backoffice promotion product list"],
  "POST /api/backoffice/promotioncreate": [3091, "Backoffice promotion create"],
  "POST /api/backoffice/promotionslist": [3092, "Backoffice promotion list"],
  "POST /api/backoffice/promotiondetail": [3093, "Backoffice promotion detail"],
  "PUT /api/backoffice/promotionupdate": [3094, "Backoffice promotion update"],
  "POST /api/backoffice/promotiondelete": [3095, "Backoffice promotion delete"],
  "POST /api/backoffice/exportshops": [3100, "Backoffice export shops"],
  "POST /api/backoffice/importshops": [3101, "Backoffice import shops"],
  "POST /api/backoffice/exportproducts": [3102, "Backoffice export products"],
  "POST /api/backoffice/importproducts": [3103, "Backoffice import products"],
  "POST /api/backoffice/exportusers": [3104, "Backoffice export users"],
  "POST /api/backoffice/importusers": [3105, "Backoffice import users"],

  // ---------------- OpenAPI (ZooApp) ----------------
  "POST /api/shopdetail": [4001, "OpenAPI shop detail"],
  "PUT /api/shopdetailupdate": [4002, "OpenAPI shop update"],
  "POST /api/productlist": [4010, "OpenAPI product list"],
  "POST /api/productdetail": [4011, "OpenAPI product detail"],
  "POST /api/productcreate": [4012, "OpenAPI product create"],
  "PUT /api/productupdate": [4013, "OpenAPI product update"],
  "DELETE /api/productdelete": [4014, "OpenAPI product delete"],
  "POST /api/orderlist": [4020, "OpenAPI order list"],
  "POST /api/orderdetail": [4021, "OpenAPI order detail"],
  "POST /api/ordercreate": [4022, "OpenAPI order create"],
  "PUT /api/orderupdatestatus": [4023, "OpenAPI order update status"],
  "PUT /api/walletupdate": [4024, "OpenAPI wallet update"],
  "POST /api/receiptlist": [4030, "OpenAPI receipt list"],
  "POST /api/availableslot": [4031, "OpenAPI available slot"],
};

// field ใน body ที่ส่งไปด้วยได้ (เป็นรหัสอ้างอิงเท่านั้น)
const REF_FIELDS = [
  ["cs1", "shopid"],
  ["cs2", "terminalid"],
  ["cs3", "ordernumber"],
  ["cs4", "productid"],
];

function moduleOf(path) {
  if (path.startsWith("/api/pos/")) return "POS";
  if (path.startsWith("/api/backoffice/")) return "Backoffice";
  return "OpenAPI";
}

// /api/pos/notificationdelete/123 -> /api/pos/notificationdelete/:id
function routeKey(req) {
  const routePath = req.route && req.route.path ? req.baseUrl + req.route.path : req.originalUrl.split("?")[0];
  return `${req.method} ${routePath}`;
}

// 2xx -> 3 (Low), 401/403 -> 6, 4xx อื่น -> 5, 5xx -> 8 (High)
function severityOf(status) {
  if (status >= 500) return 8;
  if (status === 401 || status === 403) return 6;
  if (status >= 400) return 5;
  return 3;
}

function userFromToken(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return {};
  try {
    const d = jwt.verify(h.split(" ")[1], process.env.JWT_SECRET);
    return { uinfoid: d.uinfoid, ugroupid: d.ugroupid };
  } catch {
    return {};
  }
}

function arcsightAudit(req, res, next) {
  if (!LOG_METHODS.has(req.method)) return next();

  const started = Date.now();

  // เก็บ message ของ response (ถ้ามี) ไว้ใส่ใน log
  let responseMessage;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === "object" && typeof body.message === "string") responseMessage = body.message;
    return originalJson(body);
  };

  res.on("finish", () => {
    try {
      const key = routeKey(req);
      const path = key.split(" ")[1];
      const status = res.statusCode;
      const body = req.body || {};

      // heartbeat ที่สำเร็จ ไม่ส่ง (ยิงทุกนาที) เว้นแต่ logout หรือเปิด ARCSIGHT_LOG_HEARTBEAT
      if (
        path === "/api/pos/terminalheartbeat" &&
        status < 400 &&
        !LOG_HEARTBEAT &&
        String(body.status || "online").toLowerCase() !== "logout"
      ) {
        return;
      }

      const [eventId, eventName] = EVENTS[key] || [moduleOf(path) === "POS" ? 2999 : moduleOf(path) === "Backoffice" ? 3999 : 4999, `${moduleOf(path)} ${req.method} ${path}`];
      const ok = status < 400;
      const user = userFromToken(req);

      const payload = {
        requestMethod: req.method,
        request: path,
        outcome: ok ? "Success" : "Failure",
        cn1Label: "httpStatus",
        cn1: status,
        cn2Label: "durationMs",
        cn2: Date.now() - started,
        cs5Label: "clientIP",
        cs5: req.ip,
        cs6Label: "module",
        cs6: moduleOf(path),
        suid: user.uinfoid,
        // signin ยังไม่มี token -> ใช้ชื่อผู้ใช้ที่ส่งมา (ไม่ส่งรหัสผ่าน)
        suser: body.uinfologinname || undefined,
        msg: responseMessage,
      };
      for (const [k, field] of REF_FIELDS) {
        if (body[field] !== undefined && body[field] !== null && body[field] !== "") {
          payload[`${k}Label`] = field;
          payload[k] = String(body[field]).slice(0, 100);
        }
      }
      if (req.params && req.params.id) payload.externalId = req.params.id;

      sendlogArcSight(ok ? eventName : `${eventName} failed`, eventId, severityOf(status), payload);
    } catch (e) {
      console.warn("[ArcSight] audit failed:", e.message);
    }
  });

  next();
}

module.exports = { arcsightAudit, EVENTS, severityOf };
