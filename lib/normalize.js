
const Config = require("../lib/config").init();
const Log = require("../lib/log").init(Config.log);
const Core = require("../lib/core");

const  _ = require("lodash");
const MongoClient = require("mongodb").MongoClient;
const ObjectID = require('mongodb').ObjectID;

const args = process.argv.slice(2);

const dryRun = args.indexOf("update") < 0;
const batchSize = 50;
var db = null;

if (!dryRun) {
  console.log("This will MODIFY the database.");
  console.log("Type 'ok' to continue.");

  process.stdin.setEncoding("ascii");
  process.stdin.once("data", function (typed) {
    if (typed.startsWith("ok")) return init();
    process.exit(0);
  });
} else {
  init();
}

var normalizations = {
  "executions": [
    normalizeExecutionTestId,
    normalizeExecutionScenario
  ]
};

function init () {

  MongoClient.connect(Config.db.url, (error, dbconn) => {

    if (error) {
      Log.error("Could not connect to: '" + Config.db.url + "'.");
      process.exit(1);
    }

    db = dbconn;
    Log.info("Connected to: '" + Config.db.url + "'.");

    normalize();
  });
};

function normalize () {

  var collectionIdx = -1;
  var collections = _.keys(normalizations);

  return function nextCollection () {
    if (++collectionIdx >= collections.length) return finish();

    var collection = collections[collectionIdx];
    Log.info("Normalize " + collection);

    var cursor = db.collection(collection).find().batchSize(batchSize);
    var count = 0;
    cursor.next(normalization);

    function normalization (error, doc) {
      if (error) return Log.error("Error: " + error);
      if (!doc) {
        Log.info("Normalized " + count + " documents on " + collection);
        return nextCollection();
      }

      count++;
      Log.info("Document " + doc._id);

      var passIdx = -1;

      return function nextPass () {
        if (++passIdx >= normalizations[collection].length) {
          if (dryRun) {
            Log.debug(JSON.stringify(doc));
            cursor.next(normalization);
          } else {
            db.collection(collection).replaceOne({ _id: doc._id }, doc, (error) => {
              if (error) return Log.error("Error: " + error);
              cursor.next(normalization);
            });
          }
          return;
        }

        var pass = normalizations[collection][passIdx];
        Log.info("Pass " + pass.name);

        pass(doc, nextPass);
      }();
    }
  }();
}

function finish () {
  Log.info("Db closed.");
  db.close();
  process.exit(0);
}

function normalizeTxnModified (txn, next) {
  var modified = txn.modified || txn.instant || txn.created;
  if (!modified && txn.response && txn.response.instant) modified = txn.response.instant;
  if (!modified && txn.request && txn.request.instant) modified = txn.request.instant;
  if (!txn.modified) txn.modified = modified || new Date();
  return next();
}

function normalizeTxnRequestFields (txn, next) {
  var fields = txn.request ? txn.request.fields : [];
  _.forEach(fields, (field) => {
    field.field = field.field || field.name;
    delete field.name;
  });
  return next();
}

function normalizeTxnLog (txn, next) {
  txn.log = txn.log || txn.errors || [];
  delete txn.errors;
  return next();
}

function normalizeExecutionTxnId (exec, next) {
  var goalIdx = -1;
  return function nextGoal () {
    if (++goalIdx >= exec.test.goals.length) return next();
    var goal = exec.test.goals[goalIdx];
    if (goal.txn) {
      goal.txnId = ObjectID(goal.txnId || goal.txn._id);
      delete goal.txn;
      return updateTxnExecutionId(goal.txnId, exec._id, nextGoal);
    } else return nextGoal();
  }();
}

function normalizeExecutionTestId (exec, next) {
  if (exec.test) {
    exec.test.id = ObjectID(exec.test._id || exec.test.id);
    delete exec.test._id;
  }
  next();
}

function normalizeExecutionScenario (exec, next) {
  if (exec.scenario) {
    exec.scenario.id = ObjectID(exec.scenario.id || exec.scenario._id);
    delete exec.scenario._id;
    db.collection("scenarios").find({ _id: exec.scenario.id }, (error, results) => {
      if (error) Log.error("Cannot find Scenario: " + error);
      var scenario = results[0];
      if (scenario) {
        _.forEach(scenario.tests, (id, idx) => {
          if (ObjectId(id).equals(exec.test.id)) exec.scenario.sequence = idx;
        });
      }
      next();
    });
  } else next();
}

function updateTxnExecutionId (txnId, executionId, next) {
  db.collection("txns").updateOne({ _id: txnId }, { $set: { executionId: executionId }}, (error, result) => {
    if (error) Log.error("Cannot updateTxnExecutionId: " + error);
    next();
  });
}

function normalizeExecutionGenerics (exec, next) {

  if (execution.comment) execution.test.comment = execution.comment;
  delete execution.comment;

  // for each goal

  if (goal.comment == true) {
    goal.allow_comment = true;
    goal.comment = "";
  }

  goal.options_type = goal.options_type || "radio";
  goal.choices = goal.choices || [];

}
