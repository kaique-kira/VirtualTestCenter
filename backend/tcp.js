
exports.init = init;
exports.request = request;
exports.close = close;

const Config = require("../lib/config").init();
const Log = require("../lib/log").init(Config.log);
const Core = require("../lib/core");

const Fs = require("fs");
const Net = require("net");
const TLS = require("tls");
const _ = require("lodash");

const StringDecoder = require("string_decoder").StringDecoder;

var host = null;
var receive = null;
var server = null;
var connections = [];

function init (config, handler) {
  host = config;
  receive = handler;

  var options = {};
  var Proto = getProtoOpts(config, options);

  Log.trace("Initialize " + config.hostType + " " + config.connType + "...");

  if (config.connType == "server") {
    server = Proto.createServer(options, accept);
    server.listen(config.port, config.address, () => {
      Log.info("Listening on " + config.address + ":" + config.port);
    });
  } else if (config.connType == "client") {
    if (config.keepAlive) setInterval(() => {
      if (!_.find(connections, { config: host })) connect(host);
    }, Config.backend.connInterval);
  } else {
    throw new Error("Invalid connType: '" + config.connType + "'.");
  }
}

function close () {
  if (server) {
    Log.info("Closing " + host.hostType + " server on " +
              host.address + ":" + host.port);
    server.close();
  }
  _.forEach(connections, (client) => {
    Log.info("Ending " + host.hostType + " client " +
              client.remoteAddress + ":" + client.remotePort +
              " on " + host.address + ":" + host.port);
    client.end();
  });
}

function accept (socket) {

  Log.info("Accepting connection from " + socket.remoteAddress + ":" + socket.remotePort +
           " on " + host.hostType + "://" + host.address + ":" + host.port);

  return bind(socket);
}

function connect (target, callback) {
  var type = getProtoType(target);

  var options = {};
  var Proto = getProtoOpts(target, options);

  Log.debug("Connecting to " + type + "://" + target.address + ":" + target.port);
  var socket = Proto.connect(target.port, target.address, options, () => {
    Log.info("Connected to " + type + "://" + target.address + ":" + target.port);
    if (callback) callback();
  });

  return bind(socket, target);
}

function bind (socket, config) {
  config = config || host;

  var client = {
    config: config,
    status: socket.connecting ? "connecting" : "idle",
    created: new Date(),
    type: getProtoType(config),
    localAddress: socket.localAddress,
    localPort: socket.localPort,
    remoteAddress: socket.remoteAddress || config.address,
    remotePort: socket.remotePort || config.port,
    socket: socket,
    callback: null,
    end: end,
    send: write,
    receive: recv
  };

  var buff = null;
  var len = 0;
  var flushTimer = null;
  var receiveTimer = null;

  function connect () {
      client.status = "idle";
    _.assignIn(client, {
      localAddress: socket.localAddress,
      localPort: socket.localPort,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
    });
  }

  function error (error, data) {
    client.status = "error";
    var message = data ? data.toString("hex") : "";
    Log.error("Connection: " + error + " on " + host.hostType + "://" +
              client.remoteAddress + ":" + client.remotePort);
    handle("Connection: " + error, message);
    end();
  }

  function close () {
    if (client.status == "ended") {
      Log.info("Ended " + client.remoteAddress + ":" + client.remotePort);
    } else {
      Log.info("Close " + client.remoteAddress + ":" + client.remotePort);
      if (client.status != "idle") error("Closed");
      else client.status = "closed";
    }
    connections.splice(_.indexOf(connections, client), 1);
  }

  function write (data) {
    if (client.status == "closed" || client.socket.destroyed) {
      throw "Connection: Closed";
    }

    var offset = 0;
    const mliEncoding = client.config.mliEncoding || "binary";
    const mliSize = client.config.mliSize || 0;
    var prepend = Buffer.from(client.config.prepend || "", "hex");
    var buff = Buffer.alloc(client.config.mliSize + prepend.length + data.length);

    if (client.config.mliSize > 0) {
      var len = buff.length - client.config.mliSize;
      if (mliEncoding == "binary") {
        if (client.config.mliEndianness == "big") {
          buff.writeUIntBE(len, 0, client.config.mliSize);
        } else if (client.config.mliEndianness == "little") {
          buff.writeUIntLE(len, 0, client.config.mliSize);
        }
      } else if (mliEncoding == "ascii") {
        var mli = ("00000000" + len).slice(-mliSize);
        buff.write(mli);
      }
      offset += client.config.mliSize;
    }

    if (prepend.length > 0) {
      offset += prepend.copy(buff, offset);
    }

    buff.write(data, offset, client.config.encoding);
    client.socket.write(buff);
  }

  function read (data) {
    var offset = 0;

    if (!buff) {
      if (client.config.mliSize > 0) {
        if (data.length < client.config.mliSize) {
          return error("Message too short for mliSize=" + client.config.mliSize + " bytes", data);
        }
        let size = data.length;
	let mliEncoding = client.config.mliEncoding || "binary";
	
	if (mliEncoding == "binary") {
          if (client.config.mliEndianness == "big") {
            size = data.readUIntBE(0, client.config.mliSize);
          } else if (client.config.mliEndianness == "little") {
            size = data.readUIntLE(0, client.config.mliSize);
          }
        } else if (mliEncoding == "ascii") {
          size = parseInt(data.slice(0, client.config.mliSize).toString());
        }

       if (size > 65535) {
          return error("MLI limit is 64KiB.", data);
        }
        buff = Buffer.alloc(size);
        offset = client.config.mliSize;
      } else {
        buff = data;
      }
      len = 0;
    }

    var chunklen = buff.length - len;
    if (chunklen > data.length - offset) chunklen = data.length - offset;
    data.copy(buff, len, offset, offset + chunklen);
    len += chunklen;

    Log.debug("Read chunk " + chunklen + " bytes");
    if (len >= buff.length) {
      if (len < client.config.skip) {
        return error("Message too short for skip=" + client.config.skip + " bytes", buff);
      }
      try {
        var message = buff.toString(client.config.encoding, client.config.skip);
        handle(null, message);
      } catch (e) {
        return error(e, data);
      }
      buff = null;
      len = 0;
    }

    var remaining = data.length - offset - chunklen;
    if (remaining > 0) {
      let chunk = Buffer.alloc(remaining);
      data.copy(chunk, 0, data.length - remaining);
      return read(chunk);
    }

    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (buff) {
      flushTimer = setTimeout(flush, client.config.flushTimeout || Config.backend.flushTimeout);
    } else if (!client.config.keepAlive && client.status == "idle") {
      end();
    }
  }

  function flush () {
    if (buff) return error("Incomplete message flushed", buff);
    buff = null;
    len = 0;
  }

  function recv (callback, timeout) {
    client.status = "receiving";
    receiveTimer = setTimeout(() => {
      client.status = "timeout";
      error("Receive timeout");
    }, timeout);
    client.callback = function (error, message) {
      client.status = "idle";
      client.callback = null;
      callback(error, message);
    };
  }

  function handle (error, message) {
    if (receiveTimer) {
      clearTimeout(receiveTimer);
      receiveTimer = null;
    }
    if (client.callback) {
      return client.callback(error, message);
    }
    return incoming(error, message, client);
  }

  function end () {
    if (!client.socket.destroyed) {
      if (client.status != "error") client.status = "ended";
      client.socket.end();
    }
    if (flushTimer) clearTimeout(flushTimer);
    if (receiveTimer) clearTimeout(receiveTimer);
  }

  client.socket.on("connect", connect);
  client.socket.on("close", close);
  client.socket.on("error", error);
  client.socket.on("data", (data) => {

    Log.debug("Read " + data.length + " bytes from " + client.remoteAddress + ":" + client.remotePort +
              " on " + client.type + "://" + client.localAddress + ":" + client.localPort);

    read(data);
  });

  connections.push(client);
  return client;
}

