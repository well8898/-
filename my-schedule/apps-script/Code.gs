/**
 * 내 검사 일정 — 별도 Apps Script 웹앱 (여비 청구 웹앱과 무관한 새 프로젝트)
 *
 * ▶ 파일: Code.gs(이 파일) + Index(HTML). Index 파일이 없으면 화면을 GitHub에서 읽어 옴 (PAGE_URL)
 * ▶ 스크립트 속성 (프로젝트 설정 → 스크립트 속성)
 *   - KAKAO_REST_API_KEY : 카카오 REST API 키 (현장 위치 검색·자동차 길찾기)
 *   - KAKAO_JS_KEY       : 카카오 JavaScript 키 (화면 지도)
 *   - TMAP_APP_KEY       : (선택) SK open API 티맵 앱키 — 있으면 구간 거리·시간을 티맵 추천경로로
 *   - DATA_GO_KR_KEY     : (선택) 공공데이터포털 인증키 — 승강기검사접수정보로 현장 실주소 찾기
 *                          카카오 디벨로퍼스 → 앱 → 플랫폼 → Web 사이트 도메인에 웹앱 도메인 등록
 * ▶ 출발 지사는 화면에서 정함 (일정표 제목 → 지난번 선택 → 현장 동네로 추측 → 직접 선택)
 */

const CACHE_SEC = 21600;   // 6시간
const REGION_KM = 50;      // 지사에서 이 거리(km) 밖의 검색 결과는 버림 (관할 지역 안에서만 핀)

// 화면(HTML): 이 프로젝트에 Index 파일이 있으면 그것을 쓰고, 없으면 GitHub에서 읽어 옴
const PAGE_URL = 'https://raw.githubusercontent.com/well8898/-/'
  + 'my-schedule/my-schedule/apps-script/Index.html';
// 건물 주소록: 승강기 설치 현황(공공데이터) → 건물명별 주소, 128조각으로 나눈 JSON
const BOOK_URL = 'https://raw.githubusercontent.com/well8898/-/'
  + 'my-schedule/my-schedule/data/bld/';

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
    const props = PropertiesService.getScriptProperties();
    const key = props.getProperty('KAKAO_JS_KEY') || '';
    // 티맵 앱키는 '티맵 길안내' 버튼(티맵 앱 실행 링크)에도 씀
    return { ok: true, kakaoJsKey: key.trim(), tmapKey: (props.getProperty('TMAP_APP_KEY') || '').trim() };
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

