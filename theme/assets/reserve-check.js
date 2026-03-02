/**
 * One reserve per vehicle: prevent adding a second hold for the same vehicle/VIN.
 * Reserve links with class js-reserve-button and data-reserve-url, data-reserve-vehicle, data-reserve-vin
 * are intercepted (including dynamically added ones, e.g. reel modal); we check the cart and only
 * allow add if this vehicle is not already in cart.
 */
(function () {
  document.addEventListener('click', function (e) {
    var link = e.target && e.target.closest ? e.target.closest('a.js-reserve-button[data-reserve-url]') : null;
    if (!link) return;
    var url = link.getAttribute('data-reserve-url');
    var vehicle = link.getAttribute('data-reserve-vehicle') || '';
    var vin = (link.getAttribute('data-reserve-vin') || '').trim();
    if (!url) return;
    e.preventDefault();
    fetch('/cart.js')
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var items = cart.items || [];
        for (var i = 0; i < items.length; i++) {
          var props = items[i].properties;
          if (!props) continue;
          if ((props.Vehicle !== undefined && props.Vehicle === vehicle) ||
              (vin && props.VIN !== undefined && String(props.VIN).trim() === vin)) {
            alert('You already have this vehicle on reserve. Only one reserve per vehicle is allowed.');
            return;
          }
        }
        window.location.href = url;
      })
      .catch(function () {
        window.location.href = url;
      });
  });
})();
