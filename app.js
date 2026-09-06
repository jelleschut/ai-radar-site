/* ai-radar dashboard.
   No framework, no build step. The cards are already in the DOM; this file
   only shows and hides them, keeps the filter state in the url, remembers the
   theme, and marks what is new since the last visit. */
(function () {
  "use strict";

  var FEEDBACK_ENABLED = true;
  var FEEDBACK_MODE = "github";
  var FEEDBACK_WEBHOOK_URL = "";
  var FEEDBACK_GITHUB_NEW_URL = "https://github.com/jelleschut/ai-radar/new/main";
  var STORAGE_SEEN_IDS = "ai-radar:seen-ids";
  var SEEN_IDS_KEPT = 5000;
  var STORAGE_THEME = "ai-radar:theme";
  var DEFAULT_STATE = { topics: [], types: [], min: 0, days: 60, q: "" };
  var DAY_MS = 86400000;
  var URL_WRITE_MS = 200;

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
    /* Browsers rate-limit this one: Chrome silently ignores it after a couple
       of hundred calls in a few seconds, Safari and Firefox throw. The
       debounce below keeps us well under that, and a url that is a moment
       stale is never worth losing the page over. */
    try {
      window.history.replaceState(null, "", query ? "?" + query : window.location.pathname);
    } catch (error) { /* rate-limited: the filters still work, the url lags */ }
  }

  var urlWriteTimer = null;
  var urlWriteState = null;

  /* Typing in the search box fires one input event per keystroke. Only the
     last one has to reach the url, so the write trails the typing. */
  function scheduleUrlWrite(state) {
    urlWriteState = state;
    if (urlWriteTimer !== null) { window.clearTimeout(urlWriteTimer); }
    urlWriteTimer = window.setTimeout(function () {
      urlWriteTimer = null;
      writeFilterState(urlWriteState);
    }, URL_WRITE_MS);
  }

  function isDefaultState(state) {
    return state.topics.length === 0 &&
      state.types.length === 0 &&
      state.min === DEFAULT_STATE.min &&
      state.days === DEFAULT_STATE.days &&
      state.q === DEFAULT_STATE.q;
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

  /* "Top this week" is the week's editorial pick, not a view on the stream,
     so it ignores the filters - and therefore has to step aside as soon as
     one is set. Otherwise five happily visible cards sit above "No items
     match these filters", which reads as a broken page. */
  function updateTopSection(state) {
    var top = document.getElementById("top-this-week");
    if (top) { top.hidden = !isDefaultState(state); }
  }

  function refresh(state) {
    controlsFromState(state);
    applyFilters(state);
    updateTopSection(state);
    scheduleUrlWrite(state);
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
    /* Just past the stylesheet's max-width: 46em, not on it: at exactly 46em
       (736px) both queries match and the page has two minds about whether it
       is narrow. */
    var wide = window.matchMedia("(min-width: 46.001em)");
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

  var STORAGE_VOTES = "ai-radar:votes";
  var VOTES_KEPT = 2000;

  function readVotes() {
    var raw = storageGet(STORAGE_VOTES);
    if (!raw) { return {}; }
    try {
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
    } catch (error) { return {}; }
  }

  /* String keys keep their insertion order, so the oldest votes are the ones
     that fall off when the object outgrows its cap. */
  function writeVotes(votes) {
    var keys = Object.keys(votes);
    if (keys.length > VOTES_KEPT) {
      var trimmed = {};
      keys.slice(keys.length - VOTES_KEPT).forEach(function (key) { trimmed[key] = votes[key]; });
      votes = trimmed;
    }
    storageSet(STORAGE_VOTES, JSON.stringify(votes));
    return votes;
  }

  /* An item in "Top this week" is on the page twice, under the same
     data-item-id. Walking every button rather than the clicked card is what
     keeps both copies in step. */
  function markVotes(votes) {
    var buttons = document.querySelectorAll(".card [data-signal]");
    Array.prototype.forEach.call(buttons, function (button) {
      var card = button.closest(".card");
      var id = card && card.dataset.itemId;
      var cast = id ? votes[id] : null;
      button.setAttribute("aria-pressed", cast === button.dataset.signal ? "true" : "false");
    });
  }

  /* no-cors with a URLSearchParams body is the one shape that reaches a Home
     Assistant webhook without a preflight, so HA needs no CORS configuration
     at all. The answer is opaque by definition: there is nothing to read, and
     nothing to do if the post failed - the mark stays, the signal is lost, and
     the next click sends a fresh one. */
  function sendVoteWebhook(card, signal) {
    var body = new URLSearchParams();
    body.set("item_id", card.dataset.itemId);
    body.set("signal", signal);
    body.set("title", card.dataset.title || "");
    body.set("url", card.dataset.url || "");
    body.set("ts", new Date().toISOString());
    try {
      window.fetch(FEEDBACK_WEBHOOK_URL, { method: "POST", mode: "no-cors", body: body });
    } catch (error) { /* offline, blocked, or no fetch: the vote is simply lost */ }
  }

  /* feedback.validate_record's exact contract: item_id, signal, ts, title, url. */
  function feedbackRecord(card, signal) {
    return {
      item_id: card.dataset.itemId,
      signal: signal,
      ts: new Date().toISOString(),
      title: card.dataset.title || "",
      url: card.dataset.url || ""
    };
  }

  /* A feedback filename may not contain a ":" - the repo lives on Windows -
     so the stamp is stripped down to letters and digits, exactly like the
     Home Assistant automation already does for the webhook route. */
  function feedbackFileStamp(isoTs) {
    return isoTs.replace(/[^0-9A-Za-z]/g, "");
  }

  /* github mode needs no server at all: the record becomes the pre-filled
     body of GitHub's own "create new file" page, landing exactly where
     consolidate_feedback.py expects it. Jelle - already logged in to GitHub
     in the browser - only has to press "Commit changes"; there is nothing
     here to catch, a popup blocker simply means the tab never opens. */
  function sendVoteGithub(card, signal) {
    var record = feedbackRecord(card, signal);
    var path = "feedback/inbox/" + feedbackFileStamp(record.ts) + "-" + record.item_id + ".json";
    var value = JSON.stringify(record, null, 2) + "\n";
    var url = FEEDBACK_GITHUB_NEW_URL +
      "?filename=" + encodeURIComponent(path) +
      "&value=" + encodeURIComponent(value);
    window.open(url, "_blank", "noopener");
  }

  function sendVote(card, signal) {
    if (FEEDBACK_MODE === "webhook") { sendVoteWebhook(card, signal); }
    else if (FEEDBACK_MODE === "github") { sendVoteGithub(card, signal); }
  }

  function initFeedback() {
    if (!FEEDBACK_ENABLED) { return; }
    if (FEEDBACK_MODE === "webhook" && (!FEEDBACK_WEBHOOK_URL || !window.fetch)) { return; }
    if (FEEDBACK_MODE === "github" && !FEEDBACK_GITHUB_NEW_URL) { return; }
    var votes = readVotes();
    markVotes(votes);
    document.addEventListener("click", function (event) {
      var button = event.target && event.target.closest && event.target.closest("[data-signal]");
      if (!button) { return; }
      var card = button.closest(".card");
      if (!card || !card.dataset.itemId) { return; }
      /* A second click is a change of mind, not a second vote: last one wins,
         here and in feedback_digest.py. */
      votes[card.dataset.itemId] = button.dataset.signal;
      votes = writeVotes(votes);
      markVotes(votes);
      sendVote(card, button.dataset.signal);
    });
  }

  var THEME_ORDER = ["system", "light", "dark"];

  function nextTheme(mode) {
    return THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length];
  }

  /* The button used to say "Theme" in every state, so the only clue to which
     of the three it was in was a small disc. It now says which one, in the
     label a screen reader gets as well as the one on screen. */
  function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    storageSet(STORAGE_THEME, mode);
    var button = document.getElementById("theme-toggle");
    if (!button) { return; }
    var word = button.querySelector(".theme-toggle__word");
    if (word) { word.textContent = "Theme: " + mode; }
    button.setAttribute("aria-label", "Theme: " + mode + ". Switch to " + nextTheme(mode) + ".");
  }

  function initTheme() {
    var stored = storageGet(STORAGE_THEME);
    applyTheme(THEME_ORDER.indexOf(stored) === -1 ? "system" : stored);
    var button = document.getElementById("theme-toggle");
    if (!button) { return; }
    button.addEventListener("click", function () {
      applyTheme(nextTheme(document.documentElement.getAttribute("data-theme") || "system"));
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initFilterDisclosure();
    initFilterControls();
    markNewSinceLastVisit();
    initFeedback();
  });
})();