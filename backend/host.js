
const Config = require("../lib/config").init();
const Log = require("../lib/log").init(Config.log);
const Core = require("../lib/core");

const  _ = require("lodash");
const MongoClient = require("mongodb").MongoClient;
const ObjectID = require("mongodb").ObjectID;

const Adapters = {
  "tcp": () => require("./tcp"),
  "tls": () => require("./tcp"),
  "http": () => require("./http"),
  "https": () => require("./http")
};

const Codecs = {
  "iso": () => require("../lib/iso"),
  "xml": () => require("../lib/xml"),
  "json": () => require("../lib/json")
};

var db = null;
var host = null;
var adapter = null;
var codec = null;
var polling = null;

const InboundProcessSteps = [
  queryHostAssets,
  createInboundTxn,
  decodeTxn,
  insertTxn,
  queryInboundExecution,
  queryExecutionTxns,
  validateGoal,
  matchInboundRules,
  evaluateTxnResponse,
  updateExecution,
  setExecutionResult,
  refreshRun,
  chainTxn,
  respondTxn,
  updateTxn,
  "end"
];

var outboundCount = 0;
var outboundLastId = null;
var outboundModifiedSince = null;

const OutboundProcessSteps = [
  queryOutboundExecution,
  startOutboundExecution,
  queryHostAssets,
  "nextGoal",
  queryExecutionTxns,
  createOutboundTxn,
  insertTxn,
  updateExecution,
  requestTxn,
  decodeTxn,
  updateTxn,
  validateGoal,
  updateExecution,
  nextOutboundGoal,
  setExecutionResult,
  refreshRun,
  "end"
];

init();

function init () {

  MongoClient.connect(Config.db.url, (error, dbconn) => {

    if (error) {
      Log.error("Could not connect to: " + Config.db.url);
      process.exit(1);
    }

    db = dbconn;
    Log.info("Connected to: " + Config.db.url);

    process.on("message", receive);

    process.send({
      event: "ready"
    });
  });
}

function receive (message) {

  Log.debug("message: " + JSON.stringify(message));

  if (message.command == "attach") {

    if (_.isUndefined(message.hostId)) {
      Log.error("Missing 'hostId' parameter");
    }

    attach(message.hostId);
  }

  if (message.command == "reload") {
    reload();
  }

  if (message.command == "detach") {
    detach();
  }
}

function attach (hostId) {

  Log.trace("Attaching host id " + hostId);
  load(hostId);

  process.send({
    event: "attached"
  });
}

function detach () {

  Log.trace("Detaching host " + host._id);

  if (polling) clearInterval(polling);

  adapter.close();
  db.close();

  process.send({
    event: "exit",
    hostId: host._id
  });

  process.disconnect();
  process.exit(0);
}

function load (hostId) {

  db.collection("hosts").findOne({ _id: ObjectID(hostId) }, (error, result) => {
    if (error || !result) {
      Log.error("Cannot find hostId: " + hostId + ". " + error);
      process.exit(1);
    }

    host = result;

    if (Adapters[host.hostType]) {
      adapter = Adapters[host.hostType]();
    } else {
      Log.error("Invalid hostType: ''" + host.hostType + "'.");
      process.exit(1);
    }

    if (Codecs[host.messageType]) {
      codec = Codecs[host.messageType]();
    } else {
      Log.error("Invalid messageType: '" + host.messageType + "'.");
      process.exit(1);
    }

    try {
      adapter.init(host, processInbound);
    } catch (err) {
      Log.error("Init: " + err);
    }

    polling = setInterval(processOutbound, Config.backend.pollingInterval);
  });
}

function reload () {

  Log.trace("Reloading host id " + host._id);

  adapter.close();
  load(host._id);

  process.send({
    event: "ready",
    hostId: host._id
  });
}

function processOutbound () {

  if (outboundCount < (host.outboundLimit || Config.backend.outboundLimit)) {
    outboundCount++;
    var ctx = {
      log: []
    };
    execute(ctx, OutboundProcessSteps, () => {
      outboundCount--;
    });
  }
}

function processInbound (request, callback) {
  var ctx = {
    log: [],
    request: request,
    respond: callback
  };
  var error = _.isString(callback) && callback;
  if (error) Core.log_error(ctx, error);
  execute(ctx, InboundProcessSteps);
}

