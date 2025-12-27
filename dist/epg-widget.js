(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EPGWidget = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const DEFAULT_CONFIG = {
    endpoints: {
      servicesUrl: "",
      channelsUrl: "",
      programsUrl: "",
    },
    days: 8,
    initialTab: "GR",
    includeServiceTypes: [1],
    timezone: "Asia/Tokyo",
    pxPerMinute: 1.2,
    onProgramClick: null,
    logoResolver: null,
    nowLine: true,
  };

  const TAB_TYPES = ["GR", "BS", "CS"];

  function mount(target, userConfig) {
    const config = mergeConfig(userConfig);
    const rootEl = resolveTarget(target);
    if (!rootEl) {
      throw new Error("EPGWidget: target element not found");
    }

    if (rootEl.__epgWidgetInstance) {
      rootEl.__epgWidgetInstance.destroy();
    }

    const state = createState(rootEl, config);
    rootEl.__epgWidgetInstance = state;
    state.init();
    return state;
  }

  function mergeConfig(userConfig) {
    const config = Object.assign({}, DEFAULT_CONFIG, userConfig || {});
    config.endpoints = Object.assign({}, DEFAULT_CONFIG.endpoints, (userConfig || {}).endpoints || {});
    config.includeServiceTypes = Array.isArray(config.includeServiceTypes)
      ? config.includeServiceTypes
      : DEFAULT_CONFIG.includeServiceTypes;
    config.days = Number(config.days || DEFAULT_CONFIG.days);
    config.pxPerMinute = Number(config.pxPerMinute || DEFAULT_CONFIG.pxPerMinute);
    config.initialTab = TAB_TYPES.includes(config.initialTab) ? config.initialTab : "GR";
    return config;
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

  function createState(rootEl, config) {
    let currentTab = config.initialTab;
    let dataCache = null;
    let scrollPositions = new Map();
    let observer = null;
    let programMap = new Map();

    const layout = buildLayout(rootEl, config);

    function init() {
      renderTabs();
      renderDateLinks();
      setStatusLoading();
      fetchAll()
        .then((data) => {
          dataCache = data;
          programMap = data.programById;
          setStatusClear();
          renderTab(currentTab);
        })
        .catch((error) => {
          setStatusError(error);
        });
    }

    function destroy() {
      if (observer) {
        observer.disconnect();
      }
      rootEl.innerHTML = "";
      rootEl.__epgWidgetInstance = null;
    }

    function fetchAll() {
      const { servicesUrl, channelsUrl, programsUrl } = config.endpoints;
      if (!servicesUrl || !channelsUrl || !programsUrl) {
        return Promise.reject(new Error("endpoints are not configured"));
      }
      return Promise.all([
        fetchJson(servicesUrl),
        fetchJson(channelsUrl),
        fetchJson(programsUrl),
      ]).then(([services, channels, programs]) =>
        buildDataCache(services, channels, programs, config)
      );
    }

    function setStatusLoading() {
      layout.status.innerHTML =
        '<div class="d-flex align-items-center gap-2"><div class="spinner-border spinner-border-sm" role="status"></div><span>番組表を読み込み中…</span></div>';
    }

    function setStatusClear() {
      layout.status.innerHTML = "";
    }

    function setStatusError(error) {
      layout.status.innerHTML = "";
      const alert = document.createElement("div");
      alert.className = "alert alert-danger";
      alert.innerHTML =
        "<div class=\"fw-semibold\">番組表の取得に失敗しました</div>" +
        `<div class=\"small\">${escapeHtml(error.message || String(error))}</div>`;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn btn-outline-light btn-sm mt-2";
      retry.textContent = "再試行";
      retry.addEventListener("click", () => {
        setStatusLoading();
        fetchAll()
          .then((data) => {
            dataCache = data;
            programMap = data.programById;
            setStatusClear();
            renderTab(currentTab);
          })
          .catch(setStatusError);
      });
      alert.appendChild(retry);
      layout.status.appendChild(alert);
    }

    function renderTabs() {
      layout.tabs.innerHTML = "";
      TAB_TYPES.forEach((tab) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `nav-link ${tab === currentTab ? "active" : ""}`;
        button.textContent = tab;
        button.setAttribute("role", "tab");
        button.addEventListener("click", () => {
          if (tab === currentTab) return;
          scrollPositions.set(currentTab, layout.scroll.scrollTop);
          currentTab = tab;
          Array.from(layout.tabs.children).forEach((child) => {
            child.classList.toggle("active", child.textContent === tab);
          });
          renderTab(tab);
          if (scrollPositions.has(tab)) {
            layout.scroll.scrollTop = scrollPositions.get(tab);
          }
        });
        layout.tabs.appendChild(button);
      });
    }

    function renderDateLinks() {
      layout.dates.innerHTML = "";
      const dayKeys = getDayKeys(config.days, config.timezone);
      dayKeys.forEach((dayKey) => {
        const date = parseDayKey(dayKey);
        const label = formatDayLabel(date, config.timezone);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-outline-secondary btn-sm";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          const section = layout.days.querySelector(`[data-day-key=\"${dayKey}\"]`);
          if (section) {
            section.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
        layout.dates.appendChild(btn);
      });
    }

    function renderTab(tab) {
      if (!dataCache) return;
      layout.days.innerHTML = "";
      if (observer) {
        observer.disconnect();
      }
      const tabData = dataCache.tabs[tab];
      if (!tabData || tabData.columns.length === 0) {
        layout.days.innerHTML = '<div class="epg-empty">表示できるチャンネルがありません。</div>';
        return;
      }
      observer = new IntersectionObserver(handleIntersect, {
        root: layout.scroll,
        rootMargin: "200px 0px",
        threshold: 0.1,
      });

      tabData.dayKeys.forEach((dayKey) => {
        const section = document.createElement("section");
        section.className = "epg-day-section";
        section.dataset.dayKey = dayKey;
        section.innerHTML =
          `<div class=\"epg-day-header\"><strong>${formatDayHeading(dayKey, config.timezone)}</strong></div>` +
          `<div class=\"epg-placeholder\">読み込み中…</div>`;
        layout.days.appendChild(section);
        observer.observe(section);
      });
    }

    function handleIntersect(entries) {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const section = entry.target;
        const dayKey = section.dataset.dayKey;
        if (section.dataset.rendered === "true") return;
        renderDaySection(section, dayKey);
        section.dataset.rendered = "true";
        observer.unobserve(section);
      });
    }

    function renderDaySection(section, dayKey) {
      const tabData = dataCache.tabs[currentTab];
      section.innerHTML =
        `<div class=\"epg-day-header\"><strong>${formatDayHeading(dayKey, config.timezone)}</strong></div>`;

      const grid = document.createElement("div");
      grid.className = "epg-grid";
      section.appendChild(grid);

      const header = document.createElement("div");
      header.className = "epg-grid-header";
      header.style.gridTemplateColumns = `80px repeat(${tabData.columns.length}, minmax(160px, 1fr))`;

      const timeHeader = document.createElement("div");
      timeHeader.className = "epg-time-header";
      timeHeader.textContent = "時間";
      header.appendChild(timeHeader);

      const channelHeader = document.createElement("div");
      channelHeader.className = "epg-channel-header";
      channelHeader.style.gridTemplateColumns = `repeat(${tabData.columns.length}, minmax(160px, 1fr))`;

      tabData.columns.forEach((column) => {
        const cell = document.createElement("div");
        cell.className = "epg-channel-cell";
        cell.innerHTML = buildChannelHeader(column, config);
        channelHeader.appendChild(cell);
      });

      header.appendChild(channelHeader);
      grid.appendChild(header);

      const body = document.createElement("div");
      body.className = "epg-grid-body";
      body.style.gridTemplateColumns = `80px repeat(${tabData.columns.length}, minmax(160px, 1fr))`;
      grid.appendChild(body);

      const minutesInDay = 24 * 60;
      const dayHeight = minutesInDay * config.pxPerMinute;
      const dayStart = getDayStartTimestamp(dayKey, config.timezone);

      const timeColumn = document.createElement("div");
      timeColumn.className = "epg-time-column";
      timeColumn.style.height = `${dayHeight}px`;
      for (let hour = 0; hour <= 24; hour++) {
        const label = document.createElement("div");
        label.className = "epg-time-label";
        label.style.top = `${hour * 60 * config.pxPerMinute}px`;
        label.textContent = `${String(hour).padStart(2, "0")}:00`;
        timeColumn.appendChild(label);
      }
      body.appendChild(timeColumn);

      const columnsWrap = document.createElement("div");
      columnsWrap.className = "epg-columns";
      columnsWrap.style.gridTemplateColumns = `repeat(${tabData.columns.length}, minmax(160px, 1fr))`;

      const hasPrograms = tabData.columns.some((column) =>
        columnHasPrograms(column, tabData, dayKey)
      );

      tabData.columns.forEach((column) => {
        const col = document.createElement("div");
        col.className = "epg-column";
        col.style.height = `${dayHeight}px`;
        renderProgramsInColumn(col, column, tabData, dayKey, dayStart, config);
        columnsWrap.appendChild(col);
      });

      body.appendChild(columnsWrap);

      if (config.nowLine) {
        const nowLine = buildNowLine(dayKey, dayStart, dayHeight, config);
        if (nowLine) {
          timeColumn.appendChild(nowLine.cloneNode(true));
          Array.from(columnsWrap.children).forEach((col) => {
            col.appendChild(nowLine.cloneNode(true));
          });
        }
      }

      if (!hasPrograms) {
        const empty = document.createElement("div");
        empty.className = "epg-empty";
        empty.textContent = "番組情報がありません。";
        section.appendChild(empty);
      }
    }

    function renderProgramsInColumn(container, column, tabData, dayKey, dayStart, config) {
      const programsBySlot = new Map();
      const programsForServices = column.services.flatMap((service) => {
        return (tabData.programsByService.get(service.serviceId) || []).filter((program) =>
          isSameDay(program.startAt, dayKey, config.timezone)
        );
      });

      programsForServices.forEach((program) => {
        const slotKey = `${program.startAt}-${program.duration}`;
        if (!programsBySlot.has(slotKey)) {
          programsBySlot.set(slotKey, new Map());
        }
        const groupKey = getProgramGroupKey(program);
        const groupMap = programsBySlot.get(slotKey);
        if (!groupMap.has(groupKey)) {
          groupMap.set(groupKey, program);
        }
      });

      const slots = Array.from(programsBySlot.entries())
        .map(([slotKey, groupMap]) => ({ slotKey, groupMap }))
        .sort((a, b) => {
          const startA = Number(a.slotKey.split("-")[0]);
          const startB = Number(b.slotKey.split("-")[0]);
          return startA - startB;
        });

      slots.forEach(({ slotKey, groupMap }) => {
        const [startAtStr, durationStr] = slotKey.split("-");
        const startAt = Number(startAtStr);
        const duration = Number(durationStr);
        const top = ((startAt - dayStart) / 60000) * config.pxPerMinute;
        const height = (duration / 60000) * config.pxPerMinute;
        if (height <= 4) return;
        const programs = Array.from(groupMap.values());
        if (programs.length === 1) {
          const node = buildProgramNode(programs[0], config, dayStart);
          node.style.top = `${top}px`;
          node.style.height = `${height}px`;
          container.appendChild(node);
        } else {
          const group = document.createElement("div");
          group.className = "epg-program-group";
          group.style.top = `${top}px`;
          group.style.height = `${height}px`;
          programs.forEach((program) => {
            const node = buildProgramNode(program, config, dayStart);
            node.style.height = "100%";
            group.appendChild(node);
          });
          container.appendChild(group);
        }
      });
    }

    function buildProgramNode(program, config) {
      const node = document.createElement("div");
      node.className = "epg-program";
      node.tabIndex = 0;
      node.dataset.programId = String(program.id);
      const title = program.name || "（番組情報なし）";
      const timeLabel = formatProgramTime(program, config.timezone);
      node.innerHTML =
        `<div class=\"epg-program-title\">${escapeHtml(title)}</div>` +
        `<div class=\"epg-program-time\">${escapeHtml(timeLabel)}</div>`;
      return node;
    }

    function columnHasPrograms(column, tabData, dayKey) {
      return column.services.some((service) => {
        const programs = tabData.programsByService.get(service.serviceId) || [];
        return programs.some((program) =>
          isSameDay(program.startAt, dayKey, config.timezone)
        );
      });
    }

    function buildNowLine(dayKey, dayStart, dayHeight, config) {
      const now = Date.now();
      const nowKey = formatDayKey(new Date(now), config.timezone);
      if (nowKey !== dayKey) return null;
      const top = ((now - dayStart) / 60000) * config.pxPerMinute;
      if (top < 0 || top > dayHeight) return null;
      const line = document.createElement("div");
      line.className = "epg-now-line";
      line.style.top = `${top}px`;
      return line;
    }

    function buildChannelHeader(column, config) {
      const parts = [];
      if (column.remoteControlKeyId) {
        parts.push(`<span class=\"badge bg-secondary me-1\">${column.remoteControlKeyId}</span>`);
      }
      if (column.logoUrl) {
        parts.push(`<img src=\"${column.logoUrl}\" alt=\"${escapeHtml(column.name)}\" style=\"max-height:20px; max-width:60px; object-fit:contain;\"/>`);
      }
      parts.push(`<span>${escapeHtml(column.name)}</span>`);
      return parts.join(" ");
    }

    layout.scroll.addEventListener("click", (event) => {
      const target = event.target.closest(".epg-program");
      if (!target) return;
      const program = programMap.get(Number(target.dataset.programId));
      if (!program) return;
      if (typeof config.onProgramClick === "function") {
        config.onProgramClick(program);
      }
      openModal(program);
    });

    layout.scroll.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const target = event.target.closest(".epg-program");
      if (!target) return;
      const program = programMap.get(Number(target.dataset.programId));
      if (!program) return;
      if (typeof config.onProgramClick === "function") {
        config.onProgramClick(program);
      }
      openModal(program);
    });

    layout.modalClose.addEventListener("click", closeModal);
    layout.modalBackdrop.addEventListener("click", (event) => {
      if (event.target === layout.modalBackdrop) closeModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeModal();
    });

    function openModal(program) {
      layout.modalTitle.textContent = program.name || "（番組情報なし）";
      layout.modalBody.innerHTML = buildProgramDetails(program, config.timezone);
      layout.modalBackdrop.classList.add("is-open");
    }

    function closeModal() {
      layout.modalBackdrop.classList.remove("is-open");
    }

    return { init, destroy };
  }

  function buildLayout(rootEl, config) {
    rootEl.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "epg-widget bg-body text-body border rounded";

    const controls = document.createElement("div");
    controls.className = "epg-controls";

    const tabs = document.createElement("div");
    tabs.className = "nav nav-tabs epg-tabs";
    tabs.setAttribute("role", "tablist");

    const dates = document.createElement("div");
    dates.className = "epg-date-links";

    controls.appendChild(tabs);
    controls.appendChild(dates);

    const status = document.createElement("div");
    status.className = "epg-status";

    const scroll = document.createElement("div");
    scroll.className = "epg-scroll";

    const days = document.createElement("div");
    days.className = "epg-days";
    scroll.appendChild(days);

    const modalBackdrop = document.createElement("div");
    modalBackdrop.className = "epg-modal-backdrop";
    modalBackdrop.innerHTML =
      '<div class="epg-modal" role="dialog" aria-modal="true">' +
      '<div class="epg-modal-header">' +
      '<h5 class="modal-title mb-0"></h5>' +
      '<button type="button" class="btn-close" aria-label="Close"></button>' +
      '</div>' +
      '<div class="epg-modal-body"></div>' +
      '<div class="epg-modal-footer">' +
      '<button type="button" class="btn btn-secondary btn-sm">閉じる</button>' +
      '</div>' +
      '</div>';

    wrapper.appendChild(controls);
    wrapper.appendChild(status);
    wrapper.appendChild(scroll);
    wrapper.appendChild(modalBackdrop);
    rootEl.appendChild(wrapper);

    const modalTitle = modalBackdrop.querySelector(".modal-title");
    const modalBody = modalBackdrop.querySelector(".epg-modal-body");
    const modalClose = modalBackdrop.querySelector(".btn-close");
    const modalFooterClose = modalBackdrop.querySelector(".epg-modal-footer .btn");
    modalFooterClose.addEventListener("click", () => {
      modalBackdrop.classList.remove("is-open");
    });

    return { wrapper, tabs, dates, status, scroll, days, modalBackdrop, modalTitle, modalBody, modalClose };
  }

  function fetchJson(url) {
    return fetch(url).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    });
  }

  function buildDataCache(services, channels, programs, config) {
    const servicesById = new Map(services.map((service) => [service.serviceId, service]));
    const programById = new Map(programs.map((program) => [program.id, program]));
    const dayKeys = getDayKeys(config.days, config.timezone);

    const tabs = {};
    TAB_TYPES.forEach((tab) => {
      tabs[tab] = buildTabData(tab, channels, services, programs, servicesById, dayKeys, config);
    });

    return { servicesById, programById, dayKeys, tabs };
  }

  function buildTabData(tab, channels, services, programs, servicesById, dayKeys, config) {
    const includeTypes = new Set(config.includeServiceTypes);
    let columns = [];
    if (tab === "CS") {
      columns = services
        .filter((service) => service.channel && service.channel.type === "CS" && includeTypes.has(service.type))
        .map((service) => ({
          id: service.serviceId,
          name: service.name,
          services: [service],
        }));
    } else {
      columns = channels
        .filter((channel) => channel.type === tab)
        .map((channel) => {
          const filteredServices = channel.services.filter((service) => includeTypes.has(service.type));
          const primaryService = filteredServices[0];
          const serviceMeta = primaryService ? servicesById.get(primaryService.serviceId) : null;
          return {
            id: channel.channel,
            name: channel.name,
            services: filteredServices,
            remoteControlKeyId: serviceMeta ? serviceMeta.remoteControlKeyId : null,
            logoUrl: serviceMeta && typeof config.logoResolver === "function" ? config.logoResolver(serviceMeta) : null,
          };
        })
        .filter((column) => column.services.length > 0);
    }

    const serviceIds = new Set(columns.flatMap((column) => column.services.map((service) => service.serviceId)));
    const programsByService = new Map();
    programs.forEach((program) => {
      if (!serviceIds.has(program.serviceId)) return;
      const key = program.serviceId;
      if (!programsByService.has(key)) {
        programsByService.set(key, []);
      }
      programsByService.get(key).push(program);
    });

    programsByService.forEach((list) => list.sort((a, b) => a.startAt - b.startAt));

    return { columns, programsByService, dayKeys };
  }

  function getProgramGroupKey(program) {
    const shared = (program.relatedItems || []).find((item) => item.type === "shared");
    if (shared) {
      return `shared:${program.eventId || program.id}`;
    }
    return `fallback:${program.startAt}-${program.duration}-${program.name || ""}`;
  }

  function formatProgramTime(program, timeZone) {
    const start = new Date(program.startAt);
    const end = new Date(program.startAt + program.duration);
    return `${formatTime(start, timeZone)} - ${formatTime(end, timeZone)}`;
  }

  function formatTime(date, timeZone) {
    return new Intl.DateTimeFormat("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(date);
  }

  function formatDayLabel(date, timeZone) {
    return new Intl.DateTimeFormat("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      timeZone,
    }).format(date);
  }

  function formatDayHeading(dayKey, timeZone) {
    const date = parseDayKey(dayKey);
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
      timeZone,
    }).format(date);
  }

  function parseDayKey(dayKey) {
    const [year, month, day] = dayKey.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function isSameDay(timestamp, dayKey, timeZone) {
    return formatDayKey(new Date(timestamp), timeZone) === dayKey;
  }

  function formatDayKey(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function getDayKeys(days, timeZone) {
    const keys = [];
    const now = new Date();
    for (let i = 0; i < days; i += 1) {
      const date = new Date(now.getTime() + i * 86400000);
      keys.push(formatDayKey(date, timeZone));
    }
    return keys;
  }

  function getDayStartTimestamp(dayKey, timeZone) {
    const [year, month, day] = dayKey.split("-").map(Number);
    const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const tzDate = new Date(utcDate.toLocaleString("en-US", { timeZone }));
    return tzDate.getTime();
  }

  function buildProgramDetails(program, timeZone) {
    const rows = [];
    rows.push(`<div class=\"small text-secondary\">${escapeHtml(formatProgramTime(program, timeZone))}</div>`);
    if (program.description) {
      rows.push(`<p class=\"mt-2\">${escapeHtml(program.description)}</p>`);
    }
    if (program.genres && program.genres.length) {
      rows.push(`<div class=\"small text-secondary\">ジャンル: ${program.genres.map((g) => g.lv1).join(", ")}</div>`);
    }
    rows.push(
      `<div class=\"small text-secondary\">${program.isFree ? "無料" : "有料"}</div>`
    );
    return rows.join("");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  return { mount };
});
