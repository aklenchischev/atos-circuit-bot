var sql = require('mssql');
var config = require('./../config/database-config');
var logger = require('./logger/logger')

var self = null;
class Database {
    constructor() {
        self = this;
        this.dbConfig = {
            server: config.db_server,
            database: config.database,
            user: config.db_user,
            password: config.db_password,
            port: 1433,
            options: { encrypt: true }
        };

        this.recipients = [];
    }

    addRecipient(recipient) {
        self.recipients.push(recipient);
    }

    deleteRecipient(circuitConvId) {
        for (var i = 0; i < self.recipients.length; i++) {
            if (self.recipients[i].circuitConvId === circuitConvId) {
                self.deleteRecipientFromDatabase(circuitConvId);
                self.recipients.slice(i, 1);
            }
        }
    }

    findRecipientByEmail(email) {
        for (var i = 0; i < self.recipients.length; i++) {
            if (self.recipients[i].email === email) {
                return self.recipients[i];
            }
        }
        return undefined;
    }

    findRecipientByDirectLineConvId(directLineConvId) {
        for (var i = 0; i < self.recipients.length; i++) {
            if (self.recipients[i].directlineManager.directLineConvId === directLineConvId) {
                return self.recipients[i];
            }
        }
        return undefined;
    }

    getRecipientFromDatabase(email) {
        return new Promise(function(resolve, reject){
            logger.log({level: 'info', message: `[DATABASE]: Searching for recipient with email ${email} on database...`});

            var connection = new sql.ConnectionPool(self.dbConfig);

            connection.connect()
            .then(function() {
                var request = new sql.Request(connection);
                var query = `SELECT TOP(1) * FROM ${config.recipients_table} WHERE Email = '${email}'`;

                request.query(query)
                .then(function(response) {
                    connection.close();
                    if (response.recordset[0] === undefined) {
                        logger.log({level: 'info', message: `[DATABASE]: Recipient with email ${email} not founded in database`});
                        return reject();
                    }
                    
                    resolve({
                        circuitConvId: response.recordset[0].CircuitConvId,
                        circuitParentId: response.recordset[0].CircuitParentId,
                        directLineConvId: response.recordset[0].DirectLineConvId,
                        email: response.recordset[0].Email
                    });
                })
                .catch(function(error){
                    logger.log({level: 'error', message: `[DATABASE]: Error on SELECT query. Email: ${email}. Error: ${error}`});
                })
            })
            .catch(function(error){
                logger.log({level: 'error', message: `[DATABASE]: Error on saveRecipientToDatabase method. Email: ${email}.Error: ${error}`});
                connection.close();
            });
        });
    }

    saveRecipientToDatabase(directLineConvId) {
        var recipient = self.findRecipientByDirectLineConvId(directLineConvId);

        if (recipient === undefined) {
            logger.log({level: 'error', message: `[DATABASE]: Unabled to find recipient to save to database. dlConvId: ${directLineConvId}`});
        }
        else {
            logger.log({level: 'info', message: `[DATABASE]: Saving recipient with dlConvId = ${directLineConvId} to database...`});

            var connection = new sql.ConnectionPool(self.dbConfig);

            connection.connect()
            .then(function() {
                var request = new sql.Request(connection);
                var query = `INSERT INTO ${config.recipients_table} (DirectLineConvId, CircuitConvId, CircuitParentId, Email) VALUES ('${recipient.directlineManager.directLineConvId}', '${recipient.circuitConvId}', '${recipient.circuitParentId}', '${recipient.email}')`;

                request.query(query)
                .then(function(response) {
                    if (response.rowsAffected[0] === 0) {
                        logger.log({level: 'warn', message: `[DATABASE]: Recipient with dlConvId = ${directLineConvId} wasn\'t saved in database`});
                    }
                    else {
                        logger.log({level: 'info', message: `[DATABASE]: Recipient with dlConvId = ${directLineConvId} was successfully saved on database`});
                    }
                    connection.close();
                })
                .catch(function(error){
                    logger.log({level: 'error', message: `[DATABASE]: ERROR on INSERT query. dlConvId = ${directLineConvId}. Error: ${error}`});
                })
            })
            .catch(function(error){
                logger.log({level: 'error', message: `[DATABASE]: ERROR on saveRecipientToDatabase method. dlConvId = ${directLineConvId}. Error: ${error}`});
                connection.close();
            });
        }
    }

    updateRecipientOnDatabase(recipient) {
        logger.log({level: 'info', message: `[DATABASE]: Updating recipient with dlConvId = ${recipient.directlineManager.directLineConvId} on database...`});

        var connection = new sql.ConnectionPool(self.dbConfig);

        connection.connect()
        .then(function() {
            var request = new sql.Request(connection);
            var query = `UPDATE ${config.recipients_table} SET CircuitParentId = '${recipient.circuitParentId}' WHERE DirectLineConvId = '${recipient.directlineManager.directLineConvId}'`;

            request.query(query)
            .then(function(response) {
                if (response.rowsAffected[0] === 0) {
                    logger.log({level: 'warn', message: `[DATABASE]: There is no recipient with dlConvId = ${recipient.directlineManager.directLineConvId} in database`});
                }
                else {
                    logger.log({level: 'info', message: `[DATABASE]: Recipient with dlConvId = ${recipient.directlineManager.directLineConvId} was successfully updated on database`});
                }
                connection.close();
            })
            .catch(function(error){
                logger.log({level: 'error', message: `[DATABASE]: ERROR on SELECT query. dlConvId = ${recipient.directlineManager.directLineConvId}. Error: ${error}`});
            })
        })
        .catch(function(error){
            logger.log({level: 'error', message: `[DATABASE]: ERROR on updateRecipientOnDatabase. dlConvId = ${recipient.directlineManager.directLineConvId}. Error: ${error}`});
            connection.close();
        });
    }

    deleteRecipientFromDatabase(circuitConvId) {
        logger.log({level: 'info', message: `[DATABASE]: Removing recipient with circuitConvId = ${circuitConvId}...`});
        
        var connection = new sql.ConnectionPool(self.dbConfig);

        connection.connect()
        .then(function() {
            var request = new sql.Request(connection);
            var query = `DELETE ${config.recipients_table} WHERE CircuitConvId = '${circuitConvId}'`;

            request.query(query)
            .then(function(response) {
                if (response.rowsAffected[0] === 0) {
                    logger.log({level: 'warn', message: `[DATABASE]: There is no recipient with circuitConvId = ${circuitConvId} in database`});
                }
                else {
                    logger.log({level: 'info', message: `[DATABASE]: Recipient with circuitConvId = ${circuitConvId} was successfully deleted from database`});
                }
                connection.close();
            })
            .catch(function(error){
                logger.log({level: 'error', message: `[DATABASE]: ERROR on DELETE query. circuitConvId = ${circuitConvId}. Error: ${error}`});
            })
        })
        .catch(function(error){
            logger.log({level: 'error', message: `[DATABASE]: ERROR on deleteRecipientFromDatabase method. circuitConvId = ${circuitConvId}. Error: ${error}`});
            connection.close();
        });
    }
}

module.exports = Database;