const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
dotenv.config();

const RWA_TEMPLATE_ID = "024ab86d-f47c-435a-bfd6-82852d09f8d9"
const paypal = require('@paypal/checkout-server-sdk');
const docusign = require("docusign-esign");
const fs = require("fs");
const session = require("express-session");
const { awsSdk } = require("./awsSDK");
const AWS = require("aws-sdk");
const cors = require("cors");
const { createPDF, createPaymentOrder } = require("./test");
const { randomUUID } = require("crypto");
const app = express();

const payPalConfig = {
    mode: 'sandbox', //sandbox or live
    client_id: 'AQCp0u-hOnXI6Whdyrdb2E4QaskE5PWghl2tyUhUoZFY9pQQRy961hpKYdIs8ZfgcVInFtywieiaeqan',
    client_secret: 'EBxDXbOWTxRmk5rnjtaGDRVGnGDNSZt9AqZ-Z4UA-kGdGZGWgs5fYvuaovAODdM7tC147PusUsh4KccB'
}
const environment = new paypal.core.SandboxEnvironment(payPalConfig.client_id, payPalConfig.client_secret);
const client = new paypal.core.PayPalHttpClient(environment);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: "dfsf94835asda",
    resave: true,
    saveUninitialized: true,
}));
app.use(cors({

    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    preflightContinue: false,

}))

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept , Authorization");
    next();
})

app.use(express.json());

function getEnvelopesApi(request) {
    let dsApiClient = new docusign.ApiClient();
    dsApiClient.setBasePath(process.env.BASE_PATH);
    dsApiClient.addDefaultHeader('Authorization', 'Bearer ' + request.session.access_token);
    return new docusign.EnvelopesApi(dsApiClient);
}

function makeEnvelope(names, emails, tabsArray) {
    let env = new docusign.EnvelopeDefinition();
    const expirationDate = new Date();
    expirationDate.setMinutes(expirationDate.getMinutes() + 10); // Set expiration to 10 minutes from now

    env.expireAfter = expirationDate.toISOString();
    console.log("expirationDate");
    console.log(env.expireAfter);
    console.log("expirationDate");
    env.emailSubject = "Fuel Go Contract";
    env.templateId = process.env.TEMPLATE_ID;
    env.recipients = new docusign.Recipients();

    env.templateRoles = [{
        email: emails[0],
        name: names[0],
        roleName: 'seller',
        tabs: tabsArray[0], // Provide tabs for the current recipient
    }, {
        email: emails[1],
        name: names[1],
        roleName: 'buyer',
        tabs: tabsArray[1], // Provide tabs for the current recipient
    }];
    console.log(JSON.stringify(env.templateRoles));
    // Initialize an array to hold template roles
    // const templateRoles = [];

    // // Loop through names, emails, and tabsArray
    // for (let i = 0; i < names.length && i < emails.length && i < tabsArray.length; i++) {
    //   // Construct a template role for each recipient
    //   const signer = docusign.TemplateRole.constructFromObject({
    //     email: emails[i],
    //     name: names[i],
    //     roleName: 'Applicant',
    //     tabs: tabsArray[i], // Provide tabs for the current recipient
    //   });
    //   // Push the template role to the array
    //   templateRoles.push(signer);
    // }

    //env.templateRoles = templateRoles;
    env.status = "sent";

    return env;
}


function makeRWAEnvelope({ name, email, tabs }) {
    let env = new docusign.EnvelopeDefinition();

    console.log("expirationDate");
    console.log(env.expireAfter);
    console.log("expirationDate");
    env.emailSubject = "RWA Contract";
    env.templateId = RWA_TEMPLATE_ID;
    env.recipients = new docusign.Recipients();

    env.templateRoles = [{
        email: email,
        name: name,
        roleName: 'banker',
        tabs: tabs

    }];


    env.status = "sent";

    return env;
}