function execute (ctx, steps, callback) {

  ctx = ctx || {};

  var start = Date.now();
  var stepStart = null;
  var stepIdx = -1;
  var step = null;

  return function next (nextStep) {
    if (stepIdx >= 0 && _.isFunction(steps[stepIdx])) {
      Log.trace("Call " + steps[stepIdx].name  + ": " + (Date.now() - stepStart) + " ms.");
    }
    if (nextStep) {
      Log.trace("GoTo " + (_.isFunction(nextStep) ? nextStep.name : nextStep));
      var idx = _.indexOf(steps, nextStep, stepIdx + 1);
      if (idx < 0) idx = _.indexOf(steps.slice(0, stepIdx), nextStep);
      if (idx >= 0) stepIdx = idx;
      else throw new Error("Could not find step " + (_.isFunction(nextStep) ? nextStep.name : nextStep));
    }
    while (step = steps[++stepIdx]) {
      if (_.isFunction(step)) {
        Log.trace("Call " + step.name);
        stepStart = Date.now();
        return step(ctx, next);
      }
      Log.trace("Label " + step);
    }
    if (callback) {
      return callback();
    }
  }();
}

function queryInboundExecution (ctx, next) {

  Log.trace("Query inbound executions for domain " + host.domainId);

  var cursor = db.collection("executions")
                 .find({ domainId: host.domainId, status: "active" })
                 .batchSize(Config.backend.batchSize);

  cursor.next(matchExecution);

  function matchExecution (error, execution) {
    if (error) return Log.error("Could not fetch execution. " + error);
    if (!execution) return next();

    var properties = {};
    _.assignIn(properties, ctx.properties);
    _.forEach(execution.test.assets, (asset, type) => {
      if (asset) _.forEach(asset.properties, (value, key) => properties[type + "." + key] = value);
    });

    for (var idx = 0; idx < execution.test.goals.length; idx++) {
      let goal = execution.test.goals[idx];

      let matchCtx = {
        handlers: Core.handlers,
        properties: properties,
        txn: ctx.txn,
        fields: ctx.txn.request.fields,
        execution: execution,
        test: execution.test,
        goals: execution.test.goals,
        goalIdx: idx,
        goal: goal
      };

      if (goal.type == "txn_inbound" &&
         !goal.txnId &&
          Core.match.call(matchCtx, goal.request.matches)) {

        Log.debug("Match execution " + execution._id + " goal " + idx);

        if (ctx.txn.status != "error") ctx.txn.status = "match";
        ctx.properties = properties;
        ctx.execution = execution;
        ctx.test = execution.test;
        ctx.goals = execution.test.goals;
        ctx.goalIdx = idx;
        ctx.goal = goal;

        goal.txnId = ctx.txn._id;
        ctx.txn.executionId = execution._id;
        ctx.txn.chainMode = goal.response.chainMode;
        ctx.txn.response.delay = goal.response.delay || 0;

        return next();
      }
    }

    cursor.next(matchExecution);
  }
}

function queryOutboundExecution (ctx, next) {

  Log.trace("Query outbound executions for domain " + host.domainId);

  var query = {
    domainId: host.domainId,
    status: "waiting"
  };
  var filters = [];
  if (outboundLastId) {
    filters.push({ _id: { $gt: outboundLastId }});
  }
  if (outboundModifiedSince) {
    filters.push({ modified: { $gt: outboundModifiedSince }});
  }
  if (!_.isEmpty(filters)) query.$or = filters;

  var cursor = db.collection("executions")
                 .find(query)
                 .batchSize(Config.backend.batchSize)
                 .sort({ _id: 1 });

  cursor.next(processExec);

  function processExec (error, execution) {
    if (error) return Log.error("Could not fetch execution. " + error);
    if (!execution) return next("end");

    Log.trace("Process execution " + execution._id);

    if (outboundLastId == null ||
        execution._id.getTimestamp() >= outboundLastId.getTimestamp()) {
      outboundLastId = execution._id;
    }

    if (outboundModifiedSince == null ||
        execution.modified > outboundModifiedSince) {
      outboundModifiedSince = execution.modified;
    }

    for (var idx = 0; idx < execution.test.goals.length; idx++) {
      var goal = execution.test.goals[idx];

      if (goal.type == "txn_outbound" &&
          goal.request.target == host.logicId &&
         !goal.txnId) {

        Log.debug("Process execution " + execution._id);

        ctx.execution = execution;
        ctx.test = execution.test;
        ctx.goals = execution.test.goals;
        ctx.goalIdx = idx;
        ctx.goal = goal;

        return next();
      }
    }

    cursor.next(processExec);
  }
}

