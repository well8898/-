/**
 * 내 검사 일정 — 별도 Apps Script 웹앱 (여비 청구 웹앱과 무관한 새 프로젝트)
 *
 * ▶ 파일: Code.gs(이 파일)만 있으면 됨. 화면(Index.html)은 GitHub에서 읽어 옴 (PAGE_URL)
 * ▶ 스크립트 속성 (프로젝트 설정 → 스크립트 속성)
 *   - KAKAO_REST_API_KEY : 카카오 REST API 키 (현장 위치 검색·자동차 길찾기)
 *   - KAKAO_JS_KEY       : 카카오 JavaScript 키 (화면 지도)
 *                          카카오 디벨로퍼스 → 앱 → 플랫폼 → Web 사이트 도메인에 웹앱 도메인 등록
 *   - ORIGIN_NAME        : (선택) 출발·도착 지점 이름. 기본 '고양파주지사'
 *   - ORIGIN_ADDRESS     : (선택) 출발·도착 주소. 기본 '경기 고양시 일산서구 킨텍스로 217-59'
 */

const ORIGIN_DEFAULT = { name: '고양파주지사', address: '경기 고양시 일산서구 킨텍스로 217-59' };
const CACHE_SEC = 21600; // 6시간

// 화면(HTML)은 GitHub에서 바로 읽어 옴 → 긴 HTML을 붙여 넣을 필요 없음, 화면 수정도 자동 반영
// (GitHub를 못 읽을 때만 이 프로젝트의 Index 파일을 씀. Index 파일은 없어도 됨)
const PAGE_URL = 'https://raw.githubusercontent.com/well8898/-/'
  + 'claude/nifty-sagan-s6rbvp/my-schedule/apps-script/Index.html';

function doGet() {
  return HtmlService.createHtmlOutput(pageHtml_())
    .setTitle('내 검사 일정')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function pageHtml_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('page');
  if (hit) return hit;
  try {
    const res = UrlFetchApp.fetch(PAGE_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const html = res.getContentText('UTF-8');
      try { cache.put('page', html, 600); } catch (e) { /* 너무 크면 캐시 생략 */ }
      return html;
    }
  } catch (e) { /* 아래 Index 파일로 */ }
  try {
    return HtmlService.createHtmlOutputFromFile('Index').getContent();
  } catch (e) {
    throw new Error('화면 파일을 GitHub에서 읽지 못했고 Index 파일도 없습니다: ' + PAGE_URL);
  }
}

// 화면 시작 시: 지도 키 + 출발지 좌표
function getConfig() {
  try {
    const props = PropertiesService.getScriptProperties();
    let origin = null;
    try { origin = originPlace_(); } catch (e) { /* 출발지 없이 현장끼리만 계산 */ }
    return { ok: true, kakaoJsKey: props.getProperty('KAKAO_JS_KEY') || '', origin: origin };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

function originPlace_() {
  const props = PropertiesService.getScriptProperties();
  const name = props.getProperty('ORIGIN_NAME') || ORIGIN_DEFAULT.name;
  const address = props.getProperty('ORIGIN_ADDRESS') || ORIGIN_DEFAULT.address;
  return cached_('origin:' + address, () => {
    const ad = kakaoGet_('https://dapi.kakao.com/v2/local/search/address.json?size=1&query=' + encodeURIComponent(address));
    const d = (ad.documents || [])[0];
    if (!d) throw new Error('출발지 주소를 찾지 못했습니다: ' + address);
    return { lat: Number(d.y), lng: Number(d.x), name: name };
  });
}

// sites: [{ q: 검색어, region: '파주시', area: '목동동', name: '산내마을2단지센트럴리움아파트' }]
// → { ok, places: { 검색어: { lat, lng, name } } }   못 찾은 현장은 빠짐 (지도·거리 계산에서 제외)
function geocodeSites(sites) {
  try {
    const places = {};
    (Array.isArray(sites) ? sites : []).slice(0, 60).forEach(s => {
      const q = String((s && s.q) || '').trim();
      if (!q || q in places) return;
      let p = null;
      try { p = cached_('site:' + q, () => findSite_(s)); } catch (e) { /* 이 현장만 건너뜀 */ }
      if (p) places[q] = p;
    });
    return { ok: true, places: places };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 상호 검색 결과 중 일정표의 동·읍·면에 있는 곳만 채택 (엉뚱한 지역에 핀이 찍히지 않게)
function findSite_(s) {
  const base = 'https://dapi.kakao.com/v2/local/search/';
  const area = String(s.area || '').trim();
  const city = String(s.region || '').split(' ')[0];
  const name = String(s.name || '').trim();
  const within = d => {
    const a = ' ' + (d.address_name || '') + ' ' + (d.road_address_name || '');
    return area ? a.indexOf(' ' + area) >= 0 : (!city || a.indexOf(city) >= 0);
  };
  const queries = [String(s.q || ''), name, city ? city + ' ' + name : ''].filter(Boolean);
  for (let i = 0; i < queries.length; i++) {
    const kw = kakaoGet_(base + 'keyword.json?size=15&query=' + encodeURIComponent(queries[i]));
    const d = (kw.documents || []).find(within);
    if (d) return { lat: Number(d.y), lng: Number(d.x), name: d.place_name || name };
  }
  // 이름이 지번·도로명 주소인 경우 (예: 덕은동746, 지축4로 37)
  if (/\d/.test(name)) {
    const q = [s.region, area, name.indexOf(area) === 0 ? name.slice(area.length) : name].filter(Boolean).join(' ');
    const ad = kakaoGet_(base + 'address.json?size=1&query=' + encodeURIComponent(q));
    const d = (ad.documents || [])[0];
    if (d) return { lat: Number(d.y), lng: Number(d.x), name: name };
  }
  return null;
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
  const key = PropertiesService.getScriptProperties().getProperty('KAKAO_REST_API_KEY');
  if (!key) throw new Error('스크립트 속성에 KAKAO_REST_API_KEY가 없습니다.');
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'KakaoAK ' + key }, muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code === 401 || code === 403) throw new Error('카카오 API 권한 오류(' + code + '). REST API 키와 카카오맵·카카오모빌리티 API 사용 설정을 확인하세요.');
  if (code !== 200) throw new Error('카카오 API 오류(' + code + '): ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

// 편집기에서 실행해 설정 확인
function testSetup() {
  Logger.log(getConfig());
  Logger.log(geocodeSites([{ q: '파주시 목동동 산내마을2단지센트럴리움아파트', region: '파주시', area: '목동동', name: '산내마을2단지센트럴리움아파트' }]));
}
