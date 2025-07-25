
const Config = require("../lib/config").init();
const Log = require("../lib/log").init(Config.log);
const Core = require("../lib/core");
const ObjDef = require("../lib/objdef");
const Ws = require(__dirname + "/app/js/ws");

const Assert = require("assert");
const Fs = require("fs");
const Http = require("http");
const Https = require("https");
const Crypto = require("crypto");

const  _ = require("lodash");
const Express = require("express");
const BodyParser = require("body-parser");
const MongoClient = require("mongodb").MongoClient;
const ObjectID = require("mongodb").ObjectID;

const Resources = {

  pulls: [],

  "sessions": {
  },

  "domains": {
    primary: ["name", "assets", "issues", "resports.name"],

    onquery: [
      queryById,
      queryByIds,
      validateDomainQueryIds,
      queryDocument
    ],

    onupdate: [
      findDocument,
      modifyDocument,
      validateDocument,
      updateDocument,
      respond()
    ]
  },

  "users": {

    onquery: [
      validateDomainId,
      queryByDomainId,
      queryById,
      queryByIds,
      queryDocument
    ]
  },

  "hosts": {
    primary: ["description", "logicId", "enabled", "connType", "hostType", "messageType", "address", "port", "chain"],

    onquery: [
      validateDomainId,
      queryByDomainId,
      queryById,
      queryByIds,
      queryByModified,
      queryDocument
    ],

    oninsert: [
      validateDomainId,
      findDomain,
      createDocument,
      validateDocument,
      insertDocument,
      respond((ctx) => ({
        id: ctx.host._id
      }))
    ],

    onupdate: [
      findDocument,
      modifyDocument,
      validateDocument,
      updateDocument,
      respond((ctx) => ({
        result: ctx.host
      }))
    ],

    ondelete: [
      findDocument,
      deleteDocument,
      respond()
    ]
  },

  "txns": {
    primary: ["hostId", "type", "status", "hostType", "messageType", "remoteAddress", "remotePort", "instant", "decodeTime", "processTime", "request.instant", "response.instant", "response.chained", "executionId"],

    onquery: [
      validateDomainId,
      queryByDomainId,
      queryById,
      queryByIds,
      queryByModified,
      queryByHostId,
      queryByExecutionId,
      queryDocument
    ],

    onupdate: [
      findDocument,
      modifyDocument,
      validateDocument,
      updateDocument,
      respond()
    ],
  },

  "assets": {
    primary: ["type", "description", "username"],

    onquery: [
      validateDomainId,
      queryByDomainId,
      queryById,
      queryByIds,
      queryByUserId,
      queryByType,
      queryDocument
    ],

    oninsert: [
      validateDomainId,
      findDomain,
      createDocument,
      validateDocument,
      insertDocument,
      respond((ctx) => ({
        id: ctx.asset._id
      }))
    ],

    onupdate: [
      findDocument,
      modifyDocument,
      validateDocument,
      updateDocument,
      respond()
    ],

    ondelete: [
      findDocument,
      deleteDocument,
      respond()
    ]
  },

  "tests": {
    primary: ["label", "title", "assets"],

    definition: {
      "label": { type: "string", empty: false },
      "title": { type: "string", empty: false },
      "description": { type: "string", defvalue: "" },
      "assets": { object: true, default: {}, each: {
        id: true /*, name: function (name) { return _.map(this.domain.assets, "type") }, validate: existsInCollection("assets")*/
      }},
      "goals": { array: true, default: [], each: { definition: {
        "type": { type: "string", values: ["user_input", "txn_inbound", "txn_outbound", "card_validation"] },
        "description": { type: "string", defvalue: "" },
        "options_type": { type: "string", values: ["checkbox", "radio"] },
        "options": { array: true, each: { type: "string" } },
        "allow_comment": { type: "boolean" },
        "require_comment": { type: "boolean" },
        "request": { object: true, required: (goal) => goal.type == "txn_inbound" || goal.type == "txn_outbound", definition: {
          "matches": { array: true, each: { definition: {
            "field": { type: "string", empty: false },
            "expr": { type: "string", empty: false }
          }}},
          "validations": { array: true, each: { definition: {
            "field": { type: "string", empty: false },
            "expr": { type: "string", defvalue: "" }
          }}}
        }},
        "response": { object: true, required: (goal) => goal.type == "txn_inbound" || goal.type == "txn_outbound", definition: {
          "data": { type: "string", defvalue: null }
        }},
        "label": { type: "string" },
        "validations": { array: true, required: (goal) => goal.type == "card_validation", each: {  definition: {
          "request": { type: "string", empty: false },
          "expr": { type: "string", defvalue: "" },
          "response": { type: "string", defvalue: "" },
          "sw": { type: "string", defvalue: "" }
        }}}
      }}}
    },

    onquery: [
      validateDomainId,
      queryByDomainId,
      queryById,
      queryByIds,
      queryDocument
    ],

    oninsert: [
      validateDomainId,
      findDomain,
      createDocument,
      validateDocument,
      insertDocument,
      respond((ctx) => ({
        id: ctx.test._id
      }))
    ],

    onupdate: [
      findDocument,
      modifyDocument,
      validateDocument,
      updateDocument,
      respond()
    ],

    ondelete: [
      findDocument,
      deleteDocument,
      respond()
    ],

    onexecute: [
      findDocument,
      findRun,
      findAssets,
      createExecutions,
      insertExecutions,
      respond((ctx) => ({
        executionId: ctx.executions[0]._id
      })),
      findExecutions,
      refreshRun,
      updateRun
    ]
  },

  "scenarios": {
    primary: ["name", "description"],

    definition: {
      "name": { type: "string", empty: false },
      "description": { type: "string", defvalue: "" },
      "tests": { array: true, each: { id: true }}
    },

    onquery: [
      validateDomainId,
      queryByDomainId,
      queryById,
      queryByIds,
      queryDocument
    ],

    oninsert: [
      validateDomainId,
      findDomain,
      createDocument,
      validateDocument,
      insertDocument,
      respond((ctx) => ({
        id: ctx.scenario._id
      }))
    ],

    onupdate: [
      findDocument,
      modifyDocument,
      validateDocument,
      updateDocument,
      respond()
    ],

    ondelete: [
      findDocument,
      deleteDocument,
      respond()
    ],

    onexecute: [
      findDocument,
      findRun,
      findTests,
      findAssets,
      createExecutions,
      insertExecutions,
      findExecutions,
      refreshRun,
      updateRun,
      respond((ctx) => ({ runId: ctx.run._id }))
    ]
  },

  "executions": {
    primary: ["status", "result", "created", "finished", "username", "scenario.name", "scenario.sequence", "test.label", "test.title"],

    definition: {
      "status": { type: "string", empty: false, values: ["waiting", "active", "review", "finished", "closed"] },
      "result": { type: "string", values: ["pass", "skipped", "impact", "review", "fail"] },
      "runId": { id: true },
      "userId": { id: true },
      "scenario": { object: true, definition: {
        "id": { id: true }
      }},
      "test": { object: true, definition: {
        "id": { id: true },
        "goals": { array: true, default: [], each: {
          object: true, definition: {
            "type": { type: "string", values: ["user_input", "txn_inbound", "txn_outbound", "card_validation"] },
            "txnId": { id: true }
          }
        }}
      }}
    },

    onquery: [
      validateDomainId,
      queryByDomainId,
      queryById,
      queryByIds,
      queryByRunId,
      queryByRunIds,
      queryByScenarioId,
      queryByModified,
      queryDocument
    ],

    oninsert: [
      validateDomainId,
      findDomain,
      createDocument,
      validateDocument,
      insertDocument,
      findRun,
      findExecutions,
      refreshRun,
      updateRun,
      respond((ctx) => ({
        id: ctx.execution._id
      }))
    ],

    onupdate: [
      findDocument,
      modifyExecution,
      validateDocument,
      updateExecutionCardValidations,
      updateDocument,
      respond((ctx) => ({
        result: ctx.execution
      })),
      findRun,
      findExecutions,
      refreshRun,
      updateRun
    ],

    ondelete: [
      findDocument,
      deleteDocument,
      findRun,
      findExecutions,
      refreshRun,
      updateRun,
      respond()
    ]
  },

  "runs": {
    primary: ["name", "status", "started", "finished", "waiting", "pass", "skipped", "impact", "fail"],

    definition: {
      "status": { type: "string", empty: false, values: ["open", "active", "closed"] },
      "name": { type: "string", empty: false },
      "description": { type: "string" }
    },

    onquery: [
      validateDomainId,
      queryByDomainId,
      queryById,
      queryByIds,
      queryByStatus,
      queryByModified,
      queryDocument
    ],

    oninsert: [
      validateDomainId,
      findDomain,
      createDocument,
      validateDocument,
      insertDocument,
      respond((ctx) => ({
        id: ctx.run._id
      }))
    ],

    onupdate: [
      findDocument,
      modifyRun,
      validateDocument,
      findExecutions,
      refreshRun,
      updateDocument,
      updateExecutionsStatus,
      respond()
    ],

    ondelete: [
      findDocument,
      deleteDocument,
      deleteExecutions,
      respond()
    ]
  },

  "issues": {
    primary: [ "type", "name", "createdByUsername" ],

    definition: {
      "runId": { id: true },
      "type": { type: "string", empty: false },
      "name": { type: "string", empty: false },
      "description": { type: "string" }
    },

    onquery: [
      validateDomainId,
      queryByDomainId,
      queryById,
      queryByIds,
      queryByModified,
      queryByRunId,
      queryDocument
    ],

    oninsert: [
      validateDomainId,
      findDomain,
      createDocument,
      validateDocument,
      insertDocument,
      respond((ctx) => ({
        id: ctx.issue._id
      }))
    ],

    onupdate: [
      findDocument,
      modifyDocument,
      validateDocument,
      updateDocument,
      respond()
    ],

    ondelete: [
      findDocument,
      deleteDocument,
      respond()
    ]
  }
};

