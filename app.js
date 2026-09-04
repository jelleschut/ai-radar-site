/* ai-radar dashboard.
   No framework, no build step. The cards are already in the DOM; this file
   only shows and hides them, keeps the filter state in the url, remembers the
   theme, and marks what is new since the last visit. */
(function () {
  "use strict";

  var FEEDBACK_ENABLED = false;
  var FEEDBACK_WEBHOOK_URL = "";
  var STORAGE_SEEN_IDS = "ai-radar:seen-ids";
  var SEEN_IDS_KEPT = 5000;
  var STORAGE_THEME = "ai-radar:theme";
  var DEFAULT_STATE = { topics: [], types: [], min: 0, days: 60, q: "" };
  var DAY_MS = 86400000;

  /* Storage throws in a private window or when site data is blocked. */
  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (error) { /* ignore */ }
  }

  /* What the page actually renders. A url naming a topic that no longer
     exists must not silently hide everything, so the url is intersected with
     this before it is applied. */
  function vocabulary(name) {
    return Array.prototype.map.call(
      document.querySelectorAll('#filters input[name="' + name + '"]'),
      function (input) { return input.value; }
    );
  }

  function readFilterState() {
    var params = new URLSearchParams(window.location.search);
    var list = function (name, field) {
      var raw = params.get(name);
      var known = vocabulary(field);
      return raw ? raw.split(",").filter(function (value) {
        return value && known.indexOf(value) !== -1;
      }) : [];
    };
    var min = parseInt(params.get("min"), 10);
    var days = parseInt(params.get("days"), 10);
    return {
      topics: list("topics", "topic"),
      types: list("types", "type"),
      min: isNaN(min) ? DEFAULT_STATE.min : Math.max(0, Math.min(100, min)),
      days: [7, 30, 60].indexOf(days) === -1 ? DEFAULT_STATE.days : days,
      q: params.get("q") || ""
    };
  }

  function writeFilterState(state) {
    var params = new URLSearchParams();
    if (state.topics.length) { params.set("topics", state.topics.join(",")); }
    if (state.types.length) { params.set("types", state.types.join(",")); }
    if (state.min) { params.set("min", String(state.min)); }
    if (state.days !== DEFAULT_STATE.days) { params.set("days", String(state.days)); }
    if (state.q) { params.set("q", state.q); }
    var query = params.toString();
    window.history.replaceState(null, "", query ? "?" + query : window.location.pathname);
  }

  /* Utc midnight of today. Date.now() would make "7 days" mean 168 hours,
     which drops a card halfway through its seventh day; render.top_items
     counts calendar days and the two must agree. */
  function startOfTodayUtc() {
    var now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  function cardMatches(card, state, nowMs) {
    if (state.types.length && state.types.indexOf(card.dataset.type) === -1) { return false; }
    if (state.topics.length) {
      var topics = (card.dataset.topics || "").split(" ");
      var hit = state.topics.some(function (topic) { return topics.indexOf(topic) !== -1; });
      if (!hit) { return false; }
    }
    if (parseInt(card.dataset.score, 10) < state.min) { return false; }
    var published = Date.parse(card.dataset.published + "T00:00:00Z");
    if (!isNaN(published) && (nowMs - published) > state.days * DAY_MS) { return false; }
    if (state.q && (card.dataset.search || "").indexOf(state.q.toLowerCase()) === -1) { return false; }
    return true;
  }

  function updateDayGroups() {
    var groups = document.querySelectorAll(".stream .day");
    Array.prototype.forEach.call(groups, function (group) {
      group.hidden = !group.querySelector(".card:not([hidden])");
    });
  }

  function applyFilters(state) {
    var nowMs = startOfTodayUtc();
    var cards = document.querySelectorAll(".stream .card");
    var visible = 0;
    Array.prototype.forEach.call(cards, function (card) {
      var match = cardMatches(card, state, nowMs);
      card.hidden = !match;
      if (match) { visible += 1; }
    });
    updateDayGroups();
    var status = document.getElementById("filter-status");
    if (status) { status.textContent = visible + (visible === 1 ? " item" : " items"); }
    var none = document.getElementById("no-matches");
    if (none) { none.hidden = visible !== 0 || cards.length === 0; }
    return { visible: visible };
  }

  function stateFromControls() {
    var checked = function (name) {
      return Array.prototype.map.call(
        document.querySelectorAll('#filters input[name="' + name + '"]:checked'),
        function (input) { return input.value; }
      );
    };
    return {
      topics: checked("topic"),
      types: checked("type"),
      min: parseInt(document.getElementById("min-score").value, 10) || 0,
      days: parseInt(document.getElementById("days").value, 10) || DEFAULT_STATE.days,
      q: document.getElementById("search").value.trim()
    };
  }

  function controlsFromState(state) {
    Array.prototype.forEach.call(document.querySelectorAll('#filters input[name="topic"]'), function (input) {
      input.checked = state.topics.indexOf(input.value) !== -1;
    });
    Array.prototype.forEach.call(document.querySelectorAll('#filters input[name="type"]'), function (input) {
      input.checked = state.types.indexOf(input.value) !== -1;
    });
    document.getElementById("min-score").value = String(state.min);
    document.getElementById("min-score-out").textContent = String(state.min);
    document.getElementById("days").value = String(state.days);
    document.getElementById("search").value = state.q;
  }

  function refresh(state) {
    controlsFromState(state);
    writeFilterState(state);
    applyFilters(state);
  }

  function initFilterControls() {
    var form = document.getElementById("filters");
    if (!form) { return; }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      refresh(stateFromControls());
    });
    form.addEventListener("input", function () { refresh(stateFromControls()); });
    form.addEventListener("change", function () { refresh(stateFromControls()); });
    var reset = document.getElementById("reset-filters");
    if (reset) {
      reset.addEventListener("click", function () {
        refresh({ topics: [], types: [], min: 0, days: DEFAULT_STATE.days, q: "" });
      });
    }
    window.addEventListener("popstate", function () { refresh(readFilterState()); });
    refresh(readFilterState());
  }

  function readSeenIds() {
    var raw = storageGet(STORAGE_SEEN_IDS);
    if (!raw) { return null; }
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (error) { return null; }
  }

  /* New means "this browser has not seen this id before", not "published after
     my last visit": a card that arrives late still gets noticed, and opening
     the page twice on one day no longer wipes the marks. The very first visit
     marks nothing - everything is new then, which is not useful. */
  /* The filter panel collapses on a narrow screen. [hidden] wins over any
     stylesheet, so the wide layout has to take the attribute off again. */
  function initFilterDisclosure() {
    var body = document.getElementById("filters-body");
    var toggle = document.getElementById("filters-toggle");
    if (!body || !toggle) { return; }
    var wide = window.matchMedia("(min-width: 46em)");
    var expose = function (open) {
      body.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    };
    var sync = function () { expose(wide.matches); };
    toggle.addEventListener("click", function () { expose(body.hidden); });
    if (wide.addEventListener) { wide.addEventListener("change", sync); }
    else if (wide.addListener) { wide.addListener(sync); }
    sync();
  }

  function markNewSinceLastVisit() {
    var seen = readSeenIds();
    var cards = document.querySelectorAll(".card");
    var onPage = [];
    var fresh = 0;
    Array.prototype.forEach.call(cards, function (card) {
      var id = card.dataset.itemId;
      if (!id) { return; }
      /* An item in the top five is on the page twice. Mark both cards, but
         count the item once. */
      var firstOnPage = onPage.indexOf(id) === -1;
      if (firstOnPage) { onPage.push(id); }
      if (seen && seen.indexOf(id) === -1) {
        card.classList.add("is-new");
        if (firstOnPage) { fresh += 1; }
      }
    });
    var label = document.getElementById("new-since-visit");
    if (label && fresh > 0) {
      label.textContent = fresh + " new since your last visit";
      label.hidden = false;
    }
    /* Only now, with the marks in the dom: this run's ids first, older ones
       behind them, so the trim drops what fell off the page long ago. */
    var keep = onPage.slice();
    (seen || []).forEach(function (id) {
      if (keep.indexOf(id) === -1) { keep.push(id); }
    });
    try {
      storageSet(STORAGE_SEEN_IDS, JSON.stringify(keep.slice(0, SEEN_IDS_KEPT)));
    } catch (error) { /* ignore */ }
    return fresh;
  }

  function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    storageSet(STORAGE_THEME, mode);
  }

  function initTheme() {
    document.documentElement.setAttribute("data-theme", storageGet(STORAGE_THEME) || "system");
    var button = document.getElementById("theme-toggle");
    if (!button) { return; }
    button.addEventListener("click", function () {
      var order = ["system", "light", "dark"];
      var current = document.documentElement.getAttribute("data-theme") || "system";
      applyTheme(order[(order.indexOf(current) + 1) % order.length]);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initFilterDisclosure();
    initFilterControls();
    markNewSinceLastVisit();
    if (FEEDBACK_ENABLED && FEEDBACK_WEBHOOK_URL) {
      /* Phase 2 wires the .vote buttons to the Home Assistant webhook here. */
    }
  });
})();