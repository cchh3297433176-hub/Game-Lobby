import { GAMES, type MatchAction, type MatchView, type Seat } from "@rain-go/engine";
import { motion } from "motion/react";
import { useEffect, useState, useMemo, type ReactNode } from "react";
import { UIS } from "../games";
import type { BoardProps } from "../games/types";
import { ChatInput, ChatList, Sheet } from "./Chat";
import { DropMark, IconChat, IconFlag, IconHome, IconInvite, IconName } from "./icons";
import { NameSheet } from "./NameSheet";
import { Pill, Stat } from "./Pill";
import { Header, useLandscape, useWide } from "./Shell";
import { isEmbedded, navigate } from "../router";
import { useToast } from "./Toast";

const card = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35 } };

interface CustomNpcInfo {
  id: string;
  name: string;
  avatar?: string;
}

/** 从 URL 与 Hash 解析掌机传递过来的自建同伴真实数据 */
function useEmbeddedNpcs(): CustomNpcInfo[] {
  return useMemo(() => {
    if (typeof window === "undefined") return [];
    try {
      const q = new URLSearchParams(location.search);
      let raw = q.get("npcs");
      if (!raw && location.hash.includes("npcs=")) {
        const hashQuery = location.hash.includes("?") ? location.hash.split("?")[1] : location.hash.slice(1);
        raw = new URLSearchParams(hashQuery).get("npcs");
      }
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return [];
  }, []);
}

/** 微信原生白灰微绿确认弹窗，彻底歼灭系统默认的丑陋原生 confirm */
function WeChatConfirmModal({
  title = "提示",
  content,
  onConfirm,
  onCancel,
}: {
  title?: string;
  content: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/45 p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-[310px] overflow-hidden rounded-[14px] border border-[#eaeaea] bg-white text-[#222] shadow-[0_10px_35px_rgba(0,0,0,0.18)]">
        <div className="px-5 pt-5 pb-3 text-center">
          <div className="text-[16px] font-semibold text-[#181818]">{title}</div>
          <div className="mt-2 text-[13.5px] leading-relaxed text-[#666]">{content}</div>
        </div>
        <div className="flex border-t border-[#f0f0f0]">
          <button
            type="button"
            className="flex-1 py-3 text-[14px] font-medium text-[#555] active:bg-[#f7f7f7]"
            onClick={onCancel}
          >
            取消
          </button>
          <div className="w-[0.5px] bg-[#f0f0f0]" />
          <button
            type="button"
            className="flex-1 py-3 text-[14px] font-semibold text-[#fa5151] active:bg-[#f7f7f7]"
            onClick={onConfirm}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

export function MatchScreen({
  match,
  perform,
  chip,
  extra,
  onInvite,
}: {
  match: MatchView;
  perform: (a: MatchAction) => Promise<void>;
  chip: ReactNode;
  extra?: ReactNode;
  onInvite?: () => void;
}) {
  const wide = useWide();
  const landscape = useLandscape();
  const toast = useToast();
  const embedded = isEmbedded();
  const embeddedNpcs = useEmbeddedNpcs();
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [namesOpen, setNamesOpen] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [seenChat, setSeenChat] = useState(0);
  const [imgError, setImgError] = useState(false);

  const mod = GAMES[match.kind];
  const ui = UIS[match.kind];
  const me = match.me;
  const names = match.seats.map((s) => s.name);
  const n = match.seats.length;

  useEffect(() => {
    if (chatOpen) setSeenChat(match.chat.length);
  }, [chatOpen, match.chat.length]);

  const send = async (a: MatchAction) => {
    if (busy || me === null) return false;
    setBusy(true);
    try {
      await perform(a);
      // 如果是说话动作用 postMessage 同步掌机触发活人反应
      if (a.type === "say") {
        try {
          window.parent?.postMessage(
            {
              type: "MCYT_LOBBY_CHAT_SPOKEN",
              seat: me,
              text: a.text,
              matchId: match.id,
              kind: match.kind,
            },
            "*",
          );
        } catch (_) {}
      }
      return true;
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "出错了");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const st = match.status;
  const myTurn = me !== null && !st.outcome && st.waitingOn.includes(me);
  const props: BoardProps = {
    match,
    view: match.view,
    me,
    canAct: myTurn && !busy,
    send: (move) => send({ type: "move", move }),
    toast: toast.show,
    compact: !wide,
  };

  const others = match.seats.map((_, i) => i).filter((i) => i !== me);
  const lastOther = [...match.chat].reverse().find((c) => c.seat !== me);
  const acting = st.waitingOn.find((s) => s !== me);
  const featured: Seat = acting ?? lastOther?.seat ?? others[0] ?? 0;
  const featuredSay = [...match.chat].reverse().find((c) => c.seat === featured);
  const waitingNames = st.waitingOn.filter((s) => s !== me).map((s) => names[s]);
  const status =
    st.resultText ??
    ui.status?.(match.view, match) ??
    (me === null ? `观战中 · 等 ${waitingNames.join("、")}` : myTurn ? "轮到你了" : `${waitingNames.join("、") || "对手"} 思考中…`);
  const badge = ui.badge?.(match.view, match) ?? { value: String(match.log.length), label: "MOVE" };
  const unread = match.chat.length > seenChat && match.chat.at(-1)?.seat !== me;
  const labelOf = (i: Seat) => match.labels[i] ?? "";
  const seatLine =
    n === 2
      ? [me ?? 0, 1 - (me ?? 0)].map((i) => `${names[i]} ${labelOf(i)}`).join(" · ")
      : `${n} 人桌 · ${me === null ? "观战" : `你 ${labelOf(me) || `${me + 1} 号位`}`}`;
  const thinking = !st.outcome && acting === featured;
  const subtitle = (
    <>
      {thinking && <span className="pulse-dot mr-1">●</span>}
      {featuredSay ? `“${featuredSay.text}”` : seatLine}
    </>
  );
  const openSeats = match.seats.some((s) => s.kind !== "bot" && !s.joined);
  const verdict = st.outcome
    ? me !== null && st.outcome.winners.includes(me)
      ? "WIN"
      : st.outcome.winners.length === 0
        ? "DRAW"
        : me === null
          ? "END"
          : "LOSE"
    : null;

  // 结算监听：向掌机派发战报
  useEffect(() => {
    if (!st.outcome) return;
    const isMeWin = me !== null && st.outcome.winners.includes(me);
    const resultType = isMeWin ? "胜" : "负";
    const movesCount = match.log.length;

    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: "MCYT_LOBBY_MATCH_FINISH",
            action: "game_over",
            resultType,
            winner: isMeWin ? "me" : "ai",
            movesCount,
            kind: match.kind,
            log: match.log,
          },
          "*",
        );
      }
    } catch (_) {}
  }, [st.outcome, me, match.log.length, match.kind]);

  const exitToHost = () => {
    if (embedded) {
      try {
        window.parent?.postMessage({ type: "MCYT_LOBBY_EXIT" }, "*");
      } catch (_) {}
    } else {
      navigate("/");
    }
  };

  const Actions = ui.Actions;
  const board =
    ui.shape === "square" ? (
      <div className="board-fit min-h-0 flex-1">
        <div className="board-box glass grid place-items-center !rounded-[24px] p-1 lg:p-3">
          <ui.Board {...props} />
        </div>
      </div>
    ) : (
      <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden !rounded-[24px] p-2 lg:p-4">
        <ui.Board {...props} />
      </div>
    );

  // 精准匹配自建联系人头像，增强防御并消灭裂图
  const featuredName = names[featured] || "";
  const featuredNpc =
    embeddedNpcs.find((npc) => npc.name === featuredName || String(featured) === npc.id) ||
    embeddedNpcs[featured - 1] ||
    embeddedNpcs[0];

  const avatarSrc = featuredNpc?.avatar?.trim();

  /** 局内座位药丸标签 */
  const seatStrip =
    n > 2 ? (
      <div className="flex shrink-0 gap-1.5 overflow-x-auto py-0.5">
        {match.seats.map((s, i) => {
          const waiting = !st.outcome && st.waitingOn.includes(i);
          return (
            <span key={i} className={`chip shrink-0 !px-2.5 !py-1 !text-[0.8rem] ${i === me ? "!border-black/30 !text-ink" : ""}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${waiting ? "bg-ink pulse-dot" : "bg-faint"}`} />
              {i === me ? "你" : s.name}
              {labelOf(i) && <span className="text-faint">{labelOf(i)}</span>}
            </span>
          );
        })}
      </div>
    ) : null;

  const sheets = (
    <>
      {chatOpen && (
        <Sheet title="Whisper" onClose={() => setChatOpen(false)}>
          <ChatList chat={match.chat} me={me} names={names} className="mt-3 min-h-0 flex-1" />
          {me !== null && (
            <div className="mt-3 flex shrink-0">
              <ChatInput to={n === 2 ? names[1 - me]! : "大家"} busy={busy} compact onSend={(text) => send({ type: "say", text })} />
            </div>
          )}
        </Sheet>
      )}
      {namesOpen && (
        <NameSheet
          seats={match.seats.map((s, i) => ({ name: s.name, label: `${labelOf(i) || s.kind}${i === me ? " · 你" : ""}` }))}
          onClose={() => setNamesOpen(false)}
          onSave={async (next) => {
            for (let i = 0; i < next.length; i++) {
              if (next[i] !== names[i] && !(await send({ type: "rename", seat: i, name: next[i]! }))) return false;
            }
            return true;
          }}
        />
      )}
      {confirmResign && (
        <WeChatConfirmModal
          title="认输确认"
          content="认输后当局将直接结算，是否确定认输？"
          onConfirm={() => {
            setConfirmResign(false);
            void send({ type: "resign" });
          }}
          onCancel={() => setConfirmResign(false)}
        />
      )}
    </>
  );

  const pill = (
    <button onClick={() => setChatOpen(true)} className="pill-black flex shrink-0 items-center gap-3 !rounded-[24px] px-3.5 py-2.5 text-left land:gap-2 land:!rounded-[16px] land:px-2.5 land:py-1.5">
      <span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-white/15 bg-[#222] land:h-9 land:w-9">
        {avatarSrc && !imgError ? (
          <img
            src={avatarSrc}
            alt={featuredName}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#07c160]/20 text-xs font-semibold text-[#07c160]">
            {featuredName ? featuredName.slice(0, 1) : <DropMark width={20} height={20} />}
          </div>
        )}
        {unread && <span className="absolute top-0 right-0 h-2.5 w-2.5 rounded-full border border-black bg-[#fa5151]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[1.2rem] font-semibold leading-tight text-white land:text-[1rem]">{featuredName}</span>
        <span className="block truncate text-[0.85rem] text-white/70 land:text-[0.75rem]">{subtitle}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[1.35rem] font-bold leading-none text-white land:text-[1.1rem]">{verdict ?? badge.value}</span>
        <span className="mt-1 block text-[0.7rem] text-white/55 land:text-[0.62rem]">{verdict ? mod.name.zh : badge.label}</span>
      </span>
    </button>
  );

  const iconButtons = (
    <>
      {!st.outcome && me !== null && (
        <button className="btn btn-glass shrink-0 !px-3.5" onClick={() => setConfirmResign(true)} aria-label="认输">
          <IconFlag width={19} height={19} />
        </button>
      )}
      {onInvite && openSeats && (
        <button className="btn btn-glass shrink-0 !px-3.5" onClick={onInvite} aria-label="邀请">
          <IconInvite width={19} height={19} />
        </button>
      )}
      {!embedded && (
        <button className="btn btn-glass shrink-0 !px-3.5" onClick={() => setNamesOpen(true)} aria-label="名字">
          <IconName width={19} height={19} />
        </button>
      )}
      <button className="btn btn-glass relative shrink-0 !px-3.5" onClick={() => setChatOpen(true)} aria-label="聊天">
        <IconChat width={19} height={19} />
        {unread && <span className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-[#fa5151]" />}
      </button>
    </>
  );

  // 嵌入主播掌机环境时，统一采用全景竖直/自适应流，彻底消灭挤扁的左右硬割裂横屏
  if (!wide || embedded) {
    return (
      <>
        {toast.node}
        <Header
          status={chip}
          left={
            <div className="flex min-w-0 items-center gap-2 text-[1rem]">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${myTurn ? "bg-[#07c160] pulse-dot" : "bg-faint"}`} />
              <span className="truncate">{status}</span>
            </div>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {pill}
          {seatStrip}
          {board}
          <div className="flex shrink-0 gap-2 [&_.btn]:!min-h-[44px]">
            {Actions && !st.outcome && me !== null ? (
              <Actions {...props} />
            ) : (
              <div className="chip min-w-0 flex-1 justify-center !text-ink">
                <span className="truncate">
                  {match.log.length ? `${match.log.at(-1)!.seat === me ? "你" : names[match.log.at(-1)!.seat]} · ${match.log.at(-1)!.move}` : mod.name.zh}
                </span>
              </div>
            )}
            {iconButtons}
          </div>
          {extra}
        </div>
        {sheets}
      </>
    );
  }

  // 大屏宽屏桌面端
  const stats = ui.stats?.(match.view, match) ?? [];
  return (
    <>
      {toast.node}
      <Header status={chip} />
      <div className="game-grid">
        <motion.div {...card} className="area-pill flex flex-col gap-2">
          <Pill title={names[featured]} subtitle={subtitle} onClick={() => setChatOpen(true)} />
          {seatStrip}
        </motion.div>
        <motion.section {...card} className="glass area-hero px-7 py-6">
          <div className="text-[1.4rem] text-ink-2">
            {mod.name.en} · {mod.name.zh}
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-[3.6rem] font-bold leading-[1.02] tracking-tight">{st.outcome ? st.outcome.text : badge.value}</span>
            {!st.outcome && <span className="text-[1rem] tracking-wide text-muted">{badge.label}</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[1.05rem] text-muted">
            <span>{seatLine}</span>
            {!embedded && (
              <button className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.95rem] text-ink-2 hover:bg-white/50" onClick={() => setNamesOpen(true)}>
                <IconName width={16} height={16} /> 改名
              </button>
            )}
            {onInvite && (
              <button className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.95rem] text-ink-2 hover:bg-white/50" onClick={onInvite}>
                <IconInvite width={16} height={16} /> 邀请
              </button>
            )}
          </div>
          <div className="mt-1 text-[1.05rem] text-ink">{status}</div>
        </motion.section>
        <motion.section {...card} className="area-board flex h-[min(78vh,760px)] flex-col">
          {board}
        </motion.section>
        {me !== null && !st.outcome && (
          <motion.section {...card} className="area-controls flex flex-wrap gap-3">
            {Actions && <Actions {...props} />}
            <button className="btn btn-glass flex-1" onClick={() => setConfirmResign(true)}>
              认输
            </button>
          </motion.section>
        )}
        {stats.length > 0 && (
          <motion.section {...card} className="glass area-stats px-7 py-6">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(76px,1fr))] gap-4">
              {stats.map((s) => (
                <Stat key={s.label} label={s.label} value={s.value} />
              ))}
            </div>
          </motion.section>
        )}
        <div className="area-chat flex flex-col gap-3">
          <motion.section {...card} className="glass px-6 py-5">
            <div className="text-[1.3rem] font-semibold">Whisper</div>
            <ChatList chat={match.chat} me={me} names={names} className="mt-3 max-h-56" />
            {me !== null && (
              <div className="mt-3 flex">
                <ChatInput to={n === 2 ? names[1 - me]! : "大家"} busy={busy} onSend={(text) => send({ type: "say", text })} />
              </div>
            )}
          </motion.section>
          {extra}
        </div>
      </div>
      {sheets}
    </>
  );
}
