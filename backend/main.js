

const Config = require("../lib/config").init();
const Log = require("../lib/log").init(Config.log);

const  _ = require("lodash");
const Child = require("child_process");
const MongoClient = require("mongodb").MongoClient;

var dbvtp = null;
var instances = [];

init();

function init () {

  Log.trace("Connecting to db..");

  MongoClient.connect(Config.db.url, (error, db) => {

    if (error) {
      Log.error("Could not connect to: " + Config.db.url);
      process.exit(1);
    }

    Log.info("Connected to: " + Config.db.url);

    dbvtp = db;

    setInterval(updateInstances, Config.backend.updateInterval);
  });
}

function updateInstances () {

  dbvtp.collection("hosts").find().toArray((error, results) => {

    if (error) {
      Log.warn("Could not query hosts: " + error);
      return;
    }

    _.forEach(results, (host) =>  {
      var instance = _.find(instances, { hostId: host._id });

      if (instance) {
        instance.configExists = true;
        instance.detach = !host.enabled;
        if (host.enabled && host.modified > instance.modified) {
          instance.modified = host.modified;
          Log.trace("Reload host " + host._id);
          instance.process.send({
            command: "reload"
          });
          instance.busy = true;
        }
      } else if (host.enabled) {
        Log.trace("Enable host " + host._id);
        instance = {};
        instance.configExists = true;
        instance.hostId = host._id;
        instance.modified = host.modified || new Date();
        instance.env = Object.create(process.env);
        instance.env.TZ = host.timezone || "UTC";
        instance.process = Child.fork("./backend/host", {
          env: instance.env
        });
        instance.process.on("message", (message) => {
          receive(instance, message);
        });
        instance.process.on("exit", (code, signal) => {
          Log.warn("Host " + host._id + " exited code: " + code);
          _.remove(instances, { hostId: host._id });
        });
        instances.push(instance);
      }
    });

    _.forEach(instances, (instance) => {
      if (!instance.configExists || (instance.detach && !instance.busy)) {
        Log.trace("Disable host " + instance.hostId);
        instance.process.send({
          command: "detach"
        });
        instance.busy = true;
      }
      instances.configExists = undefined;
    });
  });
}

function receive (instance, message) {

  Log.debug("message: " + JSON.stringify(message));

  if (_.isUndefined(message.event)) {
    Log.error(instance.process.pid + ": Missing 'event' parameter.");
    return;
  }

  if (message.event == "ready") {
    if (!instance.attached) {
      instance.process.send({
        command: "attach",
        hostId: instance.hostId
      });
    }
    instance.busy = false;
  }

  if (message.event == "attached") {
    instance.attached = true;
  }

  if (message.event == "exit") {
    removeInstance(instance.hostId);
  }
}

function removeInstance (hostId)  {

  var instance = _.find(instances, function (i) {
    return _.isEqual(i.hostId, hostId);
  });

  if (!_.isUndefined(instance)) {
    instances.splice(instances.indexOf(instance), 1);
    Log.trace("Detached hostId: " + hostId);
  } else {
    Log.trace("Invalid hostId: " + hostId);
  }
}