function startOutboundExecution (ctx, next) {

  var values = {
    status: "active",
    result: null,
    started: new Date(),
    finished: null,
    modified: new Date()
  }

  db.collection("executions").updateOne({ _id: ctx.execution._id }, { $set: values }, (error) => {
    if (error) return Log.error("Could not update execution. " + error);

    _.assignIn(ctx.execution, values);
    next();
  });
}

function queryHostAssets (ctx, next) {

  var query = { _id: { $in: [] } };
  _.forEach(host.assets, (id) => query._id.$in.push(ObjectID(id)));

  db.collection("assets").find(query).toArray((error, results) => {
    if (error) return Log.error("Could not query request assets. " + error);

    ctx.assets = results;
    setCtxDefinitions(ctx, results);

    next();
  });
}

function setCtxDefinitions (ctx, assets) {

  ctx.properties = ctx.properties || {};
  ctx.defs = ctx.defs || [];

  _.forEach(assets, (asset, type) => {
    if (asset) {
      _.forEach(asset.properties, (value, key) => ctx.properties[(asset.type || type) + "." + key] = value);
      _.forEach(asset.fields, (field) => {
        var def = _.find(ctx.defs, { field: field.field });
        if (def) _.assignIn(def, field);
        else ctx.defs.push(field);
      });
    }
  });

  if (!_.isEmpty(ctx.defs)) _.orderBy(ctx.defs, "field");
}

function queryExecutionTxns (ctx, next) {

  var ids = [];

  if (ctx.execution) _.forEach(ctx.execution.test.goals, (goal) => {
    if (goal.txnId) ids.push(goal.txnId);
  });

  if (_.isEmpty(ids)) return next();

  var query = { _id: { $in: ids } };
  db.collection("txns").find(query).toArray((error, results) => {
    if (error) return Log.error("Could not query execution txns. " + error);

    ctx.txns = results;
    next();
  });
}

function createInboundTxn (ctx, next) {

  var now = new Date();
  ctx.instant = now;

  ctx.txn = {
    hostId: host._id,
    domainId: host.domainId,
    type: "inbound",
    status: "received",
    hostType: host.hostType,
    messageType: host.messageType,
    encoding: host.encoding,
    remoteAddress: ctx.request.remoteAddress,
    remotePort: ctx.request.remotePort,
    localAddress: ctx.request.localAddress,
    localPort: ctx.request.localPort,
    instant: now,
    request: {
      instant: now,
      data: ctx.request.data,
      fields: ctx.request.fields,
    },
    response: {
      instant: null,
      data: null,
      delay: 0
    },
    log: ctx.log || [],
    modified: now
  };

  next();
}

function createOutboundTxn (ctx, next) {

  var now = new Date();
  ctx.instant = now;

  ctx.txn = {
    hostId: host._id,
    domainId: host.domainId,
    executionId: ctx.execution._id,
    type: "outbound",
    status: "created",
    hostType: host.hostType,
    messageType: host.messageType,
    encoding: host.encoding,
    remoteAddress: host.address,
    remotePort: host.port,
    localAddress: null,
    localPort: null,
    instant: now,
    request: {
      instant: now,
      data: null,
      delay: (ctx.goal && ctx.goal.request.delay) || 0,
      timeout: (ctx.goal && ctx.goal.request.timeout) || 0
    },
    response: {
      instant: null,
      data: null,
      fields: null
    },
    log: ctx.log || [],
    modified: now
  };

  setCtxDefinitions(ctx, ctx.test.assets);

  try {
    ctx.txn.request.data = Core.parse.call(_.assignIn({
      fields: [],
      handlers: Core.handlers
    }, ctx), ctx.goal.request.data);
  } catch (error) {
    Core.log_error(ctx, "Evaluate request: " + error);
    ctx.txn.status = "error";
  }

  try {
    ctx.txn.request.fields = _.concat(ctx.txn.request.fields || [], codec.decode(ctx.txn.request.data, host.encoding, ctx.defs));
  } catch (error) {
    Core.log_error(ctx, "Decode request: " + error);
    ctx.txn.status = "error";
  }

  next();
}

