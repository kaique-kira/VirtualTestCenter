
exports.decode = decodeIso8583;
exports.encode = encodeIso8583;
exports.encodeBmp = encodeBmp;

exports.decodeSubFields = decodeSubFields;
exports.decodeFields = decodeFields;

const Config = require("../lib/config").init();
const Log = require("../lib/log").init(Config.log);
const Util = require("../lib/util");
const Core = require("./core");
const Codec = require("../lib/codec");

const  _ = require("lodash");

function decodeIso8583 (input, encoding, defs) {
  var results = [];
  var offset = 0;
  var fids = [];

  results.push({
    field: "MTI",
    value: decodeMTI(input)
  });
  offset = 4;

  fids = decodeBmp(input, offset);
  offset += fids.bmpLength;

  results.push({
    field: "BMP",
    value: function () {
      var padding = [];
      for (var fidx = 0; fidx < fids.length; fidx++) {
        padding.push(Util.pad0(fids[fidx], 3));
      }
      return padding.toString();
    }()
  });

  for (var fidx = 0; fidx < fids.length; fidx++) {
    var name = Util.pad0(fids[fidx], 3);
    var def = _.find(defs, { field: name });

    if (!def) {
      return results;
    }

    var formats = def.format.split(";");

    var field = decodeField(input, offset, encoding, formats[0]);
    field.field = name;
    offset += field.size;

    results.push({
      field: name,
      value: field.value
    });

    if (formats.length > 1) {
      var subfields = decodeSubFields(field, _.tail(formats), defs);
      _.forEach(subfields, (subfield) => results.push({
        field: subfield.field,
        value: subfield.value
      }));
    }
  }

  return results;
}

function decodeMTI (input) {
  return input.substr(0, 4);
}

function decodeBmp (input, offset) {
  var fids = [];
  var length = 0;

  for (var fid = 1, extend = true; extend; offset += 16) {
    var bmp = input.substr(offset, 16);
    for (var first = true, byte = 0; byte < 8; byte++, length += 2) {
      var value = parseInt(bmp.substr(byte * 2, 2), 16);
      for (var bit = 0, mask = 0x80; bit < 8; mask >>>= 1, bit++, fid++, first = false) {
        if (value & mask) {
          if (!first) {
            fids.push(fid);
          }
        } else if (first) {
          extend = false;
        }
      }
    }
  }

  fids.bmpLength = length;
  return fids;
}

function encodeBmp (fields) {
  var bmp = [];
  var seq = 0, field = 1, last = Math.max(...fields);

  while (field <= last) {
    var offset = seq * 8;
    for (var first = true, byte = 0; byte < 8; byte++) {
      bmp[offset + byte] = 0;
      for (var bit = 0, mask = 0x80; bit < 8; mask >>>= 1, bit++, field++, first = false) {
        if (first && (field > seq * 64)) bmp[(seq - 1) * 8] |= 0x80;
        if (fields.indexOf(field) >= 0) bmp[offset + byte] |= mask;
      }
    }
    seq++;
  }

  var hex = "";
  for (var idx = 0; idx < bmp.length; idx++)
     hex += ("0" + bmp[idx].toString(16)).substr(-2);

  return hex.toUpperCase();
}

function decodeSubFields (field, formats, defs) {
  var results = [];

  var encoding = (field.format && field.format.encoding) || field.encoding;
  var subfields = decodeFields(field.value, 0, encoding, formats);

  for (var idx = 0; idx < subfields.length; idx++) {
    var subfield = subfields[idx];

    var name = _.isEmpty(subfield.field) ?
      field.field + "." + (idx + 1) :
      field.field + "." + subfield.field;

    subfield.field = name;
    results.push(subfield);

    var def = _.find(defs, { field: subfield.field });
    if (def) {
      var fields = decodeSubFields(subfield, def.format.split(";"), defs);
      _.forEach(fields, (field) => results.push(field));
    }
  }

  return results;
}

