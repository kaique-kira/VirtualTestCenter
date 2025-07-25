exports.init = init;
exports.request = request;
exports.close = close;

const Config = require("../lib/config").init();
const Log = require("../lib/log").init(Config.log);
const Core = require("../lib/core");

const Fs = require("fs");
const Http = require("http");
const Https = require("https");
const _ = require("lodash");

var consume = null;
var host = null;
var server = null;

function init (config, handler) {
  host = config;
  receive = handler;

  var options = {}
  var Proto = setConnOpts(config, options);

  if (config.connType == "server") {
    Log.trace("Creating " + config.hostType + " server.. ");
    if (config.hostType == "https") server = Proto.createServer(options, handle);
    else server = Proto.createServer(handle);
    server.listen(config.port, config.address, () => {
      Log.info("Listening on " + config.address + ":" + config.port);
    });
  } else if (config.connType == "client") {
    // TODO: Implement keepAlive using Http.Agent.
  } else {
    throw new Error("Invalid connType: '" + config.connType + "'.");
  }
}

function setConnOpts (config, options) {
  var type = config.type || config.hostType || host.hostType;
  var Proto = null;
  if (type == "http") {
    Proto = Http;
  } else if (type == "https") {
    Proto = Https;
    if (!_.isEmpty(config.key) || !_.isEmpty(config.cert)) {
      options.key = config.key;
      options.cert = config.cert;
      options.ca = config.ca;
    } else {
      if (_.isEmpty(Config.frontend.keyf) || _.isEmpty(Config.frontend.certf)) {
        throw "No default SSL key has been set. Check /lib/config.js or provide one for this host.";
      }
      options.key = Fs.readFileSync(Config.frontend.keyf);
      options.cert = Fs.readFileSync(Config.frontend.certf);
      options.ca = !_.isEmpty(Config.frontend.caf) && Fs.readFileSync(Config.frontend.caf);
    }
  } else {
    throw new Error("Invalid hostType: " + type);
  }
  return Proto;
}

function handle (httpRequest, httpResponse) {

  var contentTypeFields = (httpRequest.headers["content-type"] || "").split(";");
  var contentType = contentTypeFields[0] || "";
  var charset = ((contentTypeFields[1] || "").match("charset=(.+)") || [])[1];
  charset = charset || host.encoding || "utf8";

  var request = {
    localAddress: httpRequest.connection.localAddress,
    localPort: httpRequest.connection.localPort,
    remoteAddress: httpRequest.connection.remoteAddress,
    remotePort: httpRequest.connection.remotePort,
    data: "",
    fields: []
  };

  request.fields.push({ field: "method", value:  httpRequest.method });
  request.fields.push({ field: "url", value: httpRequest.url });
  _.forEach(httpRequest.headers, (value, name) => request.fields.push({ field: name, value: value }));

  httpRequest.setEncoding(charset);

  httpRequest.on("data", (chunk) => {
    request.data += chunk;
  });

  httpRequest.on("end", () => {

    Log.debug("Request: " +
      httpRequest.method + " " +
      host.hostType + "://" + request.remoteAddress + ":" + request.remotePort + httpRequest.url + " " +
      contentType + " " +
      request.data);

    receive(request, (response) => {

      var fstatusCode = _.find(response.fields, { field: "statusCode" });
      if (fstatusCode && !_.isEmpty(fstatusCode.value)) {
        httpResponse.statusCode = +fstatusCode.value;
      } else if (!_.isEmpty(response.data)) {
        httpResponse.statusCode = 200;
      } else {
        httpResponse.statusCode = 404;
      }

      if (!_.isEmpty(response.data)) {

        var fcontentType = _.find(response.fields, { field: "content-type" });
        if (fcontentType && !_.isEmpty(fcontentType.value)) {
          httpResponse.setHeader("content-type", fcontentType.value);
        } else if (!_.isEmpty(contentType)) {
          httpResponse.setHeader("content-type", contentType + "; charset=" + charset);
        }

        var fcontentLength = _.find(response.fields, (f) => _.isEqual(_.toLower(f.field), "content-length"));
        if (fcontentLength) {
          httpResponse.setHeader("Content-Length", fcontentLength.value);
        } else {
          //httpResponse.setHeader("Content-Length", response.data.length);
        }
        
        httpResponse.write(response.data, charset, () => {
          httpResponse.end(finish);
        });

      } else {
        httpResponse.end(finish);
      }

      Log.debug("Response: " +
        httpRequest.method + " " +
        host.hostType + "://" + request.remoteAddress + ":" + request.remotePort + httpRequest.url + " " +
        (fcontentType ? fcontentType.value : contentType) + " " +
        httpResponse.statusCode + " " +
        response.data);

      function finish () {
        if (!host.keepAlive) {
          Log.debug("Close " + httpRequest.connection.remoteAddress + ":" + httpRequest.connection.remotePort);
          httpRequest.connection.destroy();
        }
      }
    });
  });

  httpRequest.on("error", (error) => {
    receive(request, error);
  });
}

