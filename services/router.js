var Database = require('./database');
var Circuit = require('./circuit');
var DirectLine = require('./directline');
var Recipient = require('./../models/recipient');
var specialMessages = require('./../config/special-messages');
var logger = require('./logger/logger');

var self = null
class Router {
    constructor() {
        self = this;
        this.database = new Database();
        this.circuit = new Circuit();
    }

    start() {
        self.circuit.logon()
        .catch (function(e) {
            logger.log({level: 'error', message: `[APP]: Error on ciruit.logon. Error: ${error}`});
        });
        self.circuit.eventEmitter.on('sendToDirectLine', self.sendMessageToDirectLine);
    }

    sendMessageToDirectLine(data) {
        var recipient = self.database.findRecipientByEmail(data.email);
        if (recipient === undefined) {
            recipient = self.database.getRecipientFromDatabase(data.email)
            .then((result) => {
                recipient = new Recipient(result.circuitConvId, result.circuitParentId, new DirectLine(result.directLineConvId), result.email);
                recipient.directlineManager.eventEmitter.on('sendToCircuit', self.sendMessageToCircuit);
                recipient.directlineManager.eventEmitter.on('saveRecipient', self.saveRecipientToDatabase);
                self.database.addRecipient(recipient);

                if (data.parentId !== undefined) {
                    recipient.circuitParentId = data.parentId;
                    self.database.updateRecipientOnDatabase(recipient);
                }

                recipient.directlineManager.sendMessage(data.content, data.email);
            },
            () => {
                recipient = new Recipient(data.convId, data.parentId, new DirectLine(null), data.email);
                recipient.directlineManager.eventEmitter.on('sendToCircuit', self.sendMessageToCircuit);
                recipient.directlineManager.eventEmitter.on('saveRecipient', self.saveRecipientToDatabase);
                self.database.addRecipient(recipient);
                logger.log({level: 'info', message: `[ROUTER]: Created new recipient for ${data.email}`});

                recipient.directlineManager.sendMessage(data.content, data.email);
            });
        }
        else if (data.parentId !== undefined) {
            recipient.circuitParentId = data.parentId;
            self.database.updateRecipientOnDatabase(recipient);
            recipient.directlineManager.sendMessage(data.content, data.email);
        }
        else {
            recipient.directLineManager.sendMessage(data.content, data.email);
        }
    }

    sendMessageToCircuit(data) {
        var recipient = self.database.findRecipientByDirectLineConvId(data.convId);
        
        if (recipient === undefined) {
            logger.log({level: 'error', message: `[ROUTER]: ERROR, COULDN\'T FIND RECIPIENT FOR dlConvId = ${data.convId}`});
        }
        else {
            var askedForEmail = self.askedForEmail(data.message.text);
            if (askedForEmail) {
                logger.log({level: 'info', message: `[ROUTER]: Bot asked for email. dlConvId = ${recipient.directlineManager.directLineConvId}`});
                recipient.loginAttempts++;
                // Limit for login attempts is reached
                if (recipient.loginAttempts >= 3) {
                    var item = {
                        content: specialMessages.login_error_message,
                        parentId: recipient.circuitParentId,
                    }

                    self.circuit.sendMessage(recipient.circuitConvId, item);
                    self.database.deleteRecipient(recipient.circuitConvId, recipient.email);
                }
                else {
                    recipient.directlineManager.sendMessage(recipient.email, recipient.email);
                }
            }
            else {
                recipient.loginAttempts = 0;

                // Create an item with text
                var item = {
                    content: data.message.text,
                    parentId: recipient.circuitParentId,
                }
                // Check that message contains suggested actions
                if (data.message.suggestedActions !== undefined) {

                    // Create an array with suggested actions
                    var actions = data.message.suggestedActions.actions;
                    var options = [];
                    actions.forEach(
                        function(action) {
                            var { type, title, value } = action;
                            var option = {
                                text: value,
                                value: value,
                                action: 'submit'
                            }
                            options.push(option);
                        }
                    );

                    // Create an empty form
                    var form = {
                        id: data.message.id,
                        controls: [{
                            type: 'BUTTON',
                            name: 'actions',
                            options: options
                        }]
                    }

                    item.form = form;
                }
                self.circuit.sendMessage(recipient.circuitConvId, item);
            }
        }
    }

    askedForEmail(message) {
        if (message === specialMessages.email_prompt || message === specialMessages.email_reprompt) {
            return true;
        }
        return false;
    }

    saveRecipientToDatabase(directLineConvId) {
        self.database.saveRecipientToDatabase(directLineConvId);
    }
}

module.exports = Router;