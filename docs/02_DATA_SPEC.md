# 02. 데이터 명세 — DotDotPlanner

최종 업데이트: 2026-07-31  
문서 역할: 현재 코드가 저장하는 데이터 구조와 완료·이월·연결·복구 규칙을 정의한다.

---

## 1. 핵심 원칙

### 1.1 단일 원본·다중 뷰

Today·Weekly·Monthly Log는 기본적으로 같은 `state.items` 배열을 조회한다.  
화면마다 별도의 복제 레코드를 만들지 않는다.

### 1.2 월간 마스터는 별도 컬렉션

`state.monthlyItems`는 날짜가 없는 “이달 안에 할 일” 원본이다.

날짜에 배치하면 `state.items`에 배치본을 만들고 다음 필드로 연결한다.

```js
sourceMonthlyItemId: monthlyItem.id
```

마스터와 배치본은 공유 필드만 동기화하고 날짜·시간·순서 등은 독립적으로 유지한다.

### 1.3 UI 임시 상태는 데이터에 저장하지 않는다

선택 상태, 열린 팝업, 현재 마퀴, 클립보드, 활성 상세 패널 등은 세션 상태다.  
항목 레코드에 `selected` 같은 UI 필드를 넣지 않는다.

---

## 2. 주요 컬렉션

```js
state.items        // 날짜에 배치되는 일반 항목
state.monthlyItems // 날짜 없는 월간 마스터
state.groups       // 날짜 또는 월 문맥의 UI 그룹
state.projects     // 날짜를 넘어 유지되는 전역 프로젝트
```

첨부 파일의 실제 바이너리는 IndexedDB에 저장한다.

---

## 3. 일반 항목 `item`

현재 신규 항목의 기본 구조는 다음과 같다.

```js
{
  id: string,
  type: "task" | "schedule" | "memo" | "divider",
  text: string,

  date: "YYYY-MM-DD",
  endDate: "YYYY-MM-DD",
  allDay: boolean,
  startTime: "HH:mm" | null,
  endTime: "HH:mm" | null,

  completed: boolean,
  completionByDate: {
    [occurrenceDate: "YYYY-MM-DD"]: boolean
  } | null,

  createdAt: number,
  updatedAt: number,
  order: number,

  originalDate: "YYYY-MM-DD" | null,
  migratedFrom: "YYYY-MM-DD" | null,
  rolloverPending: boolean,

  deletedAt: string | null,

  sourceMonthlyItemId: string | null,
  instanceGroupId: string | null,
  projectId: string | null,

  groupId: string | null,
  groupIdByDate: {
    [occurrenceDate: "YYYY-MM-DD"]: string
  } | null,

  description: string,
  descriptionBlocks: array | undefined,
  subtasks: array,
  detailBlocksMigrationVersion: number,

  // Monthly Log 배치 관련 필드는 필요할 때 추가된다.
  monthlyLogScheduleColumn: number | undefined,
  monthlyLogLaneIndexByDate: object | null | undefined
}
```

### 3.1 날짜 규칙

- `date`는 시작일이다.
- `endDate`가 없으면 생성 시 `date`와 같게 맞춘다.
- 다일 항목은 `date <= occurrenceDate <= endDate`에 표시된다.
- 날짜 문자열은 `YYYY-MM-DD` 형식만 유효하다.
- UTC `toISOString().slice(0, 10)`에 의존하지 않고 로컬 날짜 유틸을 사용한다.

### 3.2 시간 규칙

- 시간은 24시간제 `HH:mm`.
- `allDay === true`이면 시간 없는 일정으로 취급한다.
- `startTime`·`endTime`은 Today·상세 정보에 사용된다.
- 현재 Monthly Log의 18개 열 위치는 시간 필드와 별개다.
- 다일 일정의 종료 시각이 시작 시각보다 작아도 앱이 임의 보정하지 않는다.

### 3.3 완료 규칙

