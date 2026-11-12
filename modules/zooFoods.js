// =====================================================================
// ส่งข้อมูลสินค้าไป ZooApp (API_ZOO /foods) : POS_Server 1.0.13
//   ใช้กับสินค้าที่ sync online (productinfo.synconline = true)
//   - zooCreate : POST   /foods
//   - zooUpdate : PUT    /foods/{productid}
//   - zooDelete : DELETE /foods/{productid}
//   error ที่ส่งออก = { status, message, zooStatus } ใช้ reject ต่อได้ทันที
// =====================================================================
const axios = require("axios");
require("dotenv").config();

const ZOO_TIMEOUT_MS = 20000;

function zooConfig() {
  const url = String(process.env.NEXT_PUBLIC_API_URL_ZOO || "").replace(/\/+$/, "");
  const key = process.env.NEXT_PUBLIC_API_ZOO_KEY || "";
  if (!url || !key) {
    throw { status: 500, message: "ยังไม่ได้ตั้งค่า NEXT_PUBLIC_API_URL_ZOO / NEXT_PUBLIC_API_ZOO_KEY", zooStatus: 0 };
  }
  return { url, key };
}

function zooError(err, action) {
  const zooStatus = (err && err.response && err.response.status) || 0;
  const data = err && err.response && err.response.data;
  const detail =
    (data && (data.message || data.error || (typeof data === "string" ? data : ""))) ||
    (err && err.code) ||
    (err && err.message) ||
    "unknown";
  console.error(`[ZooApp] ${action} failed`, zooStatus, typeof detail === "string" ? detail : JSON.stringify(detail));
  return {
    status: 502,
    zooStatus,
    message: `ZooApp ${action} ไม่สำเร็จ${zooStatus ? ` (HTTP ${zooStatus})` : ""}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
  };
}

function zooPayload(p, withIds) {
  const payload = {
    nameTh: p.productnameth,
    nameEn: p.productnameeng,
    detailTh: p.productdatath || "",
    detailEn: p.productdataeng || "",
    price: Number(p.productprice) || 0,
  };
  if (withIds) {
    return { productId: p.productid, posShopId: p.shopid, ...payload };
  }
  return payload;
}

async function call(method, path, data, action) {
  const { url, key } = zooConfig();
  try {
    const res = await axios({
      method,
      url: `${url}${path}`,
      data,
      timeout: ZOO_TIMEOUT_MS,
      headers: { "Content-Type": "application/json", "X-API-KEY": key },
    });
    return res;
  } catch (err) {
    throw zooError(err, action);
  }
}

// สร้างสินค้าที่ ZooApp ; alreadyExists = true ถ้า ZooApp ตอบว่ามีสินค้านี้อยู่แล้ว (409)
async function zooCreate(product) {
  try {
    await call("post", "/foods", zooPayload(product, true), "สร้างสินค้า");
    return { alreadyExists: false };
  } catch (e) {
    if (e.zooStatus === 409) return { alreadyExists: true };
    throw e;
  }
}

// แก้ไขสินค้าที่ ZooApp ; notFound = true ถ้า ZooApp ไม่มีสินค้านี้ (404)
async function zooUpdate(product) {
  try {
    await call("put", `/foods/${encodeURIComponent(product.productid)}`, zooPayload(product, false), "แก้ไขสินค้า");
    return { notFound: false };
  } catch (e) {
    if (e.zooStatus === 404) return { notFound: true };
    throw e;
  }
}

// ลบสินค้าที่ ZooApp ; ไม่มีอยู่แล้ว (404) ถือว่าลบสำเร็จ
async function zooDelete(productid) {
  try {
    await call("delete", `/foods/${encodeURIComponent(productid)}`, undefined, "ลบสินค้า");
    return { notFound: false };
  } catch (e) {
    if (e.zooStatus === 404) return { notFound: true };
    throw e;
  }
}

// ค่า synconline จาก request (multipart ส่งเป็น string) ; ไม่ส่งมา = ค่าเริ่มต้น
function parseSyncOnline(v, defaultValue = true) {
  if (v === undefined || v === null || v === "") return defaultValue;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(s)) return false;
  if (["true", "1", "yes", "on"].includes(s)) return true;
  return defaultValue;
}

module.exports = { zooCreate, zooUpdate, zooDelete, parseSyncOnline, zooPayload };
