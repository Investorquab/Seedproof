import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { FrameCollector } from "@seedproof/core";

type Props = {
  /** Called once with the joined, checksum-verified message. */
  onMessage: (message: unknown) => void;
  tone?: "pocket" | "home";
};

/**
 * Reads Seedproof frames from the camera (animated QR) or from pasted text.
 * Frames may arrive in any order; the collector checks the joined message.
 */
export function FrameReader({ onMessage, tone = "pocket" }: Props) {
  const collector = useRef(new FrameCollector());
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"camera" | "paste">("paste");
  const [progress, setProgress] = useState<{ have: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  const feed = (text: string): boolean => {
    const r = collector.current.add(text.trim());
    if (r.status === "progress") setProgress({ have: r.have, total: r.total });
    if (r.status === "complete") {
      setProgress(null);
      onMessage(r.message);
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (mode !== "camera") return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const tick = () => {
          if (stopped) return;
          const canvas = canvasRef.current!;
          if (video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (code?.data && feed(code.data)) return;
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setError("The camera is not available here. Paste the frames as text instead.");
        setMode("paste");
      }
    };
    start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const submitPaste = () => {
    setError(null);
    const lines = pasted.split(/\s*\n\s*/).filter(Boolean);
    let done = false;
    for (const l of lines) done = feed(l) || done;
    if (!done) setError("Some frames are missing. Copy all of them from the other device and paste again.");
  };

  return (
    <div className={`reader reader-${tone}`}>
      <div className="reader-tabs" role="tablist" aria-label="How to read the other device">
        <button type="button" role="tab" aria-selected={mode === "camera"} className="reader-tab" onClick={() => setMode("camera")}>
          Use camera
        </button>
        <button type="button" role="tab" aria-selected={mode === "paste"} className="reader-tab" onClick={() => setMode("paste")}>
          Paste text
        </button>
      </div>

      {mode === "camera" ? (
        <div className="reader-camera">
          <video ref={videoRef} muted playsInline aria-label="Camera view" />
          <canvas ref={canvasRef} hidden />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="frames">Frames from the other device</label>
          <textarea id="frames" className="input" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="SP1/..." />
          <button type="button" className={tone === "home" ? "btn btn-brass" : "btn btn-ink"} onClick={submitPaste} disabled={!pasted.trim()}>
            Read frames
          </button>
        </div>
      )}

      <p className="tiny muted" role="status" aria-live="polite">
        {progress ? `Got ${progress.have} of ${progress.total} frames` : " "}
      </p>
      {error && <p className="tiny" style={{ color: "var(--refused)" }}>{error}</p>}
    </div>
  );
}
