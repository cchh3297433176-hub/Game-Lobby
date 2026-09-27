import { GAMES, isGameKind, seatByToken, viewMatch, type MatchAction } from "@rain-go/engine";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authorized, gameOfToken, isGameId, lobbyOf, newGameId, roomOf, type Env } from "./env";
import { handleMcp } from "./mcp";
import { buildSeats, invitesOf } from "./seats";

export { GameRoom } from "./game-room";
export { Lobby } from "./lobby";

const app = new Hono<{ Bindings: Env }>();

// 注入跨域支持，方便主播掌机与本地环境直接调用
app.use("*", cors());

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const unauthorized = () =>
  new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });

/** A seat token from the `x-seat` header or the `t` query parameter. */
const seatTokenOf = (req: Request) => req.headers.get("x-seat") ?? new URL(req.url).searchParams.get("t");

app.get("/api/config", (c) => c.json({ authRequired: Boolean(c.env?.ACCESS_TOKEN || process.env.ACCESS_TOKEN) }));

app.get("/api/auth", (c) => (authorized(c.env || {}, c.req.raw) ? c.json({ ok: true }) : unauthorized()));

app.get("/api/games", async (c) => {
  if (!authorized(c.env || {}, c.req.raw)) return unauthorized();
  return c.json({ games: await lobbyOf(c.env).list(50, true) });
});

app.post("/api/games", async (c) => {
  if (!authorized(c.env || {}, c.req.raw)) return unauthorized();
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const kind = body.kind ?? "go";
  if (!isGameKind(kind) || !GAMES[kind].ready) return c.json({ error: "bad_kind", message: "没有这个游戏" }, 400);
  const id = newGameId();
  const built = buildSeats(kind, id, body.seats);
  if ("error" in built) return c.json({ error: "bad_seats", message: built.error }, 400);
  const match = await roomOf(c.env, id).create({
    id,
    kind,
    options: typeof body.options === "object" && body.options ? (body.options as Record<string, unknown>) : {},
    seats: built.seats,
    seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
    now: Date.now(),
  });
  const origin = new URL(c.req.url).origin;
  return c.json(
    {
      match: viewMatch(match, built.mine),
      token: built.mine === null ? null : match.seats[built.mine]!.token,
      invites: invitesOf(match, origin),
    },
    201,
  );
});

app.get("/api/games/:id", async (c) => {
  const id = c.req.param("id");
  if (!isGameId(id)) return c.json({ error: "bad_id" }, 400);
  const match = await roomOf(c.env, id).get();
  if (!match) return c.json({ error: "not_found" }, 404);
  return c.json({ match: viewMatch(match, seatByToken(match, seatTokenOf(c.req.raw))) });
});

/** Owner only: every seat with its invite link, e.g. to send a friend their seat. */
app.get("/api/games/:id/invites", async (c) => {
  if (!authorized(c.env || {}, c.req.raw)) return unauthorized();
  const id = c.req.param("id");
  if (!isGameId(id)) return c.json({ error: "bad_id" }, 400);
  const match = await roomOf(c.env, id).get();
  if (!match) return c.json({ error: "not_found" }, 404);
  return c.json({
    invites: invitesOf(match, new URL(c.req.url).origin),
    tokens: match.seats.map((s) => (s.kind === "human" ? s.token : null)),
  });
});

const ACTION_TYPES = new Set(["move", "resign", "say", "rename"]);

/**
 * Acting needs the seat's own token.
 * Human 和 AI 座位均支持通过普通 REST 提交动作，方便掌机角色人设驱动
 */
app.post("/api/games/:id/actions", async (c) => {
  const id = c.req.param("id");
  if (!isGameId(id)) return c.json({ error: "bad_id" }, 400);
  const token = seatTokenOf(c.req.raw);
  if (gameOfToken(token) !== id) return c.json({ error: "no_seat", message: "你没有这一局的座位" }, 403);
  const room = roomOf(c.env, id);
  const match = await room.get();
  if (!match) return c.json({ error: "not_found" }, 404);
  const seat = seatByToken(match, token);
  const seatKind = seat === null ? null : match.seats[seat]!.kind;
  if (seat === null || (seatKind !== "human" && seatKind !== "ai"))
    return c.json({ error: "no_seat", message: "你没有这一局的座位" }, 403);
  const action = await c.req.json<MatchAction>().catch(() => null);
  if (!action || typeof action !== "object" || !ACTION_TYPES.has(action.type)) return c.json({ error: "bad_action" }, 400);
  const res = await room.act(seat, action);
  return res.ok ? c.json({ match: viewMatch(res.match, seat) }) : c.json(res, 409);
});

// 原生 Node WebSocket 升级路由，实时推流对局
app.get(
  "/api/games/:id/ws",
  upgradeWebSocket((c) => {
    const id = c.req.param("id");
    const token = seatTokenOf(c.req.raw);
    const room = roomOf(c.env, id);
    let cleanup: (() => void) | null = null;
    return {
      async onOpen(_evt, ws) {
        let m = await room.get();
        const seat = m ? seatByToken(m, token) : null;
        if (m && seat !== null && m.seats[seat]?.kind === "human" && !m.seats[seat]!.joined) {
          m = await room.join(seat);
        }
        cleanup = room.registerSocket({
          send: (data: string) => ws.send(data),
          seat,
        });
        ws.send(JSON.stringify(m ? { type: "match", match: viewMatch(m, seat) } : { type: "error", message: "找不到这局" }));
      },
      onMessage(evt, ws) {
        if (evt.data === "ping") ws.send("pong");
      },
      onClose() {
        if (cleanup) cleanup();
      },
    };
  }),
);

const mcp = async (req: Request, env: Env, token?: string) => {
  if (!authorized(env, req, token)) return unauthorized();
  return handleMcp(req, env, new URL(req.url).origin, { mode: "owner" });
};
app.all("/mcp", (c) => mcp(c.req.raw, c.env || {}));
app.all("/mcp/seat/:seatToken", (c) => {
  const token = c.req.param("seatToken");
  if (!gameOfToken(token)) return unauthorized();
  return handleMcp(c.req.raw, c.env || {}, new URL(c.req.url).origin, { mode: "seat", token });
});
app.all("/mcp/:token", (c) => mcp(c.req.raw, c.env || {}, c.req.param("token")));

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

// 默认状态检查页
app.all("*", (c) =>
  c.json({
    ok: true,
    service: "mcyt-game-lobby-node",
    status: "running",
    version: "1.0.0",
  }),
);

// 启动独立 Node.js 监听服务
const port = Number(process.env.PORT || 8787);
const server = serve({
  fetch: app.fetch,
  port,
});
injectWebSocket(server);

console.log(`[Game-Lobby] 游戏大厅后端已独立启动于 http://0.0.0.0:${port}`);

export default app;
