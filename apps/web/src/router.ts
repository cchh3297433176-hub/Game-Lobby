import { useEffect, useState } from "react";

export type Route =
  | { name: "lobby" }
  | { name: "game"; id: string }
  | { name: "connect" }
  | { name: "sandbox"; kind: string };

/**
 * 判断当前是否处于主播掌机 WebView 的 iframe 嵌入环境
 */
export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.self !== window.top) return true;
  } catch (_) {
    return true;
  }
  const q = new URLSearchParams(location.search);
  const hash = location.hash || "";
  return q.has("matchId") || q.has("kind") || q.has("npcs") || hash.includes("matchId") || hash.includes("kind");
}

/**
 * 多轨路由解析：优先从 Search 参数与 Hash 路由捕获对局信息，杜绝本地 WebView 路径白屏
 */
export function parseRoute(path: string): Route {
  if (typeof window === "undefined") return { name: "lobby" };

  const searchParams = new URLSearchParams(location.search);
  const hash = location.hash || "";

  // 1. 优先捕获掌机传入的 matchId（Search 或 Hash 参数）
  let matchId = searchParams.get("matchId");
  if (!matchId && hash.includes("matchId=")) {
    const hashQuery = hash.includes("?") ? hash.split("?")[1] : hash.slice(1);
    matchId = new URLSearchParams(hashQuery).get("matchId");
  }
  if (matchId) {
    return { name: "game", id: matchId };
  }

  // 2. 捕获掌机传入的 kind（单机/沙盒对局）
  let kind = searchParams.get("kind");
  if (!kind && hash.includes("kind=")) {
    const hashQuery = hash.includes("?") ? hash.split("?")[1] : hash.slice(1);
    kind = new URLSearchParams(hashQuery).get("kind");
  }
  if (kind && isEmbedded()) {
    // 嵌入模式下如果只有 kind 则进入沙盒或默认开局
    return { name: "sandbox", kind };
  }

  // 3. 兼容 Hash 路由格式（如 #/g/xyz 或 #/sandbox/gomoku）
  const hashMatch = /^#\/g\/([a-z0-9_-]+)\/?/i.exec(hash);
  if (hashMatch) return { name: "game", id: hashMatch[1]! };

  const hashSandbox = /^#\/sandbox\/([a-z0-9_-]+)\/?/i.exec(hash);
  if (hashSandbox) return { name: "sandbox", kind: hashSandbox[1]! };

  if (hash.startsWith("#/connect")) return { name: "connect" };

  // 4. 原生 Pathname 规则
  const g = /^\/g\/([a-z0-9_-]+)\/?$/.exec(path);
  if (g) return { name: "game", id: g[1]! };
  if (path.startsWith("/connect")) return { name: "connect" };
  const sb = /^\/sandbox\/([a-z0-9_-]+)\/?$/.exec(path);
  if (sb) return { name: "sandbox", kind: sb[1]! };

  return { name: "lobby" };
}

export function navigate(path: string) {
  if (path === location.pathname) return;
  history.pushState(null, "", path);
  window.dispatchEvent(new Event("routechange"));
  window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", on);
    window.addEventListener("routechange", on);
    window.addEventListener("hashchange", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("routechange", on);
      window.removeEventListener("hashchange", on);
    };
  }, []);
  return route;
}
