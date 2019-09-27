const winston = require('winston');

////////////
//  Levels (highest to lowest):
//  - error (0)
//  - warn (1)
//  - info (2)
////////////

var logger = winston.createLogger({
    level: winston.level.info,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.simple()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: './services/logger/logs/logfile.log', maxsize: 1048576 })
      ]
});

module.exports = logger;