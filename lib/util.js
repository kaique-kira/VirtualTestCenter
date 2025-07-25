
exports.isEven = isEven;
exports.isOdd = isOdd;
exports.isHex = isHex;
exports.toHexStr = toHexStr;
exports.xorHexStr = xorHexStr;
exports.incHexStr = incHexStr;
exports.pad0 = pad0;
exports.countChar = countChar;
exports.quote = quote;

const  _ = require("lodash");

function isEven (n) {
   return n % 2 == 0;
}
function isOdd (n) {
   return Math.abs(n % 2) == 1;
}

function isHex (value) {
  return !_.isEmpty(value) && value.match(new RegExp("^[0-9A-Fa-f]+$")) != null;
}

function toHexStr (n) {
  return  ("0" + (Number(n).toString(16))).slice(-2);
}

function xorHexStr (a, b) {
  var result = "";
  for (var start = 0, end = 2; start < Math.min(_.size(a), _.size(b)); start += 2, end += 2) {
    result += toHexStr((parseInt(a.substring(start, end), 16) ^ parseInt(b.substring(start, end), 16)));
  }
  return result;
}

function incHexStr (s) {
  var result = "";
  var carry = true;
  for (var i = s.length - 1; i >= 0; i--) {
    var ni = parseInt(s.substr(i, 1), 16);
    if (carry) ni++;
    carry = ni > 15;
    if (carry) ni = 0;
    result = ni.toString(16) + result;
  }
  if (carry) result = "1" + result;
  return result;
}

function pad0 (value, dig) {
  var pad = "";
  for (var count = dig - String(value).length; count > 0; count--, pad += "0");
  return pad + value;
}

function countChar (str, char) {
  var count = 0;
  for (var idx = 0; idx < str.length && str.charAt(idx) == char; idx++, count++);
  return count;
}

function quote (value) {
  if (_.isString(value)) return "'" + value + "'";
  return value;
}
