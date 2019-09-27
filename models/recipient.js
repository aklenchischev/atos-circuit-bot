// Class that contains information about one conversation
class Recipient {
    constructor(circuitConvId, circuitParentId, directlineManager, email) {
        this.circuitConvId = circuitConvId;
        this.circuitParentId = circuitParentId;
        this.directlineManager = directlineManager;
        this.email = email;
        this.loginAttempts = 0;
    }
}

module.exports = Recipient;