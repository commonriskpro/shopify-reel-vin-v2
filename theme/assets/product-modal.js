if (!customElements.get('product-modal')) {
  customElements.define(
    'product-modal',
    class ProductModal extends ModalDialog {
      constructor() {
        super();
      }

      hide() {
        super.hide();
      }

      show(opener) {
        super.show(opener);
        this.showActiveMedia();
        this._bindArrows();
      }

      _bindArrows() {
        const prevBtn = this.querySelector('.product-media-modal__arrow--prev');
        const nextBtn = this.querySelector('.product-media-modal__arrow--next');
        if (this._arrowsBound) return;
        this._arrowsBound = true;
        if (prevBtn) prevBtn.addEventListener('click', () => this._goAdjacent(-1));
        if (nextBtn) nextBtn.addEventListener('click', () => this._goAdjacent(1));
      }

      _goAdjacent(delta) {
        const content = this.querySelector('.product-media-modal__content');
        if (!content) return;
        const items = content.querySelectorAll('[data-media-id]');
        const active = content.querySelector('[data-media-id].active');
        if (!active || items.length === 0) return;
        let index = Array.from(items).indexOf(active) + delta;
        if (index < 0) index = items.length - 1;
        if (index >= items.length) index = 0;
        const next = items[index];
        if (!next) return;
        items.forEach((el) => el.classList.remove('active'));
        next.classList.add('active');
        const template = next.querySelector('template');
        if (next.nodeName === 'DEFERRED-MEDIA' && template && template.content && template.content.querySelector('.js-youtube'))
          next.loadContent();
        this._updateCounter(index + 1, items.length);
      }

      _updateCounter(current, total) {
        const counter = this.querySelector('.product-media-modal__counter');
        if (counter) counter.textContent = current + ' of ' + total;
      }

      showActiveMedia() {
        const mediaId = this.openedBy.getAttribute('data-media-id');
        this.querySelectorAll('[data-media-id]').forEach((element) => {
          element.classList.remove('active');
        });
        const activeMedia = this.querySelector(`[data-media-id="${mediaId}"]`);
        if (!activeMedia) return;
        const activeMediaTemplate = activeMedia.querySelector('template');
        const activeMediaContent = activeMediaTemplate ? activeMediaTemplate.content : null;
        activeMedia.classList.add('active');
        activeMedia.scrollIntoView();

        const content = this.querySelector('.product-media-modal__content');
        if (content) {
          const items = content.querySelectorAll('[data-media-id]');
          const index = Array.from(items).indexOf(activeMedia);
          this._updateCounter(index + 1, items.length);
        }

        if (
          activeMedia.nodeName == 'DEFERRED-MEDIA' &&
          activeMediaContent &&
          activeMediaContent.querySelector('.js-youtube')
        )
          activeMedia.loadContent();
      }
    }
  );
}
