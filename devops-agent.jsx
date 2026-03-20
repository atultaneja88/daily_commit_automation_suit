import { useState, useRef, useEffect } from "react";

const SYSTEM_PROMPT = `You are an intelligent DevOps Automation Agent responsible for integrating Jira and GitHub workflows.
Your job is to analyze Jira issue data and decide what GitHub actions should be performed.

INPUT: You will receive:
1. Jira Issue JSON (including fields, description, comments)
2. Repository details (repo name, default branch)
3. Existing branches (optional)

TASKS:
1. Validate Trigger:
   * Only proceed if Jira issue status is "Accepted"
   * Otherwise return: { "status": "NO_ACTION", "reason": "Issue not in Accepted state" }

2. Extract Key Information:
   * Jira Issue Key (e.g., ABC-123)
   * Milestone / Fix Version (e.g., 26.2)
   * PR links from Description and Comments
   * If multiple PR links exist, select the most relevant/latest one

3. Determine Release Branch:
   * Format: release/{milestone}
   * Example: release/26.2

4. Check Branch Strategy:
   * If release branch does not exist → create it from default branch
   * If already exists → reuse it

5. Analyze PR:
   * Extract PR number, source branch, repository name
   * If no PR found → return "NO_PR_FOUND"

6. Decide Actions (CREATE_BRANCH, FETCH_PR_DETAILS, CREATE_PR_TO_RELEASE, ADD_LABELS, ADD_COMMENT, SKIP)

7. Create New PR Strategy:
   * Source branch = original PR branch
   * Target branch = release/{milestone}
   * Title format: "[Release {milestone}] {original PR title}"
   * Description must include: Jira issue key, Original PR link, Release version

8. Edge Case Handling:
   * If no PR link → SKIP
   * If branch already merged → SKIP
   * If release branch exists → do not recreate
   * If multiple PRs → process all or pick latest

OUTPUT: Return ONLY valid JSON in this exact format:
{
  "jira_issue": "",
  "milestone": "",
  "release_branch": "",
  "pr_detected": true,
  "pr_links": [],
  "selected_pr": "",
  "actions": [
    { "type": "CREATE_BRANCH", "branch_name": "" },
    { "type": "CREATE_PR_TO_RELEASE", "source_branch": "", "target_branch": "", "title": "", "description": "" }
  ],
  "reasoning": ""
}

CRITICAL: Output ONLY raw JSON. No markdown, no code fences, no explanation text outside the JSON.`;

const ACTION_META = {
  CREATE_BRANCH:       { color: "#3b82f6", icon: "⎇", label: "Create Branch" },
  FETCH_PR_DETAILS:    { color: "#8b5cf6", icon: "🔍", label: "Fetch PR Details" },
  CREATE_PR_TO_RELEASE:{ color: "#10b981", icon: "⇢", label: "Create PR → Release" },
  ADD_LABELS:          { color: "#f59e0b", icon: "🏷", label: "Add Labels" },
  ADD_COMMENT:         { color: "#06b6d4", icon: "💬", label: "Add Comment" },
  SKIP:                { color: "#6b7280", icon: "⏭", label: "Skip" },
};

const SAMPLE_INPUT = {
  jira: JSON.stringify({
  key: "PROJ-447",
  fields: {
    summary: "Fix null pointer exception in payment gateway",
    status: { name: "Accepted" },
    fixVersions: [{ name: "26.2" }],
    description: "This issue causes NPE in production.\nFix PR: https://github.com/myorg/myrepo/pull/318",
    comment: {
      comments: [
        { body: "Reviewed and approved. Ref: https://github.com/myorg/myrepo/pull/318", author: "john.doe" },
        { body: "Please cherry-pick to release branch.", author: "jane.smith" }
      ]
    }
  }
}, null, 2),
  repo: "myorg/myrepo",
  branch: "main",
  existing: "main\nrelease/26.1\nfeature/payment-fix"
};