#### 할 일

- 기본 완료 상태는 `completed`.
- 완료 취소가 가능하다.
- 완료 항목은 자동 이월 대상에서 제외한다.

#### 일정

다일 일정은 날짜별 완료가 필요하므로 `completionByDate`를 사용한다.

```js
completionByDate["2026-07-31"] = true
```

같은 일정 ID가 여러 날짜에 표시되어도 특정 occurrence만 완료할 수 있다.

### 3.4 삭제 규칙

- 삭제는 `deletedAt`을 설정하는 소프트 삭제다.
- 삭제된 항목은 일반 화면에서 제외하고 휴지통에서 조회한다.
- 휴지통에서 원위치 또는 지정 날짜로 복원할 수 있다.
- 영구 삭제는 별도 명시 조작으로만 수행한다.

---

## 4. 월간 마스터 `monthlyItem`

```js
{
  id: string,
  type: "task" | "schedule" | "memo" | "divider",
  text: string,
  monthKey: "YYYY-MM",

  completed: boolean,
  order: number,
  createdAt: number,
  updatedAt: number,
  deletedAt: string | null,

  groupId: string | null,
  instanceGroupId: string | null,
  projectId: string | null,

  description: string,
  descriptionBlocks: array | undefined,
  subtasks: array,
  detailBlocksMigrationVersion: number
}
```

### 4.1 역할

- 특정 날짜를 아직 정하지 않은 월간 후보를 보관한다.
- Calendar 우측 패널과 Today 우측 패널이 같은 컬렉션을 공유한다.
- 지난달 미완료 항목은 별도 접이식 영역에서 조회한다.
- `[이번 달]`은 복사하지 않고 기존 마스터의 `monthKey`를 이동한다.

### 4.2 마스터·배치 공유 필드

다음 필드는 마스터와 모든 배치본이 공유한다.

```js
[
  "text",
  "type",
  "description",
  "descriptionBlocks",
  "subtasks",
  "detailBlocksMigrationVersion",
  "projectId"
]
```

다음은 배치마다 독립이다.

- `date`, `endDate`
- `startTime`, `endTime`, `allDay`
- `order`
- 완료 occurrence
- 날짜별 그룹 위치
- Monthly Log 열과 레인 위치
- 이월 상태

---

## 5. 연결 인스턴스

### 5.1 월간 마스터 연결

```js
sourceMonthlyItemId
```

구조:

```text
monthlyItem 1개
 ├─ item 배치 A
 ├─ item 배치 B
 └─ item 배치 C
```

마스터를 기준으로 공유 필드를 전파한다. 휴지통에 있는 배치도 동기화 대상이다.

### 5.2 대등한 연결 복사

```js
instanceGroupId
```

일반 복사와 달리 연결 복사는 원본·복사본이 대등한 인스턴스가 된다.

공유:

- 제목
- 유형
- 설명
- 설명 블록
- 하위 할 일
- 프로젝트

독립:

- 날짜·시간
- 정렬 순서
- 날짜별 그룹
- Monthly Log 위치
- 이월 상태

완료 상태는 현재 구현 정책에 따라 연결 그룹과 월간 마스터 경로에서 동기화될 수 있으므로 변경 시 전체 관련 테스트를 다시 실행한다.

---

## 6. 그룹 `group`

그룹은 프로젝트와 다르다. 화면 안에서 항목을 접고 정리하는 UI 구조다.

### 일간·Weekly 그룹

```js
{
  id: string,
  name: string,
  date: "YYYY-MM-DD",
  order: number,
  collapsed: boolean,
  color: string | null,
  createdAt: number
}
```

### 월간 그룹

```js
{
  id: string,
  name: string,
  scope: "monthly",
  monthKey: "YYYY-MM",
  order: number,
  collapsed: boolean,
  color: string | null,
  createdAt: number
}
```

