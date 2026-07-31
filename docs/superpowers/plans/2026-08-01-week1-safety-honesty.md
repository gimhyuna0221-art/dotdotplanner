# 1주차 안전과 정직 (D1–D5) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/DECISIONS_REVIEW.md`의 1주차 판정(D1–D5)을 구현해, 되돌릴 수 없는 데이터 누적·유실 경로를 막고 화면이 거짓 수치·거짓 문구를 말하지 않게 한다.

**Architecture:** 기존 바닐라 정적 SPA 구조를 그대로 유지한다. `app.js`는 단일 IIFE이고 `dotdot-extensions.js`는 `window.DotDotPlannerBridge`를 통해서만 앱에 접근한다. D1·D2·D3·D5는 확장 파일 안에서 끝나고, D4만 `app.js`의 조회 함수 한 개와 렌더 함수 한 개를 건드린다. 새 저장 키·새 스키마·새 마이그레이션은 만들지 않는다.

**Tech Stack:** Vanilla HTML/CSS/JavaScript (ES5 스타일), localStorage, IndexedDB, Node 24.18.0 (`node --check`), Playwright(Task 2에서 승인 후 도입), Git(로컬 전용).

---

## Global Constraints

모든 태스크의 요구사항에 아래가 암묵적으로 포함된다.

**기술 제약 (`CLAUDE.md` 3절)**

- 바닐라 HTML/CSS/JavaScript. 정적 단일 페이지. `file://`에서도 동작.
- 프레임워크·빌드 도구·번들러·CDN 런타임 의존·서버·로그인을 **앱 코드에 추가하지 않는다.**
- 앱 코드에 ES Module `import`·런타임 `fetch` 의존을 추가하지 않는다.
- 기존 파일을 임의로 여러 모듈로 분리하지 않는다. 대규모 리팩터링을 하지 않는다.
- 구조화 데이터는 localStorage, 첨부 바이너리는 IndexedDB. 저장 접두사는 `dotdotplanner:v1:`.
- 테스트 도구는 앱 코드와 분리된 `tests/` 경로에만 둔다. `index.html`은 테스트 코드를 로드하지 않는다.

**데이터 제약 (`DECISIONS_REVIEW.md` §6)**

- **신규 스키마 변경 없음. `schemaVersion` 상향 없음. 마이그레이션 없음.**
- `monthlyLogScheduleColumn`·`monthlyLogLaneIndexByDate`를 읽지도 쓰지도 않는다(1주차 범위 밖).
- `routines` 키와 이미 생성된 `routineId` 항목을 **삭제하지 않는다.**
- 선택 상태(`selectedItemIds` 등)는 세션 상태다. 항목 레코드에 UI 필드를 넣지 않는다.

**제품 제약 (`DECISIONS_REVIEW.md` §11)**

- 금지 문구: **"최근 완료"**, **"이번 주에 완료함"**, **"최근 계획 변경"**, **"언제 이동했는지"**, **"모든 로컬 데이터 초기화"**.
- 완료율 `%`, 게이지 바, 분모를 만들지 않는다.
- 미완료 개수 배지에 경고색·느낌표·연체 문구를 쓰지 않는다.
- 날짜 이동을 실패나 지연으로 서술하지 않는다.
- 과거 미완료를 자동으로 이동시키지 않는다.

**변경 금지 영역**

- **Today 페이지 — 데일리 로그, 빠른 입력, 이월, 주간 보드 — 는 확정이다.** D4는 Today의 "지난달 미완료" 영역을 건드리지만, 데일리 목록·빠른 입력·이월 카드·Weekly 보드는 건드리지 않는다.
- `CLAUDE.md` 4절의 보존 목록(하드 스냅, 히스테리시스, 마퀴 좌표 보정, 범위 생성, 프로젝트 색, 월간 마스터·배치 동기화, 그룹·복사·휴지통, Undo/Redo, Ctrl/Shift+휠)을 되돌리지 않는다.

**Git 제약 (사용자 지시)**

- **원격 저장소 연결·GitHub 업로드·`git push` 금지.** 로컬 기록만 사용한다.
- 초기 기준 커밋 이후 D1·D2·D3·D4·D5를 **각각 별도 커밋**으로 남긴다.
- **각 커밋 전에 테스트 결과와 변경 파일을 사용자에게 보고한다.**

**승인 게이트 (사용자 지시)**

- **Task 0**: `.gitignore` 초안 + 포함/제외 파일 목록을 먼저 보고하고 승인받기 전까지 `git init`·`.gitignore` 작성·커밋을 실행하지 않는다.
- **Task 2**: 설치 명령 전체, 생성·수정 파일, 브라우저 바이너리 예상 용량과 설치 위치, 프로젝트 실행 파일·저장 데이터에 미치는 영향을 먼저 보고하고 승인받기 전까지 설치를 실행하지 않는다.

---

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `.gitignore` | 커밋 제외 규칙 | T0 (생성) |
| `index.html` | 사이드바 진입점 마크업 | T1 (수정, 1줄) |
| `dotdot-extensions.css` | Round D 확장 스타일 | T1·T3 (수정) |
| `dotdot-extensions.js` | Round D 확장 로직 — 루틴·검색·통계·설정 | T1·T3·T4·T6 (수정) |
| `app.js` | 앱 본체 — 월간 미완료 조회·렌더 | T5 (수정) |
| `package.json` | 테스트 전용 devDependency 선언 | T2 (생성) |
| `playwright.config.js` | Playwright 설정 + 로컬 정적 서버 기동 | T2 (생성) |
| `tests/serve.js` | 의존성 0개 정적 파일 서버 (테스트 전용) | T2 (생성) |
| `tests/helpers.js` | 공용 테스트 헬퍼 (시드·초기화) | T2 (생성) |
| `tests/d1-routine-hidden.spec.js` | D1 회귀 | T2 (생성) |
| `tests/d2-stats.spec.js` | D2 기능 + 회귀 | T3 (생성) |
| `tests/d3-search.spec.js` | D3 기능 + 회귀 | T4 (생성) |
| `tests/d4-monthly-overdue.spec.js` | D4 기능 + 회귀 | T5 (생성) |
| `tests/d5-backup-copy.spec.js` | D5 기능 + 회귀 | T6 (생성) |

**분리 원칙:** 테스트 인프라(`package.json`, `playwright.config.js`, `tests/`)는 앱 실행 파일 4개와 완전히 분리된다. `index.html`은 `tests/`의 어떤 파일도 로드하지 않는다. 테스트를 전부 지워도 앱은 그대로 동작한다.

---

## Task 0: Git 안전망 구축 (승인 게이트)

**Files:**
- Create: `.gitignore`
- 초기화: `.git/` (현재 `info/`만 있는 비정상 상태)

**Interfaces:**
- Consumes: 없음
- Produces: 초기 기준 커밋. 이후 모든 태스크가 이 커밋을 롤백 지점으로 사용한다.

**배경:** 현재 `.git/`에는 `info/`만 있고 `HEAD`·`objects`·`refs`가 없어 `git status`가 "not a git repository"로 실패한다. 커밋 이력이 0건이므로 `git init`으로 잃을 데이터가 없다.

- [ ] **Step 1: `.gitignore` 초안과 포함/제외 목록을 사용자에게 보고하고 승인받기**

승인 전에는 아래 Step을 실행하지 않는다. 보고할 내용은 이 문서 하단 "Task 0 승인 자료"와 동일하다.

- [ ] **Step 2: 저장소 초기화**

```bash
git init
git config user.name "Hyuna Kim"
git config user.email "rlagusdk0221@gmail.com"
```

- [ ] **Step 3: `.gitignore` 작성**

```gitignore
# 의존성
node_modules/

# Playwright 브라우저·테스트 결과물
/test-results/
/playwright-report/
/blob-report/
/playwright/.cache/
.playwright/

# 생성된 스크린샷·영상·trace
*.webm
*.zip
*.trace
/tests/**/*-snapshots/
/tests/screenshots/

# 작업 전 백업 폴더
/backup/
/backups/
*_backup_*/
*.bak

# 임시 파일과 로그
*.log
*.tmp
.DS_Store
Thumbs.db

# 로컬 도구 상태
.claude/scheduled_tasks.lock
.claude/settings.local.json
```

- [ ] **Step 4: 스테이징 내용이 의도와 같은지 확인 (커밋 전)**

```bash
git add -A
git status --short
```

Expected: 아래 8개 경로만 `A`로 표시된다. `node_modules`, `.claude/*`, `.git/`는 없어야 한다.

```text
A  .gitignore
A  AGENTS.md
A  README.md
A  app.js
A  assets/fonts/PretendardVariable.woff2
A  docs/... (8개 .md)
A  dotdot-extensions.css
A  dotdot-extensions.js
A  index.html
```

