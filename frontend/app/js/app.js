
var app = window.app = {};
var data = app.data = {};

app.version = "18241";

data.config = {
  wstimeout: 10000,
  def_language: "pt-br",
  update_interval: 3000,
  pull_interval: 5000,
  def_limit: 200
};
data.const = {
  accessLevels: ["read", "guest", "scope", "exec", "create", "admin"],
  scopeLevels: ["read", "scope", "exec", "create", "admin"],
  execLevels: ["read", "exec", "create", "admin"],
  createLevels: ["create", "admin"]
}
data.routes = [];
data.pooling = {
  dirty: true,
  request: null,
  pulls: []
};
data.sessionId = null;
data.domainId = null;
data.domainName = null;
data.accessLevel = null;
data.permissions = [];
data.language = data.config.def_language;
data.txn = { fields: [] };

app.locals = {};

app.route = {

  currentPath: null,

  add: function (path, element, view, controller) {
    data.routes.push({
      path: path,
      element: element,
      view: view,
      controller: controller
    });
  },

  goTo: function (path, params) {
    path = path || window.location.hash.slice(1);

    $("#content").trigger("unload");

    for (var idx = 0; idx < data.routes.length; idx++) {
      var route = data.routes[idx];
      if (path == route.controller) {
        app.route.currentPath = path;
        return app.ui.load(route.element, route.view, (render) => {
          if (route.controller) {
            return route.controller(render, params);
          }
          return render();
        });
      } else if (_.isString(path)) {
        var match = matchRoute(path, route.path);
        if (match) {
          app.route.currentPath = path;
          window.location.hash = path;
          return app.ui.load(route.element, route.view, (render) => {
            if (route.controller) {
              return route.controller(render, match);
            }
            return render();
          });
        }
      }
    }

    function matchRoute (path, route) {
      var queryIndex = path.indexOf("?");
      var query = queryIndex >= 0 ? path.substring(queryIndex + 1) : "";
      path = path.substring(0, queryIndex >= 0 ? queryIndex : path.length);
      var strExpr = route.replace(/:\w+/g, "(\\w+)")
                         .replace(/\//g, "\\/")
                         .concat("$");
      var routeExpr = new RegExp(strExpr, "g");
      var matches = routeExpr.exec(path);
      if (matches) {
        var paramExpr = /:(\w+)/g;
        var params = {};
        var matchIdx = 1;
        while ((paramMatch = paramExpr.exec(route)) !== null) {
          params[paramMatch[1]] = matches[matchIdx++];
        }
        $.extend(params, parseQuery(query));
        return params;
      }
    }

    // From: https://stackoverflow.com/a/5713807
    function parseQuery (query) {
      var setValue = function (root, path, value) {
        if (path.length > 1) {
          var dir = path.shift();
          if (typeof root[dir] == 'undefined') {
            root[dir] = path[0] == '' ? [] : {};
          }
          arguments.callee(root[dir], path, value);
        } else {
          if (root instanceof Array) {
            root.push(value);
          } else {
            root[path] = value;
          }
        }
      };

      var nvp = query.split('&');
      var data = {};
      for (var i = 0; i < nvp.length; i++) {
        var pair = nvp[i].split('=');
        var name = decodeURIComponent(pair[0]);
        var value = decodeURIComponent(pair[1]);

        var path = name.match(/(^[^\[]+)(\[.*\]$)?/);
        if (path) {
          var first = path[1];
          if (path[2]) {
            //case of 'array[level1]' || 'array[level1][level2]'
            path = path[2].match(/(?=\[(.*)\]$)/)[1].split('][')
          } else {
            //case of 'name'
            path = [];
          }
          path.unshift(first);

          setValue(data, path, value);
        }
      }

      return data;
    }
  },

  goToDefaultNav: function () {
    if (app.state.hasGuestPermisssion() || app.state.hasExecPermissions()) app.route.goTo("/executions");
    else if (app.state.hasScopePermissions()) app.route.goTo("/tests");
  }
};

app.ui = {

  get locals () {
    return app.locals[data.language];
  },

  init: function () {
    if (!data.sessionId) {
      app.ui.goToSignIn();
    } else {
      app.session.update((status) => {
        if (status == Ws.Status.SUCCESS) {
          app.ui.goToMain();
        } else {
          data.sessionId = null;
          app.state.save();
          app.ui.goToSignIn();
        }
      });
    }
  },

  goToSignIn: function () {
    app.ui.load("container", "signin.html", app.ctrls.signIn);
  },

  goToMain: function () {
    app.ui.load("container", "base.html", app.ctrls.base);
  },

  load: function (element, view, controller) {

    var $element = element instanceof jQuery ? element : $("#" + element);

    $element.off();

    controller = controller || function (render) {
      return render();
    };

    if (!app.ui.locals) {
      return $.getScript("lang/" + data.language + ".js", (result, status) => {
        if (status == "success") {
          console.log("Local " + data.language + " loaded.");
          return app.ui.load($element, view, controller);
        }
        console.log("Failed loading " + data.language);
      });
    }

    var cached = false;
    var startNetwork = new Date();

    $.ajax({
      url: view,
      dataType: "text",
      success: function (template) {

        var startCompile = new Date();
        var renderer = Handlebars.compile(template);
        var scripts = $("<output>").append($.parseHTML(template))
                                   .find("script[type='text/x-handlebars-template']");

        var startController = new Date();
        controller((context, partial) => {

          var startRender = new Date();
          var localCtx = $.extend({ locals: app.ui.locals }, context);
          var html = "";

          if (partial) {
            var partialTemplate = "{{> " + partial + "}}\n" +
              $element.find("script[type='text/x-handlebars-template']").text();
            var partialRenderer = Handlebars.compile(partialTemplate);
            html = partialRenderer(localCtx);
          } else {
            html = renderer(localCtx);
            $element.html(html);
            $element.append(scripts);
            $element.find("script:empty").remove();
          }

          var finish = new Date();

          var timing = cached ?
            String(finish - startRender) + "ms." :
            String(startCompile - startNetwork) + "/" +
            String(startController - startCompile) + "/" +
            String(finish - startRender) + "/" +
            String(finish - startNetwork) + " ms.";

          if (partial) console.log("Partial " + partial + " rendered. " + timing);
          else console.log("View " + view + " rendered. " + timing);

          // stop animations
          setTimeout(() => {
            console.log("Animations stoped.");
            $("#content .animated").removeClass("animated");
          }, 3000);

          cached = true;
          return html;
        });
      }
    });
  },

  query: function (desc, el, obj) {
    var $el = $(el || "body");

    if (desc._if && desc._if(obj) == false) return;
    if (desc.$array) {
      var results = [];
      $el.find(desc.$array).each((idx, itemEl) => {
        var value = app.ui.query(_.omit(desc, ["$array", "$index"]), itemEl, obj);
        if (value != undefined) {
          if (desc.$index) results[app.ui.query(desc.$index, itemEl)] = value;
          else results.push(value);
        }
      });
      return results;
    }
    if (desc.$each) {
      var result = {};
      $el.find(desc.$each).each((idx, itemEl) => {
        var prop = app.ui.query(desc.$property, itemEl);
        var value = app.ui.query(_.omit(desc, ["$each", "$property"]), itemEl, obj);
        if (value != undefined) result[prop] = value;
      });
      return result;
    }
    if (desc.$set) {
      var result = {};
      _.forEach(desc.$set, (desc) => {
        _.assignIn(result, app.ui.query(desc, el, result));
      });
      return result;
    }
    if (desc.$object) {
      var result = {};
      for (var prop in desc.$object) {
        var value = app.ui.query(desc.$object[prop], $el, result);
        if (value != undefined) result[prop] = value;
      }
      return result;
    } else if (desc.$string) {
      return getValue($el, desc.$string);
    } else if (desc.$numeric) {
      return Number(getValue($el, desc.$numeric));
    } else if (desc.$boolean) {
      return Boolean(getValue($el, desc.$boolean));
    }

    function getValue ($el, selection) {
      var attr = selection.match(/(.*)\[([A-Za-z\-]+)].*/);
      if (attr) return _.isEmpty(attr[1]) ? $el.attr(attr[2]) : $el.find(attr[1]).attr(attr[2]);
      var $sel = $el.find(selection);
      if ($sel.attr("type") == "checkbox") return $sel.prop("checked");
      if ($sel.length > 0 && $sel[0].tagName == "TEXTAREA") return $sel.val();
      return $sel.val() || $sel.text();
    }
  },

  queryLastModified: function (selector) {
    var modifiedSince = null;

    $("#content " + selector).each(function () {
      var $el = $(this);
      var data = $el.attr("data-modified");
      if (!_.isEmpty(data)) {
        let modified = new Date(data);
        if (!modifiedSince || modified > modifiedSince) {
          modifiedSince = modified;
        }
      }
    });

    if (modifiedSince) {
      return new Date(modifiedSince.getTime() + 1);
    }
  },

  // TODO: Make all updates use this function instead.
  upsert: function (data, render, partial, eselector, pselector) {
    if (_.isNil(data)) return 0;
    var objs = _.isArray(data) ? data : [ data ];
    var count = 0;
    var markup = "";

    _.forEach(objs, (obj) => {
      if (_.isEmpty(obj._id)) {
        console.log("Warning: Object has no _id property.");
        console.log(obj);
        return;
      }
      var elmarkup = render(obj, partial);
      var sel = eselector || ("#content ." + partial);
      var $oldel = $(sel + "[data-id='" + obj._id + "']");
      if ($oldel.length > 0) {
        $oldel.replaceWith($(elmarkup));
      } else {
        markup += elmarkup;
        count++;
      }
    });

    if (!_.isEmpty(markup)) {
      var sel = pselector || ("#content ." + partial + "s");
      var $parent = $(sel);
      if ($parent.length > 0) $(markup).prependTo($parent);
      else console.log("Warning: Cannot find parent element.");
    }

    return count;
  },

  replace: function (data, render, partial, eselector) {
    if (_.isNil(data)) return;
    var objs = _.isArray(data) ? data : [ data ];

    var $currEls = $(eselector || ("#content ." + partial));
    if ($currEls.length <= 0) return console.log("Warning: Cannot find elements to replace.");

    var $prev = $currEls;
    _.forEach(objs, (obj, idx) => {
      $prev = $(render(obj, partial)).insertAfter($prev);
    });

    $currEls.remove();
  },

  info: function (message, title) {
    toastr.info(message, title);
    return true;
  },

  success: function (message, title) {
    toastr.success(message, title);
    return true;
  },

  warning: function (message, title) {
    toastr.warning(message, title);
    return false;
  },

  error: function (message, title) {
    toastr.error(message, title);
    return false;
  }
};

app.ui.base = {

  changes: false,

  toolbar: {

    load: function (view, controller) {
      var $toolbar = $("#toolbar").show();
      $("#content").addClass("toolbar-open");
      app.ui.load($toolbar, view, (render) =>  {
        if (controller) {
          controller((context, partial) => {
            return render(context, partial);
          });
        }
        $toolbar.on("click", ".js-close-toolbar", function (ev) {
          app.ui.base.toolbar.close();
        });
      });
    },

    close: function () {
      $("#toolbar").off().empty().hide();
      $("#content").removeClass("toolbar-open");
    }
  },

  modal: {

    load: function (view, options, controller) {
      var $modal = $("#modal");
      var init = false;
      app.ui.load($modal, view, (render) => {
        if (controller) {
          controller((context, partial) => {
            var html = render(context, partial);
            if (!init) {
              $modal.modal(options);
              init = true;
            }
            return html;
          });
        }
      });
      $modal.on("hidden.bs.modal", function (ev) {
        $modal.empty();
        $modal.off();
      });
    }
  },

  content: {

    header: {

      sticky: function (enabled) {

        /*
        var $content = $("#content");
        var $header = $("#content .header").first();

        $content.unbind("scroll");

        reset();
        var voffset = $("#header").outerHeight(true);
        var threshold = Math.abs($header.offset().top - voffset);

        if (enabled) $content.scroll(function (ev) {
          var scroll = $(content).scrollTop();
          if (scroll > threshold) {
            $header.css("width", $("#content .wrapper").width());
            $header.css("position", "fixed");
            $header.css("top", voffset + "px");
            $header.parent().css("margin-top", $header.height() + "px");
            $header.addClass("sticky");
          } else {
            reset();
          }
        });

        function reset () {
          $header.css("top", "");
          $header.css("position", "");
          $header.css("width", "");
          $header.parent().css("margin-top", "");
          $header.removeClass("sticky");
        }
        */
      }
    }
  }
};

app.state = {

  load: function () {
    if (localStorage.app) {
      var storage = JSON.parse(localStorage.app);
      data.language = storage.language || data.config.def_language;
      data.sessionId = storage.sessionId;
      data.userId = storage.userId;
      data.username = storage.username;
      data.domainId = storage.domainId;
      data.txn = storage.txn || data.txn;
    }
  },

  save: function () {
    var storage = {
      language: data.language,
      sessionId: data.sessionId,
      userId: data.userId,
      username: data.username,
      domainId: data.domainId,
      txn: data.txn
    };
    localStorage.setItem("app", JSON.stringify(storage));
  },

  remove: function () {
    localStorage.removeItem("app");
  },

  setLanguage: function (language) {
    data.language = language;
  },

  setDomainId: function (id) {
    data.domainId = null
    data.domainName = null;
    data.accessLevel = null;
    if (id) {
      for (var idx = 0; idx < data.permissions.length; idx++) {
        var domain = data.permissions[idx];
        if (id == domain.domainId) {
          data.domainId = id;
          data.domainName = domain.domainName;
          data.accessLevel = domain.level || "guest";
          data.grants = domain.grants;
        }
      }
    }
    if (!data.domainId && data.permissions.length > 0) {
      data.domainId = data.permissions[0].domainId;
      data.domainName = data.permissions[0].domainName;
      data.accessLevel = data.permissions[0].level || "guest";
      data.grants = data.permissions[0].grants;
    }
  },

  setTerminalId: function (id) {
    app.session.terminalId = id;
  },

  getPermissions: function (levels) {
    return _.filter(data.permissions, (o) => {
      return o.level && _.indexOf(levels, o.level) >= 0;
    });
  },

  hasGuestPermisssion: function () {
    return data.accessLevel == "guest";
  },

  hasScopePermissions: function () {
    return _.indexOf(data.const.scopeLevels, data.accessLevel) >= 0;
  },

  hasCreatePermissions: function () {
    return _.indexOf(data.const.createLevels, data.accessLevel) >= 0;
  },

  hasExecPermissions: function () {
    return _.indexOf(data.const.execLevels, data.accessLevel) >=0;
  },

  hasAnyExecPermissions: function () {
    return !_.isEmpty(app.state.getPermissions(data.const.execLevels));
  }
}

app.session = {

  update: function (callback) {

    var request = $.ajax({
        type: "POST",
        url: "/ws/" + data.sessionId + "/info",
        dataType: "json",
        timeout: data.config.wstimeout
    });

    request.done(function (response) {
      if (response.status == Ws.Status.SUCCESS) {
        data.permissions = response.permissions;
        app.state.setDomainId(data.domainId);
        return callback(Ws.Status.SUCCESS);
      }
      console.log("updateSession: " + response.message);
      return callback(response.status);
    });

    request.fail(function (jqxhr, status) {
      if (status == "timeout") {
        return callback(Ws.Status.TIMEOUT);
      }
      return callback(Ws.Status.CONN_FAILURE);
    });
  },

  signIn: function (username, password, callback) {

    var request = $.ajax({
        type: "POST",
        url: "/ws/signin",
        data: JSON.stringify({
          username: username,
          password: password
        }),
        contentType: "application/json",
        dataType: "json",
        timeout: data.config.wstimeout
    });

    request.done((response) => {
      if (response.status == Ws.Status.SUCCESS) {
        data.sessionId = response.sessionId;
        data.userId = response.userId;
        data.username = username;
        data.permissions = response.permissions;
        app.state.setDomainId();
        app.state.save();
        return callback(Ws.Status.SUCCESS);
      }
      console.log("signIn: " + response.message);
      return callback(response.status);
    });

    request.fail((jqxhr, status) => {
      if (status == "timeout") {
        return callback(Ws.Status.TIMEOUT);
      }
      return callback(Ws.Status.CONN_FAILURE);
    });
  },

  signOut: function (callback) {

    var request = $.ajax({
        type: "POST",
        url: "/ws/" + data.sessionId + "/signout",
        dataType: "json",
        timeout: data.config.wstimeout
    });

    request.done(function (response) {
      if (response.status == Ws.Status.SUCCESS) {
        data.sessionId = null;
        app.state.save();
        return callback(Ws.Status.SUCCESS);
      }
      console.log("signOut: " + response.message);
      return callback(response.status);
    });

    request.fail(function (jqxhr, status) {
      if (status == "timeout") {
        return callback(Ws.Status.TIMEOUT);
      }
      return callback(Ws.Status.CONN_FAILURE);
    });
  }
};

app.ws = {

  call: function (endpoint, params, callback) {

	  var start = new Date();

    var request = $.ajax({
        type: "POST",
        url: "/ws/" + data.sessionId + "/" + endpoint,
        data: JSON.stringify(params),
        contentType: "application/json",
        dataType: "json",
        timeout: data.config.wstimeout
    });

    request.done(function (response) {
      setTimeout(function () {
        var finish = new Date();
        console.log("Call took " + (finish - start) + "ms.");
        if (response.status == Ws.Status.SUCCESS) {
          return callback(Ws.Status.SUCCESS, response);
        }
        console.log("Call " + endpoint + ": " + response.message);
        $("#container").trigger("wserror", response);
        callback(response.status);
      }, 0);
    });

    request.fail(function (jqxhr, status) {
      if (status == "timeout") {
        return callback(Ws.Status.TIMEOUT);
      }
      callback(Ws.Status.CONN_FAILURE);
    });
  },

  pull: function (collection, query, callback) {

    data.pulls.push({
      collection: collection,
      query: query,
      callback: callback
    });

    pooling.dirty = true;
  },

  pooling: function () {

    if (data.pooling.dirty && data.pooling.pulls.length > 0) {

      if (data.pooling.request) {
        data.pooling.request.abort();
        data.pooling.request = null;
      }

      data.pooling.request = $.ajax({
        type: "POST",
        url: "/ws/" + app.session.id + "/pull",
        data: JSON.stringify({
          pulls: app.pulls
        }),
        contentType: "application/json",
        dataType: "json",
        timeout: 0
      });

      data.pooling.request.done((response) => {
        _.forEach(app.pooling.pulls, (pull) => {
          pull.callback(response.status, response.results);
        });
        app.pooling.dirty = true;
      });

      data.pooling.request.fail((jqxhr, status) => {
        app.pooling.dirty = true;
      });

      data.pooling.dirty = false;
    }
  },

  query: function (collection, query, callback) {
    return app.ws.call(collection + "/query", _.assignIn({ domainId: data.domainId }, query), (status, response) => {
      return callback(status, status == Ws.Status.SUCCESS ? response.results : undefined);
    });
  },

  insert: function (collection, obj, callback) {
    return app.ws.call(collection + "/insert", _.assignIn({ domainId: data.domainId }, obj), (status, response) => {
      return callback(status, status == Ws.Status.SUCCESS ? response.id : undefined);
    });
  },

  update: function (collection, query, obj, callback) {
    return app.ws.call(collection + "/update", _.assignIn({ domainId: data.domainId }, obj, query), (status, response) => {
      return callback(status, status == Ws.Status.SUCCESS ? response.result : undefined);
    });
  },

  refresh: function (collection, id, onupdate, callback) {
    return app.ws.query(collection, { id: id }, (status, results) => {
      if (status != Ws.Status.SUCCESS) return callback(status);
      if (onupdate && onupdate(results[0]) != false) return app.ws.update(collection, { id: id }, results[0], callback);
      return callback(status, results[0]);
    });
  },

  delete: function (collection, ids, callback) {
    var query = {};
    if (ids instanceof Array) query.ids = ids;
    else query.id = ids;
    return app.ws.call(collection + "/delete", query, (status, response) => {
      return callback(status, status == Ws.Status.SUCCESS ? response.result : undefined);
    });
  }
}

app.lib = {

  getClassVariant: function (el, prefix) {
    var classes = $(el).attr("class");
    var start = classes.indexOf(prefix);
    return classes.substring(start + prefix.length).split(" ")[0];
  },

  prettifyHex: function (s) {
    if (!_.isEmpty(s)) {
      return s.replace(/\s/g, "").replace(/(..)/g, "$1 ").toUpperCase();
    }
    return s;
  }
}

$(document).ready(function () {

  app.route.add("/domain/:id", "content", "domain.html", app.ctrls.domain);
  app.route.add("/hosts", "content", "hosts.html", app.ctrls.hosts);
  app.route.add("/executions", "content", "executions.html", app.ctrls.executions);
  app.route.add("/executions/:domainId/:id", "content", "execution.html", app.ctrls.execution);
  app.route.add("/scenario/:id", "content", "scenario.html", app.ctrls.scenario);
  app.route.add("/tests", "content", "tests.html", app.ctrls.tests);
  app.route.add("/tests/:id", "content", "test.html", app.ctrls.test);
  app.route.add("/assets", "content", "assets.html", app.ctrls.assets);
  app.route.add("/assets/:id", "content", "asset.html", app.ctrls.asset);

  $(window).on("hashchange", function (ev) {
    if (window.location.hash.slice(1) != app.route.currentPath) {
      app.route.goTo();
    }
  });

  Handlebars.registerHelper("marked", function (text) {
    if (!_.isEmpty(text)) return new Handlebars.SafeString(marked(text));
    return "";
  });

  Swag.registerHelpers(Handlebars);

  moment.locale(data.language);

  Handlebars.registerHelper("moment", function (context, block) {
    if (context && context.hash) {
      block = _.cloneDeep(context);
      context = undefined;
    }
    var date = moment(context);

    if (block.hash.timezone){
      date.tz(block.hash.timezone);
    }

    var hasFormat = false;

    for (var i in block.hash) {
      if (i === "format") {
        hasFormat = true;
      }
      else if (date[i]) {
        date = date[i](block.hash[i]);
      } else {
        console.log("moment.js does not support '" + i + "'");
      }
    }

    if (hasFormat) {
      date = date.format(block.hash.format);
    }
    return date;
  });

  toastr.options = {
    "closeButton": true,
    "debug": false,
    "newestOnTop": false,
    "progressBar": false,
    "positionClass": "toast-top-center",
    "preventDuplicates": false,
    "onclick": null,
    "showDuration": "300",
    "hideDuration": "1000",
    "timeOut": "5000",
    "extendedTimeOut": "1000",
    "showEasing": "swing",
    "hideEasing": "linear",
    "showMethod": "fadeIn",
    "hideMethod": "fadeOut"
  };

  $("#version").text(app.version);

  app.state.load();
  app.ui.init();

  console.log("App init.");
});

$.fn['animatePanel'] = function() {

    var element = $(this);
    var effect = $(this).data('effect');
    var delay = $(this).data('delay');
    var child = $(this).data('child');

    // Set default values for attrs
    if(!effect) { effect = 'zoomIn'}
    if(!delay) { delay = 0.06 } else { delay = delay / 10 }
    if(!child) { child = '.row > div'} else {child = "." + child}

    //Set defaul values for start animation and delay
    var startAnimation = 0;
    var start = Math.abs(delay) + startAnimation;

    // Get all visible element and set opacity to 0
    var panel = element.find(child);
    panel.addClass('opacity-0');

    // Get all elements and add effect class
    panel = element.find(child);
    panel.addClass('stagger').addClass('animated-panel').addClass(effect);

    var panelsCount = panel.length + 10;
    var animateTime = (panelsCount * delay * 10000) / 10;

    // Add delay for each child elements
    panel.each(function (i, elm) {
        start += delay;
        var rounded = Math.round(start * 10) / 10;
        $(elm).css('animation-delay', rounded + 's');
        // Remove opacity 0 after finish
        $(elm).removeClass('opacity-0');
    });

    // Clear animation after finish
    setTimeout(function(){
        $('.stagger').css('animation', '');
        $('.stagger').removeClass(effect).removeClass('animated-panel').removeClass('stagger');
    }, animateTime);
};

app.context = {

  queryCollection: function (collection, extra) {
    return function doQueryCollection (context) {
      return new Promise((resolve) => {
        var query = {
          shallow: true,
          limit: app.data.config.def_limit
        };
        if (context.domainId) {
          query.domainId = context.domainId;
        }
        _.assignIn(query, extra);
        app.ws.query(collection, query, (status, results) => {
          if (status == Ws.Status.SUCCESS) {
            if (typeof context[collection] === "undefined")
              context[collection] = [];
            results.forEach((result) => {
              context[collection].push(result);
            });
          }
          resolve(context);
        });
      });
    }
  },

  queryDomains: function (context) {
    return new Promise((resolve) => {
      var query = { shallow: true };
      if (context.domainId) {
        query.id = context.domainId;
        query.shallow = false;
      }
      if (!_.isNil(query.ids) && _.isEmpty(query.ids)) return resolve(context);
      app.ws.query("domains", query, (status, results) => {
        if (status == Ws.Status.SUCCESS) {
          if (context.domainId) context.domain = results[0];
          else context.domains = results;
        }
        resolve(context);
      });
    });
  },

  queryHosts: function (context) {
    if (context.host || context.hosts) return context;

    return new Promise((resolve) => {
      var query = { shallow: true };
      if (context.hostId) {
        query.id = context.hostId;
        query.shallow = false;
      }
      if (context.modified) query.modified = context.modified;
      if (context.modifiedStart) query.modifiedStart = context.modifiedStart;
      if (context.modifiedEnd) query.modifiedEnd = context.modifiedEnd;
      if (!_.isNil(query.ids) && _.isEmpty(query.ids)) return resolve(context);
      app.ws.query("hosts", query, (status, results) => {
        if (status == Ws.Status.SUCCESS) {
          if (context.hostId) context.host = results[0];
          else context.hosts = results;
        }
        resolve(context);
      });
    });
  },

  queryTxns: function (context) {
    if (context.txn || context.txns) return context;

    return new Promise((resolve) => {
      var query = {
        shallow: _.isNil(context.shallow) ? true : context.shallow,
        sort: { _id: -1 }
      };
      if (context.txnId) {
        query.id = context.txnId;
        query.shallow = false;
      } else {
        if (context.txnIdStart) {
          query.idStart = context.txnIdStart;
        }
        if (context.txnIdEnd) {
          query.idEnd = context.txnIdEnd;
        }
        if (context.modified) query.modified = context.modified;
        if (context.modifiedStart) query.modifiedStart = context.modifiedStart;
        if (context.modifiedEnd) query.modifiedEnd = context.modifiedEnd;
        if (context.host && context.host._id) {
          query.hostId = context.host._id;
        } else if (context.hostId) {
          query.hostId = context.hostId;
        }
        if (context.execution && context.execution._id) {
          query.executionId = context.execution._id;
        } else if (context.executionId) {
          query.executionId = context.executionId;
        }
      }
      if (!_.isNil(query.ids) && _.isEmpty(query.ids)) return resolve(context);
      app.ws.query("txns", query, (status, results) => {
        if (status == Ws.Status.SUCCESS) {
          if (context.txnId) context.txn = results[0];
          else context.txns = results;
        }
        resolve(context);
      });
    });
  },

  queryRuns: function (context) {
    return new Promise((resolve) => {
      var query = { shallow: _.isNil(context.shallow) ? true : context.shallow };
      if (context.domainId) {
        query.domainId = context.domainId;
      }
      if (context.runId) {
        query.id = context.runId;
        query.shallow = false;
      } else if (context.runIds) {
        query.ids = context.runIds;
      }
      if (context.runStatus) {
        query.status = context.runStatus;
      }
      if (context.modified) query.modified = context.modified;
      if (context.modifiedStart) query.modifiedStart = context.modifiedStart;
      if (context.modifiedEnd) query.modifiedEnd = context.modifiedEnd;
      if (!_.isNil(query.ids) && _.isEmpty(query.ids)) return resolve(context);
      app.ws.query("runs", query, (status, results) => {
        if (status == Ws.Status.SUCCESS) {
          if (context.runId && !context.run) context.run = results[0];
          else if (!context.runs) context.runs = results;
        }
        resolve(context);
      });
    });
  },

  queryExecutions: function (context) {
    if (context.execution || context.executions) return context;

    return new Promise((resolve) => {
      var query = {
        shallow: _.isNil(context.shallow) ? true : context.shallow,
        limit: data.config.def_limit,
        sort: { modified: -1 }
      };
      if (context.domainId) {
        query.domainId = context.domainId;
      }
      if (context.executionId) {
        query.id = context.executionId;
        query.shallow = false;
      } else if (context.executionIds) {
        query.ids = context.executionIds;
      } else if (context.txn && context.txn.executionId) {
        query.id = context.txn.executionId;
      }
      if (context.runId) {
        query.runId = context.runId;
        query.limit = 300;
      } else if (context.runIds) {
        query.runIds = context.runIds;
      }
      if (context.modified) query.modified = context.modified;
      if (context.modifiedStart) query.modifiedStart = context.modifiedStart;
      if (context.modifiedEnd) query.modifiedEnd = context.modifiedEnd;
      if (!_.isNil(query.runIds) && _.isEmpty(query.runIds)) return resolve(context);
      if (!_.isNil(query.ids) && _.isEmpty(query.ids)) return resolve(context);
      app.ws.query("executions", query, (status, results) => {
        if (status == Ws.Status.SUCCESS) {
          if (query.id && results.length == 1) {
            context.execution = results[0];
          } else context.executions = results;
        }
        resolve(context);
      });
    });
  },

  queryIssues: function (context) {
    if (context.issue || context.issues) return context;

    return new Promise((resolve) => {
      var query = { shallow: _.isUndefined(context.shallow) ? true : context.shallow };
      if (context.issueId) {
        query.id = context.issueId;
        query.shallow = false;
      } else if (context.runId) {
        query.runId = context.runId;
      } else if (context.run) {
        query.runId = context.run._id;
      } else if (context.execution) {
        query.ids = context.execution.issues || [];
      }
      if (context.modified) query.modified = context.modified;
      if (context.modifiedStart) query.modifiedStart = context.modifiedStart;
      if (context.modifiedEnd) query.modifiedEnd = context.modifiedEnd;
      if (!_.isNil(query.ids) && _.isEmpty(query.ids)) return resolve(context);
      app.ws.query("issues", query, (status, results) => {
        if (status == Ws.Status.SUCCESS) {
          if (context.execution) results.sort((a, b) => {
            return context.execution.issues.indexOf(a._id) -
                   context.execution.issues.indexOf(b._id);
          });
          if (context.issueId && results.length > 0) context.issue = results[0];
          else context.issues = results;
        }
        resolve(context);
      });
    });
  },

  queryScenarios: function (context) {
    return new Promise((resolve) => {
      var query = { shallow: true };
      if (context.scenarioId) {
        query.id = context.scenarioId;
        query.shallow = false;
      }
      if (!_.isNil(query.ids) && _.isEmpty(query.ids)) return resolve(context);
      app.ws.query("scenarios", query, (status, results) => {
        if (status == Ws.Status.SUCCESS) {
          if (context.scenarioId) context.scenario = results[0];
          else context.scenarios = results;
        }
        resolve(context);
      });
    });
  },

  queryTests: function (context) {
    if (context.test || context.tests) return context;

    return new Promise((resolve) => {
      var query = { shallow: true, limit: 500 };
      if (context.testId) {
        query.id = context.testId;
        query.shallow = false;
      } else if (context.scenario) {
        query.ids = context.scenario.tests || [];
      }
      if (!_.isNil(query.ids) && _.isEmpty(query.ids)) return resolve(context);
      app.ws.query("tests", query, (status, results) => {
        if (status == Ws.Status.SUCCESS) {
          if (context.scenario) results.sort((a, b) => {
            return context.scenario.tests.indexOf(a._id) -
                   context.scenario.tests.indexOf(b._id);
          });
          if (context.testId && results.length > 0) context.test = results[0];
          else context.tests = results;
        }
        resolve(context);
      });
    });
  },

  queryAssets: function (context) {
    if (context.asset || context.assets) return context;

    return new Promise((resolve, reject) => {
      var query = { shallow: true, limit: 500 };
      if (context.domainId) {
        query.domainId = context.domainId;
      }
      if (context.assetId) {
        query.id = context.assetId;
        query.shallow = false;
      } else if (context.assetIds) {
        query.ids = context.assetIds;
      }
      if (!_.isNil(query.ids) && _.isEmpty(query.ids)) return resolve(context);
      app.ws.query("assets", query, (status, results) => {
        if (status == Ws.Status.SUCCESS) {
          if (context.assetId) context.asset = results[0];
          else context.assets = results;
          console.log("Olha os resultados\n" + context.assets[0]);
        }
        resolve(context);
      });
    });
  },

  normalizeHosts: function (context) {
    if (context.host) normalize(context.host);
    _.forEach(context.hosts, normalize);

    function normalize (host) {
      host.name = host.name || host.description;
    }

    return context;
  },

  normalizeTxns: function (context) {
    if (context.txn) normalize(context.txn);
    _.forEach(context.txns, normalize);

    function normalize (txn) {
      if (!txn.instant && txn.request) txn.instant = txn.request.instant;
      if (txn.request && txn.request.instant && txn.response && txn.response.instant) {
        txn.totalTime = new Date(txn.response.instant) - new Date(txn.request.instant);
      }
      if (txn.decodeTime && txn.processTime) txn.internalTime = txn.decodeTime + txn.processTime;
      /* This is local only */
      if (txn.log) {
        var log_parse = [];
        _.forEach(txn.log, (str) => log_parse.push({ level: str.split(":")[0], message: str.substr(str.indexOf(":") + 1) }));
        txn.log = log_parse;
      }
    }

    return context;
  },

  normalizeExecutions: function (context) {
    if (context.execution) normalize(context.execution);
    _.forEach(context.executions, normalize);

    function normalize (execution) {
      execution.test._currGoal = 0;
      execution.test._userGoals = [];
      execution.test._dataGoals = [];
      _.forEach(execution.test.goals, (goal, idx) => {
        goal._idx = idx;
        if (goal.type == "user_input") {
          if (execution.test._currGoal == idx) {
            execution.test._currGoal++;
          }
          execution.test._userGoals.push(goal);
          goal.choices = goal.choices || [];
        } else if (goal.type == "txn_inbound") {
          if (execution.test._currGoal == idx && goal.txnId) {
            execution.test._currGoal++;
          }
          execution.test._dataGoals.push(goal);
          goal._totalCount = 0;
          goal._passCount = 0;
          goal._failCount = 0;
          _.forEach(goal.request.validations, (validation) => {
            if (validation.result == "pass") goal._passCount++;
            else if (validation.result == "fail") goal._failCount++;
            goal._totalCount++;
          });
        } else if (goal.type == "txn_outbound") {
          if (execution.test._currGoal == idx && goal.txnId) {
            execution.test._currGoal++;
          }
          execution.test._dataGoals.push(goal);
          goal._totalCount = 0;
          goal._passCount = 0;
          goal._failCount = 0;
          _.forEach(goal.response.validations, (validation) => {
            if (validation.result == "pass") goal._passCount++;
            else if (validation.result == "fail") goal._failCount++;
            goal._totalCount++;
          });
          if (_.isNil(goal.txnId)) done = false;
        } else if (goal.type == "card_validation") {
          if (execution.test._currGoal == idx && goal.card) {
            execution.test._currGoal++;
          }
          execution.test._dataGoals.push(goal);
          goal._totalCount = 0;
          goal._passCount = 0;
          goal._failCount = 0;
          _.forEach(goal.validations, (validation) => {
            if (validation.result == "pass") goal._passCount++;
            else if (validation.result == "fail") goal._failCount++;
            goal._totalCount++;
          });
        }
      });
    }

    return context;
  },

  normalizeTest: function (context) {
    if (context.test) normalize(context.test);
    _.forEach(context.tests, normalize);

    function normalize (test) {
      _.forEach(test.goals, (goal, idx) => {
        goal.idx = idx;
        if (goal.type == "user_input") {
          goal.options_type = goal.options_type || "radio";
          if (goal.comment == true) {
            goal.allow_comment = true;
            delete goal.comment;
          }
          goal.require_comment = goal.require_comment || false;
        }
        if (goal.type == "card_validation") {
          _.forEach(goal.validations, (validation) => {
            validation.responseType = validation.responseType || "static";
          });
        }
      });
    }

    return context;
  },

  collectAssetIds: function (context) {
    context.assetIds = context.assetIds || [];

    if (context.host) collect(context.host);
    _.forEach(context.hosts, collect);
    if (context.test) collect(context.test);
    _.forEach(context.tests, collect);

    function collect (obj) {
      _.forEach(obj.assets, (id) => {
        if (id && context.assetIds.indexOf(id) == -1) {
          context.assetIds.push(id);
        }
      });
    }

    return context;
  },

  inflateTxns: function (context) {
    if (context.txn) inflate(context.txn);
    _.forEach(context.txns, inflate);

    function inflate (txn) {
      txn.host = _.find(context.hosts || [ context.host ], { _id: txn.hostId });
    }

    return context;
  },

  inflateExecutions: function (context) {
    if (context.execution) inflate(context.execution);
    _.forEach(context.executions, inflate);

    function inflate (execution) {
      _.forEach(execution.test.assets, (asset, type) => {
        if (asset) asset.type = type;
        else execution.test.assets[type] = { type: type };
      });
      _.forEach(execution.test.goals, (goal) => {
        if (goal.txnId) goal.txn = _.find(context.txns, { _id: goal.txnId });
      });
    }

    return context;
  },

  inflateTestAssets: function (context) {
    if (context.test) inflate(context.test);
    _.forEach(context.tests, inflate);

    function inflate (test) {
      var assets = {};
      _.forEach(test.assets, (id, type) => {
        assets[type] = _.find(context.assets, { _id: id }) || { _id: null, type: type };
      });
      test.assets = assets;
    }

    return context;
  },

  preparePresentation: function (context) {
    if (context.execution) prepareTest(context.execution.test);

    function prepareTest (test) {
      var properties = {};
      _.forEach(test.assets, (asset, type) => {
        _.forEach(asset.properties, (value, key) => properties[type + "." + key] = value);
      });
      test.description = resolveValue(test.description, properties);
      _.forEach(test.goals, (goal) => {
        goal.description = resolveValue(goal.description, properties);
      });
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
          return name + "?!";
        });
      }

      var result = value;
      while (result.search(expr) >= 0) {
        result = pass(result, properties);
      }
      return result;
    }

    return context;
  }
}

