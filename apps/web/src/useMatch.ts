import {
  applyMatchAction,
  createMatch,
  viewMatch,
  type GameKind,
  type Match,
  type MatchAction,
  type MatchView,
  type Seat,
} from "@rain-go/engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, getResolvedServerUrl } from "./api";

// 本地离线对局内存缓存池，支持页面刷新保活
const localMatches = new Map<string, Match>();

function getQueryParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(location.search);
  let v = q.get(key);
  if (!v && location.hash.includes(key + "=")) {
    const hashQuery = location.hash.includes("?") ? location.hash.split("?")[1] : location.hash.slice(1);
    v = new URLSearchParams(hashQuery).get(key);
  }
  return v;
}

/**
 * 在本地端内创建纯规则引擎对局
 */
function createLocalEngineMatch(id: string, seatToken: string): Match {
  const cached = localMatches.get(id);
  if (cached) return cached;

  const kind = (getQueryParam("kind") || "gomoku") as GameKind;
  const playerName = getQueryParam("playerName") || "我";

  let npcs: { id: string; name: string }[] = [];
  try {
    const rawNpcs = getQueryParam("npcs");
    if (rawNpcs) npcs = JSON.parse(rawNpcs);
  } catch (_) {}

  // 构造座位：玩家在 0 号位，自建同伴在后续座位（以 bot 规则驱动）
  const seats: { kind: "human" | "bot"; name: string; token: string; joined: boolean }[] = [
    { kind: "human", name: playerName, token: seatToken || "local_me", joined: true },
  ];

  if (npcs.length > 0) {
    npcs.forEach((n, i) => {
      seats.push({
        kind: "bot",
        name: n.name || `同伴 ${i + 1}`,
        token: `bot_token_${i}_${Date.now()}`,
        joined: true,
      });
    });
  } else {
    seats.push({
      kind: "bot",
      name: "对手",
      token: `bot_token_0_${Date.now()}`,
      joined: true,
    });
  }

  const now = Date.now();
  const m = createMatch({
    id,
    kind,
    seats,
    seed: (Math.random() * 1000000) >>> 0,
    now,
  });

  localMatches.set(id, m);
  return m;
}

/** Loads a match and keeps it live over WebSocket or local offline engine. */
export function useMatch(id: string, seatToken: string) {
  const [match, setMatchRaw] = useState<MatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const localMatchRef = useRef<Match | null>(null);

  const setMatch = useCallback((m: MatchView) => {
    setMatchRaw((prev) => (prev && prev.id === m.id && prev.version > m.version ? prev : m));
    setSyncedAt(Date.now());
  }, []);

  // 离线/本地动作执行派发
  const performLocalAction = useCallback(
    async (action: MatchAction): Promise<MatchView> => {
      let cur = localMatchRef.current || localMatches.get(id);
      if (!cur) {
        cur = createLocalEngineMatch(id, seatToken);
      }
      const seat: Seat = 0; // 玩家始终在 0 号位
      const res = applyMatchAction(cur, seat, action, Date.now());
      if (!res.ok) {
        throw new Error(res.message || res.error);
      }
      localMatches.set(id, res.match);
      localMatchRef.current = res.match;
      const view = viewMatch(res.match, seat);
      setMatch(view);
      return view;
    },
    [id, seatToken, setMatch],
  );

  useEffect(() => {
    setMatchRaw(null);
    setError(null);
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // 判别是否优先启动本地纯规则引擎（本地 match 或者无服务器配置）
    const isLocalMatch = id.startsWith("local_") || id.includes("local");

    if (isLocalMatch) {
      try {
        const m = createLocalEngineMatch(id, seatToken);
        localMatchRef.current = m;
        const view = viewMatch(m, 0);
        setMatch(view);
        setLive(true);
      } catch (err) {
        console.error("Local match init failed:", err);
        setError("本地棋局初始化失败");
      }
      return;
    }

    // 远端联机模式：尝试连接服务器
    api.getGame(id, seatToken || undefined).then(
      (m) => {
        setMatch(m);
      },
      (e: unknown) => {
        // 如果远端未找到或网络异常，自愈回退到本地纯规则对局，绝不卡死用户
        console.warn("Server unavailable or game not found, fallback to local engine:", e);
        try {
          const m = createLocalEngineMatch(id, seatToken);
          localMatchRef.current = m;
          const view = viewMatch(m, 0);
          setMatch(view);
          setLive(true);
        } catch (_) {
          setError(e instanceof ApiError && e.status === 404 ? "找不到这局" : "加载失败");
        }
      },
    );

    const connect = () => {
      const serverUrl = getResolvedServerUrl();
      let wsUrl = "";

      try {
        const u = new URL(serverUrl);
        const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
        wsUrl = `${wsProto}//${u.host}/api/games/${id}/ws${seatToken ? `?t=${encodeURIComponent(seatToken)}` : ""}`;
      } catch (_) {
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        const host = location.host || "121.43.122.253:8787";
        wsUrl = `${proto}//${host}/api/games/${id}/ws${seatToken ? `?t=${encodeURIComponent(seatToken)}` : ""}`;
      }

      try {
        ws = new WebSocket(wsUrl);
      } catch (_) {
        setLive(false);
        return;
      }

      ws.onopen = () => {
        setLive(true);
        retry = 0;
      };

      ws.onmessage = (e) => {
        if (e.data === "pong") return;
        try {
          const m = JSON.parse(String(e.data)) as { type: string; match?: MatchView };
          if (m.type === "match" && m.match) setMatch(m.match);
        } catch (_) {}
      };

      ws.onclose = () => {
        setLive(false);
        if (!stopped && !id.startsWith("local_")) {
          timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 10_000));
        }
      };

      ws.onerror = () => {
        setLive(false);
      };
    };

    connect();
    const ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(ping);
      ws?.close();
    };
  }, [id, seatToken, setMatch]);

  return { match, setMatch, error, live, syncedAt, performLocalAction };
}