function makeRecipientViewRequest(name, email) {

    let viewRequest = new docusign.RecipientViewRequest();

    viewRequest.returnUrl = "http://localhost:3000/success";
    viewRequest.authenticationMethod = 'none';

    // Recipient information must match embedded recipient info
    // we used to create the envelope.
    viewRequest.email = email;
    viewRequest.userName = name;


    return viewRequest
}


async function checkToken(request) {
    if (request.session.access_token && Date.now() < request.session.expires_at) {
        console.log("re-using access_token ", request.session.access_token);
    } else {
        console.log("generating a new access token");
        let dsApiClient = new docusign.ApiClient();
        dsApiClient.setBasePath(process.env.BASE_PATH);
        const results = await dsApiClient.requestJWTUserToken(
            process.env.INTEGRATION_KEY,
            process.env.USER_ID,
            "signature",
            fs.readFileSync(path.join(__dirname, "private.key")),
            3600
        );
        console.log(results.body);
        request.session.access_token = results.body.access_token;
        request.session.expires_at = Date.now() + (results.body.expires_in - 60) * 1000;
    }
}


app.get("/success", (request, resposne) => {
    resposne.send("Success");
});


app.post('/initiateSignature', async(request, response) => {
    const { LOIid } = request.body;
    console.log("LOIid", LOIid);
    try {
        if (!LOIid) {
            response.send("LOIid is required");
            return
        }

        const dynamodb = new awsSdk.DynamoDB()
            //get table  PendingICPO table
        const params = {
            TableName: "PendingICPO",


        };
        const result = await dynamodb.scan(params).promise();
        console.log(result);

        const finalResult = result ? result.Items.map((item) => { return AWS.DynamoDB.Converter.unmarshall(item) }) : [];


        const findUsingLOIid = finalResult.find((item) => item.LOIid === LOIid);
        console.log(findUsingLOIid);
        if (!findUsingLOIid) {
            response.send("LOIid not found");
            return
        }
        if (findUsingLOIid.contractSent) {
            return response.send({
                message: "Contract is already sent for signature"
            });
        }
        if (findUsingLOIid) {

            if (findUsingLOIid.sellerApproved && findUsingLOIid.buyerApproved) {


                // get data from LOI-hehdmsyuubfkbfai6tdtjjoxiq-staging
                const params = {
                    TableName: "LOI-hehdmsyuubfkbfai6tdtjjoxiq-staging",
                    Key: {
                        "id": { S: LOIid }
                    }

                };
                const result = await dynamodb.getItem(params).promise();

                const finalResult = result ? AWS.DynamoDB.Converter.unmarshall(result.Item) : [];
                console.log(finalResult);
                const loiResult = finalResult
                console.log("loiResult", loiResult)

                //scrap this using UserInformation-hehdmsyuubfkbfai6tdtjjoxiq-staging buyerID  fuelingvendorID
                const buyerID = finalResult.buyerID;
                const fuelingvendorID = finalResult.fuelingvendorID;
                const params1 = {
                    TableName: "UserInformation-hehdmsyuubfkbfai6tdtjjoxiq-staging",
                    Key: {
                        "id": { S: buyerID }
                    }

                };
                const result1 = await dynamodb.getItem(params1).promise();

                const finalResult1 = result1 ? AWS.DynamoDB.Converter.unmarshall(result1.Item) : [];



                const params2 = {
                    TableName: "UserInformation-hehdmsyuubfkbfai6tdtjjoxiq-staging",
                    Key: {
                        "id": { S: fuelingvendorID }
                    }
                };
                const result2 = await dynamodb.getItem(params2).promise();
                const finalResult2 = result2 ? AWS.DynamoDB.Converter.unmarshall(result2.Item) : [];
                console.log("Vednor Details", finalResult2);
                console.log("Buyer Details", finalResult1);

                ///getting vendor email using  companyinformationID fro table CompanyInformation-hehdmsyuubfkbfai6tdtjjoxiq-staging
                //get all data from CompanyInformation-hehdmsyuubfkbfai6tdtjjoxiq-staging
                const params3 = {
                    TableName: "CompanyInformation-hehdmsyuubfkbfai6tdtjjoxiq-staging"
                };
                const result3 = await dynamodb.scan(params3).promise();
                const finalResult3 = result3 ? result3.Items.map((item) => { return AWS.DynamoDB.Converter.unmarshall(item) }) : [];
                console.log("All Data", finalResult3);
                const vendorObj = finalResult3.find((item) => item.id == finalResult2.companyinformationID)


                const buyerObj = finalResult3.find((item) => item.id == finalResult1.companyinformationID)
                console.log("Buyer Object", buyerObj)
                console.log("Vendor Object", vendorObj)
                const buyerEmail = buyerObj.companyEmail
                const vendorEmail = vendorObj.companyEmail
                const buyerName = buyerObj.companyName
                const vendorName = buyerObj.companyName

                //get bank details from table  FinancialInformation-hehdmsyuubfkbfai6tdtjjoxiq-staging using id
                //get vendorbankDetisl 
                const paramsForBankAccounts = {
                    TableName: "FinancialInformation-hehdmsyuubfkbfai6tdtjjoxiq-staging"
                }
                const bankAccounts = await dynamodb.scan(paramsForBankAccounts).promise();
                const finalBankAccounts = bankAccounts ? bankAccounts.Items.map((item) => { return AWS.DynamoDB.Converter.unmarshall(item) }) : [];

                const sellerBankAccount = finalBankAccounts.find((item) => item.id == vendorObj.id)
                const buyerBankAccount = finalBankAccounts.find((item) => item.id == buyerObj.id)

                console.log("sellerBankAccount", sellerBankAccount)
                console.log("buyerBankAccount", buyerBankAccount)
                const company = "Fuel Go";
                const name1 = vendorName
                const email1 = vendorEmail;
                const name2 = buyerName;
                const email2 = buyerEmail;
                await checkToken(request);
                let tabs = docusign.Tabs.constructFromObject({
                    textTabs: [{
                            tabLabel: "vendor_id",
                            value: fuelingvendorID,
                            locked: "true"
                        }, {
                            tabLabel: "contract_duration",
                            value: loiResult.contractDuration,
                            locked: "true"

                        },
                        {
                            tabLabel: "vendor_country",
                            value: finalResult.origin,
                            locked: "true"
                        }, {
                            tabLabel: "buyer_company",
                            value: buyerObj.companyName,
                            locked: "true"
                        }, {
                            tabLabel: "buyer_id",
                            value: buyerID,
                            locked: "true"
                        },
                        {
                            tabLabel: "buyer_country",
                            value: finalResult.country,
                            locked: "true"
                        },
                        {
                            tabLabel: "fuel_type",
                            value: finalResult.fuelType,
                            locked: "true"

                        },
                        {
                            tabLabel: "quantity",
                            value: finalResult.quantity,
                            locked: "true"
                        }, {
                            tabLabel: "price",
                            value: finalResult.price,
                            locked: "true"
                        }, {
                            tabLabel: "seller_bank_name",
                            value: sellerBankAccount.accountName,
                            locked: "true"
                        }, {
                            tabLabel: "seller_bank_address",
                            value: vendorObj.companyAddress,
                            locked: "true"
                        }, {
                            tabLabel: "seller_account_number",
                            value: sellerBankAccount.accountNumber,
                            locked: "true"
                        },
                        {
                            tabLabel: "seller_aba",
                            value: sellerBankAccount.IBAN,
                            locked: "true"
                        },
                        {
                            tabLabel: "seller_account_name",
                            value: sellerBankAccount.accountName,
                            locked: "true"

                        }, {
                            tabLabel: "seller_swift",
                            value: sellerBankAccount.SWIFT,
                            locked: "true"
                        }, {
                            tabLabel: "seller_bank_officer",
                            value: sellerBankAccount.finRepName,
                            locked: "true"

                        }, {
                            tabLabel: "seller_bank_tel",
                            value: vendorObj.companyPhone,
                            locked: "true"
                        }, {
                            tabLabel: "seller_bank_email",
                            value: sellerBankAccount.finRepEmail,
                            locked: "true"
                        },
                        //same for buyer
                        {
                            tabLabel: "buyer_bank_name",
                            value: buyerBankAccount.accountName,
                            locked: "true"
                        }, {
                            tabLabel: "buyer_bank_address",
                            value: buyerObj.companyAddress,
                            locked: "true"
                        }, {
                            tabLabel: "buyer_account_number",
                            value: buyerBankAccount.accountNumber,
                            locked: "true"
                        }, {
                            tabLabel: "buyer_account_name",
                            value: buyerBankAccount.accountName,
                            locked: "true"

                        }, {
                            tabLabel: "buyer_swift",
                            value: buyerBankAccount.SWIFT,
                            locked: "true"
                        }, {
                            tabLabel: "buyer_bank_officer",
                            value: buyerBankAccount.finRepName,
                            locked: "true"

                        }, {
                            tabLabel: "buyer_bank_tel",
                            value: buyerObj.companyPhone,
                            locked: "true"
                        },
                        {
                            tabLabel: "buyer_bank_aba",
                            value: buyerBankAccount.IBAN,
                            locked: "true"
                        },

                        {
                            tabLabel: "buyer_bank_email",
                            value: buyerBankAccount.finRepEmail,
                            locked: "true"
                        },
                        {
                            tabLabel: "buyer_name",
                            value: buyerObj.companyName,
                            locked: "true"
                        }, {
                            tabLabel: "date",
                            //format date dd/mm/yyyy
                            value: new Date().toLocaleDateString('en-GB'),
                            locked: "true"

                        }
                    ],
                });


                let envelopesApi = getEnvelopesApi(request);
                let envelope = makeEnvelope([name1, name2], [email1, email2], [tabs, tabs]);

                let results = await envelopesApi.createEnvelope(
                    process.env.ACCOUNT_ID, { envelopeDefinition: envelope });



                console.log("envelope results ", results.envelopeId);
                const envelopeId = results.envelopeId
                    // Create the recipient view, the Signing Ceremony
                let viewRequest = makeRecipientViewRequest(name1, email1);
                results = await envelopesApi.createRecipientView(process.env.ACCOUNT_ID, results.envelopeId, { recipientViewRequest: viewRequest });



                // update dynamodb PendingICPO table
                const updateParams = {
                    TableName: "PendingICPO",
                    Key: {
                        "LOIid": { S: LOIid }
                    },
                    //also set signedBy to buyer
                    UpdateExpression: "set #contractSent = :contractSent  , #signedBy = :signedBy , #envelopId = :envelopId,#envelopType = :envelopType ",
                    ExpressionAttributeNames: {
                        "#contractSent": "contractSent",
                        "#signedBy": "signedBy",
                        "#envelopId": "envelopId",
                        "#envelopType": "envelopType",



                    },
                    ExpressionAttributeValues: {
                        ":contractSent": { S: "true" }

                        ,
                        ":envelopId": { S: envelopeId },
                        ":envelopType": { S: "contract" },
                        ":signedBy": { S: "0" }

                    }
                };



                await dynamodb.updateItem(updateParams).promise();


                const updateEnvelopId = {
                    TableName: "PendingICPO",
                    Key: {
                        "LOIid": { S: LOIid }
                    },
                    UpdateExpression: "set #envelopId = :envelopId",
                    ExpressionAttributeNames: {
                        "#envelopId": "envelopId"
                    },
                    ExpressionAttributeValues: {
                        ":envelopId": { S: envelopeId }
                    }
                };
                await dynamodb.updateItem(updateEnvelopId).promise();



                return response.send({
                    message: "ICPO is approved by both parties and Contract is sent for signature",
                });
            }
            if (!findUsingLOIid.sellerApproved && !findUsingLOIid.buyerApproved) {
                response.status(409).send({ message: "ICPO is not approved by both parties" })
                return
            }
            if (findUsingLOIid.sellerApproved && !findUsingLOIid.buyerApproved) {
                response.status(409).send({ message: "Buyer has not approved the ICPO yet" })
                return
            }
            if (!findUsingLOIid.sellerApproved && findUsingLOIid.buyerApproved) {
                response.status(409).send({ message: "Seller has not approved the ICPO yet" })
                return
            }
            return
        }
    } catch (error) {
        console.log(error);
        response.status(500).send({ message: "Internal server error" });
        return
    }






});

