/**
 * 画面を開く時に聞くID・パスワード(ブラウザ標準のBasic認証)の確かめ方。src/proxy.ts と、
 * proxyを通さないファイルを受け取るAPI(src/proxy.ts の matcher で除いている物)の両方で使う。
 * 環境変数 BASIC_AUTH_USER と BASIC_AUTH_PASSWORD の両方があるときだけ有効にする。
 */
const USER = process.env.BASIC_AUTH_USER ?? "";
const PASSWORD = process.env.BASIC_AUTH_PASSWORD ?? "";

/** 長さ以外で比べる時間が変わらないように比べる(1文字ずつ当てていく攻撃を防ぐ)。 */
const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const isAuthorized = (header: string | null): boolean => {
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  // 両方とも比べてから結果を出す(どちらが違ったかで時間が変わらないように)
  const userOk = safeEqual(decoded.slice(0, separator), USER);
  const passwordOk = safeEqual(decoded.slice(separator + 1), PASSWORD);
  return userOk && passwordOk;
};

/** ID・パスワードが合わなければ401の応答を返す(合っている・設定が無い時はnull)。 */
export const basicAuthDenied = (request: Request): Response | null => {
  if (!USER || !PASSWORD) return null;
  if (isAuthorized(request.headers.get("authorization"))) return null;
  return new Response("ログインが必要です", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="SNSapp", charset="UTF-8"' },
  });
};