- [ ] **Step 5: 변경 파일 목록을 사용자에게 보고**

`git status --short` 출력을 그대로 보고한다. 예상과 다르면 커밋하지 않고 멈춘다.

- [ ] **Step 6: 초기 기준 커밋**

```bash
git commit -m "chore: 초기 기준 커밋 - Round D 실행 파일 4개와 문서 현재 상태 고정

index.html, app.js, dotdot-extensions.css, dotdot-extensions.js를
2026-07-31 22:20:05 상태 그대로 기록한다. 이후 D1-D5의 롤백 지점이다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: 커밋 검증**

```bash
git log --stat --oneline -1
git ls-files
```

Expected: `git ls-files`에 `app.js`, `index.html`, `dotdot-extensions.css`, `dotdot-extensions.js`, `assets/fonts/PretendardVariable.woff2`, `docs/*.md` 8개, `AGENTS.md`, `README.md`, `.gitignore`가 모두 나온다.

---

## Task 1: D1 — 루틴 숨김 (다운로드 없이 수동·콘솔 검증)

**Files:**
- Modify: `dotdot-extensions.js:626` (`boot`), `dotdot-extensions.js:623` (`bootSideViews`), `dotdot-extensions.js:598`·`:600` (생성 핸들러)
- Modify: `index.html:2379` (사이드바 루틴 항목)
- Modify: `dotdot-extensions.css` (숨김 규칙 1줄 추가)

**Interfaces:**
- Consumes: Task 0의 기준 커밋
- Produces: 루틴 진입점이 사라진 상태. Task 2의 `d1-routine-hidden.spec.js`가 이 상태를 회귀 테스트한다.

**제거 대상은 정확히 세 가지다** (`DECISIONS_REVIEW.md` §5.9): 진입점, `boot()` 자동 호출, 수동 생성 접근. `getRoutines`/`saveRoutines`/`routineDue`/`materializeDueRoutines`/`renderRoutine` 함수 본체와 `routines` 저장 데이터는 **남긴다.**

- [ ] **Step 1: 변경 전 상태를 콘솔로 기록**

`index.html`을 브라우저에서 열고 DevTools 콘솔에 붙여넣는다.

```js
(() => {
  const P = 'dotdotplanner:v1:';
  const items = JSON.parse(localStorage.getItem(P + 'items') || '[]');
  const routineItems = items.filter(i => i.routineId && !i.deletedAt);
  console.log('routineId 항목 수:', routineItems.length);
  console.log('routines 키 존재:', localStorage.getItem(P + 'routines') !== null);
  console.log('오늘 날짜 routineDate 중복:',
    routineItems.filter(i => i.date === new Date().toLocaleDateString('sv')).length);
})();
```

세 값을 메모한다. Step 7에서 비교한다.

- [ ] **Step 2: `boot()`에서 자동 생성 호출 제거**

`dotdot-extensions.js:626`

변경 전:

```js
  function boot(){wireViewModeToggle();bootSideViews();materializeDueRoutines(B.formatLocalDate(new Date()),true,true);if(S.monthlyLogViewMode===B.constants.VIEW_MODE_TIME)B.renderMonthlyLogRows();}
```

변경 후:

```js
  // D1: 루틴 자동 생성 보류. state를 우회한 직접 저장 + reload 경로가 이월과 충돌해
  // 같은 할 일을 매일 누적시키므로(DECISIONS_REVIEW 3.2/3.3), 공식 상태·Undo/Redo·
  // dataRevision 경로로 통합되기 전까지 호출하지 않는다. materializeDueRoutines 본체와
  // localStorage의 routines 데이터는 그대로 보존한다.
  function boot(){wireViewModeToggle();bootSideViews();if(S.monthlyLogViewMode===B.constants.VIEW_MODE_TIME)B.renderMonthlyLogRows();}
```

- [ ] **Step 3: 사이드 뷰 배선에서 루틴 제거**

`dotdot-extensions.js:623` 안의 배열 하나만 바꾼다.

변경 전:

```js
['routine','shortcut','search','stats','settings'].forEach(function(view){
```

변경 후:

```js
['shortcut','search','stats','settings'].forEach(function(view){
```

- [ ] **Step 4: 수동 생성 접근 제거**

`dotdot-extensions.js:598`의 `routine-add` 분기 한 줄과 `:600`의 `routine-materialize` 분기 한 줄을 **통째로 삭제**한다. 삭제 대상은 다음 두 줄이다.

```js
      if(action==='routine-add'){var text=(document.getElementById('ext-routine-text').value||'').trim();if(!text)return;var frequency=document.getElementById('ext-routine-frequency').value;var days=Array.prototype.slice.call(document.querySelectorAll('[name="ext-routine-day"]:checked')).map(function(x){return Number(x.value);});var routines=getRoutines();routines.push({id:'routine_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),text:text,type:'task',frequency:frequency,days:days.length?days:[1],dayOfMonth:new Date().getDate(),active:true,autoCreate:true,createdAt:Date.now()});saveRoutines(routines);renderSideView();return;}
```

```js
      if(action==='routine-materialize'){materializeDueRoutines(B.formatLocalDate(new Date()),true,false);return;}
```

`routine-toggle`/`routine-delete`(`:599`)와 `routine-auto`(`:620`)는 항목을 생성하지 않으므로 그대로 둔다.

- [ ] **Step 5: 사이드바 진입점 숨기기**

`index.html:2379`

변경 전:

```html
      <div class="side-item routine"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.66-5.66M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-13.66 5.66M4 20v-5h5"/></svg><span>루틴</span></div>
```

변경 후 (`hidden` 속성만 추가):

```html
      <div class="side-item routine" hidden><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.66-5.66M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-13.66 5.66M4 20v-5h5"/></svg><span>루틴</span></div>
```

- [ ] **Step 6: `hidden`이 실제로 먹도록 CSS 규칙 추가**

`index.html:194`의 `.side-item{...display:flex...}`가 UA 스타일시트의 `[hidden]{display:none}`보다 우선하므로 `hidden` 속성만으로는 숨겨지지 않는다. `dotdot-extensions.css` 맨 아래 `@media` 규칙 **앞**에 다음 한 줄을 추가한다.

```css
/* D1: 루틴 진입점 보류. .side-item의 display:flex가 UA의 [hidden]을 덮으므로 명시 규칙이 필요하다. */
.side-item.routine[hidden]{display:none}
```

- [ ] **Step 7: 문법 검사**

```bash
node --check dotdot-extensions.js
```

Expected: 출력 없음 (종료 코드 0)

- [ ] **Step 8: 수동·콘솔 검증**

브라우저에서 `index.html`을 **새로고침**하고 확인한다.

1. 사이드바에 "루틴"이 보이지 않는다.
2. 콘솔에 오류 0건.
3. Step 1의 스니펫을 다시 실행한다.
   - `routineId 항목 수`가 Step 1과 **같다** (새로 생성되지 않음).
   - `routines 키 존재`가 **`true` 그대로다** (데이터 보존).
4. 새로고침을 3회 더 반복해도 `routineId 항목 수`가 늘지 않는다.
5. 달력 화면 → `자유 배치`/`24시간` 토글이 정상 동작한다 (`boot()` 회귀 확인).
6. 단축키·검색·통계·설정 4개 사이드 뷰가 여전히 열린다.

- [ ] **Step 9: 변경 파일과 검증 결과를 사용자에게 보고**

```bash
git status --short
git diff --stat
```

보고 항목: 변경 파일 3개, `node --check` 결과, Step 8의 1~6번 결과.

- [ ] **Step 10: 커밋**

```bash
git add index.html dotdot-extensions.js dotdot-extensions.css
git commit -m "fix(D1): 루틴 자동 생성 보류 - 이월 중복 누적 차단

boot()의 materializeDueRoutines 호출, 사이드바 진입점, 수동 생성 핸들러
2개를 제거한다. routines 저장 데이터와 이미 생성된 routineId 항목,
materializeDueRoutines 본체는 보존한다.

DECISIONS_REVIEW.md 3.2/3.3/5.9

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Playwright 도입 (승인 게이트) + D1 회귀 테스트

**Files:**
- Create: `package.json`, `playwright.config.js`, `tests/serve.js`, `tests/helpers.js`, `tests/d1-routine-hidden.spec.js`
- Modify: 없음 (앱 실행 파일 4개를 건드리지 않는다)

**Interfaces:**
- Consumes: Task 1이 만든 "루틴 진입점 없음" 상태
- Produces:
  - `tests/helpers.js` → `seedStorage(page, data)`, `readStorage(page, key)`, `openApp(page)`
  - 이후 모든 태스크가 이 세 헬퍼를 사용한다.

