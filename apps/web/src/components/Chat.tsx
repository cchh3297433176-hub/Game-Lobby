import type { MatchChat, Seat } from "@rain-go/engine";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconSend } from "./icons";

export function ChatList({
  chat,
  me,
  names,
  className = "",
  onPoke,
}: {
  chat: MatchChat[];
  me: Seat | null;
  names: string[];
  className?: string;
  onPoke?: (name: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [chat.length]);

  return (
    <div ref={box} className={`space-y-2.5 overflow-y-auto pr-1 ${className}`}>
      {chat.length === 0 && (
        <div className="py-6 text-center text-xs text-muted">
          还没有悄悄话，对同伴说话或点击上方「戳一戳」试试看吧！
        </div>
      )}
      {chat.map((m, i) => {
        const isMe = m.seat === me;
        const speakerName = names[m.seat] || (isMe ? "我" : "同伴");

        return (
          <div key={i} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
            {!isMe && (
              <div className="mb-0.5 flex items-center gap-1.5 pl-1">
                <span className="text-[11px] font-medium text-muted">{speakerName}</span>
                {onPoke && (
                  <button
                    type="button"
                    onClick={() => onPoke(speakerName)}
                    className="rounded bg-[#07c160]/10 px-1.5 py-0.2 text-[10px] font-semibold text-[#07c160] active:scale-95"
                    title={`戳一戳 ${speakerName}`}
                  >
                    戳一戳
                  </button>
                )}
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-[14px] px-3.5 py-2 text-[13.5px] leading-relaxed shadow-sm ${
                isMe
                  ? "bg-[#07c160] text-white"
                  : "border border-[#eaeaea] bg-white text-[#222]"
              }`}
            >
              {m.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ChatInput({
  to,
  busy,
  onSend,
  compact = false,
}: {
  to: string;
  busy: boolean;
  onSend: (t: string) => Promise<boolean>;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");

  return (
    <form
      className="flex min-w-0 flex-1 gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (draft.trim() && (await onSend(draft))) setDraft("");
      }}
    >
      <input
        className={`field min-w-0 text-[13px] ${compact ? "!min-h-[42px]" : ""}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={280}
        placeholder={`对 ${to} 说…`}
        enterKeyHint="send"
      />
      <button
        className={`btn btn-ink shrink-0 !px-3.5 ${compact ? "!min-h-[42px]" : ""}`}
        aria-label="发送"
        disabled={!draft.trim() || busy}
      >
        <IconSend width={18} height={18} />
      </button>
    </form>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  names = [],
  me = 0,
  onPoke,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  names?: string[];
  me?: Seat | null;
  onPoke?: (targetName: string) => void;
}) {
  const opponents = names.filter((_, i) => i !== me);

  return (
    <div
      className="fixed inset-0 z-30 flex items-end bg-black/35 p-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:items-center lg:justify-center animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="glass sheet-enter flex max-h-[78dvh] w-full max-w-[520px] flex-col !rounded-[20px] !bg-white/95 p-4 text-[#222] shadow-xl backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#f0f0f0] pb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold text-[#181818]">{title}</span>
            {opponents.length > 0 && onPoke && (
              <div className="flex items-center gap-1">
                {opponents.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onPoke(n)}
                    className="flex items-center gap-1 rounded-full border border-[#07c160]/30 bg-[#e8f8ee] px-2 py-0.5 text-[11px] font-medium text-[#07c160] active:scale-95"
                  >
                    <span>👉 戳</span>
                    <span className="font-semibold">{n}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="text-xs text-muted hover:text-ink" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
