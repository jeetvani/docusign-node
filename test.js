const PDFDocument = require('pdfkit');
const AWS = require('aws-sdk');
const { awsSdk } = require('./awsSDK');
const paypal = require('@paypal/checkout-server-sdk');
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

    console.log("LOI ID", LOIid)

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

    //get month from created date
    const createdDate = new Date(finalLOIObj.createdAt)
    const finalDate = createdDate.toLocaleString().split(',')[0];
    const month = getMonthInLetters(finalLOIObj.createdAt);

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

    // Add image with link below that
    // Assuming you have an image stored locally as "image.png"
    // You can draw the image in the PDF like this:
    // doc.image('image.png', x, y, { width, height });

    // Create a buffer to store PDF data
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', async () => {
        const pdfBuffer = Buffer.concat(buffers);

        const s3 = new awsSdk.S3();
        const bucketName = 'fuelgo6298ade9b22149b0a29df3eb5b35c40f33550-staging';
        const folderPath = 'LOIs';
        const params = {
            Bucket: bucketName,
            Key: `${folderPath}/${LOIid}.pdf`,
            Body: pdfBuffer,
            ContentType: 'application/pdf'
        };

        try {
            const upload = await s3.upload(params).promise();
            return res.send({
                message: 'PDF created and uploaded successfully',
                pdfUrl: upload.Location
            });
        } catch (error) {
            console.error('Error uploading file to S3:', error);
            return res.status(500).json({ message: 'Error uploading file to S3' });
        }
    });

    doc.end();
}


const payPalConfig = {
    mode: 'sandbox', //sandbox or live
    client_id: 'AeYujINFGrnlFLkJ_2LIU4uuuxguSpWX0dV7bAEmcXDuA0hC1OvzJNC9ew0F3ZUW-BayYs32I6Q5vwjc',
    client_secret: 'EKy6RmzYUqosustw0b6-YODV8HNjlwBgNLGgWGWN3jW1emwbC5EW3fMIkdT3HThxozWAUuZWSVKTWprO'
}

exports.createPaymentOrder = async (req, res) => {
    const environment = new paypal.core.SandboxEnvironment(payPalConfig.client_id, payPalConfig.client_secret);
    const client = new paypal.core.PayPalHttpClient(environment);

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
            amount: {
                currency_code: 'USD',
                value: '10.00'
            }
        }]
    });
    try {
        const response = await client.execute(request);
        const orderId = response.result.id;
        const paymentLink = response.result.links.find(link => link.rel === 'approve').href;
        res.status(200).json({ orderId, paymentLink });
    } catch (err) {
        console.error('Error creating order:', err);
        res.status(500).json({ error: 'Failed to create order' });
    }

}