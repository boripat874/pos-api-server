const {db} = require("../../db/postgresql");
const fs = require("fs");
const date = require("date-and-time");
const { uuid } = require("uuidv4");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT
// const { console } = require("inspector");
const {
  checkAuthorizetion,
} = require("../../modules/fun"); 

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

// notificationlist with timeout and pagination
exports.notificationlist = (req, res) => { // Changed back to standard function for Promise.race pattern

  // Define the timeout promise
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  // Wrap the main logic in a promise
  const notificationListLogic = new Promise(async (resolve, reject) => {
    try {

      // Validate API key
      await validateApiKey(req); // ตรวจสอบ API key
      
      // ตรวจสอบการอนุญาตเข้าสู่ระบบ
      await checkAuthorizetion(req);

      const search = req.query.search || "";
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10; // Default limit
      const offset = (page - 1) * limit;
      const statusFilter = 'read'; // e.g., 'unread', 'read' ,'deleted'
      
      const headers = req.headers.authorization;
      const token = headers.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const uinfoid = decoded.uinfoid;

      // Base query
      let query = db("notificationinfo")
        .join("notificationuser", "notificationinfo.id", "notificationuser.notificationid")
        .where(function () { // Group search conditions
          this.where("title", "ILIKE", `%${search}%`) // Use ILIKE for case-insensitive search
              .orWhere("details", "ILIKE", `%${search}%`);
        })
        .andWhere({ "notificationuser.uinfoid": uinfoid })
        .andWhere(function () {
          this.where("notificationuser.statusfilter", "=", 'read')
              .orWhere("notificationuser.statusfilter", "=", 'unread')
        })

      // --- Pagination ---
      // Clone the query to count total matching records *before* applying limit/offset
      const totalCountQuery = query.clone().count('* as total');

      // Apply ordering, limit, and offset to the main query
      const notificationList = await query
        .select('*') // Select desired columns
        .orderBy("created_at", "desc") // เรี่มต้นจากวันที่ล่าสุด
        // .limit(limit)
        .offset(offset);

      // Execute the count query
      const totalResult = await totalCountQuery;
      const total = parseInt(totalResult[0].total, 10);
      // --- End Pagination ---

      // Format timestamps (similar to eventlog)
      const formattedResults = notificationList.map(item => {
        let formattedCreatedAt = 'Invalid Date';
        let formattedReadAt = 'Invalid Date'; // Keep null if not read

        if (item.created_at ) {
            formattedCreatedAt = date.format(new Date(item.created_at*1000), 'YYYY-MM-DD HH:mm');
        } else if (item.created_at) {
            console.warn(`Invalid date format for created_at: ${item.created_at}`);
        }

        if (item.read_at) {
            formattedReadAt = date.format(new Date(item.read_at*1000), 'YYYY-MM-DD HH:mm');
        } else if (item.read_at) {
          console.warn(`Invalid date format for read_at: ${item.read_at}`);
        }

        return {
          created_at: formattedCreatedAt,
          title: item.title,
          details: item.details,
          notificationid: item.notificationid
        };
      });

      const idsToUpdate = notificationList.map(item => item.notificationid);

      // Resolve the main logic promise with the results
      await db("notificationuser")
      .whereIn('notificationid', idsToUpdate) // <-- ใช้ whereIn กับ list ID ที่ดึงมา
      .andWhere({ uinfoid: uinfoid })       // <-- ยังคงกรองตาม uinfoid เพื่อความปลอดภัย
      .update({ statusfilter: statusFilter, read_at: Math.floor(Date.now() / 1000) })

      resolve({
        total: total,
        page: page,
        limit: limit,
        totalPages: Math.ceil(total / limit),
        result: formattedResults,
      });

    } catch (error) {
      // Reject the main logic promise if an error occurs
      reject(error);
    }
  });

  // Race the main logic against the timeout
  Promise.race([notificationListLogic, timeoutPromise])
    .then((result) => {
      // If notificationListLogic resolves first
      res.status(200).json(result);
    })
    .catch((error) => {
      // If either notificationListLogic rejects or timeoutPromise rejects
      if (error.status) {

        // Handle custom errors with status (like Unauthorized)
        res.status(error.status).json({ message: error.message });
        
      } else if (error.message === "Request timed out") {

        // Handle the specific timeout error
        res.status(408).json({ message: "Request timed out" }); // Use 408 Request Timeout status
      } else {

        // Handle other unexpected errors
        handleError(error, res);

      }
    });
};

