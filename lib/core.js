
exports.log_push = log_push;
exports.log_call = log_call;
exports.log_info = log_info;
exports.log_warn = log_warn;
exports.log_error = log_error;
exports.match = match;
exports.validate = validate;
exports.parse = parse;
exports.fmtStr = fmtStr;
exports.fmtDate = fmtDate;
exports.handlers = {};

const Config = require("../lib/config").init();
const Log = require("../lib/log").init(Config.log);
const Util = require("../lib/util");
const Codec = require("../lib/codec");
const Iso = require("../lib/iso");

const  _ = require("lodash");
const MongoClient = require("mongodb").MongoClient;
const ObjectID = require("mongodb").ObjectID;

function log_call (ctx, name, func) {
  ctx.log_stack = ctx.log_stack || [];

  if (_.isFunction(func)) {
    stack(name);
    try {
      var result = func.call(ctx);
    } catch (err) {
      log_error(ctx, err);
    }
    stack();
    return result;
  } else {
    return stack(name);
  }

  function stack (name) {
    if (!_.isEmpty(name)) {
      return ctx.log_stack.push(name);
    }
    ctx.log_stack.pop();
  }
}

function log_push (ctx, level, message) {
  var stack = ctx.log_stack ? ctx.log_stack.join(" ") + " " : "";
  if (_.isArray(ctx.log)) ctx.log.push(level + ": " + stack + message);
}

function log_info (ctx, message) {
  Log.info(message);
  return log_push(ctx, "INFO", message);
}

function log_warn (ctx, message) {
  Log.warn(message);
  return log_push(ctx, "WARN", message);
}

function log_error (ctx, message) {
  Log.error(message);
  return log_push(ctx, "ERR", message);
}

function validate (validations, customizer) {
  var ctx = this;

  match.call(ctx, validations, (validation, field, expr, ismatch) => {

    validation.value = field.value;
    validation.exprValue = expr.source;
    validation.result = ismatch ? "pass" : "fail";

    return true;
  });
}

function match (matches, customizer) {
  var ctx = this;

  for (var idx = 0; idx < matches.length; idx++) {
    var match = matches[idx];
    var field = _.find(ctx.fields, { field: match.field }) || {};
    var expr = new RegExp(parse.call(ctx, match.expr || ''), "g");

    var ismatch = field && expr.test(field.value || '');

    if (customizer) ismatch = customizer(match, field, expr, ismatch);
    if (!ismatch) return false;
  }

  return true;
}

function resolveValue (value, properties) {
  var expr = /\\?{{(.+?)(\[.+?\])?}}/g;

  function pass (value, properties) {
    return value.replace(expr, function (match, name, selector) {
      var value = properties[name];
      if (!_.isEmpty(value)) {
        if (!_.isEmpty(selector)) {
          var pair = selector.slice(1, -1).split(",");
          var start = parseInt(pair[0]);
          var end = parseInt(pair[1]);
          if (!isNaN(start) && !isNaN(end)) return value.slice(start, end);
          if (!isNaN(start)) return value.slice(start);
        }
        return value;
      }
      return "";
    });
  }

  var result = value;
  while (result.search(expr) >= 0) {
    result = pass(result, properties);
  }
  return result;
}

function parse (str) {
  var tag, result = str, ctx = this;

  while (tag = parseTag(result)) {
	  if (_.isPlainObject(tag)) {
      var handlers = ctx.handlers || exports.handlers;
      var name = tag.params[0];
      var func = handlers[name];
      if (_.isNil(func) && handlers.default) {
        func = handlers.default;
        name = func.name;
        tag.params.unshift(name);
      }
      if (_.isFunction(func)) {
        log_call(ctx, "{{" + name + "}} @" + tag.start, () => {
          tag.result = func.apply(ctx, tag.params.slice(1));
        });
      } else {
        log_error(ctx, "Unkown tag " + Util.quote(tag.params[0]) + " @" + tag.start);
        return "";
      }
    } else if (_.isString(tag)) {
    	log_error(ctx, tag);
      return "";
    }

    result = result.substring(0, tag.start) + (tag.result || "") + result.substring(tag.end);
  }

  return result;
}

