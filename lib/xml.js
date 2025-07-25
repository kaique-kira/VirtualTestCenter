
exports.decode = decodeXml;
exports.encode = encodeXml;

const Config = require("../lib/config").init();
const Log = require("../lib/log").init(Config.log);
const Codec = require("../lib/codec");

const  _ = require("lodash");

function decodeNode (input, map, path, index) {

  var map = map || [];
  var path = path || "";
  var index = index || 0;

  var tagExpr = /<([^]+?)>/gm;
  var elExpr = /(\w+)/;
  var attrExpr = /(\w+?)\s*?=\s*?"([^]+?)"/g;

  var tags = 0;
  tagExpr.lastIndex = index;
  while (tagMatch = tagExpr.exec(input)) {
    var tag = tagMatch[1];
    //Log.debug("match " + tagExpr.lastIndex + " <" + tag + ">");
    if (tag.startsWith("!--") && tag.endsWith("--")) {
      // comment
    } else if (tag.startsWith("!")) {
    } else if (tag.startsWith("?") && tag.endsWith("?")) {
      // instructions
    } else if (tag.startsWith("/")) {
      if (!path.endsWith(tag)) {
        var element = path.slice(path.lastIndexOf("/"));
        throw "Mismatched element '" + element + "' at position " + tagExpr.lastIndex;
      }
      if (tags == 0) {
        var element = tag.slice(1);
        var value = input.slice(index, tagExpr.lastIndex - (tag.length + 2));
        map[path] = value;
      }
      return tagExpr.lastIndex;
    } else {
      var elMatch = elExpr.exec(tag);
      if (_.isEmpty(elMatch)) {
        throw "Invalid element name at position " + tagExpr.lastIndex;
      }
      var element = elMatch[1];
      // element
      //Log.debug("Element " + element);
      while (attr = attrExpr.exec(tag)) {
        var attrName = attr[1];
        var attrValue = attr[2];
        map[path + "/" + element + "." + attrName] = attrValue;
      }
      if (!tag.endsWith("/")) {
        let nextIndex = decodeNode(input, map, path + "/" + element, tagExpr.lastIndex);
        if (nextIndex > tagExpr.lastIndex)
          tagExpr.lastIndex = nextIndex;
      }
    }
    tags++;
  }
  return tagExpr.lastIndex;
}

function decodeXml (input) {
  var fields = [];
  var map = {};
  decodeNode(input, map);
  for (var field in map) {
    fields.push({
      field: field,
      value: map[field]
    });
    var tlvNodes = [
	"/Document/AccptrAuthstnReq/AuthstnReq/Tx/TxDtls/ICCRltdData",
	"/Document/AccptrAuthstnRspn/AuthstnRspn/Tx/TxDtls/ICCRltdData"
    ];
    if (_.indexOf(tlvNodes, field) >= 0) {
      var tags = Codec.decodeTlvEmv(map[field]);
      fields.push({
       field: field + ".Tags",
       value: _.join(_.map(tags, "field").sort())
      });
      _.forEach(tags, (subfield) => {
       fields.push({
         field: field + "." + subfield.field,
         value: subfield.value
       });
      });
    }
  }
  return fields;
}

function encodeXml (input) {
}

function digXml (input) {
}
