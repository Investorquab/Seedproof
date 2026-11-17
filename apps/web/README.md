# Seedproof web app

One app, three routes:

| Route | What it is |
|---|---|
| `/` | Landing page and the "One secret or two?" check |
| `/pocket` | The phone: classical key, today's window, asks the Home Key for everything else |
| `/home-key` | The second device: independent ML-DSA-87 key, reads every request in plain words, signs |

The two devices talk through animated QR codes (or copied text), because a post-quantum signature (4,627 bytes) does not fit in one QR code.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

Secrets stay in the browser, sealed with your passphrase (PBKDF2-SHA256, 600,000 rounds, AES-GCM). Testnet only.

The protocol lives in [`packages/core`](../../packages/core) and is imported through the `@seedproof/core` alias.
