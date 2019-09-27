var { DirectLine} = require('botframework-directlinejs');
var events = require('events');
var config = require('./../config/directline-config');
var logger = require('./logger/logger');

class DirectLineManager {
    constructor(convToReconnectId) {
        this.eventEmitter = new events.EventEmitter();
        this.directLineConvId = convToReconnectId;
        this.directLineChannel = new DirectLine({
            secret: config.directline_secret,
            conversationId: convToReconnectId
        });

        this.directLineChannel.activity$
        .filter(activity => activity.type === 'message' && activity.from.id === config.bot_name)
        .subscribe((message) => {
            logger.log({level: 'info', message: `[DIRECTLINE]: Received message: ${message.text}. conversation.id = ${message.conversation.id}`});
            this.messageReceived(message);
        });
    }

    messageReceived (message) {
        if (this.directLineConvId === null) {
            this.directLineConvId = message.conversation.id;
            this.eventEmitter.emit('saveRecipient', this.directLineConvId);
        }

        this.eventEmitter.emit('sendToCircuit', {
            convId: this.directLineConvId,
            message: message
        });
    }

    sendMessage (message, email) {
        this.directLineChannel.postActivity({
            from: { id: email, name: email },
            type: 'message',
            text: message
        }).subscribe(
            id => logger.log({level: 'info', message: `[DIRECTLINE]: Activity was sended with id ${id}. Email: ${email}`}),
            error => logger.log({level: 'error', message: `[DIRECTLINE]: Error posting activity ${error}. Email: ${email}`})
        );
    }
}

module.exports = DirectLineManager;