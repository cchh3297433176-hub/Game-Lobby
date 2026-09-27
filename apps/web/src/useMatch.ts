import type { MatchView } from "@rain-go/engine";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, getResolvedServerUrl } from "./api";

/** Loads a match and keeps it live over a WebSocket. The server only sends the view of the seat `seatToken` holds. */
export function useMatch(id: string, seatToken: string) {
  const [match, setMatchRaw] = useState<MatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  const setMatch = useCallback((m: MatchView) => {
    setMatchRaw((prev) => (prev && prev.id === m.id && prev.version > m.version ? prev : m));
    setSyncedAt(Date.now());
  }, []);

  useEffect(() => {
    setMatchRaw(null);
    setError(null);
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // 1. 先通过 HTTP REST 获取初始盘面
    api.getGame(id, seatToken || undefined).then(
      (m) => {
        setMatch(m);
      },
      (e: unknown) => {
        setError(e instanceof ApiError && e.status === 404 ? "找不到这局" : "加载失败");
      },
    );

    // 2. 解析正确的 WebSocket 远程推流端点
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
      } catch (err) {
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
        if (!stopped) {
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

  return { match, setMatch, error, live, syncedAt };
}
