/**
 * 내 검사 일정 — 별도 Apps Script 웹앱 (여비 청구 웹앱과 무관한 새 프로젝트)
 *
 * ▶ 파일: Code.gs(이 파일) + Index(HTML). Index 파일이 없으면 화면을 GitHub에서 읽어 옴 (PAGE_URL)
 * ▶ 스크립트 속성 (프로젝트 설정 → 스크립트 속성)
 *   - KAKAO_REST_API_KEY : 카카오 REST API 키 (현장 위치 검색·자동차 길찾기)
 *   - KAKAO_JS_KEY       : 카카오 JavaScript 키 (화면 지도)
 *                          카카오 디벨로퍼스 → 앱 → 플랫폼 → Web 사이트 도메인에 웹앱 도메인 등록
 * ▶ 출발 지사는 화면에서 정함 (일정표 제목 → 지난번 선택 → 현장 동네로 추측 → 직접 선택)
 */

const CACHE_SEC = 21600;   // 6시간
const REGION_KM = 50;      // 지사에서 이 거리(km) 밖의 검색 결과는 버림 (관할 지역 안에서만 핀)

// 화면(HTML): 이 프로젝트에 Index 파일이 있으면 그것을 쓰고, 없으면 GitHub에서 읽어 옴
const PAGE_URL = 'https://raw.githubusercontent.com/well8898/-/'
  + 'claude/nifty-sagan-s6rbvp/my-schedule/apps-script/Index.html';