const ReadOnlyFields = [
  "id",
  "_id",
  "domainId",
  "created",
  "createdByUserId",
  "createdByUsername",
  "modified"
]

const app = Express();
var db = null;

Log.trace("Connecting to db..");
MongoClient.connect(Config.db.url, function (error, conn) {

  if (error) {
    Log.error("Could not connect to: " + Config.db.url);
    process.exit(1);
  }

  Log.info("Connected to: " + Config.db.url);
  db = conn;

  setupRoutes();
});

function setupRoutes () {

  Log.info("Routes setup");

  app.use("/vendors", Express.static(__dirname + "/vendors"));
  app.use("/app", Express.static(__dirname + "/app"));
  app.use("/.well-known", Express.static(__dirname + "/certbot"));

  app.use("/ws/*", BodyParser.json({limit: "512kb"}));
  app.use("/ws/*", BodyParser.urlencoded({ extended: true }));

  app.post("/ws/signin", wsCall(wsSignIn));
  app.post("/ws/:session/signout", wsCall(wsSignOut));
  app.post("/ws/:session/info", wsCall(wsSession, wsInfo));
  app.post("/ws/:session/pull", wsCall(wsSession, wsPull));

  app.post("/ws/:session/:resource/:action", createCtx(
    findCurrentSession,
    findCurrentUser,
    setResource,
    executeAction
  ));

  //setInterval(doPull, Config.frontend.pull_interval);

  setupHttp();
}

function setupHttp () {

  if (!_.isEmpty(Config.frontend.keyf) && !_.isEmpty(Config.frontend.certf)) {

    /*
    Http.createServer(function (request, response) {
      response.writeHead(302, {
        "Location": "https://" + request.headers.host.split(":")[0] + request.url
      });
      response.end();
    }).listen(Config.frontend.port, () => {
      Log.info("Listening HTTP redirect on port " + Config.frontend.port);
    });
    */

    const insecureApp = Express();
    insecureApp.use("/.well-known", Express.static(__dirname + "/certbot"));
    insecureApp.use(function (request, response) {
      response.writeHead(302, {
        "Location": "https://" + request.headers.host.split(":")[0] + request.url
      });
      response.end();
    });
    Http.createServer(insecureApp).listen(Config.frontend.port, () => {
      Log.info("Listening HTTP redirect on port " + Config.frontend.port);
    });


    Log.info("Reading SSL key/cert.. ");

    Https.createServer({
      key: Fs.readFileSync(Config.frontend.keyf),
      cert: Fs.readFileSync(Config.frontend.certf),
      ca: Fs.readFileSync(Config.frontend.caf)
    }, app).listen(Config.frontend.portSSL, () => {
      Log.info("Listening HTTPS on port " + Config.frontend.portSSL);
    });

  } else {
    Log.info("Listening HTTP on port " + Config.frontend.port);
    app.listen(Config.frontend.port);
  }
}

