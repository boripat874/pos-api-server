const Minio = require("minio");
const fs = require("fs");
const path = require("path");
const {db} = require("./db/postgresql");
const date = require("date-and-time");
// const { uuid } = require("uuidv4");
// const multer = require("multer");
// const { console } = require("inspector");
// const jwt = require("jsonwebtoken"); // ใช้สําหรับสร้างและตรวจสอบ JWT

require("dotenv").config();

const cron = require("node-cron");

const remoteFolderPath = "data"; // Path to the folder in MinIO
const localFolderPath = "storage"; // Local path to save the folder

//=============================================================== // Initialize Minio client
const minioClient = new Minio.Client({
  endPoint: process.env.ENDPOINT_MINIO,
  port: process.env.PORT_MINIO,
  useSSL: true,
  accessKey: process.env.ACCESSKEY,
  secretKey: process.env.SECRETKEY,
});

//=============================================================== // Check if the bucket exists
const bucketName = "zoo-app";
minioClient.bucketExists(bucketName, (err, exists) => {
  if (err) {
    return console.log(err);
  }
  if (exists) {
    console.log(`Bucket ${bucketName} already exists`);
  } else {
    // Make a new bucket
    minioClient.makeBucket(bucketName, "us-east-1", (err) => {
      if (err) {
        return console.log(err);
      }
      console.log(`Bucket ${bucketName} created successfully`);
    });
  }
});

exports.createReceipt = async function  () {

    try {

        // Calculate yesterday's start and end timestamps (in seconds)
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const TwoDaysAgo = new Date(now);
        TwoDaysAgo.setDate(now.getDate() - 2);
        
        const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 1);
        const end = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
        const timeStamp = {
            startTimestamp: Math.floor(start.getTime() / 1000),
            endTimestamp: Math.floor(end.getTime() / 1000)
        };

        // Query shop list from the database
        const shops = await db("shopinfo").select("shopid", "shopnameth", "shopnameeng").where({ status: true });

        const dateYesterday = date.format(yesterday, "YYYY-MM-DD");

        // Define folder path for CSV storage
        const folderPath = `./fileuploads/${dateYesterday}`;
        // Create the folder if it does not exist
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        

        const shopPromises = shops.map(async (shop) => {

          const shopid = shop.shopid;

          // console.log(shopid);

          // Query receipt list from the database
          const receipts = await db("orderinfo")
            .join(
              "receiptinfo",
              "orderinfo.ordernumber",
              "receiptinfo.ordernumber"
            )
            .join("shopinfo", "orderinfo.shopid", "shopinfo.shopid")
            .where({ "orderinfo.shopid": shopid })
            .andWhere("receiptinfo.create_at", ">=", timeStamp.startTimestamp)
            .andWhere("receiptinfo.create_at", "<", timeStamp.endTimestamp)
            .orderBy("receiptinfo.create_at", "desc")
            .select(
              "orderinfo.shopid as shopid",
              "receiptinfo.receiptid as receiptid",
              "receiptinfo.ordernumber as ordernumber",
              "receiptinfo.receiptnumber as receiptnumber",
              "receiptinfo.paymentType as paymentType",
              "receiptinfo.receiptcash as receiptcash",
              "receiptinfo.receiptchange as receiptchange",
              "receiptinfo.receiptdiscount as receiptdiscount",
              "receiptinfo.totalprice as totalprice",
              "receiptinfo.urlfile as urlfile",
              "receiptinfo.create_at as create_at",
              "shopinfo.shoptype as shoptype"
            );

          const resultReceipts = receipts.map(receipt => {
              return {
                  ordernumber: receipt.ordernumber,
                  type: receipt.shoptype,
                  orderstatus: "COMPLETED",
                  create_at: date.format(new Date(receipt.create_at * 1000), "YYYY-MM-DDTHH:mm:ss") + "+07:00",
                  totalgrossamount: Number(receipt.totalprice)+Number(receipt.receiptdiscount),
                  totalprice: receipt.totalprice,
                  source: "POS"
              };
          });
  
          // Use csv-writer to create a CSV file (install with: npm install csv-writer)
          const createCsvWriter = require("csv-writer").createObjectCsvWriter;
          const csvWriter = createCsvWriter({
              path: `${folderPath}/${shopid}-${dateYesterday}.csv`,
              header: [
                  { id: "ordernumber", title: "OrderNumber" },
                  { id: "type", title: "Type" },
                  { id: "orderstatus", title: "OrderStatus" },
                  { id: "create_at", title: "TransactionDate" },
                  { id: "totalgrossamount", title: "TotalGrossAmount" },
                  { id: "totalprice", title: "TotalNetAmount" },
                  { id: "source", title: "Source" }
              ]
          });
  
          // Write the CSV file with the queried data
          await csvWriter.writeRecords(resultReceipts);
          
        })

        await Promise.all(shopPromises);
        
        // Later in your createReceipt function:
        await uploadFolder(folderPath, bucketName,`import/offline-sales`)
        .then(() => {
            
            // After successful upload, remove the folder
            fs.rmSync(folderPath, { recursive: true, force: true });
            console.log(`Deleted folder ${folderPath} after upload.`);
        })


        // console.log(timeStamp.startTimestamp);
        // console.log(timeStamp.endTimestamp);

        return "CSV file created and uploaded successfully.";

    } catch (error) {
        console.error("Error CSV:", error.message);
    }
}

exports.uploadReceipt = async function  () {

  try {

      // Define folder path for CSV storage
      const folderPath = `./datacsv`;
      
      // Later in your createReceipt function:
      await uploadFolder(folderPath, bucketName,`import/offline-sales`);

      return "CSV file uploaded successfully.";

  } catch (error) {
      console.error("Error CSV:", error.message);
  }
}

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

async function uploadFolder(folderPath, bucketName, remotePath) {
    const files = await fs.promises.readdir(folderPath);
    for (const file of files) {
        const filePath = path.join(folderPath, file);
        const stat = await fs.promises.stat(filePath);
        if (stat.isDirectory()) {
            // Recursively upload subfolders
            await uploadFolder(filePath, bucketName, path.join(remotePath, file));
        } else {
            const remoteFilePath = path.join(remotePath, file);
            await new Promise((resolve, reject) => {
                minioClient.fPutObject(bucketName, remoteFilePath, filePath, (err, etag) => {
                    if (err) {
                        console.log(`Error uploading ${filePath}: ${err}`);
                        return reject(err);
                    }
                    console.log(`File ${filePath} uploaded successfully. ETag: ${etag}`);
                    resolve();
                });
            });
        }
    }
}

// async function runserver() {
//   await uploadFolder(folderPath, bucketName);
//   // await downloadFolder(bucketName, remoteFolderPath, localFolderPath);
//     //   await downloadAll(bucketName,remoteFolderPath, localFolderPath);
// }