function doGet() {
  return HtmlService.createHtmlOutput(pageHtml_())
    .setTitle('내 검사 일정')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function pageHtml_() {
  try {
    return HtmlService.createHtmlOutputFromFile('Index').getContent();
  } catch (e) { /* Index 파일 없음 → GitHub */ }
  const cache = CacheService.getScriptCache();
  const hit = cache.get('page');
  if (hit) return hit;
  const res = UrlFetchApp.fetch(PAGE_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Index 파일이 없고 GitHub에서도 화면을 읽지 못했습니다: ' + PAGE_URL);
  }
  const html = res.getContentText('UTF-8');
  try { cache.put('page', html, 600); } catch (e) { /* 너무 크면 캐시 생략 */ }
  return html;
}

// 화면 시작 시: 지도 키
function getConfig() {
  try {
    const key = PropertiesService.getScriptProperties().getProperty('KAKAO_JS_KEY') || '';
    return { ok: true, kakaoJsKey: key.trim() };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 지사 이름·주소 → { ok, origin: { lat, lng, name } }  (좌표는 스크립트 속성에 영구 저장)
function getOrigin(name, address) {
  try {
    const p = branchPoint_(name, address);
    if (!p) throw new Error('지사 주소를 찾지 못했습니다: ' + address);
    return { ok: true, origin: { lat: p.lat, lng: p.lng, name: name } };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 지사 좌표는 스크립트 속성 BRANCH_POINTS 하나에 모아서 저장 ({ 지사이름: {lat,lng} })
function branchPoint_(name, address) {
  const props = PropertiesService.getScriptProperties();
  const all = JSON.parse(props.getProperty('BRANCH_POINTS') || '{}');
  if (all[name]) return all[name];
  const q = String(address || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const ad = kakaoGet_('https://dapi.kakao.com/v2/local/search/address.json?size=1&query=' + encodeURIComponent(q));
  let d = (ad.documents || [])[0];
  if (!d) {
    const kw = kakaoGet_('https://dapi.kakao.com/v2/local/search/keyword.json?size=1&query='
      + encodeURIComponent('한국승강기안전공단 ' + name));
    d = (kw.documents || [])[0];
  }
  if (!d) return null;
  all[name] = { lat: Number(d.y), lng: Number(d.x) };
  props.setProperty('BRANCH_POINTS', JSON.stringify(all));
  return all[name];
}

// 예전 버전이 지사마다 만든 BR_… 속성을 BRANCH_POINTS 하나로 합치고 지움 (속성 50개 넘김 해결)
// 편집기에서 한 번 실행하세요
function cleanupProperties() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperties();
  const all = JSON.parse(raw.BRANCH_POINTS || '{}');
  let n = 0;
  Object.keys(raw).forEach(k => {
    if (k.indexOf('BR_') !== 0) return;
    try { all[k.slice(3)] = JSON.parse(raw[k]); } catch (e) { /* 버림 */ }
    props.deleteProperty(k);
    n++;
  });
  props.setProperty('BRANCH_POINTS', JSON.stringify(all));
  Logger.log('정리한 속성 ' + n + '개 · 남은 속성 ' + Object.keys(props.getProperties()).length + '개');
}

// 인증키를 코드로 넣기 (속성 화면에서 추가가 안 될 때): 아래 따옴표 안에 키를 넣고 한 번 실행한 뒤, 키는 다시 지우세요
function setDataGoKrKey() {
  const key = '';
  if (!key) { Logger.log('함수 안의 key 따옴표에 인증키를 넣고 실행하세요.'); return; }
  PropertiesService.getScriptProperties().setProperty('DATA_GO_KR_KEY', key.trim());
  Logger.log('DATA_GO_KR_KEY 저장 완료. 이제 코드의 키를 지우고 저장하세요.');
}

// 현장이 많은 동·읍·면 이름들 → 그 동네들과 가장 잘 맞는 지사
// areas: ['북면', '삼계동', ...]  branches: [[이름, 주소], ...]  → { ok, branch, hits }
function guessBranch(areas, branches) {
  try {
    const list = (Array.isArray(areas) ? areas : []).slice(0, 10);
    // 동네 이름마다 전국의 같은 이름 후보 좌표
    const cands = list.map(a => cached_('area:' + a, () => {
      const r = kakaoGet_('https://dapi.kakao.com/v2/local/search/address.json?size=30&query=' + encodeURIComponent(a));
      return (r.documents || [])
        .filter(d => (d.address_name || '').split(' ').pop() === a)
        .map(d => [Number(d.y), Number(d.x)]);
    }) || []);
    let best = null;
    (Array.isArray(branches) ? branches : []).forEach(b => {
      let p = null;
      try { p = branchPoint_(b[0], b[1]); } catch (e) { /* 건너뜀 */ }
      if (!p) return;
      let hits = 0, sum = 0;
      cands.forEach(c => {
        const m = c.length ? Math.min.apply(null, c.map(x => km_(p.lat, p.lng, x[0], x[1]))) : 999;
        if (m <= 35) hits++;
        sum += Math.min(m, 200);
      });
      if (!best || hits > best.hits || (hits === best.hits && sum < best.sum)) {
        best = { branch: b[0], hits: hits, sum: sum };
      }
    });
    if (!best || !best.hits) return { ok: false, message: '추측할 수 없음' };
    return { ok: true, branch: best.branch, hits: best.hits };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// sites: [{ q: 검색어, region, area: '삼계동', name: '김해북부두산위브아파트' }]  origin: 지사 좌표
// → { ok, places: { 검색어: { lat, lng, name } } }   못 찾은 현장·관할 밖 결과는 빠짐
function geocodeSites(sites, origin) {
  try {
    const places = {};
    const o = origin && origin.lat ? origin : null;
    (Array.isArray(sites) ? sites : []).slice(0, 60).forEach(s => {
      const q = String((s && s.q) || '').trim();
      if (!q || q in places) return;
      let p = null;
      const ck = 'site:' + q + '@' + (o ? o.lat.toFixed(3) + ',' + o.lng.toFixed(3) : '');
      try { p = cached_(ck, () => findSite_(s, o)); } catch (e) { /* 이 현장만 건너뜀 */ }
      if (p) places[q] = p;
    });
    return { ok: true, places: places };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 상호 검색 결과 중 일정표의 동·읍·면에 있고, 지사에서 가까운 곳 (REGION_KM 안)
function findSite_(s, o) {
  const base = 'https://dapi.kakao.com/v2/local/search/';
  const area = String(s.area || '').trim();
  const name = String(s.name || '').trim();
  const near = o ? '&x=' + o.lng + '&y=' + o.lat + '&sort=distance' : '';
  const ok = d => {
    const a = ' ' + (d.address_name || '') + ' ' + (d.road_address_name || '');
    if (area && a.indexOf(' ' + area) < 0) return false;
    return !o || km_(o.lat, o.lng, Number(d.y), Number(d.x)) <= REGION_KM;
  };
  const queries = [String(s.q || ''), area + ' ' + name, name].filter(Boolean);
  for (let i = 0; i < queries.length; i++) {
    const kw = kakaoGet_(base + 'keyword.json?size=15&query=' + encodeURIComponent(queries[i]) + near);
    const d = (kw.documents || []).find(ok);
    if (d) return { lat: Number(d.y), lng: Number(d.x), name: d.place_name || name };
  }
  // 이름이 지번·도로명 주소인 경우 (예: 덕은동746, 지축4로 37)
  if (/\d/.test(name)) {
    const q = [s.region, area, name.indexOf(area) === 0 ? name.slice(area.length) : name].filter(Boolean).join(' ');
    const ad = kakaoGet_(base + 'address.json?size=5&query=' + encodeURIComponent(q));
    const d = (ad.documents || []).find(ok);
    if (d) return { lat: Number(d.y), lng: Number(d.x), name: name };
  }
  return null;
}

// 두 좌표 사이 직선거리 (km)
function km_(a, b, c, d) {
  const r = Math.PI / 180;
  const x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

// pairs: [[출발 위도, 경도, 도착 위도, 경도], ...] → { ok, km: [구간별 km(소수 1자리) | null] }  자동차 추천경로
function routeLegs(pairs) {
  try {
    const km = (Array.isArray(pairs) ? pairs : []).slice(0, 30).map(p => {
      try {
        return cached_('leg:' + p.map(v => Number(v).toFixed(5)).join(','), () => {
          const url = 'https://apis-navi.kakaomobility.com/v1/directions'
            + '?origin=' + p[1] + ',' + p[0] + '&destination=' + p[3] + ',' + p[2] + '&priority=RECOMMEND';
          const route = (kakaoGet_(url).routes || [])[0];
          if (!route) return null;
          if (route.result_code === 104) return 0; // 출발지 = 도착지
          if (route.result_code !== 0) return null;
          return Math.round(route.summary.distance / 100) / 10;
        });
      } catch (e) {
        return null;
      }
    });
    return { ok: true, km: km };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 결과(값이 있을 때만)를 6시간 캐시
function cached_(key, fn) {
  const cache = CacheService.getScriptCache();
  const ck = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, key, Utilities.Charset.UTF_8));
  const hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  const v = fn();
  if (v !== null && v !== undefined) cache.put(ck, JSON.stringify(v), CACHE_SEC);
  return v;
}

function kakaoGet_(url) {
  const key = (PropertiesService.getScriptProperties().getProperty('KAKAO_REST_API_KEY') || '').trim();
  if (!key) throw new Error('스크립트 속성에 KAKAO_REST_API_KEY가 없습니다.');
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'KakaoAK ' + key }, muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code === 401 || code === 403) throw new Error('카카오 API 권한 오류(' + code + '). REST API 키와 카카오맵·카카오모빌리티 API 사용 설정을 확인하세요.');
  if (code !== 200) throw new Error('카카오 API 오류(' + code + '): ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

// 편집기에서 실행해 설정 확인
// 편집기에서 실행해 설정 확인
function testSetup() {
  Logger.log(getConfig());
  const o = getOrigin('고양파주지사', '경기 고양시 일산서구 킨텍스로 217-59');
  Logger.log(o);
  Logger.log(geocodeSites([{ q: '파주시 목동동 산내마을2단지센트럴리움아파트', region: '파주시',
    area: '목동동', name: '산내마을2단지센트럴리움아파트' }], o.origin));
}

// ── 승강기정보 API(공공데이터포털) 확인용: 편집기에서 실행 → 실행 로그를 복사해서 보내 주세요 ──
// 스크립트 속성 DATA_GO_KR_KEY 에 공공데이터포털 '일반 인증키'를 넣고 실행
function testElevatorApi() {
  const key = (PropertiesService.getScriptProperties().getProperty('DATA_GO_KR_KEY') || '').trim();
  if (!key) { Logger.log('스크립트 속성에 DATA_GO_KR_KEY가 없습니다.'); return; }
  const base = 'https://apis.data.go.kr/B553664/BuldElevatorService/getBuldElvtrList'
    + '?serviceKey=' + encodeURIComponent(key) + '&numOfRows=3&pageNo=1';
  const tries = ['', '&buld_nm=' + encodeURIComponent('일신2조합빌딩'),
    '&buldNm=' + encodeURIComponent('일신2조합빌딩'),
    '&buld_address=' + encodeURIComponent('고양시 일산서구 일산동'),
    '&_type=json'];
  tries.forEach(t => {
    const res = UrlFetchApp.fetch(base + t, { muteHttpExceptions: true });
    Logger.log('▶ ' + (t || '(조건 없음)') + ' → ' + res.getResponseCode() + '\n'
      + res.getContentText('UTF-8').slice(0, 1500));
  });
}
