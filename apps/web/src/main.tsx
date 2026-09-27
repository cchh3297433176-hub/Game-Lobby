import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./components/Shell";
import { Connect } from "./pages/Connect";
import { MatchPage } from "./pages/Match";
import { Lobby } from "./pages/Lobby";
import { useRoute } from "./router";
import "./styles.css";

function App() {
  const route = useRoute();
  return (
    <Shell route={route} wide={route.name === "game"}>
      {route.name === "game" ? (
        <MatchPage key={route.id} id={route.id} />
      ) : route.name === "connect" ? (
        <Connect />
      ) : (
        <Lobby />
      )}
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
