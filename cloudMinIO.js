const Minio = require("minio");
const fs = require("fs");
const path = require("path");
const { uuid } = require("uuidv4");
const { db } = require("./db/postgresql");
const { createReceiptSync } = require("./modules/receiptSync");
const { createReceiptSyncRepo } = require("./modules/receiptSyncRepo");

require("dotenv").config();

//=============================================================== // Initialize Minio client
const minioClient = new Minio.Client({
  endPoint: process.env.ENDPOINT_MINIO,
  port: Number(process.env.PORT_MINIO),
  useSSL: true,
  accessKey: process.env.ACCESSKEY,
  secretKey: process.env.SECRETKEY,
});

//=============================================================== // Check if the bucket exists
const bucketName = "zoo-app";
const REMOTE_PREFIX = "import/offline-sales";

(async () => {
  try {
    if (await minioClient.bucketExists(bucketName)) {
      console.log(`Bucket ${bucketName} already exists`);
    } else {
      await minioClient.makeBucket(bucketName, "us-east-1");
      console.log(`Bucket ${bucketName} created successfully`);
    }
  } catch (err) {
    console.log(err);
  }
})();

//=============================================================== // Receipt sync
const NOT_FOUND_CODES = new Set(["NotFound", "NoSuchKey", "NoSuchObject"]);

const minioStorage = {
  async stat(objectName) {
    try {
      const s = await minioClient.statObject(bucketName, objectName);
      return { size: s.size, etag: s.etag };
    } catch (err) {
      if (NOT_FOUND_CODES.has(err.code)) return null;
      throw err;
    }
  },
  async put(objectName, localPath) {
    await minioClient.fPutObject(bucketName, objectName, localPath, { "Content-Type": "text/csv" });
  },
};

async function writeCsv(filePath, header, records) {
  const createCsvWriter = require("csv-writer").createObjectCsvWriter;
  await createCsvWriter({ path: filePath, header }).writeRecords(records);
}

const repo = createReceiptSyncRepo(db);
const receiptSync = createReceiptSync({
  repo,
  storage: minioStorage,
  writeCsv,
  baseDir: "./fileuploads",
  remotePrefix: REMOTE_PREFIX,
  newId: uuid,
});

// cron 00:05 และ GET /uploadscsv
// กวาด receipt ที่ยังไม่ success -> สร้าง CSV -> เช็ค/อัป MinIO -> flag -> ลบ local เมื่อครบ
exports.createReceipt = async function () {
  try {
    return await repo.withSyncLock(() => receiptSync.runDailySync());
  } catch (error) {
    console.error("Error CSV:", error.message);
    return { error: error.message };
  }
};

// cron ทุกชั่วโมง (นาทีที่ 30) และ GET /receiptretry
// ส่งซ้ำเฉพาะรายการที่ยังค้าง ; ไม่มีของค้างก็ไม่ทำอะไร
exports.retryPendingReceipt = async function () {
  try {
    return await repo.withSyncLock(() => receiptSync.runPendingRetry());
  } catch (error) {
    console.error("Error CSV retry:", error.message);
    return { error: error.message };
  }
};

// GET /receiptsyncstatus?days=7  -> สถานะรายวัน ครบหรือยัง ครบเวลาไหน
exports.receiptSyncStatus = async function (days = 7) {
  return receiptSync.getStatus({ days });
};

// GET /uploadreceipt
// เช็คโฟลเดอร์ที่ค้างใน fileuploads (+ datacsv ที่วางไฟล์มือ) กับ MinIO แล้วอัปส่วนที่ขาด
// fileuploads: ลบเมื่อครบ / datacsv: ไม่ลบ
exports.uploadReceipt = async function () {
  try {
    return await repo.withSyncLock(() => receiptSync.reconcileLeftovers({ extraFolders: ["./datacsv"] }));
  } catch (error) {
    console.error("Error CSV:", error.message);
    return { error: error.message };
  }
};

async function downloadAll(bucketName,remoteFolderPath, localFolderPath) {
  try {
    // Ensure the local folder exists
    fs.mkdirSync(localFolderPath, { recursive: true });

    const stream = minioClient.listObjects(bucketName, '', true); // remoteFolderPath is now '' (root)

    stream.on('data', async (obj) => {
      if (obj.prefix) {
        // Skip directory prefixes
        return;
      }

      const localFilePath = path.join(localFolderPath, obj.name);
      const localDirPath = path.dirname(localFilePath);

      // Create necessary directories
      fs.mkdirSync(localDirPath, { recursive: true });

      await new Promise((resolve, reject) => {
        minioClient.fGetObject(bucketName, obj.name, localFilePath, (err) => {
          if (err) {
            console.error(`Error downloading ${obj.name}:`, err);
            reject(err);
          } else {
            console.log(`Downloaded ${obj.name} to ${localFilePath}`);
            resolve();
          }
        });
      });
    });

    stream.on('error', (err) => {
      console.error('Error listing objects:', err);
    });

    stream.on('end', () => {
      console.log('Download complete.');
    });
  } catch (error) {
    console.error('An error occurred:', error);
  }
}
