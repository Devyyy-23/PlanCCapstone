from __future__ import annotations

from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Tuple

import sys
import json
import time
import numpy as np
import pandas as pd


# ============================================================
# USER CONFIG
# ============================================================

POWER_UNITS = "MW"     # "pu" or "MW" or "kW"
LINE_UNITS = "ohm"     # "pu" or "ohm"

TOL = 1e-8
MAX_ITERS = 200


# ============================================================
# INPUT MODULE
# ============================================================

class InputFormatError(Exception):
    pass


@dataclass
class Bus:
    bus: int
    name: str
    zone_label: str
    area: int
    bus_type: int
    Vm: float
    Va: float
    Pd: float
    Qd: float
    Pg: float
    Qg: float
    base_kv: float
    Vsp: float
    Qmax: float
    Qmin: float
    Gsh: float
    Bsh: float
    remote_bus: int


@dataclass
class Branch:
    from_bus: int
    to_bus: int
    area: int
    loss_zone: int
    circuit_id: float
    device_type: float
    R: float
    X: float
    B: float
    rating1: float
    rating2: float


@dataclass
class NetworkModel:
    base_mva: float
    buses: List[Bus]
    branches: List[Branch]
    header_date: Optional[str] = None
    header_name: Optional[str] = None
    header_year: Optional[int] = None
    header_season: Optional[str] = None
    header_case_id: Optional[str] = None


def _find_header_row(df: pd.DataFrame, text: str) -> int:
    text_upper = text.upper()
    col0 = df[0].astype(str).str.upper()
    mask = col0.str.contains(text_upper, na=False)
    idx = df.index[mask]
    if len(idx) == 0:
        raise InputFormatError(f"Could not find header '{text}' in column A.")
    return int(idx[0])


def _is_sentinel(val, sentinel: int = -999) -> bool:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return False
    if isinstance(val, (int, float)) and val == sentinel:
        return True
    return str(val).strip() == str(sentinel)


def parse_cdf_excel(path: str, sheet_name: str) -> NetworkModel:
    df = pd.read_excel(path, sheet_name=sheet_name, header=None, engine="openpyxl")

    row0 = df.iloc[0, :]
    base_mva = float(row0[3])

    bus_header = _find_header_row(df, "BUS DATA FOLLOWS")
    branch_header = _find_header_row(df, "BRANCH DATA FOLLOWS")

    start_row = bus_header + 1
    sentinel_row = None
    for r in range(start_row, branch_header):
        if _is_sentinel(df.iloc[r, 0], -999):
            sentinel_row = r
            break
    if sentinel_row is None:
        raise InputFormatError("BUS section missing -999 sentinel.")

    bus_df = df.iloc[start_row:sentinel_row].reset_index(drop=True)

    buses: List[Bus] = []
    for idx, row in bus_df.iterrows():
        if pd.isna(row[0]):
            continue
        buses.append(
            Bus(
                bus=int(row[0]),
                name=str(row[1]),
                zone_label=str(row[2]),
                area=int(row[3]),
                bus_type=int(row[4]),
                Vm=float(row[5]),
                Va=float(row[6]),
                Pd=float(row[7]),
                Qd=float(row[8]),
                Pg=float(row[9]),
                Qg=float(row[10]),
                base_kv=float(row[11]),
                Vsp=float(row[12]),
                Qmax=float(row[13]),
                Qmin=float(row[14]),
                Gsh=float(row[15]),
                Bsh=float(row[16]),
                remote_bus=int(row[17]),
            )
        )

    start_row = branch_header + 1
    sentinel_row = None
    for r in range(start_row, len(df)):
        if _is_sentinel(df.iloc[r, 0], -999):
            sentinel_row = r
            break
    if sentinel_row is None:
        raise InputFormatError("BRANCH section missing -999 sentinel.")

    br_df = df.iloc[start_row:sentinel_row].reset_index(drop=True)

    branches: List[Branch] = []
    for idx, row in br_df.iterrows():
        if pd.isna(row[0]):
            continue
        branches.append(
            Branch(
                from_bus=int(row[0]),
                to_bus=int(row[1]),
                area=int(row[2]),
                loss_zone=int(row[3]),
                circuit_id=float(row[4]),
                device_type=float(row[5]),
                R=float(row[6]),
                X=float(row[7]),
                B=float(row[8]),
                rating1=float(row.iloc[-2]),
                rating2=float(row.iloc[-1]),
            )
        )

    return NetworkModel(base_mva=base_mva, buses=buses, branches=branches)


# ============================================================
# PER UNIT CONVERSIONS
# ============================================================

def power_to_pu(p: np.ndarray, base_mva: float) -> np.ndarray:
    if POWER_UNITS == "MW":
        return p / base_mva
    if POWER_UNITS == "kW":
        return (p / 1000.0) / base_mva
    return p


def z_to_pu(r_ohm: np.ndarray, x_ohm: np.ndarray, vbase_kv: float, base_mva: float):
    if LINE_UNITS == "ohm":
        zbase = (vbase_kv ** 2) / base_mva
        return r_ohm / zbase, x_ohm / zbase
    return r_ohm, x_ohm


