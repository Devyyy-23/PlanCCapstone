# server.py
import os
import json
import urllib.request
from flask import Flask, request, jsonify
from flask_cors import CORS
import output_Integration as solver

app = Flask(__name__)
CORS(app)

# ── Existing solver endpoint ──────────────────────────────────
@app.route('/solve', methods=['POST'])
def solve_grid():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']
    temp_path = os.path.join("/tmp", "temp_grid.xlsx")
    file.save(temp_path)

    try:
        net = solver.parse_cdf_excel(temp_path, sheet_name=0)

        bus_ids = [b.bus for b in net.buses]
        id_map = {bid: i for i, bid in enumerate(bus_ids)}
        slack = [i for i, b in enumerate(net.buses) if b.bus_type == 3][0]

        base_mva = net.base_mva
        vbase = net.buses[slack].base_kv

        Pd = solver.power_to_pu(solver.np.array([b.Pd for b in net.buses]), base_mva)
        Qd = solver.power_to_pu(solver.np.array([b.Qd for b in net.buses]), base_mva)
        Pg = solver.power_to_pu(solver.np.array([b.Pg for b in net.buses]), base_mva)
        Qg = solver.power_to_pu(solver.np.array([b.Qg for b in net.buses]), base_mva)

        S = (Pd - Pg) + 1j * (Qd - Qg)

        parent = [-1] * len(bus_ids)
        children = [[] for _ in bus_ids]
        Zmap = {}

        for br in net.branches:
            i = id_map[br.from_bus]
            j = id_map[br.to_bus]
            r, x = solver.z_to_pu(solver.np.array([br.R]), solver.np.array([br.X]), vbase, base_mva)
            parent[j] = i
            children[i].append(j)
            Zmap[(i, j)] = r[0] + 1j * x[0]

        case = {
            "meta": {"nbus": len(bus_ids), "slack_bus_idx": slack},
            "bus": {"S": S},
            "branch": {"parent": parent, "children": children, "Z": Zmap}
        }

        import time
        start_time = time.perf_counter()
        sol = solver.bfs_power_flow(case)
        end_time = time.perf_counter()

        output_json = solver.serialize_to_bv04_json(sol, case, net, bus_ids, (end_time - start_time) * 1000)

        os.remove(temp_path)
        return jsonify(output_json)

    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return jsonify({"error": str(e)}), 500


# ── Chatbot proxy endpoint ────────────────────────────────────
@app.route('/chat', methods=['POST'])
def chat():
    try:
        body = request.get_json()
        messages = body.get("messages", [])

        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            return jsonify({"error": "API key not configured"}), 500

        payload = json.dumps({
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 1000,
            "system": "You are GridBot, an AI assistant for the LineWise cloud-based distribution network analysis platform, built as a capstone project by Team BV04 at Toronto Metropolitan University (2026). Team: Jaedon Chen (Solver), Dev Patel (Output Module), Kishore Kirubakaran (Solver support), Diego Cortes Cabal (Input Module). Supervisor: Shima Bagher Zade Homayie. LineWise uses the Line-Wise Newton-Raphson power flow method. Unlike bus-wise NR, it identifies which specific lines are at risk via Voltage Collapse Index (VCI): Stable VCI>0.3, Marginal 0.1-0.3, Critical VCI<0.1. Uses U=V^2 as state variable. Validated on IEEE 33-bus and 69-bus systems. Stack: Python, Flask, NumPy, Vercel, Cytoscape.js, Plotly.js. You also know general power systems engineering. Be concise, under 150 words unless detail is needed.",
            "messages": messages
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01"
            },
            method="POST"
        )

        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        reply = result["content"][0]["text"]
        return jsonify({"reply": reply})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    print("Cloud API Online: http://127.0.0.1:5000")
    app.run(debug=True, port=5000)