app.ctrls = {

  signIn: function (render) {

    render({
      language: data.language,
      username: data.username
    });

    var $content = $("#content");

    $content.on("change", ".js-language", function (ev) {
      app.state.setLanguage($(this).val());
      app.state.save();
      app.ui.goToSignIn();
    });

    $content.on("click", ".js-signin", function (ev) {

      var $username = $("#username");
      var $password = $("#password");

      var username = $username.val();
      var password = $password.val();

      if (_.isEmpty(username)) {
        $username.parents(".form-group").addClass("has-error");
        return;
      } else $username.parents(".form-group").removeClass("has-error");

      if (_.isEmpty(password)) {
        $password.parents(".form-group").addClass("has-error");
        return;
      } else $password.parents(".form-group").removeClass("has-error");

      $("#login").removeClass("animated bounceIn bounceOut shake");

      app.session.signIn(username, password, (status) => {
        if (status == Ws.Status.SUCCESS) {
          $("#login").addClass("animated bounceOut");
          app.ui.goToMain();
        } else {
          $("#login").addClass("animated shake");
          if (status == Ws.Status.NOT_FOUND) app.ui.error(app.ui.locals.user_not_found, app.ui.locals.signin);
          else app.ui.error(app.ui.locals.password_mismatch, app.ui.locals.signin);
        }
      });
    });

    $("#login").keydown(function (ev) {
      if (ev.keyCode == 13) {
        $content.find(".js-signin").click();
      }
    });
  },

  base: function (render) {

    app.ui.base.changeDomain = function (id) {
      app.state.setDomainId(id);
      app.state.save();

      load().then(updateHeaderMenu);
      app.ui.base.toolbar.close();
    }

    var $container = $("#container");

    load().then(view);

    function load () {
      return Promise.resolve({
        domainId: data.domainId,
        domainName: data.domainName,
        accessLevel: data.accessLevel,
        show: {
          hostsNav: data.accessLevel != "guest" &&
                 data.accessLevel != "scope",
          executionsNav: data.accessLevel != "scope",
          testsNav: data.accessLevel != "guest",
          assetsNav: data.accessLevel != "guest"
        },
        username: data.username.split("@")[0] + "@...",
        permissions: data.permissions
      });
    }

    function view (context) {
      render(context);
      if (window.location.hash.slice(1).length <= 1) app.route.goToDefaultNav();
      else app.route.goTo();
    }

    function updateHeaderMenu (context) {
      $container.find("#header-menu").html(render(context, "header-menu"));
    }

    $container.on("click", ".js-select-domain", function (ev) {
      var $domain = $(this).parents(".domain");
      var id = $domain.attr("data-id");
      app.ui.base.changeDomain(id);
      app.route.goToDefaultNav();
    });

    $container.on("click", ".js-open-vpay", function (ev) {
      app.ui.base.modal.load("vpay-connector-modal.html", {}, (modalRenderer) => app.ctrls.vpayModal(modalRenderer, null));
      ev.preventDefault();
    });

    $container.on("click", ".js-signout", function (ev) {
      app.session.signOut(function (status) {
        window.location.hash = "";
        app.ui.goToSignIn();
      });
    });

    $container.on("click", function (ev) {
      // Note: Event delegation won't work for removed elements.
      var $el = $(ev.target);
      if ($el.attr("href") == "#" || $el.parents("a").attr("href") == "#") {
        ev.preventDefault();
      }
    });

    $container.on("click", "a[href!='#']", function (ev) {
      var href = $(this).attr("href");
      if (app.ui.base.confirmChanges) {
        app.ui.base.modal.load("confirm-modal.html", {}, (modalRenderer) => app.ctrls.confirmModal(modalRenderer, {
          title: app.ui.locals.save_changes.title,
          message: app.ui.locals.save_changes.message,
          confirm: app.ui.locals.discard,
          cancel: app.ui.locals.cancel,
          onconfirm: () => {
            app.ui.base.confirmChanges = false;
            app.route.goTo(href.substr(1));
          },
          oncancel: () => {
          }
        }));
        ev.preventDefault();
      }
    });

    $container.on("click", ".js-todo", function (ev) {
      app.ui.base.modal.load("confirm-modal.html", {}, (modalRenderer) => app.ctrls.confirmModal(modalRenderer, {
        title: "Ooops!",
        message: app.ui.locals.feature_not_ready,
        confirm: "Ok",
        onconfirm: () => {
        },
        oncancel: () => {
        }
      }));
      ev.preventDefault();
    });

    $container.on("wserror", function (ev, response) {
      if (response.status == Ws.Status.INVALID_LOGIN) {
        data.sessionId = null;
        app.state.save();
        app.ui.goToSignIn();
      }
    });

    setInterval(function () {

      $container.find("span.ellapsed").each(function () {
        var $el = $(this);
        var time = $el.attr("data-time");
        if (time) $el.text(moment(time).fromNow(false));
      });

    }, 15000);

    var updateInterval = setInterval(function () {
      if (typeof document.hidden == "undefined" ||
          document.hidden == false) {
        $("#toolbar").trigger("update");
        $("#content").trigger("update");
        $("#modal").trigger("update");
      }
    }, data.config.update_interval);
  },

  domain: function (render, params) {

    var $content = $("#content");

    load({ domainId: params.id });

    function load (context) {

      Promise.resolve(_.assignIn({
        domainId: data.domainId
      }, context))
        .then(app.context.queryDomains)
        .then(view);
    }

    function view (context) {
      render(context);

      app.ui.base.content.header.sticky(true);
    }

    $content.on("click", ".js-edit-report", function (ev) {
      var $report = $(this).parents(".report");
      app.ws.query("domains", { id: params.id }, (status, results) => {
        if (status != Ws.Status.SUCCESS || _.isEmpty(results)) return app.ui.error(app.ui.locals.data_not_found, app.ui.locals.domain);
        var idx = Number($report.attr("data-idx"));
        var report = results[0].reports[idx];
        report.idx = idx;
        edit(report);
      });
      function edit (report) {
        app.ui.base.modal.load("report-modal.html", {}, (renderModal) => app.ctrls.reportModal(renderModal, {
          report: report,
          onsave: saveReport
        }));
      }
      function saveReport (report) {
        app.ws.refresh("domains", params.id, (domain) => {
          domain.reports[report.idx] = {
            name: report.name,
            style: report.style,
            script: report.script,
            template: report.template
          }
        }, (status) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.domain);
          app.ui.success(app.ui.locals.success_update_data, app.ui.locals.domain);
          //$report.replaceWith(render(report, "report"));
        });
      }
    });
  },

  hosts: function (render, params) {
    var $content = $("#content");
    var ready = false;

    if (!app.state.hasExecPermissions()) {
      app.ui.error(app.ui.locals.error_check_permissions, app.ui.locals.hosts);
      return app.route.goToDefaultNav();
    }
    load().then(view);

    function load (context) {
      return Promise.resolve(_.assignIn({
        hostId: params.host,
        host: null,
        hosts: null,
        assetIds: null,
        assets: app.state.hasCreatePermissions ? null : [],
        txns: null,
        modifiedStart: null,
        show: {
          createCtrls: app.state.hasCreatePermissions()
        }
      }, context))
        .then(app.context.queryHosts)
        .then(app.context.normalizeHosts)
        .then(app.context.collectAssetIds)
        .then(app.context.queryAssets)
        .then(app.context.queryTxns)
        .then(app.context.inflateTxns)
        .then(app.context.normalizeTxns);
    }

    function view (context) {
      if (params.host && context.host) context.host._viewDetails = true;

      render(context);

      app.ui.base.content.header.sticky(true);
      $content.find(".hosts").panels({ maxcolumns: 4 });
      $content.find(".assets").panels({ maxcolumns: 3 });
      $content.find(".animate-panel").animatePanel();

      if (context.txns.length < data.config.def_limit) {
        $content.find(".js-more-txn").parents(".list-group-item").remove();
      }

      ready = new Date();
    }

    function update (context) {

      load(_.assignIn({
        modifiedStart: app.ui.queryLastModified(".host, .txn") || ready
      }, context)).then((context) => {
        if (params.host && context.host) context.host._viewDetails = true;

        console.log(context);

        updateHosts(context);
        if (context.host) {
          updateAssets(context.assets);
          updateRules(context.host.rules);
        }
        updateTxns(context);
      });
    }

    function updateHosts (context) {
      var hosts = context.hosts || [];
      if (context.host) hosts.push(context.host);

      var markup = "";

      _.forEach(hosts, (obj) => {
        var elmarkup = render(_.assignIn({
	show: {
          createCtrls: app.state.hasCreatePermissions()
        }}, obj), "host");
        var $oldel = $content.find(".host[data-id='" + obj._id + "']");
        if ($oldel.length > 0) $oldel.replaceWith($(elmarkup));
        else markup += elmarkup;
      });

      if (!_.isEmpty(markup)) {
        $(markup).appendTo($content.find(".hosts"));
        $content.find(".hosts").panels({ maxcolumns: 4 });
      }
    }

    function updateAssets (assets) {
      $content.find(".assets .asset").remove();
      _.forEach(assets, (asset) => {
        $(render(asset, "asset")).insertBefore($content.find(".add-asset"));
      });
      $content.find(".assets").panels({ maxcolumns: 3 });
    }

    function updateRules (rules) {
      $content.find(".rules .rule").remove();
      _.forEach(rules, (rule) => {
        $(render(rule, "rule")).insertBefore($content.find(".add-rule"));
      });
    }

    function updateTxns (context) {
      var txns = context.txns || [];

      var markup = "";

      _.forEach(txns, (obj) => {
        var elmarkup = render(obj, "txn");
        var $oldel = $content.find(".txn[data-id='" + obj._id + "']");
        if ($oldel.length > 0) $oldel.replaceWith($(elmarkup));
        else markup += elmarkup;
      });

      if (!_.isEmpty(markup)) {
        $(markup).prependTo($content.find(".txns"));
      }
    }

    $content.on("update", function (ev) {
      if (ready) update();
    });

    $content.on("click", ".js-toggle-host", function (ev) {
      var $host = $(this).parents(".host");
      app.ws.refresh("hosts", $host.attr("data-id"), (host) => {
        host.enabled = !host.enabled;
      }, (status, result) => {
        if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.host);
        update({ host: result });
      });
    });

    $content.on("click", ".js-toggle-chain", function (ev) {
      var $host = $(this).parents(".host");
      app.ws.refresh("hosts", $host.attr("data-id"), (host) => {
        if (!host.chain || _.isEmpty(host.chain.address)) return app.ui.error(app.ui.locals.chain_not_configured, app.ui.locals.host);
        host.chain.enabled = !host.chain.enabled;
      }, (status, result) => {
        if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.host);
        update({ host: result });
      });
    });

    $content.on("click", ".js-unlink-asset", function (ev) {
      var $asset = $(this).parents(".asset");
      var id = $asset.attr("data-id");
      app.ws.refresh("hosts", params.host, (host) => {
        var index = _.indexOf(host.assets, id);
        if (index < 0) return false;
        host.assets.splice(index, 1);
      }, (status, result) => {
        if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.host);
        update({ host: result});
      });
    });

    $content.on("click", ".js-link-asset", function (ev) {
      var $asset = $(this).parents(".asset");
      app.ui.base.modal.load("select-modal.html", {}, (renderModal) => app.ctrls.selectModal(renderModal, {
        collection: "assets",
        onitem: (asset) => ({ _id: asset._id, description: asset.description }),
        onselect: linkAsset
      }));
      function linkAsset (id) {
        app.ws.refresh("hosts", params.host, (host) => {
          host.assets = host.assets || [];
          if (host.assets.indexOf(id) >= 0) return app.ui.warn(app.ui.locals.warn_already_added, app.ui.locals.host);
          host.assets.push(id);
        }, (status, result) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_insert_data, app.ui.locals.host);
          update({ host: result });
        });
      }
    });

    $content.on("click", ".js-add-rule", function (ev) {
      app.ui.base.modal.load("rule-modal.html", {}, (renderModal) => app.ctrls.ruleModal(renderModal, {
        onsave: addRule
      }));
      function addRule (rule) {
        app.ws.refresh("hosts", params.host, (host) => {
          host.rules = host.rules || [];
          rule.idx = host.rules.length;
          host.rules.push(_.omit(rule, "idx"));
        }, (status, result) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_insert_data, app.ui.locals.host);
          update({ host: result });
        });
      }
    });

    $content.on("click", ".js-edit-rule", function (ev) {
      var $rule = $(this).parents(".rule");
      var idx = Number($rule.attr("data-idx"));
      app.ws.query("hosts", { id: params.host }, (status, results) => {
        if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.data_not_found, app.ui.locals.run);
        editRule(results[0].rules[idx]);
      });
      function editRule (rule) {
        app.ui.base.modal.load("rule-modal.html", {}, (renderModal) => app.ctrls.ruleModal(renderModal, {
          edit: rule,
          onsave: saveRule
        }));
      }
      function saveRule (rule) {
        app.ws.refresh("hosts", params.host, (host) => {
          host.rules[idx] = _.omit(rule, "idx");
        }, (status, result) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_insert_data, app.ui.locals.host);
          update({ host: result });
        });
      }
    });

    $content.on("click", ".js-move-up-rule", function (ev) {
      var $rules = $(this).parents(".rules").find(".rule");
      var $rule = $(this).parents(".rule");
      if ($rules.index($rule) > 0) {
        app.ws.refresh("hosts", params.host, (host) => {
          var idx = Number($rule.attr("data-idx"));
          var rule = host.rules[idx];
          host.rules[idx] = host.rules[idx - 1];
          host.rules[idx - 1] = rule;
        }, (status, result) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.host);
          update({ host: result.rules });
        });
      }
    });

    $content.on("click", ".js-move-down-rule", function (ev) {
      var $rules = $(this).parents(".rules").find(".rule");
      var $rule = $(this).parents(".rule");
      if ($rules.index($rule) < $rules.length - 1) {
        app.ws.refresh("hosts", params.host, (host) => {
          var idx = Number($rule.attr("data-idx"));
          var rule = host.rules[idx];
          host.rules[idx] = host.rules[idx + 1];
          host.rules[idx + 1] = rule;
        }, (status, result) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.host);
          update({ host: result });
        });
      }
    });

    $content.on("click", ".js-remove-rule", function (ev) {
      var $rule = $(this).parents(".rule");
      var idx = Number($rule.attr("data-idx"));
      app.ui.base.modal.load("confirm-modal.html", {}, (modalRenderer) => app.ctrls.confirmModal(modalRenderer, {
        title: app.ui.locals.confirm_remove.title,
        message: app.ui.locals.confirm_remove.message + "\n\n" +
                 $rule.find(".data-name").text(),
        confirm: app.ui.locals.remove,
        cancel: app.ui.locals.cancel,
        onconfirm: removeRule
      }));
      function removeRule () {
        app.ws.refresh("hosts", params.host, (host) => {
          host.rules.splice(idx, 1);
        }, (status, result) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.host);
          update({ host: result });
        });
      }
    });

    $content.on("click", ".js-view-txn", function (ev) {
      var $txn = $(this).parents(".txn");
      app.ui.base.modal.load("txn-modal.html", {}, (renderModal) => app.ctrls.txnModal(renderModal, {
        txnId: $txn.attr("data-id")
      }));
    });

    $content.on("click", ".js-more-txn", function (ev) {
      var $item = $(this).parents(".list-group-item");
      var last = $content.find(".txn:last").attr("data-id");

      $item.addClass("animated fadeOut");

      load({ txnIdStart: last }).then((context) => {

        var html = "";
        _.forEach(context.txns, (txn) => {
          if (txn._id == last) return;
          html += render(txn, "txn");
        });
        $(html).insertBefore($item);

        if (context.txns.length < data.config.def_limit) {
          $item.remove();
        }
      });
    });
  },

  executions: function (render, params) {
    var $content = $("#content");
    var ready = false;

    if (!app.state.hasGuestPermisssion() &&
        !app.state.hasExecPermissions()) {
      app.ui.error(app.ui.locals.error_check_permissions, app.ui.locals.executions);
      return app.route.goToDefaultNav();
    }

    var grantRunIds = [];

    if (data.grants) {
      for (var grantIdx = 0; grantIdx < data.grants.length; grantIdx++) {
        let grant = data.grants[grantIdx];
        if (grant.type == "run") grantRunIds.push(grant.id);
      }
    }

    load().then(view);

    function load (context) {

      return Promise.resolve(_.assignIn({
        domainId: data.domainId,
        domain: null,
        runIds: !params.run && app.state.hasGuestPermisssion() ? grantRunIds : undefined,
        runId: params.run,
        issues: !params.run ? [] : undefined,
        run: null,
        runs: null,
        executions: null,
        show: {
          createCtrls: app.state.hasCreatePermissions()
        }
      }, context))
        .then(app.context.queryDomains)
        .then(app.context.queryRuns)
        .then(app.context.queryIssues)
        .then(app.context.queryExecutions);
    }

    function view (context) {
      render(context);

      createOverviewChart();
      if (context.run) {
        createEvoChart();
        organizeViewByScenario();
      }

      app.ui.base.content.header.sticky(true);
      $content.find(".runs").panels({ maxcolumns: 3 });
      $content.find(".animate-panel").animatePanel();

      if (context.excutions && (context.executions.length < data.config.def_limit)) {
        $content.find(".js-more-execution").parents(".list-group-item").remove();
      }

      ready = new Date();
    }

    function update (context) {

      load(_.assignIn({
        modifiedStart: app.ui.queryLastModified(".run, .issue, .execution") || ready
      }, context)).then((context) => {

        updateRuns(context);
        updateIssues(context);
        updateExecutions(context);
      });
    }

    function updateRuns (context) {
      var runs = context.runs || [];
      if (context.run) runs.push(context.run);

      var markup = "";

      _.forEach(runs, (obj) => {
        var elmarkup = render(obj, "run");
        var $oldel = $content.find(".run[data-id='" + obj._id + "']");
        if ($oldel.length > 0) {
          var $newel = $(elmarkup);
          $oldel.replaceWith($newel);
          createOverviewChart($newel);
        } else markup += elmarkup;
      });

      if (!_.isEmpty(markup)) {
        var $els = $(markup);
        $els.appendTo($content.find(".runs"));
        $content.find(".runs").panels({ maxcolumns: 3 });
        createOverviewChart($els);
      }
    }

    function updateIssues (context) {
      var issues = context.issues || [];

      var markup = "";

      _.forEach(issues, (obj) => {
        var elmarkup = render(obj, "issue");
        var $oldel = $content.find(".issue[data-id='" + obj._id + "']");
        if ($oldel.length > 0) {
          var $newel = $(elmarkup);
          $oldel.replaceWith($newel);
        } else markup += elmarkup;
      });

      if (!_.isEmpty(markup)) {
        var $els = $(markup);
        $els.appendTo($content.find(".issues"));
      }
    }

    function updateExecutions (context) {
      var executions = context.executions || [];

      var markup = "";

      _.forEach(executions, (obj) => {
        var elmarkup = render(_.assignIn({ domainId: data.domainId }, obj), "execution");
        var $model = $content.find(".execution[data-id='" + obj._id + "']");
        if ($model.length > 0) $model.replaceWith($(elmarkup));
        else markup += elmarkup;
      });

      if (!_.isEmpty(markup)) {
        $(markup).prependTo($content.find(".executions"));
        if (params.run) {
          createEvoChart();
          organizeViewByScenario();
        }
      }
    }

    function createOverviewChart ($els) {
      ($els || $content.find(".run")).each(function () {
        var $el = $(this);
        new Chart($el.find(".js-stats-chart"), {
          type: "doughnut",
          data: {
            labels: [
              app.ui.locals["execution-result"]["pass"],
              app.ui.locals["execution-result"]["skipped"],
              app.ui.locals["execution-result"]["impact"],
              app.ui.locals["execution-result"]["fail"] ],
            datasets: [{
                data: [
                  $el.attr("data-pass"),
                  $el.attr("data-skipped"),
                  $el.attr("data-impact"),
                  $el.attr("data-fail") ],
                backgroundColor: [
                  "#62cb31",
                  "#e67e22",
                  "#ffb606",
                  "#c0392b" ]
            }]
          },
          options: {
            responsive: false,
            legend: {
              position: "left"
            }
          }
        });
      });
    }

    function createEvoChart () {
      var executions = [];
      var dates = [];
      var executed = [];
      var evolution = [];

      $content.find(".execution").each(function () {
        executions.push(new Date($(this).attr("data-modified")));
      });

      executions.sort().forEach((execution) => {
        var date = execution.toLocaleDateString();
        var index = dates.indexOf(date);
        if (index >= 0) {
          executed[index] += 1;
          evolution[index] += 1;
        } else {
          dates.push(date);
          executed.push(1);
          evolution.push(evolution.length > 0 ? evolution[evolution.length - 1] + 1 : 1);
        }
      });

      new Chart($content.find(".run .js-evo-chart"), {
        type: 'bar',
        data: {
          datasets: [{
                label: app.ui.locals["execution"],
                data: executed,
                fill: false,
                backgroundColor: "rgba(54, 162, 235, 0.2)",
                borderColor: "rgba(54, 162, 235, 0.2)",
                borderWidth: 1
              }, {
                type: 'line',
                label: app.ui.locals["evolution"],
                data: evolution,
                fill: false,
                borderColor: "rgb(75, 192, 192)",
                lineTension: 0.1
              }],
          labels: dates
        },
        options: {
          responsive: false,
          legend: {
            position: "left"
          },
          scales: {
            yAxes: [{
              ticks: {
                beginAtZero: true,
                callback: (value) => { if (value % 1 === 0) { return value; } }
              }
            }]
          }
        }
      });
    }

    function organizeViewByScenario () {
      var scenarios = [];

      $content.find(".execution").each(function () {
        var $execution = $(this);
        var name = $execution.attr("data-scenario");
        var sequence = $execution.attr("data-sequence");

        if (!_.isEmpty(name + sequence)) {
          var scenario = _.find(scenarios, { name: name });
          if (!scenario) {
            scenario = { name: name };
            scenarios.push(scenario);
          }
        }
      });

      _.forEach(_.sortBy(scenarios, "name"), (scenario) => {
        var $parent = $content.find(".scenario[data-name='" + scenario.name + "']");
        if ($parent.length <= 0) $parent = $(render(scenario, "scenario"));
        $parent.appendTo($content.find(".executions"));
        var $sibling = $parent;
        var $children = $content.find(".execution[data-scenario='" + scenario.name + "']");
        $(_.sortBy($children, (el) => $(el).attr("data-sequence"))).insertAfter($parent);
      });
      
      $content.find(".js-more-execution").parents(".list-group-item").remove();
    }

    $content.on("update", function (ev) {
      if (ready) update();
    });

    $content.on("input", ".js-search", function (ev) {
      if (this.to) clearTimeout(this.to);
      this.to = setTimeout(() => {
        var search = $(this).val();
        if (search.trim()) {
          $content.find(".run").hide();
          $content.find(".run").filter((idx, el) => $(el).text().includes(search)).show();
          $content.find(".runs").panels({ maxcolumns: 3 });
          $content.find(".issue").hide();
          $content.find(".issue").filter((idx, el) => $(el).text().includes(search)).show();
          $content.find(".execution").hide();
          $content.find(".execution").filter((idx, el) => $(el).text().includes(search)).show();
        } else {
          $content.find(".run").show();
          $content.find(".runs").panels({ maxcolumns: 3 });
          $content.find(".issue").show();
          $content.find(".execution").show();
        }
      }, 750);
    });

    $content.on("click", ".js-create-run", function (ev) {
      app.ui.base.modal.load("run-modal.html", {}, (renderModal) => app.ctrls.runModal(renderModal, {
        edit: true,
        onsave: saveRun
      }));
      function saveRun (run) {
        app.ws.insert("runs", {
          status: run.status,
          name: run.name,
          description: run.description
        }, (status) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.run);
          app.ui.success(app.ui.locals.success_update_data, app.ui.locals.test);
          app.route.goTo();
        });
      }
    });

    $content.on("click", ".js-edit-run", function (ev) {
      var $run = $(this).parents(".run");
      return function loadRun () {
        app.ws.query("runs", { id: $run.attr("data-id") }, (status, results) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.data_not_found, app.ui.locals.run);
          return showRun(results[0]);
        });
      }();
      function showRun (run) {
        app.ui.base.modal.load("run-modal.html", {}, (renderModal) => app.ctrls.runModal(renderModal, {
          edit: run,
          onsave: saveRun
        }));
      }
      function saveRun (run) {
        app.ws.update("runs", { id: $run.attr("data-id") }, {
          status: run.status,
          name: run.name,
          description: run.description
        }, (status) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.run);
          app.ui.success(app.ui.locals.success_update_data, app.ui.locals.test);
          app.route.goTo();
        });
      }
    });

    $content.on("click", ".js-remove-run", function (ev) {
      var $run = $(this).parents(".run");
      app.ui.base.modal.load("confirm-modal.html", {}, (modalRenderer) => app.ctrls.confirmModal(modalRenderer, {
        title: app.ui.locals.confirm_remove.title,
        message: app.ui.locals.confirm_remove.message + "\n\n" +
                 $run.find(".js-name").text() + "\n\n" +
                 app.ui.locals.confirm_remove.siblings,
        confirm: app.ui.locals.remove,
        cancel: app.ui.locals.cancel,
        onconfirm: removeRun
      }));
      function removeRun () {
        app.ws.delete("runs", $run.attr("data-id"), (status, response) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_remove_data, app.ui.locals.test);
          app.ui.success(app.ui.locals.success_remove_data, app.ui.locals.test);
          app.route.goTo("/executions");
        });
      }
    });

    $content.on("click", ".js-gen-report", function (ev) {
      var $report = $(this).parents(".report");

      // It has to be here stil inside event's closure.
      var reportWindow = window.open("report.html");

      Promise.resolve({
        shallow: false,
        domainId: data.domainId,
        domain: null,
        runId: params.run,
        run: null,
        issues: null,
        executions: null
      }).then(app.context.queryDomains)
        .then(app.context.queryRuns)
        .then(app.context.queryIssues)
        .then(app.context.queryExecutions)
        .then(create);

      function create (context) {
        var report = context.domain.reports[$report.attr("data-idx")];
        var reportCtx = _.pick(context, ["run", "issues", "executions"]);

        $(reportWindow.document).ready(function (ev) {
          reportWindow.document.getElementById("style").innerHTML = report.style;
          reportWindow.document.getElementById("script").text = report.script;
          reportWindow.document.getElementById("template").text = report.template;
          reportWindow.document.getElementById("data").text = JSON.stringify(reportCtx);
        });
      }
    });

    $content.on("click", ".js-edit-issue", function (ev) {
      var $issue = $(this).parents(".issue");
      var id = $issue.attr("data-id");
      app.ui.base.modal.load("issue-modal.html", {}, (renderModal) => app.ctrls.issueModal(renderModal, {
        edit: { issueId: id },
        onsave: !app.state.hasGuestPermisssion() ? saveIssue : undefined
      }));
      function saveIssue (issue) {
        app.ws.update("issues", { id: id }, {
          type: issue.type,
          name: issue.name,
          description: issue.description
        }, (status) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.issue);
          app.ui.success(app.ui.locals.success_update_data, app.ui.locals.issue);
          $issue.replaceWith(render(_.assignIn(issue, { _id: id }), "issue"));
        });
      }
    });

    $content.on("click", ".js-remove-issue", function (ev) {
      var $issue = $(this).parents(".issue");
      app.ui.base.modal.load("confirm-modal.html", {}, (modalRenderer) => app.ctrls.confirmModal(modalRenderer, {
        title: app.ui.locals.confirm_remove.title,
        message: app.ui.locals.confirm_remove.message + "\n\n" +
                 $issue.find(".js-name").text(),
        confirm: app.ui.locals.remove,
        cancel: app.ui.locals.cancel,
        onconfirm: removeIssue
      }));
      function removeIssue () {
        app.ws.delete("issues", $issue.attr("data-id"), (status, response) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_remove_data, app.ui.locals.issue);
          app.ui.success(app.ui.locals.success_remove_data, app.ui.locals.issue);
          $issue.remove();
        });
      }
    });

    $content.on("click", ".js-remove-execution", function (ev) {
      var $execution = $(this).parents(".execution");
      app.ui.base.modal.load("confirm-modal.html", {}, (modalRenderer) => app.ctrls.confirmModal(modalRenderer, {
        title: app.ui.locals.confirm_remove.title,
        message: app.ui.locals.confirm_remove.message + "\n\n" +
                 $execution.find(".js-name").text(),
        confirm: app.ui.locals.remove,
        cancel: app.ui.locals.cancel,
        onconfirm: removeExecution
      }));
      function removeExecution () {
        app.ws.delete("executions", $execution.attr("data-id"), (status, response) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_remove_data, app.ui.locals.execution);
          app.ui.success(app.ui.locals.success_remove_data, app.ui.locals.execution);
          $execution.remove();
        });
      }
    });

    $content.on("click", ".js-more-execution", function (ev) {
      var $item = $(this).parents(".list-group-item");
      var last = $content.find(".execution:last").attr("data-modified");

      $item.addClass("animated fadeOut");

      Promise.resolve({
        domainId: data.domainId,
        runIds: !params.run && app.state.hasGuestPermisssion() ? grantRunIds : undefined,
        runId: params.run,
        modifiedStart: last,
        executions: null
      }).then(app.context.queryExecutions)
        .then(function (context) {
          console.log(context);

          var markup = "";
          _.forEach(context.executions, (execution) => {
            if (execution.modified == last) return;
            execution.domainId = data.domainId;
            markup += render(execution, "execution");
          });
          $(markup).insertBefore($item);

          if (context.executions.length < data.config.def_limit) {
            $item.remove();
          }
        });
    });
  },

  execution: function (render, params) {
    var $content = $("#content");
    var ready = null;
    var vpayCurrGoal = null;
    var vpayGoalStatus = null;

    var permission = _.find(data.permissions, { domainId: params.domainId });
    if (!permission || (permission.level != "guest" && _.indexOf(data.const.execLevels, permission.level)) < 0) {
      app.ui.error(app.ui.locals.error_check_permissions, app.ui.locals.execution);
      return app.route.goToDefaultNav();
    }
    if (data.domainId != permission.domainId) {
      app.ui.base.changeDomain(permission.domainId);
    }

    var grantRunIds = [];

    if (data.grants) {
      for (var grantIdx = 0; grantIdx < data.grants.length; grantIdx++) {
        let grant = data.grants[grantIdx];
        if (grant.type == "run") grantRunIds.push(grant.id);
      }
    }

    load().then(view);

    function load (context) {
      return Promise.resolve(_.assignIn({
        modifiedStart: null,
        runIds: permission.level == "guest" ? grantRunIds : undefined,
        executionId: params.id,
        execution: null,
        issues: null,
        txns: null,
        hosts: null
      }, context))
        .then(app.context.queryExecutions)
        .then((context) => {
          if (context.execution) delete context.modifiedStart;
          else context.hosts = [];
          return context;
        })
        .then(app.context.queryIssues)
        .then(app.context.queryTxns)
        .then(app.context.queryHosts)
        .then(app.context.inflateExecutions)
        .then(app.context.normalizeExecutions)
        .then(app.context.preparePresentation)
        .then(prettifyCardValidation)
        .then(synchronizeVpay);
    }

    function view (context) {

      if (context.execution) {

        context._viewReadOnly = data.accessLevel == "guest";

        context._viewEditable =
          !context._viewReadOnly &&
          (context.execution.status == "active" ||
           context.execution.status == "review");

        render(context);

        app.ui.base.content.header.sticky(true);
        $content.find(".assets").panels({ maxcolumns: 3 });
        $content.find(".user-goals").panels({ maxcolumns: 2, bestfit: true, screensize: "lg" });
        $("*[data-toggle='tooltip']").tooltip();

        $content.find(".validation.neutral").hide();
        $content.find(".validation.pass").hide();
        $content.find(".js-toggle-pass i").addClass("disabled");
        $content.find(".js-toggle-neutral i").addClass("disabled");

        $content.find(".goal").each((idx, el) => {
          var $goal = $(el);
          var $visible = $goal.find(".validation:visible");
          var row = $goal.find(".hidden-results");
          if ($visible.length == 0) row.show();
          else row.hide();
        });

      } else {

        if (!ready) {
          app.ui.error(app.ui.locals.data_not_found, app.ui.locals.execution);
          return app.route.goToDefaultNav();
        }

        _.forEach(context.issues, (issue) => {
          var $issue = $content.find(".issue[data-id='" + txn._id + "']");
          $txn.replaceWith(render(issue, "issue"));
        });

        _.forEach(context.txns, (txn) => {
          var $txn = $content.find(".txn[data-id='" + txn._id + "']");
          $txn.replaceWith(render(txn, "txn"));
        });
      }

      ready = new Date();
    }

    function update (context) {
      context._viewUpdate = true;
      view(context);
    }

    function prettifyCardValidation (context) {
      if (context.execution) {
        _.forEach(context.execution.test.goals, (goal) => {
          if (goal.type == "card_validation") {
            _.forEach(goal.validations, (validation) => {
              validation.request = app.lib.prettifyHex(validation.request);
              validation.value = app.lib.prettifyHex(validation.value);
            });
          }
        });
      }
      return context;
    }

    function synchronizeVpay (context) {
      if (context.execution) {
        if (context.execution.status == "active") {
          var goals = context.execution.test.goals;
          for (var idx = 0; idx < goals.length; idx++) {
            let goal = goals[idx];
            if (goal.type == "card_validation" && !goal.card) {
              if (idx != vpayCurrGoal) {
                vpayCurrGoal = idx;
                checkVpayConnector(() => {
                  writeVpayScript(goal);
                });
                break;
              }
            }
          }
        } else if (context.execution.status != "review") {
          vpayCurrGoal = null;
        }
      }
      return context;
    }

    function checkVpayConnector (callback) {
      app.vpay.getInfo((error, response) => {
        if (error || response.error) {
          vpayGoalStatus = "error";
          setVpayGoalStatus(error || response.error);
          return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.vpay);
        }
        if (response.build < data.config.vpay.connectorBuild) {
          return app.ui.base.modal.load("vpay-connector-modal.html", {}, (modalRenderer) => app.ctrls.vpayModal(modalRenderer, null));
        }
        callback();
      });
    }

    function writeVpayScript (goal) {
      vpayGoalStatus = null;
      var request = {
        label: goal.description,
        script: [],
        erase: { log: true }
      };
      _.forEach(goal.validations, (validation) => {
        let apdu = {
          request: (validation.request || "").replace(/\s/g, ''),
          sw: (validation.sw || "").replace(/\s/g, '')
        };
        validation.responseType = validation.responseType || "static";
        if (validation.responseType == "static") {
          apdu.response = (validation.responseValue || validation.response || "").replace(/\s/g, '');
        } else if (validation.responseType == "emv_internal_authenticate") {
          apdu.response = {
            type: validation.responseType,
            kMod: (validation.kModValue || validation.kMod || "").replace(/\s/g, ''),
            kExp: (validation.kExpValue || validation.kExp || "").replace(/\s/g, '')
          };
        }
        request.script.push(apdu);
      });
      app.vpay.writeCard(request, (error, response) => {
        if (error || response.error) {
          vpayGoalStatus = "error";
          setVpayGoalStatus(error || response.error);
          return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.vpay);
        }
        vpayGoalStatus = "insert";
        updateVpayStatus();
      });
    }

    function updateVpayStatus () {
      if (_.isNil(vpayCurrGoal) ||
          vpayGoalStatus == "error" ||
          vpayGoalStatus == "done") return;
      app.vpay.getInfo((error, response) => {
        if (error || response.error) {
          vpayGoalStatus = "error";
          setVpayGoalStatus(error || response.error);
          return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.vpay);
        }
        if (response.progress >= 0) {
          setVpayGoalStatus(response.info, response.progress);
        } else {
          setVpayGoalStatus(vpayGoalStatus);
          updateVpayCardInfo();
        }
        setTimeout(updateVpayStatus, data.config.vpay.updateInterval);
      });
    }

    function updateVpayCardInfo () {
      app.vpay.getCardInfo((error, response) => {
        if (error || response.error) {
          vpayGoalStatus = "error";
          setVpayGoalStatus(error || response.error);
          return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.vpay);
        }
        if (vpayGoalStatus == "insert") {
          if (response.cardStatus == "SYNC") {
            vpayGoalStatus = "ready";
          }
        } else if (vpayGoalStatus == "ready") {
          if (response.cardStatus == "ABSENT" ||
              response.cardStatus == "REMOVED") {
            vpayGoalStatus = "reinsert";
          }
        } else if (vpayGoalStatus = "reinsert") {
          if (response.cardStatus == "SYNC") {
            vpayGoalStatus = "done";
            updateVpayCardLog(_.pick(response, [
              "productStr", "buildNumber", "serialNumber", "label", "atr", "historicalBytes", "log"
            ]));
          }
        }
      });
    }

    function updateVpayCardLog (info) {
      app.ws.refresh("executions", params.id, (execution) => {
        info.instant = new Date();
        execution.test.goals[vpayCurrGoal].card = info;
      }, (status, result) => {
        if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.execution);
        load({ execution: result }).then(update);
      });
    }

    function setVpayGoalStatus (message, progress) {
      var $goal = $content.find(".goal[data-idx=" + vpayCurrGoal + "]");
      if (message == "insert") message = app.ui.locals.insert_card;
      if (message == "ready") message = app.ui.locals.card_ready;
      if (message == "reinsert") message = app.ui.locals.reinsert_card;
      if (message == "done") message = app.ui.locals.reinsert_card;
      if (message == "error" || message == "timeout") {
        message = app.ui.locals.connector_error;
        $goal.find(".color-strp").removeClass("bg-green bg-orange").addClass("bg-red-deep");
      } else if (message == "done") {
        $goal.find(".color-strp").removeClass("bg-red-deep bg-orange").addClass("bg-green");
      } else {
        $goal.find(".color-strip").removeClass("bg-green bg-red-deep").addClass("bg-orange");
      }
      if (message) {
        $goal.find(".js-status").text(message);
        $goal.find(".js-status").show();
      } else {
        $goal.find(".js-status").hide();
      }
      if (progress >= 0) {
        $goal.find(".js-progress .progress-bar").css("width", (100 * progress) + "%");
        $goal.find(".js-progress").show();
      } else {
        $goal.find(".js-progress").hide();
      }
    }

    function setChanges (value) {
      app.ui.base.confirmChanges = value;
    }

    function goToNextExecution () {
      var $execution = $content.find(".execution");
      app.context.queryCollection("executions", {
        runId: $execution.attr("data-runid"),
        scenarioId: $execution.attr("data-scenarioid"),
        sort: { "scenario.sequence": 1 }
      })({
        domainId: data.domainId,
        currId: $execution.attr("data-id"),
      }).then((context) => {
         let lastExecution = (context.executions.length -1);
         if(context.currId != context.executions[lastExecution]._id){
          for (let i = 0; i < context.executions.length; i++) {
            if (context.executions[i]._id == context.currId ) {
              context.nextId = context.executions[i + 1]._id
              break;
            }
          }

          app.route.goTo(app.ctrls.execution, { domainId: context.domainId, id: context.nextId });
         }
        
      });  
    }

    function clearGoals (id, fromIdx, toIdx) {
      var txnIds = [];

      app.ws.refresh("executions", id, (execution) => {
        for (let idx = fromIdx; idx <= toIdx; idx++) {
          var goal = execution.test.goals[idx];
          if (goal.type == "txn_inbound") {
            _.forEach(goal.request.validations, (validation) => {
              _.forEach(_.difference(_.keys(validation), ["field", "expr"]), (field) => {
                validation[field] = null;
              });
            });
            if (goal.txnId)
              txnIds.push(goal.txnId);
            goal.txnId = null;
          }
          if (goal.type == "txn_outbound") {
            _.forEach(goal.response.validations, (validation) => {
              _.forEach(_.difference(_.keys(validation), ["field", "expr"]), (field) => {
                validation[field] = null;
              });
            });
            if (goal.txnId)
              txnIds.push(goal.txnId);
            goal.txnId = null;
          }
          if (goal.type == "card_validation") {
            vpayCurrGoal = null;
            vpayGoalStatus = null;
            goal.card = null;
            _.forEach(goal.validations, (validation) => {
              validation.result = null;
              validation.value = null;
              validation.exprValue = null;
              let responseType = validation.responseType || "static";
              if (responseType == "static") {
                 validation.responseValue = null;
              } else if (responseType == "emv_internal_authenticate") {
                validation.kModValue = null;
                validation.kExpValue = null;
              }
            });
          }
        }
      }, (status, result) => {
        if (status != Ws.Status.SUCCESS)
          return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.execution);
        load({ execution: result }).then(update);
        if (txnIds.length > 0)
          clearTxns();
      });

      function clearTxns () {
          app.ws.refresh("txns", txnIds.pop(), (txn) => {
            txn.executionId = null;
          }, (status, result) => {
            if (txnIds.length > 0)
              clearTxns();
          });
      }
    }

    $content.on("unload", function (ev) {
      vpayCurrGoal = null;
    });

    $content.on("update", function (ev) {
      if (ready) load({
        modifiedStart: app.ui.queryLastModified(".execution, .txn") || ready
      }).then(update);
    });

    $content.on("click", "*[class*='js-set-status-']", function (ev) {
      var $result = $content.find(".result");
      var status = app.lib.getClassVariant(this, "js-set-status-");

      var executionData = app.ui.query(app.ctrls.executionQuery);
      console.log(executionData);
      if (status == executionData.status) return;
      if (status == "active" && _.indexOf(executionData.test.assets, "") >= 0) return app.ui.warning(app.ui.locals.warn_select_assets, app.ui.locals.execution);

      delete executionData.id;
      delete executionData.status;
      delete executionData.result;
      delete executionData.issues;
      delete executionData.test.assets;
      _.forEach(executionData.test.goals, (goal) => delete goal.type);

      app.ws.refresh("executions", params.id, (execution) => {
        _.merge(execution, executionData);
        execution.status = status;
        execution.result = null;
        if (status == "active") execution.started = new Date();
      }, (status, result) => {
        if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.execution);
        load({ execution: result }).then(update);
      });
    });

    $content.on("click", "*[class*='js-set-result-']", function (ev) {
      var $result = $content.find(".result");
      var result = app.lib.getClassVariant(this, "js-set-result-");

      var executionData = app.ui.query(app.ctrls.executionQuery);
      if (result == executionData.result) return;

      delete executionData.id;
      delete executionData.status;
      delete executionData.result;
      delete executionData.issues;
      delete executionData.test.assets;
      _.forEach(executionData.test.goals, (goal) => delete goal.type);

      app.ws.refresh("executions", params.id, (execution) => {
        _.merge(execution, executionData);
        execution.status = "finished";
        execution.result = result;
        execution.finished = new Date();
      }, (status, result) => {
        if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.execution);
        load({ execution: result }).then(update);
      });
    });

    $content.on("click", ".js-view-scenario", function (ev) {
      var $execution = $content.find(".execution");
      app.ui.base.modal.load("select-modal.html", {}, (renderModal) => app.ctrls.selectModal(renderModal, {
        collection: "executions",
        onquery: (query) => _.assignIn(query, {
          runId: $execution.attr("data-runid"),
          scenarioId: $execution.attr("data-scenarioid"),
          sort: { "scenario.sequence": 1 }
        }),
        onitem: (execution) => ({
          _id: execution._id,
          description: (execution._id == params.id ? "(" + app.ui.locals.current + ") " : "") + execution.test.label
        }),
        onselect: jumpExecution
      }));
      function jumpExecution (id, domainId) {
        app.route.goTo("/executions/" + domainId + "/" + id);
      }
    });

    $content.on("click", ".js-next-test", function (ev) {
      var $execution = $content.find(".execution");
      goToNextExecution();
    });

    $content.on("click", ".js-monitor-txn", function (ev) {
      var $host = $(this).parents(".host");
      return app.ui.base.toolbar.load("txn-toolbar.html", function (render) {
        return app.ctrls.txnToolbar(render, {
          hostId: $host.attr("data-id")
        });
      });
    });

    $content.on("click", ".js-edit-issue", function (ev) {
      var $issue = $(this).parents(".issue");
      var id = $issue.attr("data-id");
      app.ui.base.modal.load("issue-modal.html", {}, (renderModal) => app.ctrls.issueModal(renderModal, {
        edit: { issueId: id },
        onsave: !app.state.hasGuestPermisssion() ? saveIssue : undefined
      }));
      function saveIssue (issue) {
        app.ws.update("issues", { id: id }, {
          type: issue.type,
          name: issue.name,
          description: issue.description
        }, (status) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.issue);
          app.ui.success(app.ui.locals.success_update_data, app.ui.locals.issue);
          $issue.replaceWith(render(_.assignIn(issue, { _id: id }), "issue"));
        });
      }
    });

    $content.on("click", ".js-link-issue", function (ev) {
      app.ui.base.modal.load("issue-modal.html", {}, (renderModal) => app.ctrls.issueModal(renderModal, {
        list: {
          runId: $(this).parents(".execution").attr("data-runId")
        },
        edit: true,
        onselect: linkIssue,
        onsave: insertIssue
      }));
      function linkIssue (id) {
        var issues = app.ui.query(app.ctrls.executionQuery).issues;
        if (_.indexOf(issues, id) >= 0) return app.ui.warn(app.ui.locals.warn_added_already, app.ui.locals.execution);
        app.ws.refresh("executions", params.id, (execution) => {
          execution.issues = _.concat(issues, id);
        }, (status, result) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.execution);
          load({ execution: result }).then(update);
        });
      }
      function insertIssue (issue) {
        app.ws.insert("issues", {
          runId: $content.find(".execution").attr("data-runId"),
          type: issue.type,
          name: issue.name,
          description: issue.description
        }, (status, id) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.issue);
          app.ui.success(app.ui.locals.success_insert_data, app.ui.locals.issue);
          linkIssue(id);
        });
      }
    });

    $content.on("click", ".js-unlink-issue", function (ev) {
      var $issue = $(this).parents(".issue");
      var id = $issue.attr("data-id");
      app.ws.refresh("executions", params.id, (execution) => {
        execution.issues = _.without(execution.issues, id);
      }, (status, result) => {
        if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.execution);
        load({ execution: result }).then(update);
      });
    });

    $content.on("click", ".js-select-asset", function (ev) {
      var $asset = $(this).parents(".asset");
      app.ui.base.modal.load("select-modal.html", {}, (renderModal) => app.ctrls.selectModal(renderModal, {
        collection: "assets",
        select: {
          domain: true
        },
        onquery: (query) => { query.type = $asset.attr("data-type") },
        onitem: (asset) => ({ _id: asset._id, description: asset.description }),
        onselect: loadAsset
      }));
      function loadAsset (id, domainId) {
        app.ws.query("assets", { domainId: domainId, id: id }, (status, results) => {
          if (status != Ws.Status.SUCCESS || _.isEmpty(results)) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.execution);
          updateExecution(results[0]);
        });
      }
      function updateExecution (asset) {
        app.ws.refresh("executions", params.id, (execution) => {
          execution.test.assets[asset.type] = {
            _id: asset._id,
            description: asset.description,
            properties: asset.properties
          };
        }, (status, result) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.execution);
          load({ execution: result }).then(update);
        });
      }
    });

    $content.on("click", ".js-clear-goal", function (ev) {
      var $goal = $(this).parents(".goal");
      var idx = Number($goal.attr("data-idx"));
      clearGoals(params.id, idx, idx);
    });

    $content.on("click", ".js-clear-goals", function (ev) {
      let $goals = $content.find(".execution").find(".goal");
      var $lastGoal = $($goals.get($goals.length - 1));
      let lastIdx = Number($lastGoal.attr("data-idx"));
      clearGoals(params.id, 0, lastIdx);
    });

    $content.on("click", ".js-view-txn", function (ev) {
      var $goal = $(this).parents(".goal");
      var txnId = $goal.find(".txn").attr("data-id");
      if (!txnId) return app.ui.error(app.ui.locals.data_not_available, app.ui.locals.execution);
      app.ui.base.modal.load("txn-modal.html", {}, (renderModal) => app.ctrls.txnModal(renderModal, {
        txnId: txnId
      }));
    });

    $content.on("click", ".js-view-card", function (ev) {
      var $goal = $(this).parents(".goal");
      var idx = Number($goal.attr("data-idx"));
      app.ws.query("executions", { id: params.id }, (status, results) => {
        if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.load_data_error, app.ui.locals.execution);
        var goal = results[0].test.goals[idx];
        if (!goal.card) return app.ui.error(app.ui.locals.data_not_available, app.ui.locals.execution);
        app.ui.base.modal.load("vpay-card-modal.html", {}, (r) => app.ctrls.vpayCardModal(r, { card: goal.card }));
      });
      ev.preventDefault();
    });

    $content.on("click", "*[class*='js-toggle-']", function (ev) {
      var type = app.lib.getClassVariant(this, "js-toggle-");
      var disabled = $(this).find("i").hasClass("disabled");
      if (type == "neutral" && disabled) {
        $(this).parents(".goal").find(".validation.pass").show();
        $(this).parents(".goal").find(".js-toggle-pass i").removeClass("disabled");
      }
      $(this).parents(".goal").find(".validation." + type).toggle();
      $(this).find("i").toggleClass("disabled");
      var visible = $(this).parents(".goal").find(".validation:visible");
      var row = $(this).parents(".goal").find(".hidden-results");
      if (visible.length == 0) row.show();
      else row.hide();
    });
  },

  scenario: function (render, params) {

    var $content = $("#content");

    load({ create: params.create, scenarioId: params.id });

    function load (context) {

      if (context.create) {
        return view({
          create: true,
          scenario: {
            name: "",
            description: "",
            tests: []
          },
          tests: [],
          assets: {}
        });
      }

      Promise.resolve(_.assignIn({
        scenario: null,
        tests: null,
        assetIds: null,
        assets: null
      }, context))
        .then(app.context.queryScenarios)
        .then(app.context.queryTests)
        .then(app.context.collectAssetIds)
        .then(app.context.queryAssets)
        .then(app.context.inflateTestAssets)
        .then(view);
    }

    function view (context) {
      console.log(context);
      render(context);

      app.ui.base.content.header.sticky(true);
      setChanges(context.create);
    }

    function setChanges (value) {
      app.ui.base.confirmChanges = value;
      if (value) $content.find(".js-save").show();
      else $content.find(".js-save").hide();
    }

    $content.on("click", ".js-save", function (ev) {
      var data = app.ui.query(app.ctrls.scenarioQuery);
      console.log(data);
      if (params.create) {
        app.ws.insert("scenarios", data, (status, id) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_insert_data, app.ui.locals.scenario);
          app.ui.success(app.ui.locals.success_insert_data, app.ui.locals.scenario);
          setChanges(false);
          app.route.goTo("/scenario/" + id);
        });
      } else {
        app.ws.update("scenarios", { id: params.id }, data, (status, response) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.scenario);
          app.ui.success(app.ui.locals.success_update_data, app.ui.locals.scenario);
          setChanges(false);
        });
      }
    });

    $content.on("change", function (ev) {
      setChanges(true);
    });

    $content.on("click", ".js-move-up-test", function (ev) {
      var $tests = $(this).parents(".tests").find(".test");
      var $test = $(this).parents(".test");
      if ($tests.index($test) > 0) {
        $test.insertBefore($test.prev());
        setChanges(true);
      }
    });

    $content.on("click", ".js-move-down-test", function (ev) {
      var $tests = $(this).parents(".tests").find(".test");
      var $test = $(this).parents(".test");
      if ($tests.index($test) < $tests.length - 1) {
        $test.insertAfter($test.next());
        setChanges(true);
      }
    });

    $content.on("click", ".js-unlink-test", function (ev) {
      var $test = $(this).parents(".test");
      $test.remove();
      setChanges(true);
    });

    $content.on("click", ".js-add-test", function (ev) {
      app.ui.base.modal.load("select-modal.html", {}, (renderModal) => app.ctrls.selectModal(renderModal, {
        collection: "tests",
        onitem: (test) => ({ _id: test._id, description: test.label }),
        onselect: (_id) => {
          Promise.resolve({
            scenarioId: params.scenario,
            testId: _id,
            test: null,
            assets: {}
          }).then(app.context.queryTests)
            .then(app.context.queryAssets)
            .then(app.context.inflateTestAssets)
            .then((context) => {
              var localCtx = $.extend({}, context.test, { scenario: true });
              $content.find(".add-test").before(render(localCtx, "test"));
              setChanges(true);
          });
        }
      }));
    });
  },

  tests: function (render, params) {
    var $content = $("#content");

    if (app.state.hasScopePermissions()) {
      load({ scenarioId: params.scenario }).then(view);
    } else {
      app.ui.error(app.ui.locals.error_check_permissions, app.ui.locals.tests);
      return app.route.goToDefaultNav();
    }

    function load (context) {
      return Promise.resolve(_.assignIn(context, {
        show: {
          createCtrls: app.state.hasCreatePermissions(),
          execCtrls: app.state.hasAnyExecPermissions()
        }
      }))
        .then(app.context.queryScenarios)
        .then(app.context.queryTests)
        .then(app.context.collectAssetIds)
        .then(app.context.queryAssets)
        .then(app.context.inflateTestAssets)
        .then(prepareView)
    }

    function prepareView (context) {
      var scenarios = context.scenarios || [];
      if (context.scenario) scenarios.push(context.scenario);
      _.forEach(scenarios, prepareScenario);

      function prepareScenario (scenario) {
        scenario._descriptionHeading = "";
        if (!_.isEmpty(scenario.description)) {
          scenario._descriptionHeading = scenario.description.split("___")[0].trim();
        }
      }

      return context;
    }

    function view (context) {
      console.log(context);
      render(context);

      app.ui.base.content.header.sticky(true);
      if (!context.scenario) {
        $content.find(".scenarios").panels({ maxcolumns: 3 });
        $content.find(".animate-panel").animatePanel();
      }
    }

    $content.on("input", ".js-search", function (ev) {
      if (this.to) clearTimeout(this.to);
      this.to = setTimeout(() => {
        var search = $(this).val();
        if (search.trim()) {
          $content.find(".scenario").hide();
          $content.find(".scenario").filter((idx, el) => $(el).text().includes(search)).show();
          $content.find(".scenarios").panels({ maxcolumns: 3 });
          $content.find(".test").hide();
          $content.find(".test").filter((idx, el) => $(el).text().includes(search)).show();
        } else {
          $content.find(".scenario").show();
          $content.find(".scenarios").panels({ maxcolumns: 3 });
          $content.find(".test").show();
        }
      }, 750);
    });

    $content.on("click", ".js-create-scenario", function (ev) {
      app.route.goTo(app.ctrls.scenario, { create: true });
    });

    $content.on("click", ".js-create-test", function (ev) {
      app.route.goTo(app.ctrls.test, { create: true });
    });

    $content.on("click", ".js-remove-scenario", function (ev) {
      var $scenario = $(this).parents(".scenario");
      app.ui.base.modal.load("confirm-modal.html", {}, (modalRenderer) => app.ctrls.confirmModal(modalRenderer, {
        title: app.ui.locals.confirm_remove.title,
        message: app.ui.locals.confirm_remove.message + "\n\n" +
                 $scenario.find(".data-name").text(),
        confirm: app.ui.locals.remove,
        cancel: app.ui.locals.cancel,
        onconfirm: removeScenario
      }));
      function removeScenario () {
        app.ws.delete("scenarios", $scenario.attr("data-id"), (status, response) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_remove_data, app.ui.locals.scenario);
          app.ui.success(app.ui.locals["success_remove_data"], app.ui.locals["scenario"]);
          app.route.goTo("/tests");
        });
      }
    });

    $content.on("click", ".js-execute-scenario", function (ev) {
      var $scenario = $(this).parents(".scenario");
      app.ui.base.modal.load("run-modal.html", {}, (renderModal) => app.ctrls.runModal(renderModal, {
        select: {
          allow_none: false,
          runStatus: "open"
        },
        edit: {
          status: "open",
          name: $scenario.find(".data-name").text(),
          description: $scenario.find(".data-desc").text()
        },
        onselect: execute,
        onsave: createRun
      }));
      function execute (runId, domainId) {
        app.ws.call("scenarios/execute", {
          runId: runId,
          id: $scenario.attr("data-id")
        }, (status, response) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_insert_data, app.ui.locals.test);
          if (data.domainId != domainId) app.ui.base.changeDomain(domainId);
          app.route.goTo("/executions?run=" + runId);
        });
      }
      function createRun (run) {
       app.ws.insert("runs", {
         domainId: run.domainId,
         status: run.status,
         name: run.name,
         description: run.description
       }, (status, runId) => {
         if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_insert_data, app.ui.locals.test);
         execute(runId, run.domainId);
       });
     }
    });

    $content.on("click", ".js-execute-test", function (ev) {
      var $test = $(this).parents(".test");
      app.ui.base.modal.load("run-modal.html", {}, (renderModal) => app.ctrls.runModal(renderModal, {
        select: {
          allow_none: true,
          runStatus: "open"
        },
        edit: {
          status: "open",
          name: "",
          description: ""
        },
        onselect: execute,
        onsave: createRun
      }));
      function execute (runId, domainId) {
        app.ws.call("tests/execute", {
          domainId: domainId,
          runId: runId,
          id: $test.attr("data-id")
        }, (status, response) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_insert_data, app.ui.locals.test);
          app.route.goTo("/executions/" + domainId + "/" + response.executionId);
        });
      }
      function createRun (run) {
       app.ws.insert("runs", {
         domainId: run.domainId,
         status: run.status,
         name: run.name,
         description: run.description
       }, (status, runId) => {
         if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_insert_data, app.ui.locals.test);
         execute(runId, run.domainId);
       });
      }
    });

    $content.on("click", ".js-remove-test", function (ev) {
      var $test = $(this).parents(".test");
      app.ui.base.modal.load("confirm-modal.html", {}, (modalRenderer) => app.ctrls.confirmModal(modalRenderer, {
        title: app.ui.locals.confirm_remove.title,
        message: app.ui.locals.confirm_remove.message + "\n\n" +
                 $test.find(".js-label").text(),
        confirm: app.ui.locals.remove,
        cancel: app.ui.locals.cancel,
        onconfirm: removeTest
      }));
      function removeTest () {
        app.ws.delete("tests", $test.attr("data-id"), (status, response) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_remove_data, app.ui.locals.test);
          app.ui.success(app.ui.locals.success_remove_data, app.ui.locals.test);
          $test.remove();
        });
      }
    });
  },

  test: function (render, params) {
    var $content = $("#content");

    load({ create: params.create, testId: params.id });

    function load (context) {

      if (context.create) {
        return Promise.resolve({
          test: {
            label: "",
            title: "",
            description: "",
            assets: {},
            goals: []
          },
          assets: {},
          domainId: data.domainId
        }).then(app.context.queryDomains)
          .then(view);
      }

      Promise.resolve(_.extend({
        domainId: data.domainId
      }, context))
        .then(app.context.queryDomains)
        .then(app.context.queryTests)
        .then(app.context.normalizeTest)
        .then(app.context.collectAssetIds)
        .then(app.context.queryAssets)
        .then(app.context.inflateTestAssets)
        .then(view);
    }

    function view (context) {
      console.log(context);
      render(context);

      app.ui.base.content.header.sticky(true);
      $content.find(".assets").panels({ maxcolumns: 3 });

      setChanges(false);
    }

    function setChanges (value) {
      app.ui.base.confirmChanges = value;
      if (value) $content.find(".js-save").show();
      else $content.find(".js-save").hide();
    }

    $content.on("click", ".js-save", function (ev) {
      var test = app.ui.query(app.ctrls.testQuery);
      if (params.create) {
        app.ws.insert("tests", test, (status, id) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_insert_data, app.ui.locals.test);
          app.ui.success(app.ui.locals.success_insert_data, app.ui.locals.test);
          setChanges(false);
          app.route.goTo("/tests/" + id);
        });
      } else {
        app.ws.update("tests", { id: params.id }, test, (status, response) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.test);
          app.ui.success(app.ui.locals.success_update_data, app.ui.locals.test);
          setChanges(false);
        });
      }
    });

    $content.on("change", function (ev) {
      setChanges(true);
    });

    $content.on("click", ".js-unlink-asset", function (ev) {
      $(this).parents(".asset").remove();
      $content.find(".assets").panels({ maxcolumns: 3 });
      setChanges(true);
    });

    $content.on("click", ".js-clear-asset", function (ev) {
      var $asset = $(this).parents(".asset");
      $asset.replaceWith(render({
        type: $asset.attr("data-type"),
        _id: null
      }, "asset"));
      setChanges(true);
    });

    $content.on("click", ".js-add-asset", function (ev) {
      var currTypes = [];
      $content.find(".asset").each(function () {
        currTypes.push($(this).attr("data-type"));
      });
      var type = $(this).parents(".asset-type").attr("data-type");
      if (currTypes.indexOf(type) == -1) {
        $(render({
          type: type,
          _id: null
        }, "asset")).insertBefore($(this).parents(".add-asset"));
        $content.find(".assets").panels({ maxcolumns: 3 });
        setChanges(true);
      } else {
        app.ui.warning(app.ui.locals["test-page"].warn_asset_duplicated, app.ui.locals["test-page"].title);
      }
    });

    $content.on("click", ".js-select-asset", function (ev) {
      var $asset = $(this).parents(".asset");
      app.ui.base.modal.load("select-modal.html", {}, (renderModal) => app.ctrls.selectModal(renderModal, {
        collection: "assets",
        onquery: (query) => { query.type = $asset.attr("data-type") },
        onitem: (asset) => ({ _id: asset._id, description: asset.description }),
        onselect: loadAsset
      }));
      function loadAsset (id) {
        app.ws.query("assets", { id: id }, (status, results) => {
          if (status != Ws.Status.SUCCESS || _.isEmpty(results)) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.execution);
          replaceAsset(results[0]);
        });
      }
      function replaceAsset (asset) {
        $asset.replaceWith(render(asset, "asset"));
        setChanges(true);
      }
    });

    $content.on("click", ".js-move-up-goal", function (ev) {
      var $goals = $(this).parents(".goals").find(".goal");
      var $goal = $(this).parents(".goal");
      if ($goals.index($goal) > 0) {
        $goal.insertBefore($goal.prev());
        setChanges(true);
      }
    });

    $content.on("click", ".js-move-down-goal", function (ev) {
      var $goals = $(this).parents(".goals").find(".goal");
      var $goal = $(this).parents(".goal");
      if ($goals.index($goal) < $goals.length - 1) {
        $goal.insertAfter($goal.next());
        setChanges(true);
      }
    });

    $content.on("click", ".js-remove-goal", function (ev) {
      $(this).parents(".goal").remove();
      setChanges(true);
    });

    $content.on("click", ".js-move-up-option", function (ev) {
      var $options = $(this).parents(".user-options").find(".user-option");
      var $option = $(this).parents(".user-option");
      if ($options.index($option) > 0) {
        $option.insertBefore($option.prev());
        setChanges(true);
      }
    });

    $content.on("click", ".js-move-down-option", function (ev) {
      var $options = $(this).parents(".user-options").find(".user-option");
      var $option = $(this).parents(".user-option");
      if ($options.index($option) < $options.length - 1) {
        $option.insertAfter($option.next());
        setChanges(true);
      }
    });

    $content.on("click", ".js-remove-option", function (ev) {
      var $option = $(this).parents(".user-option");
      $option.remove();
      setChanges(true);
    });

    $content.on("keypress", ".add-user-option .js-option-value", function (ev) {
      if (ev.keyCode == 13) {
        var $this = $(this);
        var value = $this.val().trim();
        if (value && value.length > 0) {
          $(render({
            value: value
          }, "option")).insertBefore($this.parents(".add-user-option"));
          $this.val("");
          setChanges(true);
        }
      }
    });

    $content.on("click", ".js-move-up-row", function (ev) {
      var $rows = $(this).parents("tbody").find("tr");
      var $row = $(this).parents("tr");
      if ($rows.index($row) > 0) {
        $row.insertBefore($row.prev());
        setChanges(true);
      }
    });

    $content.on("click", ".js-move-down-row", function (ev) {
      var $rows = $(this).parents("tbody").find("tr");
      var $row = $(this).parents("tr");
      if ($rows.index($row) < $rows.length - 2) {
        $row.insertAfter($row.next());
        setChanges(true);
      }
    });

    $content.on("click", ".js-remove-row", function (ev) {
      $(this).parents("tr").remove();
      setChanges(true);
    });

    $content.on("keypress", ".js-add-match-field", function (ev) {
      if (ev.keyCode == 13) {
        var $this = $(this);
        var value = $this.val().trim();
        if (value && value.length > 0) {
          $(render({
            field: value,
            expr: ""
          }, "match")).insertBefore($this.parents(".add-match"));
          $this.val("");
          setChanges(true);
        }
      }
    });

    $content.on("keypress", ".js-add-validation-field", function (ev) {
      if (ev.keyCode == 13) {
        var $this = $(this);
        var value = $this.val().trim();
        if (value && value.length > 0) {
          $(render({
            field: value,
            expr: ""
          }, "validation")).insertBefore($this.parents(".add-validation"));
          $this.val("");
          setChanges(true);
        }
      }
    });

    $content.on("click", ".js-add-card-validation", function (ev) {
      var $this = $(this);
      $(render({
        request: "CLA INS P1 P2",
        response: "",
        sw: "90 00"
      }, "card_validation")).insertBefore($this.parents(".add-validation"));
      setChanges(true);
    });

    $content.on("click", "[class*='js-add-goal-']", function (ev) {
      var type = app.lib.getClassVariant(this, "js-add-goal-");
      $(render({
        type: type,
        idx: $content.find(".goal").length
      }, "goal")).insertBefore($(this).parents(".add-goal"));
      setChanges(true);
    });

    $content.on("change", ".goal .validation .data-responseType", function (ev) {
      var $goal = $(this).parents(".goal");
      var $validation = $(this).parents(".validation");
      var goalIdx = $content.find(".goal").index($goal);
      var valIdx = $goal.find(".validation").index($validation);
      var test = app.ui.query(app.ctrls.testQuery);
      console.log("change .validation .data-responseType", test, goalIdx, valIdx);
      $validation.replaceWith(render(test.goals[goalIdx].validations[valIdx], "card_validation"));
      setChanges(true);
    });
  },

  assets: function (render) {
    var $content = $("#content");

    if (app.state.hasScopePermissions()) {
      load().then(view);
    } else {
      app.ui.error(app.ui.locals.error_check_permissions, app.ui.locals.assets);
      return app.route.goToDefaultNav();
    }

    function load (context) {
      return Promise.resolve(_.assignIn(context || {}, {
        show: {
          createCtrls: app.state.hasCreatePermissions()
        }
      }))
        .then(app.context.queryAssets)
    }

    function view (context) {
      render(context);

      app.ui.base.content.header.sticky(true);
      $content.find(".assets").panels({ maxcolumns: 4 });
      $content.find(".animate-panel").animatePanel();
    }

    $content.on("input", ".js-search", function (ev) {
      if (this.to) clearTimeout(this.to);
      this.to = setTimeout(() => {
        var search = $(this).val();
        if (search.trim()) {
          $content.find(".asset").hide();
          $content.find(".asset").filter((idx, el) => $(el).text().includes(search)).show();
          $content.find(".assets").panels({ maxcolumns: 3 });
        } else {
          $content.find(".asset").show();
          $content.find(".assets").panels({ maxcolumns: 3 });
        }
      }, 750);
    });

    $content.on("click", ".js-create-asset", function (ev) {
      app.route.goTo(app.ctrls.asset, { create: true });
    });

    $content.on("click", ".js-remove-asset", function (ev) {
      var $asset = $(this).parents(".asset");
      app.ui.base.modal.load("confirm-modal.html", {}, (modalRenderer) => app.ctrls.confirmModal(modalRenderer, {
        title: app.ui.locals.confirm_remove.title,
        message: app.ui.locals.confirm_remove.message + "\n\n" +
                 $asset.find(".data-desc").text(),
        confirm: app.ui.locals.remove,
        cancel: app.ui.locals.cancel,
        onconfirm: removeAsset
      }));
      function removeAsset () {
        app.ws.delete("assets", $asset.attr("data-id"), (status, response) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_remove_data, app.ui.locals.asset);
          app.ui.success(app.ui.locals.success_remove_data, app.ui.locals.asset);
          $asset.remove();
          $content.find(".assets").panels({ maxcolumns: 4 });
        });
      }
    });
  },

  asset: function (render, params) {

    load({ create: params.create, assetId: params.id });

    var $content = $("#content");

    function load (context) {

      if (context.create) {
        return Promise.resolve({
          domainId: data.domainId,
          domain: null,
          asset: {
            description: "",
            properties: {},
            fields: []
          }
        }).then(app.context.queryDomains)
          .then(view);
      }

      Promise.resolve(_.extend({
        domainId: data.domainId,
        domain: null,
        asset: null
      }, context))
        .then(app.context.queryDomains)
        .then(app.context.queryAssets)
        .then(view);
    }

    function view (context) {
      console.log(context);
      render(context);

      app.ui.base.content.header.sticky(true);
      $content.find(".assets").panels({ maxcolumns: 3 });
      setChanges(false);
    }

    function setChanges (value) {
      app.ui.base.confirmChanges = value;
      if (value) $content.find(".js-save").show();
      else $content.find(".js-save").hide();
    }

    $content.on("click", ".js-save", function (ev) {
      var asset = app.ui.query(app.ctrls.assetQuery);
      if (params.create) {
        app.ws.insert("assets", asset, (status, id) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_insert_data, app.ui.locals.asset);
          app.ui.success(app.ui.locals.success_insert_data, app.ui.locals.asset);
          setChanges(false);
          app.route.goTo("/assets/" + id);
        });
      } else {
        app.ws.update("assets", { id: params.id }, asset, (status, response) => {
          if (status != Ws.Status.SUCCESS) return app.ui.error(app.ui.locals.error_update_data, app.ui.locals.test);
          app.ui.success(app.ui.locals.success_update_data, app.ui.locals.asset);
          setChanges(false);
        });
      }
    });

    $content.on("change", function (ev) {
      setChanges(true);
    });

    $content.on("click", ".js-move-up-row", function (ev) {
      var $rows = $(this).parents("tbody").find("tr");
      var $row = $(this).parents("tr");
      if ($rows.index($row) > 0) {
        $row.insertBefore($row.prev());
        setChanges(true);
      }
    });

    $content.on("click", ".js-move-down-row", function (ev) {
      var $rows = $(this).parents("tbody").find("tr");
      var $row = $(this).parents("tr");
      if ($rows.index($row) < $rows.length - 2) {
        $row.insertAfter($row.next());
        setChanges(true);
      }
    });

    $content.on("click", ".js-remove-row", function (ev) {
      $(this).parents("tr").remove();
      setChanges(true);
    });

    $content.on("keypress", ".js-add-property", function (ev) {
      if (ev.keyCode == 13) {
        var $this = $(this);
        var value = $this.val().trim();
        if (value && value.length > 0) {
          $(render({
            name: value,
            value: ""
          }, "property")).insertBefore($this.parents(".add-property"));
          $this.val("");
          setChanges(true);
        }
      }
    });

    $content.on("keypress", ".js-add-field", function (ev) {
      if (ev.keyCode == 13) {
        var $this = $(this);
        var value = $this.val().trim();
        if (value && value.length > 0) {
          $(render({
            field: value,
            format: "",
            label: ""
          }, "field")).insertBefore($this.parents(".add-field"));
          $this.val("");
          setChanges(true);
        }
      }
    });
  },

  confirmModal: function (render, params) {
    render(params);

    var $modal = $("#modal");

    $modal.on("click", ".js-confirm", function (ev) {
      params.onconfirm();
      $modal.modal("hide");
    });

    if (params.cancel) {
      $modal.on("click", ".js-cancel", function (ev) {
        params.oncancel && params.oncancel();
        $modal.modal("hide");
      });
    } else {
      $modal.find(".js-cancel").hide();
    }
  },

  selectModal: function (render, params) {
    var scopeDomains = app.state.getPermissions(data.const.scopeLevels);
    var domain = _.find(scopeDomains, { domainId: data.domainId });
    if (_.isEmpty(scopeDomains)) return app.ui.error(app.ui.locals.error_no_domain_available, app.ui.locals.select);
    if (!domain) domain = scopeDomains[0];

    var $modal = $("#modal");
    load().then(view);

    function load (context) {
      return Promise.resolve(_.assignIn(context || {}, {
        select: params.select,
        domainId: domain.domainId,
        domain: domain,
        domains: scopeDomains,
        collection: app.ui.locals[params.collection],
        items: []
      })).then(queryCollection);
    }

    function queryCollection (context) {
      return new Promise((resolve) => {
        var query = { shallow: true, limit: app.data.config.def_limit, domainId: context.domainId };
        if (params.onquery) params.onquery(query);
        app.ws.query(params.collection, query, (status, results) => {
          if (status == Ws.Status.SUCCESS) {
            results.forEach((result) => {
              context.items.push(params.onitem(result));
            });
          }
          resolve(context);
        });
      });
    }

    function view (context) {
      console.log(context);
      render(context);
    }

    function updateSelection (context) {
      console.log(context);
      $modal.find(".selection").html(render(context, "selection"));
    }

    $modal.on("click", ".js-select-domain", function (ev) {
      var $domain = $(this).parents(".domain");
      domain = _.find(data.permissions, { domainId: $domain.attr("data-id") });
      load().then(updateSelection);
      return false;
    });

    $modal.on("input", ".js-search-item", function (ev) {
      if (this.to) clearTimeout(this.to);
      this.to = setTimeout(() => {
        var search = $(this).val();
        if (search.trim()) {
          $modal.find(".item").hide();
          $modal.find(".item").filter((idx, el) => $(el).text().includes(search)).show();
        } else {
          $modal.find(".item").show();
        }
      }, 750);
    });

    $modal.on("click", ".js-select-item", function (ev) {
      var $item = $(this).parents(".item");
      params.onselect($item.attr("data-id"), domain.domainId);
      $modal.modal("hide");
      ev.preventDefault();
    });
  },


  ruleModal: function (render, params) {

    view({
      rule: params.edit || {
        matches: [],
        response: {
          delay: 0,
          data: ""
        }
      }
    });

    function view (context) {
      console.log(context);
      render(context);
    }

    var $modal = $("#modal");

    $modal.on("click", ".js-move-up-row", function (ev) {
      var $rows = $(this).parents("tbody").find("tr");
      var $row = $(this).parents("tr");
      if ($rows.index($row) > 0) {
        $row.insertBefore($row.prev());
      }
    });

    $modal.on("click", ".js-move-down-row", function (ev) {
      var $rows = $(this).parents("tbody").find("tr");
      var $row = $(this).parents("tr");
      if ($rows.index($row) < $rows.length - 2) {
        $row.insertAfter($row.next());
      }
    });

    $modal.on("click", ".js-remove-row", function (ev) {
      $(this).parents("tr").remove();
    });

    $modal.on("keypress", ".js-add-match-field", function (ev) {
      if (ev.keyCode == 13) {
        var $this = $(this);
        var value = $this.val().trim();
        if (value && value.length > 0) {
          $(render({ field: value, expr: "" }, "match")).insertBefore($this.parents(".add-match"));
          $this.val("");
        }
      }
    });

    $modal.on("click", ".js-save", function (ev) {
      var rule = app.ui.query(app.ctrls.ruleQuery, $modal);
      if (params.onsave) params.onsave(rule);
      $modal.modal("hide");
    });
  },

  txnModal: function (render, params) {

    var $modal = $("#modal");

    Promise.resolve({
      txnId: params.txnId,
      txn: params.txn
    }).then(app.context.queryTxns)
      .then(app.context.normalizeTxns)
      .then(app.context.queryExecutions)
      .then(view);

    function view (context) {
      console.log(context);
      if (!context.txn) return app.ui.error(app.ui.locals.data_not_found, app.ui.locals.transaction);
      render(context);
    }

    $modal.on("click", ".js-open-execution", function (ev) {
      var $execution = $(this).parents(".execution");
      $modal.modal("hide");
      app.route.goTo("/executions/" + data.domainId + "/" + $execution.attr("data-id"));
    });
  },

  runModal: function (render, params) {
    var execDomains = app.state.getPermissions(data.const.execLevels);
    var domain = _.find(execDomains, { domainId: data.domainId });
    if (_.isEmpty(execDomains)) return app.ui.error(app.ui.locals.error_no_domain_available, app.ui.locals.run);
    if (!domain) domain = execDomains[0];

    var $modal = $("#modal");
    load().then(view);

    function load () {
      return Promise.resolve({
        domain: domain,
        domains: execDomains,
        domainId: domain.domainId,
        select: params.select,
        runStatus: params.select ? params.select.status : undefined,
        runId: params.runId,
        run: params.edit
      }).then(app.context.queryRuns);
    }

    function view (context) {
      console.log(context);
      render(context);
    }

    function updateSelection (context) {
      console.log(context);
      $modal.find(".selection").html(render(context, "selection"));
    }

    $modal.on("click", ".js-select-domain", function (ev) {
      var $domain = $(this).parents(".domain");
      domain = _.find(data.permissions, { domainId: $domain.attr("data-id") });
      load().then(updateSelection);
      return false;
    });

    $modal.on("input", ".js-search-run", function (ev) {
      if (this.to) clearTimeout(this.to);
      this.to = setTimeout(() => {
        var search = $(this).val();
        if (search.trim()) {
          $modal.find(".runs .run").hide();
          $modal.find(".runs .run").filter((idx, el) => $(el).text().includes(search)).show();
        } else {
          $modal.find(".runs .run").show();
        }
      }, 750);
    });

    $modal.on("click", ".js-select-none", function (ev) {
      params.onselect(null, domain.domainId);
      $modal.modal("hide");
    });

    $modal.on("click", ".js-select-run", function (ev) {
      var $run = $(this).parents(".run");
      params.onselect($run.attr("data-id"), domain.domainId);
      $modal.modal("hide");
    });

    $modal.on("click", ".js-save", function (ev) {
      var run = app.ui.query(app.ctrls.runQuery, $modal);
      run.domainId = domain.domainId;
      params.onsave(run);
      $modal.modal("hide");
    });
  },

  issueModal: function (render, params) {

    Promise.resolve({
      domainId: data.domainId,
      list: params.list,
      runId: params.list ? params.list.runId : undefined,
      edit: params.edit,
      issueId: params.edit ? params.edit.issueId : undefined,
      save: !_.isUndefined(params.onsave)
    }).then(app.context.queryDomains)
      .then(app.context.queryIssues)
      .then(view);

    function view (context) {
      if (!context.issue) context.issue = params.edit;
      console.log(context);
      render(context);
    }

    var $modal = $("#modal");

    $modal.on("input", ".js-search-issue", function (ev) {
      if (this.to) clearTimeout(this.to);
      this.to = setTimeout(() => {
        var search = $(this).val();
        if (search.trim()) {
          $modal.find(".issue").hide();
          $modal.find(".issue").filter((idx, el) => $(el).text().includes(search)).show();
        } else {
          $modal.find(".issue").show();
        }
      }, 750);
    });

    $modal.on("click", ".js-select-issue", function (ev) {
      var $issue = $(this).parents(".issue");
      params.onselect($issue.attr("data-id"));
      $modal.modal("hide");
    });

    $modal.on("click", ".js-save", function (ev) {
      var issue = app.ui.query(app.ctrls.issueQuery, $modal);
      params.onsave(issue);
      $modal.modal("hide");
    });
  },

  reportModal: function (render, params) {

    view({
      report: params.report || {
        idx: -1,
        style: "",
        script: "",
        template: ""
      }
    });

    function view (context) {
      console.log(context);
      render(context);
    }

    var $modal = $("#modal");

    $modal.on("click", ".js-save", function (ev) {
      var report = app.ui.query(app.ctrls.reportQuery, $modal);
      params.onsave(report);
      $modal.modal("hide");
    });
  },

  vpayModal: function (render, params) {
    var $modal = $("#modal");

    view(_.assignIn({
      connectorBuild: data.config.vpay.connectorBuild
    }, params));

    function view (context) {
      render(context);
      connect();
    }

    function connect () {
      showVpayStatusWaiting();
      hideVpayConnectorChecks();

      app.vpay.getInfo((error, response) => {
        if (error) return setTimeout(connect, 1000);
        showVpayStatusConnected();
        showVpayConnectorChecks(response);
      });
    }

    function showVpayStatusWaiting () {
      $modal.find(".js-vpay-conn-status-waiting").show();
      $modal.find(".js-vpay-conn-status-active").hide();
    }

    function showVpayStatusConnected () {
      $modal.find(".js-vpay-conn-status-waiting").hide();
      $modal.find(".js-vpay-conn-status-active").show();
    }

    function hideVpayConnectorChecks (response) {
      $modal.find(".js-vpay-conn-checks").hide();
    }

    function showVpayConnectorChecks (response) {
      $modal.find(".data-vpay-conn-build").text(response.build);
      if (response.build >= data.config.vpay.connectorBuild) {
        $modal.find(".js-vpay-conn-build-check").show();
        $modal.find(".js-vpay-conn-build-fail").hide();
        $modal.find(".js-vpay-conn-build-outdated").hide();
      } else {
        $modal.find(".js-vpay-conn-build-check").hide();
        $modal.find(".js-vpay-conn-build-fail").show();
        $modal.find(".js-vpay-conn-build-outdated").show();
      }
      $modal.find(".js-vpay-conn-checks").show();
    }
  },

  vpayCardModal: function (render, params) {
    var $modal = $("#modal");
    view(params);

    function view (context) {

      context.card.atr = app.lib.prettifyHex(context.card.atr);
      _.forEach(context.card.log, (entry) => {
        entry.request = app.lib.prettifyHex(entry.request);
        entry.response = app.lib.prettifyHex(entry.response);
        entry.sw = app.lib.prettifyHex(entry.sw);
      });

      render(params);
    }
  },

  txnToolbar: function (render, params) {

    Promise.resolve({
      hostId: params.hostId,
      host: null,
    }).then(app.context.queryHosts)
      .then(view);

    var $toolbar = $("#toolbar");
    var ready = false;
    var modifiedSince = new Date();

    function view (context) {
      context.fields = data.txn.fields;
      console.log(context);
      render(context);
      ready = true;
    }

    $toolbar.on("update", function (ev) {
      if (!ready) return;

      console.log("Toolbar: Update txns..");

      return Promise.resolve({
        shallow: false,
        hostId: params.hostId,
        modifiedStart: modifiedSince
      }).then(app.context.queryTxns)
        .then(app.context.inflateTxns)
        .then(app.context.normalizeTxns)
        .then(function (context) {

        var html = "";

        _.forEach(context.txns, (txn) => {

          txn.request.primary = txn.request.primary || [];
          _.forEach(data.txn.fields, (name) => {
            var field = _.find(txn.request.fields, (field) => {
              return _.toLower(field.field).trim() == _.toLower(name).trim();
            });
            if (field) txn.request.primary.push(field);
          });

          var modified = new Date(txn.modified);
          if (modified > modifiedSince) modifiedSince = modified;
          modifiedSince = new Date(modifiedSince.getTime() + 1);

          var htmlel = render(txn, "txn");
          var $model = $toolbar.find(".txn[data-id='" + txn._id + "']");
          if ($model.length > 0) $model.replaceWith($(htmlel));
          else html += htmlel;
        });

        $(html).prependTo($toolbar.find(".txns"));
      });
    });

    $toolbar.on("click", ".js-move-up-field", function (ev) {
      var $fields = $(this).parents(".fields").find(".field");
      var $field = $(this).parents(".field");
      if ($fields.index($field) > 0) {
        $field.insertBefore($field.prev());
        saveFields();
      }
    });

    $toolbar.on("click", ".js-move-down-field", function (ev) {
      var $fields = $(this).parents(".fields").find(".field");
      var $field = $(this).parents(".field");
      if ($fields.index($field) < $fields.length - 1) {
        $field.insertAfter($field.next());
        saveFields();
      }
    });

    $toolbar.on("click", ".js-remove-field", function (ev) {
      var $field = $(this).parents(".field");
      $field.remove();
      saveFields();
    });

    $toolbar.on("keypress", ".add-field .js-field-value", function (ev) {
      if (ev.keyCode == 13) {
        var $this = $(this);
        var value = $this.val().trim();
        if (value && value.length > 0) {
          $(render({
            value: value
          }, "field")).insertBefore($this.parents(".add-field"));
          $this.val("");
        }
        saveFields();
      }
    });

    function saveFields () {
      data.txn.fields = [];
      $toolbar.find(".field .data-value").each((idx, el) => data.txn.fields.push($(el).text()));
      app.state.save();
    }

    $toolbar.on("click", ".js-view-txn", function (ev) {
      var $txn = $(this).parents(".txn");
      app.ui.base.modal.load("txn-modal.html", {}, (renderModal) => app.ctrls.txnModal(renderModal, {
        txnId: $txn.attr("data-id")
      }));
    });
  },

  ruleQuery: { $object: {
    idx: { $string: ".edit[data-idx]" },
    name: { $string: ".data-name" },
    matches: { $array: ".match", $object: {
      field: { $string: ".data-field" },
      expr: { $string: ".data-expr" }
    }},
    response: { $object: {
      data: { $string: ".data-response" }
    }}
  }},

  reportQuery: { $object: {
    idx: { $string: ".edit[data-idx]" },
    name: { $string: ".data-name" },
    style: { $string: ".data-style" },
    script: { $string: ".data-script" },
    template: { $string: ".data-template" }
  }},

  runQuery: { $object: {
    id: { $string: ".edit[data-id]" },
    status: { $string: ".data-status" },
    name: { $string: ".data-name" },
    description: { $string: ".data-desc" }
  }},

  executionQuery: { $object: {
    id: { $string: ".execution[data-id]" },
    status: { $string: ".execution[data-status]" },
    result: { $string: ".execution[data-result]" },
    issues: { $array: ".execution .issue", $string: "[data-id]" },
    test: { $object: {
      comment: { $string: ".data-comment" },
      assets: { $array: ".asset", $string: "[data-id]" },
      goals: { $array: ".goal", $index: { $numeric: "[data-idx]" }, $object: {
        type: { $string: "[data-type]" },
        choices: { _if: (obj) => obj.type == "user_input", $array: ".option:checked", $numeric: "[data-idx]" },
        comment: { $string: ".data-comment" },
        response: { _if: (obj) => obj.type == "txn_inbound", $object: {
            chainMode: { $string: ".data-chainMode" },
        }}
      }}
    }}
  }},

  issueQuery: { $object: {
    id: { $string: ".edit[data-id]" },
    type: { $string: ".data-type" },
    name: { $string: ".data-name" },
    description: { $string: ".data-desc" }
  }},

  scenarioQuery: { $object: {
    id: { $string: ".scenario[data-id]" },
    name: { $string: ".scenario .data-name" },
    description: { $string: ".scenario .data-desc" },
    tests: { $array: ".test", $string: "[data-id]" }
  }},

  testQuery: { $object: {
    id: { $string: ".test[data-id]" },
    label: { $string: ".data-label" },
    title: { $string: ".data-title" },
    description: { $string: ".data-desc" },
    assets: { $each: ".asset",
      $property: { $string: "[data-type]" }, $string: "[data-id]"
    },
    goals: { $array: ".goal", $set: [ { $object: {
      type: { $string: "[data-type]" },
      description: { $string: ".data-desc" }
    }}, {
      _if: (obj) => obj.type == "user_input", $object: {
      options: { $array: ".user-option", $string: ".data-value" },
      options_type: { $string: ".data-options_type:checked" },
      allow_comment: { $boolean: ".data-allow_comment" },
      require_comment: { $boolean: ".data-require_comment" }
    }}, {
      _if: (obj) => obj.type == "txn_inbound", $object: {
      request: { $object: {
        matches: { $array: ".match", $object: {
          field: { $string: ".data-field" },
          expr: { $string: ".data-expr" }
        }},
        validations: { $array: ".validation", $object: {
          field: { $string: ".data-field" },
          expr: { $string: ".data-expr" }
        }}
      }},
      response: { $object: {
        delay: { $numeric: ".data-delay" },
        chainMode: { $string: ".data-chainMode" },
        data: { $string: ".data-response" }
      }}
    }}, {
      _if: (obj) => obj.type == "txn_outbound", $object: {
      request: { $object: {
        target: { $string: ".data-target" },
        delay: { $numeric: ".data-delay" },
        timeout: { $numeric: ".data-timeout" },
        data: { $string: ".data-request" }
      }},
      response: { $object: {
        validations: { $array: ".validation", $object: {
          field: { $string: ".data-field" },
          expr: { $string: ".data-expr" }
        }}
      }}
    }}, {
      _if: (obj) => obj.type == "card_validation", $object: {
      label: { $string: ".data-label" },
      validations: { $array: ".validation", $object: {
        request: { $string: ".data-request" },
        expr: { $string: ".data-expr" },
        responseType: { $string: ".data-responseType" },
        response: { $string: ".data-response" },
        kMod: { $string: ".data-kmod" },
        kExp: { $string: ".data-kexp" },
        sw: { $string: ".data-sw" },
      }}
    }}]}
  }},

  assetQuery: { $object: {
    id: { $string: ".asset[data-id]" },
    type: { $string: ".data-type" },
    description: { $string: ".data-desc" },
    properties: { $each: ".property",
      $property: { $string: ".data-name" },
      $string: ".data-value"
    },
    fields: { $array: ".field", $object: {
      field: { $string: ".data-field" },
      format: { $string: ".data-format" },
      description: { $string: ".data-desc" }
    }}
  }}
};
