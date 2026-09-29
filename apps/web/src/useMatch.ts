import {
  GAMES,
  applyMatchAction,
  autoplay,
  createMatch,
  statusOf,
  viewMatch,
  type GameKind,
  type Match,
  type MatchAction,
  type MatchView,
  type Seat,
} from "@rain-go/engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, getResolvedServerUrl } from "./api";

// 本地离线对局内存池
const localMatches = new Map<string, Match>();

// 同伴每走一步之间的停顿（毫秒），让玩家看得到谁在出招
const BOT_STEP_MS = 850;

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
 * 完整连环自动流转：只要当前轮到的不是人类玩家（seat 0），就全力让 Bot 执行动作
 * 彻底解决飞行棋掷骰后多步卡死、第 3 个人无法行动的严重缺陷
 */
function runFullAutoplay(m: Match, now: number): Match {
  let cur = m;
  for (let step = 0; step < 1200; step++) {
    const st = statusOf(cur);
    if (st.outcome) break;

    // 检查等待行动的座位中是否有 bot（非人类座）
    const botSeat = st.waitingOn.find((s) => s !== 0 && cur.seats[s]?.kind === "bot");
    if (botSeat === undefined) break;

    const next = autoplay(cur, now);
    if (next === cur || next.version === cur.version && next.log.length === cur.log.length) {
      break;
    }
    cur = next;
  }
  return cur;
}

/**
 * 在本地端内创建纯规则引擎对局，严格适配多人游戏规格
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

  // 构造座位：玩家在 0 号位，其余同伴座位一律标记为 bot，由规则层全自动出招
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
  let m = createMatch({
    id,
    kind,
    seats,
    seed: (Math.random() * 1000000) >>> 0,
    now,
  });

  // 如果开局先手不是玩家，立即自动推进轮次
  m = runFullAutoplay(m, now);

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

  // 同伴逐步出招：每步停顿一下并刷新界面，玩家才能看到每个角色在操作
  const botTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const botRun = useRef(0);

  useEffect(
    () => () => {
      botRun.current++;
      clearTimeout(botTimer.current);
    },
    [],
  );

  const stepBots = useCallback(
    (token: number) => {
      const tick = () => {
        if (botRun.current !== token) return;
        const cur = localMatchRef.current;
        if (!cur) return;
        const st = statusOf(cur);
        if (st.outcome) return;
        const seat = st.waitingOn.find((s) => cur.seats[s]?.kind === "bot");
        if (seat === undefined) return;
        const mod = GAMES[cur.kind];
        if (!mod.bot) return;
        const move = mod.bot(cur.state, seat);
        const res = mod.apply(cur.state, seat, move);
        if (!res.ok) return;
        const now = Date.now();
        const next: Match = {
          ...cur,
          state: res.state,
          log: [...cur.log, { seat, move: res.log ?? move, t: now }].slice(-500),
          updatedAt: now,
          version: cur.version + 1,
        };
        localMatches.set(id, next);
        localMatchRef.current = next;
        setMatch(viewMatch(next, 0));
        botTimer.current = setTimeout(tick, BOT_STEP_MS);
      };
      botTimer.current = setTimeout(tick, BOT_STEP_MS);
    },
    [id, setMatch],
  );

  // 离线/本地动作执行派发
  const performLocalAction = useCallback(
    async (action: MatchAction): Promise<MatchView> => {
      let cur = localMatchRef.current || localMatches.get(id);
      if (!cur) {
        cur = createLocalEngineMatch(id, seatToken);
      }
      const seat: Seat = 0; // 玩家始终在 0 号位

      // 走棋/出牌：只落玩家这一步，同伴的动作交给 stepBots 逐步展示
      if (action.type === "move") {
        const mod = GAMES[cur.kind];
        if (statusOf(cur).outcome) throw new Error("对局已经结束");
        const move = String(action.move ?? "").trim();
        if (!move) throw new Error("没有写这步棋");
        const r = mod.apply(cur.state, seat, move);
        if (!r.ok) throw new Error(r.error);
        const now = Date.now();
        const next: Match = {
          ...cur,
          state: r.state,
          log: [...cur.log, { seat, move: r.log ?? move, t: now }].slice(-500),
          updatedAt: now,
          version: cur.version + 1,
        };
        localMatches.set(id, next);
        localMatchRef.current = next;
        const v = viewMatch(next, seat);
        setMatch(v);
        botRun.current++;
        stepBots(botRun.current);
        return v;
      }

      const res = applyMatchAction(cur, seat, action, Date.now());
      if (!res.ok) {
        throw new Error(res.message || res.error);
      }

      const finalized = res.match;

      localMatches.set(id, finalized);
      localMatchRef.current = finalized;
      const view = viewMatch(finalized, seat);
      setMatch(view);
      return view;
    },
    [id, seatToken, setMatch, stepBots],
  );

  // 注入外部对话（比如掌机调起大模型生成的同伴回复）
  const injectExternalChat = useCallback(
    (speakerSeat: Seat, text: string) => {
      let cur = localMatchRef.current || localMatches.get(id);
      if (!cur) return;
      const updatedMatch: Match = {
        ...cur,
        chat: [...cur.chat, { seat: speakerSeat, text, t: Date.now(), at: cur.log.length }].slice(-100),
        updatedAt: Date.now(),
        version: cur.version + 1,
      };
      localMatches.set(id, updatedMatch);
      localMatchRef.current = updatedMatch;
      setMatch(viewMatch(updatedMatch, 0));
    },
    [id, setMatch],
  );

  useEffect(() => {
    // 监听掌机外壳传递进来的消息注入指令
    const onHostMessage = (ev: MessageEvent) => {
      if (!ev || !ev.data) return;
      if (ev.data.type === "MCYT_LOBBY_INJECT_CHAT") {
        injectExternalChat(ev.data.seat || 1, ev.data.text || "");
      }
    };
    window.addEventListener("message", onHostMessage);
    return () => window.removeEventListener("message", onHostMessage);
  }, [injectExternalChat]);

  useEffect(() => {
    setMatchRaw(null);
    setError(null);
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

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

    // 远端联机模式
    api.getGame(id, seatToken || undefined).then(
      (m) => {
        setMatch(m);
      },
      (e: unknown) => {
        console.warn("Server unavailable, fallback to local engine:", e);
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