/* New Stuff */

function parseId (value) {
  if (_.isEmpty(value)) return null;
  if (ObjectID.isValid(value)) return ObjectID(value);
  return null;
}

function parseIds (values) {
  var ids = [];
  _.forEach(values, (value) => {
    var id = parseId(value);
    if (id) ids.push(id);
    else ids = null;
    return id != null;
  });
  if (ids) return ids;
  return null;
}

function createCtx (chain) {
  var handlers = _.isArray(chain) ? chain : arguments;

  return function handleCall (request, response) {
    Log.debug(request.ip + " " + request.method + " " + request.originalUrl + " " + JSON.stringify(request.body));

    var ctx = {
      request: request,
      response: response,
      responded: false,
      start: new Date()
    };

    ctx.send = function (data) {
      Log.debug(request.ip + " " + request.method + " " + request.originalUrl + " " + data.status + ": " + data.message);

      ctx.responded = true
      ctx.response.type("json");
      return ctx.response.send(data);
    };

    ctx.status = function (status, message) {

      ctx.send({
        status: status,
        message: message
      });

      return status != Ws.Status.SUCCESS ? -1 : 0;
    };

    ctx.callback = function (callback) {
      return function (error) {
        if (error) {
          if (_.isPlainObject(error)) ctx.send(error);
          else if (_.isArray(error)) return ctx.status.apply(null, error);
          else return ctx.status(Ws.Status.ERROR, error);
        }
        return callback.apply(ctx, Array.prototype.slice.call(arguments, 1));
      }
    };

    ctx.call = function (func, args) {
      args = Array.prototype.slice.call(arguments, 1);
      Assert(args.length  > 1 && typeof args[args.length - 1] == "function", "Did you forget the callback?");
      args[args.length - 1] = ctx.callback(args[args.length - 1]);
      return func.apply(ctx, args);
    }

    var idx = 0;
    return function next () {
      if (idx < handlers.length) return handlers[idx++].call(ctx, ctx.callback(next));
      if (!ctx.responded) return ctx.status(Ws.Status.VOID, "Request returned no status.");
    }();
  }
}

function findCurrentSession (callback) {
  var ctx = this;

  var sessionId = parseId(ctx.request.params.session);
  if (!sessionId) return callback("Invalid session id value.");

  return db.collection("sessions").findOne({ _id: sessionId, status: "active" }, ctx.callback((result) => {
    if (_.isEmpty(result)) return callback([ Ws.Status.INVALID_LOGIN, "Session not found." ]);

    ctx.session = result;
    return callback();
  }));
}

function findCurrentUser (callback) {
  var ctx = this;

  db.collection("users").findOne({ _id: ObjectID(ctx.session.userId) }, ctx.callback((result) => {
    if (_.isEmpty(result)) return callback([ Ws.Status.INVALID_LOGIN, "User not found." ]);

    ctx.user = result;
    return callback();
  }));
}

function setResource (callback) {
  var ctx = this;

  var resource = Resources[ctx.request.params.resource];
  if (!resource) return callback("Invalid resource.");

  resource.name = ctx.request.params.resource;
  ctx.resource = resource;
  return callback();
}

function executeAction (callback) {
  var ctx = this;

  var actions = ctx.resource["on" + ctx.request.params.action];
  if (_.isEmpty(actions)) return callback("Invalid action.");

  var idx = 0;
  var next = ctx.callback(() => {
    if (idx < actions.length) return actions[idx++].call(ctx, next);
    return callback();
  });

  return next();
}

function respond (func) {
  return function (callback) {
    return callback(_.assignIn({
      status: Ws.Status.SUCCESS,
      message: "Success"
    }, func && func(this)));
  }
}

function findDocument (callback) {
  var ctx = this;
  var resource = ctx.resource;

  if (_.isUndefined(ctx.request.body.id)) return callback("Missing field 'id'.");

  var id = parseId(ctx.request.body.id);
  if (!id) return callback("Invalid value for field 'id'.");

  var query = { _id: id };

  if (resource.name != "domains") {
    query.domainId = { $in: [] };
    _.forEach(ctx.user.permissions, (perm) => query.domainId.$in.push(perm.domainId));
  }

  return db.collection(resource.name).findOne(query, ctx.callback((result) => {
    if (!result) return callback("Document not found.");

    var property = resource.name.endsWith("s") ? resource.name.slice(0, -1) : resource.name;
    ctx[property] = result;

    return callback();
  }));
}

function createDocument (callback) {
  var ctx = this;
  var resource = ctx.resource;

  if (_.isUndefined(ctx.request.body.domainId)) return callback("Missing field 'domainId'.");

  var domainId = parseId(ctx.request.body.domainId);
  if (!domainId) return callback("Invalid value for field 'domainId'.");

  var doc = _.assignIn({ domainId: domainId }, _.omit(ctx.request.body, ReadOnlyFields));

  var property = resource.name.endsWith("s") ? resource.name.slice(0, -1) : resource.name;
  ctx[property] = doc;

  return callback();
}

function modifyDocument (callback) {
  var ctx = this;
  var resource = ctx.resource;

  var property = resource.name.endsWith("s") ? resource.name.slice(0, -1) : resource.name;
  var doc = ctx[property];

  if (!doc) return callback("Document not found.");

  _.assignIn(doc, _.omit(ctx.request.body, ReadOnlyFields));

  return callback();
}

function validateDocument (callback) {
  var ctx = this;
  var resource = ctx.resource;

  if (_.isEmpty(ctx.resource.definition)) return callback();

  var property = resource.name.endsWith("s") ? resource.name.slice(0, -1) : resource.name;
  var doc = ctx[property];

  return ObjDef.validate.call(ctx, resource.definition, doc, (errors) => {
    if (!_.isEmpty(errors)) return callback(errors.toString());

    return callback();
  });
}

function insertDocument (callback) {
  var ctx = this;
  var resource = ctx.resource;

  var property = resource.name.endsWith("s") ? resource.name.slice(0, -1) : resource.name;
  var doc = ctx[property];

  if (_.isEmpty(doc)) return callback("Document cannot be empty.");
  if (_.isEmpty(doc.domainId)) return callback("Missing field 'domainId'.");

  var now = new Date();
  doc.created = now;
  doc.createdByUserId = ctx.user._id;
  doc.createdByUsername = ctx.user.username;
  doc.modified = now;

  Log.trace("executeInsert: " + JSON.stringify(doc));
  db.collection(ctx.request.params.resource).insertOne(doc, ctx.callback((result) => {
    if (result.insertedCount <= 0) return callback("Document not inserted.");

    doc._id = result.insertedId;
    return callback();
  }));
}