app.post('/paymentWebhook', (req, res) => {
    // Verify webhook signature here

    const webhookEvent = req.body;
    console.log('Received webhook:', webhookEvent);

    if (webhookEvent.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        // Payment was successfully captured
        console.log('Payment captured successfully');

    } else if (webhookEvent.event_type === 'PAYMENT.CAPTURE.DENIED') {
        // Payment capture was denied
        console.log('Payment capture denied');
        // Handle accordingly
    }

    res.status(200).send('Webhook received');
});

app.post('/simulatePayment', async(req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).send({
                message: "orderId is required"
            });
        }

        const dynamodb = new awsSdk.DynamoDB()
        const params = {
            TableName: "Payments",
        };
        const result = await dynamodb.scan(params).promise();
        const finalResult = result ?
            result.Items.map((item) => { return AWS.DynamoDB.Converter.unmarshall(item) }) : [];

        if (!finalResult) {
            return res.status(404).send({
                message: "Order not found"
            });
        }

        const findOrder = finalResult.find((item) => item.orderId === orderId);
        if (!findOrder) {
            return res.status(404).send({
                message: "Order not found"
            });
        }

        const LOIid = findOrder.LOIid;
        const id = LOIid
        const params2 = {
            TableName: "LOI-hehdmsyuubfkbfai6tdtjjoxiq-staging",
            Key: {
                "id": { S: id }
            }
        };
        const result2 = await dynamodb.getItem(params2).promise();
        const finalResult2 = result2 ? AWS.DynamoDB.Converter.unmarshall(result2.Item) : [];
        const loiData = finalResult2;

        // getting CompanyInformationId from UserInformation-hehdmsyuubfkbfai6tdtjjoxiq-staging
        const params3 = {
            TableName: "UserInformation-hehdmsyuubfkbfai6tdtjjoxiq-staging",
            Key: {
                "id": { S: loiData.fuelingvendorID }
            }
        };
        const result3 = await dynamodb.getItem(params3).promise();
        const finalResult3 = result3 ? AWS.DynamoDB.Converter.unmarshall(result3.Item) : [];

        //getting financial info from FinancialInformation-hehdmsyuubfkbfai6tdtjjoxiq-staging

        const params4 = {
            TableName: "FinancialInformation-hehdmsyuubfkbfai6tdtjjoxiq-staging",
            Key: {
                "id": { S: finalResult3.companyinformationID }
            }

        }
        const result4 = await dynamodb.getItem(params4).promise()
        const finalResult4 = result3 ? AWS.DynamoDB.Converter.unmarshall(result4.Item) : [];


        await checkToken(req);
        let envelopesApi = getEnvelopesApi(req);


        let tabs = docusign.Tabs.constructFromObject({
            textTabs: [{
                    tabLabel: "date",
                    value: new Date().toLocaleDateString('en-GB'),
                    locked: "true"

                }, {
                    tabLabel: 'buyer_bank_name',
                    value: finalResult4.accountName,
                    locked: true
                }, {
                    tabLabel: 'buyer_swift',
                    value: finalResult4.SWIFT,
                    locked: true
                },
                {
                    tabLabel: 'buyer_name',
                    value: finalResult3.firstName,
                    locked: true
                },
                {
                    tabLabel: 'price',
                    value: finalResult2.price,
                    locked: true
                },
                {
                    tabLabel: 'account_number',
                    value: finalResult4.accountNumber,
                    locked: true
                },
                {
                    tabLabel: 'tel',
                    value: finalResult4.finRepPhone,
                    locked: true
                },
                {
                    tabLabel: 'buyer_iban',
                    value: finalResult4.IBAN,
                    locked: true
                },
                {
                    tabLabel: 'buyer_bank_name',
                    value: finalResult4.accountName,
                    locked: true
                },
                {
                    tabLabel: 'finRepEmail',
                    value: finalResult4.finRepEmail,
                    locked: true
                },
            ]

        })
        let envelope = await makeRWAEnvelope({
            email: finalResult4.finRepEmail,
            name: finalResult4.finRepName,
            tabs: tabs
        })
        let results = await envelopesApi.createEnvelope(
            process.env.ACCOUNT_ID, { envelopeDefinition: envelope });



        console.log("envelope results ", results.envelopeId);
        const envelopeId = results.envelopeId
            // Create the recipient view, the Signing Ceremony
        let viewRequest = makeRecipientViewRequest(finalResult4.finRepName, finalResult4.finRepEmail)
        results = await envelopesApi.createRecipientView(process.env.ACCOUNT_ID, results.envelopeId, { recipientViewRequest: viewRequest });



        //imitating a chat in table ChatMetadata-hehdmsyuubfkbfai6tdtjjoxiq-staging
        const chatHistoryId = randomUUID()
        var currentDate = new Date();

        // Get the current timestamp in milliseconds
        var timestamp = currentDate.getTime();
        const paramsInsert = {
            TableName: "ChatMetadata-hehdmsyuubfkbfai6tdtjjoxiq-staging",
            Item: {
                "id": { S: randomUUID() },
                "_typename": { S: "ChatMetaData" },
                // "_lastChangedAt": { S: timestamp },
                "_version": { S: "1" },
                "chathistoryID": { S: chatHistoryId },
                // "createdAt": { S: new Date().getTime() },
                "otherUserID": { S: orderId },
                // "updatedAt": { S: new Date().getTime() },
                "userinformationID": { S: chatHistoryId },
                "otherUserId": { S: chatHistoryId },
            }
        };

        dynamodb.putItem(paramsInsert, (err, data) => {
            if (err) {
                console.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
                return res.send({
                    err: JSON.stringify(err, null, 2)

                });
            } else {
                console.log("NEW PAYMENT ITEM ADDED")
                console.log("Added item:", JSON.stringify(data, null, 2));
                return res.send({
                    message: "Payment is successful || Chat Intimated ",
                    data: finalResult4,
                    envelope

                });
            }
        });



    } catch (error) {
        console.error("Error:", error);
        return res.status(500).send({
            message: "Internal Server Error"
        });
    }
});

