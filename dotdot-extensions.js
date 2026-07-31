/* DotDotPlanner Round D extensions.
 * - Preserves the existing 18-lane Monthly Log.
 * - Adds an exact 24-hour mode with all-day/unscheduled track, continuous multi-day time rendering,
 *   cross-day creation, drag move, and edge resize.
 * - Turns the prototype's routine/shortcut/search/stats/settings/profile ideas into local-first views.
 */
(function () {
  'use strict';

  var B = window.DotDotPlannerBridge;
  if (!B) {
    console.error('[dotdotplanner] Round D bridge is unavailable.');
    return;
  }

  var S = B.state;
  var P = B.constants.STORAGE_PREFIX;
  var SNAP = B.constants.TIME_SNAP_MINUTES || 15;
  var BASE_DATE = '2000-01-01';
  var timePointerState = null;
  var timeDraft = null;
  var allDayPointerState = null;
  var activeSideView = null;
  var sideOverlay = null;

  function pad(n) { return String(n).padStart(2, '0'); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }
  function readJSON(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  }
  function storageKeys() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key != null) keys.push(key);
    }
    return keys;
  }
  function safeSetRaw(key, value, source) {
    var kind = source || 'preferences';
    try {
      localStorage.setItem(key, String(value));
      if (B.reportStorageSuccessIfRecovering) B.reportStorageSuccessIfRecovering(kind);
      return true;
    } catch (e) {
      if (B.reportStorageFailure) B.reportStorageFailure(kind, e);
      else console.warn('[dotdotplanner] extension storage failure:', kind, e);
      return false;
    }
  }
  function writeJSON(key, value, source) { return safeSetRaw(key, JSON.stringify(value), source); }
  function minutesFromTime(value, fallback) {
    var match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return fallback;
    return Math.max(0, Math.min(1439, Number(match[1]) * 60 + Number(match[2])));
  }
  function timeFromMinutes(value) {
    var minute = Math.max(0, Math.min(1439, Math.round(value)));
    return pad(Math.floor(minute / 60)) + ':' + pad(minute % 60);
  }
  function snapMinute(value) {
    return Math.max(0, Math.min(1440, Math.round(value / SNAP) * SNAP));
  }
  function absoluteMinute(date, minute) {
    return B.differenceInCalendarDays(BASE_DATE, date) * 1440 + minute;
  }
  function fromAbsoluteMinute(value) {
    var days = Math.floor(value / 1440);
    var minute = value - days * 1440;
    if (minute < 0) { minute += 1440; days -= 1; }
    return { date: B.addCalendarDays(BASE_DATE, days), minute: minute };
  }
  function rangeDates(startDate, endDate) {
    var count = Math.max(0, B.differenceInCalendarDays(startDate, endDate));
    var out = [];
    for (var i = 0; i <= count; i++) out.push(B.addCalendarDays(startDate, i));
    return out;
  }
  function monthlyBounds() {
    var d = B.parseLocalDate(S.monthlyLogViewMonth);
    var start = B.formatLocalDate(new Date(d.getFullYear(), d.getMonth(), 1));
    var end = B.formatLocalDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    return { start: start, end: end };
  }
  function getTimeInterval(item) {
    var startDate = item.date;
    var storedEndDate = item.endDate || item.date;
    var hasStart = /^\d{2}:\d{2}$/.test(String(item.startTime || ''));
    var hasEnd = /^\d{2}:\d{2}$/.test(String(item.endTime || ''));
    if (item.allDay || (!hasStart && !hasEnd)) {
      return { allDay: true, startDate: startDate, endDate: storedEndDate };
    }
    var startMinute = minutesFromTime(item.startTime, 0);
    var endMinute = minutesFromTime(item.endTime, Math.min(1440, startMinute + 60));
    var endDate = storedEndDate < startDate ? startDate : storedEndDate;
    var startAbs = absoluteMinute(startDate, startMinute);
    var endAbs = absoluteMinute(endDate, endMinute);
    // Same-date 22:00→03:00 is explicitly interpreted as an overnight event in 24-hour mode.
    if (endDate === startDate && endMinute <= startMinute) endAbs += 1440;
    if (endAbs <= startAbs) endAbs = startAbs + Math.max(SNAP, 60);
    return { allDay: false, startAbs: startAbs, endAbs: endAbs };
  }
  function intervalToStored(startAbs, endAbs) {
    var start = fromAbsoluteMinute(startAbs);
    var end = fromAbsoluteMinute(endAbs);
    var endDate = end.date;
    var endMinute = end.minute;
    // The current model treats endDate as inclusive. Exact midnight is therefore stored as 23:59
    // on the preceding date so Daily/Weekly do not show an empty extra occurrence.
    if (endMinute === 0 && endAbs > startAbs) {
      endDate = B.addCalendarDays(endDate, -1);
      endMinute = 1439;
    }
    if (endDate < start.date) { endDate = start.date; endMinute = Math.max(start.minute + SNAP, endMinute); }
    return {
      date: start.date,
      startTime: timeFromMinutes(start.minute),
      endDate: endDate,
      endTime: timeFromMinutes(endMinute)
    };
  }
  function getPalette(item) {
    var project = item.projectId ? B.findProjectById(item.projectId) : null;
    if (project && project.color) {
      return {
        bg: 'color-mix(in srgb, ' + project.color + ' 16%, var(--bg-card))',
        border: project.color,
        text: project.color
      };
    }
    var plan = B.getMonthlyLogSchedulePlan && B.getMonthlyLogSchedulePlan();
    var entry = plan && plan.entries && plan.entries.find(function (candidate) { return candidate.item.id === item.id; });
    if (entry && entry.palette) return entry.palette;
    var palette = B.palette || [];
    if (!palette.length) return { bg:'#e2ebf7', border:'#a2b8d5', text:'#3f5f86' };
    var stored = Number(item.monthlyLogScheduleColorIndex);
    var index = Number.isInteger(stored) && stored >= 0 && stored < palette.length
      ? stored
      : Math.abs(B.getMonthlyLogScheduleColorSeed(item)) % palette.length;
    return palette[index];
  }
  function setScheduleColors(el, item) {
    var palette = getPalette(item);
    el.style.setProperty('--schedule-bg', palette.bg);
    el.style.setProperty('--schedule-border', palette.border);
    el.style.setProperty('--schedule-text', palette.text);
  }
  function buildDateLabel(date, day) {
    var d = B.parseLocalDate(date);
    var label = document.createElement('div');
    label.className = 'monthly-log-row-label';
    var n = document.createElement('span'); n.textContent = pad(day);
    var weekday = document.createElement('span'); weekday.className = 'monthly-log-row-weekday'; weekday.textContent = ['일','월','화','수','목','금','토'][d.getDay()];
    label.appendChild(n); label.appendChild(weekday);
    return label;
  }
  function makeAxis() {
    var axis = document.createElement('div');
    axis.className = 'monthly-log-time-axis-row';
    var spacer = document.createElement('div'); spacer.className = 'monthly-log-time-axis-spacer';
    var layout = document.createElement('div'); layout.className = 'monthly-log-time-axis-layout';
    var allDay = document.createElement('div'); allDay.className = 'monthly-log-time-all-day-head'; allDay.textContent = '종일·미정';
    var track = document.createElement('div'); track.className = 'monthly-log-time-axis-track';
    for (var hour = 0; hour < 24; hour++) {
      var label = document.createElement('span');
      label.className = 'monthly-log-time-axis-label';
      label.style.left = (hour / 24 * 100) + '%';
      label.textContent = pad(hour) + ':00';
      track.appendChild(label);
    }
    layout.appendChild(allDay); layout.appendChild(track);
    axis.appendChild(spacer); axis.appendChild(layout);
    return axis;
  }
  function assignLanes(segments) {
    var ends = [];
    segments.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    segments.forEach(function (segment) {
      var lane = 0;
      while (lane < ends.length && ends[lane] > segment.start) lane++;
      if (lane === ends.length) ends.push(segment.end); else ends[lane] = segment.end;
      segment.lane = lane;
    });
    return ends.length;
  }
  function eventsForDate(date) {
    var dayStart = absoluteMinute(date, 0);
    var dayEnd = dayStart + 1440;
    var allDay = [];
    var timed = [];
    S.items.forEach(function (item) {
      if (!item || item.deletedAt || item.type !== 'schedule') return;
      var interval = getTimeInterval(item);
      if (interval.allDay) {
        if (interval.startDate <= date && date <= interval.endDate) {
          if (!S.monthlyLogHideCompleted || !(item.completed || B.isOccurrenceCompleted(item, date))) allDay.push({ item:item });
        }
        return;
      }
      var start = Math.max(interval.startAbs, dayStart);
      var end = Math.min(interval.endAbs, dayEnd);
      if (end <= start) return;
      if (S.monthlyLogHideCompleted && (item.completed || B.isOccurrenceCompleted(item, date))) return;
      timed.push({ item:item, start:start - dayStart, end:end - dayStart, interval:interval });
    });
    assignLanes(timed);
    return { allDay:allDay, timed:timed };
  }
  function makeAllDayEvent(item, date) {
    var el = document.createElement('div');
    el.className = 'monthly-log-item monthly-log-time-event monthly-log-time-all-day-event';
    el.dataset.itemId = item.id;
    el.dataset.occurrenceDate = date;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-selected', 'false');
    setScheduleColors(el, item);
    if (B.isOccurrenceCompleted(item, date)) el.classList.add('is-done');
    var title = document.createElement('span'); title.className = 'monthly-log-item-title'; title.textContent = item.text || '제목 없음';
    el.appendChild(title);
    return el;
  }
  function makeTimedEvent(segment, date) {
    var item = segment.item;
    var el = document.createElement('div');
    el.className = 'monthly-log-item monthly-log-time-event';
    el.dataset.itemId = item.id;
    el.dataset.occurrenceDate = date;
    el.dataset.startAbs = String(segment.interval.startAbs);
    el.dataset.endAbs = String(segment.interval.endAbs);
    el.style.left = (segment.start / 1440 * 100) + '%';
    el.style.width = Math.max(.35, (segment.end - segment.start) / 1440 * 100) + '%';
    el.style.top = (5 + segment.lane * 28) + 'px';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-selected', 'false');
    setScheduleColors(el, item);
    if (B.isOccurrenceCompleted(item, date)) el.classList.add('is-done');
    var time = document.createElement('span'); time.className = 'monthly-log-time-event-time';
    var localStart = Math.max(0, segment.start), localEnd = Math.min(1440, segment.end);
    time.textContent = timeFromMinutes(localStart) + '–' + (localEnd === 1440 ? '24:00' : timeFromMinutes(localEnd));
    var title = document.createElement('span'); title.className = 'monthly-log-item-title'; title.textContent = item.text || '제목 없음';
    var startHandle = document.createElement('span'); startHandle.className = 'monthly-log-time-resize start'; startHandle.dataset.timeResize = 'start';
    var endHandle = document.createElement('span'); endHandle.className = 'monthly-log-time-resize end'; endHandle.dataset.timeResize = 'end';
    el.appendChild(startHandle); el.appendChild(time); el.appendChild(title); el.appendChild(endHandle);
    return el;
  }
  function renderTimeRows() {
    var container = document.getElementById('monthly-log-rows');
    if (!container) return;
    container.classList.add('is-time-mode');
    var month = B.parseLocalDate(S.monthlyLogViewMonth);
    var total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    var frag = document.createDocumentFragment();
    frag.appendChild(makeAxis());
    for (var day = 1; day <= total; day++) {
      var date = B.formatLocalDate(new Date(month.getFullYear(), month.getMonth(), day));
      var row = document.createElement('div');
      row.className = 'monthly-log-row monthly-log-time-row';
      row.dataset.date = date;
      var dow = B.parseLocalDate(date).getDay();
      if (dow === 0) row.classList.add('is-sun'); else if (dow === 6) row.classList.add('is-sat');
      if (date === S.todayDate) row.classList.add('is-today');
      row.appendChild(buildDateLabel(date, day));
      var layout = document.createElement('div'); layout.className = 'monthly-log-time-layout';
      var allDay = document.createElement('div'); allDay.className = 'monthly-log-time-all-day'; allDay.dataset.date = date;
      var track = document.createElement('div'); track.className = 'monthly-log-time-track'; track.dataset.date = date;
      var events = eventsForDate(date);
      if (!events.allDay.length) {
        var hint = document.createElement('span'); hint.className = 'monthly-log-time-all-day-empty'; hint.textContent = '종일'; allDay.appendChild(hint);
      } else {
        events.allDay.forEach(function (entry) { allDay.appendChild(makeAllDayEvent(entry.item, date)); });
      }
      var laneCount = Math.max(1, events.timed.reduce(function (max, entry) { return Math.max(max, entry.lane + 1); }, 0));
      track.style.height = Math.max(54, 10 + laneCount * 28) + 'px';
      events.timed.forEach(function (entry) { track.appendChild(makeTimedEvent(entry, date)); });
      if (date === S.todayDate) {
        var now = new Date();
        var line = document.createElement('span'); line.className = 'monthly-log-time-now-line'; line.style.left = ((now.getHours() * 60 + now.getMinutes()) / 1440 * 100) + '%'; track.appendChild(line);
      }
      layout.appendChild(allDay); layout.appendChild(track); row.appendChild(layout); frag.appendChild(row);
    }
    container.replaceChildren(frag);
    renderTimeDraft();
    if (!container._roundDTimeWired) {
      container._roundDTimeWired = true;
      container.addEventListener('pointerdown', onTimePointerDown, true);
      container.addEventListener('pointerdown', onAllDayPointerDown, true);
    }
  }
  function pointOnTrack(clientX, clientY) {
    var target = document.elementFromPoint(clientX, clientY);
    var track = target && target.closest && target.closest('.monthly-log-time-track');
    if (!track) return null;
    var rect = track.getBoundingClientRect();
    var minute = snapMinute((clientX - rect.left) / rect.width * 1440);
    return { track:track, date:track.dataset.date, minute:minute, abs:absoluteMinute(track.dataset.date, minute) };
  }
  function pointOnAllDay(clientX, clientY) {
    var target = document.elementFromPoint(clientX, clientY);
    var lane = target && target.closest && target.closest('.monthly-log-time-all-day');
    return lane ? { lane:lane, date:lane.dataset.date } : null;
  }
  function autoScroll(clientX, clientY) {
    var body = document.getElementById('monthly-log-body');
    if (!body) return;
    var rect = body.getBoundingClientRect();
    if (clientY < rect.top + 56) body.scrollTop -= 14;
    else if (clientY > rect.bottom - 56) body.scrollTop += 14;
    if (clientX < rect.left + 80) body.scrollLeft -= 18;
    else if (clientX > rect.right - 80) body.scrollLeft += 18;
  }
  function clearDraftDom() {
    document.querySelectorAll('.monthly-log-time-draft-event,.monthly-log-time-all-day-draft,.monthly-log-time-drag-ghost').forEach(function (el) { el.remove(); });
  }
  function appendTimeGhost(startAbs, endAbs, className, inputAtEnd) {
    var bounds = monthlyBounds();
    var start = fromAbsoluteMinute(startAbs), end = fromAbsoluteMinute(Math.max(startAbs + SNAP, endAbs - 1));
    rangeDates(start.date < bounds.start ? bounds.start : start.date, end.date > bounds.end ? bounds.end : end.date).forEach(function (date) {
      var track = document.querySelector('.monthly-log-time-track[data-date="' + date + '"]');
      if (!track) return;
      var dayStart = absoluteMinute(date, 0);
      var localStart = Math.max(0, startAbs - dayStart);
      var localEnd = Math.min(1440, endAbs - dayStart);
      if (localEnd <= localStart) return;
      var ghost = document.createElement('div'); ghost.className = className;
      ghost.style.left = (localStart / 1440 * 100) + '%';
      ghost.style.width = Math.max(.35, (localEnd - localStart) / 1440 * 100) + '%';
      ghost.style.top = '4px';
      track.appendChild(ghost);
      if (inputAtEnd && date === end.date) {
        var input = document.createElement('input'); input.className = 'monthly-log-time-draft-input'; input.placeholder = '일정 제목';
        input.addEventListener('keydown', function (e) {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commitTimeDraft(input.value); }
          else if (e.key === 'Escape') { e.preventDefault(); cancelTimeDraft(); }
        });
        ghost.style.pointerEvents = 'auto'; ghost.appendChild(input); setTimeout(function () { input.focus(); }, 0);
      }
    });
  }
  function renderTimeDraft() {
    clearDraftDom();
    if (!timeDraft) return;
    if (timeDraft.kind === 'time') appendTimeGhost(timeDraft.startAbs, timeDraft.endAbs, timeDraft.input ? 'monthly-log-time-draft-event' : 'monthly-log-time-drag-ghost', !!timeDraft.input);
    if (timeDraft.kind === 'allDay') {
      rangeDates(timeDraft.startDate, timeDraft.endDate).forEach(function (date) {
        var lane = document.querySelector('.monthly-log-time-all-day[data-date="' + date + '"]');
        if (!lane) return;
        var ghost = document.createElement('div'); ghost.className = 'monthly-log-time-all-day-draft';
        lane.appendChild(ghost);
        if (timeDraft.input && date === timeDraft.endDate) {
          var input = document.createElement('input'); input.className = 'monthly-log-time-draft-input'; input.placeholder = '종일 일정 제목';
          input.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commitAllDayDraft(input.value); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelTimeDraft(); }
          });
          ghost.appendChild(input); setTimeout(function () { input.focus(); }, 0);
        }
      });
    }
  }
  function cancelTimeDraft() { timeDraft = null; clearDraftDom(); }
  function commitTimeDraft(text) {
    var title = String(text || '').trim();
    if (!title || !timeDraft || timeDraft.kind !== 'time') return;
    var stored = intervalToStored(timeDraft.startAbs, timeDraft.endAbs);
    timeDraft = null;
    B.createItem({ type:'schedule', text:title, date:stored.date, endDate:stored.endDate, allDay:false, startTime:stored.startTime, endTime:stored.endTime });
  }
  function commitAllDayDraft(text) {
    var title = String(text || '').trim();
    if (!title || !timeDraft || timeDraft.kind !== 'allDay') return;
    var draft = timeDraft; timeDraft = null;
    B.createItem({ type:'schedule', text:title, date:draft.startDate, endDate:draft.endDate, allDay:true, startTime:null, endTime:null });
  }
  function bindDocumentTimePointer() {
    document.addEventListener('pointermove', onDocumentTimePointerMove, true);
    document.addEventListener('pointerup', onDocumentTimePointerUp, true);
    document.addEventListener('pointercancel', onDocumentTimePointerCancel, true);
  }
  function unbindDocumentTimePointer() {
    document.removeEventListener('pointermove', onDocumentTimePointerMove, true);
    document.removeEventListener('pointerup', onDocumentTimePointerUp, true);
    document.removeEventListener('pointercancel', onDocumentTimePointerCancel, true);
  }
  function onTimePointerDown(e) {
    if (S.monthlyLogViewMode !== B.constants.VIEW_MODE_TIME) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var eventEl = e.target.closest('.monthly-log-time-event:not(.monthly-log-time-all-day-event)');
    var track = e.target.closest('.monthly-log-time-track');
    if (!eventEl && !track) return;
    cancelTimeDraft();
    var point = pointOnTrack(e.clientX, e.clientY);
    if (!point) return;
    if (eventEl) {
      var action = e.target.closest('[data-time-resize]') ? e.target.closest('[data-time-resize]').dataset.timeResize : 'move';
      var startAbs = Number(eventEl.dataset.startAbs), endAbs = Number(eventEl.dataset.endAbs);
      timePointerState = {
        mode:action, itemId:eventEl.dataset.itemId, pointerId:e.pointerId, startX:e.clientX, startY:e.clientY,
        active:false, originalStart:startAbs, originalEnd:endAbs, currentStart:startAbs, currentEnd:endAbs,
        grabOffset:point.abs - startAbs
      };
    } else {
      timePointerState = { mode:'create', pointerId:e.pointerId, startX:e.clientX, startY:e.clientY, active:false, anchorAbs:point.abs, currentAbs:point.abs };
    }
    bindDocumentTimePointer();
  }
  function onDocumentTimePointerMove(e) {
    var ds = timePointerState;
    if (!ds || e.pointerId !== ds.pointerId) return;
    autoScroll(e.clientX, e.clientY);
    var point = pointOnTrack(e.clientX, e.clientY);
    if (!point) return;
    var moved = Math.hypot(e.clientX - ds.startX, e.clientY - ds.startY);
    if (!ds.active && moved < 5) return;
    ds.active = true; e.preventDefault(); e.stopPropagation();
    if (ds.mode === 'create') {
      ds.currentAbs = point.abs;
      var a = Math.min(ds.anchorAbs, ds.currentAbs), b = Math.max(ds.anchorAbs, ds.currentAbs);
      timeDraft = { kind:'time', startAbs:a, endAbs:Math.max(a + SNAP, b), input:false };
    } else if (ds.mode === 'move') {
      var duration = ds.originalEnd - ds.originalStart;
      ds.currentStart = point.abs - ds.grabOffset;
      ds.currentEnd = ds.currentStart + duration;
      timeDraft = { kind:'time', startAbs:ds.currentStart, endAbs:ds.currentEnd, input:false };
    } else if (ds.mode === 'start') {
      ds.currentStart = Math.min(point.abs, ds.originalEnd - SNAP); ds.currentEnd = ds.originalEnd;
      timeDraft = { kind:'time', startAbs:ds.currentStart, endAbs:ds.currentEnd, input:false };
    } else {
      ds.currentStart = ds.originalStart; ds.currentEnd = Math.max(point.abs, ds.originalStart + SNAP);
      timeDraft = { kind:'time', startAbs:ds.currentStart, endAbs:ds.currentEnd, input:false };
    }
    renderTimeDraft();
  }
  function commitEditedInterval(ds) {
    var item = B.findItemById(ds.itemId); if (!item) return;
    var stored = intervalToStored(ds.currentStart, ds.currentEnd);
    var oldStart = item.date;
    B.withHistoryTransaction(function () {
      item.date = stored.date; item.endDate = stored.endDate; item.startTime = stored.startTime; item.endTime = stored.endTime; item.allDay = false; item.updatedAt = Date.now();
      if (oldStart !== item.date) B.shiftScheduleCompletionMap(item, oldStart, item.date);
      B.normalizeCompletionMapForRange(item);
    });
    B.saveItems(); B.renderApp(); B.announce('일정 시간을 변경했습니다.');
  }
  function onDocumentTimePointerUp(e) {
    var ds = timePointerState; if (!ds || e.pointerId !== ds.pointerId) return;
    unbindDocumentTimePointer(); timePointerState = null;
    if (!ds.active) {
      if (ds.mode === 'create') timeDraft = { kind:'time', startAbs:ds.anchorAbs, endAbs:ds.anchorAbs + 60, input:true };
      else { cancelTimeDraft(); return; }
    } else if (ds.mode === 'create') {
      timeDraft.input = true;
    } else {
      commitEditedInterval(ds); timeDraft = null; return;
    }
    renderTimeDraft();
  }
  function onDocumentTimePointerCancel(e) {
    if (!timePointerState || e.pointerId !== timePointerState.pointerId) return;
    unbindDocumentTimePointer(); timePointerState = null; cancelTimeDraft();
  }
  function bindAllDayPointer() {
    document.addEventListener('pointermove', onDocumentAllDayPointerMove, true);
    document.addEventListener('pointerup', onDocumentAllDayPointerUp, true);
    document.addEventListener('pointercancel', onDocumentAllDayPointerCancel, true);
  }
  function unbindAllDayPointer() {
    document.removeEventListener('pointermove', onDocumentAllDayPointerMove, true);
    document.removeEventListener('pointerup', onDocumentAllDayPointerUp, true);
    document.removeEventListener('pointercancel', onDocumentAllDayPointerCancel, true);
  }
  function onAllDayPointerDown(e) {
    if (S.monthlyLogViewMode !== B.constants.VIEW_MODE_TIME) return;
    if (e.target.closest('.monthly-log-time-track')) return;
    var lane = e.target.closest('.monthly-log-time-all-day'); if (!lane) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var eventEl = e.target.closest('.monthly-log-time-all-day-event');
    allDayPointerState = {
      pointerId:e.pointerId, startX:e.clientX, startY:e.clientY, active:false,
      mode:eventEl ? 'move' : 'create', anchorDate:lane.dataset.date, hoverDate:lane.dataset.date,
      itemId:eventEl ? eventEl.dataset.itemId : null
    };
    cancelTimeDraft(); bindAllDayPointer();
  }
  function onDocumentAllDayPointerMove(e) {
    var ds = allDayPointerState; if (!ds || e.pointerId !== ds.pointerId) return;
    autoScroll(e.clientX, e.clientY);
    var point = pointOnAllDay(e.clientX, e.clientY); if (!point) return;
    if (!ds.active && Math.hypot(e.clientX-ds.startX,e.clientY-ds.startY) < 5) return;
    ds.active = true; ds.hoverDate = point.date; e.preventDefault(); e.stopPropagation();
    if (ds.mode === 'create') {
      timeDraft = { kind:'allDay', startDate:ds.anchorDate < ds.hoverDate ? ds.anchorDate : ds.hoverDate, endDate:ds.anchorDate < ds.hoverDate ? ds.hoverDate : ds.anchorDate, input:false };
      renderTimeDraft();
    }
  }
  function onDocumentAllDayPointerUp(e) {
    var ds = allDayPointerState; if (!ds || e.pointerId !== ds.pointerId) return;
    unbindAllDayPointer(); allDayPointerState = null;
    if (ds.mode === 'create') {
      if (!ds.active) timeDraft = { kind:'allDay', startDate:ds.anchorDate, endDate:ds.anchorDate, input:true };
      else timeDraft.input = true;
      renderTimeDraft();
      return;
    }
    if (ds.active) {
      var item = B.findItemById(ds.itemId);
      if (item) {
        B.withHistoryTransaction(function () { B.moveSingleItemToDate(item, ds.hoverDate, false); item.allDay = true; item.startTime = null; item.endTime = null; });
        B.saveItems(); B.renderApp();
      }
    }
  }
  function onDocumentAllDayPointerCancel(e) {
    if (!allDayPointerState || e.pointerId !== allDayPointerState.pointerId) return;
    unbindAllDayPointer(); allDayPointerState = null; cancelTimeDraft();
  }

  window.DotDotPlannerTimeView = { render:renderTimeRows, cancelDraft:cancelTimeDraft };

  // ------------------------------------------------------------------
  // Side feature views
  // ------------------------------------------------------------------
  function placeSideOverlay() {
    if (!sideOverlay) return;
    var side = document.querySelector('.sidebar'), board = document.querySelector('.artboard');
    if (!side || !board) return;
    var s = side.getBoundingClientRect(), b = board.getBoundingClientRect();
    sideOverlay.style.left = s.right + 'px'; sideOverlay.style.top = b.top + 'px';
    sideOverlay.style.width = Math.max(0, b.right - s.right) + 'px'; sideOverlay.style.height = b.height + 'px';
  }
  function head(title, sub, note) {
    return '<h1 class="dotdot-ext-h1">'+esc(title)+'</h1><p class="dotdot-ext-sub">'+esc(sub)+'</p>'+(note?'<div class="dotdot-ext-note">'+note+'</div>':'');
  }
  function openSideView(view) {
    activeSideView = view;
    document.querySelectorAll('.side-item').forEach(function (el) { el.classList.remove('active'); });
    var item = document.querySelector('.side-item.'+view); if (item) item.classList.add('active');
    sideOverlay.classList.add('open'); placeSideOverlay(); renderSideView();
  }
  function closeSideView() { activeSideView = null; if (sideOverlay) sideOverlay.classList.remove('open'); }
  function getAliveItems() { return S.items.filter(function (item) { return !item.deletedAt; }); }
  function getRoutines() { var value = readJSON(P+'routines', []); return Array.isArray(value)?value:[]; }
  function saveRoutines(value) { return writeJSON(P+'routines', value, 'preferences'); }
  function routineDue(routine, date) {
    var d = B.parseLocalDate(date), dow=d.getDay(), dom=d.getDate();
    if (!routine.active) return false;
    if (routine.frequency==='daily') return true;
    if (routine.frequency==='weekdays') return (routine.days||[]).indexOf(dow)>=0;
    if (routine.frequency==='weekly') return dow===Number((routine.days||[1])[0]);
    if (routine.frequency==='monthly') return dom===Number(routine.dayOfMonth||1);
    return false;
  }
  function materializeDueRoutines(date, reload, autoOnly) {
    var routines=getRoutines(), items=readJSON(P+'items',[]); if(!Array.isArray(items)) items=[];
    var changed=false, now=Date.now();
    routines.forEach(function(r){
      if((autoOnly && !r.autoCreate) || !routineDue(r,date)) return;
      var exists=items.some(function(it){return !it.deletedAt&&it.routineId===r.id&&it.routineDate===date;});
      if(exists) return;
      items.push({id:'rt_'+now.toString(36)+'_'+Math.random().toString(36).slice(2,8),type:r.type||'task',text:r.text,date:date,endDate:date,allDay:true,startTime:null,endTime:null,completed:false,createdAt:now,updatedAt:now,order:999,originalDate:date,migratedFrom:null,rolloverPending:false,completionByDate:null,deletedAt:null,sourceMonthlyItemId:null,groupId:null,groupIdByDate:null,instanceGroupId:null,projectId:r.projectId||null,description:'',subtasks:[],detailBlocksMigrationVersion:1,routineId:r.id,routineDate:date});
      changed=true; now++;
    });
    if(changed){if(!writeJSON(P+'items',items,'items'))return false;if(reload!==false)location.reload();}
    return changed;
  }
  function renderRoutine() {
    var routines=getRoutines();
    var rows=routines.map(function(r){return '<li><span class="dotdot-ext-tag">'+esc(({daily:'매일',weekdays:'특정 요일',weekly:'매주',monthly:'매월'})[r.frequency]||r.frequency)+'</span><span style="flex:1;'+(r.active?'':'opacity:.45')+'">'+esc(r.text)+'</span><label class="dotdot-ext-muted"><input type="checkbox" data-ext="routine-auto" data-id="'+r.id+'" '+(r.autoCreate?'checked':'')+'> 자동 생성</label><button class="dotdot-ext-btn" data-ext="routine-toggle" data-id="'+r.id+'">'+(r.active?'일시정지':'활성화')+'</button><button class="dotdot-ext-btn danger" data-ext="routine-delete" data-id="'+r.id+'">삭제</button></li>';}).join('')||'<li class="dotdot-ext-muted">등록된 루틴이 없습니다.</li>';
    return head('루틴','반복 규칙을 실제 Today 항목으로 생성','자동 생성은 같은 루틴·같은 날짜의 중복을 방지합니다. 생성된 항목은 일반 할 일과 동일하게 이동·완료·삭제할 수 있습니다.')+'<div class="dotdot-ext-card"><h3>새 루틴</h3><div class="dotdot-ext-row"><input class="dotdot-ext-input" id="ext-routine-text" placeholder="반복할 할 일"><select class="dotdot-ext-select" id="ext-routine-frequency"><option value="daily">매일</option><option value="weekdays">특정 요일</option><option value="weekly">매주</option><option value="monthly">매월</option></select><span class="dotdot-ext-routine-days">'+['일','월','화','수','목','금','토'].map(function(d,i){return '<label class="dotdot-ext-day-toggle"><input type="checkbox" name="ext-routine-day" value="'+i+'">'+d+'</label>';}).join('')+'</span><button class="dotdot-ext-btn primary" data-ext="routine-add">추가</button></div></div><div class="dotdot-ext-card"><div class="dotdot-ext-row"><button class="dotdot-ext-btn primary" data-ext="routine-materialize">오늘 해당 루틴 지금 생성</button></div></div><div class="dotdot-ext-card"><h3>루틴 목록</h3><ul class="dotdot-ext-list">'+rows+'</ul></div>';
  }
  var shortcutQuery='';
  var shortcuts=[['Ctrl/⌘','A','현재 목록 전체 선택'],['Ctrl/⌘','C / X / V','복사·잘라내기·붙여넣기'],['Ctrl/⌘','Alt','C / V','연결 인스턴스 복사·붙여넣기'],['Ctrl/⌘','Alt','U','연결 해제'],['Ctrl/⌘','[ / ]','그룹 생성·해제'],['Ctrl/⌘','Z','실행 취소'],['Ctrl/⌘','Shift','Z','다시 실행'],['Ctrl/⌘','Y','다시 실행'],['Shift','클릭','범위 선택'],['Ctrl/⌘','클릭','비연속 선택'],['Delete','','휴지통 이동'],['Escape','','현재 조작 취소'],['Ctrl','휠','Monthly Log 행 높이'],['Shift','휠','Monthly Log 자유 배치 셀 너비']];
  function renderShortcut(){var q=shortcutQuery.toLowerCase();var rows=shortcuts.filter(function(s){return !q||s.join(' ').toLowerCase().indexOf(q)>=0;}).map(function(s){return '<li><span style="min-width:190px">'+s.slice(0,-1).filter(Boolean).map(function(k){return '<span class="dotdot-ext-kbd">'+esc(k)+'</span>';}).join(' + ')+'</span><span>'+esc(s[s.length-1])+'</span></li>';}).join('');return head('단축키','현재 앱 조작 문법을 한곳에서 확인','입력창이나 설명 편집 중에는 브라우저의 기본 텍스트 단축키가 우선합니다.')+'<div class="dotdot-ext-card"><div class="dotdot-ext-row"><input class="dotdot-ext-input" id="ext-shortcut-query" value="'+esc(shortcutQuery)+'" placeholder="단축키 검색"></div><ul class="dotdot-ext-list">'+rows+'</ul></div>';}
  var searchState={q:'',type:'all',done:'all',from:'',to:''};
  function renderSearch(){var q=searchState.q.trim().toLowerCase();var projects={};S.projects.forEach(function(p){projects[p.id]=p.name;});var results=getAliveItems().filter(function(it){var hay=(it.text+' '+(it.description||'')+' '+(projects[it.projectId]||'')).toLowerCase();return(!q||hay.indexOf(q)>=0)&&(searchState.type==='all'||it.type===searchState.type)&&(searchState.done==='all'||(searchState.done==='done')===!!it.completed)&&(!searchState.from||it.date>=searchState.from)&&(!searchState.to||it.date<=searchState.to);}).sort(function(a,b){return a.date<b.date?1:-1;});var rows=results.slice(0,150).map(function(it){return '<li><span class="dotdot-ext-muted" style="min-width:88px">'+it.date+'</span><span class="dotdot-ext-tag">'+esc(it.type)+'</span><span style="flex:1;'+(it.completed?'text-decoration:line-through;opacity:.55':'')+'">'+esc(it.text)+'</span><button class="dotdot-ext-btn" data-ext="search-open" data-date="'+it.date+'">Today에서 열기</button></li>';}).join('')||'<li class="dotdot-ext-muted">검색 결과가 없습니다.</li>';return head('검색','제목·설명·프로젝트 검색과 필터','검색 결과는 원본 항목을 가리키며 복사본을 만들지 않습니다.')+'<div class="dotdot-ext-card"><div class="dotdot-ext-row"><input class="dotdot-ext-input" id="ext-search-q" value="'+esc(searchState.q)+'" placeholder="검색어"><select class="dotdot-ext-select" id="ext-search-type"><option value="all">모든 유형</option><option value="task">할 일</option><option value="schedule">일정</option><option value="memo">메모</option></select><select class="dotdot-ext-select" id="ext-search-done"><option value="all">전체</option><option value="open">미완료</option><option value="done">완료</option></select><input class="dotdot-ext-input" style="min-width:auto" type="date" id="ext-search-from" value="'+searchState.from+'"><span>~</span><input class="dotdot-ext-input" style="min-width:auto" type="date" id="ext-search-to" value="'+searchState.to+'"></div><p class="dotdot-ext-muted">'+results.length+'건</p><ul class="dotdot-ext-list">'+rows+'</ul></div>';}
  function renderStats(){var items=getAliveItems();var today=B.formatLocalDate(new Date());function period(n){var from=B.addCalendarDays(today,-(n-1));var list=items.filter(function(it){return it.date>=from&&it.date<=today;});var done=list.filter(function(it){return it.completed;}).length;return{total:list.length,done:done,rate:list.length?Math.round(done/list.length*100):0};}var w7=period(7),w30=period(30),moved=items.filter(function(it){return it.migratedFrom||(it.originalDate&&it.originalDate!==it.date);}).length;function stat(label,value,sub){return '<div class="dotdot-ext-stat"><b>'+value+'</b><span>'+label+(sub?' · '+sub:'')+'</span></div>';}return head('통계','완료·이월·유형 분포를 현재 로컬 데이터에서 계산','삭제되지 않은 항목만 집계하며 성과 압박용 스트릭은 만들지 않습니다.')+'<div class="dotdot-ext-card"><h3>최근 7일</h3>'+stat('완료',w7.done,'전체 '+w7.total)+stat('완료율',w7.rate+'%')+'<div class="dotdot-ext-bar"><i style="width:'+w7.rate+'%"></i></div></div><div class="dotdot-ext-card"><h3>최근 30일</h3>'+stat('완료',w30.done,'전체 '+w30.total)+stat('완료율',w30.rate+'%')+'<div class="dotdot-ext-bar"><i style="width:'+w30.rate+'%"></i></div></div><div class="dotdot-ext-card"><h3>계획 변경</h3>'+stat('이월·이동 흔적',moved+'건')+'</div>';
  }
  function fullBackupPayload(){var storage={};for(var i=0;i<localStorage.length;i++){var key=localStorage.key(i);if(key&&key.indexOf(P)===0)storage[key]=localStorage.getItem(key);}return{format:'dotdotplanner-full-backup-v1',exportedAt:new Date().toISOString(),storage:storage};}
  function downloadJson(payload,name){var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);}
  function renderSettings(){var theme=localStorage.getItem(P+'theme')||'light',days=localStorage.getItem(P+'weeklyVisibleDays')||'7',week=localStorage.getItem(P+'calendarWeekStartsOn')||'0',def=localStorage.getItem(P+'defaultInputMode')||'task',auto=localStorage.getItem(P+'autoRolloverEnabled')!=='false';return head('설정','실제 앱에 연결되는 로컬 설정과 데이터 관리','가져오기는 현재 데이터를 타임스탬프 백업 키에 먼저 보존한 뒤 교체합니다.')+'<div class="dotdot-ext-card"><h3>표시·입력</h3><div class="dotdot-ext-field"><span>테마</span><select class="dotdot-ext-select" id="ext-theme"><option value="light" '+(theme==='light'?'selected':'')+'>라이트</option><option value="dark" '+(theme==='dark'?'selected':'')+'>다크</option></select></div><div class="dotdot-ext-field"><span>Weekly 표시 일수</span><select class="dotdot-ext-select" id="ext-week-days">'+Array.from({length:14},function(_,i){var n=i+1;return '<option value="'+n+'" '+(String(n)===days?'selected':'')+'>'+n+'일</option>';}).join('')+'</select></div><div class="dotdot-ext-field"><span>주 시작 요일</span><select class="dotdot-ext-select" id="ext-week-start"><option value="0" '+(week==='0'?'selected':'')+'>일요일</option><option value="1" '+(week==='1'?'selected':'')+'>월요일</option></select></div><div class="dotdot-ext-field"><span>기본 빠른 입력 유형</span><select class="dotdot-ext-select" id="ext-default-type"><option value="task" '+(def==='task'?'selected':'')+'>할 일</option><option value="schedule" '+(def==='schedule'?'selected':'')+'>일정</option><option value="memo" '+(def==='memo'?'selected':'')+'>메모</option></select></div><div class="dotdot-ext-field"><span>과거 미완료 자동 이월</span><label><input type="checkbox" id="ext-auto-rollover" '+(auto?'checked':'')+'> 사용</label></div></div><div class="dotdot-ext-card"><h3>데이터</h3><div class="dotdot-ext-row"><button class="dotdot-ext-btn" data-ext="export-app">앱 JSON 내보내기</button><button class="dotdot-ext-btn" data-ext="export-full">첨부 외 전체 설정 백업</button><button class="dotdot-ext-btn" data-ext="import-full">백업 가져오기·교체</button><button class="dotdot-ext-btn danger" data-ext="reset-all">모든 로컬 데이터 초기화</button></div><p class="dotdot-ext-muted">IndexedDB 첨부 바이너리는 아직 이 JSON에 포함되지 않습니다.</p></div>';}
  function getProfile(){var p=readJSON(P+'localProfile',null);return p&&p.name?p:null;}
  function initials(name){var n=String(name||'').trim();return !n?'＋':(/[가-힣]/.test(n)?n.slice(-2):n.slice(0,2).toUpperCase());}
  function paintProfile(){var el=document.querySelector('.profile');if(!el)return;var p=getProfile();el.textContent=initials(p&&p.name);el.classList.toggle('dotdot-profile-empty',!p);el.setAttribute('title',p?p.name+' · 로컬 프로필':'로컬 프로필 설정');}
  function renderAccount(){var p=getProfile();return head('로컬 프로필','계정·서버 없이 이 브라우저에만 저장','동기화나 인증 기능이 아닙니다. 사이드바에 표시할 이름만 저장합니다.')+'<div class="dotdot-ext-card" style="max-width:430px">'+(p?'<div class="dotdot-ext-row"><span class="dotdot-ext-avatar">'+esc(initials(p.name))+'</span><strong>'+esc(p.name)+'</strong></div>':'')+'<div class="dotdot-ext-row"><input class="dotdot-ext-input" id="ext-profile-name" value="'+esc(p?p.name:'')+'" placeholder="표시 이름"><button class="dotdot-ext-btn primary" data-ext="profile-save">저장</button>'+(p?'<button class="dotdot-ext-btn danger" data-ext="profile-clear">지우기</button>':'')+'</div></div>';}
  var sideRenderers={routine:renderRoutine,shortcut:renderShortcut,search:renderSearch,stats:renderStats,settings:renderSettings,account:renderAccount};
  function renderSideView(){if(activeSideView&&sideRenderers[activeSideView])sideOverlay.innerHTML=sideRenderers[activeSideView]();}
  function focusBack(id,value){var el=document.getElementById(id);if(!el)return;el.value=value;el.focus();try{el.setSelectionRange(value.length,value.length);}catch(e){}}
  function wireSideEvents(){
    sideOverlay.addEventListener('click',function(e){var el=e.target.closest('[data-ext]');if(!el)return;var action=el.dataset.ext;
      if(action==='routine-add'){var text=(document.getElementById('ext-routine-text').value||'').trim();if(!text)return;var frequency=document.getElementById('ext-routine-frequency').value;var days=Array.prototype.slice.call(document.querySelectorAll('[name="ext-routine-day"]:checked')).map(function(x){return Number(x.value);});var routines=getRoutines();routines.push({id:'routine_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),text:text,type:'task',frequency:frequency,days:days.length?days:[1],dayOfMonth:new Date().getDate(),active:true,autoCreate:true,createdAt:Date.now()});saveRoutines(routines);renderSideView();return;}
      if(action==='routine-toggle'||action==='routine-delete'){var rs=getRoutines(),id=el.dataset.id;if(action==='routine-delete')rs=rs.filter(function(r){return r.id!==id;});else rs.forEach(function(r){if(r.id===id)r.active=!r.active;});saveRoutines(rs);renderSideView();return;}
      if(action==='routine-materialize'){materializeDueRoutines(B.formatLocalDate(new Date()),true,false);return;}
      if(action==='search-open'){if(safeSetRaw(P+'selectedDate',el.dataset.date,'preferences'))location.reload();return;}
      if(action==='export-app'){B.exportAllDataAsJson();return;}
      if(action==='export-full'){downloadJson(fullBackupPayload(),'dotdotplanner-full-backup-'+B.formatLocalDate(new Date())+'.json');return;}
      if(action==='import-full'){var input=document.createElement('input');input.type='file';input.accept='application/json';input.onchange=function(){var file=input.files&&input.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(){try{var data=JSON.parse(reader.result);if(!data||data.format!=='dotdotplanner-full-backup-v1'||!data.storage)throw new Error('지원하지 않는 형식');if(!confirm('현재 로컬 데이터를 백업한 뒤 가져온 데이터로 교체할까요?'))return;var backup=fullBackupPayload();localStorage.setItem(P+'import_backup_'+Date.now(),JSON.stringify(backup));storageKeys().filter(function(k){return k.indexOf(P)===0&&!k.startsWith(P+'import_backup_');}).forEach(function(k){localStorage.removeItem(k);});Object.keys(data.storage).forEach(function(k){if(k.indexOf(P)===0)localStorage.setItem(k,data.storage[k]);});location.reload();}catch(err){alert('가져오기에 실패했습니다: '+err.message);}};reader.readAsText(file);};input.click();return;}
      if(action==='reset-all'){if(!confirm('모든 DotDotPlanner 로컬 데이터를 삭제할까요?'))return;if(!confirm('복구하려면 먼저 백업해야 합니다. 정말 삭제할까요?'))return;storageKeys().filter(function(k){return k.indexOf(P)===0;}).forEach(function(k){localStorage.removeItem(k);});location.reload();return;}
      if(action==='profile-save'){var name=(document.getElementById('ext-profile-name').value||'').trim();if(!name)return;writeJSON(P+'localProfile',{name:name,updatedAt:new Date().toISOString()},'preferences');paintProfile();renderSideView();return;}
      if(action==='profile-clear'){localStorage.removeItem(P+'localProfile');paintProfile();renderSideView();return;}
    });
    sideOverlay.addEventListener('input',function(e){if(e.target.id==='ext-shortcut-query'){shortcutQuery=e.target.value;var v=shortcutQuery;renderSideView();focusBack('ext-shortcut-query',v);}if(e.target.id==='ext-search-q'){searchState.q=e.target.value;var q=searchState.q;renderSideView();focusBack('ext-search-q',q);}});
    sideOverlay.addEventListener('change',function(e){var id=e.target.id;
      if(id==='ext-search-type'){searchState.type=e.target.value;renderSideView();}
      if(id==='ext-search-done'){searchState.done=e.target.value;renderSideView();}
      if(id==='ext-search-from'){searchState.from=e.target.value;renderSideView();}
      if(id==='ext-search-to'){searchState.to=e.target.value;renderSideView();}
      if(id==='ext-theme'){if(safeSetRaw(P+'theme',e.target.value,'preferences'))document.documentElement.dataset.theme=e.target.value;}
      if(id==='ext-week-days'){if(safeSetRaw(P+'weeklyVisibleDays',e.target.value,'preferences'))location.reload();}
      if(id==='ext-week-start'){if(safeSetRaw(P+'calendarWeekStartsOn',e.target.value,'preferences'))location.reload();}
      if(id==='ext-default-type'){if(safeSetRaw(P+'defaultInputMode',e.target.value,'preferences'))location.reload();}
      if(id==='ext-auto-rollover'){if(safeSetRaw(P+'autoRolloverEnabled',String(e.target.checked),'preferences'))location.reload();}
      if(e.target.dataset.ext==='routine-auto'){var routines=getRoutines(),rid=e.target.dataset.id;routines.forEach(function(r){if(r.id===rid)r.autoCreate=e.target.checked;});saveRoutines(routines);}
    });
  }
  function bootSideViews(){sideOverlay=document.createElement('div');sideOverlay.className='dotdot-ext-overlay';sideOverlay.id='dotdot-ext-overlay';document.body.appendChild(sideOverlay);wireSideEvents();['routine','shortcut','search','stats','settings'].forEach(function(view){var el=document.querySelector('.side-item.'+view);if(!el)return;el.setAttribute('role','button');el.tabIndex=0;el.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openSideView(view);},true);el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();openSideView(view);}});});['today','calendar','trash'].forEach(function(view){var el=document.querySelector('.side-item.'+view);if(el)el.addEventListener('click',closeSideView,true);});var profile=document.querySelector('.profile');paintProfile();if(profile){profile.setAttribute('role','button');profile.tabIndex=0;profile.addEventListener('click',function(){openSideView('account');});profile.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();openSideView('account');}});}window.addEventListener('resize',function(){if(activeSideView)placeSideOverlay();});}

  function wireViewModeToggle(){document.querySelectorAll('[data-monthly-view-mode]').forEach(function(btn){btn.addEventListener('click',function(){var mode=btn.dataset.monthlyViewMode;if(mode!==B.constants.VIEW_MODE_TIME)mode=B.constants.VIEW_MODE_LANES;if(S.monthlyLogViewMode===mode)return;cancelTimeDraft();S.monthlyLogViewMode=mode;B.savePreferences();B.renderMonthlyLog();});});}
  function boot(){wireViewModeToggle();bootSideViews();materializeDueRoutines(B.formatLocalDate(new Date()),true,true);if(S.monthlyLogViewMode===B.constants.VIEW_MODE_TIME)B.renderMonthlyLogRows();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