function parseTag (str, start) {
  var tag, quote, len = 0;
  for (var idx = start || 0; idx < str.length; ) {
    if (str.charAt(idx) == "\\") {
      idx += 2;
      if (tag) len += 2;
    } else if (!quote && str.substr(idx, 2) == "{{") {
      if (tag) return "Malformed tag at index " + tag.start + ".";
      tag = { start: idx, end: -1, params: [] };
      idx += 2;
    } else if (!quote && str.substr(idx, 2) == "}}") {
    	if (!tag) return "Malformed tag at index " + idx + ".";
      if (len) tag.params.push(str.substr(idx - len, len));
      tag.end = idx + 2;
      return tag;
    } else if (tag && quote && str.charAt(idx) == quote) {
      tag.params.push(str.substr(idx - len, len).replace(/\\(.)/g, "$1"));
      quote = null;
      idx++;
      len = 0;
    } else if (tag && !quote && (str.charAt(idx) == '\'' || str.charAt(idx) == '"')) {
      quote = str.charAt(idx);
      idx++;
      len = 0;
    } else if (tag && !quote && (str.charAt(idx) == ',' || str.charAt(idx) == ' ')) {
      let value = str.substr(idx - len, len);
      if (len) tag.params.push(isNaN(value) ? value : Number(value));
      len = 0;
      idx++;
    } else {
    	idx++;
      if (tag) len++;
    }
  }
  if (tag) return "Malformed tag at index " + tag.start + ".";
}

/*
console.log(fmtStr("000001234567", "!R0,00"));
console.log(fmtStr("123", "R0000000000"));
console.log(fmtStr("123", "R??????????"));
console.log(fmtStr("1234123412341234", "R*0000"));
*/

function fmtStr (str, fmt) {
  var preLen = Util.countChar(fmt, "@") || Util.countChar(fmt, "X") || Util.countChar(fmt, "&");
  var hexMode = fmt.startsWith("X");
  var bcdMode = fmt.startsWith("&");
  if (preLen) fmt = fmt.substr(preLen);
  var vchar = null, fchar = null, left = true, result = '';
  var limit = 1024;
  while (str.length + fmt.length > 0) {
    if (!limit--) return "ERR: 1024 limit reached.";
    insert = false;
    fchar = fmt.length > 0 ? fmt.charAt(left ? 0 : fmt.length - 1) : fchar;
    vchar = str.length > 0 ? str.charAt(left ? 0 : str.length - 1) : null;
    if (fchar == "R") {
      vchar = null;
    } else if (fchar == "L") {
      if (!left) left = true;
      vchar = null;
    } else if (fchar == "?") {
      if (!vchar) vchar = " ";
    } else if (fchar == "*") {
      if (vchar) vchar = "*";
    } else if (fchar == "#") {
    	if (vchar && vchar.match(/[^0-9]/))	vchar = "";
    } else if (fchar == "!") {
      if (vchar == " " || vchar == "0") {
      	vchar = "";
        fchar = null;
      } else {
      	vchar = null;
      }
    } else if (fchar == "0") {
      if (vchar) {
      	if (vchar.match(/[^0-9]/)) vchar = "";
      } else {
        vchar = '0';
      }
    } else if (fchar == "H") {
      vchar = vchar ? ("0" + vchar.charCodeAt(0).toString(16)).substr(-2) : "00";
    } else if (fchar == "|") {
      break;
    } else if (fchar) {
      insert = vchar != " " && fchar != vchar;
    	vchar = fchar;
      fchar = "";
    }
    if (fchar != null && fmt.length > 0) {
    	if (left) fmt = fmt.substr(1);
      else fmt = fmt.substr(0, fmt.length - 1);
      if (fchar == "R") {
        fchar = null;
        left = false;
      }
    }
    if (vchar != null) {
      if (left) {
        result = result + vchar;
        if (!insert && str.length > 0) str = str.substr(1);
      } else {
      	result = vchar + result;
        if (!insert && str.length > 0) str = str.substr(0, str.length - 1);
      }
    }
  }
  var length = (hexMode || bcdMode) ? result.replace(/\s/g, "").length / 2 : result.length;
  if (preLen) {
    if ((hexMode || bcdMode) && length % 1 != 0) {
    	if (left) result += "F";
      else result = "0" + result;
    }
    var preValue = Math.ceil(length);
    if (hexMode) preValue = preValue.toString(16);
  	result = Util.pad0(preValue, preLen) + result;
  }
  return result;
}

