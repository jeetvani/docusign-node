const PDFDocument = require('pdfkit');
const fs = require('fs');
const AWS = require('aws-sdk');
const { awsSdk } = require('./awsSDK');

exports.createPDF = async (req, res) => {

    function getMonthInLetters(dateString) {
        const date = new Date(dateString);
        const monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];
        const monthIndex = date.getMonth(); // Get the month (0 to 11)
        const monthName = monthNames[monthIndex];
        return monthName;
    }
    const { LOIid } = req.body
    if (!LOIid) {
        return res.status(400).json({ message: 'LOIid is required' });
    }
    console.log("LOI ID",LOIid)
    const dynamoDB = new awsSdk.DynamoDB()

    //get data from table LOI-hehdmsyuubfkbfai6tdtjjoxiq-staging
    const params = {
        TableName: 'LOI-hehdmsyuubfkbfai6tdtjjoxiq-staging',
        Key: {
            id: { S: LOIid }
        }
    }

    let data;
    try {
        data = await dynamoDB.getItem(params).promise()
    } catch (error) {
        console.log('Error getting data from DynamoDB:', error);
        return res.status(500).json({ message: 'Error getting data from DynamoDB' });
    }
    const item = data.Item;
    if (!item) {
        return res.status(404).json({ message: 'LOI not found' });
    }
    //convert item to json
    const finalLOIObj = AWS.DynamoDB.Converter.unmarshall(item)

    // Create a new PDF document
    const doc = new PDFDocument();


    //get moneth from created date
    const createdDate = new Date(finalLOIObj.createdAt)
    const finalDate = createdDate.toLocaleString().split(',')[0];
    const month = getMonthInLetters(finalLOIObj.createdAt);

    // Pipe the PDF content to a writable stream, in this case, a file stream
    const writeStream = fs.createWriteStream(`${LOIid}.pdf`);
    doc.pipe(writeStream);

    // Add content to the PDF document
    doc.fontSize(24);
    doc.text(`
 Letter of Intent (LOI)
  `, 100, 100);


    //at right corner
    doc.fontSize(12);
    doc.text(`
    Month : ${month}
    `, 400, 100);

    //below that date
    doc.fontSize(12);
    doc.text(`
    Date : ${finalDate}
    `, 400, 120);

    // Finalize the PDF document
    const text = `We, FuelGo, a duly authorized Buyer Agent of our customer, registered with address at 708 S. 6th st, Champaign, Illinois, represented in this negotiation by Jack Dayan, submit the present LOI and confirm our customer interest in purchasing the following commodity from the Seller.`

    //below that text
    doc.fontSize(12);
    doc.text(text, 100, 200);



    const jsonData = [finalLOIObj]



    //mapping json data
    let y = 300;

    //remove all keys starting with _
    const filteredJsonData = jsonData.map((data) => {
        const filteredData = {};
        for (const [key, value] of Object.entries(data)) {
            if (!key.startsWith('_')) {
                filteredData[key] = value;
            }
        }
        return filteredData;
    });

    //all are in camel case so make first letter capital and space between words
    const finalData = filteredJsonData.map((data) => {
        const formattedData = {};
        for (const [key, value] of Object.entries(data)) {
            const formattedKey = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
            formattedData[formattedKey] = value;
        }
        return formattedData;
    }
    );


    finalData.forEach((data) => {
        for (const [key, value] of Object.entries(data)) {
            doc.fontSize(12);
            doc.text(`${key} : ${value}`, 100, y);
            y = y + 20;
        }
    });




    //add image wiht link below that





    doc.end();
    // Listen for 'finish' event to know when the PDF is written successfully
    writeStream.on('finish', () => {
        console.log('PDF created successfully');
    });

    // Listen for errors during writing the PDF
    writeStream.on('error', (err) => {
        console.error('Error creating PDF:', err);
    });

    const pdfBlob = fs.readFileSync(`${LOIid}.pdf`);
    const s3Buc = new awsSdk.S3()
    const bucketName = 'fuelgo6298ade9b22149b0a29df3eb5b35c40f33550-staging';
    const folderPath = 'LOIs';
    const params2 = {
        Bucket: bucketName,
        Key: `${folderPath}/${LOIid}.pdf`,
        Body: pdfBlob,
        ContentType: 'application/pdf'
    }
    try {
        const upload = await s3Buc.upload(params2).promise()

        return res.send({
            message: 'PDF created successfully',
            pdfUrl: upload.Location

        });
    }
    catch (error) {
        console.log('Error uploading file to S3:', error);
        return res.status(500).json({ message: 'Error uploading file to S3' });
    }


}

// Call the function to create the PDF