# ============================================================
# RADIAL BFS SOLVER
# ============================================================

def bfs_power_flow(case: Dict[str, Any]) -> Dict[str, Any]:
    nbus = case["meta"]["nbus"]
    slack = case["meta"]["slack_bus_idx"]

    V = np.ones(nbus, dtype=complex)
    S = case["bus"]["S"]

    parent = case["branch"]["parent"]
    children = case["branch"]["children"]
    Z = case["branch"]["Z"]

    max_err = 0.0
    for it in range(MAX_ITERS):
        V_prev = V.copy()

        I = np.conj(S / V)
        I[slack] = 0

        Ibus = I.copy()

        for v in reversed(range(nbus)):
            p = parent[v]
            if p >= 0:
                Ibus[p] += Ibus[v]

        for v in range(nbus):
            for c in children[v]:
                V[c] = V[v] - Z[(v, c)] * Ibus[c]

        max_err = np.max(np.abs(V - V_prev))
        if max_err < TOL:
            break

    return {
        "iters": it + 1,
        "Vm": np.abs(V),
        "Va_deg": np.rad2deg(np.angle(V)),
        "Va_rad": np.angle(V),
        "V": V,
        "max_error": max_err,
        "converged": max_err < TOL,
        "Ibus": Ibus,
    }


# ============================================================
# OUTPUT MODULE - BV04 API DATA CONTRACT
# ============================================================

def compute_line_power_flows(
    V: np.ndarray,
    Zmap: Dict[Tuple[int, int], complex],
    parent: List[int],
    children: List[List[int]]
) -> Dict[Tuple[int, int], Dict[str, float]]:
    """
    Compute PF, QF, PS, QS for each line in per-unit.
    
    Power flow from bus i to bus j:
    S_ij = V_i * conj(I_ij)
    where I_ij = (V_i - V_j) / Z_ij
    
    Returns dict mapping (from_bus, to_bus) -> {"PF": ..., "QF": ..., "PS": ..., "QS": ...}
    """
    line_flows = {}
    
    for (i, j), Z_ij in Zmap.items():
        # Forward direction: from bus i to bus j
        I_ij = (V[i] - V[j]) / Z_ij
        S_ij = V[i] * np.conj(I_ij)
        
        # Reverse direction: from bus j to bus i
        I_ji = (V[j] - V[i]) / Z_ij
        S_ji = V[j] * np.conj(I_ji)
        
        line_flows[(i, j)] = {
            "PF": float(np.real(S_ij)),
            "QF": float(np.imag(S_ij)),
            "PS": float(np.real(S_ji)),
            "QS": float(np.imag(S_ji)),
        }
    
    return line_flows


def compute_vci(
    V: np.ndarray,
    Zmap: Dict[Tuple[int, int], complex],
    S_load: np.ndarray,
    line_flows: Dict[Tuple[int, int], Dict[str, float]]
) -> Dict[Tuple[int, int], float]:
    """
    Compute Voltage Collapse Index (VCI) for each line.
    
    VCI is a stability metric ranging from 0.0 (stable) to 1.0 (critical).
    
    Formula from reference equations (49) and (50):
    VCI_a = 2·U_a + 2·(PF·R + QF·X - U_a/2) = U_a + 2·(PF·R + QF·X)
    VCI_b = 2·U_b + 2·(PS·R + QS·X - U_a/2)
    
    Where:
    - U_a = sending end voltage magnitude
    - U_b = receiving end voltage magnitude  
    - PF, QF = active/reactive power flow from sending end
    - PS, QS = active/reactive power flow from receiving end
    - R, X = line resistance and reactance
    
    Returns the maximum of VCI_a and VCI_b for each line.
    Clamped to [0.0, 1.0] as per specification.
    """
    vci_map = {}
    
    for (i, j), Z_ij in Zmap.items():
        # Get impedance components
        R = np.real(Z_ij)
        X = np.imag(Z_ij)
        
        # Voltage magnitudes
        U_a = np.abs(V[i])  # Sending end
        U_b = np.abs(V[j])  # Receiving end
        
        # Get power flows
        flows = line_flows.get((i, j), {"PF": 0.0, "QF": 0.0, "PS": 0.0, "QS": 0.0})
        PF = flows["PF"]
        QF = flows["QF"]
        PS = flows["PS"]
        QS = flows["QS"]
        
        # VCI_a = U_a + 2·(PF·R + QF·X)
        VCI_a = U_a + 2.0 * (PF * R + QF * X)
        
        # VCI_b = 2·U_b + 2·(PS·R + QS·X - U_a/2)
        VCI_b = 2.0 * U_b + 2.0 * (PS * R + QS * X - U_a / 2.0)
        
        # Take maximum of both indices
        vci = max(VCI_a, VCI_b)
        
        # Clamp to [0.0, 1.0]
        vci = max(0.0, min(1.0, vci))
        
        vci_map[(i, j)] = float(vci)
    
    return vci_map