function getProtoType (config) {
  return config.type || config.hostType || "tcp";
}

function getProtoOpts (config, options) {
  var type = getProtoType(config);
  var Proto = null;
  if (type == "tcp") {
    Proto = Net;
  } else if (type == "tls") {
    Proto = TLS;
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

function clientInfo (client) {
  return {
    localAddress: client.localAddress,
    localPort: client.localPort,
    remoteAddress: client.remoteAddress,
    remotePort: client.remotePort
  };
}

function incoming (error, message, client) {

  // TODO: Change host to accept incoming errors. Is that a good idea?
  if (error) return;

  Log.debug("Receive from " + client.remoteAddress + ":" + client.remotePort +
             " on " + host.hostType + "://" + host.address + ":" + host.port + " " + message);

  client.status = "receiving";

  var request = _.assignIn({
    data: message
  }, clientInfo(client));

  return receive(request, (response) => {

    if (response.data) {
      Log.debug("Respond tcp://" + client.remoteAddress + ":" + client.remotePort + " " + response.data);

      client.send(response.data);
    }

    client.status = "idle";
  });
}

function request (request, target, callback) {

  /*
  var client = _.find(connections, {
    status: "idle",
    remoteAddress: (target && target.address) || host.address,
    remotePort: (target && target.port) || host.port
  });
  */
  Log.debug("Target " + JSON.stringify(target));
  var client = _.find(connections, (conn) => {
    return conn.status == "idle" &&
    conn.remoteAddress == ((target && target.address) || host.address),
    conn.remotePort == ((target && target.port) || host.port)
  });
 
  if (!client) {
    Log.debug("Client not found");
    if (target || host.connType == "client") {
      client = connect(target || host, send);
    } else return setTimeout(() => {
      callback("Connection: No client available.", {
        localAddress: host.address,
        localPort: host.port,
        remoteAddress: host.address,
        remotePort: host.port
      });
    }, 0);
  }

  if (client.status == "idle") send();

  function send () {
    Log.debug("Request " + client.type + "://" + client.remoteAddress + ":" + client.remotePort + " " + request.data);

    try {
      client.send(request.data);
    } catch (error) {
      callback(error);
    }
  }

  client.receive((error, data) => {
    Log.debug("Response " + client.type + "://" + client.remoteAddress + ":" + client.remotePort + " " + error + " " + data);

    var response = _.assignIn(clientInfo(client), {
      data: data || ""
    });

    callback(error, response);
  }, request.timeout || Config.backend.requestTimeout);
}