export default function DevOpsAgent() {
  const [jiraJson, setJiraJson]       = useState(SAMPLE_INPUT.jira);
  const [repoName, setRepoName]       = useState(SAMPLE_INPUT.repo);
  const [defaultBranch, setDefaultBranch] = useState(SAMPLE_INPUT.branch);
  const [existingBranches, setExistingBranches] = useState(SAMPLE_INPUT.existing);
  const [result, setResult]           = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [logLines, setLogLines]       = useState([]);
  const [activeTab, setActiveTab]     = useState("input");
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  const addLog = (msg, type = "info") => {
    setLogLines(prev => [...prev, { msg, type, ts: new Date().toLocaleTimeString() }]);
  };

  const runAgent = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setLogLines([]);
    setActiveTab("output");

    try {
      addLog("🚀 Agent initializing...", "info");
      addLog("📋 Parsing Jira issue payload...", "info");

      let parsedJira;
      try {
        parsedJira = JSON.parse(jiraJson);
      } catch {
        throw new Error("Invalid Jira JSON — please check the format.");
      }

      const status = parsedJira?.fields?.status?.name || parsedJira?.status?.name || "unknown";
      addLog(`🔍 Issue status detected: "${status}"`, status === "Accepted" ? "success" : "warn");

      if (status !== "Accepted") {
        addLog("⛔ Status is not 'Accepted' — agent will return NO_ACTION.", "warn");
      }

      const userPrompt = `
Jira Issue JSON:
${jiraJson}

Repository: ${repoName}
Default Branch: ${defaultBranch}
Existing Branches:
${existingBranches || "(none provided)"}
      `.trim();

      addLog("🤖 Sending to Claude AI Agent...", "info");

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }]
        })
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);

      const data = await response.json();
      const raw = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";

      addLog("✅ Agent response received.", "success");
      addLog("🔎 Parsing action plan JSON...", "info");

      const clean = raw.replace(/```json|```/gi, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch {
        throw new Error("Agent returned malformed JSON:\n" + raw);
      }

      if (parsed.status === "NO_ACTION") {
        addLog("🚫 NO_ACTION — trigger condition not met.", "warn");
        setResult({ _no_action: true, ...parsed });
        return;
      }
      if (parsed.status === "NO_PR_FOUND") {
        addLog("🚫 NO_PR_FOUND — no pull request detected.", "warn");
        setResult({ _no_pr: true, ...parsed });
        return;
      }

      addLog(`📌 Jira Issue: ${parsed.jira_issue}`, "success");
      addLog(`🏷  Milestone: ${parsed.milestone}`, "success");
      addLog(`⎇  Release Branch: ${parsed.release_branch}`, "success");
      addLog(`🔗 PR Detected: ${parsed.pr_detected ? "Yes" : "No"}`, parsed.pr_detected ? "success" : "warn");

      (parsed.actions || []).forEach(a => {
        const meta = ACTION_META[a.type] || {};
        addLog(`⚡ Action queued: ${meta.label || a.type}`, "action");
      });

      addLog("🎯 Action plan complete — ready for execution.", "success");
      setResult(parsed);

    } catch (e) {
      addLog(`❌ Error: ${e.message}`, "error");
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const logColor = { info: "#94a3b8", success: "#34d399", warn: "#fbbf24", error: "#f87171", action: "#a78bfa" };

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", background: "#070b14", minHeight: "100vh", color: "#e2e8f0", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
        textarea { resize: vertical; }
        .tab-btn { background: none; border: none; cursor: pointer; padding: 10px 20px; font-family: inherit; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; transition: all .2s; border-bottom: 2px solid transparent; }
        .tab-btn.active { color: #38bdf8; border-bottom-color: #38bdf8; }
        .tab-btn:not(.active) { color: #475569; }
        .tab-btn:hover:not(.active) { color: #94a3b8; }
        .run-btn { background: linear-gradient(135deg, #0ea5e9, #6366f1); border: none; color: white; padding: 12px 32px; font-family: inherit; font-weight: 700; font-size: 13px; letter-spacing: 2px; cursor: pointer; border-radius: 6px; transition: all .2s; text-transform: uppercase; }
        .run-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(99,102,241,.4); }
        .run-btn:disabled { opacity: .5; cursor: not-allowed; }
        .field-label { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #475569; margin-bottom: 6px; display: block; }
        .field-input { width: 100%; background: #0f172a; border: 1px solid #1e293b; color: #e2e8f0; font-family: inherit; font-size: 12px; padding: 10px 12px; border-radius: 6px; outline: none; transition: border-color .2s; }
        .field-input:focus { border-color: #38bdf8; }
        .action-card { background: #0f172a; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; border-left: 3px solid; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        .fade-in { animation: fadeIn .4s ease; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      `}</style>

      {/* Header */}
      <div style={{ background: "#0a0f1e", borderBottom: "1px solid #1e293b", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ background: "linear-gradient(135deg,#0ea5e9,#6366f1)", width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚙</div>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 16, letterSpacing: 1, color: "#f1f5f9" }}>DevOps Automation Agent</div>
            <div style={{ fontSize: 10, color: "#475569", letterSpacing: 2 }}>JIRA × GITHUB WORKFLOW INTELLIGENCE</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: loading ? "#fbbf24" : "#34d399", boxShadow: loading ? "0 0 8px #fbbf24" : "0 0 8px #34d399" }} className={loading ? "pulse" : ""} />
          <span style={{ fontSize: 10, color: "#475569", letterSpacing: 2 }}>{loading ? "PROCESSING" : "READY"}</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: "#0a0f1e", borderBottom: "1px solid #1e293b", padding: "0 28px", display: "flex" }}>
        <button className={`tab-btn ${activeTab === "input" ? "active" : ""}`} onClick={() => setActiveTab("input")}>⌨ Input</button>
        <button className={`tab-btn ${activeTab === "output" ? "active" : ""}`} onClick={() => setActiveTab("output")}>⚡ Output</button>
        <button className={`tab-btn ${activeTab === "json" ? "active" : ""}`} onClick={() => setActiveTab("json")}>{ } Raw JSON</button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left Panel */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", borderRight: "1px solid #1e293b" }}>

          {activeTab === "input" && (
            <div className="fade-in">
              <div style={{ marginBottom: 20 }}>
                <span className="field-label">Jira Issue JSON</span>
                <textarea className="field-input" rows={14} value={jiraJson} onChange={e => setJiraJson(e.target.value)} placeholder='{ "key": "ABC-123", "fields": { ... } }' />
              </div>
              <div className="grid-2" style={{ marginBottom: 16 }}>
                <div>
                  <span className="field-label">Repository (org/repo)</span>
                  <input className="field-input" value={repoName} onChange={e => setRepoName(e.target.value)} placeholder="myorg/myrepo" />
                </div>
                <div>
                  <span className="field-label">Default Branch</span>
                  <input className="field-input" value={defaultBranch} onChange={e => setDefaultBranch(e.target.value)} placeholder="main" />
                </div>
              </div>
              <div style={{ marginBottom: 24 }}>
                <span className="field-label">Existing Branches (one per line, optional)</span>
                <textarea className="field-input" rows={4} value={existingBranches} onChange={e => setExistingBranches(e.target.value)} placeholder={"main\nrelease/26.1\nfeature/my-branch"} />
              </div>
              <button className="run-btn" onClick={runAgent} disabled={loading}>
                {loading ? "⟳  Running Agent..." : "▶  Run Agent"}
              </button>
            </div>
          )}

          {activeTab === "output" && (
            <div className="fade-in">
              <div style={{ fontSize: 10, color: "#475569", letterSpacing: 2, marginBottom: 12 }}>AGENT LOG</div>
              <div ref={logRef} style={{ background: "#0a0f1e", borderRadius: 8, border: "1px solid #1e293b", padding: "14px 16px", height: 320, overflowY: "auto", fontFamily: "monospace", fontSize: 11 }}>
                {logLines.length === 0 && <div style={{ color: "#334155" }}>// Run the agent to see live logs...</div>}
                {logLines.map((l, i) => (
                  <div key={i} style={{ color: logColor[l.type], marginBottom: 4, lineHeight: 1.6 }}>
                    <span style={{ color: "#334155", marginRight: 10 }}>{l.ts}</span>{l.msg}
                  </div>
                ))}
                {loading && <div style={{ color: "#6366f1" }} className="pulse">▌</div>}
              </div>

              {error && (
                <div style={{ marginTop: 16, background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: "12px 16px", color: "#f87171", fontSize: 12 }}>
                  ❌ {error}
                </div>
              )}

              {result && !result._no_action && !result._no_pr && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 10, color: "#475569", letterSpacing: 2, marginBottom: 12 }}>ACTION PLAN</div>
                  {(result.actions || []).map((action, i) => {
                    const meta = ACTION_META[action.type] || { color: "#6b7280", icon: "•", label: action.type };
                    return (
                      <div key={i} className="action-card fade-in" style={{ borderLeftColor: meta.color }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <span style={{ fontSize: 18 }}>{meta.icon}</span>
                          <span className="badge" style={{ background: meta.color + "22", color: meta.color, border: `1px solid ${meta.color}44` }}>{meta.label}</span>
                        </div>
                        {action.branch_name && <div style={{ color: "#94a3b8", fontSize: 11 }}>Branch: <span style={{ color: "#38bdf8" }}>{action.branch_name}</span></div>}
                        {action.source_branch && <div style={{ color: "#94a3b8", fontSize: 11 }}>Source: <span style={{ color: "#38bdf8" }}>{action.source_branch}</span> → Target: <span style={{ color: "#34d399" }}>{action.target_branch}</span></div>}
                        {action.title && <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 4 }}>Title: <span style={{ color: "#e2e8f0" }}>{action.title}</span></div>}
                        {action.description && (
                          <div style={{ marginTop: 8, background: "#070b14", borderRadius: 4, padding: "8px 10px", fontSize: 11, color: "#64748b", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                            {action.description}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {result?._no_action && (
                <div style={{ marginTop: 16, background: "#1a1200", border: "1px solid #78350f", borderRadius: 8, padding: 20, textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>⛔</div>
                  <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 14 }}>NO_ACTION</div>
                  <div style={{ color: "#92400e", fontSize: 12, marginTop: 6 }}>{result.reason || "Issue not in Accepted state"}</div>
                </div>
              )}

              {result?._no_pr && (
                <div style={{ marginTop: 16, background: "#0f1a2e", border: "1px solid #1e3a5f", borderRadius: 8, padding: 20, textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                  <div style={{ color: "#38bdf8", fontWeight: 700, fontSize: 14 }}>NO_PR_FOUND</div>
                  <div style={{ color: "#475569", fontSize: 12, marginTop: 6 }}>No pull request links detected in description or comments.</div>
                </div>
              )}
            </div>
          )}

          {activeTab === "json" && (
            <div className="fade-in">
              <div style={{ fontSize: 10, color: "#475569", letterSpacing: 2, marginBottom: 12 }}>RAW JSON OUTPUT</div>
              {result ? (
                <pre style={{ background: "#0a0f1e", border: "1px solid #1e293b", borderRadius: 8, padding: 16, fontSize: 11, color: "#94a3b8", overflowX: "auto", lineHeight: 1.7 }}>
                  {JSON.stringify(result, null, 2)}
                </pre>
              ) : (
                <div style={{ color: "#334155", fontSize: 12 }}>// Run the agent to see JSON output...</div>
              )}
            </div>
          )}
        </div>

        {/* Right Panel – Summary */}
        <div style={{ width: 280, overflowY: "auto", padding: "24px 20px", background: "#060a13" }}>
          <div style={{ fontSize: 10, color: "#334155", letterSpacing: 2, marginBottom: 16 }}>ACHIEVEMENT PANEL</div>

          {!result && !loading && (
            <div style={{ color: "#1e293b", fontSize: 12, textAlign: "center", marginTop: 40 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>⚙</div>
              Run agent to<br/>see results
            </div>
          )}

          {loading && (
            <div style={{ textAlign: "center", marginTop: 40 }}>
              <div style={{ fontSize: 36, marginBottom: 12, animation: "pulse 1s infinite" }}>🤖</div>
              <div style={{ color: "#6366f1", fontSize: 12 }} className="pulse">Agent thinking...</div>
            </div>
          )}

          {result && !result._no_action && !result._no_pr && (
            <div className="fade-in">
              {/* Issue card */}
              <div style={{ background: "#0f172a", borderRadius: 8, padding: 14, marginBottom: 12, border: "1px solid #1e293b" }}>
                <div style={{ fontSize: 9, color: "#475569", letterSpacing: 2, marginBottom: 8 }}>JIRA ISSUE</div>
                <div style={{ color: "#38bdf8", fontWeight: 700, fontSize: 16 }}>{result.jira_issue || "—"}</div>
                <div style={{ color: "#64748b", fontSize: 10, marginTop: 4 }}>v{result.milestone}</div>
              </div>

              {/* Branch card */}
              <div style={{ background: "#0f172a", borderRadius: 8, padding: 14, marginBottom: 12, border: "1px solid #1e293b" }}>
                <div style={{ fontSize: 9, color: "#475569", letterSpacing: 2, marginBottom: 8 }}>RELEASE BRANCH</div>
                <div style={{ color: "#34d399", fontSize: 12, fontWeight: 600 }}>⎇ {result.release_branch || "—"}</div>
              </div>

              {/* PR card */}
              <div style={{ background: "#0f172a", borderRadius: 8, padding: 14, marginBottom: 12, border: "1px solid #1e293b" }}>
                <div style={{ fontSize: 9, color: "#475569", letterSpacing: 2, marginBottom: 8 }}>PULL REQUEST</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span className="badge" style={{ background: result.pr_detected ? "#052e1680" : "#1c0a0a", color: result.pr_detected ? "#34d399" : "#f87171", border: `1px solid ${result.pr_detected ? "#34d39944" : "#f8717144"}` }}>
                    {result.pr_detected ? "✓ DETECTED" : "✗ NOT FOUND"}
                  </span>
                </div>
                {result.selected_pr && <div style={{ color: "#94a3b8", fontSize: 10, wordBreak: "break-all" }}>{result.selected_pr}</div>}
              </div>

              {/* Actions summary */}
              <div style={{ background: "#0f172a", borderRadius: 8, padding: 14, marginBottom: 12, border: "1px solid #1e293b" }}>
                <div style={{ fontSize: 9, color: "#475569", letterSpacing: 2, marginBottom: 10 }}>ACTIONS QUEUED</div>
                {(result.actions || []).map((a, i) => {
                  const meta = ACTION_META[a.type] || { color: "#6b7280", icon: "•" };
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>{meta.label || a.type}</span>
                    </div>
                  );
                })}
              </div>

              {/* Reasoning */}
              {result.reasoning && (
                <div style={{ background: "#0f172a", borderRadius: 8, padding: 14, border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: 9, color: "#475569", letterSpacing: 2, marginBottom: 8 }}>AGENT REASONING</div>
                  <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.7 }}>{result.reasoning}</div>
                </div>
              )}
            </div>
          )}

          {(result?._no_action || result?._no_pr) && (
            <div className="fade-in" style={{ textAlign: "center", marginTop: 30 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>{result._no_action ? "⛔" : "🔍"}</div>
              <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                {result._no_action ? "NO ACTION TAKEN" : "NO PR FOUND"}
              </div>
              <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.7 }}>
                {result._no_action ? "Issue must be in 'Accepted' state to trigger automation." : "Add PR links to the Jira description or comments."}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
