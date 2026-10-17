# Vercel로 옮기기 (내 검사 일정)

구글 앱스 스크립트 대신 Vercel(무료)에서 화면과 서버를 함께 돌린다. 화면은 같고, 서버만 바뀐다.

| 파일 | 하는 일 |
| --- | --- |
| `web.html` | 화면 (주소 `/`). `index.html`을 고친 뒤 `python3 tools/wrap.py`로 다시 만든다 |
| `api/rpc.js` | 화면이 부르는 서버 기능 (`google.script.run` 대신) |
| `api/w.js` | 홈 화면 위젯 (`/?w=키`) |
| `lib/core.js` | 서버 기능 본체 (`apps-script/Code.gs`를 옮긴 것) |
| `vercel.json` | 주소 연결, 서버 위치(서울) |

## 처음 한 번 설정

1. **가입**: vercel.com → GitHub 계정으로 가입 (Hobby, 무료, 카드 필요 없음)
2. **프로젝트 만들기**: Add New → Project → `well8898/-` 저장소 Import
   - Root Directory: `my-schedule`
   - Framework Preset: Other
   - 나머지는 그대로 두고 Deploy
3. **배포할 브랜치**: Project → Settings → Environments → Production → Branch Tracking 을 `my-schedule` 로
   (예전 화면은 Settings → Git → Production Branch. "No deployments found"가 나오면 `my-schedule` 브랜치에 새 커밋이 올라가 미리보기 배포가 한 번 생긴 뒤에 다시)
4. **저장소 연결**: Project → Storage → Upstash(Redis) → Create → 이 프로젝트에 Connect
   - 연결하면 `KV_REST_API_URL`, `KV_REST_API_TOKEN` 환경 변수가 자동으로 생긴다
5. **키 넣기**: Project → Settings → Environment Variables (앱스 스크립트 '스크립트 속성'에 있던 값 그대로)
   - `KAKAO_REST_API_KEY`, `KAKAO_JS_KEY`, `TMAP_APP_KEY`, `DATA_GO_KR_KEY`
6. **다시 배포**: Deployments → 맨 위 → Redeploy (환경 변수는 다시 배포해야 적용)
7. **카카오 지도 도메인**: 카카오 디벨로퍼스 → 내 애플리케이션 → 플랫폼 → Web → 사이트 도메인에
   Vercel 주소(`https://○○○.vercel.app`) 추가

## 확인

- `https://○○○.vercel.app/` 를 열면 화면 맨 아래에 `서버 v1.0` 이 보이면 연결된 것
- 일정표를 올리고 지도·구간 거리·승강기 정보가 나오는지
- 위젯: 웹앱 아래 「홈 화면 위젯 주소」 → 「위젯 앱에 바로 연결」 (위젯 앱 1.12 이상)

## 옮길 때 알아 둘 것

- 위젯 주소와 공유 링크가 새 주소로 바뀐다. 각자 웹앱을 새 주소로 한 번 열고 위젯을 다시 연결해야 한다
- 앱스 스크립트에 저장된 것(직접 고친 현장 주소, 공유 일정표)은 옮겨지지 않는다. 새로 올리면 된다
- 앱스 스크립트 웹앱은 바로 지우지 말고, 모두 옮길 때까지 같이 둔다

## 회사 메일 인증 켜기

메일 보낼 계정을 넣으면 그때부터 **회사 메일(@koelsa.or.kr)로 확인한 휴대폰만** 일정·위젯·일정표 올리기를 쓸 수 있습니다. 넣기 전에는 지금처럼 누구나 됩니다.

1. 인증 메일 전용 **Gmail 계정**을 하나 만듭니다 (예: `todaysite.mail@gmail.com`)
2. 그 계정에서 **2단계 인증**을 켭니다 (Google 계정 → 보안)
3. Google 계정 → 보안 → **앱 비밀번호** → 이름 「오늘 현장」 → 16자리 비밀번호 복사
4. Vercel → 프로젝트 → Settings → **Environment Variables** 에 추가

| 이름 | 값 |
|---|---|
| `SMTP_USER` | 그 Gmail 주소 |
| `SMTP_PASS` | 16자리 앱 비밀번호 (띄어쓰기 없이) |
| `AUTH_SECRET` | 아무 긴 글자 (예: 비밀번호 생성기로 32자) — 인증번호를 서버에 그대로 남기지 않는 데 씀 |
| `REVIEW_LOGIN` | (플레이스토어 심사 때만) `review@koelsa.or.kr:246810` 처럼 메일:6자리 |
| `AUTH_DOMAIN` | (보통 안 넣음) 회사 메일 주소 끝. 기본값 `koelsa.or.kr` |

5. Deployments → 마지막 배포 → **Redeploy**

**먼저 담당자 메일로 시험**: 앱을 열면 「회사 메일로 한 번만 확인할게요」가 나옵니다. 내 메일 아이디를 넣고 메일이 오는지(스팸함 포함) 확인하세요.

- 메일은 하루 400통까지만 보냅니다 (Gmail 한도 500통). 같은 메일은 1분에 한 번, 하루 8번까지.
- 인증은 휴대폰마다 처음 한 번입니다. 앱 데이터를 지우거나 다른 휴대폰이면 다시 합니다.
- 위젯도 인증이 필요합니다: **앱 2.6 이상**에서 인증하면 위젯도 바로 됩니다. 2.5 이하 앱의 위젯은 「회사 메일 인증이 필요해요」만 나오니 앱을 업데이트하세요.
- 끄려면 `SMTP_USER`·`SMTP_PASS` 를 지우고 Redeploy.
