
exports.validate = validate;
exports.defaultValidator = defaultValidator;

const  _ = require("lodash");
const ObjectID = require("mongodb").ObjectID;

var validators = [
  basicValidator,

];

function validate (definition, doc) {
  var root = arguments.length >= 5 ? arguments[arguments.length - 3] : null;
  var errors = arguments.length >= 4 ? arguments[arguments.length - 2] : [];
  var callback = arguments.length >= 3 ? arguments[arguments.length - 1] : null;

  var ctx = this;
  var paths = _.keys(definition), idx = 0;

  return function next () {
    while (idx < paths.length) {
      var path = paths[idx++];
      var relpath = (root != null ? root + "." : "") + path;
      var validator = typeof definition[path] == "function" ? definition[path] :
                      defaultValidator(definition[path]);
      var value = _.get(doc, relpath);

      return validator.call(ctx, value, relpath, doc, errors, next);
    }
    return callback(errors);
  }();
}

function defaultValidator (descriptor) {

  var settings = _.assignIn({
    required: null,
    type: null,
    obj: null,
    array: null,
    id: false,
    empty: null,
    keys: null,
    values: null,
    name: null,
    definition: null,
    validate: null,
    each: null,
    query: null,
    defvalue: undefined,
    error: null
  }, descriptor);

  return function (value, path, doc, errors, callback) {
    var ctx = this;

    console.log(path + ": " + value);

    if (!_.isNil(settings.required)) {
      var required = settings.required;
      if (typeof required == "function") {
        required = required.call(ctx, getParentObject(doc, path));
      }
      if (required == true && _.isNil(value)) {
        errors.push("Field '" + path + "' is required.");
      }
    }
    if (settings.type && !_.isNil(value) && typeof value != settings.type) {
      errors.push("Field '" + path + "' must be of type'" + settings.type + "'");
    }
    if (settings.obj && !_.isNil(value) && !_.isPlainObject(value)) {
      errors.push("Field '" + path + "' must be an object.");
    }
    if (settings.array && !_.isNil(value) && !_.isArray(value)) {
      errors.push("Field '" + path + "' must be an array.");
    }
    if (settings.id && !_.isNil(value) && _.isString(value) && !_.isEmpty(value)) {
      if (!ObjectID.isValid(value)) {
        errors.push("Field '" + path + "' must be a valid ID.");
      } else {
        _.set(doc, path, new ObjectID(value));
      }
    }
    if (!_.isNil(settings.empty)) {
      var empty = settings.empty;
      if (typeof empty == "function") {
        empty = empty.call(ctx, getParentObject(doc, path));
      }
      if (empty == false && _.isEmpty(value)) {
        errors.push("Field '" + path + "' cannot be empty.");
      }
    }
    if (settings.keys && _.isPlainObject(value) && !_.isEmpty(value)) {
      var values = settings.keys;
      if (typeof values == "function") {
        values = values.call(ctx, value);
      }
      if (_.isEmpty(_.intersection(values, _.keys(value)))) {
        errors.push("Invalid key for '" + path + "'.");
      }
    }
    if (settings.values && !_.isEmpty(value)) {
      var values = settings.values;
      if (typeof values == "function") {
        values = values.call(ctx, value);
      }
      if (_.isEmpty(_.intersection(values, _.isString(value) ? [value] : _.values(value)))) {
        errors.push("Invalid value for '" + path + "'.");
      }
    }
    if (!_.isNil(settings.name)) {
      var values = settings.name;
      if (typeof values == "function") {
        values = values.call(ctx, getPropertyName(path));
      }
      if (values == false || !_.includes(values, getPropertyName(path))) {
        errors.push("Invalid property name for '" + path + "'.");
      }
    }
    if (settings.definition && !_.isEmpty(value)) {
      return validate.call(ctx, settings.definition, doc, path, errors, callback);
    }
    if (settings.validate && !_.isEmpty(value)) {
      return settings.validate.call(ctx, value, path, doc, errors, callback);
    }
    if (settings.each && !_.isEmpty(value)) {
      var validator = typeof settings.each == "function" ? settings.each :
                      defaultValidator(settings.each);
      var keys = _.keys(value);
      var values = _.values(value);
      var idx = 0;

      return function next () {
        while (idx < values.length) {
          var relpath = path + (_.isArray(value) ? "[" + idx + "]" : "." + keys[idx]);
          return validator.call(ctx, values[idx++], relpath, doc, errors, next);
        }
        return callback();
      }();
    }
    if (settings.defvalue != undefined && _.isEmpty(value)) {
      _.set(doc, path, settings.defvalue);
    }
    callback();
  }
}

