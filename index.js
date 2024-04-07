const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
dotenv.config();
const docusign = require("docusign-esign");
const fs = require("fs");
const session = require("express-session");
const { awsSdk } = require("./awsSDK");
const AWS = require("aws-sdk");
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: "dfsf94835asda",
  resave: true,
  saveUninitialized: true,
}));

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
  env.emailSubject = "Please sign this document";
  env.templateId = process.env.TEMPLATE_ID;
  env.recipients = new docusign.Recipients();

  env.templateRoles = [{
    email: emails[0],
    name: names[0],
    roleName: 'Applicant',
    tabs: tabsArray[0], // Provide tabs for the current recipient
  }, {
    email: emails[1],
    name: names[1],
    roleName: 'Applicant2',
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


app.post('/initiateSignature', async (request, response) => {
  const { LOIid } = request.body;

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
      console.log(finalResult2);




      const company = "Test Company";
      const name1 = "Jeet Vani"
      const email1 = "jackyairdayan@gmail.com";
      const name2 = "Jeet Vani";
      const email2 = "copyrightjeet@gmail.com";
      await checkToken(request);
      let tabs = docusign.Tabs.constructFromObject({
        textTabs: [
          {
            tabLabel: "vendor_id",
            value: fuelingvendorID,
            locked: "true"
          }, {
            tabLabel: "vendor_country",
            value: finalResult.origin,
            locked: "true"
          }, {
            tabLabel: "company_name",
            value: company,
            locked: "true"
          }, {
            tabLabel: "buyer_id",
            value: "buyer_id",
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
            value: "seller_bank_name",
            locked: "true"
          }, {
            tabLabel: "seller_bank_address",
            value: "seller_bank_address",
            locked: "true"
          }, {
            tabLabel: "seller_account_number",
            value: "seller_account_number",
            locked: "true"
          }, {
            tabLabel: "seller_account_name",
            value: "seller_account_name",
            locked: "true"

          }, {
            tabLabel: "seller_swift",
            value: "seller_swift",
            locked: "true"
          }, {
            tabLabel: "seller_bank_officer",
            value: "seller_bank_officer",
            locked: "true"

          }, {
            tabLabel: "seller_bank_tel",
            value: "seller_bank_tel",
            locked: "true"
          }, {
            tabLabel: "seller_bank_email",
            value: "seller_bank_email",
            locked: "true"
          },
          //same for buyer
          {
            tabLabel: "buyer_bank_name",
            value: "buyer_bank_name",
            locked: "true"
          }, {
            tabLabel: "buyer_bank_address",
            value: "buyer_bank_address",
            locked: "true"
          }, {
            tabLabel: "buyer_account_number",
            value: "buyer_account_number",
            locked: "true"
          }, {
            tabLabel: "buyer_account_name",
            value: "buyer_account_name",
            locked: "true"

          }, {
            tabLabel: "buyer_swift",
            value: "buyer_swift",
            locked: "true"
          }, {
            tabLabel: "buyer_bank_officer",
            value: "buyer_bank_officer",
            locked: "true"

          }, {
            tabLabel: "buyer_bank_tel",
            value: "buyer_bank_tel",
            locked: "true"
          }, {
            tabLabel: "buyer_bank_email",
            value: "buyer_bank_email",
            locked: "true"
          },
          {
            tabLabel: "buyer_name",
            value: "buyer_name",
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
      results = await envelopesApi.createRecipientView(process.env.ACCOUNT_ID, results.envelopeId,
        { recipientViewRequest: viewRequest });



      // update dynamodb PendingICPO table
      const updateParams = {
        TableName: "PendingICPO",
        Key: {
          "LOIid": { S: LOIid }
        },
        //also set signedBy to buyer
        UpdateExpression: "set #contractSent = :contractSent  , #signedBy = :signedBy , #envelopId = :envelopId,#envelopType = :envelopType , signedBy = :signedBy",
        ExpressionAttributeNames: {
          "#contractSent": "contractSent",
          "#signedBy": "signedBy",
          "#envelopId": "envelopId",
          "#envelopType": "envelopType",
          "#signedBy": "signedBy"


        },
        ExpressionAttributeValues: {
          ":contractSent": { S: "true" }
          , ":signedBy": { S: "buyer" }
          , ":envelopId": { S: envelopeId },
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
      response.send("ICPO is not approved by both parties")
      return
    }
    if (findUsingLOIid.sellerApproved && !findUsingLOIid.buyerApproved) {
      response.send("Buyer has not approved the ICPO yet")
      return
    }
    if (!findUsingLOIid.sellerApproved && findUsingLOIid.buyerApproved) {
      response.send("Seller has not approved the ICPO yet")
      return
    }
    return
  }




  return



});


app.post('/webhook', (request, response) => {
  console.log("webhook called");
  response.send("webhook called");
});

// https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=8f9fee83-9a23-4c41-8166-51447dfddc96&redirect_uri=https://red-average-springbok.cyclic.app

app.listen(3000, () => {
  console.log("server has started", process.env.USER_ID);
});



