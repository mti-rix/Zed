const AWS = require('aws-sdk');
const https = require('https');
const querystring = require('querystring');

const dynamo = new AWS.DynamoDB.DocumentClient();

let cachedAccessKey; //Cached tokens


/// this is specific for Salesforce API due to the "configName"
module.exports =  async (payload, configName) => {
    // getting payload
    // getting configName
    
    const payloadResponse = submitHTTP(payload, configName);
   
    return payloadResponse;
};
async function submitHTTP(payload, configName, retries = 1 ){

    const regexHostnameFilter = /^[a-z][a-z0-9+\-.]*:\/\/([a-z0-9\-._~%!$&'()*+,;=]+@)?([a-z0-9\-._~%]+|\[[a-z0-9\-._~%!$&'()*+,;=:]+\])/;

    let scanCriteria = {
        TableName: "Zed_Configurator",
        KeyConditionExpression: "configurationName = :configName",
        ExpressionAttributeValues: {":configName": process.env.accessConfigName}
    };
    
    //Check if there's a security access key available
    if(!cachedAccessKey || !cachedAccessKey.access_token){
        console.log("No cached key access!!!");
        const config = await dynamo.query(scanCriteria).promise();
        const options = config.Items[0].configData.options;
        const data = config.Items[0].configData.data;
        cachedAccessKey = await httpsRequest(options, data);
    }
    console.log("cachedAccessKey:", JSON.stringify(cachedAccessKey));
    
    scanCriteria.ExpressionAttributeValues = {":configName": configName};
    const config = await dynamo.query(scanCriteria).promise();
    let options = config.Items[0].configData.options;
    const data = config.Items[0].configData.data;
    
    config.Items[0].configData.options.hostname = cachedAccessKey.instance_url.match(regexHostnameFilter)[2];
    config.Items[0].configData.options.headers.Authorization = cachedAccessKey.token_type + " " + cachedAccessKey.access_token;
    
    let optionsString = JSON.stringify(options);
    for(var attr in payload){
        optionsString = optionsString.replace("{"+attr+"}", payload[attr]) ;
    }
    options = JSON.parse(optionsString);
    console.log("config:", JSON.stringify(config));
    console.log("options:", JSON.stringify(options));
    
    let returnedValue;
    
    await httpsRequest(options, data).then((result) => {
        console.log("Success", result);
        returnedValue = result;
    }).catch((error) => {
        const thisError = error.toString().substring(7, 26);
        if(thisError=="statusCode=401" && retries > 0){
            // Token expired
            console.log("Token Expired!!!!!!!!!!!:", error);
            cachedAccessKey = "";
            returnedValue = submitHTTP(payload, configName, retries - 1);    
        }else {
            throw new Error(error);
      }
    });
    return returnedValue;
}

// ConsistentRead 

// Wrapper to add promises to the HTTP.REQUEST
function httpsRequest(params, postData) {
    return new Promise(function(resolve, reject) {
        
        var req = https.request(params, function(res) {

            // reject on bad status
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error('statusCode=' + res.statusCode));
            }
            // cumulate data
            var body = [];
            res.on('data', function(chunk) {
                body.push(chunk);
            });
            // resolve on end
            res.on('end', function() {
                try {
                    body = JSON.parse(Buffer.concat(body).toString());
                } catch(e) {
                    console.log("ERROR: ", e);
                    reject(e);
                }
                resolve(body);
            });
        });
        // reject on request error
        req.on('error', function(err) {
            // This is not a "Second reject", just a different sort of failure
            reject(err);
        });
        if (postData) {
            req.write(querystring.stringify(postData));
        }
        // IMPORTANT
        req.end();
    });
}