function requestTxn (ctx, next) {

  if (ctx.txn.request.delay > 5000) {
    ctx.txn.status = "delay";
    updateTxn(ctx);
  }

  setTimeout(request, ctx.txn.request.delay || 0);

  function request () {

    try {
      adapter.request(ctx.txn.request, null, (error, response) => {
        if (error) {
          Core.log_error(ctx, error);
          ctx.txn.status = "error";
        } else {
          ctx.txn.status = "finished";
        }

        ctx.txn.localAddress = response.localAddress;
        ctx.txn.localPort = response.localPort;
        ctx.txn.remoteAddress = response.remoteAddress;
        ctx.txn.remotePort = response.remotePort;

        ctx.txn.response.instant = new Date();
        ctx.txn.response.data = response.data;
        ctx.txn.response.fields = ctx.txn.response.fields || [];

        next();
      });
    } catch (error) {
      Core.log_error(ctx, error);
      ctx.txn.status = "error";
    }

    if (ctx.txn.status != "request") {
      if (ctx.txn.status != "error") ctx.txn.status = "request";
      updateTxn(ctx);
    }
  }
}

function decodeTxn (ctx, next) {

  try {
    if (ctx.txn.type == "inbound") {
      if (!_.isEmpty(ctx.txn.request.data)) {
        ctx.txn.request.data = ctx.txn.request.data || "";
        ctx.txn.request.fields = _.concat(ctx.txn.request.fields || [], codec.decode(ctx.txn.request.data, host.encoding, ctx.defs));
      }
    } else if (ctx.txn.type == "outbound") {
      if (!_.isEmpty(ctx.txn.response.data)) {
        ctx.txn.response.data = ctx.txn.response.data || "";
        ctx.txn.response.fields = _.concat(ctx.txn.response.fields || [], codec.decode(ctx.txn.response.data, host.encoding, ctx.defs));
      }
    }
  } catch (error) {
    Core.log_error(ctx, "Decode: " + error);
    ctx.txn.status = "error";
  }

  next();
}

function validateGoal (ctx, next) {

  if (ctx.goal) try {
    if (ctx.goal.type == "txn_inbound") {
      Core.validate.call(_.assignIn({
        handlers: Core.handlers,
        fields: ctx.txn.request.fields,
      }, ctx), ctx.goal.request.validations);
    } else if (ctx.goal.type == "txn_outbound") {
      Core.validate.call(_.assignIn({
        handlers: Core.handlers,
        fields: ctx.txn.response.fields,
      }, ctx), ctx.goal.response.validations);
    }
  } catch (error) {
    Core.log_error(ctx, "Validate: " + error);
    ctx.txn.status = "error";
  }

  next();
}

function nextOutboundGoal (ctx, next) {

  if (ctx.txn.status == "error") return next();

  for (var idx = ctx.goalIdx; idx < ctx.test.goals.length; idx++) {
    var goal = ctx.test.goals[idx];

    if (goal.type == "txn_outbound" &&
        goal.request.target == host.logicId &&
       !goal.txnId) {

      Log.trace("Next goal: " + idx);

      ctx.goalIdx = idx;
      ctx.goal = goal;
      return next("nextGoal");
    }
  }

  next();
}

function setExecutionResult (ctx, next) {
  if (!ctx.execution) return next();

  var done = true;
  var errors = ctx.txn.status == "error";
  var review = false;

  for (var idx = 0; idx < ctx.test.goals.length; idx++) {
    var goal = ctx.test.goals[idx];

    if (goal.type == "txn_outbound") {
      if (_.isNil(goal.txnId)) done = false;
      errors = errors || (done && !_.isNil(_.find(goal.response.validations, { result: "fail" })));
    }

    if (goal.type == "txn_inbound") {
      if (_.isNil(goal.txnId)) done = false;
      errors = errors || (done && !_.isNil(_.find(goal.request.validations, { result: "fail" })));
    }

    if (goal.type == "user_input") {
      review = true;
    }

    if (!done) return next();
  }

  var values = {
    status: "active",
    result: null,
    started: ctx.execution.started,
    finished: null,
    modified: new Date()
  }

  if (review) {
    values.status = "review";
  } else {
    values.status = "finished";
    values.finished = new Date();
    if (errors) values.result = "fail";
    else values.result = "pass";
  }

  db.collection("executions").updateOne({ _id: ctx.execution._id }, { $set: values }, (error) => {
    if (error) return Log.error("Could not update execution. " + error);

    _.assignIn(ctx.execution, values);
    next();
  });
}

