(function ($) {

  $.fn.panels = function (options) {

    var settings = $.extend({
      selection: '.panel',
      maxcolumns: 4,
      bestfit: false,
      screensize: 'md',
    }, options);

    this.each(function () {
      var $root = $(this);

      function organize () {
        var colspan, $panels, $row, coln;

        $panels = $root.find(settings.selection);
        colspan = settings.bestfit && $panels.length <= settings.maxcolumns ? Math.floor(12 / $panels.length) : Math.floor(12 / settings.maxcolumns);
        $row = null;
        coln = 0;
        $root.empty();
        $panels.each(function () {
          if ($row == null || coln >= settings.maxcolumns) {
            $row = $('<div class="row"></div>').appendTo($root);
            coln = 0;
          }
          var $col = $row;
          if ($(this).css("display") != "none") {
            $col = $("<div class='col-" + settings.screensize + "-" + colspan + "'></div>").appendTo($row);
            coln++;
          }

          $(this).appendTo($col);
        });
      }

      organize();
    });

    return this;
  };

}(jQuery));
