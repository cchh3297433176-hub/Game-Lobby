import crypto from "node:crypto";
import type { GameRoom } from "./game-room";
import { roomOf } from "./game-room";
import type { Lobby } from "./lobby";
import { lobbyOf } from "./lobby";

export interface Env {
  ACCESS_TOKEN?: string;
  PORT?: string | number;
}

export function newGameId(): string {
  return crypto.randomBytes(4).toString("hex");
}

export function isGameId(id: string): boolean {
  return /^[0-9a-f]{8}$/i.test(id) || /^[a-z0-9_-]{4,32}$/i.test(id);
}

export function newSeatToken(gameId: string): string {
  return `${gameId}_${crypto.randomBytes(8).toString("hex")}`;
}

export function gameOfToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split("_");
  return parts.length >= 2 ? parts[0] : null;
}

export function authorized(env: Env, req: Request, token?: string): boolean {
  const expected = env.ACCESS_TOKEN || process.env.ACCESS_TOKEN;
  // 未设置密码时直接放行，便于掌机直连
  if (!expected) return true;
  if (token && token === expected) return true;
  const authHeader = req.headers.get("authorization") || req.headers.get("x-access-token");
  if (authHeader) {
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (bearer === expected) return true;
  }
  const urlToken = new URL(req.url).searchParams.get("token");
  if (urlToken && urlToken === expected) return true;
  return false;
}

export { lobbyOf, roomOf };
