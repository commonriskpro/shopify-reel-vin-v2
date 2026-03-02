(function () {
  const section = document.querySelector('[data-shoppable-reels]');
  if (!section) return;

  const apiUrl = section.dataset.reelsApiUrl;
  if (!apiUrl || !apiUrl.startsWith('http')) {
    renderEmpty(section, 'Add your Reels API URL in the section settings.');
    return;
  }

  const grid = section.querySelector('[data-reels-grid]');
  const productBaseUrl = section.dataset.productsBaseUrl || '/products/';
  const homepageOnly = section.dataset.homepageOnly === 'true';

  // Create skeleton loading UI immediately
  createSkeletonUI(grid);
  
  // Try to load from cache first
  const cacheKey = `reels_${apiUrl}_${homepageOnly}`;
  const cachedData = getCachedReels(cacheKey);
  
  if (cachedData) {
    // Render cached data immediately
    setTimeout(() => {
      renderReels(grid, cachedData.reels, productBaseUrl);
      console.log('[Reels] Loaded from cache');
    }, 0);
  }
  
  // Use Intersection Observer to load when section is visible
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        loadReels();
        observer.unobserve(entry.target);
      }
    });
  }, {
    rootMargin: '200px', // Load 200px before section becomes visible
    threshold: 0.1
  });
  
  observer.observe(section);
  
  // Also load immediately if section is already visible
  if (isElementInViewport(section)) {
    loadReels();
  }
  
  function loadReels() {
    // Build URL with cache busting only if not using cache
    var url = apiUrl.indexOf('?') !== -1 ? apiUrl + '&' : apiUrl + '?';
    if (homepageOnly) url += 'homepage=1&';
    url += '_=' + Date.now();
    
    // Use fetch with AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    fetch(url, { 
      cache: 'no-store',
      signal: controller.signal
    })
      .then((res) => {
        clearTimeout(timeoutId);
        return res.json();
      })
      .then((data) => {
        const reels = (data && data.reels) ? data.reels : [];
        if (reels.length === 0) {
          renderEmpty(section, 'No reels yet. Run a sync or add reels in Instagram.');
          return;
        }
        
        // Cache the response
        cacheReels(cacheKey, { reels, timestamp: Date.now() });
        
        // Render the reels
        renderReels(grid, reels, productBaseUrl);
        console.log('[Reels] Loaded fresh from API');
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          console.warn('[Reels] Request timed out');
        }
        
        // If we have cached data, use it even on error
        if (!cachedData) {
          renderError(section, 'Could not load reels. Check the API URL and CORS.');
          console.error('Shoppable reels:', err);
        }
      });
  }
  
  function createSkeletonUI(gridEl) {
    gridEl.innerHTML = '';
    gridEl.className = 'shoppable-reels__grid shoppable-reels__grid--cards';
    
    // Create 3 skeleton cards
    for (let i = 0; i < 3; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'shoppable-reels__card shoppable-reels__card--skeleton';
      skeleton.innerHTML = `
        <div class="shoppable-reels__card-thumb shoppable-reels__card-thumb--skeleton"></div>
        <div class="shoppable-reels__card-caption shoppable-reels__card-caption--skeleton"></div>
      `;
      gridEl.appendChild(skeleton);
    }
  }
  
  function getCachedReels(key) {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) return null;
      
      const data = JSON.parse(cached);
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      
      // Cache valid for 1 hour
      if (now - data.timestamp < oneHour) {
        return data;
      } else {
        // Cache expired, remove it
        localStorage.removeItem(key);
        return null;
      }
    } catch (e) {
      return null;
    }
  }
  
  function cacheReels(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      // localStorage might be full or not available
      console.warn('[Reels] Could not cache data:', e);
    }
  }
  
  function isElementInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
      rect.top <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.bottom >= 0
    );
  }

  function renderEmpty(container, message) {
    const wrap = container.querySelector('[data-reels-grid]') && container.querySelector('[data-reels-grid]').parentElement || container;
    const el = document.createElement('p');
    el.className = 'shoppable-reels__empty';
    el.textContent = message;
    const grid = container.querySelector('[data-reels-grid]');
    if (grid) grid.replaceWith(el);
    else wrap.appendChild(el);
  }

  function renderError(container, message) {
    const wrap = container.querySelector('[data-reels-grid]') && container.querySelector('[data-reels-grid]').parentElement || container;
    const el = document.createElement('p');
    el.className = 'shoppable-reels__error';
    el.textContent = message;
    const grid = container.querySelector('[data-reels-grid]');
    if (grid) grid.replaceWith(el);
    else wrap.appendChild(el);
  }

  let reelsData = [];
  let baseUrlData = '';

  function renderReels(gridEl, reels, baseUrl) {
    reelsData = reels;
    baseUrlData = baseUrl;
    gridEl.innerHTML = '';
    gridEl.className = 'shoppable-reels__grid shoppable-reels__grid--cards';

    reels.forEach(function (reel, index) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'shoppable-reels__card';
      card.setAttribute('data-reel-index', index);
      card.style.setProperty('--reel-index', String(index));

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'shoppable-reels__card-thumb';
      const cardThumbUrl = reel.poster_url || reel.thumbnail_url || '';
      if (cardThumbUrl) {
        const img = document.createElement('img');
        img.src = cardThumbUrl;
        img.alt = (reel.caption || '').slice(0, 100);
        img.loading = 'lazy';
        img.decoding = 'async';
        thumbWrap.appendChild(img);
      }
      const playIcon = document.createElement('span');
      playIcon.className = 'shoppable-reels__card-play';
      playIcon.setAttribute('aria-hidden', 'true');
      thumbWrap.appendChild(playIcon);
      const label = document.createElement('span');
      label.className = 'shoppable-reels__card-label';
      label.textContent = (reel.product_handles && reel.product_handles.length) ? 'Shop the reel' : 'Watch';
      thumbWrap.appendChild(label);
      card.appendChild(thumbWrap);
      if (reel.caption) {
        const cap = document.createElement('p');
        cap.className = 'shoppable-reels__card-caption';
        cap.textContent = reel.caption.slice(0, 60) + (reel.caption.length > 60 ? '…' : '');
        card.appendChild(cap);
      }
      card.addEventListener('click', function (e) {
        if (section._carouselDidDrag) {
          section._carouselDidDrag = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        openModal(index);
      });
      gridEl.appendChild(card);
    });

    createModal(section, gridEl, reels, baseUrl);

    var carousel = section.querySelector('[data-reels-carousel]');
    var scrollContainer = gridEl;
    var prevBtn = carousel && carousel.querySelector('[data-carousel-prev]');
    var nextBtn = carousel && carousel.querySelector('[data-carousel-next]');
    if (carousel && scrollContainer && reels.length > 0) {
      function getScrollStep(el) {
        var card = el.querySelector('.shoppable-reels__card');
        var gap = 0;
        if (window.getComputedStyle) {
          var styles = window.getComputedStyle(el);
          gap = parseFloat(styles.columnGap || styles.gap || '0') || 0;
        }
        if (card) {
          return Math.max(card.getBoundingClientRect().width + gap, Math.round(el.clientWidth * 0.75));
        }
        return Math.max(220, Math.round(el.clientWidth * 0.75));
      }
      function scrollByStep(direction) {
        var el = section.querySelector('[data-reels-grid]');
        if (!el) return;
        var step = getScrollStep(el) * direction;
        var maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
        var nextLeft = el.scrollLeft + step;
        if (nextLeft < 0) nextLeft = 0;
        if (nextLeft > maxLeft) nextLeft = maxLeft;
        el.scrollTo({ left: nextLeft, behavior: 'smooth' });
      }
      function scrollToPrevCard() {
        scrollByStep(-1);
      }
      function scrollToNextCard() {
        scrollByStep(1);
      }
      if (prevBtn) prevBtn.removeAttribute('hidden');
      if (nextBtn) nextBtn.removeAttribute('hidden');
      /* Delegate from section so next/prev always work (click and touch) */
      section.addEventListener('click', function carouselClick(e) {
        var target = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
        if (!target) return;
        var inCarousel = carousel.contains(target);
        if (!inCarousel) return;
        var next = target.closest('[data-carousel-next]');
        var prev = target.closest('[data-carousel-prev]');
        if (next) {
          e.preventDefault();
          e.stopPropagation();
          scrollToNextCard();
          return;
        }
        if (prev) {
          e.preventDefault();
          e.stopPropagation();
          scrollToPrevCard();
          return;
        }
        /* Edge tap: click in left/right zone of carousel */
        var rect = carousel.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var edgeZone = 56;
        if (x >= 0 && x <= edgeZone) {
          e.preventDefault();
          scrollToPrevCard();
        } else if (x >= rect.width - edgeZone && x <= rect.width) {
          e.preventDefault();
          scrollToNextCard();
        }
      }, true);
      var carouselTouchStartX = 0;
      var carouselTouchStartY = 0;
      section.addEventListener('touchstart', function (e) {
        if (!carousel.contains(e.target)) return;
        var t = e.touches && e.touches[0];
        if (t) {
          carouselTouchStartX = t.clientX;
          carouselTouchStartY = t.clientY;
        }
      }, { passive: true, capture: true });
      section.addEventListener('touchend', function (e) {
        var touch = e.changedTouches && e.changedTouches[0];
        if (!touch) return;
        var rect = carousel.getBoundingClientRect();
        var x = touch.clientX - rect.left;
        var y = touch.clientY - rect.top;
        if (x < 0 || x > rect.width || y < 0 || y > rect.height) return;
        var moveX = Math.abs(touch.clientX - carouselTouchStartX);
        var moveY = Math.abs(touch.clientY - carouselTouchStartY);
        if (moveX > 45 || moveY > 45) return;
        var edgeZone = 56;
        if (x >= 0 && x <= edgeZone) {
          e.preventDefault();
          e.stopPropagation();
          scrollToPrevCard();
        } else if (x >= rect.width - edgeZone && x <= rect.width) {
          e.preventDefault();
          e.stopPropagation();
          scrollToNextCard();
        } else {
          var under = document.elementFromPoint(touch.clientX, touch.clientY);
          if (under && carousel.contains(under)) {
            if (under.closest('[data-carousel-next]')) {
              e.preventDefault();
              e.stopPropagation();
              scrollToNextCard();
            } else if (under.closest('[data-carousel-prev]')) {
              e.preventDefault();
              e.stopPropagation();
              scrollToPrevCard();
            }
          }
        }
      }, { passive: false, capture: true });

      /* Mouse drag + momentum (smartphone-like with mouse) */
      var dragStartX = 0;
      var dragStartScrollLeft = 0;
      var lastScrollLeft = 0;
      var lastScrollT = 0;
      var inertiaRaf = 0;
      function getMaxScroll() {
        return Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
      }
      function clampScroll(value) {
        return Math.max(0, Math.min(value, getMaxScroll()));
      }
      function onCarouselMouseMove(e) {
        var dx = dragStartX - e.clientX;
        var next = dragStartScrollLeft + dx;
        scrollContainer.scrollLeft = clampScroll(next);
        lastScrollLeft = scrollContainer.scrollLeft;
        lastScrollT = Date.now();
      }
      function onCarouselMouseUp() {
        var moved = Math.abs(scrollContainer.scrollLeft - dragStartScrollLeft) > 5;
        if (moved) section._carouselDidDrag = true;
        document.removeEventListener('mousemove', onCarouselMouseMove);
        document.removeEventListener('mouseup', onCarouselMouseUp);
        scrollContainer.style.cursor = 'grab';
        scrollContainer.style.userSelect = '';
        document.body.style.userSelect = '';

        /* Momentum: continue scroll with deceleration like touch swipe */
        var dt = Date.now() - lastScrollT;
        if (dt <= 0) return;
        var velocity = (scrollContainer.scrollLeft - lastScrollLeft) / dt; /* px/ms */
        if (Math.abs(velocity) < 0.15) return;
        var friction = 0.92;
        function inertiaStep() {
          velocity *= friction;
          if (Math.abs(velocity) < 0.08) return;
          var maxLeft = getMaxScroll();
          var next = scrollContainer.scrollLeft + velocity * 14;
          next = Math.max(0, Math.min(next, maxLeft));
          scrollContainer.scrollLeft = next;
          if (next <= 0 || next >= maxLeft) velocity = 0;
          inertiaRaf = requestAnimationFrame(inertiaStep);
        }
        if (inertiaRaf) cancelAnimationFrame(inertiaRaf);
        inertiaRaf = requestAnimationFrame(inertiaStep);
      }
      scrollContainer.addEventListener('mousedown', function (e) {
        if (e.button !== 0 || !carousel.contains(e.target)) return;
        /* Only ignore prev/next arrows; allow drag when clicking on a reel card */
        if (e.target.closest('[data-carousel-prev]') || e.target.closest('[data-carousel-next]')) return;
        stopArrowAnimation();
        if (inertiaRaf) {
          cancelAnimationFrame(inertiaRaf);
          inertiaRaf = 0;
        }
        dragStartX = e.clientX;
        dragStartScrollLeft = scrollContainer.scrollLeft;
        lastScrollLeft = scrollContainer.scrollLeft;
        lastScrollT = Date.now();
        section._carouselDidDrag = false;
        scrollContainer.style.cursor = 'grabbing';
        scrollContainer.style.userSelect = 'none';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onCarouselMouseMove);
        document.addEventListener('mouseup', onCarouselMouseUp);
      });
      scrollContainer.style.cursor = 'grab';
    }
  }

  function createModal(section, gridEl, reels, baseUrl) {
    const existing = section.querySelector('.shoppable-reels__modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'shoppable-reels__modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Reel');

    const inner = document.createElement('div');
    inner.className = 'shoppable-reels__modal-inner';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'shoppable-reels__modal-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', closeModal);

    const content = document.createElement('div');
    content.className = 'shoppable-reels__modal-content';

    const videoCol = document.createElement('div');
    videoCol.className = 'shoppable-reels__modal-video-col';
    var prevArrowUrl = section.dataset.prevArrowUrl || '';
    var nextArrowUrl = section.dataset.nextArrowUrl || '';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'shoppable-reels__modal-nav shoppable-reels__modal-nav--prev';
    prevBtn.setAttribute('aria-label', 'Previous reel');
    prevBtn.innerHTML = prevArrowUrl ? '<img src="' + prevArrowUrl + '" alt="" width="24" height="24" aria-hidden="true">' : '&#10094;';
    prevBtn.addEventListener('click', function () {
      var i = parseInt(overlay.getAttribute('data-current-index'), 10) - 1;
      if (i < 0) i = reels.length - 1;
      overlay.classList.add('shoppable-reels__modal--transitioning');
      setTimeout(function () {
        openModal(i);
        overlay.classList.remove('shoppable-reels__modal--transitioning');
      }, 180);
    });
    const videoWrap = document.createElement('div');
    videoWrap.className = 'shoppable-reels__modal-video-wrap';
    const videoEl = document.createElement('video');
    videoEl.controls = false;
    videoEl.setAttribute('controlsList', 'nodownload nofullscreen noremoteplayback');
    videoEl.disablePictureInPicture = true;
    videoEl.playsInline = true;
    videoEl.preload = 'metadata';
    videoWrap.appendChild(videoEl);
    const playOverlay = document.createElement('button');
    playOverlay.type = 'button';
    playOverlay.className = 'shoppable-reels__modal-video-play-overlay';
    playOverlay.setAttribute('aria-label', 'Play video');
    playOverlay.innerHTML = '<span class="shoppable-reels__modal-video-play-icon" aria-hidden="true"></span>';
    videoWrap.appendChild(playOverlay);
    function togglePlay() {
      if (videoEl.paused) {
        videoEl.play();
        playOverlay.classList.add('is-playing');
      } else {
        videoEl.pause();
        playOverlay.classList.remove('is-playing');
      }
    }
    videoEl.addEventListener('play', function () { playOverlay.classList.add('is-playing'); });
    videoEl.addEventListener('pause', function () { playOverlay.classList.remove('is-playing'); });
    videoEl.addEventListener('click', function (e) { e.preventDefault(); togglePlay(); });
    playOverlay.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); togglePlay(); });
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'shoppable-reels__modal-nav shoppable-reels__modal-nav--next';
    nextBtn.setAttribute('aria-label', 'Next reel');
    nextBtn.innerHTML = nextArrowUrl ? '<img src="' + nextArrowUrl + '" alt="" width="24" height="24" aria-hidden="true">' : '&#10095;';
    nextBtn.addEventListener('click', function () {
      var i = parseInt(overlay.getAttribute('data-current-index'), 10) + 1;
      if (i >= reels.length) i = 0;
      overlay.classList.add('shoppable-reels__modal--transitioning');
      setTimeout(function () {
        openModal(i);
        overlay.classList.remove('shoppable-reels__modal--transitioning');
      }, 180);
    });
    videoCol.appendChild(videoWrap);

    const panelCol = document.createElement('div');
    panelCol.className = 'shoppable-reels__modal-panel-col';
    const panel = document.createElement('div');
    panel.className = 'shoppable-reels__modal-panel';
    panel.appendChild(createPanelHandle());
    const panelBody = document.createElement('div');
    panelBody.className = 'shoppable-reels__modal-panel-body';
    panel.appendChild(panelBody);

    content.appendChild(videoCol);
    content.appendChild(panelCol);
    panelCol.appendChild(panel);

    inner.appendChild(content);
    overlay.appendChild(prevBtn);
    overlay.appendChild(inner);
    overlay.appendChild(nextBtn);
    overlay.appendChild(closeBtn);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', function onKey(e) {
      if (overlay.getAttribute('aria-hidden') === 'true') return;
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onKey); }
      if (e.key === 'ArrowLeft') prevBtn.click();
      if (e.key === 'ArrowRight') nextBtn.click();
    });

    overlay.setAttribute('aria-hidden', 'true');
    section.appendChild(overlay);

    overlay._videoEl = videoEl;
    overlay._playOverlay = playOverlay;
    overlay._panelBody = panelBody;
    overlay._reels = reels;
    overlay._baseUrl = baseUrl;
  }

  function openModal(index) {
    const modal = section.querySelector('.shoppable-reels__modal');
    if (!modal || !reelsData.length) return;
    const reels = modal._reels || reelsData;
    var baseUrl = section.dataset.productsBaseUrl || modal._baseUrl || baseUrlData || '';
    const reel = reels[index];
    if (!reel) return;

    modal.setAttribute('data-current-index', index);
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('shoppable-reels__modal--open');
    document.body.style.overflow = 'hidden';

    const videoEl = modal._videoEl;
    const panelBody = modal._panelBody;
    panelBody.innerHTML = '';

    if (reel.caption && String(reel.caption).trim()) {
      const captionEl = document.createElement('p');
      captionEl.className = 'shoppable-reels__modal-caption';
      captionEl.textContent = String(reel.caption).trim();
      panelBody.appendChild(captionEl);
    }

    const playbackUrl = reel.playback_url || reel.media_url || '';
    const posterUrl = reel.poster_url || reel.thumbnail_url || '';
    if (playbackUrl) {
      videoEl.style.display = '';
      videoEl.src = playbackUrl;
      if (posterUrl) {
        videoEl.poster = posterUrl;
      } else {
        videoEl.removeAttribute('poster');
      }
      videoEl.load();
      if (modal._playOverlay) modal._playOverlay.classList.remove('is-playing');
      videoEl.play().catch(function () {});
    } else if (posterUrl) {
      videoEl.style.display = 'none';
    }

    const productHandles = reel.product_handles || [];
    var baseUrl = section.dataset.productsBaseUrl || modal._baseUrl || baseUrlData || '';
    var productBase = (baseUrl || '').replace(/\/?$/, '');

    if (productHandles.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'shoppable-reels__modal-panel-empty';
      empty.textContent = 'No products linked to this reel.';
      panelBody.appendChild(empty);
    } else {
      var baseForFetch = baseUrl || (window.location.origin + '/products/');
      var baseForLinks = productBase || (window.location.origin + '/products');
      productHandles.forEach(function (handle, idx) {
        fetchProduct(baseForFetch, handle, function (product) {
          if (product) {
            try {
              panelBody.appendChild(renderProductPanel(product, baseForLinks, idx === 0));
            } catch (err) {
              console.error('Shoppable reels: panel render failed', err);
              var fallback = document.createElement('div');
              fallback.className = 'shoppable-reels__panel-card shoppable-reels__panel-card--active';
              var v = product.variants && product.variants[0];
              fallback.innerHTML = '<h3 class="shoppable-reels__panel-title">' + escapeHtml(product.title || '') + '</h3><p class="shoppable-reels__panel-price">' + (v && v.price ? escapeHtml(formatMoney(v.price)) : '') + '</p>';
              panelBody.appendChild(fallback);
            }
          }
        });
      });
    }

    var prevBtn = modal.querySelector('.shoppable-reels__modal-nav--prev');
    var nextBtn = modal.querySelector('.shoppable-reels__modal-nav--next');
    if (prevBtn) prevBtn.style.visibility = reels.length > 1 ? 'visible' : 'hidden';
    if (nextBtn) nextBtn.style.visibility = reels.length > 1 ? 'visible' : 'hidden';
  }

  function closeModal() {
    const modal = section.querySelector('.shoppable-reels__modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('shoppable-reels__modal--open');
    document.body.style.overflow = '';
    if (modal._videoEl) {
      modal._videoEl.pause();
      modal._videoEl.removeAttribute('src');
    }
  }

  function createPanelHandle() {
    const handle = document.createElement('div');
    handle.className = 'shoppable-reels__panel-handle';
    handle.setAttribute('aria-hidden', 'true');
    return handle;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  var vehicleDetailIcons = {
    vin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
    year: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>',
    make: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/></svg>',
    model: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    trim: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0z"/></svg>',
    bodyStyle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 17h14v-5H5v5z"/><path d="M5 9l2-4h10l2 4"/><path d="M7 17v2"/><path d="M17 17v2"/></svg>',
    engine: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/></svg>',
    fuel: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21v-4h2v4z"/><path d="M15 21v-4h2v4z"/><path d="M19 10V8h-2V4h-2v10h4v-2h2z"/><path d="M5 10V4H3v14h4v-6h2V10H5z"/></svg>',
    drive: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    transmission: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/></svg>',
    manufacturer: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>'
  };

  function getOptionName(opt) {
    if (opt == null) return '';
    if (typeof opt === 'string') return opt;
    if (typeof opt === 'object' && opt !== null && typeof opt.name === 'string') return opt.name;
    return String(opt);
  }

  function normalizeBodyType(val) {
    if (val == null || String(val).trim() === '') return '';
    var s = String(val).trim();
    var u = s.toUpperCase();
    if (u.indexOf('PICKUP') !== -1 || u.indexOf('TRUCK') !== -1) return 'Pickup';
    if (u.indexOf('SUV') !== -1 || u.indexOf('SPORT UTILITY') !== -1 || u.indexOf('MULTI-PURPOSE') !== -1 || u.indexOf('MPV') !== -1) return 'SUV';
    if (u.indexOf('SEDAN') !== -1 || u.indexOf('PASSENGER CAR') !== -1) return 'SEDAN';
    if (u.indexOf('COUPE') !== -1) return 'COUPE';
    if (u.indexOf('HATCHBACK') !== -1) return 'HATCHBACK';
    if (u.indexOf('CONVERTIBLE') !== -1) return 'CONVERTIBLE';
    if (u.indexOf('WAGON') !== -1) return 'WAGON';
    if (u.indexOf('VAN') !== -1 || u.indexOf('MINIVAN') !== -1) return 'VAN';
    return s;
  }

  function getVehicleDetails(product, variant) {
    var out = [];
    var v = variant || (product.variants && product.variants[0]);
    var opts = product.options || [];
    function add(key, label, value, iconKey) {
      if (value == null || String(value).trim() === '') return;
      out.push({ label: label, value: String(value).trim(), icon: vehicleDetailIcons[iconKey] || vehicleDetailIcons.vin });
    }
    function getMeta(ns, key) {
      var m = product.metafields;
      if (!m) return null;
      if (m[ns] && m[ns][key]) return m[ns][key];
      var keys = Object.keys(m);
      for (var i = 0; i < keys.length; i++) {
        var val = m[keys[i]];
        if (val && typeof val === 'object' && val[key] != null) return val[key];
      }
      return null;
    }
    function getVehicle(key) {
      var vh = product.vehicle;
      if (vh && vh[key] != null) return vh[key];
      var meta = getMeta('vehicle', key) || getMeta('custom', key) || getMeta('descriptors', key);
      if (meta != null) return meta;
      if ((key === 'vin' || key === 'VIN') && product.description) {
        var vinMatch = product.description.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
        if (vinMatch) return vinMatch[1];
      }
      return null;
    }
    var yearFromTitle = product.title && product.title.match(/^\s*(\d{4})/);
    var titleParts = product.title && product.title.replace(/^\s*\d{4}\s+/, '').trim().split(/\s+/);
    var opt0 = getOptionName(opts[0]);
    var opt1 = getOptionName(opts[1]);
    var opt2 = getOptionName(opts[2]);
    var opt3 = getOptionName(opts[3]);
    add('vin', 'VIN:', getVehicle('vin') || getVehicle('VIN'), 'vin');
    add('year', 'Year:', getVehicle('year') || (v && opt0 && opt0.toLowerCase().indexOf('year') !== -1 && v.option1 ? v.option1 : null) || (yearFromTitle ? yearFromTitle[1] : null), 'year');
    add('make', 'Make:', getVehicle('make') || (v && opt1 && opt1.toLowerCase().indexOf('make') !== -1 ? v.option2 : null) || (titleParts && titleParts[0]) || null, 'make');
    add('model', 'Model:', getVehicle('model') || (v && opt2 && opt2.toLowerCase().indexOf('model') !== -1 ? v.option3 : null) || (titleParts && titleParts[1]) || null, 'model');
    add('trim', 'Trim/Edition:', getVehicle('trim') || getVehicle('edition') || (v && opt3 && opt3.toLowerCase().indexOf('trim') !== -1 ? v.option4 : null) || (titleParts && titleParts[2]) || null, 'trim');
    add('bodyStyle1', 'Body Style 1:', normalizeBodyType(getVehicle('body_style') || getVehicle('body_style_1')), 'bodyStyle');
    add('bodyStyle2', 'Body Style 2:', normalizeBodyType(getVehicle('body_style_2')), 'bodyStyle');
    add('engine', 'Engine:', getVehicle('engine'), 'engine');
    add('fuelType', 'Fuel Type:', getVehicle('fuel_type') || getVehicle('fuel'), 'fuel');
    add('driveType', 'Drive Type:', getVehicle('drive_type') || getVehicle('drivetrain'), 'drive');
    add('transmission', 'Transmission:', getVehicle('transmission'), 'transmission');
    add('vin2', 'VIN:', getVehicle('vin') || getVehicle('VIN'), 'vin');
    opts.forEach(function (opt, idx) {
      var name = getOptionName(opt);
      var key = (name && name.toLowerCase().replace(/\s+/g, ' ').trim()) || '';
      var optVal = v && v['option' + (idx + 1)];
      if (!optVal || !key) return;
      if (key.indexOf('manufacturer') !== -1) return;
      var label = (name.slice(-1) === ':' ? name : name + ':');
      if (out.some(function (r) { return r.label === label; })) return;
      var iconKey = 'vin';
      if (key.indexOf('year') !== -1) iconKey = 'year';
      else if (key.indexOf('make') !== -1) iconKey = 'make';
      else if (key.indexOf('model') !== -1) iconKey = 'model';
      else if (key.indexOf('trim') !== -1 || key.indexOf('edition') !== -1) iconKey = 'trim';
      else if (key.indexOf('body') !== -1) iconKey = 'bodyStyle';
      else if (key.indexOf('engine') !== -1) iconKey = 'engine';
      else if (key.indexOf('fuel') !== -1) iconKey = 'fuel';
      else if (key.indexOf('drive') !== -1) iconKey = 'drive';
      else if (key.indexOf('transmission') !== -1) iconKey = 'transmission';
      else if (key.indexOf('manufacturer') !== -1) iconKey = 'manufacturer';
      var displayVal = iconKey === 'bodyStyle' ? normalizeBodyType(optVal) : String(optVal);
      if (displayVal === '') return;
      out.push({ label: label, value: displayVal, icon: vehicleDetailIcons[iconKey] || vehicleDetailIcons.vin });
    });
    out = out.filter(function (item) {
      if (item.value.toUpperCase() === 'TRUCK') {
        return !out.some(function (o) { return o.value.toUpperCase() === 'PICKUP'; });
      }
      return true;
    });
    return out;
  }

  function renderProductPanel(product, baseUrl, isFirst) {
    const card = document.createElement('div');
    card.className = 'shoppable-reels__panel-card' + (isFirst ? ' shoppable-reels__panel-card--active' : '');
    const variant = product.variants && product.variants[0];
    const productUrl = baseUrl.replace(/\/?$/, '') + '/' + (product.handle || '');

    const images = (product.images && product.images.length) ? product.images : (product.featured_image ? [product.featured_image] : []);
    let imgSrc = '';
    if (images[0]) imgSrc = typeof images[0] === 'string' ? images[0] : (images[0].src || images[0].url);

    const imageUrls = images.map(function (im) { return typeof im === 'string' ? im : (im.src || im.url); }).filter(Boolean);
    let currentIndex = 0;

    const imgWrap = document.createElement('div');
    imgWrap.className = 'shoppable-reels__panel-image-wrap';
    const img = document.createElement('img');
    img.src = imgSrc || '';
    img.alt = (product.title || '').slice(0, 100);
    img.loading = 'lazy';
    imgWrap.appendChild(img);

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'shoppable-reels__panel-image-expand';
    expandBtn.setAttribute('aria-label', 'Expand image');
    expandBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
    expandBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (img.src) window.open(img.src, '_blank', 'noopener');
    });
    imgWrap.appendChild(expandBtn);

    if (imageUrls.length > 1) {
      let currentIndex = 0;
      const goToIndex = function (idx) {
        currentIndex = (idx + imageUrls.length) % imageUrls.length;
        img.src = imageUrls[currentIndex];
        var gal = card.querySelector('.shoppable-reels__panel-gallery');
        if (gal) {
          var segs = gal.querySelectorAll('.shoppable-reels__panel-gallery-seg');
          segs.forEach(function (s, i) { s.classList.toggle('shoppable-reels__panel-gallery-seg--active', i === currentIndex); });
        }
      };
      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'shoppable-reels__panel-image-arrow shoppable-reels__panel-image-arrow--prev';
      prevBtn.setAttribute('aria-label', 'Previous image');
      prevBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
      prevBtn.addEventListener('click', function (e) { e.preventDefault(); goToIndex(currentIndex - 1); });
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'shoppable-reels__panel-image-arrow shoppable-reels__panel-image-arrow--next';
      nextBtn.setAttribute('aria-label', 'Next image');
      nextBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
      nextBtn.addEventListener('click', function (e) { e.preventDefault(); goToIndex(currentIndex + 1); });
      imgWrap.appendChild(prevBtn);
      imgWrap.appendChild(nextBtn);
    }

    if (images.length > 0) {
      const gallery = document.createElement('div');
      gallery.className = 'shoppable-reels__panel-gallery';
      gallery.setAttribute('role', 'tablist');
      gallery.setAttribute('aria-label', 'Image gallery');
      images.forEach(function (im, i) {
        const src = typeof im === 'string' ? im : (im.src || im.url);
        if (!src) return;
        const seg = document.createElement('button');
        seg.type = 'button';
        seg.className = 'shoppable-reels__panel-gallery-seg' + (i === 0 ? ' shoppable-reels__panel-gallery-seg--active' : '');
        seg.setAttribute('aria-label', 'Image ' + (i + 1));
        seg.setAttribute('role', 'tab');
        seg.addEventListener('click', function () {
          var segs = gallery.querySelectorAll('.shoppable-reels__panel-gallery-seg');
          var idx = Array.prototype.indexOf.call(segs, seg);
          if (idx >= 0) currentIndex = idx;
          img.src = src;
          segs.forEach(function (s) { s.classList.remove('shoppable-reels__panel-gallery-seg--active'); });
          seg.classList.add('shoppable-reels__panel-gallery-seg--active');
        });
        gallery.appendChild(seg);
      });
      imgWrap.appendChild(gallery);
    }

    const title = document.createElement('h3');
    title.className = 'shoppable-reels__panel-title';
    title.textContent = product.title || '';

    const priceEl = document.createElement('p');
    priceEl.className = 'shoppable-reels__panel-price';
    priceEl.textContent = variant && variant.price ? formatMoney(variant.price) : '';

    card.appendChild(imgWrap);

    card.appendChild(title);
    card.appendChild(priceEl);

    if (product.description && product.description.trim()) {
      const descWrap = document.createElement('div');
      descWrap.className = 'shoppable-reels__panel-description';
      if (/<[a-z][\s\S]*>/i.test(product.description)) {
        descWrap.innerHTML = product.description;
      } else {
        descWrap.textContent = product.description;
      }
      card.appendChild(descWrap);
    }

    const vehicleDetails = getVehicleDetails(product, variant);
    if (vehicleDetails.length > 0) {
      const vehicleSection = document.createElement('div');
      vehicleSection.className = 'shoppable-reels__panel-vehicle-details';
      const vehicleHeading = document.createElement('h4');
      vehicleHeading.className = 'shoppable-reels__panel-vehicle-details-title';
      vehicleHeading.textContent = 'Vehicle details';
      vehicleSection.appendChild(vehicleHeading);
      const vehicleGrid = document.createElement('div');
      vehicleGrid.className = 'shoppable-reels__panel-vehicle-details-grid';
      vehicleDetails.forEach(function (item) {
        const row = document.createElement('div');
        row.className = 'shoppable-reels__panel-vehicle-detail';
        row.innerHTML = '<span class="shoppable-reels__panel-vehicle-detail-icon" aria-hidden="true">' + (item.icon || '') + '</span><span class="shoppable-reels__panel-vehicle-detail-label">' + escapeHtml(item.label) + '</span><span class="shoppable-reels__panel-vehicle-detail-value">' + escapeHtml(item.value) + '</span>';
        vehicleGrid.appendChild(row);
      });
      vehicleSection.appendChild(vehicleGrid);
      card.appendChild(vehicleSection);
    }

    const options = product.options || [];
    const optionValues = [];
    options.forEach(function (optName, optIndex) {
      const key = 'option' + (optIndex + 1);
      const vals = [];
      (product.variants || []).forEach(function (v) {
        if (v[key] && vals.indexOf(v[key]) === -1) vals.push(v[key]);
      });
      optionValues.push(vals);
    });
    const selectedOptions = {};
    options.forEach(function (opt, i) {
      selectedOptions[i] = (variant && variant['option' + (i + 1)]) || (optionValues[i] && optionValues[i][0]) || '';
    });
    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'shoppable-reels__panel-options';
    options.forEach(function (opt, optIndex) {
      const name = typeof opt === 'string' ? opt : (opt.name || 'Option ' + (optIndex + 1));
      const values = optionValues[optIndex] || [];
      if (values.length <= 1) return;
      const label = document.createElement('span');
      label.className = 'shoppable-reels__panel-option-label';
      label.textContent = name + (name.slice(-1) === ':' ? '' : ':');
      optionsWrap.appendChild(label);
      const btns = document.createElement('div');
      btns.className = 'shoppable-reels__panel-option-btns';
      values.forEach(function (val) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'shoppable-reels__panel-option-btn';
        btn.textContent = val;
        if (selectedOptions[optIndex] === val) btn.classList.add('shoppable-reels__panel-option-btn--selected');
        btn.addEventListener('click', function () {
          selectedOptions[optIndex] = val;
          btns.querySelectorAll('.shoppable-reels__panel-option-btn').forEach(function (b) { b.classList.remove('shoppable-reels__panel-option-btn--selected'); });
          btn.classList.add('shoppable-reels__panel-option-btn--selected');
          var v = findVariant(product.variants, selectedOptions, options.length);
          if (v) {
            priceEl.textContent = formatMoney(v.price);
            var form = card.querySelector('.shoppable-reels__panel-add-form');
            if (form) form.querySelector('input[name="id"]').value = v.id;
          }
        });
        btns.appendChild(btn);
      });
      optionsWrap.appendChild(btns);
    });
    if (optionsWrap.children.length) card.appendChild(optionsWrap);

    const actions = document.createElement('div');
    actions.className = 'shoppable-reels__panel-actions';
    const moreLink = document.createElement('a');
    moreLink.href = productUrl;
    moreLink.className = 'shoppable-reels__panel-more';
    moreLink.textContent = 'More Info';
    var holdVariantId = (section.dataset.holdVariantId || '').trim();
    var reserveLabel = (section.dataset.reserveButtonLabel || 'Reserve').trim();
    var reserveBtn = document.createElement('a');
    reserveBtn.className = 'shoppable-reels__panel-add-btn shoppable-reels__panel-reserve-btn js-reserve-button';
    reserveBtn.textContent = reserveLabel;
    var rawVin = '';
    for (var d = 0; d < vehicleDetails.length; d++) {
      if (vehicleDetails[d].label === 'VIN:') { rawVin = vehicleDetails[d].value; break; }
    }
    if (holdVariantId) {
      var vehicleTitle = encodeURIComponent(product.title || '');
      var vinVal = encodeURIComponent(rawVin);
      var imgUrl = '';
      var fi = product.featured_image;
      if (fi) imgUrl = typeof fi === 'string' ? fi : (fi.src || fi.url || '');
      if (imgUrl) imgUrl = encodeURIComponent(imgUrl);
      var reserveHref = '/cart/add?id=' + holdVariantId + '&quantity=1&properties[Vehicle]=' + vehicleTitle + '&properties[VIN]=' + vinVal;
      if (imgUrl) reserveHref += '&properties[_vehicle_image]=' + imgUrl;
      reserveBtn.href = reserveHref;
      reserveBtn.setAttribute('data-reserve-url', reserveHref);
      reserveBtn.setAttribute('data-reserve-vehicle', product.title || '');
      reserveBtn.setAttribute('data-reserve-vin', rawVin);
    } else {
      reserveBtn.href = productUrl;
    }
    actions.appendChild(moreLink);
    actions.appendChild(reserveBtn);
    card.appendChild(actions);

    return card;
  }

  function findVariant(variants, selected, numOptions) {
    if (!variants || !variants.length) return null;
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      var match = true;
      for (var j = 0; j < numOptions; j++) {
        if (v['option' + (j + 1)] !== selected[j]) { match = false; break; }
      }
      if (match) return v;
    }
    return variants[0];
  }

  function fetchProduct(baseUrl, handle, done) {
    var url = baseUrl.replace(/\/?$/, '') + '/' + handle + '.js';
    fetch(url)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { done(data || null); })
      .catch(function () { done(null); });
  }

  function renderProductCard(product, baseUrl) {
    const a = document.createElement('a');
    a.href = baseUrl.replace(/\/?$/, '') + '/' + (product.handle || '');
    a.className = 'shoppable-reels__product-card';

    const img = document.createElement('img');
    let imgSrc = product.featured_image;
    if (imgSrc && typeof imgSrc === 'object') imgSrc = imgSrc.src || imgSrc.url;
    if (!imgSrc && product.images && product.images[0]) imgSrc = product.images[0].src || product.images[0];
    img.src = imgSrc || '';
    img.alt = (product.title || '').slice(0, 100);
    img.loading = 'lazy';
    a.appendChild(img);

    const title = document.createElement('span');
    title.className = 'shoppable-reels__product-title';
    title.textContent = product.title || '';
    a.appendChild(title);

    const price = document.createElement('span');
    price.className = 'shoppable-reels__product-price';
    const variant = product.variants && product.variants[0];
    price.textContent = variant && variant.price ? formatMoney(variant.price) : '';
    a.appendChild(price);

    return a;
  }

  function formatMoney(cents) {
    const amount = (cents / 100).toFixed(2);
    if (typeof window.Shopify !== 'undefined' && window.Shopify.formatMoney) {
      return window.Shopify.formatMoney(cents);
    }
    return '$' + amount;
  }
})();