def serialize_to_bv04_json(
    sol: Dict[str, Any],
    case: Dict[str, Any],
    net: NetworkModel,
    bus_ids: List[int],
    execution_time_ms: float
) -> Dict[str, Any]:
    """
    Serialize solver output to BV04 API JSON schema.
    
    Schema structure:
    {
      "solver_metadata": {...},
      "buses": [{bus_id, type, U, delta_rad}, ...],
      "lines": [{line_id, from_bus, to_bus, PF, QF, PS, QS, VCI}, ...]
    }
    """
    # Extract data
    V = sol["V"]
    Vm = sol["Vm"]
    Va_rad = sol["Va_rad"]
    converged = sol["converged"]
    iters = sol["iters"]
    max_error = sol["max_error"]
    
    Zmap = case["branch"]["Z"]
    parent = case["branch"]["parent"]
    children = case["branch"]["children"]
    S_load = case["bus"]["S"]
    
    # Compute line power flows
    line_flows = compute_line_power_flows(V, Zmap, parent, children)
    
    # Compute VCI for each line (needs line_flows)
    vci_map = compute_vci(V, Zmap, S_load, line_flows)
    
    # Build solver metadata
    solver_metadata = {
        "method": "Line-Wise NR (String)",
        "iterations": int(iters),
        "global_max_error": float(max_error),
        "execution_time_ms": float(execution_time_ms),
        "converged": bool(converged),
        "tolerance": float(TOL)
    }
    
    # Build buses array
    buses = []
    for idx, bus_id in enumerate(bus_ids):
        bus_obj = net.buses[idx]
        
        # Determine bus type string
        if bus_obj.bus_type == 3:
            bus_type_str = "Slack"
        elif bus_obj.bus_type == 2:
            bus_type_str = "PV"
        else:
            bus_type_str = "PQ"
        
        buses.append({
            "bus_id": int(bus_id),
            "type": bus_type_str,
            "U": float(Vm[idx]),
            "delta_rad": float(Va_rad[idx])
        })
    
    # Build lines array
    lines = []
    id_map = {bid: i for i, bid in enumerate(bus_ids)}
    
    for br in net.branches:
        from_bus_id = br.from_bus
        to_bus_id = br.to_bus
        
        i = id_map[from_bus_id]
        j = id_map[to_bus_id]
        
        line_id = f"L{from_bus_id}-{to_bus_id}"
        
        flows = line_flows.get((i, j), {"PF": 0.0, "QF": 0.0, "PS": 0.0, "QS": 0.0})
        vci = vci_map.get((i, j), 0.0)
        
        lines.append({
            "line_id": line_id,
            "from_bus": int(from_bus_id),
            "to_bus": int(to_bus_id),
            "PF": float(flows["PF"]),
            "QF": float(flows["QF"]),
            "PS": float(flows["PS"]),
            "QS": float(flows["QS"]),
            "VCI": float(vci)
        })
    
    # Construct final JSON
    output = {
        "solver_metadata": solver_metadata,
        "buses": buses,
        "lines": lines
    }
    
    return output


# ============================================================
# MAIN
# ============================================================

def main():

    if len(sys.argv) != 3:
        print("Usage:")
        print("  python this_file.py \"FILE.xlsx\" \"SheetName\"")
        return

    excel_path = sys.argv[1]
    sheet_name = sys.argv[2]

    try:
        net = parse_cdf_excel(excel_path, sheet_name)
    except Exception as e:
        print("Status: ERROR")
        print(e)
        return

    # Build minimal case
    bus_ids = [b.bus for b in net.buses]
    id_map = {bid: i for i, bid in enumerate(bus_ids)}
    slack = [i for i, b in enumerate(net.buses) if b.bus_type == 3][0]

    base_mva = net.base_mva
    vbase = net.buses[slack].base_kv

    Pd = power_to_pu(np.array([b.Pd for b in net.buses]), base_mva)
    Qd = power_to_pu(np.array([b.Qd for b in net.buses]), base_mva)
    Pg = power_to_pu(np.array([b.Pg for b in net.buses]), base_mva)
    Qg = power_to_pu(np.array([b.Qg for b in net.buses]), base_mva)

    S = (Pd - Pg) + 1j * (Qd - Qg)

    parent = [-1] * len(bus_ids)
    children = [[] for _ in bus_ids]
    Zmap = {}

    for br in net.branches:
        i = id_map[br.from_bus]
        j = id_map[br.to_bus]
        r, x = z_to_pu(np.array([br.R]), np.array([br.X]), vbase, base_mva)
        parent[j] = i
        children[i].append(j)
        Zmap[(i, j)] = r[0] + 1j * x[0]

    case = {
        "meta": {"nbus": len(bus_ids), "slack_bus_idx": slack},
        "bus": {"S": S},
        "branch": {"parent": parent, "children": children, "Z": Zmap}
    }

    # Run solver with timing
    start_time = time.perf_counter()
    sol = bfs_power_flow(case)
    end_time = time.perf_counter()
    execution_time_ms = (end_time - start_time) * 1000.0

    # Serialize to BV04 JSON format
    output_json = serialize_to_bv04_json(sol, case, net, bus_ids, execution_time_ms)
    
    # Output JSON to stdout
    print(json.dumps(output_json, indent=2))


if __name__ == "__main__":
    main()