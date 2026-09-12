require("dotenv").config();

const express = require("express");

const {
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand
} = require("@aws-sdk/client-s3");

const {
    DynamoDBDocumentClient,
    PutCommand,
    DeleteCommand,
    ScanCommand,
    GetCommand
} = require("@aws-sdk/lib-dynamodb");

const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { v4: uuidv4 } = require("uuid");

const s3 = require("./config/s3");
const dynamodb = require("./config/dynamodb");
const upload = require("./middleware/upload");

const app = express();

const PORT = 3000;


// DynamoDB Document Client
const docClient = DynamoDBDocumentClient.from(dynamodb);



app.set("view engine", "ejs");

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));


// Homepage
app.get("/", async (req, res) => {

    try {

        const { ScanCommand } = require("@aws-sdk/lib-dynamodb");

        const command = new ScanCommand({
            TableName: "Files"
        });

        const result = await docClient.send(command);

        res.render("index", {
            files: result.Items || []
        });

    } catch (error) {

        console.error("Error fetching files:", error);

        res.status(500).send("Failed to load files.");

    }

});


// Upload file
app.post("/upload", upload.single("file"), async (req, res) => {

    try {

        if (!req.file) {
            return res.status(400).send("Please select a file.");
        }

        // Generate unique ID
        const id = uuidv4();

        // S3 file path
        const s3Key = `uploads/${id}-${req.file.originalname}`;


        // -------------------------
        // Upload file to S3
        // -------------------------

        const s3Command = new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: s3Key,
            Body: req.file.buffer,
            ContentType: req.file.mimetype
        });

        await s3.send(s3Command);


        // -------------------------
        // Save metadata to DynamoDB
        // -------------------------

        const dynamodbCommand = new PutCommand({
            TableName: "Files",

            Item: {
                id: id,
                fileName: req.file.originalname,
                fileSize: req.file.size,
                s3Key: s3Key,
                shareToken: uuidv4(),
                uploadedAt: new Date().toISOString()
            }
        });

        await docClient.send(dynamodbCommand);


        console.log("File uploaded successfully:", req.file.originalname);

        res.redirect("/");


    } catch (error) {

        console.error("Upload error:", error);

        res.status(500).send("Failed to upload file.");

    }

});

app.post("/delete/:id", async (req, res) => {

    try {

        const id = req.params.id;


        // Find the file in DynamoDB
        const getCommand = new GetCommand({
            TableName: "Files",

            Key: {
                id: id
            }
        });

        const result = await docClient.send(getCommand);

        if (!result.Item) {
            return res.status(404).send("File not found.");
        }


        // Delete file from S3
        const s3Command = new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: result.Item.s3Key
        });

        await s3.send(s3Command);


        // Delete metadata from DynamoDB
        const dynamodbCommand = new DeleteCommand({
            TableName: "Files",

            Key: {
                id: id
            }
        });

        await docClient.send(dynamodbCommand);


        console.log("File deleted:", result.Item.fileName);

        res.redirect("/");


    } catch (error) {

        console.error("Delete error:", error);

        res.status(500).send("Failed to delete file.");

    }

});

app.get("/share/:token", async (req, res) => {

    try {

        const token = req.params.token;

        // Find the file using the share token
        const command = new ScanCommand({
            TableName: "Files",

            FilterExpression: "shareToken = :token",

            ExpressionAttributeValues: {
                ":token": token
            }
        });

        const result = await docClient.send(command);

        // Token doesn't exist
        if (!result.Items || result.Items.length === 0) {
            return res.status(404).send("Invalid or expired share link.");
        }

        const file = result.Items[0];


        // Create S3 download command
        const s3Command = new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: file.s3Key
        });


        // Generate temporary URL
        const signedUrl = await getSignedUrl(s3, s3Command, {
            expiresIn: 900
        });


        // Redirect user to S3
        res.redirect(signedUrl);


    } catch (error) {

        console.error("Share error:", error);

        res.status(500).send("Failed to generate download link.");

    }

});

app.listen(PORT, () => {
    console.log(`CloudShare running at http://localhost:${PORT}`);
});