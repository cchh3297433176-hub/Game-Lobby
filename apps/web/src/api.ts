import type { GameKind, MatchAction, MatchView, PublicSeat, Seat, SeatKind } from "@rain-go/engine";

const TOKEN_KEY = "rain-go:token";
const BG_KEY = "rain-go:bg";
const LAST_GAME_KEY = "rain-go:last-game";
const NAMES_KEY = "rain-go:names";
const LAST_NAMES_KEY = "rain-go:last-names";
const SERVER_URL_KEY = "rain-go:server-url";

const readJson = <T,>(k: string, fallback: T): T => {
  try {
    const v = JSON.parse(read(k) || "null") as T | null;
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const write = (k: string, v: string) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    // Storage unavailable (private mode); settings last for this visit only.
  }
};

/**
 * 获取当前生效的裁判后端服务地址
 * 优先顺序：URL 参数中的 serverUrl -> localStorage 缓存 -> 官方云端节点
 */
export function getResolvedServerUrl(): string {
  if (typeof window !== "undefined") {
    try {
      const q = new URLSearchParams(location.search);
      let s = q.get("serverUrl");
      if (!s && location.hash.includes("serverUrl=")) {
        const hashQuery = location.hash.includes("?") ? location.hash.split("?")[1] : location.hash.slice(1);
        s = new URLSearchParams(hashQuery).get("serverUrl");
      }
      if (s && s.trim()) {
        const clean = s.trim().replace(/\/+$/, "");
        prefs.setServerUrl(clean);
        return clean;
      }
    } catch (_) {}
  }
  const cached = prefs.serverUrl();
  if (cached) return cached;

  // 读取主播掌机主系统配置的 Key（如果存在同域存储）
  const mcytLobby = read("mcyt_lobby_server_url");
  if (mcytLobby) return mcytLobby.trim().replace(/\/+$/, "");

  // 默认云端保活节点
  return "http://121.43.122.253:8787";
}

export const prefs = {
  token: () => read(TOKEN_KEY),
  setToken: (v: string) => write(TOKEN_KEY, v.trim()),
  background: () => read(BG_KEY),
  setBackground: (v: string) => write(BG_KEY, v.trim()),
  lastGame: () => read(LAST_GAME_KEY),
  setLastGame: (v: string) => write(LAST_GAME_KEY, v),
  serverUrl: () => read(SERVER_URL_KEY),
  setServerUrl: (v: string) => write(SERVER_URL_KEY, v.trim()),
  setServer: (v: string) => write(SERVER_URL_KEY, v.trim()),
  /** Recently used player names, newest first. */
  recentNames: (): string[] => readJson<string[]>(NAMES_KEY, []).filter((n) => typeof n === "string"),
  rememberNames: (...names: (string | undefined)[]) => {
    const add = names.map((n) => n?.trim()).filter((n): n is string => Boolean(n));
    if (!add.length) return;
    const list = [...add, ...prefs.recentNames().filter((n) => !add.includes(n))].slice(0, 10);
    write(NAMES_KEY, JSON.stringify(list));
  },
  forgetName: (name: string) => write(NAMES_KEY, JSON.stringify(prefs.recentNames().filter((n) => n !== name))),
  /** The seat token this device holds for a game. */
  seatToken: (id: string) => read(`rain-go:seat:${id}`),
  setSeatToken: (id: string, token: string) => write(`rain-go:seat:${id}`, token),
  lastNames: () => readJson<{ human: string; ai: string }>(LAST_NAMES_KEY, { human: "", ai: "" }),
  setLastNames: (human: string, ai: string) => write(LAST_NAMES_KEY, JSON.stringify({ human: human.trim(), ai: ai.trim() })),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, seatToken?: string): Promise<T> {
  const headers = new Headers(init.headers);
  const token = prefs.token();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (seatToken) headers.set("x-seat", seatToken);
  if (init.body) headers.set("content-type", "application/json");

  // 将相对路径补全为具备独立域名的完整 URL，防止本地 file:// 协议请求失效
  let fullUrl = path;
  if (path.startsWith("/")) {
    const base = getResolvedServerUrl();
    fullUrl = `${base}${path}`;
  }

  const res = await fetch(fullUrl, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(body.error ?? res.status), String(body.message ?? body.error ?? res.statusText));
  return body as T;
}

export interface GameMeta {
  id: string;
  kind: GameKind;
  seats: PublicSeat[];
  labels: string[];
  over: boolean;
  waitingOn: Seat[];
  moves: number;
  result?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SeatSpec {
  kind: SeatKind;
  name?: string;
  me?: boolean;
}

export interface Invite {
  seat: Seat;
  kind: SeatKind;
  name: string;
  joined: boolean;
  link: string | null;
}

export const api = {
  config: () => request<{ authRequired: boolean }>("/api/config"),
  checkAuth: () => request<{ ok: true }>("/api/auth"),
  listGames: () => request<{ games: GameMeta[] }>("/api/games").then((r) => r.games),
  createGame: (o: { kind: GameKind; options: Record<string, string>; seats: SeatSpec[] }) =>
    request<{ match: MatchView; token: string | null; invites: Invite[] }>("/api/games", { method: "POST", body: JSON.stringify(o) }),
  getGame: (id: string, seatToken?: string) => request<{ match: MatchView }>(`/api/games/${id}`, {}, seatToken).then((r) => r.match),
  invites: (id: string) => request<{ invites: Invite[]; tokens: (string | null)[] }>(`/api/games/${id}/invites`),
  act: (id: string, seatToken: string, action: MatchAction) =>
    request<{ match: MatchView }>(`/api/games/${id}/actions`, { method: "POST", body: JSON.stringify(action) }, seatToken).then((r) => r.match),
};