function request (request, config, callback) {

  if (!config && host.hostType == "server") throw new Error("Http client request not supported.");
  config = config || host;

  var options = {
    host: config.address,
    port: config.port,
    path: config.path || "",
    method: "POST",
    headers: {},
    rejectUnauthorized: false
  };

  var furl = _.find(request.fields, { field: "url" });
  if (furl && !_.isEmpty(furl.value)) {
    options.path += furl.value;
  }

  var fmethod = _.find(request.fields, { field: "method" });
  if (fmethod && !_.isEmpty(fmethod.value)) {
    options.method = fmethod.value;
  }

  var fcontentType = _.find(request.fields, { field: "content-type" }) || { value: "" };
  if (fcontentType && !_.isEmpty(fcontentType.value)) {
    options.headers["content-type"] = fcontentType.value;
  }

  var type = config.type || config.hostType;

  if (type == "https") {
    options.agent = new Https.Agent(options);
  }

  Log.debug("Request: " +
    options.method + " " +
    type + "://" + options.host + ":" + options.port + options.path + " " +
    (fcontentType ? fcontentType.value : ""));

  var Proto = type == "https" ? Https : Http;
  var start = Date.now();

  var httpRequest = Proto.request(options, (httpResponse) => {

    var response = {
      localAddress: httpRequest.connection.localAddress,
      localPort: httpRequest.connection.localPort,
      remoteAddress: config.address,
      remotePort: config.port,
      time: 0,
      data: "",
      fields: []
    };

    httpResponse.on("data", (chunk) => {
      response.data += chunk;
    });

    httpResponse.on("end", () => {
      response.time = Date.now() - start;

      response.fields.push({ field: "statusCode", value: httpResponse.statusCode });
      _.forEach(httpResponse.headers, (value, name) => response.fields.push({ field: name, value: value }));

      Log.debug("Response: " +
        options.method + " " +
        type + "://" + response.remoteAddress + ":" + response.remotePort + options.path + " " +
        (fcontentType ? fcontentType.value : "") + " " +
        httpResponse.statusCode + " " +
        response.data);

      callback(null, response);

      if (!host.keepAlive) {
        Log.debug("Close " + httpResponse.connection.remoteAddress + ":" + httpResponse.connection.remotePort);
        httpResponse.connection.destroy();
      }
    });
  });

  httpRequest.on("error", function (error) {

    var response = {
      localAddress: httpRequest.connection.localAddress,
      localPort: httpRequest.connection.localPort,
      remoteAddress: config.address,
      remotePort: config.port,
      data: "",
      fields: []
    };

    callback(error, response);
  });

  httpRequest.write(request.data);
  httpRequest.end();
}

function close () {
  if (server) {
    Log.info("Closing " + host.hostType + " server on " + host.address + ":" + host.port);
    server.close();
  }
}
