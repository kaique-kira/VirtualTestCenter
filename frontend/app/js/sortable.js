(function ($) {

  $.fn.sortable = function (options) {

    var start, dragging, $dragEl, $dragDst, dragX, dragY;

    var settings = $.extend({
      selector: 'li',
      handle: '.draggable',
      delay: 250,
      ondragclass: 'dragging',
      ondragstart: null,
      ondragend: null
    }, options);

    this.each(function () {
      var $root = $(this);

      $root.on('mousedown', settings.handle, function (ev) {
        start = new Date().getTime();
        $dragEl = $(ev.target).closest(settings.selector);
        dragX = ev.pageX;
        dragY = ev.pageY;
        $root.on('mousemove', onmousemove);
        $root.on('click', settings.handle, noclick);
        dragging = false;
        ev.preventDefault();
      });

      $root.on('mouseup', function (ev) {
        if (dragging) {
          dragging = false;
          $('body').css('user-select', '');
          $dragEl.css('transform', '');
          if (settings.ondragclass) $dragEl.removeClass(settings.ondragclass);
          if (settings.ondragend) settings.ondragend($dragEl.get(0));
        }
        if ($dragDst) {
          $dragEl.insertBefore($dragDst);
          $dragDst.css('margin-top', '');
          $dragDst.css('border-top', '');
          $dragDst = null;
        }
        $root.off('mousemove', onmousemove);
      });

      function noclick (ev) {
        $root.off('click', settings.handle, noclick);
        var now = new Date().getTime();
        if (now - start > settings.delay) {
          ev.stopPropagation();
          return false;
        }
      }

      function onmousemove (ev) {
        var now = new Date().getTime();
        if (now - start > settings.delay) {
          if (!dragging) {
            dragging = true;
            $('body').css('user-select', 'none');
            if (settings.ondragclass) $dragEl.addClass(settings.ondragclass);
            if (settings.ondragstart) settings.ondragstart($dragEl.get(0));
          }
          $dragEl.css('transform', 'translate(' +
            (ev.pageX - dragX) + 'px, ' +
            (ev.pageY - dragY) + 'px)');
          $dragEl.hide();
          var el = document.elementFromPoint(ev.clientX, ev.clientY);
          $dragEl.show();
          if ($dragDst) $dragDst.css('border-top', '');
          $dragDst = $(el).closest(settings.selector);
          $dragDst.css('margin-top', $dragEl.outerHeight());
          $dragDst.css('border-top', '1px solid black');
          ev.preventDefault();
        }
      }
    });

    return this;
  };

}(jQuery));