- [ ] **Step 1: 설치 계획을 사용자에게 보고하고 승인받기**

승인 전에는 Step 2 이후를 실행하지 않는다. 보고 내용은 이 문서 하단 "Task 2 승인 자료"와 동일하다.

- [ ] **Step 2: `package.json` 생성**

```json
{
  "name": "dotdotplanner-tests",
  "version": "1.0.0",
  "private": true,
  "description": "DotDotPlanner 테스트 전용 설정. 앱은 여전히 빌드 없이 index.html로 실행된다.",
  "scripts": {
    "test": "playwright test",
    "check": "node --check app.js && node --check dotdot-extensions.js"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0"
  }
}
```

- [ ] **Step 3: 의존성 0개 정적 서버 작성**

`file://`에서는 localStorage origin이 불안정하므로 로컬 HTTP로 띄운다. 외부 패키지를 쓰지 않는다.

`tests/serve.js`:

```js
// 테스트 전용 정적 서버. 의존성 0개. 앱 코드는 이 파일을 모른다.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2'
};

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('test server on http://127.0.0.1:' + PORT);
});
```

- [ ] **Step 4: `playwright.config.js` 작성**

```js
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    video: 'off',
    screenshot: 'off'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/serve.js',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: true,
    timeout: 20000
  }
});
```

- [ ] **Step 5: 공용 헬퍼 작성**

`tests/helpers.js`:

```js
const P = 'dotdotplanner:v1:';

// 앱 스크립트가 실행되기 전에 localStorage를 심는다.
async function seedStorage(page, data) {
  await page.addInitScript(([prefix, payload]) => {
    localStorage.clear();
    Object.keys(payload).forEach((key) => {
      localStorage.setItem(prefix + key, typeof payload[key] === 'string'
        ? payload[key]
        : JSON.stringify(payload[key]));
    });
  }, [P, data]);
}

async function openApp(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto('/index.html');
  await page.waitForSelector('.side-item.today');
  return errors;
}

async function readStorage(page, key) {
  return page.evaluate((full) => {
    const raw = localStorage.getItem(full);
    try { return raw == null ? null : JSON.parse(raw); } catch (e) { return raw; }
  }, P + key);
}

module.exports = { P, seedStorage, openApp, readStorage };
```

- [ ] **Step 6: D1 회귀 테스트 작성 (실패를 먼저 확인할 수 없는 유형이므로 통과 조건을 명시적으로 검증)**

`tests/d1-routine-hidden.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { seedStorage, openApp, readStorage } = require('./helpers');

const YESTERDAY_ROUTINE = {
  id: 'rt_seed_1', type: 'task', text: '아침 스트레칭',
  date: '2026-07-30', endDate: '2026-07-30', allDay: true,
  startTime: null, endTime: null, completed: false,
  createdAt: 1, updatedAt: 1, order: 0,
  originalDate: '2026-07-30', migratedFrom: null, rolloverPending: false,
  completionByDate: null, deletedAt: null, sourceMonthlyItemId: null,
  groupId: null, groupIdByDate: null, instanceGroupId: null, projectId: null,
  description: '', subtasks: [], detailBlocksMigrationVersion: 1,
  routineId: 'routine_seed', routineDate: '2026-07-30'
};

const ACTIVE_ROUTINE = [{
  id: 'routine_seed', text: '아침 스트레칭', type: 'task',
  frequency: 'daily', days: [1], dayOfMonth: 1,
  active: true, autoCreate: true, createdAt: 1
}];

test('루틴 사이드바 진입점이 보이지 않는다', async ({ page }) => {
  await seedStorage(page, { routines: ACTIVE_ROUTINE });
  const errors = await openApp(page);
  await expect(page.locator('.side-item.routine')).toBeHidden();
  expect(errors).toEqual([]);
});

test('새로고침을 반복해도 루틴 항목이 생성되지 않는다', async ({ page }) => {
  await seedStorage(page, { items: [YESTERDAY_ROUTINE], routines: ACTIVE_ROUTINE });
  await openApp(page);
  for (let i = 0; i < 3; i++) await page.reload();
  const items = await readStorage(page, 'items');
  const routineItems = items.filter((it) => it.routineId && !it.deletedAt);
  expect(routineItems).toHaveLength(1);
});

test('routines 저장 데이터가 보존된다', async ({ page }) => {
  await seedStorage(page, { routines: ACTIVE_ROUTINE });
  await openApp(page);
  await page.reload();
  const routines = await readStorage(page, 'routines');
  expect(routines).toHaveLength(1);
  expect(routines[0].id).toBe('routine_seed');
});

test('나머지 사이드 뷰 4개는 계속 열린다', async ({ page }) => {
  await seedStorage(page, {});
  await openApp(page);
  for (const view of ['shortcut', 'search', 'stats', 'settings']) {
    await page.locator('.side-item.' + view).click();
    await expect(page.locator('#dotdot-ext-overlay')).toHaveClass(/open/);
  }
});
```

- [ ] **Step 7: 테스트 실행**

```bash
npx playwright test tests/d1-routine-hidden.spec.js
```

Expected: `4 passed`

- [ ] **Step 8: 의도적 회귀로 테스트가 실제로 잡는지 확인**

`dotdot-extensions.js`의 `bootSideViews` 배열에 `'routine'`을 임시로 되돌리고 실행한다.

```bash
npx playwright test tests/d1-routine-hidden.spec.js
```

Expected: 첫 번째 테스트가 FAIL. 확인 후 **반드시 원복**하고 다시 실행해 `4 passed`를 확인한다.

- [ ] **Step 9: 변경 파일과 테스트 결과를 사용자에게 보고**

보고 항목: 생성 파일 5개, `4 passed`, Step 8의 실패 재현 결과, `node_modules` 실제 용량, 브라우저 설치 경로.

- [ ] **Step 10: 커밋**

```bash
git add package.json package-lock.json playwright.config.js tests/
git commit -m "test: Playwright 하네스 도입 + D1 회귀 테스트

앱 실행 파일과 분리된 tests/ 경로에만 둔다. index.html은 테스트 코드를
로드하지 않는다. 정적 서버는 의존성 0개(tests/serve.js).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: D2 — 통계 교체 (완료율·게이지·분모 삭제)

**Files:**
- Modify: `dotdot-extensions.js:584` (`renderStats` 전체 교체)
- Modify: `dotdot-extensions.css:72-73` (`.dotdot-ext-bar` 규칙 삭제)
- Create: `tests/d2-stats.spec.js`

**Interfaces:**
- Consumes: `tests/helpers.js`의 `seedStorage`/`openApp`, 브리지의 `B.getOccurrenceDates(item)`(`app.js:437`), `B.isOccurrenceCompleted(item, date)`(`app.js:1459`), `B.addCalendarDays(date, n)`, `B.formatLocalDate(dateObj)`
- Produces:
  - `statsPeriodRows(days)` → `Array<{date: string, text: string, kind: 'task'|'schedule'}>`
  - `statsMovedRows()` → `Array<{from: string, to: string, text: string, basis: '원래'|'직전'}>`
  - `renderStats()` → `string` (HTML)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/d2-stats.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { seedStorage, openApp } = require('./helpers');

function base(over) {
  return Object.assign({
    id: 'x', type: 'task', text: 't', date: '2026-07-30', endDate: '2026-07-30',
    allDay: true, startTime: null, endTime: null, completed: false,
    createdAt: 1, updatedAt: 1, order: 0, originalDate: null, migratedFrom: null,
    rolloverPending: false, completionByDate: null, deletedAt: null,
    sourceMonthlyItemId: null, groupId: null, groupIdByDate: null,
    instanceGroupId: null, projectId: null, description: '', subtasks: [],
    detailBlocksMigrationVersion: 1
  }, over);
}

async function openStats(page) {
  await openApp(page);
  await page.locator('.side-item.stats').click();
  await expect(page.locator('#dotdot-ext-overlay')).toHaveClass(/open/);
}

test('게이지 바와 완료율 %가 화면에 없다', async ({ page }) => {
  await seedStorage(page, { items: [base({ id: 'a', completed: true })] });
  await openStats(page);
  await expect(page.locator('.dotdot-ext-bar')).toHaveCount(0);
  await expect(page.locator('#dotdot-ext-overlay')).not.toContainText('완료율');
  await expect(page.locator('#dotdot-ext-overlay')).not.toContainText('%');
});

test('금지 문구를 쓰지 않고 계획일 기준임을 밝힌다', async ({ page }) => {
  await seedStorage(page, { items: [base({ id: 'a', completed: true })] });
  await openStats(page);
  const overlay = page.locator('#dotdot-ext-overlay');
  await expect(overlay).not.toContainText('최근 완료');
  await expect(overlay).not.toContainText('최근 계획 변경');
  await expect(overlay).toContainText('계획일 기준 완료 상태');
});

test('memo와 divider는 집계에서 제외된다', async ({ page }) => {
  await seedStorage(page, {
    items: [
      base({ id: 'a', type: 'task', text: '완료한 할 일', completed: true }),
      base({ id: 'b', type: 'memo', text: '메모입니다', completed: true }),
      base({ id: 'c', type: 'divider', text: '구분선입니다', completed: true })
    ]
  });
  await openStats(page);
  const overlay = page.locator('#dotdot-ext-overlay');
  await expect(overlay).toContainText('완료한 할 일');
  await expect(overlay).not.toContainText('메모입니다');
  await expect(overlay).not.toContainText('구분선입니다');
});

test('schedule은 완료 occurrence만 집계한다', async ({ page }) => {
  await seedStorage(page, {
    items: [base({
      id: 's', type: 'schedule', text: '3일 워크숍',
      date: '2026-07-29', endDate: '2026-07-31', allDay: true,
      completionByDate: { '2026-07-29': true, '2026-07-30': false, '2026-07-31': true }
    })]
  });
  await openStats(page);
  const rows = page.locator('#ext-stats-done-30 li');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('2026-07-31');
});

test('삭제 항목은 집계에서 빠진다', async ({ page }) => {
  await seedStorage(page, {
    items: [base({ id: 'a', completed: true, text: '지운 할 일', deletedAt: '2026-07-30T00:00:00.000Z' })]
  });
  await openStats(page);
  await expect(page.locator('#dotdot-ext-overlay')).not.toContainText('지운 할 일');
});

test('이동 목록은 원래/직전 날짜에서 현재 날짜로만 표시한다', async ({ page }) => {
  await seedStorage(page, {
    items: [base({ id: 'm', text: '미룬 일', date: '2026-07-31', originalDate: '2026-07-20', migratedFrom: '2026-07-30' })]
  });
  await openStats(page);
  const row = page.locator('#ext-stats-moved li').first();
  await expect(row).toContainText('2026-07-30');
  await expect(row).toContainText('2026-07-31');
  await expect(row).toContainText('미룬 일');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx playwright test tests/d2-stats.spec.js
```

