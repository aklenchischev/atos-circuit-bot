var Circuit = require('circuit-sdk');
var events = require('events');
var config = require('./../config/circuit-config');
var logger = require('./logger/logger')

var self = null;
class CircuitManager {
    constructor() {
        self = this;
        this.client = null;
        this.eventEmitter = new events.EventEmitter();
    }

    logon() {
        logger.log({level: 'info', message: '[CIRCUIT]: Creating Circuit client...'});
        return new Promise(function(resolve, reject) {
            
            self.client = new Circuit.Client({
                client_id: config.client_id,
                client_secret: config.client_secret,
                domain: config.domain,
                autoRenewToken: true
            });

            logger.log({level: 'info', message: '[CIRCUIT]: Circuit client created successfully'});
            logger.log({level: 'info', message: '[CIRCUIT]: Subscribing to events...'});
            
            self.addEventListeners(self.client); 

            logger.log({level: 'info', message: '[CIRCUIT]: Subscribed to events successfully'});
            logger.log({level: 'info', message: '[CIRCUIT]: Trying to log on...'});
            
            self.client.logon()
            .then(function loggedOn() {
                logger.log({level: 'info', message: '[CIRCUIT]: Logged on'});
                return self.client.setPresence({state: Circuit.Enums.PresenceState.AVAILABLE});
            })
            .then(() => {
                logger.log({level: 'info', message: '[CIRCUIT]: Presence updated'});
                resolve();
            })
            .catch(reject);
        });
    }

    addEventListeners(client) {
        client.addEventListener('itemAdded', function (event) {
            self.receiveItem(event.item);
        });
    
        client.addEventListener('itemUpdated', function (event) {
            self.receiveItem(event.item);
        });
    
        client.addEventListener('formSubmission', function (event) {

            var submittedValue = event.form.data[0].value;
            logger.log({level: 'info', message: ('[CIRCUIT]: Form was submitted with value' + submittedValue)});
    
            client.getItemById(event.itemId)
            .then(function (itemInfo) {
                client.updateTextItem({
                    itemId: event.itemId,
                    content: itemInfo.text.content,
                    form: {
                        id: event.form.id,
                        controls: [{
                            type: 'LABEL',
                            text: submittedValue
                        }]
                    }
                });

                logger.log({level: 'info', message: `[CIRCUIT]: Form was submitted. circuitConvId = ${itemInfo.convId}. Value = ${submittedValue}`});

                var item = {
                    convId: itemInfo.convId,
                    parentItemId: itemInfo.parentItemId,
                    type: 'TEXT',
                    creatorId: event.submitterId,
                    text: { content: submittedValue }
                }

                self.receiveItem(item);
            });
        });
    }

    receiveItem(item) {
        if (item.type !== 'TEXT' || self.sentByMe(item)) {
            logger.log({level: 'info', message: `[CIRCUIT]: Skip it is not text or I sent it. ConvId = ${item.convId}`});
            return;
        }

        if (!item.text || !item.text.content) {
            logger.log({level: 'info', message: `[CIRCUIT]: Skip it does not have text. ConvId = ${item.convId}`});
            return;
        }

        self.client.getConversationById(item.convId)
        .then(function(conv) {
            if (conv.type === "DIRECT") {
                logger.log({level: 'info', message: `[CIRCUIT]: Item received. ConvId = ${item.convId}. Content = ${item.text.content}`});

                self.client.getUserById(item.creatorId)
                .then(function (user) {
                    self.eventEmitter.emit('sendToDirectLine', {
                        convId: item.convId,
                        parentId: (item.parentItemId) ? item.parentItemId : item.itemId,
                        email: user.emailAddress,
                        content: item.text.content
                    });
                });
            }
            else {
                logger.log({level: 'warn', message: `[CIRCUIT]: Skip message from multi-user conversation. ConvId = ${item.convId}`});
            }
        })
    }

    sendMessage(convId, item) {
        self.client.addTextItem(convId, item);
    }

    sentByMe (item){
        return (self.client.loggedOnUser.userId === item.creatorId);
    }
}

module.exports = CircuitManager;