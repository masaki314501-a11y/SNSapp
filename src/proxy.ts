import { NextResponse, type NextRequest } from "next/server";

/**
 * 公開しているURLを知っていれば誰でも使える状態だと、AI(Gemini)の料金がかかる機能を他人に使われたり、
 * 動画を置かれたりするので、ID・パスワードを聞く(ブラウザ標準のBasic認証)。
 * 環境変数 BASIC_AUTH_USER と BASIC_AUTH_PASSWORD の両方があるときだけ有効にする
 * (ローカルの npm run dev では設定しなければ今までどおり聞かれない)。
 * 一度入れると、ブラウザが同じサイトへの通信(API・動画の読み込み・書き出し)に自動で付けて送る。
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

export function proxy(request: NextRequest) {
  if (!USER || !PASSWORD) return NextResponse.next();
  if (isAuthorized(request.headers.get("authorization"))) return NextResponse.next();
  return new NextResponse("ログインが必要です", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="SNSapp", charset="UTF-8"' },
  });
}

export const config = {
  // 画面の部品(JS・CSS)は中身を見られても困らないので除く。それ以外(画面・API・動画)はすべて守る
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
