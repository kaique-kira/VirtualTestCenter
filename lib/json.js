
exports.decode = decodeJson;
exports.encode = encodeJson;

const Config = require("../lib/config").init();
const Log = require("../lib/log").init(Config.log);
const Codec = require("../lib/codec");
const Iso = require("../lib/iso");

const _ = require("lodash");

const isTraversable = (o) => typeof o === 'object';

function traverse (map, obj, path = '') {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const abspath = path + '[' + i + ']';
      const value = obj[i];
      if (isTraversable(value))
        traverse(map, value, abspath);
      else
        map[abspath] = value;
    }
  } else if (typeof obj === 'object') {
    for (let p in obj) {
      const abspath = path !== '' ? path + '.' + p : p;
      const value = obj[p];
      if (isTraversable(value))
        traverse(map, value, abspath);
      else
        map[abspath] = value;
    }
  }
}

function decodeJson (input, encoding, defs) {

  const inputObj = JSON.parse(input);

  let map = {};
  traverse(map, inputObj);

  var fields = [];
  for (let key in map) {

    let field = {
      field: key,
      value: map[key]
    };
    fields.push(field);

    if (typeof field.value === "string") {
      var def = _.find(defs, { field: key });
      if (def) {
        var formats = def.format.split(";");
        var subfields = Iso.decodeSubFields(field, formats, defs);
        _.forEach(subfields, (subfield) => fields.push({
          field: subfield.field,
          value: subfield.value
        }));
      }
    }

    /*
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
    */
  }
  return fields;
}

function encodeJson (input) {
}
