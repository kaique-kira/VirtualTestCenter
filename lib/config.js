
exports.init = function () {

  this.version = "17355";

  this.db = {};
  this.db.url = "mongodb://127.0.0.1:27017/vtc";

  this.log = {};
  this.log.error = true;
  this.log.warn = true;
  this.log.debug = true;
  this.log.info = true;
  this.log.trace = false;
  this.log.query = false;

  this.frontend = {};
  this.frontend.port = 8080;
  this.frontend.portSSL = 8443;
  this.frontend.keyf = "./key.pem";
  this.frontend.certf = "./cert.pem";
  this.frontend.caf = "./ca_bundle.pem";
  this.frontend.def_language = "pt-br";
  this.frontend.wstimeout = 2000;
  this.frontend.update_interval = 3000;
  this.frontend.pull_interval = 5000;
  this.frontend.def_limit = 150;

  this.backend = {};
  this.backend.updateInterval = 1000;
  this.backend.batchSize = 10;
  this.backend.requestTimeout = 30000;
  this.backend.flushTimeout = 300;
  this.backend.connInterval = 5000;
  this.backend.pollingInterval = 1500;
  this.backend.outboundLimit = 1;

  return this;
};
