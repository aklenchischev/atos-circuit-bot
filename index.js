global.XMLHttpRequest = require('xhr2');
global.WebSocket = require('ws');

var config = require('./config.json');
var Circuit = require('circuit-sdk');
const { DirectLine } = require('botframework-directlinejs');

// Class that contains information about one conversation
class Recipient {
    constructor(circuitConvId, circuitParentId, dlManager, email) {
        this.circuitConvId = circuitConvId;
        this.circuitParentId = circuitParentId;
        this.dlManager = dlManager;
        this.email = email;
    }
}

var router;
var circuit;

//*********************************************************************
//* Circuit
//*********************************************************************
var CircuitManager = function CircuitManager () {

    var self = this;
    var client = null;

    // Connect to Circuit account
    this.logon = function logon() {

        return new Promise(
            function(resolve, reject) {

                console.log('[CIRCUIT]: Creating Circuit client...');

                // Create client
                client = new Circuit.Client({
                    client_id: config.client_id,
                    client_secret: config.client_secret,
                    domain: config.domain,
                    autoRenewToken: true
                });
                
                // Register event listeners
                self.addEventListeners(client); 

                // Logon to Circuit
                client.logon()
                .then(
                    function loggedOn(user) {
                        console.log('[CIRCUIT]: Logged on');
                        return client.setPresence({state: Circuit.Enums.PresenceState.AVAILABLE});
                    }
                )
                .then(
                    () => {
                        console.log('[CIRCUIT]: Presence updated');
                        resolve();
                    }
                )
                .catch(reject);
            }
        );
    };

    // Subscribe to events
    this.addEventListeners = function addEventListeners(client) {

        console.log('[CIRCUIT]: Subscribing to events...');

        client.addEventListener('itemAdded', function (event) {
            self.receiveItem(event.item);
        });

        client.addEventListener('itemUpdated', function (event) {
            self.receiveItem(event.item);
        });

        // TO DO: Handle a form submission
        client.addEventListener('formSubmission', function (event) {
            var formData = event.form;
            console.log(event);
            console.log(formData);
        });
    };

    // Check that item was sended by myself
    this.sentByMe = function sentByMe (item){
        return (client.loggedOnUser.userId === item.creatorId);
    };

    // Receive message
    this.receiveItem = function receiveItem(item) {
        
        console.log('[CIRCUIT]: Item received');

        if (item.type !== 'TEXT' || self.sentByMe(item)) {
            console.log('[CIRCUIT]: Skip it is not text or I sent it');
            return;
        }

        if (!item.text || !item.text.content) {
            console.log('[CIRCUIT]: Skip it does not have text');
            return;
        }

        console.log('[CIRCUIT]: Content of item: ', item.text.content);

        // Send message to DirectLine
        client.getUserById(item.creatorId)
        .then(
            function (user) {
                router.sendMessageToDirectLine(item.convId, 
                    (item.parentItemId) ? item.parentItemId : item.itemId, user.emailAddress, item.text.content);
            }
        );
    };

    // Send message
    this.sendMessage = function sendMessage(convId, parentId, item) {

        client.addTextItem(convId, {
                parentId: parentId,
                content: item
            }
        );
    };
};

//*********************************************************************
//* DirectLine
//*********************************************************************
var DirectLineManager = function DirectLineManager () {
    
    var self = this;

    this.conversationId = null;

    this.directLineChannel = new DirectLine({
        secret: config.directline_secret
    });
    
    // Subscribe to bot's messages
    self.directLineChannel.activity$
    .filter(activity => activity.type === 'message' && activity.from.id === 'atos-booking-bot')
    .subscribe(
        function (message) {
            console.log("[DIRECTLINE]: Received message ", message);
            self.messageReceived(message);
        }
    );
    
    // Receive message
    this.messageReceived = function messageReceived (message) {
        self.conversationId = message.conversation.id;
        router.sendMessageToCircuit(self.conversationId, message);
    };

    // Send message
    this.sendMessage = function sendMessage (message, email) {
        self.directLineChannel.postActivity({
            from: { id: email, name: email },
            type: 'message',
            text: message
        }).subscribe(
            id => console.log("[DIRECTLINE]: Activity was sended with id ", id),
            error => console.log("[DIRECTLINE]: Error posting activity ", error)
        );
    };
};

//*********************************************************************
//* RouteBot
//*********************************************************************
var RouteBot = function RouteBot () {

    var self = this;

    // Store a list of recipients
    var recipients = [];

    this.sendMessageToDirectLine = function sendMessageToDirectLine(convId, parentId, email, message) {

        var recipient = self.findRecipientByEmail(email);

        if (recipient === undefined) {
            recipient = self.createNewRecipient(convId, parentId, email);
        }
        else {
            recipient.circuitParentId = parentId;
        }

        recipient.dlManager.sendMessage(message, email);
    };

    this.sendMessageToCircuit = function sendMessageToCircuit(dlConvId, message) {

        var recipient = self.findRecipientByDirectLineConvId(dlConvId);

        if (recipient === undefined) {
            console.log("[ROUTER]: ERROR, COULDNT FIND RECIPIENT FOR dlConvId ", dlConvId);
        }
        else {
            console.log("[ROUTER]: Sending message to Circuit recipient...");
            circuit.sendMessage(recipient.circuitConvId, recipient.circuitParentId, message.text);
        }
    };

    // Find recipient in array by email to send message to directLine
    this.findRecipientByEmail = function findRecipientByEmail(email) {

        for (var i = 0; i < recipients.length; i++) {
            if (recipients[i].email === email) {
                return recipients[i];
            }
        }

        return undefined;
    };

    // Find recipient in array by dlConvId to send message to Circuit
    this.findRecipientByDirectLineConvId = function(dlConvId) {

        for (var i = 0; i < recipients.length; i++) {
            if (recipients[i].dlManager.conversationId === dlConvId) {
                return recipients[i];
            }
        }

        return undefined;
    }

    // Create new recipient
    this.createNewRecipient = function createNewRecipient(circuitConvId, circuitParentId, email) {
        
        console.log("[ROUTER]: Creating new recipient for ", email);
        var newRecipient = new Recipient(circuitConvId, circuitParentId, new DirectLineManager(), email);
        recipients.push(newRecipient);
        return newRecipient;
    };
};

//*********************************************************************
//* run
//*********************************************************************
function run() {

    router = new RouteBot();
    circuit = new CircuitManager();

    circuit.logon()
        .catch (function(e) {
            console.log('[APP]:', e);
        }
    );
};

//*********************************************************************
//* main
//*********************************************************************
run();