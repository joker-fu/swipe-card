import { LitElement, html, css, unsafeCSS } from "lit";

import Swiper from "swiper/swiper-bundle.esm.js";
import swiperStyle from "swiper/swiper-bundle.css";
import deepcopy from "deep-clone-simple";

const HELPERS = window.loadCardHelpers ? window.loadCardHelpers() : undefined;

window.customCards = window.customCards || [];
window.customCards.push({
  type: "swipe-card",
  name: "Swipe Card",
  description: "A card thats lets you swipe through multiple Lovelace cards.",
});

const computeCardSize = (card) => {
  if (typeof card.getCardSize === "function") {
    return card.getCardSize();
  }
  if (customElements.get(card.localName)) {
    return 1;
  }
  return customElements
    .whenDefined(card.localName)
    .then(() => computeCardSize(card));
};

class SwipeCard extends LitElement {
  static get properties() {
    return {
      _config: {},
      _cards: {},
    };
  }

  static getStubConfig() {
    return { cards: [] };
  }

  shouldUpdate(changedProps) {
    if (changedProps.has("_config") || changedProps.has("_cards")) {
      return true;
    }
    return false;
  }

  static get styles() {
    return css`
      :host {
        --swiper-theme-color: var(--primary-color);
      }
      ${unsafeCSS(swiperStyle)}
    `;
  }

