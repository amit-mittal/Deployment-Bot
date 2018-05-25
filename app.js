var azure = require('azure');
var spawn = require("child_process").spawn;

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

setInterval(function(){
    serviceBusService.receiveQueueMessage('deployments', { isPeekLock: true }, function(error, lockedMessage){
        if(!error) {
            var deploymentId = lockedMessage.body;
            var action = lockedMessage.customProperties['action'];
            var userInfo = lockedMessage.customProperties['user'];

            // Message received and locked
            console.log("Message received is Id: %s Action: %s User %s", deploymentId, action, userInfo);

            // Doing the WADI work here
            var powershellCmd = ".\\Sample.ps1 -tfsIds @(" + deploymentId + ") -action " + action;
            var child = spawn("powershell.exe", [powershellCmd]);
            child.stdout.on("data", function(data) {
                console.log("Powershell Data: " + data);
            });
            child.stderr.on("data", function(data) {
                console.log("Powershell Errors: " + data);
            });
            child.on("exit", function() {
                console.log("Powershell Script finished");
            });
            child.stdin.end();
            
            var statusMessage = "Successfully performed action ";
            statusMessage += action.toString();
            statusMessage += " on the deployment ";
            statusMessage += deploymentId.toString();

            console.log("Body of message is %s", statusMessage);

            // Enqueue the status of the work done
            var message = {
                body: statusMessage,
                customProperties: {
                    user: userInfo
                }
            };
            serviceBusService.sendQueueMessage('results', message, function(error){
                if(!error){
                    console.log("Enqueued the status successful!!");
                } else {
                    console.log("Enqueued the status...failed!!");
                }
            });

            serviceBusService.deleteMessage(lockedMessage, function (deleteError){
                if(!deleteError){
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