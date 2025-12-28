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
    days: 8,
    initialTab: "GR",
    includeServiceTypes: [1],
    timezone: "Asia/Tokyo",
    pxPerMinute: 2,
    nowLine: true,
    onProgramClick: null,
    logoResolver: null,
  };

  var tabTypes = ["GR", "BS", "CS"];

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

  function resolveTarget(target) {
    if (typeof target === "string") {
      return document.querySelector(target);
    }
    if (target instanceof HTMLElement) {
      return target;
    }
    return null;
  }

  function formatDayLabel(date, timeZone) {
    var formatter = new Intl.DateTimeFormat("ja-JP", {
      timeZone: timeZone,
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    });
    var parts = formatter.formatToParts(date);
    var month = parts.find(function (p) {
      return p.type === "month";
    }).value;
    var day = parts.find(function (p) {
      return p.type === "day";
    }).value;
    var weekday = parts.find(function (p) {
      return p.type === "weekday";
    }).value;
    return month + "/" + day + "(" + weekday + ")";
  }

  function formatTime(date, timeZone) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
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

  function EPGWidgetInstance(target, config) {
    this.target = target;
    this.config = mergeConfig(defaults, config || {});
    this.state = {
      currentTab: this.config.initialTab,
      scrollTop: 0,
      data: null,
      dayKeys: [],
      renderedDays: new Set(),
    };
    this.elements = {};
    this.programIndex = new Map();
    this.observer = null;
    this.init();
  }

  EPGWidgetInstance.prototype.init = function () {
    this.target.innerHTML = "";
    this.target.classList.add("epg-widget");

    var wrapper = createElement("div", "epg-container");
    var header = createElement("div", "epg-header");
    var tabs = createElement("ul", "nav nav-tabs epg-tabs");
    tabs.setAttribute("role", "tablist");

    tabTypes.forEach(
      function (tabType) {
        var li = createElement("li", "nav-item");
        var button = createElement(
          "button",
          "nav-link" + (tabType === this.state.currentTab ? " active" : ""),
          tabType
        );
        button.type = "button";
        button.setAttribute("role", "tab");
        button.setAttribute("data-epg-tab", tabType);
        li.appendChild(button);
        tabs.appendChild(li);
      }.bind(this)
    );

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
      var section = this.elements.body.querySelector(
        '.epg-day-section[data-day-key="' + dayKey + '"]'
      );
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
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
        if (this.state.data) {
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
    this.detachEvents();
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
    var endpoints = this.config.endpoints || {};
    if (!endpoints.servicesUrl || !endpoints.channelsUrl || !endpoints.programsUrl) {
      this.showError("エンドポイントの設定が不足しています。");
      return;
    }

    this.elements.loading.classList.remove("d-none");
    this.elements.alert.classList.add("d-none");

    Promise.all([
      fetchJson(endpoints.servicesUrl),
      fetchJson(endpoints.channelsUrl),
      fetchJson(endpoints.programsUrl),
    ])
      .then(
        function (responses) {
          this.state.data = {
            services: responses[0],
            channels: responses[1],
            programs: responses[2],
          };
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
    Array.prototype.forEach.call(this.elements.tabs.querySelectorAll(".nav-link"), function (tab) {
      if (tab.getAttribute("data-epg-tab") === this.state.currentTab) {
        tab.classList.add("active");
      } else {
        tab.classList.remove("active");
      }
    }, this);
  };

  EPGWidgetInstance.prototype.buildDayKeys = function () {
    var now = new Date();
    var dayKeys = [];
    for (var i = 0; i < this.config.days; i += 1) {
      var date = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      dayKeys.push(getDayKey(date, this.config.timezone));
    }
    this.state.dayKeys = dayKeys;
  };

  EPGWidgetInstance.prototype.renderDateLinks = function () {
    this.elements.dateLinks.innerHTML = "";
    var now = new Date();
    for (var i = 0; i < this.state.dayKeys.length; i += 1) {
      var date = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      var button = createElement("button", "btn btn-sm btn-outline-secondary", formatDayLabel(date, this.config.timezone));
      button.type = "button";
      button.setAttribute("data-epg-day", this.state.dayKeys[i]);
      this.elements.dateLinks.appendChild(button);
    }
  };

  EPGWidgetInstance.prototype.renderBody = function () {
    if (!this.state.data) {
      return;
    }

    if (this.observer) {
      this.observer.disconnect();
    }

    this.programIndex.clear();
    this.state.renderedDays = new Set();

    var scrollContainer = createElement("div", "epg-scroll-container");
    var sectionsWrapper = createElement("div", "epg-sections");
    scrollContainer.appendChild(sectionsWrapper);

    this.elements.body.innerHTML = "";
    this.elements.body.appendChild(scrollContainer);

    var dayData = this.prepareDayData();
    var emptyCount = 0;

    this.state.dayKeys.forEach(
      function (dayKey) {
        var daySection = createElement("section", "epg-day-section", "");
        daySection.setAttribute("data-day-key", dayKey);

        var header = createElement("div", "epg-day-header bg-body border", "");
        header.textContent = dayData.labels[dayKey] || dayKey;
        header.setAttribute("data-day-header", dayKey);

        var placeholder = createElement("div", "epg-day-placeholder", "読み込み中...");

        daySection.appendChild(header);
        daySection.appendChild(placeholder);

        sectionsWrapper.appendChild(daySection);

        if (!dayData.byDay[dayKey] || dayData.byDay[dayKey].length === 0) {
          emptyCount += 1;
        }
      }.bind(this)
    );

    if (emptyCount === this.state.dayKeys.length) {
      var empty = createElement("div", "epg-empty text-center text-body", "番組情報がありません。");
      this.elements.body.innerHTML = "";
      this.elements.body.appendChild(empty);
      return;
    }

    this.observeSections(dayData);
    this.observeActiveDay();

    if (this.state.scrollTop) {
      scrollContainer.scrollTop = this.state.scrollTop;
    }
  };

  EPGWidgetInstance.prototype.observeSections = function (dayData) {
    var sections = this.elements.body.querySelectorAll(".epg-day-section");
    var renderSection = function (section) {
      var dayKey = section.getAttribute("data-day-key");
      if (this.state.renderedDays.has(dayKey)) {
        return;
      }
      this.state.renderedDays.add(dayKey);
      var content = this.renderDaySection(dayKey, dayData);
      section.innerHTML = "";
      section.appendChild(content.header);
      section.appendChild(content.body);
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

      sections.forEach(
        function (section) {
          this.observer.observe(section);
        }.bind(this)
      );
    } else {
      sections.forEach(renderSection);
    }
  };

  EPGWidgetInstance.prototype.observeActiveDay = function () {
    var scrollContainer = this.elements.body.querySelector(".epg-scroll-container");
    if (!scrollContainer || !("IntersectionObserver" in window)) {
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

    var headers = scrollContainer.querySelectorAll(".epg-day-header[data-day-header]");
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            setActive(entry.target.getAttribute("data-day-header"));
          }
        });
      },
      { root: scrollContainer, threshold: 0.6 }
    );

    headers.forEach(function (header) {
      observer.observe(header);
    });
  };

  EPGWidgetInstance.prototype.prepareDayData = function () {
    var timeZone = this.config.timezone;
    var daySet = new Set(this.state.dayKeys);
    var byDay = {};
    var labels = {};

    this.state.dayKeys.forEach(function (key, index) {
      byDay[key] = [];
      var date = new Date(Date.now() + index * 24 * 60 * 60 * 1000);
      labels[key] = formatDayLabel(date, timeZone);
    });

    this.state.data.programs.forEach(
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

  EPGWidgetInstance.prototype.renderDaySection = function (dayKey, dayData) {
    var header = createElement("div", "epg-day-header bg-body border", dayData.labels[dayKey] || dayKey);
    header.setAttribute("data-day-header", dayKey);
    var body = createElement("div", "epg-day-body");

    var dayPrograms = dayData.byDay[dayKey] || [];
    var columns = this.buildColumns();
    var columnPrograms = this.collectProgramsForColumns(columns, dayPrograms);
    var grid = this.renderGrid(columns, columnPrograms, dayKey);

    if (grid) {
      body.appendChild(grid);
    } else {
      body.appendChild(createElement("div", "epg-empty text-center text-body", "番組情報がありません。"));
    }

    return { header: header, body: body };
  };

  EPGWidgetInstance.prototype.buildColumns = function () {
    var includeTypes = this.config.includeServiceTypes || [1];
    var services = this.state.data.services || [];
    var channels = this.state.data.channels || [];

    var servicesById = {};
    services.forEach(function (service) {
      servicesById[service.serviceId] = service;
    });

    if (this.state.currentTab === "CS") {
      var csColumns = [];
      channels
        .filter(function (channel) {
          return channel.type === "CS";
        })
        .forEach(function (channel) {
          channel.services
            .filter(function (service) {
              return includeTypes.indexOf(service.type) !== -1;
            })
            .forEach(function (service) {
              var fullService = servicesById[service.serviceId] || service;
              csColumns.push({
                key: "CS-" + service.serviceId,
                name: fullService.name || "(サービス名なし)",
                services: [fullService],
              });
            });
        });
      return csColumns;
    }

    return channels
      .filter(
        function (channel) {
          return channel.type === this.state.currentTab;
        }.bind(this)
      )
      .map(function (channel) {
        var filteredServices = channel.services
          .filter(function (service) {
            return includeTypes.indexOf(service.type) !== -1;
          })
          .map(function (service) {
            return servicesById[service.serviceId] || service;
          });
        if (filteredServices.length === 0) {
          return null;
        }
        return {
          key: channel.type + "-" + channel.channel,
          name: channel.name || channel.channel,
          services: filteredServices,
        };
      })
      .filter(function (col) {
        return col !== null;
      });
  };

  EPGWidgetInstance.prototype.collectProgramsForColumns = function (columns, dayPrograms) {
    var programsByService = {};
    dayPrograms.forEach(function (program) {
      if (!programsByService[program.serviceId]) {
        programsByService[program.serviceId] = [];
      }
      programsByService[program.serviceId].push(program);
    });

    return columns.map(function (column) {
      var serviceIds = column.services.map(function (service) {
        return service.serviceId;
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
            var combined = sharedItems
              .map(function (item) {
                return item.serviceId + ":" + item.eventId;
              })
              .concat(program.serviceId + ":" + program.eventId);
            combined.sort();
            sharedKey = combined.join("|");
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
          };
        }
        groups[groupKey].programs.push(program);
        groups[groupKey].startAt = Math.min(groups[groupKey].startAt, program.startAt);
        groups[groupKey].endAt = Math.max(groups[groupKey].endAt, program.startAt + program.duration);
      });
    });

    return Object.keys(groups).map(function (key) {
      return groups[key];
    });
  };

  EPGWidgetInstance.prototype.renderGrid = function (columns, columnPrograms, dayKey) {
    if (columns.length === 0) {
      return null;
    }

    var gridScroll = createElement("div", "epg-grid-scroll");
    var grid = createElement("div", "epg-grid");
    var timeColumn = createElement("div", "epg-time-column border-end");
    var timeInner = createElement("div", "epg-time-inner");
    var dayHeight = 24 * 60 * this.config.pxPerMinute;
    timeInner.style.height = dayHeight + "px";

    for (var hour = 0; hour < 24; hour += 1) {
      var label = createElement("div", "epg-time-label text-body", hour.toString().padStart(2, "0"));
      label.style.top = hour * 60 * this.config.pxPerMinute + "px";
      timeInner.appendChild(label);
    }

    timeColumn.appendChild(timeInner);

    var columnsWrapper = createElement("div", "epg-columns");

    columns.forEach(
      function (column, index) {
        var columnEl = createElement("div", "epg-channel-column border-end");
        var header = createElement("div", "epg-channel-header bg-body border-bottom", "");
        var title = createElement("div", "epg-channel-title", column.name);
        var meta = createElement("div", "epg-channel-meta", "");
        if (column.services[0] && column.services[0].remoteControlKeyId) {
          meta.textContent = "リモコン" + column.services[0].remoteControlKeyId;
        }
        var logo = null;
        if (typeof this.config.logoResolver === "function") {
          var logoUrl = this.config.logoResolver(column.services[0]);
          if (logoUrl) {
            logo = createElement("img", "epg-channel-logo", "");
            logo.src = logoUrl;
            logo.alt = column.name;
          }
        }

        if (logo) {
          header.appendChild(logo);
        }
        header.appendChild(title);
        if (meta.textContent) {
          header.appendChild(meta);
        }

        var programsContainer = createElement("div", "epg-programs");
        programsContainer.style.height = dayHeight + "px";

        var groups = this.layoutPrograms(columnPrograms[index] || []);

        groups.forEach(
          function (group) {
            var program = group.programs[0] || {};
            var startDate = new Date(group.startAt);
            var endDate = new Date(group.endAt);
            var startMinutes = getMinutesSinceMidnight(startDate, this.config.timezone);
            var durationMinutes = Math.max(1, Math.round((group.endAt - group.startAt) / 60000));
            var top = startMinutes * this.config.pxPerMinute;
            var height = durationMinutes * this.config.pxPerMinute;
            var programEl = createElement("div", "epg-program border", "");
            var programId = group.key + "-" + group.startAt;
            programEl.setAttribute("data-program-id", programId);
            programEl.setAttribute("tabindex", "0");
            programEl.style.top = top + "px";
            programEl.style.height = height + "px";
            programEl.style.left = (group.laneIndex / group.laneCount) * 100 + "%";
            programEl.style.width = 100 / group.laneCount + "%";

            var titleText = program.name || "（番組情報なし）";
            var timeText =
              formatTime(startDate, this.config.timezone) + "〜" + formatTime(endDate, this.config.timezone);

            programEl.innerHTML =
              '<div class="epg-program-inner">' +
              '<div class="epg-program-title">' +
              titleText +
              "</div>" +
              '<div class="epg-program-time">' +
              timeText +
              "</div>" +
              "</div>";

            this.programIndex.set(programId, {
              raw: program,
              group: group,
              title: titleText,
              time: timeText,
              services: group.programs
                .map(function (item) {
                  return item.serviceId;
                })
                .join(", "),
            });

            programsContainer.appendChild(programEl);
          }.bind(this)
        );

        if (this.config.nowLine) {
          var now = new Date();
          var nowKey = getDayKey(now, this.config.timezone);
          if (nowKey === dayKey) {
            var nowLine = createElement("div", "epg-now-line", "");
            nowLine.style.top = getMinutesSinceMidnight(now, this.config.timezone) * this.config.pxPerMinute + "px";
            programsContainer.appendChild(nowLine);
          }
        }

        columnEl.appendChild(header);
        columnEl.appendChild(programsContainer);
        columnsWrapper.appendChild(columnEl);
      }.bind(this)
    );

    grid.appendChild(timeColumn);
    grid.appendChild(columnsWrapper);
    gridScroll.appendChild(grid);
    return gridScroll;
  };

  EPGWidgetInstance.prototype.layoutPrograms = function (groups) {
    var sorted = groups.slice().sort(function (a, b) {
      return a.startAt - b.startAt;
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

    sorted.forEach(function (group) {
      group.laneCount = Math.max(1, this.computeMaxOverlap(group, sorted));
    }, this);

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
        return b.delta - a.delta;
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
    var title = program.name || "（番組情報なし）";
    var description = program.description || "";
    var extended = program.extended || {};
    var extendedHtml = Object.keys(extended)
      .map(function (key) {
        return "<div><strong>" + key + "</strong>: " + extended[key] + "</div>";
      })
      .join("");
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
