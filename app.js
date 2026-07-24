// DotDotPlanner - app.js
// 1단계: 상태 / localStorage / 시드 데이터 / 기본 렌더링 / 빠른 입력
// 순수 정적 페이지(file://)에서도 동작해야 하므로 fetch, ES Module import는 사용하지 않는다.
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // 상수
  // ---------------------------------------------------------------------
  var STORAGE_PREFIX = 'dotdotplanner:v1:';
  var ITEMS_KEY = STORAGE_PREFIX + 'items';
  var SELECTED_DATE_KEY = STORAGE_PREFIX + 'selectedDate';
  var CALENDAR_VIEW_DATE_KEY = STORAGE_PREFIX + 'calendarViewDate';
  var WEEK_START_DATE_KEY = STORAGE_PREFIX + 'weekStartDate';
  var LUNAR_ENABLED_KEY = STORAGE_PREFIX + 'lunarEnabled';
  var WEEKLY_PANEL_KEY = STORAGE_PREFIX + 'weeklyPanel';
  // 5: index.html의 <head> 인라인 스크립트가 body 렌더 전에 이미 이 정확한 키 문자열로
  // localStorage를 읽어 documentElement.dataset.theme을 선반영해 둔다(깜빡임 방지) — 여기서는
  // 그 값을 그대로 이어받아 상태/버튼 표시만 동기화한다.
  var THEME_KEY = STORAGE_PREFIX + 'theme';

  // 1: 레거시 item.subtasks를 detailBlocks 안의 todo 블록으로 옮기는 마이그레이션의 버전.
  // item.detailBlocksMigrationVersion이 이 값 이상이면 두 번 다시 스캔하지 않는다 —
  // 그래야 사용자가 지운 todo가 다음 렌더에서 되살아나지 않는다.
  var DETAIL_BLOCKS_MIGRATION_VERSION = 1;

  // 1/2: Weekly 패널은 top(px) 하나로 위치가 정해지고, 높이는 "실제 화면(viewport) 바닥"까지
  // 항상 닿도록 매번 다시 계산한다(더 이상 1152 같은 고정 전체 높이를 쓰지 않는다 —
  // applyWeeklyPanelPosition 참고). WEEKLY_DEFAULT_TOP은 기존 CSS 고정값(542)과 같아 처음
  // 로드 시 지금 디자인과 완전히 동일하게 보인다.
  var WEEKLY_GAP = 16;
  var WEEKLY_DEFAULT_TOP = 542;
  var WEEKLY_MIN_TOP = 150; // 드래그로 최대한 펼쳐도 상단 화면이 완전히 덮이지 않게.
  var WEEKLY_MAX_TOP = 1002; // 드래그로 최대한 줄여도 Weekly가 완전히 사라지지 않게(최소 150px).
  var WEEKLY_MIN_VISIBLE_HEIGHT = 100; // 펼친 상태에서 Weekly가 항상 최소 이만큼은 보이게.

  // 현재 정적 목업이 표시하던 값과 동일하게 맞춘 기본값(1단계는 달력/Weekly 네비게이션을
  // 구현하지 않으므로, 지금 화면에 보이는 날짜를 그대로 기본 상태로 사용한다).
  var DEFAULT_SELECTED_DATE = '2026-07-30';
  var DEFAULT_CALENDAR_VIEW_DATE = '2026-07-01';
  var DEFAULT_WEEK_START_DATE = '2026-07-26';

  var WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

  var MODE_PLACEHOLDER = {
    task: '할 일을 입력하고 엔터를 누르세요.',
    schedule: '일정을 입력하고 엔터를 누르세요.',
    memo: '메모를 입력하고 엔터를 누르세요.'
  };

  // ---------------------------------------------------------------------
  // 앱 상태 (state 구조는 앞으로의 단계에서 계속 채워진다. 1단계에서 실제로
  // 쓰이는 건 selectedDate / weekStartDate / items / inputMode 뿐이다.)
  // ---------------------------------------------------------------------
  var state = {
    todayDate: null,
    selectedDate: DEFAULT_SELECTED_DATE,
    calendarViewDate: DEFAULT_CALENDAR_VIEW_DATE,
    selectedDateRange: null,
    inputMode: 'task',
    items: [],
    // 선택 상태는 페이지가 열려 있는 동안만 유지한다(localStorage 저장 안 함,
    // 새로고침하면 초기화, item 데이터 자체에는 selected 필드를 두지 않는다).
    selectedItemIds: new Set(),
    lastSelectedItemId: null,
    // 범위 선택(Shift) 기준점. { itemId, context: 'daily'|'weekly', containerKey } 형태이며
    // containerKey는 daily일 때 selectedDate, weekly일 때 해당 열의 날짜다. 선택과 마찬가지로
    // localStorage에 저장하지 않는다.
    selectionAnchor: null,
    weekStartDate: DEFAULT_WEEK_START_DATE,
    lunarEnabled: false,
    // { startDate, endDate } 형태의 일회성 날짜 초안 — 달력 범위 드래그나 날짜 휠 편집으로
    // 채워지고, 항목 생성에 소비되면 다시 null로 돌아간다. localStorage에 저장하지 않는다.
    dateTimeDraft: null,
    // 종료 날짜를 사용자가 명시적으로 활성화했는지 여부
endDateDraftActive: false,
    // "하루 종일" 토글의 현재 값. dateTimeDraft가 있을 때 항목 생성에 쓰인다. 기본 true.
    allDayDraft: true,
    // 하루 종일이 꺼졌을 때 쓰는 시작·종료 시간(HH:mm, 24시간제). 토글을 껐다 켜도 마지막 값을
    // 보존하되, 항목 생성 후에는 dateTimeDraft와 같은 방식으로 초기화한다. localStorage 미저장.
    timeDraft: { startTime: null, endTime: null },
    // Weekly 패널의 top(px, artboard 기준)은 "펼쳐졌을 때의" 위치·높이를 항상 가리킨다 —
    // isLowered로 내려도 top/height 자체는 절대 바뀌지 않고(패널 크기·내부 레이아웃·스크롤
    // 상태가 그대로 보존됨), 화면에는 transform:translateY로만 밀어내려 헤더 한 줄만 남긴다
    // (applyWeeklyPanelPosition 참고). lastExpandedTop은 사용자가 경계를 드래그해 조절한 마지막
    // top 값을 기억해 다시 올릴 때 그 자리로 정확히 복원하는 데 쓴다. top/lastExpandedTop/
    // isLowered는 새로고침 후에도 복원되도록 localStorage에 저장한다(아래 WEEKLY_PANEL_KEY).
    weeklyPanel: { top: null, lastExpandedTop: null, isLowered: false },
    // Map<itemId, Set<occurrenceDate>> — 다중 선택된 항목이 어느 occurrenceDate(들)로
    // 선택됐는지 기억해 완료 처리 시 정확한 범위만 바꾼다. daily/weekly 어느 쪽에서
    // 선택했든 값은 항상 그 항목이 표시된 컨테이너의 날짜(containerKey)와 같다. 같은
    // item.id라도 다일 일정은 서로 다른 날짜 열에서 각각 선택될 수 있으므로 occurrenceDate
    // 하나가 아니라 Set으로 여러 개를 동시에 담을 수 있어야 한다(addSelectedOccurrence 참고).
    // localStorage에 저장하지 않는다.
    selectedOccurrenceById: new Map(),
    // 4: 이월 목록 펼침 여부(세션 한정, localStorage 저장 안 함 — 매번 닫힌 상태로 시작).
    rolloverExpanded: false,
    // 8: 'today'(기존 달력+Daily+Weekly 화면) | 'trash'(휴지통 보기).
    currentView: 'today',
    // 5: 휴지통 상단 타입 필터. 데이터에는 영향 없이 화면 표시만 바꾼다.
    trashFilter: 'all',
    // 8: 휴지통 선택은 Daily/Weekly의 selectedItemIds와 완전히 분리한다(다른 화면 전환 시
    // 서로 간섭하지 않게). trashSelectionAnchor는 Shift 범위 선택의 기준 itemId 하나만 저장—
    // 휴지통은 컨테이너 구분이 없는 단일 목록이라 context/containerKey가 필요 없다.
    trashSelectedItemIds: new Set(),
    trashSelectionAnchor: null,
    // 5: 'light' | 'dark'. 실제 화면 반영은 documentElement의 data-theme 속성(CSS 선택자
    // :root[data-theme="dark"])이 담당하고, 이 값은 그 상태를 앱 쪽에서도 참조하기 위한 것.
    theme: 'light',
    // 7: Ctrl/Cmd+C·V용 앱 내부 클립보드. 브라우저 시스템 클립보드는 쓰지 않고 메모리에만
    // 두며, 새로고침하면 사라진다(localStorage 미저장). items는 붙여넣기에 필요한 필드만
    // 담은 가벼운 스냅샷 + 배치 계산용 원본 id 하나로 구성된다.
    itemClipboard: { items: [], copiedAt: null },
    // task 상세 drawer에 표시 중인 item.id. 선택 상태처럼 세션 한정이라 localStorage에
    // 저장하지 않는다 — 새로고침하면 항상 닫힌 상태로 시작한다.
    activeDetailItemId: null,
    // 6차: 다일 일정처럼 같은 item.id가 여러 날짜 칸에 걸쳐 표시될 때, 상세 모달을 "어느
    // 날짜 칸에서 열었는지" 기억한다. 완료 버튼이 이 날짜의 occurrence를 기준으로 동작한다.
    // task/memo는 occurrence 개념이 없어 item.date와 사실상 같은 값이 된다. 세션 한정.
    activeDetailOccurrenceDate: null,
    // 20: 설명 블록 에디터가 지금 포커스를 두고 있는 블록/커서 위치. Undo/Redo나 구조
    // 변경으로 전체가 다시 그려진 뒤에도 포커스가 사라지지 않게 복원하는 데 쓴다.
    // 세션 한정이라 localStorage에 저장하지 않는다.
    descriptionEditor: null,
    // 3차: 설명 블록 다중선택. 화면에 보이는(접힌 toggle 자식은 제외) detailBlocks만
    // 대상이며, 다른 item의 모달을 열거나 모달을 닫으면 초기화한다. 세션 한정.
    detailBlockSelection: { selectedIds: new Set(), anchorId: null },
    // 5A: 표 셀/범위/행/열 선택. { blockId, mode:'cell'|'row'|'col', anchorR, anchorC,
    // cells:Set<"r,c"> } 또는 null. localStorage에 저장하지 않는 임시 UI 상태.
    descTableSelection: null
  };

  // 9: Undo/Redo — state.items 전체를 트랜잭션 전/후로 스냅샷해 두는 방식이라 생성/수정/완료/
  // 이동/재정렬/휴지통 이동·복원·영구삭제까지 모든 항목 변경을 종류 구분 없이 균일하게 되돌릴 수
  // 있다. withHistoryTransaction의 중첩 호출은 가장 바깥쪽 호출만 실제로 기록한다.
  var history = { undoStack: [], redoStack: [], limit: 50 };
  var historyTransactionDepth = 0;
  var historyBeforeSnapshot = null;

  // ---------------------------------------------------------------------
  // 날짜 유틸 — toISOString().slice(0,10)은 UTC 기준이라 한국 로컬에서
  // 자정 근처에 하루가 밀릴 수 있으므로 사용하지 않는다.
  // ---------------------------------------------------------------------
  function formatLocalDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function parseLocalDate(str) {
    var parts = String(str).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function formatShortDate(dateStr) {
    var d = parseLocalDate(dateStr);
    var yy = String(d.getFullYear()).slice(2);
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return yy + '.' + mm + '.' + dd + ' (' + WEEKDAY_KO[d.getDay()] + ')';
  }

  function formatTime12(hhmm) {
    if (!hhmm) return '';
    var parts = hhmm.split(':').map(Number);
    var h = parts[0];
    var m = parts[1];
    var period = h < 12 ? 'am' : 'pm';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return period + String(h12).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function uid() {
    return 'it_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // 달력 날짜 단위 계산 — 밀리초/서머타임 오차를 피하려고 로컬 자정 Date로만 계산한다.
  function addCalendarDays(dateStr, days) {
    var d = parseLocalDate(dateStr);
    d.setDate(d.getDate() + days);
    return formatLocalDate(d);
  }

  function differenceInCalendarDays(startDate, endDate) {
    var a = parseLocalDate(startDate);
    var b = parseLocalDate(endDate);
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  function formatDotDate(dateStr) {
    var d = parseLocalDate(dateStr);
    return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
  }

  function formatAnnounceDate(dateStr) {
    var d = parseLocalDate(dateStr);
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }

  // item.date~item.endDate 사이의 모든 발생 날짜를 반환한다(다일 schedule의
  // 날짜별 완료 상태 계산에 쓰는 공통 헬퍼). 날짜가 역전되거나 손상돼도 앱이
  // 멈추지 않도록 단일 날짜로 안전하게 처리하고, 비정상적으로 긴 범위는 잘라낸다.
  var MAX_OCCURRENCE_SPAN = 366;
  function getOccurrenceDates(item) {
    var start = item && item.date;
    if (!start) return [];
    var end = item && item.endDate;
    if (!end || end === start) return [start];
    var span = differenceInCalendarDays(start, end);
    if (!isFinite(span) || span <= 0) return [start];
    if (span > MAX_OCCURRENCE_SPAN) span = MAX_OCCURRENCE_SPAN;
    var dates = [];
    for (var i = 0; i <= span; i++) {
      dates.push(addCalendarDays(start, i));
    }
    return dates;
  }

  function announce(message) {
    var el = document.getElementById('a11y-announcer');
    if (!el) return;
    el.textContent = '';
    setTimeout(function () { el.textContent = message; }, 30);
  }

  // ---------------------------------------------------------------------
  // localStorage
  // ---------------------------------------------------------------------
  function validateStoredItems(raw) {
    if (!Array.isArray(raw)) return null;
    var validTypes = { task: true, schedule: true, memo: true };
    var ok = raw.every(function (it) {
      return it && typeof it === 'object' &&
        typeof it.id === 'string' &&
        validTypes[it.type] &&
        typeof it.text === 'string' &&
        typeof it.date === 'string';
    });
    return ok ? raw : null;
  }

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn('[dotdotplanner] localStorage read failed:', key, e);
      return null;
    }
  }

  function loadState() {
    var items = null;
    try {
      var rawItems = JSON.parse(safeGet(ITEMS_KEY));
      items = validateStoredItems(rawItems);
    } catch (e) {
      items = null;
    }
    var isFirstRun = !items;
    if (!items) {
      items = createSeedItems();
    }

    var selectedDate = safeGet(SELECTED_DATE_KEY) || DEFAULT_SELECTED_DATE;
    var calendarViewDate = safeGet(CALENDAR_VIEW_DATE_KEY) || DEFAULT_CALENDAR_VIEW_DATE;
    var weekStartDate = safeGet(WEEK_START_DATE_KEY) || DEFAULT_WEEK_START_DATE;
    var lunarEnabled = safeGet(LUNAR_ENABLED_KEY) === 'true';

    return {
      items: items,
      selectedDate: selectedDate,
      calendarViewDate: calendarViewDate,
      weekStartDate: weekStartDate,
      lunarEnabled: lunarEnabled,
      isFirstRun: isFirstRun
    };
  }

  function saveItems() {
    try {
      localStorage.setItem(ITEMS_KEY, JSON.stringify(state.items));
    } catch (e) {
      console.warn('[dotdotplanner] failed to save items:', e);
    }
  }

  function savePreferences() {
    try {
      localStorage.setItem(SELECTED_DATE_KEY, state.selectedDate);
      localStorage.setItem(CALENDAR_VIEW_DATE_KEY, state.calendarViewDate);
      localStorage.setItem(WEEK_START_DATE_KEY, state.weekStartDate);
      localStorage.setItem(LUNAR_ENABLED_KEY, String(state.lunarEnabled));
    } catch (e) {
      console.warn('[dotdotplanner] failed to save preferences:', e);
    }
  }

  // 1: Weekly 패널의 마지막 펼침 위치/접힘 여부만 별도 키로 저장한다(항목 데이터와
  // 무관한 순수 레이아웃 설정이라 items/선호 날짜와 분리해 둔다).
  function saveWeeklyPanelPrefs() {
    try {
      localStorage.setItem(WEEKLY_PANEL_KEY, JSON.stringify({
        lastExpandedTop: state.weeklyPanel.lastExpandedTop,
        isLowered: state.weeklyPanel.isLowered
      }));
    } catch (e) {
      console.warn('[dotdotplanner] failed to save weekly panel prefs:', e);
    }
  }

  function loadWeeklyPanelPrefs() {
    try {
      var raw = JSON.parse(safeGet(WEEKLY_PANEL_KEY));
      if (raw && typeof raw === 'object') return raw;
    } catch (e) { /* 손상된 값은 기본값으로 폴백 */ }
    return null;
  }

  // ---------------------------------------------------------------------
  // 시드 데이터 — 현재 정적 목업(디자인 확정본)에 있던 문구/완료 상태를
  // 그대로 옮긴다. localStorage에 유효한 데이터가 없을 때 딱 한 번만 쓰인다.
  //
  // 참고: 일정 진행률 원(--pct)의 실제 계산은 5단계에서 구현 예정이라,
  // 1단계에서는 모든 일정이 미완료 시 빈 원(0%)으로 표시된다. 기존 목업의
  // "일정이 거의 끝나갑니다" 항목이 보여주던 78% 채움은 이 계산이 붙기 전
  // 까지 임시로 사라진다(완료된 항목은 기존과 동일하게 가득 찬 회색 원).
  // ---------------------------------------------------------------------
  function makeItem(overrides) {
    var now = Date.now();
    var base = {
      id: uid(),
      type: 'task',
      text: '',
      date: DEFAULT_SELECTED_DATE,
      endDate: null,
      allDay: true,
      startTime: null,
      endTime: null,
      completed: false,
      createdAt: now,
      updatedAt: now,
      order: 0,
      originalDate: null,
      migratedFrom: null,
      completionByDate: null,
      deletedAt: null,
      // task 상세 drawer 전용 필드. 기존(이 필드가 생기기 전) 항목은 없을 수 있으므로
      // 읽는 쪽에서는 항상 `item.description || ''`, `ensureSubtasks(item)`로 접근한다.
      description: '',
      subtasks: [],
      // 1: 새로 만드는 항목은 애초에 옮길 레거시 subtask가 없으므로 이미 정규화된
      // 상태로 시작한다(normalizeItemDetailBlocks가 다시 훑지 않게).
      detailBlocksMigrationVersion: DETAIL_BLOCKS_MIGRATION_VERSION
    };
    var item = Object.assign(base, overrides);
    if (!item.endDate) item.endDate = item.date;
    if (!item.originalDate) item.originalDate = item.date;
    if (item.type === 'schedule') ensureScheduleCompletionMap(item);
    return item;
  }

  function createSeedItems() {
    var D = DEFAULT_SELECTED_DATE; // '2026-07-30'
    var items = [
      makeItem({ type: 'task', text: '할 일을 입력하였습니다.', date: D, order: 0 }),
      makeItem({ type: 'task', text: '할 일을 완료하였습니다.', date: D, order: 1, completed: true }),
      makeItem({ type: 'task', text: '할 일에 마우스 커서가 있습니다.', date: D, order: 2 }),
      makeItem({ type: 'schedule', text: '일정이 거의 끝나갑니다.', date: D, endDate: '2026-08-02', order: 3 }),
      makeItem({ type: 'schedule', text: '일정을 완료하였습니다.', date: D, order: 4, allDay: false, startTime: '22:30', endTime: '22:30', completed: true }),
      makeItem({ type: 'memo', text: '메모를 입력하였습니다.', date: D, order: 5 }),
      makeItem({ type: 'schedule', text: '일정이 있습니다.', date: D, order: 6 })
    ];

    // Weekly 열(07.26 ~ 08.01)의 기존 더미 항목. 08.01(토)은 원래도 비어 있었다.
    var weekDates = ['2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-31'];
    weekDates.forEach(function (d) {
      for (var i = 0; i < 3; i++) {
        items.push(makeItem({ type: 'task', text: '할 일', date: d, order: i }));
      }
    });
    items.push(makeItem({ type: 'schedule', text: '유럽 여행', date: '2026-07-30', order: 7 }));

    return items;
  }

  // ---------------------------------------------------------------------
  // 조회 헬퍼
  // ---------------------------------------------------------------------
  function findItemById(itemId) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === itemId) return state.items[i];
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // 9: Undo/Redo 트랜잭션 — fn 안에서 일어나는 state.items 변경을 통째로 하나의
  // history 항목으로 묶는다. fn이 다른 트랜잭션 함수를 내부에서 호출해도(중첩)
  // historyTransactionDepth로 가장 바깥쪽 호출만 실제로 기록한다. 실제로 아무 것도
  // 바뀌지 않았으면(JSON 비교) history에 쌓지 않는다.
  // ---------------------------------------------------------------------
  function withHistoryTransaction(fn) {
    var isOutermost = historyTransactionDepth === 0;
    if (isOutermost) {
      historyBeforeSnapshot = JSON.stringify(state.items);
    }
    historyTransactionDepth++;
    try {
      fn();
    } finally {
      historyTransactionDepth--;
      if (isOutermost) {
        var afterSnapshot = JSON.stringify(state.items);
        if (afterSnapshot !== historyBeforeSnapshot) {
          history.undoStack.push({ before: historyBeforeSnapshot, after: afterSnapshot });
          if (history.undoStack.length > history.limit) history.undoStack.shift();
          history.redoStack = [];
        }
        historyBeforeSnapshot = null;
      }
    }
  }

  function finishHistoryOp() {
    saveItems();
    state.selectedItemIds.clear();
    state.selectedOccurrenceById.clear();
    state.lastSelectedItemId = null;
    state.selectionAnchor = null;
    // 20/15: Undo/Redo(Ctrl+Z 등)는 isTypingElsewhere 가드 때문에 애초에 포커스가 설명
    // 블록 밖에 있을 때만 실행될 수 있다 — 즉 undo() 호출 시점엔 "지금 편집 중이던 블록"이
    // 존재하지 않는다. 그런데 state.descriptionEditor에 그 이전(포커스가 안에 있었을 때의)
    // 목표가 남아 있으면 재렌더 후 그 블록으로 포커스가 도로 딸려 들어가 버려서, 바로 이어
    // 누르는 Ctrl+Shift+Z(Redo)가 다시 "타이핑 중"으로 오인돼 브라우저 기본 동작에 먹혀버린다
    // (Redo가 안 먹는 것처럼 보임). Undo/Redo 후에는 재추적할 이전 포커스가 없으므로 비워둔다.
    state.descriptionEditor = null;
    renderApp();
  }

  function undo() {
    if (!history.undoStack.length) return;
    var entry = history.undoStack.pop();
    history.redoStack.push(entry);
    state.items = JSON.parse(entry.before);
    finishHistoryOp();
  }

  function redo() {
    if (!history.redoStack.length) return;
    var entry = history.redoStack.pop();
    history.undoStack.push(entry);
    state.items = JSON.parse(entry.after);
    finishHistoryOp();
  }

  // ---------------------------------------------------------------------
  // 다일 schedule의 날짜별 완료 상태(completionByDate). task/memo는 그대로
  // item.completed를 쓰고, schedule만 발생 날짜(occurrenceDate)별로 분리한다.
  // item.completed는 schedule에서는 "기간 전체 완료 여부"를 나타내는 파생 값이다.
  // ---------------------------------------------------------------------
  function ensureScheduleCompletionMap(item) {
    if (!item.completionByDate || typeof item.completionByDate !== 'object') {
      var map = {};
      getOccurrenceDates(item).forEach(function (d) { map[d] = !!item.completed; });
      item.completionByDate = map;
    }
    return item.completionByDate;
  }

  function isOccurrenceCompleted(item, occurrenceDate) {
    if (item.type !== 'schedule') return !!item.completed;
    var map = ensureScheduleCompletionMap(item);
    return !!map[occurrenceDate];
  }

  function setOccurrenceCompleted(item, occurrenceDate, completed) {
    if (item.type !== 'schedule') {
      item.completed = completed;
      return;
    }
    var map = ensureScheduleCompletionMap(item);
    map[occurrenceDate] = completed;
    syncScheduleOverallCompleted(item);
  }

  // schedule.completed = 기간의 모든 발생 날짜가 true일 때만 true.
  function syncScheduleOverallCompleted(item) {
    var dates = getOccurrenceDates(item);
    var map = ensureScheduleCompletionMap(item);
    item.completed = dates.length > 0 && dates.every(function (d) { return !!map[d]; });
  }

  // date/endDate가 바뀐 뒤(타입 전환 등) completionByDate를 현재 범위에 맞춘다.
  // 기존에 있던 날짜 값은 보존하고, 새로 편입된 날짜만 item.completed를 기본값으로 채운다.
  function normalizeCompletionMapForRange(item) {
    var map = ensureScheduleCompletionMap(item);
    var dates = getOccurrenceDates(item);
    var next = {};
    dates.forEach(function (d) {
      next[d] = Object.prototype.hasOwnProperty.call(map, d) ? !!map[d] : !!item.completed;
    });
    item.completionByDate = next;
    return next;
  }

  // 일정을 다른 시작 날짜로 옮길 때 completionByDate도 같은 날짜 차이만큼 함께
  // 이동한다(07.30=true, 07.31=false → 새 시작 08.10이면 08.10=true, 08.11=false).
  // 수동 이동/드래그 이동/일괄 이동이 전부 이 함수를 거치는 moveSingleItemToDate를 통해 호출된다.
  function shiftScheduleCompletionMap(item, oldStartDate, newStartDate) {
    if (!item.completionByDate) return;
    var shift = differenceInCalendarDays(oldStartDate, newStartDate);
    if (!isFinite(shift) || shift === 0) return;
    var next = {};
    Object.keys(item.completionByDate).forEach(function (dateKey) {
      next[addCalendarDays(dateKey, shift)] = item.completionByDate[dateKey];
    });
    item.completionByDate = next;
  }

  // 앱 시작 시 1회 실행 — localStorage의 기존 schedule 중 completionByDate가 없는
  // 항목만 item.completed 값으로 전체 날짜를 균일 초기화한다. 이미 맵이 있으면
  // 손대지 않는다(완료 정보 손실 방지). 뭔가 바뀐 경우에만 true를 반환한다.
  function migrateScheduleCompletionMaps(items) {
    var changed = false;
    items.forEach(function (item) {
      if (item.type !== 'schedule') return;
      if (item.completionByDate && typeof item.completionByDate === 'object') return;
      var map = {};
      getOccurrenceDates(item).forEach(function (d) { map[d] = !!item.completed; });
      item.completionByDate = map;
      changed = true;
    });
    return changed;
  }

  function typeLabel(type) {
    if (type === 'task') return '할 일';
    if (type === 'schedule') return '일정';
    return '메모';
  }

  // ---------------------------------------------------------------------
  // 데이터 조회
  // ---------------------------------------------------------------------
  function getItemsForDate(date) {
    return state.items.filter(function (it) {
      if (it.deletedAt) return false; // 7: 휴지통으로 이동한 항목은 Daily/Weekly/이월 어디에도 나타나지 않는다.
      var end = it.endDate || it.date;
      return it.date <= date && date <= end;
    });
  }

  function getTrashItems() {
    return state.items.filter(function (it) { return !!it.deletedAt; });
  }

  function getItemsForWeek(weekStartDate) {
    var start = parseLocalDate(weekStartDate);
    var map = {};
    for (var i = 0; i < 7; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var key = formatLocalDate(d);
      map[key] = getItemsForDate(key).sort(function (a, b) { return a.order - b.order; });
    }
    return map;
  }

  function nextOrder(date) {
    var existing = state.items.filter(function (it) { return it.date === date; });
    if (!existing.length) return 0;
    return Math.max.apply(null, existing.map(function (it) { return it.order; })) + 1;
  }

  // 5: Weekly "+"로 만든 항목을 해당 날짜 맨 위에 두기 위한 정렬용 최소값.
  // order는 상대적 정렬에만 쓰이므로 기존 최소값보다 1 작은 값을 주면 재번호 없이 맨 앞이 된다.
  function minOrderForDate(date) {
    var existing = state.items.filter(function (it) { return it.date === date; });
    if (!existing.length) return 0;
    return Math.min.apply(null, existing.map(function (it) { return it.order; })) - 1;
  }

  // ---------------------------------------------------------------------
  // 생성
  // ---------------------------------------------------------------------
  function createItem(opts) {
    var d = opts.date || state.selectedDate;
    var item;
    withHistoryTransaction(function () {
      item = makeItem({
        type: opts.type,
        text: opts.text,
        date: d,
        endDate: opts.endDate || d,
        allDay: opts.allDay === undefined ? true : opts.allDay,
        startTime: opts.startTime || null,
        endTime: opts.endTime || null,
        order: opts.insertAtStart ? minOrderForDate(d) : nextOrder(d)
      });
      state.items.push(item);
    });
    saveItems();
    renderApp();
    return item;
  }

  // ---------------------------------------------------------------------
  // 6차 5/6: Daily·Weekly 카드용 "상세 내용 있음"/"todo 진행" 판정. detailBlocks
  // 원본 배열을 그대로 순회한다(computeVisibleDescriptionBlocks가 아니다) — 그래서 접힌
  // toggle 자식도 배열엔 여전히 있으므로 자동으로 "존재"로 계산된다. divider·todo는
  // 그 자체로는 "상세 내용"에 포함하지 않는다(구분선만 있으면 실질 콘텐츠 없음, todo는
  // 별도의 진행 수 배지로 표시하므로 중복 표시하지 않는다).
  // ---------------------------------------------------------------------
  function itemHasDescriptionContent(item) {
    if (!Array.isArray(item.descriptionBlocks)) return false;
    return item.descriptionBlocks.some(function (b) {
      if (b.type === 'divider' || b.type === 'todo') return false;
      if (b.type === 'paragraph') return !!(b.text && b.text.trim());
      return true;
    });
  }

  function itemTodoCounts(item) {
    var subtasks = Array.isArray(item.subtasks) ? item.subtasks : [];
    var total = subtasks.length;
    var done = 0;
    subtasks.forEach(function (s) { if (s.completed) done++; });
    return { done: done, total: total };
  }

  // compact=true면 Weekly용(카드 폭이 좁아 li 오른쪽 위에 절대 위치로 겹쳐 그린다 —
  // 제목 트랙 너비·체크박스/기호 정렬은 전혀 건드리지 않는다). false면 Daily용(제목
  // 텍스트 뒤에 인라인으로 붙는다 — Daily .row-title엔 원래 ellipsis가 없어 안전하다).
  function buildCardDetailBadge(item, compact) {
    var hasDetail = itemHasDescriptionContent(item);
    var counts = itemTodoCounts(item);
    if (!hasDetail && !counts.total) return null;
    var wrap = document.createElement('span');
    wrap.className = compact ? 'card-detail-badge card-detail-badge-compact' : 'card-detail-badge';
    wrap.setAttribute('aria-hidden', 'false');
    var labelParts = [];
    if (hasDetail) {
      var doc = document.createElement('span');
      doc.className = 'card-detail-badge-doc';
      doc.setAttribute('aria-hidden', 'true');
      doc.textContent = '📝';
      wrap.appendChild(doc);
      labelParts.push('상세 내용 있음');
    }
    if (counts.total) {
      var todoEl = document.createElement('span');
      todoEl.className = 'card-detail-badge-todo';
      todoEl.textContent = counts.done + '/' + counts.total;
      wrap.appendChild(todoEl);
      labelParts.push('하위 할 일 ' + counts.done + '/' + counts.total + '개 완료');
    }
    var label = labelParts.join(', ');
    wrap.setAttribute('aria-label', label);
    wrap.title = label;
    return wrap;
  }

  // ---------------------------------------------------------------------
  // 렌더링 — 기존 CSS 클래스(.task, .checkbox, .ic-*, .row-title, .event-body 등)를
  // 그대로 사용해 DOM을 생성한다. 새 시각 요소는 추가하지 않는다.
  // ---------------------------------------------------------------------
  function buildSubInfo(item) {
  // 일정만 날짜·시간 보조정보를 표시한다.
  if (item.type !== 'schedule') return null;

  var dateText;

  if (item.endDate && item.endDate !== item.date) {
    dateText =
      formatShortDate(item.date) +
      ' - ' +
      formatShortDate(item.endDate);
  } else {
    dateText = formatShortDate(item.date);
  }

  if (!item.startTime && !item.endTime) {
    return dateText;
  }

  var timeText;

  if (
    item.startTime &&
    item.endTime &&
    item.startTime !== item.endTime
  ) {
    timeText =
      formatTime12(item.startTime) +
      ' - ' +
      formatTime12(item.endTime);
  } else {
    timeText = formatTime12(
      item.endTime || item.startTime
    );
  }

  return dateText + ', ' + timeText;
}

  // occurrenceDate: schedule은 같은 item.id가 여러 날짜 칸에 표시될 수 있으므로
  // "이 날짜 발생분"이 완료됐는지로 시각 상태를 결정한다(task/memo는 item.completed 그대로).
  function iconForType(item, occurrenceDate) {
    var span = document.createElement('span');
    if (item.type === 'task') {
      span.className = 'ic-dot';
    } else if (item.type === 'memo') {
      span.className = 'ic-dash';
    } else {
      span.className = 'ic-ring';
      // 1단계: 실제 진행률 계산 미구현(5단계 예정). 완료 시에만 가득 채움.
      span.style.setProperty('--pct', isOccurrenceCompleted(item, occurrenceDate) ? '100' : '0');
    }
    return span;
  }

  // 체크박스 = 완료 여부 토글 버튼 (상태 문양과 역할이 분리되어 있음).
  function checkboxButton(item, occurrenceDate) {
    var completedHere = isOccurrenceCompleted(item, occurrenceDate);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'checkbox' + (completedHere ? ' checked' : '');
    btn.dataset.action = 'toggle-complete';
    btn.dataset.itemId = item.id;
    btn.dataset.occurrenceDate = occurrenceDate;
    btn.setAttribute('role', 'checkbox');
    btn.setAttribute('aria-checked', String(completedHere));
    btn.setAttribute('aria-label', (completedHere ? '완료 취소: ' : '완료 처리: ') + item.text);
    return btn;
  }

  // 상태 문양 = 종류(할 일/일정/메모) 변경 팝업을 여는 버튼.
  function typeMenuButton(item, className, occurrenceDate) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.dataset.action = 'type-menu';
    btn.dataset.itemId = item.id;
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', '종류 변경 (현재: ' + typeLabel(item.type) + ')');
    btn.appendChild(iconForType(item, occurrenceDate));
    return btn;
  }

  function buildDotHandle(className) {
    var handle = document.createElement('span');
    handle.className = className;
    handle.setAttribute('aria-label', '드래그하여 이동');
    var dots = document.createElement('span');
    dots.className = 'dots';
    for (var i = 0; i < 6; i++) {
      var dot = document.createElement('span');
      dot.className = 'dot-mini';
      dots.appendChild(dot);
    }
    handle.appendChild(dots);
    return handle;
  }

  // 7A.2(정정): grip이 더 이상 gutter의 자식이 아니라 형제 요소라, grip 위 순수 클릭(드래그로
  // 발전하지 않은 pointerdown+up)의 네이티브 click은 gutter를 거치지 않고 곧장 grip 자신에서
  // 발생한다 — 그래서 grip 자신에도 gutter와 똑같은 선택 리스너(모디파이어 인식,
  // skipOpenDetail)를 단다(로직은 handleItemPointerSelect 재사용, 중복 없음). 실제 drag였다면
  // onDragPointerUp이 이미 suppressNextItemGutterClickOnce()로 이 클릭을 억제해 둔다.
  function attachGripSelectClick(handleEl, item, context, containerKey) {
    handleEl.addEventListener('click', function (e) {
      if (suppressNextItemGutterClick) { suppressNextItemGutterClick = false; return; }
      handleItemPointerSelect(e, item.id, context, containerKey, undefined, true);
    });
  }

  // Daily 전용 6점 드래그 핸들. context/sourceDate는 이 핸들을 눌러 드래그를 시작할 때
  // "어느 컨테이너/날짜에서 집어들었는지"를 dragState에 기록하기 위해 필요하다.
  function createDragHandle(item, sourceDate) {
    var drag = buildDotHandle('drag');
    drag.addEventListener('pointerdown', function (e) {
      onDragHandlePointerDown(e, item.id, 'daily', sourceDate);
    });
    attachGripSelectClick(drag, item, 'daily', sourceDate);
    return drag;
  }

  // Weekly 전용 소형 드래그 핸들. 카드 크기를 바꾸지 않기 위해 기존 왼쪽 내부 여백
  // 안에 절대 위치로 겹쳐두고, 평소에는 숨겼다가 hover/focus 시에만 보인다(CSS 처리).
  function createWeeklyDragHandle(item, columnDate) {
    var handle = buildDotHandle('week-drag');
    handle.addEventListener('pointerdown', function (e) {
      onDragHandlePointerDown(e, item.id, 'weekly', columnDate);
    });
    attachGripSelectClick(handle, item, 'weekly', columnDate);
    return handle;
  }

  // 7A.2(정정): "선택 gutter"는 grid 열이 아니라 카드 왼쪽 기존 여백 위에 겹치는 absolute
  // 투명 hit area다 — 카드 간격·checkbox·기호·제목 위치를 전혀 바꾸지 않는다. 6점 grip은
  // 원래 자리에 그대로 있고(별도 grid 항목/절대위치), z-index로 이 overlay보다 위에 둬서
  // grip 자신의 pointerdown(재정렬)이 항상 grip에 먼저 닿는다. overlay 영역 중 grip이 아닌
  // 부분을 클릭하면(또는 grip을 순수 클릭만 하면, pointerup 뒤 native click이 bubbling돼)
  // 이 리스너가 모디파이어(Shift/Ctrl) 인식 선택을 처리한다(로직 중복 없음).
  function createSelectGutterOverlay(item, context, containerKey, overlayClassName) {
    var overlay = document.createElement('div');
    overlay.className = overlayClassName;
    overlay.dataset.action = 'select-item';
    overlay.dataset.itemId = item.id;
    overlay.addEventListener('click', function (e) {
      if (suppressNextItemGutterClick) { suppressNextItemGutterClick = false; return; }
      handleItemPointerSelect(e, item.id, context, containerKey, undefined, true);
    });
    return overlay;
  }

  // 상세형 렌더러 — 상단 오늘 목록 전용 (드래그 핸들 / 체크박스 / 상태 문양 /
  // 제목+보조정보 / 수동 이월 화살표 전부 표시).
  function createDailyItemRow(item, occurrenceDate) {
    var sub = buildSubInfo(item);
    var completedHere = isOccurrenceCompleted(item, occurrenceDate);
    var row = document.createElement('div');
    row.className = 'task' + (completedHere ? ' done' : '') + (sub ? ' event' : '');
    row.dataset.itemId = item.id;
    row.dataset.occurrenceDate = occurrenceDate;
    row.setAttribute('aria-selected', 'false');

    var symbol = typeMenuButton(item, 'symbol', occurrenceDate);

    // 6차 5: 상세 내용/todo 배지는 제목 텍스트 뒤에 같은 줄로 인라인 추가한다 — Daily의
    // .row-title엔 원래 ellipsis가 없어(백주 검색 결과, Weekly만 truncate) 뒤에 붙는
    // 요소가 텍스트를 자르거나 카드 높이를 바꾸지 않는다.
    var titleEl = document.createElement('span');
    titleEl.className = 'row-title';
    titleEl.textContent = item.text; // textContent만 사용 (XSS 방지)
    var detailBadge = buildCardDetailBadge(item, false);
    if (detailBadge) titleEl.appendChild(detailBadge);

    var body;
    if (sub) {
      body = document.createElement('span');
      body.className = 'event-body';
      var small = document.createElement('small');
      small.textContent = sub;
      body.appendChild(titleEl);
      body.appendChild(small);
    } else {
      body = titleEl;
    }

    var arrow = document.createElement('button');
    arrow.type = 'button';
    arrow.className = 'arrow';
    arrow.dataset.action = 'move-date';
    arrow.dataset.itemId = item.id;
    arrow.setAttribute('aria-haspopup', 'menu');
    arrow.setAttribute('aria-expanded', 'false');
    arrow.setAttribute('aria-label', '날짜 이동: ' + item.text);
    arrow.textContent = '→';

    row.appendChild(createDragHandle(item, state.selectedDate));
    row.appendChild(checkboxButton(item, occurrenceDate));
    row.appendChild(symbol);
    row.appendChild(body);
    row.appendChild(arrow);
    row.appendChild(createSelectGutterOverlay(item, 'daily', state.selectedDate, 'select-gutter'));
    return row;
  }

  // 축약형 렌더러 — Weekly 카드 전용. 같은 item/id를 쓰지만 체크박스 + 상태
  // 문양 + 제목 한 줄만 보여준다(드래그 핸들, 화살표, 날짜·시간 보조문구는 숨김).
  // 다일 일정이 여러 날짜 칸에 걸쳐 보일 때도 item을 복제하지 않고, 같은 item을
  // 호출 지점(getItemsForWeek)마다 그대로 다시 그린다.
  function createWeeklyItemRow(item, columnDate) {
    // Weekly는 항상 하나의 날짜 열 안에서 그려지므로 그 열의 날짜가 곧 occurrenceDate다.
    var completedHere = isOccurrenceCompleted(item, columnDate);
    var li = document.createElement('li');
    li.dataset.itemId = item.id;
    li.dataset.occurrenceDate = columnDate;
    li.setAttribute('aria-selected', 'false');
    if (completedHere) li.classList.add('done');

    var title = document.createElement('span');
    title.className = 'week-item-title';
    title.textContent = item.text; // 실제 데이터는 자르지 않음, 표시만 CSS ellipsis
    title.title = item.text; // 마우스 오버 시 전체 문장 확인 가능

    li.appendChild(createWeeklyDragHandle(item, columnDate));
    li.appendChild(checkboxButton(item, columnDate));
    li.appendChild(typeMenuButton(item, 'week-symbol-btn', columnDate));
    li.appendChild(title);
    li.appendChild(createSelectGutterOverlay(item, 'weekly', columnDate, 'week-select-gutter'));
    // 6차 6: 카드 폭이 좁아 grid 트랙에 끼워 넣지 않고, 이미 position:relative인 li
    // 위에 절대 위치로 겹쳐 그린다 — 제목 트랙 너비·체크박스/기호 정렬을 전혀 바꾸지 않는다.
    var detailBadge = buildCardDetailBadge(item, true);
    if (detailBadge) li.appendChild(detailBadge);
    return li;
  }

  // 4: originalDate/migratedFrom을 selectedDate가 아니라 item.date(현재 시작일)와 비교한다 —
  // 다일 일정은 date~endDate 여러 날짜 칸에 자연스럽게 표시되는데, 이걸 selectedDate와
  // 비교하면 "이동한 적 없는" 다일 일정도 시작일 다음날부터 전부 이월로 잘못 분류된다.
  // originalDate/migratedFrom이 item.date와 다르다는 건 실제로 다른 날짜에서 이동해 왔다는
  // 뜻이므로, 그 경우에만 이월로 본다(다일 일정 자체의 자연스러운 표시 범위는 대상이 아님).
  function isRolloverItem(item) {
    if (!item.originalDate && !item.migratedFrom) return false;
    var originDiffers = item.originalDate && item.originalDate !== item.date;
    var migratedDiffers = item.migratedFrom && item.migratedFrom !== item.date;
    return !!(originDiffers || migratedDiffers);
  }

  function getRolloverItemsForDate(selectedDate) {
    return getItemsForDate(selectedDate).filter(isRolloverItem);
  }

  // 4: 이월 항목은 #rollover-list에, 나머지는 #daily-list에 각각 한 번씩만 그려
  // 일반 목록에 중복 표시되지 않게 한다. 두 목록 다 같은 createDailyItemRow를 재사용한다.
  function renderDailyList() {
    var container = document.getElementById('daily-list');
    var rolloverContainer = document.getElementById('rollover-list');
    if (!container) return;
    var all = getItemsForDate(state.selectedDate).slice().sort(function (a, b) { return a.order - b.order; });
    var rollover = [];
    var normal = [];
    all.forEach(function (it) {
      (isRolloverItem(it) ? rollover : normal).push(it);
    });
    container.replaceChildren.apply(container, normal.map(function (it) { return createDailyItemRow(it, state.selectedDate); }));
    if (rolloverContainer) {
      rolloverContainer.replaceChildren.apply(rolloverContainer, rollover.map(function (it) { return createDailyItemRow(it, state.selectedDate); }));
    }
    renderRolloverToggleState(rollover.length);
  }

  // 이월 토글 버튼의 표시 개수/화살표 방향과, 펼침 상태에 따른 목록 표시/숨김을 갱신한다.
  function renderRolloverToggleState(count) {
    var toggle = document.querySelector('.rollover-toggle');
    var countEl = document.querySelector('.rollover-count');
    var tri = toggle ? toggle.querySelector('.tri') : null;
    var list = document.getElementById('rollover-list');
    if (countEl) countEl.textContent = '이월(' + count + ')';
    if (toggle) toggle.setAttribute('aria-expanded', String(state.rolloverExpanded));
    if (tri) tri.classList.toggle('open', state.rolloverExpanded);
    if (list) {
      list.hidden = count === 0; // 이월 항목 자체가 없으면 완전히 숨김(애니메이션 불필요).
      // 접힘/펼침은 hidden이 아니라 CSS max-height 전환(.rollover-open)으로만 표현해
      // "짧은 열림·닫힘 애니메이션"이 실제로 보이게 한다.
      list.classList.toggle('rollover-open', state.rolloverExpanded && count > 0);
    }
  }

  function toggleRolloverExpanded() {
    state.rolloverExpanded = !state.rolloverExpanded;
    var count = getRolloverItemsForDate(state.selectedDate).length;
    renderRolloverToggleState(count);
  }

  function renderWeekly() {
    var lists = document.querySelectorAll('.week-card ul[data-date]');
    var byDate = getItemsForWeek(state.weekStartDate);
    lists.forEach(function (ul) {
      var date = ul.dataset.date;
      var items = byDate[date] || getItemsForDate(date).sort(function (a, b) { return a.order - b.order; });
      ul.replaceChildren.apply(ul, items.map(function (it) { return createWeeklyItemRow(it, date); }));
    });
  }

  // ---------------------------------------------------------------------
  // 8: 휴지통 보기 — deletedAt이 있는 항목만 삭제한 날짜별로 묶어 보여준다. 기존 .task 카드
  // 디자인을 재사용하되, 체크박스/타입메뉴/화살표 대신 정적 아이콘 + 복원/영구 삭제
  // 버튼을 놓는다(휴지통 항목은 완료·타입변경·날짜이동 대상이 아니므로).
  // ---------------------------------------------------------------------
  var TRASH_FILTER_ICON = { task: 'ic-dot', schedule: 'ic-ring', memo: 'ic-dash' };

  // deletedAt(ISO, UTC 저장)을 로컬 날짜(YYYY-MM-DD)로 바꾼다. 손상된 값은 null.
  function parseDeletedAtLocalDate(deletedAt) {
    if (!deletedAt) return null;
    var d = new Date(deletedAt);
    if (isNaN(d.getTime())) return null;
    return formatLocalDate(d);
  }

  function formatTrashDeletedTime(deletedAt) {
    var d = deletedAt ? new Date(deletedAt) : null;
    if (!d || isNaN(d.getTime())) return '삭제 시간 알 수 없음';
    return '삭제 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // 6: 다일 일정은 "원래 일정 시작 → 종료"로, 그 외는 "원래 날짜 X"로 — 삭제 시간과는
  // 항상 별도 줄에 표시해 두 정보가 한 줄에 뒤섞이지 않게 한다.
  function trashOriginalDateLabel(item) {
    if (item.endDate && item.endDate !== item.date) {
      return '원래 일정 ' + formatDotDate(item.date) + ' → ' + formatDotDate(item.endDate);
    }
    return '원래 날짜 ' + formatDotDate(item.date);
  }

  function createTrashItemRow(item) {
    var row = document.createElement('div');
    row.className = 'task trash-row';
    row.dataset.itemId = item.id;
    row.setAttribute('aria-selected', 'false');

    var icon = document.createElement('span');
    icon.className = 'trash-row-icon';
    icon.appendChild(iconForType(item, item.date));

    var body = document.createElement('span');
    body.className = 'event-body';
    var title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = item.text;
    var subOriginal = document.createElement('small');
    subOriginal.className = 'trash-original-date';
    subOriginal.textContent = trashOriginalDateLabel(item);
    var subDeleted = document.createElement('small');
    subDeleted.className = 'trash-deleted-time';
    subDeleted.textContent = formatTrashDeletedTime(item.deletedAt);
    body.appendChild(title);
    body.appendChild(subOriginal);
    body.appendChild(subDeleted);

    var actions = document.createElement('span');
    actions.className = 'trash-row-actions';
    var restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'trash-action-btn';
    restoreBtn.dataset.action = 'trash-restore';
    restoreBtn.dataset.itemId = item.id;
    restoreBtn.textContent = '복원';
    restoreBtn.setAttribute('aria-label', '복원: ' + item.text);
    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'trash-action-btn danger';
    deleteBtn.dataset.action = 'trash-delete';
    deleteBtn.dataset.itemId = item.id;
    deleteBtn.textContent = '영구 삭제';
    deleteBtn.setAttribute('aria-label', '영구 삭제: ' + item.text);
    actions.appendChild(restoreBtn);
    actions.appendChild(deleteBtn);

    row.appendChild(icon);
    row.appendChild(body);
    row.appendChild(actions);
    return row;
  }

  // 5: 현재 필터에 맞는 삭제 항목만 골라, 6: deletedAt의 로컬 날짜로 묶는다. 그룹은 최근
  // 삭제일이 위로 오도록 정렬하고, 같은 그룹 안에서는 deletedAt이 최근인 항목이 위로 온다.
  // 날짜를 해석할 수 없는 deletedAt은 별도의 "삭제 날짜 알 수 없음" 그룹으로 모아 앱이
  // 멈추지 않게 한다.
  function getTrashGroups() {
    var filterType = state.trashFilter;
    var items = getTrashItems().filter(function (it) {
      return filterType === 'all' || it.type === filterType;
    });
    var groupsByKey = {};
    items.forEach(function (it) {
      var key = parseDeletedAtLocalDate(it.deletedAt) || '__unknown__';
      if (!groupsByKey[key]) groupsByKey[key] = [];
      groupsByKey[key].push(it);
    });
    Object.keys(groupsByKey).forEach(function (key) {
      groupsByKey[key].sort(function (a, b) { return (b.deletedAt || '').localeCompare(a.deletedAt || ''); });
    });
    var dateKeys = Object.keys(groupsByKey).filter(function (k) { return k !== '__unknown__'; }).sort().reverse();
    if (groupsByKey.__unknown__) dateKeys.push('__unknown__');
    return dateKeys.map(function (key) {
      return { dateStr: key === '__unknown__' ? null : key, items: groupsByKey[key] };
    });
  }

  function formatTrashGroupHeader(dateStr, count) {
    if (!dateStr) return '삭제 날짜 알 수 없음 ' + count;
    var d = parseLocalDate(dateStr);
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 · ' + WEEKDAY_KO[d.getDay()] + '요일 ' + count;
  }

  function renderTrashList() {
    var container = document.getElementById('trash-list');
    if (!container) return;
    var groups = getTrashGroups();
    var frag = document.createDocumentFragment();
    groups.forEach(function (group) {
      var header = document.createElement('div');
      header.className = 'trash-group-header';
      header.textContent = formatTrashGroupHeader(group.dateStr, group.items.length);
      frag.appendChild(header);
      group.items.forEach(function (it) { frag.appendChild(createTrashItemRow(it)); });
    });
    container.replaceChildren(frag);
    renderTrashSelectionState();
    renderTrashBulkBar();
    renderEmptyTrashButtonState();
  }

  // 8: 현재 화면에 실제로 그려진(=현재 필터에서 보이는) 휴지통 행의 순서 그대로 id 목록을
  // 반환한다 — Shift 범위 선택이 이 순서를 기준으로 계산되므로, 접힌/숨겨진 항목은
  // 자연히 범위에서 빠진다.
  function getVisibleTrashIds() {
    return Array.prototype.map.call(
      document.querySelectorAll('#trash-list > .trash-row[data-item-id]'),
      function (el) { return el.dataset.itemId; }
    );
  }

  function trashComputeRange(ids, fromId, toId) {
    var i1 = ids.indexOf(fromId);
    var i2 = ids.indexOf(toId);
    if (i1 === -1 || i2 === -1) return [toId];
    return ids.slice(Math.min(i1, i2), Math.max(i1, i2) + 1);
  }

  function renderTrashSelectionState() {
    document.querySelectorAll('#trash-list .trash-row[data-item-id]').forEach(function (el) {
      var selected = state.trashSelectedItemIds.has(el.dataset.itemId);
      el.classList.toggle('is-selected', selected);
      el.setAttribute('aria-selected', String(selected));
    });
  }

  function renderTrashBulkBar() {
    var bar = document.getElementById('trash-bulk-bar');
    if (!bar) return;
    var count = state.trashSelectedItemIds.size;
    bar.hidden = count === 0;
    var countEl = bar.querySelector('.trash-bulk-count');
    if (countEl) countEl.textContent = count + '개 선택';
  }

  function clearTrashSelection() {
    if (!state.trashSelectedItemIds.size && !state.trashSelectionAnchor) return;
    state.trashSelectedItemIds.clear();
    state.trashSelectionAnchor = null;
    renderTrashSelectionState();
    renderTrashBulkBar();
  }

  function selectSingleTrashItem(itemId) {
    state.trashSelectedItemIds.clear();
    state.trashSelectedItemIds.add(itemId);
    state.trashSelectionAnchor = itemId;
    renderTrashSelectionState();
    renderTrashBulkBar();
  }

  function toggleTrashNonContiguous(itemId) {
    if (state.trashSelectedItemIds.has(itemId)) state.trashSelectedItemIds.delete(itemId);
    else state.trashSelectedItemIds.add(itemId);
    state.trashSelectionAnchor = itemId;
    renderTrashSelectionState();
    renderTrashBulkBar();
  }

  function trashRangeReplace(itemId) {
    if (!state.trashSelectionAnchor) { selectSingleTrashItem(itemId); return; }
    var range = trashComputeRange(getVisibleTrashIds(), state.trashSelectionAnchor, itemId);
    state.trashSelectedItemIds = new Set(range);
    renderTrashSelectionState();
    renderTrashBulkBar();
  }

  function trashRangeAdd(itemId) {
    if (!state.trashSelectionAnchor) {
      state.trashSelectedItemIds.add(itemId);
      state.trashSelectionAnchor = itemId;
      renderTrashSelectionState();
      renderTrashBulkBar();
      return;
    }
    var range = trashComputeRange(getVisibleTrashIds(), state.trashSelectionAnchor, itemId);
    range.forEach(function (id) { state.trashSelectedItemIds.add(id); });
    state.trashSelectionAnchor = itemId;
    renderTrashSelectionState();
    renderTrashBulkBar();
  }

  // 7: 행 안의 복원/영구 삭제 버튼은 선택 상태와 완전히 무관하게 항상 그 행 하나에만
  // 적용한다(다중 선택이 있어도 무시) — 일괄 작업은 상단 bulk bar 버튼으로만 실행한다.
  function handleTrashListClick(e) {
    var restoreBtn = e.target.closest('[data-action="trash-restore"]');
    if (restoreBtn) {
      e.stopPropagation();
      restoreItems([restoreBtn.dataset.itemId]);
      return;
    }
    var deleteBtn = e.target.closest('[data-action="trash-delete"]');
    if (deleteBtn) {
      e.stopPropagation();
      var targetItem = findItemById(deleteBtn.dataset.itemId);
      var label = targetItem ? targetItem.text : '이 항목';
      if (!window.confirm('"' + label + '"을(를) 영구 삭제할까요?')) return;
      permanentDeleteItems([deleteBtn.dataset.itemId]);
      return;
    }
    var row = e.target.closest('.trash-row[data-item-id]');
    if (!row) return;
    e.stopPropagation();
    var itemId = row.dataset.itemId;
    var isMulti = e.ctrlKey || e.metaKey;
    var isShift = e.shiftKey;
    if (isMulti && isShift) trashRangeAdd(itemId);
    else if (isMulti) toggleTrashNonContiguous(itemId);
    else if (isShift) trashRangeReplace(itemId);
    else selectSingleTrashItem(itemId);
  }

  // 9: 상단 일괄 작업 — bulk bar의 두 버튼 전용. restoreItems/permanentDeleteItems가 실제로
  // 손댄(touched) id만 trashSelectedItemIds에서 제거하므로, 선택 전체를 대상으로 하는 이
  // 일괄 작업 뒤에는 선택이 자연히 비워진다.
  function bulkRestoreSelectedTrash() {
    var ids = Array.from(state.trashSelectedItemIds);
    if (!ids.length) return;
    restoreItems(ids);
  }

  function bulkPermanentDeleteSelectedTrash() {
    var ids = Array.from(state.trashSelectedItemIds);
    if (!ids.length) return;
    if (!window.confirm(ids.length + '개 항목을 영구 삭제할까요?')) return;
    permanentDeleteItems(ids);
  }

  function wireTrashBulkBar() {
    var bar = document.getElementById('trash-bulk-bar');
    if (!bar) return;
    bar.addEventListener('click', function (e) {
      if (e.target.closest('[data-action="bulk-restore"]')) { bulkRestoreSelectedTrash(); return; }
      if (e.target.closest('[data-action="bulk-delete"]')) { bulkPermanentDeleteSelectedTrash(); return; }
    });
  }

  // 5: 필터 변경은 데이터에 영향 없이 화면 표시만 바꾸되, 필터로 가려질 수 있는 항목이
  // 일괄 작업에 잘못 포함되지 않도록 선택은 항상 초기화한다.
  function setTrashFilter(filter) {
    if (state.trashFilter === filter) return;
    state.trashFilter = filter;
    clearTrashSelection();
    renderTrashFilterState();
    renderTrashList();
  }

  function renderTrashFilterState() {
    document.querySelectorAll('.trash-filter-btn').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.filter === state.trashFilter));
    });
  }

  function wireTrashFilter() {
    document.querySelectorAll('.trash-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setTrashFilter(btn.dataset.filter); });
    });
    renderTrashFilterState();
  }

  // 10: 현재 필터와 무관하게 휴지통의 모든 항목을 영구 삭제한다(하나의 Undo 트랜잭션).
  function emptyTrash() {
    var allIds = getTrashItems().map(function (it) { return it.id; });
    if (!allIds.length) return;
    if (!window.confirm('휴지통의 모든 항목을 영구 삭제할까요?')) return;
    permanentDeleteItems(allIds);
  }

  function renderEmptyTrashButtonState() {
    var btn = document.getElementById('empty-trash-btn');
    if (!btn) return;
    btn.disabled = getTrashItems().length === 0;
  }

  function wireEmptyTrashButton() {
    var btn = document.getElementById('empty-trash-btn');
    if (btn) btn.addEventListener('click', emptyTrash);
  }

  function renderTrashBadge() {
    var badge = document.querySelector('.trash-badge');
    if (!badge) return;
    var count = getTrashItems().length;
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }

  // 사이드바 오늘/휴지통 전환 — 보기 모드만 바꾸고 selectedDate 등 다른 상태는 건드리지 않는다.
  // 8: 휴지통 진입 시 일반(Daily/Weekly) 선택을, 오늘 화면 복귀 시 휴지통 선택을 각각 초기화한다.
  function setView(view) {
    if (state.currentView === view) return;
    state.currentView = view;
    document.querySelectorAll('.side-item').forEach(function (el) { el.classList.remove('active'); });
    var target = document.querySelector('.side-item.' + (view === 'trash' ? 'trash' : 'today'));
    if (target) target.classList.add('active');
    var normalView = document.querySelector('.daily-normal-view');
    var trashView = document.getElementById('trash-view');
    if (normalView) normalView.hidden = view === 'trash';
    if (trashView) trashView.hidden = view !== 'trash';
    if (view === 'trash') {
      state.selectedItemIds.clear();
      state.selectedOccurrenceById.clear();
      state.lastSelectedItemId = null;
      state.selectionAnchor = null;
    } else {
      clearTrashSelection();
    }
    renderApp();
  }

  function wireSidebarNav() {
    var todayBtn = document.querySelector('.side-item.today');
    var trashBtn = document.querySelector('.side-item.trash');
    function onKeydownActivate(handler) {
      return function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
      };
    }
    if (todayBtn) {
      todayBtn.addEventListener('click', function () { setView('today'); });
      todayBtn.addEventListener('keydown', onKeydownActivate(function () { setView('today'); }));
    }
    if (trashBtn) {
      trashBtn.addEventListener('click', function () { setView('trash'); });
      trashBtn.addEventListener('keydown', onKeydownActivate(function () { setView('trash'); }));
    }
  }

  // ---------------------------------------------------------------------
  // 5/6/9/10: 라이트·다크모드 토글. <head>의 인라인 스크립트가 이미 첫 페인트 전에
  // documentElement.dataset.theme을 선반영해 뒀으므로, 여기서는 그 값을 state와 버튼
  // aria-pressed 표시에 동기화하고 클릭·키보드 조작만 연결한다. 테마는 항목 데이터를
  // 저장·변경하지 않고(별도 THEME_KEY), history Undo/Redo 스냅샷(state.items) 대상도 아니다.
  // ---------------------------------------------------------------------
  function loadTheme() {
    var saved = safeGet(THEME_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
  }

  function renderThemeToggleState() {
    document.querySelectorAll('.theme-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.themeChoice === state.theme);
    });
    var capsule = document.querySelector('.theme');
    if (capsule) {
      var isDark = state.theme === 'dark';
      capsule.setAttribute('aria-checked', String(isDark));
      // 6: 라벨은 현재 상태가 아니라 "클릭하면 어떻게 되는지"를 알려주는 동작 문구여야 한다.
      capsule.setAttribute('aria-label', isDark ? '라이트모드로 전환' : '다크모드로 전환');
    }
  }

  function setTheme(theme) {
    if (state.theme === theme) return;
    applyTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { console.warn('[dotdotplanner] failed to save theme:', e); }
    renderThemeToggleState();
  }

  function wireThemeToggle() {
    var capsule = document.querySelector('.theme');
    if (!capsule) return;
    // 6/10: 캡슐 전체가 하나의 토글 — 빈 공간·해·달·활성 배경 어디를 클릭해도(자식 span은
    // pointer-events:none이라 클릭이 항상 캡슐 자신에서 발생) 현재 테마의 반대로 전환한다.
    // 핸들러를 이 한 곳에만 달아 클릭이 두 번 잡혀 원상태로 되돌아가는 이중 토글을 방지한다.
    function toggleTheme() { setTheme(state.theme === 'dark' ? 'light' : 'dark'); }
    capsule.addEventListener('click', toggleTheme);
    capsule.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTheme(); }
    });
  }

  function renderApp() {
    renderDailyTitle();
    renderCalendarToday();
    renderCalendarDots();
    renderCalendarSelection();
    renderCalendarRangeSelection();
    renderDateFields();
    renderAllDayToggle();
    renderTimeFields();
    renderDailyList();
    renderWeekly();
    renderTrashFilterState();
    renderTrashList();
    renderTrashBadge();
    renderSelectionState();
    syncDetailDrawer();
  }

  // ---------------------------------------------------------------------
  // 완료 토글 / 종류 변경 — Daily·Weekly가 같은 item.id를 공유하므로
  // renderApp() 한 번으로 양쪽에 동시 반영된다.
  // ---------------------------------------------------------------------
  // 9~14: 체크박스는 기본적으로 "클릭한 항목/occurrence 하나"만 조작한다. 유일한 예외는
  // schedule일 때 — 클릭한 occurrence 자체가 선택 상태에 포함돼 있고, 같은 item.id의 다른
  // occurrence도 함께 선택돼 있으면 그 "선택된 occurrence들"만 함께 완료 처리한다. 서로 다른
  // item.id는(같이 선택돼 있어도) 절대 함께 바뀌지 않고, task/memo는 선택 상태와 무관하게
  // 항상 클릭한 항목 하나만 바뀐다.
  function toggleItemCompleted(itemId, occurrenceDate) {
    var item = findItemById(itemId);
    if (!item) {
      console.warn('[dotdotplanner] toggleItemCompleted: unknown itemId', itemId);
      return;
    }
    var occ = occurrenceDate || item.date;
    // 15: 선택 occurrence는 항상 이 item.id 하나로 한정해서만 읽는다 — 다른 일정의 선택
    // occurrence는 애초에 이 Set에 섞이지 않으므로 서로 다른 일정이 함께 바뀔 수 없다.
    var occSet = item.type === 'schedule' ? state.selectedOccurrenceById.get(itemId) : null;
    var isBulkSchedule = item.type === 'schedule' && state.selectedItemIds.has(itemId) &&
      !!occSet && occSet.has(occ) && occSet.size > 1;

    withHistoryTransaction(function () {
      if (isBulkSchedule) {
        var targetCompleted = !isOccurrenceCompleted(item, occ);
        occSet.forEach(function (occDate) {
          setOccurrenceCompleted(item, occDate, targetCompleted);
        });
      } else {
        setOccurrenceCompleted(item, occ, !isOccurrenceCompleted(item, occ));
      }
      item.updatedAt = Date.now();
    });
    saveItems();
    renderApp();
  }

  function changeItemType(itemId, nextType) {
    var item = findItemById(itemId);
    if (!item) {
      console.warn('[dotdotplanner] changeItemType: unknown itemId', itemId);
      closeTypeMenu();
      return;
    }
    if (item.type === nextType) {
      closeTypeMenu();
      return;
    }

    withHistoryTransaction(function () {
      if (nextType === 'schedule') {
        // task/memo → schedule: 날짜는 유지하고 일정에 필요한 필드만 보강한다.
        if (!item.endDate) item.endDate = item.date;
        if (item.allDay === undefined || item.allDay === null) item.allDay = true;
        if (item.startTime === undefined) item.startTime = null;
        if (item.endTime === undefined) item.endTime = null;
        item.type = nextType;
        // 이전에 schedule이었던 적이 있으면 그때의 completionByDate를 복원하고 현재
        // date~endDate 범위에 맞게 정규화한다. 처음 schedule이 되는 경우는 item.completed로 새로 채운다.
        normalizeCompletionMapForRange(item);
        syncScheduleOverallCompleted(item);
      } else {
        // schedule → task/memo: endDate/startTime/endTime/completionByDate는 지우지 않고
        // 그대로 둔다(다시 schedule로 바꾸면 복원됨). 화면 완료 판정은 item.completed를 쓴다.
        item.type = nextType;
      }
      item.updatedAt = Date.now();
    });
    saveItems();
    renderApp();
    closeTypeMenu();
  }

  // ---------------------------------------------------------------------
  // 종류 선택 팝업 (role="menu") — 한 번에 하나만 열리고, 외부 클릭/Escape/
  // 다른 항목 클릭/선택 완료 시 닫힌다. 방향키로 이동, Enter로 선택.
  // ---------------------------------------------------------------------
  var TYPE_OPTIONS = [
    { type: 'task', icon: 'ic-dot' },
    { type: 'schedule', icon: 'ic-ring' },
    { type: 'memo', icon: 'ic-dash' }
  ];

  var activeTypeMenu = null; // { el, itemId }

  // 타입 메뉴/날짜 이동 팝업 공용 위치 계산 (앵커 아래에 붙이되 viewport를 벗어나면 보정).
  function positionPopup(menuEl, anchorEl) {
    var rect = anchorEl.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    menuEl.style.top = '0px';
    menuEl.style.left = '0px';
    var menuRect = menuEl.getBoundingClientRect();

    var top = rect.bottom + 4;
    var left = rect.left;
    if (left + menuRect.width > vw - 8) left = Math.max(8, vw - menuRect.width - 8);
    if (left < 8) left = 8;
    if (top + menuRect.height > vh - 8) top = rect.top - menuRect.height - 4;
    if (top < 8) top = 8;
    menuEl.style.top = top + 'px';
    menuEl.style.left = left + 'px';
  }

  function moveTypeMenuFocus(items, target) {
    items.forEach(function (it) { it.tabIndex = -1; });
    target.tabIndex = 0;
    target.focus();
  }

  function onTypeMenuKeydown(e) {
    if (!activeTypeMenu) return;
    var items = Array.prototype.slice.call(activeTypeMenu.el.querySelectorAll('[role="menuitemradio"]'));
    var currentIndex = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeTypeMenu();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveTypeMenuFocus(items, items[(currentIndex + 1 + items.length) % items.length]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveTypeMenuFocus(items, items[(currentIndex - 1 + items.length) % items.length]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (currentIndex >= 0) {
        changeItemType(activeTypeMenu.itemId, items[currentIndex].dataset.type);
      }
    }
  }

  function onOutsideTypeMenuPointerDown(e) {
    if (!activeTypeMenu) return;
    if (activeTypeMenu.el.contains(e.target)) return;
    var anchor = document.querySelector('[data-action="type-menu"][data-item-id="' + activeTypeMenu.itemId + '"]');
    if (anchor && anchor.contains(e.target)) return;
    closeTypeMenu();
  }

  function closeTypeMenu(restoreFocus) {
    if (!activeTypeMenu) return;
    var itemId = activeTypeMenu.itemId;
    activeTypeMenu.el.remove();
    document.removeEventListener('pointerdown', onOutsideTypeMenuPointerDown, true);
    document.removeEventListener('keydown', onTypeMenuKeydown, true);
    activeTypeMenu = null;
    // 재렌더링 후에는 원래 앵커 DOM이 교체되므로, 같은 item id를 가진 최신 버튼을
    // 다시 찾아 aria-expanded를 되돌리고 포커스를 복원한다.
    var anchors = document.querySelectorAll('[data-action="type-menu"][data-item-id="' + itemId + '"]');
    anchors.forEach(function (a) { a.setAttribute('aria-expanded', 'false'); });
    if (restoreFocus !== false && anchors[0]) anchors[0].focus();
  }

  function openTypeMenu(itemId, anchorEl) {
    if (activeTypeMenu && activeTypeMenu.itemId === itemId) {
      closeTypeMenu();
      return;
    }
    var item = findItemById(itemId);
    if (!item) return;
    if (activeTypeMenu) closeTypeMenu(false);
    if (activeDateWheel) closeDateWheelPopup(false);
    if (activeTimeWheel) closeTimeWheelPopup(false);

    var menu = document.createElement('div');
    menu.className = 'type-menu';
    menu.setAttribute('role', 'menu');

    TYPE_OPTIONS.forEach(function (opt) {
      var isCurrent = opt.type === item.type;
      var mi = document.createElement('div');
      mi.className = 'type-menu-item';
      mi.setAttribute('role', 'menuitemradio');
      mi.setAttribute('aria-checked', String(isCurrent));
      mi.tabIndex = isCurrent ? 0 : -1;
      mi.dataset.type = opt.type;

      var icon = document.createElement('span');
      icon.className = opt.icon;
      var label = document.createElement('span');
      label.textContent = typeLabel(opt.type);

      mi.appendChild(icon);
      mi.appendChild(label);
      mi.addEventListener('click', function () {
        changeItemType(itemId, opt.type);
      });
      menu.appendChild(mi);
    });

    document.body.appendChild(menu);
    positionPopup(menu, anchorEl);
    anchorEl.setAttribute('aria-expanded', 'true');
    activeTypeMenu = { el: menu, itemId: itemId };

    var toFocus = menu.querySelector('[aria-checked="true"]') || menu.firstElementChild;
    if (toFocus) toFocus.focus();

    // 이 클릭 이벤트 자체가 곧바로 outside-click으로 처리되지 않도록 다음 tick에 등록.
    setTimeout(function () {
      document.addEventListener('pointerdown', onOutsideTypeMenuPointerDown, true);
      document.addEventListener('keydown', onTypeMenuKeydown, true);
    }, 0);
  }

  // ---------------------------------------------------------------------
  // 선택 (Daily/Weekly 공용) — item.id 기준이라 같은 id의 모든 표현(다일 일정의
  // Weekly 복제 포함)이 한꺼번에 선택 표시된다. localStorage에는 저장하지 않는다.
  // ---------------------------------------------------------------------
  function isItemSelected(itemId) {
    return state.selectedItemIds.has(itemId);
  }

  // 15: 같은 item.id라도 다일 일정은 서로 다른 날짜 열에서 각각 선택될 수 있으므로, 기존
  // occurrence 선택에 "더한다"(덮어쓰지 않는다) — 그래야 7/1·7/2·7/3 occurrence를 차례로
  // Ctrl+클릭해 함께 선택하는 게 가능해진다.
  function addSelectedOccurrence(itemId, containerKey) {
    if (containerKey === undefined) return;
    var set = state.selectedOccurrenceById.get(itemId);
    if (!set) { set = new Set(); state.selectedOccurrenceById.set(itemId, set); }
    set.add(containerKey);
  }

  // 일반 클릭 = 단일 선택 + 새 anchor 저장. context/containerKey를 생략하면(예: 드래그 로직
  // 내부에서 이미 다른 경로로 anchor를 관리하는 경우) anchor는 건드리지 않는다.
  function selectSingleItem(itemId, context, containerKey) {
    state.selectedItemIds.clear();
    state.selectedItemIds.add(itemId);
    state.selectedOccurrenceById.clear();
    addSelectedOccurrence(itemId, containerKey);
    state.lastSelectedItemId = itemId;
    if (context !== undefined) {
      state.selectionAnchor = { itemId: itemId, context: context, containerKey: containerKey };
    }
    renderSelectionState();
  }

  function clearItemSelection() {
    if (state.selectedItemIds.size === 0 && !state.selectionAnchor) return;
    state.selectedItemIds.clear();
    state.selectedOccurrenceById.clear();
    state.lastSelectedItemId = null;
    state.selectionAnchor = null;
    renderSelectionState();
  }

  function isSameContainer(anchor, context, containerKey) {
    return !!anchor && anchor.context === context && anchor.containerKey === containerKey;
  }

  // 현재 화면에 표시된 순서 그대로 id 목록을 반환한다(범위 선택 계산 기준).
  // daily/weekly 모두 "같은 날짜의 항목을 order로 정렬"이라는 동일한 규칙이라
  // containerKey(날짜 문자열)만으로 충분하다.
  function getVisibleIdsForContainer(containerKey) {
    return getItemsForDate(containerKey)
      .slice()
      .sort(function (a, b) { return a.order - b.order; })
      .map(function (it) { return it.id; });
  }

  function computeRange(ids, fromId, toId) {
    var i1 = ids.indexOf(fromId);
    var i2 = ids.indexOf(toId);
    if (i1 === -1 || i2 === -1) return [toId];
    var start = Math.min(i1, i2);
    var end = Math.max(i1, i2);
    return ids.slice(start, end + 1);
  }

  // Ctrl/Cmd+클릭: 비연속 추가/제거. 클릭한 항목이 새 anchor가 된다.
  // 15: 같은 item.id라도 "이미 선택된 그 occurrence"를 다시 클릭했을 때만 제거한다 — 다일
  // 일정의 아직 선택 안 된 다른 날짜 occurrence를 클릭하면 기존 선택은 유지한 채 이 occurrence만
  // 추가된다(그래야 여러 occurrence를 함께 선택해 일괄 완료할 수 있다).
  function toggleNonContiguousSelection(itemId, context, containerKey) {
    var occSet = state.selectedOccurrenceById.get(itemId);
    var alreadyThisOccurrence = !!occSet && containerKey !== undefined && occSet.has(containerKey);
    if (state.selectedItemIds.has(itemId) && (alreadyThisOccurrence || containerKey === undefined)) {
      if (occSet && containerKey !== undefined) occSet.delete(containerKey);
      if (!occSet || !occSet.size) {
        state.selectedItemIds.delete(itemId);
        state.selectedOccurrenceById.delete(itemId);
      }
    } else {
      state.selectedItemIds.add(itemId);
      addSelectedOccurrence(itemId, containerKey);
    }
    state.lastSelectedItemId = itemId;
    state.selectionAnchor = { itemId: itemId, context: context, containerKey: containerKey };
    renderSelectionState();
  }

  // Shift+클릭: anchor→클릭 항목까지 연속 범위로 "교체" 선택. anchor가 다른 컨테이너에
  // 있으면(다른 날짜/Daily·Weekly 간) 범위를 만들지 않고 단일 선택으로 대체한다.
  function rangeReplaceSelection(itemId, context, containerKey) {
    var anchor = state.selectionAnchor;
    if (!isSameContainer(anchor, context, containerKey)) {
      selectSingleItem(itemId, context, containerKey);
      return;
    }
    var ids = getVisibleIdsForContainer(containerKey);
    var range = computeRange(ids, anchor.itemId, itemId);
    state.selectedItemIds = new Set(range);
    state.selectedOccurrenceById.clear();
    range.forEach(function (id) { addSelectedOccurrence(id, containerKey); });
    state.lastSelectedItemId = itemId;
    renderSelectionState();
  }

  // Ctrl/Cmd+Shift+클릭: anchor→클릭 항목 범위를 기존 선택에 "추가"(기존 비연속 선택은
  // 유지). 다른 컨테이너 간에는 범위를 만들 수 없으므로 클릭한 항목 하나만 추가하고
  // anchor를 갱신한다(기존 선택은 그대로 유지 — Ctrl의 "추가" 의미를 지킨다).
  function rangeAddSelection(itemId, context, containerKey) {
    var anchor = state.selectionAnchor;
    if (!isSameContainer(anchor, context, containerKey)) {
      state.selectedItemIds.add(itemId);
      addSelectedOccurrence(itemId, containerKey);
      state.lastSelectedItemId = itemId;
      state.selectionAnchor = { itemId: itemId, context: context, containerKey: containerKey };
      renderSelectionState();
      return;
    }
    var ids = getVisibleIdsForContainer(containerKey);
    var range = computeRange(ids, anchor.itemId, itemId);
    range.forEach(function (id) { state.selectedItemIds.add(id); addSelectedOccurrence(id, containerKey); });
    state.lastSelectedItemId = itemId;
    renderSelectionState();
  }

  // 클릭 시 눌린 보조키에 따라 위 네 가지 선택 동작으로 분기하는 단일 진입점.
  // 7A.2: skipOpenDetail이 true면(선택 gutter 클릭) 보조키 없는 클릭도 상세 모달을 열지
  // 않는다 — gutter는 "선택 전용" 영역이라는 요구사항 때문. 카드 본문 클릭은 여전히
  // (skipOpenDetail 생략 = false) 기존처럼 단일 선택 + 상세 모달을 함께 연다.
  function handleItemPointerSelect(e, itemId, context, containerKey, occurrenceDate, skipOpenDetail) {
    var isMulti = e.ctrlKey || e.metaKey;
    var isShift = e.shiftKey;
    if (isMulti && isShift) {
      rangeAddSelection(itemId, context, containerKey);
    } else if (isMulti) {
      toggleNonContiguousSelection(itemId, context, containerKey);
    } else if (isShift) {
      rangeReplaceSelection(itemId, context, containerKey);
    } else {
      selectSingleItem(itemId, context, containerKey);
      // 6차 1: 보조키 없는 일반 클릭은 이제 task뿐 아니라 schedule/memo도 같은 상세
      // 모달을 연다(기존 task 클릭 동작을 그대로 세 유형에 확장 — 별도 "상세 열기 전용"
      // 영역을 새로 만들지 않는다). 체크박스·상태 문양·화살표·드래그 핸들은 이 지점에
      // 도달하기 전에 각자의 data-action 분기에서 이미 걸러졌다.
      if (!skipOpenDetail) openDetailDrawer(itemId, occurrenceDate);
    }
  }

  // 실제 선택 여부를 DOM에 반영하는 단일 지점. renderApp() 끝에서 항상 다시
  // 호출되므로, 완료 토글/타입 변경 등 다른 재렌더링 후에도 선택 표시가 유지된다.
  // 8: 휴지통 행(.task.trash-row)은 selectedItemIds가 아니라 별도의 trashSelectedItemIds를
  // 쓰므로(renderTrashSelectionState 담당) 여기서 제외한다 — 안 그러면 휴지통 보기에서
  // 매번 selectedItemIds(항상 빈 상태)를 기준으로 휴지통 선택 표시가 지워진다.
  function renderSelectionState() {
    document.querySelectorAll('.task[data-item-id]:not(.trash-row), .week-card li[data-item-id]').forEach(function (el) {
      var selected = state.selectedItemIds.has(el.dataset.itemId);
      el.classList.toggle('is-selected', selected);
      el.setAttribute('aria-selected', String(selected));
    });
  }

  // ---------------------------------------------------------------------
  // 이벤트 위임 — Daily/Weekly 컨테이너 각각에 리스너 1개만 등록한다.
  // 재렌더링으로 행이 교체돼도 컨테이너 자체는 그대로라 다시 등록할 필요 없다.
  // ---------------------------------------------------------------------
  function handleListClick(e) {
    var checkboxBtn = e.target.closest('[data-action="toggle-complete"]');
    if (checkboxBtn) {
      e.stopPropagation();
      toggleItemCompleted(checkboxBtn.dataset.itemId, checkboxBtn.dataset.occurrenceDate);
      return;
    }
    var typeBtn = e.target.closest('[data-action="type-menu"]');
    if (typeBtn) {
      e.stopPropagation();
      openTypeMenu(typeBtn.dataset.itemId, typeBtn);
      return;
    }
    var moveBtn = e.target.closest('[data-action="move-date"]');
    if (moveBtn) {
      e.stopPropagation();
      handleMoveDateClick(moveBtn.dataset.itemId, moveBtn);
      return;
    }
    var plusBtn = e.target.closest('[data-action="weekly-add"]');
    if (plusBtn) {
      e.stopPropagation();
      var card = plusBtn.closest('.week-card');
      var ul = card && card.querySelector('ul[data-date]');
      if (ul) openWeeklyInlineAdd(ul.dataset.date, plusBtn);
      return;
    }
    // 7A.2(정정): 선택 gutter(overlay)와 6점 grip은 이제 형제 요소라 gutter closest만으로는
    // grip 클릭을 못 거른다 — 각자 자기 자신의 click 리스너가 이미 처리했으므로 둘 다
    // 여기서 제외한다(안 그러면 중복 처리: Ctrl 토글이 두 번 실행돼 도로 꺼지는 등).
    if (e.target.closest('[data-action="select-item"]') || e.target.closest('.drag') || e.target.closest('.week-drag')) return;
    // 인라인 추가 입력 영역 클릭은 선택과 무관하다.
    if (e.target.closest('.week-inline-add')) return;
    // 제목 인라인 편집 입력 안 클릭(텍스트 선택 등)은 카드 선택으로 이어지지 않는다.
    if (e.target.closest('.title-edit-input')) return;
    // 7A.2 6: 날짜 header(Weekly)는 "빈 영역 클릭"으로 치지 않는다(아무 것도 안 함).
    if (e.target.closest('.week-card header')) return;

    var row = e.target.closest('[data-item-id]');
    if (!row) {
      // 7A.2 6: 카드도 알려진 컨트롤도 아닌 실제 빈 공간 클릭 — 전체 선택 해제(모달 없음,
      // history 없음). marquee drag가 방금 끝났다면(suppressNextItemGutterClick) 중복
      // 처리하지 않는다.
      if (suppressNextItemGutterClick) { suppressNextItemGutterClick = false; return; }
      clearItemSelection();
      return;
    }
    e.stopPropagation();
    var itemId = row.dataset.itemId;
    var context, containerKey;
    if (row.closest('#daily-list, #rollover-list')) {
      context = 'daily';
      containerKey = state.selectedDate;
    } else {
      context = 'weekly';
      var ulEl = row.closest('ul[data-date]');
      containerKey = ulEl ? ulEl.dataset.date : null;
    }

    // 3: 제목 글자를 클릭해도 빈 영역 클릭과 동일하게 "선택"만 한다(편집은 더블클릭/F2/
    // 단일선택 Enter 전용) — Shift/Ctrl 범위·비연속 선택이 제목 위에서도 그대로 작동한다.
    // 4: 다른 항목을 편집하던 중이었다면 이 클릭에서 먼저 커밋부터 하고 나서 같은 클릭으로
    // 바로 선택까지 끝낸다(두 번째 클릭이 필요해지는 문제 방지). blur의 setTimeout(0) 지연
    // 커밋과 중복 실행돼도 commitTitleEdit()은 activeTitleEdit이 없으면 즉시 반환해 안전하다.
    if (activeTitleEdit) commitTitleEdit();

    handleItemPointerSelect(e, itemId, context, containerKey, row.dataset.occurrenceDate);
  }

  // 목록/Weekly 카드 "바깥"의 빈 영역 클릭 시 전체 선택 해제.
  function handleDocumentSelectionClear(e) {
    // 7A.2(정정): Daily 빈 공간 marquee가 .top 기준으로 넓게 걸리면서, drag가 끝나는
    // 지점(mouseup)이 #daily-list/#rollover-list 바깥(예: 빠른입력·이월 토글 사이 여백)일
    // 수 있다 — 그 경우 여기 도달하는 뒤이은 native click이 insideKnownContainer에 안
    // 걸려 방금 만든 marquee 선택을 조용히 지워버린다. gutter와 같은 억제 플래그를 공유해
    // "방금 실제 drag(marquee/재정렬)가 끝난 직후의 click 1개"만 여기서도 건너뛴다.
    if (suppressNextItemGutterClick) { suppressNextItemGutterClick = false; return; }
    var dailyList = document.getElementById('daily-list');
    var rolloverList = document.getElementById('rollover-list');
    var trashList = document.getElementById('trash-list');
    var trashBulkBar = document.getElementById('trash-bulk-bar');
    var weeklyPanel = document.querySelector('.weekly');
    var insideKnownContainer =
      (dailyList && dailyList.contains(e.target)) ||
      (rolloverList && rolloverList.contains(e.target)) ||
      (trashList && trashList.contains(e.target)) ||
      (trashBulkBar && trashBulkBar.contains(e.target)) ||
      // Weekly 패널 전체(헤더의 내리기/올리기 토글·주간 이동 버튼, 경계 드래그 핸들,
      // week-grid 전부 포함) — 여기를 클릭했다고 선택이 조용히 풀리면 안 된다(7: 내렸다
      // 올려도 선택 유지 요구사항). week-grid만 따로 보던 예전 범위를 패널 전체로 넓혔다.
      (weeklyPanel && weeklyPanel.contains(e.target)) ||
      (activeTypeMenu && activeTypeMenu.el.contains(e.target)) ||
      (activeMoveMenu && activeMoveMenu.el.contains(e.target)) ||
      (activeDateWheel && activeDateWheel.el.contains(e.target)) ||
      (activeTimeWheel && activeTimeWheel.el.contains(e.target)) ||
      // 상세 drawer(backdrop 포함) 안에서의 클릭으로 선택이 조용히 풀리지 않게 한다 —
      // drawer는 activeDetailItemId로 독립 관리되고, 닫힘은 자신의 backdrop/X/Escape가 맡는다.
      (activeDetailDrawer && activeDetailDrawer.overlayEl.contains(e.target));
    if (insideKnownContainer) return;
    // 8: 일반 선택과 휴지통 선택은 서로 다른 상태라 빈 공간 클릭 시 둘 다 각자 초기화한다.
    if (state.selectedItemIds.size > 0) clearItemSelection();
    if (state.trashSelectedItemIds.size > 0) clearTrashSelection();
  }

  // 항목 하나만 선택돼 있을 때 F2 또는 Enter로 제목 편집을 시작한다(다중 선택이면 무시).
  // 이미 다른 입력(빠른 입력, 날짜 입력, 편집 중인 제목 자신 등)에 포커스가 있을 때는
  // 그 입력의 고유 동작을 가로채지 않는다.
  function startTitleEditForSelection() {
    var itemId = state.selectedItemIds.values().next().value;
    if (!itemId) return;
    var titleEl = document.querySelector('#daily-list [data-item-id="' + itemId + '"] .row-title') ||
      document.querySelector('#rollover-list [data-item-id="' + itemId + '"] .row-title') ||
      document.querySelector('.week-card li[data-item-id="' + itemId + '"] .week-item-title');
    if (!titleEl) return;
    startTitleEdit(itemId, titleEl);
  }

  function handleGlobalKeydown(e) {
    var ae = document.activeElement;
    var isTypingElsewhere = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);

    if (e.key === 'F2') {
      if (isTypingElsewhere || activeTitleEdit || activeDateWheel || activeTimeWheel) return;
      if (state.selectedItemIds.size !== 1) return;
      e.preventDefault();
      startTitleEditForSelection();
      return;
    }
    if (e.key === 'Enter' && !e.isComposing) {
      if (isTypingElsewhere || activeTitleEdit || activeDateWheel || activeTimeWheel) return; // 편집 중 Enter는 input/휠 자신의 핸들러가 처리.
      if (dragState || calendarRangeDragState || activeTypeMenu || activeMoveMenu || activeWeeklyInlineAdd) return;
      if (state.selectedItemIds.size !== 1) return;
      startTitleEditForSelection();
      return;
    }

    // 7: Delete는 항상, Backspace는 입력창 등에 포커스가 없을 때만 선택 항목을 휴지통으로 이동한다.
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (isTypingElsewhere || activeTitleEdit || activeDateWheel || activeTimeWheel) return;
      if (dragState || calendarRangeDragState || activeTypeMenu || activeMoveMenu || activeWeeklyInlineAdd) return;
      if (state.activeDetailItemId) return; // 5: 상세 drawer가 열린 동안은 차단.
      if (state.currentView !== 'today') return; // 휴지통 보기 자체에서는 이 단축키로 삭제하지 않는다.
      if (state.selectedItemIds.size === 0) return;
      e.preventDefault();
      softDeleteItems(Array.from(state.selectedItemIds));
      return;
    }

    var key = e.key.toLowerCase();

    // 7: Ctrl/Cmd+C·V = 앱 내부 항목 클립보드. 입력창/편집 팝업/드래그 중이거나 휴지통
    // 화면일 때는 아무 것도 하지 않고 그대로 반환해 브라우저 기본 텍스트 복사·붙여넣기를
    // 건드리지 않는다.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (key === 'c' || key === 'v')) {
      if (isTypingElsewhere || activeTitleEdit || activeDateWheel || activeTimeWheel || activeWeeklyInlineAdd) return;
      if (dragState || calendarRangeDragState || activeTypeMenu || activeMoveMenu) return;
      if (state.activeDetailItemId) return; // 5: 상세 drawer가 열린 동안은 차단.
      if (state.currentView !== 'today') return;
      e.preventDefault();
      if (key === 'c') copySelectedItemsToClipboard(); else pasteItemsFromClipboard();
      return;
    }

    // 9: Ctrl/Cmd+Z=Undo, Ctrl/Cmd+Shift+Z 또는 Windows Ctrl+Y=Redo. Shift+Z 단독은 글자
    // 입력과 충돌하므로 등록하지 않는다(아래 조건 모두 ctrl/meta가 눌려 있어야만 매칭됨).
    var isUndoCombo = (e.ctrlKey || e.metaKey) && !e.altKey && key === 'z' && !e.shiftKey;
    var isRedoCombo = ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'z' && e.shiftKey) ||
      (e.ctrlKey && !e.metaKey && !e.altKey && key === 'y');
    if (isUndoCombo || isRedoCombo) {
      // 입력창/textarea/contenteditable/제목 편집 input에 포커스가 있으면 브라우저 기본
      // 텍스트 undo/redo를 그대로 쓰게 두고 전역 history는 실행하지 않는다.
      if (isTypingElsewhere) return;
      e.preventDefault();
      if (isRedoCombo) redo(); else undo();
      return;
    }

    if (e.key !== 'Escape') return;
    // 드래그 중이면 무엇보다 먼저 취소한다(데이터 변경 없음, localStorage 쓰기 없음).
    if (dragState) {
      cancelActiveDrag();
      return;
    }
    // 7A.2: Daily/Weekly 빈 공간 marquee도 같은 우선순위(진행 중인 조작부터 취소).
    if (itemMarqueeSelectionState) {
      cancelItemMarqueeSelection();
      return;
    }
    if (calendarRangeDragState) {
      cancelCalendarRangeDrag();
      return;
    }
    // 팝업이 열려 있으면 팝업 자신의 캡처 단계 핸들러가 먼저 처리하고
    // stopPropagation()으로 여기까지 전달되지 않게 막는다. 팝업이 없을 때만
    // 아래 우선순위(확정된 날짜 범위 → 항목 선택)를 처리한다.
    if (activeTypeMenu || activeMoveMenu || activeDateWheel || activeTimeWheel) return;
    // 5/12: 상세 drawer도 자신의 캡처 단계 핸들러(onDetailDrawerKeydown)가 먼저 처리하고
    // stopPropagation()한다 — 혹시라도 여기까지 전달됐다면 아무 것도 하지 않는다(안전망).
    if (state.activeDetailItemId) return;
    // 3: 드래그 중이 아니어도, 확정된 날짜 범위가 남아 있으면 Escape로 명시적으로 취소한다.
    if (state.selectedDateRange) {
      clearConfirmedDateRange();
      return;
    }
    // 8: 휴지통 보기에서는 휴지통 선택을, 그 외에는 기존처럼 일반 선택을 해제한다.
    if (state.currentView === 'trash') {
      clearTrashSelection();
    } else {
      clearItemSelection();
    }
  }

  // ---------------------------------------------------------------------
  // 7A.2 7: Daily·Weekly 빈 공간 marquee 선택. desc-editor의 marquee(threshold·overlay·
  // Escape 취소 패턴)와 형태는 닮았지만, 대상이 item card라 완전히 별도 상태로 관리한다
  // (item 선택 자체는 selectSingleItem/renderSelectionState 등 기존 helper를 그대로 쓴다).
  // ---------------------------------------------------------------------
  var itemMarqueeSelectionState = null;

  function isItemMarqueeExcludedTarget(target) {
    if (!target || !target.closest) return true;
    return !!(target.closest('[data-item-id]') || target.closest('[data-action]') ||
      target.closest('.week-card header') || target.closest('.week-inline-add') || target.closest('.title-edit-input') ||
      // Daily 쪽 marquee는 .top(달력+Daily 전체 스크롤 뷰포트) 기준으로 넓게 걸어서(실제
      // 빈 목록 영역이 #daily-list 자체보다 크다) 달력·빠른입력·이월 토글·제목·입력요소를
      // 명시적으로 제외한다(이들은 data-action이 없다).
      target.closest('.calendar-card') || target.closest('.quick') || target.closest('.rollover') ||
      target.closest('.daily-title') || target.closest('input') || target.closest('textarea'));
  }

  function onItemListPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (dragState || itemMarqueeSelectionState) return;
    if (state.currentView !== 'today') return; // 휴지통 보기에서는 별도 선택 체계를 쓴다.
    if (isItemMarqueeExcludedTarget(e.target)) return;
    // 7A.2(정정): Daily marquee의 대상 컨테이너(.top)는 overflow-y:auto 스크롤 영역이다 —
    // preventDefault 없이 두면 브라우저가 이 드래그를 스크롤 제스처로 해석해 도중에
    // pointercancel을 보내 marquee가 끊긴다(Weekly의 .week-grid는 자체 스크롤이 없어
    // 이 문제가 없었다). 기존 grip 드래그(onDragHandlePointerDown)도 같은 이유로
    // preventDefault를 쓴다.
    e.preventDefault();
    var containerEl = e.currentTarget;
    itemMarqueeSelectionState = {
      active: false,
      pending: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      rafScheduled: false,
      // 7A.2 7: Ctrl/Cmd·Shift·Ctrl+Shift 전부 "기존 선택 유지 + marquee 항목 추가"로
      // 동일하게 동작한다(토글/범위anchor 없음) — modifier 하나라도 있으면 additive.
      additive: !!(e.ctrlKey || e.metaKey || e.shiftKey),
      initialSelectedIds: new Set(state.selectedItemIds),
      overlayEl: null,
      containerEl: containerEl
    };
    try { containerEl.setPointerCapture(e.pointerId); } catch (err) {}
    containerEl.addEventListener('pointermove', onItemListPointerMove);
    containerEl.addEventListener('pointerup', onItemListPointerUp);
    containerEl.addEventListener('pointercancel', onItemListPointerCancel);
  }

  function activateItemMarqueeSelection() {
    var ms = itemMarqueeSelectionState;
    ms.pending = false;
    ms.active = true;
    var overlay = document.createElement('div');
    overlay.className = 'item-marquee-overlay';
    document.body.appendChild(overlay);
    ms.overlayEl = overlay;
  }

  function updateItemMarqueeRect() {
    var ms = itemMarqueeSelectionState;
    if (!ms || !ms.overlayEl) return;
    var x1 = Math.min(ms.startX, ms.currentX), y1 = Math.min(ms.startY, ms.currentY);
    var x2 = Math.max(ms.startX, ms.currentX), y2 = Math.max(ms.startY, ms.currentY);
    ms.overlayEl.style.left = x1 + 'px';
    ms.overlayEl.style.top = y1 + 'px';
    ms.overlayEl.style.width = (x2 - x1) + 'px';
    ms.overlayEl.style.height = (y2 - y1) + 'px';
  }

  function updateItemMarqueeSelection() {
    var ms = itemMarqueeSelectionState;
    if (!ms) return;
    var x1 = Math.min(ms.startX, ms.currentX), y1 = Math.min(ms.startY, ms.currentY);
    var x2 = Math.max(ms.startX, ms.currentX), y2 = Math.max(ms.startY, ms.currentY);
    var intersecting = new Set();
    // 7A.2: 화면에 실제로 보이는 카드만(:not([hidden]) 목록·펼쳐진 Weekly 열) 대상으로 한다.
    document.querySelectorAll('#daily-list .task[data-item-id], #rollover-list .task[data-item-id], .week-card li[data-item-id]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return; // 숨김(display:none) 컨테이너 안 카드 제외.
      if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) intersecting.add(el.dataset.itemId);
    });
    var finalSet;
    if (ms.additive) {
      finalSet = new Set(ms.initialSelectedIds);
      intersecting.forEach(function (id) { finalSet.add(id); });
    } else {
      finalSet = intersecting;
    }
    state.selectedItemIds = finalSet;
    renderSelectionState();
  }

  function itemMarqueeRafTick() {
    var ms = itemMarqueeSelectionState;
    if (!ms) return;
    ms.rafScheduled = false;
    updateItemMarqueeRect();
    updateItemMarqueeSelection();
  }

  function onItemListPointerMove(e) {
    var ms = itemMarqueeSelectionState;
    if (!ms || e.pointerId !== ms.pointerId) return;
    ms.currentX = e.clientX;
    ms.currentY = e.clientY;
    if (ms.pending) {
      var dx = e.clientX - ms.startX, dy = e.clientY - ms.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      activateItemMarqueeSelection();
    }
    if (!ms.rafScheduled) {
      ms.rafScheduled = true;
      requestAnimationFrame(itemMarqueeRafTick);
    }
  }

  function teardownItemMarqueeListeners(ms) {
    var el = ms && ms.containerEl;
    if (!el) return;
    el.removeEventListener('pointermove', onItemListPointerMove);
    el.removeEventListener('pointerup', onItemListPointerUp);
    el.removeEventListener('pointercancel', onItemListPointerCancel);
    try { el.releasePointerCapture(ms.pointerId); } catch (err) {}
  }

  function cleanupItemMarqueeDom(ms) {
    if (ms.overlayEl) ms.overlayEl.remove();
  }

  function onItemListPointerUp(e) {
    var ms = itemMarqueeSelectionState;
    if (!ms || e.pointerId !== ms.pointerId) return;
    teardownItemMarqueeListeners(ms);
    cleanupItemMarqueeDom(ms);
    // 실제로 드래그가 활성화됐었다면 뒤에 이어지는 네이티브 'click'이 방금 만든 선택을
    // 곧바로 지우지 않도록 억제한다(gutter click과 같은 억제 플래그 재사용).
    if (ms.active) suppressNextItemGutterClickOnce();
    itemMarqueeSelectionState = null;
  }

  function onItemListPointerCancel(e) {
    var ms = itemMarqueeSelectionState;
    if (!ms || e.pointerId !== ms.pointerId) return;
    cancelItemMarqueeSelection();
  }

  function cancelItemMarqueeSelection() {
    var ms = itemMarqueeSelectionState;
    if (!ms) return;
    teardownItemMarqueeListeners(ms);
    cleanupItemMarqueeDom(ms);
    state.selectedItemIds = new Set(ms.initialSelectedIds);
    renderSelectionState();
    if (ms.active) suppressNextItemGutterClickOnce();
    itemMarqueeSelectionState = null;
  }

  function wireItemListMarqueeDelegation(containerEl) {
    containerEl.addEventListener('pointerdown', onItemListPointerDown);
  }

  function handleListDblClick(e) {
    var titleEl = e.target.closest('.row-title, .week-item-title');
    if (!titleEl) return; // 체크박스/상태문양/드래그핸들/화살표는 이 셀렉터에 안 걸린다.
    var row = titleEl.closest('[data-item-id]');
    if (!row) return;
    e.stopPropagation();
    startTitleEdit(row.dataset.itemId, titleEl);
  }

  function wireListDelegation() {
    var dailyList = document.getElementById('daily-list');
    if (dailyList) {
      dailyList.addEventListener('click', handleListClick);
      dailyList.addEventListener('dblclick', handleListDblClick);
    }
    // 4: 이월 목록도 같은 위임 핸들러를 그대로 재사용한다(체크·편집·타입변경·이동·선택·드래그 공용).
    var rolloverList = document.getElementById('rollover-list');
    if (rolloverList) {
      rolloverList.addEventListener('click', handleListClick);
      rolloverList.addEventListener('dblclick', handleListDblClick);
    }
    // Daily marquee는 #daily-list/#rollover-list 자체(카드 높이에 딱 맞게 감싸 빈 공간이
    // 없음)가 아니라, 실제로 남는 빈 공간이 있는 .top(달력+Daily 스크롤 뷰포트 전체)에
    // 건다 — isItemMarqueeExcludedTarget이 달력·빠른입력·이월 토글 등을 걸러낸다.
    var topEl = document.querySelector('.top');
    if (topEl) wireItemListMarqueeDelegation(topEl);
    var weekGrid = document.querySelector('.week-grid');
    if (weekGrid) {
      weekGrid.addEventListener('click', handleListClick);
      weekGrid.addEventListener('dblclick', handleListDblClick);
      wireItemListMarqueeDelegation(weekGrid);
    }
    var trashList = document.getElementById('trash-list');
    if (trashList) {
      trashList.addEventListener('click', handleTrashListClick);
    }
    document.addEventListener('click', handleDocumentSelectionClear);
    document.addEventListener('keydown', handleGlobalKeydown);
    // 4차 5: 텍스트 선택 floating toolbar — 상세 모달이 열려 있을 때만 의미 있으므로
    // onDescSelectionChange 내부에서 activeDetailDrawer 여부를 매번 확인한다.
    document.addEventListener('selectionchange', onDescSelectionChange);
  }

  // ---------------------------------------------------------------------
  // 제목 인라인 편집 — Daily/Weekly가 같은 item.id를 공유하므로 item.text만 바꾸고
  // renderApp()으로 다시 그리면 두 표현(다일 일정의 여러 날짜 칸 포함) 전부 동기화된다.
  // 취소도 데이터를 건드리지 않고 renderApp()만 다시 호출해 원래 제목을 복원한다.
  // ---------------------------------------------------------------------
  var activeTitleEdit = null; // { itemId, inputEl, originalText }

  function startTitleEdit(itemId, titleEl) {
    var item = findItemById(itemId);
    if (!item || !titleEl) return;
    if (activeTitleEdit) {
      if (activeTitleEdit.itemId === itemId) { activeTitleEdit.inputEl.focus(); return; }
      commitTitleEdit(); // 한 번에 하나만 편집 — 다른 항목을 편집 중이면 먼저 저장한다.
    }
    if (activeTypeMenu) closeTypeMenu(false);
    if (activeMoveMenu) closeMoveDateMenu(false);
    if (activeWeeklyInlineAdd) closeWeeklyInlineAdd(false);
    if (activeDateWheel) closeDateWheelPopup(false);
    if (activeTimeWheel) closeTimeWheelPopup(false);

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'title-edit-input';
    input.value = item.text; // textContent 경로가 아니라 value 프로퍼티라 별도 이스케이프 불필요.
    input.setAttribute('aria-label', '제목 편집');

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    activeTitleEdit = { itemId: itemId, inputEl: input, originalText: item.text };
    input.addEventListener('keydown', onTitleEditKeydown);
    input.addEventListener('blur', onTitleEditBlur);
  }

  // item.text/updatedAt만 바꾼다 — id/type/date/endDate/completed/completionByDate/order/
  // originalDate/migratedFrom은 절대 건드리지 않는다. 공백만 남으면 저장하지 않는다.
  function commitTitleEdit() {
    if (!activeTitleEdit) return;
    var edit = activeTitleEdit;
    activeTitleEdit = null; // blur가 중복으로 다시 들어와도 위 가드에서 즉시 멈추게 먼저 비운다.

    var item = findItemById(edit.itemId);
    var newText = edit.inputEl.value.trim();
    if (item && newText && newText !== item.text) {
      withHistoryTransaction(function () {
        item.text = newText;
        item.updatedAt = Date.now();
      });
      saveItems();
    }
    renderApp(); // 변경이 없었거나 공백뿐이었어도 다시 그리면 원래 제목으로 복원된다.
  }

  function cancelTitleEdit() {
    if (!activeTitleEdit) return;
    activeTitleEdit = null;
    renderApp();
  }

  function onTitleEditKeydown(e) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      commitTitleEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelTitleEdit();
    }
    // 방향키, Ctrl/Cmd+A·C·V·X, 텍스트 선택은 input 기본 동작 그대로 둔다(막지 않음).
  }

  function onTitleEditBlur() {
    // Escape로 이미 취소되며 activeTitleEdit이 비워진 뒤, input이 DOM에서 제거되면서
    // blur가 한 번 더 발생할 수 있다 — 그때는 아무 것도 하지 않는다.
    if (!activeTitleEdit) return;
    // blur는 다른 요소(체크박스 등)의 mousedown 처리 도중 동기적으로 발생한다. 여기서 바로
    // renderApp()으로 DOM을 다시 그리면, 방금 mousedown이 눌린 요소가 mouseup 전에 사라져
    // 브라우저가 click 이벤트 자체를 합성하지 않게 된다(클릭이 조용히 무효화됨). 지금 진행
    // 중인 클릭 사이클이 원래 DOM을 상대로 먼저 끝나도록 한 틱 미뤄서 커밋한다.
    setTimeout(commitTitleEdit, 0);
  }

  // ---------------------------------------------------------------------
  // task 상세 drawer — Daily/Weekly의 task를 일반 클릭하면 화면 오른쪽에 겹쳐 뜬다.
  // 메인 화면 크기는 절대 건드리지 않고, backdrop(전체화면 고정 요소)이 배경의 클릭·
  // 드래그·휠을 물리적으로 가로막아 버리므로(포인터가 backdrop에서 멈춤) 상단/Weekly
  // 스크롤 차단이나 카드 드래그 차단을 위한 별도 로직이 필요 없다 — scrollTop도 아예
  // 건드리지 않으니 "닫으면 그대로 복원"도 저절로 만족된다.
  // ---------------------------------------------------------------------
  var activeDetailDrawer = null; // DOM 참조 묶음(아래 buildDetailDrawerDom 참고), 닫히면 null.

  function ensureSubtasks(item) {
    if (!Array.isArray(item.subtasks)) item.subtasks = [];
    return item.subtasks;
  }

  function nextSubtaskOrder(item) {
    var list = ensureSubtasks(item);
    if (!list.length) return 0;
    return Math.max.apply(null, list.map(function (s) { return s.order; })) + 1;
  }

  function getDetailFocusable() {
    if (!activeDetailDrawer) return [];
    var nodes = activeDetailDrawer.drawerEl.querySelectorAll('button,input,textarea,[tabindex],[contenteditable="true"]');
    return Array.prototype.filter.call(nodes, function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
  }

  // 12: Escape/Tab을 캡처 단계에서 가로챈다 — 팝업(날짜 이동 등)이 열려 있으면 그쪽 자신의
  // 캡처 리스너가 처리하도록 양보하고, 제목/설명/하위 할 일 입력 안에서는 그 입력 자신의
  // 로컬 Escape(편집 취소)가 먼저 동작하도록 역시 양보한다(전파를 막지 않고 그냥 return).
  // 11: Escape 우선순위 — 1.텍스트 조합·편집 취소/2.slash 메뉴 닫기(둘 다 desc-editor 자신의
  // 위임 keydown이 처리하도록 여기서는 양보) → 3.marquee 취소 → 4.block drag 취소 →
  // 5.블록 선택 해제 → 6.그 외 상세 모달 닫기.
  function onDetailDrawerKeydown(e) {
    if (!activeDetailDrawer) return;
    // 우선순위 3.
    if (detailMarqueeSelectionState) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelDetailMarqueeSelection();
      }
      return;
    }
    // 우선순위 4. 하위 할 일은 이제 별도 UI 없이 todo 블록으로 통합됐으므로 같은
    // descriptionBlockDragState로 처리된다.
    if (descriptionBlockDragState) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelActiveDescBlockDrag();
      }
      return;
    }
    // 5A 2: 표 행·열 드래그도 같은 우선순위(진행 중인 드래그부터 취소).
    if (descTableDragState) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        abortDescTableDrag();
      }
      return;
    }
    // 7A 5: 셀/행/열 drag 범위 선택도 같은 우선순위.
    if (descTableRangeSelectState) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        abortDescTableRangeSelect();
      }
      return;
    }
    // 7A 7/8: resize drag도 같은 우선순위.
    if (descTableResizeState) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        abortDescTableResize();
      }
      return;
    }
    // 5B 10: gallery 내부 순서 drag도 같은 우선순위.
    if (descMediaGalleryDragState) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        abortDescMediaGalleryDrag();
      }
      return;
    }
    // 7A 10: 표 우클릭 contextual menu(또는 거기서 연 색상 패널)가 열려 있으면 포커스
    // 위치와 무관하게 Escape가 최우선으로 그것부터 닫는다(선택은 그대로 둔다).
    if (descFloatingToolbarState && (descFloatingToolbarState.blockId === '__table_context_menu__' || descFloatingToolbarState.blockId === '__table_color__')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeDescFloatingToolbar();
      }
      return;
    }
    // 진단(수동 편집 이력 검토): activeDetailTimeMenu/activeDetailItemTimeWheel(상세 패널
    // 시간 수정 팝업·시간 휠)이 이 목록에 빠져 있었다 — 시간 휠에서 시/오전오후 항목을
    // 클릭하면 포커스가 입력칸이 아니라 휠 컬럼(div)으로 옮겨가는데, 그 상태에서 Escape를
    // 누르면 INPUT/TEXTAREA 가드에도 안 걸리고 popupOpen도 false라 아래 Escape 분기가
    // 상세 drawer 전체를 닫아버렸다(재현 확인됨). 두 상태를 popupOpen에 포함해 그 경우
    // Escape가 여기서는 아무 것도 하지 않고 시간 휠/메뉴 자신의 캡처 핸들러
    // (onDetailItemTimeWheelKeydown/onDetailTimeMenuKeydown)에 맡기도록 한다.
    var popupOpen = activeTypeMenu || activeMoveMenu || activeDateWheel || activeTimeWheel ||
      activeDetailTimeMenu || activeDetailItemTimeWheel;
    // 20: 설명 블록 에디터(contenteditable)는 자기 자신의 위임 keydown 핸들러가 Escape/Tab을
    // 직접 처리한다(slash 메뉴 닫기, 들여쓰기 등) — INPUT/TEXTAREA와 마찬가지로 여기서는
    // 양보하고 그냥 return한다.
    var t = e.target;
    var isInDescEditor = !!(t && t.closest && activeDetailDrawer.descriptionEditorEl &&
      activeDetailDrawer.descriptionEditorEl.contains(t) && t !== activeDetailDrawer.descriptionEditorEl);
    var focusInDescText = !!(t && t.closest && (t.closest('.desc-block-text') || t.tagName === 'TD'));

    // 3차: 블록이 선택된 상태에서(텍스트 편집 중이 아닐 때만) Delete/Backspace=일괄 삭제,
    // Tab/Shift+Tab=일괄 indent, Escape=선택 해제(우선순위 5) — 어떤 요소에 포커스가
    // 있든(또는 아무 데도 없든) 선택 상태 자체를 기준으로 판단한다.
    var selSize = state.detailBlockSelection.selectedIds.size;
    if (selSize > 0 && !focusInDescText) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        deleteSelectedDescBlocks();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        indentSelectedDescBlocks(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        clearDetailBlockSelection();
        return;
      }
    }

    if (e.key === 'Escape') {
      if (popupOpen) return;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (isInDescEditor) return;
      e.preventDefault();
      e.stopPropagation();
      closeDetailDrawer(); // 우선순위 6.
      return;
    }
    if (e.key === 'Tab') {
      if (popupOpen) return;
      if (isInDescEditor) return; // Tab은 들여쓰기 — 포커스 트랩 대상에서 제외.
      var focusable = getDetailFocusable();
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // 6/7: todo 블록에 연결할 새 subtask를 만든다(구조는 예전 addSubtask와 동일 — id 생성
  // 형식만 그대로 재사용). 블록 배열 조작과 한 트랜잭션으로 묶이도록 history/save/render는
  // 호출하지 않는다 — 호출부(handleDescEnter 등)가 자기 트랜잭션 안에서 함께 커밋한다.
  function createLinkedSubtask(item, text) {
    var list = ensureSubtasks(item);
    var now = Date.now();
    var subtask = {
      id: 'st_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      text: text || '', completed: false, createdAt: now, updatedAt: now, order: nextSubtaskOrder(item)
    };
    list.push(subtask);
    return subtask;
  }

  function removeSubtaskById(item, subtaskId) {
    var list = ensureSubtasks(item);
    var idx = list.findIndex(function (s) { return s.id === subtaskId; });
    if (idx !== -1) list.splice(idx, 1);
  }

  function getDescTodoSubtask(item, block) {
    if (!block || block.type !== 'todo' || !block.subtaskId) return null;
    return ensureSubtasks(item).find(function (s) { return s.id === block.subtaskId; }) || null;
  }

  // 7: todo 블록의 "글자"는 자기 자신이 아니라 연결된 subtask.text다 — 구조 변경 함수들이
  // 매번 분기하지 않도록 읽기/쓰기를 한 곳으로 모은다.
  function getDescBlockDisplayText(item, block) {
    if (block.type === 'todo') {
      var st = getDescTodoSubtask(item, block);
      return st ? st.text : '';
    }
    return block.text || '';
  }

  function setDescBlockDisplayText(item, block, text) {
    if (block.type === 'todo') {
      var st = getDescTodoSubtask(item, block);
      if (st) { st.text = text; st.updatedAt = Date.now(); }
    } else {
      block.text = text;
    }
    // 4차: 구조적으로(타이핑이 아니라 코드가) 텍스트를 다시 쓰는 지점이므로, 예전 서식
    // 경계와 더 이상 맞지 않는 richTextHTML은 무효화한다(plain text가 새 기준이 된다).
    block.richTextHTML = null;
    block.updatedAt = Date.now();
  }

  function toggleSubtaskCompleted(itemId, subtaskId) {
    var item = findItemById(itemId);
    var st = item && ensureSubtasks(item).find(function (s) { return s.id === subtaskId; });
    if (!st) return;
    withHistoryTransaction(function () {
      st.completed = !st.completed;
      st.updatedAt = Date.now();
      item.updatedAt = Date.now(); // 8: 부모 task의 completed 여부는 절대 함께 바꾸지 않는다.
    });
    saveItems();
    renderApp();
  }


  // ---------------------------------------------------------------------
  // 20: 설명 블록 에디터 — 상세 drawer의 '설명' textarea 하나를 노션과 비슷한 블록
  // 목록으로 바꾼다. 블록은 flat array(item.descriptionBlocks)로 유지하고 indent 값으로
  // 계층(토글의 자식)을 표현한다. 실제 텍스트 편집은 이 배열의 각 항목을 하나의
  // contenteditable 요소로 그려 브라우저 네이티브 입력을 그대로 쓰고, 구조 변경
  // (블록 생성·삭제·이동·타입 변경·들여쓰기)만 우리가 직접 배열을 조작한다.
  // ---------------------------------------------------------------------
  var DESC_BLOCK_TEXT_TYPES = ['paragraph', 'heading1', 'heading2', 'heading3', 'bulleted', 'numbered', 'toggle', 'quote', 'code', 'todo'];
  var DESC_BLOCK_INDENTABLE_TYPES = DESC_BLOCK_TEXT_TYPES; // divider/attachment/table은 Tab 들여쓰기 제외.
  var DESC_MAX_INDENT = 3;
  // 2/3: indent(0~3)에 따라 글머리 기호·번호 형식을 바꾼다. 4단계를 순환한다.
  var DESC_BULLET_MARKERS = ['•', '◦', '▪', '◇'];

  var DESC_SLASH_COMMANDS = [
    { type: 'paragraph', label: '텍스트', kw: 'text paragraph 텍스트', desc: '일반 문단을 입력합니다.' },
    { type: 'heading1', label: 'H1 대제목', kw: 'h1 heading 제목', desc: '가장 큰 제목입니다.' },
    { type: 'heading2', label: 'H2 중제목', kw: 'h2 heading 제목', desc: '중간 크기 제목입니다.' },
    { type: 'heading3', label: 'H3 소제목', kw: 'h3 heading 제목', desc: '작은 크기 제목입니다.' },
    { type: 'bulleted', label: '글머리 기호', kw: 'bullet list 목록', desc: '들여쓰기 단계별로 기호가 바뀌는 목록입니다.' },
    { type: 'numbered', label: '번호 기호', kw: 'number list 목록', desc: '들여쓰기 단계별로 번호 형식이 바뀌는 목록입니다.' },
    { type: 'todo', label: '할 일 목록', kw: 'todo 할일 체크 completed check', desc: '완료 여부를 체크할 수 있는 항목을 만듭니다.' },
    { type: 'toggle', label: '토글 목록', kw: 'toggle 토글', desc: '클릭해 자식 블록을 접고 펼칩니다.' },
    { type: 'quote', label: '인용', kw: 'quote 인용', desc: '왼쪽 세로선이 있는 인용문입니다.' },
    { type: 'divider', label: '구분선', kw: 'divider 구분', desc: '얇은 가로 구분선을 삽입합니다.' },
    { type: 'attachment', label: '첨부', kw: 'attachment file 첨부 파일', desc: '파일을 선택해 첨부합니다.' },
    { type: 'table', label: '표', kw: 'table 표', desc: '기본 2×2 표를 만듭니다.' },
    { type: 'code', label: '</> 코드', kw: 'code 코드', desc: '고정폭 글꼴의 코드 블록입니다.' }
  ];

  function descBlockUid() {
    return 'db_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function makeDescriptionBlock(type, overrides) {
    var now = Date.now();
    var base = {
      id: descBlockUid(),
      type: type,
      text: '',
      richTextHTML: null,
      indent: 0,
      checked: false,
      collapsed: false,
      language: null,
      tableData: null,
      attachmentId: null,
      attachmentName: null,
      attachmentSize: null,
      attachmentType: null,
      createdAt: now,
      updatedAt: now
    };
    if (type === 'table') base.tableData = [[makeDescTableCell(), makeDescTableCell()], [makeDescTableCell(), makeDescTableCell()]];
    return Object.assign(base, overrides || {});
  }

  // ---------------------------------------------------------------------
  // 4차: 블록 안 인라인 서식. raw HTML을 그대로 신뢰하지 않고 whitelist tag/attribute만
  // 남기는 sanitize를 거쳐 block.richTextHTML(한 블록 안에서만 유효)에 저장한다.
  // block.text는 항상 plain text fallback으로 별도 유지한다(검색·카드 요약·구버전 호환).
  // ---------------------------------------------------------------------
  var DESC_RICH_ALLOWED_TAGS = { STRONG: 1, EM: 1, U: 1, S: 1, CODE: 1, A: 1, SPAN: 1, BR: 1 };
  var DESC_RICH_REMOVE_TAGS = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1 };
  var DESC_RICH_ALLOWED_ATTRS = { A: ['href'], SPAN: ['data-text-color', 'data-background-color'] };
  var DESC_RICH_COLOR_KEYS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

  function sanitizeDescRichNode(node) {
    var child = node.firstChild;
    while (child) {
      var next = child.nextSibling;
      if (child.nodeType === 3) { child = next; continue; }
      if (child.nodeType !== 1) { node.removeChild(child); child = next; continue; }
      var tag = child.tagName;
      if (DESC_RICH_REMOVE_TAGS[tag]) { node.removeChild(child); child = next; continue; }
      sanitizeDescRichNode(child); // 자손 먼저 정리.
      if (!DESC_RICH_ALLOWED_TAGS[tag]) {
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        child = next;
        continue;
      }
      var allowedAttrs = DESC_RICH_ALLOWED_ATTRS[tag] || [];
      Array.prototype.slice.call(child.attributes).forEach(function (attr) {
        if (allowedAttrs.indexOf(attr.name) === -1) child.removeAttribute(attr.name);
      });
      if (tag === 'A') {
        var href = child.getAttribute('href') || '';
        if (!/^(https?:|mailto:)/i.test(href)) child.removeAttribute('href');
      }
      if (tag === 'SPAN') {
        var tc = child.getAttribute('data-text-color');
        if (tc && DESC_RICH_COLOR_KEYS.indexOf(tc) === -1) child.removeAttribute('data-text-color');
        var bc = child.getAttribute('data-background-color');
        if (bc && DESC_RICH_COLOR_KEYS.indexOf(bc) === -1) child.removeAttribute('data-background-color');
      }
      child = next;
    }
  }

  function sanitizeDescRichHTML(html) {
    if (!html) return '';
    var container = document.createElement('div');
    container.innerHTML = html;
    sanitizeDescRichNode(container);
    return container.innerHTML;
  }

  function findDescTextNodeAtOffset(el, offset) {
    var remaining = offset;
    var result = null;
    (function walk(n) {
      if (result) return;
      if (n.nodeType === 3) {
        if (remaining <= n.textContent.length) { result = { node: n, offset: Math.max(0, remaining) }; remaining = -1; }
        else remaining -= n.textContent.length;
      } else {
        for (var i = 0; i < n.childNodes.length; i++) { walk(n.childNodes[i]); if (result) return; }
      }
    })(el);
    return result || { node: el, offset: 0 };
  }

  function setDescRangeByOffsets(el, startOffset, endOffset) {
    var sel = window.getSelection();
    if (!sel) return;
    var s = findDescTextNodeAtOffset(el, startOffset);
    var eOff = findDescTextNodeAtOffset(el, endOffset);
    var range = document.createRange();
    range.setStart(s.node, s.offset);
    range.setEnd(eOff.node, eOff.offset);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function findRichAncestorTag(node, tagName, boundaryEl) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== boundaryEl) {
      if (el.tagName === tagName) return el;
      el = el.parentElement;
    }
    return null;
  }

  function unwrapRichElement(el) {
    var parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  }

  function descPlainOffsetOf(blockTextEl, boundaryNode, before) {
    var pre = document.createRange();
    pre.selectNodeContents(blockTextEl);
    if (before) pre.setEndBefore(boundaryNode); else pre.setEndAfter(boundaryNode);
    return pre.toString().length;
  }

  // 굵게/기울임/밑줄/취소선/inline code — 이미 같은 태그로 감싸져 있으면(toggle 판정은
  // range의 commonAncestorContainer 기준 단순화) 그 요소 전체를 unwrap하고, 아니면
  // 선택 영역을 새로 wrap한다. 한 블록(boundary) 안에서만 동작한다.
  function applyDescInlineFormat(blockTextEl, range, tagName) {
    if (!range || range.collapsed) return false;
    var existing = findRichAncestorTag(range.commonAncestorContainer, tagName, blockTextEl);
    if (existing) {
      var existStart = descPlainOffsetOf(blockTextEl, existing, true);
      var existLen = existing.textContent.length;
      unwrapRichElement(existing);
      setDescRangeByOffsets(blockTextEl, existStart, existStart + existLen);
    } else {
      var preRange = range.cloneRange();
      preRange.selectNodeContents(blockTextEl);
      preRange.setEnd(range.startContainer, range.startOffset);
      var startOffset = preRange.toString().length;
      var selectedLength = range.toString().length;
      var frag = range.extractContents();
      var wrapper = document.createElement(tagName);
      wrapper.appendChild(frag);
      range.insertNode(wrapper);
      blockTextEl.normalize();
      setDescRangeByOffsets(blockTextEl, startOffset, startOffset + selectedLength);
    }
    return true;
  }

  function applyDescLinkFormat(blockTextEl, range, href) {
    if (!range || range.collapsed || !href) return false;
    var frag = range.extractContents();
    var a = document.createElement('a');
    a.setAttribute('href', href);
    a.appendChild(frag);
    range.insertNode(a);
    blockTextEl.normalize();
    return true;
  }

  // Range.extractContents()는 선택이 어떤 서식 요소의 텍스트와 정확히 같은 경계로 딱
  // 맞아떨어질 때(예: 요소 전체가 선택된 경우) 그 요소 자체는 fragment에 포함하지 않고
  // 텍스트만 뽑아가 버릴 수 있다(요소는 원본에 빈 채로 남거나, 재삽입 지점이 다시 그
  // 요소 안이 돼 사실상 아무 효과가 없어 보인다) — "서식 제거"·"색 기본값"처럼 기존
  // 요소 자체를 없애야 하는 명령은 extractContents 대신 intersectsNode로 실제
  // 걸쳐 있는 서식 요소를 직접 찾아 다룬다.
  function findDescRichElementsInRange(blockTextEl, range) {
    var all = blockTextEl.querySelectorAll('strong,em,u,s,code,a,span');
    var result = [];
    Array.prototype.forEach.call(all, function (el) {
      if (range.intersectsNode(el)) result.push(el);
    });
    return result;
  }

  function applyDescColorFormat(blockTextEl, range, attrName, colorKey) {
    if (!range || range.collapsed) return false;
    var preRange = range.cloneRange();
    preRange.selectNodeContents(blockTextEl);
    preRange.setEnd(range.startContainer, range.startOffset);
    var startOffset = preRange.toString().length;
    var selectedLength = range.toString().length;
    if (colorKey === 'default') {
      var spans = findDescRichElementsInRange(blockTextEl, range).filter(function (el) { return el.tagName === 'SPAN' && el.hasAttribute(attrName); });
      spans.forEach(function (el) {
        el.removeAttribute(attrName);
        if (!el.attributes.length) unwrapRichElement(el);
      });
    } else {
      var frag = range.extractContents();
      var span = document.createElement('span');
      span.setAttribute(attrName, colorKey);
      span.appendChild(frag);
      range.insertNode(span);
    }
    blockTextEl.normalize();
    setDescRangeByOffsets(blockTextEl, startOffset, startOffset + selectedLength);
    return true;
  }

  // "서식 제거" — 선택 범위와 걸쳐 있는 whitelist 태그를 전부(태그 전체 단위로) unwrap한다.
  function clearDescSelectionFormatting(blockTextEl, range) {
    if (!range || range.collapsed) return false;
    var preRange = range.cloneRange();
    preRange.selectNodeContents(blockTextEl);
    preRange.setEnd(range.startContainer, range.startOffset);
    var startOffset = preRange.toString().length;
    var selectedLength = range.toString().length;
    var targets = findDescRichElementsInRange(blockTextEl, range);
    targets.forEach(function (el) { if (el.isConnected) unwrapRichElement(el); });
    blockTextEl.normalize();
    setDescRangeByOffsets(blockTextEl, startOffset, startOffset + selectedLength);
    return true;
  }

  // ---------------------------------------------------------------------
  // 4차: 텍스트 선택 floating toolbar. 실제 브라우저 선택(Range)이 유일한 근거이므로,
  // selectionchange마다 그 블록 안에서의 선택이면 Range를 clone해 descSavedFormatRange에
  // 저장해 둔다 — toolbar 버튼은 pointerdown에서 preventDefault해 그 선택이 풀리지 않게
  // 막지만, 그래도 클릭 시점엔 저장해 둔 Range로 명시적으로 복원한 뒤 명령을 실행한다.
  // ---------------------------------------------------------------------
  var descSavedFormatRange = null; // { blockId, itemId, textEl, range }
  var descFloatingToolbarState = null; // { el, blockId, colorPanel: 'text'|'bg'|'link'|null }

  function isDescSelectionInsideActiveEditor(sel) {
    if (!activeDetailDrawer || !sel || !sel.rangeCount || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var node = range.commonAncestorContainer;
    var el = node.nodeType === 1 ? node : node.parentElement;
    // 7A 13: 표 셀(td)의 인라인 텍스트 선택도 같은 floating toolbar 대상에 포함한다 —
    // 구조 서식(블록 타입 변경)은 buildDescFloatingToolbarDom이 isTableCell일 때 자체적으로 뺀다.
    var textEl = el && el.closest ? (el.closest('.desc-block-text') || el.closest('td[data-row][data-col]')) : null;
    if (!textEl || !activeDetailDrawer.descriptionEditorEl.contains(textEl)) return null;
    return { textEl: textEl, range: range };
  }

  function onDescSelectionChange() {
    // 링크 URL 입력처럼 toolbar 자신의 진짜 <input>에 포커스가 가 있는 동안은, 그 입력이
    // document Selection을 collapse/치환시켜도 toolbar를 닫거나 저장된 Range를 버리지
    // 않는다 — 그렇지 않으면 URL을 입력하려는 순간 toolbar가 스스로 사라져 버린다.
    if (descFloatingToolbarState && document.activeElement && descFloatingToolbarState.el.contains(document.activeElement)) return;
    // 5A: 표 색상 팔레트는 텍스트 Range 선택과 무관하게 열려 있어야 한다(셀 선택 기반) —
    // selectionchange가 이를 대신 닫아버리지 않게 여기서 건너뛴다(Escape·외부 클릭만 닫음).
    if (descFloatingToolbarState && descFloatingToolbarState.blockId === '__table_color__') return;
    var sel = window.getSelection();
    var hit = isDescSelectionInsideActiveEditor(sel);
    if (!hit) {
      // 5: 다른 블록을 클릭하면(선택이 사라지거나 다른 블록으로 옮겨가면) 저장해 둔 Range는 폐기한다.
      if (descSavedFormatRange && (!sel || !sel.rangeCount || sel.isCollapsed)) descSavedFormatRange = null;
      closeDescFloatingToolbar();
      return;
    }
    descSavedFormatRange = { blockId: hit.textEl.dataset.blockId, itemId: state.activeDetailItemId, textEl: hit.textEl, range: hit.range.cloneRange() };
    openOrUpdateDescFloatingToolbar(hit.textEl, hit.range);
  }

  function closeDescFloatingToolbar() {
    if (!descFloatingToolbarState) return;
    var ft = descFloatingToolbarState;
    descFloatingToolbarState = null;
    document.removeEventListener('pointerdown', onOutsideDescFloatingToolbarPointerDown, true);
    if (ft.el.isConnected) ft.el.remove();
  }

  function onOutsideDescFloatingToolbarPointerDown(e) {
    var ft = descFloatingToolbarState;
    if (!ft) return;
    if (ft.el.contains(e.target)) return;
    closeDescFloatingToolbar();
  }

  function positionDescFloatingToolbar(range) {
    var ft = descFloatingToolbarState;
    if (!ft || !activeDetailDrawer) return;
    var rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) rect = range.getClientRects()[0] || rect;
    var drawerRect = activeDetailDrawer.drawerEl.getBoundingClientRect();
    ft.el.style.left = '0px';
    ft.el.style.top = '0px';
    var tRect = ft.el.getBoundingClientRect();
    var top = rect.top - tRect.height - 8;
    var left = rect.left + (rect.width - tRect.width) / 2;
    var minLeft = drawerRect.left + 4;
    var maxLeft = drawerRect.right - tRect.width - 4;
    if (left > maxLeft) left = maxLeft;
    if (left < minLeft) left = minLeft;
    var minTop = drawerRect.top + 4;
    if (top < minTop) top = rect.bottom + 8; // 위쪽 공간이 없으면 선택 영역 아래로.
    var maxTop = drawerRect.bottom - tRect.height - 4;
    if (top > maxTop) top = maxTop;
    ft.el.style.left = left + 'px';
    ft.el.style.top = top + 'px';
  }

  function removeEmptyDescRichElements(root) {
    Array.prototype.slice.call(root.querySelectorAll('strong,em,u,s,code,a,span')).forEach(function (el) {
      if (!el.textContent) el.remove();
    });
  }

  function runDescFormatCommand(applyFn) {
    var sf = descSavedFormatRange;
    if (!sf || !sf.textEl || !sf.textEl.isConnected) return;
    var item = findItemById(sf.itemId);
    if (!item) return;
    flushDescTextEditSession(); // 진행 중이던 타이핑 세션과 서식 명령의 history를 분리한다.
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(sf.range);
    var range = sel.getRangeAt(0);
    var textEl = sf.textEl;
    var ok = applyFn(textEl, range);
    if (!ok) return;
    // Range.extractContents()는 boundary가 어떤 태그의 텍스트 노드 끝(또는 시작)에 정확히
    // 걸치면, 원본 DOM에 내용이 텅 빈 그 태그의 "껍데기"를 그대로 남겨둘 수 있다(스펙 동작 —
    // 버그 아님). 우리 서식 태그는 항상 텍스트를 담고 있어야 하므로 매 명령 뒤에 청소한다.
    removeEmptyDescRichElements(textEl);
    textEl.normalize();
    var blocks = ensureDescriptionBlocks(item);
    var block = blocks.find(function (b) { return b.id === sf.blockId; });
    if (!block) return;
    withHistoryTransaction(function () {
      if (textEl.tagName === 'TD') {
        // 7A 13: 표 셀은 block.text가 아니라 tableData[r][c]가 콘텐츠의 실제 저장 위치다.
        var cr = Number(textEl.dataset.row), cc = Number(textEl.dataset.col);
        var crow = block.tableData && block.tableData[cr];
        var ccell = crow && crow[cc];
        if (ccell) {
          ccell.text = stripDescZwsp(textEl.textContent);
          ccell.richTextHTML = textEl.querySelector('*') ? sanitizeDescRichHTML(stripDescZwsp(textEl.innerHTML)) : null;
        }
      } else if (block.type === 'todo') {
        var st = getDescTodoSubtask(item, block);
        if (st) { st.text = stripDescZwsp(textEl.textContent); st.updatedAt = Date.now(); }
        block.richTextHTML = textEl.querySelector('*') ? sanitizeDescRichHTML(stripDescZwsp(textEl.innerHTML)) : null;
      } else {
        block.text = stripDescZwsp(textEl.textContent);
        block.richTextHTML = textEl.querySelector('*') ? sanitizeDescRichHTML(stripDescZwsp(textEl.innerHTML)) : null;
      }
      block.updatedAt = Date.now();
      syncDescriptionPlainTextMirror(item);
      item.updatedAt = Date.now();
    });
    saveItems();
    // 6/7: 렌더를 통째로 다시 하지 않아 caret·스크롤이 그대로 유지된다(descForceRebuild 미설정).
    var newSel = window.getSelection();
    if (newSel.rangeCount && !newSel.getRangeAt(0).collapsed) {
      var newRange = newSel.getRangeAt(0);
      descSavedFormatRange = { blockId: sf.blockId, itemId: sf.itemId, textEl: textEl, range: newRange.cloneRange() };
      positionDescFloatingToolbar(newRange);
    } else {
      descSavedFormatRange = null;
      closeDescFloatingToolbar();
    }
  }

  var DESC_FT_COLOR_LABELS = { default: '기본', gray: '회색', brown: '갈색', orange: '주황', yellow: '노랑', green: '초록', blue: '파랑', purple: '보라', pink: '분홍', red: '빨강' };
  var DESC_FT_BLOCKTYPE_OPTIONS = [
    { type: 'paragraph', label: '텍스트' }, { type: 'heading1', label: 'H1' }, { type: 'heading2', label: 'H2' }, { type: 'heading3', label: 'H3' },
    { type: 'bulleted', label: '글머리 기호' }, { type: 'numbered', label: '번호 기호' }, { type: 'toggle', label: '토글' }, { type: 'quote', label: '인용' }, { type: 'todo', label: '할 일' }
  ];

  // 5차: 표 셀 색상도 이 팔레트/스와치 DOM을 그대로 재사용한다(복제 금지) — onPick(key)
  // 콜백만 호출자(텍스트 toolbar vs 표 selection toolbar)에 따라 다르게 넘긴다.
  function buildDescColorPanel(attrName, onPick) {
    var panel = document.createElement('div');
    panel.className = 'desc-ft-color-panel';
    DESC_RICH_COLOR_KEYS.forEach(function (key) {
      var sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'desc-ft-swatch';
      sw.dataset.colorKey = key;
      sw.setAttribute('aria-label', DESC_FT_COLOR_LABELS[key]);
      sw.title = DESC_FT_COLOR_LABELS[key];
      if (key !== 'default') {
        if (attrName === 'data-text-color') sw.style.color = 'var(--desc-color-' + key + ')';
        else sw.style.background = 'var(--desc-color-' + key + ')';
      }
      var swatchDot = document.createElement('span');
      swatchDot.className = 'desc-ft-swatch-dot' + (key === 'default' ? ' is-default' : '');
      if (key !== 'default') swatchDot.style.background = 'var(--desc-color-' + key + ')';
      sw.appendChild(swatchDot);
      sw.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      sw.addEventListener('click', function () { onPick(key); });
      panel.appendChild(sw);
    });
    return panel;
  }

  function buildDescLinkPanel() {
  var panel = document.createElement('div');
  panel.className = 'desc-ft-link-panel';

  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'desc-ft-link-input';
  input.placeholder = 'https://...';

  // 선택한 글자에 이미 링크가 걸려 있다면 기존 주소를 입력칸에 표시한다.
  var saved = descSavedFormatRange;
  if (saved && saved.textEl && saved.range) {
    var links = saved.textEl.querySelectorAll('a[href]');

    for (var i = 0; i < links.length; i++) {
      try {
        if (saved.range.intersectsNode(links[i])) {
          input.value = links[i].getAttribute('href') || '';
          break;
        }
      } catch (err) {
        // 손상된 Range는 무시하고 빈 입력칸으로 둔다.
      }
    }
  }

  var applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'desc-ft-link-apply';
  applyBtn.textContent = '적용';

  function commit() {
    var href = input.value.trim();
    if (!href) return;

    if (!/^(https?:|mailto:)/i.test(href)) {
      href = 'https://' + href;
    }

    // https://가 자동 추가된 경우에도 입력칸에 최종 주소를 남긴다.
    input.value = href;

    runDescFormatCommand(function (textEl, range) {
      return applyDescLinkFormat(textEl, range, href);
    });
  }

  input.addEventListener('pointerdown', function (e) {
    e.stopPropagation();
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeDescFloatingToolbar();
    }
  });

  applyBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
  });

  applyBtn.addEventListener('click', commit);

  panel.appendChild(input);
  panel.appendChild(applyBtn);

  return panel;
}

  function toggleDescFtSubpanel(kind, buildFn) {
    var ft = descFloatingToolbarState;
    if (!ft) return;
    var existing = ft.el.querySelector('.desc-ft-subpanel-wrap');
    var wasOpen = ft.colorPanel === kind;
    if (existing) existing.remove();
    ft.colorPanel = null;
    if (!wasOpen) {
      var wrap = document.createElement('div');
      wrap.className = 'desc-ft-subpanel-wrap';
      wrap.appendChild(buildFn());
      ft.el.appendChild(wrap);
      ft.colorPanel = kind;
    }
    if (descSavedFormatRange) positionDescFloatingToolbar(descSavedFormatRange.range);
  }

  function buildDescFloatingToolbarDom(blockId, isTableCell) {
    var el = document.createElement('div');
    el.className = 'desc-floating-toolbar';
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', '텍스트 서식');

    // 7A 13: 표 셀 안에서는 구조 서식(블록 타입 변환)을 금지한다 — 셀은 항상 표 데이터의
    // 일부라 paragraph/heading/todo 등으로 바뀌면 표 구조 자체가 깨진다. 인라인 서식만 허용.
    if (!isTableCell) {
      var typeSelect = document.createElement('select');
      typeSelect.className = 'desc-ft-blocktype';
      typeSelect.setAttribute('aria-label', '블록 종류 변경');
      DESC_FT_BLOCKTYPE_OPTIONS.forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt.type;
        o.textContent = opt.label;
        typeSelect.appendChild(o);
      });
      typeSelect.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      typeSelect.addEventListener('change', function () {
        var sf = descSavedFormatRange;
        if (!sf) return;
        applyDescSlashCommand(sf.itemId, sf.blockId, typeSelect.value);
        closeDescFloatingToolbar();
      });
      el.appendChild(typeSelect);
    }

    function addBtn(label, title, onClick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'desc-ft-btn';
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      b.addEventListener('click', onClick);
      el.appendChild(b);
      return b;
    }

    addBtn('B', '굵게 (Ctrl+B)', function () {
      runDescFormatCommand(function (textEl, range) { return applyDescInlineFormat(textEl, range, 'STRONG'); });
    }).style.fontWeight = '800';
    addBtn('I', '기울임 (Ctrl+I)', function () {
      runDescFormatCommand(function (textEl, range) { return applyDescInlineFormat(textEl, range, 'EM'); });
    }).style.fontStyle = 'italic';
    addBtn('U', '밑줄 (Ctrl+U)', function () {
      runDescFormatCommand(function (textEl, range) { return applyDescInlineFormat(textEl, range, 'U'); });
    }).style.textDecoration = 'underline';
    addBtn('S', '취소선 (Ctrl+Shift+S)', function () {
      runDescFormatCommand(function (textEl, range) { return applyDescInlineFormat(textEl, range, 'S'); });
    }).style.textDecoration = 'line-through';
    addBtn('</>', '인라인 코드', function () {
      runDescFormatCommand(function (textEl, range) { return applyDescInlineFormat(textEl, range, 'CODE'); });
    });
    addBtn('🔗', '링크', function () { toggleDescFtSubpanel('link', buildDescLinkPanel); });
    addBtn('A', '텍스트색', function () {
      toggleDescFtSubpanel('text', function () {
        return buildDescColorPanel('data-text-color', function (key) {
          runDescFormatCommand(function (textEl, range) { return applyDescColorFormat(textEl, range, 'data-text-color', key); });
        });
      });
    });
    addBtn('▧', '배경색', function () {
      toggleDescFtSubpanel('bg', function () {
        return buildDescColorPanel('data-background-color', function (key) {
          runDescFormatCommand(function (textEl, range) { return applyDescColorFormat(textEl, range, 'data-background-color', key); });
        });
      });
    });
    addBtn('✕서식', '서식 제거', function () {
      runDescFormatCommand(function (textEl, range) { return clearDescSelectionFormatting(textEl, range); });
    });

    return el;
  }

  function openOrUpdateDescFloatingToolbar(textEl, range) {
    if (descFloatingToolbarState && descFloatingToolbarState.blockId === textEl.dataset.blockId) {
      positionDescFloatingToolbar(range);
      return;
    }
    closeDescFloatingToolbar();
    var el = buildDescFloatingToolbarDom(textEl.dataset.blockId, textEl.tagName === 'TD');
    document.body.appendChild(el);
    descFloatingToolbarState = { el: el, blockId: textEl.dataset.blockId, colorPanel: null };
    positionDescFloatingToolbar(range);
    setTimeout(function () {
      document.addEventListener('pointerdown', onOutsideDescFloatingToolbarPointerDown, true);
    }, 0);
  }

  // 5: 이 타입들 중 하나가 배열의 마지막 블록이면(=그 뒤에 아무 것도 없으면) 항상 빈
  // paragraph 하나를 자동으로 붙여, 표·코드·구분선·첨부 바로 아래에 편집 가능한 진입점이
  // 항상 있게 한다(사용자가 그 paragraph를 지워도 다음 접근 때 다시 채워진다 — 완전히
  // 없앨 수는 없다. 이미 마지막이 paragraph면 손대지 않으므로 빈 줄이 계속 쌓이지 않는다).
  var DESC_SPECIAL_TRAILING_TYPES = ['table', 'code', 'divider', 'attachment', 'image', 'video', 'mediaGallery'];

  // ---------------------------------------------------------------------
  // 5A: 표 셀 데이터 모델. 예전엔 셀이 순수 문자열이었다 — 색상을 담을 자리가 없어
  // {text, richTextHTML, textColor, backgroundColor}로 승격한다. 문자열 셀은 읽을 때마다
  // (렌더 시점에) 제자리에서 객체로 감싸 올린다 — 새 레코드를 만드는 게 아니라 같은 셀의
  // 표현 형식만 바꾸는 것이라 반복 실행해도 안전하다(버전 게이트 불필요).
  // ---------------------------------------------------------------------
  function normalizeDescTableCell(cell) {
    if (typeof cell === 'string') return { text: cell, richTextHTML: null, textColor: null, backgroundColor: null };
    if (!cell || typeof cell !== 'object') return { text: '', richTextHTML: null, textColor: null, backgroundColor: null };
    if (typeof cell.text !== 'string') cell.text = '';
    if (cell.richTextHTML === undefined) cell.richTextHTML = null;
    if (cell.textColor === undefined) cell.textColor = null;
    if (cell.backgroundColor === undefined) cell.backgroundColor = null;
    return cell;
  }

  function normalizeDescTableData(block) {
    if (!Array.isArray(block.tableData)) return block.tableData;
    block.tableData = block.tableData.map(function (row) { return row.map(normalizeDescTableCell); });
    return block.tableData;
  }

  function makeDescTableCell() { return { text: '', richTextHTML: null, textColor: null, backgroundColor: null }; }

  // ---------------------------------------------------------------------
  // 7A 16: 열 너비/행 높이. 값이 없거나(구버전 데이터) 실제 행·열 수와 배열 길이가
  // 어긋났을 때만(=행·열이 추가·삭제됐는데 아직 동기화 전) 기본값으로 채운다 — 이미
  // 있는 사용자 지정 값은 절대 덮어쓰지 않는다. mutateDescTable류가 행·열을 넣고 뺄 때
  // 이 배열도 함께 splice하므로 정상 흐름에서는 길이가 어긋날 일이 없고, 이 함수는
  // 방어적 lazy-normalize(구 데이터 호환)로만 동작한다.
  // ---------------------------------------------------------------------
  var DESC_TABLE_DEFAULT_COL_WIDTH = 120;
  var DESC_TABLE_MIN_COL_WIDTH = 48;
  var DESC_TABLE_DEFAULT_ROW_HEIGHT = 36;
  var DESC_TABLE_MIN_ROW_HEIGHT = 26;

  function normalizeDescTableSizing(block) {
    var rows = Array.isArray(block.tableData) ? block.tableData.length : 0;
    var cols = rows && Array.isArray(block.tableData[0]) ? block.tableData[0].length : 0;
    if (!Array.isArray(block.columnWidths) || block.columnWidths.length !== cols) {
      var oldW = Array.isArray(block.columnWidths) ? block.columnWidths : [];
      var newW = [];
      for (var c = 0; c < cols; c++) newW.push(oldW[c] != null ? oldW[c] : DESC_TABLE_DEFAULT_COL_WIDTH);
      block.columnWidths = newW;
    }
    if (!Array.isArray(block.rowHeights) || block.rowHeights.length !== rows) {
      var oldH = Array.isArray(block.rowHeights) ? block.rowHeights : [];
      var newH = [];
      for (var r = 0; r < rows; r++) newH.push(oldH[r] != null ? oldH[r] : DESC_TABLE_DEFAULT_ROW_HEIGHT);
      block.rowHeights = newH;
    }
  }

  function enforceDescTrailingParagraph(blocks) {
    if (!blocks.length) return false;
    var last = blocks[blocks.length - 1];
    if (DESC_SPECIAL_TRAILING_TYPES.indexOf(last.type) !== -1) {
      blocks.push(makeDescriptionBlock('paragraph', {}));
      return true;
    }
    return false;
  }

  // 2: 기존 item.description 문자열을 딱 한 번만 paragraph 블록 하나로 옮긴다. 이미
  // descriptionBlocks 배열이 있으면(빈 배열 포함) 다시는 문자열에서 다시 만들지 않는다 —
  // 그래야 새로고침마다 중복 생성되지 않는다. (레거시 subtask -> todo 마이그레이션은
  // 더 이상 여기서 하지 않는다 — normalizeItemDetailBlocks가 앱 로드 시 딱 한 번만
  // 처리한다. 매 렌더마다 다시 스캔하면 사용자가 지우거나 다른 타입으로 바꾼 todo가
  // "아직 연결 안 된 subtask"처럼 보여 되살아날 수 있기 때문이다.)
  function ensureDescriptionBlocks(item) {
    if (!Array.isArray(item.descriptionBlocks)) {
      if (typeof item.description === 'string' && item.description.trim() !== '') {
        item.descriptionBlocks = [makeDescriptionBlock('paragraph', { text: item.description })];
      } else {
        item.descriptionBlocks = [];
      }
    }
    enforceDescTrailingParagraph(item.descriptionBlocks);
    return item.descriptionBlocks;
  }

  // 1: 앱 로드 시(또는 item 최초 접근 시) 딱 한 번만 실행되는 정규화. 이미
  // detailBlocksMigrationVersion이 있으면 아무 것도 하지 않는다 — orphan subtask가
  // 남아 있어도 여기서만 처리하고, 일반 렌더 경로에서는 절대 자동 복구하지 않는다.
  function normalizeItemDetailBlocks(item) {
    if ((item.detailBlocksMigrationVersion || 0) >= DETAIL_BLOCKS_MIGRATION_VERSION) return false;
    var blocks = ensureDescriptionBlocks(item);
    var subtasks = ensureSubtasks(item);
    if (subtasks.length) {
      var linkedIds = {};
      blocks.forEach(function (b) { if (b.type === 'todo' && b.subtaskId) linkedIds[b.subtaskId] = true; });
      subtasks.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function (s) {
        if (!linkedIds[s.id]) {
          blocks.push(makeDescriptionBlock('todo', { subtaskId: s.id }));
          linkedIds[s.id] = true;
        }
      });
      enforceDescTrailingParagraph(blocks);
    }
    item.detailBlocksMigrationVersion = DETAIL_BLOCKS_MIGRATION_VERSION;
    return true;
  }

  function normalizeAllItemsDetailBlocks(items) {
    var changed = false;
    items.forEach(function (item) {
      if (normalizeItemDetailBlocks(item)) changed = true;
    });
    return changed;
  }

  // 2: 기존 코드 호환용 plain text 미러 — 화면 렌더링의 source of truth는 항상
  // descriptionBlocks이고, item.description은 구조 변경마다 이걸로부터 파생만 시킨다.
  function syncDescriptionPlainTextMirror(item) {
    var blocks = ensureDescriptionBlocks(item);
    item.description = blocks
      .filter(function (b) { return DESC_BLOCK_TEXT_TYPES.indexOf(b.type) !== -1 && b.text; })
      .map(function (b) { return b.text; })
      .join('\n');
  }

  // 11: toggle 다음부터 자기보다 indent가 큰 블록까지가 자식이다(같거나 작은 indent가
  // 나오면 종료). 배열 인덱스 기준 [start, end) 범위를 돌려준다 — 데이터는 절대 지우지
  // 않고, 숨김은 항상 렌더 단계에서만 처리한다.
  function getToggleChildRange(blocks, toggleIndex) {
    var toggle = blocks[toggleIndex];
    var end = toggleIndex + 1;
    while (end < blocks.length && blocks[end].indent > toggle.indent) end++;
    return { start: toggleIndex + 1, end: end };
  }

  function getToggleChildIds(blocks, toggleIndex) {
    var range = getToggleChildRange(blocks, toggleIndex);
    return blocks.slice(range.start, range.end).map(function (b) { return b.id; });
  }

  // 6/11: 접힌 toggle의 자식(및 그 자손)을 화면 목록에서만 제외한다. 번호 매기기는 이
  // 화면에 실제로 보이는 목록을 기준으로 계산한다(숨겨진 항목은 번호에 관여하지 않음).
  // 3: indent 레벨마다 독립된 번호 카운터를 둔다 — 같은 레벨의 연속 numbered는 이어지고
  // (하위 레벨을 다녀와도 부모 레벨은 계속 이어짐), 그 레벨(또는 더 얕은 레벨)에 다른
  // type/블록이 끼어들면 그 레벨과 그보다 깊은 레벨의 카운터만 리셋된다.
  function computeVisibleDescriptionBlocks(blocks) {
    var visible = [];
    var skipIndent = null;
    var counters = [0, 0, 0, 0];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (skipIndent !== null) {
        if (b.indent > skipIndent) continue;
        skipIndent = null;
      }
      var displayNumber = null;
      var lvl = Math.max(0, Math.min(counters.length - 1, b.indent || 0));
      if (b.type === 'numbered') {
        counters[lvl] = counters[lvl] + 1;
        for (var d = lvl + 1; d < counters.length; d++) counters[d] = 0;
        displayNumber = counters[lvl];
      } else {
        for (var d2 = lvl; d2 < counters.length; d2++) counters[d2] = 0;
      }
      visible.push({ block: b, index: i, displayNumber: displayNumber });
      if (b.type === 'toggle' && b.collapsed) skipIndent = b.indent;
    }
    return visible;
  }

  function toDescAlphaLabel(n, upper) {
    var s = '';
    while (n > 0) {
      n--;
      s = String.fromCharCode(97 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return upper ? s.toUpperCase() : s;
  }

  function toDescRomanLabel(n) {
    var vals = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
      [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    var res = '';
    vals.forEach(function (v) { while (n >= v[0]) { res += v[1]; n -= v[0]; } });
    return res;
  }

  // 3: indent 0=1. 2. 3. / 1=a. b. c. / 2=i. ii. iii. / 3=A. B. C.
  function formatDescNumberMarker(n, indent) {
    switch (((indent || 0) % 4 + 4) % 4) {
      case 1: return toDescAlphaLabel(n, false) + '.';
      case 2: return toDescRomanLabel(n) + '.';
      case 3: return toDescAlphaLabel(n, true) + '.';
      default: return n + '.';
    }
  }

  function getEmptyDescPlaceholderBlock() {
    return { id: '__desc_empty__', type: 'paragraph', text: '', indent: 0, checked: false, collapsed: false };
  }

  // ---------------------------------------------------------------------
  // 설명 블록 에디터 런타임 상태. renderDescriptionEditor 자체는 "지금 포커스가 이
  // 에디터 안에 있고, 우리가 직접 재구성을 요청한 게 아니면" 통째로 다시 그리지 않는다
  // (일반 타이핑은 input 리스너가 데이터만 갱신하고 절대 재렌더를 부르지 않으므로 이
  // 가드에 걸릴 일이 없다 — 이 가드가 실제로 막아주는 건 Enter/Tab/Backspace/slash/드래그
  // 처럼 "우리가 renderApp()을 직접 호출하는" 구조 변경이 진행 중인 바로 그 순간이 아니라,
  // 그 이후 우연히 겹칠 수 있는 무관한 재렌더뿐이다). 구조 변경 함수들은 반드시
  // descForceRebuild=true와 state.descriptionEditor(포커스 복원 목표)를 먼저 설정한 뒤
  // saveItems()+renderApp()을 부른다.
  // ---------------------------------------------------------------------
  var lastRenderedDescriptionItemId = null;
  var descForceRebuild = false;
  var descTextEditSession = null; // { itemId, blockId, before } — 700~1000ms 디바운스/blur로 한 덩어리 커밋.
  var descSaveDebounceTimer = null;
  var descHistoryDebounceTimer = null;
  var activeDescSlashMenu = null; // { el, itemId, blockId, query, items, activeIndex }
  var descriptionBlockDragState = null;
  var suppressNextDescEditorClick = false;

  // 실제 드래그(threshold 초과) 뒤에 이어지는 네이티브 'click'은 항상 같은 동기 이벤트
  // 시퀀스(pointerup -> mouseup -> click) 안에서 즉시 발생한다 — setTimeout(0)은 그 뒤에야
  // 실행되므로, 여기서 플래그를 세우고 곧바로 해제를 예약해 두면 "바로 다음 click"만
  // 정확히 억제된다. 이렇게 하지 않으면(플래그를 onDescEditorClick 안에서만 리셋하면)
  // 드래그 직후 desc-editor 밖(.detail-header 등)을 먼저 클릭했을 때 플래그가 그대로
  // 남아 있다가, 한참 뒤 전혀 무관한 다음 클릭(예: 삭제 버튼)을 조용히 삼켜버리는 버그가 된다.
  function suppressNextDescEditorClickOnce() {
    suppressNextDescEditorClick = true;
    setTimeout(function () { suppressNextDescEditorClick = false; }, 0);
  }

  function getDescCaretOffset(el) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return el.textContent.length;
    var range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return el.textContent.length;
    var preRange = range.cloneRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
  }

  function setDescCaretOffset(el, offset) {
    var sel = window.getSelection();
    if (!sel) return;
    var range = document.createRange();
    if (!el.firstChild) {
      range.setStart(el, 0);
    } else {
      var remaining = offset;
      var target = null;
      var targetOffset = 0;
      (function walk(n) {
        if (target) return;
        if (n.nodeType === 3) {
          if (remaining <= n.textContent.length) {
            target = n;
            targetOffset = Math.max(0, remaining);
            remaining = -1;
          } else {
            remaining -= n.textContent.length;
          }
        } else {
          for (var i = 0; i < n.childNodes.length; i++) {
            walk(n.childNodes[i]);
            if (target) return;
          }
        }
      })(el);
      if (target) range.setStart(target, targetOffset);
      else { range.selectNodeContents(el); range.collapse(false); }
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // 줄바꿈 뒤에 아무 것도 없을 때(=방금 넣은 '\n'이 텍스트의 마지막 글자) 캐럿을 그 뒤에
  // 두면, 크롬 계열 브라우저가 "줄바꿈 앞"과 "줄바꿈 뒤(빈 다음 줄)"를 같은 지점으로 보고
  // 다음 타이핑을 줄바꿈 앞(즉 이전 줄 끝)에 이어붙이는 경우가 있다 — 데이터에는 정확한
  // 위치(textNode, length)를 넣어도 실제 타이핑 지점이 어긋난다. 저장되지 않는 눈에 안
  // 보이는 zero-width space를 캐럿을 위한 임시 닻으로 하나 심어 그 앞에 캐럿을 두면
  // 해결된다 — 이 문자는 DESC_ZWSP_RE로 항상 걸러내고 저장/조회 데이터에는 절대 남기지
  // 않는다(재렌더되는 순간 자연히 사라진다).
  var DESC_ZWSP = '​';
  var DESC_ZWSP_RE = /​/g;

  function stripDescZwsp(text) {
    return text.indexOf(DESC_ZWSP) === -1 ? text : text.replace(DESC_ZWSP_RE, '');
  }

  // Shift+Enter/코드 블록 안 줄바꿈 — execCommand('insertText','\n')은 브라우저에 따라
  // 실제 개행 문자 대신 <br>을 넣어 textContent에서 줄바꿈이 통째로 사라지는(두 줄이
  // 붙어버리는) 문제가 있다. Range.insertNode로 텍스트 노드를 직접 쪼개 넣는 방식도
  // 시도했으나, 분할 경계에 빈 텍스트 노드가 남으면서 브라우저가 그다음 타이핑을 엉뚱한
  // (첫 번째) 텍스트 노드에 이어붙이는 경우가 있었다(캐럿의 논리적 위치는 맞는데 실제
  // 입력 지점은 어긋남). textContent를 문자열로 통째로 갈아끼워 텍스트 노드 하나로
  // 정리한 뒤에도, 삽입한 '\n'이 마지막 글자라면 위 주석의 크롬 캐럿 버그가 남아있어
  // zero-width space 닻을 함께 심는다.
  function insertDescLiteralNewline(el) {
    var offset = getDescCaretOffset(el);
    var full = el.textContent;
    var after = full.slice(offset);
    var insertion = (after === '') ? ('\n' + DESC_ZWSP) : '\n';
    el.textContent = full.slice(0, offset) + insertion + after;
    setDescCaretOffset(el, offset + 1);
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }

  function getDescCaretRect(el) {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).startContainer)) {
      var range = sel.getRangeAt(0).cloneRange();
      range.collapse(true);
      var rects = range.getClientRects();
      if (rects.length) return rects[0];
      var rect = range.getBoundingClientRect();
      if (rect && (rect.width || rect.height)) return rect;
    }
    return el.getBoundingClientRect();
  }

  function isDescCaretOnFirstLine(el) {
    var caretRect = getDescCaretRect(el);
    var elRect = el.getBoundingClientRect();
    var lineH = caretRect.height || 16;
    return (caretRect.top - elRect.top) < lineH * 0.6;
  }

  function isDescCaretOnLastLine(el) {
    var caretRect = getDescCaretRect(el);
    var elRect = el.getBoundingClientRect();
    var lineH = caretRect.height || 16;
    return (elRect.bottom - caretRect.bottom) < lineH * 0.6;
  }

  // 7A 6: 표 셀은 rowHeights로 높이가 고정돼(vertical-align:top) 실제 텍스트보다 셀 자체가
  // 훨씬 클 수 있다 — isDescCaretOnFirstLine/LastLine처럼 el 자신의 bounding rect와
  // 비교하면 "마지막 줄"이 항상 false로 나온다(캐럿이 텍스트 쪽에 있어도 셀 바닥은
  // 훨씬 아래이므로). 셀의 실제 텍스트 내용 rect와 비교하는 전용 버전을 쓴다.
  function getDescTableCellContentRect(td) {
    if (!td.textContent) return td.getBoundingClientRect();
    var range = document.createRange();
    range.selectNodeContents(td);
    var rects = range.getClientRects();
    if (!rects.length) return td.getBoundingClientRect();
    var top = Infinity, bottom = -Infinity;
    for (var i = 0; i < rects.length; i++) {
      top = Math.min(top, rects[i].top);
      bottom = Math.max(bottom, rects[i].bottom);
    }
    return { top: top, bottom: bottom };
  }

  function isDescTableCaretOnFirstLine(td) {
    var caretRect = getDescCaretRect(td);
    var contentRect = getDescTableCellContentRect(td);
    var lineH = caretRect.height || 16;
    return (caretRect.top - contentRect.top) < lineH * 0.6;
  }

  function isDescTableCaretOnLastLine(td) {
    var caretRect = getDescCaretRect(td);
    var contentRect = getDescTableCellContentRect(td);
    var lineH = caretRect.height || 16;
    return (contentRect.bottom - caretRect.bottom) < lineH * 0.6;
  }

  // 22: ArrowUp/ArrowDown으로 인접 블록 이동 — 표/구분선/첨부처럼 desc-block-text가
  // 아닌 블록은 건너뛰고, caret을 둘 수 있는 다음 텍스트 블록까지 계속 탐색한다.
  function findAdjacentDescBlockTextEl(blockId, dir) {
    var orderedIds = getVisibleDescBlockIdsInOrder();
    var idx = orderedIds.indexOf(blockId);
    if (idx === -1) return null;
    for (var i = idx + dir; i >= 0 && i < orderedIds.length; i += dir) {
      var wrap = activeDetailDrawer.descriptionEditorEl.querySelector('.desc-block[data-block-id="' + orderedIds[i] + '"]');
      var textEl = wrap && wrap.querySelector('.desc-block-text');
      if (textEl) return textEl;
    }
    return null;
  }

  function formatDescFileSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  // ---------------------------------------------------------------------
  // 5B 3: 파일 유형 판정 — MIME type을 우선 쓰고, MIME이 비어 있는 기존 파일에 한해서만
  // 확장자를 보조 기준으로 쓴다(확장자만으로 새 파일을 판단하지 않는다).
  // ---------------------------------------------------------------------
  var DESC_IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
  var DESC_VIDEO_EXT_RE = /\.(mp4|webm|ogg|mov|m4v)$/i;

  function descEffectiveMediaKind(mimeType, name) {
    var mt = (mimeType || '').toLowerCase();
    if (mt.indexOf('image/') === 0) return 'image';
    if (mt.indexOf('video/') === 0) return 'video';
    if (!mt) {
      if (name && DESC_IMAGE_EXT_RE.test(name)) return 'image';
      if (name && DESC_VIDEO_EXT_RE.test(name)) return 'video';
    }
    return 'other';
  }

  // 어떤 블록이든(image/video/attachment로 저장돼 있든) 실제 렌더 분기는 항상 이 함수로
  // 결정한다 — 기존 attachment 데이터를 대량으로 type 변환하지 않아도 안전하게 이미지/
  // 동영상으로 표시되는 이유(2: 안전한 정규화는 "읽을 때"만 하고 저장 데이터는 안 건드림).
  function descBlockMediaKind(block) {
    if (block.type === 'image') return 'image';
    if (block.type === 'video') return 'video';
    if (block.type === 'attachment') return descEffectiveMediaKind(block.mimeType || block.attachmentType, block.name || block.attachmentName);
    return 'other';
  }

  // 2: 새 스키마(name/mimeType/size)를 우선 읽고, 구 attachment 데이터(attachmentName/
  // attachmentType/attachmentSize)는 손실 없이 fallback으로 읽는다 — 저장 데이터 자체를
  // 대량 변환하지 않는다.
  function getDescMediaMeta(block) {
    return {
      attachmentId: block.attachmentId || null,
      name: block.name || block.attachmentName || '',
      mimeType: block.mimeType || block.attachmentType || '',
      size: block.size != null ? block.size : block.attachmentSize
    };
  }

  function makeDescMediaBlock(type, overrides) {
    var now = Date.now();
    var base = {
      id: descBlockUid(), type: type, indent: 0,
      attachmentId: null, name: '', mimeType: '', size: 0,
      alt: '', caption: '', createdAt: now, updatedAt: now
    };
    return Object.assign(base, overrides || {});
  }

  function makeDescMediaGalleryItem(overrides) {
    return Object.assign({
      id: 'mgi_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      attachmentId: null, name: '', mimeType: '', size: 0, alt: '', caption: ''
    }, overrides || {});
  }

  // ---------------------------------------------------------------------
  // 5B 13: Blob URL 캐시 — attachmentId 하나당 URL을 한 번만 만들고 재사용한다. 상세
  // 모달을 닫을 때 한꺼번에 revoke한다(그 시점엔 관련 DOM도 전부 사라지므로 안전하다).
  // 개별 무효화(revokeDescBlobUrl)는 파일이 실제로 교체될 때만 쓴다.
  // ---------------------------------------------------------------------
  var descBlobUrlCache = {}; // attachmentId -> objectURL
  var descBlobUrlPending = {}; // attachmentId -> Promise<url>

  function ensureDescBlobUrl(attachmentId, onReady, onError) {
    // 캐시 적중 시에도 콜백은 항상 비동기(microtask)로 미룬다 — 호출 시점엔 img/video
    // 요소가 아직 부모에 붙기 전(build 함수가 반환하기 전)이라 isConnected가 false다.
    // 동기로 바로 부르면 캐시 hit일 때만 렌더가 비어버리는(=재사용 시 항상 실패하는) 버그가 된다.
    if (descBlobUrlCache[attachmentId]) { Promise.resolve(descBlobUrlCache[attachmentId]).then(onReady); return; }
    if (!descBlobUrlPending[attachmentId]) {
      descBlobUrlPending[attachmentId] = getDescAttachmentBlob(attachmentId).then(function (blob) {
        delete descBlobUrlPending[attachmentId];
        if (!blob) throw new Error('missing blob');
        var url = URL.createObjectURL(blob);
        descBlobUrlCache[attachmentId] = url;
        return url;
      }, function (err) { delete descBlobUrlPending[attachmentId]; throw err; });
    }
    descBlobUrlPending[attachmentId].then(onReady, onError || function () {});
  }

  function revokeDescBlobUrl(attachmentId) {
    if (descBlobUrlCache[attachmentId]) { URL.revokeObjectURL(descBlobUrlCache[attachmentId]); delete descBlobUrlCache[attachmentId]; }
    delete descBlobUrlPending[attachmentId];
  }

  function revokeAllDescBlobUrls() {
    Object.keys(descBlobUrlCache).forEach(function (id) { URL.revokeObjectURL(descBlobUrlCache[id]); });
    descBlobUrlCache = {};
    descBlobUrlPending = {};
  }

  function buildDescBlockHandle(itemId, blockId) {
    var handle = buildDotHandle('desc-block-drag');
    handle.setAttribute('aria-label', '블록 이동');
    handle.addEventListener('pointerdown', function (e) {
      onDescBlockDragHandlePointerDown(e, itemId, blockId);
    });
    return handle;
  }
function buildDescBlockAddButton(itemId, blockId) {
  var button = document.createElement('button');

  button.type = 'button';
  button.className = 'desc-block-add';
  button.textContent = '+';
  button.setAttribute(
    'aria-label',
    '이 블록 아래에 텍스트 추가. Alt와 함께 클릭하면 위에 추가'
  );
  button.title = '아래에 추가 · Alt+클릭: 위에 추가';

  // 블록 선택 사각형이나 텍스트 포커스가 먼저 작동하지 않게 한다.
  button.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    e.stopPropagation();
  });

  button.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();

    var item = findItemById(itemId);
    if (!item) return;

    var blocks = ensureDescriptionBlocks(item);
    var blockIndex = blocks.findIndex(function (block) {
      return block.id === blockId;
    });

    if (blockIndex === -1) return;

    var currentBlock = blocks[blockIndex];

    // 현재 블록 자체가 이미 빈 문단이면 새 빈 문단을 중복 생성하지 않고
    // 현재 문단에 커서만 둔다.
    if (
      currentBlock.type === 'paragraph' &&
      !getDescBlockDisplayText(item, currentBlock).trim()
    ) {
      state.descriptionEditor = {
        itemId: item.id,
        activeBlockId: currentBlock.id,
        selectionStart: 0
      };

      descForceRebuild = true;
      renderApp();
      return;
    }

    clearDetailBlockSelection();
    clearDescTableSelection();

    if (e.altKey) {
      insertParagraphBeforeBlock(item, blockIndex);
    } else {
      insertParagraphAfterBlock(item, blockIndex);
    }
  });

  return button;
}
  function formatDescFileKind(mimeType, name) {
    if (mimeType) {
      var slash = mimeType.indexOf('/');
      return (slash !== -1 ? mimeType.slice(slash + 1) : mimeType).toUpperCase();
    }
    var m = name && name.match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toUpperCase() : '파일';
  }

  // 6: 이미지·동영상이 아닌 파일은 계속 이 카드 형식을 쓴다 — 크기·간격은 그대로 두고
  // 필드만 새 스키마(name/mimeType/size, 구 데이터는 attachmentName 등으로 fallback)로
  // 읽고 "교체" 버튼만 추가한다.
  function buildDescAttachmentDom(block) {
    var meta = getDescMediaMeta(block);
    var box = document.createElement('div');
    box.className = 'desc-attachment';
    box.dataset.blockId = block.id;
    box.tabIndex = 0;
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', '첨부 파일: ' + (meta.name || ''));

    var icon = document.createElement('span');
    icon.className = 'desc-attachment-icon';
    icon.textContent = '📎';
    icon.setAttribute('aria-hidden', 'true');

    var metaEl = document.createElement('div');
    metaEl.className = 'desc-attachment-meta';
    var name = document.createElement('div');
    name.className = 'desc-attachment-name';
    name.textContent = meta.name || '첨부 파일';
    var size = document.createElement('div');
    size.className = 'desc-attachment-size';
    size.textContent = formatDescFileKind(meta.mimeType, meta.name) + ' · ' + formatDescFileSize(meta.size);
    metaEl.appendChild(name);
    metaEl.appendChild(size);

    var dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'desc-attachment-btn';
    dl.dataset.action = 'desc-media-download';
    dl.dataset.blockId = block.id;
    dl.setAttribute('aria-label', '다운로드');
    dl.textContent = '⤓';

    var replace = document.createElement('button');
    replace.type = 'button';
    replace.className = 'desc-attachment-btn';
    replace.dataset.action = 'desc-media-replace';
    replace.dataset.blockId = block.id;
    replace.setAttribute('aria-label', '파일 교체');
    replace.textContent = '⇄';

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'desc-attachment-btn danger';
    del.dataset.action = 'desc-media-delete';
    del.dataset.blockId = block.id;
    del.setAttribute('aria-label', '첨부 삭제');
    del.textContent = '×';

    box.appendChild(icon);
    box.appendChild(metaEl);
    box.appendChild(dl);
    box.appendChild(replace);
    box.appendChild(del);

    if (block._error) {
      var err = document.createElement('div');
      err.className = 'desc-attachment-error';
      err.textContent = block._error;
      var outer = document.createElement('div');
      outer.appendChild(box);
      outer.appendChild(err);
      outer.style.flex = '1 1 auto';
      outer.style.minWidth = '0';
      return outer;
    }
    return box;
  }

  // ---------------------------------------------------------------------
  // 5A 3: 표 셀/범위/행/열 선택. 화면 표시용 임시 상태(state.descTableSelection)만 다루고
  // localStorage에는 저장하지 않는다. cells는 항상 "r,c" 문자열 Set으로 표현해 셀 단위
  // 선택·행 선택·열 선택·비연속(Ctrl) 선택을 같은 자료구조 하나로 통일한다.
  // ---------------------------------------------------------------------
  function descTableCellKey(r, c) { return r + ',' + c; }

  function clearDescTableSelection() {
    if (!state.descTableSelection) return;
    var blockId = state.descTableSelection.blockId;
    state.descTableSelection = null;
    syncDescTableSelectionClasses(blockId);
  }

  function syncDescTableSelectionClasses(blockId) {
    if (!activeDetailDrawer || !blockId) return;
    var wrap = activeDetailDrawer.descriptionEditorEl.querySelector('.desc-table-wrap[data-block-id="' + blockId + '"]');
    if (!wrap) return;
    var sel = state.descTableSelection && state.descTableSelection.blockId === blockId ? state.descTableSelection : null;
    wrap.classList.toggle('has-selection', !!(sel && sel.cells.size));
    Array.prototype.forEach.call(wrap.querySelectorAll('td[data-row]'), function (td) {
      var r = Number(td.dataset.row), c = Number(td.dataset.col);
      var key = descTableCellKey(r, c);
      td.classList.toggle('is-selected', !!(sel && sel.cells.has(key)));
      // 7A 12: anchor 셀은 조금 더 진한 outline으로 구분되는 "활성" 셀이다.
      td.classList.toggle('is-active-cell', !!(sel && sel.anchorR === r && sel.anchorC === c));
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('.desc-table-rowhandle'), function (h) {
      h.classList.toggle('is-selected', !!(sel && sel.mode === 'row' && sel.cells.has(descTableCellKey(Number(h.dataset.rowHandle), 0))));
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('.desc-table-colhandle'), function (h) {
      h.classList.toggle('is-selected', !!(sel && sel.mode === 'col' && sel.cells.has(descTableCellKey(0, Number(h.dataset.colHandle)))));
    });
  }

  function computeDescTableRectCells(r1, c1, r2, c2) {
    var cells = [];
    var rMin = Math.min(r1, r2), rMax = Math.max(r1, r2), cMin = Math.min(c1, c2), cMax = Math.max(c1, c2);
    for (var r = rMin; r <= rMax; r++) for (var c = cMin; c <= cMax; c++) cells.push(descTableCellKey(r, c));
    return cells;
  }

  function applyDescTableSelection(blockId, mode, anchorR, anchorC, cellKeys, additive) {
    var prev = state.descTableSelection;
    var set = (additive && prev && prev.blockId === blockId) ? new Set(prev.cells) : new Set();
    cellKeys.forEach(function (k) { set.add(k); });
    var prevBlockId = prev && prev.blockId !== blockId ? prev.blockId : null;
    state.descTableSelection = { blockId: blockId, mode: mode, anchorR: anchorR, anchorC: anchorC, cells: set };
    if (prevBlockId) syncDescTableSelectionClasses(prevBlockId); // 다른 표로 옮기면 이전 표의 표시를 지운다.
    syncDescTableSelectionClasses(blockId);
  }

  function handleDescTableCellClick(e, td) {
    var blockId = td.dataset.blockId;
    var r = Number(td.dataset.row), c = Number(td.dataset.col);
    var sel = state.descTableSelection;
    var additive = e.ctrlKey || e.metaKey;
    if (e.shiftKey && sel && sel.blockId === blockId && sel.anchorR != null && sel.anchorC != null) {
      applyDescTableSelection(blockId, 'cell', sel.anchorR, sel.anchorC, computeDescTableRectCells(sel.anchorR, sel.anchorC, r, c), additive && sel.mode === 'cell');
      return;
    }
    if (additive && sel && sel.blockId === blockId && sel.mode === 'cell') {
      var key = descTableCellKey(r, c);
      var set = new Set(sel.cells);
      if (set.has(key)) set.delete(key); else set.add(key);
      state.descTableSelection = { blockId: blockId, mode: 'cell', anchorR: r, anchorC: c, cells: set };
      syncDescTableSelectionClasses(blockId);
      return;
    }
    applyDescTableSelection(blockId, 'cell', r, c, [descTableCellKey(r, c)], false);
  }

  function getDescTableColCount(block) {
    return block.tableData && block.tableData[0] ? block.tableData[0].length : 1;
  }

  // ---------------------------------------------------------------------
  // 7A 5: 셀 pointerdown-drag 직사각형 범위 선택. 같은 엔진을 axis 파라미터로 공용화해
  // 행/열 handle의 "grip 아닌 부분" drag에도 재사용한다(row/col 다중 drag 선택).
  // 텍스트 위에서 시작한 drag는 절대 가로채지 않는다 — pointerdown 시점에 클릭 좌표가
  // 실제 텍스트 렌더 사각형 안인지 확인해 두고, 그 경우 이 엔진 자체를 비활성화한다.
  // ---------------------------------------------------------------------
  var descTableRangeSelectState = null;

  function isPointOnDescTableCellText(td, x, y) {
    if (!td.textContent) return false;
    var range = document.createRange();
    range.selectNodeContents(td);
    var rects = range.getClientRects();
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  }

  function onDescTableCellRangeSelectPointerDown(e, axis, blockId, r, c) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (descTableRangeSelectState || descTableDragState) return;
    var startedOnText = false;
    if (axis === 'cell') {
      var td = e.target.closest && e.target.closest('td[data-row][data-col]');
      if (td) startedOnText = isPointOnDescTableCellText(td, e.clientX, e.clientY);
    }
    var prevSel = state.descTableSelection;
    descTableRangeSelectState = {
      blockId: blockId, axis: axis, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY, startR: r, startC: c,
      pending: true, active: false, startedOnText: startedOnText,
      additive: e.ctrlKey || e.metaKey,
      initialSelection: (prevSel && prevSel.blockId === blockId) ? { mode: prevSel.mode, anchorR: prevSel.anchorR, anchorC: prevSel.anchorC, cells: new Set(prevSel.cells) } : null
    };
    document.addEventListener('pointermove', onDescTableRangeSelectPointerMove);
    document.addEventListener('pointerup', onDescTableRangeSelectPointerUp);
    document.addEventListener('pointercancel', onDescTableRangeSelectPointerCancel);
  }

  function findDescTableCellAtPoint(blockId, x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el || !el.closest) return null;
    var td = el.closest('td[data-row][data-col]');
    if (td && td.dataset.blockId === blockId) return { r: Number(td.dataset.row), c: Number(td.dataset.col) };
    var rowHandle = el.closest('.desc-table-rowhandle');
    if (rowHandle && rowHandle.dataset.blockId === blockId) return { r: Number(rowHandle.dataset.rowHandle), c: null };
    var colHandle = el.closest('.desc-table-colhandle');
    if (colHandle && colHandle.dataset.blockId === blockId) return { r: null, c: Number(colHandle.dataset.colHandle) };
    return null;
  }

  function updateDescTableRangeSelectLive(rs, hitR, hitC) {
    var item = findItemById(state.activeDetailItemId);
    var block = item && ensureDescriptionBlocks(item).find(function (b) { return b.id === rs.blockId; });
    if (!block || !Array.isArray(block.tableData)) return;
    var rowCount = block.tableData.length;
    var colCount = getDescTableColCount(block);
    var cells = [];
    var mode;
    if (rs.axis === 'cell') {
      if (hitR == null || hitC == null) return;
      mode = 'cell';
      cells = computeDescTableRectCells(rs.startR, rs.startC, hitR, hitC);
    } else if (rs.axis === 'row') {
      mode = 'row';
      var curR = hitR != null ? hitR : rs.startR;
      var rMin = Math.min(rs.startR, curR), rMax = Math.max(rs.startR, curR);
      for (var r = rMin; r <= rMax; r++) for (var c = 0; c < colCount; c++) cells.push(descTableCellKey(r, c));
    } else {
      mode = 'col';
      var curC = hitC != null ? hitC : rs.startC;
      var cMin = Math.min(rs.startC, curC), cMax = Math.max(rs.startC, curC);
      for (var cc = cMin; cc <= cMax; cc++) for (var rr = 0; rr < rowCount; rr++) cells.push(descTableCellKey(rr, cc));
    }
    var set = (rs.additive && rs.initialSelection) ? new Set(rs.initialSelection.cells) : new Set();
    cells.forEach(function (k) { set.add(k); });
    state.descTableSelection = { blockId: rs.blockId, mode: mode, anchorR: rs.startR, anchorC: rs.startC, cells: set };
    syncDescTableSelectionClasses(rs.blockId);
  }

  function onDescTableRangeSelectPointerMove(e) {
    var rs = descTableRangeSelectState;
    if (!rs || e.pointerId !== rs.pointerId) return;
    if (rs.pending) {
      var dx = e.clientX - rs.startX, dy = e.clientY - rs.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (rs.startedOnText) {
        teardownDescTableRangeSelectListeners();
        descTableRangeSelectState = null;
        return;
      }
      rs.pending = false;
      rs.active = true;
      var nativeSel = window.getSelection();
      if (nativeSel) nativeSel.removeAllRanges();
      document.body.classList.add('desc-table-rangeselect-active');
    }
    if (!rs.active) return;
    var hit = findDescTableCellAtPoint(rs.blockId, e.clientX, e.clientY);
    if (!hit) return;
    updateDescTableRangeSelectLive(rs, hit.r, hit.c);
  }

  function teardownDescTableRangeSelectListeners() {
    document.removeEventListener('pointermove', onDescTableRangeSelectPointerMove);
    document.removeEventListener('pointerup', onDescTableRangeSelectPointerUp);
    document.removeEventListener('pointercancel', onDescTableRangeSelectPointerCancel);
  }

  function onDescTableRangeSelectPointerUp(e) {
    var rs = descTableRangeSelectState;
    if (!rs || e.pointerId !== rs.pointerId) return;
    teardownDescTableRangeSelectListeners();
    document.body.classList.remove('desc-table-rangeselect-active');
    descTableRangeSelectState = null;
    if (!rs.active) return;
    suppressNextDescEditorClickOnce();
    // 7A.1 7: handle 위에서 시작한 drag(여러 행/열 연속 선택)가 실제로 움직였을 때만(즉
    // active일 때만, drag 도중엔 표시 안 함) 완료 시점에 딱 한 번 메뉴를 연다. 순수 셀
    // 범위 drag(axis 'cell')는 우클릭으로만 메뉴를 연다(기존 동작 유지).
    if ((rs.axis === 'row' || rs.axis === 'col') && state.descTableSelection &&
      state.descTableSelection.blockId === rs.blockId && state.descTableSelection.cells.size) {
      var wrap = activeDetailDrawer && activeDetailDrawer.descriptionEditorEl.querySelector('.desc-table-wrap[data-block-id="' + rs.blockId + '"]');
      var handleEl = wrap && wrap.querySelector(
        rs.axis === 'row' ? '.desc-table-rowhandle[data-row-handle="' + rs.startR + '"]' : '.desc-table-colhandle[data-col-handle="' + rs.startC + '"]'
      );
if (handleEl) openDescTableHandleMenu(e, state.descTableSelection);    }
  }

  function onDescTableRangeSelectPointerCancel(e) {
    var rs = descTableRangeSelectState;
    if (!rs || e.pointerId !== rs.pointerId) return;
    abortDescTableRangeSelect();
  }

  // ---------------------------------------------------------------------
  // 7A 7/8: 열 너비·행 높이 resize. pointermove 동안은 DOM과 block.columnWidths/
  // rowHeights를 직접 라이브로만 갱신하고(재렌더·save 없음), pointerdown 시점의
  // state.items 스냅샷을 들고 있다가 pointerup에서 딱 한 번 history/save를 확정한다
  // (descTextEditSession과 같은 "수동 스냅샷 브래킷" 패턴 — withHistoryTransaction을
  // 그대로 쓰면 이미 라이브로 바뀐 뒤라 "변경 없음"으로 오판된다).
  // ---------------------------------------------------------------------
  var descTableResizeState = null;

  function updateDescTableColWidthDom(wrap, block, idx, width) {
    var cols = wrap.querySelectorAll('.desc-table colgroup col');
    if (cols[idx]) cols[idx].style.width = width + 'px';
    // 7A.1: 개별 col 폭뿐 아니라 table 전체 width도 같이 고정해야(auto stretch 방지) 실제
    // 렌더 경계가 columnWidths와 일치한다 — 그 뒤 실측 기반 syncDescTableWrapOverlay가
    // handle/resize 위치를 그 실제 경계에 맞춰 다시 그린다(계산이 아니라 측정).
    syncDescTableTotalWidth(wrap, block);
    syncDescTableWrapOverlay(wrap);
  }

  function updateDescTableRowHeightDom(wrap, block, idx, height) {
    var table = wrap.querySelector('.desc-table');
    var rows = table ? table.querySelectorAll(':scope > tr') : [];
    if (rows[idx]) rows[idx].style.height = height + 'px';
    syncDescTableWrapOverlay(wrap);
  }

  function onDescTableColResizePointerDown(e, blockId, boundaryIdx) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (descTableResizeState || descTableDragState || descTableRangeSelectState) return;
    var item = findItemById(state.activeDetailItemId);
    var block = item && ensureDescriptionBlocks(item).find(function (b) { return b.id === blockId; });
    if (!block) return;
    normalizeDescTableSizing(block);
    e.preventDefault();
    descTableResizeState = {
      axis: 'col', blockId: blockId, itemId: state.activeDetailItemId, boundaryIdx: boundaryIdx,
      pointerId: e.pointerId, pending: true, active: false,
      startX: e.clientX, startY: e.clientY, startSize: block.columnWidths[boundaryIdx],
      historyBeforeSnapshot: null
    };
    document.addEventListener('pointermove', onDescTableResizePointerMove);
    document.addEventListener('pointerup', onDescTableResizePointerUp);
    document.addEventListener('pointercancel', onDescTableResizePointerCancel);
  }

  function onDescTableRowResizePointerDown(e, blockId, boundaryIdx) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (descTableResizeState || descTableDragState || descTableRangeSelectState) return;
    var item = findItemById(state.activeDetailItemId);
    var block = item && ensureDescriptionBlocks(item).find(function (b) { return b.id === blockId; });
    if (!block) return;
    normalizeDescTableSizing(block);
    e.preventDefault();
    descTableResizeState = {
      axis: 'row', blockId: blockId, itemId: state.activeDetailItemId, boundaryIdx: boundaryIdx,
      pointerId: e.pointerId, pending: true, active: false,
      startX: e.clientX, startY: e.clientY, startSize: block.rowHeights[boundaryIdx],
      historyBeforeSnapshot: null
    };
    document.addEventListener('pointermove', onDescTableResizePointerMove);
    document.addEventListener('pointerup', onDescTableResizePointerUp);
    document.addEventListener('pointercancel', onDescTableResizePointerCancel);
  }

  function onDescTableResizePointerMove(e) {
    var rs = descTableResizeState;
    if (!rs || e.pointerId !== rs.pointerId) return;
    if (rs.pending) {
      var dx0 = e.clientX - rs.startX, dy0 = e.clientY - rs.startY;
      if (Math.hypot(dx0, dy0) < DRAG_THRESHOLD) return;
      rs.pending = false;
      rs.active = true;
      rs.historyBeforeSnapshot = JSON.stringify(state.items);
      document.body.classList.add(rs.axis === 'col' ? 'desc-table-colresize-active' : 'desc-table-rowresize-active');
    }
    if (!rs.active) return;
    var item = findItemById(rs.itemId);
    var block = item && ensureDescriptionBlocks(item).find(function (b) { return b.id === rs.blockId; });
    var wrap = activeDetailDrawer && activeDetailDrawer.descriptionEditorEl.querySelector('.desc-table-wrap[data-block-id="' + rs.blockId + '"]');
    if (!block || !wrap) return;
    if (rs.axis === 'col') {
      var newW = Math.max(DESC_TABLE_MIN_COL_WIDTH, Math.round(rs.startSize + (e.clientX - rs.startX)));
      block.columnWidths[rs.boundaryIdx] = newW;
      updateDescTableColWidthDom(wrap, block, rs.boundaryIdx, newW);
    } else {
      var newH = Math.max(DESC_TABLE_MIN_ROW_HEIGHT, Math.round(rs.startSize + (e.clientY - rs.startY)));
      block.rowHeights[rs.boundaryIdx] = newH;
      updateDescTableRowHeightDom(wrap, block, rs.boundaryIdx, newH);
    }
  }

  function teardownDescTableResizeListeners() {
    document.removeEventListener('pointermove', onDescTableResizePointerMove);
    document.removeEventListener('pointerup', onDescTableResizePointerUp);
    document.removeEventListener('pointercancel', onDescTableResizePointerCancel);
  }

  function onDescTableResizePointerUp(e) {
    var rs = descTableResizeState;
    if (!rs || e.pointerId !== rs.pointerId) return;
    teardownDescTableResizeListeners();
    document.body.classList.remove('desc-table-colresize-active', 'desc-table-rowresize-active');
    descTableResizeState = null;
    if (!rs.active) return; // 임계값 못 넘긴 순수 클릭 — 경계를 그냥 클릭한 것뿐, 아무 일도 없다.
    var afterSnapshot = JSON.stringify(state.items);
    if (afterSnapshot !== rs.historyBeforeSnapshot) {
      history.undoStack.push({ before: rs.historyBeforeSnapshot, after: afterSnapshot });
      if (history.undoStack.length > history.limit) history.undoStack.shift();
      history.redoStack = [];
    }
    var item = findItemById(rs.itemId);
    var block = item && ensureDescriptionBlocks(item).find(function (b) { return b.id === rs.blockId; });
    if (block) { block.updatedAt = Date.now(); if (item) item.updatedAt = Date.now(); }
    saveItems();
  }

  function onDescTableResizePointerCancel(e) {
    var rs = descTableResizeState;
    if (!rs || e.pointerId !== rs.pointerId) return;
    abortDescTableResize();
  }

  function abortDescTableResize() {
    var rs = descTableResizeState;
    if (!rs) return;
    teardownDescTableResizeListeners();
    document.body.classList.remove('desc-table-colresize-active', 'desc-table-rowresize-active');
    descTableResizeState = null;
    if (!rs.active) return;
    var item = findItemById(rs.itemId);
    var block = item && ensureDescriptionBlocks(item).find(function (b) { return b.id === rs.blockId; });
    var wrap = activeDetailDrawer && activeDetailDrawer.descriptionEditorEl.querySelector('.desc-table-wrap[data-block-id="' + rs.blockId + '"]');
    if (!block || !wrap) return;
    if (rs.axis === 'col') {
      block.columnWidths[rs.boundaryIdx] = rs.startSize;
      updateDescTableColWidthDom(wrap, block, rs.boundaryIdx, rs.startSize);
    } else {
      block.rowHeights[rs.boundaryIdx] = rs.startSize;
      updateDescTableRowHeightDom(wrap, block, rs.boundaryIdx, rs.startSize);
    }
  }

  function abortDescTableRangeSelect() {
    var rs = descTableRangeSelectState;
    if (!rs) return;
    teardownDescTableRangeSelectListeners();
    document.body.classList.remove('desc-table-rangeselect-active');
    if (rs.active) {
      state.descTableSelection = rs.initialSelection ? { blockId: rs.blockId, mode: rs.initialSelection.mode, anchorR: rs.initialSelection.anchorR, anchorC: rs.initialSelection.anchorC, cells: new Set(rs.initialSelection.cells) } : null;
      syncDescTableSelectionClasses(rs.blockId);
    }
    descTableRangeSelectState = null;
  }

  function handleDescTableRowHandleClick(e, blockId, r) {
    var item = findItemById(state.activeDetailItemId);
    var block = item && ensureDescriptionBlocks(item).find(function (b) { return b.id === blockId; });
    if (!block) return;
    var colCount = getDescTableColCount(block);
    var sel = state.descTableSelection;
    var additive = e.ctrlKey || e.metaKey;
    var rows = [r];
    if (e.shiftKey && sel && sel.blockId === blockId && sel.mode === 'row' && sel.anchorR != null) {
      var rMin = Math.min(sel.anchorR, r), rMax = Math.max(sel.anchorR, r);
      rows = [];
      for (var rr = rMin; rr <= rMax; rr++) rows.push(rr);
    }
    // 7A.1 8: Ctrl/Cmd+클릭은 추가뿐 아니라 제거도 가능해야 한다 — 이미 선택된(같은 mode)
    // 행을 Ctrl+클릭하면 그 행만 선택에서 뺀다. Shift 범위 클릭에는 적용하지 않는다.
    if (additive && !e.shiftKey && sel && sel.blockId === blockId && sel.mode === 'row' && sel.cells.has(descTableCellKey(r, 0))) {
      var removeSet = new Set(sel.cells);
      for (var rc = 0; rc < colCount; rc++) removeSet.delete(descTableCellKey(r, rc));
      if (removeSet.size) {
        state.descTableSelection = { blockId: blockId, mode: 'row', anchorR: r, anchorC: 0, cells: removeSet };
        syncDescTableSelectionClasses(blockId);
      } else {
        clearDescTableSelection();
      }
      return;
    }
    var cells = [];
    rows.forEach(function (rr) { for (var c = 0; c < colCount; c++) cells.push(descTableCellKey(rr, c)); });
    applyDescTableSelection(blockId, 'row', e.shiftKey && sel ? sel.anchorR : r, 0, cells, additive);
  }

  function handleDescTableColHandleClick(e, blockId, c) {
    var item = findItemById(state.activeDetailItemId);
    var block = item && ensureDescriptionBlocks(item).find(function (b) { return b.id === blockId; });
    if (!block) return;
    var rowCount = Array.isArray(block.tableData) ? block.tableData.length : 1;
    var sel = state.descTableSelection;
    var additive = e.ctrlKey || e.metaKey;
    var cols = [c];
    if (e.shiftKey && sel && sel.blockId === blockId && sel.mode === 'col' && sel.anchorC != null) {
      var cMin = Math.min(sel.anchorC, c), cMax = Math.max(sel.anchorC, c);
      cols = [];
      for (var cc = cMin; cc <= cMax; cc++) cols.push(cc);
    }
    // 7A.1 8: 대칭 동작 — 이미 선택된 열을 Ctrl+클릭하면 제거.
    if (additive && !e.shiftKey && sel && sel.blockId === blockId && sel.mode === 'col' && sel.cells.has(descTableCellKey(0, c))) {
      var removeSetC = new Set(sel.cells);
      for (var rr2 = 0; rr2 < rowCount; rr2++) removeSetC.delete(descTableCellKey(rr2, c));
      if (removeSetC.size) {
        state.descTableSelection = { blockId: blockId, mode: 'col', anchorR: 0, anchorC: c, cells: removeSetC };
        syncDescTableSelectionClasses(blockId);
      } else {
        clearDescTableSelection();
      }
      return;
    }
    var cells = [];
    cols.forEach(function (cc) { for (var r = 0; r < rowCount; r++) cells.push(descTableCellKey(r, cc)); });
    applyDescTableSelection(blockId, 'col', 0, e.shiftKey && sel ? sel.anchorC : c, cells, additive);
  }

  // 5A 4: 4차 텍스트 toolbar와 같은 색 팔레트(buildDescColorPanel)를 재사용해 선택된
  // 셀·범위·행·열에 색을 적용한다. 새로 추가된 행·열은 항상 기본색(makeDescTableCell)이라
  // 여기서 기존 색을 복제해 올 일이 없다.
  function applyDescTableColor(attrName, colorKey) {
    var sel = state.descTableSelection;
    if (!sel || !sel.cells.size) return;
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var block = blocks.find(function (b) { return b.id === sel.blockId; });
    if (!block || !Array.isArray(block.tableData)) return;
    flushDescTextEditSession();
    var field = attrName === 'data-text-color' ? 'textColor' : 'backgroundColor';
    withHistoryTransaction(function () {
      normalizeDescTableData(block);
      sel.cells.forEach(function (key) {
        var parts = key.split(',');
        var r = Number(parts[0]), c = Number(parts[1]);
        var row = block.tableData[r];
        var cell = row && row[c];
        if (!cell) return;
        cell[field] = colorKey === 'default' ? null : colorKey;
      });
      block.updatedAt = Date.now();
      item.updatedAt = Date.now();
    });
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  function openDescTableColorPanel(blockId, attrName, anchorEl) {
    // 7A 10: contextual menu의 색상 버튼처럼 anchorEl 자신이 곧 닫힐 팝업(context menu)
    // 소속일 수 있다 — closeDescFloatingToolbar()가 그 팝업을 DOM에서 떼어내기 전에
    // rect를 먼저 읽어 둔다(떼어낸 뒤 읽으면 0,0으로 붕괴한다).
    var rect = anchorEl.getBoundingClientRect();
    closeDescFloatingToolbar();
    var el = document.createElement('div');
    el.className = 'desc-floating-toolbar desc-table-color-toolbar';
    el.appendChild(buildDescColorPanel(attrName, function (key) {
      applyDescTableColor(attrName, key);
      closeDescFloatingToolbar();
    }));
    document.body.appendChild(el);
    descFloatingToolbarState = { el: el, blockId: '__table_color__', colorPanel: null };
   var drawerRect = activeDetailDrawer.drawerEl.getBoundingClientRect();

el.style.left = '0px';
el.style.top = '0px';

var tRect = el.getBoundingClientRect();

var left = Math.min(
  Math.max(rect.left, drawerRect.left + 4),
  drawerRect.right - tRect.width - 4
);

var top = rect.top - tRect.height - 6;

if (top < drawerRect.top + 4) {
  top = rect.bottom + 6;
}

el.style.left = left + 'px';
el.style.top = top + 'px';
    setTimeout(function () { document.addEventListener('pointerdown', onOutsideDescFloatingToolbarPointerDown, true); }, 0);
  }

  // ---------------------------------------------------------------------
  // 7A 10: 행/열/범위 선택 우클릭 contextual menu. 삽입·복제·삭제는 기존 위치 기반
  // 헬퍼(insertDescTableRowAt 등, mutateDescTable과 동일한 함수)를, 색상은
  // openDescTableColorPanel/applyDescTableColor를 그대로 재사용한다 — 이 메뉴 전용
  // 로직은 "선택된 행·열·셀이 무엇인지 계산"과 "메뉴 배치"뿐이다.
  // ---------------------------------------------------------------------
  function descTableSelectedIndices(sel, axisIdx) {
    var out = new Set();
    sel.cells.forEach(function (key) {
      var parts = key.split(',');
      out.add(Number(parts[axisIdx]));
    });
    return Array.from(out).sort(function (a, b) { return a - b; });
  }

  function closeDescTableContextMenu() {
    if (!descFloatingToolbarState || descFloatingToolbarState.blockId !== '__table_context_menu__') return;
    closeDescFloatingToolbar();
    if (activeDetailDrawer) {
      Array.prototype.forEach.call(
        activeDetailDrawer.descriptionEditorEl.querySelectorAll('.desc-table-rowhandle[aria-expanded="true"],.desc-table-colhandle[aria-expanded="true"]'),
        function (h) { h.setAttribute('aria-expanded', 'false'); }
      );
    }
  }

  // 메뉴 항목(삽입/복제/삭제)은 구조를 바꾸므로 mutateDescTable과 동일한 절차(선택 좌표
  // 정규화 → withHistoryTransaction 1건 → 선택 해제 → 강제 재렌더 → 저장)를 따른다.
  function runDescTableStructuralAction(blockId, fn) {
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var block = blocks.find(function (b) { return b.id === blockId; });
    if (!block || !Array.isArray(block.tableData)) return;
    flushDescTextEditSession();
    withHistoryTransaction(function () {
      normalizeDescTableData(block);
      normalizeDescTableSizing(block);
      fn(block);
      block.updatedAt = Date.now();
      item.updatedAt = Date.now();
    });
    clearDescTableSelection();
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  function openDescTableContextMenu(x, y, sel) {
    closeDescFloatingToolbar();
    var blockId = sel.blockId;
    var el = document.createElement('div');
    el.className = 'desc-floating-toolbar desc-table-context-menu';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', '표 편집 메뉴');

    function addItem(label, onClick, danger) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'desc-table-context-menu-item' + (danger ? ' danger' : '');
      b.textContent = label;
      b.setAttribute('role', 'menuitem');
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); closeDescTableContextMenu(); });
      el.appendChild(b);
      return b;
    }
    function addSep() {
      var s = document.createElement('div');
      s.className = 'desc-table-context-menu-sep';
      el.appendChild(s);
    }

    if (sel.mode === 'row') {
      var rows = descTableSelectedIndices(sel, 0);
      addItem('위에 행 삽입', function () {
        runDescTableStructuralAction(blockId, function (block) { insertDescTableRowAt(block, rows[0]); });
      });
      addItem('아래에 행 삽입', function () {
        runDescTableStructuralAction(blockId, function (block) { insertDescTableRowAt(block, rows[rows.length - 1] + 1); });
      });
      addItem('행 복제', function () {
        runDescTableStructuralAction(blockId, function (block) {
          rows.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { duplicateDescTableRowAt(block, r); });
        });
      });
      addItem('행 삭제', function () {
        runDescTableStructuralAction(blockId, function (block) {
          if (block.tableData.length - rows.length < 1) return;
          rows.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { removeDescTableRowAt(block, r); });
        });
      }, true);
      addSep();
    } else if (sel.mode === 'col') {
      var cols = descTableSelectedIndices(sel, 1);
      addItem('왼쪽에 열 삽입', function () {
        runDescTableStructuralAction(blockId, function (block) { insertDescTableColAt(block, cols[0]); });
      });
      addItem('오른쪽에 열 삽입', function () {
        runDescTableStructuralAction(blockId, function (block) { insertDescTableColAt(block, cols[cols.length - 1] + 1); });
      });
      addItem('열 복제', function () {
        runDescTableStructuralAction(blockId, function (block) {
          cols.slice().sort(function (a, b) { return b - a; }).forEach(function (c) { duplicateDescTableColAt(block, c); });
        });
      });
      addItem('열 삭제', function () {
        runDescTableStructuralAction(blockId, function (block) {
          if (getDescTableColCount(block) - cols.length < 1) return;
          cols.slice().sort(function (a, b) { return b - a; }).forEach(function (c) { removeDescTableColAt(block, c); });
        });
      }, true);
      addSep();
    } else {
      addItem('내용 지우기', function () {
        runDescTableStructuralAction(blockId, function (block) {
          sel.cells.forEach(function (key) {
            var parts = key.split(',');
            var r = Number(parts[0]), c = Number(parts[1]);
            var row = block.tableData[r];
            var cell = row && row[c];
            if (cell) { cell.text = ''; cell.richTextHTML = null; }
          });
        });
      });
      addSep();
    }

    var textBtn = addItem('A 텍스트색', function () { openDescTableColorPanel(blockId, 'data-text-color', textBtn); });
    var bgBtn = addItem('배경색', function () { openDescTableColorPanel(blockId, 'data-background-color', bgBtn); });

    document.body.appendChild(el);
    descFloatingToolbarState = { el: el, blockId: '__table_context_menu__', colorPanel: null };
   var drawerRect = activeDetailDrawer.drawerEl.getBoundingClientRect();

el.style.left = '0px';
el.style.top = '0px';

var tRect = el.getBoundingClientRect();

var cursorGapX = 16;
var cursorGapY = 8;
var edgeGap = 8;

var minLeft = drawerRect.left + edgeGap;
var maxLeft = drawerRect.right - tRect.width - edgeGap;
var minTop = drawerRect.top + edgeGap;
var maxTop = drawerRect.bottom - tRect.height - edgeGap;

// 기본 위치: 마우스 커서의 오른쪽 아래
var left = x + cursorGapX;
var top = y + cursorGapY;

// 오른쪽 공간이 부족한 경우에만 커서 왼쪽으로 전환
if (left > maxLeft) {
  left = x - tRect.width - cursorGapX;
}

// 상세창 밖으로 나가지 않도록 최종 보정
left = Math.max(minLeft, Math.min(left, maxLeft));
top = Math.max(minTop, Math.min(top, maxTop));

el.style.left = left + 'px';
el.style.top = top + 'px';
    setTimeout(function () { document.addEventListener('pointerdown', onOutsideDescFloatingToolbarPointerDown, true); }, 0);
    // 7A.1 10: 메뉴가 어떤 행/열 선택에서 열렸는지 aria-expanded로 표시(키보드 사용자용).
    // closeDescFloatingToolbar()는 DOM만 치우고 aria 상태는 안 건드리므로, 다른 handle로
    // 메뉴가 옮겨갈 때 이전 handle에 남은 aria-expanded=true를 여기서 먼저 전부 지운다.
    if (activeDetailDrawer) {
      Array.prototype.forEach.call(
        activeDetailDrawer.descriptionEditorEl.querySelectorAll('.desc-table-rowhandle[aria-expanded="true"],.desc-table-colhandle[aria-expanded="true"]'),
        function (h) { h.setAttribute('aria-expanded', 'false'); }
      );
    }
    if ((sel.mode === 'row' || sel.mode === 'col') && activeDetailDrawer) {
      var wrapEl = activeDetailDrawer.descriptionEditorEl.querySelector('.desc-table-wrap[data-block-id="' + blockId + '"]');
      if (wrapEl) {
        var idxAxis = sel.mode === 'row' ? 0 : 1;
        var handleSelClass = sel.mode === 'row' ? '.desc-table-rowhandle' : '.desc-table-colhandle';
        var attr = sel.mode === 'row' ? 'data-row-handle' : 'data-col-handle';
        descTableSelectedIndices(sel, idxAxis).forEach(function (idx) {
          var h = wrapEl.querySelector(handleSelClass + '[' + attr + '="' + idx + '"]');
          if (h) h.setAttribute('aria-expanded', 'true');
        });
      }
    }
  }

  // 7A.1 5/6: 행·열 handle 클릭/drag-select 완료 뒤 선택 근처에 메뉴를 직접 띄운다 — 우클릭
  // 경로(onDescTableContextMenuEvent)와 같은 openDescTableContextMenu를 재사용한다(로직 중복 없음).
  function openDescTableHandleMenu(e, sel) {
  if (!e || !sel || !sel.cells.size) return;
if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
  // 행·열 핸들의 위치가 아니라 실제 클릭한 마우스 커서 위치를 사용한다.
  openDescTableContextMenu(
    e.clientX,
    e.clientY,
    sel
  );
}

  function onDescTableContextMenuEvent(e) {
    var td = e.target.closest('td[data-row][data-col]');
    var rowHandle = e.target.closest('.desc-table-rowhandle');
    var colHandle = e.target.closest('.desc-table-colhandle');
    if (!td && !rowHandle && !colHandle) return;
    var wrap = e.target.closest('.desc-table-wrap');
    if (!wrap) return;
    e.preventDefault();
    var blockId = wrap.dataset.blockId;
    var sel = state.descTableSelection;
    // 이미 선택된 상태에서 그 선택 안쪽을 우클릭하면 선택을 바꾸지 않는다(메뉴가 기존
    // 선택을 먼저 해제하지 않아야 한다는 요구사항) — 선택이 없거나 다른 표/영역이면 지금
    // 우클릭한 지점 하나를 새로 선택한다.
    var insideExisting = sel && sel.blockId === blockId && sel.cells.size && (
      (td && sel.cells.has(td.dataset.row + ',' + td.dataset.col)) ||
      (rowHandle && sel.mode === 'row' && sel.cells.has(rowHandle.dataset.rowHandle + ',0')) ||
      (colHandle && sel.mode === 'col' && sel.cells.has('0,' + colHandle.dataset.colHandle))
    );
    if (!insideExisting) {
      var fakeEvent = { shiftKey: false, ctrlKey: false, metaKey: false };
      if (rowHandle) handleDescTableRowHandleClick(fakeEvent, blockId, Number(rowHandle.dataset.rowHandle));
      else if (colHandle) handleDescTableColHandleClick(fakeEvent, blockId, Number(colHandle.dataset.colHandle));
      else if (td) handleDescTableCellClick(fakeEvent, td);
      sel = state.descTableSelection;
    }
    if (!sel || !sel.cells.size) return;
    openDescTableContextMenu(e.clientX, e.clientY, sel);
  }

  // ---------------------------------------------------------------------
  // 5A 2: 행·열 드래그 재정렬. axis('row'|'col') 하나로 두 방향을 공용 처리한다 — 3차
  // 블록 드래그와 같은 5px 임계값·Escape/pointercancel 취소·withHistoryTransaction 패턴을
  // 그대로 따르되, 대상이 table row/column이라 자료구조(배열 splice)가 다르므로 새로 짠다.
  // ---------------------------------------------------------------------
  var descTableDragState = null; // { axis, blockId, itemId, index, pointerId, pending, active, startX, startY, previewEl, overIndex, insertAfter }

  function onDescTableHandlePointerDown(e, axis, blockId, index) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (descTableDragState) return;
    flushDescTextEditSession();
    e.preventDefault();
    descTableDragState = {
      axis: axis, blockId: blockId, itemId: state.activeDetailItemId, index: index,
      pointerId: e.pointerId, pending: true, active: false,
      startX: e.clientX, startY: e.clientY, previewEl: null, overIndex: index, insertAfter: false
    };
    document.addEventListener('pointermove', onDescTableHandlePointerMove);
    document.addEventListener('pointerup', onDescTableHandlePointerUp);
    document.addEventListener('pointercancel', onDescTableHandlePointerCancel);
  }

  function activateDescTableDrag(ds) {
    ds.pending = false;
    ds.active = true;
    document.body.classList.add('desc-table-dnd-active');
    var preview = document.createElement('div');
    preview.className = ds.axis === 'row' ? 'desc-table-row-drag-preview' : 'desc-table-col-drag-preview';
    preview.textContent = ds.axis === 'row' ? (ds.index + 1) + '행 이동' : (ds.index + 1) + '열 이동';
    document.body.appendChild(preview);
    ds.previewEl = preview;
  }

  function getDescTableHandleEls(ds) {
    var wrap = activeDetailDrawer && activeDetailDrawer.descriptionEditorEl.querySelector('.desc-table-wrap[data-block-id="' + ds.blockId + '"]');
    if (!wrap) return [];
    var sel = ds.axis === 'row' ? '.desc-table-rowhandle' : '.desc-table-colhandle';
    return Array.prototype.slice.call(wrap.querySelectorAll(sel));
  }

  function clearDescTableDropIndicator(ds) {
    var wrap = activeDetailDrawer && activeDetailDrawer.descriptionEditorEl.querySelector('.desc-table-wrap[data-block-id="' + ds.blockId + '"]');
    if (!wrap) return;
    var suffix = ds.axis === 'row' ? '-row' : '-col';
    Array.prototype.forEach.call(wrap.querySelectorAll('.is-drop-before' + suffix + ',.is-drop-after' + suffix), function (el) {
      el.classList.remove('is-drop-before' + suffix, 'is-drop-after' + suffix);
    });
  }

  function updateDescTableDropIndicator(ds) {
    clearDescTableDropIndicator(ds);
    var wrap = activeDetailDrawer.descriptionEditorEl.querySelector('.desc-table-wrap[data-block-id="' + ds.blockId + '"]');
    if (!wrap) return;
    var idx = ds.overIndex;
    var suffix = ds.axis === 'row' ? '-row' : '-col';
    var cellSel = ds.axis === 'row' ? 'td[data-row="' + idx + '"]' : 'td[data-col="' + idx + '"]';
    var cls = (ds.insertAfter ? 'is-drop-after' : 'is-drop-before') + suffix;
    wrap.querySelectorAll(cellSel).forEach(function (td) { td.classList.add(cls); });
    var handleSel = ds.axis === 'row' ? '.desc-table-rowhandle[data-row-handle="' + idx + '"]' : '.desc-table-colhandle[data-col-handle="' + idx + '"]';
    var h = wrap.querySelector(handleSel);
    if (h) h.classList.add(cls);
  }

  function computeDescTableOverIndex(ds, clientX, clientY) {
    var handles = getDescTableHandleEls(ds);
    for (var i = 0; i < handles.length; i++) {
      var r = handles[i].getBoundingClientRect();
      var idx = Number(ds.axis === 'row' ? handles[i].dataset.rowHandle : handles[i].dataset.colHandle);
      if (ds.axis === 'row') {
        if (clientY < r.top + r.height / 2) return { index: idx, after: false };
        if (clientY <= r.bottom) return { index: idx, after: true };
      } else {
        if (clientX < r.left + r.width / 2) return { index: idx, after: false };
        if (clientX <= r.right) return { index: idx, after: true };
      }
    }
    var last = handles[handles.length - 1];
    var lastIdx = last ? Number(ds.axis === 'row' ? last.dataset.rowHandle : last.dataset.colHandle) : ds.index;
    return { index: lastIdx, after: true };
  }

  function onDescTableHandlePointerMove(e) {
    var ds = descTableDragState;
    if (!ds || e.pointerId !== ds.pointerId) return;
    if (ds.pending) {
      var dx = e.clientX - ds.startX, dy = e.clientY - ds.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      activateDescTableDrag(ds);
    }
    ds.previewEl.style.left = (e.clientX + 12) + 'px';
    ds.previewEl.style.top = (e.clientY + 12) + 'px';
    var over = computeDescTableOverIndex(ds, e.clientX, e.clientY);
    ds.overIndex = over.index;
    ds.insertAfter = over.after;
    updateDescTableDropIndicator(ds);
  }

  function cleanupDescTableDragDom(ds) {
    document.body.classList.remove('desc-table-dnd-active');
    if (ds.previewEl && ds.previewEl.isConnected) ds.previewEl.remove();
    clearDescTableDropIndicator(ds);
  }

  function teardownDescTableDragListeners() {
    document.removeEventListener('pointermove', onDescTableHandlePointerMove);
    document.removeEventListener('pointerup', onDescTableHandlePointerUp);
    document.removeEventListener('pointercancel', onDescTableHandlePointerCancel);
  }

  function abortDescTableDrag() {
    var ds = descTableDragState;
    if (!ds) return;
    teardownDescTableDragListeners();
    if (ds.active) cleanupDescTableDragDom(ds);
    descTableDragState = null;
  }

  function onDescTableHandlePointerCancel(e) {
    var ds = descTableDragState;
    if (!ds || e.pointerId !== ds.pointerId) return;
    abortDescTableDrag();
  }

  function commitDescTableDrag(ds) {
    var item = findItemById(ds.itemId);
    var blocks = item && ensureDescriptionBlocks(item);
    var block = blocks && blocks.find(function (b) { return b.id === ds.blockId; });
    if (!block || !Array.isArray(block.tableData)) return;
    var fromIndex = ds.index;
    var toIndex = ds.overIndex + (ds.insertAfter ? 1 : 0);
    if (toIndex > fromIndex) toIndex -= 1; // 자기 자신을 먼저 빼고 계산하므로 뒤쪽 목표는 하나 당겨진다.
    if (toIndex === fromIndex) return; // 제자리 drop.
    withHistoryTransaction(function () {
      normalizeDescTableData(block);
      normalizeDescTableSizing(block);
      if (ds.axis === 'row') {
        var row = block.tableData.splice(fromIndex, 1)[0];
        block.tableData.splice(toIndex, 0, row);
        var h = block.rowHeights.splice(fromIndex, 1)[0];
        block.rowHeights.splice(toIndex, 0, h);
      } else {
        block.tableData.forEach(function (rowArr) {
          var cell = rowArr.splice(fromIndex, 1)[0];
          rowArr.splice(toIndex, 0, cell);
        });
        var w = block.columnWidths.splice(fromIndex, 1)[0];
        block.columnWidths.splice(toIndex, 0, w);
      }
      block.updatedAt = Date.now();
      item.updatedAt = Date.now();
    });
    clearDescTableSelection();
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  function onDescTableHandlePointerUp(e) {
    var ds = descTableDragState;
    if (!ds || e.pointerId !== ds.pointerId) return;
    teardownDescTableDragListeners();
    descTableDragState = null;
    if (!ds.active) return; // 임계값 못 넘긴 순수 클릭 — 이미 click 이벤트가 선택을 처리한다.
    // 3차 블록 드래그 핸들과 동일한 이유로, 실제 드래그가 일어난 뒤 이어지는 네이티브
    // click이 방금 옮긴 행/열에 대해 다시 선택 로직을 태우지 않도록 억제한다.
    suppressNextDescEditorClickOnce();
    cleanupDescTableDragDom(ds);
    commitDescTableDrag(ds);
  }

  // 5A 1: 표 가장자리 hover "+" 영역은 기존 desc-table-add-row/-col data-action을 그대로
  // 재사용한다(onDescEditorClick의 핸들러를 복제하지 않음) — 새 셀 칸에 같은 속성만 붙인다.
  function buildDescMediaErrorState(message) {
    var err = document.createElement('div');
    err.className = 'desc-media-error';
    err.textContent = message;
    return err;
  }

  // 4/5/6: 이미지·동영상·일반 파일 카드가 공유하는 다운로드/교체/삭제 버튼 묶음.
  function buildDescMediaActionBar(block) {
    var bar = document.createElement('div');
    bar.className = 'desc-media-actions';
    [['desc-media-download', '⤓', '다운로드', false], ['desc-media-replace', '⇄', '파일 교체', false], ['desc-media-delete', '×', '삭제', true]].forEach(function (spec) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'desc-media-action-btn' + (spec[3] ? ' danger' : '');
      btn.dataset.action = spec[0];
      btn.dataset.blockId = block.id;
      btn.setAttribute('aria-label', spec[2]);
      btn.textContent = spec[1];
      bar.appendChild(btn);
    });
    return bar;
  }

  function buildDescMediaCaptionEl(block, placeholder) {
    var caption = document.createElement('div');
    caption.className = 'desc-media-caption';
    caption.contentEditable = 'true';
    caption.dataset.blockId = block.id;
    caption.dataset.mediaCaption = 'true';
    caption.setAttribute('data-placeholder', placeholder);
    caption.setAttribute('role', 'textbox');
    caption.textContent = block.caption || '';
    return caption;
  }

  // 4: image MIME은 실제 <img>로 렌더한다. Blob 로딩은 비동기(IndexedDB)라 로딩/오류
  // 상태를 함께 관리한다 — 캐시된 URL이 있으면 동기적으로 즉시 채워져 재렌더마다 깜빡이지
  // 않는다.
  function buildDescImageDom(block) {
    var meta = getDescMediaMeta(block);
    var wrap = document.createElement('div');
    wrap.className = 'desc-media-block desc-media-image';
    wrap.dataset.blockId = block.id;

    var imgWrap = document.createElement('div');
    imgWrap.className = 'desc-media-image-wrap is-loading';
    var img = document.createElement('img');
    img.className = 'desc-media-img';
    img.alt = block.alt || meta.name || '';
    img.draggable = false;
    img.loading = 'lazy';
    imgWrap.appendChild(img);
    if (meta.attachmentId) {
      ensureDescBlobUrl(meta.attachmentId, function (url) {
        if (!img.isConnected) return;
        img.src = url;
        imgWrap.classList.remove('is-loading');
      }, function () {
        if (!imgWrap.isConnected) return;
        imgWrap.classList.remove('is-loading');
        imgWrap.classList.add('is-error');
        imgWrap.appendChild(buildDescMediaErrorState('이미지를 불러오지 못했습니다.'));
      });
    } else {
      imgWrap.classList.remove('is-loading');
      imgWrap.classList.add('is-error');
      imgWrap.appendChild(buildDescMediaErrorState('파일을 찾을 수 없습니다.'));
    }
    wrap.appendChild(imgWrap);
    wrap.appendChild(buildDescMediaActionBar(block));
    wrap.appendChild(buildDescMediaCaptionEl(block, '캡션 추가...'));
    return wrap;
  }

  // 5: video MIME은 실제 <video controls>로 렌더한다. autoplay는 속성 자체를 넣지 않아
  // 원천적으로 금지된다.
  function buildDescVideoDom(block) {
    var meta = getDescMediaMeta(block);
    var wrap = document.createElement('div');
    wrap.className = 'desc-media-block desc-media-video';
    wrap.dataset.blockId = block.id;

    var videoWrap = document.createElement('div');
    videoWrap.className = 'desc-media-video-wrap is-loading';
    var video = document.createElement('video');
    video.className = 'desc-media-video-el';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.addEventListener('error', function () {
      videoWrap.classList.remove('is-loading');
      videoWrap.classList.add('is-error');
      videoWrap.appendChild(buildDescMediaErrorState('동영상을 재생할 수 없습니다.'));
    });
    video.addEventListener('loadedmetadata', function () { videoWrap.classList.remove('is-loading'); });
    videoWrap.appendChild(video);
    if (meta.attachmentId) {
      ensureDescBlobUrl(meta.attachmentId, function (url) {
        if (!video.isConnected) return;
        video.src = url;
      }, function () {
        if (!videoWrap.isConnected) return;
        videoWrap.classList.remove('is-loading');
        videoWrap.classList.add('is-error');
        videoWrap.appendChild(buildDescMediaErrorState('동영상을 불러오지 못했습니다.'));
      });
    } else {
      videoWrap.classList.remove('is-loading');
      videoWrap.classList.add('is-error');
      videoWrap.appendChild(buildDescMediaErrorState('파일을 찾을 수 없습니다.'));
    }
    wrap.appendChild(videoWrap);
    wrap.appendChild(buildDescMediaActionBar(block));
    wrap.appendChild(buildDescMediaCaptionEl(block, '캡션 추가...'));
    return wrap;
  }

  // 8: 1개는 renderDescriptionEditor 쪽에서 이미 image/video 단독 블록으로 정규화해 이
  // 함수 자체가 호출되지 않는다(아래 normalizeDescMediaGalleryBlock 참고). 2/3개는 균등
  // 폭 grid, 4개 이상은 내부 가로 스크롤 — 별도 wheel 핸들러를 달지 않아 세로 스크롤을
  // 가로채지 않고, Shift+휠·트랙패드 가로 제스처는 overflow-x:auto의 기본 동작으로 처리된다.
  function buildDescMediaGalleryItemDom(block, item, idx) {
    var kind = descEffectiveMediaKind(item.mimeType, item.name);
    var cell = document.createElement('div');
    cell.className = 'desc-media-gallery-item';
    cell.dataset.blockId = block.id;
    cell.dataset.mediaItemId = item.id;

    var handle = buildDotHandle('desc-media-gallery-handle');
    handle.addEventListener('pointerdown', function (e) { onDescMediaGalleryItemPointerDown(e, block.id, item.id); });
    cell.appendChild(handle);

    var mediaWrap = document.createElement('div');
    mediaWrap.className = 'desc-media-gallery-media is-loading';
    var el;
    if (kind === 'video') {
      el = document.createElement('video');
      el.controls = true;
      el.playsInline = true;
      el.preload = 'metadata';
      el.addEventListener('loadedmetadata', function () { mediaWrap.classList.remove('is-loading'); });
      el.addEventListener('error', function () { mediaWrap.classList.remove('is-loading'); mediaWrap.classList.add('is-error'); mediaWrap.appendChild(buildDescMediaErrorState('재생 불가')); });
    } else {
      el = document.createElement('img');
      el.alt = item.alt || item.name || '';
      el.draggable = false;
      el.loading = 'lazy';
    }
    el.className = 'desc-media-gallery-el';
    mediaWrap.appendChild(el);
    if (item.attachmentId) {
      ensureDescBlobUrl(item.attachmentId, function (url) {
        if (!el.isConnected) return;
        if (kind === 'video') el.src = url; else { el.src = url; mediaWrap.classList.remove('is-loading'); }
      }, function () {
        if (!mediaWrap.isConnected) return;
        mediaWrap.classList.remove('is-loading');
        mediaWrap.classList.add('is-error');
        mediaWrap.appendChild(buildDescMediaErrorState('불러오지 못함'));
      });
    } else {
      mediaWrap.classList.remove('is-loading');
      mediaWrap.classList.add('is-error');
    }
    cell.appendChild(mediaWrap);

    var itemActions = document.createElement('div');
    itemActions.className = 'desc-media-gallery-item-actions';
    var sepBtn = document.createElement('button');
    sepBtn.type = 'button';
    sepBtn.className = 'desc-media-gallery-item-btn';
    sepBtn.dataset.action = 'desc-media-gallery-item-separate';
    sepBtn.dataset.blockId = block.id;
    sepBtn.dataset.mediaItemId = item.id;
    sepBtn.setAttribute('aria-label', '별도 블록으로 분리');
    sepBtn.textContent = '⇱';
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'desc-media-gallery-item-btn danger';
    delBtn.dataset.action = 'desc-media-gallery-item-delete';
    delBtn.dataset.blockId = block.id;
    delBtn.dataset.mediaItemId = item.id;
    delBtn.setAttribute('aria-label', '이 미디어 삭제');
    delBtn.textContent = '×';
    itemActions.appendChild(sepBtn);
    itemActions.appendChild(delBtn);
    cell.appendChild(itemActions);

    return cell;
  }

  function buildDescMediaGalleryDom(block) {
    var wrap = document.createElement('div');
    wrap.className = 'desc-media-gallery';
    wrap.dataset.blockId = block.id;
    var items = Array.isArray(block.items) ? block.items : [];
    var count = items.length;
    wrap.classList.add(count >= 4 ? 'is-scroll' : 'cols-' + Math.max(1, count));
    items.forEach(function (item, idx) { wrap.appendChild(buildDescMediaGalleryItemDom(block, item, idx)); });
    return wrap;
  }

  // 11: gallery 항목이 0/1개로 줄면 불변식을 맞춘다 — 0개는 블록 자체 제거(최소 1
  // paragraph 유지), 1개는 단독 image/video(또는 attachment) 블록으로 자동 정규화한다.
  function normalizeDescMediaGalleryAt(blocks, idx) {
    var block = blocks[idx];
    if (!block || block.type !== 'mediaGallery') return;
    if (block.items.length === 0) {
      blocks.splice(idx, 1);
      if (!blocks.length) blocks.push(makeDescriptionBlock('paragraph', {}));
    } else if (block.items.length === 1) {
      var only = block.items[0];
      var kind = descEffectiveMediaKind(only.mimeType, only.name);
      blocks[idx] = makeDescMediaBlock(kind === 'other' ? 'attachment' : kind, {
        id: block.id, attachmentId: only.attachmentId, name: only.name, mimeType: only.mimeType, size: only.size,
        alt: only.alt || '', caption: only.caption || '', indent: block.indent, createdAt: block.createdAt
      });
    }
  }

  function deleteDescMediaGalleryItem(blockId, mediaItemId) {
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var idx = blocks.findIndex(function (b) { return b.id === blockId; });
    if (idx === -1 || !Array.isArray(blocks[idx].items)) return;
    flushDescTextEditSession();
    var focusBlockId;
    withHistoryTransaction(function () {
      var block = blocks[idx];
      block.items = block.items.filter(function (i) { return i.id !== mediaItemId; });
      block.updatedAt = Date.now();
      normalizeDescMediaGalleryAt(blocks, idx);
      focusBlockId = blocks[Math.min(idx, blocks.length - 1)].id;
      syncDescriptionPlainTextMirror(item);
      item.updatedAt = Date.now();
    });
    state.descriptionEditor = { itemId: item.id, activeBlockId: focusBlockId, selectionStart: null };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  // 11: gallery 안 미디어 하나를 별도 단일 블록으로 꺼낸다 — gallery 바로 뒤에 삽입하고,
  // 남은 gallery는 필요하면(0/1개) 함께 정규화한다.
  function separateDescMediaGalleryItem(blockId, mediaItemId) {
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var idx = blocks.findIndex(function (b) { return b.id === blockId; });
    if (idx === -1 || !Array.isArray(blocks[idx].items)) return;
    var block = blocks[idx];
    var target = block.items.find(function (i) { return i.id === mediaItemId; });
    if (!target) return;
    flushDescTextEditSession();
    var newBlockId;
    withHistoryTransaction(function () {
      block.items = block.items.filter(function (i) { return i.id !== mediaItemId; });
      block.updatedAt = Date.now();
      var kind = descEffectiveMediaKind(target.mimeType, target.name);
      var newBlock = makeDescMediaBlock(kind === 'other' ? 'attachment' : kind, {
        attachmentId: target.attachmentId, name: target.name, mimeType: target.mimeType, size: target.size,
        alt: target.alt || '', caption: target.caption || '', indent: block.indent
      });
      newBlockId = newBlock.id;
      blocks.splice(idx + 1, 0, newBlock);
      normalizeDescMediaGalleryAt(blocks, idx);
      syncDescriptionPlainTextMirror(item);
      item.updatedAt = Date.now();
    });
    state.descriptionEditor = { itemId: item.id, activeBlockId: newBlockId, selectionStart: null };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  // ---------------------------------------------------------------------
  // 10: gallery 내부 순서 drag. 5A 표 행/열 drag와 같은 5px threshold·Escape 취소
  // 패턴이지만 대상이 block.items 배열이라 새로 짠다. 핸들(desc-media-gallery-handle)에서만
  // 시작하므로 video controls·이미지 자체 클릭과 절대 겹치지 않는다.
  // ---------------------------------------------------------------------
  var descMediaGalleryDragState = null;

  function onDescMediaGalleryItemPointerDown(e, galleryBlockId, mediaItemId) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (descMediaGalleryDragState) return;
    flushDescTextEditSession();
    e.preventDefault();
    descMediaGalleryDragState = {
      galleryBlockId: galleryBlockId, itemId: state.activeDetailItemId, mediaItemId: mediaItemId,
      pointerId: e.pointerId, pending: true, active: false,
      startX: e.clientX, startY: e.clientY, previewEl: null, overMediaItemId: mediaItemId, dropPosition: 'before'
    };
    document.addEventListener('pointermove', onDescMediaGalleryItemPointerMove);
    document.addEventListener('pointerup', onDescMediaGalleryItemPointerUp);
    document.addEventListener('pointercancel', onDescMediaGalleryItemPointerCancel);
  }

  function activateDescMediaGalleryDrag(ds) {
    ds.pending = false;
    ds.active = true;
    document.body.classList.add('desc-media-gallery-dnd-active');
    var preview = document.createElement('div');
    preview.className = 'desc-media-gallery-drag-preview';
    preview.textContent = '이동 중';
    document.body.appendChild(preview);
    ds.previewEl = preview;
  }

  function getDescMediaGalleryItemEls(ds) {
    var wrap = activeDetailDrawer && activeDetailDrawer.descriptionEditorEl.querySelector('.desc-media-gallery[data-block-id="' + ds.galleryBlockId + '"]');
    if (!wrap) return [];
    return Array.prototype.slice.call(wrap.querySelectorAll('.desc-media-gallery-item'));
  }

  function clearDescMediaGalleryDropIndicator(ds) {
    getDescMediaGalleryItemEls(ds).forEach(function (el) { el.classList.remove('is-drop-before', 'is-drop-after'); });
  }

  function updateDescMediaGalleryDropIndicator(ds) {
    clearDescMediaGalleryDropIndicator(ds);
    var els = getDescMediaGalleryItemEls(ds);
    var target = els.filter(function (el) { return el.dataset.mediaItemId === ds.overMediaItemId; })[0];
    if (target) target.classList.add(ds.dropPosition === 'after' ? 'is-drop-after' : 'is-drop-before');
  }

  function computeDescMediaGalleryOver(ds, clientX, clientY) {
    var els = getDescMediaGalleryItemEls(ds).filter(function (el) { return el.dataset.mediaItemId !== ds.mediaItemId; });
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return { id: els[i].dataset.mediaItemId, position: clientX < r.left + r.width / 2 ? 'before' : 'after' };
      }
    }
    var closest = null, closestDist = Infinity, closestRect = null;
    els.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var d = Math.hypot(clientX - cx, clientY - cy);
      if (d < closestDist) { closestDist = d; closest = el; closestRect = r; }
    });
    if (!closest) return { id: ds.overMediaItemId, position: ds.dropPosition };
    return { id: closest.dataset.mediaItemId, position: clientX < closestRect.left + closestRect.width / 2 ? 'before' : 'after' };
  }

  function onDescMediaGalleryItemPointerMove(e) {
    var ds = descMediaGalleryDragState;
    if (!ds || e.pointerId !== ds.pointerId) return;
    if (ds.pending) {
      var dx = e.clientX - ds.startX, dy = e.clientY - ds.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      activateDescMediaGalleryDrag(ds);
    }
    ds.previewEl.style.left = (e.clientX + 12) + 'px';
    ds.previewEl.style.top = (e.clientY + 12) + 'px';
    var over = computeDescMediaGalleryOver(ds, e.clientX, e.clientY);
    ds.overMediaItemId = over.id;
    ds.dropPosition = over.position;
    updateDescMediaGalleryDropIndicator(ds);
  }

  function cleanupDescMediaGalleryDragDom(ds) {
    document.body.classList.remove('desc-media-gallery-dnd-active');
    if (ds.previewEl && ds.previewEl.isConnected) ds.previewEl.remove();
    clearDescMediaGalleryDropIndicator(ds);
  }

  function teardownDescMediaGalleryDragListeners() {
    document.removeEventListener('pointermove', onDescMediaGalleryItemPointerMove);
    document.removeEventListener('pointerup', onDescMediaGalleryItemPointerUp);
    document.removeEventListener('pointercancel', onDescMediaGalleryItemPointerCancel);
  }

  function abortDescMediaGalleryDrag() {
    var ds = descMediaGalleryDragState;
    if (!ds) return;
    teardownDescMediaGalleryDragListeners();
    if (ds.active) cleanupDescMediaGalleryDragDom(ds);
    descMediaGalleryDragState = null;
  }

  function onDescMediaGalleryItemPointerCancel(e) {
    var ds = descMediaGalleryDragState;
    if (!ds || e.pointerId !== ds.pointerId) return;
    abortDescMediaGalleryDrag();
  }

  function commitDescMediaGalleryDrag(ds) {
    var item = findItemById(ds.itemId);
    var blocks = item && ensureDescriptionBlocks(item);
    var block = blocks && blocks.filter(function (b) { return b.id === ds.galleryBlockId; })[0];
    if (!block || !Array.isArray(block.items)) return;
    var fromIdx = block.items.findIndex(function (i) { return i.id === ds.mediaItemId; });
    var overIdx = block.items.findIndex(function (i) { return i.id === ds.overMediaItemId; });
    if (fromIdx === -1 || overIdx === -1) return;
    var toIdx = overIdx + (ds.dropPosition === 'after' ? 1 : 0);
    if (toIdx > fromIdx) toIdx -= 1;
    if (toIdx === fromIdx) return;
    withHistoryTransaction(function () {
      var moved = block.items.splice(fromIdx, 1)[0];
      block.items.splice(toIdx, 0, moved);
      block.updatedAt = Date.now();
      item.updatedAt = Date.now();
    });
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  function onDescMediaGalleryItemPointerUp(e) {
    var ds = descMediaGalleryDragState;
    if (!ds || e.pointerId !== ds.pointerId) return;
    teardownDescMediaGalleryDragListeners();
    descMediaGalleryDragState = null;
    if (!ds.active) return;
    suppressNextDescEditorClickOnce();
    cleanupDescMediaGalleryDragDom(ds);
    commitDescMediaGalleryDrag(ds);
  }

  // 7A 0/1: 표 본체(<table>)에는 실제 데이터 셀([data-row][data-col])만 들어간다 — 행/열
  // handle·resize·+ rail은 전부 wrap 기준 absolute overlay 요소로 분리해서 만든다.
  // 7A.1: 처음엔 열은 table-layout:fixed + <colgroup>이 폭을 강제하니 columnWidths 값만으로
  // col handle/resize 위치를 계산해도 될 거라 가정했으나, 실제로는 table에 명시적 width가
  // 없으면 컨테이너 폭에 맞춰 자동으로 늘어날 수 있어(auto stretch) 실제 렌더 폭이
  // columnWidths 합과 어긋나고, 그 결과 overlay가 실제 세로 경계에서 벗어나 보였다 — 아래
  // syncDescTableTotalWidth로 table 폭을 고정하고, syncDescTableOverlayLayout(Wrap)이 항상
  // 실제 렌더된 td/tr을 재측정해 모든 overlay(행/열 모두)를 보정한다.
  function buildDescTableDom(block) {
    normalizeDescTableData(block);
    normalizeDescTableSizing(block);
    var wrap = document.createElement('div');
    wrap.className = 'desc-table-wrap';
    wrap.dataset.blockId = block.id;
    if (state.descTableSelection && state.descTableSelection.blockId === block.id && state.descTableSelection.cells.size) {
      wrap.classList.add('has-selection');
    }

    var scroll = document.createElement('div');
    scroll.className = 'desc-table-scroll';
    var table = document.createElement('table');
    table.className = 'desc-table';
    var data = Array.isArray(block.tableData) && block.tableData.length ? block.tableData : [[makeDescTableCell()]];
    var colCount = data[0] ? data[0].length : 1;
    var colWidths = block.columnWidths;
    var rowHeights = block.rowHeights;
    var sel = state.descTableSelection && state.descTableSelection.blockId === block.id ? state.descTableSelection : null;

    var colgroup = document.createElement('colgroup');
    var totalColWidth = 0;
    for (var ci = 0; ci < colCount; ci++) {
      var colW = colWidths[ci] || DESC_TABLE_DEFAULT_COL_WIDTH;
      var col = document.createElement('col');
      col.style.width = colW + 'px';
      colgroup.appendChild(col);
      totalColWidth += colW;
    }
    table.appendChild(colgroup);
    // 7A.1: 명시적 width 없이는 table-layout:fixed 표가 컨테이너 폭까지 자동으로 늘어날 수
    // 있어(auto stretch) 실제 렌더 폭이 columnWidths 합과 어긋난다 — 폭을 고정해 막는다.
    table.style.width = totalColWidth + 'px';

    data.forEach(function (row, r) {
      var tr = document.createElement('tr');
      tr.style.height = (rowHeights[r] || DESC_TABLE_DEFAULT_ROW_HEIGHT) + 'px';
      row.forEach(function (rawCell, c) {
        var cellData = normalizeDescTableCell(rawCell);
        row[c] = cellData;
        var td = document.createElement('td');
        td.contentEditable = 'true';
        td.dataset.blockId = block.id;
        td.dataset.row = String(r);
        td.dataset.col = String(c);
        td.textContent = cellData.text || '';
        if (cellData.richTextHTML) td.innerHTML = sanitizeDescRichHTML(cellData.richTextHTML);
        if (cellData.textColor) td.style.color = 'var(--desc-color-' + cellData.textColor + ')';
        if (cellData.backgroundColor) td.style.background = 'color-mix(in srgb,var(--desc-color-' + cellData.backgroundColor + ') 25%,transparent)';
        if (sel && sel.cells.has(r + ',' + c)) {
          td.classList.add('is-selected');
          if (sel.anchorR === r && sel.anchorC === c) td.classList.add('is-active-cell');
        }
        td.addEventListener('pointerdown', function (e) { onDescTableCellRangeSelectPointerDown(e, 'cell', block.id, r, c); });
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });

    scroll.appendChild(table);
    wrap.appendChild(scroll);

    // 열 handle rail(위쪽) — 각 handle 너비를 columnWidths와 동일하게 맞춰 실제 열과
    // 정확히 겹치게 한다(table-layout:fixed라 측정 없이도 항상 일치한다).
    var colRail = document.createElement('div');
    colRail.className = 'desc-table-colhandle-rail';
    for (var c = 0; c < colCount; c++) {
      var colHandle = document.createElement('button');
      colHandle.type = 'button';
      colHandle.className = 'desc-table-colhandle';
      colHandle.style.width = (colWidths[c] || DESC_TABLE_DEFAULT_COL_WIDTH) + 'px';
      colHandle.dataset.blockId = block.id;
      colHandle.dataset.colHandle = String(c);
      colHandle.dataset.action = 'desc-table-col-handle';
      colHandle.title = (c + 1) + '열';
      colHandle.setAttribute('aria-label', (c + 1) + '열 선택 — 클릭: 선택, grip 드래그: 재정렬');
      colHandle.setAttribute('aria-haspopup', 'menu');
      colHandle.setAttribute('aria-expanded', 'false');
      var colDots = buildDotHandle('desc-table-handle-dots');
      colHandle.appendChild(colDots);
      if (sel && sel.mode === 'col' && sel.cells.has('0,' + c)) colHandle.classList.add('is-selected');
      (function (colIdx, dotsEl) {
        dotsEl.addEventListener('pointerdown', function (e) { e.stopPropagation(); onDescTableHandlePointerDown(e, 'col', block.id, colIdx); });
        colHandle.addEventListener('pointerdown', function (e) { onDescTableCellRangeSelectPointerDown(e, 'col', block.id, 0, colIdx); });
      })(c, colDots);
      colRail.appendChild(colHandle);
    }
    wrap.appendChild(colRail);

    // 행 handle rail(왼쪽).
    var rowRail = document.createElement('div');
    rowRail.className = 'desc-table-rowhandle-rail';
    data.forEach(function (row, r) {
      var rowHandle = document.createElement('button');
      rowHandle.type = 'button';
      rowHandle.className = 'desc-table-rowhandle';
      rowHandle.style.height = (rowHeights[r] || DESC_TABLE_DEFAULT_ROW_HEIGHT) + 'px';
      rowHandle.dataset.blockId = block.id;
      rowHandle.dataset.rowHandle = String(r);
      rowHandle.dataset.action = 'desc-table-row-handle';
      rowHandle.title = (r + 1) + '행';
      rowHandle.setAttribute('aria-label', (r + 1) + '행 선택 — 클릭: 선택, grip 드래그: 재정렬');
      rowHandle.setAttribute('aria-haspopup', 'menu');
      rowHandle.setAttribute('aria-expanded', 'false');
      var rowDots = buildDotHandle('desc-table-handle-dots');
      rowHandle.appendChild(rowDots);
      if (sel && sel.mode === 'row' && sel.cells.has(r + ',0')) rowHandle.classList.add('is-selected');
      (function (rowIdx, dotsEl) {
        dotsEl.addEventListener('pointerdown', function (e) { e.stopPropagation(); onDescTableHandlePointerDown(e, 'row', block.id, rowIdx); });
        rowHandle.addEventListener('pointerdown', function (e) { onDescTableCellRangeSelectPointerDown(e, 'row', block.id, rowIdx, 0); });
      })(r, rowDots);
      rowRail.appendChild(rowHandle);
    });
    wrap.appendChild(rowRail);

    // + rail(오른쪽/아래) — 기존 add-row/add-col 로직을 그대로 재사용(별도 복제 없음).
    var addColRail = document.createElement('button');
    addColRail.type = 'button';
    addColRail.className = 'desc-table-add-col-rail';
    addColRail.dataset.action = 'desc-table-add-col';
    addColRail.dataset.blockId = block.id;
    addColRail.setAttribute('aria-label', '오른쪽에 열 추가');
    addColRail.title = '열 추가';
    addColRail.textContent = '+';
    wrap.appendChild(addColRail);

    var addRowRail = document.createElement('button');
    addRowRail.type = 'button';
    addRowRail.className = 'desc-table-add-row-rail';
    addRowRail.dataset.action = 'desc-table-add-row';
    addRowRail.dataset.blockId = block.id;
    addRowRail.setAttribute('aria-label', '아래에 행 추가');
    addRowRail.title = '행 추가';
    addRowRail.textContent = '+';
    wrap.appendChild(addRowRail);

    // 7A 7/8: 열/행 resize handle. 열 위치는 columnWidths 누적 합으로(측정 불필요),
    // 행 위치는 초기값은 rowHeights 누적 합을 쓰고 DOM 삽입 뒤 실측 보정한다.
    var colResizeLayer = document.createElement('div');
    colResizeLayer.className = 'desc-table-colresize-layer';
    var accW = 0;
    for (var cr = 0; cr < colCount - 1; cr++) {
      accW += (colWidths[cr] || DESC_TABLE_DEFAULT_COL_WIDTH);
      var colResize = document.createElement('span');
      colResize.className = 'desc-table-colresize';
      colResize.style.left = accW + 'px';
      colResize.dataset.blockId = block.id;
      colResize.dataset.colBoundary = String(cr);
      colResize.dataset.action = 'desc-table-col-resize';
      colResize.tabIndex = 0;
      colResize.setAttribute('role', 'separator');
      colResize.setAttribute('aria-label', (cr + 1) + '열과 ' + (cr + 2) + '열 경계 — 드래그로 너비 조절');
      colResize.title = '열 너비 조절';
      (function (boundaryIdx) {
        colResize.addEventListener('pointerdown', function (e) { onDescTableColResizePointerDown(e, block.id, boundaryIdx); });
      })(cr);
      colResizeLayer.appendChild(colResize);
    }
    wrap.appendChild(colResizeLayer);

    var rowResizeLayer = document.createElement('div');
    rowResizeLayer.className = 'desc-table-rowresize-layer';
    var accH = 0;
    for (var rr = 0; rr < data.length - 1; rr++) {
      accH += (rowHeights[rr] || DESC_TABLE_DEFAULT_ROW_HEIGHT);
      var rowResize = document.createElement('span');
      rowResize.className = 'desc-table-rowresize';
      rowResize.style.top = accH + 'px';
      rowResize.dataset.blockId = block.id;
      rowResize.dataset.rowBoundary = String(rr);
      rowResize.dataset.action = 'desc-table-row-resize';
      rowResize.tabIndex = 0;
      rowResize.setAttribute('role', 'separator');
      rowResize.setAttribute('aria-label', (rr + 1) + '행과 ' + (rr + 2) + '행 경계 — 드래그로 높이 조절');
      rowResize.title = '행 높이 조절';
      (function (boundaryIdx) {
        rowResize.addEventListener('pointerdown', function (e) { onDescTableRowResizePointerDown(e, block.id, boundaryIdx); });
      })(rr);
      rowResizeLayer.appendChild(rowResize);
    }
    wrap.appendChild(rowResizeLayer);

    // 1: 기존 +행/+열/−행/−열/텍스트색/배경색 기능은 삭제하지 않고, 표 그 자체 구조처럼
    // 보이지 않도록 접근 가능한 보조 메뉴로만 남긴다(평소 숨김, hover·focus·선택 시 표시).
    var toolbar = document.createElement('div');
    toolbar.className = 'desc-table-toolbar';
    toolbar.setAttribute('aria-label', '표 편집 메뉴(보조)');
    [['desc-table-add-row', '+ 행'], ['desc-table-add-col', '+ 열'], ['desc-table-remove-row', '− 행'], ['desc-table-remove-col', '− 열']].forEach(function (pair) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'desc-table-btn';
      btn.dataset.action = pair[0];
      btn.dataset.blockId = block.id;
      btn.textContent = pair[1];
      toolbar.appendChild(btn);
    });
    var textColorBtn = document.createElement('button');
    textColorBtn.type = 'button';
    textColorBtn.className = 'desc-table-btn';
    textColorBtn.dataset.action = 'desc-table-text-color';
    textColorBtn.dataset.blockId = block.id;
    textColorBtn.textContent = 'A 텍스트색';
    toolbar.appendChild(textColorBtn);
    var bgColorBtn = document.createElement('button');
    bgColorBtn.type = 'button';
    bgColorBtn.className = 'desc-table-btn';
    bgColorBtn.dataset.action = 'desc-table-bg-color';
    bgColorBtn.dataset.blockId = block.id;
    bgColorBtn.textContent = '배경색';
    toolbar.appendChild(bgColorBtn);
    wrap.appendChild(toolbar);
    return wrap;
  }

  // 7A.1: overlay(handle/resize/+rail) 위치는 columnWidths 누적합 같은 "계산값"이 아니라
  // 실제로 렌더된 td/tr의 getBoundingClientRect()를 wrap 좌표계로 변환한 "단일 측정값"에서
  // 파생시킨다 — border-collapse·padding·box-sizing·table 자동 stretch·서브픽셀 반올림 등
  // 어떤 이유로 실제 렌더 폭이 데이터의 columnWidths 합과 달라도 항상 실제 경계와 일치한다.
  function measureDescTableGeometry(wrap) {
    var table = wrap.querySelector('.desc-table');
    if (!table) return null;
    var rows = Array.prototype.slice.call(table.querySelectorAll(':scope > tr'));
    var firstRow = rows[0];
    if (!firstRow) return null;
    var wrapRect = wrap.getBoundingClientRect();
    var cells = Array.prototype.slice.call(firstRow.children);
    var colLefts = cells.map(function (td) { return td.getBoundingClientRect().left - wrapRect.left; });
    var colRights = cells.map(function (td) { return td.getBoundingClientRect().right - wrapRect.left; });
    var rowTops = rows.map(function (tr) { return tr.getBoundingClientRect().top - wrapRect.top; });
    var rowBottoms = rows.map(function (tr) { return tr.getBoundingClientRect().bottom - wrapRect.top; });
    return { colLefts: colLefts, colRights: colRights, rowTops: rowTops, rowBottoms: rowBottoms };
  }

  // 열 하나가 바뀔 때마다(resize drag 등) table 전체 폭을 columnWidths 합으로 다시 고정한다
  // — 명시적 width가 없으면 table-layout:fixed 표가 컨테이너 폭에 맞춰 늘어나면서(auto
  // stretch) 각 열이 선언한 columnWidths보다 넓게 렌더되고, 그 결과 실제 세로 경계와
  // overlay 위치가 어긋나는 게 이번 정렬 문제의 실제 원인이었다.
  function syncDescTableTotalWidth(wrap, block) {
    var table = wrap.querySelector('.desc-table');
    if (!table) return;
    var cols = getDescTableColCount(block);
    var total = 0;
    for (var i = 0; i < cols; i++) total += (block.columnWidths[i] || DESC_TABLE_DEFAULT_COL_WIDTH);
    table.style.width = total + 'px';
  }

  var DESC_TABLE_RAIL_GAP = 2; // +rail을 실제 마지막 열/행 경계에서 살짝 띄우는 여백(0~4px 권장 범위 안).

  function syncDescTableWrapOverlay(wrap) {
    var geo = measureDescTableGeometry(wrap);
    if (!geo || !geo.colLefts.length || !geo.rowTops.length) return;
    var firstColLeft = geo.colLefts[0];
    var lastColRight = geo.colRights[geo.colRights.length - 1];
    var firstRowTop = geo.rowTops[0];
    var lastRowBottom = geo.rowBottoms[geo.rowBottoms.length - 1];
    var tableSpanW = lastColRight - firstColLeft;
    var tableSpanH = lastRowBottom - firstRowTop;

    var colRail = wrap.querySelector('.desc-table-colhandle-rail');
    if (colRail) {
      Array.prototype.forEach.call(colRail.children, function (handle, c) {
        if (geo.colLefts[c] == null) return;
        handle.style.left = geo.colLefts[c] + 'px';
        handle.style.width = Math.max(0, geo.colRights[c] - geo.colLefts[c]) + 'px';
      });
    }
    var rowRail = wrap.querySelector('.desc-table-rowhandle-rail');
    if (rowRail) {
      Array.prototype.forEach.call(rowRail.children, function (handle, r) {
        if (geo.rowTops[r] == null) return;
        handle.style.top = geo.rowTops[r] + 'px';
        handle.style.height = Math.max(0, geo.rowBottoms[r] - geo.rowTops[r]) + 'px';
      });
    }
    // 7A.1: hit-strip은 경계와 수직인 축(9px, CSS)만 고정이고, 경계를 "따라가는" 축은
    // 실제 표 범위(firstRowTop~lastRowBottom / firstColLeft~lastColRight)로 명시 지정한다
    // — 그렇지 않으면 layer가 wrap 전체를 덮으면서(overlay 정렬 통일의 부작용) rail/toolbar
    // 위 클릭까지 가로챈다.
    var colResizeLayer = wrap.querySelector('.desc-table-colresize-layer');
    if (colResizeLayer) {
      Array.prototype.forEach.call(colResizeLayer.children, function (span, i) {
        if (geo.colRights[i] == null) return;
        span.style.left = geo.colRights[i] + 'px';
        span.style.top = firstRowTop + 'px';
        span.style.height = Math.max(0, tableSpanH) + 'px';
      });
    }
    var rowResizeLayer = wrap.querySelector('.desc-table-rowresize-layer');
    if (rowResizeLayer) {
      Array.prototype.forEach.call(rowResizeLayer.children, function (span, i) {
        if (geo.rowBottoms[i] == null) return;
        span.style.top = geo.rowBottoms[i] + 'px';
        span.style.left = firstColLeft + 'px';
        span.style.width = Math.max(0, tableSpanW) + 'px';
      });
    }

    var addColRail = wrap.querySelector('.desc-table-add-col-rail');
    if (addColRail) {
      addColRail.style.left = (lastColRight + DESC_TABLE_RAIL_GAP) + 'px';
      addColRail.style.right = 'auto';
      addColRail.style.top = firstRowTop + 'px';
      addColRail.style.bottom = 'auto';
      addColRail.style.height = Math.max(0, lastRowBottom - firstRowTop) + 'px';
    }
    var addRowRail = wrap.querySelector('.desc-table-add-row-rail');
    if (addRowRail) {
      addRowRail.style.top = (lastRowBottom + DESC_TABLE_RAIL_GAP) + 'px';
      addRowRail.style.bottom = 'auto';
      addRowRail.style.left = firstColLeft + 'px';
      addRowRail.style.right = 'auto';
      addRowRail.style.width = Math.max(0, lastColRight - firstColLeft) + 'px';
    }
    var toolbar = wrap.querySelector('.desc-table-toolbar');
    if (toolbar) {
      // 3/4: 보조 toolbar도 같은 측정값으로 표 실제 너비 기준 왼쪽 정렬 + 실제 마지막 행
      // 바로 아래(+행 rail 높이만큼만 띄워서) 배치한다 — wrapper 전체 폭 끝이 아니다.
      toolbar.style.left = firstColLeft + 'px';
      toolbar.style.top = (lastRowBottom + 11 + 8) + 'px';
    }
  }

  // renderDescriptionEditor가 매 구조 재렌더 뒤 컨테이너 전체에 대해 한 번 호출한다.
  function syncDescTableOverlayLayout(container) {
    var wraps = container.querySelectorAll('.desc-table-wrap');
    Array.prototype.forEach.call(wraps, syncDescTableWrapOverlay);
  }

  // 7A.1: 모달 resize·폰트 변경·브라우저 zoom처럼 렌더 사이클을 거치지 않는 외부 요인으로
  // 표 크기가 바뀌어도 overlay가 계속 실제 경계를 따라가야 한다 — ResizeObserver로 wrap
  // 자신의 box 변화를 관찰한다(폴링 없음). 매 구조 재렌더(container.replaceChildren)마다
  // 기존 관찰 대상이 전부 교체되므로, 그때마다 이전 observer를 버리고 새로 만든다(누수 방지).
  var descTableGeometryObserver = null;

  function setupDescTableGeometryObserver(container) {
    if (descTableGeometryObserver) { descTableGeometryObserver.disconnect(); descTableGeometryObserver = null; }
    if (typeof ResizeObserver === 'undefined') return;
    var wraps = container.querySelectorAll('.desc-table-wrap');
    if (!wraps.length) return;
    descTableGeometryObserver = new ResizeObserver(function (entries) {
      entries.forEach(function (entry) { syncDescTableWrapOverlay(entry.target); });
    });
    Array.prototype.forEach.call(wraps, function (wrap) { descTableGeometryObserver.observe(wrap); });
  }

  function createDescriptionBlockDom(item, block, arrIndex, displayNumber, isSoleEmptyBlock) {
    var wrap = document.createElement('div');
    wrap.className = 'desc-block' + (state.detailBlockSelection.selectedIds.has(block.id) ? ' is-selected' : '');
    wrap.dataset.blockId = block.id;
    wrap.dataset.blockType = block.type;
    var indent = block.indent || 0;
    wrap.style.paddingLeft = (24 + indent * 22) + 'px';
     wrap.style.paddingLeft = (24 + indent * 22) + 'px';

  // 실제 저장된 블록에만 + 버튼을 붙인다.
  // 설명이 완전히 비었을 때 표시되는 임시 placeholder 블록(arrIndex === -1)은 제외한다.
  if (arrIndex >= 0) {
    wrap.appendChild(
      buildDescBlockAddButton(item.id, block.id)
    );
  }

  wrap.appendChild(
    buildDescBlockHandle(item.id, block.id)
  );
    if (block.type === 'divider') {
      var dwrap = document.createElement('div');
      dwrap.className = 'desc-divider-wrap';
      dwrap.dataset.blockId = block.id;
      dwrap.tabIndex = 0;
      dwrap.setAttribute('role', 'separator');
      dwrap.appendChild(document.createElement('hr')).className = 'desc-divider';
      wrap.appendChild(dwrap);
      return wrap;
    }
    if (block.type === 'attachment') {
      var mediaKind = descBlockMediaKind(block);
      // 3: 기존 attachment 데이터도 MIME(또는 이름 확장자 fallback)이 image/video면 실제
      // 렌더로 보여준다 — block.type 자체는 바꾸지 않는다(대량 변환 금지).
      if (mediaKind === 'image') { wrap.appendChild(buildDescImageDom(block)); return wrap; }
      if (mediaKind === 'video') { wrap.appendChild(buildDescVideoDom(block)); return wrap; }
      wrap.appendChild(buildDescAttachmentDom(block));
      return wrap;
    }
    if (block.type === 'image') {
      wrap.appendChild(buildDescImageDom(block));
      return wrap;
    }
    if (block.type === 'video') {
      wrap.appendChild(buildDescVideoDom(block));
      return wrap;
    }
    if (block.type === 'mediaGallery') {
      wrap.appendChild(buildDescMediaGalleryDom(block));
      return wrap;
    }
    if (block.type === 'table') {
      wrap.appendChild(buildDescTableDom(block));
      return wrap;
    }

    var content = document.createElement('div');
    content.className = 'desc-block-content';

    if (block.type === 'bulleted') {
      var bullet = document.createElement('span');
      bullet.className = 'desc-marker-bullet';
      bullet.textContent = DESC_BULLET_MARKERS[indent % DESC_BULLET_MARKERS.length];
      bullet.setAttribute('aria-hidden', 'true');
      content.appendChild(bullet);
    } else if (block.type === 'numbered') {
      var num = document.createElement('span');
      num.className = 'desc-marker-number';
      num.textContent = formatDescNumberMarker(displayNumber != null ? displayNumber : 1, indent);
      num.setAttribute('aria-hidden', 'true');
      content.appendChild(num);
    } else if (block.type === 'todo') {
      var linkedSubtask = getDescTodoSubtask(item, block);
      var tdone = !!(linkedSubtask && linkedSubtask.completed);
      var tcheck = document.createElement('button');
      tcheck.type = 'button';
      tcheck.className = 'subtask-checkbox desc-todo-checkbox' + (tdone ? ' checked' : '');
      tcheck.dataset.blockId = block.id;
      tcheck.dataset.action = 'desc-todo-toggle';
      tcheck.setAttribute('role', 'checkbox');
      tcheck.setAttribute('aria-checked', String(tdone));
      tcheck.setAttribute('aria-label', tdone ? '완료 취소' : '완료로 표시');
      content.appendChild(tcheck);
    } else if (block.type === 'toggle') {
      var tbtn = document.createElement('button');
      tbtn.type = 'button';
      tbtn.className = 'desc-toggle-btn';
      tbtn.dataset.blockId = block.id;
      tbtn.dataset.action = 'desc-toggle-collapse';
      tbtn.setAttribute('aria-expanded', String(!block.collapsed));
      tbtn.setAttribute('aria-label', block.collapsed ? '펼치기' : '접기');
      tbtn.textContent = block.collapsed ? '▶' : '▼';
      content.appendChild(tbtn);
    }

    var text = document.createElement('div');
    text.className = 'desc-block-text';
    text.contentEditable = 'true';
    text.dataset.blockId = block.id;
    text.setAttribute('role', 'textbox');
    text.setAttribute('aria-multiline', 'true');
    if (isSoleEmptyBlock && block.type === 'paragraph') {
      text.setAttribute('data-placeholder', '설명이나 간단한 메모를 입력하세요. / 를 눌러 블록을 추가할 수 있습니다.');
    } else {
      text.setAttribute('data-placeholder', '');
    }
    // 4차: 인라인 서식이 있으면 sanitize된 HTML을 그대로 렌더한다(저장 시점에 이미
    // whitelist sanitize를 거쳤지만, 손으로 편집됐을 수 있는 localStorage 데이터에 대비해
    // 렌더 시점에도 한 번 더 방어적으로 sanitize한다). 없으면 기존처럼 plain text.
    var descDisplayPlain = block.type === 'todo' ? (linkedSubtask ? linkedSubtask.text : '') : (block.text || '');
    if (block.richTextHTML) {
      text.innerHTML = sanitizeDescRichHTML(block.richTextHTML);
    } else {
      text.textContent = descDisplayPlain;
    }
    if (block.type === 'todo' && tdone) text.classList.add('desc-todo-text-done');
    content.appendChild(text);
    if (block.type === 'todo') {
      var tdel = document.createElement('button');
      tdel.type = 'button';
      tdel.className = 'desc-todo-delete';
      tdel.dataset.blockId = block.id;
      tdel.dataset.action = 'desc-todo-delete';
      tdel.setAttribute('aria-label', '할 일 삭제');
      tdel.textContent = '×';
      content.appendChild(tdel);
    }
    wrap.appendChild(content);
    return wrap;
  }

  function restoreDescriptionEditorFocus(item) {
    var st = state.descriptionEditor;
    if (!st || st.itemId !== item.id || !st.activeBlockId) return;
    var container = activeDetailDrawer && activeDetailDrawer.descriptionEditorEl;
    if (!container) return;
    // 7A 6: 표 블록은 셀이 여러 개라 activeBlockId만으로는 첫 셀로만 돌아간다 — 마지막
    // 셀 Tab으로 새 행을 추가한 뒤처럼 특정 셀을 지정해야 할 때는 cellRow/cellCol을 함께
    // 쓴다(없으면 기존과 동일하게 첫 td로 폴백 — mutateDescTable 등 기존 호출부는 그대로).
    var tableCellSel = '.desc-table-wrap[data-block-id="' + st.activeBlockId + '"] td' +
      (typeof st.cellRow === 'number' && typeof st.cellCol === 'number' ? '[data-row="' + st.cellRow + '"][data-col="' + st.cellCol + '"]' : '');
    var el = container.querySelector('.desc-block-text[data-block-id="' + st.activeBlockId + '"]') ||
      container.querySelector('.desc-divider-wrap[data-block-id="' + st.activeBlockId + '"]') ||
      container.querySelector('.desc-attachment[data-block-id="' + st.activeBlockId + '"]') ||
      container.querySelector(tableCellSel);
    if (!el) return;
    // 15: rAF로 다음 프레임까지 미루지 않고 바로 포커스를 준다 — replaceChildren 직후에도
    // 이미 DOM에 연결된 요소라 focus()는 동기적으로 안전하다. 한 프레임이라도 늦추면 그
    // 사이(포커스가 사라진 옛 요소→아직 안 옮겨진 새 요소) 빠르게 이어지는 다음 입력이
    // 통째로 유실될 수 있다(Enter 직후 바로 타이핑하는 경우 등).
    el.focus();
    if (typeof st.selectionStart === 'number' && (el.classList.contains('desc-block-text') || el.tagName === 'TD')) {
      setDescCaretOffset(el, st.selectionStart);
    }
  }

  // 4/15: renderApp()이 무엇 때문에 호출됐든(하위 할 일 체크 등 무관한 변경 포함) 항상
  // 마지막에 이 함수가 불린다 — 타이핑 도중에는 절대 다시 그리지 않되(=descForceRebuild가
  // true일 때만, 즉 우리가 구조 변경으로 직접 요청했을 때만 다시 그림), 그 외에는 항상
  // 최신 데이터로 다시 그린다.
  function renderDescriptionEditor(item) {
    if (!activeDetailDrawer) return;
    var container = activeDetailDrawer.descriptionEditorEl;
    var blocks = ensureDescriptionBlocks(item);
    var focusInside = !!(document.activeElement && container.contains(document.activeElement) && document.activeElement !== container);
    var sameItem = lastRenderedDescriptionItemId === item.id;
    if (focusInside && sameItem && !descForceRebuild) return;
    // 15: 포커스 복원은 "에디터 자신이 구조 변경을 일으켜 다시 그려달라고 명시적으로
    // 요청했을 때"(descForceRebuild)만 한다 — 그 외(완료 버튼 클릭처럼 에디터와 무관한
    // 이유로 renderApp()이 돌아 여기까지 왔을 때)까지 포커스를 되가져오면, 사용자가 막
    // 클릭한 다른 버튼에서 포커스를 뺏어와 버린다.
    var shouldRestoreFocus = descForceRebuild;
    descForceRebuild = false;
    lastRenderedDescriptionItemId = item.id;
    // 4차: 구조 재구성이 일어나면 floating toolbar가 들고 있던 DOM 참조(textEl)가 통째로
    // 새로 만들어진 노드로 바뀌어 무효해진다 — 안전하게 닫는다(서식 명령 자체는
    // descForceRebuild를 세팅하지 않으므로 여기 걸리지 않는다).
    if (shouldRestoreFocus) { closeDescFloatingToolbar(); descSavedFormatRange = null; }

    var visible = computeVisibleDescriptionBlocks(blocks);
    var soleEmpty = visible.length === 0 || (visible.length === 1 && !visible[0].block.text && visible[0].block.type === 'paragraph');
    var displayList = visible.length ? visible : [{ block: getEmptyDescPlaceholderBlock(), index: -1, displayNumber: null }];
var rows = displayList.map(function (entry) {
  return createDescriptionBlockDom(
    item,
    entry.block,
    entry.index,
    entry.displayNumber,
    soleEmpty
  );
});

container.replaceChildren.apply(container, rows);
    // 7A/7A.1: overlay(handle/resize/+rail) 위치는 실제 렌더된 td/tr을 재야 정확하다(내용에
    // 따라 행이 늘어날 수 있고, table-layout:fixed도 border/padding/auto-stretch에 따라
    // columnWidths 합과 실제 렌더 폭이 어긋날 수 있다). DOM에 실제로 붙은 뒤에만
    // getBoundingClientRect가 의미 있으므로 삽입 직후 한 번 보정하고, 이후 모달 resize·zoom
    // 등 외부 요인 변화는 ResizeObserver가 폴링 없이 계속 재보정한다.
    syncDescTableOverlayLayout(container);
    setupDescTableGeometryObserver(container);
    if (shouldRestoreFocus) restoreDescriptionEditorFocus(item);
  }

  // 14: 세션(=한 번의 연속 입력)의 "시작 시점" 전체 state.items 스냅샷을 기억해 뒀다가,
  // 디바운스가 끝나거나 blur될 때 그 스냅샷과 "지금" 스냅샷을 한 쌍으로 묶어 history에
  // 직접 push한다 — withHistoryTransaction처럼 fn 실행 전후를 감싸는 방식이 아니라(이미
  // 데이터는 각 keystroke마다 즉시 반영돼 있으므로), 세션 시작 시점 스냅샷을 우리가 직접
  // 들고 있다가 같은 방식으로 커밋한다.
  function ensureDescTextEditSession(item, block) {
    if (descTextEditSession && descTextEditSession.itemId === item.id && descTextEditSession.blockId === block.id) return;
    flushDescTextEditSession();
    descTextEditSession = { itemId: item.id, blockId: block.id, beforeSnapshot: JSON.stringify(state.items) };
  }

  function flushDescTextEditSession() {
    if (descHistoryDebounceTimer) { clearTimeout(descHistoryDebounceTimer); descHistoryDebounceTimer = null; }
    if (!descTextEditSession) return;
    var session = descTextEditSession;
    descTextEditSession = null;
    var afterSnapshot = JSON.stringify(state.items);
    if (afterSnapshot !== session.beforeSnapshot) {
      history.undoStack.push({ before: session.beforeSnapshot, after: afterSnapshot });
      if (history.undoStack.length > history.limit) history.undoStack.shift();
      history.redoStack = [];
    }
  }

  // 모달을 닫기 직전 등, 아직 반영되지 않은 debounce 저장/history를 즉시 흘려보낸다.
  function flushDescriptionEditorPending(item) {
    if (descSaveDebounceTimer) { clearTimeout(descSaveDebounceTimer); descSaveDebounceTimer = null; }
    if (item) syncDescriptionPlainTextMirror(item);
    if (item) saveItems();
    flushDescTextEditSession();
  }

  function scheduleDescAutosave(item) {
    clearTimeout(descSaveDebounceTimer);
    descSaveDebounceTimer = setTimeout(function () {
      descSaveDebounceTimer = null;
      syncDescriptionPlainTextMirror(item);
      saveItems();
      // 6차 7: 일반 타이핑은(라이브 입력을 방해하지 않으려고) renderApp()을 부르지
      // 않는다 — 하지만 Daily/Weekly의 "상세 내용 있음" 배지는 그래서 실시간으로 갱신되지
      // 않는 사각지대가 생긴다. 전체 renderApp 대신 이 두 목록만(가볍게) 다시 그려
      // 모달 안 타이핑을 방해하지 않으면서도 배지를 최신 상태로 유지한다.
      renderDailyList();
      renderWeekly();
    }, 300);
    clearTimeout(descHistoryDebounceTimer);
    descHistoryDebounceTimer = setTimeout(function () {
      descHistoryDebounceTimer = null;
      syncDescriptionPlainTextMirror(item);
      saveItems();
      flushDescTextEditSession();
    }, 800);
  }

  // 최초 입력 시점에만 진짜 블록을 만든다 — 렌더 단계에서 미리 만들어 두면(빈 아이템도
  // seed 데이터 취급) "seed 데이터 중복 생성 없음" 요구를 어기게 된다.
  function materializeDescPlaceholderBlock(item, target) {
    var blocks = ensureDescriptionBlocks(item);
    var newBlock = makeDescriptionBlock('paragraph', {});
    blocks.push(newBlock);
    target.dataset.blockId = newBlock.id;
    var wrap = target.closest('.desc-block');
    if (wrap) {
      wrap.dataset.blockId = newBlock.id;
      wrap.dataset.blockType = 'paragraph';
      var oldHandle = wrap.querySelector('.desc-block-drag');
      if (oldHandle) oldHandle.replaceWith(buildDescBlockHandle(item.id, newBlock.id));
    }
  }

  function insertParagraphAfterBlock(item, idx) {
    var blocks = ensureDescriptionBlocks(item);
    if (idx == null || idx < 0 || idx >= blocks.length) return;
    var anchor = blocks[idx];
    flushDescTextEditSession();
    // 5: enforceDescTrailingParagraph가 표·코드·구분선·첨부 바로 뒤에 빈 paragraph를 이미
    // 자동으로 만들어 뒀을 수 있다 — 그 자리가 비어 있는 채로 바로 다음이면 새로 또 만들지
    // 않고 그 기존 paragraph에 포커스만 옮긴다(빈 paragraph 중복 방지).
    var existingNext = blocks[idx + 1];
    if (existingNext && existingNext.type === 'paragraph' && !existingNext.text) {
      state.descriptionEditor = { itemId: item.id, activeBlockId: existingNext.id, selectionStart: 0 };
      descForceRebuild = true;
      renderApp();
      return;
    }
    var newBlock;
    withHistoryTransaction(function () {
      newBlock = makeDescriptionBlock('paragraph', { indent: anchor.indent || 0 });
      blocks.splice(idx + 1, 0, newBlock);
      syncDescriptionPlainTextMirror(item);
      item.updatedAt = Date.now();
    });
    state.descriptionEditor = { itemId: item.id, activeBlockId: newBlock.id, selectionStart: 0 };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }
function insertParagraphBeforeBlock(item, idx) {
  var blocks = ensureDescriptionBlocks(item);

  if (idx == null || idx < 0 || idx >= blocks.length) return;

  var anchor = blocks[idx];

  flushDescTextEditSession();

  // 바로 앞에 이미 빈 문단이 있다면 새로 만들지 않고 그 문단으로 이동한다.
  var existingPrevious = blocks[idx - 1];

  if (
    existingPrevious &&
    existingPrevious.type === 'paragraph' &&
    !getDescBlockDisplayText(item, existingPrevious).trim()
  ) {
    state.descriptionEditor = {
      itemId: item.id,
      activeBlockId: existingPrevious.id,
      selectionStart: 0
    };

    descForceRebuild = true;
    renderApp();
    return;
  }

  var newBlock;

  withHistoryTransaction(function () {
    newBlock = makeDescriptionBlock('paragraph', {
      indent: anchor.indent || 0
    });

    blocks.splice(idx, 0, newBlock);
    syncDescriptionPlainTextMirror(item);
    item.updatedAt = Date.now();
  });

  state.descriptionEditor = {
    itemId: item.id,
    activeBlockId: newBlock.id,
    selectionStart: 0
  };

  descForceRebuild = true;
  saveItems();
  renderApp();
}



  // 24: "+ 하위 할 일 추가" 빠른 진입점 — 별도 하위 할 일 섹션을 되살리지 않고, 통합
  // detailBlocks 문서 끝(특수 블록 뒤 유지되는 terminal 빈 paragraph가 있다면 그 앞)에
  // todo 블록 하나 + 연결 subtask 하나를 만든다. 이미 그 자리가 빈 todo라면 중복 생성 없이
  // 거기로 포커스만 옮긴다.
  function quickAddDescTodo(itemId) {
    var item = findItemById(itemId);
    if (!item) return;
    flushDescTextEditSession();
    var blocks = ensureDescriptionBlocks(item);
    var insertAt = blocks.length;
    if (blocks.length >= 2) {
      var last = blocks[blocks.length - 1];
      var prev = blocks[blocks.length - 2];
      if (last.type === 'paragraph' && !last.text && DESC_SPECIAL_TRAILING_TYPES.indexOf(prev.type) !== -1) {
        insertAt = blocks.length - 1; // terminal 빈 paragraph 앞에 삽입.
      }
    }
    var candidate = insertAt > 0 ? blocks[insertAt - 1] : null;
    if (candidate && candidate.type === 'todo') {
      var candSub = getDescTodoSubtask(item, candidate);
      if (candSub && !candSub.text) {
        state.descriptionEditor = { itemId: item.id, activeBlockId: candidate.id, selectionStart: 0 };
        descForceRebuild = true;
        renderApp();
        return;
      }
    }
    var newBlock;
    withHistoryTransaction(function () {
      var subtask = createLinkedSubtask(item, '');
      newBlock = makeDescriptionBlock('todo', { subtaskId: subtask.id });
      blocks.splice(insertAt, 0, newBlock);
      syncDescriptionPlainTextMirror(item);
      item.updatedAt = Date.now();
    });
    state.descriptionEditor = { itemId: item.id, activeBlockId: newBlock.id, selectionStart: 0 };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  // 7: 일반 블록에서 Enter — 커서 기준으로 텍스트를 나눠 새 블록을 바로 다음에 삽입한다.
  // 빈 목록/토글/인용 블록에서는 새 블록을 만들지 않고 그 블록 자체를 단계적으로
  // "졸업"시킨다(들여쓰기 감소 → paragraph 전환).
  function handleDescEnter(item, blockId, textEl) {
    var blocks = ensureDescriptionBlocks(item);
    var idx = blocks.findIndex(function (b) { return b.id === blockId; });
    if (idx === -1) return;
    var block = blocks[idx];
    var isTodo = block.type === 'todo';
    var todoSubtask = isTodo ? getDescTodoSubtask(item, block) : null;
    var offset = getDescCaretOffset(textEl);
    var full = isTodo ? (todoSubtask ? todoSubtask.text : '') : (block.text || '');
    var before = full.slice(0, offset);
    var after = full.slice(offset);

    flushDescTextEditSession();

    var isEmptyDemote = !full && (block.type === 'bulleted' || block.type === 'numbered' || block.type === 'toggle' || block.type === 'quote' || block.type === 'todo');
    var isEmptyHeading = !full && (block.type === 'heading1' || block.type === 'heading2' || block.type === 'heading3');

    var newBlock = null;
    withHistoryTransaction(function () {
      if (isEmptyDemote) {
        if (block.indent > 0) {
          block.indent -= 1;
        } else {
          // 7: 빈 todo가 paragraph로 졸업하면 더 이상 연결이 필요 없는 빈 subtask도 함께 정리한다.
          if (isTodo && block.subtaskId) {
            removeSubtaskById(item, block.subtaskId);
            delete block.subtaskId;
          }
          block.type = 'paragraph';
        }
        block.updatedAt = Date.now();
      } else if (isEmptyHeading) {
        newBlock = makeDescriptionBlock('paragraph', { indent: block.indent });
        blocks.splice(idx + 1, 0, newBlock);
      } else if (isTodo) {
        // 7: 커서 앞은 기존 subtask에 남기고, 커서 뒤는 새 subtask를 만들어 새 todo 블록에 연결한다.
        if (todoSubtask) { todoSubtask.text = before; todoSubtask.updatedAt = Date.now(); }
        block.richTextHTML = null; // 4차: plain 분리 지점이므로 예전 서식 경계는 무효화.
        var newSubtask = createLinkedSubtask(item, after);
        newBlock = makeDescriptionBlock('todo', { subtaskId: newSubtask.id, indent: block.indent });
        blocks.splice(idx + 1, 0, newBlock);
      } else {
        var continuationType = block.type;
        if (continuationType === 'heading1' || continuationType === 'heading2' || continuationType === 'heading3' || continuationType === 'toggle') {
          continuationType = 'paragraph'; // 12: toggle 바로 뒤 Enter가 자식처럼 보이지 않도록.
        }
        block.text = before;
        block.richTextHTML = null; // 4차: plain 분리 지점이므로 예전 서식 경계는 무효화.
        block.updatedAt = Date.now();
        newBlock = makeDescriptionBlock(continuationType, { text: after, indent: block.indent });
        blocks.splice(idx + 1, 0, newBlock);
      }
      syncDescriptionPlainTextMirror(item);
      item.updatedAt = Date.now();
    });

    var targetBlockId = newBlock ? newBlock.id : block.id;
    var targetOffset = newBlock ? 0 : 0;
    state.descriptionEditor = { itemId: item.id, activeBlockId: targetBlockId, selectionStart: targetOffset };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  function indentDescBlock(item, blockId, delta) {
    var blocks = ensureDescriptionBlocks(item);
    var idx = blocks.findIndex(function (b) { return b.id === blockId; });
    if (idx === -1) return;
    var block = blocks[idx];
    if (DESC_BLOCK_INDENTABLE_TYPES.indexOf(block.type) === -1) return;
    var next = Math.max(0, Math.min(DESC_MAX_INDENT, (block.indent || 0) + delta));
    if (next === block.indent) return;

    var container = activeDetailDrawer && activeDetailDrawer.descriptionEditorEl;
    var liveEl = container && container.querySelector('.desc-block-text[data-block-id="' + blockId + '"]');
    var caretOffset = liveEl ? getDescCaretOffset(liveEl) : null;

    flushDescTextEditSession();
    withHistoryTransaction(function () {
      block.indent = next;
      block.updatedAt = Date.now();
      item.updatedAt = Date.now();
    });
    state.descriptionEditor = { itemId: item.id, activeBlockId: blockId, selectionStart: caretOffset };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  // 9: Backspace 병합/삭제 — 빈 블록은 단계적으로 졸업하거나(heading/list/quote/toggle)
  // 지워지고(paragraph), 텍스트가 있는 블록의 커서가 맨 앞이면 이전 텍스트 블록과 합친다.
  function handleDescBackspaceAtStart(item, blockId) {
    var blocks = ensureDescriptionBlocks(item);
    var idx = blocks.findIndex(function (b) { return b.id === blockId; });
    if (idx === -1) return;
    var block = blocks[idx];
    var text = getDescBlockDisplayText(item, block);

    flushDescTextEditSession();

    var targetBlockId = block.id;
    var targetOffset = 0;

    withHistoryTransaction(function () {
      if (!text) {
        if (block.type !== 'paragraph') {
          if (block.indent > 0) {
            block.indent -= 1;
          } else {
            // 7: 빈 todo가 paragraph로 졸업하면 연결된(내용 없는) subtask도 함께 정리한다.
            if (block.type === 'todo' && block.subtaskId) {
              removeSubtaskById(item, block.subtaskId);
              delete block.subtaskId;
            }
            block.type = 'paragraph';
          }
          targetBlockId = block.id;
          targetOffset = 0;
        } else if (idx === 0) {
          // 8: 최소 하나의 paragraph 블록은 항상 유지한다 — 첫 블록이면 아무 것도 하지 않는다.
          targetBlockId = block.id;
          targetOffset = 0;
        } else {
          var prev = blocks[idx - 1];
          targetBlockId = prev.id;
          targetOffset = DESC_BLOCK_TEXT_TYPES.indexOf(prev.type) !== -1 ? getDescBlockDisplayText(item, prev).length : null;
          blocks.splice(idx, 1);
          if (block.type === 'todo' && block.subtaskId) removeSubtaskById(item, block.subtaskId);
        }
      } else if (idx > 0) {
        var prev2 = blocks[idx - 1];
        if (DESC_BLOCK_TEXT_TYPES.indexOf(prev2.type) !== -1) {
          var prevText = getDescBlockDisplayText(item, prev2);
          targetOffset = prevText.length;
          setDescBlockDisplayText(item, prev2, prevText + text);
          targetBlockId = prev2.id;
          blocks.splice(idx, 1);
          // 7: 현재(todo였던) 블록이 다른 블록에 병합돼 사라지면 연결된 subtask도 함께 지운다
          // (텍스트는 이미 prev2로 옮겨졌으므로 데이터 손실이 아니다).
          if (block.type === 'todo' && block.subtaskId) removeSubtaskById(item, block.subtaskId);
        }
      }
      syncDescriptionPlainTextMirror(item);
      item.updatedAt = Date.now();
    });

    state.descriptionEditor = { itemId: item.id, activeBlockId: targetBlockId, selectionStart: targetOffset };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  // 토글 접기/펼치기는 콘텐츠가 아니라 화면 상태에 가깝다(Weekly 패널의 lastExpandedTop과
  // 같은 결) — Undo 스택을 여기서까지 쌓지 않는다(새로고침 유지를 위해 저장은 한다).
  function toggleDescBlockCollapsed(blockId) {
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var block = blocks.find(function (b) { return b.id === blockId; });
    if (!block) return;
    block.collapsed = !block.collapsed;
    block.updatedAt = Date.now();
    state.descriptionEditor = { itemId: item.id, activeBlockId: blockId, selectionStart: null };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  // 7/10: todo 블록의 완료 상태는 블록 자신이 아니라 연결된 subtask에 있다. 클릭한 todo가
  // 다중선택(2개 이상)에 포함돼 있으면 선택된 todo 전체를 같은 상태로 일괄 전환하고,
  // 그 외(선택이 없거나 todo 하나뿐)에는 기존 toggleSubtaskCompleted 단일 동작을 그대로
  // 재사용한다(부모 task의 completed는 손대지 않는다는 규칙 포함).
  function toggleDescTodoBlockChecked(blockId) {
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var block = blocks.find(function (b) { return b.id === blockId; });
    if (!block || block.type !== 'todo' || !block.subtaskId) return;
    flushDescTextEditSession();

    var sel = state.detailBlockSelection;
    var selectedTodoSubtaskIds = (sel.selectedIds.size > 1 && sel.selectedIds.has(blockId))
      ? blocks.filter(function (b) { return b.type === 'todo' && b.subtaskId && sel.selectedIds.has(b.id); })
        .map(function (b) { return b.subtaskId; })
      : null;

    if (selectedTodoSubtaskIds && selectedTodoSubtaskIds.length > 1) {
      var subtasks = ensureSubtasks(item);
      var currentSubtask = subtasks.find(function (s) { return s.id === block.subtaskId; });
      var targetCompleted = !(currentSubtask && currentSubtask.completed);
      withHistoryTransaction(function () {
        selectedTodoSubtaskIds.forEach(function (sid) {
          var st = subtasks.find(function (s) { return s.id === sid; });
          if (st && st.completed !== targetCompleted) { st.completed = targetCompleted; st.updatedAt = Date.now(); }
        });
        item.updatedAt = Date.now();
      });
      descForceRebuild = true;
      saveItems();
      renderApp();
      return;
    }

    state.descriptionEditor = { itemId: item.id, activeBlockId: blockId, selectionStart: null };
    descForceRebuild = true;
    toggleSubtaskCompleted(item.id, block.subtaskId);
  }

  // 7: todo 블록과 연결된 subtask를 한 트랜잭션으로 함께 지운다 — Undo 한 번으로 둘 다
  // 복원된다. 최소 하나의 paragraph는 항상 유지한다는 일반 규칙과 동일하게, 지우고 나서
  // 블록이 하나도 안 남으면 빈 paragraph를 하나 남긴다.
  function deleteDescTodoBlock(blockId) {
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var idx = blocks.findIndex(function (b) { return b.id === blockId; });
    if (idx === -1 || blocks[idx].type !== 'todo') return;
    var block = blocks[idx];
    var subtaskId = block.subtaskId;
    flushDescTextEditSession();
    withHistoryTransaction(function () {
      blocks.splice(idx, 1);
      if (subtaskId) removeSubtaskById(item, subtaskId);
      if (!blocks.length) blocks.push(makeDescriptionBlock('paragraph', {}));
      syncDescriptionPlainTextMirror(item);
      item.updatedAt = Date.now();
    });
    var focusTarget = blocks[Math.min(idx, blocks.length - 1)];
    state.descriptionEditor = { itemId: item.id, activeBlockId: focusTarget.id, selectionStart: null };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  // 8: 선택된 블록 일괄 삭제 — toggle이 선택돼도 자식을 자동으로 함께 지우지 않는다(선택된
  // 블록만 지운다는 게 기본 규칙). 자식도 지우고 싶으면 자식도 함께 선택돼 있어야 한다
  // (그러면 그 자식도 그냥 selectedIds에 포함돼 있으므로 같은 방식으로 지워진다).
  function deleteSelectedDescBlocks() {
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var sel = state.detailBlockSelection;
    var idsToDelete = new Set(sel.selectedIds);
    if (!idsToDelete.size) return;
    flushDescTextEditSession();
    var subtaskIdsToRemove = [];
    blocks.forEach(function (b) {
      if (idsToDelete.has(b.id) && b.type === 'todo' && b.subtaskId) subtaskIdsToRemove.push(b.subtaskId);
    });
    withHistoryTransaction(function () {
      var remaining = blocks.filter(function (b) { return !idsToDelete.has(b.id); });
      subtaskIdsToRemove.forEach(function (sid) { removeSubtaskById(item, sid); });
      if (!remaining.length) remaining.push(makeDescriptionBlock('paragraph', {}));
      item.descriptionBlocks = remaining;
      enforceDescTrailingParagraph(item.descriptionBlocks);
      syncDescriptionPlainTextMirror(item);
      item.updatedAt = Date.now();
    });
    clearDetailBlockSelection();
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  // 9: 선택된 블록 일괄 indent/outdent — 각 블록의 "현재" indent에 같은 delta를 적용하므로
  // 서로 다른 indent였던 블록들 사이의 상대 차이가 그대로 유지된다. divider/table/
  // attachment처럼 들여쓰기 대상이 아닌 타입은 조용히 건너뛴다.
  function indentSelectedDescBlocks(delta) {
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var sel = state.detailBlockSelection;
    if (!sel.selectedIds.size) return;
    flushDescTextEditSession();
    var mutated = false;
    withHistoryTransaction(function () {
      blocks.forEach(function (b) {
        if (!sel.selectedIds.has(b.id)) return;
        if (DESC_BLOCK_INDENTABLE_TYPES.indexOf(b.type) === -1) return;
        var next = Math.max(0, Math.min(DESC_MAX_INDENT, (b.indent || 0) + delta));
        if (next !== b.indent) { b.indent = next; b.updatedAt = Date.now(); mutated = true; }
      });
      if (mutated) item.updatedAt = Date.now();
    });
    if (!mutated) return;
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  // 5A 5: 표 안 Enter/ArrowDown과 표 밖 paragraph 진입을 분리한다 — 마지막 셀(또는 마지막
  // 행)에서만 insertParagraphAfterBlock을 재사용해 표 뒤 진입점으로 넘어간다(그 함수가
  // 이미 "기존 빈 paragraph 재사용 vs 새로 생성" 중복 방지 로직을 갖고 있다).
  function onDescTableCellKeydown(e, td, item, idx, block) {
    if (e.key === 'Escape') {
      // 7A 10: contextual menu/색상 패널이 열려 있으면 이 keydown이 stopPropagation으로
      // onDetailDrawerKeydown의 동일 분기에 도달하기 전에 여기서 먼저 닫는다.
      if (descFloatingToolbarState && (descFloatingToolbarState.blockId === '__table_context_menu__' || descFloatingToolbarState.blockId === '__table_color__')) {
        e.preventDefault();
        e.stopPropagation();
        closeDescFloatingToolbar();
        return;
      }
      var esel = state.descTableSelection;
      if (esel && esel.blockId === td.dataset.blockId && esel.cells.size) {
        e.preventDefault();
        e.stopPropagation();
        clearDescTableSelection();
      }
      return;
    }
    if (e.isComposing) return; // 7A 6: 한글 등 IME 조합 확정 중에는 어떤 키도 셀 이동으로 가로채지 않는다.
    if (!block || !Array.isArray(block.tableData)) return;
    var r = Number(td.dataset.row), c = Number(td.dataset.col);
    var colCount = getDescTableColCount(block);
    var rowCount = block.tableData.length;

    function focusCellAt(rr, cc, atEnd) {
      var wrap = td.closest('.desc-table-wrap');
      var target = wrap && wrap.querySelector('td[data-row="' + rr + '"][data-col="' + cc + '"]');
      if (!target) return false;
      target.focus();
      setDescCaretOffset(target, atEnd ? target.textContent.length : 0);
      return true;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (c > 0) { focusCellAt(r, c - 1, true); return; }
        if (r > 0) { focusCellAt(r - 1, colCount - 1, true); return; }
        // 7A 6: 첫 셀의 Shift+Tab — 표 앞의 마지막 텍스트 블록으로 나간다(없으면 아무 것도 안 함).
        var prevText = findAdjacentDescBlockTextEl(block.id, -1);
        if (prevText) { prevText.focus(); setDescCaretOffset(prevText, prevText.textContent.length); }
        return;
      }
      if (c + 1 < colCount) { focusCellAt(r, c + 1, false); return; }
      if (r + 1 < rowCount) { focusCellAt(r + 1, 0, false); return; }
      // 7A 6: 마지막 셀의 Tab — 새 행을 추가하고 그 첫 셀로 이동한다(history 1건).
      flushDescTextEditSession();
      clearDescTableSelection();
      withHistoryTransaction(function () {
        insertDescTableRowAt(block, block.tableData.length);
        block.updatedAt = Date.now();
        item.updatedAt = Date.now();
      });
      state.descriptionEditor = { itemId: item.id, activeBlockId: block.id, selectionStart: null, cellRow: rowCount, cellCol: 0 };
      descForceRebuild = true;
      saveItems();
      renderApp();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      var nextR = c + 1 < colCount ? r : r + 1;
      var nextC = c + 1 < colCount ? c + 1 : 0;
      if (nextR < rowCount && focusCellAt(nextR, nextC, false)) return;
      insertParagraphAfterBlock(item, idx);
      return;
    }

    var isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    if (!isArrow) return;
    // 7A 6: Shift+Arrow(텍스트 선택 확장)와 Ctrl/Cmd/Alt+Arrow(OS·브라우저 단축키)는 절대
    // 가로채지 않는다 — 일반 블록의 위/아래 이동(5507줄)과 동일한 원칙.
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    var nsel = window.getSelection();
    if (!nsel || !nsel.isCollapsed) return; // Range 선택이 있으면 기본 방향키(선택 축소) 동작에 맡긴다.

    if (e.key === 'ArrowLeft') {
      if (getDescCaretOffset(td) === 0) {
        e.preventDefault();
        if (c > 0) focusCellAt(r, c - 1, true);
        else if (r > 0) focusCellAt(r - 1, colCount - 1, true);
      }
      return;
    }
    if (e.key === 'ArrowRight') {
      if (getDescCaretOffset(td) === td.textContent.length) {
        e.preventDefault();
        if (c + 1 < colCount) focusCellAt(r, c + 1, false);
        else if (r + 1 < rowCount) focusCellAt(r + 1, 0, false);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      if (!isDescTableCaretOnFirstLine(td)) return;
      if (r > 0) { e.preventDefault(); focusCellAt(r - 1, c, false); return; }
      var upText = findAdjacentDescBlockTextEl(block.id, -1);
      if (upText) {
        e.preventDefault();
        upText.focus();
        setDescCaretOffset(upText, upText.textContent.length);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      if (!isDescTableCaretOnLastLine(td)) return;
      if (r < rowCount - 1) { e.preventDefault(); focusCellAt(r + 1, c, false); return; }
      e.preventDefault();
      insertParagraphAfterBlock(item, idx);
    }
  }

  // ---------------------------------------------------------------------
  // 7A: 위치 기반 행·열 삽입/삭제/복제. mutateDescTable의 "끝에 추가/마지막 제거"와
  // contextual menu의 "선택한 행·열 기준 위/아래/좌/우 삽입·삭제·복제"가 모두 이
  // 공용 헬퍼를 쓴다(로직 중복 없음). 호출자가 withHistoryTransaction으로 감싼다.
  // ---------------------------------------------------------------------
  function insertDescTableRowAt(block, atIndex) {
    normalizeDescTableData(block);
    normalizeDescTableSizing(block);
    var cols = getDescTableColCount(block);
    var newRow = [];
    for (var i = 0; i < cols; i++) newRow.push(makeDescTableCell());
    block.tableData.splice(atIndex, 0, newRow);
    block.rowHeights.splice(atIndex, 0, DESC_TABLE_DEFAULT_ROW_HEIGHT);
  }

  function insertDescTableColAt(block, atIndex) {
    normalizeDescTableData(block);
    normalizeDescTableSizing(block);
    block.tableData.forEach(function (row) { row.splice(atIndex, 0, makeDescTableCell()); });
    block.columnWidths.splice(atIndex, 0, DESC_TABLE_DEFAULT_COL_WIDTH);
  }

  function removeDescTableRowAt(block, r) {
    if (block.tableData.length <= 1) return false;
    block.tableData.splice(r, 1);
    block.rowHeights.splice(r, 1);
    return true;
  }

  function removeDescTableColAt(block, c) {
    var cols = getDescTableColCount(block);
    if (cols <= 1) return false;
    block.tableData.forEach(function (row) { row.splice(c, 1); });
    block.columnWidths.splice(c, 1);
    return true;
  }

  function duplicateDescTableRowAt(block, r) {
    if (!block.tableData[r]) return;
    var cloned = block.tableData[r].map(function (cell) { return Object.assign({}, normalizeDescTableCell(cell)); });
    block.tableData.splice(r + 1, 0, cloned);
    block.rowHeights.splice(r + 1, 0, block.rowHeights[r]);
  }

  function duplicateDescTableColAt(block, c) {
    block.tableData.forEach(function (row) {
      if (row[c] === undefined) return;
      row.splice(c + 1, 0, Object.assign({}, normalizeDescTableCell(row[c])));
    });
    block.columnWidths.splice(c + 1, 0, block.columnWidths[c]);
  }

  function mutateDescTable(blockId, action) {
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var block = blocks.find(function (b) { return b.id === blockId; });
    if (!block || !Array.isArray(block.tableData)) return;
    flushDescTextEditSession();
    clearDescTableSelection(); // 행/열 구조가 바뀌면 이전 선택 좌표는 더 이상 유효하지 않다.
    withHistoryTransaction(function () {
      normalizeDescTableData(block);
      normalizeDescTableSizing(block);
      var cols = getDescTableColCount(block);
      // 16: 새 행·열은 항상 기본값(기존 선택 셀 색·너비를 복제하지 않는다) — makeDescTableCell()/
      // DESC_TABLE_DEFAULT_*이 매번 색 없는 새 객체·기본 크기를 만들어 주므로 자연히 만족된다.
      if (action === 'add-row') insertDescTableRowAt(block, block.tableData.length);
      else if (action === 'add-col') insertDescTableColAt(block, cols);
      else if (action === 'remove-row') removeDescTableRowAt(block, block.tableData.length - 1);
      else if (action === 'remove-col') removeDescTableColAt(block, cols - 1);
      block.updatedAt = Date.now();
      item.updatedAt = Date.now();
    });
    state.descriptionEditor = { itemId: item.id, activeBlockId: blockId, selectionStart: null };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  function onDescEditorInput(e) {
    var target = e.target;
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;

    if (target.dataset && target.dataset.mediaCaption) {
      var blocksC = ensureDescriptionBlocks(item);
      var blockC = blocksC.find(function (b) { return b.id === target.dataset.blockId; });
      if (!blockC) return;
      blockC.caption = target.textContent;
      blockC.updatedAt = Date.now();
      ensureDescTextEditSession(item, blockC);
      scheduleDescAutosave(item);
      return;
    }

    if (target.tagName === 'TD') {
      var blockIdT = target.dataset.blockId;
      var blocksT = ensureDescriptionBlocks(item);
      var blockT = blocksT.find(function (b) { return b.id === blockIdT; });
      if (!blockT || !Array.isArray(blockT.tableData)) return;
      var r = Number(target.dataset.row);
      var c = Number(target.dataset.col);
      if (blockT.tableData[r] && blockT.tableData[r][c]) {
        var cellT = normalizeDescTableCell(blockT.tableData[r][c]);
        cellT.text = stripDescZwsp(target.textContent);
        // 7A 13: 셀 inline 서식도 4차와 같은 richTextHTML+plain text fallback 구조를 쓴다.
        cellT.richTextHTML = target.querySelector('*') ? sanitizeDescRichHTML(stripDescZwsp(target.innerHTML)) : null;
        blockT.tableData[r][c] = cellT;
      }
      blockT.updatedAt = Date.now();
      // 7A 8: 셀 내용이 늘어나 행이 커질 수 있으므로 타이핑마다 행 rail 위치를 다시 잰다
      // (구조 재렌더 없이 가벼운 측정만).
      syncDescTableOverlayLayout(activeDetailDrawer.descriptionEditorEl);
      ensureDescTextEditSession(item, blockT);
      scheduleDescAutosave(item);
      return;
    }

    if (!target.classList || !target.classList.contains('desc-block-text')) return;

    var blockId = target.dataset.blockId;
    if (blockId === '__desc_empty__') {
      materializeDescPlaceholderBlock(item, target);
      blockId = target.dataset.blockId;
    }
    var blocks = ensureDescriptionBlocks(item);
    var block = blocks.find(function (b) { return b.id === blockId; });
    if (!block) return;
    // 7: todo 블록은 자기 text가 없다 — 연결된 subtask.text가 실제 데이터다.
    if (block.type === 'todo') {
      var linkedSubtask = getDescTodoSubtask(item, block);
      if (linkedSubtask) {
        linkedSubtask.text = stripDescZwsp(target.textContent);
        linkedSubtask.updatedAt = Date.now();
      }
    } else {
      block.text = stripDescZwsp(target.textContent); // 14: 화면(데이터) 상태는 즉시 갱신, 저장/history만 debounce.
    }
    // 4차: 타이핑 자체는(구조 변경이 아니라) 라이브 편집이므로, 인라인 서식 태그가 있는
    // 동안은 매 입력마다 richTextHTML을 target.innerHTML에서 다시 sanitize해 동기화한다
    // (형식이 하나도 없으면 plain text만 저장해 데이터를 가볍게 유지한다).
    block.richTextHTML = target.querySelector('*') ? sanitizeDescRichHTML(stripDescZwsp(target.innerHTML)) : null;
    block.updatedAt = Date.now();
    ensureDescTextEditSession(item, block);
    scheduleDescAutosave(item);
    if (!e.isComposing) updateDescSlashMenuFromInput(item, block, target);
  }

  function trackDescCaretPosition(e) {
    var target = e.target;
    if (!target.classList || !target.classList.contains('desc-block-text')) return;
    if (!state.descriptionEditor || state.descriptionEditor.activeBlockId !== target.dataset.blockId) return;
    state.descriptionEditor.selectionStart = getDescCaretOffset(target);
  }

  function onDescEditorFocusIn(e) {
    var target = e.target;
    if (!target.dataset || !target.dataset.blockId) return;
    var blockId = target.dataset.blockId;
    if (activeDescSlashMenu && activeDescSlashMenu.blockId !== blockId) closeDescSlashMenu();
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var offset = target.classList.contains('desc-block-text') ? getDescCaretOffset(target) : null;
    state.descriptionEditor = { itemId: item.id, activeBlockId: blockId, selectionStart: offset };
  }

  function onDescEditorFocusOut(e) {
    var target = e.target;
    if (!target.classList) return;
    if (!target.classList.contains('desc-block-text') && target.tagName !== 'TD') return;
    flushDescTextEditSession();
  }

  // 16: Enter/Shift+Enter/Tab/Shift+Tab/Backspace와 slash 메뉴의 방향키·Enter·Escape를
  // 한 곳(컨테이너 위임)에서 처리한다. slash 메뉴가 열려 있으면 그 메뉴가 최우선이다 —
  // DOM 포커스는 여전히 블록 자신에 남아 있으므로(커서 유지), 메뉴 자체로 포커스를
  // 옮기지 않고 이 키다운에서 activeIndex만 바꾼다(aria-activedescendant로 표시).
  function onDescEditorKeydown(e) {
    var target = e.target;
    if (!target.dataset || !target.dataset.blockId) return;
    var blockId = target.dataset.blockId;

    // 캡션은 한 줄짜리 라벨이라 Enter/Escape는 편집 종료(blur)로만 다룬다.
    if (target.dataset.mediaCaption) {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); target.blur(); }
      return;
    }

    // 4차 4: floating toolbar도 slash 메뉴와 같은 성격의 일시적 팝업이므로 Escape로 먼저 닫는다.
    if (e.key === 'Escape' && descFloatingToolbarState && descFloatingToolbarState.blockId === blockId) {
      e.preventDefault();
      e.stopPropagation();
      closeDescFloatingToolbar();
      return;
    }

    if (activeDescSlashMenu && activeDescSlashMenu.blockId === blockId) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveDescSlashMenuActive(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveDescSlashMenuActive(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (activeDescSlashMenu.items.length) { e.preventDefault(); e.stopPropagation(); applyActiveDescSlashItem(); return; }
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDescSlashMenu(); return; }
    }

    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var idx = blocks.findIndex(function (b) { return b.id === blockId; });
    var block = idx !== -1 ? blocks[idx] : null;

    if (target.tagName === 'TD') { onDescTableCellKeydown(e, target, item, idx, block); return; }

    if (target.classList.contains('desc-divider-wrap') || target.classList.contains('desc-attachment')) {
      if (e.key === 'Enter') { e.preventDefault(); insertParagraphAfterBlock(item, idx); }
      return;
    }

    if (!target.classList.contains('desc-block-text')) return;

    // 25: Ctrl/Cmd+B·I·U·Shift+S — 텍스트 선택(caret만으로는 적용 대상이 없으므로 제외)이
    // 있을 때만 동작한다. floating toolbar의 같은 명령과 동일한 실행 경로(runDescFormatCommand)
    // 를 그대로 재사용해 history/save/서식 로직이 한 곳에만 있게 한다.
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      var fmtKey = e.key.toLowerCase();
      var fmtTag = fmtKey === 'b' ? 'STRONG' : fmtKey === 'i' ? 'EM' : fmtKey === 'u' ? 'U' : (fmtKey === 's' && e.shiftKey) ? 'S' : null;
      if (fmtTag) {
        var curSel = window.getSelection();
        if (curSel && curSel.rangeCount && !curSel.isCollapsed && target.contains(curSel.anchorNode)) {
          e.preventDefault();
          descSavedFormatRange = { blockId: blockId, itemId: item.id, textEl: target, range: curSel.getRangeAt(0).cloneRange() };
          runDescFormatCommand(function (textEl, range) { return applyDescInlineFormat(textEl, range, fmtTag); });
        }
        return;
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (blockId === '__desc_empty__') {
        // 22: 설명이 하나도 없는 새 item은 실제 블록 없이 placeholder 하나만 보여준다
        // (렌더 자체는 다른 블록과 동일한 DOM/이벤트 위임을 쓰지만, 데이터에는 아직
        // 없다) — Enter/입력과 동일하게 여기서도 먼저 실제 블록으로 승격해야 Tab이
        // 첫/유일 블록에서도 동작한다.
        materializeDescPlaceholderBlock(item, target);
        blockId = target.dataset.blockId;
      }
      indentDescBlock(item, blockId, e.shiftKey ? -1 : 1);
      return;
    }

    if (e.key === 'Backspace') {
      var sel = window.getSelection();
      var hasSelection = !!(sel && !sel.isCollapsed && target.contains(sel.anchorNode));
      var offset = getDescCaretOffset(target);
      if (!hasSelection && offset === 0) {
        e.preventDefault();
        if (blockId === '__desc_empty__') return; // 실제 블록이 없으면 지울 것도 없다.
        handleDescBackspaceAtStart(item, blockId);
      }
      return;
    }

    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var navSel = window.getSelection();
      if (navSel && navSel.isCollapsed) {
        var goingUp = e.key === 'ArrowUp';
        if (goingUp ? isDescCaretOnFirstLine(target) : isDescCaretOnLastLine(target)) {
          var neighborText = findAdjacentDescBlockTextEl(blockId, goingUp ? -1 : 1);
          if (neighborText) {
            e.preventDefault();
            neighborText.focus();
            setDescCaretOffset(neighborText, goingUp ? neighborText.textContent.length : 0);
          }
        }
      }
      return;
    }

    if (e.key === 'Enter') {
      if (e.isComposing) return; // 17: 한글 조합 확정용 Enter — 블록을 나누지 않는다.
      e.preventDefault();
      if (block && block.type === 'code') {
        if (e.ctrlKey || e.metaKey) insertParagraphAfterBlock(item, idx);
        else insertDescLiteralNewline(target);
        return;
      }
      if (e.shiftKey) {
        insertDescLiteralNewline(target);
        return;
      }
      if (blockId === '__desc_empty__') {
        materializeDescPlaceholderBlock(item, target);
        blockId = target.dataset.blockId;
      }
      handleDescEnter(item, blockId, target);
    }
  }

  // ---------------------------------------------------------------------
  // 3차: 설명 블록 다중선택. 화면에 보이는 순서(=DOM 순서, 접힌 toggle 자식은 애초에
  // DOM에 없으므로 자연히 제외된다)를 기준으로 anchor~클릭 범위를 계산한다.
  // ---------------------------------------------------------------------
  function getVisibleDescBlockIdsInOrder() {
    if (!activeDetailDrawer) return [];
    return Array.prototype.map.call(
      activeDetailDrawer.descriptionEditorEl.querySelectorAll(':scope > .desc-block'),
      function (el) { return el.dataset.blockId; }
    );
  }

  function computeIdRangeInclusive(orderedIds, idA, idB) {
    var ia = orderedIds.indexOf(idA);
    var ib = orderedIds.indexOf(idB);
    if (ia === -1 || ib === -1) return [idB];
    var lo = Math.min(ia, ib);
    var hi = Math.max(ia, ib);
    return orderedIds.slice(lo, hi + 1);
  }

  // 렌더를 통째로 다시 하지 않고 CSS 클래스만 갱신한다 — 선택은 순수 화면 상태라 데이터
  // 변경도, 포커스/캐럿을 건드릴 이유도 없다.
  function syncDescBlockSelectionClasses() {
    if (!activeDetailDrawer) return;
    var selectedIds = state.detailBlockSelection.selectedIds;
    activeDetailDrawer.descriptionEditorEl.querySelectorAll(':scope > .desc-block').forEach(function (el) {
      el.classList.toggle('is-selected', selectedIds.has(el.dataset.blockId));
    });
  }

  function clearDetailBlockSelection() {
    if (!state.detailBlockSelection.selectedIds.size && !state.detailBlockSelection.anchorId) return;
    state.detailBlockSelection.selectedIds = new Set();
    state.detailBlockSelection.anchorId = null;
    syncDescBlockSelectionClasses();
  }

  // 3/4: gutter·핸들·블록 빈 여백·특수 블록의 비편집 영역 클릭만 여기 도달한다(텍스트/표
  // 셀/이미 처리된 액션 버튼 클릭은 onDescEditorClick에서 먼저 걸러진다).
  function blurStaleDescTextFocus() {
    // 핸들/gutter 클릭·marquee는 pointerdown에서 preventDefault해 기존 텍스트 포커스를
    // 브라우저가 자동으로 옮겨주지 않는다(드래그 시작 시 caret이 끊기지 않게 하려는 의도).
    // 그 결과 블록 선택을 만든 뒤에도 document.activeElement가 예전에 편집하던
    // contenteditable에 남아, 이후 Delete/Tab 같은 키보드 단축키가 "텍스트 편집 중"으로
    // 잘못 판정될 수 있다. 선택이 실제로 바뀌는 시점에 그 잔여 포커스를 명시적으로 지운다.
    var ae = document.activeElement;
    if (ae && (ae.closest('.desc-block-text') || ae.tagName === 'TD')) ae.blur();
  }

  function handleDescBlockSelectionClick(e, blockId) {
    blurStaleDescTextFocus();
    var sel = state.detailBlockSelection;
    var visibleIds = getVisibleDescBlockIdsInOrder();
    if (e.shiftKey && sel.anchorId && visibleIds.indexOf(sel.anchorId) !== -1) {
      var range = computeIdRangeInclusive(visibleIds, sel.anchorId, blockId);
      if (e.ctrlKey || e.metaKey) {
        range.forEach(function (id) { sel.selectedIds.add(id); });
      } else {
        sel.selectedIds = new Set(range);
      }
      // anchor는 유지한다(Shift+클릭은 anchor를 바꾸지 않는다).
    } else if (e.ctrlKey || e.metaKey) {
      if (sel.selectedIds.has(blockId)) sel.selectedIds.delete(blockId);
      else sel.selectedIds.add(blockId);
      sel.anchorId = blockId;
    } else {
      sel.selectedIds = new Set([blockId]);
      sel.anchorId = blockId;
    }
    syncDescBlockSelectionClasses();
  }

function onDescEditorClick(e) {
  if (suppressNextDescEditorClick) {
    suppressNextDescEditorClick = false;
    return;
  }

  // 상세 문서 안의 링크를 클릭하면 새 탭으로 연다.
  var linkEl = e.target.closest(
    '.desc-block-text a[href], ' +
    '.desc-table td a[href]'
  );

  if (linkEl) {
    e.preventDefault();
    e.stopImmediatePropagation();

    var href = linkEl.getAttribute('href');

    if (/^mailto:/i.test(href)) {
      window.location.href = href;
    } else {
      window.open(href, '_blank', 'noopener,noreferrer');
    }

    return;
  }

  var toggleBtn = e.target.closest('[data-action="desc-toggle-collapse"]');

    if (toggleBtn) { e.preventDefault(); toggleDescBlockCollapsed(toggleBtn.dataset.blockId); return; }
    var todoBtn = e.target.closest('[data-action="desc-todo-toggle"]');
    if (todoBtn) { e.preventDefault(); toggleDescTodoBlockChecked(todoBtn.dataset.blockId); return; }
    var todoDelBtn = e.target.closest('[data-action="desc-todo-delete"]');
    if (todoDelBtn) { e.preventDefault(); deleteDescTodoBlock(todoDelBtn.dataset.blockId); return; }
    var dlBtn = e.target.closest('[data-action="desc-media-download"]');
    if (dlBtn) { e.preventDefault(); downloadDescMediaBlock(dlBtn.dataset.blockId); return; }
    var replaceBtn = e.target.closest('[data-action="desc-media-replace"]');
    if (replaceBtn) { e.preventDefault(); replaceDescMediaBlock(replaceBtn.dataset.blockId); return; }
    var delBtn = e.target.closest('[data-action="desc-media-delete"]');
    if (delBtn) { e.preventDefault(); deleteDescMediaBlock(delBtn.dataset.blockId); return; }
    var galleryItemDel = e.target.closest('[data-action="desc-media-gallery-item-delete"]');
    if (galleryItemDel) { e.preventDefault(); deleteDescMediaGalleryItem(galleryItemDel.dataset.blockId, galleryItemDel.dataset.mediaItemId); return; }
    var galleryItemSep = e.target.closest('[data-action="desc-media-gallery-item-separate"]');
    if (galleryItemSep) { e.preventDefault(); separateDescMediaGalleryItem(galleryItemSep.dataset.blockId, galleryItemSep.dataset.mediaItemId); return; }
    var addRow = e.target.closest('[data-action="desc-table-add-row"]');
    if (addRow) { e.preventDefault(); mutateDescTable(addRow.dataset.blockId, 'add-row'); return; }
    var addCol = e.target.closest('[data-action="desc-table-add-col"]');
    if (addCol) { e.preventDefault(); mutateDescTable(addCol.dataset.blockId, 'add-col'); return; }
    var remRow = e.target.closest('[data-action="desc-table-remove-row"]');
    if (remRow) { e.preventDefault(); mutateDescTable(remRow.dataset.blockId, 'remove-row'); return; }
    var remCol = e.target.closest('[data-action="desc-table-remove-col"]');
    if (remCol) { e.preventDefault(); mutateDescTable(remCol.dataset.blockId, 'remove-col'); return; }
    var tcBtn = e.target.closest('[data-action="desc-table-text-color"]');
    if (tcBtn) { e.preventDefault(); openDescTableColorPanel(tcBtn.dataset.blockId, 'data-text-color', tcBtn); return; }
    var bgBtn = e.target.closest('[data-action="desc-table-bg-color"]');
    if (bgBtn) { e.preventDefault(); openDescTableColorPanel(bgBtn.dataset.blockId, 'data-background-color', bgBtn); return; }

    // 5A 3 / 7A.1 5·6: 행/열 handle 클릭 = 행/열 전체 선택(드래그는 pointerdown에서 별도로
    // 처리) + 선택이 남아 있으면 바로 옆에 contextual menu를 띄운다. Ctrl/Cmd로 선택을 모두
    // 지웠으면(빈 선택) 메뉴를 연다. 다른 handle을 클릭하면 openDescTableContextMenu가
    // 알아서 기존 메뉴를 닫고 새로 연다(위치·내용 갱신).
    var rowHandle = e.target.closest('.desc-table-rowhandle');

if (rowHandle) {
  clearDetailBlockSelection();

  handleDescTableRowHandleClick(
    e,
    rowHandle.dataset.blockId,
    Number(rowHandle.dataset.rowHandle)
  );

  if (
    state.descTableSelection &&
    state.descTableSelection.cells.size
  ) {
    openDescTableHandleMenu(
      e,
      state.descTableSelection
    );
  } else {
    closeDescTableContextMenu();
  }

  return;
}

var colHandle = e.target.closest('.desc-table-colhandle');

if (colHandle) {
  clearDetailBlockSelection();

  handleDescTableColHandleClick(
    e,
    colHandle.dataset.blockId,
    Number(colHandle.dataset.colHandle)
  );

  if (
    state.descTableSelection &&
    state.descTableSelection.cells.size
  ) {
    openDescTableHandleMenu(
      e,
      state.descTableSelection
    );
  } else {
    closeDescTableContextMenu();
  }

  return;
}

    // 4: 텍스트/표 셀 클릭은 caret 배치가 우선이다 — 블록 선택으로 바뀌지 않고, 오히려
    // 기존 블록 선택이 있었다면 텍스트 편집을 시작하는 것으로 보고 해제한다.
    if (e.target.closest('.desc-block-text') || e.target.closest('.desc-media-caption')) {
      clearDetailBlockSelection();
      clearDescTableSelection();
      return;
    }
    if (e.target.tagName === 'TD') {
      clearDetailBlockSelection();
      handleDescTableCellClick(e, e.target);
      return;
    }
    // 16: video controls·이미지 자체·gallery item 클릭은 블록 선택으로 바뀌지 않는다
    // (표 셀 클릭과 같은 우선순위 — 미디어 자체 조작이 caret/컨트롤 조작보다 앞선다).
    if (e.target.closest('.desc-media-image-wrap') || e.target.closest('.desc-media-video-wrap') || e.target.closest('.desc-media-gallery-item')) {
      clearDetailBlockSelection();
      clearDescTableSelection();
      return;
    }
    // 표 밖 다른 곳(다른 블록의 gutter 등)을 클릭하면 표 선택도 함께 해제한다.
    clearDescTableSelection();
    var blockWrap = e.target.closest('.desc-block');
    if (!blockWrap) return;
    handleDescBlockSelectionClick(e, blockWrap.dataset.blockId);
  }

  function wireDescriptionEditorDelegation(container) {
    container.addEventListener('click', onDescEditorClick);
    container.addEventListener('keydown', onDescEditorKeydown);
    container.addEventListener('input', onDescEditorInput);
    container.addEventListener('focusin', onDescEditorFocusIn);
    container.addEventListener('focusout', onDescEditorFocusOut);
    container.addEventListener('click', trackDescCaretPosition);
    container.addEventListener('keyup', trackDescCaretPosition);
    container.addEventListener('contextmenu', onDescTableContextMenuEvent);
  }

  // ---------------------------------------------------------------------
  // 6/9: 빈 공간·gutter marquee 선택. .detail-body(설명 라벨+desc-editor를 감싸는 영역)에
  // 위임한다 — desc-editor 자신의 콘텐츠 높이보다 .detail-body가 더 클 때(내용이 짧을 때)
  // 도 빈 공간에서 시작할 수 있어야 하기 때문이다. 텍스트/핸들/액션 버튼/표 셀 위에서는
  // 절대 시작하지 않는다(네이티브 텍스트 선택·기존 블록 드래그와 충돌 방지).
  // ---------------------------------------------------------------------
  var detailMarqueeSelectionState = null;
  var detailMarqueeAutoScrollRAF = null;
  var suppressDetailBodyClickAfterMarquee = false;

  function isDetailMarqueeExcludedTarget(target) {
    if (!target || !target.closest) return true;
    return !!(target.closest('.desc-block-text') || target.closest('[contenteditable="true"]') ||
      target.closest('.desc-block-drag') || target.closest('[data-action]') || target.closest('td') ||
      // 5B 16: video controls·이미지·gallery item 조작은 marquee를 시작하지 않는다.
      target.closest('.desc-media-video-wrap') || target.closest('.desc-media-image-wrap') || target.closest('.desc-media-gallery-item'));
  }

  function onDetailBodyPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (descriptionBlockDragState || detailMarqueeSelectionState) return;
    if (isDetailMarqueeExcludedTarget(e.target)) return;
    var bodyEl = e.currentTarget;
    detailMarqueeSelectionState = {
      active: false,
      pending: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      rafScheduled: false,
      additive: !!(e.ctrlKey || e.metaKey),
      initialSelectedIds: new Set(state.detailBlockSelection.selectedIds),
      overlayEl: null,
      bodyEl: bodyEl
    };
    try { bodyEl.setPointerCapture(e.pointerId); } catch (err) {}
    bodyEl.addEventListener('pointermove', onDetailBodyPointerMove);
    bodyEl.addEventListener('pointerup', onDetailBodyPointerUp);
    bodyEl.addEventListener('pointercancel', onDetailBodyPointerCancel);
  }

  function activateDetailMarqueeSelection() {
    var ms = detailMarqueeSelectionState;
    blurStaleDescTextFocus();
    ms.pending = false;
    ms.active = true;
    var overlay = document.createElement('div');
    overlay.className = 'detail-marquee-overlay';
    document.body.appendChild(overlay);
    ms.overlayEl = overlay;
  }

  function updateDetailMarqueeRect() {
    var ms = detailMarqueeSelectionState;
    if (!ms || !ms.overlayEl) return;
    var x1 = Math.min(ms.startX, ms.currentX);
    var y1 = Math.min(ms.startY, ms.currentY);
    var x2 = Math.max(ms.startX, ms.currentX);
    var y2 = Math.max(ms.startY, ms.currentY);
    ms.overlayEl.style.left = x1 + 'px';
    ms.overlayEl.style.top = y1 + 'px';
    ms.overlayEl.style.width = (x2 - x1) + 'px';
    ms.overlayEl.style.height = (y2 - y1) + 'px';
  }

  function updateDetailMarqueeSelection() {
    var ms = detailMarqueeSelectionState;
    if (!ms || !activeDetailDrawer) return;
    var x1 = Math.min(ms.startX, ms.currentX);
    var y1 = Math.min(ms.startY, ms.currentY);
    var x2 = Math.max(ms.startX, ms.currentX);
    var y2 = Math.max(ms.startY, ms.currentY);
    var intersecting = new Set();
    activeDetailDrawer.descriptionEditorEl.querySelectorAll(':scope > .desc-block').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) intersecting.add(el.dataset.blockId);
    });
    var finalSet;
    if (ms.additive) {
      finalSet = new Set(ms.initialSelectedIds);
      intersecting.forEach(function (id) { finalSet.add(id); });
    } else {
      finalSet = intersecting;
    }
    state.detailBlockSelection.selectedIds = finalSet;
    if (finalSet.size) {
      var orderedNow = getVisibleDescBlockIdsInOrder().filter(function (id) { return finalSet.has(id); });
      state.detailBlockSelection.anchorId = orderedNow[0] || null;
    }
    syncDescBlockSelectionClasses();
  }

  function computeDetailMarqueeAutoScroll(y) {
    if (!detailMarqueeSelectionState || !detailMarqueeSelectionState.active || !activeDetailDrawer) return null;
    var container = activeDetailDrawer.drawerEl;
    var rect = container.getBoundingClientRect();
    var edge = AUTOSCROLL_EDGE;
    var distTop = y - rect.top;
    var distBottom = rect.bottom - y;
    var direction = 0;
    var proximity = 0;
    if (distTop >= 0 && distTop < edge) { direction = -1; proximity = (edge - distTop) / edge; }
    else if (distBottom >= 0 && distBottom < edge) { direction = 1; proximity = (edge - distBottom) / edge; }
    else return null;
    var speed = Math.max(2, Math.round(AUTOSCROLL_MAX_SPEED * proximity));
    return { container: container, direction: direction, speed: speed };
  }

  function detailMarqueeAutoScrollTick() {
    detailMarqueeAutoScrollRAF = null;
    if (!detailMarqueeSelectionState || !detailMarqueeSelectionState.active) return;
    var info = computeDetailMarqueeAutoScroll(detailMarqueeSelectionState.currentY);
    if (info) {
      var before = info.container.scrollTop;
      info.container.scrollTop += info.direction * info.speed;
      if (info.container.scrollTop !== before) updateDetailMarqueeSelection();
    }
    detailMarqueeAutoScrollRAF = requestAnimationFrame(detailMarqueeAutoScrollTick);
  }

  function ensureDetailMarqueeAutoScrollLoop() {
    if (detailMarqueeAutoScrollRAF !== null) return;
    detailMarqueeAutoScrollRAF = requestAnimationFrame(detailMarqueeAutoScrollTick);
  }

  function stopDetailMarqueeAutoScroll() {
    if (detailMarqueeAutoScrollRAF !== null) { cancelAnimationFrame(detailMarqueeAutoScrollRAF); detailMarqueeAutoScrollRAF = null; }
  }

  function detailMarqueeRafTick() {
    var ms = detailMarqueeSelectionState;
    if (!ms) return;
    ms.rafScheduled = false;
    updateDetailMarqueeRect();
    updateDetailMarqueeSelection();
    ensureDetailMarqueeAutoScrollLoop();
  }

  function onDetailBodyPointerMove(e) {
    var ms = detailMarqueeSelectionState;
    if (!ms || e.pointerId !== ms.pointerId) return;
    ms.currentX = e.clientX;
    ms.currentY = e.clientY;
    if (ms.pending) {
      var dx = e.clientX - ms.startX;
      var dy = e.clientY - ms.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      activateDetailMarqueeSelection();
    }
    if (!ms.rafScheduled) {
      ms.rafScheduled = true;
      requestAnimationFrame(detailMarqueeRafTick);
    }
  }

  function teardownDetailMarqueeListeners(ms) {
    var bodyEl = ms && ms.bodyEl;
    if (!bodyEl) return;
    bodyEl.removeEventListener('pointermove', onDetailBodyPointerMove);
    bodyEl.removeEventListener('pointerup', onDetailBodyPointerUp);
    bodyEl.removeEventListener('pointercancel', onDetailBodyPointerCancel);
    try { bodyEl.releasePointerCapture(ms.pointerId); } catch (err) {}
  }

  function cleanupDetailMarqueeDom(ms) {
    stopDetailMarqueeAutoScroll();
    if (ms.overlayEl) ms.overlayEl.remove();
  }

  function onDetailBodyPointerUp(e) {
    var ms = detailMarqueeSelectionState;
    if (!ms || e.pointerId !== ms.pointerId) return;
    teardownDetailMarqueeListeners(ms);
    cleanupDetailMarqueeDom(ms);
    // 실제로 드래그가 활성화됐었다면(임계값을 넘어 사각형을 그렸다면) mouseup 뒤에 이어지는
    // 네이티브 'click' 이벤트가 방금 만든 선택을 곧바로 지우지 않도록 억제한다.
    if (ms.active) suppressDetailBodyClickAfterMarquee = true;
    detailMarqueeSelectionState = null;
  }

  function onDetailBodyPointerCancel(e) {
    var ms = detailMarqueeSelectionState;
    if (!ms || e.pointerId !== ms.pointerId) return;
    cancelDetailMarqueeSelection();
  }

  function cancelDetailMarqueeSelection() {
    var ms = detailMarqueeSelectionState;
    if (!ms) return;
    teardownDetailMarqueeListeners(ms);
    cleanupDetailMarqueeDom(ms);
    state.detailBlockSelection.selectedIds = new Set(ms.initialSelectedIds);
    syncDescBlockSelectionClasses();
    if (ms.active) suppressDetailBodyClickAfterMarquee = true;
    detailMarqueeSelectionState = null;
  }

  function wireDetailBodyMarqueeDelegation(bodyEl) {
  bodyEl.addEventListener('pointerdown', onDetailBodyPointerDown);

  // 빈 공간을 그냥 클릭하면 기존 블록 선택만 해제한다.
  bodyEl.addEventListener('click', function (e) {
    if (suppressDetailBodyClickAfterMarquee) {
      suppressDetailBodyClickAfterMarquee = false;
      return;
    }

    if (isDetailMarqueeExcludedTarget(e.target)) return;

    if (e.target.closest('.desc-block')) return;

    clearDetailBlockSelection();
  });
}
  // ---------------------------------------------------------------------
  // 5: 슬래시 명령 메뉴. DOM 포커스는 항상 편집 중인 블록 자신에 남아 있고(커서 유지),
  // 메뉴는 activeIndex + aria-activedescendant로만 "가상 포커스"를 표시한다.
  // ---------------------------------------------------------------------
  function computeDescSlashQuery(text, caretOffset) {
    var i = 0;
    while (i < text.length && text[i] === ' ') i++;
    if (text[i] !== '/') return null;
    if (caretOffset <= i) return null;
    var seg = text.slice(i, caretOffset);
    if (seg.charAt(0) !== '/') return null;
    var query = seg.slice(1);
    if (/\s/.test(query)) return null;
    return query;
  }

  function descSlashIconGlyph(type) {
    var map = { paragraph: 'T', heading1: 'H1', heading2: 'H2', heading3: 'H3', bulleted: '•', numbered: '1.', todo: '☐', toggle: '▶', quote: '"', divider: '—', attachment: '📎', table: '▦', code: '</>' };
    return map[type] || '';
  }

  function positionDescSlashMenu(anchorEl) {
    var ds = activeDescSlashMenu;
    if (!ds) return;
    var rect = getDescCaretRect(anchorEl);
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    ds.el.style.left = '0px';
    ds.el.style.top = '0px';
    var menuRect = ds.el.getBoundingClientRect();
    var top = rect.bottom + 4;
    var left = rect.left;
    if (left + menuRect.width > vw - 8) left = Math.max(8, vw - menuRect.width - 8);
    if (left < 8) left = 8;
    if (top + menuRect.height > vh - 8) top = rect.top - menuRect.height - 4;
    if (top < 8) top = 8;
    ds.el.style.left = left + 'px';
    ds.el.style.top = top + 'px';
  }

  function renderDescSlashMenuItems() {
    var ds = activeDescSlashMenu;
    if (!ds) return;
    var q = ds.query.trim().toLowerCase();
    var filtered = DESC_SLASH_COMMANDS.filter(function (cmd) {
      if (!q) return true;
      return cmd.label.toLowerCase().indexOf(q) !== -1 || cmd.kw.toLowerCase().indexOf(q) !== -1;
    });
    ds.items = filtered;
    if (ds.activeIndex >= filtered.length) ds.activeIndex = 0;
    ds.el.replaceChildren();
    if (!filtered.length) {
      var empty = document.createElement('div');
      empty.className = 'desc-slash-empty';
      empty.textContent = '일치하는 명령이 없습니다.';
      ds.el.appendChild(empty);
      if (ds.anchorEl) ds.anchorEl.removeAttribute('aria-activedescendant');
      return;
    }
    filtered.forEach(function (cmd, i) {
      var row = document.createElement('div');
      row.className = 'desc-slash-item' + (i === ds.activeIndex ? ' is-active' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === ds.activeIndex));
      row.id = 'desc-slash-item-' + i;
      var icon = document.createElement('span');
      icon.className = 'desc-slash-item-icon';
      icon.textContent = descSlashIconGlyph(cmd.type);
      icon.setAttribute('aria-hidden', 'true');
      var labelWrap = document.createElement('span');
      labelWrap.className = 'desc-slash-item-label-wrap';
      var label = document.createElement('span');
      label.className = 'desc-slash-item-label';
      label.textContent = cmd.label;
      labelWrap.appendChild(label);
      if (cmd.desc) {
        var descEl = document.createElement('span');
        descEl.className = 'desc-slash-item-desc';
        descEl.textContent = cmd.desc;
        labelWrap.appendChild(descEl);
      }
      row.appendChild(icon);
      row.appendChild(labelWrap);
      row.addEventListener('mousedown', function (e) {
        e.preventDefault(); // 블록의 포커스/커서를 유지한 채로 선택한다.
        ds.activeIndex = i;
        applyActiveDescSlashItem();
      });
      ds.el.appendChild(row);
    });
    if (ds.anchorEl) ds.anchorEl.setAttribute('aria-activedescendant', 'desc-slash-item-' + ds.activeIndex);
    positionDescSlashMenu(ds.anchorEl);
  }

  function moveDescSlashMenuActive(delta) {
    var ds = activeDescSlashMenu;
    if (!ds || !ds.items.length) return;
    ds.activeIndex = (ds.activeIndex + delta + ds.items.length) % ds.items.length;
    renderDescSlashMenuItems();
  }

  function onOutsideDescSlashMenuPointerDown(e) {
    if (!activeDescSlashMenu) return;
    if (activeDescSlashMenu.el.contains(e.target)) return;
    if (activeDescSlashMenu.anchorEl && activeDescSlashMenu.anchorEl.contains(e.target)) return;
    closeDescSlashMenu();
  }

  function closeDescSlashMenu() {
    if (!activeDescSlashMenu) return;
    var ds = activeDescSlashMenu;
    activeDescSlashMenu = null;
    document.removeEventListener('pointerdown', onOutsideDescSlashMenuPointerDown, true);
    if (ds.anchorEl) {
      ds.anchorEl.removeAttribute('aria-expanded');
      ds.anchorEl.removeAttribute('aria-controls');
      ds.anchorEl.removeAttribute('aria-activedescendant');
    }
    if (ds.el.isConnected) ds.el.remove();
  }

  function openDescSlashMenu(itemId, blockId, query, target) {
    closeDescSlashMenu();
    var menu = document.createElement('div');
    menu.className = 'desc-slash-menu';
    menu.setAttribute('role', 'listbox');
    menu.id = 'desc-slash-menu-' + blockId;
    document.body.appendChild(menu);
    activeDescSlashMenu = { el: menu, itemId: itemId, blockId: blockId, query: query, items: [], activeIndex: 0, anchorEl: target };
    target.setAttribute('aria-expanded', 'true');
    target.setAttribute('aria-controls', menu.id);
    renderDescSlashMenuItems();
    setTimeout(function () {
      document.addEventListener('pointerdown', onOutsideDescSlashMenuPointerDown, true);
    }, 0);
  }

  function updateDescSlashMenuFromInput(item, block, target) {
    var text = target.textContent;
    var offset = getDescCaretOffset(target);
    var query = computeDescSlashQuery(text, offset);
    if (query === null) { closeDescSlashMenu(); return; }
    if (activeDescSlashMenu && activeDescSlashMenu.blockId === block.id) {
      activeDescSlashMenu.query = query;
      renderDescSlashMenuItems();
    } else {
      openDescSlashMenu(item.id, block.id, query, target);
    }
  }

  // 5: '/query' 문자열을 블록 텍스트에서 제거하고 선택한 타입으로 바꾼다. divider는 자신
  // 아래에 새 paragraph를 만들어 포커스를 옮기고, attachment는 파일 선택기를 연다(성공할
  // 때만 실제로 타입이 바뀐다 — 취소/실패 시 paragraph 그대로 남아 빈 첨부 블록이 생기지
  // 않는다).
  function applyDescSlashCommand(itemId, blockId, type) {
    var item = findItemById(itemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var idx = blocks.findIndex(function (b) { return b.id === blockId; });
    if (idx === -1) return;
    var block = blocks[idx];
    var wasTodo = block.type === 'todo';
    var stripped = getDescBlockDisplayText(item, block).replace(/^(\s*)\/\S*/, '$1');
    block.richTextHTML = null; // 4차: 타입 변환은 plain text 기준 재구성이므로 예전 서식은 무효화.

    flushDescTextEditSession();

    // 1: todo에서 다른 타입으로 바뀌면(첨부 포함) 연결된 subtask는 더 이상 쓸모가 없다 —
    // 텍스트는 이미 위에서 새 블록으로 넘겨받았으므로 데이터 손실 없이 정리한다.
    if (wasTodo && type !== 'todo' && block.subtaskId) {
      removeSubtaskById(item, block.subtaskId);
      delete block.subtaskId;
    }

    if (type === 'attachment') {
      block.text = stripped;
      block.updatedAt = Date.now();
      saveItems();
      renderApp();
      openDescAttachmentPicker(itemId, blockId);
      return;
    }

    var focusBlockId = block.id;
    var focusOffset = stripped.length;
    withHistoryTransaction(function () {
      if (type === 'divider') {
        block.type = 'divider';
        block.text = '';
        block.updatedAt = Date.now();
        var afterDivider = makeDescriptionBlock('paragraph', { indent: block.indent });
        blocks.splice(idx + 1, 0, afterDivider);
        focusBlockId = afterDivider.id;
        focusOffset = null;
      } else if (type === 'table') {
        block.type = 'table';
        block.text = '';
        block.tableData = [[makeDescTableCell(), makeDescTableCell()], [makeDescTableCell(), makeDescTableCell()]];
        block.updatedAt = Date.now();
        focusOffset = null;
      } else if (type === 'todo') {
        // 7: todo는 자기 text가 없다 — 지금까지 입력했던 텍스트(슬래시 명령 제외)를 그대로
        // 새 subtask의 초기 텍스트로 넘긴다.
        var newSubtaskForTodo = createLinkedSubtask(item, stripped);
        block.type = 'todo';
        block.subtaskId = newSubtaskForTodo.id;
        delete block.text;
        block.updatedAt = Date.now();
        focusOffset = stripped.length;
      } else {
        block.type = type;
        block.text = stripped;
        block.updatedAt = Date.now();
      }
      syncDescriptionPlainTextMirror(item);
      item.updatedAt = Date.now();
    });

    state.descriptionEditor = { itemId: item.id, activeBlockId: focusBlockId, selectionStart: focusOffset };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  function applyActiveDescSlashItem() {
    var ds = activeDescSlashMenu;
    if (!ds || !ds.items.length) return;
    var cmd = ds.items[ds.activeIndex];
    var blockId = ds.blockId;
    var itemId = ds.itemId;
    closeDescSlashMenu();
    applyDescSlashCommand(itemId, blockId, cmd.type);
  }

  // ---------------------------------------------------------------------
  // 12: 첨부 블록 — 파일 자체는 localStorage가 아니라 IndexedDB(dotdotplanner_files/
  // attachments, key=attachmentId)에 Blob으로 저장한다. descriptionBlocks에는 메타데이터만
  // 남는다.
  // ---------------------------------------------------------------------
  var DESC_ATTACHMENT_DB_NAME = 'dotdotplanner_files';
  var DESC_ATTACHMENT_STORE = 'attachments';
  var descAttachmentDbPromise = null;

  function openDescAttachmentDb() {
    if (descAttachmentDbPromise) return descAttachmentDbPromise;
    descAttachmentDbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      var req = indexedDB.open(DESC_ATTACHMENT_DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DESC_ATTACHMENT_STORE)) db.createObjectStore(DESC_ATTACHMENT_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return descAttachmentDbPromise;
  }

  function saveDescAttachmentBlob(id, blob) {
    return openDescAttachmentDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DESC_ATTACHMENT_STORE, 'readwrite');
        tx.objectStore(DESC_ATTACHMENT_STORE).put(blob, id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getDescAttachmentBlob(id) {
    return openDescAttachmentDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DESC_ATTACHMENT_STORE, 'readonly');
        var req = tx.objectStore(DESC_ATTACHMENT_STORE).get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function deleteDescAttachmentBlob(id) {
    return openDescAttachmentDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DESC_ATTACHMENT_STORE, 'readwrite');
        tx.objectStore(DESC_ATTACHMENT_STORE).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function showDescAttachmentError(itemId, blockId, message) {
    if (!activeDetailDrawer) return;
    var container = activeDetailDrawer.descriptionEditorEl;
    var anchor = container.querySelector('.desc-block-text[data-block-id="' + blockId + '"]') ||
      container.querySelector('.desc-attachment[data-block-id="' + blockId + '"]');
    var wrap = anchor && anchor.closest('.desc-block');
    if (!wrap) return;
    var err = document.createElement('div');
    err.className = 'desc-attachment-error';
    err.textContent = message;
    wrap.appendChild(err);
    setTimeout(function () { if (err.isConnected) err.remove(); }, 4000);
  }

  function descAttachmentUid() { return 'att_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

  // 1/7: slash "/첨부"가 여는 원래 진입점 — 이제 multiple 파일을 지원하고, 시각 미디어
  // 개수에 따라 단일 image/video 블록 · mediaGallery 블록 · attachment 블록으로 나눠
  // 만든다. 파일마다 IndexedDB 저장을 먼저 병렬로 시도하고, "성공한 파일만" 갖고 블록을
  // 만든다(성공 전에는 블록을 먼저 만들지 않는다 — 깨진 attachmentId 방지). 실패한 파일은
  // 개별적으로 오류를 알리고 나머지 성공분은 그대로 살린다.
  function openDescAttachmentPicker(itemId, blockId) {
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var files = input.files ? Array.prototype.slice.call(input.files) : [];
      input.remove();
      if (!files.length) return; // 취소 — 블록은 이미 paragraph 그대로, 빈 블록이 남지 않는다.
      Promise.allSettled(files.map(function (file) {
        var attachmentId = descAttachmentUid();
        return saveDescAttachmentBlob(attachmentId, file).then(function () {
          return { ok: true, attachmentId: attachmentId, name: file.name, size: file.size, mimeType: file.type, kind: descEffectiveMediaKind(file.type, file.name) };
        }, function () {
          return { ok: false, name: file.name };
        });
      })).then(function (settled) {
        var results = settled.map(function (s) { return s.value; });
        var succeeded = results.filter(function (r) { return r.ok; });
        var failed = results.filter(function (r) { return !r.ok; });
        if (succeeded.length) finalizeDescPickedFiles(itemId, blockId, succeeded);
        failed.forEach(function (r) { showDescAttachmentError(itemId, blockId, '"' + r.name + '" 파일을 저장하지 못했습니다.'); });
      });
    });
    input.click();
  }

  // 2/7/8: 성공한 파일 목록(원래 선택 순서)을 받아 규칙대로 블록을 만든다 — 시각 미디어가
  // 1개면 단일 image/video, 2개 이상이면 mediaGallery 하나. 일반 파일은 항상 별도
  // attachment 블록. 트리거였던 blockId(비어 있는 paragraph)는 첫 번째로 만들어지는
  // 블록으로 재활용하고, 나머지는 바로 뒤에 순서대로 삽입한다 — history/save/render는
  // 한 번씩만 수행한다.
  function finalizeDescPickedFiles(itemId, blockId, files) {
    var item = findItemById(itemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var anchorIdx = blocks.findIndex(function (b) { return b.id === blockId; });
    if (anchorIdx === -1) return;
    var visual = files.filter(function (f) { return f.kind === 'image' || f.kind === 'video'; });
    var other = files.filter(function (f) { return f.kind !== 'image' && f.kind !== 'video'; });
    var newBlocks = [];
    if (visual.length === 1) {
      newBlocks.push(makeDescMediaBlock(visual[0].kind, { attachmentId: visual[0].attachmentId, name: visual[0].name, mimeType: visual[0].mimeType, size: visual[0].size, indent: blocks[anchorIdx].indent || 0 }));
    } else if (visual.length >= 2) {
      newBlocks.push(makeDescMediaBlock('mediaGallery', {
        indent: blocks[anchorIdx].indent || 0,
        items: visual.map(function (f) { return makeDescMediaGalleryItem({ attachmentId: f.attachmentId, name: f.name, mimeType: f.mimeType, size: f.size }); })
      }));
    }
    other.forEach(function (f) {
      newBlocks.push(makeDescMediaBlock('attachment', { attachmentId: f.attachmentId, name: f.name, mimeType: f.mimeType, size: f.size, indent: blocks[anchorIdx].indent || 0 }));
    });
    if (!newBlocks.length) return;
    var firstFocusId;
    withHistoryTransaction(function () {
      var first = newBlocks[0];
      var anchorBlock = blocks[anchorIdx];
      first.id = anchorBlock.id; // 트리거 블록 자리를 그대로 재사용(빈 paragraph가 남지 않게).
      first.createdAt = anchorBlock.createdAt;
      blocks[anchorIdx] = first;
      firstFocusId = first.id;
      if (newBlocks.length > 1) blocks.splice.apply(blocks, [anchorIdx + 1, 0].concat(newBlocks.slice(1)));
      enforceDescTrailingParagraph(blocks);
      syncDescriptionPlainTextMirror(item);
      item.updatedAt = Date.now();
    });
    state.descriptionEditor = { itemId: item.id, activeBlockId: firstFocusId, selectionStart: null };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  function downloadDescMediaBlock(blockId) {
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var block = blocks.find(function (b) { return b.id === blockId; });
    var meta = block && getDescMediaMeta(block);
    if (!meta || !meta.attachmentId) return;
    getDescAttachmentBlob(meta.attachmentId).then(function (blob) {
      if (!blob) { showDescAttachmentError(item.id, blockId, '파일을 찾을 수 없습니다.'); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = meta.name || 'attachment';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }).catch(function () {
      showDescAttachmentError(item.id, blockId, '파일을 불러오지 못했습니다.');
    });
  }

  // 14: 삭제 시 IndexedDB Blob을 즉시 지우지 않는다 — Undo/Redo가 참조할 수 있는 동안
  // 데이터 손실을 만들지 않기 위해, 이번 단계에서는 orphan Blob이 남는 쪽을 택한다
  // (완전한 GC는 범위 밖).
  function deleteDescMediaBlock(blockId) {
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var idx = blocks.findIndex(function (b) { return b.id === blockId; });
    if (idx === -1) return;
    flushDescTextEditSession();
    withHistoryTransaction(function () {
      blocks.splice(idx, 1);
      if (!blocks.length) blocks.push(makeDescriptionBlock('paragraph', {}));
      syncDescriptionPlainTextMirror(item);
      item.updatedAt = Date.now();
    });
    var focusTarget = blocks[Math.min(idx, blocks.length - 1)];
    state.descriptionEditor = { itemId: item.id, activeBlockId: focusTarget.id, selectionStart: null };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  // 12: 파일 교체 — 새 파일을 IndexedDB에 먼저 저장하고, 성공한 뒤에야 블록의
  // attachmentId/메타데이터를 바꾼다(실패하면 기존 파일·화면 그대로). 파일 종류가 바뀌면
  // (image<->video<->일반) block.type도 안전하게 맞춰 바꾼다 — 블록 id는 그대로 유지돼
  // 선택·포커스가 끊기지 않는다.
  function replaceDescMediaBlock(blockId) {
    var item = findItemById(state.activeDetailItemId);
    if (!item) return;
    var blocks = ensureDescriptionBlocks(item);
    var block = blocks.find(function (b) { return b.id === blockId; });
    if (!block) return;
    var input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      var attachmentId = descAttachmentUid();
      saveDescAttachmentBlob(attachmentId, file).then(function () {
        var freshBlocks = ensureDescriptionBlocks(item);
        var freshBlock = freshBlocks.find(function (b) { return b.id === blockId; });
        if (!freshBlock) return;
        var oldAttachmentId = freshBlock.attachmentId;
        var kind = descEffectiveMediaKind(file.type, file.name);
        withHistoryTransaction(function () {
          freshBlock.type = kind === 'other' ? 'attachment' : kind;
          freshBlock.attachmentId = attachmentId;
          freshBlock.name = file.name;
          freshBlock.mimeType = file.type;
          freshBlock.size = file.size;
          delete freshBlock.attachmentName;
          delete freshBlock.attachmentType;
          delete freshBlock.attachmentSize;
          freshBlock.updatedAt = Date.now();
          item.updatedAt = Date.now();
        });
        if (oldAttachmentId) revokeDescBlobUrl(oldAttachmentId); // 14: DB blob은 유지, 메모리 URL만 정리.
        descForceRebuild = true;
        saveItems();
        renderApp();
      }).catch(function () {
        showDescAttachmentError(item.id, blockId, '새 파일을 저장하지 못했습니다. 기존 파일을 유지합니다.');
      });
    });
    input.click();
  }

  // ---------------------------------------------------------------------
  // 10: 설명 블록 드래그 — todo를 포함한 모든 블록(하위 할 일도 이제 todo 블록으로 통합돼
  // 이 흐름을 그대로 탄다)이 descriptionBlockDragState 하나로 움직인다. toggle을 옮기면
  // 자식(더 깊은 indent로 이어지는 블록들)도 함께 옮긴다 — 옮기는 동안 anchor+자식 전부를
  // 숨기고(같은 높이 자리 하나만 placeholder로 보여줌), 커밋 시 배열에서 그 구간을 통째로
  // splice해 옮긴다.
  // ---------------------------------------------------------------------
  // 7: 선택된 블록 중 하나의 핸들을 잡으면 선택 전체를 함께 옮긴다. 선택되지 않은 블록의
  // 핸들을 잡으면 그 블록 하나만 새로 선택하고 그것만 옮긴다(기존 단일 드래그와 동일).
  // 각 "루트" 블록이 toggle이면(선택 여부와 무관하게) 자식도 항상 함께 포함한다.
  // 7: 선택(어떤 블록이 그룹으로 옮겨질지)은 여기서 확정하지 않는다 — 단순 클릭(움직임
  // 없이 바로 떼는 경우)은 이 pointerdown 뒤에 이어지는 네이티브 click 이벤트가
  // onDescEditorClick의 Shift/Ctrl 인식 선택 로직으로 처리해야 하므로, 여기서 미리
  // "이 블록 하나만 선택"으로 덮어써 버리면 Shift+클릭 범위선택이 매번 깨진다. 그룹은
  // 실제로 드래그 임계값을 넘어 activateDescBlockDrag()가 호출될 때만 계산한다.
  function onDescBlockDragHandlePointerDown(e, itemId, blockId) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (descriptionBlockDragState) return;
    if (blockId === '__desc_empty__') return;
    flushDescTextEditSession();
    e.preventDefault();

    var anchorRow = document.querySelector('.desc-block[data-block-id="' + blockId + '"]');
    if (!anchorRow) return;
    var listEl = anchorRow.parentElement;
    if (!listEl) return;
    var handle = anchorRow.querySelector('.desc-block-drag');
    if (!handle) return;
    var anchorRect = anchorRow.getBoundingClientRect();

    descriptionBlockDragState = {
      active: false,
      pending: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      rafScheduled: false,
      itemId: itemId,
      blockId: blockId,
      moveBlockIds: null,
      overBlockId: null,
      pointerCurrentlyValid: false,
      handle: handle,
      anchorRow: anchorRow,
      anchorRect: anchorRect,
      grabOffsetX: e.clientX - anchorRect.left,
      grabOffsetY: e.clientY - anchorRect.top,
      previewEl: null,
      placeholderEl: null,
      listEl: listEl,
      hiddenRows: null,
      groupHeight: 0
    };

    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    handle.addEventListener('pointermove', onDescBlockDragPointerMove);
    handle.addEventListener('pointerup', onDescBlockDragPointerUp);
    handle.addEventListener('pointercancel', onDescBlockDragPointerCancel);
  }

  function createDescBlockDragPreview() {
    var ds = descriptionBlockDragState;
    var rect = ds.anchorRect;
    var preview = document.createElement('div');
    preview.className = 'desc-block-drag-preview';
    preview.style.width = rect.width + 'px';
    preview.style.height = rect.height + 'px';
    var clone = ds.anchorRow.cloneNode(true);
    preview.appendChild(clone);
    var extraCount = ds.moveBlockIds.length - 1;
    if (extraCount > 0) {
      var badge = document.createElement('span');
      badge.className = 'desc-block-drag-preview-badge';
      badge.textContent = '+' + extraCount;
      preview.appendChild(badge);
    }
    document.body.appendChild(preview);
    ds.previewEl = preview;
    positionDescBlockDragPreview(ds.startX, ds.startY);
  }

  function positionDescBlockDragPreview(x, y) {
    var ds = descriptionBlockDragState;
    if (!ds || !ds.previewEl) return;
    var left = x - ds.grabOffsetX;
    var top = y - ds.grabOffsetY;
    ds.previewEl.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
  }

  // placeholder는 이동하는 그룹 전체의 합산 높이를 쓴다 — 숨기기(display:none) 전에
  // 미리 각 행의 실제 높이를 재둬야 한다(숨긴 뒤에는 getBoundingClientRect가 0을 준다).
  function createDescBlockPlaceholder() {
    var ds = descriptionBlockDragState;
    var placeholder = document.createElement('div');
    placeholder.className = 'desc-block-drag-placeholder';
    placeholder.style.height = (ds.groupHeight || ds.anchorRect.height) + 'px';
    ds.anchorRow.parentNode.insertBefore(placeholder, ds.anchorRow);
    ds.placeholderEl = placeholder;
    ds.pointerCurrentlyValid = true;
  }

  function getDescBlockDragGroupInfo(ds) {
    var rows = [];
    var totalHeight = 0;
    ds.moveBlockIds.forEach(function (id) {
      var el = ds.listEl.querySelector('.desc-block[data-block-id="' + id + '"]');
      if (el) { rows.push(el); totalHeight += el.getBoundingClientRect().height; }
    });
    return { rows: rows, totalHeight: totalHeight };
  }

  // 7: 실제로 드래그 임계값을 넘는 이 시점에만 "무엇을 함께 옮길지" 확정한다. 이미 잡은
  // 블록이 다중선택(2개 이상)에 포함돼 있으면 선택 전체를, 아니면(선택 안 된 블록의
  // 핸들을 잡았으면) 그 블록 하나만 새로 선택해 그것만 옮긴다. 각 "루트" 블록이
  // toggle이면(선택 여부와 무관하게) 자식도 항상 함께 포함한다.
  function activateDescBlockDrag() {
    var ds = descriptionBlockDragState;
    ds.pending = false;
    ds.active = true;
    document.body.classList.add('desc-block-dnd-active');

    var item = findItemById(ds.itemId);
    var blocks = item ? ensureDescriptionBlocks(item) : [];
    var sel = state.detailBlockSelection;
    var rootIds;
    if (sel.selectedIds.has(ds.blockId) && sel.selectedIds.size > 1) {
      // 이미 다중 선택된 블록을 잡고 드래그하는 경우에만 "그룹 드래그"로 취급한다.
      rootIds = getVisibleDescBlockIdsInOrder().filter(function (id) { return sel.selectedIds.has(id); });
    } else {
      // 선택되지 않은(또는 단일) 블록의 일반 드래그는 이동 그룹 계산에만 로컬로 쓰고,
      // 화면에 보이는 블록 선택 상태(state.detailBlockSelection)는 건드리지 않는다 —
      // 그렇지 않으면 평범한 단일 드래그만으로도 블록이 "선택된" 채로 남아 Escape
      // 우선순위·Delete/Tab 단축키 등 선택 관련 동작에 원치 않게 영향을 준다.
      rootIds = [ds.blockId];
    }
    var moveSet = new Set();
    var moveBlockIds = [];
    rootIds.forEach(function (rootId) {
      var rootIdx = blocks.findIndex(function (b) { return b.id === rootId; });
      if (rootIdx === -1) return;
      if (!moveSet.has(rootId)) { moveSet.add(rootId); moveBlockIds.push(rootId); }
      if (blocks[rootIdx].type === 'toggle') {
        getToggleChildIds(blocks, rootIdx).forEach(function (cid) {
          if (!moveSet.has(cid)) { moveSet.add(cid); moveBlockIds.push(cid); }
        });
      }
    });
    ds.moveBlockIds = moveBlockIds;

    createDescBlockDragPreview();
    var groupInfo = getDescBlockDragGroupInfo(ds);
    ds.hiddenRows = groupInfo.rows;
    ds.groupHeight = groupInfo.totalHeight;
    ds.hiddenRows.forEach(function (el) { el.classList.add('desc-block-drag-hidden'); });
    createDescBlockPlaceholder();
  }

  function updateDescBlockDropTarget(clientY) {
    var ds = descriptionBlockDragState;
    if (!ds || !ds.placeholderEl) return;
    var rows = Array.prototype.slice.call(
      ds.listEl.querySelectorAll(':scope > .desc-block:not(.desc-block-drag-hidden)'));
    var insertBeforeEl = null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) { insertBeforeEl = rows[i]; break; }
    }

    // 5B 9: 단일 image/video 블록을 다른 image/video/mediaGallery 블록의 "가운데 절반"
    // 위로 가져가면(위/아래 25% 가장자리 제외) 재정렬이 아니라 gallery 병합으로 본다 —
    // 기존 insert-before/after 계산·placeholder FLIP은 건드리지 않고, 이 경우에만 별도로
    // placeholder를 잠시 감추고 mergeTargetBlockId를 세팅한다(merge 아닐 땐 항상 null이라
    // 기존 재정렬 동작은 그대로다).
    var mergeTargetId = null;
    if (ds.moveBlockIds && ds.moveBlockIds.length === 1 && isDescBlockDraggedTypeMergeable(ds)) {
      for (var j = 0; j < rows.length; j++) {
        if (!isDescBlockElMergeTarget(rows[j])) continue;
        var mr = rows[j].getBoundingClientRect();
        var bandTop = mr.top + mr.height * 0.25, bandBottom = mr.top + mr.height * 0.75;
        if (clientY >= bandTop && clientY <= bandBottom) { mergeTargetId = rows[j].dataset.blockId; break; }
      }
    }
    ds.mergeTargetBlockId = mergeTargetId;
    rows.forEach(function (el) { el.classList.toggle('desc-block-merge-target', el.dataset.blockId === mergeTargetId); });

    if (mergeTargetId) {
      if (ds.placeholderEl.isConnected) ds.placeholderEl.remove();
      ds.overBlockId = null;
      return;
    }
    var alreadyThere = ds.placeholderEl.parentNode === ds.listEl &&
      ds.placeholderEl.nextElementSibling === (insertBeforeEl || null);
    if (!alreadyThere) moveDescBlockPlaceholderWithFlip(insertBeforeEl);
    ds.overBlockId = (insertBeforeEl && insertBeforeEl.dataset.blockId) ? insertBeforeEl.dataset.blockId : null;
  }

  function isDescBlockDraggedTypeMergeable(ds) {
    var item = findItemById(ds.itemId);
    var block = item && ensureDescriptionBlocks(item).find(function (b) { return b.id === ds.blockId; });
    if (!block) return false;
    var kind = descBlockMediaKind(block);
    return kind === 'image' || kind === 'video';
  }

  function isDescBlockElMergeTarget(el) {
    if (!el.querySelector) return false;
    return !!(el.querySelector('.desc-media-image') || el.querySelector('.desc-media-video') || el.querySelector('.desc-media-gallery'));
  }

  function moveDescBlockPlaceholderWithFlip(insertBeforeEl) {
    var ds = descriptionBlockDragState;
    var placeholder = ds.placeholderEl;
    var listEl = ds.listEl;
    var affected = Array.prototype.slice.call(
      listEl.querySelectorAll(':scope > .desc-block:not(.desc-block-drag-hidden)'));
    var firstRects = new Map();
    affected.forEach(function (el) { firstRects.set(el, el.getBoundingClientRect()); });
    if (insertBeforeEl) listEl.insertBefore(placeholder, insertBeforeEl);
    else listEl.appendChild(placeholder);
    affected.forEach(function (el) {
      var first = firstRects.get(el);
      var last = el.getBoundingClientRect();
      var dy = first.top - last.top;
      if (Math.abs(dy) < 0.5) return;
      el.style.transition = 'none';
      el.style.transform = 'translateY(' + dy + 'px)';
      el.getBoundingClientRect();
      el.style.transition = 'transform ' + FLIP_DURATION + 'ms ease';
      el.style.transform = '';
      clearInlineTransformAfter(el, FLIP_DURATION + 40);
    });
  }

  var descBlockAutoScrollRAF = null;

  function computeDescBlockAutoScroll(y) {
    if (!descriptionBlockDragState || !descriptionBlockDragState.active || !activeDetailDrawer) return null;
    var container = activeDetailDrawer.drawerEl;
    var rect = container.getBoundingClientRect();
    var edge = AUTOSCROLL_EDGE;
    var distTop = y - rect.top;
    var distBottom = rect.bottom - y;
    var direction = 0;
    var proximity = 0;
    if (distTop >= 0 && distTop < edge) { direction = -1; proximity = (edge - distTop) / edge; }
    else if (distBottom >= 0 && distBottom < edge) { direction = 1; proximity = (edge - distBottom) / edge; }
    else return null;
    var speed = Math.max(2, Math.round(AUTOSCROLL_MAX_SPEED * proximity));
    return { container: container, direction: direction, speed: speed };
  }

  function descBlockAutoScrollTick() {
    descBlockAutoScrollRAF = null;
    if (!descriptionBlockDragState || !descriptionBlockDragState.active) return;
    var info = computeDescBlockAutoScroll(descriptionBlockDragState.lastClientY);
    if (!info) return;
    var before = info.container.scrollTop;
    info.container.scrollTop += info.direction * info.speed;
    if (info.container.scrollTop !== before) {
      updateDescBlockDropTarget(descriptionBlockDragState.lastClientY);
      positionDescBlockDragPreview(descriptionBlockDragState.lastClientX, descriptionBlockDragState.lastClientY);
    }
    descBlockAutoScrollRAF = requestAnimationFrame(descBlockAutoScrollTick);
  }

  function ensureDescBlockAutoScrollLoop() {
    if (descBlockAutoScrollRAF !== null) return;
    descBlockAutoScrollRAF = requestAnimationFrame(descBlockAutoScrollTick);
  }

  function stopDescBlockAutoScroll() {
    if (descBlockAutoScrollRAF !== null) { cancelAnimationFrame(descBlockAutoScrollRAF); descBlockAutoScrollRAF = null; }
  }

  function descBlockDragRafTick() {
    if (!descriptionBlockDragState) return;
    descriptionBlockDragState.rafScheduled = false;
    positionDescBlockDragPreview(descriptionBlockDragState.lastClientX, descriptionBlockDragState.lastClientY);
    updateDescBlockDropTarget(descriptionBlockDragState.lastClientY);
    ensureDescBlockAutoScrollLoop();
  }

  function onDescBlockDragPointerMove(e) {
    if (!descriptionBlockDragState || e.pointerId !== descriptionBlockDragState.pointerId) return;
    descriptionBlockDragState.lastClientX = e.clientX;
    descriptionBlockDragState.lastClientY = e.clientY;
    if (descriptionBlockDragState.pending) {
      var dx = e.clientX - descriptionBlockDragState.startX;
      var dy = e.clientY - descriptionBlockDragState.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      activateDescBlockDrag();
    }
    if (!descriptionBlockDragState.rafScheduled) {
      descriptionBlockDragState.rafScheduled = true;
      requestAnimationFrame(descBlockDragRafTick);
    }
  }

  function teardownDescBlockDragListeners(ds) {
    var handle = ds && ds.handle;
    if (!handle) return;
    handle.removeEventListener('pointermove', onDescBlockDragPointerMove);
    handle.removeEventListener('pointerup', onDescBlockDragPointerUp);
    handle.removeEventListener('pointercancel', onDescBlockDragPointerCancel);
    try { handle.releasePointerCapture(ds.pointerId); } catch (err) {}
  }

  function cleanupDescBlockDragDom(ds) {
    stopDescBlockAutoScroll();
    if (ds.previewEl) ds.previewEl.remove();
    if (ds.placeholderEl) ds.placeholderEl.remove();
    (ds.hiddenRows || []).forEach(function (el) { el.classList.remove('desc-block-drag-hidden'); });
    document.body.classList.remove('desc-block-dnd-active');
    if (ds.listEl) Array.prototype.forEach.call(ds.listEl.querySelectorAll('.desc-block-merge-target'), function (el) { el.classList.remove('desc-block-merge-target'); });
  }

  // 5B 9: 단일 image/video 블록을 다른 image/video/mediaGallery 블록의 가운데 절반에
  // 놓으면 재정렬 대신 gallery로 합친다. 원본 블록은 배열에서 제거되므로(splice가 아니라
  // filter) 중복으로 남지 않는다.
  function commitDescMediaMerge(ds) {
    var item = findItemById(ds.itemId);
    var blocks = item && ensureDescriptionBlocks(item);
    var draggedBlock = blocks && blocks.find(function (b) { return b.id === ds.blockId; });
    var targetBlock = blocks && blocks.find(function (b) { return b.id === ds.mergeTargetBlockId; });
    cleanupDescBlockDragDom(ds);
    descriptionBlockDragState = null;
    if (!draggedBlock || !targetBlock || draggedBlock.id === targetBlock.id) { renderApp(); return; }
    var draggedMeta = getDescMediaMeta(draggedBlock);
    var draggedItem = makeDescMediaGalleryItem({ attachmentId: draggedMeta.attachmentId, name: draggedMeta.name, mimeType: draggedMeta.mimeType, size: draggedMeta.size, alt: draggedBlock.alt || '', caption: draggedBlock.caption || '' });
    var focusBlockId;
    withHistoryTransaction(function () {
      var remaining = blocks.filter(function (b) { return b.id !== draggedBlock.id; });
      var targetIdx = remaining.findIndex(function (b) { return b.id === targetBlock.id; });
      if (targetBlock.type === 'mediaGallery') {
        remaining[targetIdx].items = remaining[targetIdx].items.concat([draggedItem]);
        remaining[targetIdx].updatedAt = Date.now();
        focusBlockId = remaining[targetIdx].id;
      } else {
        var targetMeta = getDescMediaMeta(targetBlock);
        var targetItem = makeDescMediaGalleryItem({ attachmentId: targetMeta.attachmentId, name: targetMeta.name, mimeType: targetMeta.mimeType, size: targetMeta.size, alt: targetBlock.alt || '', caption: targetBlock.caption || '' });
        var galleryBlock = makeDescMediaBlock('mediaGallery', { id: targetBlock.id, indent: targetBlock.indent || 0, createdAt: targetBlock.createdAt, items: [targetItem, draggedItem] });
        remaining[targetIdx] = galleryBlock;
        focusBlockId = galleryBlock.id;
      }
      item.descriptionBlocks = remaining;
      syncDescriptionPlainTextMirror(item);
      item.updatedAt = Date.now();
    });
    state.descriptionEditor = { itemId: ds.itemId, activeBlockId: focusBlockId, selectionStart: null };
    descForceRebuild = true;
    saveItems();
    renderApp();
  }

  function abortDescBlockDrag(ds) {
    cleanupDescBlockDragDom(ds);
    if (descriptionBlockDragState === ds) descriptionBlockDragState = null;
  }

  // 13/7: moveBlockIds(anchor + toggle 자식 + 함께 선택된 다른 블록들, 서로 떨어져 있을
  // 수 있음)를 배열에서 한 번에 뽑아 상대 순서를 유지한 채 목표 위치에 통째로 다시
  // 끼워넣는다. drop 대상(overBlockId)은 항상 숨겨진(=이동 그룹) 행을 제외한 나머지
  // 중에서만 고른 것이므로 "그룹 내부로 drop"은 애초에 불가능하다.
  function commitDescBlockDrop(ds) {
    var item = findItemById(ds.itemId);
    var mutated = false;
    if (item) {
      var blocks = ensureDescriptionBlocks(item);
      var moveIdSet = new Set(ds.moveBlockIds);
      var group = [];
      var remaining = [];
      blocks.forEach(function (b) {
        if (moveIdSet.has(b.id)) group.push(b);
        else remaining.push(b);
      });
      if (group.length) {
        withHistoryTransaction(function () {
          var insertAt = remaining.length;
          if (ds.overBlockId) {
            var idx = remaining.findIndex(function (b) { return b.id === ds.overBlockId; });
            if (idx !== -1) insertAt = idx;
          }
          remaining.splice.apply(remaining, [insertAt, 0].concat(group));
          item.descriptionBlocks = remaining;
          syncDescriptionPlainTextMirror(item);
          item.updatedAt = Date.now();
          mutated = true;
        });
      }
    }
    cleanupDescBlockDragDom(ds);
    descriptionBlockDragState = null;
    if (mutated) {
      // 3차: 선택 상태는 이동 후에도 유지한다(이미 state.detailBlockSelection에 그대로
      // 남아 있고, id는 바뀌지 않았으므로 다음 렌더가 자동으로 다시 표시해 준다).
      state.descriptionEditor = { itemId: ds.itemId, activeBlockId: ds.blockId, selectionStart: null };
      descForceRebuild = true;
      saveItems();
    }
    renderApp();
  }

  function finishDescBlockDrop(ds) {
    // 5B 9: 병합 대상 위에서 놓았다면 placeholder가 이미 감춰져 있어 아래 "유효한 drop
    // 위치" 검사와 무관하다 — 재정렬 커밋보다 먼저 분기한다.
    if (ds.mergeTargetBlockId && ds.pointerCurrentlyValid) { commitDescMediaMerge(ds); return; }
    var valid = ds.pointerCurrentlyValid && ds.placeholderEl && ds.placeholderEl.isConnected;
    if (!valid) { abortDescBlockDrag(ds); return; }
    var targetRect = ds.placeholderEl.getBoundingClientRect();
    var preview = ds.previewEl;
    if (!preview) { commitDescBlockDrop(ds); return; }
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      preview.removeEventListener('transitionend', finish);
      commitDescBlockDrop(ds);
    }
    preview.style.transition = 'transform ' + FLIP_DURATION + 'ms ease';
    preview.style.transform = 'translate3d(' + targetRect.left + 'px,' + targetRect.top + 'px,0)';
    preview.addEventListener('transitionend', finish);
    setTimeout(finish, FLIP_DURATION + 80);
  }

  function onDescBlockDragPointerUp(e) {
    if (!descriptionBlockDragState || e.pointerId !== descriptionBlockDragState.pointerId) return;
    var ds = descriptionBlockDragState;
    teardownDescBlockDragListeners(ds);
    stopDescBlockAutoScroll();
    if (!ds.active) {
      // 핸들을 그냥 클릭(움직임 없이)한 경우 — 뒤따르는 네이티브 click 이벤트가
      // onDescEditorClick의 Shift/Ctrl 인식 선택 로직으로 처리하므로 여기서는 아무 것도
      // 하지 않는다(중복 호출 방지 — 특히 Ctrl+클릭은 두 번 토글되면 도로 취소돼 버린다).
      descriptionBlockDragState = null;
      return;
    }
    // 실제로 드래그가 임계값을 넘어 활성화됐다면, mouseup 뒤에 이어지는 네이티브 'click'
    // 이벤트가 여전히 핸들(원래 mousedown 대상)을 향해 발생해 onDescEditorClick의
    // 일반 클릭 선택 로직을 다시 태워 방금 옮긴 블록을 "선택"으로 남기지 않도록 억제한다.
    suppressNextDescEditorClickOnce();
    finishDescBlockDrop(ds);
  }

  function onDescBlockDragPointerCancel(e) {
    if (!descriptionBlockDragState || e.pointerId !== descriptionBlockDragState.pointerId) return;
    var ds = descriptionBlockDragState;
    teardownDescBlockDragListeners(ds);
    abortDescBlockDrag(ds);
  }

  function cancelActiveDescBlockDrag() {
    if (!descriptionBlockDragState) return;
    var ds = descriptionBlockDragState;
    teardownDescBlockDragListeners(ds);
    abortDescBlockDrag(ds);
  }

  // 제목 span은 재사용하지 않고 매번 새로 만든다 — startTitleEdit()이 titleEl.replaceWith(input)로
  // 완전히 다른 노드로 갈아치우는데, 그 함수는 activeDetailDrawer.titleTextEl 참조를 알지
  // 못해 갱신해주지 않는다. 그래서 d.titleTextEl을 직접 믿지 않고, 절대 갈아치워지지 않는
  // 안정적인 부모 컨테이너(headerLeftEl) 안에서 "지금 실제로 들어있는" 요소(span이든 편집이
  // 끝나지 않아 남아있는 input이든)를 매번 다시 찾아서 교체한다.
  function rebuildDetailTitleText(item) {
    var d = activeDetailDrawer;
    var current = d.headerLeftEl.querySelector('.detail-title-text, .title-edit-input');
    var span = document.createElement('span');
    span.className = 'detail-title-text';
    span.setAttribute('role', 'button');
    span.setAttribute('tabindex', '0');
    span.setAttribute('aria-label', '제목 편집');
    span.textContent = item.text;
    span.addEventListener('click', function () {
      if (state.activeDetailItemId) startTitleEdit(state.activeDetailItemId, span);
    });
    span.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && state.activeDetailItemId) {
        e.preventDefault();
        startTitleEdit(state.activeDetailItemId, span);
      }
    });
    if (current) current.replaceWith(span); else d.headerLeftEl.appendChild(span);
    d.titleTextEl = span;
  }

  function renderDetailDrawerContent(item) {
    var d = activeDetailDrawer;
    if (!d) return;
    if (!activeTitleEdit || activeTitleEdit.itemId !== item.id) {
      rebuildDetailTitleText(item);
    }
    renderDescriptionEditor(item);
    // occurrence(다일 일정의 현재 보는 날짜) 기준 — task/memo는 isOccurrenceCompleted가
    // item.completed로 그대로 폴백하므로 동작이 바뀌지 않는다.
    var occ = state.activeDetailOccurrenceDate || item.date;
    // 완료 체크박스 -- Daily/Weekly와 같은 checkboxButton(내부에서 toggleItemCompleted가
    // 참조하는 것과 같은 isOccurrenceCompleted를 그대로 씀)을 제목 맨 앞에 다시 그린다.
    // "완료로 표시" 하단 버튼은 폐지하고 이 체크박스 하나로 대체한다.
    var newCheckbox = checkboxButton(item, occ);
    newCheckbox.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleItemCompleted(item.id, occ);
    });
    if (d.checkboxEl && d.checkboxEl.parentNode) d.checkboxEl.replaceWith(newCheckbox);
    d.checkboxEl = newCheckbox;
    if (
  item.endDate &&
  item.endDate !== item.date
) {
  d.moveDateBtn.textContent =
    '날짜 이동 — ' +
    formatDotDate(item.date) +
    ' - ' +
    formatDotDate(item.endDate);
} else {
  d.moveDateBtn.textContent =
    '날짜 이동 — ' +
    formatDotDate(item.date);
}

d.moveDateBtn.dataset.action = 'move-date';
d.moveDateBtn.dataset.itemId = item.id;

d.timeBtn.textContent =
  formatDetailTimeButtonText(item);

d.timeBtn.dataset.itemId = item.id;
    // 6차 1: 헤더 아이콘도 실제 item.type(task/schedule/memo)에 맞춰 매번 새로 그린다
    // (예전엔 항상 task라 ic-dot을 고정해 둬도 됐지만 이제는 아니다).
    // 7A.1 11/13: Daily·Weekly 행에서 이미 쓰던 typeMenuButton(기존 openTypeMenu/
    // changeItemType 재사용, 새 변환 시스템 아님)을 그대로 써서 이 기호를 실제 버튼으로
    // 승격한다 — 클릭하면 같은 종류 선택 popover가 열린다.
    var newIcon = typeMenuButton(item, 'detail-header-icon', occ);
    newIcon.title = '유형 변경';
    newIcon.addEventListener('click', function (e) {
      e.stopPropagation();
      openTypeMenu(item.id, newIcon);
    });
    if (d.typeIconEl && d.typeIconEl.parentNode) d.typeIconEl.replaceWith(newIcon);
    d.typeIconEl = newIcon;
  }

  function buildDetailDrawerDom() {
    var overlay = document.createElement('div');
    overlay.className = 'detail-overlay';

    var backdrop = document.createElement('div');
    backdrop.className = 'detail-backdrop';
    backdrop.addEventListener('click', function (e) {
  e.preventDefault();
  e.stopPropagation();

  // 잠깐 overlay만 클릭 판정에서 제외해서
  // 현재 마우스 좌표 바로 아래의 실제 요소를 찾는다.
  overlay.style.pointerEvents = 'none';
  var underlyingEl = document.elementFromPoint(e.clientX, e.clientY);
  overlay.style.pointerEvents = '';

  if (!underlyingEl) {
    closeDetailDrawer();
    return;
  }

  // Daily 또는 Weekly의 항목 카드인지 확인한다.
  var itemRow = underlyingEl.closest(
    '.task[data-item-id]:not(.trash-row), ' +
    '.week-card li[data-item-id]'
  );

  // 카드가 아닌 빈 배경을 클릭한 경우에는 기존처럼 닫는다.
  if (!itemRow) {
    closeDetailDrawer();
    return;
  }

  // 클릭 피드백: 카드가 잠깐 회색으로 보이게 한다.
  itemRow.classList.add('hover');
  setTimeout(function () {
    if (itemRow.isConnected) itemRow.classList.remove('hover');
  }, 140);

  // 아래 요소의 기존 클릭 이벤트를 그대로 실행한다.
  // 제목 클릭, 체크박스, 종류 기호, 날짜 이동 등의 기존 분기를 재사용한다.
  underlyingEl.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: e.clientX,
    clientY: e.clientY,
    button: 0,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey
  }));
});

    var drawer = document.createElement('div');
    drawer.className = 'detail-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', '할 일 상세');

    var header = document.createElement('div');
    header.className = 'detail-header';
    var headerLeft = document.createElement('div');
    headerLeft.className = 'detail-header-left';
    // 실제 체크박스·아이콘은 renderDetailDrawerContent가 매번 checkboxButton/typeMenuButton으로
    // 다시 그린다 -- 여기서는 첫 렌더 전까지 자리만 차지할 임시 placeholder만 넣어 둔다.
    // 배치 순서: [완료 체크박스] [종류 기호] [제목].
    var checkboxPlaceholder = document.createElement('button');
    checkboxPlaceholder.type = 'button';
    checkboxPlaceholder.className = 'checkbox';
    var typeIcon = document.createElement('span');
    typeIcon.className = 'ic-dot detail-header-icon';
    var titleText = document.createElement('span');
    titleText.className = 'detail-title-text';
    titleText.setAttribute('role', 'button');
    titleText.setAttribute('tabindex', '0');
    titleText.setAttribute('aria-label', '제목 편집');
    headerLeft.appendChild(checkboxPlaceholder);
    headerLeft.appendChild(typeIcon);
    headerLeft.appendChild(titleText);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'detail-close-btn';
    closeBtn.setAttribute('aria-label', '상세창 닫기');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function () { closeDetailDrawer(); });

    header.appendChild(headerLeft);
    header.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'detail-body';
    wireDetailBodyMarqueeDelegation(body);
    // 7A.1 9: 표 contextual menu/색상 패널은 화면 좌표에 고정 배치되므로 모달 스크롤을
    // 따라오지 못한다 — 살아있는 위치를 다시 계산하는 대신(불필요한 복잡도) 스크롤 시 닫는다.
    body.addEventListener('scroll', function () {
      if (descFloatingToolbarState && (descFloatingToolbarState.blockId === '__table_context_menu__' || descFloatingToolbarState.blockId === '__table_color__')) {
        closeDescFloatingToolbar();
      }
    }, { passive: true });

    var descLabel = document.createElement('div');
    descLabel.className = 'detail-section-label';
    descLabel.textContent = '설명';
    var descEditor = document.createElement('div');
    // 링크 hover 주소 미리보기
var linkPreview = document.createElement('div');
linkPreview.className = 'desc-link-preview';
linkPreview.setAttribute('role', 'tooltip');
linkPreview.setAttribute('aria-hidden', 'true');

var linkPreviewIcon = document.createElement('span');
linkPreviewIcon.className = 'desc-link-preview-icon';
linkPreviewIcon.textContent = '🔗';
linkPreviewIcon.setAttribute('aria-hidden', 'true');

var linkPreviewUrl = document.createElement('span');
linkPreviewUrl.className = 'desc-link-preview-url';

linkPreview.appendChild(linkPreviewIcon);
linkPreview.appendChild(linkPreviewUrl);

var linkPreviewTimer = null;
var activePreviewLink = null;
var lastPreviewPointerX = 0;
var lastPreviewPointerY = 0;

function positionDescLinkPreview(clientX, clientY) {
  if (!linkPreview.classList.contains('open')) return;

  var gapX = 14;
  var gapY = 12;
  var edge = 8;
  var rect = linkPreview.getBoundingClientRect();

  // 기본 위치: 커서의 오른쪽 위
  var left = clientX + gapX;
  var top = clientY - rect.height - gapY;

  // 오른쪽 화면 밖으로 나가면 커서 왼쪽으로 전환
  if (left + rect.width > window.innerWidth - edge) {
    left = clientX - rect.width - gapX;
  }

  // 위쪽 공간이 부족하면 커서 아래쪽으로 전환
  if (top < edge) {
    top = clientY + 18;
  }

  // 최종 화면 경계 보정
  left = Math.max(edge, Math.min(left, window.innerWidth - rect.width - edge));
  top = Math.max(edge, Math.min(top, window.innerHeight - rect.height - edge));

  linkPreview.style.left = left + 'px';
  linkPreview.style.top = top + 'px';
}

function hideDescLinkPreview() {
  if (linkPreviewTimer) {
    clearTimeout(linkPreviewTimer);
    linkPreviewTimer = null;
  }

  activePreviewLink = null;
  linkPreview.classList.remove('open');
  linkPreview.setAttribute('aria-hidden', 'true');
}

descEditor.addEventListener('pointerover', function (e) {
  // 터치에서는 hover 미리보기를 사용하지 않는다.
  if (e.pointerType === 'touch') return;

  var link = e.target.closest && e.target.closest('a[href]');

  if (
    !link ||
    !descEditor.contains(link) ||
    !link.closest('.desc-block-text, .desc-table td')
  ) {
    return;
  }

  // 같은 링크 내부에서 자식 요소 사이를 이동한 경우 다시 열지 않는다.
  if (activePreviewLink === link) return;

  hideDescLinkPreview();

  var href = link.getAttribute('href');
  if (!href) return;

  activePreviewLink = link;
  lastPreviewPointerX = e.clientX;
  lastPreviewPointerY = e.clientY;

  // 짧게 머물렀을 때만 표시해 지나갈 때 깜빡이지 않게 한다.
  linkPreviewTimer = setTimeout(function () {
    if (activePreviewLink !== link || !link.isConnected) return;

    linkPreviewUrl.textContent = href;
    linkPreview.title = href;
    linkPreview.classList.add('open');
    linkPreview.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(function () {
      positionDescLinkPreview(
        lastPreviewPointerX,
        lastPreviewPointerY
      );
    });
  }, 150);
});

descEditor.addEventListener('pointermove', function (e) {
  if (!activePreviewLink) return;

  lastPreviewPointerX = e.clientX;
  lastPreviewPointerY = e.clientY;

  positionDescLinkPreview(e.clientX, e.clientY);
});

descEditor.addEventListener('pointerout', function (e) {
  var link = e.target.closest && e.target.closest('a[href]');
  if (!link || link !== activePreviewLink) return;

  // 링크 내부의 다른 자식 요소로 이동한 것은 실제 이탈이 아니다.
  if (e.relatedTarget && link.contains(e.relatedTarget)) return;

  hideDescLinkPreview();
});

descEditor.addEventListener('pointerleave', hideDescLinkPreview);

// 모달을 스크롤할 때 이전 위치에 미리보기가 남지 않게 한다.
body.addEventListener('scroll', hideDescLinkPreview, {
  passive: true
});
    descEditor.className = 'desc-editor';
    descEditor.setAttribute('aria-label', '설명');
    wireDescriptionEditorDelegation(descEditor);

    // 7: 기존 "하위 할 일" 전용 섹션(라벨+목록+추가버튼)은 제거한다 — 하위 할 일은 이제
    // desc-editor 안의 todo 블록으로 통합돼 다른 블록과 자유롭게 섞인다(중복 표시 금지).
    body.appendChild(descLabel);
    body.appendChild(descEditor);

    // 24: 문서와 분리된 별도 섹션이 아니라, todo 블록을 빠르게 추가하는 보조 진입점 하나만
    // 문서 바로 아래에 둔다(생성된 todo 자체는 다른 블록과 동일하게 자유 이동/선택된다).
    var addTodoBtn = document.createElement('button');
    addTodoBtn.type = 'button';
    addTodoBtn.className = 'desc-add-todo-btn';
    addTodoBtn.dataset.action = 'desc-add-todo';
    addTodoBtn.textContent = '+ 하위 할 일 추가';
    addTodoBtn.addEventListener('click', function () {
      if (state.activeDetailItemId) quickAddDescTodo(state.activeDetailItemId);
    });
    body.appendChild(addTodoBtn);

    var footer = document.createElement('div');
footer.className = 'detail-footer';

// "완료로 표시" 버튼은 폐지됐다 -- 완료 전환은 이제 제목 앞 체크박스(renderDetailDrawerContent)
// 하나로만 한다. 자리를 비워두지 않도록 날짜 이동 버튼이 바로 첫 번째로 온다.
var moveDateBtn =
  document.createElement('button');

moveDateBtn.type = 'button';
moveDateBtn.className = 'detail-action-btn';

moveDateBtn.addEventListener('click', function () {
  var item = findItemById(
    state.activeDetailItemId
  );

  if (item) {
    handleMoveDateClick(
      item.id,
      moveDateBtn
    );
  }
});

var timeBtn =
  document.createElement('button');

timeBtn.type = 'button';
timeBtn.className = 'detail-action-btn';
timeBtn.setAttribute(
  'aria-haspopup',
  'dialog'
);
timeBtn.setAttribute(
  'aria-expanded',
  'false'
);

timeBtn.addEventListener('click', function () {
  var item = findItemById(
    state.activeDetailItemId
  );

  if (item) {
    openDetailTimeMenu(
      item.id,
      timeBtn
    );
  }
});

var trashBtn =
  document.createElement('button');

trashBtn.type = 'button';
trashBtn.className =
  'detail-action-btn detail-trash-btn';

trashBtn.textContent = '휴지통으로 이동';

trashBtn.addEventListener('click', function () {
  var item = findItemById(
    state.activeDetailItemId
  );

  if (item) {
    softDeleteItems([item.id]);
  }
});

footer.appendChild(moveDateBtn);
footer.appendChild(timeBtn);
footer.appendChild(trashBtn);

    drawer.appendChild(header);
    drawer.appendChild(body);
    drawer.appendChild(footer);
    overlay.appendChild(backdrop);
    overlay.appendChild(drawer);
    overlay.appendChild(linkPreview);
    document.body.appendChild(overlay);

    document.addEventListener('keydown', onDetailDrawerKeydown, true);
    

    activeDetailDrawer = {
      overlayEl: overlay, backdropEl: backdrop, drawerEl: drawer,
      headerLeftEl: headerLeft, titleTextEl: titleText, typeIconEl: typeIcon,
      checkboxEl: checkboxPlaceholder, closeBtn: closeBtn,
      descriptionEditorEl: descEditor,
     moveDateBtn: moveDateBtn, timeBtn: timeBtn, trashBtn: trashBtn,
      returnFocusEl: document.activeElement
    };
  }

  // 6차 1: task·schedule·memo 모두 같은 상세 모달을 연다(더 이상 task 전용이 아니다).
  function openDetailDrawer(itemId, occurrenceDate) {
    var item = findItemById(itemId);
    if (!item || item.deletedAt) return;
    var occ = occurrenceDate || item.date;
    if (state.activeDetailItemId === itemId && activeDetailDrawer) {
      // 6차 9: 같은 item을 다른 occurrence(다일 일정의 다른 날짜 칸)에서 다시 열었을
      // 뿐이면 문서 상태를 재생성하지 않고 occurrence만 갱신한다.
      if (state.activeDetailOccurrenceDate !== occ) {
        state.activeDetailOccurrenceDate = occ;
        renderDetailDrawerContent(item);
      }
      return;
    }
    // 14: 다른 항목으로 전환하기 전, 이전 항목의 설명 블록에 아직 반영되지 않은
    // debounce 저장/history가 있으면 먼저 흘려보낸다.
    if (activeDetailDrawer && state.activeDetailItemId && state.activeDetailItemId !== itemId) {
      flushDescriptionEditorPending(findItemById(state.activeDetailItemId));
      closeDescSlashMenu();
      closeDescFloatingToolbar(); // 6차 9: close 경로와 동일하게 toolbar도 정리한다.
      descSavedFormatRange = null;
      clearDetailBlockSelection(); // 3: 다른 item의 모달을 열면 블록 선택을 초기화한다.
      state.descTableSelection = null; // 5A: 표 셀 선택도 함께 초기화한다.
      revokeAllDescBlobUrls(); // 5B 13: 이전 item의 미디어 URL은 더 이상 화면에 없으므로 정리한다.
      lastRenderedDescriptionItemId = null; // 6차 9: 다음 렌더가 무조건 다시 그리게 한다.
    }
    var isFirstOpen = !activeDetailDrawer;
    state.activeDetailItemId = itemId;
    state.activeDetailOccurrenceDate = occ;
    if (isFirstOpen) buildDetailDrawerDom();
    renderDetailDrawerContent(item);
    if (isFirstOpen) {
      requestAnimationFrame(function () {
        if (activeDetailDrawer) activeDetailDrawer.overlayEl.classList.add('open');
      });
      requestAnimationFrame(function () {
        if (activeDetailDrawer) activeDetailDrawer.closeBtn.focus();
      });
    }
  }

  function closeDetailDrawer() {
    if (!activeDetailDrawer) return;
    // 15: 드래그·marquee 진행 중에는 backdrop 클릭 등으로도 drawer가 닫히지 않는다.
    if (descriptionBlockDragState || detailMarqueeSelectionState || descTableDragState || descMediaGalleryDragState || descTableRangeSelectState || descTableResizeState) return;
    // 14: 아직 반영되지 않은 설명 블록의 debounce 저장/history를 닫기 직전 즉시 흘려보낸다
    // (마지막 입력이 유실되지 않게).
    var closingItem = state.activeDetailItemId ? findItemById(state.activeDetailItemId) : null;
    flushDescriptionEditorPending(closingItem);

if (activeDetailTimeMenu) {
  closeDetailTimeMenu(false);
}

closeDescSlashMenu();
    closeDescFloatingToolbar(); // 4차 4: 모달을 닫으면 floating toolbar도 함께 정리한다.
    descSavedFormatRange = null;
    clearDetailBlockSelection(); // 3: 모달을 닫으면 블록 선택을 초기화한다.
    state.descTableSelection = null; // 5A: 표 셀 선택도 세션 한정이므로 모달을 닫으면 초기화한다.
    revokeAllDescBlobUrls(); // 5B 13: 모달이 닫히면 관련 DOM도 전부 사라지므로 이 시점에 한꺼번에 revoke한다.
    lastRenderedDescriptionItemId = null;
    var refs = activeDetailDrawer;
    activeDetailDrawer = null;
    state.activeDetailItemId = null;
    state.activeDetailOccurrenceDate = null;
    if (activeTitleEdit && refs.drawerEl.contains(activeTitleEdit.inputEl)) activeTitleEdit = null;
    document.removeEventListener('keydown', onDetailDrawerKeydown, true);
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function removeNow() { if (refs.overlayEl.isConnected) refs.overlayEl.remove(); }
    if (reduceMotion) {
      removeNow();
    } else {
      refs.overlayEl.classList.remove('open');
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        refs.drawerEl.removeEventListener('transitionend', finish);
        removeNow();
      }
      refs.drawerEl.addEventListener('transitionend', finish);
      setTimeout(finish, 260);
    }

    if (refs.returnFocusEl && refs.returnFocusEl.isConnected) refs.returnFocusEl.focus();
  }

  // renderApp() 끝에서 항상 호출된다. drawer가 열려 있지 않으면 아무 것도 하지 않고(=여기서
  // 새로 열지 않음, open은 사용자 클릭에서만), 열려 있는데 대상 항목이 삭제되었거나 더 이상
  // task가 아니게 되면(이론상으로만 가능) 자동으로 닫는다. 그 외에는 내용만 최신화한다.
  function syncDetailDrawer() {
    if (!activeDetailDrawer) return;
    var item = state.activeDetailItemId ? findItemById(state.activeDetailItemId) : null;
    // 6차 1: task/schedule/memo 전부 유효한 상세 대상이므로 더 이상 type으로 자동 닫지
    // 않는다 — 삭제(휴지통 이동 포함)됐을 때만 닫는다.
    if (!item || item.deletedAt) {
      closeDetailDrawer();
      return;
    }
    renderDetailDrawerContent(item);
  }

  // ---------------------------------------------------------------------
  // 오른쪽 화살표 → 날짜 이동 팝업
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
// 상세 패널 시간 수정 팝업
// ---------------------------------------------------------------------
var activeDetailTimeMenu = null;
// { el, anchorEl, itemId, allDayCheck, startBtn, endBtn }

var activeDetailItemTimeWheel = null;
// { el, anchorEl, itemId, field, period, hour, minute, settleTimers, onConfirm, closeParentOnConfirm }

// 상세 패널 시간 입력 형식("am 09:15")의 오전오후/시/분 세그먼트 경계 -- 상단 메인 시간
// 입력("AM  09:00")과 공백 수·대소문자가 달라 문자 위치가 다르므로 별도 테이블을 쓴다.
var DETAIL_TIME_INPUT_SEGMENTS = [
  { unit: 'period', start: 0, end: 2 },
  { unit: 'hour', start: 3, end: 5 },
  { unit: 'minute', start: 6, end: 8 }
];

// 진단(수동 편집 이력 검토): 시간 입력칸의 'focus' 리스너가 매번 openWheelForInput을 부르는데,
// 휠을 닫으면서(Escape/Enter 커밋 등) 프로그램적으로 그 입력칸에 다시 focus()를 주는 여러
// 지점(closeDetailItemTimeWheel, commitTypedTime)이 있어 "닫자마자 같은 focus 이벤트로 곧바로
// 재오픈"되는 루프가 있었다(실제 재현 확인 — Escape를 눌러도 휠이 안 닫히는 것처럼 보였다).
// 그 프로그램적 focus() 호출을 이 플래그로만 감싸 "재오픈 금지"를 표시한다 — focus 복원 자체
// (접근성상 필요)는 그대로 유지한다.
var suppressDetailItemTimeWheelReopen = false;

function formatDetailTimeButtonText(item) {
  if (
    item.allDay !== false ||
    (!item.startTime && !item.endTime)
  ) {
    return '시간';
  }

  if (item.startTime && item.endTime) {
    return (
      '시간 — ' +
      formatTime12(item.startTime) +
      ' - ' +
      formatTime12(item.endTime)
    );
  }

  return (
    '시간 — ' +
    formatTime12(item.startTime || item.endTime)
  );
}

function refreshDetailTimeDisplays(item) {
  saveItems();

  if (
    activeDetailDrawer &&
    activeDetailDrawer.timeBtn &&
    state.activeDetailItemId === item.id
  ) {
    activeDetailDrawer.timeBtn.textContent =
      formatDetailTimeButtonText(item);
  }

  renderDailyList();
  renderWeekly();
}

function saveDetailItemTime(itemId, field, newTime) {
  var current = findItemById(itemId);
  if (!current || current.deletedAt) return null;

  withHistoryTransaction(function () {
    current.allDay = false;

    if (field === 'start') {
      current.startTime = newTime;

      if (
        current.endTime &&
        (current.endDate || current.date) === current.date &&
        current.endTime < current.startTime
      ) {
        current.endTime = current.startTime;
      }
    } else {
      if (!current.startTime) {
        current.startTime = '09:00';
      }

      current.endTime = newTime;

      if (
        (current.endDate || current.date) === current.date &&
        current.endTime < current.startTime
      ) {
        current.endTime = current.startTime;
      }
    }

    current.updatedAt = Date.now();
  });

  refreshDetailTimeDisplays(current);
  return current;
}

function saveDetailItemAsAllDay(itemId) {
  var current = findItemById(itemId);
  if (!current || current.deletedAt) return null;

  withHistoryTransaction(function () {
    current.allDay = true;
    current.startTime = null;
    current.endTime = null;
    current.updatedAt = Date.now();
  });

  refreshDetailTimeDisplays(current);
  return current;
}

function onOutsideDetailItemTimeWheelPointerDown(e) {
  if (!activeDetailItemTimeWheel) return;
  if (activeDetailItemTimeWheel.el.contains(e.target)) return;
  if (
    activeDetailItemTimeWheel.anchorEl &&
    activeDetailItemTimeWheel.anchorEl.contains(e.target)
  ) {
    return;
  }

  closeDetailItemTimeWheel(false);
}

function onDetailItemTimeWheelKeydown(e) {
  if (!activeDetailItemTimeWheel) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeDetailItemTimeWheel();
  }
}

function closeDetailItemTimeWheel(restoreFocus) {
  if (!activeDetailItemTimeWheel) return;

  var wheel = activeDetailItemTimeWheel;
  var anchorEl = wheel.anchorEl;

  Object.keys(wheel.settleTimers).forEach(function (unit) {
    if (wheel.settleTimers[unit]) {
      clearTimeout(wheel.settleTimers[unit]);
    }
  });

  if (wheel.numBufferTimer) {
    clearTimeout(wheel.numBufferTimer);
  }

  wheel.el.remove();

  document.removeEventListener(
    'pointerdown',
    onOutsideDetailItemTimeWheelPointerDown,
    true
  );

  document.removeEventListener(
    'keydown',
    onDetailItemTimeWheelKeydown,
    true
  );

  activeDetailItemTimeWheel = null;

  if (!wheel.confirmed && typeof wheel.onCancel === 'function') {
    wheel.onCancel();
  }

  if (anchorEl) {
    anchorEl.setAttribute('aria-expanded', 'false');
  }

  if (
    restoreFocus !== false &&
    anchorEl &&
    anchorEl.isConnected
  ) {
    // 이 focus()가 입력칸 자신의 'focus' 리스너를 다시 트리거해 방금 닫은 휠을 즉시
    // 재오픈하지 않도록 감싼다 — 실제 재현된 버그였다(Escape를 눌러도 휠이 닫히지
    // 않는 것처럼 보이는 원인). focus 복원 자체(접근성)는 그대로 유지한다.
    suppressDetailItemTimeWheelReopen = true;
    anchorEl.focus();
    suppressDetailItemTimeWheelReopen = false;
  }
}

function getDetailItemTimeWheelIndex(col, unit) {
  var items = Array.prototype.slice.call(
    col.querySelectorAll('.date-wheel-item')
  );

  var value = activeDetailItemTimeWheel[unit];

  var idx = items.findIndex(function (item) {
    return item.dataset.value === String(value);
  });

  return idx === -1 ? 0 : idx;
}

function setDetailItemTimeWheelIndex(col, unit, idx, smooth) {
  if (!activeDetailItemTimeWheel) return;

  var items = Array.prototype.slice.call(
    col.querySelectorAll('.date-wheel-item')
  );

  if (!items.length) return;

  idx = Math.max(0, Math.min(items.length - 1, idx));

  col.scrollTo({
    top: idx * DATE_WHEEL_ITEM_HEIGHT,
    behavior: smooth ? 'smooth' : 'auto'
  });

  updateWheelColumnVisual(col, idx);

  var raw = items[idx].dataset.value;

  activeDetailItemTimeWheel[unit] =
    unit === 'period' ? raw : Number(raw);
    syncDetailItemTimeInputFromWheel();
}
function syncDetailItemTimeInputFromWheel() {
  if (!activeDetailItemTimeWheel) return;

  var input =
    activeDetailItemTimeWheel.anchorEl;

  if (!input || !input.isConnected) {
    return;
  }

  var time24 = to24Hour(
    activeDetailItemTimeWheel.period,
    activeDetailItemTimeWheel.hour,
    activeDetailItemTimeWheel.minute
  );

  input.value =
    formatDetailTimeEditorValue(time24);

  input.classList.remove(
    'is-placeholder',
    'is-invalid'
  );

  input.removeAttribute(
    'aria-invalid'
  );

  // 종료 시간 휠은 확정(분 클릭/Enter) 전에도 위에서 이미 is-placeholder를 지워 입력칸이
  // 실제 시간처럼 보이는데, X 삭제 버튼은 확정 시점(setInputDisplay)에만 갱신돼 "입력칸엔
  // 시간이 보이는데 X만 안 보이는" 화면 불일치가 있었다(실제 재현된 버그). 같은 시점에
  // 함께 보여준다 -- 아직 확정 전 임시 상태이므로 항목 데이터는 여기서 건드리지 않고,
  // Escape 취소 시에는 restoreInputFromItem이 실제 저장값 기준으로 다시 감춘다.
  if (activeDetailItemTimeWheel.field === 'end') {
    var clearBtn = input.nextElementSibling;
    if (clearBtn && clearBtn.classList.contains('detail-time-clear-btn')) {
      clearBtn.hidden = false;
    }
  }
}
function settleDetailItemTimeWheelColumn(col, unit) {
  if (!activeDetailItemTimeWheel) return;

  var items = Array.prototype.slice.call(
    col.querySelectorAll('.date-wheel-item')
  );

  if (!items.length) return;

  var idx = Math.round(
    col.scrollTop / DATE_WHEEL_ITEM_HEIGHT
  );

  setDetailItemTimeWheelIndex(
    col,
    unit,
    idx,
    false
  );
}

function syncDetailItemTimeWheelColumnsToState() {
  if (!activeDetailItemTimeWheel) return;

  var popup = activeDetailItemTimeWheel.el;
  var periodCol = popup.querySelector('.date-wheel-col[data-unit="period"]');
  var hourCol = popup.querySelector('.date-wheel-col[data-unit="hour"]');
  var minuteCol = popup.querySelector('.date-wheel-col[data-unit="minute"]');

  if (periodCol) {
    scrollColumnToValue(periodCol, activeDetailItemTimeWheel.period, false);
  }
  if (hourCol) {
    scrollColumnToValue(hourCol, activeDetailItemTimeWheel.hour, false);
  }
  if (minuteCol) {
    scrollColumnToValue(minuteCol, activeDetailItemTimeWheel.minute, false);
  }
}

function clearDetailItemTimeNumBuffer() {
  if (!activeDetailItemTimeWheel) return;

  activeDetailItemTimeWheel.numBuffer = '';
  activeDetailItemTimeWheel.numBufferUnit = null;

  if (activeDetailItemTimeWheel.numBufferTimer) {
    clearTimeout(activeDetailItemTimeWheel.numBufferTimer);
    activeDetailItemTimeWheel.numBufferTimer = null;
  }
}

function scheduleDetailItemTimeNumBufferReset() {
  if (!activeDetailItemTimeWheel) return;

  if (activeDetailItemTimeWheel.numBufferTimer) {
    clearTimeout(activeDetailItemTimeWheel.numBufferTimer);
  }

  activeDetailItemTimeWheel.numBufferTimer =
    activeDetailItemTimeWheel.numBuffer
      ? setTimeout(
          clearDetailItemTimeNumBuffer,
          WHEEL_NUMBER_BUFFER_TIMEOUT
        )
      : null;
}

function applyDetailItemTimeNumBuffer() {
  if (
    !activeDetailItemTimeWheel ||
    !activeDetailItemTimeWheel.numBuffer
  ) {
    return;
  }

  var wheel = activeDetailItemTimeWheel;
  var buffer = wheel.numBuffer;

  if (buffer.length <= 2) {
    var number = Number(buffer);

    if (wheel.numBufferUnit === 'hour') {
      if (number < 1 || number > 12) return;
      wheel.hour = number;
    } else if (wheel.numBufferUnit === 'minute') {
      if (number > 59) return;
      wheel.minute = (Math.round(number / 5) * 5) % 60;
    } else {
      return;
    }

    syncDetailItemTimeWheelColumnsToState();
    return;
  }

  var hour24;
  var minute;

  if (buffer.length === 3) {
    hour24 = Number(buffer.slice(0, 1));
    minute = Number(buffer.slice(1));
  } else {
    hour24 = Number(buffer.slice(0, 2));
    minute = Number(buffer.slice(2));
  }

  if (hour24 > 23 || minute > 59) return;

  var rounded = roundToNearest5(hour24, minute);
  var parsed12 = minutesOfDayToTime12(
    rounded.hour * 60 + rounded.minute
  );

  wheel.period = parsed12.period;
  wheel.hour = parsed12.hour;
  wheel.minute = parsed12.minute;

  syncDetailItemTimeWheelColumnsToState();
}

function confirmDetailItemTimeWheel() {
  if (!activeDetailItemTimeWheel) return;

  var wheel = activeDetailItemTimeWheel;

  var newTime = to24Hour(
    wheel.period,
    wheel.hour,
    wheel.minute
  );

  var onConfirm = wheel.onConfirm;
  var closeParent = wheel.closeParentOnConfirm;

  wheel.confirmed = true;
  closeDetailItemTimeWheel(false);

  if (typeof onConfirm === 'function') {
    onConfirm(newTime);
  }

  if (closeParent && activeDetailTimeMenu) {
    closeDetailTimeMenu(false);
  }
}

function wireDetailItemTimeWheelColumn(col, unit) {
  var wheelAccum = 0;
  var wheelCooling = false;

  col.addEventListener('scroll', function () {
    if (!activeDetailItemTimeWheel) return;

    if (activeDetailItemTimeWheel.settleTimers[unit]) {
      clearTimeout(
        activeDetailItemTimeWheel.settleTimers[unit]
      );
    }

    activeDetailItemTimeWheel.settleTimers[unit] =
      setTimeout(function () {
        settleDetailItemTimeWheelColumn(col, unit);
      }, 90);
  });

  col.addEventListener('wheel', function (e) {
    e.preventDefault();

    if (!activeDetailItemTimeWheel || wheelCooling) {
      return;
    }

    wheelAccum += e.deltaY;

    if (
      Math.abs(wheelAccum) <
      WHEEL_DELTA_THRESHOLD
    ) {
      return;
    }

    var direction = wheelAccum > 0 ? 1 : -1;
    wheelAccum = 0;

    var items = Array.prototype.slice.call(
      col.querySelectorAll('.date-wheel-item')
    );

    var currentIdx =
      getDetailItemTimeWheelIndex(col, unit);

    var nextIdx =
      (currentIdx + direction + items.length) %
      items.length;

    clearDetailItemTimeNumBuffer();

    setDetailItemTimeWheelIndex(
      col,
      unit,
      nextIdx,
      true
    );

    wheelCooling = true;

    setTimeout(function () {
      wheelCooling = false;
    }, WHEEL_STEP_COOLDOWN);
  }, { passive: false });

  col.addEventListener('click', function (e) {
    var item = e.target.closest('.date-wheel-item');
    if (!item || !activeDetailItemTimeWheel) return;

    var items = Array.prototype.slice.call(
      col.querySelectorAll('.date-wheel-item')
    );

    var idx = items.indexOf(item);

    clearDetailItemTimeNumBuffer();

    setDetailItemTimeWheelIndex(
      col,
      unit,
      idx,
      true
    );

    if (unit === 'minute') {
      confirmDetailItemTimeWheel();
      return;
    }

    col.focus();
  });

  col.addEventListener('keydown', function (e) {
    if (!activeDetailItemTimeWheel) return;

    if (
      unit === 'period' &&
      (e.key === 'a' || e.key === 'A' ||
       e.key === 'p' || e.key === 'P')
    ) {
      e.preventDefault();
      e.stopPropagation();

      var periodItems = Array.prototype.slice.call(
        col.querySelectorAll('.date-wheel-item')
      );

      var wantedPeriod =
        e.key === 'a' || e.key === 'A'
          ? 'AM'
          : 'PM';

      var periodIdx = periodItems.findIndex(function (item) {
        return item.dataset.value === wantedPeriod;
      });

      if (periodIdx !== -1) {
        setDetailItemTimeWheelIndex(
          col,
          unit,
          periodIdx,
          true
        );
      }
      return;
    }

    if (
      unit !== 'period' &&
      /^[0-9]$/.test(e.key)
    ) {
      e.preventDefault();
      e.stopPropagation();

      activeDetailItemTimeWheel.numBuffer =
        ((activeDetailItemTimeWheel.numBuffer || '') + e.key)
          .slice(-4);

      activeDetailItemTimeWheel.numBufferUnit = unit;

      scheduleDetailItemTimeNumBufferReset();
      applyDetailItemTimeNumBuffer();
      return;
    }

    if (e.key === 'Backspace' && unit !== 'period') {
      e.preventDefault();
      e.stopPropagation();

      activeDetailItemTimeWheel.numBuffer =
        (activeDetailItemTimeWheel.numBuffer || '')
          .slice(0, -1);

      scheduleDetailItemTimeNumBufferReset();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      clearDetailItemTimeNumBuffer();
      confirmDetailItemTimeWheel();
      return;
    }

    var items = Array.prototype.slice.call(
      col.querySelectorAll('.date-wheel-item')
    );

    var currentIdx =
      getDetailItemTimeWheelIndex(col, unit);

    var nextIdx = currentIdx;

    if (e.key === 'ArrowDown') {
      nextIdx = currentIdx + 1;
    } else if (e.key === 'ArrowUp') {
      nextIdx = currentIdx - 1;
    } else if (e.key === 'PageDown') {
      nextIdx = currentIdx + 5;
    } else if (e.key === 'PageUp') {
      nextIdx = currentIdx - 5;
    } else {
      return;
    }

    e.preventDefault();
    clearDetailItemTimeNumBuffer();

    nextIdx =
      (nextIdx + items.length) %
      items.length;

    setDetailItemTimeWheelIndex(
      col,
      unit,
      nextIdx,
      true
    );
  });
}

// 상세 시간 휠은 입력칸 아래가 아니라 클릭 지점/입력칸의 오른쪽에 띄운다.
// 오른쪽 공간이 부족할 때만 입력칸 왼쪽으로 보내고, 어느 경우에도 viewport 밖으로
// 잘리지 않도록 마지막으로 보정한다.
function positionDetailItemTimeWheelPopup(popup, anchorEl, pointerPoint) {
  var rect = anchorEl.getBoundingClientRect();
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var gap = 12;

  popup.style.top = '0px';
  popup.style.left = '0px';
  var popupRect = popup.getBoundingClientRect();

  var hasPointer = pointerPoint &&
    Number.isFinite(pointerPoint.x) &&
    Number.isFinite(pointerPoint.y);

  // 마우스로 열었으면 커서 오른쪽을 우선하되, 팝업 전체가 입력칸 오른쪽에 있도록 한다.
  // 키보드 포커스로 열었으면 입력칸 오른쪽을 기준으로 한다.
  var left = hasPointer
    ? Math.max(pointerPoint.x + gap, rect.right + gap)
    : rect.right + gap;
  var top = hasPointer ? pointerPoint.y - 24 : rect.top;

  // 오른쪽 공간이 부족하면 입력칸 왼쪽으로 이동한다.
  if (left + popupRect.width > vw - 8) {
    left = rect.left - popupRect.width - gap;
  }

  if (left < 8) left = 8;
  if (left + popupRect.width > vw - 8) {
    left = Math.max(8, vw - popupRect.width - 8);
  }
  if (top + popupRect.height > vh - 8) {
    top = vh - popupRect.height - 8;
  }
  if (top < 8) top = 8;

  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

function openDetailItemTimeWheel(
  itemId,
  field,
  anchorEl,
  initialTime,
  onConfirm,
  closeParentOnConfirm,
  onCancel,
  keepAnchorFocus,
  pointerPoint
) {
  if (activeTimeWheel) {
    closeTimeWheelPopup(false);
  }

  if (activeDetailItemTimeWheel) {
    closeDetailItemTimeWheel(false);
  }

  var parsed = parseTime12(initialTime);

  var initMinutes = timeToMinutesOfDay(
    parsed.period,
    parsed.hour,
    parsed.minute
  );

  var rounded = roundToNearest5(
    Math.floor(initMinutes / 60),
    initMinutes % 60
  );

  var parsed12 = minutesOfDayToTime12(
    rounded.hour * 60 + rounded.minute
  );

  var popup = document.createElement('div');
  popup.className = 'date-wheel-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute(
    'aria-label',
    field === 'start'
      ? '시작 시간 선택'
      : '종료 시간 선택'
  );

  var colsWrap = document.createElement('div');
  colsWrap.className = 'date-wheel-cols';

  var hours = [];
  for (var h = 1; h <= 12; h++) {
    hours.push(h);
  }

  var minutes = [];
  for (var m = 0; m < 60; m += 5) {
    minutes.push(m);
  }

  var periodCol = buildWheelColumn(
    'period',
    ['AM', 'PM'],
    function (value) { return value; }
  );

  var hourCol = buildWheelColumn(
    'hour',
    hours,
    function (value) { return String(value); }
  );

  var minuteCol = buildWheelColumn(
    'minute',
    minutes,
    function (value) {
      return String(value).padStart(2, '0');
    }
  );

  colsWrap.appendChild(periodCol);
  colsWrap.appendChild(hourCol);
  colsWrap.appendChild(minuteCol);

  var centerLine = document.createElement('div');
  centerLine.className = 'date-wheel-center-line';
  colsWrap.appendChild(centerLine);

  popup.appendChild(colsWrap);
  document.body.appendChild(popup);

  positionDetailItemTimeWheelPopup(
    popup,
    anchorEl,
    pointerPoint
  );

  anchorEl.setAttribute(
    'aria-expanded',
    'true'
  );

  activeDetailItemTimeWheel = {
    el: popup,
    anchorEl: anchorEl,
    itemId: itemId,
    field: field,
    period: parsed12.period,
    hour: parsed12.hour,
    minute: parsed12.minute,
    settleTimers: {
      period: null,
      hour: null,
      minute: null
    },
    onConfirm: onConfirm,
    onCancel: onCancel,
    confirmed: false,
    numBuffer: '',
    numBufferUnit: null,
    numBufferTimer: null,
    closeParentOnConfirm:
      !!closeParentOnConfirm
  };

  scrollColumnToValue(
    periodCol,
    parsed12.period,
    false
  );

  scrollColumnToValue(
    hourCol,
    parsed12.hour,
    false
  );

  scrollColumnToValue(
    minuteCol,
    parsed12.minute,
    false
  );

  wireDetailItemTimeWheelColumn(
    periodCol,
    'period'
  );

  wireDetailItemTimeWheelColumn(
    hourCol,
    'hour'
  );

  wireDetailItemTimeWheelColumn(
    minuteCol,
    'minute'
  );

  if (keepAnchorFocus) {
    anchorEl.focus();
  } else {
    hourCol.focus();
  }

  setTimeout(function () {
    document.addEventListener(
      'pointerdown',
      onOutsideDetailItemTimeWheelPointerDown,
      true
    );

    document.addEventListener(
      'keydown',
      onDetailItemTimeWheelKeydown,
      true
    );
  }, 0);
}

function onOutsideDetailTimeMenuPointerDown(e) {
  if (!activeDetailTimeMenu) return;

  if (activeDetailTimeMenu.el.contains(e.target)) {
    return;
  }

  if (
    activeDetailItemTimeWheel &&
    activeDetailItemTimeWheel.el.contains(e.target)
  ) {
    return;
  }

  if (
    activeDetailTimeMenu.anchorEl &&
    activeDetailTimeMenu.anchorEl.contains(e.target)
  ) {
    return;
  }

  closeDetailTimeMenu();
}

function onDetailTimeMenuKeydown(e) {
  if (!activeDetailTimeMenu) return;

  if (
    e.key === 'Escape' &&
    !activeDetailItemTimeWheel
  ) {
    e.preventDefault();
    e.stopPropagation();
    closeDetailTimeMenu();
  }
}

function closeDetailTimeMenu(restoreFocus) {
  if (!activeDetailTimeMenu) return;

  if (activeDetailItemTimeWheel) {
    closeDetailItemTimeWheel(false);
  }

  var anchorEl = activeDetailTimeMenu.anchorEl;

  activeDetailTimeMenu.el.remove();

  document.removeEventListener(
    'pointerdown',
    onOutsideDetailTimeMenuPointerDown,
    true
  );

  document.removeEventListener(
    'keydown',
    onDetailTimeMenuKeydown,
    true
  );

  activeDetailTimeMenu = null;

  if (anchorEl) {
    anchorEl.setAttribute(
      'aria-expanded',
      'false'
    );
  }

  if (
    restoreFocus !== false &&
    anchorEl &&
    anchorEl.isConnected
  ) {
    anchorEl.focus();
  }
}

function formatDetailTimeEditorValue(time24) {
  if (!time24) return '';

  var parsed = parseTime12(time24);

  return (
    parsed.period.toLowerCase() +
    ' ' +
    String(parsed.hour).padStart(2, '0') +
    ':' +
    String(parsed.minute).padStart(2, '0')
  );
}

function parseDetailTimeEditorValue(rawValue, fallbackTime) {
  var text = String(rawValue || '')
    .trim()
    .toLowerCase();

  if (!text) return null;

  var period = null;

  if (
    text.indexOf('오전') !== -1 ||
    text.indexOf('am') !== -1 ||
    /^a(?=\s|\d)/.test(text)
  ) {
    period = 'AM';
  }

  if (
    text.indexOf('오후') !== -1 ||
    text.indexOf('pm') !== -1 ||
    /^p(?=\s|\d)/.test(text)
  ) {
    period = 'PM';
  }

  text = text
    .replace(/오전|오후|am|pm/gi, '')
    .replace(/^[ap](?=\s|\d)/i, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9:]/g, '');

  if (!text) return null;

  var hour;
  var minute;

  if (text.indexOf(':') !== -1) {
    var parts = text.split(':');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return null;
    }

    hour = Number(parts[0]);
    minute = Number(parts[1]);
  } else {
    var digits = text.replace(/\D/g, '');

    if (!digits || digits.length > 4) return null;

    if (digits.length <= 2) {
      hour = Number(digits);
      minute = 0;
    } else if (digits.length === 3) {
      hour = Number(digits.slice(0, 1));
      minute = Number(digits.slice(1));
    } else {
      hour = Number(digits.slice(0, 2));
      minute = Number(digits.slice(2));
    }
  }

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  if (period) {
    if (hour < 0 || hour > 12) return null;
    if (hour === 0) hour = 12;
    return to24Hour(period, hour, minute);
  }

  // AM/PM을 생략하면 기존에 저장된 시간대(AM/PM)를 유지한다.
  // 단 00시 또는 13~23시는 명백한 24시간 입력이므로 그대로 해석한다.
  if (hour === 0 || hour > 12) {
    if (hour > 23) return null;
    return (
      String(hour).padStart(2, '0') +
      ':' +
      String(minute).padStart(2, '0')
    );
  }

  var fallback = parseTime12(fallbackTime || '09:00');
  return to24Hour(fallback.period, hour, minute);
}

function openDetailTimeMenu(itemId, anchorEl) {
  var item = findItemById(itemId);

  if (!item || item.deletedAt) return;

  if (
    activeDetailTimeMenu &&
    activeDetailTimeMenu.itemId === itemId
  ) {
    closeDetailTimeMenu();
    return;
  }

  if (activeTypeMenu) {
    closeTypeMenu(false);
  }

  if (activeMoveMenu) {
    closeMoveDateMenu(false);
  }

  if (activeDateWheel) {
    closeDateWheelPopup(false);
  }

  if (activeTimeWheel) {
    closeTimeWheelPopup(false);
  }

  if (activeDetailTimeMenu) {
    closeDetailTimeMenu(false);
  }

  var menu = document.createElement('div');
  menu.className =
    'move-menu detail-time-menu';

  menu.setAttribute('role', 'dialog');
  menu.setAttribute(
    'aria-label',
    '시간 수정'
  );

  var allDayRow =
  document.createElement('div');

allDayRow.className =
  'move-menu-custom';

var allDayLabel =
  document.createElement('label');

allDayLabel.className =
  'detail-all-day-label';

var allDayCheck =
  document.createElement('input');

allDayCheck.type = 'checkbox';

allDayCheck.checked =
  item.allDay !== false &&
  !item.startTime &&
  !item.endTime;

var allDayText =
  document.createElement('span');

allDayText.textContent = '하루 종일';

allDayLabel.appendChild(allDayCheck);
allDayLabel.appendChild(allDayText);
allDayRow.appendChild(allDayLabel);

allDayRow.addEventListener('click', function (e) {
  if (!allDayLabel.contains(e.target)) {
    e.preventDefault();
    e.stopPropagation();
  }
});
  function makeTimeRow(
    labelText,
    time24,
    isPlaceholder
  ) {
    var row =
      document.createElement('div');

    row.className =
      'move-menu-custom';

    var label =
      document.createElement('span');

    label.textContent = labelText;

    var input =
      document.createElement('input');

    input.type = 'text';
    input.inputMode = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.className =
      'move-menu-date detail-time-value';

    input.dataset.time24 = time24 || '';
    input.value = isPlaceholder
      ? '00:00'
      : formatDetailTimeEditorValue(time24);

    input.classList.toggle(
      'is-placeholder',
      !!isPlaceholder
    );

    input.setAttribute(
      'aria-label',
      labelText + ' 시간 직접 입력'
    );

    input.setAttribute(
      'aria-haspopup',
      'dialog'
    );

    input.setAttribute(
      'aria-expanded',
      'false'
    );

    var clearBtn =
  document.createElement('button');

clearBtn.type = 'button';

clearBtn.className =
  'detail-time-clear-btn';

clearBtn.textContent = '×';

clearBtn.setAttribute(
  'aria-label',
  labelText + ' 시간 제거'
);

/*
 * 종료시간이 실제로 설정된 경우에만 ×를 표시한다.
 * 시작시간 행에는 표시하지 않는다.
 */
clearBtn.hidden =
  labelText !== '종료' || !time24;

row.appendChild(label);
row.appendChild(input);
row.appendChild(clearBtn);

return {
  row: row,
  input: input,
  clearBtn: clearBtn
};
  }

  var startTimeValue =
    item.startTime || '09:00';

  var startRow = makeTimeRow(
    '시작',
    startTimeValue,
    false
  );

  var endRow = makeTimeRow(
    '종료',
    item.endTime,
    !item.endTime
  );

  function setInputDisplay(
    input,
    time24,
    isPlaceholder
  ) {
    input.dataset.time24 = time24 || '';
    input.value = isPlaceholder
      ? '00:00'
      : formatDetailTimeEditorValue(time24);

    input.classList.toggle(
      'is-placeholder',
      !!isPlaceholder
    );

    input.classList.remove(
      'is-editing',
      'is-invalid'
    );

    input.removeAttribute('aria-invalid');
    var rowInfo =
  input === startRow.input
    ? startRow
    : endRow;

if (rowInfo.clearBtn) {
  rowInfo.clearBtn.hidden =
    input !== endRow.input ||
    !time24 ||
    !!isPlaceholder;
}
  }

  function restoreInputFromItem(field, input) {
    var current = findItemById(itemId);
    if (!current) return;

    if (field === 'start') {
      setInputDisplay(
        input,
        current.startTime || '09:00',
        false
      );
      return;
    }

    setInputDisplay(
      input,
      current.endTime,
      !current.endTime
    );
  }

  function syncInputsFromItem(current) {
    if (!current) return;

    setInputDisplay(
      startRow.input,
      current.startTime || '09:00',
      false
    );

    setInputDisplay(
      endRow.input,
      current.endTime,
      !current.endTime
    );

    allDayCheck.checked =
      current.allDay !== false &&
      !current.startTime &&
      !current.endTime;

    syncTimeInputs();
  }

  function syncTimeInputs() {
    var disabled = allDayCheck.checked;

    startRow.input.disabled = disabled;
    endRow.input.disabled = disabled;
  }

  function markInputInvalid(input) {
    input.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }

  function closeWheelWithoutCancel(input) {
    if (
      !activeDetailItemTimeWheel ||
      activeDetailItemTimeWheel.anchorEl !== input
    ) {
      return;
    }

    activeDetailItemTimeWheel.confirmed = true;
    closeDetailItemTimeWheel(false);
  }

  function commitTypedTime(field, input, closeParent) {
    var current = findItemById(itemId);
    if (!current) return;

    var fallbackTime =
      field === 'start'
        ? (current.startTime || '09:00')
        : (current.endTime || current.startTime || '00:00');

    var parsedTime = parseDetailTimeEditorValue(
      input.value,
      fallbackTime
    );

    if (!parsedTime) {
      markInputInvalid(input);
      return;
    }

    closeWheelWithoutCancel(input);

    var updated = saveDetailItemTime(
      itemId,
      field,
      parsedTime
    );

    if (!updated) return;

    syncInputsFromItem(updated);

    if (closeParent) {
      closeDetailTimeMenu(false);
      return;
    }

    // 커밋 직후 포커스를 시작 입력칸으로 되돌리되(항상 이 분기는 field==='start'일 때만
    // 실행됨 — end는 closeParent가 true라 위에서 이미 return한다), 입력칸 자신의 'focus'
    // 리스너가 곧바로 휠을 다시 열지 않도록 감싼다(실제 재현된 버그 — Enter로 저장해도
    // 휠이 바로 다시 뜨는 것처럼 보였다).
    suppressDetailItemTimeWheelReopen = true;
    startRow.input.focus();
    suppressDetailItemTimeWheelReopen = false;
  }

  function openWheelForInput(field, input, pointerPoint) {
    if (input.disabled) return;

    if (
      activeDetailItemTimeWheel &&
      activeDetailItemTimeWheel.anchorEl === input &&
      activeDetailItemTimeWheel.field === field
    ) {
      // focus로 먼저 열린 뒤 click이 이어지는 경우, 실제 클릭 위치의 오른쪽으로 한 번 더 보정한다.
      if (pointerPoint) {
        positionDetailItemTimeWheelPopup(
          activeDetailItemTimeWheel.el,
          input,
          pointerPoint
        );
      }
      return;
    }

    var current = findItemById(itemId);
    if (!current) return;

    var initialTime =
      field === 'start'
        ? (current.startTime || '09:00')
        : (current.endTime || '00:00');

    if (
      field === 'end' &&
      !current.endTime
    ) {
      input.classList.remove('is-placeholder');
      input.classList.add('is-editing');
      input.value = formatDetailTimeEditorValue('00:00');
      input.select();
    }

    openDetailItemTimeWheel(
      itemId,
      field,
      input,
      initialTime,
      function (newTime) {
        var updated = saveDetailItemTime(
          itemId,
          field,
          newTime
        );

        if (
          updated &&
          activeDetailTimeMenu &&
          activeDetailTimeMenu.itemId === itemId
        ) {
          syncInputsFromItem(updated);
        }
      },
      field === 'end',
      function () {
        if (
          input.isConnected &&
          activeDetailTimeMenu &&
          activeDetailTimeMenu.itemId === itemId
        ) {
          restoreInputFromItem(field, input);
        }
      },
      true,
      pointerPoint
    );
  }
  endRow.clearBtn.addEventListener(
  'pointerdown',
  function (e) {
    e.preventDefault();
    e.stopPropagation();
  }
);
endRow.clearBtn.addEventListener(
  'click',
  function (e) {
    e.preventDefault();
    e.stopPropagation();

    if (
      activeDetailItemTimeWheel &&
      activeDetailItemTimeWheel.anchorEl ===
        endRow.input
    ) {
      activeDetailItemTimeWheel.confirmed = true;
      closeDetailItemTimeWheel(false);
    }

    var current = findItemById(itemId);

    if (!current || current.deletedAt) {
      return;
    }

    withHistoryTransaction(function () {
      current.allDay = false;
      current.endTime = null;
      current.updatedAt = Date.now();
    });

    saveItems();

    refreshDetailTimeDisplays(current);

    setInputDisplay(
      endRow.input,
      null,
      true
    );

   
  }
);
  function wireEditableTimeInput(field, rowInfo) {
    var input = rowInfo.input;
    var pendingPointerPoint = null;

    // pointerdown은 focus보다 먼저 발생하므로 클릭 좌표를 잠시 보관한다.
    input.addEventListener('pointerdown', function (e) {
      pendingPointerPoint = { x: e.clientX, y: e.clientY };
    });

    input.addEventListener('focus', function () {
      if (suppressDetailItemTimeWheelReopen) return;
      var point = pendingPointerPoint;
      pendingPointerPoint = null;
      openWheelForInput(field, input, point);
    });

    input.addEventListener('click', function (e) {
      var cursorPosition =
        typeof input.selectionStart === 'number'
          ? input.selectionStart
          : 0;

      openWheelForInput(
        field,
        input,
        { x: e.clientX, y: e.clientY }
      );

      // "am 09:15" 형식 -- 클릭 위치에 따라 AM/PM(0~2)·시(3~5)·분(6~8) 중 하나만 선택한다
      // (상단 메인 시간 입력과 동일한 방식, 형식 폭만 다름).
      setTimeout(function () {
        if (cursorPosition <= 2) input.setSelectionRange(0, 2);
        else if (cursorPosition <= 5) input.setSelectionRange(3, 5);
        else input.setSelectionRange(6, 8);
      }, 0);
    });

    input.addEventListener('input', function () {
      input.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');

      if (input.classList.contains('is-placeholder')) {
        input.classList.remove('is-placeholder');
        input.classList.add('is-editing');
      }
    });

    input.addEventListener('keydown', function (e) {
  if (
    handleTimeInputHorizontalArrowKey(
      e,
      input,
      DETAIL_TIME_INPUT_SEGMENTS,
      !!(activeDetailItemTimeWheel && activeDetailItemTimeWheel.anchorEl === input)
    )
  ) {
    return;
  }

  /*
   * am 또는 pm 글자에 커서가 있거나
   * am/pm 두 글자가 선택되어 있을 때만 작동한다.
   */
  var selectionStart =
    typeof input.selectionStart === 'number'
      ? input.selectionStart
      : -1;

  var selectionEnd =
    typeof input.selectionEnd === 'number'
      ? input.selectionEnd
      : -1;

  var cursorIsOnPeriod =
    selectionStart >= 0 &&
    selectionStart <= 2 &&
    selectionEnd <= 2;

  var hasPeriod =
    /^(am|pm)\b/i.test(input.value);

  /*
   * AM/PM 부분에서 방향키 위·아래를 누르면
   * am과 pm을 서로 전환한다.
   */
  if (
    cursorIsOnPeriod &&
    hasPeriod &&
    (
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown'
    )
  ) {
    e.preventDefault();
    e.stopPropagation();

    var nextPeriod =
      /^am\b/i.test(input.value)
        ? 'pm'
        : 'am';

    input.value =
      input.value.replace(
        /^(am|pm)/i,
        nextPeriod
      );

    /*
     * 전환 후에도 am/pm 부분을 계속 선택해 둔다.
     */
    input.setSelectionRange(0, 2);

    /*
     * 오른쪽에 열린 시간 휠의 AM/PM도 같이 바꾼다.
     */
    if (
      activeDetailItemTimeWheel &&
      activeDetailItemTimeWheel.anchorEl === input
    ) {
      activeDetailItemTimeWheel.period =
        nextPeriod.toUpperCase();

      syncDetailItemTimeWheelColumnsToState();
    }

    return;
  }

  /*
   * 시(3~5)·분(6~8) 부분에서 방향키 위·아래를 누르면 해당 부분만 순환 조절한다
   * (마우스 휠 스크롤과 같은 인덱스 기반 로직을 그대로 재사용 -- 새 커밋 경로를
   * 만들지 않는다. auto로 즉시 반영해 스크롤 애니메이션 중 네이티브 scroll 이벤트가
   * 중간값으로 덮어쓰는 경합을 피한다).
   */
  var cursorIsOnHour =
    selectionStart >= 3 && selectionEnd <= 5;
  var cursorIsOnMinute =
    selectionStart >= 6 && selectionEnd <= 8;

  if (
    (cursorIsOnHour || cursorIsOnMinute) &&
    (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
    activeDetailItemTimeWheel &&
    activeDetailItemTimeWheel.anchorEl === input
  ) {
    e.preventDefault();
    e.stopPropagation();

    var unit = cursorIsOnHour ? 'hour' : 'minute';
    var col = activeDetailItemTimeWheel.el.querySelector(
      '.date-wheel-col[data-unit="' + unit + '"]'
    );

    if (col) {
      var items = col.querySelectorAll('.date-wheel-item');
      var currentIdx = getDetailItemTimeWheelIndex(col, unit);
      var direction = e.key === 'ArrowUp' ? -1 : 1;
      var nextIdx = (currentIdx + direction + items.length) % items.length;

      clearDetailItemTimeNumBuffer();
      setDetailItemTimeWheelIndex(col, unit, nextIdx, false);

      input.setSelectionRange(
        cursorIsOnHour ? 3 : 6,
        cursorIsOnHour ? 5 : 8
      );
    }

    return;
  }

  /*
   * 기존 Enter 저장 기능
   */
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    e.stopPropagation();

    commitTypedTime(
      field,
      input,
      field === 'end'
    );

    return;
  }

  /*
   * 기존 Escape 취소 기능
   */
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();

    if (
      activeDetailItemTimeWheel &&
      activeDetailItemTimeWheel.anchorEl === input
    ) {
      closeDetailItemTimeWheel(false);
    } else {
      restoreInputFromItem(field, input);
    }
  }
});
  }

  allDayCheck.addEventListener(
    'change',
    function () {
      if (!allDayCheck.checked) {
        syncTimeInputs();
        startRow.input.focus();
        return;
      }

      saveDetailItemAsAllDay(itemId);
      closeDetailTimeMenu(false);
    }
  );

  wireEditableTimeInput('start', startRow);
  wireEditableTimeInput('end', endRow);

  syncTimeInputs();

  menu.appendChild(allDayRow);
  menu.appendChild(startRow.row);
  menu.appendChild(endRow.row);

  document.body.appendChild(menu);

  positionPopup(menu, anchorEl);

  anchorEl.setAttribute(
    'aria-expanded',
    'true'
  );

  activeDetailTimeMenu = {
    el: menu,
    anchorEl: anchorEl,
    itemId: itemId,
    allDayCheck: allDayCheck,
    startBtn: startRow.input,
    endBtn: endRow.input
  };

  setTimeout(function () {
    document.addEventListener(
      'pointerdown',
      onOutsideDetailTimeMenuPointerDown,
      true
    );

    document.addEventListener(
      'keydown',
      onDetailTimeMenuKeydown,
      true
    );
  }, 0);
}


  var activeMoveMenu = null; // { el, itemIds, anchorItemId }

  function getSelectedItemsForAction(anchorItemId) {
    if (state.selectedItemIds.has(anchorItemId) && state.selectedItemIds.size >= 2) {
      return Array.from(state.selectedItemIds);
    }
    return [anchorItemId];
  }

  function handleMoveDateClick(itemId, anchorEl) {
    if (activeMoveMenu && activeMoveMenu.anchorItemId === itemId) {
      closeMoveDateMenu();
      return;
    }
    var targetIds = getSelectedItemsForAction(itemId);
    if (!(state.selectedItemIds.has(itemId) && state.selectedItemIds.size >= 2)) {
      // 7-B: 선택되어 있지 않거나 단일 선택뿐이면, 클릭한 항목 하나만 새로 선택한다.
      // 이동 화살표는 Daily에만 존재하므로 컨테이너는 항상 daily/selectedDate다.
      selectSingleItem(itemId, 'daily', state.selectedDate);
    }
    openMoveDateMenu(targetIds, anchorEl);
  }

  function onOutsideMoveMenuPointerDown(e) {
    if (!activeMoveMenu) return;
    if (activeMoveMenu.el.contains(e.target)) return;
    // 이 메뉴 안의 날짜 입력칸이 연 날짜 휠(연·월·일 팝업)은 document.body의 형제
    // 요소로 렌더링되므로 .move-menu의 자손이 아니다 -- 휠 내부 클릭까지 "바깥 클릭"으로
    // 오인해 메뉴째 닫아버리지 않도록 별도로 확인한다.
    if (activeDateWheel && activeDateWheel.el.contains(e.target)) return;
    closeMoveDateMenu();
  }

  function onMoveMenuKeydown(e) {
    if (!activeMoveMenu) return;
    if (e.key === 'Escape') {
      // 이 메뉴 안에서 연 날짜 휠이 열려 있다면 그 휠 자신의 캡처 핸들러
      // (onDateWheelKeydown)에 우선순위를 넘긴다 -- Escape 한 번은 휠만 닫아야 한다
      // (7번 요구사항 -- 상세 드로어/시간 메뉴에서 이미 쓴 것과 같은 우선순위 구조).
      if (activeDateWheel) return;
      e.preventDefault();
      e.stopPropagation();
      closeMoveDateMenu();
    }
    // Tab 이동은 브라우저 기본 포커스 순회에 맡긴다.
  }

  function closeMoveDateMenu(restoreFocus) {
    if (!activeMoveMenu) return;
    var anchorItemId = activeMoveMenu.anchorItemId;
    activeMoveMenu.el.remove();
    document.removeEventListener('pointerdown', onOutsideMoveMenuPointerDown, true);
    document.removeEventListener('keydown', onMoveMenuKeydown, true);
    activeMoveMenu = null;
    var anchors = document.querySelectorAll('[data-action="move-date"][data-item-id="' + anchorItemId + '"]');
    anchors.forEach(function (a) { a.setAttribute('aria-expanded', 'false'); });
    if (restoreFocus !== false && anchors[0]) anchors[0].focus();
  }

  function openMoveDateMenu(itemIds, anchorEl) {
    if (activeTypeMenu) closeTypeMenu(false); // 타입 팝업이 열려 있으면 닫고 이동 팝업을 연다.
    if (activeMoveMenu) closeMoveDateMenu(false);
    if (activeDateWheel) closeDateWheelPopup(false);
    if (activeTimeWheel) closeTimeWheelPopup(false);

    var menu = document.createElement('div');
    menu.className = 'move-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', '날짜 이동');

    function makeItemButton(labelText, onClick) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'move-menu-item';
      btn.textContent = labelText;
      btn.addEventListener('click', onClick);
      return btn;
    }

    var todayBtn = makeItemButton('오늘로 이동', function () {
      moveItemsToDate(itemIds, state.todayDate);
    });
    var tomorrowBtn = makeItemButton('내일로 이동', function () {
      moveItemsToDate(itemIds, addCalendarDays(state.todayDate, 1));
    });


    var customWrap = document.createElement('div');
customWrap.className = 'move-menu-custom';

/*
 * 단일 항목(다중선택 아님)일 때만 시작일과 종료일 입력칸을 함께 표시한다.
 * task/memo도 schedule과 동일하게 date/endDate 필드를 쓸 수 있으므로 종류로
 * 제한하지 않는다(10번 요구사항 -- 다중선택은 여전히 이 분기를 타지 않는다).
 */
var rangeItem = null;

if (itemIds.length === 1) {
  var candidateItem =
    findItemById(itemIds[0]);

  if (candidateItem) {
  rangeItem = candidateItem;
}
}

if (rangeItem) {
  customWrap.classList.add(
    'move-menu-range'
  );

  var title =
    document.createElement('span');

  title.className =
    'move-menu-range-title';

  title.textContent =
    '직접 선택';

  var startLabel =
    document.createElement('label');

  startLabel.className =
    'move-menu-range-field';

  var startText =
    document.createElement('span');

  startText.textContent =
    '시작';

  var startInput =
    document.createElement('input');

  startInput.type = 'text';
  startInput.autocomplete = 'off';
  startInput.spellcheck = false;

  startInput.className =
    'move-menu-date';

  startInput.value =
    rangeItem.date;

  var endLabel =
    document.createElement('label');

  endLabel.className =
    'move-menu-range-field';

  var endText =
    document.createElement('span');

  endText.textContent =
    '종료';

  var endInput =
    document.createElement('input');

  endInput.type = 'text';
  endInput.autocomplete = 'off';
  endInput.spellcheck = false;
  endInput.placeholder = '연도-월-일';

  endInput.className =
    'move-menu-date';
var hasExplicitEndDate =
  !!rangeItem.endDate &&
  rangeItem.endDate !== rangeItem.date;
  endInput.value =
  hasExplicitEndDate
    ? rangeItem.endDate
    : '';

endInput.classList.toggle(
  'is-placeholder',
  !hasExplicitEndDate
);

  var endDateClearBtn =
    document.createElement('button');

  endDateClearBtn.type = 'button';

  endDateClearBtn.className =
    'move-menu-range-date-clear-btn';

  endDateClearBtn.setAttribute(
    'aria-label',
    '종료 날짜 제거'
  );

  endDateClearBtn.textContent = '×';

  // 종료 날짜가 실제로 활성화된 경우에만 보인다(상세 시간 메뉴의 종료시간 X와 같은 규칙).
  endDateClearBtn.hidden = !hasExplicitEndDate;

  // 12/13: 종료는 사용자가 종료 입력칸을 직접 클릭(=휠을 여는 행위)했을 때만 활성화된다.
  // 시작을 아무리 조작해도(방향키 포함) 이 값은 바뀌지 않는다(10/11번 요구사항 -- 기존
  // 버그였던 "시작만 바꿔도 종료가 함께 활성화되는" 문제의 수정 지점).
  var endActive = hasExplicitEndDate;

  // 시작 날짜 라이브 커밋 -- moveSingleItemToDate가 "종료 비활성(=endDate와 date가 같음)이면
  // 함께 이동, 종료 활성(다일 일정)이면 기간 길이를 보존해 함께 이동"을 이미 정확히
  // 처리하므로 그대로 재사용한다. 종료가 비활성일 때 이 함수는 종료를 새로 만들지 않는다.
  function applyStartLiveChange(newDate) {
    if (rangeItem.date === newDate) return;
    withHistoryTransaction(function () {
      moveSingleItemToDate(rangeItem, newDate);
      assignOrderForMove([rangeItem], newDate);
    });
    saveItems();
    // moveSingleItemToDate는 클램프를 적용하지 않지만(항상 요청한 날짜 그대로 이동),
    // target 기반 휠 전반에 쓰는 동기화 함수를 그대로 재사용해 휠 컬럼도 최종 값과
    // 일관되게 맞춘다(값이 이미 같으면 아무 것도 하지 않는다).
    syncActiveDateWheelToCommittedDate();
    renderApp();
    startInput.value = rangeItem.date;
    if (endActive) {
      endInput.value = rangeItem.endDate || rangeItem.date;
      endDateClearBtn.hidden = false;
    }
  }

  function applyEndLiveChange(newDate) {
    if (!endActive) return; // 방어적 가드 -- 명시적으로 활성화되기 전에는 절대 커밋하지 않는다.
    applyMoveMenuRangeChange(rangeItem.id, rangeItem.date, newDate, false);
    // 종료<시작 클램프로 실제 저장값이 방금 조작한 휠의 원시 위치와 달라졌을 수 있다 --
    // 상단 메인 날짜 입력의 클램프 동기화와 같은 함수를 재사용한다.
    syncActiveDateWheelToCommittedDate();
    startInput.value = rangeItem.date;
    endInput.value = rangeItem.endDate || rangeItem.date;
    endDateClearBtn.hidden = false;
  }

  wireMoveMenuDateInput(startInput, 'start', function () {
    var snapshotDate = rangeItem.date;
    var snapshotEndDate = rangeItem.endDate || rangeItem.date;
    return {
      getCurrentDate: function () { return rangeItem.date; },
      applyDate: applyStartLiveChange,
      restore: function () {
        // 7: 이 휠을 열기 전 값으로 되돌린다. 종료 활성 여부는 시작 조작으로 바뀌지
        // 않았으므로 건드리지 않는다.
        applyMoveMenuRangeChange(rangeItem.id, snapshotDate, snapshotEndDate, false);
        startInput.value = rangeItem.date;
        if (endActive) endInput.value = rangeItem.endDate || rangeItem.date;
      }
    };
  });

  wireMoveMenuDateInput(endInput, 'end', function () {
    // 12: 클릭(=이 휠을 여는 시점)이 곧 명시적 활성화 동작이다.
    var wasActive = endActive;
    if (!endActive) {
      endActive = true;
      endInput.classList.remove('is-placeholder');
      if (!endInput.value) endInput.value = rangeItem.endDate || rangeItem.date;
      endDateClearBtn.hidden = false;
    }
    var snapshotDate = rangeItem.date;
    var snapshotEndDate = rangeItem.endDate || rangeItem.date;
    return {
      getCurrentDate: function () { return rangeItem.endDate || rangeItem.date; },
      applyDate: applyEndLiveChange,
      // 2/3: '일' 클릭이나 입력칸 Enter로 성공적으로 확정되면 날짜 휠뿐 아니라 날짜 이동
      // 메뉴도 함께 닫는다(상세 드로어는 건드리지 않는다). 시작 날짜 target에는 이 값을
      // 두지 않으므로 시작 필드의 기존 확정 방식은 그대로다(8번 요구사항).
      closeParentOnConfirm: true,
      restore: function () {
        // 7: 이 휠을 열기 전 값으로 되돌린다(방금 클릭으로 활성화됐을 뿐이었다면 그
        // 활성화 자체도 함께 되돌린다).
        applyMoveMenuRangeChange(rangeItem.id, snapshotDate, snapshotEndDate, false);
        endActive = wasActive;
        startInput.value = rangeItem.date;
        endInput.value = endActive ? (rangeItem.endDate || rangeItem.date) : '';
        endInput.classList.toggle('is-placeholder', !endActive);
        endDateClearBtn.hidden = !endActive;
      }
    };
  });

  endDateClearBtn.addEventListener(
    'pointerdown',
    function (e) {
      // 11: 이 pointerdown이 입력칸으로 전달돼 날짜 휠이 재오픈되지 않게 막는다
      // (상세 시간 메뉴의 종료시간 X와 같은 방식).
      e.preventDefault();
      e.stopPropagation();
    }
  );

  endDateClearBtn.addEventListener(
    'click',
    function (e) {
      e.preventDefault();
      e.stopPropagation();

      // 열려 있는 종료 날짜 휠이 있으면 focus 복원 없이 안전하게 닫는다(재오픈 방지).
      if (
        activeDateWheel &&
        activeDateWheel.anchorEl === endInput
      ) {
        closeDateWheelPopup(false);
      }

      if (!endActive) return;

      // 종료 날짜만 해제하고 항목을 단일 날짜 일정으로 즉시 되돌린다 -- 이미 검증된
      // applyMoveMenuRangeChange(종료<시작 클램프·completion map 정리 등을 함께 처리)를
      // 그대로 재사용해 새 커밋 경로를 만들지 않는다. 시작 날짜는 그대로 넘긴다.
      applyMoveMenuRangeChange(
        rangeItem.id,
        rangeItem.date,
        rangeItem.date,
        false
      );

      endActive = false;
      startInput.value = rangeItem.date;
      endInput.value = '';
      endInput.classList.add('is-placeholder');
      endDateClearBtn.hidden = true;
    }
  );

  startLabel.appendChild(startText);
  startLabel.appendChild(startInput);

  endLabel.appendChild(endText);
  endLabel.appendChild(endInput);
  endLabel.appendChild(endDateClearBtn);

  customWrap.appendChild(title);
  customWrap.appendChild(startLabel);
  customWrap.appendChild(endLabel);
} else {
  /*
   * 단일 날짜 항목(일정이 아닌 할 일·메모) 또는 여러 항목을 이동할 때는
   * 기존 날짜 입력칸 하나를 사용한다.
   */
  var label =
    document.createElement('label');

  label.textContent =
    '직접 선택';

  var dateInput =
    document.createElement('input');

  dateInput.type = 'text';
  dateInput.autocomplete = 'off';
  dateInput.spellcheck = false;

  dateInput.className =
    'move-menu-date';

  var singleItem =
    itemIds.length === 1
      ? findItemById(itemIds[0])
      : null;

  var currentSingleDate =
    (singleItem && singleItem.date) ||
    state.selectedDate;

  dateInput.value = currentSingleDate;

  wireMoveMenuDateInput(dateInput, 'start', function () {
    var snapshotDate = currentSingleDate;
    return {
      getCurrentDate: function () { return currentSingleDate; },
      applyDate: function (newDate) {
        if (currentSingleDate === newDate) return;
        currentSingleDate = newDate;
        applyMoveMenuDateChange(itemIds, newDate, false);
        dateInput.value = currentSingleDate;
      },
      restore: function () {
        currentSingleDate = snapshotDate;
        applyMoveMenuDateChange(itemIds, snapshotDate, false);
        dateInput.value = currentSingleDate;
      }
    };
  });

  customWrap.appendChild(label);
  customWrap.appendChild(dateInput);
}

    menu.appendChild(todayBtn);
    menu.appendChild(tomorrowBtn);
    menu.appendChild(customWrap);

    document.body.appendChild(menu);
    positionPopup(menu, anchorEl);
    anchorEl.setAttribute('aria-expanded', 'true');
    activeMoveMenu = { el: menu, itemIds: itemIds, anchorItemId: anchorEl.dataset.itemId };
    todayBtn.focus();

    setTimeout(function () {
      document.addEventListener('pointerdown', onOutsideMoveMenuPointerDown, true);
      document.addEventListener('keydown', onMoveMenuKeydown, true);
    }, 0);
  }

  // ---------------------------------------------------------------------
  // 날짜 이동 실행
  // ---------------------------------------------------------------------
  function moveSingleItemToDate(item, targetDate) {
    if (item.date === targetDate) {
      // 같은 날짜로 "이동"은 아무 것도 바꾸지 않는다(originalDate/migratedFrom/updatedAt 불변).
      return false;
    }
    if (!item.originalDate) item.originalDate = item.date;
    item.migratedFrom = item.date;
    var oldStartDate = item.date;

    // 기간 보존 이동은 종류와 무관하게 endDate가 실제로 date와 다를 때만 적용한다 --
    // task/memo도 이제 endDate를 가질 수 있으므로(일정과 같은 의미) type 제한을 없앴다.
    // 완료 상태 처리(아래 shiftScheduleCompletionMap)는 여전히 schedule 전용으로 남긴다.
    if (item.endDate && item.endDate !== item.date) {
      // 다일 기간: 기간 길이를 보존하며 통째로 이동.
      var span = differenceInCalendarDays(item.date, item.endDate);
      item.date = targetDate;
      item.endDate = addCalendarDays(targetDate, span);
    } else {
      var wasSameDayEnd = !item.endDate || item.endDate === item.date;
      item.date = targetDate;
      if (wasSameDayEnd) item.endDate = targetDate;
    }
    // startTime/endTime/allDay는 그대로 유지(스펙 11-4,11-5).
    // 날짜별 완료 패턴(completionByDate)도 같은 날짜 차이만큼 함께 옮긴다 — 수동 이동/
    // 드래그 이동/일괄 이동 전부 이 함수를 거치므로 한 곳에서만 처리하면 된다.
    if (item.type === 'schedule') {
      shiftScheduleCompletionMap(item, oldStartDate, item.date);
    }
    item.updatedAt = Date.now();
    return true;
  }

  function assignOrderForMove(items, targetDate) {
    var movedSet = items;
    var existingMax = state.items.reduce(function (max, it) {
      if (it.date === targetDate && movedSet.indexOf(it) === -1) {
        return Math.max(max, it.order);
      }
      return max;
    }, -1);
    // 이동 대상 항목들 간의 기존 상대 순서(order)를 유지한 채, 대상 날짜의
    // 기존 항목들 뒤에 순차적으로 이어붙인다.
    var sorted = items.slice().sort(function (a, b) { return a.order - b.order; });
    sorted.forEach(function (it, idx) {
      it.order = existingMax + 1 + idx;
    });
  }

  // 이동의 핵심 로직만 수행한다(검증 + 이동 + order 재배치 + 저장). 팝업 정리/선택
  // 해제/렌더링/알림은 호출자마다 다르므로(수동 이동 팝업은 선택 해제, 드래그앤드롭은
  // 선택 유지) 여기서 하지 않는다 — moveItemsToDate()와 performDrop()이 각자 감싼다.
  function applyMoveItemsToDate(itemIds, targetDate) {
    if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      console.warn('[dotdotplanner] applyMoveItemsToDate: invalid targetDate', targetDate);
      return null;
    }
    var uniqueIds = Array.from(new Set(itemIds));
    var touched = [];
    withHistoryTransaction(function () {
      uniqueIds.forEach(function (id) {
        var item = findItemById(id);
        if (!item) {
          console.warn('[dotdotplanner] applyMoveItemsToDate: unknown itemId', id);
          return;
        }
        var changed = moveSingleItemToDate(item, targetDate);
        if (changed) touched.push(item);
      });

      if (touched.length) {
        assignOrderForMove(touched, targetDate);
      }
    });
    if (touched.length) saveItems();
    return touched;
  }

  // 날짜 이동의 공통 핵심(검증+이동+저장) — "오늘/내일로 이동" 버튼과 기존 "직접 선택"
  // change 이벤트(closeMenu=true, 매번 팝업을 닫음) 뿐 아니라, 날짜 휠로 라이브 조작하는
  // 중(closeMenu=false, 매 틱마다 팝업을 유지)에도 재사용한다.
  function applyMoveMenuDateChange(itemIds, targetDate, closeMenu) {
    var touched = applyMoveItemsToDate(itemIds, targetDate);
    if (touched === null) return;

    if (closeMenu) {
      // 이동된 항목은 현재 화면(선택된 날짜/주)에서 사라지거나 다른 칸으로 옮겨갈 수 있어
      // closeMoveDateMenu()의 "원래 화살표로 포커스 복원"은 의미가 없다 — 팝업만 직접 정리한다.
      if (activeMoveMenu) {
        activeMoveMenu.el.remove();
        document.removeEventListener('pointerdown', onOutsideMoveMenuPointerDown, true);
        document.removeEventListener('keydown', onMoveMenuKeydown, true);
        activeMoveMenu = null;
      }
      state.selectedItemIds.clear();
      state.selectedOccurrenceById.clear();
      state.lastSelectedItemId = null;
      state.selectionAnchor = null;
    }
    renderApp();

    if (closeMenu && touched.length) {
      announce(touched.length + '개 항목을 ' + formatAnnounceDate(targetDate) + '로 이동했습니다.');
    }
  }

  // 수동 이동 팝업(화살표·오늘/내일 버튼) 전용 래퍼 — 이동 후 팝업을 닫고 선택을 해제한다.
  function moveItemsToDate(itemIds, targetDate) {
    applyMoveMenuDateChange(itemIds, targetDate, true);
  }
// 다일 일정의 시작~종료 범위 이동 공통 핵심 — 기존 "직접 선택" change 이벤트(closeMenu=true,
// 매번 팝업을 닫음) 뿐 아니라, 날짜 휠로 라이브 조작하는 중(closeMenu=false, 매 틱마다
// 팝업을 유지)에도 재사용한다.
function applyMoveMenuRangeChange(
  itemId,
  startDate,
  endDate,
  closeMenu
) {
  var datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (
    !datePattern.test(startDate) ||
    !datePattern.test(endDate)
  ) {
    return;
  }

  /*
   * 종료일이 시작일보다 앞이면
   * 시작일과 같은 날짜로 자동 보정한다.
   */
  if (endDate < startDate) {
    endDate = startDate;
  }

  var item = findItemById(itemId);

  // task/memo도 이제 시작~종료 범위를 가질 수 있어 schedule 제한을 없앴다. 완료 상태
  // 처리(shiftScheduleCompletionMap/normalizeCompletionMapForRange/
  // syncScheduleOverallCompleted)는 completionByDate가 schedule 전용 개념이므로
  // 아래에서 item.type==='schedule'일 때만 호출한다(4/5번 완료 규칙 -- task/memo에
  // completionByDate를 새로 만들지 않는다).
  if (
    !item ||
    item.deletedAt
  ) {
    return;
  }

  var oldStartDate = item.date;
  var oldEndDate =
    item.endDate || item.date;

  /*
   * 날짜가 실제로 달라지지 않았다면
   * (닫는 호출일 때만) 메뉴만 닫고 종료한다.
   */
  if (
    oldStartDate === startDate &&
    oldEndDate === endDate
  ) {
    if (closeMenu) closeMoveDateMenu(false);
    return;
  }

  withHistoryTransaction(function () {
    /*
     * 시작일이 바뀌었다면 기존 완료 기록도
     * 같은 날짜 차이만큼 이동한다(schedule 전용).
     */
    if (oldStartDate !== startDate && item.type === 'schedule') {
  shiftScheduleCompletionMap(
    item,
    oldStartDate,
    startDate
  );
}

    item.date = startDate;
    item.endDate = endDate;
item.originalDate = startDate;
item.migratedFrom = null;
    /*
     * 새 기간에 맞춰 날짜별 완료 기록을 정리한다(schedule 전용 -- task/memo는
     * item.completed 하나만 쓰고 완료 규칙 자체를 바꾸지 않는다).
     */
    if (item.type === 'schedule') {
      normalizeCompletionMapForRange(item);
      syncScheduleOverallCompleted(item);
    }

    item.updatedAt = Date.now();

    /*
     * 시작일이 바뀐 경우에만
     * 새 날짜 목록의 순서를 다시 배치한다.
     */
    if (oldStartDate !== startDate) {
      assignOrderForMove(
        [item],
        startDate
      );
    }
  });

  saveItems();

  if (closeMenu) {
    if (activeMoveMenu) {
      activeMoveMenu.el.remove();

      document.removeEventListener(
        'pointerdown',
        onOutsideMoveMenuPointerDown,
        true
      );

      document.removeEventListener(
        'keydown',
        onMoveMenuKeydown,
        true
      );

      activeMoveMenu = null;
    }

    state.selectedItemIds.clear();
    state.selectedOccurrenceById.clear();
    state.lastSelectedItemId = null;
    state.selectionAnchor = null;
  }

  renderApp();

  if (closeMenu) {
    announce(
      '일정을 ' +
      formatAnnounceDate(startDate) +
      '부터 ' +
      formatAnnounceDate(endDate) +
      '까지로 변경했습니다.'
    );
  }
}

function moveSingleScheduleToRange(
  itemId,
  startDate,
  endDate
) {
  applyMoveMenuRangeChange(itemId, startDate, endDate, true);
}
  // ---------------------------------------------------------------------
  // 7: 소프트 삭제(휴지통) — 실제로 state.items에서 제거하지 않고 deletedAt만 채운다.
  // getItemsForDate가 deletedAt이 있는 항목을 걸러내므로 Daily/Weekly/이월/달력 점에서
  // 저절로 사라진다. 복원은 deletedAt만 지우면 원래 date/order/type/completionByDate가
  // 그대로 남아있어 모든 화면에 다시 나타난다.
  // ---------------------------------------------------------------------
  function softDeleteItems(itemIds) {
    var uniqueIds = Array.from(new Set(itemIds));
    var touched = [];
    withHistoryTransaction(function () {
      uniqueIds.forEach(function (id) {
        var item = findItemById(id);
        if (!item || item.deletedAt) return;
        item.deletedAt = new Date().toISOString();
        item.updatedAt = Date.now();
        touched.push(item);
      });
    });
    if (!touched.length) return touched;
    saveItems();
    state.selectedItemIds.clear();
    state.selectedOccurrenceById.clear();
    state.lastSelectedItemId = null;
    state.selectionAnchor = null;
    renderApp();
    announce(touched.length + '개 항목을 휴지통으로 이동했습니다.');
    return touched;
  }

  // 8: 복원/영구 삭제된 항목만 trashSelectedItemIds에서 제거한다(전체를 비우지 않음) —
  // 행별 버튼으로 선택 밖의 항목 하나만 복원해도 나머지 선택은 그대로 남는다. 반대로
  // bulk 작업은 선택 전체를 대상으로 호출되므로 이 가지치기만으로 자연히 선택이 비워진다.
  function pruneTrashSelection(touchedIds) {
    var changed = false;
    touchedIds.forEach(function (id) {
      if (state.trashSelectedItemIds.delete(id)) changed = true;
    });
    if (state.trashSelectionAnchor && touchedIds.indexOf(state.trashSelectionAnchor) !== -1) {
      state.trashSelectionAnchor = null;
    }
    if (changed) { renderTrashSelectionState(); renderTrashBulkBar(); }
  }

  function restoreItems(itemIds) {
    var uniqueIds = Array.from(new Set(itemIds));
    var touched = [];
    withHistoryTransaction(function () {
      uniqueIds.forEach(function (id) {
        var item = findItemById(id);
        if (!item || !item.deletedAt) return;
        item.deletedAt = null;
        item.updatedAt = Date.now();
        touched.push(item);
      });
    });
    if (!touched.length) return touched;
    saveItems();
    pruneTrashSelection(touched.map(function (it) { return it.id; }));
    renderApp();
    announce(touched.length + '개 항목을 복원했습니다.');
    return touched;
  }

  function permanentDeleteItems(itemIds) {
    var idSet = {};
    itemIds.forEach(function (id) { idSet[id] = true; });
    var removedIds = [];
    withHistoryTransaction(function () {
      var next = state.items.filter(function (it) {
        if (idSet[it.id]) { removedIds.push(it.id); return false; }
        return true;
      });
      state.items = next;
    });
    if (!removedIds.length) return 0;
    saveItems();
    pruneTrashSelection(removedIds);
    renderApp();
    announce(removedIds.length + '개 항목을 영구 삭제했습니다.');
    return removedIds.length;
  }

  // ---------------------------------------------------------------------
  // 7: 항목 복제(Ctrl/Cmd+C·V) — 앱 내부 클립보드. Ctrl/Cmd+C는 선택된 항목을 읽어서
  // 가벼운 스냅샷으로만 저장할 뿐 state.items를 바꾸지 않으므로 history/저장/렌더링
  // 어느 것도 건드리지 않는다. id는 새 항목 id로 재사용하지 않고, 붙여넣을 때 "원본 바로
  // 다음에 놓기" 위한 위치 찾기 용도로만 쓴다.
  // ---------------------------------------------------------------------
  function copySelectedItemsToClipboard() {
    var ids = Array.from(state.selectedItemIds);
    if (!ids.length) return;
    var items = ids
      .map(function (id) { return findItemById(id); })
      .filter(function (it) { return it && !it.deletedAt; })
      .map(function (it) {
        return {
          id: it.id,
          type: it.type,
          text: it.text,
          date: it.date,
          endDate: it.endDate,
          allDay: it.allDay,
          startTime: it.startTime,
          endTime: it.endTime
        };
      });
    if (!items.length) return;
    state.itemClipboard = { items: items, copiedAt: Date.now() };
  }

  // Ctrl/Cmd+V: 클립보드 항목을 실제 새 항목으로 만든다. 새 id/createdAt/updatedAt, completed
  // = false(진행 중인 완료 표시 없음), originalDate = 자기 자신의 date(방금 만들어진 항목이라
  // 이월 이력이 없음), migratedFrom = null. 날짜별로 묶어 각 복제본을 그 날짜 목록에서
  // 원본 바로 다음 자리에 끼워 넣고(여러 개를 붙여넣어도 원래 상대 순서 유지), 한 번의
  // history 트랜잭션·저장·렌더링으로 처리한 뒤 새로 만든 항목들을 선택 상태로 남긴다.
  function pasteItemsFromClipboard() {
    var clip = state.itemClipboard;
    if (!clip || !clip.items.length) return;

    var newIds = [];
    withHistoryTransaction(function () {
      var byDate = {};
      var dateOrder = [];
      clip.items.forEach(function (src) {
        if (!byDate[src.date]) { byDate[src.date] = []; dateOrder.push(src.date); }
        byDate[src.date].push(src);
      });
      dateOrder.forEach(function (date) {
        var list = getItemsForDate(date).slice().sort(function (a, b) { return a.order - b.order; });
        // 클립보드에 담긴 순서가 아니라, 이 날짜에서 원본들이 "지금" 놓여 있는 순서를 기준으로
        // 삼아야 여러 개를 복제했을 때 원래 상대 순서가 그대로 유지된다.
        var entries = byDate[date].slice().sort(function (a, b) {
          var ia = list.findIndex(function (it) { return it.id === a.id; });
          var ib = list.findIndex(function (it) { return it.id === b.id; });
          return ia - ib;
        });
        entries.forEach(function (src) {
          var dupe = makeItem({
            type: src.type,
            text: src.text,
            date: src.date,
            endDate: src.endDate,
            allDay: src.allDay,
            startTime: src.startTime,
            endTime: src.endTime,
            completed: false
          });
          state.items.push(dupe);
          newIds.push(dupe.id);
          var idx = list.findIndex(function (it) { return it.id === src.id; });
          if (idx === -1) list.push(dupe); else list.splice(idx + 1, 0, dupe);
        });
        list.forEach(function (it, i) { it.order = i; });
      });
    });
    if (!newIds.length) return;
    saveItems();
    state.selectedItemIds = new Set(newIds);
    state.selectedOccurrenceById.clear();
    state.lastSelectedItemId = newIds[newIds.length - 1];
    state.selectionAnchor = null;
    renderApp();
    announce(newIds.length + '개 항목을 복제했습니다.');
  }

  // ---------------------------------------------------------------------
  // 드래그앤드롭 — 라이브러리 없이 Pointer Events만 사용한다. 4~6px 이동해야
  // 실제 드래그로 간주한다(그 전까지는 단순 클릭). 색상 강조는 보조 표시일 뿐이고,
  // 주요 피드백은 (1) 포인터를 따라다니는 실제 카드 복제본(drag preview)과
  // (2) 삽입 후보 위치에 실제로 생기는 카드 크기의 빈 공간(placeholder)이다.
  // 이동/재정렬 데이터 로직은 그대로 재사용한다 — moveItemsToDate가 쓰는
  // applyMoveItemsToDate(다른 날짜)와 reorderItemsWithinDate(같은 날짜).
  // ---------------------------------------------------------------------
  var DRAG_THRESHOLD = 5; // px
  var FLIP_DURATION = 150; // ms
  var dragState = null;
  // dragState 형태:
  // { active, pending, pointerId, startX, startY, lastClientX, lastClientY, rafScheduled,
  //   draggedItemIds, sourceContext, sourceDate, overContext, overDate, overItemId,
  //   dropPosition, pointerCurrentlyValid, handle, anchorRow, anchorRect,
  //   grabOffsetX, grabOffsetY, previewEl, placeholderEl, hiddenRows,
  //   itemId, occurrenceDate, clickModifiers }

  // 7A.2: 실제 드래그(threshold 초과) 뒤에 이어지는 네이티브 'click'이 선택 gutter의 click
  // 리스너에서 다시 "클릭 = 선택"으로 처리되지 않도록 억제한다(desc 에디터의
  // suppressNextDescEditorClickOnce와 같은 패턴 — pointerup/pointercancel 직후 같은 동기
  // 이벤트 시퀀스 안에서 바로 다음 click 하나만 정확히 삼킨다).
  var suppressNextItemGutterClick = false;
  function suppressNextItemGutterClickOnce() {
    suppressNextItemGutterClick = true;
    setTimeout(function () { suppressNextItemGutterClick = false; }, 0);
  }

  function onDragHandlePointerDown(e, itemId, context, sourceDate) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!findItemById(itemId)) return;
    // 아래 preventDefault()가 네이티브 blur까지 함께 막아버릴 수 있어, 편집 중이었다면
    // 여기서 명시적으로 먼저 저장해 둔다.
    if (activeTitleEdit) commitTitleEdit();
    if (activeDateWheel) closeDateWheelPopup(false);
    if (activeTimeWheel) closeTimeWheelPopup(false);
    e.preventDefault(); // 네이티브 드래그 고스트/텍스트 선택 방지

    var anchorRow = e.currentTarget.closest('[data-item-id]');
    if (!anchorRow) return;

    // 9/19: 이미 다중 선택(≥2)에 포함된 항목을 잡으면 선택 전체를 함께 옮기고,
    // 아니면 이 항목 하나만 새로 선택한다(수동 이동의 getSelectedItemsForAction과 동일 규칙).
    // 7A.2: Shift/Ctrl이 눌려 있으면 여기서 미리 단일 선택하지 않는다 — selectSingleItem이
    // state.selectionAnchor를 이 항목으로 덮어써서 Shift 범위 계산이 깨지기 때문이다. 실제
    // 모디파이어 인식 선택은(순수 클릭으로 끝나면) 아래 gutter click 리스너가 처리한다.
    var hasModifier = e.shiftKey || e.ctrlKey || e.metaKey;
    var ids = getSelectedItemsForAction(itemId);
    if (!hasModifier && !(state.selectedItemIds.has(itemId) && state.selectedItemIds.size >= 2)) {
      selectSingleItem(itemId, context, sourceDate);
    }

    var handle = e.currentTarget;
    var anchorRect = anchorRow.getBoundingClientRect();
    dragState = {
      active: false,
      pending: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      rafScheduled: false,
      draggedItemIds: ids,
      sourceContext: context,
      sourceDate: sourceDate,
      overContext: null,
      overDate: null,
      overItemId: null,
      dropPosition: null,
      pointerCurrentlyValid: false,
      handle: handle,
      anchorRow: anchorRow,
      anchorRect: anchorRect,
      grabOffsetX: e.clientX - anchorRect.left,
      grabOffsetY: e.clientY - anchorRect.top,
      previewEl: null,
      placeholderEl: null,
      hiddenRows: []
    };

    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    handle.addEventListener('pointermove', onDragPointerMove);
    handle.addEventListener('pointerup', onDragPointerUp);
    handle.addEventListener('pointercancel', onDragPointerCancel);
  }

  // --- drag preview (포인터를 따라다니는 실제 카드 복제본) ------------------
  function createDragPreview() {
    var rect = dragState.anchorRect;
    var preview = document.createElement('div');
    preview.className = 'drag-preview';
    preview.style.width = rect.width + 'px';
    preview.style.height = rect.height + 'px';

    var clone = dragState.anchorRow.cloneNode(true);
    clone.classList.remove('is-selected');
    clone.removeAttribute('aria-selected');
    preview.appendChild(clone);

    if (dragState.draggedItemIds.length >= 2) {
      preview.classList.add('drag-preview-stack');
      var badge = document.createElement('span');
      badge.className = 'drag-count-badge';
      badge.textContent = String(dragState.draggedItemIds.length);
      preview.appendChild(badge);
    }

    document.body.appendChild(preview);
    dragState.previewEl = preview;
    positionDragPreview(dragState.startX, dragState.startY);
  }

  // position:fixed(top:0,left:0) 고정 후 transform: translate3d만 갱신 —
  // top/left를 직접 바꿔 매 프레임 레이아웃을 유발하지 않는다.
  function positionDragPreview(x, y) {
    if (!dragState || !dragState.previewEl) return;
    var left = x - dragState.grabOffsetX;
    var top = y - dragState.grabOffsetY;
    dragState.previewEl.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
  }

  // --- 원본 카드 숨김/복원 ---------------------------------------------------
  function hideSourceRows() {
    var idSet = {};
    dragState.draggedItemIds.forEach(function (id) { idSet[id] = true; });
    // 체크박스/상태문양/화살표 버튼도 이벤트 위임 때문에 각자 data-item-id를 갖고
    // 있고, drag-preview 안의 복제본도 같은 data-item-id를 그대로 들고 있으므로,
    // 실제 목록(#daily-list, #rollover-list, .week-card ul) 안의 행 컨테이너만 정확히 골라 숨긴다.
    var rows = document.querySelectorAll(
      '#daily-list > .task[data-item-id], #rollover-list > .task[data-item-id], .week-card ul[data-date] > li[data-item-id]');
    rows.forEach(function (row) {
      if (idSet[row.dataset.itemId]) {
        row.classList.add('drag-source-hidden');
        dragState.hiddenRows.push(row);
      }
    });
  }

  function restoreSourceRows(ds) {
    if (!ds) return;
    ds.hiddenRows.forEach(function (row) {
      row.classList.remove('drag-source-hidden');
    });
    ds.hiddenRows = [];
  }

  // --- placeholder(카드 크기의 실제 빈 공간) --------------------------------
  function createPlaceholder() {
    var placeholder;
    if (dragState.sourceContext === 'daily') {
      placeholder = document.createElement('div');
      placeholder.className = 'drag-placeholder drag-placeholder-daily';
    } else {
      placeholder = document.createElement('li');
      placeholder.className = 'drag-placeholder drag-placeholder-weekly';
    }
    placeholder.style.height = dragState.anchorRect.height + 'px';
    dragState.anchorRow.parentNode.insertBefore(placeholder, dragState.anchorRow);
    dragState.placeholderEl = placeholder;
    dragState.overContext = dragState.sourceContext;
    dragState.overDate = dragState.sourceDate;
    dragState.overItemId = null;
    dragState.dropPosition = 'end';
    dragState.pointerCurrentlyValid = true;
  }

  function clearColumnHighlight() {
    document.querySelectorAll('.drop-target-column,.drop-target-list').forEach(function (el) {
      el.classList.remove('drop-target-column', 'drop-target-list');
    });
  }

  // 12: 달력 드롭 하이라이트 — 항상 그 시점에 하나의 날짜 칸에만 붙어 있어야 하므로, 새 칸에
  // 붙이기 전에 이전 칸에서 먼저 뗀다. cleanupDragDom()이 성공/취소/Escape/pointercancel
  // 어느 경로든 마지막에 항상 거치므로 거기서 한 번만 정리하면 된다.
  var calendarDropHighlightDate = null;
  function setCalendarDropHighlight(date) {
    if (calendarDropHighlightDate === date) return;
    clearCalendarDropHighlight();
    var cell = document.querySelector('.dates .date[data-date="' + date + '"]');
    if (cell) cell.classList.add('calendar-drop-target');
    calendarDropHighlightDate = date;
  }
  function clearCalendarDropHighlight() {
    if (calendarDropHighlightDate === null) return;
    document.querySelectorAll('.dates .date.calendar-drop-target').forEach(function (el) {
      el.classList.remove('calendar-drop-target');
    });
    calendarDropHighlightDate = null;
  }

  // FLIP: placeholder를 새 위치로 옮기기 전/후의 형제 행 위치를 재서, 순간이동 대신
  // 짧은 transform 트랜지션으로 자연스럽게 비켜나는 것처럼 보이게 한다.
  function movePlaceholderWithFlip(targetList, insertBeforeEl) {
    var placeholder = dragState.placeholderEl;
    var oldParent = placeholder.parentNode;
    var affected = [];
    if (oldParent) affected = affected.concat(Array.prototype.slice.call(
      oldParent.querySelectorAll(':scope > [data-item-id]:not(.drag-source-hidden)')));
    if (targetList !== oldParent) affected = affected.concat(Array.prototype.slice.call(
      targetList.querySelectorAll(':scope > [data-item-id]:not(.drag-source-hidden)')));

    var firstRects = new Map();
    affected.forEach(function (el) { firstRects.set(el, el.getBoundingClientRect()); });

    if (insertBeforeEl) {
      targetList.insertBefore(placeholder, insertBeforeEl);
    } else {
      targetList.appendChild(placeholder);
    }

    affected.forEach(function (el) {
      var first = firstRects.get(el);
      var last = el.getBoundingClientRect();
      var dy = first.top - last.top;
      if (Math.abs(dy) < 0.5) return;
      el.style.transition = 'none';
      el.style.transform = 'translateY(' + dy + 'px)';
      el.getBoundingClientRect(); // 강제 리플로우 — 위 transform을 실제로 적용시킨다.
      el.style.transition = 'transform ' + FLIP_DURATION + 'ms ease';
      el.style.transform = '';
      clearInlineTransformAfter(el, FLIP_DURATION + 40);
    });
  }

  function clearInlineTransformAfter(el, delay) {
    setTimeout(function () {
      el.style.transition = '';
      el.style.transform = '';
    }, delay);
  }

  // placeholder는 Daily(div)와 Weekly(li) 사이를 옮겨다닐 수 있으므로, 태그가 목표
  // 컨테이너와 안 맞으면(예: daily에서 집어 weekly 열 위로 이동) 같은 자리에서 올바른
  // 태그의 새 요소로 교체한다 — ul 안에 div가 들어가는 잘못된 마크업을 방지한다.
  function ensurePlaceholderTagForContext(context) {
    var needsLi = context === 'weekly';
    var current = dragState.placeholderEl;
    var currentIsLi = current.tagName === 'LI';
    if (needsLi === currentIsLi) return;

    var next = document.createElement(needsLi ? 'li' : 'div');
    next.className = needsLi ? 'drag-placeholder drag-placeholder-weekly' : 'drag-placeholder drag-placeholder-daily';
    next.style.height = dragState.anchorRect.height + 'px';
    if (current.parentNode) {
      current.parentNode.replaceChild(next, current);
    }
    dragState.placeholderEl = next;
  }

  // 4: #daily-list와 #rollover-list는 같은 날짜(state.selectedDate)의 하나의 order 공간을
  // 시각적으로만 나눈 것이라, 드래그 드롭 대상으로는 둘 다 "daily" 컨텍스트로 다룬다.
  function findDailyDropList(el, x, y) {
  if (!el) return null;

  var dailyList = document.getElementById('daily-list');
  var rolloverList = document.getElementById('rollover-list');

  // 실제 목록 또는 카드 위에 있을 때는 기존 판정 유지
  if (dailyList && dailyList.contains(el)) return dailyList;

  if (
    rolloverList &&
    !rolloverList.hidden &&
    rolloverList.contains(el)
  ) {
    return rolloverList;
  }

  /*
   * Daily 목록이 비어 있으면 #daily-list의 높이가 0이 되어
   * elementFromPoint()가 #daily-list가 아니라 .daily를 반환한다.
   * 이때 목록 시작점 아래의 빈 Daily 영역을 #daily-list 드롭 영역으로 취급한다.
   */
  var daily = document.querySelector('.daily');
  var normalView = document.querySelector('.daily-normal-view');

  if (
    !dailyList ||
    !daily ||
    !normalView ||
    normalView.hidden ||
    state.currentView !== 'today'
  ) {
    return null;
  }

  // 포인터 아래 요소가 실제 Daily 영역 안에 있어야 함
  if (el !== daily && !daily.contains(el)) return null;

  // 제목·빠른 입력·이월 메뉴 위는 빈 목록 영역이 아님
  if (
    el.closest('.daily-title') ||
    el.closest('.quick') ||
    el.closest('.rollover') ||
    el.closest('#trash-view')
  ) {
    return null;
  }

  var dailyRect = daily.getBoundingClientRect();
  var listRect = dailyList.getBoundingClientRect();

  var insideHorizontal =
    x >= dailyRect.left &&
    x <= dailyRect.right;

  var insideEmptyListArea =
    y >= listRect.top &&
    y <= dailyRect.bottom;

  return insideHorizontal && insideEmptyListArea
    ? dailyList
    : null;
}

  function updateDropTarget(x, y) {
    if (!dragState || !dragState.placeholderEl) return;
    var el = document.elementFromPoint(x, y);
    var dailyDropList = findDailyDropList(el, x, y);
    var weeklyUl = el ? el.closest('.week-card ul[data-date]') : null;
    // 9/10: 드래그 프리뷰가 pointer-events:none이라 elementFromPoint는 항상 프리뷰
    // 아래의 실제 달력 칸을 반환한다 — daily/weekly 목록이 아닐 때만 달력 칸인지 본다.
    var calendarCell = (!dailyDropList && !weeklyUl && el) ? el.closest('.date[data-date]') : null;

    if (calendarCell) {
      // 10/13: 달력 칸은 목록이 아니라 "이 날짜로 이동" 자체가 목적이라 placeholder를
      // 목록 안으로 옮기지 않는다(원래 자리에 그대로 둔 채 칸만 강조) — 인접 월 칸도
      // data-date가 실제 날짜라 그대로 유효한 드롭 대상이 된다.
      dragState.pointerCurrentlyValid = true;
      clearColumnHighlight();
      setCalendarDropHighlight(calendarCell.dataset.date);
      dragState.overContext = 'calendar';
      dragState.overDate = calendarCell.dataset.date;
      dragState.overItemId = null;
      dragState.dropPosition = null;
      return;
    }
    clearCalendarDropHighlight();

    var targetContext, targetDate, targetList;
    if (dailyDropList) {
      targetContext = 'daily'; targetDate = state.selectedDate; targetList = dailyDropList;
    } else if (weeklyUl) {
      targetContext = 'weekly'; targetDate = weeklyUl.dataset.date; targetList = weeklyUl;
    } else {
      // 12: 허용되지 않은 영역 위에서는 placeholder를 마지막 유효 위치에 그대로 둔다.
      dragState.pointerCurrentlyValid = false;
      clearColumnHighlight();
      return;
    }

    dragState.pointerCurrentlyValid = true;
    ensurePlaceholderTagForContext(targetContext);
    clearColumnHighlight();
    // 보조 강조는 실제로 다른 날짜/열로 옮길 때만 아주 약하게 표시한다. 같은 목록 안에서
    // 순서만 바꿀 때는 placeholder 공간만으로 충분해서 배경 강조가 오히려 과해 보인다.
    if (targetDate !== dragState.sourceDate) {
      if (targetContext === 'weekly') {
        var card = targetList.closest('.week-card');
        if (card) card.classList.add('drop-target-column');
      } else {
        targetList.classList.add('drop-target-list');
      }
    }

    var rows = Array.prototype.slice.call(
      targetList.querySelectorAll(':scope > [data-item-id]:not(.drag-source-hidden)'));
    var insertBeforeEl = null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { insertBeforeEl = rows[i]; break; }
    }

    var alreadyThere = dragState.placeholderEl.parentNode === targetList &&
      dragState.placeholderEl.nextElementSibling === (insertBeforeEl || null);
    if (!alreadyThere) {
      movePlaceholderWithFlip(targetList, insertBeforeEl);
    }

    dragState.overContext = targetContext;
    dragState.overDate = targetDate;
    dragState.overItemId = insertBeforeEl ? insertBeforeEl.dataset.itemId : null;
    dragState.dropPosition = insertBeforeEl ? 'before' : 'end';
  }

  function activateDrag() {
    dragState.pending = false;
    dragState.active = true;
    if (activeTypeMenu) closeTypeMenu(false);
    if (activeMoveMenu) closeMoveDateMenu(false);
    if (activeWeeklyInlineAdd) closeWeeklyInlineAdd(false);
    document.body.classList.add('dnd-active');

    createDragPreview();
    hideSourceRows();
    createPlaceholder();
  }

  function dragRafTick() {
    if (!dragState) return;
    dragState.rafScheduled = false;
    positionDragPreview(dragState.lastClientX, dragState.lastClientY);
    updateDropTarget(dragState.lastClientX, dragState.lastClientY);
    ensureAutoScrollLoop();
  }

  // --- 드래그 중 가장자리 자동 스크롤 ----------------------------------------
  var AUTOSCROLL_EDGE = 28; // px, 24~32 범위
  var AUTOSCROLL_MAX_SPEED = 16; // px/frame, 가장자리에 가까울수록 이 값에 근접
  var autoScrollRAF = null;

  // el부터 위로 올라가며 "실제로 세로 스크롤 가능한" 첫 조상을 찾는다(overflow-y가
  // auto/scroll이면서 scrollHeight > clientHeight). .daily/.artboard는 overflow:hidden이라
  // 건너뛰고, 마지막엔 페이지 자체(document.scrollingElement)로 폴백한다.
  function findScrollableAncestor(el) {
    var node = el ? el.parentElement : null;
    while (node && node !== document.body && node !== document.documentElement) {
      var style = getComputedStyle(node);
      var canScrollY = style.overflowY === 'auto' || style.overflowY === 'scroll';
      if (canScrollY && node.scrollHeight > node.clientHeight) return node;
      node = node.parentElement;
    }
    var root = document.scrollingElement || document.documentElement;
    if (root && root.scrollHeight > root.clientHeight) return root;
    return null;
  }

  function computeAutoScroll(x, y) {
    if (!dragState || !dragState.active) return null;
    var el = document.elementFromPoint(x, y);
    if (!el) return null;

    var weeklyUl = el.closest('.week-card ul[data-date]');
    var dailyDropList = findDailyDropList(el);
    var container;
    if (weeklyUl) {
      // 7: 개별 ul은 더 이상 스크롤 컨테이너가 아니다 — Weekly 전체가 공유하는
      // .weekly-body를 스크롤해 7개 열이 함께 움직이게 한다.
      container = weeklyUl.closest('.weekly-body');
    } else if (dailyDropList) {
      container = findScrollableAncestor(dailyDropList);
    } else {
      return null;
    }
    if (!container) return null;

    var rect = container.getBoundingClientRect();
    var edge = AUTOSCROLL_EDGE;
    var distTop = y - rect.top;
    var distBottom = rect.bottom - y;

    var direction = 0;
    var proximity = 0;
    if (distTop >= 0 && distTop < edge) {
      direction = -1;
      proximity = (edge - distTop) / edge;
    } else if (distBottom >= 0 && distBottom < edge) {
      direction = 1;
      proximity = (edge - distBottom) / edge;
    } else {
      return null; // 중앙 — 자동 스크롤 대상 아님
    }

    var speed = Math.max(2, Math.round(AUTOSCROLL_MAX_SPEED * proximity));
    return { container: container, direction: direction, speed: speed };
  }

  function autoScrollTick() {
    autoScrollRAF = null;
    if (!dragState || !dragState.active) return; // 드래그 종료/취소 시 다음 프레임을 예약하지 않아 즉시 멈춘다.

    var info = computeAutoScroll(dragState.lastClientX, dragState.lastClientY);
    if (!info) return; // 가장자리를 벗어났으면(중앙) 스스로 멈춘다 — 다시 가장자리에 들어오면 재시작됨.

    var before = info.container.scrollTop;
    info.container.scrollTop += info.direction * info.speed;
    if (info.container.scrollTop !== before) {
      // 스크롤된 만큼 카드 위치가 바뀌므로 placeholder/열 강조를 새 레이아웃 기준으로 다시 계산한다.
      updateDropTarget(dragState.lastClientX, dragState.lastClientY);
      positionDragPreview(dragState.lastClientX, dragState.lastClientY);
    }
    autoScrollRAF = requestAnimationFrame(autoScrollTick);
  }

  // 이미 루프가 돌고 있으면 아무 것도 하지 않는다 — 중복 루프 방지.
  function ensureAutoScrollLoop() {
    if (autoScrollRAF !== null) return;
    autoScrollRAF = requestAnimationFrame(autoScrollTick);
  }

  function stopAutoScroll() {
    if (autoScrollRAF !== null) {
      cancelAnimationFrame(autoScrollRAF);
      autoScrollRAF = null;
    }
  }

  function onDragPointerMove(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    dragState.lastClientX = e.clientX;
    dragState.lastClientY = e.clientY;
    if (dragState.pending) {
      var dx = e.clientX - dragState.startX;
      var dy = e.clientY - dragState.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      activateDrag();
    }
    if (!dragState.rafScheduled) {
      dragState.rafScheduled = true;
      requestAnimationFrame(dragRafTick);
    }
  }

  function teardownDragListeners(ds) {
    var handle = ds && ds.handle;
    if (!handle) return;
    handle.removeEventListener('pointermove', onDragPointerMove);
    handle.removeEventListener('pointerup', onDragPointerUp);
    handle.removeEventListener('pointercancel', onDragPointerCancel);
    try { handle.releasePointerCapture(ds.pointerId); } catch (err) {}
  }

  function cleanupDragDom(ds) {
    stopAutoScroll(); // 드래그 종료/취소 경로 전부 이 함수를 거치므로 여기서 한 번만 멈추면 된다.
    if (ds.previewEl) ds.previewEl.remove();
    if (ds.placeholderEl) ds.placeholderEl.remove();
    restoreSourceRows(ds);
    clearColumnHighlight();
    clearCalendarDropHighlight(); // 12: 성공/취소/Escape/pointercancel 전부 여기를 거친다.
    document.body.classList.remove('dnd-active');
  }

  function abortDrag(ds) {
    cleanupDragDom(ds);
    if (dragState === ds) dragState = null;
  }

  // 같은 날짜 안에서의 순서 변경 — moveSingleItemToDate와 달리 date/endDate/
  // originalDate/migratedFrom/completionByDate는 절대 건드리지 않고 order(및 실제로
  // 바뀐 항목의 updatedAt)만 갱신한다(스펙: "이동"과 "순서 변경"은 서로 다른 연산).
  // dropPosition은 placeholder 로직이 항상 "이 항목 앞" 또는 "끝"만 계산하므로
  // 'before' | 'end' 두 가지만 쓴다.
  function reorderItemsWithinDate(itemIds, date, overItemId, dropPosition) {
    var all = state.items.filter(function (it) { return it.date === date; })
      .sort(function (a, b) { return a.order - b.order; });
    var movingSet = {};
    itemIds.forEach(function (id) { movingSet[id] = true; });
    var moving = all.filter(function (it) { return movingSet[it.id]; });
    var staying = all.filter(function (it) { return !movingSet[it.id]; });
    if (!moving.length) return false;

    var insertAt = staying.length;
    if (dropPosition === 'before' && overItemId) {
      var idx = staying.findIndex(function (it) { return it.id === overItemId; });
      if (idx !== -1) insertAt = idx;
    }

    var result = staying.slice(0, insertAt).concat(moving, staying.slice(insertAt));
    var changed = false;
    result.forEach(function (it, idx) {
      if (it.order !== idx) {
        it.order = idx;
        it.updatedAt = Date.now();
        changed = true;
      }
    });
    return changed;
  }

  function commitDrop(ds) {
  var ids = ds.draggedItemIds.filter(function (id) {
    return !!findItemById(id);
  });

  var mutated = false;
  var sameDate = ds.sourceDate === ds.overDate;

  // placeholder가 실제로 어느 Daily 목록에 놓였는지 기억한다.
  var targetListId =
    ds.placeholderEl && ds.placeholderEl.parentElement
      ? ds.placeholderEl.parentElement.id
      : null;

  if (ids.length) {
    if (!sameDate) {
      var touched = [];

      withHistoryTransaction(function () {
        ids.forEach(function (id) {
          var item = findItemById(id);
          if (!item || item.deletedAt) return;

          if (moveSingleItemToDate(item, ds.overDate)) {
  var isNormalDestination =
    ds.overContext === 'calendar' ||
    ds.overContext === 'weekly' ||
    (
      ds.overContext === 'daily' &&
      targetListId === 'daily-list'
    );

  if (isNormalDestination) {
    item.originalDate = item.date;
    item.migratedFrom = null;
  }

  touched.push(item);
}
        });

        if (touched.length) {
          // 먼저 대상 날짜에 임시 순서를 부여한다.
          assignOrderForMove(touched, ds.overDate);

          /*
           * 일반 Daily 목록에 직접 떨어뜨렸다면
           * 사용자가 지정한 정확한 위치에 들어가는 일반 항목으로 취급한다.
           * 이월 목록으로 강제로 올라가지 않게 한다.
           */
          if (
  ds.overContext === 'weekly' ||
  (
    ds.overContext === 'daily' &&
    targetListId === 'daily-list'
  )
) {
            touched.forEach(function (item) {
              item.originalDate = item.date;
              item.migratedFrom = null;
            });
          }

          /*
           * 달력 칸은 위치가 없는 날짜 이동이므로 재정렬하지 않는다.
           * Daily·Weekly 목록은 placeholder가 있던 위치를 실제 order에 반영한다.
           */
          if (ds.overContext !== 'calendar') {
            reorderItemsWithinDate(
              ids,
              ds.overDate,
              ds.overItemId,
              ds.dropPosition
            );
          }
        }
      });

      mutated = touched.length > 0;
      if (mutated) saveItems();
    } else if (ds.overContext !== 'calendar') {
      withHistoryTransaction(function () {
        var classificationChanged = false;

        /*
         * 이미 이월로 분류된 항목을 같은 날짜의 일반 Daily 목록에
         * 직접 놓은 경우에도 일반 항목으로 전환한다.
         */
        if (
  ds.overContext === 'weekly' ||
  ds.overContext === 'calendar' ||
  (
    ds.overContext === 'daily' &&
    targetListId === 'daily-list'
  )
) {
  touched.forEach(function (item) {
    item.originalDate = item.date;
    item.migratedFrom = null;
  });
}

        var reordered = reorderItemsWithinDate(
          ids,
          ds.overDate,
          ds.overItemId,
          ds.dropPosition
        );

        mutated = classificationChanged || reordered;
      });

      if (mutated) saveItems();
    }
  }

  /*
   * 달력 칸으로 이동한 경우에는 이동한 날짜를 바로 보여준다.
   */
  if (mutated && ds.overContext === 'calendar') {
  state.selectedDate = ds.overDate;
  state.calendarViewDate = ds.overDate.slice(0, 7) + '-01';
  state.rolloverExpanded = false;
  savePreferences();
}

  /*
   * 사용자가 이월 목록 안에 직접 떨어뜨린 경우에만 이월 목록을 연다.
   */
  if (
    mutated &&
    ds.overContext === 'daily' &&
    targetListId === 'rollover-list'
  ) {
    state.rolloverExpanded = true;
  }

  cleanupDragDom(ds);
  dragState = null;
  renderApp();

  if (mutated) {
    if (sameDate) {
      announce('항목 순서를 변경했습니다.');
    } else {
      announce(
        ids.length +
          '개 항목을 ' +
          formatAnnounceDate(ds.overDate) +
          '로 이동했습니다.'
      );
    }
  }
}

  function finishDrop(ds) {
    var valid = ds.pointerCurrentlyValid && ds.overContext && ds.overDate &&
      ds.placeholderEl && ds.placeholderEl.isConnected;
    if (!valid) {
      abortDrag(ds);
      return;
    }

    if (ds.overContext === 'calendar') {
      // 10: 달력 칸은 목록의 "자리"가 아니라 그냥 이동 대상 날짜일 뿐이라, placeholder
      // 위치로 되돌아가는 FLIP 애니메이션 없이 바로 데이터를 반영한다.
      commitDrop(ds);
      return;
    }

    var targetRect = ds.placeholderEl.getBoundingClientRect();
    var preview = ds.previewEl;
    if (!preview) { commitDrop(ds); return; }

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      preview.removeEventListener('transitionend', finish);
      commitDrop(ds);
    }
    preview.style.transition = 'transform ' + FLIP_DURATION + 'ms ease';
    preview.style.transform = 'translate3d(' + targetRect.left + 'px,' + targetRect.top + 'px,0)';
    preview.addEventListener('transitionend', finish);
    setTimeout(finish, FLIP_DURATION + 80); // transitionend 미발생 대비 안전장치
  }

  function onDragPointerUp(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    var ds = dragState;
    teardownDragListeners(ds);
    // 포인터를 뗀 순간 자동 스크롤은 즉시 멈춘다 — 드롭 정착 애니메이션이 남아있는 동안
    // (아직 dragState.active === true) 목록이 계속 스크롤되는 것처럼 보이면 안 된다.
    stopAutoScroll();
    if (!ds.active) {
      // 임계값 미도달 — 순수 클릭이었을 뿐이다. 7A.2: 여기서 선택을 처리하지 않는다 —
      // pointerup 뒤 같은 동기 시퀀스에서 이어지는 네이티브 'click'이 gutter의 click
      // 리스너로 자연스럽게 bubbling돼(모디파이어 인식) 선택을 처리한다(중복 처리 방지).
      dragState = null;
      return;
    }
    // 7A.2: 실제 drag였다면 곧 이어질 네이티브 click을 선택 gutter가 다시 "클릭=선택"으로
    // 오인하지 않게 미리 억제한다.
    suppressNextItemGutterClickOnce();
    finishDrop(ds);
  }

  function onDragPointerCancel(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    var ds = dragState;
    teardownDragListeners(ds);
    if (ds.active) suppressNextItemGutterClickOnce();
    abortDrag(ds);
  }

  function cancelActiveDrag() {
    if (!dragState) return;
    var ds = dragState;
    teardownDragListeners(ds);
    if (ds.active) suppressNextItemGutterClickOnce();
    abortDrag(ds);
  }

  // ---------------------------------------------------------------------
  // Weekly "+" 인라인 추가 — 메인 빠른 입력과 동일한 createItem()을 재사용한다.
  // 한 번에 하나의 열에서만 열리며, 텍스트가 남아있는 상태로 다른 + 를 누르면
  // 내용을 지우지 않고 기존 입력으로 포커스만 되돌린다.
  // ---------------------------------------------------------------------
  var activeWeeklyInlineAdd = null; // { li, input, date, plusBtn, mode }
  var WEEKLY_INLINE_MODES = [
    { type: 'task', icon: 'ic-dot', label: '할 일' },
    { type: 'schedule', icon: 'ic-ring', label: '일정' },
    { type: 'memo', icon: 'ic-dash', label: '메모' }
  ];

  function onOutsideWeeklyInlineAddPointerDown(e) {
    if (!activeWeeklyInlineAdd) return;
    if (activeWeeklyInlineAdd.li.contains(e.target)) return;
    if (activeWeeklyInlineAdd.plusBtn && activeWeeklyInlineAdd.plusBtn.contains(e.target)) return;
    // 입력한 내용이 있으면 임의로 지우지 않고 그대로 둔다(포커스만 이동 허용).
    if (activeWeeklyInlineAdd.input.value.trim().length > 0) return;
    closeWeeklyInlineAdd(false);
  }

  function closeWeeklyInlineAdd(restoreFocus) {
    if (!activeWeeklyInlineAdd) return;
    var plusBtn = activeWeeklyInlineAdd.plusBtn;
    document.removeEventListener('pointerdown', onOutsideWeeklyInlineAddPointerDown, true);
    if (activeWeeklyInlineAdd.li.isConnected) activeWeeklyInlineAdd.li.remove();
    activeWeeklyInlineAdd = null;
    if (restoreFocus !== false && plusBtn && plusBtn.isConnected) plusBtn.focus();
  }

  // 8: 입력줄 DOM만 만들어 그 날짜 ul 맨 위에 꽂고 activeWeeklyInlineAdd를 갱신한다.
  // createItem()의 renderApp()이 ul.replaceChildren()으로 목록 전체를 다시 그리며 이전
  // 입력줄(li)을 함께 지워버리므로, Enter로 항목을 만든 직후 이 함수를 다시 호출해 같은
  // 날짜·같은 모드로 입력줄을 재구성한다 — 그래서 입력창이 계속 열려 있는 것처럼 보인다.
  // 포커스 이동과 바깥 클릭 감지 등록은 호출자(openWeeklyInlineAdd/Enter 핸들러)가 맡는다.
  function buildWeeklyInlineAddRow(date, plusBtn, mode) {
    var ul = document.querySelector('.week-card ul[data-date="' + date + '"]');
    if (!ul) return null;

    var li = document.createElement('li');
    li.className = 'week-inline-add';

    var modesWrap = document.createElement('span');
    modesWrap.className = 'week-inline-modes';
    modesWrap.setAttribute('role', 'group');
    modesWrap.setAttribute('aria-label', '입력 종류');
    var modeButtons = [];

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'week-inline-input';
    input.placeholder = MODE_PLACEHOLDER[mode];
    input.setAttribute('aria-label', formatAnnounceDate(date) + ' 항목 추가');

    WEEKLY_INLINE_MODES.forEach(function (cfg) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'week-inline-mode';
      btn.dataset.type = cfg.type;
      btn.setAttribute('aria-pressed', String(cfg.type === mode));
      btn.setAttribute('aria-label', cfg.label);
      var icon = document.createElement('span');
      icon.className = cfg.icon;
      btn.appendChild(icon);
      btn.addEventListener('click', function () {
        activeWeeklyInlineAdd.mode = cfg.type;
        modeButtons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.type === cfg.type)); });
        input.placeholder = MODE_PLACEHOLDER[cfg.type];
        input.focus();
      });
      modeButtons.push(btn);
      modesWrap.appendChild(btn);
    });

    input.addEventListener('keydown', onWeeklyInlineInputKeydown);

    li.appendChild(modesWrap);
    li.appendChild(input);
    ul.prepend(li); // 5: 입력 줄은 그 날짜 목록의 맨 위(첫 카드 자리)에 표시한다.
    // 6: 개별 ul은 더 이상 스크롤 컨테이너가 아니므로 건드리지 않는다 — Weekly 전체가
    // 공유하는 .weekly-body를 맨 위로 스크롤해 입력 줄이 바로 보이게 한다.
    var weeklyBody = ul.closest('.weekly-body');
    if (weeklyBody) weeklyBody.scrollTop = 0;

    activeWeeklyInlineAdd = { li: li, input: input, date: date, plusBtn: plusBtn, mode: mode };
    return activeWeeklyInlineAdd;
  }

  // 8: Enter = 항목 생성 후 같은 날짜·같은 모드로 입력줄을 재구성해 계속 입력할 수 있게
  // 한다(값만 비우고 포커스도 그대로 유지). 공백만 입력한 채 Enter를 누르면 아무 것도
  // 만들지 않고 입력줄도 그대로 둔다. 한글 조합 중 Enter(IME)는 무시한다.
  function onWeeklyInlineInputKeydown(e) {
    if (!activeWeeklyInlineAdd) return;
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      var text = activeWeeklyInlineAdd.input.value.trim();
      if (!text) return;
      var currentMode = activeWeeklyInlineAdd.mode;
      var currentPlusBtn = activeWeeklyInlineAdd.plusBtn;
      var currentDate = activeWeeklyInlineAdd.date;
      // 6: 열려 있던 날짜 초안(dateTimeDraft)이 있으면 그 범위를 쓰고, 없으면 이 열의 날짜로 단일
      // 생성한다. createItem()이 내부에서 renderApp()을 호출하므로, 그 전에 옵션을 먼저 만들고
      // 초안을 비워야 렌더링 결과에 범위 표시가 남지 않는다.
      var weeklyOpts = buildCreateOptsFromDraft(currentMode, text, currentDate);
      weeklyOpts.insertAtStart = true; // 5: Weekly "+"로 만든 항목은 해당 날짜 맨 위에 추가한다.
      clearDateTimeDraftAfterCreate();
      createItem(weeklyOpts); // renderApp()이 ul을 다시 그리며 이 입력줄을 지운다.
      buildWeeklyInlineAddRow(currentDate, currentPlusBtn, currentMode); // 같은 자리에 새 입력줄 재구성.
      var reopened = activeWeeklyInlineAdd;
      requestAnimationFrame(function () {
        if (activeWeeklyInlineAdd === reopened && reopened.input.isConnected) reopened.input.focus();
      });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeWeeklyInlineAdd();
    }
  }

  function openWeeklyInlineAdd(date, plusBtn) {
    if (activeWeeklyInlineAdd) {
      if (activeWeeklyInlineAdd.date === date) {
        activeWeeklyInlineAdd.input.focus();
        return;
      }
      if (activeWeeklyInlineAdd.input.value.trim().length > 0) {
        // 다른 열에 미입력 내용이 남아있으면 임의로 버리지 않고 기존 입력으로 되돌린다.
        activeWeeklyInlineAdd.input.focus();
        return;
      }
      closeWeeklyInlineAdd(false);
    }
    if (activeTypeMenu) closeTypeMenu(false);
    if (activeMoveMenu) closeMoveDateMenu(false);
    if (activeDateWheel) closeDateWheelPopup(false);
    if (activeTimeWheel) closeTimeWheelPopup(false);

    var built = buildWeeklyInlineAddRow(date, plusBtn, 'task');
    if (!built) return;
    built.input.focus();

    setTimeout(function () {
      document.addEventListener('pointerdown', onOutsideWeeklyInlineAddPointerDown, true);
    }, 0);
  }

  // ---------------------------------------------------------------------
  // 빠른 입력 (입력 종류 전환 + Enter 생성)
  // ---------------------------------------------------------------------
  function setInputMode(mode) {
    state.inputMode = mode;
    document.querySelectorAll('.q-slot').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
    });
    var input = document.getElementById('quick-input');
    if (input) {
      input.placeholder = MODE_PLACEHOLDER[mode] || MODE_PLACEHOLDER.task;
    }
  }

  function wireModeButtons() {
    document.querySelectorAll('.q-slot').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setInputMode(btn.dataset.mode);
        var input = document.getElementById('quick-input');
        if (input) input.focus();
      });
    });
  }

  // 6: 빠른 입력과 Weekly + 입력이 공유하는 생성 옵션 조립 로직. dateTimeDraft가 있으면
  // (달력 범위 드래그든 날짜 휠 편집이든) 그 시작·종료일을 쓰고, type은 호출한 쪽의 현재
  // 모드를 그대로 따른다(task/schedule/memo 전부 기간·시간을 가질 수 있음). draft가 없으면
  // fallbackDate(없으면 selectedDate)를 쓰는 기존 단일 날짜 규칙을 유지한다. allDay/시간은
  // 날짜 draft 유무와 무관하게 항상 현재 토글·시간 초안 값을 그대로 반영한다.
  function buildCreateOptsFromDraft(type, text, fallbackDate) {
    var draft = state.dateTimeDraft;
    var timeOpts = {
  allDay: state.allDayDraft,
  startTime: state.allDayDraft
    ? null
    : (state.timeDraft.startTime || '09:00'),
  endTime: state.allDayDraft
    ? null
    : (state.timeDraft.endTime || null)
};
    if (draft && draft.startDate) {
      return Object.assign({ type: type, text: text, date: draft.startDate, endDate: draft.endDate }, timeOpts);
    }
    var base = fallbackDate ? { type: type, text: text, date: fallbackDate } : { type: type, text: text };
    return Object.assign(base, timeOpts);
  }

  // 항목 생성 하나가 끝나면 일회성 날짜·시간 초안을 초기화한다(selectedDate와 allDayDraft
  // 토글 자체는 손대지 않음 — inputMode처럼 다음 생성에도 이어지는 지속 설정이다).
  function clearDateTimeDraftAfterCreate() {
  // 항목을 만든 뒤 날짜 범위만 초기화한다.
  // 사용자가 선택한 시작·종료 시간은 다음 입력에도 그대로 유지한다.
  state.selectedDateRange = null;
  state.dateTimeDraft = null;
}

  function wireQuickInput() {
    var input = document.getElementById('quick-input');
    if (!input) return;
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      // createItem()이 내부에서 renderApp()을 호출하므로, 그 전에 먼저 초안을 읽어 생성 옵션을
      // 만들고 나서 초안을 비워야 렌더링 결과에 범위 표시가 남지 않는다.
      var opts = buildCreateOptsFromDraft(state.inputMode, text);
      clearDateTimeDraftAfterCreate();
      createItem(opts);
      input.value = '';
    });
  }

  // ---------------------------------------------------------------------
  // 달력 — 단일 날짜 클릭(selectedDate 변경) / 날짜 범위 드래그(schedule 기간 준비).
  // 항목 드래그(dragState)와 이름 충돌·간섭이 없도록 완전히 별도의 calendarRangeDragState를
  // 사용한다. 월 경계 자동 이동을 지원해야 하므로(달력 DOM이 드래그 중 재생성될 수 있음)
  // 개별 셀에 pointer capture를 거는 대신 document 레벨 pointer 이벤트를 사용한다.
  // ---------------------------------------------------------------------
  var CALENDAR_DRAG_THRESHOLD = 5; // px
  var CALENDAR_MONTH_SHIFT_COOLDOWN = 300; // ms, 월 전환 재렌더링 직후 짧은 잠금(연속 전환 방지)
  var calendarRangeDragState = null;
  // { pending, active, pointerId, startX, startY, startDate, hoverDate, monthShiftCooldownUntil }

  function daysInMonthFromParts(year, month0) { // month0: 0~11
    return new Date(year, month0 + 1, 0).getDate();
  }

  function buildCalendarDateCell(dateObj, otherMonthClass) {
    var span = document.createElement('span');
    span.className = 'date';
    var dateStr = formatLocalDate(dateObj);
    if (otherMonthClass) {
      // 8: 인접 월 날짜는 흐린 회색 계열로만 표시 — 일·토 색상 규칙은 현재 월에만 적용해
      // 인접 월 주말이 강한 빨강/파랑으로 보이지 않게 한다.
      span.classList.add('other-month', otherMonthClass);
      span.setAttribute('aria-label', formatAnnounceDate(dateStr) + ', ' + (otherMonthClass === 'previous-month' ? '이전 달' : '다음 달'));
    } else {
      var dow = dateObj.getDay();
      if (dow === 0) span.classList.add('sun');
      else if (dow === 6) span.classList.add('sat');
    }
    span.textContent = String(dateObj.getDate());
    span.dataset.date = dateStr;
    return span;
  }

  // 달력 카드/행 크기(.calendar-card, .dates)는 그대로 두고, 매 렌더링마다 state.calendarViewDate가
  // 속한 달의 실제 레이아웃(요일 오프셋 + 일수)에 맞춰 셀만 다시 만든다.
  // 1: 항상 42칸(6행) 고정 — 5주만 필요한 달도 다음 달 날짜로 6번째 줄까지 채워, 달마다 전체
  // 달력 높이가 달라져 아래 "하루 종일" 영역과 겹치는 일이 없게 한다.
  function renderCalendarMonthGrid(viewDate) {
    var datesEl = document.querySelector('.dates');
    if (!datesEl) return;
    var year = viewDate.getFullYear();
    var month = viewDate.getMonth();
    var firstDow = new Date(year, month, 1).getDay();
    var total = daysInMonthFromParts(year, month);
    var totalCells = 42;
    var trailing = totalCells - firstDow - total;

    var frag = document.createDocumentFragment();
    var prevMonthLastDay = new Date(year, month, 0).getDate();
    for (var i = firstDow - 1; i >= 0; i--) {
      frag.appendChild(buildCalendarDateCell(new Date(year, month - 1, prevMonthLastDay - i), 'previous-month'));
    }
    for (var d = 1; d <= total; d++) {
      frag.appendChild(buildCalendarDateCell(new Date(year, month, d), null));
    }
    for (var n = 1; n <= trailing; n++) {
      frag.appendChild(buildCalendarDateCell(new Date(year, month + 1, n), 'next-month'));
    }
    datesEl.replaceChildren(frag);
  }

  function renderCalendarTitle() {
    var el = document.querySelector('.cal-title');
    if (!el) return;
    var d = parseLocalDate(state.calendarViewDate);
    el.textContent = d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월';
  }

  function formatDailyTitleDate(dateStr) {
    var d = parseLocalDate(dateStr);
    return d.getFullYear() + '년 ' + String(d.getMonth() + 1).padStart(2, '0') + '월 ' + String(d.getDate()).padStart(2, '0') + '일';
  }

  // 7: 범위 선택이 활성화된 동안(라이브 드래그 포함) 시작~종료 형식으로 보여준다.
  // 같은 달/다른 달/다른 연도에 따라 종료일 쪽 표기를 다르게 줄인다.
  function formatDailyRangeTitle(startDate, endDate) {
    var a = parseLocalDate(startDate);
    var b = parseLocalDate(endDate);
    var startFull = a.getFullYear() + '년 ' + String(a.getMonth() + 1).padStart(2, '0') + '월 ' + String(a.getDate()).padStart(2, '0') + '일';
    if (a.getFullYear() !== b.getFullYear()) {
      var endFull = b.getFullYear() + '년 ' + String(b.getMonth() + 1).padStart(2, '0') + '월 ' + String(b.getDate()).padStart(2, '0') + '일';
      return startFull + ' ~ ' + endFull;
    }
    if (a.getMonth() !== b.getMonth()) {
      return startFull + ' ~ ' + String(b.getMonth() + 1).padStart(2, '0') + '월 ' + String(b.getDate()).padStart(2, '0') + '일';
    }
    return startFull + ' ~ ' + String(b.getDate()).padStart(2, '0') + '일';
  }

  function renderDailyTitle() {
    var el = document.querySelector('.daily-title');
    if (!el) return;
    if (state.currentView === 'trash') {
      el.textContent = '휴지통';
      return;
    }
    var range = getDraftRange();
    el.textContent = range.startDate !== range.endDate
      ? formatDailyRangeTitle(range.startDate, range.endDate)
      : formatDailyTitleDate(state.selectedDate);
  }

  function renderCalendarSelection() {
    document.querySelectorAll('.dates .date').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.date === state.selectedDate);
    });
  }

  // 오늘 표시 — 정적 HTML/특정 숫자에 고정하지 않고 매 렌더링마다 실제 today를 기준으로
  // 다시 계산한다. 기존 클래스를 전부 지운 뒤 state.todayDate와 일치하는 칸에만 다시 건다.
  function renderCalendarToday() {
    document.querySelectorAll('.dates .date').forEach(function (el) {
      el.classList.toggle('today', el.dataset.date === state.todayDate);
    });
  }

  // 일정(schedule) 존재 여부로 날짜별 점을 계산한다. task/memo는 대상이 아니고, 완료 여부도
  // 점의 존재 조건과 무관하다(getOccurrenceDates는 다일 일정 완료 로직에서 쓰던 헬퍼 재사용).
  function getScheduleDotDates() {
    var set = {};
    state.items.forEach(function (it) {
      if (it.type !== 'schedule' || it.deletedAt) return;
      getOccurrenceDates(it).forEach(function (d) { set[d] = true; });
    });
    return set;
  }

  function renderCalendarDots() {
    var dotDates = getScheduleDotDates();
    document.querySelectorAll('.dates .date[data-date]').forEach(function (el) {
      el.classList.toggle('has-dot', !!dotDates[el.dataset.date]);
    });
  }

  function clearCalendarRangePreview() {
    document.querySelectorAll('.dates .date.range-preview').forEach(function (el) {
      el.classList.remove('range-preview');
    });
  }

  function showCalendarRangePreview(fromDate, toDate) {
    clearCalendarRangePreview();
    var start = fromDate <= toDate ? fromDate : toDate;
    var end = fromDate <= toDate ? toDate : fromDate;
    document.querySelectorAll('.dates .date[data-date]').forEach(function (el) {
      var d = el.dataset.date;
      if (d >= start && d <= end) el.classList.add('range-preview');
    });
  }

  // 2: pointerup 후에도 유지되는 "확정된" 범위 표시(라이브 드래그용 range-preview와는
  // 별개 클래스). renderApp()의 일부로도 호출되어 다른 재렌더링을 거쳐도 유지된다.
  function clearConfirmedRangeClasses() {
    document.querySelectorAll('.dates .date').forEach(function (el) {
      el.classList.remove('range-selected-start', 'range-selected-middle', 'range-selected-end', 'range-selected-single');
    });
  }

  function applyConfirmedRangeClasses(start, end) {
    clearConfirmedRangeClasses();
    if (start === end) {
      var singleEl = document.querySelector('.dates .date[data-date="' + start + '"]');
      if (singleEl) singleEl.classList.add('range-selected-single');
      return;
    }
    document.querySelectorAll('.dates .date[data-date]').forEach(function (el) {
      var d = el.dataset.date;
      if (d < start || d > end) return;
      if (d === start) el.classList.add('range-selected-start');
      else if (d === end) el.classList.add('range-selected-end');
      else el.classList.add('range-selected-middle');
    });
  }

  function renderCalendarRangeSelection() {
    if (state.selectedDateRange) {
      applyConfirmedRangeClasses(state.selectedDateRange.startDate, state.selectedDateRange.endDate);
    } else {
      clearConfirmedRangeClasses();
    }
  }

  // 1: pointermove/날짜 셀 진입마다 호출 — 전체 renderApp() 대신 범위 미리보기 셀과 날짜
  // 필드, 상단 제목만 부분 갱신한다(깜빡임 방지).
  function updateCalendarRangeLive(start, end) {
    state.dateTimeDraft = { startDate: start, endDate: end };
    showCalendarRangePreview(start, end);
    renderDateFields();
    renderDailyTitle();
  }

  function teardownCalendarDragListeners() {
    document.removeEventListener('pointermove', onCalendarDatePointerMove);
    document.removeEventListener('pointerup', onCalendarDatePointerUp);
    document.removeEventListener('pointercancel', onCalendarDatePointerCancel);
  }

  function cancelCalendarRangeDrag() {
    if (!calendarRangeDragState) return;
    var ds = calendarRangeDragState;
    if (ds.edgeTimer) clearTimeout(ds.edgeTimer);
    teardownCalendarDragListeners();
    calendarRangeDragState = null;
    clearCalendarRangePreview();
  }

  // 3: 확정된 범위를 명시적으로 취소하고 selectedDate 기준 단일 날짜로 되돌린다(Escape 전용).
  function clearConfirmedDateRange() {
    state.selectedDateRange = null;
    state.dateTimeDraft = null;
    savePreferences();
    renderApp();
  }

  function onCalendarDatePointerDown(e) {
    // 12: 항목 드래그(dragState)가 아직 정리되지 않은 채로(드롭 정착 애니메이션 중 등) 새
    // 포인터가 눌리는 극히 짧은 틈에도 달력 범위 드래그가 함께 시작되지 않게 막는다.
    if (dragState) return;
    var cell = e.target.closest('.date[data-date]');
    if (!cell) return; // .cal-nav(‹ 오늘 ›)는 .dates 바깥이라 애초에 여기로 안 들어온다.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); // 4: 항목 선택 이벤트 위임이 달력 이벤트를 받지 않게 분리.
    e.preventDefault(); // 날짜 숫자가 파란 텍스트로 선택되는 것 방지(user-select:none 보조) — 이 목적에서만 사용.

    // 4: 달력 날짜 조작을 시작하면(단일 클릭이든 드래그든) 기존 항목 선택은 항상 먼저 해제한다.
    clearItemSelection();

    calendarRangeDragState = {
      pending: true,
      active: false,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startDate: cell.dataset.date,
      hoverDate: cell.dataset.date,
      monthShiftCooldownUntil: 0
    };
    document.addEventListener('pointermove', onCalendarDatePointerMove);
    document.addEventListener('pointerup', onCalendarDatePointerUp);
    document.addEventListener('pointercancel', onCalendarDatePointerCancel);
  }

  function calendarMonthStartFor(dateStr) {
    var d = parseLocalDate(dateStr);
    return formatLocalDate(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  // 11/12: 가장자리 체류가 아니라, 드래그 포인터가 "실제로 화면에 표시된 인접 월 날짜 셀"에
  // 진입했을 때만 그 달로 전환한다. 전환 직후에는 같은 셀이 더 이상 other-month가 아니게 되므로
  // (현재 달 셀이 되므로) 재진입 판정 자체가 자연스럽게 막히고, 추가로 짧은 쿨다운을 둬 재렌더링
  // 직후 같은 포인터 위치로 인한 연쇄 전환도 막는다.
  function maybeShiftMonthForCell(ds, cell) {
    if (!cell.classList.contains('other-month')) return;
    if (Date.now() < ds.monthShiftCooldownUntil) return;

    var targetMonthStart = calendarMonthStartFor(cell.dataset.date);
    if (targetMonthStart === state.calendarViewDate) return;

    state.calendarViewDate = targetMonthStart;
    savePreferences();

    renderCalendarMonthGrid(parseLocalDate(targetMonthStart));
    renderCalendarTitle();
    renderCalendarToday();
    renderCalendarDots();
    renderCalendarSelection();
    renderCalendarRangeSelection();

    ds.monthShiftCooldownUntil = Date.now() + CALENDAR_MONTH_SHIFT_COOLDOWN;
  }

  function onCalendarDatePointerMove(e) {
    if (!calendarRangeDragState || e.pointerId !== calendarRangeDragState.pointerId) return;
    var ds = calendarRangeDragState;
    if (ds.pending) {
      var dx = e.clientX - ds.startX;
      var dy = e.clientY - ds.startY;
      if (Math.hypot(dx, dy) < CALENDAR_DRAG_THRESHOLD) return;
      ds.pending = false;
      ds.active = true;
      // 3: 새로운 범위 드래그가 실제로 시작되면 이전에 확정돼 있던 범위 표시는 소비된 것으로 본다.
      if (state.selectedDateRange) {
        state.selectedDateRange = null;
        clearConfirmedRangeClasses();
      }
      updateCalendarRangeLive(ds.startDate, ds.startDate);
    }

    var el = document.elementFromPoint(e.clientX, e.clientY);
    var cell = el ? el.closest('.date[data-date]') : null;
    if (cell) {
      ds.hoverDate = cell.dataset.date;
      maybeShiftMonthForCell(ds, cell); // 12: 실제 인접 월 셀 진입 시에만 이 시점에서 전환.
    }

    var start = ds.startDate <= ds.hoverDate ? ds.startDate : ds.hoverDate;
    var end = ds.startDate <= ds.hoverDate ? ds.hoverDate : ds.startDate;
    updateCalendarRangeLive(start, end);
  }

  function onCalendarDatePointerUp(e) {
    if (!calendarRangeDragState || e.pointerId !== calendarRangeDragState.pointerId) return;
    var ds = calendarRangeDragState;
    teardownCalendarDragListeners();
    calendarRangeDragState = null;

    if (!ds.active) {
      // 단일 클릭 — selectedDate만 옮기고, 이전에 확정된 범위가 있었다면 함께 해제한다.
      clearCalendarRangePreview();
      state.selectedDate = ds.startDate;
      state.selectedDateRange = null;
      state.dateTimeDraft = null;
      state.endDateDraftActive = false;
      // 10: 인접 월 날짜를 클릭했으면 달력 자체도 그 달로 이동한다.
      var clickedMonthStart = calendarMonthStartFor(ds.startDate);
      var monthChanged = clickedMonthStart !== state.calendarViewDate;
      if (monthChanged) {
        state.calendarViewDate = clickedMonthStart;
      }
      savePreferences();
      if (monthChanged) {
        renderCalendarMonthGrid(parseLocalDate(clickedMonthStart));
        renderCalendarTitle();
      }
      renderApp();
      return;
    }

    // 범위 드래그 확정 — 역방향이면 이른 날짜→늦은 날짜로 정규화(라이브 갱신 중 이미 정규화된
    // dateTimeDraft를 그대로 confirmed 상태로 승격한다). 월 경계를 넘나든 경우도 startDate/
    // hoverDate에는 실제 날짜 문자열이 그대로 들어있으므로 별도 처리 없이 정확히 확정된다.
    var start = ds.startDate <= ds.hoverDate ? ds.startDate : ds.hoverDate;
    var end = ds.startDate <= ds.hoverDate ? ds.hoverDate : ds.startDate;
    state.selectedDate = start;
    state.selectedDateRange = { startDate: start, endDate: end };
    state.dateTimeDraft = { startDate: start, endDate: end };
    savePreferences();
    setInputMode('schedule');
    clearCalendarRangePreview();
    renderApp(); // renderCalendarRangeSelection()이 range-selected-* 클래스를 확정 표시로 남긴다.
    var input = document.getElementById('quick-input');
    if (input) input.focus();
  }

  function onCalendarDatePointerCancel(e) {
    if (!calendarRangeDragState || e.pointerId !== calendarRangeDragState.pointerId) return;
    teardownCalendarDragListeners();
    calendarRangeDragState = null;
    clearCalendarRangePreview();
  }

  // 14: ‹ 이전 달 / ○ 오늘 / › 다음 달 — 범위 드래그 중이면 먼저 안전하게 취소한 뒤 이동한다
  // (드래그 중인 범위와 버튼 클릭이 동시에 서로 다른 달을 가리키는 모순 상태를 피하기 위함).
  function navigateCalendarMonth(delta) {
    if (calendarRangeDragState) cancelCalendarRangeDrag();
    var current = parseLocalDate(state.calendarViewDate);
    var next = new Date(current.getFullYear(), current.getMonth() + delta, 1);
    state.calendarViewDate = formatLocalDate(next);
    savePreferences();
    renderCalendarMonthGrid(next);
    renderCalendarTitle();
    renderApp();
  }

  function navigateCalendarToToday() {
    if (calendarRangeDragState) cancelCalendarRangeDrag();
    var today = parseLocalDate(state.todayDate);
    var monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    state.calendarViewDate = formatLocalDate(monthStart);
    savePreferences();
    renderCalendarMonthGrid(monthStart);
    renderCalendarTitle();
    renderApp();
  }

  function wireCalendarNav() {
    var prevBtn = document.querySelector('.cal-nav-prev');
    var nextBtn = document.querySelector('.cal-nav-next');
    var todayBtn = document.querySelector('.cal-nav-today');
    if (prevBtn) prevBtn.addEventListener('click', function () { navigateCalendarMonth(-1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { navigateCalendarMonth(1); });
    if (todayBtn) todayBtn.addEventListener('click', navigateCalendarToToday);
  }

  function wireCalendarDates() {
    var datesEl = document.querySelector('.dates');
    if (datesEl) datesEl.addEventListener('pointerdown', onCalendarDatePointerDown);
  }

  // ---------------------------------------------------------------------
  // 달력 아래 시작일·종료일 필드 + "하루 종일" 토글 + 날짜 휠 팝업.
  // dateTimeDraft가 있으면 그 값을, 없으면 selectedDate(단일 날짜)를 필드에 표시한다.
  // ---------------------------------------------------------------------
  function getDraftRange() {
    if (state.dateTimeDraft && state.dateTimeDraft.startDate) return state.dateTimeDraft;
    return { startDate: state.selectedDate, endDate: state.selectedDate };
  }

  function formatRangeBoxDate(dateStr) {
    var d = parseLocalDate(dateStr);
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEKDAY_KO[d.getDay()] + ')';
  }

  function setMainDateFieldDisplay(
  fieldEl,
  dateStr,
  isPlaceholder
) {
  if (!fieldEl) return;

  var displayText =
    isPlaceholder
      ? ''
      : formatRangeBoxDate(dateStr);

  /*
   * 앞으로 날짜칸을 input으로 바꿔도 작동하고,
   * 아직 button인 현재 상태에서도 작동한다.
   */
  if (fieldEl.tagName === 'INPUT') {
    fieldEl.value = displayText;

    fieldEl.placeholder =
      isPlaceholder
        ? '연도-월-일'
        : '';
  } else {
    fieldEl.textContent =
      isPlaceholder
        ? '연도-월-일'
        : displayText;
  }

  fieldEl.classList.toggle(
    'date-placeholder',
    isPlaceholder
  );
}

function renderDateFields() {
  var range = getDraftRange();

  var startBox = document.querySelector(
    '.date-row .range-box[data-field="start"]'
  );

  var endBox = document.querySelector(
    '.date-row .range-box[data-field="end"]'
  );
var clearEndDateBtn = document.querySelector(
  '.date-row .date-clear-btn'
);
  var hasEndDate =
    state.endDateDraftActive ||
    range.endDate !== range.startDate;

  /*
 * 키보드 편집 중인 입력칸은 건드리지 않는다.
 * 그래야 YYYY-MM-DD가 확정 전까지 그대로 유지된다.
 */
if (startBox && activeDateWheel && activeDateWheel.anchorEl === startBox) {
  // 이 입력칸을 향해 날짜 휠이 열려 있는 동안은 편집용 원본 형식(YYYY-MM-DD)을 그대로
  // 유지한 채 매 조작마다 값만 갱신한다 — setMainDateFieldDisplay는 보기 좋은 표시
  // 형식(예: "7월 30일 (목)")으로 바꿔버려 편집 형식을 깨뜨리므로 여기선 쓰지 않는다.
  startBox.value = range.startDate;
} else if (
  !startBox ||
  !startBox.classList.contains(
    'is-date-editing'
  )
) {
  setMainDateFieldDisplay(
    startBox,
    range.startDate,
    false
  );
}

if (endBox && activeDateWheel && activeDateWheel.anchorEl === endBox) {
  endBox.value = range.endDate || range.startDate;
} else if (
  !endBox ||
  !endBox.classList.contains(
    'is-date-editing'
  )
) {
  setMainDateFieldDisplay(
    endBox,
    range.endDate ||
      range.startDate,
    !hasEndDate
  );
}

  if (startBox) {
    startBox.setAttribute(
      'aria-label',
      '시작 날짜 입력 또는 선택'
    );
  }

  if (endBox) {
    endBox.setAttribute(
      'aria-label',
      hasEndDate
        ? '종료 날짜 입력 또는 변경'
        : '종료 날짜 설정'
    );
  }
  if (clearEndDateBtn) {
  clearEndDateBtn.hidden =
    !hasEndDate;
}
}

  function renderAllDayToggle() {
    var toggle = document.querySelector('.all-day-toggle');
    if (toggle) {
      toggle.classList.toggle('on', state.allDayDraft);
      toggle.setAttribute('aria-checked', String(state.allDayDraft));
    }
    // 1/7: 켜짐이면 시간 필드는 비활성 스타일로 흐리게(값은 그대로 보임, 클릭해도 팝업 안 열림),
    // 꺼지면 활성으로 보인다.
    document.querySelectorAll('.time-row .range-box').forEach(function (el) {
      el.classList.toggle('disabled', state.allDayDraft);
      el.setAttribute('aria-disabled', String(state.allDayDraft));
    });
  }

  function wireAllDayToggle() {
    var row = document.querySelector('.all-day-row');
    if (!row) return;
    // 6: 트랙뿐 아니라 "하루 종일" 라벨까지 포함한 행 전체를 하나의 클릭 영역으로 묶는다.
    // 핸들러를 행 하나에만 달아둔다 — 스위치 버튼 클릭도 이 행으로 버블링되므로 여기서 한 번만
    // 처리하면 이중 토글(두 번 잡혀 원상태로 되돌아가는 버그) 걱정이 없다.
    function toggleAllDay() {
  state.allDayDraft = !state.allDayDraft;

  if (state.allDayDraft) {
    /*
     * 하루 종일을 켜면 시간 범위를 해제한다.
     * 다음에 다시 끌 때 시작시간 하나만 나타나게 한다.
     */
    state.timeDraft = {
      startTime: null,
      endTime: null
    };
  } else {
    /*
     * 하루 종일을 끄면 시작시간만 기본으로 활성화한다.
     * 종료시간은 클릭 가능한 비활성 00:00 상태로 둔다.
     */
    state.timeDraft = {
      startTime: '09:00',
      endTime: null
    };
  }

  renderApp();
}
    row.addEventListener('click', toggleAllDay);
  }

  // 4/7: 이월 토글 버튼 + Daily 상단 [삭제] 버튼.
  function wireRolloverControls() {
    var toggle = document.querySelector('.rollover-toggle');
    if (toggle) toggle.addEventListener('click', toggleRolloverExpanded);
    var deleteBtn = document.querySelector('.rollover .delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        if (!state.selectedItemIds.size) return;
        softDeleteItems(Array.from(state.selectedItemIds));
      });
    }
  }

  // --- 시간 필드 표시/검증 ----------------------------------------------------
  function formatTimeFieldDisplay(hhmm) {
    if (!hhmm) return '';
    var parts = hhmm.split(':').map(Number);
    var h = parts[0];
    var m = parts[1];
    var period = h < 12 ? 'AM' : 'PM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return period + '  ' + String(h12).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function parseTime12(hhmm) {
    var parts = hhmm.split(':').map(Number);
    var h = parts[0];
    var m = parts[1];
    var period = h < 12 ? 'AM' : 'PM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return { period: period, hour: h12, minute: m };
  }

  function to24Hour(period, hour12, minute) {
    var h = hour12 % 12;
    if (period === 'PM') h += 12;
    return String(h).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }

  function addMinutesToTimeClamped(timeStr, minutes) {
    var parts = timeStr.split(':').map(Number);
    var total = parts[0] * 60 + parts[1] + minutes;
    if (total > 23 * 60 + 59) total = 23 * 60 + 59; // 자정을 넘겨 다음 날로 넘어가지 않게 상한.
    var h = Math.floor(total / 60);
    var m = total % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  // 2: 분은 00/05/10.../55 열두 값만 쓴다. 24시간제 (hour, minute)를 가장 가까운 5분 단위로
  // 반올림해 { hour: 0~23, minute: 0,5,...,55 } 형태로 돌려준다 — 이건 "전체 시간(HHmm) 숫자
  // 입력" 결과를 보정할 때만 쓴다(예: 09:58 → 10:00처럼 시가 자동으로 넘어가는 것이 맞는 경우).
  // 분 휠 스크롤/화살표 자체는 시로 캐스케이딩하지 않으므로 이 함수를 쓰지 않는다.
  function roundToNearest5(hour24, minute) {
    var total = hour24 * 60 + minute;
    var rounded = Math.round(total / 5) * 5;
    rounded = ((rounded % 1440) + 1440) % 1440;
    return { hour: Math.floor(rounded / 60), minute: rounded % 60 };
  }

  function timeToMinutesOfDay(period, hour12, minute) {
    var h = hour12 % 12;
    if (period === 'PM') h += 12;
    return h * 60 + minute;
  }

  function minutesOfDayToTime12(totalMin) {
    totalMin = ((totalMin % 1440) + 1440) % 1440;
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    var period = h < 12 ? 'AM' : 'PM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return { period: period, hour: h12, minute: m };
  }

  function setMainTimeFieldDisplay(
  fieldEl,
  displayText
) {
  if (!fieldEl) return;

  if (fieldEl.tagName === 'INPUT') {
    fieldEl.value = displayText;
  } else {
    fieldEl.textContent = displayText;
  }
}

function renderTimeFields() {
  var startBox = document.querySelector(
    '.time-row .range-box[data-field="start"]'
  );

  var endBox = document.querySelector(
    '.time-row .range-box[data-field="end"]'
  );

  var clearEndBtn = document.querySelector(
    '.time-row .time-clear-btn'
  );

  var start =
    state.timeDraft.startTime ||
    '09:00';

  var hasEndTime =
    !!state.timeDraft.endTime;

  /*
   * 키보드 편집 중에는 입력값을
   * renderApp이 다시 덮어쓰지 않는다.
   */
  if (
  startBox &&
  (
    !startBox.classList.contains(
      'is-time-editing'
    ) ||
    (
      activeTimeWheel &&
      activeTimeWheel.anchorEl === startBox
    )
  )
) {
    setMainTimeFieldDisplay(
      startBox,
      formatTimeFieldDisplay(start)
    );
  }

  if (startBox) {
    startBox.classList.toggle(
      'disabled',
      state.allDayDraft
    );

    startBox.setAttribute(
      'aria-disabled',
      String(state.allDayDraft)
    );
  }

  if (
  endBox &&
  (
    !endBox.classList.contains(
      'is-time-editing'
    ) ||
    (
      activeTimeWheel &&
      activeTimeWheel.anchorEl === endBox
    )
  )
) {
    setMainTimeFieldDisplay(
      endBox,
      hasEndTime
        ? formatTimeFieldDisplay(
            state.timeDraft.endTime
          )
        : '00:00'
    );
  }

  if (endBox) {
    endBox.classList.toggle(
      'disabled',
      state.allDayDraft ||
        !hasEndTime
    );

    endBox.setAttribute(
      'aria-disabled',
      String(state.allDayDraft)
    );

    endBox.classList.toggle(
      'time-placeholder',
      !state.allDayDraft &&
        !hasEndTime
    );

    endBox.setAttribute(
      'aria-label',
      hasEndTime
        ? '종료 시간 변경'
        : '종료 시간 설정'
    );
  }

  if (clearEndBtn) {
    clearEndBtn.hidden =
      state.allDayDraft ||
      !hasEndTime;
  }
}

  // 5: 시작·종료일이 같은 날일 때만 시간 순서를 강제한다(날짜가 다르면 자정을 넘는 일정이라
  // 종료 시각이 시작 시각보다 이를 수 있음 — 예: 22:00 → 다음 날 08:00).
function applyTimeFieldChange(field, newTime) {
  var range = getDraftRange();
  var sameDay = range.startDate === range.endDate;

  var start = state.timeDraft.startTime || '09:00';
  var end = state.timeDraft.endTime || null;

  if (field === 'start') {
    start = newTime;

    /*
     * 종료시간이 실제로 설정된 경우에만 순서를 보정한다.
     * 종료시간이 null이면 한 시각 상태를 그대로 유지한다.
     */
    if (end && sameDay && start > end) {
      end = addMinutesToTimeClamped(start, 5);
    }
  } else {
    end = newTime;

    if (sameDay && end < start) {
      end = start;
    }
  }

  state.timeDraft = {
    startTime: start,
    endTime: end
  };

  // 위 클램프/자동보정으로 실제 저장값이 방금 조작한 휠의 원시 위치와 달라졌을 수 있다
  // (예: 종료를 시작보다 앞선 값으로 돌리면 저장값은 시작으로 고정되지만 휠 자체는 계속
  // 움직인 위치에 남는다). 열린 휠이 있으면 그 컬럼들을 최종 저장값으로 즉시 맞춘다.
  syncActiveTimeWheelToCommittedTime();

  renderApp();
}

 function applyDateFieldChange(field, newDate) {
  var range = getDraftRange();

  var start = range.startDate;
  var end = range.endDate;

  if (field === 'start') {
    /*
     * 시작 날짜를 Enter로 확정하면
     * 우선 단일 날짜로 만든다.
     */
    start = newDate;
    end = newDate;

    state.endDateDraftActive = false;
  } else {
    /*
     * 종료 날짜를 직접 입력하거나 선택했을 때만
     * 날짜 범위를 활성화한다.
     */
    end = newDate;

    if (end < start) {
      end = start;
    }

    state.endDateDraftActive = true;
  }

  state.dateTimeDraft = {
    startDate: start,
    endDate: end
  };

  state.selectedDateRange =
    state.endDateDraftActive
      ? {
          startDate: start,
          endDate: end
        }
      : null;

  state.selectedDate = start;

  // 종료<시작 클램프(위 end = start)로 실제 저장값이 열려 있는 날짜 휠의 원시 위치와
  // 달라졌을 수 있다. 열린 휠이 있으면 그 컬럼들을 최종 저장값으로 즉시 맞춘다.
  syncActiveDateWheelToCommittedDate();

  savePreferences();
  renderApp();
}

  // --- 날짜 휠 팝업 ----------------------------------------------------------
  var DATE_WHEEL_ITEM_HEIGHT = 32;
  var DATE_WHEEL_VISIBLE = 5;
  var DATE_WHEEL_PAD = Math.floor(DATE_WHEEL_VISIBLE / 2);
  var DATE_WHEEL_YEAR_SPAN_BACK = 3;
  var DATE_WHEEL_YEAR_SPAN_FWD = 7;

  var activeDateWheel = null; // { field, anchorEl, el, year, month, day }

  function daysInMonth(year, month) { // month: 1~12
    return new Date(year, month, 0).getDate(); // 2: 윤년/월별 일수는 Date 자체 계산에 맡긴다.
  }

  function buildDateWheelItem(value, label) {
    var item = document.createElement('div');
    item.className = 'date-wheel-item';
    item.dataset.value = String(value);
    item.setAttribute('role', 'option');
    item.textContent = label;
    return item;
  }

  function updateWheelColumnVisual(col, centerIdx) {
    var items = col.querySelectorAll('.date-wheel-item');
    items.forEach(function (it, i) { it.classList.toggle('center', i === centerIdx); });
  }

  // 시간 입력칸에서 선택된 세그먼트(오전오후/시/분)를 ArrowLeft/ArrowRight로 좌우
  // 이동한다(값은 바꾸지 않는다). 상단 메인 시간 입력("AM  09:00")과 상세 패널 시간
  // 입력("am 09:15")은 표시 형식(공백 수·대소문자)이 달라 세그먼트 문자 위치가 서로
  // 다르므로, segments(그 입력의 실제 문자열 구조에 맞는 경계 배열)를 인자로 받아
  // 하나의 함수로 공유한다. wheelOpenForInput은 호출부가 각자의 활성 휠 변수
  // (activeTimeWheel/activeDetailItemTimeWheel)로 판단해 넘긴다.
  function handleTimeInputHorizontalArrowKey(e, input, segments, wheelOpenForInput) {
    if (
      (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') ||
      !wheelOpenForInput ||
      // 아직 한 번도 커밋되지 않은 빈 종료 시간은 "00:00"처럼 오전오후 접두사가 없는
      // placeholder 상태라 세그먼트 문자 위치 자체가 의미 없다 -- 기존 ArrowUp/Down의
      // hasPeriod 가드(위/아래)와 같은 전제를 그대로 따른다.
      !/^(am|pm)\b/i.test(input.value)
    ) {
      return false;
    }

    var selectionStart =
      typeof input.selectionStart === 'number' ? input.selectionStart : -1;
    var selectionEnd =
      typeof input.selectionEnd === 'number' ? input.selectionEnd : -1;

    var currentIndex = segments.findIndex(function (seg) {
      return selectionStart >= seg.start && selectionEnd <= seg.end;
    });
    if (currentIndex === -1) return false;

    e.preventDefault();
    e.stopPropagation();

    var nextIndex = currentIndex + (e.key === 'ArrowRight' ? 1 : -1);
    nextIndex = Math.max(0, Math.min(segments.length - 1, nextIndex));

    var seg = segments[nextIndex];
    input.focus();
    input.setSelectionRange(seg.start, seg.end);
    return true;
  }

  // 문자열 비교로 통일해 숫자 값(연/월/일/시/분)과 문자열 값(오전/오후)을 모두 다룬다.
  function scrollColumnToValue(col, value, smooth) {
    var items = Array.prototype.slice.call(col.querySelectorAll('.date-wheel-item'));
    var idx = items.findIndex(function (it) { return it.dataset.value === String(value); });
    if (idx === -1) idx = 0;
    col._twOpToken = (col._twOpToken || 0) + 1; // 진행 중이던 stale settle 타이머를 무효화한다(시간 휠 전용, 다른 휠엔 영향 없음).
    col.scrollTo({ top: idx * DATE_WHEEL_ITEM_HEIGHT, behavior: smooth ? 'smooth' : 'auto' });
    updateWheelColumnVisual(col, idx);
  }

  var WHEEL_UNIT_LABELS = { year: '연도', month: '월', day: '일', period: '오전 오후', hour: '시', minute: '분' };

  function buildWheelColumn(unit, values, labelFn) {
    var col = document.createElement('div');
    col.className = 'date-wheel-col';
    col.dataset.unit = unit;
    col.tabIndex = 0;
    col.setAttribute('role', 'listbox');
    col.setAttribute('aria-label', WHEEL_UNIT_LABELS[unit] || unit);
    // scroll-padding-top만 있고 -bottom이 없으면 스냅 뷰포트가 위아래 비대칭이 돼, 마지막
    // 항목(예: 시 12, 분 55)으로 스크롤할 때 마지막 한 칸만큼 스냅이 아래로 밀려 어긋난다
    // (경계에서만 드러나는 문제 — 양쪽을 대칭으로 맞춰 모든 인덱스에서 정확히 맞게 한다).
    col.style.scrollPaddingTop = (DATE_WHEEL_PAD * DATE_WHEEL_ITEM_HEIGHT) + 'px';
    col.style.scrollPaddingBottom = (DATE_WHEEL_PAD * DATE_WHEEL_ITEM_HEIGHT) + 'px';
    col.style.paddingTop = (DATE_WHEEL_PAD * DATE_WHEEL_ITEM_HEIGHT) + 'px';
    col.style.paddingBottom = (DATE_WHEEL_PAD * DATE_WHEEL_ITEM_HEIGHT) + 'px';
    col.style.boxSizing = 'border-box';
    values.forEach(function (v) { col.appendChild(buildDateWheelItem(v, labelFn(v))); });
    return col;
  }

  function regenerateDayColumn() {
    var dayCol = activeDateWheel.el.querySelector('.date-wheel-col[data-unit="day"]');
    var dim = daysInMonth(activeDateWheel.year, activeDateWheel.month);
    if (activeDateWheel.day > dim) activeDateWheel.day = dim; // 2: 2월 30일 같은 값 자동 보정.
    dayCol.querySelectorAll('.date-wheel-item').forEach(function (el) { el.remove(); });
    for (var d = 1; d <= dim; d++) dayCol.appendChild(buildDateWheelItem(d, d + '일'));
    scrollColumnToValue(dayCol, activeDateWheel.day, false);
  }

  // 연/월/일 세 컬럼을 현재 activeDateWheel 상태로 즉시(auto, non-smooth) 재정렬한다 —
  // regenerateDayColumn이 월/연도 변경에 따른 일 수 변화(및 존재하지 않는 일 보정)까지
  // 함께 처리하므로 그대로 재사용한다.
  function syncDateWheelColumnsToState() {
    if (!activeDateWheel) return;
    var yearCol = activeDateWheel.el.querySelector('.date-wheel-col[data-unit="year"]');
    var monthCol = activeDateWheel.el.querySelector('.date-wheel-col[data-unit="month"]');
    if (yearCol) scrollColumnToValue(yearCol, activeDateWheel.year, false);
    if (monthCol) scrollColumnToValue(monthCol, activeDateWheel.month, false);
    regenerateDayColumn();
  }

  // applyDateFieldChange의 종료<시작 클램프로 실제 저장값이 열려 있는 날짜 휠의 원시
  // 위치와 달라졌을 때, 그 휠(activeDateWheel이 가리키는 필드)을 최종 저장값으로 되돌린다.
  function syncActiveDateWheelToCommittedDate() {
    if (!activeDateWheel) return;
    var committedDateStr;
    if (activeDateWheel.target) {
      // 상세 패널 날짜 이동 메뉴처럼 상단 .schedule-panel의 dateTimeDraft가 아닌 다른
      // 대상(예: 특정 항목)에 커밋하는 휠은 target.getCurrentDate로 실제 저장값을 읽는다.
      committedDateStr = activeDateWheel.target.getCurrentDate();
    } else {
      var range = getDraftRange();
      committedDateStr = activeDateWheel.field === 'start' ? range.startDate : range.endDate;
    }
    if (!committedDateStr) return;
    var d = parseLocalDate(committedDateStr);
    var year = d.getFullYear();
    var month = d.getMonth() + 1;
    var day = d.getDate();
    if (
      activeDateWheel.year === year &&
      activeDateWheel.month === month &&
      activeDateWheel.day === day
    ) {
      return;
    }
    activeDateWheel.year = year;
    activeDateWheel.month = month;
    activeDateWheel.day = day;
    syncDateWheelColumnsToState();
  }

  function commitDateWheelSelection() {
    if (!activeDateWheel) return;
    var newDate = formatLocalDate(new Date(activeDateWheel.year, activeDateWheel.month - 1, activeDateWheel.day));
    if (activeDateWheel.target) {
      activeDateWheel.target.applyDate(newDate);
    } else {
      applyDateFieldChange(activeDateWheel.field, newDate);
    }
    // renderApp()이 팝업 바깥의 필드 텍스트만 갱신하고, 열려 있는 팝업 자체는 그대로 둔다
    // (연속으로 연/월/일을 조정할 수 있어야 하므로 값 하나 바뀔 때마다 닫지 않는다).
  }

  function settleWheelColumn(col, unit) {
    if (!activeDateWheel) return;
    var items = Array.prototype.slice.call(col.querySelectorAll('.date-wheel-item'));
    var idx = Math.round(col.scrollTop / DATE_WHEEL_ITEM_HEIGHT);
    idx = Math.max(0, Math.min(items.length - 1, idx));
    col.scrollTo({ top: idx * DATE_WHEEL_ITEM_HEIGHT, behavior: 'auto' });
    updateWheelColumnVisual(col, idx);
    activeDateWheel[unit] = Number(items[idx].dataset.value);
    if (unit === 'year' || unit === 'month') regenerateDayColumn();
    commitDateWheelSelection();
  }

  function clearWheelSettleTimer(unit) {
    if (activeDateWheel && activeDateWheel.settleTimers[unit]) {
      clearTimeout(activeDateWheel.settleTimers[unit]);
      activeDateWheel.settleTimers[unit] = null;
    }
  }

  var WHEEL_DELTA_THRESHOLD = 70; // px, 50~100 범위 — 이 이상 누적돼야 한 칸 이동
  var WHEEL_STEP_COOLDOWN = 110; // ms, 80~140 범위 — 트랙패드 관성으로 여러 칸이 튀는 것 억제
  var WHEEL_NUMBER_BUFFER_TIMEOUT = 850; // ms, 700~1000 범위

  function wireWheelColumn(col, unit) {
    col.addEventListener('scroll', function () {
      var idx = Math.round(col.scrollTop / DATE_WHEEL_ITEM_HEIGHT);
      updateWheelColumnVisual(col, idx);
      clearWheelSettleTimer(unit);
      // 130ms 동안 추가 스크롤이 없으면 "멈췄다"고 보고 정렬·확정한다(터치 드래그 패닝 등
      // 실제 자유 스크롤 전용 — 휠/클릭/키보드는 목표 인덱스를 이미 알고 있어 아래에서 즉시 확정한다).
      if (activeDateWheel) {
        activeDateWheel.settleTimers[unit] = setTimeout(function () { settleWheelColumn(col, unit); }, 130);
      }
    });

    // 7: 마우스 휠/트랙패드는 네이티브 스크롤에 맡기지 않고 delta를 직접 누적해, 임계값을
    // 넘을 때마다 정확히 한 칸만 이동시킨다(관성 스크롤로 여러 칸이 튀는 것을 막는다).
    var wheelAccum = 0;
    var wheelCooling = false;
    col.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (wheelCooling) return;
      wheelAccum += e.deltaY;
      if (Math.abs(wheelAccum) < WHEEL_DELTA_THRESHOLD) return;
      var direction = wheelAccum > 0 ? 1 : -1;
      wheelAccum = 0;
      var items = Array.prototype.slice.call(col.querySelectorAll('.date-wheel-item'));
      var currentIdx = Math.round(col.scrollTop / DATE_WHEEL_ITEM_HEIGHT);
      var nextIdx = Math.max(0, Math.min(items.length - 1, currentIdx + direction));
      selectWheelIndex(col, unit, nextIdx);
      wheelCooling = true;
      setTimeout(function () { wheelCooling = false; }, WHEEL_STEP_COOLDOWN);
    }, { passive: false });

    col.addEventListener('click', function (e) {
      var item = e.target.closest('.date-wheel-item');
      if (!item) return;
      var items = Array.prototype.slice.call(col.querySelectorAll('.date-wheel-item'));
      var idx = items.indexOf(item);
      selectWheelIndex(col, unit, idx);
      // 9: 일을 클릭하면 확정 후 팝업을 닫고 원래 버튼으로 포커스를 복원한다. 연/월은 팝업을
      // 유지하고 계속 조작할 수 있게 같은 열에 포커스를 둔다.
      if (unit === 'day') {
        closeDateWheelPopupAndParentIfConfirmed();
      } else {
        col.focus();
      }
    });

    // 8: 숫자 키보드로 값을 직접 입력한다(연=4자리, 월/일=최대 2자리). 마지막 입력 후 일정
    // 시간이 지나면 버퍼를 비운다. Backspace로 마지막 자리 삭제, Enter로 확정.
    var numBuffer = '';
    var numBufferTimer = null;
    var maxLen = unit === 'year' ? 4 : 2;

    function resetNumBuffer() {
      numBuffer = '';
      if (numBufferTimer) { clearTimeout(numBufferTimer); numBufferTimer = null; }
    }

    function scheduleBufferReset() {
      if (numBufferTimer) clearTimeout(numBufferTimer);
      numBufferTimer = numBuffer ? setTimeout(resetNumBuffer, WHEEL_NUMBER_BUFFER_TIMEOUT) : null;
    }

    function applyNumBuffer() {
      if (!numBuffer) return;
      var num = Number(numBuffer);
      if (unit === 'year') {
        if (numBuffer.length < 4) return; // 4자리를 다 채웠을 때만 확정(중간 자리수로 점프 방지).
      }
      var items = Array.prototype.slice.call(col.querySelectorAll('.date-wheel-item'));
      var idx = items.findIndex(function (it) { return Number(it.dataset.value) === num; });
      if (idx === -1) return; // 범위 밖 값(예: 13월, 해당 월에 없는 일)은 무시(자동 거부).
      selectWheelIndex(col, unit, idx);
    }

    col.addEventListener('keydown', function (e) {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation(); // 8: 페이지 단축키/항목 선택으로 전달되지 않게 막는다.
        numBuffer = (numBuffer + e.key).slice(-maxLen);
        scheduleBufferReset();
        applyNumBuffer();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        numBuffer = numBuffer.slice(0, -1);
        scheduleBufferReset();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        resetNumBuffer();
        // 9: 연/월 Enter는 값만 확정(이미 확정돼 있음)하고 팝업 유지, 일 Enter는 확정 후 팝업 닫기.
        if (unit === 'day') closeDateWheelPopupAndParentIfConfirmed();
        return;
      }

      var items = Array.prototype.slice.call(col.querySelectorAll('.date-wheel-item'));
      var currentIdx = Math.round(col.scrollTop / DATE_WHEEL_ITEM_HEIGHT);
      var nextIdx = currentIdx;
      if (e.key === 'ArrowDown') nextIdx = Math.min(items.length - 1, currentIdx + 1);
      else if (e.key === 'ArrowUp') nextIdx = Math.max(0, currentIdx - 1);
      else if (e.key === 'PageDown') nextIdx = Math.min(items.length - 1, currentIdx + 5);
      else if (e.key === 'PageUp') nextIdx = Math.max(0, currentIdx - 5);
      else return;
      e.preventDefault();
      resetNumBuffer(); // 방향키로 이동하면 진행 중이던 숫자 입력은 무효화한다.
      selectWheelIndex(col, unit, nextIdx);
      // 9: PageUp/PageDown, 방향키, 일반 스크롤만으로는 팝업을 자동으로 닫지 않는다.
    });
  }

  // 클릭/키보드처럼 목표 인덱스를 이미 알고 있는 경우 전용 — 부드러운 스크롤 애니메이션은
  // 보여주되, 그 애니메이션이 끝나기를 기다리지 않고 값 자체는 즉시 확정한다. (스크롤 이벤트
  // 디바운스에만 맡기면, 애니메이션이 아직 중간 지점을 지나는 순간 디바운스가 먼저 멈췄다고
  // 오판해 애니메이션을 중간에 멈춰버리는 경합이 생길 수 있어 이렇게 분리했다.)
  function selectWheelIndex(col, unit, idx) {
    // 아직 남아있을 수 있는 이전(다른 조작에서 비롯된) 디바운스 settle이 뒤늦게 끼어들어
    // 지금 막 확정하는 값을 덮어쓰지 않도록 먼저 취소한다.
    clearWheelSettleTimer(unit);
    col.scrollTo({ top: idx * DATE_WHEEL_ITEM_HEIGHT, behavior: 'smooth' });
    updateWheelColumnVisual(col, idx);
    var items = col.querySelectorAll('.date-wheel-item');
    activeDateWheel[unit] = Number(items[idx].dataset.value);
    if (unit === 'year' || unit === 'month') regenerateDayColumn();
    commitDateWheelSelection();
  }

  // 날짜 입력칸의 연·월·일 방향키 조작 전용 — smooth 스크롤 애니메이션이 진행되는 동안
  // wireWheelColumn의 네이티브 'scroll' 리스너가 아직 중간 지점인 scrollTop을 기준으로
  // .center를 다시 계산해, 방금 이 함수가 확정한 값을 일시적으로 덮어쓸 수 있다("입력값과
  // 휠 중앙값이 매 단계 즉시 일치해야 한다"는 요구와 충돌). auto(즉시) 스크롤로 애니메이션
  // 자체를 없애 그 경합을 원천 차단한다.
  function selectWheelIndexImmediate(col, unit, idx) {
    clearWheelSettleTimer(unit);
    col.scrollTo({ top: idx * DATE_WHEEL_ITEM_HEIGHT, behavior: 'auto' });
    updateWheelColumnVisual(col, idx);
    var items = col.querySelectorAll('.date-wheel-item');
    activeDateWheel[unit] = Number(items[idx].dataset.value);
    if (unit === 'year' || unit === 'month') regenerateDayColumn();
    commitDateWheelSelection();
  }

  // 날짜 입력칸(YYYY-MM-DD 텍스트)에서 클릭 위치에 따라 연·월·일 중 하나만 선택한다.
  // 상단 메인 날짜 입력과 상세 패널 날짜 이동 메뉴가 공유한다.
  function selectDateInputSegmentFromCursor(input) {
    if (typeof input.selectionStart !== 'number') return;
    var cursorPosition = input.selectionStart;
    if (cursorPosition <= 4) input.setSelectionRange(0, 4);
    else if (cursorPosition <= 7) input.setSelectionRange(5, 7);
    else input.setSelectionRange(8, 10);
  }

  // 날짜 입력칸에서 선택된 연·월·일 세그먼트를 ArrowUp/ArrowDown으로 조절한다.
  // activeDateWheel이 이 input을 향해 열려 있을 때만 동작한다. 상단 메인 날짜 입력과
  // 상세 패널 날짜 이동 메뉴가 공유하며, 처리했으면 true를 반환한다(호출부가 그 뒤
  // 로직 -- Enter/Escape 등 -- 을 계속 실행할 수 있게).
  function handleDateInputArrowKey(e, input) {
    if (
      (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') ||
      !activeDateWheel ||
      activeDateWheel.anchorEl !== input
    ) {
      return false;
    }

    var selectionStart =
      typeof input.selectionStart === 'number' ? input.selectionStart : -1;
    var selectionEnd =
      typeof input.selectionEnd === 'number' ? input.selectionEnd : -1;

    var unit = null;
    var selectStart = 0;
    var selectEnd = 4;

    /*
     * 2026-07-24
     * 0123456789
     */
    if (selectionEnd <= 4) {
      unit = 'year'; selectStart = 0; selectEnd = 4;
    } else if (selectionStart >= 5 && selectionEnd <= 7) {
      unit = 'month'; selectStart = 5; selectEnd = 7;
    } else if (selectionStart >= 8) {
      unit = 'day'; selectStart = 8; selectEnd = 10;
    }

    if (!unit) return false;

    e.preventDefault();
    e.stopPropagation();

    var direction = e.key === 'ArrowUp' ? -1 : 1;
    var col = activeDateWheel.el.querySelector(
      '.date-wheel-col[data-unit="' + unit + '"]'
    );

    if (col) {
      var items = Array.prototype.slice.call(col.querySelectorAll('.date-wheel-item'));
      var currentIdx = items.findIndex(function (it) {
        return Number(it.dataset.value) === activeDateWheel[unit];
      });
      if (currentIdx === -1) currentIdx = 0;

      var nextIdx;
      if (unit === 'month') {
        // 월만 12<->01로 순환한다(연/일은 목록 끝에서 멈춘다).
        nextIdx = (currentIdx + direction + items.length) % items.length;
      } else {
        nextIdx = Math.max(0, Math.min(items.length - 1, currentIdx + direction));
      }

      selectWheelIndexImmediate(col, unit, nextIdx);

      input.focus();
      input.setSelectionRange(selectStart, selectEnd);
    }

    return true;
  }

  // 날짜 입력칸(YYYY-MM-DD)의 연·월·일 세그먼트 경계 -- handleDateInputArrowKey(위,
  // ArrowUp/Down용)의 판정 로직은 그대로 두고, 여기서는 ArrowLeft/Right 전용으로 같은
  // 경계를 인덱스 순서(0=연,1=월,2=일)로도 다룰 수 있게 별도 테이블만 추가한다.
  var DATE_INPUT_SEGMENTS = [
    { unit: 'year', start: 0, end: 4 },
    { unit: 'month', start: 5, end: 7 },
    { unit: 'day', start: 8, end: 10 }
  ];

  function findDateInputSegmentIndex(selectionStart, selectionEnd) {
    return DATE_INPUT_SEGMENTS.findIndex(function (seg) {
      return selectionStart >= seg.start && selectionEnd <= seg.end;
    });
  }

  // 날짜 입력칸에서 선택된 세그먼트를 ArrowLeft/ArrowRight로 좌우 이동한다(값은 바꾸지
  // 않는다 -- ArrowUp/Down인 handleDateInputArrowKey와 완전히 분리된 별도 함수).
  // 상단 메인 날짜 입력과 상세 패널 날짜 이동 메뉴가 공유한다.
  function handleDateInputHorizontalArrowKey(e, input) {
    if (
      (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') ||
      !activeDateWheel ||
      activeDateWheel.anchorEl !== input
    ) {
      return false;
    }

    var selectionStart =
      typeof input.selectionStart === 'number' ? input.selectionStart : -1;
    var selectionEnd =
      typeof input.selectionEnd === 'number' ? input.selectionEnd : -1;

    var currentIndex = findDateInputSegmentIndex(selectionStart, selectionEnd);
    if (currentIndex === -1) return false;

    e.preventDefault();
    e.stopPropagation();

    var nextIndex = currentIndex + (e.key === 'ArrowRight' ? 1 : -1);
    nextIndex = Math.max(0, Math.min(DATE_INPUT_SEGMENTS.length - 1, nextIndex));

    var seg = DATE_INPUT_SEGMENTS[nextIndex];
    input.focus();
    input.setSelectionRange(seg.start, seg.end);
    return true;
  }

  // "2026-09-20"/"2026.09.20"/"2026/09/20"/"20260920"을 YYYY-MM-DD로 정규화하고 존재하지
  // 않는 날짜(예: 2026-02-31)는 거부한다. 상단 메인 날짜 입력의 parseMainDateInput과 같은
  // 규칙이지만 그 함수는 wireDateFields 안에 갇혀 있어 재사용할 수 없다 -- 메인 코드는
  // 건드리지 않기 위해 별도로 둔다.
  function parseYmdDateInput(value) {
    var text = String(value || '').trim();
    if (/^\d{8}$/.test(text)) {
      text = text.slice(0, 4) + '-' + text.slice(4, 6) + '-' + text.slice(6, 8);
    }
    text = text.replace(/[./]/g, '-');
    var match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return formatLocalDate(date);
  }

  // 상세 패널 날짜 이동 메뉴의 시작·종료(또는 단일) 날짜 입력칸에 상단 메인 날짜 입력과
  // 같은 상호작용(클릭 시 세그먼트 선택 + 방향키 조절 + 날짜 휠, Enter 확정)을 연결한다.
  // makeTarget()은 클릭할 때마다(=휠을 열 때마다) 호출돼 그 시점의 스냅샷을 담은
  // openDateWheelPopup용 target({getCurrentDate, applyDate, restore})을 새로 만든다.
  function wireMoveMenuDateInput(input, field, makeTarget) {
    input.addEventListener('mouseup', function () {
      setTimeout(function () {
        selectDateInputSegmentFromCursor(input);
      }, 0);
    });

    input.addEventListener('click', function () {
      openDateWheelPopup(field, input, makeTarget());
    });

    input.addEventListener('keydown', function (e) {
      if (handleDateInputArrowKey(e, input)) return;
      if (handleDateInputHorizontalArrowKey(e, input)) return;

      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();

        // 종료 날짜 입력칸은 휠 조작뿐 아니라 직접 타이핑한 텍스트도 Enter로 확정할 수
        // 있어야 한다(3/7번 요구사항). 시작 날짜 입력칸의 기존 확정 방식(휠만 닫음, 10번
        // 요구사항 -- 이번에 변경하지 않음)은 아래 field==='end' 분기 밖에서 그대로 유지된다.
        if (
          field === 'end' &&
          activeDateWheel &&
          activeDateWheel.anchorEl === input &&
          activeDateWheel.target
        ) {
          var parsed = parseYmdDateInput(input.value);
          if (!parsed) {
            input.classList.add('is-invalid');
            input.setAttribute('aria-invalid', 'true');
            input.select();
            return;
          }
          input.classList.remove('is-invalid');
          input.removeAttribute('aria-invalid');
          // 6: 기존 종료<시작 클램프를 포함해 이미 검증된 커밋 경로(target.applyDate --
          // 휠 클릭·방향키와 동일한 경로)를 그대로 재사용한다. 새 커밋 로직을 만들지 않는다.
          var target = activeDateWheel.target; // closeDateWheelPopup이 activeDateWheel을 지우기 전에 잡아둔다.
          target.applyDate(parsed);
          closeDateWheelPopup(false);
          // 2/3: '일' 클릭 확정과 같은 규칙 -- 종료 날짜 target에만 있는 플래그이므로
          // 시작 날짜(휠만 닫힘)는 그대로 영향받지 않는다.
          if (target.closeParentOnConfirm) closeMoveDateMenu(false);
          return;
        }

        // 6(기존): 값은 이미 매 조작마다 라이브 커밋돼 있으므로 Enter는 휠만 닫으면 된다.
        if (activeDateWheel && activeDateWheel.anchorEl === input) {
          closeDateWheelPopup(false);
        }
      }
    });
  }

  function onOutsideDateWheelPointerDown(e) {
    if (!activeDateWheel) return;
    if (activeDateWheel.el.contains(e.target)) return;
    if (activeDateWheel.anchorEl && activeDateWheel.anchorEl.contains(e.target)) return;
    closeDateWheelPopup();
  }

  function onDateWheelKeydown(e) {
    if (!activeDateWheel) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelDateWheelPopup();
    }
    // Tab 이동은 브라우저 기본 포커스 순회에 맡긴다(7: 키보드 Tab 이동 지원).
  }

  // 날짜 휠은 스크롤·클릭·키보드 조작마다 즉시 commitDateWheelSelection으로 저장하므로
  // (시간 휠과 같은 "라이브 커밋" 방식), Escape는 열기 전 상태로 되돌려야 한다. 이를 위해
  // openDateWheelPopup에서 열기 직전 상태를 스냅샷해 두고 여기서 그대로 복원한다.
  function cancelDateWheelPopup() {
    if (!activeDateWheel) return;
    if (activeDateWheel.target) {
      activeDateWheel.target.restore();
      closeDateWheelPopup();
      return;
    }
    state.dateTimeDraft = activeDateWheel.originalDateTimeDraft;
    state.endDateDraftActive = activeDateWheel.originalEndDateDraftActive;
    state.selectedDateRange = activeDateWheel.originalSelectedDateRange;
    state.selectedDate = activeDateWheel.originalSelectedDate;
    closeDateWheelPopup();
    savePreferences();
    renderApp();
  }

  function closeDateWheelPopup(restoreFocus) {
    if (!activeDateWheel) return;
    var anchorEl = activeDateWheel.anchorEl;
    Object.keys(activeDateWheel.settleTimers).forEach(function (u) {
      if (activeDateWheel.settleTimers[u]) clearTimeout(activeDateWheel.settleTimers[u]);
    });
    activeDateWheel.el.remove();
    document.removeEventListener('pointerdown', onOutsideDateWheelPointerDown, true);
    document.removeEventListener('keydown', onDateWheelKeydown, true);
    // 이 클래스가 남아 있으면 renderDateFields가 이후 이 입력칸을 다시는 보기 좋은
    // 형식으로 갱신하지 못한다(편집용 원시 YYYY-MM-DD에 멈춰 있게 됨) — 휠이 어떤
    // 이유로든 닫히는 이 한 지점에서 항상 지운다.
    if (anchorEl) anchorEl.classList.remove('is-date-editing');
    activeDateWheel = null;
    if (anchorEl) anchorEl.setAttribute('aria-expanded', 'false');
    if (restoreFocus !== false && anchorEl) anchorEl.focus();
  }

  // 날짜 휠의 '일' 확정(클릭/키보드 Enter 공통 경로)에서만 쓴다. 이 휠이 상세 날짜 이동
  // 메뉴의 종료 날짜용으로 열려 있던 경우에만(target.closeParentOnConfirm) 휠과 함께
  // 메뉴도 닫는다 -- 상단 메인 날짜 입력·시작 날짜 휠은 target이 없거나 이 플래그가
  // 없으므로 기존과 똑같이 휠만 닫힌다(8/13번 요구사항 -- 회귀 없음).
  function closeDateWheelPopupAndParentIfConfirmed() {
    var shouldCloseParent = !!(
      activeDateWheel &&
      activeDateWheel.target &&
      activeDateWheel.target.closeParentOnConfirm
    );
    closeDateWheelPopup();
    if (shouldCloseParent) closeMoveDateMenu(false);
  }

  function openDateWheelPopup(field, anchorEl, target) {
    if (
  activeDateWheel &&
  activeDateWheel.field === field &&
  activeDateWheel.anchorEl === anchorEl
) {
  return;
}
    if (activeTitleEdit) commitTitleEdit();
    if (activeTypeMenu) closeTypeMenu(false);
    // target이 있으면(상세 패널 날짜 이동 메뉴 등) 이 휠은 그 메뉴 안에 앵커돼 있으므로
    // 메뉴 자체를 닫지 않는다 -- 그 외(상단 메인 날짜 입력)에는 기존과 동일하게 닫는다.
    if (!target && activeMoveMenu) closeMoveDateMenu(false);
    if (activeWeeklyInlineAdd) closeWeeklyInlineAdd(false);
    if (activeDateWheel) closeDateWheelPopup(false);
    if (activeTimeWheel) closeTimeWheelPopup(false);

    var baseDate;
    if (target) {
      baseDate = target.getCurrentDate();
    } else {
      var range = getDraftRange();
      baseDate = field === 'start' ? range.startDate : range.endDate;
    }
    var d = parseLocalDate(baseDate);
    var year = d.getFullYear();
    var month = d.getMonth() + 1;
    var day = d.getDate();

    var popup = document.createElement('div');
    popup.className = 'date-wheel-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', (field === 'start' ? '시작일' : '종료일') + ' 선택');

    var colsWrap = document.createElement('div');
    colsWrap.className = 'date-wheel-cols';

    var todayYear = parseLocalDate(state.todayDate).getFullYear();
    var years = [];
    for (var y = todayYear - DATE_WHEEL_YEAR_SPAN_BACK; y <= todayYear + DATE_WHEEL_YEAR_SPAN_FWD; y++) years.push(y);
    var months = [];
    for (var m = 1; m <= 12; m++) months.push(m);
    var days = [];
    var dim = daysInMonth(year, month);
    for (var dd = 1; dd <= dim; dd++) days.push(dd);

    var yearCol = buildWheelColumn('year', years, function (v) { return v + '년'; });
    var monthCol = buildWheelColumn('month', months, function (v) { return v + '월'; });
    var dayCol = buildWheelColumn('day', days, function (v) { return v + '일'; });
    colsWrap.appendChild(yearCol);
    colsWrap.appendChild(monthCol);
    colsWrap.appendChild(dayCol);

    var centerLine = document.createElement('div');
    centerLine.className = 'date-wheel-center-line';
    colsWrap.appendChild(centerLine);

    popup.appendChild(colsWrap);
   document.body.appendChild(popup);
positionPopup(popup, anchorEl);
anchorEl.setAttribute('aria-expanded', 'true');

var anchorRect =
  anchorEl.getBoundingClientRect();

var popupRect =
  popup.getBoundingClientRect();

activeDateWheel = {
  field: field,
  anchorEl: anchorEl,
  el: popup,
  year: year,
  month: month,
  day: day,

  /*
   * 입력칸과 패널 사이의 처음 간격을 기억한다.
   * 화면 스크롤 시 패널 전체만 같은 거리로 이동한다.
   */
  offsetTop:
    popupRect.top -
    anchorRect.top,

  offsetLeft:
    popupRect.left -
    anchorRect.left,

  settleTimers: {
    year: null,
    month: null,
    day: null
  },

  // target이 있으면(상세 패널 등) 커밋·복원을 target이 전담하므로 아래 상단 패널 전용
  // 스냅샷은 만들지 않는다.
  target: target || null,

  // Escape로 열기 전 상태를 복원할 때 쓴다(cancelDateWheelPopup, target 없을 때만).
  originalDateTimeDraft: target ? null : (state.dateTimeDraft
    ? { startDate: state.dateTimeDraft.startDate, endDate: state.dateTimeDraft.endDate }
    : null),
  originalEndDateDraftActive: target ? null : state.endDateDraftActive,
  originalSelectedDateRange: target ? null : (state.selectedDateRange
    ? { startDate: state.selectedDateRange.startDate, endDate: state.selectedDateRange.endDate }
    : null),
  originalSelectedDate: target ? null : state.selectedDate
};


    scrollColumnToValue(yearCol, year, false);
    scrollColumnToValue(monthCol, month, false);
    scrollColumnToValue(dayCol, day, false);
    wireWheelColumn(yearCol, 'year');
    wireWheelColumn(monthCol, 'month');
    wireWheelColumn(dayCol, 'day');
  

    setTimeout(function () {
      document.addEventListener('pointerdown', onOutsideDateWheelPointerDown, true);
      document.addEventListener('keydown', onDateWheelKeydown, true);
    }, 0);
  }

  function wireDateFields() {
  function parseMainDateInput(value) {
    var text = String(value || '').trim();

    /*
     * 20260730 입력도 허용한다.
     */
    if (/^\d{8}$/.test(text)) {
      text =
        text.slice(0, 4) + '-' +
        text.slice(4, 6) + '-' +
        text.slice(6, 8);
    }

    /*
     * 2026.07.30, 2026/07/30도 허용한다.
     */
    text = text.replace(/[./]/g, '-');

    var match = text.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/
    );

    if (!match) {
      return null;
    }

    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);

    var date = new Date(
      year,
      month - 1,
      day
    );

    /*
     * 2026-02-31 같은 존재하지 않는 날짜를 거부한다.
     */
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return formatLocalDate(date);
  }

  document
    .querySelectorAll(
      '.date-row .main-date-input[data-field]'
    )
    .forEach(function (input) {
      var field = input.dataset.field;

      /*
       * 입력칸에 포커스가 오면
       * 키보드로 수정하기 쉬운 YYYY-MM-DD 형태로 바꾼다.
       */
      input.addEventListener(
  'focus',
  function () {
    var range = getDraftRange();

    var dateValue =
      field === 'start'
        ? range.startDate
        : (
            state.endDateDraftActive
              ? range.endDate
              : ''
          );

    /*
     * 날짜 입력칸은 계속 text 상태로 유지한다.
     * 브라우저 기본 date 입력과 사용자 날짜 휠의 충돌을 막는다.
     */
    input.type = 'text';

    input.classList.add(
      'is-date-editing'
    );

    input.value = dateValue;

    input.classList.remove(
      'is-invalid'
    );

    input.removeAttribute(
      'aria-invalid'
    );
  }
);
      input.addEventListener(
        'mouseup',
        function () {
          setTimeout(function () {
            selectDateInputSegmentFromCursor(input);
          }, 0);
        }
      );
      /*
       * 클릭하면 기존 날짜 휠도 연다.
       */
      input.addEventListener(
        'click',
        function () {
          if (field === 'end') {
            var range = getDraftRange();

            state.endDateDraftActive = true;

            state.dateTimeDraft = {
              startDate: range.startDate,
              endDate:
                range.endDate ||
                range.startDate
            };

            input.classList.remove(
              'date-placeholder'
            );

            if (!input.value) {
              input.value =
                range.endDate ||
                range.startDate;
            }
          }

          openDateWheelPopup(
            field,
            input
          );
        }
      );

      input.addEventListener(
        'keydown',
        function (e) {
          if (handleDateInputArrowKey(e, input)) return;
          if (handleDateInputHorizontalArrowKey(e, input)) return;

          if (
            e.key === 'Enter' &&
            !e.isComposing
          ) {
            e.preventDefault();
            e.stopPropagation();

            var parsedDate =
              parseMainDateInput(
                input.value
              );

            if (!parsedDate) {
              input.classList.add(
                'is-invalid'
              );

              input.setAttribute(
                'aria-invalid',
                'true'
              );

              input.select();
              return;
            }

            if (field === 'end') {
              state.endDateDraftActive = true;
            }

            /*
             * 열린 날짜 휠을 먼저 닫고
             * 입력한 날짜를 저장한다.
             */
            if (activeDateWheel) {
              closeDateWheelPopup(false);
            }

           
input.classList.remove(
  'is-date-editing'
);
applyDateFieldChange(
  field,
  parsedDate
);

input.blur();

return;
          }

          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();

            if (activeDateWheel) {
              closeDateWheelPopup(false);
            }
            
            renderDateFields();
            input.blur();
          }
        }
      );

      /*
       * 입력하지 않고 밖을 클릭한 경우
       * 다시 보기 좋은 날짜 표시로 되돌린다.
       */
      input.addEventListener(
  'blur',
  function () {
    setTimeout(function () {
      if (!activeDateWheel) {
        renderDateFields();
      }
    }, 0);
  }
);
    });
  var clearEndDateBtn =
    document.querySelector(
      '.date-row .date-clear-btn'
    );

  if (clearEndDateBtn) {
    clearEndDateBtn.addEventListener(
      'pointerdown',
      function (e) {
        e.preventDefault();
        e.stopPropagation();
      }
    );

    clearEndDateBtn.addEventListener(
      'click',
      function (e) {
        e.preventDefault();
        e.stopPropagation();

        if (activeDateWheel) {
          closeDateWheelPopup(false);
        }

        var range = getDraftRange();

        var endBox =
          document.querySelector(
            '.date-row .main-date-input[data-field="end"]'
          );

        if (endBox) {
          endBox.classList.remove(
            'is-date-editing'
          );
        }

        state.endDateDraftActive = false;

        state.dateTimeDraft = {
          startDate: range.startDate,
          endDate: range.startDate
        };

        state.selectedDateRange = null;
        state.selectedDate =
          range.startDate;

        renderApp();
      }
    );
  }
  var topScroller =
    document.querySelector('.top');

  if (topScroller) {
    topScroller.addEventListener(
  'scroll',
  function () {
    if (activeDateWheel) {
      positionPopup(
        activeDateWheel.el,
        activeDateWheel.anchorEl
      );
    }

    if (activeTimeWheel) {
      positionPopup(
        activeTimeWheel.el,
        activeTimeWheel.anchorEl
      );
    }
  },
  { passive: true }
);
  }
}

  // ---------------------------------------------------------------------
  // 시간 휠 팝업 — 날짜 휠과 같은 border/radius/배경/그림자(.date-wheel-popup 등 동일 클래스)와
  // 같은 감도 조절 상수(WHEEL_DELTA_THRESHOLD 등)를 재사용한다. 오전·오후/시/분 세 열이며,
  // 날짜 휠과 달리 어느 열에서 Enter를 눌러도 확정 + 팝업이 닫힌다(일 열만 닫히는 날짜 휠과 다름).
  // ---------------------------------------------------------------------
  var activeTimeWheel = null;
  // { field, anchorEl, el, period, hour, minute, originalStartTime, originalEndTime, settleTimers }

  // 상단 메인 시간 입력 형식("AM  09:00", 오전오후 뒤 공백 두 칸)의 세그먼트 경계 --
  // 상세 패널 시간 입력("am 09:15")과 공백 수·대소문자가 달라 문자 위치가 다르므로
  // 별도 테이블을 쓴다(DETAIL_TIME_INPUT_SEGMENTS 참고).
  var MAIN_TIME_INPUT_SEGMENTS = [
    { unit: 'period', start: 0, end: 2 },
    { unit: 'hour', start: 4, end: 6 },
    { unit: 'minute', start: 7, end: 9 }
  ];

  function clearTimeWheelSettleTimer(unit) {
    if (activeTimeWheel && activeTimeWheel.settleTimers[unit]) {
      clearTimeout(activeTimeWheel.settleTimers[unit]);
      activeTimeWheel.settleTimers[unit] = null;
    }
  }

  function commitTimeWheelSelection() {
    if (!activeTimeWheel) return;
    var newTime = to24Hour(activeTimeWheel.period, activeTimeWheel.hour, activeTimeWheel.minute);
    applyTimeFieldChange(activeTimeWheel.field, newTime);
  }

  // 'smooth' 스크롤 애니메이션 도중 다음 조작(휠·방향키·클릭)이 연달아 들어오면 애니메이션이
  // 이어서 발생시키는 네이티브 'scroll' 이벤트가 그 뒤늦은 시점의(아직 목표에 도달 못한)
  // scrollTop을 기준으로 다시 값을 확정해 방금 확정한 값을 덮어쓸 수 있다. 조작마다 토큰을
  // 새로 발급해, settle 타이머가 실행될 때 자신이 발급된 이후 더 최신 조작이 없었는지 확인하고
  // 있었다면 스스로 무시한다(오래된 조작의 뒤늦은 되돌림을 막는다).
  function selectTimeWheelIndex(col, unit, idx) {
    clearTimeWheelSettleTimer(unit);
    col._twOpToken = (col._twOpToken || 0) + 1;
    col.scrollTo({ top: idx * DATE_WHEEL_ITEM_HEIGHT, behavior: 'smooth' });
    updateWheelColumnVisual(col, idx);
    var items = col.querySelectorAll('.date-wheel-item');
    var raw = items[idx].dataset.value;
    activeTimeWheel[unit] = unit === 'period' ? raw : Number(raw);
    commitTimeWheelSelection();
  }

  function settleTimeWheelColumn(col, unit, expectedToken) {
    if (!activeTimeWheel) return;
    if (expectedToken !== undefined && col._twOpToken !== expectedToken) return; // 더 최신 조작이 이미 있었음 — 무시.
    var items = Array.prototype.slice.call(col.querySelectorAll('.date-wheel-item'));
    var idx = Math.round(col.scrollTop / DATE_WHEEL_ITEM_HEIGHT);
    idx = Math.max(0, Math.min(items.length - 1, idx));
    col.scrollTo({ top: idx * DATE_WHEEL_ITEM_HEIGHT, behavior: 'auto' });
    updateWheelColumnVisual(col, idx);
    var raw = items[idx].dataset.value;
    activeTimeWheel[unit] = unit === 'period' ? raw : Number(raw);
    commitTimeWheelSelection();
  }

  // 1: 오전오후/시/분 세 열 DOM을 현재 activeTimeWheel 상태에 맞춰 다시 정렬한다 — 숫자 버퍼로
  // 값이 바뀐 뒤 세 열의 중앙 선택값을 즉시 동기화하는 용도로만 쓴다(열 간 캐스케이딩 없음).
  function syncTimeWheelColumnsToState() {
    if (!activeTimeWheel) return;
    var periodCol = activeTimeWheel.el.querySelector('.date-wheel-col[data-unit="period"]');
    var hourCol = activeTimeWheel.el.querySelector('.date-wheel-col[data-unit="hour"]');
    var minuteCol = activeTimeWheel.el.querySelector('.date-wheel-col[data-unit="minute"]');
    if (periodCol) scrollColumnToValue(periodCol, activeTimeWheel.period, false);
    if (hourCol) scrollColumnToValue(hourCol, activeTimeWheel.hour, false);
    if (minuteCol) scrollColumnToValue(minuteCol, activeTimeWheel.minute, false);
  }

  // applyTimeFieldChange의 같은 날 종료<시작 클램프(또는 시작 변경에 따른 종료 자동보정)로
  // 실제 저장값이 열려 있는 휠의 원시 스크롤 위치와 달라졌을 때, 그 휠(activeTimeWheel이
  // 가리키는 필드)을 최종 저장값으로 되돌린다. smooth로 하면 이어지는 wheel/scroll 이벤트와
  // 다시 경쟁할 수 있어 syncTimeWheelColumnsToState()의 auto(non-smooth) 방식을 그대로 쓴다.
  function syncActiveTimeWheelToCommittedTime() {
    if (!activeTimeWheel) return;
    var committed = activeTimeWheel.field === 'start'
      ? (state.timeDraft.startTime || '09:00')
      : (state.timeDraft.endTime || '00:00');
    var parsed = parseTime12(committed);
    if (
      activeTimeWheel.period === parsed.period &&
      activeTimeWheel.hour === parsed.hour &&
      activeTimeWheel.minute === parsed.minute
    ) {
      return;
    }
    activeTimeWheel.period = parsed.period;
    activeTimeWheel.hour = parsed.hour;
    activeTimeWheel.minute = parsed.minute;
    syncTimeWheelColumnsToState();
  }

  function clearTimeNumBuffer() {
    if (!activeTimeWheel) return;
    activeTimeWheel.numBuffer = '';
    activeTimeWheel.numBufferUnit = null;
    if (activeTimeWheel.numBufferTimer) { clearTimeout(activeTimeWheel.numBufferTimer); activeTimeWheel.numBufferTimer = null; }
  }

  function scheduleTimeNumBufferReset() {
    if (!activeTimeWheel) return;
    if (activeTimeWheel.numBufferTimer) clearTimeout(activeTimeWheel.numBufferTimer);
    activeTimeWheel.numBufferTimer = activeTimeWheel.numBuffer
      ? setTimeout(clearTimeNumBuffer, WHEEL_NUMBER_BUFFER_TIMEOUT)
      : null;
  }

  // 2: 버퍼 길이로 "열별 입력"과 "전체 시간 입력"을 구분한다.
  // 1~2자리 — 마지막으로 입력받은 열(시/분)만 그 값으로 바꾸고 나머지 두 열은 그대로 둔다
  // (분은 5분 단위로 반올림하되 시로 넘어가지 않도록 60을 0으로 감싼다 — 열 자체 캐스케이딩 금지).
  // 3~4자리 — HHmm(24시간제) 전체 시간으로 해석한다. 이때는 분이 60에 닿으면 시가 자연스럽게
  // 넘어가는 것이 맞으므로(예: 09:58 → 10:00) roundToNearest5의 캐스케이딩 결과를 그대로 쓴다.
  function applyTimeNumBuffer() {
    if (!activeTimeWheel || !activeTimeWheel.numBuffer) return;
    var buf = activeTimeWheel.numBuffer;

    if (buf.length <= 2) {
      var num = Number(buf);
      if (activeTimeWheel.numBufferUnit === 'hour') {
        if (num < 1 || num > 12) return;
        activeTimeWheel.hour = num;
      } else if (activeTimeWheel.numBufferUnit === 'minute') {
        if (num > 59) return;
        activeTimeWheel.minute = (Math.round(num / 5) * 5) % 60;
      } else {
        return;
      }
      syncTimeWheelColumnsToState();
      commitTimeWheelSelection();
      return;
    }

    var hour24, minute;
    if (buf.length === 3) { hour24 = Number(buf.slice(0, 1)); minute = Number(buf.slice(1)); }
    else { hour24 = Number(buf.slice(0, 2)); minute = Number(buf.slice(2)); }
    if (hour24 > 23 || minute > 59) return; // 유효 범위를 벗어난 입력은 적용하지 않는다.

    var rounded = roundToNearest5(hour24, minute);
    var parsed12 = minutesOfDayToTime12(rounded.hour * 60 + rounded.minute);
    activeTimeWheel.period = parsed12.period;
    activeTimeWheel.hour = parsed12.hour;
    activeTimeWheel.minute = parsed12.minute;
    syncTimeWheelColumnsToState();
    commitTimeWheelSelection();
  }

  // 'smooth' 스크롤 애니메이션이 끝나기 전에 다음 휠/방향키 입력이 연달아 들어오면
  // col.scrollTop이 아직 목표 지점에 도달하지 못한 상태라 Math.round(scrollTop/32)로 계산한
  // "현재 인덱스"가 실제 값과 어긋날 수 있다. activeTimeWheel[unit](항상 동기적으로 확정된
  // 값)에서 역으로 인덱스를 구하면 애니메이션 진행 상태와 무관하게 항상 정확하다.
  function currentTimeWheelIndex(col, unit) {
    var items = Array.prototype.slice.call(col.querySelectorAll('.date-wheel-item'));
    var value = activeTimeWheel[unit];
    var idx = items.findIndex(function (it) { return it.dataset.value === String(value); });
    return idx === -1 ? 0 : idx;
  }

  function wireTimeWheelColumn(col, unit) {
    col.addEventListener('click', function (e) {
  var item = e.target.closest('.date-wheel-item');
  if (!item) return;

  var items = Array.prototype.slice.call(
    col.querySelectorAll('.date-wheel-item')
  );
  var idx = items.indexOf(item);

  selectTimeWheelIndex(col, unit, idx);

  // 분을 클릭하면 시간 선택을 확정하고 팝업을 닫는다.
  // 시작시간과 종료시간 모두 같은 시간 휠을 사용하므로 함께 적용된다.
  if (unit === 'minute') {
    clearTimeNumBuffer();
    closeTimeWheelPopup();
    return;
  }

  // 오전·오후와 시를 선택했을 때는 계속 조작할 수 있도록 유지한다.
  col.focus();
});

    // 1: 세 열은 완전히 독립적이다 — 어느 열을 스크롤/방향키로 움직여도 그 열의 값만
    // 바뀌고 나머지 두 열은 그대로 유지된다. 날짜 휠과 달리 시간 휠은 끝에서 멈추지 않고
    // 다음 값으로 순환한다(분 55 다음 00, 시 12 다음 1) — 순환해도 다른 열은 건드리지 않는다.
    var wheelAccum = 0;
    var wheelCooling = false;
    col.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (wheelCooling) return;
      wheelAccum += e.deltaY;
      if (Math.abs(wheelAccum) < WHEEL_DELTA_THRESHOLD) return;
      var direction = wheelAccum > 0 ? 1 : -1;
      wheelAccum = 0;
      var items = Array.prototype.slice.call(col.querySelectorAll('.date-wheel-item'));
      var currentIdx = currentTimeWheelIndex(col, unit);
      var nextIdx = (currentIdx + direction + items.length) % items.length;
      selectTimeWheelIndex(col, unit, nextIdx);
      wheelCooling = true;
      setTimeout(function () { wheelCooling = false; }, WHEEL_STEP_COOLDOWN);
    }, { passive: false });

    col.addEventListener('keydown', function (e) {
      if (unit === 'period') {
        // 오전/오후 열은 A/P 키로 직접 전환한다.
        if (e.key === 'a' || e.key === 'A' || e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          e.stopPropagation();
          var wantAM = (e.key === 'a' || e.key === 'A');
          var items = Array.prototype.slice.call(col.querySelectorAll('.date-wheel-item'));
          var idx = items.findIndex(function (it) { return it.dataset.value === (wantAM ? 'AM' : 'PM'); });
          if (idx !== -1) selectTimeWheelIndex(col, unit, idx);
          return;
        }
      } else if (/^[0-9]$/.test(e.key)) {
        // 2: 시·분 열은 팝업 공용 버퍼에 쌓이되, 어느 열에서 입력했는지(numBufferUnit)를
        // 함께 기억해 1~2자리는 그 열만 바꾸고, 3~4자리로 늘어나면 전체 시간(HHmm)으로 재해석한다.
        e.preventDefault();
        e.stopPropagation(); // 페이지 단축키/항목 선택으로 전달되지 않게 막는다.
        if (activeTimeWheel) {
          activeTimeWheel.numBuffer = ((activeTimeWheel.numBuffer || '') + e.key).slice(-4);
          activeTimeWheel.numBufferUnit = unit;
          scheduleTimeNumBufferReset();
          applyTimeNumBuffer();
        }
        return;
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (activeTimeWheel) {
          activeTimeWheel.numBuffer = (activeTimeWheel.numBuffer || '').slice(0, -1);
          scheduleTimeNumBufferReset();
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        clearTimeNumBuffer();
        closeTimeWheelPopup(); // 시간 팝업은 어느 열에서 Enter를 눌러도 확정 + 닫힘.
        return;
      }

      var items2 = Array.prototype.slice.call(col.querySelectorAll('.date-wheel-item'));
      var len = items2.length;
      var currentIdx = currentTimeWheelIndex(col, unit);
      var nextIdx = currentIdx;
      if (e.key === 'ArrowDown') nextIdx = (currentIdx + 1 + len) % len;
      else if (e.key === 'ArrowUp') nextIdx = (currentIdx - 1 + len) % len;
      else if (e.key === 'PageDown') nextIdx = (currentIdx + 5 + len) % len;
      else if (e.key === 'PageUp') nextIdx = (currentIdx - 5 + len) % len;
      else return;
      e.preventDefault();
      clearTimeNumBuffer();
      selectTimeWheelIndex(col, unit, nextIdx);
    });
  }

  function onOutsideTimeWheelPointerDown(e) {
    if (!activeTimeWheel) return;
    if (activeTimeWheel.el.contains(e.target)) return;
    if (activeTimeWheel.anchorEl && activeTimeWheel.anchorEl.contains(e.target)) return;
    closeTimeWheelPopup(); // 4: 외부 클릭 — 현재 값을 저장(이미 라이브 반영됨)하고 닫기만 한다.
  }

  function onTimeWheelKeydown(e) {
    if (!activeTimeWheel) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelTimeWheelPopup();
    }
  }

  function closeTimeWheelPopup(restoreFocus) {
    if (!activeTimeWheel) return;
    var anchorEl = activeTimeWheel.anchorEl;
    Object.keys(activeTimeWheel.settleTimers).forEach(function (u) {
      if (activeTimeWheel.settleTimers[u]) clearTimeout(activeTimeWheel.settleTimers[u]);
    });
    activeTimeWheel.el.remove();
    document.removeEventListener('pointerdown', onOutsideTimeWheelPointerDown, true);
    document.removeEventListener('keydown', onTimeWheelKeydown, true);
    // Enter 커밋 경로가 아닌 다른 종료 경로(Escape, 바깥 클릭, 분 클릭 확정, 다른 필드로
    // 전환)에서는 이 클래스가 지워지지 않아 renderTimeFields가 이후 이 입력칸을 영영
    // 갱신하지 않게 되는 문제가 있었다 — 휠이 어떤 이유로든 닫히는 이 한 지점에서 항상
    // 지워 renderTimeFields가 실제 값을 다시 반영할 수 있게 한다.
    if (anchorEl) anchorEl.classList.remove('is-time-editing');
    activeTimeWheel = null;
    if (anchorEl) anchorEl.setAttribute('aria-expanded', 'false');
    if (restoreFocus !== false && anchorEl) anchorEl.focus();
  }

  // 4: Escape — 팝업을 열기 전 시간(시작·종료 모두)으로 되돌리고 닫는다.
  function cancelTimeWheelPopup() {
    if (!activeTimeWheel) return;
    state.timeDraft = { startTime: activeTimeWheel.originalStartTime, endTime: activeTimeWheel.originalEndTime };
    closeTimeWheelPopup();
    renderApp();
  }

  function openTimeWheelPopup(field, anchorEl) {
    if (state.allDayDraft) return; // 7: 하루 종일이면 클릭해도 시간 팝업을 열지 않는다.
if (
  activeTimeWheel &&
  activeTimeWheel.field === field &&
  activeTimeWheel.anchorEl === anchorEl
) {
  return;
}    // 4: 기존 cross-close 구조 재사용 — 다른 팝업/편집이 열려 있으면 먼저 정리한다.
    if (activeTitleEdit) commitTitleEdit();
    if (activeTypeMenu) closeTypeMenu(false);
    if (activeMoveMenu) closeMoveDateMenu(false);
    if (activeWeeklyInlineAdd) closeWeeklyInlineAdd(false);
    if (activeDateWheel) closeDateWheelPopup(false);
    if (activeTimeWheel) closeTimeWheelPopup(false);

    var currentTime =
  field === 'start'
    ? (state.timeDraft.startTime || '09:00')
    : (state.timeDraft.endTime || '00:00');
    var parsed = parseTime12(currentTime);
    // 2: 분 휠은 00/05/.../55 열두 값이므로, 팝업을 여는 시점에 기존 값을 가장 가까운 5분으로
    // 미리 보정해 둔다(예: 기존 저장값이 09:17이었다면 09:15로 스냅).
    var initMinutesOfDay = timeToMinutesOfDay(parsed.period, parsed.hour, parsed.minute);
    var roundedInit = roundToNearest5(Math.floor(initMinutesOfDay / 60), initMinutesOfDay % 60);
    var parsed12 = minutesOfDayToTime12(roundedInit.hour * 60 + roundedInit.minute);
    parsed = { period: parsed12.period, hour: parsed12.hour, minute: parsed12.minute };

    var popup = document.createElement('div');
    popup.className = 'date-wheel-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', (field === 'start' ? '시작 시간' : '종료 시간') + ' 선택');

    var colsWrap = document.createElement('div');
    colsWrap.className = 'date-wheel-cols';

    var minutes = []; // 1: 분은 00,05,10,...,55 5분 단위 열두 값을 독립 열로 사용한다.
    for (var mi = 0; mi < 60; mi += 5) minutes.push(mi);
    var hours = [];
    for (var hi = 1; hi <= 12; hi++) hours.push(hi);

    var periodCol = buildWheelColumn('period', ['AM', 'PM'], function (v) { return v; });
    var hourCol = buildWheelColumn('hour', hours, function (v) { return String(v); });
    var minuteCol = buildWheelColumn('minute', minutes, function (v) { return String(v).padStart(2, '0'); });
    colsWrap.appendChild(periodCol);
    colsWrap.appendChild(hourCol);
    colsWrap.appendChild(minuteCol);

    var centerLine = document.createElement('div');
    centerLine.className = 'date-wheel-center-line';
    colsWrap.appendChild(centerLine);

    popup.appendChild(colsWrap);
    document.body.appendChild(popup);
    positionPopup(popup, anchorEl);
    anchorEl.setAttribute('aria-expanded', 'true');

    activeTimeWheel = {
      field: field, anchorEl: anchorEl, el: popup,
      period: parsed.period, hour: parsed.hour, minute: parsed.minute,
      originalStartTime: state.timeDraft.startTime || '09:00',
originalEndTime: state.timeDraft.endTime || null,
      settleTimers: { period: null, hour: null, minute: null },
      numBuffer: '', numBufferUnit: null, numBufferTimer: null
    };

    scrollColumnToValue(periodCol, parsed.period, false);
    scrollColumnToValue(hourCol, parsed.hour, false);
    scrollColumnToValue(minuteCol, parsed.minute, false);
    wireTimeWheelColumn(periodCol, 'period');
    wireTimeWheelColumn(hourCol, 'hour');
    wireTimeWheelColumn(minuteCol, 'minute');
    

    setTimeout(function () {
      document.addEventListener('pointerdown', onOutsideTimeWheelPointerDown, true);
      document.addEventListener('keydown', onTimeWheelKeydown, true);
    }, 0);
  }

  function wireTimeFields() {
  function parseMainTimeInput(value) {
    var text = String(value || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');

    var match = text.match(
      /^(AM|PM)\s*(\d{1,2}):(\d{1,2})$/
    );

    if (!match) {
      return null;
    }

    var period = match[1];
    var hour = Number(match[2]);
    var minute = Number(match[3]);

    if (
      hour < 1 ||
      hour > 12 ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }

    return to24Hour(
      period,
      hour,
      minute
    );
  }

  document
    .querySelectorAll(
      '.time-row .range-box[data-field]'
    )
    .forEach(function (input) {
      input.addEventListener(
  'click',
  function () {
    if (state.allDayDraft) return;

    var cursorPosition =
      typeof input.selectionStart ===
      'number'
        ? input.selectionStart
        : 0;

    input.classList.add(
      'is-time-editing'
    );

    openTimeWheelPopup(
      input.dataset.field,
      input
    );

    setTimeout(function () {
      input.focus();

      if (cursorPosition <= 2) {
        input.setSelectionRange(0, 2);
      } else if (cursorPosition <= 6) {
        input.setSelectionRange(4, 6);
      } else {
        input.setSelectionRange(7, 9);
      }
    }, 0);
  }
);
      input.addEventListener(
        'keydown',
        function (e) {
          if (
            handleTimeInputHorizontalArrowKey(
              e,
              input,
              MAIN_TIME_INPUT_SEGMENTS,
              !!(activeTimeWheel && activeTimeWheel.anchorEl === input)
            )
          ) {
            return;
          }

              /*
     * 선택한 AM·시·분을 방향키로 조절한다.
     */
    if (
      (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) &&
      activeTimeWheel &&
      activeTimeWheel.anchorEl === input
    ) {
      var selectionStart =
        typeof input.selectionStart ===
        'number'
          ? input.selectionStart
          : -1;

      var selectionEnd =
        typeof input.selectionEnd ===
        'number'
          ? input.selectionEnd
          : -1;

      var unit = null;
      var selectStart = 0;
      var selectEnd = 2;

      /*
       * AM··09:00
       * 01  45 78
       */
      if (selectionEnd <= 2) {
        unit = 'period';
        selectStart = 0;
        selectEnd = 2;
      } else if (
        selectionStart >= 4 &&
        selectionEnd <= 6
      ) {
        unit = 'hour';
        selectStart = 4;
        selectEnd = 6;
      } else if (selectionStart >= 7) {
        unit = 'minute';
        selectStart = 7;
        selectEnd = 9;
      }

      if (unit) {
        var col =
          activeTimeWheel.el.querySelector(
            '.date-wheel-col[data-unit="' +
              unit +
              '"]'
          );

        if (col) {
          var items =
            col.querySelectorAll(
              '.date-wheel-item'
            );

          var currentIdx =
            currentTimeWheelIndex(
              col,
              unit
            );

          var direction =
            e.key === 'ArrowUp'
              ? -1
              : 1;

          var nextIdx =
            (
              currentIdx +
              direction +
              items.length
            ) % items.length;

          e.preventDefault();
          e.stopPropagation();

          clearTimeNumBuffer();

          selectTimeWheelIndex(
            col,
            unit,
            nextIdx
          );

          input.focus();

          input.setSelectionRange(
            selectStart,
            selectEnd
          );

          return;
        }
      }
    }
          if (
            e.key !== 'Enter' ||
            e.isComposing
          ) {
            return;
          }

          e.preventDefault();
          e.stopPropagation();

          var parsedTime =
            parseMainTimeInput(
              input.value
            );

          if (!parsedTime) {
            input.classList.add(
              'is-invalid'
            );

            input.setAttribute(
              'aria-invalid',
              'true'
            );

            input.select();
            return;
          }

          input.classList.remove(
            'is-invalid',
            'is-time-editing'
          );

          input.removeAttribute(
            'aria-invalid'
          );

          if (activeTimeWheel) {
            closeTimeWheelPopup(false);
          }

          applyTimeFieldChange(
            input.dataset.field,
            parsedTime
          );
        }
      );
    });

  var clearEndBtn =
    document.querySelector(
      '.time-row .time-clear-btn'
    );

  if (clearEndBtn) {
    clearEndBtn.addEventListener(
      'pointerdown',
      function (e) {
        e.preventDefault();
        e.stopPropagation();
      }
    );

    clearEndBtn.addEventListener(
      'click',
      function (e) {
        e.preventDefault();
        e.stopPropagation();

        if (activeTimeWheel) {
          closeTimeWheelPopup(false);
        }

        state.timeDraft = {
          startTime:
            state.timeDraft.startTime ||
            '09:00',
          endTime: null
        };

        renderApp();
      }
    );
  }
}

  // Weekly "+" 버튼의 aria-label에 실제 날짜를 채운다(정적 HTML은 공용 라벨만 가짐).
  function initWeeklyPlusLabels() {
    document.querySelectorAll('.week-card').forEach(function (card) {
      var ul = card.querySelector('ul[data-date]');
      var plusBtn = card.querySelector('.plus');
      if (ul && plusBtn) {
        plusBtn.setAttribute('aria-label', formatAnnounceDate(ul.dataset.date) + '에 항목 추가');
      }
    });
  }

  // ---------------------------------------------------------------------
  // 3: Weekly 날짜 이동 — 항상 연속된 7일(state.weekStartDate ~ +6일)을 보여준다.
  // 항목의 실제 date/이동 여부는 절대 건드리지 않고, 어느 7일을 "보여줄지"만 바꾼다.
  // ---------------------------------------------------------------------
  function getWeekStartSunday(dateStr) {
    var d = parseLocalDate(dateStr);
    var sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
    return formatLocalDate(sunday);
  }

  // 7개 .week-card의 헤더 텍스트(MM.DD (요일))·일/토 색상 클래스·ul[data-date]·+
  // 버튼 aria-label을 현재 state.weekStartDate 기준으로 다시 채운다. renderWeekly()가
  // 그 뒤 이 새 data-date를 기준으로 항목을 다시 그린다.
  function renderWeeklyDateHeaders() {
    var cards = document.querySelectorAll('.week-card');
    var start = parseLocalDate(state.weekStartDate);
    cards.forEach(function (card, i) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var dateStr = formatLocalDate(d);
      var headerSpan = card.querySelector('header span');
      var ul = card.querySelector('ul[data-date]');
      var plusBtn = card.querySelector('.plus');
      if (headerSpan) {
        headerSpan.textContent = String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0') + ' (' + WEEKDAY_KO[d.getDay()] + ')';
        headerSpan.classList.remove('sun', 'sat');
        if (d.getDay() === 0) headerSpan.classList.add('sun');
        else if (d.getDay() === 6) headerSpan.classList.add('sat');
      }
      if (ul) ul.dataset.date = dateStr;
      if (plusBtn) plusBtn.setAttribute('aria-label', formatAnnounceDate(dateStr) + '에 항목 추가');
    });
  }

  function afterWeekNavigate() {
    savePreferences();
    renderWeeklyDateHeaders();
    renderWeekly();
    renderSelectionState();
    var weeklyBody = document.querySelector('.weekly-body');
    if (weeklyBody) weeklyBody.scrollTop = 0; // Weekly 내부 스크롤은 항상 맨 위로.
  }

  function navigateWeek(deltaDays) {
    state.weekStartDate = addCalendarDays(state.weekStartDate, deltaDays);
    afterWeekNavigate();
  }

  function navigateWeekToToday() {
    state.weekStartDate = getWeekStartSunday(state.todayDate);
    afterWeekNavigate();
  }

  function wireWeeklyNav() {
    document.querySelectorAll('.week-nav-btn[data-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nav = btn.dataset.nav;
        if (nav === 'today') navigateWeekToToday();
        else navigateWeek(Number(nav));
      });
    });
  }

  // ---------------------------------------------------------------------
  // Weekly 패널 내리기·올리기 토글 + 상단 경계 드래그로 높이·위치 조절.
  // Weekly는 display:none/height:0 방식의 "접힘"이 아니라, 펼쳤을 때의 top/height를 항상
  // 그대로 유지한 채(내부 DOM·스크롤·선택·인라인입력 상태 전부 보존) transform:translateY로
  // 패널 전체를 화면 아래로 밀어내 헤더 한 줄만 보이게 하는 "슬라이드" 방식이다. 이렇게 하면
  // .weekly-body의 실제 박스 크기가 절대 바뀌지 않아 flex로 늘어난 카드 레이아웃이나
  // scrollTop이 내렸다 올려도 흐트러지지 않는다.
  // ---------------------------------------------------------------------
  // offsetTop/offsetHeight는 레이아웃 값이라 transform(내려간 상태)의 영향을 받지 않는다.
  // bottomOffset(패널 top부터 헤더 "바닥"까지, margin-top 포함)은 헤더 바닥이 화면 맨
  // 아래에 정확히 맞닿도록 translateY 이동량을 계산하는 데 쓴다. height(헤더 자신의 높이,
  // margin 제외)는 그 결과로 화면에 남는 헤더의 실제 top 좌표(= shellHeight - height)를
  // 계산하는 데 쓴다 — margin-top은 이동 후에도 헤더 위에 그대로 남아있으므로 두 계산에
  // 서로 다른 값을 써야 상단 영역 높이가 헤더 top과 정확히 맞아떨어진다.
  function getWeeklyHeaderMetrics() {
    var headEl = document.querySelector('.weekly-head');
    if (!headEl) return { bottomOffset: 0, height: 0 };
    return { bottomOffset: headEl.offsetTop + headEl.offsetHeight, height: headEl.offsetHeight };
  }

  // artboard의 실제 렌더 높이(=현재 100dvh) — 짧은 화면에서 WEEKLY_MIN_TOP/MAX_TOP 같은
  // 고정 픽셀 상수가 더 이상 맞지 않을 수 있어 매번 다시 읽는다.
  function getArtboardHeight() {
    var artboardEl = document.querySelector('.artboard');
    var h = artboardEl ? artboardEl.getBoundingClientRect().height : 0;
    return h > 0 ? h : (WEEKLY_DEFAULT_TOP + 610);
  }

  // 저장된/드래그로 요청한 top이 현재 화면 높이에서도 안전한 범위인지 다시 clamp한다 —
  // Weekly가 항상 최소 WEEKLY_MIN_VISIBLE_HEIGHT만큼은 보이는 높이를 갖도록 보장한다.
  // isLowered 여부와 무관하게 top은 언제나 "펼쳤을 때의" 위치이므로 이 계산 하나로 충분하다.
  function clampWeeklyTop(topPx) {
    var artboardHeight = getArtboardHeight();
    var minTop = WEEKLY_MIN_TOP;
    var maxTop = Math.min(WEEKLY_MAX_TOP, Math.max(minTop, artboardHeight - WEEKLY_MIN_VISIBLE_HEIGHT));
    return Math.max(minTop, Math.min(maxTop, topPx));
  }

  // topPxOverride: 경계 드래그 중 실시간 미리보기용(아직 state에 커밋 전). 생략하면
  // state.weeklyPanel.top을 기준으로 삼는다. top/height(펼친 크기)는 isLowered와 무관하게
  // 항상 이 값 그대로 적용하고, isLowered일 때만 그 위에 translateY를 추가로 얹는다 —
  // 그래서 내렸다 올려도 패널의 실제 크기·내부 레이아웃은 단 한 번도 바뀌지 않는다.
  function applyWeeklyPanelPosition(topPxOverride) {
    var weeklyEl = document.querySelector('.weekly');
    var topAreaEl = document.querySelector('.top');
    if (!weeklyEl || !topAreaEl) return;
    var topPx = typeof topPxOverride === 'number' ? topPxOverride : (state.weeklyPanel.top || WEEKLY_DEFAULT_TOP);
    weeklyEl.style.top = topPx + 'px'; // bottom:0은 CSS에 고정으로 있어 높이는 브라우저가 자동 계산.
    weeklyEl.classList.toggle('is-lowered', !!state.weeklyPanel.isLowered);
    if (state.weeklyPanel.isLowered) {
      var headerMetrics = getWeeklyHeaderMetrics();
      var shellHeight = getArtboardHeight();
      var panelHeight = Math.max(0, shellHeight - topPx); // bottom:0이라 항상 이 값과 같다.
      weeklyEl.style.transform = 'translateY(' + Math.max(0, panelHeight - headerMetrics.bottomOffset) + 'px)';
      // 6: 상단 영역은 이제 "화면에 남은 Weekly 헤더의 상단"까지 확장한다 — 패널이 내려가도
      // 헤더의 화면상 위치는 항상 shellHeight - headerMetrics.height로 일정하다(top과 무관).
      topAreaEl.style.height = Math.max(0, shellHeight - headerMetrics.height - WEEKLY_GAP) + 'px';
    } else {
      weeklyEl.style.transform = '';
      topAreaEl.style.height = (topPx - WEEKLY_GAP) + 'px';
    }
  }

  // 브라우저 창 크기가 바뀌면 Weekly의 top 값 자체는 임의로 바꾸지 않되(비율 재계산 없음),
  // 새 화면에서도 여전히 유효한 범위인지 안전하게 재clamp한다. 높이는 CSS(top+bottom:0)가
  // 알아서 다시 계산하므로 여기서는 top 재검증 + 재적용만 하면 된다.
  function handleWeeklyPanelResize() {
    if (!state.weeklyPanel) return;
    state.weeklyPanel.top = clampWeeklyTop(state.weeklyPanel.top || WEEKLY_DEFAULT_TOP);
    applyWeeklyPanelPosition();
  }

  function wireWeeklyPanelResize() {
    var resizeRaf = null;
    window.addEventListener('resize', function () {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(function () {
        resizeRaf = null;
        handleWeeklyPanelResize();
      });
    });
  }

  // 토글(접기/펼치기)에서만 짧은 트랜지션을 켠다 — 경계 드래그 중에는 즉시 반응해야 하므로
  // 이 클래스를 절대 붙이지 않는다.
  function setWeeklyPanelAnimating(on) {
    var weeklyEl = document.querySelector('.weekly');
    var topAreaEl = document.querySelector('.top');
    if (weeklyEl) weeklyEl.classList.toggle('panel-transition', on);
    if (topAreaEl) topAreaEl.classList.toggle('panel-transition', on);
  }

  // 올라옴(▼, 기존 .open 의미 재사용) / 내려감(▲, 새 .up) 방향으로 토글 아이콘을 바꾼다.
  function renderWeeklyPanelToggleState() {
    var toggleBtn = document.querySelector('.collapse');
    var tri = toggleBtn ? toggleBtn.querySelector('.tri') : null;
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(!state.weeklyPanel.isLowered));
    if (tri) {
      tri.classList.toggle('open', !state.weeklyPanel.isLowered);
      tri.classList.toggle('up', state.weeklyPanel.isLowered);
    }
  }

  // 내리기/올리기는 top(펼친 위치·높이)을 절대 건드리지 않는다 — isLowered 플래그와
  // transform만 바뀌므로 DOM/스크롤/선택/인라인입력 등 Weekly 내부 상태는 항상 그대로다.
  function toggleWeeklyPanelLowered() {
    setWeeklyPanelAnimating(true);
    if (state.weeklyPanel.isLowered) {
      // 올리기 — top은 내려가 있는 동안에도 계속 lastExpandedTop과 같았으므로(아래 참고)
      // 별도 복원 계산 없이 화면 크기 변경 대비 재clamp만 하면 된다.
      state.weeklyPanel.isLowered = false;
      state.weeklyPanel.top = clampWeeklyTop(state.weeklyPanel.lastExpandedTop || WEEKLY_DEFAULT_TOP);
    } else {
      // 내리기 — 지금 top을 lastExpandedTop으로 기억해 둔다(top 자체는 바꾸지 않는다).
      state.weeklyPanel.lastExpandedTop = state.weeklyPanel.top || WEEKLY_DEFAULT_TOP;
      state.weeklyPanel.isLowered = true;
    }
    applyWeeklyPanelPosition();
    renderWeeklyPanelToggleState();
    saveWeeklyPanelPrefs();
    setTimeout(function () { setWeeklyPanelAnimating(false); }, 260);
  }

  function wireWeeklyPanelToggle() {
    var toggleBtn = document.querySelector('.collapse');
    if (toggleBtn) toggleBtn.addEventListener('click', toggleWeeklyPanelLowered);
  }

  // --- 상단 경계 드래그 ------------------------------------------------------
  var weeklyResizeDragState = null; // { pointerId, startY, startTop, currentTop, rafScheduled, handle }

  function onWeeklyResizeHandlePointerDown(e) {
    if (state.weeklyPanel.isLowered) return; // 내려간 상태에서는 경계 드래그 비활성화.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    var handle = e.currentTarget;
    weeklyResizeDragState = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startTop: state.weeklyPanel.top || WEEKLY_DEFAULT_TOP,
      currentTop: state.weeklyPanel.top || WEEKLY_DEFAULT_TOP,
      rafScheduled: false,
      handle: handle
    };
    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    handle.addEventListener('pointermove', onWeeklyResizeHandlePointerMove);
    handle.addEventListener('pointerup', onWeeklyResizeHandlePointerUp);
    handle.addEventListener('pointercancel', onWeeklyResizeHandlePointerCancel);
    document.addEventListener('keydown', onWeeklyResizeEscapeKeydown, true);
  }

  function weeklyResizeRafTick() {
    if (!weeklyResizeDragState) return;
    weeklyResizeDragState.rafScheduled = false;
    applyWeeklyPanelPosition(weeklyResizeDragState.currentTop);
  }

  function onWeeklyResizeHandlePointerMove(e) {
    if (!weeklyResizeDragState || e.pointerId !== weeklyResizeDragState.pointerId) return;
    var dy = e.clientY - weeklyResizeDragState.startY;
    var nextTop = weeklyResizeDragState.startTop + dy;
    nextTop = clampWeeklyTop(nextTop);
    weeklyResizeDragState.currentTop = nextTop;
    if (!weeklyResizeDragState.rafScheduled) {
      weeklyResizeDragState.rafScheduled = true;
      requestAnimationFrame(weeklyResizeRafTick);
    }
  }

  function teardownWeeklyResizeListeners(ds) {
    var handle = ds && ds.handle;
    if (!handle) return;
    handle.removeEventListener('pointermove', onWeeklyResizeHandlePointerMove);
    handle.removeEventListener('pointerup', onWeeklyResizeHandlePointerUp);
    handle.removeEventListener('pointercancel', onWeeklyResizeHandlePointerCancel);
    try { handle.releasePointerCapture(ds.pointerId); } catch (err) {}
    document.removeEventListener('keydown', onWeeklyResizeEscapeKeydown, true);
  }

  function onWeeklyResizeHandlePointerUp(e) {
    if (!weeklyResizeDragState || e.pointerId !== weeklyResizeDragState.pointerId) return;
    var ds = weeklyResizeDragState;
    teardownWeeklyResizeListeners(ds);
    state.weeklyPanel.top = ds.currentTop;
    state.weeklyPanel.lastExpandedTop = ds.currentTop;
    weeklyResizeDragState = null;
    saveWeeklyPanelPrefs();
  }

  function onWeeklyResizeHandlePointerCancel(e) {
    if (!weeklyResizeDragState || e.pointerId !== weeklyResizeDragState.pointerId) return;
    var ds = weeklyResizeDragState;
    teardownWeeklyResizeListeners(ds);
    applyWeeklyPanelPosition(ds.startTop);
    state.weeklyPanel.top = ds.startTop;
    weeklyResizeDragState = null;
  }

  function onWeeklyResizeEscapeKeydown(e) {
    if (e.key !== 'Escape' || !weeklyResizeDragState) return;
    e.preventDefault();
    e.stopPropagation();
    var ds = weeklyResizeDragState;
    teardownWeeklyResizeListeners(ds);
    applyWeeklyPanelPosition(ds.startTop);
    state.weeklyPanel.top = ds.startTop;
    weeklyResizeDragState = null;
  }

  function wireWeeklyResizeHandle() {
    var handle = document.querySelector('.weekly-resize-handle');
    if (handle) handle.addEventListener('pointerdown', onWeeklyResizeHandlePointerDown);
  }

  function initWeeklyPanel() {
    var prefs = loadWeeklyPanelPrefs();
    state.weeklyPanel.isLowered = !!(prefs && prefs.isLowered);
    state.weeklyPanel.lastExpandedTop = (prefs && typeof prefs.lastExpandedTop === 'number') ? prefs.lastExpandedTop : WEEKLY_DEFAULT_TOP;
    // top은 내려가 있든 아니든 항상 "펼쳤을 때의" 위치이므로 lastExpandedTop 기준으로만 정한다.
    state.weeklyPanel.top = clampWeeklyTop(state.weeklyPanel.lastExpandedTop);
    applyWeeklyPanelPosition();
    renderWeeklyPanelToggleState();
    wireWeeklyPanelToggle();
    wireWeeklyResizeHandle();
    wireWeeklyPanelResize();
  }

  // ---------------------------------------------------------------------
  // 초기화
  // ---------------------------------------------------------------------
  function init() {
    state.todayDate = formatLocalDate(new Date());

    // 5: <head> 인라인 스크립트가 이미 documentElement에 반영해 둔 테마를 state/버튼에 동기화.
    applyTheme(loadTheme());
    renderThemeToggleState();
    wireThemeToggle();

    var loaded = loadState();
    state.items = loaded.items;
    state.selectedDate = loaded.selectedDate;
    state.calendarViewDate = loaded.calendarViewDate;
    state.weekStartDate = loaded.weekStartDate;
    state.lunarEnabled = loaded.lunarEnabled;

    // 1: 레거시 subtask -> todo 블록 마이그레이션은 앱 로드 시 이 한 번만 실행한다
    // (detailBlocksMigrationVersion으로 이미 처리된 item은 건너뜀 — 새로고침마다 또는
    // 렌더마다 다시 스캔하지 않는다).
    var detailBlocksMigrated = normalizeAllItemsDetailBlocks(state.items);

    if (loaded.isFirstRun) {
      saveItems();
      savePreferences();
    } else {
      // 4: 기존 localStorage의 schedule 중 completionByDate가 없는 항목만 정상화한다.
      // 뭔가 실제로 바뀐 경우에만 저장 — 새로고침마다 불필요하게 다시 쓰지 않는다.
      var migrated = migrateScheduleCompletionMaps(state.items);
      if (migrated || detailBlocksMigrated) saveItems();
    }

    setInputMode(state.inputMode);
    wireModeButtons();
    wireQuickInput();
    wireListDelegation();
    initWeeklyPlusLabels();
    renderCalendarMonthGrid(parseLocalDate(state.calendarViewDate));
    renderCalendarTitle();
    wireCalendarDates();
    wireCalendarNav();
    wireDateFields();
    wireTimeFields();
    wireAllDayToggle();
    wireRolloverControls();
    wireSidebarNav();
    wireTrashFilter();
    wireTrashBulkBar();
    wireEmptyTrashButton();
    renderWeeklyDateHeaders();
    wireWeeklyNav();
    initWeeklyPanel();
    renderApp();
  }

  init();
})();
