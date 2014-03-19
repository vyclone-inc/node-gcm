/*!
 * node-gcm
 * Copyright(c) 2013 Marcus Farkas <toothlessgear@finitebox.com>
 * MIT Licensed
 */
var Constants = require('./constants');
var timer = require('timers');
var req = require('request');

var consoleLogger = {
  error: function(s) {
    console.error(s);
  }
};

function Sender(key , options) {
    this.key = key;
    this.options = options  || {};
    this.logger = options.logger || consoleLogger;
}

var sendNoRetryMethod = Sender.prototype.sendNoRetry = function (message, registrationIds, callback) {
    var body = {},
        requestBody,
        post_options,
        self = this;

    body[Constants.JSON_REGISTRATION_IDS] = registrationIds;

    if (message.delayWhileIdle !== undefined) {
        body[Constants.PARAM_DELAY_WHILE_IDLE] = message.delayWhileIdle;
    }
    if (message.collapseKey !== undefined) {
        body[Constants.PARAM_COLLAPSE_KEY] = message.collapseKey;
    }
    if (message.timeToLive !== undefined) {
        body[Constants.PARAM_TIME_TO_LIVE] = message.timeToLive;
    }
    if (message.hasData) {
        body[Constants.PARAM_PAYLOAD_KEY] = message.data;
    }

    requestBody = JSON.stringify(body);

    post_options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-length': Buffer.byteLength(requestBody, 'utf8'),
            'Authorization': 'key=' + this.key
        },
        uri: this.options.sendUri || Constants.GCM_SEND_URI,
        body: requestBody
    };

    if(this.options.proxy){
        post_options.proxy = this.options.proxy;
    }

    post_options.timeout = this.options.timeout || Constants.SOCKET_TIMEOUT;

    req(post_options, function (err, res, resBody) {

        if (err)
            return callback(err, null);

        if (!res)
            return callback('response is null', null);

        if (res.statusCode === 503) {
            self.logger.error('Service is unavailable');
            return callback(res.statusCode, null);
        } else if(res.statusCode == 401){
            self.logger.error('Unauthorized');
            return callback(res.statusCode, null);
        } else if (res.statusCode !== 200) {
            self.logger.error('Invalid request: ' + res.statusCode);
            return callback(res.statusCode, null);
        }

        // Make sure that we don't crash in case something goes wrong while
        // handling the response.
        try {
            var data = JSON.parse(resBody);
        } catch (e) {
            self.logger.error("Error handling response " + e);
            return callback("error", null);
        }
        return callback(null, data);
    });
};

//noinspection JSUnusedGlobalSymbols
Sender.prototype.send = function (message, registrationId, retries, callback) {

    var attempt = 1,
        backoff = Constants.BACKOFF_INITIAL_DELAY,
        self = this;

    if (registrationId.length === 1) {

        this.sendNoRetry(message, registrationId, function lambda(err, result) {

            if (result === undefined) {
                if (attempt < retries) {
                    var sleepTime = backoff * 2 * attempt;
                    if (sleepTime > Constants.MAX_BACKOFF_DELAY) {
                        sleepTime = Constants.MAX_BACKOFF_DELAY;
                    }
                    timer.setTimeout(function () {
                        sendNoRetryMethod(message, registrationId, lambda);
                    }, sleepTime);
                } else {
                    self.logger.error('Could not send message after ' + retries + ' attempts');
                    callback(null, result);
                }
                attempt += 1;
            } else callback(null, result);
        });
    } else if (registrationId.length > 1) {
        this.sendNoRetry(message, registrationId, function lambda(err, result) {

            if (attempt < retries) {
                var sleepTime = backoff * 2 * attempt,
                    unsentRegIds = [],
                    i;
                if (sleepTime > Constants.MAX_BACKOFF_DELAY) {
                    sleepTime = Constants.MAX_BACKOFF_DELAY;
                }

                if (result) {
                    for (i = 0; i < registrationId.length; i += 1) {
                        if (result.results[i].error === 'Unavailable') {
                            unsentRegIds.push(registrationId[i]);
                        }
                    }
                }

                registrationId = unsentRegIds;
                if (registrationId.length !== 0) {
                    timer.setTimeout(function () {
                        sendNoRetryMethod(message, registrationId, lambda);
                    }, sleepTime);
                    attempt += 1;
                } else callback(null, result);

            } else {
                self.logger.error('Could not send message to all devices after ' + retries + ' attempts');
                callback(null, result);
            }
        });
    } else {
        self.logger.error('No RegistrationIds given!');
        callback('No RegistrationIds given!', null);
    }
};

module.exports = Sender;
