(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EPGWidget = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var defaults = {
    endpoints: {
      servicesUrl: "",
      channelsUrl: "",
      programsUrl: "",
    },
    programsFetchMode: "range",
    days: 8,
    daysBefore: 1,
    initialTab: "GR",
    includeServiceTypes: [1],
    timezone: "Asia/Tokyo",
    pxPerMinute: 4,
    nowLine: true,
    onProgramClick: null,
    logoResolver: null,
    sources: null,
    tabs: null,
  };
  var DAY_MS = 24 * 60 * 60 * 1000;
  var COMPACT_PROGRAM_HEIGHT = 36;
  var COMPACT_PROGRAM_HOVER_HEIGHT = 72;
  var GENRE_ACCENT_COLORS = {
    0: "#81D4FA",
    1: "#FFF176",
    2: "#64B5F6",
    3: "#EF9A9A",
    4: "#FFD54F",
    5: "#CE93D8",
    6: "#FFCC80",
    7: "#F48FB1",
    8: "#9FA8DA",
    9: "#C5E1A5",
    10: "#A5D6A7",
    11: "#80CBC4",
  };
  var DEFAULT_GENRE_ACCENT_COLOR = "#E0E0E0";

  function mergeConfig(base, overrides) {
    var result = {};
    Object.keys(base).forEach(function (key) {
      if (typeof base[key] === "object" && base[key] !== null && !Array.isArray(base[key])) {
        result[key] = mergeConfig(base[key], (overrides || {})[key] || {});
      } else {
        result[key] = base[key];
      }
    });
    Object.keys(overrides || {}).forEach(function (key) {
      result[key] = overrides[key];
    });
    return result;
  }

  function resolveCssSize(value) {
    if (value == null) {
      return null;
    }
    if (typeof value === "number") {
      return isFinite(value) ? value + "px" : null;
    }
    if (typeof value === "string") {
      var trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      if (/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) {
        return trimmed + "px";
      }
      return trimmed;
    }
    return null;
  }

  function applyCssVariable(target, name, value) {
    if (!target) {
      return;
    }
    if (value == null) {
      target.style.removeProperty(name);
      return;
    }
    target.style.setProperty(name, value);
  }

  function normalizeDayCount(value) {
    var count = typeof value === "number" ? value : parseInt(value, 10);
    if (!isFinite(count)) {
      return 0;
    }
    return Math.max(0, Math.floor(count));
  }

  function addDays(baseDate, offsetDays) {
    return new Date(baseDate.getTime() + offsetDays * DAY_MS);
  }

  function normalizeSources(config) {
    if (Array.isArray(config.sources) && config.sources.length) {
      return config.sources.map(function (source, index) {
        var endpoints = source.endpoints || source;
        return {
          id: source.id || "source-" + (index + 1),
          label: source.label || "",
          endpoints: {
            servicesUrl: endpoints.servicesUrl || "",
            channelsUrl: endpoints.channelsUrl || "",
            programsUrl: endpoints.programsUrl || "",
          },
        };
      });
    }
    return [
      {
        id: "default",
        label: "",
        endpoints: {
          servicesUrl: (config.endpoints || {}).servicesUrl || "",
          channelsUrl: (config.endpoints || {}).channelsUrl || "",
          programsUrl: (config.endpoints || {}).programsUrl || "",
        },
      },
    ];
  }

  function normalizeTabs(config, sources) {
    if (Array.isArray(config.tabs) && config.tabs.length) {
      return config.tabs.map(function (tab, index) {
        var sourceId = tab.sourceId || (sources[0] ? sources[0].id : "default");
        var id = tab.id || tab.key || tab.label || "tab-" + (index + 1);
        return {
          id: id,
          label: tab.label || id,
          sourceId: sourceId,
          channelTypes: tab.channelTypes || tab.channelType || null,
          channelFilter: typeof tab.channelFilter === "function" ? tab.channelFilter : null,
          serviceFilter: typeof tab.serviceFilter === "function" ? tab.serviceFilter : null,
          mode: tab.mode || tab.layout || "grouped",
        };
      });
    }

    var defaultTabs = [];
    sources.forEach(function (source) {
      var prefix = source.label || source.id || "";
      var usePrefix = sources.length > 1 && prefix;
      var makeLabel = function (suffix) {
        return usePrefix ? prefix + " " + suffix : suffix;
      };
      var makeId = function (suffix) {
        return sources.length > 1 ? source.id + ":" + suffix : suffix;
      };
      defaultTabs.push({
        id: makeId("GR"),
        label: makeLabel("GR"),
        sourceId: source.id,
        channelTypes: ["GR"],
        mode: "grouped",
      });
      defaultTabs.push({
        id: makeId("BS"),
        label: makeLabel("BS"),
        sourceId: source.id,
        channelTypes: ["BS"],
        mode: "grouped",
      });
      defaultTabs.push({
        id: makeId("CS"),
        label: makeLabel("CS"),
        sourceId: source.id,
        channelTypes: ["CS"],
        mode: "service",
      });
    });
    return defaultTabs;
  }

  function resolveTarget(target) {
    if (typeof target === "string") {
      return document.querySelector(target);
    }
    if (target instanceof HTMLElement) {
      return target;
    }
    return null;
  }

  function formatDayLabelParts(date, timeZone) {
    var formatter = new Intl.DateTimeFormat("ja-JP", {
      timeZone: timeZone,
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    });
    var parts = formatter.formatToParts(date);
    return {
      month: parts.find(function (p) {
        return p.type === "month";
      }).value,
      day: parts.find(function (p) {
        return p.type === "day";
      }).value,
      weekday: parts.find(function (p) {
        return p.type === "weekday";
      }).value,
    };
  }

  function formatDayLabel(date, timeZone) {
    var parts = formatDayLabelParts(date, timeZone);
    return parts.month + "/" + parts.day + "(" + parts.weekday + ")";
  }

  function formatTime(date, timeZone) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function formatMinute(date, timeZone) {
    var formatter = new Intl.DateTimeFormat("ja-JP", {
      timeZone: timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    var parts = formatter.formatToParts(date);
    var minute = parts.find(function (p) {
      return p.type === "minute";
    });
    return minute ? minute.value : "00";
  }

  function normalizeSummary(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeProgramText(value) {
    if (value == null) {
      return "";
    }
    return String(value)
      .replace(/\u3000/g, " ")
      .replace(/[\uff01-\uff5e]/g, function (char) {
        return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
      });
  }

  function getProgramSummary(program) {
    if (!program) {
      return "";
    }
    if (program.description) {
      return program.description;
    }
    if (program.extended) {
      if (typeof program.extended === "string") {
        return program.extended;
      }
      if (typeof program.extended === "object") {
        var keys = Object.keys(program.extended);
        if (keys.length) {
          return program.extended[keys[0]];
        }
      }
    }
    return "";
  }

  function buildProgramHoverMarkup(minuteText, titleText, summaryText) {
    return (
      '<div class="epg-program-hover" aria-hidden="true">' +
      '<div class="epg-program-inner">' +
      '<div class="epg-program-top">' +
      '<span class="epg-program-minute">' +
      minuteText +
      "</span>" +
      '<span class="epg-program-title">' +
      titleText +
      "</span>" +
      "</div>" +
      '<div class="epg-program-summary">' +
      summaryText +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function isProgramOverflowing(programEl) {
    if (!programEl || programEl.clientHeight === 0 || programEl.clientWidth === 0) {
      return false;
    }
    var inner = programEl.querySelector(".epg-program-inner");
    var target = inner || programEl;
    var heightOverflow = target.scrollHeight - programEl.clientHeight;
    var widthOverflow = target.scrollWidth - programEl.clientWidth;
    return heightOverflow > 1 || widthOverflow > 1;
  }

  function getPrimaryGenreLevel(program) {
    if (!program || !Array.isArray(program.genres) || !program.genres.length) {
      return null;
    }
    var primary = program.genres[0];
    if (!primary || primary.lv1 == null) {
      return null;
    }
    return primary.lv1;
  }

  function resolveProgramAccent(program, fallbackPrograms) {
    var lv1 = getPrimaryGenreLevel(program);
    if (lv1 == null && Array.isArray(fallbackPrograms)) {
      for (var i = 0; i < fallbackPrograms.length; i += 1) {
        lv1 = getPrimaryGenreLevel(fallbackPrograms[i]);
        if (lv1 != null) {
          break;
        }
      }
    }
    if (lv1 == null) {
      return DEFAULT_GENRE_ACCENT_COLOR;
    }
    return GENRE_ACCENT_COLORS[lv1] || DEFAULT_GENRE_ACCENT_COLOR;
  }

  function getDayKey(date, timeZone) {
    var formatter = new Intl.DateTimeFormat("ja-JP", {
      timeZone: timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    var parts = formatter.formatToParts(date);
    var year = parts.find(function (p) {
      return p.type === "year";
    }).value;
    var month = parts.find(function (p) {
      return p.type === "month";
    }).value;
    var day = parts.find(function (p) {
      return p.type === "day";
    }).value;
    return year + "-" + month + "-" + day;
  }

  function getMinutesSinceMidnight(date, timeZone) {
    var formatter = new Intl.DateTimeFormat("ja-JP", {
      timeZone: timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    var parts = formatter.formatToParts(date);
    var hour = parseInt(
      parts.find(function (p) {
        return p.type === "hour";
      }).value,
      10
    );
    var minute = parseInt(
      parts.find(function (p) {
        return p.type === "minute";
      }).value,
      10
    );
    return hour * 60 + minute;
  }

  function debounce(fn, wait) {
    var timeout;
    return function () {
      var args = arguments;
      clearTimeout(timeout);
      timeout = setTimeout(function () {
        fn.apply(null, args);
      }, wait);
    };
  }

  function fetchJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      return response.json();
    });
  }

  function buildProgramsUrl(baseUrl, params) {
    var origin = typeof window !== "undefined" && window.location ? window.location.href : "";
    var url = new URL(baseUrl, origin || document.baseURI || "http://localhost");
    Object.keys(params || {}).forEach(function (key) {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.set(key, params[key]);
      }
    });
    return url.toString();
  }

  function getTimeZoneOffset(date, timeZone) {
    try {
      var formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      var parts = formatter.formatToParts(date);
      var values = {};
      parts.forEach(function (part) {
        values[part.type] = part.value;
      });
      var asUtc = Date.UTC(
        parseInt(values.year, 10),
        parseInt(values.month, 10) - 1,
        parseInt(values.day, 10),
        parseInt(values.hour, 10),
        parseInt(values.minute, 10),
        parseInt(values.second, 10)
      );
      return (asUtc - date.getTime()) / 60000;
    } catch (error) {
      return -date.getTimezoneOffset();
    }
  }

  function getZonedTimestamp(year, month, day, hour, minute, second, timeZone) {
    var utcDate = new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0));
    var offsetMinutes = getTimeZoneOffset(utcDate, timeZone);
    return utcDate.getTime() - offsetMinutes * 60000;
  }

  function getDayRange(dayKey, timeZone) {
    if (!dayKey) {
      return null;
    }
    var parts = dayKey.split("-");
    if (parts.length !== 3) {
      return null;
    }
    var year = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10);
    var day = parseInt(parts[2], 10);
    if (!year || !month || !day) {
      return null;
    }
    var start = getZonedTimestamp(year, month, day, 0, 0, 0, timeZone);
    var next = getZonedTimestamp(year, month, day + 1, 0, 0, 0, timeZone);
    return { since: start, until: next - 1 };
  }

  function createElement(tag, className, text) {
    var el = document.createElement(tag);
    if (className) {
      el.className = className;
    }
    if (text !== undefined) {
      el.textContent = text;
    }
    return el;
  }

  function getServiceKey(service) {
    if (!service) {
      return "unknown:unknown";
    }
    var networkId = service.networkId != null ? service.networkId : "unknown";
    var serviceId = service.serviceId != null ? service.serviceId : "unknown";
    return networkId + ":" + serviceId;
  }

  function resolveServiceLogoUrl(service, config) {
    if (!service || !service.hasLogoData) {
      return null;
    }
    if (typeof config.logoResolver === "function") {
      return config.logoResolver(service);
    }
    if (service.networkId == null || service.logoId == null) {
      return null;
    }
    return "https://celive.cela.me/static/logo/" + service.networkId + "_" + service.logoId + ".png";
  }

  function pickDisplayProgram(programs) {
    if (!Array.isArray(programs) || programs.length === 0) {
      return null;
    }
    var best = null;
    var bestScore = -1;
    programs.forEach(function (program, index) {
      var score = 0;
      var name = (program.name || "").trim();
      if (name) {
        score += 4;
      }
      if (program.description) {
        score += 2;
      }
      if (program.extended && Object.keys(program.extended).length > 0) {
        score += 1;
      }
      if (program.eventId != null) {
        score += 1;
      }
      if (score > bestScore) {
        best = program;
        bestScore = score;
      } else if (score === bestScore && best) {
        var bestName = (best.name || "").trim();
        if (name.length > bestName.length || (name && !bestName)) {
          best = program;
        }
      } else if (score === bestScore && !best) {
        best = program;
      }
    });
    return best || programs[0];
  }

  function EPGWidgetInstance(target, config) {
    this.target = target;
    this.config = mergeConfig(defaults, config || {});
    this.state = {
      currentTab: this.config.initialTab,
      scrollTop: 0,
      hasInitialScroll: false,
      dataBySource: {},
      dayKeys: [],
      renderedDays: new Set(),
      dayLoadingIndicators: {},
      dayRequests: {},
      tabs: [],
      sources: [],
      sourcesById: {},
      programCacheBySource: {},
      renderToken: 0,
    };
    this.elements = {};
    this.programIndex = new Map();
    this.observer = null;
    this.nowLineTimer = null;
    this.init();
  }

  EPGWidgetInstance.prototype.init = function () {
    this.state.sources = normalizeSources(this.config);
    this.state.sourcesById = {};
    this.state.sources.forEach(
      function (source) {
        this.state.sourcesById[source.id] = source;
      }.bind(this)
    );
    this.state.tabs = normalizeTabs(this.config, this.state.sources);
    if (!this.state.tabs.find(function (tab) { return tab.id === this.state.currentTab; }.bind(this))) {
      this.state.currentTab = this.state.tabs.length ? this.state.tabs[0].id : this.config.initialTab;
    }

    this.target.innerHTML = "";
    this.target.classList.add("epg-widget");
    this.applySizing();

    var wrapper = createElement("div", "epg-container");
    var header = createElement("div", "epg-header");
    var tabs = createElement("ul", "nav nav-tabs epg-tabs");
    tabs.setAttribute("role", "tablist");

    var dateLinks = createElement("div", "epg-date-links");

    header.appendChild(tabs);
    header.appendChild(dateLinks);

    var body = createElement("div", "epg-body");
    var loading = createElement("div", "epg-loading text-center text-body");
    loading.innerHTML =
      '<div class="spinner-border" role="status" aria-label="Loading"></div><div class="mt-2">読み込み中...</div>';

    body.appendChild(loading);

    var alert = createElement("div", "alert alert-danger d-none", "");
    var retry = createElement("button", "btn btn-outline-light btn-sm ms-2", "再試行");
    retry.type = "button";
    alert.appendChild(retry);

    body.appendChild(alert);

    var modal = this.createModal();

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    wrapper.appendChild(modal.backdrop);
    wrapper.appendChild(modal.modal);

    this.target.appendChild(wrapper);

    this.elements.wrapper = wrapper;
    this.elements.tabs = tabs;
    this.elements.dateLinks = dateLinks;
    this.elements.body = body;
    this.elements.loading = loading;
    this.elements.alert = alert;
    this.elements.retry = retry;
    this.elements.modal = modal;

    this.attachEvents();
    this.load();
  };

  EPGWidgetInstance.prototype.applySizing = function () {
    var channelWidth = resolveCssSize(this.config.channelWidth);
    var channelMinWidth = resolveCssSize(this.config.channelMinWidth);
    if (channelWidth && !channelMinWidth) {
      channelMinWidth = channelWidth;
    }
    var multiWidth = resolveCssSize(this.config.multiServiceWidth);
    var multiMinWidth = resolveCssSize(this.config.multiServiceMinWidth);
    if (multiWidth && !multiMinWidth) {
      multiMinWidth = multiWidth;
    }
    applyCssVariable(this.target, "--epg-channel-width", channelWidth);
    applyCssVariable(this.target, "--epg-channel-min-width", channelMinWidth);
    applyCssVariable(this.target, "--epg-channel-multi-width", multiWidth);
    applyCssVariable(
      this.target,
      "--epg-channel-multi-min-width",
      multiMinWidth
    );
  };

  EPGWidgetInstance.prototype.resetSizing = function () {
    applyCssVariable(this.target, "--epg-channel-width", null);
    applyCssVariable(this.target, "--epg-channel-min-width", null);
    applyCssVariable(this.target, "--epg-channel-multi-width", null);
    applyCssVariable(this.target, "--epg-channel-multi-min-width", null);
  };

  EPGWidgetInstance.prototype.markColumnAsMulti = function (columnIndex) {
    var columns = this.state.columns || [];
    var column = columns[columnIndex];
    if (!column || column.hasMultiSchedule) {
      return false;
    }
    column.hasMultiSchedule = true;
    var columnEls = this.state.columnElements || [];
    var headerEls = this.state.columnHeaderElements || [];
    if (columnEls[columnIndex]) {
      columnEls[columnIndex].classList.add("epg-channel-column--multi");
    }
    if (headerEls[columnIndex]) {
      headerEls[columnIndex].classList.add("epg-channel-header--multi");
    }
    return true;
  };

  EPGWidgetInstance.prototype.attachEvents = function () {
    this.handleTabClick = function (event) {
      var button = event.target.closest("button[data-epg-tab]");
      if (!button) {
        return;
      }
      var nextTab = button.getAttribute("data-epg-tab");
      if (nextTab === this.state.currentTab) {
        return;
      }
      var scrollContainer = this.elements.body.querySelector(".epg-scroll-container");
      this.state.scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
      this.state.currentTab = nextTab;
      this.renderTabs();
      this.renderBody();
    }.bind(this);

    this.handleDateClick = function (event) {
      var button = event.target.closest("button[data-epg-day]");
      if (!button) {
        return;
      }
      var dayKey = button.getAttribute("data-epg-day");
      var scrollContainer = this.elements.body.querySelector(".epg-scroll-container");
      var dayOffset = this.state.dayOffsets ? this.state.dayOffsets[dayKey] : undefined;
      if (scrollContainer && dayOffset !== undefined) {
        var headerOffset = this.state.headerHeight || 0;
        var now = new Date();
        var nowKey = getDayKey(now, this.config.timezone);
        var targetMinutes =
          dayKey === nowKey
            ? Math.max(0, getMinutesSinceMidnight(now, this.config.timezone) - 60)
            : 19 * 60;
        var targetTop = dayOffset + targetMinutes * this.config.pxPerMinute;
        scrollContainer.scrollTo({
          top: Math.max(0, targetTop - headerOffset),
          behavior: "smooth",
        });
        return;
      }
      var dayTarget = this.elements.body.querySelector(
        '.epg-day-loading[data-day-key="' + dayKey + '"]'
      );
      if (dayTarget) {
        dayTarget.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }.bind(this);

    this.handleProgramClick = function (event) {
      var programEl = event.target.closest(".epg-program");
      if (!programEl) {
        return;
      }
      var programId = programEl.getAttribute("data-program-id");
      var programData = this.programIndex.get(programId);
      if (!programData) {
        return;
      }
      this.openModal(programData);
      if (typeof this.config.onProgramClick === "function") {
        this.config.onProgramClick(programData.raw);
      }
    }.bind(this);

    this.handleProgramKeydown = function (event) {
      if (event.key !== "Enter") {
        return;
      }
      var programEl = event.target.closest(".epg-program");
      if (!programEl) {
        return;
      }
      event.preventDefault();
      var programId = programEl.getAttribute("data-program-id");
      var programData = this.programIndex.get(programId);
      if (!programData) {
        return;
      }
      this.openModal(programData);
      if (typeof this.config.onProgramClick === "function") {
        this.config.onProgramClick(programData.raw);
      }
    }.bind(this);

    this.handleRetry = function () {
      this.load();
    }.bind(this);

    this.elements.tabs.addEventListener("click", this.handleTabClick);
    this.elements.dateLinks.addEventListener("click", this.handleDateClick);
    this.elements.body.addEventListener("click", this.handleProgramClick);
    this.elements.body.addEventListener("keydown", this.handleProgramKeydown);
    this.elements.retry.addEventListener("click", this.handleRetry);

    this.handleResize = debounce(
      function () {
        if (Object.keys(this.state.dataBySource || {}).length) {
          this.renderBody();
        }
      }.bind(this),
      200
    );
    window.addEventListener("resize", this.handleResize);
  };

  EPGWidgetInstance.prototype.detachEvents = function () {
    this.elements.tabs.removeEventListener("click", this.handleTabClick);
    this.elements.dateLinks.removeEventListener("click", this.handleDateClick);
    this.elements.body.removeEventListener("click", this.handleProgramClick);
    this.elements.body.removeEventListener("keydown", this.handleProgramKeydown);
    this.elements.retry.removeEventListener("click", this.handleRetry);
    window.removeEventListener("resize", this.handleResize);
  };

  EPGWidgetInstance.prototype.destroy = function () {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.activeDayCleanup) {
      this.activeDayCleanup();
      this.activeDayCleanup = null;
    }
    this.detachEvents();
    this.resetSizing();
    this.target.innerHTML = "";
    this.target.classList.remove("epg-widget");
  };

  EPGWidgetInstance.prototype.createModal = function () {
    var backdrop = createElement("div", "epg-modal-backdrop d-none");
    var modal = createElement("div", "modal epg-modal d-none");
    modal.setAttribute("tabindex", "-1");
    modal.setAttribute("role", "dialog");

    var dialog = createElement("div", "modal-dialog modal-dialog-centered");
    var content = createElement("div", "modal-content bg-body text-body border");
    var header = createElement("div", "modal-header");
    var title = createElement("h5", "modal-title", "番組詳細");
    var closeButton = createElement("button", "btn-close", "");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close");
    header.appendChild(title);
    header.appendChild(closeButton);

    var body = createElement("div", "modal-body");

    var footer = createElement("div", "modal-footer");
    var footerButton = createElement("button", "btn btn-secondary", "閉じる");
    footerButton.type = "button";
    footer.appendChild(footerButton);

    content.appendChild(header);
    content.appendChild(body);
    content.appendChild(footer);
    dialog.appendChild(content);
    modal.appendChild(dialog);

    var closeModal = function () {
      backdrop.classList.add("d-none");
      modal.classList.add("d-none");
      modal.classList.remove("show");
      document.body.classList.remove("epg-modal-open");
    };

    closeButton.addEventListener("click", closeModal);
    footerButton.addEventListener("click", closeModal);
    backdrop.addEventListener("click", closeModal);

    return {
      backdrop: backdrop,
      modal: modal,
      body: body,
      title: title,
      open: function (contentHtml) {
        body.innerHTML = contentHtml;
        backdrop.classList.remove("d-none");
        modal.classList.remove("d-none");
        modal.classList.add("show");
        document.body.classList.add("epg-modal-open");
      },
    };
  };

  EPGWidgetInstance.prototype.load = function () {
    var sources = this.state.sources || [];
    if (!sources.length) {
      this.showError("エンドポイントの設定が不足しています。");
      return;
    }
    var invalidSource = sources.find(function (source) {
      return (
        !source.endpoints.servicesUrl ||
        !source.endpoints.channelsUrl ||
        !source.endpoints.programsUrl
      );
    });
    if (invalidSource) {
      this.showError("エンドポイントの設定が不足しています。");
      return;
    }

    this.elements.loading.classList.remove("d-none");
    this.elements.alert.classList.add("d-none");
    this.state.programCacheBySource = {};

    var useBulkPrograms = this.config.programsFetchMode === "bulk";
    Promise.all(
      sources.map(function (source) {
        var requests = [
          fetchJson(source.endpoints.servicesUrl),
          fetchJson(source.endpoints.channelsUrl),
        ];
        if (useBulkPrograms) {
          requests.push(fetchJson(source.endpoints.programsUrl));
        }
        return Promise.all(requests).then(function (responses) {
          return {
            id: source.id,
            data: {
              services: responses[0],
              channels: responses[1],
              programs: useBulkPrograms ? responses[2] : [],
            },
          };
        });
      })
    )
      .then(
        function (responses) {
          this.state.dataBySource = {};
          responses.forEach(
            function (entry) {
              this.state.dataBySource[entry.id] = entry.data;
            }.bind(this)
          );
          this.state.tabs = normalizeTabs(this.config, this.state.sources);
          this.state.tabs = this.state.tabs.filter(
            function (tab) {
              var data = this.state.dataBySource[tab.sourceId];
              if (!data) {
                return false;
              }
              return this.buildColumns(tab, data).length > 0;
            }.bind(this)
          );
          if (
            !this.state.tabs.find(function (tab) {
              return tab.id === this.state.currentTab;
            }.bind(this))
          ) {
            this.state.currentTab = this.state.tabs.length ? this.state.tabs[0].id : this.config.initialTab;
          }
          this.elements.loading.classList.add("d-none");
          this.renderTabs();
          this.buildDayKeys();
          this.renderDateLinks();
          this.renderBody();
        }.bind(this)
      )
      .catch(
        function (error) {
          this.showError("取得に失敗しました: " + error.message);
        }.bind(this)
      );
  };

  EPGWidgetInstance.prototype.showError = function (message) {
    this.elements.loading.classList.add("d-none");
    this.elements.alert.classList.remove("d-none");
    this.elements.alert.firstChild.textContent = message;
  };

  EPGWidgetInstance.prototype.renderTabs = function () {
    this.elements.tabs.innerHTML = "";
    this.state.tabs.forEach(
      function (tab) {
        var li = createElement("li", "nav-item");
        var button = createElement(
          "button",
          "nav-link" + (tab.id === this.state.currentTab ? " active" : ""),
          tab.label
        );
        button.type = "button";
        button.setAttribute("role", "tab");
        button.setAttribute("data-epg-tab", tab.id);
        li.appendChild(button);
        this.elements.tabs.appendChild(li);
      }.bind(this)
    );
  };

  EPGWidgetInstance.prototype.getCurrentTabDefinition = function () {
    return this.state.tabs.find(
      function (tab) {
        return tab.id === this.state.currentTab;
      }.bind(this)
    );
  };

  EPGWidgetInstance.prototype.getCurrentSourceData = function () {
    var tab = this.getCurrentTabDefinition();
    var sourceId = tab ? tab.sourceId : this.state.sources[0] ? this.state.sources[0].id : null;
    return sourceId ? this.state.dataBySource[sourceId] : null;
  };

  EPGWidgetInstance.prototype.buildDayKeys = function () {
    var now = new Date();
    var dayKeys = [];
    var days = normalizeDayCount(this.config.days);
    var daysBefore = normalizeDayCount(this.config.daysBefore);
    var startOffset = -daysBefore;
    var totalDays = days + daysBefore;
    for (var i = 0; i < totalDays; i += 1) {
      var date = addDays(now, startOffset + i);
      dayKeys.push(getDayKey(date, this.config.timezone));
    }
    this.state.dayKeys = dayKeys;
    this.state.dayStartOffset = startOffset;
  };

  EPGWidgetInstance.prototype.renderDateLinks = function () {
    this.elements.dateLinks.innerHTML = "";
    var linkDays = normalizeDayCount(this.config.days);
    this.elements.dateLinks.style.setProperty("--epg-date-columns", Math.max(1, linkDays));
    var now = new Date();
    for (var i = 0; i < linkDays; i += 1) {
      var date = addDays(now, i);
      var labelParts = formatDayLabelParts(date, this.config.timezone);
      var fullLabel = labelParts.month + "/" + labelParts.day + "(" + labelParts.weekday + ")";
      var button = createElement("button", "btn btn-sm btn-outline-secondary", "");
      if (labelParts.weekday === "土") {
        button.classList.add("epg-date-saturday");
      } else if (labelParts.weekday === "日") {
        button.classList.add("epg-date-sunday");
      }
      var fullLabelEl = createElement("span", "epg-date-label-full", fullLabel);
      var shortLabelEl = createElement("span", "epg-date-label-short", "");
      var shortDayEl = createElement("span", "epg-date-label-day", labelParts.day);
      var shortWeekdayEl = createElement("span", "epg-date-label-weekday", "(" + labelParts.weekday + ")");

      fullLabelEl.setAttribute("aria-hidden", "true");
      shortLabelEl.setAttribute("aria-hidden", "true");
      shortLabelEl.appendChild(shortDayEl);
      shortLabelEl.appendChild(shortWeekdayEl);
      button.appendChild(fullLabelEl);
      button.appendChild(shortLabelEl);
      button.type = "button";
      button.setAttribute("data-epg-day", getDayKey(date, this.config.timezone));
      button.setAttribute("aria-label", fullLabel);
      this.elements.dateLinks.appendChild(button);
    }
  };

  EPGWidgetInstance.prototype.renderBody = function () {
    var data = this.getCurrentSourceData();
    var currentTab = this.getCurrentTabDefinition();
    if (!data || !currentTab) {
      var emptyState = createElement("div", "epg-empty text-center text-body", "番組情報がありません。");
      this.elements.body.innerHTML = "";
      this.elements.body.appendChild(emptyState);
      return;
    }

    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.nowLineTimer) {
      clearInterval(this.nowLineTimer);
      this.nowLineTimer = null;
    }

    this.programIndex.clear();
    this.state.renderedDays = new Set();
    this.state.dayLoadingIndicators = {};
    this.state.dayRequests = {};
    this.state.renderToken = (this.state.renderToken || 0) + 1;

    var scrollContainer = createElement("div", "epg-scroll-container");

    this.elements.body.innerHTML = "";
    this.elements.body.appendChild(this.elements.alert);
    this.elements.body.appendChild(this.elements.loading);
    this.elements.loading.classList.add("d-none");
    this.elements.alert.classList.add("d-none");
    this.elements.body.appendChild(scrollContainer);

    var columns = this.buildColumns(currentTab, data);

    if (columns.length === 0) {
      var empty = createElement("div", "epg-empty text-center text-body", "番組情報がありません。");
      this.elements.body.innerHTML = "";
      this.elements.body.appendChild(this.elements.alert);
      this.elements.body.appendChild(empty);
      return;
    }

    this.state.columns = columns;

    var gridScroll = this.renderCombinedGrid(columns);
    if (!gridScroll) {
      var emptyGrid = createElement("div", "epg-empty text-center text-body", "番組情報がありません。");
      this.elements.body.innerHTML = "";
      this.elements.body.appendChild(this.elements.alert);
      this.elements.body.appendChild(emptyGrid);
      return;
    }

    scrollContainer.appendChild(gridScroll);

    this.syncHeaderHeights();
    this.observeSections();
    this.observeActiveDay();
    this.startNowLineTicker();

    if (this.state.scrollTop) {
      scrollContainer.scrollTop = this.state.scrollTop;
    } else if (!this.state.hasInitialScroll) {
      this.scrollToNow();
      this.state.hasInitialScroll = true;
    }
  };

  EPGWidgetInstance.prototype.observeSections = function () {
    var markers = this.elements.body.querySelectorAll(".epg-day-loading[data-day-key]");
    var renderSection = function (marker) {
      var dayKey = marker.getAttribute("data-day-key");
      this.renderDayPrograms(dayKey);
    }.bind(this);

    if ("IntersectionObserver" in window) {
      this.observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              renderSection(entry.target);
              this.observer.unobserve(entry.target);
            }
          }, this);
        }.bind(this),
        { root: this.elements.body.querySelector(".epg-scroll-container"), rootMargin: "200px" }
      );

      markers.forEach(
        function (marker) {
          this.observer.observe(marker);
        }.bind(this)
      );
    } else {
      markers.forEach(renderSection);
    }
  };

  EPGWidgetInstance.prototype.observeActiveDay = function () {
    var scrollContainer = this.elements.body.querySelector(".epg-scroll-container");
    if (!scrollContainer) {
      return;
    }

    var buttonsByDay = {};
    this.elements.dateLinks.querySelectorAll("button[data-epg-day]").forEach(function (button) {
      buttonsByDay[button.getAttribute("data-epg-day")] = button;
    });

    var setActive = function (dayKey) {
      Object.keys(buttonsByDay).forEach(function (key) {
        buttonsByDay[key].classList.toggle("active", key === dayKey);
      });
    };

    var dayHeight = 24 * 60 * this.config.pxPerMinute;
    var updateActiveFromScroll = function () {
      var headerOffset = this.state.headerHeight || 0;
      var adjusted = Math.max(0, scrollContainer.scrollTop - headerOffset);
      var dayIndex = Math.min(this.state.dayKeys.length - 1, Math.floor(adjusted / dayHeight));
      var dayKey = this.state.dayKeys[dayIndex];
      if (dayKey) {
        setActive(dayKey);
      }
    }.bind(this);

    var rafId = null;
    var onScroll = function () {
      if (rafId) {
        return;
      }
      rafId = requestAnimationFrame(function () {
        rafId = null;
        updateActiveFromScroll();
      });
    };

    scrollContainer.addEventListener("scroll", onScroll);
    updateActiveFromScroll();

    this.activeDayCleanup = function () {
      scrollContainer.removeEventListener("scroll", onScroll);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  };

  EPGWidgetInstance.prototype.syncHeaderHeights = function () {
    var gridFrame = this.elements.body.querySelector(".epg-grid-frame");
    var grid = this.elements.body.querySelector(".epg-grid");
    if (!gridFrame || !grid) {
      return;
    }
    var headers = gridFrame.querySelectorAll(".epg-channel-header");
    var timeHeader = gridFrame.querySelector(".epg-time-header");
    var timeInner = grid.querySelector(".epg-time-inner");
    if (!headers.length || !timeHeader || !timeInner) {
      return;
    }
    var maxHeight = 0;
    headers.forEach(function (header) {
      maxHeight = Math.max(maxHeight, header.offsetHeight);
    });
    if (maxHeight <= 0) {
      return;
    }
    this.state.headerHeight = maxHeight;
    gridFrame.style.setProperty("--epg-header-height", maxHeight + "px");
    timeHeader.style.height = maxHeight + "px";
  };

  EPGWidgetInstance.prototype.prepareDayData = function (data) {
    var timeZone = this.config.timezone;
    var daySet = new Set(this.state.dayKeys);
    var byDay = {};
    var labels = {};
    var now = new Date();
    var dayStartOffset =
      typeof this.state.dayStartOffset === "number"
        ? this.state.dayStartOffset
        : -normalizeDayCount(this.config.daysBefore);

    this.state.dayKeys.forEach(function (key, index) {
      byDay[key] = [];
      var date = addDays(now, dayStartOffset + index);
      labels[key] = formatDayLabel(date, timeZone);
    });

    (data.programs || []).forEach(
      function (program) {
        var date = new Date(program.startAt);
        var dayKey = getDayKey(date, timeZone);
        if (!daySet.has(dayKey)) {
          return;
        }
        byDay[dayKey].push(program);
      }.bind(this)
    );

    return { byDay: byDay, labels: labels };
  };

  EPGWidgetInstance.prototype.filterProgramsByDay = function (programs, dayKey) {
    var timeZone = this.config.timezone;
    return (programs || []).filter(function (program) {
      if (!program || program.startAt == null) {
        return false;
      }
      var date = new Date(program.startAt);
      return getDayKey(date, timeZone) === dayKey;
    });
  };

  EPGWidgetInstance.prototype.getProgramsForDay = function (dayKey, columns) {
    var data = this.getCurrentSourceData();
    if (!data) {
      return Promise.resolve([]);
    }
    if (this.config.programsFetchMode === "bulk") {
      return Promise.resolve(this.filterProgramsByDay(data.programs || [], dayKey));
    }
    return this.fetchProgramsForDay(dayKey, columns);
  };

  EPGWidgetInstance.prototype.fetchProgramsForDay = function (dayKey, columns) {
    var tab = this.getCurrentTabDefinition();
    var sourceId = tab ? tab.sourceId : this.state.sources[0] ? this.state.sources[0].id : null;
    var source = sourceId ? this.state.sourcesById[sourceId] : null;
    if (!source || !source.endpoints || !source.endpoints.programsUrl) {
      return Promise.resolve([]);
    }
    var range = getDayRange(dayKey, this.config.timezone);
    if (!range) {
      return Promise.resolve([]);
    }
    var serviceMap = {};
    var serviceList = [];
    (columns || this.state.columns || []).forEach(function (column) {
      (column.services || []).forEach(function (service) {
        var key = getServiceKey(service);
        if (!serviceMap[key]) {
          serviceMap[key] = service;
          serviceList.push(service);
        }
      });
    });
    if (!serviceList.length) {
      return Promise.resolve([]);
    }
    var cache = this.state.programCacheBySource[sourceId];
    if (!cache) {
      cache = { byService: {}, requests: {} };
      this.state.programCacheBySource[sourceId] = cache;
    }
    var baseUrl = source.endpoints.programsUrl;
    var requests = serviceList.map(
      function (service) {
        return this.fetchProgramsForServiceDay(baseUrl, cache, service, dayKey, range);
      }.bind(this)
    );
    return Promise.all(requests).then(function (results) {
      var combined = [];
      results.forEach(function (list) {
        if (Array.isArray(list)) {
          combined = combined.concat(list);
        }
      });
      return combined;
    });
  };

  EPGWidgetInstance.prototype.fetchProgramsForServiceDay = function (baseUrl, cache, service, dayKey, range) {
    var serviceKey = getServiceKey(service);
    var byService = cache.byService[serviceKey] || (cache.byService[serviceKey] = {});
    if (byService[dayKey]) {
      return Promise.resolve(byService[dayKey]);
    }
    var requests = cache.requests[serviceKey] || (cache.requests[serviceKey] = {});
    if (requests[dayKey]) {
      return requests[dayKey];
    }
    if (service.networkId == null || service.serviceId == null) {
      byService[dayKey] = [];
      return Promise.resolve([]);
    }
    var url = buildProgramsUrl(baseUrl, {
      networkId: service.networkId,
      serviceId: service.serviceId,
      since: range.since,
      until: range.until,
    });
    var promise = fetchJson(url)
      .then(function (list) {
        var programs = Array.isArray(list) ? list : [];
        programs = programs.filter(function (program) {
          return (
            program &&
            program.startAt != null &&
            program.startAt >= range.since &&
            program.startAt <= range.until
          );
        });
        byService[dayKey] = programs;
        delete requests[dayKey];
        return programs;
      })
      .catch(function (error) {
        delete requests[dayKey];
        throw error;
      });
    requests[dayKey] = promise;
    return promise;
  };

  EPGWidgetInstance.prototype.renderDayPrograms = function (dayKey) {
    if (this.state.renderedDays.has(dayKey)) {
      return;
    }
    var dayIndex = this.state.dayKeys.indexOf(dayKey);
    if (dayIndex === -1) {
      return;
    }
    var dayRequests = this.state.dayRequests || {};
    if (dayRequests[dayKey]) {
      return;
    }
    var dayHeight = 24 * 60 * this.config.pxPerMinute;
    var dayOffset = this.state.dayOffsets[dayKey] || dayIndex * dayHeight;
    var now = Date.now();
    var columns = this.state.columns || [];
    if (!columns.length) {
      return;
    }

    var renderToken = this.state.renderToken;
    var cleanup = function () {
      delete dayRequests[dayKey];
    };

    dayRequests[dayKey] = this.getProgramsForDay(dayKey, columns)
      .then(
        function (dayPrograms) {
          cleanup();
          if (this.state.renderToken !== renderToken) {
            return;
          }
          var list = Array.isArray(dayPrograms) ? dayPrograms : [];
          var compactHoverHeight = Math.max(COMPACT_PROGRAM_HOVER_HEIGHT, this.config.pxPerMinute * 16);
          var loadingIndicator = this.state.dayLoadingIndicators[dayKey];
          var overflowCandidates = [];
          var needsHeaderSync = false;
          if (!list.length) {
            if (loadingIndicator) {
              loadingIndicator.innerHTML =
                '<div class="epg-day-loading-inner text-body-secondary">番組情報がありません</div>';
            }
            this.state.renderedDays.add(dayKey);
            delete this.state.dayLoadingIndicators[dayKey];
            return;
          }

          var columnPrograms = this.collectProgramsForColumns(columns, list);
          columnPrograms.forEach(
            function (groups, columnIndex) {
              var programsContainer = this.state.programContainers[columnIndex];
              if (!programsContainer) {
                return;
              }
              var column = columns[columnIndex];
              var laidOut = this.layoutPrograms(groups || []);
              if (column && !column.hasMultiSchedule && Array.isArray(column.services) && column.services.length > 1) {
                var hasMultiSchedule = laidOut.some(function (item) {
                  return item.laneCount > 1;
                });
                if (hasMultiSchedule) {
                  if (this.markColumnAsMulti(columnIndex)) {
                    needsHeaderSync = true;
                  }
                }
              }

              laidOut.forEach(
                function (group) {
                  var program = pickDisplayProgram(group.programs) || {};
                  var startDate = new Date(group.startAt);
                  var endDate = new Date(group.endAt);
                  var startMinutes = getMinutesSinceMidnight(startDate, this.config.timezone);
                  var durationMinutes = Math.max(1, Math.round((group.endAt - group.startAt) / 60000));
                  var top = dayOffset + startMinutes * this.config.pxPerMinute;
                  var height = durationMinutes * this.config.pxPerMinute;
                  var programEl = createElement("div", "epg-program border", "");
                  var programId = group.key + "-" + group.startAt + "-" + dayKey + "-" + columnIndex;
                  programEl.setAttribute("data-program-id", programId);
                  programEl.setAttribute("tabindex", "0");
                  programEl.style.top = top + "px";
                  programEl.style.setProperty("--epg-program-height", height + "px");
                  programEl.style.left = (group.laneIndex / group.laneCount) * 100 + "%";
                  programEl.style.width = 100 / group.laneCount + "%";
                  programEl.style.setProperty(
                    "--epg-program-minute-bg",
                    resolveProgramAccent(program, group.programs)
                  );

                  if (group.startAt <= now && group.endAt > now) {
                    programEl.classList.add("epg-program-now");
                  }

                  if (group.endAt <= now) {
                    programEl.classList.add("epg-program-ended");
                  }

                  var titleText = program.name ? normalizeProgramText(program.name) : "-";
                  var timeText =
                    formatTime(startDate, this.config.timezone) + "〜" + formatTime(endDate, this.config.timezone);
                  var minuteText = formatMinute(startDate, this.config.timezone);
                  var summaryText = normalizeSummary(normalizeProgramText(getProgramSummary(program)));
                  if (!summaryText) {
                    summaryText = "";
                  }

                  var contentMarkup =
                    '<div class="epg-program-inner">' +
                    '<div class="epg-program-top">' +
                    '<span class="epg-program-minute">' +
                    minuteText +
                    "</span>" +
                    '<span class="epg-program-title">' +
                    titleText +
                    "</span>" +
                    "</div>" +
                    '<div class="epg-program-summary">' +
                    summaryText +
                    "</div>" +
                    "</div>";
                  programEl.innerHTML = contentMarkup;

                  this.programIndex.set(programId, {
                    raw: program,
                    group: group,
                    title: titleText,
                    time: timeText,
                    services: group.programs
                      .map(function (item) {
                        return getServiceKey(item);
                      })
                      .join(", "),
                  });

                  programsContainer.appendChild(programEl);
                  overflowCandidates.push({
                    element: programEl,
                    hoverHeight: Math.max(height, compactHoverHeight),
                    minuteText: minuteText,
                    titleText: titleText,
                    summaryText: summaryText,
                  });
                }.bind(this)
              );
            }.bind(this)
          );

          if (overflowCandidates.length) {
            this.applyProgramHoverOverflow(overflowCandidates, renderToken);
          }
          if (needsHeaderSync) {
            this.syncHeaderHeights();
          }
          this.state.renderedDays.add(dayKey);

          if (loadingIndicator && loadingIndicator.parentNode) {
            loadingIndicator.parentNode.removeChild(loadingIndicator);
          }
          delete this.state.dayLoadingIndicators[dayKey];
        }.bind(this),
        function (error) {
          cleanup();
          if (this.state.renderToken !== renderToken) {
            return;
          }
          var loadingIndicator = this.state.dayLoadingIndicators[dayKey];
          if (loadingIndicator) {
            loadingIndicator.innerHTML =
              '<div class="epg-day-loading-inner text-danger">番組情報の取得に失敗しました</div>';
          }
          this.showError("番組情報の取得に失敗しました: " + error.message);
        }.bind(this)
      );
  };

  EPGWidgetInstance.prototype.applyProgramHoverOverflow = function (candidates, renderToken) {
    if (!candidates || !candidates.length) {
      return;
    }
    var apply = function () {
      if (this.state.renderToken !== renderToken) {
        return;
      }
      var overflowed = [];
      candidates.forEach(function (candidate) {
        var programEl = candidate.element;
        if (!programEl || !programEl.isConnected) {
          return;
        }
        if (isProgramOverflowing(programEl)) {
          overflowed.push(candidate);
        }
      });

      overflowed.forEach(function (candidate) {
        var programEl = candidate.element;
        if (!programEl || !programEl.isConnected) {
          return;
        }
        programEl.classList.add("epg-program-compact");
        programEl.style.setProperty("--epg-program-hover-height", candidate.hoverHeight + "px");
        if (!programEl.querySelector(".epg-program-hover")) {
          programEl.insertAdjacentHTML(
            "beforeend",
            buildProgramHoverMarkup(candidate.minuteText, candidate.titleText, candidate.summaryText)
          );
        }
      });
    }.bind(this);

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(apply);
    } else {
      setTimeout(apply, 0);
    }
  };

  EPGWidgetInstance.prototype.buildColumns = function (tab, data) {
    var includeTypes = this.config.includeServiceTypes || [1];
    var services = data.services || [];
    var channels = data.channels || [];

    var servicesById = {};
    services.forEach(function (service) {
      servicesById[getServiceKey(service)] = service;
    });

    var pickMainService = function (serviceList) {
      if (!serviceList || serviceList.length === 0) {
        return null;
      }
      var candidates = serviceList.filter(function (service) {
        return service.type === 1;
      });
      if (candidates.length === 0) {
        candidates = serviceList.slice();
      }
      var primary = candidates.reduce(function (best, service) {
        if (!best) {
          return service;
        }
        var bestId = best.serviceId != null ? best.serviceId : Number.POSITIVE_INFINITY;
        var serviceId = service.serviceId != null ? service.serviceId : Number.POSITIVE_INFINITY;
        return serviceId < bestId ? service : best;
      }, null);
      return primary || serviceList[0];
    };

    var sortColumns = function (items) {
      return items.sort(function (a, b) {
        var aKey =
          a.mainService && a.mainService.remoteControlKeyId != null
            ? a.mainService.remoteControlKeyId
            : a.mainService
            ? a.mainService.serviceId
            : 0;
        var bKey =
          b.mainService && b.mainService.remoteControlKeyId != null
            ? b.mainService.remoteControlKeyId
            : b.mainService
            ? b.mainService.serviceId
            : 0;
        if (aKey !== bKey) {
          return aKey - bKey;
        }
        var aServiceId = a.mainService ? a.mainService.serviceId : 0;
        var bServiceId = b.mainService ? b.mainService.serviceId : 0;
        return aServiceId - bServiceId;
      });
    };

    var channelMatches = function (channel) {
      if (tab.channelFilter && typeof tab.channelFilter === "function") {
        return tab.channelFilter(channel);
      }
      if (tab.channelTypes) {
        var types = Array.isArray(tab.channelTypes) ? tab.channelTypes : [tab.channelTypes];
        return types.indexOf(channel.type) !== -1;
      }
      return true;
    };

    var serviceMatches = function (service) {
      if (includeTypes.indexOf(service.type) === -1) {
        return false;
      }
      if (tab.serviceFilter && typeof tab.serviceFilter === "function") {
        return tab.serviceFilter(service);
      }
      return true;
    };

    if (tab.mode === "service") {
      var serviceColumns = [];
      channels
        .filter(channelMatches)
        .forEach(function (channel) {
          (channel.services || channel._services || [])
            .filter(serviceMatches)
            .forEach(function (service) {
              var fullService = servicesById[getServiceKey(service)] || service;
              serviceColumns.push({
                key: (tab.id || "tab") + "-" + getServiceKey(service),
                name: fullService.name || "(サービス名なし)",
                services: [fullService],
                mainService: fullService,
              });
            });
        });
      return sortColumns(serviceColumns);
    }

    var groupedColumns = channels
      .filter(channelMatches)
      .map(function (channel) {
        var filteredServices = (channel.services || channel._services || [])
          .filter(serviceMatches)
          .map(function (service) {
            return servicesById[getServiceKey(service)] || service;
          });
        if (filteredServices.length === 0) {
          return null;
        }
        var mainService = pickMainService(filteredServices);
        return {
          key: (tab.id || "tab") + "-" + channel.channel,
          name: (mainService && mainService.name) || channel.name || channel.channel,
          services: filteredServices,
          mainService: mainService,
        };
      })
      .filter(function (col) {
        return col !== null;
      });
    return sortColumns(groupedColumns);
  };

  EPGWidgetInstance.prototype.collectProgramsForColumns = function (columns, dayPrograms) {
    var programsByService = {};
    dayPrograms.forEach(function (program) {
      var programKey = getServiceKey(program);
      if (!programsByService[programKey]) {
        programsByService[programKey] = [];
      }
      programsByService[programKey].push(program);
    });

    return columns.map(function (column) {
      var serviceIds = column.services.map(function (service) {
        return getServiceKey(service);
      });
      return this.mergeProgramsForServices(serviceIds, programsByService);
    }, this);
  };

  EPGWidgetInstance.prototype.mergeProgramsForServices = function (serviceIds, programsByService) {
    var groups = {};

    serviceIds.forEach(function (serviceId) {
      var list = programsByService[serviceId] || [];
      list.forEach(function (program) {
        var sharedKey = null;
        if (Array.isArray(program.relatedItems)) {
          var sharedItems = program.relatedItems.filter(function (item) {
            return item.type === "shared";
          });
          if (sharedItems.length) {
            var sharedCandidates = sharedItems.map(function (item) {
              var relatedNetworkId = item.networkId != null ? item.networkId : program.networkId;
              return relatedNetworkId + ":" + item.serviceId + ":" + item.eventId;
            });
            if (program.serviceId !== undefined && program.eventId !== undefined) {
              sharedCandidates.push(
                (program.networkId != null ? program.networkId : "unknown") +
                  ":" +
                  program.serviceId +
                  ":" +
                  program.eventId
              );
            }
            sharedCandidates = Array.from(new Set(sharedCandidates)).filter(function (entry) {
              return entry.indexOf("undefined") === -1;
            });
            sharedCandidates.sort();
            var canonicalShared = sharedCandidates[0] || program.eventId;
            sharedKey = "shared-" + canonicalShared;
          }
        }
        var fallbackName = program.name || "";
        var fallbackKey = program.startAt + "-" + program.duration + "-" + fallbackName;
        var eventKey = program.eventId
          ? "event-" + program.eventId + "-" + program.startAt + "-" + program.duration
          : null;
        var groupKey = sharedKey || eventKey || fallbackKey;
        if (!groups[groupKey]) {
          groups[groupKey] = {
            key: groupKey,
            startAt: program.startAt,
            endAt: program.startAt + program.duration,
            programs: [],
            minServiceId: program.serviceId != null ? program.serviceId : Number.POSITIVE_INFINITY,
          };
        }
        groups[groupKey].programs.push(program);
        groups[groupKey].startAt = Math.min(groups[groupKey].startAt, program.startAt);
        groups[groupKey].endAt = Math.max(groups[groupKey].endAt, program.startAt + program.duration);
        if (program.serviceId != null) {
          groups[groupKey].minServiceId = Math.min(groups[groupKey].minServiceId, program.serviceId);
        }
      });
    });

    return Object.keys(groups).map(function (key) {
      var group = groups[key];
      group.programs.sort(function (a, b) {
        var aService = a.serviceId != null ? a.serviceId : Number.POSITIVE_INFINITY;
        var bService = b.serviceId != null ? b.serviceId : Number.POSITIVE_INFINITY;
        if (aService !== bService) {
          return aService - bService;
        }
        return (a.eventId || 0) - (b.eventId || 0);
      });
      return group;
    });
  };

  EPGWidgetInstance.prototype.renderCombinedGrid = function (columns) {
    if (columns.length === 0) {
      return null;
    }

    var gridScroll = createElement("div", "epg-grid-scroll");
    var gridFrame = createElement("div", "epg-grid-frame");
    var gridHeader = createElement("div", "epg-grid-header");
    var grid = createElement("div", "epg-grid");
    var timeColumn = createElement("div", "epg-time-column border-end");
    var timeInner = createElement("div", "epg-time-inner");
    var dayHeight = 24 * 60 * this.config.pxPerMinute;
    var totalHeight = this.state.dayKeys.length * dayHeight;
    timeInner.style.height = totalHeight + "px";

    this.state.dayOffsets = {};

    this.state.dayKeys.forEach(
      function (dayKey, index) {
        var dayOffset = index * dayHeight;
        this.state.dayOffsets[dayKey] = dayOffset;
        if (index > 0) {
          var dayDivider = createElement("div", "epg-time-divider", "");
          dayDivider.style.top = dayOffset + "px";
          timeInner.appendChild(dayDivider);
        }
        for (var hour = 0; hour < 24; hour += 1) {
          var label = createElement("div", "epg-time-label text-body", hour.toString().padStart(2, "0"));
          label.style.top = dayOffset + hour * 60 * this.config.pxPerMinute + "px";
          timeInner.appendChild(label);
        }
      }.bind(this)
    );

    timeColumn.appendChild(timeInner);

    var columnsWrapper = createElement("div", "epg-columns");
    this.state.programContainers = [];
    this.state.columnElements = [];
    this.state.columnHeaderElements = [];

    columns.forEach(
      function (column, index) {
        var columnEl = createElement("div", "epg-channel-column border-end");
        var header = createElement("div", "epg-channel-header bg-body border-bottom border-end", "");
        var headerTop = createElement("div", "epg-channel-header-row epg-channel-header-top", "");
        var logoSlot = createElement("div", "epg-channel-header-slot epg-channel-header-logo-slot", "");
        var headerSpacer = createElement("div", "epg-channel-header-spacer", "");
        var title = createElement("div", "epg-channel-title", column.name);
        var badgeSlot = createElement("div", "epg-channel-header-slot epg-channel-header-badge-slot", "");
        if (column && column.hasMultiSchedule) {
          columnEl.classList.add("epg-channel-column--multi");
          header.classList.add("epg-channel-header--multi");
        }
        var primaryService = column.mainService || column.services[0];
        var badgeValue = "";
        if (primaryService && primaryService.remoteControlKeyId != null) {
          badgeValue = String(primaryService.remoteControlKeyId);
        } else if (primaryService && primaryService.serviceId != null) {
          badgeValue = String(primaryService.serviceId);
        }
        if (badgeValue) {
          var badge = createElement("span", "epg-channel-badge", badgeValue);
          badgeSlot.appendChild(badge);
        }
        var logoUrl = resolveServiceLogoUrl(primaryService || column.services[0], this.config);
        if (logoUrl) {
          var logo = createElement("img", "epg-channel-logo", "");
          logo.src = logoUrl;
          logo.alt = column.name;
          logoSlot.appendChild(logo);
        }

        headerTop.appendChild(logoSlot);
        headerTop.appendChild(headerSpacer);
        headerTop.appendChild(badgeSlot);
        header.appendChild(headerTop);
        header.appendChild(title);

        var programsContainer = createElement("div", "epg-programs");
        programsContainer.style.height = totalHeight + "px";

        this.state.dayKeys.forEach(
          function (dayKey, dayIndex) {
            var divider = createElement("div", "epg-day-divider", "");
            divider.style.top = dayIndex * dayHeight + "px";
            programsContainer.appendChild(divider);
          }.bind(this)
        );

        if (this.config.nowLine) {
          var now = new Date();
          var nowKey = getDayKey(now, this.config.timezone);
          if (this.state.dayOffsets[nowKey] !== undefined) {
            var nowLine = createElement("div", "epg-now-line", "");
            nowLine.style.top =
              this.state.dayOffsets[nowKey] +
              getMinutesSinceMidnight(now, this.config.timezone) * this.config.pxPerMinute +
              "px";
            programsContainer.appendChild(nowLine);
          }
        }

        columnEl.appendChild(programsContainer);
        gridHeader.appendChild(header);
        columnsWrapper.appendChild(columnEl);
        this.state.programContainers.push(programsContainer);
        this.state.columnElements.push(columnEl);
        this.state.columnHeaderElements.push(header);
      }.bind(this)
    );

    grid.appendChild(timeColumn);
    grid.appendChild(columnsWrapper);
    gridFrame.appendChild(gridHeader);
    gridFrame.appendChild(grid);
    gridScroll.appendChild(gridFrame);

    this.state.dayKeys.forEach(
      function (dayKey) {
        var dayOffset = this.state.dayOffsets[dayKey] || 0;
        var dayLoading = createElement("div", "epg-day-loading");
        dayLoading.style.top = dayOffset + "px";
        dayLoading.style.height = dayHeight + "px";
        dayLoading.setAttribute("data-day-key", dayKey);
        dayLoading.innerHTML =
          '<div class="epg-day-loading-inner text-body-secondary">' +
          '<div class="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true"></div>' +
          '<span>番組情報を読み込み中...</span>' +
          "</div>";
        this.state.dayLoadingIndicators[dayKey] = dayLoading;
        grid.appendChild(dayLoading);
      }.bind(this)
    );
    return gridScroll;
  };

  EPGWidgetInstance.prototype.updateNowLinePosition = function () {
    if (!this.config.nowLine || !this.state.dayOffsets) {
      return;
    }
    var now = new Date();
    var nowKey = getDayKey(now, this.config.timezone);
    var dayOffset = this.state.dayOffsets[nowKey];
    var nowLines = this.elements.body.querySelectorAll(".epg-now-line");
    if (!nowLines.length) {
      return;
    }
    if (dayOffset === undefined) {
      nowLines.forEach(function (line) {
        line.style.display = "none";
      });
      return;
    }
    var top =
      dayOffset + getMinutesSinceMidnight(now, this.config.timezone) * this.config.pxPerMinute + "px";
    nowLines.forEach(function (line) {
      line.style.display = "block";
      line.style.top = top;
    });
  };

  EPGWidgetInstance.prototype.startNowLineTicker = function () {
    if (!this.config.nowLine) {
      return;
    }
    this.updateNowLinePosition();
    this.nowLineTimer = setInterval(
      function () {
        this.updateNowLinePosition();
      }.bind(this),
      30000
    );
  };

  EPGWidgetInstance.prototype.scrollToNow = function () {
    var scrollContainer = this.elements.body.querySelector(".epg-scroll-container");
    if (!scrollContainer) {
      return;
    }
    var now = new Date();
    var nowKey = getDayKey(now, this.config.timezone);
    var dayOffset = this.state.dayOffsets ? this.state.dayOffsets[nowKey] : undefined;
    if (dayOffset === undefined) {
      return;
    }
    var headerOffset = this.state.headerHeight || 0;
    var minutes = Math.max(0, getMinutesSinceMidnight(now, this.config.timezone) - 60);
    var top = dayOffset + minutes * this.config.pxPerMinute;
    scrollContainer.scrollTop = Math.max(0, top - headerOffset);
  };

  EPGWidgetInstance.prototype.layoutPrograms = function (groups) {
    var sorted = groups.slice().sort(function (a, b) {
      if (a.startAt !== b.startAt) {
        return a.startAt - b.startAt;
      }
      var aService = a.minServiceId != null ? a.minServiceId : Number.POSITIVE_INFINITY;
      var bService = b.minServiceId != null ? b.minServiceId : Number.POSITIVE_INFINITY;
      if (aService !== bService) {
        return aService - bService;
      }
      return (a.endAt || 0) - (b.endAt || 0);
    });
    var active = [];
    var lanes = [];

    sorted.forEach(function (group) {
      active = active.filter(function (item) {
        return item.endAt > group.startAt;
      });
      lanes = lanes.filter(function (lane) {
        return active.some(function (item) {
          return item.laneIndex === lane;
        });
      });

      var laneIndex = 0;
      while (lanes.indexOf(laneIndex) !== -1) {
        laneIndex += 1;
      }
      lanes.push(laneIndex);
      group.laneIndex = laneIndex;
      active.push({ endAt: group.endAt, laneIndex: laneIndex });
    });

    var components = [];
    var currentComponent = [];
    var currentEnd = null;

    sorted.forEach(function (group) {
      if (!currentComponent.length) {
        currentComponent = [group];
        currentEnd = group.endAt;
        return;
      }

      if (group.startAt < currentEnd) {
        currentComponent.push(group);
        currentEnd = Math.max(currentEnd, group.endAt);
        return;
      }

      components.push(currentComponent);
      currentComponent = [group];
      currentEnd = group.endAt;
    });

    if (currentComponent.length) {
      components.push(currentComponent);
    }

    components.forEach(function (component) {
      var events = [];
      component.forEach(function (item) {
        events.push({ time: item.startAt, delta: 1 });
        events.push({ time: item.endAt, delta: -1 });
      });

      events.sort(function (a, b) {
        if (a.time === b.time) {
          return a.delta - b.delta;
        }
        return a.time - b.time;
      });

      var active = 0;
      var maxActive = 0;
      events.forEach(function (event) {
        active += event.delta;
        maxActive = Math.max(maxActive, active);
      });

      var laneCount = Math.max(1, maxActive || 1);
      component.forEach(function (item) {
        item.laneCount = laneCount;
      });
    });

    return sorted;
  };

  EPGWidgetInstance.prototype.computeMaxOverlap = function (group, groups) {
    var overlaps = groups.filter(function (other) {
      return other.startAt < group.endAt && other.endAt > group.startAt;
    });

    var events = [];
    overlaps.forEach(function (item) {
      events.push({ time: item.startAt, delta: 1 });
      events.push({ time: item.endAt, delta: -1 });
    });

    events.sort(function (a, b) {
      if (a.time === b.time) {
        return a.delta - b.delta;
      }
      return a.time - b.time;
    });

    var active = 0;
    var maxActive = 0;
    events.forEach(function (event) {
      active += event.delta;
      maxActive = Math.max(maxActive, active);
    });

    return maxActive || 1;
  };

  EPGWidgetInstance.prototype.openModal = function (programData) {
    var program = programData.raw || {};
    var title = program.name ? normalizeProgramText(program.name) : "（番組情報なし）";
    var description = program.description ? normalizeProgramText(program.description) : "";
    var extended = program.extended || {};
    var extendedHtml = "";
    if (typeof extended === "string") {
      extendedHtml = normalizeProgramText(extended);
    } else if (extended && typeof extended === "object") {
      extendedHtml = Object.keys(extended)
        .map(function (key) {
          return (
            "<div><strong>" +
            normalizeProgramText(key) +
            "</strong>: " +
            normalizeProgramText(extended[key]) +
            "</div>"
          );
        })
        .join("");
    }
    var isFree = program.isFree === false ? "有料" : "無料";
    var bodyHtml =
      "<div class=\"mb-2\"><strong>放送時間</strong>: " +
      programData.time +
      "</div>" +
      "<div class=\"mb-2\"><strong>料金</strong>: " +
      isFree +
      "</div>" +
      (description ? "<div class=\"mb-2\">" + description + "</div>" : "") +
      (extendedHtml ? "<div class=\"mb-2\">" + extendedHtml + "</div>" : "");

    this.elements.modal.open(bodyHtml);
    this.elements.modal.title.textContent = title;
  };

  function mount(target, config) {
    var element = resolveTarget(target);
    if (!element) {
      throw new Error("targetが見つかりません。");
    }
    if (element.__epgInstance) {
      element.__epgInstance.destroy();
    }
    element.__epgInstance = new EPGWidgetInstance(element, config || {});
    return element.__epgInstance;
  }

  return {
    mount: mount,
  };
});