function decodeFields (input, offset, encoding, formats) {
  var results = [];
  var idx = 0;
  var tags = [];

  while (offset < input.length && idx < formats.length) {
    var format = formats[idx++];

    if (format.startsWith("tlvemv")) {
      _.forEach(Codec.decodeTlvEmv(input.substr(offset)), (field) => {
        results.push(field);
        tags.push(field.field);
        offset += field.size;
      });
    } else if (format.startsWith("tlv")) {
      _.forEach(decodeTlv(input, offset, encoding, format), (field) => {
        results.push(field);
        tags.push(field.field);
        offset += field.size;
      });
    } else {
      var field = decodeField(input, offset, encoding, format);
      results.push(field);
      offset += field.size;
    }
  }

  if (!_.isEmpty(tags)) {
    tags.sort();
    results.unshift({
      field: "Tags",
      value: _.join(tags, ",")
    });
  }


  return results;
}

function parseFormat (format) {
  var expr = /([a-zA-Z0-9]+?:)?([^\s.0-9]+)(\.+)?([0-9]+)?\s*(.+)?/g;
  var matches = expr.exec((format || "").trim());
  if (matches) return {
    name: matches[1] ? matches[1].substring(0, matches[1].length - 1) : null,
    type: matches[2],
    lengthSize: matches[3] ? matches[3].length : 0,
    size: matches[4] ? parseInt(matches[4]) : 0,
    encoding: (matches[5] || "").trim()
  };
  return null;
}

function decodeField (input, offset, encoding, format) {

  var params = parseFormat(format);
  if (!params) return;

  var bcd = encoding == "hex";
  var start = offset;
  var length = params.size;
  var size = 0;
  var value = "";
  var raw = "";

  if (params.lengthSize) {
		// length indicator is numeric, right aligned
    if (bcd && Util.isOdd(params.lengthSize)) {
    	offset++;
    	size++;
    }
    length = parseInt(input.substr(offset, params.lengthSize));
    offset += params.lengthSize;
    size += params.lengthSize;
  }

  if (params.type == "n") {
    // numeric, right aligned
    if (bcd && Util.isOdd(length)) {
    	offset++;
    	size++;
    }
    value = input.substr(offset, length);
    size += length;
  } else if (params.type == "a" || params.type == "an") {
    if (params.encoding == "hex") length *= 2;
    value = input.substr(offset, length);
    size += length;
  } else if (params.type == "ans") {
    if (bcd) length *= 2;
    value = input.substr(offset, length);
    size += length;
    if (params.encoding) value = Buffer.from(value, encoding).toString(params.encoding);
  } else  if (params.type == "b") {
    length = Math.ceil(length / 4);
    value = input.substr(offset, length);
    size += length;
  } else  if (params.type == "h") {
    length *= 2;
    value = input.substr(offset, length);
    size += length;
  }

  // align odd->even boundary
	if (bcd && Util.isOdd(size)) {
    var nibble = _.upperCase(input.charAt(offset));
    // include if not filler
    if (nibble != "F") value += nibble;
    offset++;
    size++;
  }

  return {
    field: params.name || "",
    value: value,
    start: start,
    size: size,
    format: params,
    encoding: encoding,
    raw: input.substr(start, size)
  };
}

function parseTlvFormat (format) {
  if (format.startsWith("tlv")) {
    var parts = format.split(/\s+(.+)/);
    var params = parts.length > 1 ? parts[1].split(",") : [];
    return {
      type: parts[0].substr(3),
      tag: params[0],
      length: params[1],
      value: params[2]
    };
  }
}

function decodeTlv (input, offset, encoding, format) {
  format = format || {};

  var params = parseTlvFormat(format);
  var results = [];

  while (offset < input.length) {
    var start = offset;
    var size = 0;

    var tag = decodeField(input, offset, encoding, params.tag || "n3");
    offset += tag.size;
    size += tag.size;

    var length = decodeField(input, offset, encoding, params.length || "n3");
    offset += length.size;
    size += length.size;

    if (length.format.type == "b") {
      length.intValue = parseInt(length.value, 16);
      length.intValue *= 2;
    } else {
      length.intValue = parseInt(length.value);
    }

    var valueFmt = !_.isEmpty(params.value) ? parseFormat(params.value) : {};
    var value = decodeField(input, offset, encoding, (valueFmt.tag || "ans") + length.intValue);
    offset += value.size;
    size += value.size;

    results.push({
      field: tag.value,
      value: value.value,
      start: start,
      size: size,
      format: params,
      encoding: encoding
    });
  }

  return results;
}

function encodeIso8583 (fields) {
}