function updateDocument (callback) {
  var ctx = this;
  var resource = ctx.resource;

  var property = resource.name.endsWith("s") ? resource.name.slice(0, -1) : resource.name;
  var doc = ctx[property];

  if (!doc) return callback("Document not found.");

  var now = new Date();
  _.assignIn(doc, {
    modified: now
  });

  Log.trace("updateDocument: " + doc._id + "; " + JSON.stringify(doc));
  return db.collection(resource.name).replaceOne({ _id: doc._id }, doc, ctx.callback((result) => {
    if (result.modifiedCount <= 0) return callback("Document not found.");

    return callback();
  }));
}

function deleteDocument (callback) {
  var ctx = this;
  var resource = ctx.resource;

  var property = resource.name.endsWith("s") ? resource.name.slice(0, -1) : resource.name;
  var doc = ctx[property];

  if (!doc) return callback("Document not found.");

  return db.collection(resource.name).deleteOne({ _id: doc._id }, ctx.callback((result) => {
    if (result.deletedCount <= 0) return callback("Couldn't remove document.");

    return callback();
  }));
}

function validateDomainId (callback) {
  var ctx = this;

  if (_.isUndefined(ctx.request.body.domainId)) return callback("Missing field 'domainId'.");

  var id = parseId(ctx.request.body.domainId);
  if (!id) return callback("Invalid value for field 'domainId'.");

  var granted = false;
  _.forEach(ctx.user.permissions, (perm) => {
    return !(granted = id.equals(perm.domainId));
  });

  if (!granted) return callback("Permission not granted.");

  ctx.request.body.domainId = id;
  callback();
}

function findDomain (callback) {
  var ctx = this;

  if (_.isUndefined(ctx.request.body.domainId)) return callback("Missing field 'domainId'.");

  var id = parseId(ctx.request.body.domainId);
  if (!id) return callback("Invalid value for field 'domainId'.");

  return db.collection("domains").findOne({ _id: id }, ctx.callback((result) => {
    if (!result) return callback("Domain not found.");

    ctx.domain = result;
    callback();
  }));
}

function findTests (callback) {
  var ctx = this;
  ctx.tests = [];

  var ids = [];

  if (!_.isEmpty(ctx.request.body.tests)) {
    ids = parseIds(ctx.request.body.tests);
    if (!ids) return callback("Invalid value for field 'tests'.");
  } else if (ctx.scenario) {
    ids = parseIds(ctx.scenario.tests);
  }

  if (_.isEmpty(ids)) return callback();

  return db.collection("tests").find({ _id: { $in: ids }}).toArray(ctx.callback((results) => {

    // TODO: Should we check if the right amount of tests were returned?

    ctx.tests = results;
    return callback();
  }));
}

function findAssets (callback) {
  var ctx = this;
  ctx.assets = [];

  var tests = [];

  if (ctx.test) tests = [ ctx.test ];
  else if (ctx.tests) tests = ctx.tests;

  var ids = [];

  _.forEach(tests, (test) => {
    _.forEach(test.assets, (id) => id && ids.indexOf(id) < 0 && ids.push(id))
  });

  if (_.isEmpty(ids)) return callback();

  console.log("findAssets: " + ids);
  return db.collection("assets").find({ _id: { $in: ids }}).toArray(ctx.callback((results) => {

    ctx.assets = results;
    return callback();
  }));
}

function findExecutions (callback) {
  var ctx = this;
  ctx.executions = [];

  if (!ctx.run) return callback();

  return db.collection("executions").find({ runId: ctx.run._id }).toArray(ctx.callback((results) => {

    // TODO: Should we check if the right amount of tests were returned?

    ctx.executions = results;
    return callback();
  }));
}

function createExecutions (callback) {
  var ctx = this;
  var tests = [];

  if (ctx.test) tests = [ ctx.test ];
  else if (ctx.tests) tests = ctx.tests;

  if (_.isEmpty(tests)) return callback();

  var domainId = parseId(ctx.request.body.domainId);
  if (ctx.run) domainId = ctx.run.domainId;

  ctx.executions = [];
  var sequence = [];

  if (ctx.scenario) {
    _.forEach(ctx.scenario.tests, (id) => {
      var test = _.find(tests, (test) => ObjectID(id).equals(test._id));
      if (test) sequence.push(test);
    });
  } else {
    sequence = tests;
  }

  _.forEach(sequence, (test, idx) => {

    var execution = {
      domainId: domainId || test.domainId,
      status: "waiting",
      result: null,
      started: null,
      finished: null,
      userId: ctx.user._id,
      username: ctx.user.username,
      runId: ctx.run && ctx.run._id,
      scenario: ctx.scenario && {
        id: ctx.scenario._id,
        name: ctx.scenario.name,
        sequence: idx
      },
      test: {
        id: test._id,
        label: test.label,
        title: test.title,
        description: test.description,
        assets: {},
        goals: test.goals
      }
    };

    _.forEach(test.assets, (id, type) => {
      var asset = _.find(ctx.assets, { _id: id });
      execution.test.assets[type] = asset ? _.omit(asset, ["domainId", "type"]) : null;
    });

    ctx.executions.push(execution);
  });

  return callback();
}

function insertExecutions (callback) {
  var ctx = this;
  var executions = ctx.executions;

  if (_.isEmpty(executions)) return callback();

  var now = new Date();

  _.forEach(executions, (execution) => {
    execution.created = now;
    execution.createdByUserId = ctx.user._id;
    execution.createdByUsername = ctx.user.username;
    execution.modified = now;
  });

  Log.trace("insertExecutions: " + JSON.stringify(executions));
  db.collection("executions").insertMany(executions, ctx.callback((result) => {
    if (result.insertedCount <= 0) return callback("Couldn't insert executions.");

    _.forEach(result.insertedIds, (id, idx) => {
      executions[idx]._id = id;
    });

    return callback();
  }));
}

