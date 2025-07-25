
exports.decodeField = decodeField;
exports.decodeTlvEmv = decodeTlvEmv;
exports.generateSessionKeyAC_3des = generateSessionKeyAC_3des;
exports.generateARPC_3des_method1 = generateARPC_3des_method1;
exports.generateSessionKeyMAC_3des = generateSessionKeyMAC_3des;
exports.generateMAC_3des = generateMAC_3des;

const Config = require("./config").init();
const Log = require("./log").init(Config.log);
const Util = require("../lib/util");

const Crypto = require("crypto");
const  _ = require("lodash");

function decodeField (input, format) {
  if (format == "tlvemv") {
    return decodeTlvEmv(input);
  }
}

// ISO/IEC 8825
function decodeTlvEmv (input) {
  var result = [];
  var offset = 0;

  while (offset < input.length) {
    var size = 0;

    var tag = decodeTagEmv(input, offset);
    offset += tag.length;
    size += tag.length;

    var length = decodeLengthEmv(input, offset);
    offset += length.size * 2;
    size += length.size * 2;

    var value = input.substr(offset, length.value * 2);
    offset += value.length;
    size += value.length;

    result.push({
      field: tag,
      value: value,
      size: size
    });
  }

  return result;
}

function decodeTagEmv (input, offset) {
  var tag = input.substr(offset, 2);
  offset += 2;

  if ((parseInt(tag, 16) & 0x1F) == 0x1F) {
    for (var follows = true; follows; ) {
      var byte = input.substr(offset, 2);
      follows = (parseInt(byte, 16) & 0x80) == 0x80;
      tag += byte;
      offset += 2
    }
  }

  return tag;
}

function decodeLengthEmv (input, offset) {
  var length = parseInt(input.substr(offset, 2), 16);
  var size = 1;
  offset += 2;

  if (length & 0x80) {
    size = length & 0x7F;
    length = parseInt(input.substr(offset, size * 2), 16);
  }

  return {
    value: length,
    size: size
  };
}

function padMsgIso (msg) {
  var result = msg;
  var first = true;
  while ((result.length / 2) % 8) {
    if (first) result += "80";
    else result += "00";
    first = false;
  }
  return result;
}

function generateSessionKeyAC_3des (mk, atc, un) {
  var algo = "des-ede3-cbc";
  var key = Buffer.from(mk + mk.substring(0, 16), "hex");
  var iv = Buffer.alloc(8, 0);
  return Crypto.createCipheriv(algo, key, iv).update(atc + "F000" + un, "hex", "hex") +
         Crypto.createCipheriv(algo, key, iv).update(atc + "0F00" + un, "hex", "hex");
}

function generateARPC_3des_method1 (sk, ac, arc) {
  var algo = "des-ede3-cbc";
  var key = Buffer.from(sk + sk.substring(0, 16), "hex");
  var iv = Buffer.alloc(8, 0);
  var data = arc + "000000000000";
  return Crypto.createCipheriv(algo, key, iv).update(Util.xorHexStr(ac, data), "hex", "hex");
}

function generateSessionKeyMAC_3des (mk, ac) {
  var algo = "des-ede3-cbc";
  var key = Buffer.from(mk + mk.substring(0, 16), "hex");
  var iv = Buffer.alloc(8, 0);
  return Crypto.createCipheriv(algo, key, iv).update(ac.substr(0, 4) + "F0" + ac.substr(6, 10), "hex", "hex") +
         Crypto.createCipheriv(algo, key, iv).update(ac.substr(0, 4) + "0F" + ac.substr(6, 10), "hex", "hex");
}

function generateMAC_3des (sk, msg) {
  var ek = new Buffer(sk.substr(0, 16), "hex");
  var edek = new Buffer(sk + sk.substring(0, 16), "hex");
  var iv = Buffer.alloc(8, 0);
  var buff = padMsgIso(msg);
  var index = 0;
  var block = "0000000000000000";
  while (index < buff.length) {
    block = Util.xorHexStr(block, buff.substr(index, 16));
    index += 16;
    if (index < buff.length) block = Crypto.createCipheriv("des", ek, iv).update(block, "hex", "hex");
    else block = Crypto.createCipheriv("des-ede3-cbc", edek, iv).update(block, "hex", "hex");
  }
  return block;
}
