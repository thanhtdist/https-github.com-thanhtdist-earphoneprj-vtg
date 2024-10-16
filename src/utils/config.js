// This file contains the configuration for the app.
const appConfig = {
    // Apply for app instance
    appInstanceArn: "arn:aws:chime:us-east-1:647755634525:app-instance/1007fa5f-d281-43e6-ac7d-758a23201cc0",
    // Apply for app instance user and channel
    appInstanceUserExpirationDays: 1,
    channelExpirationDays: 1,
    // Region for the Amazon Chime SDK
    region: 'us-east-1',
    // Session ID for the chat messaging
    sessionId: 'sessionChatVTG',
    // Access key and secret key for the AWS account
    //accessKeyId: '',
    //secretAccessKey: '',
    accessKeyId: process.env.REACT_APP_MY_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_MY_APP_AWS_SECRET_ACCESS_KEY,
    // URL for the web app of the viewer
    //AppURL: 'http://localhost:3000/viewer/',
    AppURL: 'https://main.d1kjg68sgeplir.amplifyapp.com/viewer/',
};
export default appConfig;