function modifyExecution (callback) {
  var ctx = this;
  var execution = ctx.execution;

  if (!execution) return callback();

  var now = new Date();

  if (ctx.request.body.status != execution.status) {
    if (ctx.request.body.status == "active") {
      execution.started = now;
      execution.finished = null;
      execution.userId = ctx.user._id;
      execution.username = ctx.user.username;
    }
    if (ctx.request.body.status == "finished") {
      execution.finished = now;
    }
    if (ctx.request.body.status == "closed") {
      if (!execution.finished) execution.finished = now;
    }
  }

  _.assignIn(execution, _.omit(ctx.request.body, _.concat(ReadOnlyFields, [
    "started",
    "finished",
    "userId",
    "username"
  ])));

  if (execution.status == "active" && _.findIndex(_.values(execution.test.assets), _.isNil) >= 0) return callback("Asset cannot be Nil for an active execution.");

  return callback();
}

function deleteExecutions (callback) {
  var ctx = this;

  var query = {};

  if (ctx.resource.name == "runs" && ctx.request.body.id) {
    var id = parseId(ctx.request.body.id);
    if (!id) return callback("Invalid value for field 'id'.");

    query.runId = id;
    ctx.request.body.id = id;
  }

  if (_.isEmpty(query)) return callback();

  return db.collection("executions").deleteMany(query, ctx.callback((result) => {
    return callback();
  }));
}

function updateExecutionCardValidations (callback) {
  var ctx = this;
  var execution = ctx.execution;

  if (!execution) return callback();

  var properties = {};
  _.forEach(execution.test.assets, (asset, type) => {
    if (asset) _.forEach(asset.properties, (value, key) => properties[type + "." + key] = value);
  });
 
  _.forEach(execution.test.goals, (goal) => {
    if (goal.type == "card_validation") {
      if (goal.card)  {
        _.forEach(goal.validations, (validation) => {
          let vctx = {
            execution: execution,
            test: execution.test,
            goals: execution.test.goals,
            properties: properties,
            fields: [],
            handlers: Core.handlers
          };
          validation.exprValue = Core.parse.call(vctx, validation.expr);
          Log.debug("updateExecutionCardValidations: Log = " + vctx.log);
        });
        let index = goal.card.log.length;
        let anyMatch = false;
        while (--index >= 0) {
          let entry = goal.card.log[index];
          if (entry.type == "APDU" && !_.isNil(entry.match)) anyMatch = true;
          if (entry.type == "SELECT" && anyMatch) break;
        }
        while (++index < goal.card.log.length) {
          let entry = goal.card.log[index];
          if (entry.match >= 0 && entry.match < goal.validations.length) {
            let validation = goal.validations[entry.match];
            validation.value = entry.request;
            let exprValue = (validation.exprValue || "").replace(/\s/g, "");
            try {
              let expr = new RegExp(exprValue, "gi");
              validation.result = expr.test(validation.value) ? "pass" : "fail";
            } catch (error) {
              validation.result = "fail";
            }
          }
        }
        _.forEach(goal.validations, (validation) => {
          if (!validation.result) validation.result = "fail";
        });
      } else {
       _.forEach(goal.validations, (validation) => {
          validation.value = null;
          validation.result = null;
          if (validation.response) {
             validation.responseValue = Core.parse.call({
               properties: properties,
               fields: [],
               handlers: Core.handlers
             }, validation.response);              
          }
          if (validation.kMod) {
            validation.kModValue = Core.parse.call({
              properties: properties,
              fields: [],
              handlers: Core.handlers
            }, validation.kMod);
          }
          if (validation.kExp) {
            validation.kExpValue = Core.parse.call({
              properties: properties,
              fields: [],
              handlers: Core.handlers
            }, validation.kExp);
          }
        });
      }
    }
  });

  return callback();
}

function findRun (callback) {
  var ctx = this;

  if (_.isNil(ctx.request.body.runId)) return callback();

  var id = parseId(ctx.request.body.runId);
  if (!id) return callback("Invalid value for field 'runId'.");

  return db.collection("runs").findOne({ _id: id }, ctx.callback((result) => {
    if (!result) return callback("Run not found.");

    ctx.run = result;
    return callback();
  }));
}

function createRun (callback) {
  var ctx = this;
  var source = ctx.test || ctx.scenario;

  if (ctx.run || !source) return callback();

  var doc = {
    domainId: source.domainId,
    status: "",
    name: "",
    description: ""
  };

  ctx.run = _.assignIn(doc, _.pick(ctx.request.body, _.keys(doc)));

  return callback();
}

function modifyRun (callback) {
  var ctx = this;
  var run = ctx.run;

  if (!run) return callback();

  var now = new Date();

  if (ctx.request.body.status != run.status) {
    if (ctx.request.body.status == "active") {
      run.started = run.started || now;
      run.finished = null;
    }
    if (ctx.request.body.status == "closed") {
      if (!run.started) run.started = now;
      run.finished = now;
    }
  }

  _.merge(run, _.omit(ctx.request.body, _.concat(ReadOnlyFields, [
    "started",
    "finished"
  ])));

  return callback();
}

function refreshRun (callback) {
  var ctx = this;
  var run = ctx.run;

  if (!run && _.isEmpty(ctx.executions)) return callback();

  run.total = 0;
  run.pass = 0;
  run.skipped = 0;
  run.impact = 0;
  run.fail = 0;
  run.scenarios = 0;

  var scenarios = [];

  _.forEach(ctx.executions, (execution) => {
    if (run.status == "closed") execution.status = "closed";
    else if (execution.status == "closed") execution.status = "finished";

    run.total++;
    if (execution.result == "pass") run.pass++;
    if (execution.result == "skipped") run.skipped++;
    if (execution.result == "impact") run.impact++;
    if (execution.result == "fail") run.fail++;
    if (execution.scenario && _.indexOf(scenarios, execution.scenario.id) < 0) {
      scenarios.push(execution.scenario.id);
    }
  });

  run.scenarios = scenarios.length;

  return callback();
}

function insertRun (callback) {
  var ctx = this;
  var run = ctx.run;

  if (!run || run._id) return callback();

  var now = new Date();
  run.created = now;
  run.createdByUserId = ctx.user._id;
  run.createdByUsername = ctx.user.username;
  run.modified = now;

  Log.trace("insertRun: " + JSON.stringify(run));
  db.collection("runs").insertOne(run, ctx.callback((result) => {
    if (result.insertedCount <= 0) return callback("Couldn't insert run.");

    run._id = result.insertedId;
    return callback();
  }));
}

