# 한국승강기안전공단노동조합 출장 여비 청구

Google Apps Script 웹앱입니다.

| 파일 | 내용 |
|---|---|
| `Code.gs` | 서버 (시트·드라이브·카카오 API·PDF) |
| `Index.html` | 직원 화면 |
| `data/지사별주소.xlsx` | '지사별 주소' 탭에 붙여 넣을 지사 주소 목록 |

## 반영 순서 (관리 기능 포함 버전)

1. Apps Script 편집기에 `Code.gs`와 `Index.html`을 붙여넣고 저장합니다.
2. 함수 선택 칸에서 `setup`을 고르고 [실행] → 권한 허용. 실행 기록에서 ❌·⚠ 줄이 없는지 확인합니다.
   - '여비 청구 데이터'의 `마감여부` 열이 `상태` 열로 바뀌고, 예전 `진행중`은 `제출`로 바뀝니다.
   - `보완 메모`·`보완 이력`·`소속(등록)`·`식수 변경` 열과 `제출 현황` 탭이 생깁니다.
   - 대상자 명단·식수의 출장명, 대상자 명단의 소속, 상태 칸이 목록에서 고르는 칸이 됩니다.
3. 배포 → 배포 관리 → ✏️ → 새 버전 → 배포.
4. 스프레드시트를 새로 고치면 위쪽에 **여비 관리** 메뉴가 생깁니다 (스크립트가 이 시트의 확장 프로그램 → Apps Script에 있을 때).
5. 메뉴에서 **PDF 폴더 정리**를 한 번 눌러 예전 출장 폴더를 `연도 / 기간 출장명` 폴더로 옮깁니다.

### 여비 관리 메뉴

| 메뉴 | 하는 일 |
|---|---|
| 새 출장 등록… | 창 하나로 출장 관리·대상자 명단·식수에 한 번에 입력. 출장명이 겹치면 바로 경고, 사번을 붙여넣으면 지난 출장 소속이 채워짐 |
| 설정 점검 | 겹치는 출장명, 연결 안 된 출장명, 지사 목록에 없는 소속, 기간 오류, 유류대·카카오 키 확인 |
| 제출 현황 새로 고침 | '제출 현황' 탭을 다시 만듦 (직원이 제출할 때도 자동 갱신) |
| 선택한 사람 보완요청… | '여비 청구 데이터'에서 고른 행의 상태를 보완요청으로 바꾸고 메모를 남김 → 직원 화면에 표시 |
| PDF 폴더 정리 | 예전 위치의 출장 폴더를 연도/기간 폴더로 옮기고 이름을 맞춤 |

### 사람별 상태 (여비 청구 데이터 '상태' 열)

제출 → 보완요청(보완 메모가 직원 화면에 보임, 고쳐 내면 다시 '제출'과 보완 이력 기록) → 확인완료 → 마감.
확인완료·마감이면 직원은 고칠 수 없습니다. 마감되면 수정용 데이터는 매일 새벽 자동 정리됩니다.

## 자동 배포 (GitHub → Apps Script)

GitHub 브랜치 `claude/admiring-mendel-ne43hk`에 새 `Code.gs`·`Index.html`이 올라오면,
Apps Script가 **10분마다 스스로 확인해서** 프로젝트에 반영하고 **지금 쓰는 웹앱 배포를 새 버전으로** 바꿉니다.
웹앱 주소는 그대로이고, 프로젝트의 다른 파일과 설정(appsscript.json)은 건드리지 않습니다.
바로 반영하려면 스프레드시트 메뉴 **여비 관리 → 최신 버전으로 업데이트 (GitHub)**.

### 처음 한 번만 설정 (스크립트 소유자 계정으로)

1. **Apps Script API 켜기** — https://script.google.com/home/usersettings → 'Google Apps Script API'를 **사용**으로.
2. **코드 붙여넣기 (마지막 수동 작업)** — 스프레드시트 → 확장 프로그램 → Apps Script → `Code.gs`, `Index.html`을 이 저장소 내용으로 바꾸고 저장.
3. **권한 목록 넣기** — 편집기 왼쪽 ⚙ 프로젝트 설정 → '편집기에서 "appsscript.json" 매니페스트 파일 표시' 체크 →
   편집기 파일 목록의 `appsscript.json`을 열고, 맨 첫 줄 `{` 바로 다음 줄에 아래를 그대로 붙여넣고 저장:
   ```
     "oauthScopes": [
       "https://www.googleapis.com/auth/spreadsheets",
       "https://www.googleapis.com/auth/drive",
       "https://www.googleapis.com/auth/script.external_request",
       "https://www.googleapis.com/auth/script.scriptapp",
       "https://www.googleapis.com/auth/script.container.ui",
       "https://www.googleapis.com/auth/calendar.readonly",
       "https://www.googleapis.com/auth/script.projects",
       "https://www.googleapis.com/auth/script.deployments"
     ],
   ```
4. **실행** — 함수 선택 칸에서 `setup` → [실행] → 권한 허용. 이어서 `setupAutoUpdate` → [실행] → 권한 허용.
   실행 기록에 `✅ … 새 버전(n)으로 배포했어요`가 나오면 끝입니다.

### 알아 둘 점

- 편집기에서 직접 고친 `Code.gs`·`Index.html`은 GitHub 내용이 바뀌면 덮어써집니다. 수정은 저장소에서 하세요.
- 새 버전이 만들어질 때마다 Apps Script 버전이 하나씩 쌓입니다(프로젝트당 최대 200개). 많이 쌓이면 배포 관리에서 오래된 버전을 지우세요.
- 자동 업데이트를 멈추려면 편집기 왼쪽 ⏰ 트리거에서 `autoUpdateFromGitHub`를 삭제하세요.
- 시트 탭(유류대·식수·지사별 주소 등)을 고치는 것은 배포와 상관없이 바로 반영됩니다.

## 짧은 주소 (Netlify)

`netlify/index.html`은 웹앱을 화면 가득 띄우는 페이지입니다. Netlify에 올리면 `이름.netlify.app` 주소로 앱이 열립니다.

1. https://app.netlify.com → 사이트 선택 → **Deploys** 탭 → `netlify` 폴더를 끌어다 놓기 (또는 새 사이트는 https://app.netlify.com/drop)
2. 주소 이름 바꾸기: **Site configuration → Change site name**
3. 웹앱 주소가 바뀌면(새 배포를 만든 경우) `netlify/index.html` 안의 주소 두 곳을 바꾸고 다시 올리기.
   평소처럼 '배포 관리 → 새 버전'으로 업데이트하면 주소가 그대로라 다시 올릴 필요 없음.