다일 항목은 occurrence마다 그룹이 달라질 수 있으므로 `groupIdByDate`를 사용한다.

---

## 7. 프로젝트 `project`

프로젝트는 날짜·월 경계를 넘어 유지되는 전역 소속이다.

```js
{
  id: string,
  name: string,
  color: "#RRGGBB" | null,
  order: number,
  createdAt: number
}
```

- item과 monthlyItem은 `projectId`만 저장한다.
- 이름과 색은 레코드에 복제하지 않는다.
- 프로젝트 삭제 시 항목은 삭제하지 않고 `projectId`만 해제한다.
- Monthly Log 일정과 연결선은 프로젝트 색을 우선 사용한다.

---

## 8. 이월 규칙

### 8.1 대상

- `type === "task"`
- 미완료
- 기준 날짜보다 과거
- 다일 항목이면 `endDate`가 지난 뒤
- 삭제되지 않은 항목

### 8.2 자동 이월과 정착

자동 이월은 과거 항목을 오늘 쪽에서 다시 판단할 수 있게 한다.

관련 필드:

```js
originalDate
migratedFrom
rolloverPending
```

- `originalDate`: 최초 계획 날짜
- `migratedFrom`: 이월 직전 날짜
- `rolloverPending`: 사용자가 명시적으로 정착시키지 않은 자동 이월 상태

Weekly와 Today의 일반 목록은 자동 이월 항목이 원래 오늘 항목처럼 중복 표시되지 않도록 필터링한다.

### 8.3 완료와 이월

- 완료한 할 일은 이월하지 않는다.
- occurrence 완료 상태는 유지한다.
- 사용자가 명시적으로 날짜 이동하면 새 위치에 정착한다.
- 3개월 이상 누적 미완료 정책은 아직 확정하지 않았다.

---

## 9. 선택·복사·이동의 데이터 효과

### 일반 복사

- 새 ID 생성
- 내용과 프로젝트 등 필요한 필드 복사
- 원본과 이후 동기화하지 않음

### 연결 복사

- `instanceGroupId` 생성 또는 재사용
- 공유 필드 동기화

### 월간 마스터 배치

- `sourceMonthlyItemId` 설정
- 마스터는 남고 날짜 항목 생성

### 이동

- 기존 item의 날짜·순서·Monthly Log 위치를 변경
- 복제하지 않음
- Undo/Redo 한 단계로 묶음

### 다중 선택

선택 자체는 저장하지 않는다.

```js
selectedItemIds
selectedOccurrenceById
selectionAnchor
```

모두 세션 상태다.

---

## 10. Undo/Redo

```js
history = {
  undoStack: [],
  redoStack: [],
  limit: 50
}
```

`withHistoryTransaction()`의 가장 바깥 트랜잭션만 기록한다.

적용 범위:

- 생성·수정
- 완료
- 이동·정렬
- 그룹
- 프로젝트
- 휴지통 이동·복원·영구삭제
- monthlyItems와 items를 함께 바꾸는 연결 작업

---

## 11. 저장소

기본 접두사:

```text
dotdotplanner:v1:
```

### 핵심 데이터

| 키 | 내용 |
|---|---|
| `items` | 일반 항목 배열 |
| `monthlyItems` | 월간 마스터 배열 |
| `groups` | 그룹 배열 |
| `projects` | 프로젝트 배열 |
| `schemaVersion` | 저장 스키마 버전 |
| `dataRevision` | 교차 탭 충돌 감지 revision |

### 날짜·화면 상태

| 키 | 내용 |
|---|---|
| `selectedDate` | Today 선택 날짜 |
| `calendarViewDate` | 미니 달력 표시 월 |
| `monthlyLogViewMonth` | Monthly Log 표시 월 |
| `weekStartDate` | Weekly 시작 날짜 |
| `weeklyVisibleDays` | Weekly 표시 일수 |
| `weeklyRangeMode` | rolling / week |
| `weeklyAutoFollow` | 실제 날짜 자동 추적 |
| `weeklyRowSplitRatio` | Weekly 두 행 높이 비율 |
| `weeklyPanel` | Weekly 패널 위치·접힘 |