// // ฟังก์ชันสำหรับนับจำนวน Notification ที่ยังไม่ได้อ่าน
exports.notificationUnreadCount = (req, res) => {
  // Define the timeout promise
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  // Wrap the main logic in a promise
  const countLogic = new Promise(async (resolve, reject) => {
    try {
      
      // Validate API key
      await validateApiKey(req);

      // ตรวจสอบการอนุญาตเข้าสู่ระบบ
      await checkAuthorizetion(req);

      // Get uinfoid from query parameters
      const headers = req.headers.authorization;
      const token = headers.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const uinfoid = decoded.uinfoid;

      // Perform the count query on notificationuser table
      const countResult = await db("notificationuser")
        .where({
          uinfoid: uinfoid,
          statusfilter: 'unread' // Hardcode the status to 'unread'
        })
        .count('* as unreadCount') // Count all matching rows and alias the result
        .first(); // Use first() because count() returns an array with one object

      // Extract the count (default to 0 if no result)
      const unreadCount = countResult ? parseInt(countResult.unreadCount, 10) : 0;

      // Resolve the promise with the count
      resolve({
        unreadCount: unreadCount
      });

    } catch (error) {
      // Reject the promise if any error occurs
      reject(error);
    }
  });

  // Race the main logic against the timeout
  Promise.race([countLogic, timeoutPromise])
    .then((result) => {
      // If countLogic resolves first
      res.status(200).json(result);
    })
    .catch((error) => {
      // If either countLogic rejects or timeoutPromise rejects
      if (error.status) {
        // Handle custom errors with status (like Unauthorized, Bad Request, Not Found)
        res.status(error.status).json({ message: error.message });
      } else if (error.message === "Request timed out") {
        // Handle the specific timeout error
        res.status(408).json({ message: "Request timed out" }); // Use 408 Request Timeout status
      } else {
        // Handle other unexpected errors
        handleError(error, res);
      }
    });
};

// ฟังก์ชันสำหรับลบ (soft delete) Notification ของผู้ใช้
exports.notificationDelete = (req, res) => {
  // Define the timeout promise
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeout)
  );

  // Wrap the main logic in a promise
  const deleteLogic = new Promise(async (resolve, reject) => {
    try {

      // 1. Get Notification ID from route parameter
      const notificationIdToDelete = req.params.id; // รับ ID จาก URL เช่น /backoffice/notification/some-uuid

      // 2. Validate API Key
      await validateApiKey(req);

      // ตรวจสอบการอนุญาตเข้าสู่ระบบ
      await checkAuthorizetion(req);

      const headers = req.headers.authorization;
      const token = headers.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const uinfoid = decoded.uinfoid;

      // 4. Validate Input
      if (!notificationIdToDelete) {
        return reject({ status: 400, message: "notificationid not required" });
      }

      // 5. Perform Soft Delete in notificationuser table
      // We update the statusfilter for the specific user and notification ID
      const updateResult = await db("notificationuser")
        .where({
          uinfoid: uinfoid,                 // Match the user from the token
          notificationid: notificationIdToDelete // Match the notification ID from the URL param
        })
        // Optionally check if it's not already deleted
        // .andWhereNot({ statusfilter: 'deleted' })
        .update({
          statusfilter: 'deleted', // Set the status to 'deleted'
          // Optionally set a deleted_at timestamp if your table has it
          // deleted_at: Math.floor(Date.now() / 1000)
        });

      // 6. Check if any row was actually updated
      if (updateResult === 0) {
        // This means no matching 'unread' or 'read' notification was found for this user and ID
        return reject({ status: 402, message: "Notification not found for this user or already deleted" });
      }

      // 7. Resolve successfully
      resolve({
        message: "Notification deleted successfully",
      });

    } catch (error) {
      // Reject the promise if any other error occurs (DB connection etc.)
      reject(error);
    }
  });

  // Race the main logic against the timeout
  Promise.race([deleteLogic, timeoutPromise])
    .then((result) => {
      // If deleteLogic resolves first
      res.status(200).json(result); // 200 OK for successful deletion
    })
    .catch((error) => {
      // If either deleteLogic rejects or timeoutPromise rejects
      if (error.status) {
        // Handle custom errors with status
        res.status(error.status).json({ message: error.message });
      } else if (error.message === "Request timed out") {
        // Handle the specific timeout error
        res.status(402).json({ message: "Request timed out" });
      } else {
        // Handle other unexpected errors
        handleError(error, res);
      }
    });
};



// --- Add other notification endpoints here (create, read, delete) ---
// exports.notificationCreate = ...
// exports.notificationMarkRead = ...
// exports.notificationDelete = ...