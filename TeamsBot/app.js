var restify = require('restify');
var builder = require('botbuilder');
var azure = require('azure');

//=========================================================
// Azure queue setup
//=========================================================
var serviceBusService = azure.createServiceBusService("<Service-Bus-Endpoint>");
serviceBusService.createQueueIfNotExists('deployments', function(error){
    if(!error){
        console.log("Deployments Queue already exists");
    } else {
        console.log("Got some error while queue creation.")
    }
});

serviceBusService.createQueueIfNotExists('results', function(error){
    if(!error){
        console.log("Results Queue already exists");
    } else {
        console.log("Got some error while queue creation.")
    }
});

//=========================================================
// Bot Setup
//=========================================================

// Setup Restify Server
var server = restify.createServer();
// While deploying make sure the port is 80
server.listen(process.env.port || process.env.PORT || 80, function () {
   console.log('%s listening to %s', server.name, server.url); 
});
  
// Create chat bot
var connector = new builder.ChatConnector({
    appId: "",
    appPassword: ""
});

var bot = new builder.UniversalBot(connector);
server.post('/api/messages', connector.listen());

//=========================================================
// Bots Dialogs
//=========================================================

bot.dialog('/', [
    function (session, args, next) {
        if (!session.userData.deploymentId) {
            session.beginDialog('/profile');
        } else {
            next();
        }
    },
    function (session, results) {
        if(!session.userData.acked) {
            session.send('Hello %s!', session.userData.name);
            session.userData.acked = true;
        }

        if(session.userData.deploymentId) {
            session.send('Selected deployment id is %s!', session.userData.deploymentId);
            session.beginDialog('/menu');
        }
    }
]);

bot.dialog('/profile', [
    function (session, args, next) {
        session.dialogData.profile = args || {};
        if (!session.userData.name) {
            builder.Prompts.text(session, "Hello, what's your name?");
        } else {
            next();
        }
    },
    function (session, results, next) {
        if (results.response) {
            session.userData.name = results.response;
        }
        
        if (!session.userData.deploymentId) {
            builder.Prompts.text(session, "What is the Deployment Id?");
        } else {
            next();
        }
    },
    function (session, results) {
        if (results.response) {
            session.userData.deploymentId = results.response;
        }
        session.endDialog();
    }
]);

bot.dialog('/menu', [
    function (session) {
        builder.Prompts.choice(session, "Choose an option:", 'De-skip|Retry|Abort|Reset|Quit');
    },
    function (session, results) {
        switch (results.response.index) {
            case 0:
                session.beginDialog('/deskip');
                break;
            case 1:
                session.beginDialog('/retry');
                break;
            case 2:
                session.beginDialog('/abort');
                break;
            case 3:
                session.userData.deploymentId = null;
                session.send("Deployment Id has been reset now!!");
                session.endDialog();
                break;
            default:
                session.endDialog();
                break;
        }
    },
    function (session) {
        // Reload menu
        session.replaceDialog('/menu');
    }
]).reloadAction('showMenu', null, { matches: /^(menu|back)/i });

bot.dialog('/deskip', [
    function (session, args) {
        var message = "Confirm that you want to de-skip deployment " + session.userData.deploymentId;
        builder.Prompts.choice(session, message, "Yes|No")
    },
    function (session, results) {
        if ('Yes' == results.response.entity) {
            
            var message = {
                body: session.userData.deploymentId,
                customProperties: {
                    action: 'deskip',
                    user: new Buffer(JSON.stringify(session.message.address)).toString('base64')
                }
            };
            serviceBusService.sendQueueMessage('deployments', message, function(error){
                if(!error){
                    session.endDialog("Successfullly sent the message");
                } else {
                    session.endDialog("Some failure while enqueueing");
                }
            });

            // TODO some way to send notification to user

        } else {
            session.endDialog("Sure, going back!!");
        }
    }
]);

bot.dialog('/retry', [
    function (session, args) {
        var message = "Confirm that you want to retry the deployment " + session.userData.deploymentId;
        builder.Prompts.choice(session, message, "Yes|No")
    },
    function (session, results) {
        if ('Yes' == results.response.entity) {
            
            var message = {
                body: session.userData.deploymentId,
                customProperties: {
                    action: 'retry',
                    user: new Buffer(JSON.stringify(session.message.address)).toString('base64')
                }
            };
            serviceBusService.sendQueueMessage('deployments', message, function(error){
                if(!error){
                    session.endDialog("Successfullly sent the message");
                } else {
                    session.endDialog("Some failure while enqueueing");
                }
            });

        } else {
            session.endDialog("Sure, going back!!");
        }
    }
]);

bot.dialog('/abort', [
    function (session, args) {
        var message = "Confirm that you want to abort deployment " + session.userData.deploymentId;
        builder.Prompts.choice(session, message, "Yes|No")
    },
    function (session, results) {
        if ('Yes' == results.response.entity) {
            
            var message = {
                body: session.userData.deploymentId,
                customProperties: {
                    action: 'abort',
                    user: new Buffer(JSON.stringify(session.message.address)).toString('base64')
                }
            };
            serviceBusService.sendQueueMessage('deployments', message, function(error){
                if(!error){
                    session.endDialog("Successfullly sent the message");
                } else {
                    session.endDialog("Some failure while enqueueing");
                }
            });
        } else {
            session.endDialog("Sure, going back!!");
        }
    }
]);

//=========================================================
// Bot Push Notification
//=========================================================

server.post('/api/notify', function (req, res) {
    // Process posted notification
    var address = JSON.parse(req.body.address);
    var notification = req.body.notification;

    // Send notification as a proactive message
    var msg = new builder.Message()
        .address(address)
        .text(notification);
    bot.send(msg, function (err) {
        // Return success/failure
        res.status(err ? 500 : 200);
        res.end();
    });
});

//=========================================================
// Service to push
//=========================================================

setInterval(function(){
    serviceBusService.receiveQueueMessage('results', { isPeekLock: true }, function(error, lockedMessage){
        if(!error) {
            var deploymentId = lockedMessage.body;
            var userInfo = new Buffer(lockedMessage.customProperties['user'], 'base64').toString('ascii');

            // Message received and locked
            console.log("Body of the message received is: '%s' User %s", deploymentId, userInfo);

            var address = JSON.parse(userInfo);

            // Push notification to the user
            var msg = new builder.Message()
                .address(address)
                .text(deploymentId);
            bot.send(msg);
            
            serviceBusService.deleteMessage(lockedMessage, function (deleteError){
                if(!deleteError) {
                    // Message deleted
                    console.log("Message successfully deleted.");
                } else {
                    console.log("Got some error while deleting the message.");
                }
            });
        } else {
            console.log("Got some error while receiving the message.");
        }
    });

    console.log("Sleeping for 10 seconds.");

}, 10*1000); // 10 seconds