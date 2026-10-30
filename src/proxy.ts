import { NextResponse, type NextRequest } from "next/server";
import { basicAuthDenied } from "@/lib/basicAuth";

/**
 * 公開しているURLを知っていれば誰でも使える状態だと、AI(Gemini)の料金がかかる機能を他人に使われたり、
 * 動画を置かれたりするので、ID・パスワードを聞く(ブラウザ標準のBasic認証)。
 * 環境変数 BASIC_AUTH_USER と BASIC_AUTH_PASSWORD の両方があるときだけ有効にする
 * (ローカルの npm run dev では設定しなければ今までどおり聞かれない)。
 * 一度入れると、ブラウザが同じサイトへの通信(API・動画の読み込み・書き出し)に自動で付けて送る。
 */
export function proxy(request: NextRequest) {
  return basicAuthDenied(request) ?? NextResponse.next();
}

export const config = {
  // 画面の部品(JS・CSS)は中身を見られても困らないので除く。それ以外(画面・API・動画)はすべて守る。
  // ファイルを受け取るAPI(api/upload〜・api/extract-style〜)も除く(それぞれのAPIの中で同じID・パスワードを確かめる)。proxyを通すと、Next.jsが送られてきた中身を
  // 10MB(proxyClientMaxBodySize)までしか取っておかず、10MBを超える動画が途中で切れて保存されていた。
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/upload|api/extract-style).*)"],
};
