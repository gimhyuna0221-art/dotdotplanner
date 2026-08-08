/* DotDotPlanner Round D extensions.
 * - Turns the prototype's routine/shortcut/search/stats/settings/profile ideas into local-first views.
 * - The 24-hour Monthly Log mode that used to live here was removed for Monthly Calendar v1.
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
  var activeSideView = null;
  var sideOverlay = null;

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
  // 평일/주말은 새 데이터 구조가 아니라 기존 "특정 요일"(frequency:'weekdays') +
  // days 배열로 정규화되는 UI 프리셋일 뿐이다(요구사항). 요일 집합이 정확히 월~금/
  // 토·일이면 목록에서도 평일/주말로 표시한다(신규 필드 없이 기존 days만으로 판정).
  function routineFrequencyLabel(r){
    if(r.frequency==='weekdays'){
      var days=(r.days||[]).slice().sort(function(a,b){return a-b;}).join(',');
      if(days==='1,2,3,4,5') return '평일';
      if(days==='0,6') return '주말';
      return '특정 요일';
    }
    return ({daily:'매일',weekly:'매주',monthly:'매월'})[r.frequency]||r.frequency;
  }
  function renderRoutine() {
    var routines=getRoutines();
    var rows=routines.map(function(r){return '<li><span class="dotdot-ext-tag">'+esc(routineFrequencyLabel(r))+'</span><span style="flex:1;'+(r.active?'':'opacity:.45')+'">'+esc(r.text)+'</span><label class="dotdot-ext-muted"><input type="checkbox" data-ext="routine-auto" data-id="'+r.id+'" '+(r.autoCreate?'checked':'')+'> 자동 생성</label><button class="dotdot-ext-btn" data-ext="routine-toggle" data-id="'+r.id+'">'+(r.active?'일시정지':'활성화')+'</button><button class="dotdot-ext-btn danger" data-ext="routine-delete" data-id="'+r.id+'">삭제</button></li>';}).join('')||'<li class="dotdot-ext-muted">등록된 루틴이 없습니다.</li>';
    return head('루틴','반복 규칙을 실제 Today 항목으로 생성','자동 생성은 같은 루틴·같은 날짜의 중복을 방지합니다. 생성된 항목은 일반 할 일과 동일하게 이동·완료·삭제할 수 있습니다.')+'<div class="dotdot-ext-card"><h3>새 루틴</h3><div class="dotdot-ext-row"><input class="dotdot-ext-input" id="ext-routine-text" placeholder="반복할 할 일"><select class="dotdot-ext-select" id="ext-routine-frequency"><option value="daily">매일</option><option value="weekdays">특정 요일</option><option value="weekdays-work">평일</option><option value="weekdays-weekend">주말</option><option value="weekly">매주</option><option value="monthly">매월</option></select><span class="dotdot-ext-routine-days" id="ext-routine-days-wrap" hidden>'+['일','월','화','수','목','금','토'].map(function(d,i){return '<label class="dotdot-ext-day-toggle"><input type="checkbox" name="ext-routine-day" value="'+i+'">'+d+'</label>';}).join('')+'</span><button class="dotdot-ext-btn primary" data-ext="routine-add">추가</button></div></div><div class="dotdot-ext-card"><div class="dotdot-ext-row"><button class="dotdot-ext-btn primary" data-ext="routine-materialize">오늘 해당 루틴 지금 생성</button></div></div><div class="dotdot-ext-card"><h3>루틴 목록</h3><ul class="dotdot-ext-list">'+rows+'</ul></div>';
  }
  // ------------------------------------------------------------------
  // 단축키 -- 독립 화면(오버레이)이 아니라 앱 전체 가장 왼쪽에 고정되는 보조 패널.
  // routine/search/stats/settings/account은 기존 sideOverlay 시스템을 그대로 쓰고,
  // 이 패널만 별도 DOM(body의 첫 자식)으로 관리한다.
  // ------------------------------------------------------------------
  var shortcutQuery='';
  var shortcutPanelOpen=false;
  var shortcutPanelEl=null, shortcutPanelBodyEl=null;
  // 전수 감사(재작성): 코드에 실제 등록된 전역 키보드 단축키(app.js handleGlobalKeydown)를
  // 다시 세어 4그룹 17항목으로 갱신했다 -- 이전 12항목 목록에는 F2/Enter(제목 편집 시작),
  // Ctrl/Cmd+N(빠른 입력 포커스), Ctrl/Cmd+Shift+/(이번 달 패널 토글), Ctrl/Cmd+Alt+I(배치
  // 생성)가 통째로 빠져 있었고, Ctrl/Cmd+[·]는 서로 다른 두 명령인데 한 줄로 묶여 있었다.
  // exec가 있는 항목은 "실행" 버튼이 app.js의 실제 명령 함수를 호출한다(로직 복제 없음,
  // 대부분 dispatchShortcutCommand로 handleGlobalKeydown 자체를 합성 이벤트로 통과시켜
  // 키보드 입력과 완전히 같은 코드 경로를 탄다). exec가 없는 항목(Shift/Ctrl+클릭처럼
  // 포인터 동작 자체가 필요한 것)만 "직접 조작"으로 표시한다.
  // 요구사항: 단축키 패널은 읽기 전용 치트시트다 -- "실행" 버튼/활성·비활성 판정을
  // 전부 없앴다. 아래 목록(키 조합·설명·그룹별 개수)은 실제 handleGlobalKeydown에
  // 등록된 21개 단축키와 일치를 맞추기 위한 registry로만 남긴다(감사 시 이 배열과
  // app.js를 나란히 비교한다).
  var SHORTCUT_GROUPS=[
    {id:'select',label:'선택',accent:'sat',items:[
      {keys:['Ctrl/⌘','A'],desc:'현재 목록 전체 선택'},
      {keys:['Shift','클릭'],desc:'범위 선택'},
      {keys:['Ctrl/⌘','클릭'],desc:'비연속 선택'}
    ]},
    {id:'input',label:'입력·이동',accent:'mint',items:[
      {keys:['F2'],desc:'선택 항목 제목 편집 시작'},
      {keys:['Enter'],desc:'선택 항목 제목 편집 시작'},
      {keys:['Ctrl/⌘','N'],desc:'Today 빠른 입력에 포커스'},
      {keys:['Ctrl/⌘','Shift','/'],desc:'이번 달 할 일 패널 토글'}
    ]},
    {id:'clip',label:'복사·그룹',accent:'lav',items:[
      {keys:['Ctrl/⌘','C'],desc:'복사'},
      {keys:['Ctrl/⌘','X'],desc:'잘라내기'},
      {keys:['Ctrl/⌘','V'],desc:'붙여넣기'},
      {keys:['Ctrl/⌘','Alt','C'],desc:'연결 인스턴스 복사'},
      {keys:['Ctrl/⌘','Alt','V'],desc:'연결 인스턴스 붙여넣기'},
      {keys:['Ctrl/⌘','Alt','U'],desc:'연결 해제'},
      {keys:['Ctrl/⌘','['],desc:'그룹 생성'},
      {keys:['Ctrl/⌘',']'],desc:'그룹 해제'},
      {keys:['Ctrl/⌘','Alt','I'],desc:'선택한 이달의 할 일을 오늘 날짜에 배치'}
    ]},
    {id:'edit',label:'편집·되돌리기',accent:'sun',items:[
      {keys:['Ctrl/⌘','Z'],desc:'실행 취소'},
      {keys:['Ctrl/⌘','Shift','Z'],desc:'다시 실행'},
      {keys:['Ctrl/⌘','Y'],desc:'다시 실행'},
      {keys:['Delete'],desc:'휴지통 이동 / 영구 삭제'},
      {keys:['Escape'],desc:'현재 조작 취소'}
    ]}
  ];
  function buildShortcutRow(entry){
    var keysHtml=entry.keys.map(function(k,i){
      return (i?'<span class="shortcut-kbd-plus" aria-hidden="true">+</span>':'')+'<span class="shortcut-kbd">'+esc(k)+'</span>';
    }).join('');
    // 실행 버튼이 없으니 키 행이 가로 폭을 그대로 다 쓰고, 설명은 그 아래 자기 줄에서
    // 전체 폭을 자연스럽게 쓴다(요구사항).
    return '<li class="shortcut-row">'
      +'<div class="shortcut-row-top"><span class="shortcut-keys">'+keysHtml+'</span></div>'
      +'<p class="shortcut-desc">'+esc(entry.desc)+'</p>'
      +'</li>';
  }
  function renderShortcutPanelBody(){
    if(!shortcutPanelBodyEl) return;
    var q=shortcutQuery.trim().toLowerCase();
    var shown=0;
    var groupsHtml=SHORTCUT_GROUPS.map(function(g){
      var items=g.items.filter(function(s){return !q||(s.keys.join(' ')+' '+s.desc).toLowerCase().indexOf(q)>=0;});
      if(!items.length) return '';
      shown+=items.length;
      return '<section class="shortcut-group" data-accent="'+g.accent+'">'
        +'<h3 class="shortcut-group-label"><span class="shortcut-group-tab" aria-hidden="true"></span>'+esc(g.label)+'<span class="shortcut-group-count">'+items.length+'</span></h3>'
        +'<ul class="shortcut-rows">'+items.map(buildShortcutRow).join('')+'</ul>'
        +'</section>';
    }).join('');
    if(!groupsHtml) groupsHtml='<p class="shortcut-empty">일치하는 단축키가 없습니다. 다른 검색어를 입력해 보세요.</p>';
    shortcutPanelBodyEl.innerHTML=
      '<div class="shortcut-search"><span class="shortcut-search-icon" aria-hidden="true"></span><input class="shortcut-search-input" id="ext-shortcut-query" type="text" autocomplete="off" value="'+esc(shortcutQuery)+'" placeholder="단축키 검색" aria-label="단축키 검색"></div>'
      +'<p class="shortcut-count">'+shown+'개 단축키</p>'
      +groupsHtml
      +'<div class="dotdot-ext-note shortcut-panel-note">입력창이나 설명 편집 중에는 브라우저의 기본 텍스트 단축키가 우선합니다.</div>';
  }
  // .artboard는 app.js의 우측 패널 도킹 계산(placeSideOverlay/applyMonthlyPanelDom/
  // applyMonthlyLogInboxDockDom 등)이 getBoundingClientRect()로 그대로 재는 대상이라
  // 그 요소 자체의 클래스·CSS·자식 구성은 절대 바꾸지 않는다. 대신 .artboard를 새
  // .app-row 래퍼로 한 번 감싸고, 패널을 그 래퍼의 첫 자식(=.artboard 앞)으로 넣는다 --
  // .artboard가 측정하는 자기 자신의 크기·위치는 그대로이므로 Today/Monthly 우측 패널
  // 로직에는 영향이 없다.
  function ensureAppRow(){
    var artboard=document.querySelector('.artboard');
    if(!artboard) return null;
    var row=artboard.parentElement;
    if(row && row.classList.contains('app-row')) return row;
    row=document.createElement('div');
    row.className='app-row';
    artboard.parentNode.insertBefore(row, artboard);
    row.appendChild(artboard);
    return row;
  }
  function buildShortcutPanel(){
    if(shortcutPanelEl) return;
    var row=ensureAppRow();
    if(!row) return;
    shortcutPanelEl=document.createElement('aside');
    shortcutPanelEl.className='shortcut-panel';
    shortcutPanelEl.id='shortcut-panel';
    shortcutPanelEl.hidden=true;
    shortcutPanelEl.setAttribute('aria-label','단축키');
    shortcutPanelEl.innerHTML=
      '<div class="shortcut-panel-header">'
        +'<div class="shortcut-panel-title-row"><h2 class="shortcut-panel-title">단축키</h2>'
        +'<button type="button" class="shortcut-panel-close" id="shortcut-panel-close" aria-label="단축키 패널 닫기">×</button></div>'
        +'<p class="shortcut-panel-sub">현재 앱 조작 문법을 한곳에서 확인</p>'
      +'</div>'
      +'<div class="shortcut-panel-body" id="shortcut-panel-body"></div>';
    // .app-row의 첫 자식(=.artboard 바로 앞 열)으로 삽입한다.
    row.insertBefore(shortcutPanelEl, row.firstChild);
    shortcutPanelBodyEl=shortcutPanelEl.querySelector('#shortcut-panel-body');
    shortcutPanelEl.querySelector('#shortcut-panel-close').addEventListener('click', closeShortcutPanel);
    shortcutPanelEl.addEventListener('input', function(e){
      if(e.target.id!=='ext-shortcut-query') return;
      shortcutQuery=e.target.value;
      renderShortcutPanelBody();
      focusBack('ext-shortcut-query', shortcutQuery);
    });
  }
  function onShortcutPanelDocumentKeydown(e){
    if(e.key!=='Escape' || !shortcutPanelOpen) return;
    e.preventDefault();
    e.stopPropagation();
    closeShortcutPanel();
  }
  function openShortcutPanel(){
    if(shortcutPanelOpen) return;
    buildShortcutPanel();
    // 다른 보조 화면(검색/루틴/통계/설정)을 닫지 않는다 -- 요구사항: 현재 화면 상태를
    // 그대로 보존한다. 데스크톱에서는 패널이 열리며 .app-row 폭이 늘어나 .artboard가
    // 오른쪽으로 밀리므로, 열려 있는 sideOverlay가 있다면 새 위치로 다시 맞춘다(닫지
    // 않고 재배치만 한다 -- placeSideOverlay는 이미 열려 있는 화면의 스크롤·입력값·
    // DOM을 전혀 건드리지 않고 좌표만 다시 잰다).
    shortcutPanelOpen=true;
    shortcutPanelEl.hidden=false;
    document.body.classList.add('shortcut-panel-open');
    var btn=document.querySelector('.side-item.shortcut');
    if(btn){ btn.classList.add('active'); btn.setAttribute('aria-expanded','true'); }
    if(activeSideView) placeSideOverlay();
    renderShortcutPanelBody();
    document.addEventListener('keydown', onShortcutPanelDocumentKeydown, true);
    var input=document.getElementById('ext-shortcut-query');
    if(input) input.focus();
  }
  function closeShortcutPanel(){
    if(!shortcutPanelOpen) return;
    shortcutPanelOpen=false;
    if(shortcutPanelEl) shortcutPanelEl.hidden=true;
    document.body.classList.remove('shortcut-panel-open');
    var btn=document.querySelector('.side-item.shortcut');
    if(btn){ btn.classList.remove('active'); btn.setAttribute('aria-expanded','false'); }
    // 패널이 닫히며 .app-row 폭이 원래대로 줄어드는 경우도 마찬가지로 다시 맞춘다.
    if(activeSideView) placeSideOverlay();
    document.removeEventListener('keydown', onShortcutPanelDocumentKeydown, true);
  }
  function toggleShortcutPanel(){
    if(shortcutPanelOpen) closeShortcutPanel(); else openShortcutPanel();
  }
  var searchState={q:'',type:'all',done:'all',from:'',to:''};
  // 검색 결과 행 -- Today가 실제로 쓰는 유형 기호(B.iconForType)·프로젝트 점
  // (B.buildProjectDot)·커스텀 툴팁(B.applyInlineTooltip)을 그대로 재사용해 다른
  // 화면과 같은 문법으로 보이게 한다(요구사항: schedule/task/divider 영어 pill 제거).
  // 정보 위계: 날짜 -> 유형 기호 -> 프로젝트 점/그룹선 -> 제목 -> 실행 버튼.
  function buildSearchRows(results){
    if(!results.length) return '<li class="dotdot-ext-muted">검색 결과가 없습니다.</li>';
    var typeLabels={task:'할 일',schedule:'일정',memo:'메모',divider:'구분선'};
    var ul=document.createElement('ul');
    results.slice(0,150).forEach(function(it){
      var li=document.createElement('li');
      li.className='search-row';
      var groupId=B.getItemGroupIdAt(it,'weekly',it.date);
      var group=groupId?B.findGroupById(groupId):null;
      var dot=B.buildProjectDot(it,'is-lg',group?group.name:null);
      if(group){
        var bar=document.createElement('span');
        bar.className='search-group-bar';
        bar.style.setProperty('--group-accent',group.color||'var(--lav)');
        // 프로젝트 점이 있으면 그 점의 툴팁에 그룹명이 이미 함께 담기므로(위 buildProjectDot),
        // 막대 자체는 순수 시각 표시만 하고 별도 툴팁 트리거를 중복으로 만들지 않는다.
        if(!dot) B.applyInlineTooltip(bar, group.name, '그룹: '+group.name);
        li.appendChild(bar);
      }
      var dateEl=document.createElement('span');
      dateEl.className='search-date';
      dateEl.textContent=it.date||'';
      li.appendChild(dateEl);
      var iconWrap=document.createElement('span');
      iconWrap.className='search-type-icon';
      iconWrap.appendChild(B.iconForType(it));
      B.applyInlineTooltip(iconWrap, typeLabels[it.type]||it.type);
      li.appendChild(iconWrap);
      if(dot) li.appendChild(dot);
      var titleEl=document.createElement('span');
      titleEl.className='search-title'+(it.completed?' is-done':'');
      titleEl.textContent=it.text||'';
      li.appendChild(titleEl);
      if(/^\d{4}-\d{2}-\d{2}$/.test(it.date||'')){
        var btn=document.createElement('button');
        btn.className='dotdot-ext-btn';
        btn.setAttribute('data-ext','search-open');
        btn.setAttribute('data-date', it.date);
        btn.setAttribute('data-item-id', it.id);
        btn.textContent='Today에서 열기';
        li.appendChild(btn);
      }
      ul.appendChild(li);
    });
    return ul.innerHTML;
  }
  function renderSearch(){var q=searchState.q.trim().toLowerCase();var projects={};S.projects.forEach(function(p){projects[p.id]=p.name;});var results=getAliveItems().filter(function(it){var hay=(it.text+' '+(it.description||'')+' '+(projects[it.projectId]||'')).toLowerCase();return(!q||hay.indexOf(q)>=0)&&(searchState.type==='all'||it.type===searchState.type)&&(searchState.done==='all'||(searchState.done==='done')===!!it.completed)&&(!searchState.from||it.date>=searchState.from)&&(!searchState.to||it.date<=searchState.to);})
    // 렌더 직전 실제 존재 여부를 다시 확인한다: 완전 삭제된 항목이나 오래된 참조는
    // getAliveItems()의 스냅샷에 남아 있더라도 여기서 걸러 절대 표시하지 않는다.
    .filter(function(it){var found=B.findItemById(it.id);return !!found&&!found.deletedAt;})
    .sort(function(a,b){return a.date<b.date?1:-1;});var rows=buildSearchRows(results);return head('검색','제목·설명·프로젝트 검색과 필터','검색 결과는 원본 항목을 가리키며 복사본을 만들지 않습니다.')+'<div class="dotdot-ext-card"><div class="dotdot-ext-row"><input class="dotdot-ext-input" id="ext-search-q" value="'+esc(searchState.q)+'" placeholder="검색어"><select class="dotdot-ext-select" id="ext-search-type"><option value="all">모든 유형</option><option value="task">할 일</option><option value="schedule">일정</option><option value="memo">메모</option></select><select class="dotdot-ext-select" id="ext-search-done"><option value="all">전체</option><option value="open">미완료</option><option value="done">완료</option></select><input class="dotdot-ext-input" style="min-width:auto" type="date" id="ext-search-from" value="'+searchState.from+'"><span>~</span><input class="dotdot-ext-input" style="min-width:auto" type="date" id="ext-search-to" value="'+searchState.to+'"></div><p class="dotdot-ext-muted">'+results.length+'건</p><ul class="dotdot-ext-list">'+rows+'</ul></div>';}
  // 검색 결과의 "Today에서 열기" -- 예전에는 localStorage에 날짜만 써넣고 새로고침해
  // 날짜만 맞을 뿐 대상이 어디 있는지 못 찾는 문제가 있었다. itemId 기준으로 실제 상태를
  // 옮기고(새로고침 없음), 그룹/완료숨김 때문에 가려졌으면 이번만 펼치고, 렌더 후 DOM을
  // itemId로 다시 찾아 가운데로 스크롤 + 맥박 강조한다.
  function cssIdSelector(id){
    return (window.CSS && CSS.escape) ? CSS.escape(String(id)) : String(id).replace(/([^\w-])/g,'\\$1');
  }
  function prefersReducedMotion(){
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function flashSearchTarget(itemId){
    var el=document.querySelector('[data-item-id="'+cssIdSelector(itemId)+'"]');
    if(!el){
      // 그룹 펼침 등 방금 반영된 렌더가 다음 프레임에야 자리잡는 경우를 한 번 더 시도한다.
      requestAnimationFrame(function(){
        var retry=document.querySelector('[data-item-id="'+cssIdSelector(itemId)+'"]');
        if(retry) flashSearchTarget.__apply(retry);
      });
      return;
    }
    flashSearchTarget.__apply(el);
  }
  flashSearchTarget.__apply=function(el){
    el.scrollIntoView({block:'center', inline:'nearest', behavior: prefersReducedMotion()?'auto':'smooth'});
    var reduced=prefersReducedMotion();
    el.classList.add(reduced?'search-jump-highlight-static':'search-jump-highlight');
    setTimeout(function(){
      el.classList.remove('search-jump-highlight');
      el.classList.remove('search-jump-highlight-static');
    }, reduced?2000:1700);
  };
  function openInToday(itemId,date){
    if(!date) return;
    var it=B.findItemById(itemId);
    if(!it||it.deletedAt) return; // 실제로 존재하지 않는 삭제 항목은 열지 않는다(요구사항).
    closeSideView();
    S.selectedDate=date;
    S.calendarViewDate=date.slice(0,7)+'-01';
    S.selectedDateRange=null;
    // 대상이 그룹 안에 있으면 자동으로 펼친다.
    var groupId=B.getItemGroupIdAt(it,'weekly',date);
    if(groupId){ var g=B.findGroupById(groupId); if(g && g.collapsed) g.collapsed=false; }
    // 완료 숨김 필터에 가려졌다면 찾는 순간에는 보이게 한다(Today/Daily 전용 플래그).
    if(it.completed && S.dailyHideCompleted) S.dailyHideCompleted=false;
    B.savePreferences();
    B.setView('today');
    B.renderApp();
    requestAnimationFrame(function(){ flashSearchTarget(itemId); });
  }
  function renderStats(){var items=getAliveItems();var today=B.formatLocalDate(new Date());function period(n){var from=B.addCalendarDays(today,-(n-1));var list=items.filter(function(it){return it.date>=from&&it.date<=today;});var done=list.filter(function(it){return it.completed;}).length;return{total:list.length,done:done,rate:list.length?Math.round(done/list.length*100):0};}var w7=period(7),w30=period(30),moved=items.filter(function(it){return it.migratedFrom||(it.originalDate&&it.originalDate!==it.date);}).length;function stat(label,value,sub){return '<div class="dotdot-ext-stat"><b>'+value+'</b><span>'+label+(sub?' · '+sub:'')+'</span></div>';}return head('통계','완료·이월·유형 분포를 현재 로컬 데이터에서 계산','삭제되지 않은 항목만 집계하며 성과 압박용 스트릭은 만들지 않습니다.')+'<div class="dotdot-ext-card"><h3>최근 7일</h3>'+stat('완료',w7.done,'전체 '+w7.total)+stat('완료율',w7.rate+'%')+'<div class="dotdot-ext-bar"><i style="width:'+w7.rate+'%"></i></div></div><div class="dotdot-ext-card"><h3>최근 30일</h3>'+stat('완료',w30.done,'전체 '+w30.total)+stat('완료율',w30.rate+'%')+'<div class="dotdot-ext-bar"><i style="width:'+w30.rate+'%"></i></div></div><div class="dotdot-ext-card"><h3>계획 변경</h3>'+stat('이월·이동 흔적',moved+'건')+'</div>';
  }
  function fullBackupPayload(){var storage={};for(var i=0;i<localStorage.length;i++){var key=localStorage.key(i);if(key&&key.indexOf(P)===0)storage[key]=localStorage.getItem(key);}return{format:'dotdotplanner-full-backup-v1',exportedAt:new Date().toISOString(),storage:storage};}
  function downloadJson(payload,name){var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);}
  // 7차 감사(데이터 관리 UX 정리): 기존에는 "앱 JSON 내보내기"(exportAllDataAsJson --
  // items/monthlyItems/groups/projects만, 설정 없음, data.storage 형식이 아니라
  // "백업 가져오기·교체"로 되돌릴 수도 없는 별도 형식)와 "첨부 외 전체 설정 백업"
  // (fullBackupPayload -- 이 접두사의 모든 localStorage 키를 그대로 담아 실제로
  // "가져오기"와 짝이 맞는 유일한 복원 가능 형식)이 따로 있었다. 실제로 복원 가능한
  // 쪽은 fullBackupPayload 하나뿐이라 그것만 "백업 파일 만들기"로 남기고, 복원되지도
  // 않으면서 데이터 일부만 담는 앱 JSON 내보내기는 중복 버튼으로 판단해 제거한다
  // (요구사항: 실제 차이 없는데 중복 유지 금지 -- 여기서는 "복원 가능한 형식이
  // 하나뿐"이라는 실제 차이가 있으므로, 더 완전하고 실제로 쓰이는 쪽만 남긴다).
  // 최종 감사: 단일 "기본 빠른 입력 유형"을 오늘/달력/퓨처로그 3개로 분리한다(요구사항).
  // 현재값은 localStorage가 아니라 B.state(app.js와 실시간 공유되는 참조)에서 읽어
  // 항상 실제 적용 중인 값을 보여준다. 변경은 B.setScreenDefaultInputMode로 위임 --
  // 그쪽이 상태 갱신+저장+새로고침 없는 즉시 반영을 전부 처리하므로 여기서는
  // location.reload()를 부르지 않는다(요구사항).
  function inputModeSelectOptions(current){
    return ['task','schedule','memo'].map(function(v){
      var label=v==='task'?'할 일':(v==='schedule'?'일정':'메모');
      return '<option value="'+v+'" '+(current===v?'selected':'')+'>'+label+'</option>';
    }).join('');
  }
  function inputModeField(id,label,current){
    return '<div class="dotdot-ext-field"><span>'+esc(label)+'</span><select class="dotdot-ext-select" id="'+id+'">'+inputModeSelectOptions(current)+'</select></div>';
  }
  function weekStartField(current){
    var value=Number(current)===1?'1':'0';
    return '<div class="dotdot-ext-field"><span>주 시작 요일</span><select class="dotdot-ext-select" id="ext-week-start"><option value="0" '+(value==='0'?'selected':'')+'>일요일 시작</option><option value="1" '+(value==='1'?'selected':'')+'>월요일 시작</option></select></div>';
  }
  function lunarField(enabled){
    return '<div class="dotdot-ext-field"><span>음력 표시</span><label><input type="checkbox" id="ext-lunar-enabled" '+(enabled?'checked':'')+'> 사용</label></div>';
  }
  function renderSettings(){
    var todayMode=S.todayDefaultInputMode||'task',
        calendarMode=S.calendarDefaultInputMode||'schedule',
        futureLogMode=S.futureLogDefaultInputMode||'schedule',
        weekStartsOn=Number(S.calendarWeekStartsOn)===1?1:0,
        lunarEnabled=!!S.lunarEnabled,
        auto=localStorage.getItem(P+'autoRolloverEnabled')!=='false';
    return head('설정','실제 앱에 연결되는 로컬 설정과 데이터 관리','복원 전 현재 정보는 타임스탬프 백업 키로 한 번 더 보존합니다.')
      +'<div class="dotdot-ext-card"><h3>표시·입력</h3>'
      +weekStartField(weekStartsOn)
      +lunarField(lunarEnabled)
      +inputModeField('ext-default-type-today','오늘 기본 빠른 입력 유형',todayMode)
      +inputModeField('ext-default-type-calendar','달력 기본 빠른 입력 유형',calendarMode)
      +inputModeField('ext-default-type-futurelog','퓨처로그 기본 빠른 입력 유형',futureLogMode)
      +'<div class="dotdot-ext-field"><span>과거 미완료 자동 이월</span><label><input type="checkbox" id="ext-auto-rollover" '+(auto?'checked':'')+'> 사용</label></div></div><div class="dotdot-ext-card"><h3>데이터 관리</h3><div class="dotdot-ext-row"><button class="dotdot-ext-btn" data-ext="export-full">백업 파일 만들기</button><button class="dotdot-ext-btn" data-ext="import-full">백업에서 복원</button><button class="dotdot-ext-btn danger" data-ext="reset-all">모든 정보 초기화</button></div><p class="dotdot-ext-muted"><b>백업 파일 만들기</b> — 할 일, 일정, 메모, 완료 기록, 휴지통과 화면·입력 설정을 파일로 저장합니다. 첨부 파일은 포함되지 않습니다.</p><p class="dotdot-ext-muted"><b>백업에서 복원</b> — 현재 항목과 설정을 백업 파일의 내용으로 교체합니다. 첨부 파일은 변경되지 않습니다.</p><p class="dotdot-ext-muted"><b>모든 정보 초기화</b> — 할 일·일정·메모, 완료 기록, 휴지통, 첨부 파일, 화면·입력 설정을 전부 삭제합니다. 되돌릴 수 없습니다.</p></div>';
  }
  function getProfile(){var p=readJSON(P+'localProfile',null);return p&&p.name?p:null;}
  function initials(name){var n=String(name||'').trim();return !n?'＋':(/[가-힣]/.test(n)?n.slice(-2):n.slice(0,2).toUpperCase());}
  // 요구사항: 브라우저 기본 title 툴팁 대신 앱 공용 커스텀 툴팁(app.js의
  // data-tooltip-text/wireInlineTooltips)을 그대로 재사용한다 -- 이 엘리먼트는 이미
  // role="button"/tabIndex가 별도로 설정돼 있어(bootSideViews) role="img"를 강제하는
  // applyInlineTooltip 대신 data-tooltip-text 속성만 직접 채운다.
  function paintProfile(){var el=document.querySelector('.profile');if(!el)return;var p=getProfile();el.textContent=initials(p&&p.name);el.classList.toggle('dotdot-profile-empty',!p);el.dataset.tooltipText=p?p.name+' · 로컬 프로필':'로컬 프로필 설정';}
  function renderAccount(){var p=getProfile();return head('로컬 프로필','계정·서버 없이 이 브라우저에만 저장','동기화나 인증 기능이 아닙니다. 사이드바에 표시할 이름만 저장합니다.')+'<div class="dotdot-ext-card" style="max-width:430px">'+(p?'<div class="dotdot-ext-row"><span class="dotdot-ext-avatar">'+esc(initials(p.name))+'</span><strong>'+esc(p.name)+'</strong></div>':'')+'<div class="dotdot-ext-row"><input class="dotdot-ext-input" id="ext-profile-name" value="'+esc(p?p.name:'')+'" placeholder="표시 이름"><button class="dotdot-ext-btn primary" data-ext="profile-save">저장</button>'+(p?'<button class="dotdot-ext-btn danger" data-ext="profile-clear">지우기</button>':'')+'</div></div>';}
  var sideRenderers={routine:renderRoutine,search:renderSearch,stats:renderStats,settings:renderSettings,account:renderAccount};
  function renderSideView(){if(activeSideView&&sideRenderers[activeSideView])sideOverlay.innerHTML=sideRenderers[activeSideView]();}
  function focusBack(id,value){var el=document.getElementById(id);if(!el)return;el.value=value;el.focus();try{el.setSelectionRange(value.length,value.length);}catch(e){}}
  function deleteAttachmentDatabase() {
    if (!window.indexedDB || !B.constants.ATTACHMENT_DB_NAME) return Promise.resolve();
    var closePromise = B.closeAttachmentDb ? B.closeAttachmentDb() : Promise.resolve();
    return Promise.resolve(closePromise).then(function () {
      return new Promise(function (resolve, reject) {
        var settled = false;
        var request;
        try { request = indexedDB.deleteDatabase(B.constants.ATTACHMENT_DB_NAME); }
        catch (err) { reject(err); return; }
        request.onsuccess = function () { if (!settled) { settled = true; resolve(); } };
        request.onerror = function () { if (!settled) { settled = true; reject(request.error || new Error('첨부 파일 저장소 삭제 실패')); } };
        request.onblocked = function () { if (!settled) { settled = true; reject(new Error('첨부 파일 저장소가 다른 창에서 사용 중입니다. 다른 DotDotPlanner 창을 닫고 다시 시도하세요.')); } };
      });
    });
  }

  function wireSideEvents(){
    sideOverlay.addEventListener('click',function(e){var el=e.target.closest('[data-ext]');if(!el)return;var action=el.dataset.ext;
      if(action==='routine-add'){
        var text=(document.getElementById('ext-routine-text').value||'').trim();
        if(!text)return;
        var freqRaw=document.getElementById('ext-routine-frequency').value;
        var frequency=freqRaw, days;
        // 평일/주말은 새 데이터 구조가 아니라 기존 "특정 요일" + days로 정규화된다(요구사항).
        if(freqRaw==='weekdays-work'){ frequency='weekdays'; days=[1,2,3,4,5]; }
        else if(freqRaw==='weekdays-weekend'){ frequency='weekdays'; days=[0,6]; }
        else { days=Array.prototype.slice.call(document.querySelectorAll('[name="ext-routine-day"]:checked')).map(function(x){return Number(x.value);}); }
        var routines=getRoutines();
        routines.push({id:'routine_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),text:text,type:'task',frequency:frequency,days:days.length?days:[1],dayOfMonth:new Date().getDate(),active:true,autoCreate:true,createdAt:Date.now()});
        saveRoutines(routines);renderSideView();return;
      }
      if(action==='routine-toggle'||action==='routine-delete'){var rs=getRoutines(),id=el.dataset.id;if(action==='routine-delete')rs=rs.filter(function(r){return r.id!==id;});else rs.forEach(function(r){if(r.id===id)r.active=!r.active;});saveRoutines(rs);renderSideView();return;}
      if(action==='routine-materialize'){materializeDueRoutines(B.formatLocalDate(new Date()),true,false);return;}
      if(action==='search-open'){openInToday(el.dataset.itemId, el.dataset.date);return;}
      if(action==='export-full'){downloadJson(fullBackupPayload(),'dotdotplanner-full-backup-'+B.formatLocalDate(new Date())+'.json');return;}
      if(action==='import-full'){var input=document.createElement('input');input.type='file';input.accept='application/json';input.onchange=function(){var file=input.files&&input.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(){try{var data=JSON.parse(reader.result);if(!data||data.format!=='dotdotplanner-full-backup-v1'||!data.storage)throw new Error('지원하지 않는 형식');if(!confirm('현재 로컬 데이터를 백업한 뒤 가져온 데이터로 교체할까요?'))return;var backup=fullBackupPayload();localStorage.setItem(P+'import_backup_'+Date.now(),JSON.stringify(backup));storageKeys().filter(function(k){return k.indexOf(P)===0&&!k.startsWith(P+'import_backup_');}).forEach(function(k){localStorage.removeItem(k);});Object.keys(data.storage).forEach(function(k){if(k.indexOf(P)===0)localStorage.setItem(k,data.storage[k]);});location.reload();}catch(err){alert('가져오기에 실패했습니다: '+err.message);}};reader.readAsText(file);};input.click();return;}
      if(action==='reset-all'){
        if(el.disabled)return;
        if(!confirm('모든 정보를 초기화할까요?\n\n할 일·일정·메모, 완료 기록, 휴지통, 첨부 파일, 화면·입력 설정을 전부 삭제합니다.\n이 작업은 되돌릴 수 없습니다.'))return;
        el.disabled=true;
        deleteAttachmentDatabase().then(function(){
          storageKeys().filter(function(k){return k.indexOf(P)===0;}).forEach(function(k){localStorage.removeItem(k);});
          location.reload();
        }).catch(function(err){
          el.disabled=false;
          alert('모든 정보 초기화에 실패했습니다: '+(err&&err.message?err.message:String(err)));
        });
        return;
      }
      if(action==='profile-save'){var name=(document.getElementById('ext-profile-name').value||'').trim();if(!name)return;writeJSON(P+'localProfile',{name:name,updatedAt:new Date().toISOString()},'preferences');paintProfile();renderSideView();return;}
      if(action==='profile-clear'){localStorage.removeItem(P+'localProfile');paintProfile();renderSideView();return;}
    });
    sideOverlay.addEventListener('input',function(e){if(e.target.id==='ext-search-q'){searchState.q=e.target.value;var q=searchState.q;renderSideView();focusBack('ext-search-q',q);}});
    sideOverlay.addEventListener('change',function(e){var id=e.target.id;
      if(id==='ext-routine-frequency'){
        // 평일/주말/매일/매월은 프리셋이라 개별 요일 체크박스를 숨긴다(요구사항: 숨기거나
        // 읽기전용). '특정 요일'·'매주'로 바꾸면 다시 보여 직접 선택할 수 있다.
        var v=e.target.value;
        var wrap=document.getElementById('ext-routine-days-wrap');
        if(wrap) wrap.hidden=(v==='daily'||v==='monthly'||v==='weekdays-work'||v==='weekdays-weekend');
      }
      if(id==='ext-search-type'){searchState.type=e.target.value;renderSideView();}
      if(id==='ext-search-done'){searchState.done=e.target.value;renderSideView();}
      if(id==='ext-search-from'){searchState.from=e.target.value;renderSideView();}
      if(id==='ext-search-to'){searchState.to=e.target.value;renderSideView();}
      if(id==='ext-theme'){if(safeSetRaw(P+'theme',e.target.value,'preferences'))document.documentElement.dataset.theme=e.target.value;}
      if(id==='ext-week-days'){if(safeSetRaw(P+'weeklyVisibleDays',e.target.value,'preferences'))location.reload();}
      if(id==='ext-week-start'){
        if(B.setCalendarWeekStartsOn) B.setCalendarWeekStartsOn(Number(e.target.value));
        else if(safeSetRaw(P+'calendarWeekStartsOn',e.target.value,'preferences')) location.reload();
      }
      if(id==='ext-lunar-enabled'){
        if(B.setLunarEnabled) B.setLunarEnabled(!!e.target.checked);
        else if(safeSetRaw(P+'lunarEnabled',String(!!e.target.checked),'preferences')) location.reload();
      }
      // 최종 감사: 화면별 기본 빠른 입력 유형 -- B.setScreenDefaultInputMode가 상태
      // 갱신·저장·(그 화면이 열려 있으면) 즉시 반영을 전부 처리하므로 여기서는
      // location.reload()를 부르지 않는다(요구사항: reload 없이 즉시 반영).
      if(id==='ext-default-type-today'&&B.setScreenDefaultInputMode){B.setScreenDefaultInputMode('today',e.target.value);}
      if(id==='ext-default-type-calendar'&&B.setScreenDefaultInputMode){B.setScreenDefaultInputMode('calendar',e.target.value);}
      if(id==='ext-default-type-futurelog'&&B.setScreenDefaultInputMode){B.setScreenDefaultInputMode('futureLog',e.target.value);}
      if(id==='ext-auto-rollover'){if(safeSetRaw(P+'autoRolloverEnabled',String(e.target.checked),'preferences'))location.reload();}
      if(e.target.dataset.ext==='routine-auto'){var routines=getRoutines(),rid=e.target.dataset.id;routines.forEach(function(r){if(r.id===rid)r.autoCreate=e.target.checked;});saveRoutines(routines);}
    });
  }
  function bootSideViews(){sideOverlay=document.createElement('div');sideOverlay.className='dotdot-ext-overlay';sideOverlay.id='dotdot-ext-overlay';document.body.appendChild(sideOverlay);wireSideEvents();['routine','search','stats','settings'].forEach(function(view){var el=document.querySelector('.side-item.'+view);if(!el)return;el.setAttribute('role','button');el.tabIndex=0;el.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openSideView(view);},true);el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();openSideView(view);}});});['today','calendar','future-log','trash'].forEach(function(view){var el=document.querySelector('.side-item.'+view);if(!el)return;el.addEventListener('click',closeSideView,true);el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){closeSideView();}});});var profile=document.querySelector('.profile');paintProfile();if(profile){profile.setAttribute('role','button');profile.tabIndex=0;profile.addEventListener('click',function(){openSideView('account');});profile.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();openSideView('account');}});}window.addEventListener('resize',function(){if(activeSideView)placeSideOverlay();});
    // 단축키는 sideOverlay 시스템 밖에서 독립적으로 뜨는 왼쪽 패널이라 여기서 따로 만든다.
    buildShortcutPanel();
    var shortcutBtn=document.querySelector('.side-item.shortcut');
    if(shortcutBtn){
      shortcutBtn.setAttribute('role','button');
      shortcutBtn.setAttribute('aria-expanded','false');
      shortcutBtn.tabIndex=0;
      shortcutBtn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();toggleShortcutPanel();});
      shortcutBtn.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleShortcutPanel();}});
    }
  }

  function boot(){bootSideViews();materializeDueRoutines(B.formatLocalDate(new Date()),true,true);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
