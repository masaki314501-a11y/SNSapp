/**
 * 参考スクショ/動画を一度に渡せる枚数。画面(クライアント)とAPI(サーバー)の両方で使うため、
 * node:fsを読むstyleReference.tsや"use client"付きのvideoProject.tsではなく、ここに置く
 * (videoProject.tsの値をサーバーでimportするとundefinedになるため)。
 * 1枚だと、その1枚にたまたま映っていた物まで真似してしまうので、複数枚から共通点を読ませる。
 */
export const MAX_STYLE_REFERENCES = 10;