// 아직 좌표가 없는 지사들의 주소를 한꺼번에(병렬) 검색해 BRANCH_POINTS에 저장
function prefetchBranches_(branches) {
  const props = PropertiesService.getScriptProperties();
  const all = JSON.parse(props.getProperty('BRANCH_POINTS') || '{}');
  const miss = (Array.isArray(branches) ? branches : []).filter(b => !all[b[0]]);
  if (!miss.length) return;
  const key = getKakaoKey_();
  const res = UrlFetchApp.fetchAll(miss.map(b => ({
    url: 'https://dapi.kakao.com/v2/local/search/address.json?size=1&query='
      + encodeURIComponent(String(b[1] || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()),
    headers: { Authorization: 'KakaoAK ' + key }, muteHttpExceptions: true,
  })));
  res.forEach((r, i) => {
    try {
      const d = (JSON.parse(r.getContentText()).documents || [])[0];
      if (d) all[miss[i][0]] = { lat: Number(d.y), lng: Number(d.x) };
    } catch (e) { /* 이 지사는 나중에 개별 검색 */ }
  });
  props.setProperty('BRANCH_POINTS', JSON.stringify(all));
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
    prefetchBranches_(branches);
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
      const ck = 'site3:' + q + '|' + (s.addr || '') + '@' + (o ? o.lat.toFixed(3) + ',' + o.lng.toFixed(3) : '');
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
  // 실주소: 검사접수정보(정밀·설치·수시)에서 찾은 것 → 없으면 건물 주소록(정기 포함 전체)
  if (!s.addr) {
    const cands = bookCandidates_(name, area);
    for (let i = 0; i < Math.min(cands.length, 5); i++) {
      const p = addrPoint_(cands[i], o);
      if (p) return { lat: p.lat, lng: p.lng, name: name, addr: cands[i] };
    }
  }
  if (s.addr) {
    const ad = kakaoGet_(base + 'address.json?size=3&query=' + encodeURIComponent(cleanAddr_(s.addr)));
    const d = (ad.documents || []).find(x => !o || km_(o.lat, o.lng, Number(x.y), Number(x.x)) <= REGION_KM);
    if (d) return { lat: Number(d.y), lng: Number(d.x), name: name, addr: s.addr };
    const kw = kakaoGet_(base + 'keyword.json?size=5&query=' + encodeURIComponent(cleanAddr_(s.addr)) + near);
    const k = (kw.documents || []).find(x => !o || km_(o.lat, o.lng, Number(x.y), Number(x.x)) <= REGION_KM);
    if (k) return { lat: Number(k.y), lng: Number(k.x), name: name, addr: s.addr };
  }
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

// ── 승강기검사접수정보 (공공데이터포털 ElevatorRecptnService) ──
// 검사 예정일 기간의 접수 건 → 건물명·실주소 목록. 지사 이름을 주면 그 지사 건만
// → { ok, list: [{ d: 'yyyyMMdd', nm: 건물명, addr: 주소, kind: 정기/정밀/수시/설치 }] }
function recptnList(st, en, branch) {
  try {
    const key = (PropertiesService.getScriptProperties().getProperty('DATA_GO_KR_KEY') || '').trim();
    if (!key) return { ok: true, list: [], note: 'DATA_GO_KR_KEY 없음' };
    const list = cached_('recptn4:' + st + '-' + en + ':' + (branch || ''), () => {
      const out = [];
      for (let page = 1; page <= 10; page++) {
        const url = 'https://apis.data.go.kr/B553664/ElevatorRecptnService/getRecptnV1'
          + '?serviceKey=' + encodeURIComponent(key) + '&_type=json&numOfRows=1000&pageNo=' + page
          + '&inspct_st_de=' + st + '&inspct_en_de=' + en;
        const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) throw new Error('검사접수정보 오류(' + res.getResponseCode() + ')');
        const body = (JSON.parse(res.getContentText('UTF-8')).response || {}).body || {};
        let items = (body.items && body.items.item) || [];
        if (!Array.isArray(items)) items = [items];
        items.forEach(it => {
          if (branch && String(it.inspctInsttNm || '') !== branch) return;
          out.push({ d: String(it.inspctDt), nm: String(it.buldNm || '').trim(),
            addr: String(it.address || '').trim(), kind: String(it.inspctKindNm || ''),
            inst: String(it.inspctInsttNm || '').trim(),
            mnt: String(it.ledgMntCompanyNm || '').trim(), tel: String(it.ledgMntHedofcTelno || '').trim(),
            mfr: String(it.ledgMnfcturCompanyNm || '').trim(),
            mfrTel: String(it.ledgMnfcturHedofcTelno || it.reqstMnfcturCompanyTelno || '').trim(),
            form: [it.ledgElvtrDiv, it.ledgElvtrForm].map(x => String(x || '').trim()).filter(Boolean).join(' · ') });
        });
        if (page * 1000 >= Number(body.totalCount || 0)) break;
      }
      return out;
    });
    return { ok: true, list: list || [] };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 주소 → 좌표 (지사에서 REGION_KM 안일 때만)
function addrPoint_(addr, o) {
  const base = 'https://dapi.kakao.com/v2/local/search/';
  const ad = kakaoGet_(base + 'address.json?size=3&query=' + encodeURIComponent(cleanAddr_(addr)));
  const d = (ad.documents || []).find(x => !o || km_(o.lat, o.lng, Number(x.y), Number(x.x)) <= REGION_KM);
  return d ? { lat: Number(d.y), lng: Number(d.x) } : null;
}

const BOOK_SHARDS = {}; // 한 번 실행 동안 받은 주소록 조각

// 건물 주소록에서 건물명으로 주소 후보 (일정표의 동이 들어간 주소를 앞으로)
function bookCandidates_(name, area) {
  const k = bookKey_(name);
  if (k.length < 2) return [];
  let v = 5381;
  for (let i = 0; i < k.length; i++) v = (v * 33 + k.charCodeAt(i)) % 4294967296;
  const file = ('00' + (v % 128)).slice(-3) + '.json';
  let shard = BOOK_SHARDS[file];
  if (!shard) {
    try {
      const res = UrlFetchApp.fetch(BOOK_URL + file, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) return [];
      shard = BOOK_SHARDS[file] = JSON.parse(res.getContentText('UTF-8'));
    } catch (e) {
      return [];
    }
  }
  const list = shard[k] || [];
  if (!area) return list;
  const hit = list.filter(a => a.indexOf(area) >= 0);
  return hit.length ? hit : list;
}

// 건물명 → 주소록 키 (data/bld 를 만든 규칙과 같아야 함)
function bookKey_(n) {
  let x = String(n || '').replace(/\(주\)|㈜/g, '').replace(/\([^)]*$/, '')
    .replace(/\s*[A-Z0-9,\s]+동(,\s*[A-Z0-9]+동)*\s*$/, '').replace(/\s+/g, ' ').trim() || String(n || '');
  return x.replace(/주식회사/g, '').replace(/[\s()·\-_.,#]/g, '').replace(/아파트$/, '');
}

// 접수 주소 → 카카오 주소 검색용 ('(장전동)', '일원', 쉼표 뒤 등 정리)
function cleanAddr_(a) {
  return String(a || '').replace(/\([^)]*\)?/g, ' ').split(',')[0]
    .replace(/일원|번지/g, ' ').replace(/\s+/g, ' ').trim();
}

// 두 좌표 사이 직선거리 (km)
function km_(a, b, c, d) {
  const r = Math.PI / 180;
  const x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

// pairs: [[출발 위도, 경도, 도착 위도, 경도], ...]
// → { ok, km: [구간 km(소수 1자리) | null], min: [구간 분 | null], src: 'TMAP' | '카카오' }  자동차 추천경로
// 스크립트 속성 TMAP_APP_KEY 가 있으면 티맵, 없거나 실패한 구간은 카카오내비. 캐시 없는 구간은 한꺼번에(병렬) 요청
function routeLegs(pairs) {
  try {
    const tmapKey = (PropertiesService.getScriptProperties().getProperty('TMAP_APP_KEY') || '').trim();
    const list = (Array.isArray(pairs) ? pairs : []).slice(0, 30);
    const cache = CacheService.getScriptCache();
    const ids = list.map(p => 'leg3:' + p.map(v => Number(v).toFixed(5)).join(','));
    const hit = cache.getAll(ids);
    const out = list.map((p, i) => (hit[ids[i]] ? JSON.parse(hit[ids[i]]) : null));
    let src = tmapKey ? 'TMAP' : '카카오';
    const todo = () => out.map((r, i) => (r ? -1 : i)).filter(i => i >= 0);
    todo().forEach(i => {
      const p = list[i];
      if (Math.abs(p[0] - p[2]) < 1e-5 && Math.abs(p[1] - p[3]) < 1e-5) out[i] = { km: 0, min: 0 };
    });
    if (tmapKey && todo().length) {
      const idx = todo();
      const res = UrlFetchApp.fetchAll(idx.map(i => ({
        url: 'https://apis.openapi.sk.com/tmap/routes?version=1&format=json',
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { appKey: tmapKey },
        payload: JSON.stringify({ startX: String(list[i][1]), startY: String(list[i][0]),
          endX: String(list[i][3]), endY: String(list[i][2]),
          reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', searchOption: '0' }),
      })));
      res.forEach((r, n) => {
        try {
          if (r.getResponseCode() !== 200) return;
          const f = (JSON.parse(r.getContentText()).features || [])[0];
          const pr = f && f.properties;
          if (pr && pr.totalDistance != null) {
            out[idx[n]] = { km: Math.round(pr.totalDistance / 100) / 10, min: Math.round((pr.totalTime || 0) / 60) };
          }
        } catch (e) { /* 이 구간은 카카오로 */ }
      });
    }
    if (todo().length) {
      const key = getKakaoKey_();
      const idx = todo();
      const res = UrlFetchApp.fetchAll(idx.map(i => ({
        url: 'https://apis-navi.kakaomobility.com/v1/directions?origin=' + list[i][1] + ',' + list[i][0]
          + '&destination=' + list[i][3] + ',' + list[i][2] + '&priority=RECOMMEND',
        headers: { Authorization: 'KakaoAK ' + key }, muteHttpExceptions: true,
      })));
      res.forEach((r, n) => {
        try {
          const route = (JSON.parse(r.getContentText()).routes || [])[0];
          if (!route) return;
          if (route.result_code === 104) out[idx[n]] = { km: 0, min: 0 };
          else if (route.result_code === 0) {
            out[idx[n]] = { km: Math.round(route.summary.distance / 100) / 10,
              min: Math.round(route.summary.duration / 60) };
          }
          if (tmapKey && out[idx[n]]) src = 'TMAP·카카오';
        } catch (e) { /* 계산 실패 구간 */ }
      });
    }
    const put = {};
    out.forEach((r, i) => { if (r && !hit[ids[i]]) put[ids[i]] = JSON.stringify(r); });
    if (Object.keys(put).length) {
      try { cache.putAll(put, CACHE_SEC); } catch (e) { /* 생략 */ }
    }
    return { ok: true, km: out.map(r => (r ? r.km : null)), min: out.map(r => (r ? r.min : null)), src: src };
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
  if (v !== null && v !== undefined) {
    try { cache.put(ck, JSON.stringify(v), CACHE_SEC); } catch (e) { /* 100KB 넘으면 캐시 생략 */ }
  }
  return v;
}

function getKakaoKey_() {
  const key = (PropertiesService.getScriptProperties().getProperty('KAKAO_REST_API_KEY') || '').trim();
  if (!key) throw new Error('스크립트 속성에 KAKAO_REST_API_KEY가 없습니다.');
  return key;
}

function kakaoGet_(url) {
  const key = getKakaoKey_();
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'KakaoAK ' + key }, muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code === 401 || code === 403) throw new Error('카카오 API 권한 오류(' + code + '). REST API 키와 카카오맵·카카오모빌리티 API 사용 설정을 확인하세요.');
  if (code !== 200) throw new Error('카카오 API 오류(' + code + '): ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

// 편집기에서 실행해 설정 확인
// 편집기에서 실행해 설정 확인
function testSetup() {
  const props = PropertiesService.getScriptProperties();
  ['KAKAO_REST_API_KEY', 'KAKAO_JS_KEY', 'TMAP_APP_KEY', 'DATA_GO_KR_KEY'].forEach(k =>
    Logger.log(k + ': ' + (props.getProperty(k) ? '있음' : '없음')));
  const o = getOrigin('고양파주지사', '경기 고양시 일산서구 킨텍스로 217-59');
  Logger.log('지사 좌표: ' + JSON.stringify(o));
  Logger.log('주소록: 일신2조합빌딩 → ' + bookCandidates_('일신2조합빌딩', '일산동'));
  if (o.ok) {
    const g = geocodeSites([{ q: '일신2조합빌딩', area: '일산동', name: '일신2조합빌딩' }], o.origin);
    Logger.log('현장 위치: ' + JSON.stringify(g));
    const p = g.places && g.places['일신2조합빌딩'];
    if (p) Logger.log('거리: ' + JSON.stringify(routeLegs([[o.origin.lat, o.origin.lng, p.lat, p.lng]])));
  }
}

// 우리 지사 검사접수 건 확인: 지사 이름·기간을 바꿔 실행 → 실행 로그를 보내 주세요
function testBranchRecptn() {
  const branch = '고양파주지사', st = '20261012', en = '20261016';
  const r = recptnList(st, en, branch);
  if (!r.ok) { Logger.log('오류: ' + r.message); return; }
  Logger.log(branch + ' ' + st + '~' + en + ' 접수 ' + r.list.length + '건');
  r.list.slice(0, 40).forEach(x => Logger.log(x.d + ' · ' + x.kind + ' · ' + x.nm + ' · ' + x.addr + ' · 보수: ' + x.mnt + ' ' + x.tel));
  const all = recptnList(st, en, '');
  const inst = {};
  (all.list || []).forEach(x => { if (/고양|파주/.test(x.addr)) inst[x.inst] = (inst[x.inst] || 0) + 1; });
  Logger.log('주소가 고양·파주인 전체 접수의 검사 지사별 건수: ' + JSON.stringify(inst));
}