app.post('/createPaymentOrder', createPaymentOrder)

app.post('/webhook', async(request, response) => {
    // console.log("webhook called");
    // console.log("WEBHOOK BODY", request.body);

    // if webhook event is recipient-completed
    const webhookEvent = request.body.event;
    console.log("webhookEvent", webhookEvent);
    if (webhookEvent == "recipient-completed") {
        console.log("Recipient completed event");

        const envelopeId = request.body.data.envelopeId;
        //find in pendingICPO table using envelopeId
        const dynamodb = new awsSdk.DynamoDB()
        const params = {
            TableName: "PendingICPO",
            FilterExpression: "#envelopId = :envelopId",
            ExpressionAttributeNames: {
                "#envelopId": "envelopId"
            },
            ExpressionAttributeValues: {
                ":envelopId": { S: envelopeId }
            }
        };
        await dynamodb.scan(params, (err, data) => {
            if (err) {
                console.error("Unable to scan the table. Error JSON:", JSON.stringify(err, null, 2));
            } else {
                console.log("Scan succeeded.");
                console.log(data);
                const finalResult = data ? data.Items.map((item) => { return AWS.DynamoDB.Converter.unmarshall(item) }) : [];
                console.log(finalResult);
                if (finalResult.length > 0) {
                    const item = finalResult[0];
                    console.log(item);
                    //update dynamodb PendingICPO table
                    const updateParams = {
                        TableName: "PendingICPO",
                        Key: {
                            "LOIid": { S: item.LOIid }
                        },
                        //also set signedBy to buyer
                        UpdateExpression: "set #signedBy = :signedBy",
                        ExpressionAttributeNames: {
                            "#signedBy": "signedBy"
                        },

                        //increase the signedBy value by 1
                        ExpressionAttributeValues: {
                            ":signedBy": {
                                S: (parseInt(item.signedBy) + 1).toString()
                            }
                        }
                    };
                    const updateIt = dynamodb.updateItem(updateParams, (err, data) => {
                        if (err) {
                            console.error("Unable to update item. Error JSON:", JSON.stringify(err, null, 2));
                        } else {
                            console.log("UpdateItem succeeded:", data);
                        }
                    });

                    //if signed value is 2 then create a new item in Payments table



                    console.log("THE CONTRACT IS SIGNED BY " + item.signedBy + " PARTIES ")
                    if (parseInt(item.signedBy) == 1) {
                        console.log("THE CONTRACT IS SIGNED BY BOTH PARTIES")

                        //get loi data from table LOI-hehdmsyuubfkbfai6tdtjjoxiq-staging
                        const LOIid = item.LOIid;
                        const findingParams = {
                            TableName: "LOI-hehdmsyuubfkbfai6tdtjjoxiq-staging",
                            Key: {
                                "id": { S: LOIid }
                            }
                        };

                        dynamodb.getItem(findingParams, async(err, data) => {
                            if (err) {
                                console.error("Unable to get item. Error JSON:", JSON.stringify(err, null, 2));
                            } else {
                                console.log("GetItem succeeded:", data);
                                const loiData = data ? AWS.DynamoDB.Converter.unmarshall(data.Item) : [];
                                console.log(loiData);

                                //! Create a new order IN PAYPAL
                                const request = new paypal.orders.OrdersCreateRequest();
                                request.prefer('return=representation');
                                request.requestBody({
                                    intent: 'CAPTURE',
                                    purchase_units: [{
                                        amount: {
                                            currency_code: 'USD',
                                            value: (parseFloat(loiData.price).toFixed(2)) * 0.1
                                        }
                                    }]
                                });
                                try {
                                    const response = await client.execute(request);
                                    const orderId = response.result.id;
                                    const paymentLink = response.result.links.find(link => link.rel === 'approve').href;
                                    const params = {
                                        TableName: "Payments",
                                        Item: {
                                            "LOIid": { S: LOIid },
                                            "buyerID": { S: loiData.buyerID },
                                            "fuelingvendorID": { S: loiData.fuelingvendorID },
                                            "amount": { S: JSON.stringify(loiData.price) },
                                            "paid": { S: "0" },
                                            "downPayment": { S: JSON.stringify(parseFloat(loiData.price) * 0.1) },
                                            "orderId": { S: orderId },
                                            "paymentLink": { S: paymentLink },
                                        }
                                    };

                                    dynamodb.putItem(params, (err, data) => {
                                        if (err) {
                                            console.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
                                        } else {
                                            console.log("NEW PAYMENT ITEM ADDED")
                                            console.log("Added item:", JSON.stringify(data, null, 2));
                                        }
                                    });
                                } catch (err) {
                                    console.error('Error creating order:', err);
                                    res.status(500).json({ error: 'Failed to create order' });
                                }
                                //! Create a new order IN PAYPAL




                            }
                        });


                    }
                }
            }
        });

        return response.send("Webhook was called  for recipient_completed event");
    }
    response.send("webhook called");

});

app.post('/loiPDF', createPDF)
app.get('/loiPDF', (req, res) => {
        res.send("LOI PDF")
    })
    // https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=8f9fee83-9a23-4c41-8166-51447dfddc96&redirect_uri=https://red-average-springbok.cyclic.app




app.listen(3000, () => {
    console.log("server has started", process.env.USER_ID);
});