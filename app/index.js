global.XMLHttpRequest = require('xhr2');
global.WebSocket = require('ws');

var logger = require('./../services/logger/logger');
var Router = require('./../services/router');

const http = require('http');
const port = process.env.PORT || 3000;

function runServer() {
    const server = http.createServer((req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end('<h1>Bot is online</h1>');
    });

    server.listen(port, () => {
        logger.log({level: 'info', message: ('[APP]: Server running at port ' + port)});
    });
};

function start() {
    runServer();
    var router = new Router();
    router.start();
};

start();