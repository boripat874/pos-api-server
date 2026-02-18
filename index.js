const https = require('https');
const express = require("express");
const path = require("path");
const fs = require("fs");
const swaggerUi = require("swagger-ui-express");
const YAML = require('yamljs');
const openApi = require("./routes/openApiroutes"); //API
const apiBackoffice = require("./routes/backoffice");
const pos = require("./routes/pos");
var bodyParser = require('body-parser')
const app = express();
const cors = require("cors");
const {createReceipt,uploadReceipt} = require("./cloudMinIO");
const {setshoplot} = require("./setshopslot");
const cron = require("node-cron");

require("dotenv").config();

// const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  key: fs.readFileSync(path.join(__dirname, 'private.key')),
  cert: fs.readFileSync(path.join(__dirname, 'certificate.crt'))
};

const swaggerDocument = YAML.load('./API_POS_OpenAPI.yml');
const swaggerDocumentPossystem = YAML.load('./API_POS_System.yml');

// app.use(cors());
const corsOptions = {
    // origin: ['http://58.136.159.58:3001', 'http://localhost:3000'], // เพิ่ม origin ที่ต้องการอนุญาตใน array นี้
    // origin: 'http://58.136.159.58:3001',
    origin: true,
    credentials: true,
};
// 58.136.159.58

app.use(cors(corsOptions));

app.use(express.urlencoded({ extended: true }))
app.use(express.json()); 

app.use('/api',openApi); // Use Routes API
app.use('/api',apiBackoffice);
app.use('/api',pos);

// app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
// app.use('/api-docs-pos', swaggerUi.serve, swaggerUi.setup(swaggerDocumentPossystem));

app.use(
    '/api-docs',
    swaggerUi.serveFiles(swaggerDocument),
    swaggerUi.setup(swaggerDocument)
);

app.use(
    '/api-docs-pos',
    swaggerUi.serveFiles(swaggerDocumentPossystem),
    swaggerUi.setup(swaggerDocumentPossystem)
);
app.use("/uploads", express.static("uploads"));

(async () => {
  await setshoplot(); // if setshoplot returns a promise

  // cron job to update send csv to minio

    cron.schedule("5 0 * * *", async () => {
        try {
        console.log("Running cron job at 00:01 every day");
        console.log(await createReceipt());
        } catch (error) {
        console.error("Error CSV:", error.message);
        }
    });
})();

app.get("/uploadscsv", async(req, res) => {

    try {

        res.send(await createReceipt());

    }catch (error) {
        console.error("Error csv:", error.message);
        res.send(error.message);
    }
    
})

app.get("/uploadreceipt", async(req, res) => {

    try {

        res.send(await uploadReceipt());

    }catch (error) {
        console.error("Error csv:", error.message);
        res.send(error.message);
    }
    
})
// app.use('/pdf')

// หน้าแรก
app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>POS Server Status</title>
            <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏃</text></svg>">
        </head>

        <body style="display: flex; 
            justify-content: center; 
            align-items: center; 
            height: 100vh; 
            margin: 0; 
            font-family: 
            sans-serif; 
            font-size: 2em;
        ">

            <div
                style="
                    background-color: #3EB776;
                    color: #fff;
                    padding: 20px;
                    border-radius: 10px;
                    text-align: center;
                ">
            🏃POS Server is running!
            </div>
        </body>
        </html>
    `);
});

// Start the server
const port = process.env.Port;

// Create the HTTPS server manually
const server = https.createServer(options, app);

server.listen(PORT, () => {
    console.log(`🚀 Secure Server is running on https://localhost:${PORT}`);
});

// Optional: Error handling for Windows port conflicts
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`❌ Error: Port ${PORT} is already in use by another service (likely IIS or Skype).`);
  } else if (e.code === 'EACCES') {
    console.error(`❌ Error: You must run Terminal as Administrator to use port ${PORT}.`);
  } else {
    console.error(e);
  }
});
// app.listen(port, function () {
//     console.log(`Server is running on http://localhost:${port}`);
// });



