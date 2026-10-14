# 한국승강기안전공단노동조합 출장 여비 청구

Google Apps Script 웹앱입니다.

| 파일 | 내용 |
|---|---|
| `Code.gs` | 서버 (시트·드라이브·카카오 API·PDF) |
| `Index.html` | 직원 화면 |
| `data/지사별주소.xlsx` | '지사별 주소' 탭에 붙여 넣을 지사 주소 목록 |
| `.github/workflows/deploy-apps-script.yml` | 자동 배포 |

## 자동 배포

`Code.gs` 또는 `Index.html`이 바뀌어 `claude/admiring-mendel-ne43hk` 브랜치에 올라가면,
GitHub Actions가 Apps Script 프로젝트의 두 파일을 바꾸고 **지금 쓰는 웹앱 배포를 새 버전으로** 바꿉니다.
웹앱 주소는 그대로입니다. 프로젝트의 설정 파일(appsscript.json)과 다른 파일은 건드리지 않습니다.

### 처음 한 번 설정

1. **Apps Script API 켜기** — https://script.google.com/home/usersettings 에서 'Google Apps Script API'를 **사용**으로.
   웹앱을 배포한 계정(스크립트 소유자)으로 하세요.
2. **로그인 정보 만들기** — Node.js가 설치된 PC에서:
   ```
   npm install -g @google/clasp@2.4.2
   clasp login
   ```
   브라우저가 열리면 스크립트 소유자 계정으로 허용합니다.
   그러면 `C:\Users\(사용자)\.clasprc.json` (Mac은 `~/.clasprc.json`) 파일이 생깁니다. 메모장으로 열어 **내용 전체**를 복사하세요.
3. **값 두 개 확인**
   - 스크립트 ID: Apps Script 편집기 → ⚙ 프로젝트 설정 → 스크립트 ID
   - 배포 ID: 배포 → 배포 관리 → 지금 쓰는 웹앱 배포 → 배포 ID
4. **GitHub에 등록** — 이 저장소 → Settings → Secrets and variables → Actions → New repository secret

   | Name | Secret |
   |---|---|
   | `CLASPRC_JSON` | 2번에서 복사한 내용 전체 |
   | `SCRIPT_ID` | 스크립트 ID |
   | `DEPLOYMENT_ID` | 배포 ID |
5. **시험 실행** — 저장소 → Actions → 'Apps Script 자동 배포' → Run workflow.
   초록 체크가 뜨면 끝입니다. 이후에는 코드가 올라갈 때마다 자동으로 실행됩니다.

### 알아 둘 점

- `CLASPRC_JSON`은 스크립트 소유자 계정의 Apps Script 접근 권한입니다. GitHub Secret은 화면에 다시 표시되지 않지만,
  계정 비밀번호처럼 다루세요. 권한을 끊으려면 Google 계정 → 보안 → 타사 액세스에서 clasp 연결을 삭제하면 됩니다.
- Apps Script 프로젝트는 버전을 최대 200개까지 만들 수 있습니다. 많이 쌓이면 편집기의 '배포 관리'에서 오래된 버전을 정리하세요.
- 편집기에서 직접 고친 내용은 다음 자동 배포 때 이 저장소의 `Code.gs`·`Index.html`로 덮어써집니다. 수정은 저장소에서 하세요.
- 시트 탭(유류대·식수·지사별 주소 등)을 고치는 것은 배포와 상관없이 바로 반영됩니다.

## 짧은 주소 (Netlify)

`netlify/index.html`은 웹앱을 화면 가득 띄우는 페이지입니다. Netlify에 올리면 `이름.netlify.app` 주소로 앱이 열립니다.

1. https://app.netlify.com → 사이트 선택 → **Deploys** 탭 → `netlify` 폴더를 끌어다 놓기 (또는 새 사이트는 https://app.netlify.com/drop)
2. 주소 이름 바꾸기: **Site configuration → Change site name**
3. 웹앱 주소가 바뀌면(새 배포를 만든 경우) `netlify/index.html` 안의 주소 두 곳을 바꾸고 다시 올리기.
   평소처럼 '배포 관리 → 새 버전'으로 업데이트하면 주소가 그대로라 다시 올릴 필요 없음.
