(function () {
  "use strict";

  const SYSTEM_PROMPT = `You are GridBot, an AI assistant for the LineWise cloud-based distribution network analysis platform, built as a capstone project by Team BV04 at Toronto Metropolitan University (2026).

Team members:
- Jaedon Chen — Solver Unit (Newton-Raphson engine)
- Dev Patel — Output Module (result serialization & export)
- Kishore Kirubakaran — Solver Unit support
- Diego Cortes Cabal — Input Module (IEEE CDF parsing)
- Supervisor: Shima Bagher Zade Homayie

About LineWise:
- Cloud-based power distribution network analysis tool hosted on Vercel
- Uses the Line-Wise Newton-Raphson power flow method (based on Mohamed & Venkatesh, IEEE Trans. Power Systems, 2018)
- Unlike conventional bus-wise NR methods, the line-wise method identifies WHICH specific transmission lines are at risk of voltage collapse
- Uses squared voltage magnitude (U = V²) as state variable for improved numerical stability
- Key output: Voltage Collapse Index (VCI) per line — Stable (VCI > 0.3), Marginal (0.1–0.3), Critical (VCI < 0.1)
- Validated on IEEE 33-bus and 69-bus standard distribution systems
- Convergence tolerance: 1e-6, typical solve time ~0.33 seconds
- Tech stack: Python, Flask, NumPy, Pandas, Cytoscape.js, Plotly.js, SheetJS, Vercel

How to use LineWise:
1. Download the .XLSX template from the dashboard
2. Fill in your BUS DATA and BRANCH DATA following IEEE CDF format
3. Upload the file and enter the sheet name/index
4. Click "Run Solver" — results appear instantly
5. Download the .XLSX solution or view the VCI heatmap

Future roadmap:
- V2: Historical trend analysis with AWS/Azure storage, fault historian
- V3: AI-assisted anomaly detection and plain-language summaries
- V4: Real-time SCADA integration, N-1 contingency analysis, SaaS model for utilities

You also have deep knowledge of general power systems engineering:
- Power flow methods (Newton-Raphson, Gauss-Seidel, backward/forward sweep, Z-bus)
- Distribution network analysis, voltage stability, reactive power compensation
- Per-unit systems, bus admittance matrix, Jacobian matrix
- IEEE test systems (33-bus, 69-bus, 118-bus, PEGASE)
- Voltage collapse, loadability limits, P-V curves, Q-V curves
- Smart grid, DERs, EV integration, SCADA systems

Be concise, helpful, and technically accurate. If asked about the project, answer with confidence. If asked general power systems questions, answer like a knowledgeable electrical engineer. Keep responses under 150 words unless a detailed explanation is genuinely needed.`;

  const API_URL = "https://api.anthropic.com/v1/messages";

  // ── Inject styles ──
  const style = document.createElement("style");
  style.textContent = `
    #gridbot-btn {
      position: fixed;
      bottom: 24px;
      right: 84px;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: linear-gradient(135deg, #22c55e, #16a34a);
      border: none;
      cursor: pointer;
      z-index: 9998;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(34,197,94,0.4);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #gridbot-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 24px rgba(34,197,94,0.5);
    }
    #gridbot-btn svg { width: 24px; height: 24px; }

    #gridbot-window {
      position: fixed;
      bottom: 88px;
      right: 24px;
      width: 360px;
      max-height: 520px;
      background: #0f141a;
      border: 1px solid #243041;
      border-radius: 14px;
      display: flex;
      flex-direction: column;
      z-index: 9999;
      overflow: hidden;
      box-shadow: 0 16px 48px rgba(0,0,0,0.6);
      font-family: system-ui, -apple-system, sans-serif;
      transform: scale(0.92) translateY(12px);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.2s ease, opacity 0.2s ease;
    }
    #gridbot-window.open {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: all;
    }

    #gridbot-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      background: #151c24;
      border-bottom: 1px solid #243041;
      flex-shrink: 0;
    }
    #gridbot-header-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #22c55e;
      animation: gb-pulse 2s infinite;
    }
    @keyframes gb-pulse {
      0%,100% { opacity:1; } 50% { opacity:0.3; }
    }
    #gridbot-header-title {
      flex: 1;
      font-size: 13px;
      font-weight: 600;
      color: #e8eef6;
      letter-spacing: 0.02em;
    }
    #gridbot-header-sub {
      font-size: 10px;
      color: #a9b4c2;
      font-weight: 400;
    }
    #gridbot-close {
      background: none;
      border: none;
      color: #a9b4c2;
      cursor: pointer;
      font-size: 18px;
      padding: 0;
      line-height: 1;
    }
    #gridbot-close:hover { color: #e8eef6; background: none; }

    #gridbot-messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 0;
    }
    #gridbot-messages::-webkit-scrollbar { width: 4px; }
    #gridbot-messages::-webkit-scrollbar-track { background: transparent; }
    #gridbot-messages::-webkit-scrollbar-thumb { background: #243041; border-radius: 4px; }

    .gb-msg {
      max-width: 88%;
      padding: 9px 12px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.55;
      word-wrap: break-word;
    }
    .gb-msg.user {
      align-self: flex-end;
      background: #1a3a2a;
      border: 1px solid #22c55e33;
      color: #e8eef6;
    }
    .gb-msg.assistant {
      align-self: flex-start;
      background: #151c24;
      border: 1px solid #243041;
      color: #e8eef6;
    }
    .gb-msg.typing {
      align-self: flex-start;
      background: #151c24;
      border: 1px solid #243041;
      color: #a9b4c2;
      font-style: italic;
      font-size: 12px;
    }

    #gridbot-input-row {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid #243041;
      background: #151c24;
      flex-shrink: 0;
    }
    #gridbot-input {
      flex: 1;
      background: #0f141a;
      border: 1px solid #243041;
      border-radius: 8px;
      color: #e8eef6;
      font-size: 13px;
      padding: 8px 10px;
      outline: none;
      resize: none;
      font-family: inherit;
      line-height: 1.4;
      max-height: 80px;
    }
    #gridbot-input:focus { border-color: #22c55e55; }
    #gridbot-input::placeholder { color: #475569; }
    #gridbot-send {
      background: #22c55e;
      border: none;
      border-radius: 8px;
      width: 36px;
      height: 36px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      align-self: flex-end;
      transition: background 0.15s;
      padding: 0;
    }
    #gridbot-send:hover { background: #16a34a; }
    #gridbot-send:disabled { background: #243041; cursor: not-allowed; }
    #gridbot-send svg { width: 16px; height: 16px; }

    .gb-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 14px 10px;
    }
    .gb-chip {
      background: #151c24;
      border: 1px solid #243041;
      border-radius: 100px;
      color: #a9b4c2;
      font-size: 11px;
      padding: 4px 10px;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
      font-family: inherit;
    }
    .gb-chip:hover { border-color: #22c55e55; color: #22c55e; background: #151c24; }
  `;
  document.head.appendChild(style);

  // ── Build DOM ──
  const btn = document.createElement("button");
  btn.id = "gridbot-btn";
  btn.title = "Ask GridBot";
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>`;

  const win = document.createElement("div");
  win.id = "gridbot-window";
  win.innerHTML = `
    <div id="gridbot-header">
      <div id="gridbot-header-dot"></div>
      <div>
        <div id="gridbot-header-title">GridBot <span style="color:#22c55e;font-size:11px;">AI</span></div>
        <div id="gridbot-header-sub">LineWise · Power Systems Assistant</div>
      </div>
      <button id="gridbot-close">×</button>
    </div>
    <div id="gridbot-messages">
      <div class="gb-msg assistant">Hey! I'm GridBot 👋 Ask me anything about the LineWise project, how to use it, or general power systems questions.</div>
    </div>
    <div class="gb-chips">
      <button class="gb-chip">What is VCI?</button>
      <button class="gb-chip">How do I upload data?</button>
      <button class="gb-chip">Why line-wise NR?</button>
      <button class="gb-chip">Future roadmap?</button>
    </div>
    <div id="gridbot-input-row">
      <textarea id="gridbot-input" placeholder="Ask a question..." rows="1"></textarea>
      <button id="gridbot-send">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(win);

  // ── State ──
  const messages = [];
  let isOpen = false;
  let isLoading = false;

  // ── Helpers ──
  function toggleWindow() {
    isOpen = !isOpen;
    win.classList.toggle("open", isOpen);
  }

  function scrollToBottom() {
    const msgs = document.getElementById("gridbot-messages");
    msgs.scrollTop = msgs.scrollHeight;
  }

  function appendMessage(role, text) {
    const msgs = document.getElementById("gridbot-messages");
    const el = document.createElement("div");
    el.className = `gb-msg ${role}`;
    el.textContent = text;
    msgs.appendChild(el);
    scrollToBottom();
    return el;
  }

  function setLoading(val) {
    isLoading = val;
    document.getElementById("gridbot-send").disabled = val;
  }

  async function sendMessage(text) {
    if (!text.trim() || isLoading) return;

    appendMessage("user", text);
    messages.push({ role: "user", content: text });

    const typingEl = document.createElement("div");
    typingEl.className = "gb-msg typing";
    typingEl.textContent = "GridBot is thinking...";
    document.getElementById("gridbot-messages").appendChild(typingEl);
    scrollToBottom();
    setLoading(true);

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: messages,
        }),
      });

      const data = await res.json();
      typingEl.remove();

      const reply = data?.content?.[0]?.text ?? "Sorry, I couldn't get a response. Please try again.";
      messages.push({ role: "assistant", content: reply });
      appendMessage("assistant", reply);

    } catch (err) {
      typingEl.remove();
      appendMessage("assistant", "Connection error. Make sure the API is reachable.");
    }

    setLoading(false);
  }

  // ── Events ──
  btn.addEventListener("click", toggleWindow);
  document.getElementById("gridbot-close").addEventListener("click", toggleWindow);

  document.getElementById("gridbot-send").addEventListener("click", () => {
    const input = document.getElementById("gridbot-input");
    const val = input.value.trim();
    if (!val) return;
    input.value = "";
    input.style.height = "auto";
    sendMessage(val);
  });

  document.getElementById("gridbot-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const val = e.target.value.trim();
      if (!val) return;
      e.target.value = "";
      e.target.style.height = "auto";
      sendMessage(val);
    }
  });

  document.getElementById("gridbot-input").addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 80) + "px";
  });

  document.querySelectorAll(".gb-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (!isOpen) toggleWindow();
      sendMessage(chip.textContent);
    });
  });

})();
