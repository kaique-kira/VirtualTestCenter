(function ($) {

  $.fn.editable = function (options) {

    var settings = $.extend({
      maxlines: 1
    }, options);

    this.each(function () {
      var $root = $(this);

      function update () {
        var nodes, prev;

        nodes = $root.contents();
        prev = null;
        for (var idx = 0; idx < nodes.length; idx++) {
          node = nodes[idx];
          var nodeName = node.nodeName.toLowerCase();
          if (idx >= settings.maxlines) {
            node.remove();
          } else if (nodeName == "#text") {
            node.nodeValue = node.nodeValue.trim().replace("\n", "");
          }
          if (settings.maxlines > 1 && nodeName != "p") {
            $(node).replaceWith("<p>" + node.textContent.trim() + "</p>");
          }
          prev = node;
        }
      }

      $root.attr("contenteditable", "true");
      $root.on("keydown", function (ev) {
        if ($root.contents().length >= settings.maxlines && ev.keyCode == 13) return false;
      });
      $root.on("input paste", update);
      update();
    });

    return this;
  };

}(jQuery));