function updateRun (callback) {
  var ctx = this;
  var run = ctx.run;

  if (!run) return callback();

  var now = new Date();
  run.modified = now;

  Log.trace("updateRun: " + run._id + " " + JSON.stringify(run));
  return db.collection("runs").replaceOne({ _id: run._id }, run, ctx.callback((result) => {
    if (!result.modifiedCount) return callback("Couldn't update ''" + run._id + "'.");

    return callback();
  }));
}

function updateExecutionsStatus (callback) {
  var ctx = this;
  var run = ctx.run;

  if (!run) return callback();

  var now = new Date();

  var query = { runId: run._id };
  var update = { $set: { modified: now }};

  if (run.status == "closed") {
    query.status = { $ne: run.status };
    update.$set.status = "closed";
  } else {
    query.status = "closed";
    update.$set.status = "finished";
  }

  Log.trace("updateExecutionsStatus: " + JSON.stringify(query) + "," + JSON.stringify(update));
  return db.collection("executions").updateMany(query, update, ctx.callback((result) => {

    return callback();
  }));
}

function queryByDomainId (callback) {
  var ctx = this;
  var query = ctx.query || {};

  if (ctx.request.body.domainId) {
    var id = parseId(ctx.request.body.domainId);
    if (!id) return callback("Invalid value for field 'domainId'.");

    query.domainId = id;
    ctx.request.body.domainId = id;
  }

  ctx.query = query;
  return callback();
}

function validateDomainQueryIds (callback) {
  var ctx = this;
  var query = ctx.query || {};

  var ids =  [];
  _.forEach(ctx.user.permissions, (perm) => ids.push(perm.domainId));

  if (query._id) {
    if (_.isArray(query._id.$in) && !_.isEmpty(_.differenceWith(query._id.$in, ids, (a, b) => a.equals(b)))) {
      return callback("Permission not granted.");
    } else if (!_.isEmpty(_.differenceWith([ query._id ], ids, (a, b) => a.equals(b)))) {
      return callback("Permission not granted.");
    }
  }

  return callback();
}

function queryByUserDomains (callback) {
  var ctx = this;
  var query = ctx.query || {};

  query.domainId = { $in: [] };
  _.forEach(ctx.user.permissions, (perm) => query.domainId.$in.push(perm.domainId));

  ctx.query = query;
  return callback();
}

function queryById (callback) {
  var ctx = this;
  var query = ctx.query || {};

  if (ctx.request.body.id) {
    var id = parseId(ctx.request.body.id);
    if (!id) return callback("Invalid value for field 'id'.");

    query._id = id;
    ctx.request.body.id = id;
  } else {

    var end = parseId(ctx.request.body.idEnd);
    if (end) {
      query._id = { $gte: end };
    }

    var start = parseId(ctx.request.body.idStart);
    if (start) {
      var criteria = { $lte: start };
      if (query._id) {
        query.$and = query.$and || [];
        query.$and.push(query._id);
        delete query._id;
        query.$and.push(criteria);
      } else {
        query._id = criteria;
      }
    }
  }

  ctx.query = query;
  return callback();
}

function queryByIds (callback) {
  var ctx = this;
  var query = ctx.query || {};

  if (ctx.request.body.ids) {
    var ids = parseIds(ctx.request.body.ids);
    if (!ids) return callback("Invalid value for field 'ids'.");

    query._id = { $in: ids };
    ctx.request.body.ids = ids;
  }

  ctx.query = query;
  return callback();
}

function queryByHostId (callback) {
  var ctx = this;
  var query = ctx.query || {};

  if (ctx.request.body.hostId) {
    var id = parseId(ctx.request.body.hostId);
    if (!id) return callback("Invalid value for field 'hostId'.");

    query.hostId = id;
    ctx.request.body.hostId = id;
  }

  ctx.query = query;
  return callback();
}

function queryByExecutionId (callback) {
  var ctx = this;
  var query = ctx.query || {};

  if (ctx.request.body.executionId) {
    var id = parseId(ctx.request.body.executionId);
    if (!id) return callback("Invalid value for field 'executionId'.");

    query.executionId = id;
    ctx.request.body.executionId = id;
  }

  ctx.query = query;
  return callback();
}


function queryByStatus (callback) {
  var ctx = this;
  var query = ctx.query || {};

  if (!_.isEmpty(ctx.request.body.status)) {
    query.status = ctx.request.body.status;
  }

  ctx.query = query;
  return callback();
}

function queryByType (callback) {
  var ctx = this;
  var query = ctx.query || {};

  if (!_.isEmpty(ctx.request.body.type)) {
    query.type = ctx.request.body.type;
  }

  ctx.query = query;
  return callback();
}

function queryByStart (callback) {
  var ctx = this;
  var query = ctx.query || {};

  if (!isNaN(Date.parse(ctx.request.body.start))) {
    query.$or = [
      { instant: { $gte: new Date(ctx.request.body.start) } },
      { modified: { $gte: new Date(ctx.request.body.start) } },
    ];
  }

  ctx.query = query;
  return callback();
}

function queryByModified (callback) {
  var ctx = this;
  var query = ctx.query || {};

  var start = ctx.request.body.modified || ctx.request.body.modifiedStart;
  if (!_.isEmpty(start) && !isNaN(Date.parse(start))) {
    query.modified = { $gte: new Date(start) };
  }

  var end = ctx.request.body.modifiedEnd;
  if (!_.isEmpty(end) && !isNaN(Date.parse(end))) {
    var criteria = { $lte: new Date(end) };

    if (query.modified) {
      query.$and = query.$and || [];
      query.$and.push(query.modified);
      delete query.modified;
      query.$and.push({ modified: criteria });
    } else {
      query.modified = criteria;
    }
  }

  ctx.query = query;
  return callback();
}

function queryByUserId (callback) {
  var ctx = this;

  if (_.isEmpty(ctx.request.body.userId)) return callback();

  ctx.query = ctx.query || {};

  var id = parseId(ctx.request.body.userId);
  if (!id) return callback("Invalid value for field 'userId'.");

  ctx.query.userId = id;
  ctx.request.body.userId = id;

  return callback();
}

function queryByRunId (callback) {
  var ctx = this;

  if (_.isEmpty(ctx.request.body.runId)) return callback();

  ctx.query = ctx.query || {};

  var id = parseId(ctx.request.body.runId);
  if (!id) return callback("Invalid value for field 'runId'.");

  ctx.query.runId = id;
  ctx.request.body.runId = id;

  return callback();
}

