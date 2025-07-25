
var defaults = {
  error: true,
  warn: true,
  debug: true,
  info: true,
  trace: true,
  query: false
};

function write (level, message) {
  var line = new Error().stack.split("\n")[3].trim();
  var match = /at\s?(.*?)\s\(*?([^\(\)]+?)\)?$/.exec(line);
  var func = match[1];
  var fn = /.+[\\\/](.+?)$/.exec(match[2])[1];
  console.log(process.pid + "\t" + fn + "\t" + level + "\t" + message);
}

exports.init = function (config) {

  var instance = {};

  instance.error = function (message) {
    if (config.error) {
      write("ERROR", message);
    }
  }

  instance.warn = function (message) {
    if (config.warn) {
      write("WARN", message);
    }
  }

  instance.debug = function (message) {
    if (config.debug) {
      write("DEBUG", message);
    }
  }

  instance.info = function (message) {
    if (config.info) {
      write("INFO", message);
    }
  }

  instance.trace = function (message) {
    if (config.trace) {
      write("TRACE", message);
    }
  }

  instance.query = function (collection, query) {
    if (config.query) {
      write("QUERY", collection + ": " + format(query));
    }
    return query;
  }

  return instance;
};
