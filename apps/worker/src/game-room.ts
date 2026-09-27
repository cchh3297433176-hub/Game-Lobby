import {
  GAMES,
  applyMatchAction,
  createMatch,
  joinSeat,
  seatByToken,
  statusOf,
  viewMatch,
  type Match,
  type MatchAction,
  type NewMatchOptions,
  type Seat,
} from "@rain-go/engine";
import { lobbyOf } from "./lobby";
import type { GameMeta } from "./lobby";

export type ActResult = { ok: true; match: Match } | { ok: false; error: string; message: string };

interface ActiveSocket {
  send: (data: string) => void;
  seat: Seat | null;
}

/**
 * 纯内存单局房间管理器（替代 Cloudflare Durable Object）。
 * 保证状态原地读写并支持多端 WebSocket 实时脱敏广播。
 */
export class GameRoom {
  readonly id: string;
  private match: Match | null = null;
  private waiters = new Set<() => void>();
  private sockets = new Set<ActiveSocket>();

  constructor(id: string) {
    this.id = id;
  }

  private async load(): Promise<Match | null> {
    return this.match;
  }

  private async save(m: Match): Promise<void> {
    this.match = m;
    for (const item of this.sockets) {
      try {
        item.send(JSON.stringify({ type: "match", match: viewMatch(m, item.seat) }));
      } catch {
        // 连接已失效
      }
    }
    for (const wake of this.waiters) wake();
    this.waiters.clear();
    await lobbyOf().upsert(metaOf(m));
  }

  async create(o: NewMatchOptions): Promise<Match> {
    if (await this.load()) throw new Error("Game already exists");
    const m = createMatch(o);
    await this.save(m);
    return m;
  }

  async get(): Promise<Match | null> {
    return this.load();
  }

  async act(seat: Seat, action: MatchAction): Promise<ActResult> {
    const m = await this.load();
    if (!m) return { ok: false, error: "not_found", message: "找不到这局" };
    const res = applyMatchAction(joinSeat(m, seat, Date.now()), seat, action, Date.now());
    if (!res.ok) return res;
    await this.save(res.match);
    return { ok: true, match: res.match };
  }

  async join(seat: Seat): Promise<Match | null> {
    const m = await this.load();
    if (!m || !m.seats[seat]) return m;
    const next = joinSeat(m, seat, Date.now());
    if (next !== m) await this.save(next);
    return next;
  }

  /** Resolves once the game waits on `seat`, the game ends, or the timeout passes. */
  async waitFor(seat: Seat, timeoutMs: number): Promise<{ match: Match | null; timedOut: boolean }> {
    const deadline = Date.now() + Math.min(Math.max(timeoutMs, 0), 58_000);
    for (;;) {
      const m = await this.load();
      if (!m) return { match: null, timedOut: false };
      const st = statusOf(m);
      if (st.outcome || st.waitingOn.includes(seat)) return { match: m, timedOut: false };
      const left = deadline - Date.now();
      if (left <= 0) return { match: m, timedOut: true };
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.add(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** 注册活动的 WebSocket 连接监听，并在断开时返回清理函数 */
  registerSocket(socket: ActiveSocket): () => void {
    this.sockets.add(socket);
    return () => {
      this.sockets.delete(socket);
    };
  }
}

const rooms = new Map<string, GameRoom>();

export function roomOf(_env: unknown, id: string): GameRoom {
  let r = rooms.get(id);
  if (!r) {
    r = new GameRoom(id);
    rooms.set(id, r);
  }
  return r;
}

export function metaOf(m: Match): GameMeta {
  const st = statusOf(m);
  return {
    id: m.id,
    kind: m.kind,
    seats: m.seats.map(({ token: _t, ...s }) => s),
    labels: GAMES[m.kind].seatLabels(m.state),
    over: Boolean(st.outcome),
    waitingOn: st.waitingOn,
    moves: m.log.length,
    result: st.resultText ?? undefined,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}
