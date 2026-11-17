import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./styles.css";
import { Landing } from "./pages/Landing";
import { HomeKey } from "./pages/HomeKey";
import { Pocket } from "./pages/Pocket";
import { Guardian } from "./pages/Guardian";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/home-key" element={<HomeKey />} />
        <Route path="/pocket" element={<Pocket />} />
        <Route path="/guardian" element={<Guardian />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
