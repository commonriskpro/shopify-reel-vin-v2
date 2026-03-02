(function () {
  const container = document.querySelector('[data-product-linked-reel]');
  if (!container) return;

  const apiUrl = container.dataset.reelsApiUrl;
  const productHandle = (container.dataset.productHandle || '').trim().toLowerCase();
  if (!apiUrl || !apiUrl.startsWith('http') || !productHandle) {
    container.querySelector('.product__linked-reel-loading')?.remove();
    return;
  }

  const loadingEl = container.querySelector('.product__linked-reel-loading');
  const separator = apiUrl.indexOf('?') !== -1 ? '&' : '?';
  const url = apiUrl + separator + 'product_handle=' + encodeURIComponent(productHandle) + '&_=' + Date.now();

  fetch(url, { cache: 'no-store' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      const reels = (data && data.reels) ? data.reels : [];
      loadingEl?.remove();
      if (reels.length === 0) {
        container.style.display = 'none';
        return;
      }
      const reel = reels[0];
      const playbackUrl = reel.playback_url || reel.media_url || '';
      const posterUrl = reel.poster_url || reel.thumbnail_url || '';
      if (!playbackUrl && !posterUrl) {
        container.style.display = 'none';
        return;
      }
      var priceText = (reel.formatted_price || reel.price || '').toString().trim();
      if (!priceText && reel.products && reel.products.length > 0 && reel.products[0].price) {
        priceText = reel.products[0].price;
      }
      if (priceText) {
        var priceEl = document.createElement('p');
        priceEl.className = 'product__linked-reel-price';
        priceEl.textContent = priceText;
        container.appendChild(priceEl);
      }
      const wrap = document.createElement('div');
      wrap.className = 'product__linked-reel-video-wrap';
      const video = document.createElement('video');
      video.className = 'product__linked-reel-video';
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('controlsList', 'nodownload');
      if (posterUrl) video.poster = posterUrl;
      if (playbackUrl) {
        video.src = playbackUrl;
        video.load();
      }
      wrap.appendChild(video);
      container.appendChild(wrap);
      container.classList.add('product__linked-reel--has-reel');
    })
    .catch(function () {
      loadingEl?.remove();
      container.style.display = 'none';
    });
})();
