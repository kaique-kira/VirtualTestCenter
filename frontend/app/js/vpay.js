
var app = window.app;
var data = app.data;

data.config.vpay = {
  connectorUrl: "https://localhost:25700",
  connectorBuild: "18241",
  cardBuild: "18241",
  updateInterval: 250
};

app.vpay = {

  request: function (method, resource, params, callback) {
    var opts = {
      type: method,
      url: data.config.vpay.connectorUrl + resource,
      timeout: data.config.wstimeout
    };
    if (params != null) {
      opts.contentType = "application/json";
      opts.data = JSON.stringify(params);
    }
    var request = $.ajax(opts);
    request.done((response) => {
      callback(null, response);
    });
    request.fail((xhr, textStatus, errorThrown) => {
      callback(textStatus);
    });
  },

  perform: function (method, resource, params, callback) {
    app.vpay.request(method, resource, params, (error, response) => {
      if (error) return callback(error);
      if (response.appStatus == "LOCKED") {
        return app.vpay.unlock((error, response) => {
          if (error) return callback(error);
          if (response.appStatus == "UNLOCKED") {
            return app.vpay.request(method, resource, params, callback);
          }
          callback(null, response);
        });
      }
      callback(null, response);
    });
  },

  getInfo: function (callback) {
    app.vpay.perform("GET", "/", null, callback);
  },

  getCardInfo: function (callback) {
    app.vpay.perform("GET", "/card", null, callback);
  },

  unlock: function (callback) {
    var now = new Date();
    var token = md5("unlock," + now.getFullYear() + (now.getMonth() + 1) + now.getDate());
    app.vpay.request("POST", "/", { unlockToken: token }, (error, response) => {
      if (error) return callback(error);
      return callback(null, response);
    });
  },

  writeCard: function (request, callback) {
    app.vpay.perform("POST", "/card", request, callback);
  },

  eraseLog: function (callback) {
    app.vpay.perform("POST", "/card", { erase: { log: true }}, callback);
  }
};
