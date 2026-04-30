// lambda/index.js
const AWS = require('aws-sdk');
const ssm = new AWS.SSM();

exports.handler = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));

  const paramName = process.env.SSM_PARAM_NAME || '/app/config/greeting';

  try {
    console.log(`Fetching SSM parameter: ${paramName}`);

    const result = await ssm.getParameter({
      Name: paramName,
      WithDecryption: false,
    }).promise();

    const greeting = result.Parameter.Value;
    
    console.log('Successfully retrieved from SSM:', greeting);

    return {
      status: 'Success',
      parameterName: paramName,
      greeting: greeting,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error retrieving SSM parameter:', error);
    throw new Error(`Failed to retrieve SSM parameter: ${error.message}`);
  }
};