Expected: FAIL. 최소한 `.dotdot-ext-bar` 개수 0 기대와 `계획일 기준 완료 상태` 문구 기대가 깨진다.

- [ ] **Step 3: `renderStats` 교체**

`dotdot-extensions.js:584-585`의 `renderStats` 함수 전체를 아래로 교체한다.

```js
  // D2: 완료율·게이지·분모를 만들지 않는다. completedAt이 없어 완료 시각을 알 수 없으므로
  // "최근 완료"라고 부르지 않고, 계획일(task는 date, schedule은 occurrence 날짜)이 구간에
  // 속하면서 지금 완료 상태인 것만 센다. memo/divider는 완료 개념이 없어 제외한다.
  function statsPeriodRows(days){
    var today=B.formatLocalDate(new Date());
    var from=B.addCalendarDays(today,-(days-1));
    var rows=[];
    S.items.forEach(function(item){
      if(!item||item.deletedAt)return;
      if(item.type==='memo'||item.type==='divider')return;
      if(item.type==='task'){
        if(item.completed&&item.date>=from&&item.date<=today)rows.push({date:item.date,text:item.text,kind:'task'});
        return;
      }
      if(item.type==='schedule'){
        B.getOccurrenceDates(item).forEach(function(d){
          if(d>=from&&d<=today&&B.isOccurrenceCompleted(item,d))rows.push({date:d,text:item.text,kind:'schedule'});
        });
      }
    });
    rows.sort(function(a,b){return a.date<b.date?1:(a.date>b.date?-1:0);});
    return rows;
  }
  // 이동 시각 기록이 없으므로 "언제 옮겼는지"를 주장하지 않는다. 현재 데이터로 확인
  // 가능한 것은 originalDate(원래) 또는 migratedFrom(직전)과 현재 date뿐이다.
  function statsMovedRows(){
    var rows=[];
    S.items.forEach(function(item){
      if(!item||item.deletedAt)return;
      var basis=item.migratedFrom?'직전':(item.originalDate?'원래':null);
      var from=item.migratedFrom||item.originalDate||null;
      if(!from||from===item.date)return;
      rows.push({from:from,to:item.date,text:item.text,basis:basis});
    });
    rows.sort(function(a,b){return a.to<b.to?1:(a.to>b.to?-1:0);});
    return rows;
  }
  function statsDoneList(rows){
    if(!rows.length)return '<li class="dotdot-ext-muted">이 구간에 계획된 완료 항목이 없습니다.</li>';
    return rows.slice(0,150).map(function(r){
      return '<li><span class="dotdot-ext-muted" style="min-width:88px">'+esc(r.date)+'</span><span class="dotdot-ext-tag">'+(r.kind==='task'?'할 일':'일정')+'</span><span style="flex:1">'+esc(r.text)+'</span></li>';
    }).join('');
  }
  function renderStats(){
    var d7=statsPeriodRows(7),d30=statsPeriodRows(30),moved=statsMovedRows();
    var movedRows=moved.length
      ? moved.slice(0,150).map(function(r){
          return '<li><span class="dotdot-ext-tag">'+esc(r.basis)+'</span><span class="dotdot-ext-muted" style="min-width:180px">'+esc(r.from)+' → '+esc(r.to)+'</span><span style="flex:1">'+esc(r.text)+'</span></li>';
        }).join('')
      : '<li class="dotdot-ext-muted">날짜가 바뀐 항목이 없습니다.</li>';
    return head('통계','계획일 기준 완료 상태와 날짜 이동을 현재 로컬 데이터에서 확인','완료 시각은 저장하지 않으므로 언제 완료했는지는 알 수 없습니다. 아래는 계획일이 해당 구간에 속하면서 지금 완료 상태인 항목입니다. 할 일은 계획 날짜, 일정은 완료한 날짜를 기준으로 셉니다. 메모와 구분선은 완료 개념이 없어 제외합니다.')
      +'<div class="dotdot-ext-card"><h3>최근 7일 · 계획일 기준 완료 상태</h3><div class="dotdot-ext-stat"><b>'+d7.length+'</b><span>완료 상태 항목</span></div><ul class="dotdot-ext-list" id="ext-stats-done-7">'+statsDoneList(d7)+'</ul></div>'
      +'<div class="dotdot-ext-card"><h3>최근 30일 · 계획일 기준 완료 상태</h3><div class="dotdot-ext-stat"><b>'+d30.length+'</b><span>완료 상태 항목</span></div><ul class="dotdot-ext-list" id="ext-stats-done-30">'+statsDoneList(d30)+'</ul></div>'
      +'<div class="dotdot-ext-card"><h3>날짜가 바뀐 항목</h3><p class="dotdot-ext-muted">계획을 옮긴 것은 실패가 아닙니다. 이동 시각은 저장하지 않으므로 원래 또는 직전 날짜와 현재 날짜만 표시합니다.</p><ul class="dotdot-ext-list" id="ext-stats-moved">'+movedRows+'</ul></div>';
  }
```

- [ ] **Step 4: 게이지 바 CSS 삭제**

`dotdot-extensions.css:72-73`의 두 줄을 삭제한다.

```css
.dotdot-ext-bar{height:8px;border-radius:999px;background:var(--bg-hover);overflow:hidden;margin-top:6px}
.dotdot-ext-bar>i{display:block;height:100%;background:var(--lav)}
```

- [ ] **Step 5: 문법 검사와 테스트**

```bash
node --check dotdot-extensions.js
npx playwright test tests/d2-stats.spec.js
```

Expected: `node --check` 출력 없음, `6 passed`

- [ ] **Step 6: 회귀 스위트 실행**

```bash
npx playwright test
```

Expected: `10 passed` (D1 4개 + D2 6개)

- [ ] **Step 7: 보고 후 커밋**