function queryByRunIds (callback) {
  var ctx = this;

  if (_.isEmpty(ctx.request.body.runIds)) return callback();

  ctx.query = ctx.query || {};

  var ids = parseIds(ctx.request.body.runIds);
  if (!ids) return callback("Invalid value for field 'runIds'.");

  ctx.query.runId = { $in: ids };
  ctx.request.body.runIds = ids;

  return callback();
}

function queryByScenarioId (callback) {
  var ctx = this;

  if (_.isEmpty(ctx.request.body.scenarioId)) return callback();

  ctx.query = ctx.query || {};

  var id = parseId(ctx.request.body.scenarioId);
  if (!id) return callback("Invalid value for field 'scenarioId'.");

  ctx.query["scenario.id"] = id;
  ctx.request.body.scenarioId = id;

  return callback();
}

function queryDocument (callback) {
  var ctx = this;
  var resource = ctx.resource;
  var projection = {};

  if (_.isEmpty(ctx.query)) return callback("Query has no criteria.");
  Log.trace("queryDocument: " + JSON.stringify(ctx.query));

  if (!_.isEmpty(ctx.request.body.limit) && _.isNaN(ctx.request.body.limit)) return callback("Invalid value for field 'limit'.");

  if (ctx.request.body.shallow) {
    projection._id = 1;
    projection.modified = 1;
    _.forEach(resource.primary, (field) => projection[field] = 1);
  }
  var cursor = db.collection(resource.name).find(ctx.query, projection);
  if (ctx.request.body.sort) cursor.sort(ctx.request.body.sort);
  cursor.limit(ctx.request.body.limit || Config.frontend.def_limit);

  return cursor.toArray(ctx.callback((results) => {

    ctx[resource.name] = results;

    return callback({
      status: Ws.Status.SUCCESS,
      message: "Success",
      results: results || []
    });
  }));
}

/* Old Stuff */

function wsCall () {

  var chain = arguments;

  return function (request, response) {

    Log.trace(request.ip + " " +
              request.method + " " +
              request.originalUrl + " " +
              JSON.stringify(request.body));

    var ctx = {
      request: request,
      response: response,
      chain: chain,
      chainIdx: -1,
      start: new Date(),
      chainTime: [],
      responded: false,

      continue: function () {

        while (ctx.chainIdx < chain.length) {
          ctx.chainIdx++;

          if (!ctx.responded) {
            var el = chain[ctx.chainIdx];

            if (typeof el == "function") {
              var result = el.call(ctx);

              var time = new Date();
              var prevTime = ctx.chainIdx > 0 ? ctx.chainTime[ctx.chainIdx - 1] : ctx.start;
              Log.trace("Call " + el.name + " " + (time - prevTime) + " ms.");

              ctx.chainTime.push(time);
              return result;
            }
          }

          ctx.chainTime.push(new Date());
        }
      },

      send: function (data) {
        return ctx.response.send(JSON.stringify(data));
      },

      status: function (status, message) {
        ctx.responded = true;

        Log.debug(request.ip + " " +
                  request.method + " " +
                  request.originalUrl + " " +
                  JSON.stringify(request.body) + " " +
                  status + ": " + message);

        ctx.response.send(JSON.stringify({
          status: status,
          message: message
        }));

        return status != Ws.Status.SUCCESS ? -1 : 0;
      },

      handleError: function (callback) {
        return function (error) {
          if (error) return ctx.status(Ws.Status.ERROR, error);
          callback.apply(ctx, Array.prototype.slice.call(arguments, 1));
        }
      },

      toJSON: function () {
        return "MyCallCtx";
      }
    };

    return ctx.continue();
  }
}

function wsSignIn () {

  getUserByUsername(this.request.body.username, this.handleError((user) => {
    if (!user) return this.status(Ws.Status.NOT_FOUND, "Username not found.");

    this.user = user;

    signIn(user, this.request.body.password, this.handleError((session) => {
      if (!session) return this.status(Ws.Status.INVALID_LOGIN, "Invalid password");

      this.session = session;

      wsInfo.call(this);
    }));
  }));
}

function wsSignOut () {

  signOutSessionById(this.request.params.session, "User sign out.", this.handleError((count) => {
    return this.status(Ws.Status.SUCCESS, "Success");
  }));
}

function wsSession () {

  validateSessionById(this.request.params.session, this.handleError((session) => {
    if (!session) return this.status(Ws.Status.INVALID_LOGIN, "Session not found.");

    this.session = session;

    getUserById(session.userId, this.handleError((user) => {
      if (!user) return this.status(Ws.Status.INVALID_LOGIN, "User no longer exists.");

      this.user = user;

      this.continue();
    }));
  }));
}

function wsInfo () {

  getSessionInfo(this.session, this.user, this.handleError((info) => {

    this.send(_.assignIn({
      status: Ws.Status.SUCCESS,
      message: "Success"
    }, info));

  }));
}

function doPull () {

  var pullIdx = 0;
  var pulleds = [];

  return function next () {
    while (pullIdx < Resources.pulls.length) {
      var pull = Resources.pulls[pullIdx++]

      return db.collection(pull.collection)
                  .find(pull.query)
                  .toArray((error, results) => {

        if (!_.isEmpty(results)) {
          _.forEach(pull.ctxs, (ctx) => {

            ctx.send({
              status: Ws.Status.SUCCESS,
              message: "Finish",
              results: results
            });
          });
        }

        next();
      });
    }

    Resources.pulls = _.without(Resources.pulls, pulleds);
  }();
}

function wsPull () {

  var ctx = this;
  var pulls = this.request.body.pulls || [this.request.body.pulls];

   _.forEach(pulls, (pull) => {

     var resource = Resources[pull.collection];

     if (!resource) {
       return ctx.status(Ws.Status.ERROR, "Invalid collection.");
     }

     var query = {};

     if (pull.id) {

       var id = parseId(pull.id);
       if (!id) {
         return ctx.status(Ws.Status.ERROR, "Invalid 'id'.");
       }

       query._id = id;

     } else if (pull.ids) {

       query._id = { $in: [] };

       _.forEach(pull.ids, (str, idx) => {

         var id = parseId(str);
         if (!id) {
           return ctx.status(Ws.Status.ERROR, "Invalid 'ids[" + idx + "]'.");
         }

         query._id.$in.push(id);
       });

       if (ctx.responded) return;
     }

     if (pull.domainId) {

       var id = parseId(pull.domainId);
       if (!id) {
         return ctx.status(Ws.Status.ERROR, "Invalid 'domainId'.");
       }

       _.forEach(this.user.permissions, (perm) => {
         if (perm.domainId == pull.domainId) query.domainId = id;
       });
     }

     if (!query.domainId) {
       return this.status(Ws.Status.ERROR, "Operation not allowed for specified domain.");
     }

     if (resource.onquery) {
       var passes = _.keys(resource.onquery), passIdx = 0;

       return function next () {
         while (passIdx < passes.length) {
           var path = passes[passIdx++];

           if (ctx.request.body[path] || _.has(ctx.request.body, path)) {
             var value = ctx.request.body[path] || _.get(ctx.request.body, path);
             return resource.onquery[path].call(ctx, next, value);
           }
         }
         finish();
       }();
     }

     var target = null;

     _.forEach(Resource.pulls, (source) => {
       if (pull.collection == source.collection  && _.isEqual(pull.query, query)) {
         target = source;
       }
     });

     if (!target) target = {
       collection: pull.collection,
       query: query,
       ctxs: []
     };

     target.ctxs.push(this);
   });
}