  setConfig(config) {
    if (!config || !config.cards || !Array.isArray(config.cards)) {
      throw new Error("Card config incorrect");
    }
    this._config = config;
    this._parameters = deepcopy(this._config.parameters) || {};
    this._cards = [];
    this._loopDuplicateCards = [];
    this._createCardsRunId = (this._createCardsRunId || 0) + 1;
    this._swiperRefreshInFlight = false;
    this._swiperRefreshQueued = false;
    this._resizeRefreshTimer = undefined;
    this._postInitRefreshTimer = undefined;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => {
        if (this._resizeRefreshTimer) {
          window.clearTimeout(this._resizeRefreshTimer);
        }
        this._resizeRefreshTimer = window.setTimeout(() => {
          this._queueSwiperRefresh();
        }, 90);
      });
    }
    this._createCards();
  }

  _featureEnabled(key) {
    return key in this._parameters && this._parameters[key] !== false;
  }

  _normalizeSwiperParameters() {
    const cardCount = Array.isArray(this._config?.cards)
      ? this._config.cards.length
      : 0;

    if (this._parameters.loop === true && cardCount > 0) {
      const isAutoSlides = this._parameters.slidesPerView === "auto";
      if (isAutoSlides) {
        if (
          !Number.isFinite(Number(this._parameters.loopedSlides)) ||
          Number(this._parameters.loopedSlides) < 1
        ) {
          this._parameters.loopedSlides = cardCount;
        }
        if (
          !Number.isFinite(Number(this._parameters.loopAdditionalSlides)) ||
          Number(this._parameters.loopAdditionalSlides) < 0
        ) {
          this._parameters.loopAdditionalSlides = Math.min(2, cardCount);
        }
      }
    }

    if ("start_card" in this._config) {
      const rawStartCard = Number.parseInt(this._config.start_card, 10);
      const maxCard = Math.max(1, cardCount);
      const clampedStartCard = Number.isFinite(rawStartCard)
        ? Math.min(Math.max(rawStartCard, 1), maxCard)
        : 1;
      this._parameters.initialSlide = clampedStartCard - 1;
    }
  }

  set hass(hass) {
    this._hass = hass;

    if (!this._cards) {
      return;
    }

    this._cards.forEach((element) => {
      element.hass = this._hass;
    });

    if (this._loopDuplicateCards) {
      this._loopDuplicateCards.forEach((element) => {
        element.hass = this._hass;
      });
    }
  }

  connectedCallback() {
    super.connectedCallback();
    if (this._config && this._hass && this._updated && !this._loaded) {
      this._initialLoad();
    } else if (this.swiper) {
      this._queueSwiperRefresh();
      this._schedulePostInitRefresh();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._resizeRefreshTimer) {
      window.clearTimeout(this._resizeRefreshTimer);
      this._resizeRefreshTimer = undefined;
    }
    if (this._postInitRefreshTimer) {
      window.clearTimeout(this._postInitRefreshTimer);
      this._postInitRefreshTimer = undefined;
    }
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    this._updated = true;
    if (this._config && this._hass && this.isConnected && !this._loaded) {
      this._initialLoad();
    } else if (this.swiper) {
      this._queueSwiperRefresh();
    }
  }

  _queueSwiperRefresh() {
    if (!this.swiper) {
      return;
    }

    if (this._swiperRefreshInFlight) {
      this._swiperRefreshQueued = true;
      return;
    }

    this._swiperRefreshInFlight = true;

    Promise.resolve()
      .then(async () => {
        do {
          this._swiperRefreshQueued = false;
          this.swiper.update();
          if (this._parameters?.loop === true) {
            await this._hydrateLoopDuplicateSlides();
            if (
              this._parameters.autoHeight === true &&
              typeof this.swiper.updateAutoHeight === "function"
            ) {
              this.swiper.updateAutoHeight(0);
            }
          }
        } while (this._swiperRefreshQueued);
      })
      .finally(() => {
        this._swiperRefreshInFlight = false;
      });
  }

  _schedulePostInitRefresh() {
    if (!this.swiper) {
      return;
    }
    if (this._postInitRefreshTimer) {
      window.clearTimeout(this._postInitRefreshTimer);
    }
    this._postInitRefreshTimer = window.setTimeout(() => {
      this._queueSwiperRefresh();
    }, 180);
  }

  render() {
    if (!this._config || !this._hass) {
      return html``;
    }

    return html`
      <div
        class="swiper-container"
        dir="${this._hass.translationMetadata.translations[
          this._hass.selectedLanguage || this._hass.language
        ].isRTL || false
          ? "rtl"
          : "ltr"}"
      >
        <div class="swiper-wrapper">${this._cards}</div>
        ${this._featureEnabled("pagination")
          ? html` <div class="swiper-pagination"></div> `
          : ""}
        ${this._featureEnabled("navigation")
          ? html`
              <div class="swiper-button-next"></div>
              <div class="swiper-button-prev"></div>
            `
          : ""}
        ${this._featureEnabled("scrollbar")
          ? html` <div class="swiper-scrollbar"></div> `
          : ""}
      </div>
    `;
  }

  async _initialLoad() {
    this._loaded = true;

    await this.updateComplete;

    this._normalizeSwiperParameters();

    if (this._featureEnabled("pagination")) {
      if (
        this._parameters.pagination === null ||
        this._parameters.pagination === true ||
        typeof this._parameters.pagination !== "object"
      ) {
        this._parameters.pagination = {};
      }
      this._parameters.pagination.el =
        this.shadowRoot.querySelector(".swiper-pagination");
    }

    if (this._featureEnabled("navigation")) {
      if (
        this._parameters.navigation === null ||
        this._parameters.navigation === true ||
        typeof this._parameters.navigation !== "object"
      ) {
        this._parameters.navigation = {};
      }
      this._parameters.navigation.nextEl = this.shadowRoot.querySelector(
        ".swiper-button-next"
      );
      this._parameters.navigation.prevEl = this.shadowRoot.querySelector(
        ".swiper-button-prev"
      );
    }

    if (this._featureEnabled("scrollbar")) {
      if (
        this._parameters.scrollbar === null ||
        this._parameters.scrollbar === true ||
        typeof this._parameters.scrollbar !== "object"
      ) {
        this._parameters.scrollbar = {};
      }
      this._parameters.scrollbar.el =
        this.shadowRoot.querySelector(".swiper-scrollbar");
    }

    this.swiper = new Swiper(
      this.shadowRoot.querySelector(".swiper-container"),
      this._parameters
    );

    if (
      this._parameters.loop === true &&
      typeof this.swiper.slideToLoop === "function"
    ) {
      this.swiper.slideToLoop(this._parameters.initialSlide || 0, 0, false);
    }

    this._queueSwiperRefresh();
    this._schedulePostInitRefresh();

    if (this._config.reset_after) {
      this.swiper
        .on("slideChange", () => {
          this._setResetTimer();
        })
        .on("click", () => {
          this._setResetTimer();
        })
        .on("touchEnd", () => {
          this._setResetTimer();
        });
    }
  }

  _setResetTimer() {
    if (this._resetTimer) {
      window.clearTimeout(this._resetTimer);
    }
    this._resetTimer = window.setTimeout(() => {
      if (
        this._parameters.loop === true &&
        typeof this.swiper.slideToLoop === "function"
      ) {
        this.swiper.slideToLoop(this._parameters.initialSlide || 0);
      } else {
        this.swiper.slideTo(this._parameters.initialSlide || 0);
      }
    }, this._config.reset_after * 1000);
  }

  async _createCards() {
    const runId = this._createCardsRunId;
    const cardCount = Array.isArray(this._config?.cards)
      ? this._config.cards.length
      : 0;
    const isLoopEnabled = this._parameters?.loop === true;

    const createPlaceholderSlide = () => {
      const placeholder = document.createElement("div");
      placeholder.className = "swiper-slide";
      if ("card_width" in this._config) {
        placeholder.style.width = this._config.card_width;
      }
      return placeholder;
    };

    const waitForIdle = () =>
      new Promise((resolve) => {
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(() => resolve(), { timeout: 140 });
        } else {
          window.setTimeout(resolve, 0);
        }
      });

    const loadAllCards = async () => {
      const cards = await Promise.all(
        this._config.cards.map((config) => this._createCardElement(config))
      );

      if (runId !== this._createCardsRunId) {
        return;
      }

      this._cards = cards;
      await this.updateComplete;

      if (this._ro) {
        cards.forEach((cardEl) => this._ro.observe(cardEl));
      }
    };

    const loadNonLoopCardsFast = async () => {
      if (cardCount === 0) {
        this._cards = [];
        return;
      }

      const rawStartCard = Number.parseInt(this._config?.start_card, 10);
      const startIndex = Number.isFinite(rawStartCard)
        ? Math.min(Math.max(rawStartCard, 1), cardCount) - 1
        : 0;

      const order = [];
      const used = new Set();
      const add = (index) => {
        if (index < 0 || index >= cardCount || used.has(index)) {
          return;
        }
        used.add(index);
        order.push(index);
      };

      add(startIndex);
      add(startIndex - 1);
      add(startIndex + 1);
      for (let distance = 2; used.size < cardCount; distance += 1) {
        add(startIndex + distance);
        add(startIndex - distance);
      }

      this._cards = Array.from({ length: cardCount }, () =>
        createPlaceholderSlide()
      );
      await this.updateComplete;

      if (runId !== this._createCardsRunId) {
        return;
      }

      let scheduledRefresh = undefined;
      const scheduleRefresh = () => {
        if (scheduledRefresh) {
          return;
        }
        scheduledRefresh = window.setTimeout(() => {
          scheduledRefresh = undefined;
          if (runId === this._createCardsRunId) {
            this._queueSwiperRefresh();
          }
        }, 120);
      };

      const clearScheduledRefresh = () => {
        if (scheduledRefresh) {
          window.clearTimeout(scheduledRefresh);
          scheduledRefresh = undefined;
        }
      };

      const loadCardAt = async (index) => {
        const currentSlide = this._cards[index];
        if (!currentSlide || typeof currentSlide.setConfig === "function") {
          return;
        }

        const cardEl = await this._createCardElement(this._config.cards[index]);
        if (runId !== this._createCardsRunId) {
          return;
        }

        if (currentSlide.parentElement) {
          currentSlide.parentElement.replaceChild(cardEl, currentSlide);
        }
        if (this._ro) {
          this._ro.unobserve(currentSlide);
          this._ro.observe(cardEl);
        }
        this._cards[index] = cardEl;
      };

      const firstBatchSize = Math.min(3, order.length);
      await Promise.all(order.slice(0, firstBatchSize).map(loadCardAt));
      if (runId !== this._createCardsRunId) {
        clearScheduledRefresh();
        return;
      }

      this._queueSwiperRefresh();

      const remaining = order.slice(firstBatchSize);
      const backgroundBatchSize = 2;
      while (remaining.length > 0) {
        if (runId !== this._createCardsRunId) {
          clearScheduledRefresh();
          return;
        }

        const batch = remaining.splice(0, backgroundBatchSize);
        await Promise.all(batch.map(loadCardAt));
        scheduleRefresh();
        await waitForIdle();
      }

      clearScheduledRefresh();
    };

    this._cardPromises = isLoopEnabled ? loadAllCards() : loadNonLoopCardsFast();
    await this._cardPromises;

    if (this.swiper) {
      this._queueSwiperRefresh();
    }
  }

  async _createInnerCardElement(cardConfig) {
    const element = (await HELPERS).createCardElement(cardConfig);
    if (this._hass) {
      element.hass = this._hass;
    }
    return element;
  }

  async _createCardElement(cardConfig) {
    const element = await this._createInnerCardElement(cardConfig);
    element.className = "swiper-slide";
    if ("card_width" in this._config) {
      element.style.width = this._config.card_width;
    }
    element.addEventListener(
      "ll-rebuild",
      (ev) => {
        ev.stopPropagation();
        this._rebuildCard(element, cardConfig);
      },
      {
        once: true,
      }
    );
    return element;
  }

  async _hydrateLoopDuplicateSlides() {
    const wrapper = this.shadowRoot?.querySelector(".swiper-wrapper");
    if (!wrapper || !Array.isArray(this._config?.cards)) {
      return;
    }

    const duplicateSlides = Array.from(
      wrapper.querySelectorAll(".swiper-slide-duplicate")
    );

    if (duplicateSlides.length === 0) {
      this._loopDuplicateCards = [];
      return;
    }

    const hydratedCards = [];

    for (const duplicateSlide of duplicateSlides) {
      const idxRaw = duplicateSlide.getAttribute("data-swiper-slide-index");
      const sourceIndex = Number.parseInt(idxRaw, 10);
      if (
        !Number.isFinite(sourceIndex) ||
        sourceIndex < 0 ||
        sourceIndex >= this._config.cards.length
      ) {
        continue;
      }

      const cardConfig = this._config.cards[sourceIndex];
      const sourceSlide = this._cards?.[sourceIndex];
      const sourceIsHydratedCard =
        sourceSlide && typeof sourceSlide.setConfig === "function";
      if (!sourceIsHydratedCard) {
        continue;
      }

      const hydratedIndex = Number.parseInt(
        duplicateSlide.dataset.swipeHydratedIndex || "",
        10
      );
      const hydratedMode = duplicateSlide.dataset.swipeHydratedMode || "";

      if (
        hydratedMode === "setConfig" &&
        hydratedIndex === sourceIndex &&
        typeof duplicateSlide.setConfig === "function"
      ) {
        if ("card_width" in this._config) {
          duplicateSlide.style.width = this._config.card_width;
        }
        if (this._hass) {
          duplicateSlide.hass = this._hass;
        }
        hydratedCards.push(duplicateSlide);
        continue;
      }

      if (
        hydratedMode === "nested" &&
        hydratedIndex === sourceIndex &&
        duplicateSlide.firstElementChild
      ) {
        const nestedCard = duplicateSlide.firstElementChild;
        if (this._hass) {
          nestedCard.hass = this._hass;
        }
        hydratedCards.push(nestedCard);
        continue;
      }

      try {
        if (typeof duplicateSlide.setConfig === "function") {
          duplicateSlide.setConfig(deepcopy(cardConfig));
          if ("card_width" in this._config) {
            duplicateSlide.style.width = this._config.card_width;
          }
          if (this._hass) {
            duplicateSlide.hass = this._hass;
          }
          duplicateSlide.dataset.swipeHydratedMode = "setConfig";
          duplicateSlide.dataset.swipeHydratedIndex = String(sourceIndex);
          hydratedCards.push(duplicateSlide);
          continue;
        }
      } catch (e) {
        // Fall through to nested-card fallback for non-standard cards.
      }

      duplicateSlide.innerHTML = "";
      const duplicateCard = await this._createInnerCardElement(cardConfig);
      duplicateCard.style.width = "100%";
      duplicateSlide.appendChild(duplicateCard);
      duplicateSlide.dataset.swipeHydratedMode = "nested";
      duplicateSlide.dataset.swipeHydratedIndex = String(sourceIndex);
      hydratedCards.push(duplicateCard);
    }

    this._loopDuplicateCards = hydratedCards;
  }

  async _rebuildCard(cardElToReplace, config) {
    let newCardEl;
    try {
      newCardEl = await this._createCardElement(config);
      newCardEl.hass = this._hass;
    } catch (e) {
      newCardEl = document.createElement("ha-alert");
      newCardEl.alertType = "error";
      newCardEl.innerText = e.message;
    }
    if (cardElToReplace.parentElement) {
      cardElToReplace.parentElement.replaceChild(newCardEl, cardElToReplace);
    }
    this._cards = this._cards.map((curCardEl) =>
      curCardEl === cardElToReplace ? newCardEl : curCardEl
    );
    if (this._ro) {
      this._ro.unobserve(cardElToReplace);
      this._ro.observe(newCardEl);
    }
    this._queueSwiperRefresh();
  }

  async getCardSize() {
    await this._cardPromises;

    if (!this._cards) {
      return 0;
    }

    const promises = [];

    for (const element of this._cards) {
      if (!element || typeof element.setConfig !== "function") {
        continue;
      }
      promises.push(computeCardSize(element));
    }

    if (promises.length === 0) {
      return 1;
    }

    const results = await Promise.all(promises);

    return Math.max(...results);
  }
}

customElements.define("swipe-card", SwipeCard);
console.info(
  "%c   SWIPE-CARD  \n%c Version 5.0.0 ",
  "color: orange; font-weight: bold; background: black",
  "color: white; font-weight: bold; background: dimgray"
);