```bash
git add dotdot-extensions.js dotdot-extensions.css tests/d2-stats.spec.js
git commit -m "fix(D2): 통계 완료율/게이지/분모 삭제, 계획일 기준 완료 목록으로 교체

memo/divider를 분모에 넣어 기록할수록 낮아지던 수치를 제거한다. task는
date, schedule은 완료 occurrence 날짜로 집계한다. completedAt이 없으므로
'최근 완료'가 아니라 '계획일 기준 완료 상태'로 표기한다.

DECISIONS_REVIEW.md 5.5/5.6

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: D3 — 검색 범위 확장과 이동 규칙

**Files:**
- Modify: `dotdot-extensions.js:582-583` (`searchState`, `renderSearch`), `:601` (`search-open` 핸들러)
- Create: `tests/d3-search.spec.js`

**Interfaces:**
- Consumes: `B.findProjectById(id)`, `B.setView(view)`(`app.js:4077`, 값은 `'today'|'calendar'|'trash'`), `B.formatLocalDate`, `B.renderApp()`
- Produces:
  - `searchHaystack(item)` → `string` (소문자, 제목+설명+프로젝트명+하위 할 일)
  - `searchRows()` → `Array<{kind:'item'|'monthly'|'trash-item'|'trash-monthly', item: object, when: string}>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/d3-search.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { seedStorage, openApp } = require('./helpers');

const ITEM = {
  id: 'i1', type: 'task', text: '치과 예약', date: '2026-07-30', endDate: '2026-07-30',
  allDay: true, startTime: null, endTime: null, completed: false, createdAt: 1, updatedAt: 1,
  order: 0, originalDate: null, migratedFrom: null, rolloverPending: false, completionByDate: null,
  deletedAt: null, sourceMonthlyItemId: null, groupId: null, groupIdByDate: null,
  instanceGroupId: null, projectId: 'p1', description: '스케일링 포함', subtasks: [{ id: 's1', text: '보험카드 챙기기', completed: false }],
  detailBlocksMigrationVersion: 1
};
const TRASHED = Object.assign({}, ITEM, { id: 'i2', text: '버린 항목', deletedAt: '2026-07-30T00:00:00.000Z' });
const MONTHLY = {
  id: 'm1', type: 'task', text: '여권 갱신', monthKey: '2026-05', completed: false,
  order: 0, createdAt: 1, updatedAt: 1, deletedAt: null, groupId: null,
  instanceGroupId: null, projectId: null, description: '', subtasks: [],
  detailBlocksMigrationVersion: 1
};
const TRASHED_MONTHLY = Object.assign({}, MONTHLY, { id: 'm2', text: '버린 수집함', deletedAt: '2026-05-30T00:00:00.000Z' });
const PROJECTS = [{ id: 'p1', name: '건강관리', color: '#88aa66', order: 0, createdAt: 1 }];

async function search(page, q) {
  await openApp(page);
  await page.locator('.side-item.search').click();
  await page.locator('#ext-search-q').fill(q);
}

test('이달의 할 일이 검색된다', async ({ page }) => {
  await seedStorage(page, { monthlyItems: [MONTHLY] });
  await search(page, '여권');
  await expect(page.locator('#ext-search-results li')).toHaveCount(1);
  await expect(page.locator('#ext-search-results li').first()).toContainText('월간 수집함');
});

test('휴지통 항목이 검색된다', async ({ page }) => {
  await seedStorage(page, { items: [TRASHED], monthlyItems: [TRASHED_MONTHLY] });
  await search(page, '버린');
  await expect(page.locator('#ext-search-results li')).toHaveCount(2);
  await expect(page.locator('#ext-search-results')).toContainText('휴지통');
});

test('프로젝트명으로 검색된다', async ({ page }) => {
  await seedStorage(page, { items: [ITEM], projects: PROJECTS });
  await search(page, '건강관리');
  await expect(page.locator('#ext-search-results li')).toHaveCount(1);
});

test('하위 할 일로 검색된다', async ({ page }) => {
  await seedStorage(page, { items: [ITEM], projects: PROJECTS });
  await search(page, '보험카드');
  await expect(page.locator('#ext-search-results li')).toHaveCount(1);
});

test('활성 item은 Today로 이동한다', async ({ page }) => {
  await seedStorage(page, { items: [ITEM], projects: PROJECTS });
  await search(page, '치과');
  await page.locator('[data-ext="search-open"]').first().click();
  await expect(page.locator('.side-item.today')).toHaveClass(/active/);
  await expect(page.locator('#dotdot-ext-overlay')).not.toHaveClass(/open/);
});

test('삭제 항목은 휴지통으로 이동한다', async ({ page }) => {
  await seedStorage(page, { items: [TRASHED] });
  await search(page, '버린');
  await page.locator('[data-ext="search-open"]').first().click();
  await expect(page.locator('.side-item.trash')).toHaveClass(/active/);
});