function wsExecuteTest () {

  var ctx = this;
  var test = this.document;
  var timestamp = new Date();

  var execution = {
    domainId: test.domainId,
    userId: this.user._id,
    username: this.username,
    status: "waiting",
    result: null,
    created: timestamp,
    modified: timestamp,
    started: null,
    finished: null,
    test: {
      _id: test._id,
      label: test.label,
      title: test.title,
      description: test.description,
      assets: {},
      goals: test.goals
    }
  };

  setAssets();

  function setAssets (next) {
    var assetIds = [];

    _.forEach(test.assets, (assetId, assetType) => {
      assetIds.push(ObjectID(assetId));
      execution.test.assets[assetType] = null;
    });

    db.collection("assets")
         .find({ _id: { $in: assetIds }, domainId: execution.domainId })
         .toArray(ctx.handleError((results) => {

      _.forEach(results, (asset) => {
        var clone = _.pick(asset, ["_id", "description", "properties"]);
        execution.test.assets[asset.type] = clone;
      });

      insert();
    }));
  }

  function insert () {

    console.log("insert: " + JSON.stringify(execution));

    db.collection("executions")
         .insertOne(execution, ctx.handleError((result) => {

      execution._id = ObjectID(result.insertedId);

      return ctx.send({
        status: Ws.Status.SUCCESS,
        message: "Success",
        executionId: result.insertedId
      });
    }));
  }
}

/*
 * Validators
 */

function existsInCollection (collection) {

  return function (value, path, doc, errors, callback) {

    if (ObjectID.isValid(value)) {

      return db.collection(collection)
                  .count({ domainId: doc.domainId, _id: ObjectID(value)}, (error, count) => {

        if (error) errors.push(error);
        if (!count) errors.push("Document '" + value + "' not found.");

        callback();
      });
    }

    callback();
  }
}

/*
 * API functions
 */

function signIn (user, password, callback) {

  var challenge = Crypto.createHash("md5");
  challenge.update(user.created.toISOString());
  challenge.update(password);
  var hash = challenge.digest("hex");

  Log.debug("Hash: " + hash);

  if (!_.isEqual(hash, user.password)) {
    return callback("Password mismatch.", null);
 }

  signOut(user, "New sign in.", function (error, count) {

    var session = {
      userId: user._id,
      status: "active",
      created: new Date(),
      log: [
        {
          instant: new Date(),
          message: "Sign in."
        }
      ]
    };

    db.collection("sessions")
      .insertOne(session, function (error, result) {

      if (error) {
        Log.error("Could not insert session. " + error);
        return callback(errpr);
      }

      session._id = ObjectID(result.insertedId);
      callback(null, session);
    });
  });
}

function signOut (user, reason, callback) {

  db.collection("sessions")
    .find({ userId: user._id, status: "active" })
    .toArray(function (error, results) {

    var count = 0;

    (function signOutNext (error) {
      var session = results[count];

      if (error) {
        Log.error("Couldn't update sessionId: '" + session._id + "'. " + error);
        return callback(error, count);
      }
      if (count >= results.length) {
        return callback(null, count);
      }
      signOutSessionById(session._id, reason, signOutNext);
      count++;
    })();
  });
}

function signOutSessionById (id, reason, callback) {

  var now = new Date();

  db.collection("sessions")
    .update({ _id: ObjectID(id), status: "active" }, {
    $set: {
      status: "closed",
      closed: now
    },
    $push: {
      log: {
        instant: now,
        message: "Sign out. " + reason
      }
    }
  }, callback);
}

function getActiveSessionById (id, callback) {
  return db.collection("sessions").find({ _id: ObjectID(id), status: "active" }).toArray((error, results) => {
    if (error) return callback(error);
    if (results.length <= 0) return callback();

    return callback(null, results[0]);
  });
}

function validateSessionById (id, callback) {

  getActiveSessionById(id, (error, session) => {

    // TODO: Validate session.

    callback(error, session);
  });
}

function getSessionInfo (session, user, callback) {

  if (arguments.length == 2) {
    user = undefined;
    callback = arguments[1];
  }

  var info = {
    sessionId: session._id,
    userId: session.userId
  };

  if (!user) return getUserById(session.userId, (error, user) => {
    if (error) callback(error);
    getSessionInfo.call(this, session, user, callback);
  });

  getUserPermissions(user, (error, permissions) => {
    if (error) return callback(error);
    info.permissions = permissions;
    return callback(null, info);
  });
}

function getUserByUsername (username, callback) {

  db.collection("users")
    .find({ username: username })
    .toArray(function (error, results) {

    if (error) return callback(error);
    if (results.length <= 0) return callback();

    return callback(null, results[0]);
  });
}

function getUserById (id, callback) {

  db.collection("users")
    .find({ _id: ObjectID(id) })
    .toArray(function (error, results) {

    if (error) return callback(error);
    if (results.length <= 0) return callback();

    return callback(null, results[0]);
  });
}

function getUserPermissions (user, callback) {

  db.collection("domains")
       .find({ _id: { $in: _.map(user.permissions, "domainId") }})
       .toArray(function (error, results) {

    if (error) {
      return callback(error);
    }

    var permissions = [];
    _.forEach(results, function (domain) {
      _.forEach(user.permissions, function (permission) {
        if (domain._id.equals(permission.domainId)) {
          permission.domainName = domain.name;
          permissions.push(permission);
          return false;
        }
      });
    });

    return callback(null, permissions);
  });
}
