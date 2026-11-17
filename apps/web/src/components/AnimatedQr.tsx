import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

type Props = {
  frames: string[];
  /** Module colour: slate on the phone, brass ink on the Home Key. */
  color?: string;
  label: string;
  intervalMs?: number;
};

/**
 * Plays message frames as a looping QR code. One QR holds at most 2,953 bytes,
 * so requests and signatures go over in several frames.
 */
export function AnimatedQr({ frames, color = "#1C2530", label, intervalMs = 450 }: Props) {
  const [images, setImages] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all(
      frames.map((f) =>
        QRCode.toDataURL(f, { errorCorrectionLevel: "L", margin: 1, width: 560, color: { dark: color, light: "#FFFFFF" } }),
      ),
    ).then((urls) => alive && setImages(urls));
    setIndex(0);
    return () => {
      alive = false;
    };
  }, [frames, color]);

  const reduced = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    if (images.length < 2) return;
    // With reduced motion the frames still advance (the data needs them), just slower.
    const t = setInterval(() => setIndex((i) => (i + 1) % images.length), reduced ? 1200 : intervalMs);
    return () => clearInterval(t);
  }, [images.length, intervalMs, reduced]);

  const copyAll = async () => {
    await navigator.clipboard.writeText(frames.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <figure className="qr">
      <div className="qr-box">
        {images[index] ? (
          <img src={images[index]} alt={`${label}, frame ${index + 1} of ${frames.length}`} width={290} height={290} />
        ) : (
          <div className="qr-placeholder" aria-hidden="true" />
        )}
      </div>
      <figcaption className="qr-caption">
        <div className="qr-progress" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${frames.length}, minmax(0, 1fr))` }}>
          {frames.map((_, i) => (
            <span key={i} style={{ background: i <= index ? color : "#D9DEE3" }} />
          ))}
        </div>
        <span className="tiny muted">
          Frame {index + 1} of {frames.length}. Hold it in front of the other device's camera.
        </span>
        <button type="button" className="btn btn-ghost small" onClick={copyAll}>
          {copied ? "Copied as text" : "Copy as text instead"}
        </button>
      </figcaption>
    </figure>
  );
}
