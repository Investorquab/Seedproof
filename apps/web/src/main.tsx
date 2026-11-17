import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./styles.css";
import { Landing } from "./pages/Landing";

// The device apps carry the signing and sealing code; load each only when it is opened.
const HomeKey = lazy(() => import("./pages/HomeKey").then((m) => ({ default: m.HomeKey })));
const Pocket = lazy(() => import("./pages/Pocket").then((m) => ({ default: m.Pocket })));
const Guardian = lazy(() => import("./pages/Guardian").then((m) => ({ default: m.Guardian })));

const loading = <p className="small muted" style={{ padding: 24 }}>Opening…</p>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={loading}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/home-key" element={<HomeKey />} />
          <Route path="/pocket" element={<Pocket />} />
          <Route path="/guardian" element={<Guardian />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
