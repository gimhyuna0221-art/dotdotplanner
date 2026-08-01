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
  function renderRoutine() {
    var routines=getRoutines();
    var rows=routines.map(function(r){return '<li><span class="dotdot-ext-tag">'+esc(({daily:'매일',weekdays:'특정 요일',weekly:'매주',monthly:'매월'})[r.frequency]||r.frequency)+'</span><span style="flex:1;'+(r.active?'':'opacity:.45')+'">'+esc(r.text)+'</span><label class="dotdot-ext-muted"><input type="checkbox" data-ext="routine-auto" data-id="'+r.id+'" '+(r.autoCreate?'checked':'')+'> 자동 생성</label><button class="dotdot-ext-btn" data-ext="routine-toggle" data-id="'+r.id+'">'+(r.active?'일시정지':'활성화')+'</button><button class="dotdot-ext-btn danger" data-ext="routine-delete" data-id="'+r.id+'">삭제</button></li>';}).join('')||'<li class="dotdot-ext-muted">등록된 루틴이 없습니다.</li>';
    return head('루틴','반복 규칙을 실제 Today 항목으로 생성','자동 생성은 같은 루틴·같은 날짜의 중복을 방지합니다. 생성된 항목은 일반 할 일과 동일하게 이동·완료·삭제할 수 있습니다.')+'<div class="dotdot-ext-card"><h3>새 루틴</h3><div class="dotdot-ext-row"><input class="dotdot-ext-input" id="ext-routine-text" placeholder="반복할 할 일"><select class="dotdot-ext-select" id="ext-routine-frequency"><option value="daily">매일</option><option value="weekdays">특정 요일</option><option value="weekly">매주</option><option value="monthly">매월</option></select><span class="dotdot-ext-routine-days">'+['일','월','화','수','목','금','토'].map(function(d,i){return '<label class="dotdot-ext-day-toggle"><input type="checkbox" name="ext-routine-day" value="'+i+'">'+d+'</label>';}).join('')+'</span><button class="dotdot-ext-btn primary" data-ext="routine-add">추가</button></div></div><div class="dotdot-ext-card"><div class="dotdot-ext-row"><button class="dotdot-ext-btn primary" data-ext="routine-materialize">오늘 해당 루틴 지금 생성</button></div></div><div class="dotdot-ext-card"><h3>루틴 목록</h3><ul class="dotdot-ext-list">'+rows+'</ul></div>';
  }
  var shortcutQuery='';
  var shortcuts=[['Ctrl/⌘','A','현재 목록 전체 선택'],['Ctrl/⌘','C / X / V','복사·잘라내기·붙여넣기'],['Ctrl/⌘','Alt','C / V','연결 인스턴스 복사·붙여넣기'],['Ctrl/⌘','Alt','U','연결 해제'],['Ctrl/⌘','[ / ]','그룹 생성·해제'],['Ctrl/⌘','Z','실행 취소'],['Ctrl/⌘','Shift','Z','다시 실행'],['Ctrl/⌘','Y','다시 실행'],['Shift','클릭','범위 선택'],['Ctrl/⌘','클릭','비연속 선택'],['Delete','','휴지통 이동'],['Escape','','현재 조작 취소'],['Ctrl','휠','Monthly Log 행 높이'],['Shift','휠','Monthly Log 셀 너비']];
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

  function boot(){bootSideViews();materializeDueRoutines(B.formatLocalDate(new Date()),true,true);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
