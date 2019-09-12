global.XMLHttpRequest = require('xhr2');
global.WebSocket = require('ws');

var Circuit = require('circuit-sdk');
const { DirectLine } = require('botframework-directlinejs');

var config = require('./config.json');
var specialMessages = require('./special-messages.json');

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

        // Handle a form submission
        client.addEventListener('formSubmission', function (event) {
            console.log("[TEST: Event - ", event);

            var submittedValue = event.form.data[0].value;
            console.log("[CIRCUIT]: Form was submitted with value ", submittedValue);

            // Create an item to send to DirectLine
            var item = {
                type: 'TEXT',
                creatorId: event.submitterId,
                text: {
                    content: submittedValue
                }
            }

            self.receiveItem(item);
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
    this.sendMessage = function sendMessage(convId, item) {

        client.addTextItem(convId, item);
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
    var loginAttempts = 0;

    // Store a list of recipients
    var recipients = [];

    this.sendMessageToDirectLine = function sendMessageToDirectLine(convId, parentId, email, message) {

        var recipient = self.findRecipientByEmail(email);

        if (recipient === undefined) {
            recipient = self.createNewRecipient(convId, parentId, email);
        }
        else if (parentId !== undefined) {
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

            // Check for email asking
            var askedForEmail = self.botAskedForEmail(message.text);
            
            if (askedForEmail) {

                console.log("[ROUTER]: Bot asked for email");
                // Limit for login attempts is reached
                if (loginAttempts >= 3) {
                    
                    var item = {
                        content: specialMessages.login_error_message,
                        parentId: recipient.circuitParentId,
                    }

                    circuit.sendMessage(recipient.circuitConvId, item);
                    self.deleteRecipient(recipient.circuitConvId, recipient.email);
                }
                else {
                    // Send user's email to bot
                    recipient.dlManager.sendMessage(recipient.email, recipient.email);
                }
            }
            else {

                // Create an item with text
                var item = {
                    content: message.text,
                    parentId: recipient.circuitParentId,
                }

                // Check that message contains suggested actions
                if (message.suggestedActions !== undefined) {

                    // Create an array with suggested actions
                    var actions = message.suggestedActions.actions;
                    var options = [];
                    actions.forEach(
                        function(action) {
                            var { type, title, value } = action;
                            var option = {
                                text: value,
                                value: value,
                                notification: "Form submitted",
                                action: 'submit'
                            }

                            options.push(option);
                        }
                    );

                    // Create an empty form
                    var form = {
                        id: message.id,
                        controls: [{
                            type: 'BUTTON',
                            name: 'actions',
                            options: options
                        }]
                    }

                    item.form = form;
                }

                circuit.sendMessage(recipient.circuitConvId, item);
            }
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
    this.findRecipientByDirectLineConvId = function findRecipientByDirectLineConvId(dlConvId) {

        for (var i = 0; i < recipients.length; i++) {
            if (recipients[i].dlManager.conversationId === dlConvId) {
                return recipients[i];
            }
        }

        return undefined;
    }

    // Create new recipient
    this.createNewRecipient = function createNewRecipient(circuitConvId, circuitParentId, email) {
        
        var newRecipient = new Recipient(circuitConvId, circuitParentId, new DirectLineManager(), email);
        recipients.push(newRecipient);

        console.log("[ROUTER]: Created new recipient for ", email);
        return newRecipient;
    };

    // Remove recipient from array
    this.deleteRecipient = function deleteRecipient(circuitConvId, email) {

        for (var i = 0; i < recipients.length; i++) {
            if (recipients[i].circuitConvId === circuitConvId &&
                recipients[i].email === email) {
                    recipients.slice(i, 1);
                    console.log("[ROUTER]: Deleted recipient for ", email);
                }
        }
    }

    // Check if bot wants to get user's email. If he asks for 5 times in a row 
    // send to Circuit appropriate message and delete this recipient
    this.botAskedForEmail = function botAskedForEmail(message) {

        if (!self.checkForEmailAsking(message)) {
            loginAttempts = 0;
            return false;
        }
        else if (loginAttempts < 5) {
            loginAttempts++;
            return true;
        }

        return true;
    };

    // Check message for Email asking
    this.checkForEmailAsking = function checkForEmailAsking(message) {

        if (message === specialMessages.email_prompt || message === specialMessages.email_reprompt) {
            return true;
        }

        return false;
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