function fmtDate (date, fmt) {
  var result = '';
  var inset = '';
  var size = 0;
  for (var idx = 0; idx <= fmt.length; idx++) {
    var char = idx >= fmt.length ? '' : fmt.charAt(idx);
    if (char != inset) {
      if (inset == 'd') {
        result += Util.pad0(date.getDate(), size);
      } else if (inset == 'm') {
        result += Util.pad0(date.getMonth() + 1, size);
      } else if (inset == 'y') {
        var year = String(date.getFullYear())
        result += year.substr(year.length - size);
      } else if (inset == 'H') {
        result += Util.pad0(date.getHours(), size);
      } else if (inset == 'M') {
        result += Util.pad0(date.getMinutes(), size);
      } else if (inset == 's') {
        result += Util.pad0(date.getSeconds(), size);
      } else {
        for (var count = 0; count < size; count++) {
          result += inset;
        }
      }
      inset = char;
      size = 0;
    }
    size++;
  }
  return result;
}

exports.handlers.fmt = function (str, fmt) {
  return fmtStr(parse.call(this, str), fmt);
};

exports.handlers.default =
exports.handlers.property = function (name, fmt) {
  var result = this.properties[name];
  if (!result) _.forEach(this.properties, (value, key) => {
    if (key.toLowerCase() == name.toLowerCase()) {
      result = value;
      return false;
    }
  });
  if (result) return fmt ? fmtStr(result, fmt) : result;
  log_error(this, "Missing property: " + Util.quote(name));
};

exports.handlers.field = function (name, fmt) {
  if (_.isEmpty(name)) return log_error(this, "Missing parameter name.");
  var field = _.find(this.fields, { field: name });
  if (field) return field.value && fmt ? fmtStr(field.value, fmt) : field.value;
  log_warn(this, "Missing field: " + Util.quote(name));
};

exports.handlers.fieldx = function (idx, name, fmt) {
  if (_.isNaN(idx)) return log_error(this, "Invalid value for parameter index: " + Util.quote(idx));
  if (_.isEmpty(name)) return log_error(this, "Missing parameter name.");

  var goal = idx >= 0 ? this.goals[idx] : this.goals[this.goalIdx + idx];
  if (!goal) return log_error(this, "Invalid goal index: " + idx);

  if (_.indexOf(["txn_inbound", "txn_outbound"], goal.type) < 0) {
    return log_error(this, "No suitable goal found for index: " + idx);
  }

  var src = goal;

  if (this.txns) {
    let txn = _.find(this.txns, { _id: goal.txnId });
    if (_.isEmpty(txn)) log_warn(this, "No txn found for index: " + idx);
    else src = txn;
  }

  var fields = this.fields;
  var matches = name.match(/(?:(.+?):)?(.+)/);
  if (_.isNil(matches[1]) || _.startsWith(matches[1], "req")) {
    fields = src.request.fields || src.request.validations;
  } else if (_.startsWith(matches[1], "resp")) {
    fields = src.response.fields || src.response.validations;
  }

  var field = _.find(fields, { field: matches[2] });
  if (field) return field.value && fmt ? fmtStr(field.value, fmt) : field.value;
  log_error(this, "Missing field: " + Util.quote(name));
};

exports.handlers.date = function (fmt, expr) {
  var instant = (this.instant || new Date()).getTime();
  if (!_.isEmpty(expr)) {
    var matches = expr.trim().match(/([+-]?\d+)(.+)/);
    var value = parseInt(matches[1]);
    if (_.isNaN(value)) return log_error(this, "Invalid value for parameter expr: " + Util.quote(expr));
    var unit = (matches[2] || "").trim().toLowerCase();
    if (_.startsWith(unit, "s")) instant += value * 1000;
    else if (_.startsWith(unit, "m")) instant += value * 60000;
    else if (_.startsWith(unit, "h")) instant += value * 3600000;
    else if (_.startsWith(unit, "d")) instant += value * 86400000;
    else return log_error(this, "Invalid unit for parameter expr: " + Util.quote(expr));
  }
  return fmtDate(new Date(instant), fmt || "");
};

exports.handlers.rand = function (min, max, fmt) {
  var value = Math.round(Math.min(min, max) + (Math.abs(max - min) * Math.random()));
  return value != NaN && fmt ? fmtStr(value.toString(), fmt) : value;
};

exports.handlers.randx = function (digs, fmt) {
  var value = '';
  while (digs-- > 0) value += Math.round(15 * Math.random()).toString(16);
  return fmt ? fmtStr(value, fmt) : value;
};

exports.handlers.randa = function (digs, fmt) {
  var value = '';
  while (digs > 0) {
    var char = String.fromCharCode(Math.round(122 * Math.random()));
    if (char.match(/[A-Za-z0-9]/)) {
      value += char;
      digs--;
    }
  };
  return fmt ? fmtStr(value, fmt) : value;
};

exports.handlers.seq = function (fmt) {
  var value = Math.trunc((this.instant || new Date()).getTime() / 1000).toString();
  return fmt ? fmtStr(value, fmt) : value;
};