function refreshRun (ctx, next) {
  if (!ctx.execution || !ctx.execution.runId) return next();

  var fields = { status: true, result: true, scenario: true };

  var cursor = db.collection("executions")
                 .find({ runId: ctx.execution.runId }, fields)
                 .batchSize(Config.backend.batchSize);

  var stats = {
    total: 0,
    pass: 0,
    skipped: 0,
    impact: 0,
    fail: 0,
    scenarios: 0,
    modified: new Date()
  }

  var scenarios = [];

  cursor.next(countExecution);

  function countExecution (error, execution) {
    if (error) return Log.error("Could not fetch execution.  '" + error + "'.");
    if (!execution) return setRunStats();

    stats.total++;
    if (execution.result == "pass") stats.pass++;
    if (execution.result == "skipped") stats.skipped++;
    if (execution.result == "impact") stats.impact++;
    if (execution.result == "fail") stats.fail++;
    if (execution.scenario && _.indexOf(scenarios, execution.scenario.id) < 0) {
      scenarios.push(execution.scenario.id);
      stats.scenarios++;
    }

    cursor.next(countExecution);
  }

  function setRunStats () {
    db.collection("runs").updateOne({ _id: ctx.execution.runId }, { $set: stats }, (error) => {
      if (error) return Log.error("Could not update run. " + error);

      next();
    });
  }
}

function insertTxn (ctx, next) {

  db.collection("txns").insertOne(ctx.txn, (error, result) => {
    if (error) return Log.error("Could not insert txn.  '" + error + "'.");

    ctx.txn._id = result.insertedId;
    if (ctx.goal) ctx.goal.txnId = result.insertedId;
    next();
  });
}

function updateTxn (ctx, next) {
  if (!ctx.txn) return next && next();

  ctx.txn.modified = new Date();

  db.collection("txns").replaceOne({ _id: ctx.txn._id }, ctx.txn, (error) => {
    if (error) return Log.error("Could not update txn. " + error);

    if (next) next();
  });
}

function updateExecution (ctx, next) {
  if (!ctx.execution) return next();

  if (!_.isNil(ctx.goalIdx)) merge();
  else update();

  function merge () {
    db.collection("executions").findOne({ _id: ctx.execution._id }, (error, result) => {
      if (error) return Log.error("Could not fetch execution. " + error);

      result.test.goals[ctx.goalIdx] = ctx.execution.test.goals[ctx.goalIdx];

      ctx.execution = result;
      ctx.test = result.test;
      ctx.goals = result.test.goals;
      ctx.goal = result.test.goals[ctx.goalIdx];

      update();
    });
  }

  function update () {
    ctx.execution.modified = new Date();

    db.collection("executions").replaceOne({ _id: ctx.execution._id }, ctx.execution, (error) => {
      if (error) return Log.error("Could not update execution. " + error);

      next();
    });
  }
}

function matchInboundRules (ctx, next) {

  if (ctx.txn.status == "error") return next();

  if (!ctx.execution && host.rules) {
    Log.trace("Match inbound rules for txn " + ctx.txn._id);

    for (var idx = 0; idx < host.rules.length; idx++) {
      var rule = host.rules[idx];

      let matchCtx = {
        handlers: Core.handlers,
        properties: ctx.properties,
        txn: ctx.txn,
        fields: ctx.txn.request.fields,
        ruleIdx: idx,
        rule: rule
      };

      if (Core.match.call(matchCtx, rule.matches)) {

        Log.debug("Match rule " + idx + " for txn " + ctx.txn._id);

        ctx.rule = rule;
        ctx.txn.status = "match";
        ctx.txn.chainMode = rule.response.chainMode;
        ctx.txn.response.delay = rule.response.delay || 0;
        break;
      }
    }
  }

  next();
}


const CHAIN_MAX_SAMPLE = 1500;
const CHAIN_MAX_THROTTLE = 5;
var chainStats = null;

