const http = require('http');
const port=process.env.PORT || 3000

const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html');
    res.end('<h1>Bot is online</h1>');
});

server.listen(port,() => {
    console.log(`Server running at port `+port);
});

global.XMLHttpRequest = require('xhr2');
global.WebSocket = require('ws');

var Circuit = require('circuit-sdk');
const { DirectLine } = require('botframework-directlinejs');

var config = require('./config.json');
var specialMessages = require('./special-messages.json');

var sql = require('mssql');

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

                console.log('[CIRCUIT]: Circuit client created successfully');
                
                console.log('[CIRCUIT]: Subscribing to events...');
                // Register event listeners
                self.addEventListeners(client); 

                console.log('[CIRCUIT]: Subscribed to events successfully');

                console.log('[CIRCUIT]: Trying to log on...');
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

        client.addEventListener('itemAdded', function (event) {
            self.receiveItem(event.item);
        });

        client.addEventListener('itemUpdated', function (event) {
            self.receiveItem(event.item);
        });

        // Handle a form submission
        client.addEventListener('formSubmission', function (event) {

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
var DirectLineManager = function DirectLineManager (convToReconnectId) {
    
    var self = this;

    this.conversationId = convToReconnectId;

    this.directLineChannel = new DirectLine({
        secret: config.directline_secret,
        conversationId: convToReconnectId
    });
    
    // Subscribe to bot's messages
    self.directLineChannel.activity$
    .filter(activity => activity.type === 'message' && activity.from.id === config.bot_name)
    .subscribe(
        function (message) {
            console.log("[DIRECTLINE]: Received message ", message.text);
            self.messageReceived(message);
        }
    );
    
    // Receive message
    this.messageReceived = function messageReceived (message) {

        if (self.conversationId === null) {
            self.conversationId = message.conversation.id;
            router.saveRecipientToDatabase(self.conversationId);
        }
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

    // Create a configuration object for our Azure SQL connection parameters
    var dbConfig = {
        server: config.db_server,
        database: config.database,
        user: config.db_user,
        password: config.db_password,
        port: 1433,
        options: {
            encrypt: true
        }
    };

    this.sendMessageToDirectLine = function sendMessageToDirectLine(convId, parentId, email, message) {

        var recipient = self.findRecipientByEmail(email);
        if (recipient === undefined) {

            recipient = self.getRecipientFromDatabase(convId)
            .then(
                function(result) {

                    if (result === undefined) {
                        recipient = self.createNewRecipient(convId, parentId, email);
                    }
                    else {
                        recipient = result;
                    }

                    recipient.circuitParentId = parentId;
                    self.updateRecipientOnDatabase(recipient);

                    recipient.dlManager.sendMessage(message, email);
                },
                function(error) {
                    console.log('[ROUTER]: Error while loading recipient from database ', error);
                }
            );
        }
        else if (parentId !== undefined) {
            recipient.circuitParentId = parentId;
            self.updateRecipientOnDatabase(recipient);
            recipient.dlManager.sendMessage(message, email);
        }
        else {
            recipient.dlManager.sendMessage(message, email);
        }
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
        
        var newRecipient = new Recipient(circuitConvId, circuitParentId, new DirectLineManager(null), email);
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
                    self.deleteRecipientFromDatabase(circuitConvId, email);
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

    // Save recipient to database
    this.saveRecipientToDatabase = function saveRecipientToDatabase(dlConvId) {

        var recipient = self.findRecipientByDirectLineConvId(dlConvId);
        if (recipient === undefined) {
            console.log("[ROUTER]: ERROR. Unabled to find recipient to save to database");
        }
        else {
            console.log("[ROUTER]: Saving recipient to database...");

            // Create connection instance
            var conn =  new sql.ConnectionPool(dbConfig);

            conn.connect()
            // Successfull connection
            .then(
                function() {
                    // Create request instance, passing in connection instance
                    var req = new sql.Request(conn);

                    // Define insert query
                    var query = `INSERT INTO ${config.recipients_table} VALUES ('${recipient.dlManager.conversationId}', '${recipient.circuitConvId}', '${recipient.circuitParentId}', '${recipient.email}')`;

                    // Call mssql's query method passing in params
                    req.query(query)
                    .then(
                        function() {
                            console.log("[ROUTER]: Recipient was successfully saved to database");
                            conn.close();
                        }
                    )
                    // Handle sql statement execution errors
                    .catch(
                        function(err) {
                            console.log("[ROUTER]: ERROR when try to execute insert query ", err);
                            conn.close();
                        }
                    )
                }
            )
            // Handle connection errors
            .catch(
                function (err) {
                    console.log("[ROUTER]: ERROR when try to connect to database on insert query", err);
                    conn.close();
                }
            );
        }
    };

    // Update recipient on database
    this.updateRecipientOnDatabase = function updateRecipientOnDatabase(recipient) {

        console.log("[ROUTER]: Updating recipient on database...");

        // Create connection instance
        var conn =  new sql.ConnectionPool(dbConfig);

        conn.connect()
        // Successfull connection
        .then(
            function() {
                // Create request instance, passing in connection instance
                var req = new sql.Request(conn);

                // Define update query
                var query = `UPDATE ${config.recipients_table} SET CircuitParentId = '${recipient.circuitParentId}' WHERE DirectLineConvId = '${recipient.dlManager.conversationId}'`;

                // Call mssql's query method passing in params
                req.query(query)
                .then(
                    function() {
                        console.log("[ROUTER]: Recipient was successfully updated on database");
                        conn.close();
                    }
                )
                // Handle sql statement execution errors
                .catch(
                    function(err) {
                        console.log("[ROUTER]: ERROR when try to execute update query ", err);
                        conn.close();
                    }
                )
            }
        )
        // Handle connection errors
        .catch(
            function (err) {
                console.log("[ROUTER]: ERROR when try to connect to database on update query", err);
                conn.close();
            }
        );
    };

    // Delete recipient from database
    this.deleteRecipientFromDatabase = function deleteRecipientFromDatabase(circuitConvId, email) {
        console.log("[ROUTER]: Removing recipient from database...");

        // Create connection instance
        var conn =  new sql.ConnectionPool(dbConfig);

        conn.connect()
        // Successfull connection
        .then(
            function() {
                // Create request instance, passing in connection instance
                var req = new sql.Request(conn);

                // Define delete query
                var query = `DELETE ${config.recipients_table} WHERE CircuitConvId = '${circuitConvId}' AND Email = '${email}'`;

                // Call mssql's query method passing in params
                req.query(query)
                .then(
                    function() {
                        console.log("[ROUTER]: Recipient was successfully deleted from database");
                        conn.close();
                    }
                )
                // Handle sql statement execution errors
                .catch(
                    function(err) {
                        console.log("[ROUTER]: ERROR when try to execute delete query ", err);
                        conn.close();
                    }
                )
            }
        )
        // Handle connection errors
        .catch(
            function (err) {
                console.log("[ROUTER]: ERROR when try to connect to database on delete query", err);
                conn.close();
            }
        );
    };

    // Get recipient from database
    this.getRecipientFromDatabase = function getRecipientFromDatabase(convId) {

        return new Promise(
            function (resolve, reject) {
                console.log("[ROUTER]: Searching for recipient on database...");

                // Create connection instance
                var conn =  new sql.ConnectionPool(dbConfig);

                conn.connect()
                // Successfull connection
                .then(
                    function() {
                        // Create request instance, passing in connection instance
                        var req = new sql.Request(conn);

                        // Define select query
                        var query = `SELECT TOP(1) * FROM ${config.recipients_table} WHERE CircuitConvId = '${convId}'`;

                        // Call mssql's query method passing in params
                        req.query(query)
                        .then(
                            function(recordSet) {
                                
                                conn.close();
                                if (recordSet.recordset[0] === undefined) {
                                    console.log("[ROUTER]: Recipient not founded in database");
                                    return resolve(undefined);
                                }

                                var newRecipient = new Recipient(recordSet.recordset[0].CircuitConvId, recordSet.recordset[0].CircuitParentId, new DirectLineManager(recordSet.recordset[0].DirectLineConvId), recordSet.recordset[0].Email);
                                recipients.push(newRecipient);
                        
                                return resolve(newRecipient);
                            }
                        )
                        // Handle sql statement execution errors
                        .catch(
                            function(err) {
                                console.log("[ROUTER]: ERROR when try to execute select query ", err);
                                conn.close();
                            }
                        )
                    }
                )
                // Handle connection errors
                .catch(
                    function (err) {
                        console.log("[ROUTER]: ERROR when try to connect to database on select query", err);
                        conn.close();
                    }
                );
            }
        );
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