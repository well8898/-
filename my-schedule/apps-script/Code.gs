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

function doGet(e) {
  if (e && e.parameter && e.parameter.w) return widgetOutput_(e); // 홈 화면 위젯
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
    let webUrl = '';
    try { webUrl = ScriptApp.getService().getUrl(); } catch (e) { /* 배포 전 */ }
    return { ok: true, kakaoJsKey: key.trim(), tmapKey: (props.getProperty('TMAP_APP_KEY') || '').trim(), webUrl: webUrl };
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

// ════════════════════════════════════════════════════
//  홈 화면 위젯: 웹앱이 저장한 '내 일정'을 개인 주소(?w=키)로 돌려줌
//  ?w=키            → JSON (KWGT 등 위젯 앱용)
//  ?w=키&fmt=text   → 줄글 (주소 내용을 그대로 띄우는 위젯 앱용)
// ════════════════════════════════════════════════════
const W_KEY_RE = /^[a-z0-9]{12,32}$/;

// 화면에서 호출: 내 일정 저장 (주 단위, 내 것만)
function saveWidget(key, data) {
  try {
    if (!W_KEY_RE.test(String(key || ''))) throw new Error('위젯 키가 올바르지 않습니다.');
    const json = JSON.stringify(Object.assign({}, data, { savedAt: Date.now() }));
    if (json.length > 8500) throw new Error('일정이 너무 커서 위젯에 저장하지 못했습니다.');
    PropertiesService.getScriptProperties().setProperty('W_' + key, json);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 화면에서 호출: 하루 이동거리(km) 계산이 끝나면 위젯 데이터에 더해 둠
function saveWidgetKm(key, iso, km) {
  try {
    if (!W_KEY_RE.test(String(key || ''))) return { ok: false };
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('W_' + key);
    if (!raw) return { ok: false };
    const data = JSON.parse(raw);
    (data.days || []).forEach(d => { if (d.iso === iso) d.km = Number(km) || null; });
    props.setProperty('W_' + key, JSON.stringify(data));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 화면에서 호출: 위젯 키를 바꿀 때 예전 키 데이터 삭제
function deleteWidget(key) {
  if (W_KEY_RE.test(String(key || ''))) PropertiesService.getScriptProperties().deleteProperty('W_' + key);
  return { ok: true };
}

function widgetOutput_(e) {
  const key = String(e.parameter.w || '');
  const raw = W_KEY_RE.test(key) ? PropertiesService.getScriptProperties().getProperty('W_' + key) : null;
  const out = raw ? widgetView_(withCoords_(key, JSON.parse(raw))) : { ok: false, title: '위젯 주소가 올바르지 않아요', text: '웹앱에서 일정표를 올린 뒤 위젯 주소를 다시 복사하세요.' };
  if (e.parameter.view) {
    return HtmlService.createHtmlOutput(widgetHtml_(out))
      .setTitle('오늘 현장')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (e.parameter.fmt === 'text') {
    return ContentService.createTextOutput(out.text || out.title).setMimeType(ContentService.MimeType.TEXT);
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// 위젯에 보여 줄 날(오늘부터 남은 근무일)의 현장 좌표가 없으면 찾아서 저장 (길안내 링크용, 처음 한 번만)
function withCoords_(key, data) {
  try {
    const tz = 'Asia/Seoul', today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const targets = (data.days || []).filter(d => d.iso >= today && d.stops && d.stops.length).slice(0, 7);
    const need = [];
    targets.forEach(d => d.stops.forEach(s => {
      if (s.lat == null && s.name && !need.some(x => x.q === s.name + '|' + (s.area || ''))) {
        need.push({ q: s.name + '|' + (s.area || ''), area: s.area || '', name: s.name, region: '' });
      }
    }));
    if (!need.length) return data;
    let origin = null;
    if (data.branch && data.branch[0]) {
      const o = getOrigin(data.branch[0], data.branch[1] || '');
      if (o.ok) origin = o.origin;
    }
    if (origin) data.origin = origin;
    const r = geocodeSites(need, origin);
    if (!r.ok) return data;
    targets.forEach(d => d.stops.forEach(s => {
      const p = r.places[s.name + '|' + (s.area || '')];
      if (p) { s.lat = p.lat; s.lng = p.lng; if (p.addr) s.addr = p.addr; } else if (s.lat == null) s.lat = false;
    }));
    PropertiesService.getScriptProperties().setProperty('W_' + key, JSON.stringify(data));
  } catch (e) { /* 좌표 없이 보여 줌 */ }
  return data;
}

// 길안내 링크: 카카오맵(앱/웹) · 티맵(앱 실행 링크, 앱키 있을 때) · 네이버지도 앱
function navLinks_(dest, lat, lng) {
  const de = encodeURIComponent(String(dest).replace(/[,/]/g, ' '));
  const tk = (PropertiesService.getScriptProperties().getProperty('TMAP_APP_KEY') || '').trim();
  return {
    kakao: 'https://map.kakao.com/link/to/' + de + ',' + lat + ',' + lng,
    tmap: tk ? 'https://apis.openapi.sk.com/tmap/app/routes?appKey=' + encodeURIComponent(tk)
      + '&name=' + de + '&lon=' + lng + '&lat=' + lat
      : 'tmap://route?goalname=' + de + '&goalx=' + lng + '&goaly=' + lat,
    naver: 'nmap://route/car?dlat=' + lat + '&dlng=' + lng + '&dname=' + de + '&appname=elevator.schedule',
  };
}

// 위젯 화면 (?w=키&view=1): A안 — 오늘 현장 목록, 줄마다 티맵 버튼, 하루 경로
function widgetHtml_(o) {
  const h = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let app = '';
  try { app = ScriptApp.getService().getUrl(); } catch (e) { /* 없음 */ }
  let rows = '';
  for (let i = 1; i <= 8; i++) {
    if (!o['n' + i]) continue;
    const link = o['t' + i] || o['k' + i];
    rows += '<div class="row' + (o['d' + i] === '1' ? ' done' : '') + '">'
      + '<span class="no">' + i + '</span><span class="t">' + h(o['h' + i]) + '</span>'
      + '<span class="n">' + h(o['n' + i]) + '<small>' + h(o['s' + i]) + '</small></span>'
      + (link ? '<a class="go" target="_blank" href="' + h(link) + '">티맵</a>' : '') + '</div>';
  }
  if (o.l8 && /^외 /.test(o.l8)) rows += '<div class="more">' + h(o.l8) + '</div>';
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>'
    + '*{box-sizing:border-box}html,body{margin:0;background:#121822;color:#eef3fb;'
    + 'font-family:"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif}'
    + 'body{padding:12px 12px 10px}.top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}'
    + '.top b{font-size:16px}.top span{font-size:11px;color:#9fb0c8;white-space:nowrap}'
    + '.sum{font-size:12.5px;color:#9fb0c8;margin:4px 0 10px}'
    + '.row{display:grid;grid-template-columns:22px 46px minmax(0,1fr) auto;gap:8px;align-items:center;'
    + 'background:rgba(255,255,255,.07);border-radius:14px;padding:8px 8px 8px 10px;margin-bottom:6px}'
    + '.no{width:20px;height:20px;border-radius:50%;background:#4b8df8;display:grid;place-items:center;font-size:11px;font-weight:800}'
    + '.t{font-weight:700;font-size:14px;font-variant-numeric:tabular-nums}'
    + '.n{font-size:14.5px;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.n small{display:block;font-size:11.5px;color:#9fb0c8;font-weight:400}'
    + '.go{background:#4b8df8;color:#fff;text-decoration:none;border-radius:11px;padding:9px 12px;font-size:13px;font-weight:800}'
    + '.done{opacity:.45}.more{font-size:12px;color:#9fb0c8;text-align:center;margin:2px 0 6px}'
    + '.bot{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px}'
    + '.bot a{display:block;text-align:center;color:#eef3fb;text-decoration:none;border:1px solid rgba(255,255,255,.2);'
    + 'border-radius:12px;padding:9px 0;font-size:13px;font-weight:700}.msg{color:#9fb0c8;font-size:13px;margin-top:8px}'
    + '</style></head><body>'
    + '<div class="top"><b>' + h(o.title) + '</b><span>' + h(o.updated ? o.updated + ' 저장' : '') + '</span></div>'
    + (o.sub ? '<div class="sum">' + h(o.sub) + '</div>' : '<div class="msg">' + h(o.text || '') + '</div>')
    + rows
    + '<div class="bot">' + (o.rk ? '<a target="_blank" href="' + h(o.rk) + '">하루 경로 · 카카오</a>' : '<span></span>')
    + (app ? '<a target="_blank" href="' + h(app) + '">웹앱 열기</a>' : '') + '</div>'
    + '</body></html>';
}

// 저장된 주간 일정 → 지금 보여 줄 하루 (오후 6시 이후거나 오늘 근무가 없으면 다음 근무일)
function widgetView_(data) {
  const tz = 'Asia/Seoul', now = new Date();
  const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const hour = Number(Utilities.formatDate(now, tz, 'H'));
  const days = data.days || [];
  const t = days.find(d => d.iso === today);
  let main = t && t.stops && t.stops.length && hour < 18 ? t : null;
  if (!main) main = days.find(d => d.iso > today && d.stops && d.stops.length) || null;
  const off = t && t.off && hour < 18;
  const updated = Utilities.formatDate(new Date(data.savedAt || now), tz, 'M/d HH:mm');
  // 위젯 앱에서 ◀ ▶ 로 넘겨 볼 수 있게 일정표의 모든 근무일
  const all = days.filter(d => d.stops && d.stops.length).map(d => {
    const v = dayView_(data, d, today, now);
    return { iso: d.iso, title: v.title, sub: v.sub, lines: v.lines, rk: v.rk || '', rv: v.rv || '' };
  });
  if (!main) {
    const title = off ? '오늘은 휴가예요' : '이번 일정표에 남은 근무가 없어요';
    return { ok: true, name: data.name, title: title, sub: '새 일정표를 올려 주세요', lines: [], text: title, updated: updated, days: all, main: '' };
  }
  const v = dayView_(data, main, today, now);
  if (off) v.title = '오늘 휴가 · ' + v.title;
  return Object.assign(v.per, { all: v.rows.join(' / ') }, { ok: true, name: data.name, title: v.title, sub: v.sub, start: v.lines[0] ? v.lines[0].time : '',
    lines: v.lines, count: v.lines.length, text: v.text, rk: v.rk, rv: v.rv, updated: updated, days: all, main: main.iso });
}

// 하루치 위젯 내용: 제목·요약·현장 줄·길안내 링크·하루 경로
function dayView_(data, main, today, now) {
  const tz = 'Asia/Seoul';
  const when = main.iso === today ? '오늘' : main.iso === tomorrow_(today) ? '내일' : '';
  const kindNm = { '정': '정기', '밀': '정밀', '수': '수시', '완': '설치', '설': '설치' };
  const lines = main.stops.map((s, i) => {
    const nav = s.lat ? navLinks_(s.addr ? s.addr.replace(/\([^)]*\)/g, ' ').trim() : s.name, s.lat, s.lng) : null;
    return {
      no: i + 1, time: s.time || '', name: s.name, area: s.area || '', addr: s.addr || '',
      kind: kindNm[s.kind] || s.kind || '', units: s.units == null ? '' : s.units, nav: nav,
    };
  });
  const units = main.stops.reduce((a, s) => a + (s.units || 0), 0);
  const places = new Set(main.stops.map(s => s.name)).size;
  const title = (when ? when + ' ' : '') + main.label + (main.team ? ' · ' + main.team : '');
  const sub = places + '곳 · ' + units + '대' + (main.km ? ' · ' + main.km + 'km' : '')
    + (main.mates && main.mates.length ? ' · 동행 ' + main.mates.join(', ') : '');
  const text = [title, ...lines.map(l => l.no + '. ' + l.time + ' ' + l.name + (l.area ? ' (' + l.area + ')' : '')
    + ' ' + l.kind + ' ' + l.units), sub].join('\n');
  const nowHm = Utilities.formatDate(now, tz, 'HH:mm');
  // 위젯 앱에서 줄마다 따로 쓰기 쉽게 l1~l8 (현장 한 줄씩)
  const rows = text.split('\n').slice(1, -1);
  const per = {};
  // 줄마다 길안내 링크: k1~k8 카카오, t1~t8 티맵, v1~v8 네이버 (좌표를 못 찾은 현장은 카카오 검색)
  for (let i = 0; i < 8; i++) {
    per['l' + (i + 1)] = rows[i] || '';
    const l = lines[i];
    // 위젯 칸용: h 시간, n 현장명, s 동·종류·대수, d 지난 현장이면 1 (흐리게 표시용)
    per['h' + (i + 1)] = l ? l.time : '';
    per['n' + (i + 1)] = l ? l.name : '';
    per['s' + (i + 1)] = l ? [l.area, (l.kind + ' ' + l.units).trim()].filter(Boolean).join(' · ') : '';
    per['d' + (i + 1)] = l && when === '오늘' && l.time && l.time < nowHm ? '1' : '0';
    const q = l ? encodeURIComponent(((l.area || '') + ' ' + l.name).trim()) : '';
    per['k' + (i + 1)] = l ? (l.nav ? l.nav.kakao : 'https://map.kakao.com/?eName=' + q) : '';
    per['t' + (i + 1)] = l ? (l.nav ? l.nav.tmap : 'https://map.kakao.com/?eName=' + q) : '';
    per['v' + (i + 1)] = l ? (l.nav ? l.nav.naver : 'https://map.naver.com/p/search/' + q) : '';
  }
  if (rows.length > 8) per.l8 = '외 ' + (rows.length - 7) + '곳 더';
  // 하루 경로 (지사 출발 → 현장들 → 마지막 현장): 카카오 rk, 네이버 rv
  let rk = '', rv = '';
  const pts = lines.filter(l => l.nav).map(l => ({ n: l.name, lat: main.stops[l.no - 1].lat, lng: main.stops[l.no - 1].lng }));
  if (pts.length) {
    const lab = x => encodeURIComponent(String(x).replace(/[,/]/g, ' '));
    const o = data.origin, end = pts[pts.length - 1], via = pts.slice(0, -1).slice(0, 5);
    const bn = data.branch && data.branch[0] ? data.branch[0] : '지사';
    rk = 'https://map.kakao.com/link/by/car/' + (o ? [{ n: bn, lat: o.lat, lng: o.lng }] : [])
      .concat(via, [end]).map(x => lab(x.n) + ',' + x.lat + ',' + x.lng).join('/');
    rv = 'nmap://route/car?dlat=' + end.lat + '&dlng=' + end.lng + '&dname=' + lab(end.n);
    if (o) rv += '&slat=' + o.lat + '&slng=' + o.lng + '&sname=' + lab(bn);
    via.forEach((x, i) => { rv += '&v' + (i + 1) + 'lat=' + x.lat + '&v' + (i + 1) + 'lng=' + x.lng + '&v' + (i + 1) + 'name=' + lab(x.n); });
    rv += '&appname=elevator.schedule';
  }
  return { title: title, sub: sub, lines: lines, rows: rows, text: text, per: per, rk: rk, rv: rv };
}

function tomorrow_(iso) {
  const d = new Date(iso + 'T12:00:00+09:00');
  d.setDate(d.getDate() + 1);
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}

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