exports.handlers.seqx = function (fmt) {
  var value = Math.trunc((this.instant || new Date()).getTime() / 1000).toString(16);
  return fmt ? fmtStr(value, fmt) : value;
};

exports.handlers.seqa = function (fmt) {
  var value = Math.trunc((this.instant || new Date()).getTime() / 1000).toString(36);
  return fmt ? fmtStr(value, fmt) : value;
};

exports.handlers.arpc1 = function (arc, ac) {

  if (!Util.isHex(arc) || arc.length != 4) return log_error(this, " Invalid value hex2 for parameter arc: " + Util.quote(arc));

  var mk = _.find(this.properties, (value, name) => _.endsWith(name, "MK_AC"));
  if (!mk) {
    mk = _.find(this.properties, (value, name) => _.endsWith(name, "MK"));
    if (!mk) return log_error(this, "Missing properties MK_AC/MK");
    log_info(this, "Property MK_AC not found. Using property MK");
  }
  if (!Util.isHex(mk) || mk.length != 32) return log_error(this, "Invalid value hex16 for property MK_AC/MK: " + Util.quote(mk));

  var field_ac = _.isEmpty(ac) ? _.find(this.fields, (o) => _.endsWith(o.field, "9F26")) : { value: ac };
  if (!field_ac) return log_error(this, "Missing value/..9F26 for parameter ac: " + Util.quote(ac));
  if (!Util.isHex(field_ac.value) || field_ac.value.length != 16) return log_error(this, "Invalid value hex8 for parameter ac: " + Util.quote(field_ac.value));

  return Codec.generateARPC_3des_method1(mk, field_ac.value, arc);
};

exports.handlers.mac = function (apdu, atc, ac) {

  if (!Util.isHex(apdu) || apdu.length % 2 != 0 || apdu.length < 10) {
    return log_error(this, "Invalid value hex5~n for parameter apdu: " + Util.quote(apdu));
  }

  var field_atc = _.isEmpty(atc) ? _.find(this.fields, (o) => _.endsWith(o.field, "9F36")) : { value: atc };
  if (!field_atc) return log_error(this, "Missing value/..9F36 for parameter atc: " + Util.quote(atc));
  if (!Util.isHex(field_atc.value) || field_atc.value.length != 4) return log_error(this, "Invalid value hex2 for parameter atc: " + Util.quote(field_atc.value));

  var field_ac = _.isEmpty(ac) ? _.find(this.fields, (o) => _.endsWith(o.field, "9F26")) : { value: ac };
  if (!field_ac) return log_error(this, "Missing value/..9F26 for parameter ac: " + Util.quote(ac));
  if (!Util.isHex(field_ac.value) || field_ac.value.length != 16) return log_error(this, "Invalid value hex8 for parameter ac: " + Util.quote(field_ac.value));

  var rand = this.rand || field_ac.value;

  var sk = _.find(this.properties, (value, name) => _.endsWith(name, "SK_SMI"));
  if (sk && (!Util.isHex(sk) || sk.length != 32)) return log_error(this, "Invalid value hex16 for property SK_SMI: " + Util.quote(sk));

  if (!sk) {
    var mk = _.find(this.properties, (value, name) => _.endsWith(name, "MK_SMI"));
    if (!mk) {
      var mk = _.find(this.properties, (value, name) => _.endsWith(name, "MK"));
      if (!mk) return log_error(this, "Missing properties MK_SMI/MK");
    }
    if (!Util.isHex(mk) || mk.length != 32) {
      return log_error(this, "Invalid value hex16 for property MK_SMI/MK: " + Util.quote(mk));
    }

    log_info(this, "Property SK_SMI not found. Calculated SK using MK_SMI/MK");
    sk = Codec.generateSessionKeyMAC_3des(mk, rand);

    log_info(this, "Using RAND=" + rand + ", MK=" + mk + ", Generated SK=" + sk);
  }

  var mac = Codec.generateMAC_3des(sk, apdu + field_atc.value + rand);

  this.rand = Util.incHexStr(rand);
  return apdu + mac;
}

exports.handlers.bmp = function (required, optional) {

  if (_.isEmpty(required)) {
    return log_error(this, "Missing required fields");
  }

  var out = [];

  required.split(",").forEach((n) => out.push(+n));

  if (!_.isEmpty(optional)) {
    optional.split(",").forEach((n) => { if (_.find(this.fields, (o) => +o.field == n)) out.push(+n); });
  }

  return Iso.encodeBmp(out.sort());
}

