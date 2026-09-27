import type { GameKind, PublicSeat, Seat } from "@rain-go/engine";

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

/** 单机内存对局列表管理器，取代原有的 Cloudflare Durable Object */
export class Lobby {
  private games = new Map<string, GameMeta>();

  async upsert(meta: GameMeta): Promise<void> {
    this.games.set(meta.id, meta);
  }

  async list(limit = 50, includeFinished = true): Promise<GameMeta[]> {
    return [...this.games.values()]
      .filter((g) => Array.isArray(g.seats) && (includeFinished || !g.over))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }
}

export const globalLobby = new Lobby();

export function lobbyOf(_env?: unknown): Lobby {
  return globalLobby;
}