### 표시 설정

| 키 | 내용 |
|---|---|
| `theme` | light / dark |
| `lunarEnabled` | 음력 표시 |
| `calendarWeekStartsOn` | 일요일·월요일 시작 |
| `dailyHideCompleted` | Daily 완료 숨김 |
| `weeklyHideCompleted` | Weekly 완료 숨김 |
| `monthlyLogHideCompleted` | Monthly Log 완료 숨김 |
| `monthlyInboxHideCompleted` | 이달의 할 일 완료 숨김 |

### Monthly Log 설정

| 키 | 내용 |
|---|---|
| `calendarMonthlySplitRatio` | Monthly Log·월간 패널 폭 비율 |
| `monthlyLogColumnDividerEnabled` | 자유 구분선 사용 |
| `monthlyLogColumnDividerRatio` | 레거시 단일 구분선 비율 |
| `monthlyLogColumnDividerRatios` | 다중 구분선 비율 배열 |
| `monthlyLogRowHeights` | 날짜별 행 높이 |
| `monthlyLogScheduleCellWidth` | 전역 셀 너비 |

### 손상·복구

| 키 패턴 | 내용 |
|---|---|
| `items_corrupted_backup` | items 전체 파싱 실패 원본 |
| `monthlyItems_corrupted_backup` | monthlyItems 전체 파싱 실패 원본 |
| `items_quarantine_*` | 잘못된 개별 레코드 |
| `migration_backup_*` | 마이그레이션 직전 스냅샷 |

---

## 12. 데이터 검증과 실패 처리

### 형식 검사

- 날짜: `YYYY-MM-DD`
- 월: `YYYY-MM`
- 시간: `00:00`~`23:59`
- 프로젝트 색: `#RRGGBB`
- 타입: `task | schedule | memo | divider`

### 손상 처리

- 배열 전체가 손상되면 원문을 별도 키에 보존한다.
- 배열 안의 일부 레코드만 잘못되면 정상 레코드는 로드하고 잘못된 레코드만 격리한다.
- 개발용 시드로 조용히 덮어쓰지 않는다.

### 저장 실패 배너

저장 실패는 다음 대상별로 독립 관리한다.

```text
items
monthlyItems
groups
projects
preferences
weeklyPanelPrefs
indexeddb
```

한 대상의 성공이 다른 대상의 오류 배너를 지우지 않는다.

### 교차 탭

`dataRevision`으로 다른 탭의 수정을 감지하고 사용자 선택을 요구한다.  
실제 두 브라우저 탭 동시 조작은 사용자 재검증 대상으로 남아 있다.

---

## 13. 내보내기와 첨부

### JSON 내보내기

현재 export에는 최소 다음이 포함된다.

- items
- monthlyItems
- groups
- projects
- preferences 및 관련 메타데이터

### 마이그레이션 백업

최소 다음 원문을 포함한다.

- items
- monthlyItems
- groups
- projects

### IndexedDB

이미지·동영상 등 첨부 바이너리를 저장한다.

아직 보류:

- JSON 가져오기
- 첨부 바이너리까지 포함한 완전 ZIP 백업
- 가져오기 시 덮어쓰기·병합·ID 충돌 정책

---

## 14. 변경 시 사전 논의가 필요한 영역

다음은 데이터 모델 의미가 바뀌므로 코드부터 수정하지 않는다.

- Monthly Log 24시간 축
- 다일 시간 일정의 연속·반복 해석
- 자정 넘김 표현
- 기존 18칸 데이터 마이그레이션
- 열별 개별 너비
- 3개월 이상 미완료 정책
- AM/PM 없는 시간 입력
- 완전 백업·가져오기 충돌 정책