test('검색은 복사본을 만들지 않는다', async ({ page }) => {
  await seedStorage(page, { items: [ITEM], monthlyItems: [MONTHLY], projects: PROJECTS });
  await search(page, '치과');
  await page.locator('[data-ext="search-open"]').first().click();
  const counts = await page.evaluate(() => ({
    items: JSON.parse(localStorage.getItem('dotdotplanner:v1:items') || '[]').length,
    monthly: JSON.parse(localStorage.getItem('dotdotplanner:v1:monthlyItems') || '[]').length
  }));
  expect(counts).toEqual({ items: 1, monthly: 1 });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx playwright test tests/d3-search.spec.js
```

Expected: FAIL — `#ext-search-results`가 아직 없다.

- [ ] **Step 3: `searchState`와 `renderSearch` 교체**

`dotdot-extensions.js:582-583`을 아래로 교체한다.

```js
  var searchState={q:'',type:'all',done:'all',from:'',to:''};
  function searchProjectName(projectId){
    if(!projectId)return '';
    var project=B.findProjectById(projectId);
    return project&&project.name?project.name:'';
  }
  // 제목·설명·프로젝트명·하위 할 일을 검색한다. 프로젝트 이름은 레코드에 복제하지 않고
  // projectId로 조회한다(02_DATA_SPEC 7절).
  function searchHaystack(item){
    var subtasks='';
    if(Array.isArray(item.subtasks)){
      subtasks=item.subtasks.map(function(sub){
        if(!sub)return '';
        return typeof sub==='string'?sub:(sub.text||'');
      }).join(' ');
    }
    return (item.text+' '+(item.description||'')+' '+searchProjectName(item.projectId)+' '+subtasks).toLowerCase();
  }
  var SEARCH_KIND_LABEL={item:'날짜 항목',monthly:'월간 수집함','trash-item':'휴지통','trash-monthly':'휴지통 · 월간'};
  // 조회 대상은 네 갈래다: 활성 items, 활성 monthlyItems, 삭제 items, 삭제 monthlyItems.
  // 결과는 원본을 가리키며 복사본을 만들지 않는다.
  function searchRows(){
    var q=searchState.q.trim().toLowerCase();
    var fromMonth=searchState.from?searchState.from.slice(0,7):'';
    var toMonth=searchState.to?searchState.to.slice(0,7):'';
    var rows=[];
    function accept(item,isMonthly){
      if(!item)return false;
      if(q&&searchHaystack(item).indexOf(q)<0)return false;
      if(searchState.type!=='all'&&item.type!==searchState.type)return false;
      if(searchState.done!=='all'&&(searchState.done==='done')!==!!item.completed)return false;
      var when=isMonthly?item.monthKey:item.date;
      if(!when)return false;
      if(isMonthly){
        if(fromMonth&&when<fromMonth)return false;
        if(toMonth&&when>toMonth)return false;
      }else{
        if(searchState.from&&when<searchState.from)return false;
        if(searchState.to&&when>searchState.to)return false;
      }
      return true;
    }
    S.items.forEach(function(item){
      if(!accept(item,false))return;
      rows.push({kind:item.deletedAt?'trash-item':'item',item:item,when:item.date});
    });
    S.monthlyItems.forEach(function(item){
      if(!accept(item,true))return;
      rows.push({kind:item.deletedAt?'trash-monthly':'monthly',item:item,when:item.monthKey});
    });
    rows.sort(function(a,b){return a.when<b.when?1:(a.when>b.when?-1:0);});
    return rows;
  }
  function renderSearch(){
    var rows=searchRows();
    var list=rows.length
      ? rows.slice(0,150).map(function(row){
          var item=row.item;
          return '<li><span class="dotdot-ext-muted" style="min-width:88px">'+esc(row.when)+'</span>'
            +'<span class="dotdot-ext-tag">'+esc(SEARCH_KIND_LABEL[row.kind])+'</span>'
            +'<span style="flex:1;'+(item.completed?'text-decoration:line-through;opacity:.55':'')+'">'+esc(item.text)+'</span>'
            +'<button class="dotdot-ext-btn" data-ext="search-open" data-kind="'+row.kind+'" data-when="'+esc(row.when)+'" data-id="'+esc(item.id)+'">열기</button></li>';
        }).join('')
      : '<li class="dotdot-ext-muted">검색 결과가 없습니다.</li>';
    return head('검색','제목·설명·프로젝트·하위 할 일에서 찾기','검색 결과는 원본 항목을 가리키며 복사본을 만들지 않습니다. 날짜 항목은 오늘 화면에서, 월간 수집함은 해당 월의 이달의 할 일에서, 삭제한 항목은 휴지통에서 엽니다.')
      +'<div class="dotdot-ext-card"><div class="dotdot-ext-row"><input class="dotdot-ext-input" id="ext-search-q" value="'+esc(searchState.q)+'" placeholder="검색어">'
      +'<select class="dotdot-ext-select" id="ext-search-type"><option value="all">모든 유형</option><option value="task">할 일</option><option value="schedule">일정</option><option value="memo">메모</option></select>'
      +'<select class="dotdot-ext-select" id="ext-search-done"><option value="all">전체</option><option value="open">미완료</option><option value="done">완료</option></select>'
      +'<input class="dotdot-ext-input" style="min-width:auto" type="date" id="ext-search-from" value="'+searchState.from+'"><span>~</span>'
      +'<input class="dotdot-ext-input" style="min-width:auto" type="date" id="ext-search-to" value="'+searchState.to+'"></div>'
      +'<p class="dotdot-ext-muted">'+rows.length+'건</p><ul class="dotdot-ext-list" id="ext-search-results">'+list+'</ul></div>';
  }
```

- [ ] **Step 4: `search-open` 핸들러 교체**

`dotdot-extensions.js:601`의 한 줄을 아래로 교체한다. `location.reload()`를 쓰지 않는다.

```js
      // 종류별 이동 규칙: 활성 item -> Today, 활성 monthlyItem -> 해당 월의 이달의 할 일,
      // 삭제 항목 -> 휴지통(선택·강조까지만. 자동 복원/복사/배치본 생성은 하지 않는다).
      if(action==='search-open'){
        var kind=el.dataset.kind,when=el.dataset.when,targetId=el.dataset.id;
        if(kind==='item'){
          S.selectedDate=when;
          B.setView('today');
        }else if(kind==='monthly'){
          S.selectedDate=when+'-01';
          S.monthlyLogViewMonth=when+'-01';
          B.setView('calendar');
        }else{
          B.setView('trash');
        }
        B.savePreferences();
        B.renderApp();
        closeSideView();
        window.setTimeout(function(){
          var row=document.querySelector('[data-item-id="'+targetId+'"],[data-monthly-item-id="'+targetId+'"]');
          if(row&&row.scrollIntoView)row.scrollIntoView({block:'center'});
        },0);
        return;
      }
```

- [ ] **Step 5: 문법 검사와 테스트**

```bash
node --check dotdot-extensions.js
npx playwright test tests/d3-search.spec.js
```

Expected: `7 passed`

- [ ] **Step 6: 회귀 스위트 실행**

```bash
npx playwright test
```

Expected: `17 passed`

- [ ] **Step 7: 보고 후 커밋**

```bash
git add dotdot-extensions.js tests/d3-search.spec.js
git commit -m "feat(D3): 검색을 monthlyItems와 휴지통까지 확장, 이동 규칙 4종 명시

프로젝트명과 하위 할 일도 검색한다. location.reload() 대신 setView로
이동하며 복사본을 만들지 않는다.

DECISIONS_REVIEW.md 5.7

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: D4 — 과거 미완료 월별 접이식

**Files:**
- Modify: `app.js:3518-3530` (`getOverdueMonthlyItemIdsForMonth`)
- Modify: `app.js:21186-21209` (`renderMonthlyOverdueInto`)
- Create: `tests/d4-monthly-overdue.spec.js`

**Interfaces:**
- Consumes: `findMonthlyItemById(id)`(`app.js:20214`), `buildMonthlyOverdueRowEl(item, targetMonthKey)`(`app.js:21162`), `state.monthlyOverdueExpanded`
- Produces:
  - `getOverdueMonthlyItemIdsForMonth(monthKey)` → `string[]` (**모든** 과거 월, 최신 월 우선)
  - `getOverdueMonthlyGroupsForMonth(monthKey)` → `Array<{monthKey: string, ids: string[]}>`

**주의:** `getOverdueMonthlyItemIdsForMonth`의 **이름과 반환 타입을 바꾸지 않는다.** 기존 호출부(`renderMonthlyOverdueInto`)가 개수 계산에 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/d4-monthly-overdue.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { seedStorage, openApp, readStorage } = require('./helpers');

function monthly(id, text, monthKey, over) {
  return Object.assign({
    id: id, type: 'task', text: text, monthKey: monthKey, completed: false,
    order: 0, createdAt: 1, updatedAt: 1, deletedAt: null, groupId: null,
    instanceGroupId: null, projectId: null, description: '', subtasks: [],
    detailBlocksMigrationVersion: 1
  }, over || {});
}

const SEED = [
  monthly('a', '지난달 항목', '2026-07'),
  monthly('b', '석달전 항목', '2026-05'),
  monthly('c', '반년전 항목', '2026-02'),
  monthly('d', '완료된 항목', '2026-05', { completed: true }),
  monthly('e', '삭제된 항목', '2026-05', { deletedAt: '2026-05-30T00:00:00.000Z' })
];

async function openCalendarOverdue(page) {
  await openApp(page);
  await page.locator('.side-item.calendar').click();
  await page.locator('#monthly-inbox-overdue .rollover-toggle').click();
}

test('3개월 이상 지난 미완료도 보인다', async ({ page }) => {
  await seedStorage(page, { monthlyItems: SEED, calendarViewDate: '2026-08-01', monthlyLogViewMonth: '2026-08-01' });
  await openCalendarOverdue(page);
  const list = page.locator('#monthly-inbox-overdue-list');
  await expect(list).toContainText('지난달 항목');
  await expect(list).toContainText('석달전 항목');
  await expect(list).toContainText('반년전 항목');
});

test('완료·삭제 항목은 제외된다', async ({ page }) => {
  await seedStorage(page, { monthlyItems: SEED, calendarViewDate: '2026-08-01', monthlyLogViewMonth: '2026-08-01' });
  await openCalendarOverdue(page);
  const list = page.locator('#monthly-inbox-overdue-list');
  await expect(list).not.toContainText('완료된 항목');
  await expect(list).not.toContainText('삭제된 항목');
});

test('월별 머리글로 묶여 최신 월이 먼저 온다', async ({ page }) => {
  await seedStorage(page, { monthlyItems: SEED, calendarViewDate: '2026-08-01', monthlyLogViewMonth: '2026-08-01' });
  await openCalendarOverdue(page);
  const heads = page.locator('#monthly-inbox-overdue-list .monthly-overdue-month');
  await expect(heads).toHaveCount(3);
  await expect(heads.nth(0)).toContainText('2026년 7월');
  await expect(heads.nth(2)).toContainText('2026년 2월');
});

test('머리글 문구에 경고색과 느낌표를 쓰지 않는다', async ({ page }) => {
  await seedStorage(page, { monthlyItems: SEED, calendarViewDate: '2026-08-01', monthlyLogViewMonth: '2026-08-01' });
  await openCalendarOverdue(page);
  const count = page.locator('#monthly-inbox-overdue .rollover-count');
  await expect(count).toContainText('지난 달 미완료 3개');
  await expect(count).not.toContainText('!');
  await expect(count).not.toContainText('연체');
});

test('자동 이동이 일어나지 않는다', async ({ page }) => {
  await seedStorage(page, { monthlyItems: SEED, calendarViewDate: '2026-08-01', monthlyLogViewMonth: '2026-08-01' });
  await openCalendarOverdue(page);
  await page.reload();
  const stored = await readStorage(page, 'monthlyItems');
  expect(stored.map((m) => m.monthKey).sort()).toEqual(['2026-02', '2026-05', '2026-05', '2026-05', '2026-07']);
});

test('미완료가 없으면 영역이 사라진다', async ({ page }) => {
  await seedStorage(page, { monthlyItems: [], calendarViewDate: '2026-08-01', monthlyLogViewMonth: '2026-08-01' });
  await openApp(page);
  await page.locator('.side-item.calendar').click();
  await expect(page.locator('#monthly-inbox-overdue')).toBeHidden();
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx playwright test tests/d4-monthly-overdue.spec.js
```

Expected: FAIL — 현재는 바로 전 달만 나오므로 "석달전 항목"이 없다.

- [ ] **Step 3: 조회 함수 확장**

`app.js:3518-3530`을 아래로 교체한다. 함수 이름과 반환 타입은 유지한다.

```js
  // 이월 대상: 현재 보고 있는 달보다 과거인 monthlyItem 마스터 중 미완료·삭제되지 않은 것.
  // D4 이전에는 바로 전 달만 봤기 때문에 2개월 이상 지난 마스터가 현재 월에서 발견되지
  // 않았다(DECISIONS_REVIEW 5.4). 발견·조회는 기간 제한 없이 확정이고, 3개월 이상 항목의
  // 자동 이동·보관·정리 정책은 여전히 미확정이므로 여기서 아무것도 이동시키지 않는다.
  // divider는 완료 개념이 없는 순수 구분선이라 제외한다.
  function getOverdueMonthlyGroupsForMonth(monthKey) {
    var buckets = {};
    state.monthlyItems.forEach(function (it) {
      if (!it || it.deletedAt || it.completed || it.type === 'divider') return;
      if (typeof it.monthKey !== 'string' || it.monthKey >= monthKey) return;
      if (!buckets[it.monthKey]) buckets[it.monthKey] = [];
      buckets[it.monthKey].push(it);
    });
    return Object.keys(buckets)
      .sort(function (a, b) { return a < b ? 1 : (a > b ? -1 : 0); })
      .map(function (key) {
        return {
          monthKey: key,
          ids: buckets[key]
            .sort(function (a, b) { return a.order - b.order; })
            .map(function (it) { return it.id; })
        };
      });
  }

  function getOverdueMonthlyItemIdsForMonth(monthKey) {
    var ids = [];
    getOverdueMonthlyGroupsForMonth(monthKey).forEach(function (group) {
      group.ids.forEach(function (id) { ids.push(id); });
    });
    return ids;
  }
```

- [ ] **Step 4: 렌더에 월별 머리글 추가**

`app.js:21186-21209`의 `renderMonthlyOverdueInto`를 아래로 교체한다.

```js
  function renderMonthlyOverdueInto(sectionEl, listEl, dividerEl, monthKey) {
    if (!sectionEl || !listEl) return;
    var groups = getOverdueMonthlyGroupsForMonth(monthKey);
    var count = 0;
    groups.forEach(function (group) { count += group.ids.length; });
    // 미완료가 없으면 영역 자체를 표시하지 않는다(요구사항).
    sectionEl.hidden = count === 0;
    var countEl = sectionEl.querySelector('.rollover-count');
    // D4: 여러 달을 함께 보여주므로 '지난달'이 아니라 '지난 달'로 적는다. 경고색·느낌표·
    // 연체 문구는 쓰지 않는다(3원칙 3번).
    if (countEl) countEl.textContent = '지난 달 미완료 ' + count + '개';
    var toggle = sectionEl.querySelector('.rollover-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(state.monthlyOverdueExpanded));
    var tri = sectionEl.querySelector('.tri');
    if (tri) tri.classList.toggle('open', state.monthlyOverdueExpanded);
    listEl.hidden = count === 0;
    listEl.classList.toggle('rollover-open', state.monthlyOverdueExpanded && count > 0);
    if (dividerEl) dividerEl.hidden = !(state.monthlyOverdueExpanded && count > 0);
    if (count > 0) {
      var children = [];
      groups.forEach(function (group) {
        var head = document.createElement('div');
        head.className = 'monthly-overdue-month';
        var parsed = parseLocalDate(group.monthKey + '-01');
        head.textContent = parsed.getFullYear() + '년 ' + (parsed.getMonth() + 1) + '월 · ' + group.ids.length + '개';
        children.push(head);
        group.ids.forEach(function (id) {
          children.push(buildMonthlyOverdueRowEl(findMonthlyItemById(id), monthKey));
        });
      });
      listEl.replaceChildren.apply(listEl, children);
    } else {
      listEl.replaceChildren();
    }
  }
```

- [ ] **Step 5: 월 머리글 스타일 추가**

`dotdot-extensions.css` 맨 아래 `@media` 규칙 **앞**에 추가한다.

```css
/* D4: 과거 미완료 월별 머리글. 경고색을 쓰지 않고 기존 muted 톤을 따른다. */
.monthly-overdue-month{padding:8px 2px 4px;font-size:11px;font-weight:750;color:var(--muted)}
.monthly-overdue-month:first-child{padding-top:2px}
```

- [ ] **Step 6: 문법 검사와 테스트**

```bash
node --check app.js
npx playwright test tests/d4-monthly-overdue.spec.js
```

Expected: `node --check` 출력 없음, `6 passed`

- [ ] **Step 7: 수동 확인 (Today 패널)**

브라우저에서 Today 화면의 "이달의 할 일" 패널을 열어 같은 월별 머리글이 나오는지 확인한다. `renderTodayMonthlyOverdue`가 같은 함수를 부르므로 두 화면이 일치해야 한다.

- [ ] **Step 8: 회귀 스위트 실행**

```bash
npx playwright test
```

Expected: `23 passed`

- [ ] **Step 9: 보고 후 커밋**

```bash
git add app.js dotdot-extensions.css tests/d4-monthly-overdue.spec.js
git commit -m "fix(D4): 과거 미완료 수집함을 월별 접이식으로 전체 노출

바로 전 달 한정을 해제한다. 발견/조회만 넓히고 자동 이동은 하지 않는다.
3개월 이상 항목의 처분 정책은 여전히 미확정이다.

DECISIONS_REVIEW.md 5.4

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: D5 — 백업·초기화 문구 정직화

**Files:**
- Modify: `dotdot-extensions.js:588` (`renderSettings`의 데이터 카드), `:605` (`reset-all` 확인 문구)
- Create: `tests/d5-backup-copy.spec.js`

**Interfaces:**
- Consumes: `B.exportAllDataAsJson()`, `fullBackupPayload()`, `downloadJson(payload, name)`
- Produces: 없음 (문구·확인 절차만 변경. 저장 로직은 그대로)

**변경하지 않는 것:** `import-full`의 백업·교체 로직, `fullBackupPayload()`의 수집 범위, IndexedDB 처리. **실제 첨부 백업 구현은 1주차 범위 밖이다.**

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/d5-backup-copy.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { seedStorage, openApp } = require('./helpers');

async function openSettings(page) {
  await openApp(page);
  await page.locator('.side-item.settings').click();
  await expect(page.locator('#dotdot-ext-overlay')).toHaveClass(/open/);
}

test('데이터 버튼 모두가 첨부 원본 제외를 직접 표시한다', async ({ page }) => {
  await seedStorage(page, {});
  await openSettings(page);
  for (const action of ['export-app', 'export-full', 'import-full', 'reset-all']) {
    await expect(page.locator(`[data-ext="${action}"]`)).toContainText('첨부 원본 제외');
  }
});

test('모든 로컬 데이터 초기화라고 부르지 않는다', async ({ page }) => {
  await seedStorage(page, {});
  await openSettings(page);
  await expect(page.locator('#dotdot-ext-overlay')).not.toContainText('모든 로컬 데이터 초기화');
  await expect(page.locator('[data-ext="reset-all"]')).toContainText('플래너 기록 지우기');
});

test('초기화 확인 문구가 첨부 원본이 남는다는 사실을 밝힌다', async ({ page }) => {
  await seedStorage(page, {});
  await openSettings(page);
  const messages = [];
  page.on('dialog', (d) => { messages.push(d.message()); d.dismiss(); });
  await page.locator('[data-ext="reset-all"]').click();
  expect(messages.join(' ')).toContain('첨부 원본');
});

test('첫 확인을 취소하면 데이터가 그대로 남는다', async ({ page }) => {
  await seedStorage(page, { theme: 'dark' });
  await openSettings(page);
  page.on('dialog', (d) => d.dismiss());
  await page.locator('[data-ext="reset-all"]').click();
  const theme = await page.evaluate(() => localStorage.getItem('dotdotplanner:v1:theme'));
  expect(theme).toBe('dark');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx playwright test tests/d5-backup-copy.spec.js
```

Expected: FAIL

- [ ] **Step 3: 데이터 카드 문구 교체**

`dotdot-extensions.js:588`의 `renderSettings` 안에서 데이터 카드 부분만 아래로 교체한다. `<h3>데이터</h3>`로 시작하는 `div.dotdot-ext-card` 하나가 대상이다.

```js
'<div class="dotdot-ext-card"><h3>데이터</h3><div class="dotdot-ext-row">'
+'<button class="dotdot-ext-btn" data-ext="export-app">앱 JSON 내보내기 (첨부 원본 제외)</button>'
+'<button class="dotdot-ext-btn" data-ext="export-full">전체 설정 백업 (첨부 원본 제외)</button>'
+'<button class="dotdot-ext-btn" data-ext="import-full">백업 가져오기·교체 (첨부 원본 제외)</button>'
+'<button class="dotdot-ext-btn danger" data-ext="reset-all">플래너 기록 지우기 (첨부 원본 제외)</button>'
+'</div><p class="dotdot-ext-muted">이미지·동영상 원본은 IndexedDB에 있고 위 기능에 포함되지 않습니다. 가져오기와 지우기를 해도 첨부 원본은 브라우저에 그대로 남습니다.</p></div>'
```

- [ ] **Step 4: 초기화 확인 문구 교체**

`dotdot-extensions.js:605`의 `reset-all` 분기에서 두 `confirm` 문구를 교체한다.

```js
      if(action==='reset-all'){
        if(!confirm('이 브라우저에 저장된 DotDotPlanner 플래너 기록(할 일·일정·월간 수집함·그룹·프로젝트·설정)을 지웁니다. 이미지·동영상 첨부 원본은 지워지지 않고 남습니다. 계속할까요?'))return;
        if(!confirm('복구하려면 먼저 백업해야 합니다. 첨부 원본은 그대로 남는다는 점을 확인했다면 계속하세요.'))return;
        storageKeys().filter(function(k){return k.indexOf(P)===0;}).forEach(function(k){localStorage.removeItem(k);});
        location.reload();
        return;
      }
```

- [ ] **Step 5: 문법 검사와 테스트**

```bash
node --check dotdot-extensions.js
npx playwright test tests/d5-backup-copy.spec.js
```

Expected: `4 passed`

- [ ] **Step 6: 전체 회귀 스위트 실행**

```bash
npm run check
npx playwright test
```

Expected: `27 passed` (D1 4 + D2 6 + D3 7 + D4 6 + D5 4)

- [ ] **Step 7: 보고 후 커밋**

```bash
git add dotdot-extensions.js tests/d5-backup-copy.spec.js
git commit -m "fix(D5): 백업·초기화 문구에 첨부 원본 제외를 직접 표시

IndexedDB 첨부가 남는 기능을 '모든 로컬 데이터 초기화'라고 부르지 않는다.
저장 로직은 바꾸지 않는다. 실제 첨부 백업 구현은 1주차 범위 밖이다.

DECISIONS_REVIEW.md 5.11

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 0 승인 자료 (사용자에게 먼저 보고할 내용)

### 초기 기준 커밋 포함 파일

| 경로 | 크기 | 이유 |
|---|---|---|
| `index.html` | 179,935 B | Round D 실행 파일 |
| `app.js` | 1,246,513 B | Round D 실행 파일 |
| `dotdot-extensions.css` | 10,187 B | Round D 실행 파일 |
| `dotdot-extensions.js` | 48,425 B | Round D 실행 파일 |
| `assets/fonts/PretendardVariable.woff2` | 2.0 MB | 로컬 폰트. 없으면 화면이 깨진다 |
| `docs/*.md` (8개) | 약 96 KB | 기획·데이터·화면·규칙·인수인계·판정 문서 |
| `AGENTS.md` | 1,295 B | 작업 규칙 |
| `README.md` | 410 B | 프로젝트 설명 |
| `.gitignore` | 신규 | 제외 규칙 |

`docs/` 8개: `00_최종기획안_요약.md`, `01_PRODUCT_DEFINITION.md`, `02_DATA_SPEC.md`, `03_SCREEN_SPEC.md`, `CLAUDE.md`, `HANDOFF.md`, `DECISIONS_REVIEW.md`, `superpowers/plans/2026-08-01-week1-safety-honesty.md`

### 초기 커밋 제외 파일

| 경로 | 이유 |
|---|---|
| `.claude/scheduled_tasks.lock` | 도구 락 파일 |
| `.claude/settings.local.json` | 로컬 전용 설정 |
| `.agents/` | 빈 폴더. git은 빈 폴더를 추적하지 않는다 |
| `node_modules/` | 아직 없음. Task 2 이후 생성 |
| Playwright 결과물·백업·로그·ZIP | 아직 없음. 사전 차단 |

### 주의

- 현재 `.git/`에는 `info/`만 있고 커밋 이력이 0건이라 `git init`으로 잃을 데이터가 없다.
- **원격 저장소를 연결하지 않는다. `git remote add`·`git push`를 실행하지 않는다.**

---

## Task 2 승인 자료 (사용자에게 먼저 보고할 내용)

### 실행할 설치 명령 전체

```bash
npm install --save-dev @playwright/test@^1.49.0
npx playwright install chromium
```

두 번째 명령에만 네트워크 다운로드가 있다. `npx playwright install` (브라우저 전체)이 아니라 **`chromium`만** 받는다.

### 생성·수정되는 파일

| 경로 | 동작 |
|---|---|
| `package.json` | 생성 (Task 2 Step 2에서 직접 작성) |
| `package-lock.json` | `npm install`이 생성 |
| `node_modules/` | `npm install`이 생성. `.gitignore`로 제외됨 |
| `playwright.config.js` | 생성 |
| `tests/serve.js`, `tests/helpers.js`, `tests/d1-routine-hidden.spec.js` | 생성 |

**앱 실행 파일 4개(`index.html`, `app.js`, `dotdot-extensions.css`, `dotdot-extensions.js`)는 이 태스크에서 수정하지 않는다.**

### 브라우저 바이너리 예상 용량과 설치 위치

| 항목 | 값 |
|---|---|
| `@playwright/test` 패키지 (`node_modules/`) | 약 50–80 MB |
| Chromium 바이너리 | 약 130–180 MB |
| Chromium Headless Shell | 약 80–100 MB |
| **합계 예상** | **약 260–360 MB** |
| 바이너리 설치 위치 | `C:\Users\rlagu\AppData\Local\ms-playwright\` |
| `node_modules` 위치 | `C:\dotdotplanner_coordinate_lock_v21\node_modules\` |

용량은 버전에 따라 달라진다. 설치 후 실제 용량을 측정해 보고한다.

### 프로젝트 실행 파일과 저장 데이터에 미치는 영향

| 대상 | 영향 |
|---|---|
| `index.html`·`app.js`·`dotdot-extensions.css`·`dotdot-extensions.js` | **없음.** 테스트 코드를 로드하지 않는다 |
| 앱 실행 방식 | **없음.** 여전히 빌드 없이 `index.html`을 열면 동작한다 |
| 사용자의 실제 localStorage 데이터 | **없음.** 테스트는 `127.0.0.1:4173` origin에서 돌고, 브라우저에서 직접 열 때의 `file://` origin과 저장소가 분리된다. 게다가 Playwright는 매 테스트마다 새 브라우저 컨텍스트를 쓴다 |
| IndexedDB 첨부 | **없음** |
| 네트워크 | 설치 시 1회만. 테스트 실행 시에는 `127.0.0.1` 로컬 서버만 사용한다 |
| 되돌리기 | `node_modules/`, `package.json`, `package-lock.json`, `playwright.config.js`, `tests/`를 지우면 완전히 원복된다. 앱은 영향받지 않는다 |

### 위험

- `tests/serve.js`가 `127.0.0.1:4173`을 점유한다. 다른 프로그램이 쓰고 있으면 `PORT` 환경변수로 바꾼다.
- `reuseExistingServer: true`라 이미 떠 있는 서버가 있으면 재사용한다.

---

## 자체 점검 결과

**1. 사양 커버리지** — `DECISIONS_REVIEW.md` §9 1주차 표의 D1–D5가 각각 Task 1·3·4·5·6에 대응한다. Task 0(git)과 Task 2(Playwright)는 사용자가 이번 세션에서 추가로 지시한 안전망·자동화 항목이다.

**2. 미결 항목** — 없음. 모든 Step에 실제 명령 또는 실제 코드가 들어 있다.

**3. 타입 일관성** — `getOverdueMonthlyItemIdsForMonth`는 Task 5에서도 `string[]`을 유지해 기존 호출부를 깨지 않는다. `seedStorage`/`openApp`/`readStorage`는 Task 2에서 정의한 시그니처를 Task 3–6이 그대로 쓴다. `statsPeriodRows`/`statsMovedRows`/`searchRows`는 각각 한 곳에서만 정의된다.

**4. 범위** — 1주차 5개 항목 + 안전망 2개. 2주차(D6–D10)는 이 계획에 포함하지 않는다.

---

## 이 계획이 다루지 않는 것

| 항목 | 이유 |
|---|---|
| D6 `[다음 달]` 이동 | 2주차 |
| D7 24시간 모드 안내 | 2주차 |
| D8 로컬 프로필 제거 | 2주차 |
| D9–D10 문서 동기화 | 2주차 |
| 자동 배치 모드 | 2D 패킹 규칙 미확정 (`DECISIONS_REVIEW.md` §10) |
| 루틴 재구현 | 별도 라운드 |
| IndexedDB 포함 완전 백업 | 정책 미확정 (`CLAUDE.md` 12절) |