function chainTxn (ctx, next) {
  var mode = ctx.txn.chainMode || "allow";
  var chain = false;

  // HACK: Chain specific terminal to dev.

  if (host.port == 50526) {
    let fieldReportPOIId = _.find(ctx.txn.request.fields, { field: "/Document/StsRpt/StsRpt/POIId/Id" });
    let fieldAuthMerchId = _.find(ctx.txn.request.fields, { field: "/Document/AccptrAuthstnReq/AuthstnReq/Envt/Mrchnt/Id/Id" });
    let fieldCancMerchId = _.find(ctx.txn.request.fields, { field: "/Document/AccptrCxlReq/CxlReq/Envt/Mrchnt/Id/Id" });

    let sak = "3A9D8BAD0510C5414B126408B4C7CD14";

    if (_.isEmpty(ctx.txn.response.data) && (
        (fieldReportPOIId && fieldReportPOIId.value == sak) ||
        (fieldAuthMerchId && fieldAuthMerchId.value == sak) ||
        (fieldCancMerchId && fieldCancMerchId.value == sak))) chain = {
      "type": "https",
      "address" : "127.0.0.1",
      "port" : 50984,
      "keepAlive" : true
    };
 }

/*
  var field041 = _.find(ctx.txn.request.fields, { field: "041" });
  var field042 = _.find(ctx.txn.request.fields, { field: "042" });

  var mid = "017005508166001";
  var tid = "BW000235";

  if (_.isEmpty(ctx.txn.response.data) && (
      (field041 && (field041.value == tid || field041.value == "99999999")) &&
      (field042 && field042.value == mid))) chain = {
    "type": "tcp",
    "address" : "104.236.82.178",
    "port" : 50355,
    "msgOffset" : 0,
    "mliSize" : 2,
    "mliEndianness" : "big",
    "encoding" : "ascii",
    "keepAlive" : true
  };

  var field042 = _.find(ctx.txn.request.fields, { field: "042" });

  var mid = "017005508166001";

  if (_.isEmpty(ctx.txn.response.data) && (
      (field042 && field042.value == mid))) chain = {
    "type": "tcp",
    "address" : "104.236.82.178",
    "port" : 50355,
    "msgOffset" : 0,
    "mliSize" : 2,
    "mliEndianness" : "big",
    "encoding" : "ascii",
    "keepAlive" : true
  };
  */

  if (!chain && host.chain && host.chain.enabled) {
    chain = host.chain.force_forward;
    chain = chain || (mode == "allow" && _.isEmpty(ctx.txn.response.data));
    chain = chain || mode == "force";
    if (chain) chain = host.chain;
  }

  if (chain) {
    /* Disabled
    if (chainStats) {
      let time = new Date().getTime() - chainStats.first.getTime();
      if (time < CHAIN_MAX_SAMPLE) {
        if (chainStats.count >= CHAIN_MAX_THROTTLE) {
          chain = false;
          Core.log_warn(ctx, "Chain prevented, throttle limit reached");
        }
       } else {
        chainStats = null;
      }
    }
    if (!chainStats) {
      chainStats = {
        first: new Date(),
        count: 0
      };
    }
    */
 }

  if (chain) {
    //chainStats.count++;

    Log.debug("Chain txn " + ctx.txn._id);

    ctx.txn.status = "chaining";
    updateTxn(ctx);

    return adapter.request(ctx.txn.request, chain, (error, response) => {
      if (error) {
        Core.log_error(ctx, error);
        ctx.txn.status = "error";
      } else {
        ctx.txn.status = "chained";
      }
      if (mode == "allow" || mode == "force") {

        ctx.txn.localAddress = host.chain.address;
        ctx.txn.localPort = host.chain.port;

        ctx.txn.response.instant = new Date();
        ctx.txn.response.data = response.data;
        ctx.txn.response.fields = _.concat(response.fields || [], codec.decode(response.data, host.encoding, ctx.defs));
        ctx.txn.response.chained = true;
      }
      next();
    });
  }

  next();
}

function evaluateTxnResponse (ctx, next) {

  if (_.isEmpty(ctx.txn.response.data)) {

    var response = null;
    if (ctx.goal) response = ctx.goal.response;
    else if (ctx.rule) response = ctx.rule.response;

    if (response) {

      try {
        ctx.txn.response.data = Core.parse.call(_.assignIn({
          handlers: Core.handlers,
          fields: ctx.txn.request.fields
        }, ctx), response.data || "");
      } catch (error) {
        Core.log_error(ctx, "Evaluate response: " + error);
        ctx.txn.status = "error";
      }

      try {
        ctx.txn.response.fields = _.concat(ctx.txn.response.fields || [], codec.decode(ctx.txn.response.data, host.encoding, ctx.defs));
      } catch (error) {
        Core.log_error(ctx, "Decode response: " + error);
        ctx.txn.status = "error";
      }

      // TODO: Save txn copy into goal
      response.fields = ctx.txn.response.fields;
    }
  }

  next();
}

function respondTxn (ctx, next) {

  if (ctx.txn.response.delay > 5000) {
    ctx.txn.status = "delay";
    updateTxn(ctx);
  }
  return setTimeout(respond, ctx.txn.response.delay || 0);

  function respond () {
    try {
      ctx.respond(ctx.txn.response);
      ctx.txn.status = "responded";
    } catch (error) {
      Core.log_error(ctx, error);
      ctx.txn.status = "error";
    }
    next();
  }

  next();
}
