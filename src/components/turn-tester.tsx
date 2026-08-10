import { useState } from "react"
import { fetchIceServers } from "../services/calls-service"
import { useTranslation, type Cle } from "../i18n"

/**
 * Testeur de serveurs TURN — pour comparer des fournisseurs (Metered, Cloudflare,
 * ExpressTURN, coturn auto-heberge...) sans toucher au code : on colle les
 * identifiants, on lance le test, et on voit si un candidat "relay" est obtenu
 * et en combien de temps. Un fournisseur qui ne produit aucun relay ne fera
 * jamais passer les appels entre reseaux differents.
 */

interface TestResult {
  host: number
  srflx: number
  relay: number
  /** Temps (ms) pour obtenir le premier candidat relay, null si aucun. */
  firstRelayMs: number | null
  elapsedMs: number
}

async function gatherCandidates(servers: RTCIceServer[], timeoutMs = 8000): Promise<TestResult> {
  const pc = new RTCPeerConnection({ iceServers: servers })
  const counts = { host: 0, srflx: 0, relay: 0 }
  let firstRelayMs: number | null = null
  const startedAt = Date.now()

  pc.createDataChannel("probe")
  pc.onicecandidate = (event) => {
    if (!event.candidate) return
    const line = event.candidate.candidate
    if (line.includes(" typ relay ")) {
      counts.relay += 1
      if (firstRelayMs === null) firstRelayMs = Date.now() - startedAt
    } else if (line.includes(" typ srflx ")) {
      counts.srflx += 1
    } else if (line.includes(" typ host ")) {
      counts.host += 1
    }
  }

  await pc.setLocalDescription(await pc.createOffer())

  // On attend la fin de la collecte, ou le timeout (serveur injoignable).
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer)
        resolve()
      }
    }
  })

  pc.close()
  return { ...counts, firstRelayMs, elapsedMs: Date.now() - startedAt }
}

export default function TurnTester() {
  const { t } = useTranslation()
  const [urls, setUrls] = useState("")
  const [username, setUsername] = useState("")
  const [credential, setCredential] = useState("")
  const [testing, setTesting] = useState<"current" | "custom" | null>(null)
  const [result, setResult] = useState<{ label: Cle; data: TestResult } | null>(null)
  const [error, setError] = useState("")

  const runTest = async (label: Cle, servers: RTCIceServer[], kind: "current" | "custom") => {
    setTesting(kind)
    setResult(null)
    setError("")
    try {
      const data = await gatherCandidates(servers)
      setResult({ label, data })
    } catch (err) {
      setError(err instanceof Error ? err.message : t("turn_test_unsupported"))
    } finally {
      setTesting(null)
    }
  }

  const testCurrent = async () => {
    const servers = await fetchIceServers()
    await runTest("turn_current_config", servers, "current")
  }

  const testCustom = async () => {
    const list = urls
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean)
    if (list.length === 0) {
      setError(t("turn_need_url"))
      return
    }
    await runTest(
      "turn_manual_provider",
      [{ urls: list, username: username.trim() || undefined, credential: credential || undefined }],
      "custom"
    )
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 10,
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-input)",
    color: "var(--text-primary)",
    fontSize: 12,
    fontFamily: "'DM Sans', sans-serif",
  }

  const btnStyle: React.CSSProperties = {
    background: "var(--accent)",
    color: "var(--accent-text)",
    border: "none",
    borderRadius: 9,
    padding: "9px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif",
  }

  const verdictOk = result !== null && result.data.relay > 0

  return (
    <div className="s-card">
      <div className="s-card-title">{t("turn_title")}</div>
      <p
        style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, margin: "6px 0 14px" }}
      >
        {t("turn_explain")}
      </p>

      <button style={btnStyle} onClick={() => void testCurrent()} disabled={testing !== null}>
        {testing === "current" ? t("turn_testing") : t("turn_test_current")}
      </button>

      <div
        style={{ borderTop: "1px solid var(--border-subtle)", margin: "16px 0", paddingTop: 14 }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginBottom: 10,
          }}
        >
          {t("turn_test_other")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            style={inputStyle}
            placeholder={t("turn_urls_placeholder")}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={inputStyle}
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              style={inputStyle}
              placeholder="Credential"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
            />
          </div>
          <button
            style={{ ...btnStyle, alignSelf: "flex-start" }}
            onClick={() => void testCustom()}
            disabled={testing !== null}
          >
            {testing === "custom" ? t("turn_testing") : t("turn_test_these")}
          </button>
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>{error}</div>}

      {result && (
        <div
          style={{
            marginTop: 8,
            padding: "12px 14px",
            borderRadius: 10,
            border: `1px solid ${verdictOk ? "var(--success)" : "var(--danger)"}`,
            background: verdictOk ? "rgba(46, 125, 50, 0.08)" : "rgba(239, 68, 68, 0.08)",
            fontSize: 12,
            lineHeight: 1.7,
            color: "var(--text-primary)",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {verdictOk ? t("turn_ok") : t("turn_ko")}
          </div>
          <div style={{ color: "var(--text-secondary)" }}>
            {t(result.label)} — {t("turn_candidates")} : {result.data.relay} relay,{" "}
            {result.data.srflx} srflx, {result.data.host} host
            {result.data.firstRelayMs !== null && (
              <>
                {" "}
                — {t("turn_first_relay")} <strong>{result.data.firstRelayMs} ms</strong>
              </>
            )}{" "}
            ({t("turn_test_label")} : {(result.data.elapsedMs / 1000).toFixed(1)} s)
          </div>
          {!verdictOk && (
            <div style={{ color: "var(--text-muted)", marginTop: 4 }}>{t("turn_ko_detail")}</div>
          )}
        </div>
      )}
    </div>
  )
}
