

const AWS = require('aws-sdk')
const { awsReactCred } = require('./config')

// Set the global region for all AWS service requests
AWS.config.update({
    accessKeyId: awsReactCred.accessKey,
    secretAccessKey: awsReactCred.accessKeySecret,
    region: awsReactCred.region,

})
 
const awsSdk = AWS;

module.exports = { awsSdk }

