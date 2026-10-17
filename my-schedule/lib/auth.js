// 회사 메일 인증: 회사 메일(@koelsa.or.kr)로 6자리 번호를 보내고, 맞으면 그 휴대폰에 열쇠(토큰)를 줌.
// 메일 보낼 계정(SMTP_USER·SMTP_PASS)이 Vercel 환경 변수에 있을 때만 켜짐 — 없으면 지금처럼 누구나.
const crypto = require('crypto');
const { redis_ } = require('./core.js');

const env = k => String(process.env[k] || '').trim();
const DOMAIN = () => (env('AUTH_DOMAIN') || 'koelsa.or.kr').toLowerCase();
const authOn = () => !!(env('SMTP_USER') && env('SMTP_PASS'));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const pepper = () => env('AUTH_SECRET') || env('SMTP_PASS');
// 인증 없이 부를 수 있는 기능
const OPEN = new Set(['getConfig', 'latestVer', 'authStart', 'authVerify', 'authCheck']);
const OK_TOK = new Map(); // 확인한 열쇠 (서버가 켜져 있는 동안만)

async function checkToken(t) {
  if (!authOn()) return true;
  t = String(t || '');
  if (!/^[a-f0-9]{48}$/.test(t)) return false;
  const k = 'p:tok:' + sha(t);
  if (OK_TOK.has(k)) return true;
  const v = (await redis_([['GET', k]]))[0];
  if (v) OK_TOK.set(k, 1);
  return !!v;
}

// 플레이스토어 심사용 계정 (Vercel 환경 변수 REVIEW_LOGIN = "메일:6자리번호") — 메일을 보내지 않고 정해진 번호로 통과
function review_() {
  const m = /^([^:\s]+@[^:\s]+):(\d{6})$/.exec(env('REVIEW_LOGIN'));
  return m ? { email: m[1].toLowerCase(), code: m[2] } : null;
}

function mailOk_(email) {
  return new RegExp('^[a-z0-9._%+-]{1,64}@' + DOMAIN().replace(/\./g, '\\.') + '$').test(email);
}

async function sendMail_(to, code) {
  if (env('SMTP_HOST') === 'test') { global.__lastAuthCode = code; return; } // 시험용: 보내지 않음
  const nodemailer = require('nodemailer');
  const port = +(env('SMTP_PORT') || 465);
  const tr = nodemailer.createTransport({
    host: env('SMTP_HOST') || 'smtp.gmail.com', port, secure: port === 465,
    auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
  });
  await tr.sendMail({
    from: '"오늘 현장" <' + env('SMTP_USER') + '>',
    to,
    subject: '[오늘 현장] 인증번호 ' + code,
    text: '오늘 현장 앱 인증번호: ' + code + '\n\n앱 화면에 이 6자리 번호를 넣어 주세요. 10분 동안 쓸 수 있어요.\n직접 요청하지 않았다면 이 메일은 무시하세요.',
    html: '<div style="font-family:sans-serif;font-size:16px;line-height:1.6">'
      + '<p>오늘 현장 앱 인증번호예요.</p>'
      + '<p style="font-size:34px;font-weight:bold;letter-spacing:6px;margin:16px 0">' + code + '</p>'
      + '<p>앱 화면에 이 6자리 번호를 넣어 주세요. 10분 동안 쓸 수 있어요.</p>'
      + '<p style="color:#888;font-size:13px">직접 요청하지 않았다면 이 메일은 무시하세요.</p></div>',
  });
}

// 1) 번호 보내기 — 같은 메일은 1분에 한 번, 하루 8번 / 서버 전체 하루 400통까지
async function authStart(email) {
  if (!authOn()) return { ok: false, message: '이 서버는 메일 인증을 쓰지 않아요.' };
  email = String(email || '').trim().toLowerCase();
  if (!mailOk_(email)) return { ok: false, message: '회사 메일(@' + DOMAIN() + ')만 쓸 수 있어요.' };
  const rv = review_();
  if (rv && rv.email === email) return { ok: true, email };
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const [prev, cnt, all] = await redis_([['GET', 'c:otp:' + email], ['GET', 'c:otpn:' + email + ':' + day], ['GET', 'c:otpall:' + day]]);
  if (prev && Date.now() - JSON.parse(prev).at < 60e3) return { ok: false, wait: true, message: '방금 보냈어요. 1분 뒤에 다시 받을 수 있어요.' };
  if (+cnt >= 8) return { ok: false, message: '오늘은 이 메일로 더 보낼 수 없어요. 내일 다시 해 주세요.' };
  if (+all >= 400) return { ok: false, message: '오늘 보낼 수 있는 메일을 다 썼어요. 내일 다시 해 주세요.' };
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  try {
    await sendMail_(email, code);
  } catch (e) {
    return { ok: false, message: '메일을 보내지 못했어요. 잠시 뒤 다시 해 주세요.' };
  }
  await redis_([
    ['SET', 'c:otp:' + email, JSON.stringify({ h: sha(email + '|' + code + '|' + pepper()), at: Date.now(), tries: 0 }), 'EX', 600],
    ['INCR', 'c:otpn:' + email + ':' + day], ['EXPIRE', 'c:otpn:' + email + ':' + day, 90000],
    ['INCR', 'c:otpall:' + day], ['EXPIRE', 'c:otpall:' + day, 90000],
  ]);
  return { ok: true, email };
}

// 2) 번호 확인 — 맞으면 열쇠(토큰). 5번 틀리면 번호를 다시 받아야 함
async function authVerify(email, code) {
  if (!authOn()) return { ok: false, message: '이 서버는 메일 인증을 쓰지 않아요.' };
  email = String(email || '').trim().toLowerCase();
  code = String(code || '').replace(/\D/g, '');
  const rv = review_();
  if (rv && rv.email === email) {
    if (code !== rv.code) return { ok: false, message: '번호가 맞지 않아요.' };
    const token = crypto.randomBytes(24).toString('hex');
    await redis_([['SET', 'p:tok:' + sha(token), JSON.stringify({ email, at: Date.now(), review: 1 })]]);
    return { ok: true, token };
  }
  const raw = (await redis_([['GET', 'c:otp:' + email]]))[0];
  if (!raw) return { ok: false, message: '번호가 만료됐어요. 번호를 다시 받아 주세요.' };
  const o = JSON.parse(raw);
  if (o.tries >= 5) return { ok: false, message: '여러 번 틀렸어요. 번호를 다시 받아 주세요.' };
  if (sha(email + '|' + code + '|' + pepper()) !== o.h) {
    o.tries++;
    await redis_([['SET', 'c:otp:' + email, JSON.stringify(o), 'EX', 600]]);
    return { ok: false, message: '번호가 맞지 않아요. (' + (5 - o.tries) + '번 남음)' };
  }
  const token = crypto.randomBytes(24).toString('hex');
  await redis_([['DEL', 'c:otp:' + email], ['SET', 'p:tok:' + sha(token), JSON.stringify({ email, at: Date.now() })]]);
  return { ok: true, token };
}

module.exports = { authOn, DOMAIN, OPEN, checkToken, authStart, authVerify };