function basicValidator (def, doc, path, value, errors, callback) {
  if (!_.isNil(def.required)) {
    var required = def.required;
    if (typeof required == "function") {
      required = required.call(ctx, getParentObject(doc, path));
    }
    if (required == true && _.isUndefined(value)) {
      errors.push("Field '" + path + "' is required.");
    }
  }
  if (!_.isNil(def.name)) {
    var values = def.name;
    if (typeof values == "function") {
      values = values.call(ctx, getPropertyName(path));
    }
    if (values == false || !_.includes(values, getPropertyName(path))) {
      errors.push("Invalid property name for '" + path + "'.");
    }
  }
  if (def.nullable == false) {
    if (_.isNull(value)) {
      errors.push("Field '" + path + "' cannot be null.");
    }
  }
  if (!_.isNil(value)) {
    if (!_.isNil(def.type)) {
      if (typeof value != def.type) {
        errors.push("Field '" + path + "' must be of type'" + def.type + "'");
      }
    }
    if (def.object == true) {
      if (!_.isPlainObject(value)) {
        errors.push("Field '" + path + "' must be an object.");
      }
    }
    if (def.array == true) {
      if (!_.isArray(value)) {
        errors.push("Field '" + path + "' must be an array.");
      }
    }
    if (!_.isNil(def.empty)) {
      var empty = def.empty;
      if (typeof empty == "function") {
        empty = empty.call(ctx, getParentObject(doc, path));
      }
      if (empty == false && _.isEmpty(value)) {
        errors.push("Field '" + path + "' cannot be empty.");
      }
    }
    if (!_.isEmpty(value)) {
      if (!_.isNil(def.keys) && _.isPlainObject(value)) {
        var values = def.keys;
        if (typeof values == "function") {
          values = values.call(ctx, value);
        }
        if (values == false || _.isEmpty(_.intersection(values, _.keys(value)))) {
          errors.push("Invalid key for '" + path + "'.");
        }
      }
      if (!_.isNil(def.values)) {
        var values = def.values;
        if (typeof values == "function") {
          values = values.call(ctx, value);
        }
        var data = _.isString(value) ? [value] : _.values(value);
        if (values == false || _.isEmpty(_.intersection(values, data))) {
          errors.push("Invalid value for '" + path + "'.");
        }
      }
      if (def.id == true) {
        if (!ObjectID.isValid(value)) {
          errors.push("Field '" + path + "' must be a valid ID.");
        } else {
          _.set(doc, path, new ObjectID(value));
        }
      }
    }
  }
  if (settings.definition && !_.isEmpty(value)) {
    return validate.call(ctx, settings.definition, value, path, errors, callback);
  }
  if (settings.validate && !_.isEmpty(value)) {
    return settings.validate.call(ctx, value, path, doc, errors, callback);
  }
  callback();
}

function getParentObject (doc, path) {
  var idx = path.lastIndexOf(".");
  if (idx >= 0) {
    return _.get(doc, path.substr(0, idx));
  }
  return doc;
}

function getPropertyName (path) {
  var name = path.substr(path.lastIndexOf(".") + 1);
  return name.split("[")[0];
}
