"""
Generate the simulated fleet dataset used by the dashboard.

Everything here is SYNTHETIC. The fleet, zones, operators and events are
fictional and seeded (seed 42) so the dataset is reproducible. Several
safety problems are deliberately planted so they can be found and
investigated from the data alone:

  1. Software regression   v4.3.0 hesitates on occluded unprotected left turns,
                           worst at dusk. Partially fixed in v4.3.1.
  2. Operator fatigue      VSO-24 is scheduled for 5.5-6.5 h shifts from week 5 (policy is
                           4.0 h max). Drowsiness and takeover delay rise late
                           in the shift.
  3. Calibration drift     AV-09 returned to service after a windshield
                           replacement without a camera recalibration.
  4. Construction zone     A lane closure at Dock St & Pier 3 raises
                           precautionary takeovers (environment, not a defect).
  5. Data quality          Duplicate intervention rows from a logger retry,
                           a DMS camera outage on AV-03, missing odometer values.

Run:  python tools/generate_data.py      (writes data/fleet.json)
"""
import json
import math
import random
from datetime import date, datetime, timedelta
from pathlib import Path

R = random.Random(42)
START = date(2026, 9, 21)  # Monday, week 1
WEEKS = 8
OUT = Path(__file__).resolve().parent.parent / "data" / "fleet.json"

# ---------------------------------------------------------------- reference data
ZONES = {
    "Harbor District": {
        "vehicles": ["AV-01", "AV-02", "AV-03", "AV-04"],
        "vsos": [f"VSO-{i:02d}" for i in range(1, 11)],
        "speed": 21,
        "sites": [
            ("Dock St & Pier 3", "lane_change", 0.0),
            ("Harbor Blvd & 2nd Ave", "unprotected_left", 0.2),
            ("Quay Rd roundabout", "roundabout", 0.0),
            ("Ferry Terminal pickup", "pickup_dropoff", 0.0),
            ("Canal St & Mill Ln", "four_way_stop", 0.0),
        ],
    },
    "Ridgeview": {
        "vehicles": ["AV-05", "AV-06", "AV-07", "AV-08"],
        "vsos": [f"VSO-{i:02d}" for i in range(11, 21)],
        "speed": 26,
        "sites": [
            ("Marlow Ave & 5th St", "unprotected_left", 1.0),
            ("Hale Rd & Pine St", "unprotected_left", 0.85),
            ("Ridgeview Pkwy merge", "merge", 0.0),
            ("College Ave crosswalk", "crosswalk", 0.0),
            ("Summit Dr & Oak St", "signalized", 0.0),
        ],
    },
    "Old Town": {
        "vehicles": ["AV-09", "AV-10", "AV-11", "AV-12"],
        "vsos": [f"VSO-{i:02d}" for i in range(21, 31)],
        "speed": 17,
        "sites": [
            ("Market St & Bell Ln", "unprotected_left", 0.5),
            ("Cathedral Sq", "shared_space", 0.0),
            ("Rowan St (narrow two-way)", "narrow_road", 0.0),
            ("Old Bridge Rd", "curve", 0.0),
            ("Station Rd bus lane", "bus_lane", 0.0),
        ],
    },
}
VEH_ZONE = {v: z for z, c in ZONES.items() for v in c["vehicles"]}

RELEASES = [
    {"version": "v4.2.0", "date": "2026-09-01", "notes": "Baseline release for the period.",
     "gate": "Passed sim regression (1,840 scenarios).", "coverage_gap": None},
    {"version": "v4.3.0", "date": "2026-10-19",
     "notes": "New planner cost terms for smoother yielding and fewer comfort takeovers.",
     "gate": "Passed sim regression (1,912 scenarios); comfort takeovers -18% in sim.",
     "coverage_gap": "No scenarios with an occluded oncoming lane on unprotected left turns in low light."},
    {"version": "v4.3.1", "date": "2026-11-04",
     "notes": "Hotfix: restores conservative creep behaviour when the oncoming lane is occluded.",
     "gate": "Passed sim regression plus 64 new occluded-left scenarios.", "coverage_gap": None},
]


def sw_for(d):
    if d >= date(2026, 11, 4):
        return "v4.3.1"
    if d >= date(2026, 10, 19):
        return "v4.3.0"
    return "v4.2.0"


def sunset(d):
    """Fictional city sunset (local time, hours). DST ends Nov 1."""
    days = (d - date(2026, 9, 21)).days
    h = 19.08 - days * 0.0275           # ~1.6 min earlier per day
    if d >= date(2026, 11, 1):
        h -= 1.0
    return h


def light_at(d, hour):
    s = sunset(d)
    if hour < s - 0.5:
        return "day"
    if hour < s + 0.5:
        return "dusk"
    return "night"


def ts(d, hour):
    dt = datetime(d.year, d.month, d.day) + timedelta(hours=hour)
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def week_of(d):
    return (d - START).days // 7 + 1


def pois(lam):
    # Knuth; lam is small
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= R.random()
        if p <= L:
            return k
        k += 1


# ---------------------------------------------------------------- weather per zone/day
weather = {}
for z in ZONES:
    for i in range(WEEKS * 7):
        d = START + timedelta(days=i)
        r = R.random()
        weather[(z, d)] = "rain" if r < 0.18 + (0.1 if d.month == 11 else 0) else ("fog" if r < 0.25 else "clear")
weather[("Old Town", date(2026, 11, 5))] = "rain"

# ---------------------------------------------------------------- data containers
shifts, interventions, flags, dms, incidents = [], [], [], [], []
counters = {"int": 0, "flag": 0, "dms": 0}


def nid(kind, prefix):
    counters[kind] += 1
    return f"{prefix}-{counters[kind]:05d}"


# Forced assignments for the incident shifts
FORCED = {
    (date(2026, 10, 29), "AV-06", "P"): ("VSO-15", 14.55, 3.85),
    (date(2026, 11, 5), "AV-10", "P"): ("VSO-24", 14.58, 6.3),
    (date(2026, 10, 15), "AV-09", "A"): ("VSO-22", 7.9, 3.7),
    (date(2026, 10, 21), "AV-07", "A"): ("VSO-13", 7.5, 3.6),
    (date(2026, 11, 10), "AV-02", "P"): ("VSO-04", 13.9, 3.7),
}

# ---------------------------------------------------------------- simulate shifts
for i in range(WEEKS * 7):
    d = START + timedelta(days=i)
    if d.weekday() == 6:      # no Sunday operations
        continue
    wk = week_of(d)
    sw = sw_for(d)
    for z, cfg in ZONES.items():
        pool = cfg["vsos"][:]
        R.shuffle(pool)
        used = set(v[0] for k, v in FORCED.items() if k[0] == d)
        # VSO-24 works the long PM shift from week 4 on (scheduling control failure)
        if z == "Old Town" and wk >= 5 and d.weekday() < 5 and R.random() < 0.9:
            used.add("VSO-24")
        pool = [p for p in pool if p not in used]
        for veh in cfg["vehicles"]:
            for sl in ("A", "P"):
                key = (d, veh, sl)
                if key in FORCED:
                    vso, start_h, hours = FORCED[key]
                else:
                    long_vso = (z == "Old Town" and sl == "P" and wk >= 5 and "VSO-24" in used
                                and not any(s["vso"] == "VSO-24" and s["date"] == d.isoformat() for s in shifts)
                                and veh in ("AV-10", "AV-11") and not (d == date(2026, 11, 5)))
                    if long_vso:
                        vso = "VSO-24"
                        hours = round(R.uniform(5.5, 6.5), 2)
                    else:
                        vso = pool.pop()
                        hours = round(min(4.0, max(3.0, R.gauss(3.6, 0.25))), 2)
                        if R.random() < 0.012:
                            hours = round(R.uniform(4.1, 4.45), 2)   # occasional minor overrun
                    start_h = (7.0 if sl == "A" else 14.5) + R.uniform(-0.4, 0.4)
                sid = f"S-{d.strftime('%m%d')}-{veh[3:]}{sl}"
                dms_up = 1.0 if R.random() > 0.006 else round(R.uniform(0.85, 0.97), 2)
                if veh == "AV-03" and date(2026, 11, 2) <= d <= date(2026, 11, 7):
                    dms_up = 0.0
                shift = {
                    "id": sid, "date": d.isoformat(), "week": wk, "vehicle": veh, "zone": z, "vso": vso,
                    "start": ts(d, start_h), "hours": hours, "sw": sw, "weather": weather[(z, d)],
                    "precheck": R.random() > 0.004, "dms_uptime": dms_up,
                    "km": 0.0, "km_day": 0.0, "km_dusk": 0.0, "km_night": 0.0,
                }
                # ---- simulate in 15-minute slices
                h = 0.0
                while h < hours - 1e-9:
                    step = min(0.25, hours - h)
                    clock = start_h + h + step / 2
                    light = light_at(d, clock)
                    spd = cfg["speed"] * (0.8 if weather[(z, d)] == "rain" else 1.0) * R.uniform(0.85, 1.1)
                    km = spd * step
                    shift["km"] += km
                    shift["km_" + light] += km
                    hint = h + step / 2      # hour into shift

                    # AV-09 calibration drift window
                    calib = veh == "AV-09" and date(2026, 10, 9) <= d < date(2026, 10, 20)
                    construction = z == "Harbor District" and d >= date(2026, 10, 26)

                    # ---- background flags (per km)
                    base = {"perception_low_conf": 0.018, "planner_uncertainty": 0.012, "occlusion_high": 0.008,
                            "localization_drift": 0.003, "ood_scene": 0.002, "hard_brake": 0.006}
                    if light == "night":
                        base["perception_low_conf"] *= 1.6
                    if weather[(z, d)] == "rain":
                        base["perception_low_conf"] *= 1.4
                    if calib:
                        base["localization_drift"] *= 7
                        base["perception_low_conf"] *= 2.2
                    if sw == "v4.3.0":
                        base["hard_brake"] *= 1.15
                    for ftype, rate in base.items():
                        for _ in range(pois(rate * km)):
                            t = start_h + h + R.random() * step
                            flags.append({"id": nid("flag", "F"), "ts": ts(d, t), "shift": sid, "vehicle": veh,
                                          "type": ftype, "site": None, "sw": sw, "light": light_at(d, t)})

                    # ---- background interventions
                    irates = {"precautionary": 0.0035, "comfort": 0.003 * (0.75 if sw != "v4.2.0" else 1.0),
                              "safety_critical": 0.00045}
                    if calib:
                        irates["precautionary"] *= 3
                    for itype, rate in irates.items():
                        for _ in range(pois(rate * km)):
                            t = start_h + h + R.random() * step
                            if calib and itype != "comfort" and R.random() < 0.7:
                                trig = "localization" if R.random() < 0.6 else "perception"
                            else:
                                trig = R.choices(["perception", "prediction", "planning", "localization", "control",
                                                  "external", "vso_precaution"],
                                                 [22, 18, 20, 6, 4, 14, 16])[0]
                            interventions.append({"type": itype, "trigger": trig, "t": t, "site": None,
                                                  "_s": shift, "_d": d})

                    # ---- site visits
                    if R.random() < 0.55:
                        site, man, occ = R.choice(cfg["sites"])
                        t = start_h + h + R.random() * step
                        lt = light_at(d, t)
                        site_flags = {}
                        sc_p = 0.0006
                        pre_p = 0.004
                        trig = "planning"
                        if man == "unprotected_left":
                            dusk_mult = 2.2 if lt == "dusk" else (1.5 if lt == "night" else 1.0)
                            if sw == "v4.3.0":
                                reg = 1.0
                            elif sw == "v4.3.1":
                                reg = 0.3
                            else:
                                reg = 0.08
                            site_flags["planner_uncertainty"] = 0.05 + 0.55 * occ * reg * dusk_mult
                            site_flags["occlusion_high"] = 0.08 + 0.5 * occ
                            site_flags["hard_brake"] = 0.01 + 0.16 * occ * reg * dusk_mult
                            sc_p += 0.022 * occ * reg * dusk_mult
                            pre_p += 0.05 * occ * reg * dusk_mult
                        if site == "Dock St & Pier 3" and construction:
                            site_flags["ood_scene"] = 0.35
                            site_flags["perception_low_conf"] = 0.15
                            pre_p += 0.16
                            sc_p += 0.004
                            trig = "external"
                        if man == "narrow_road" and lt == "night":
                            site_flags["perception_low_conf"] = 0.12
                        for ftype, p in site_flags.items():
                            for _ in range(pois(p)):
                                tt = t + R.uniform(-0.002, 0.002)
                                flags.append({"id": nid("flag", "F"), "ts": ts(d, tt), "shift": sid, "vehicle": veh,
                                              "type": ftype, "site": site, "sw": sw, "light": lt})
                        if R.random() < sc_p:
                            interventions.append({"type": "safety_critical", "trigger": trig, "t": t, "site": site,
                                                  "_s": shift, "_d": d})
                        if R.random() < pre_p:
                            interventions.append({"type": "precautionary",
                                                  "trigger": trig if R.random() < 0.8 else "vso_precaution",
                                                  "t": t, "site": site, "_s": shift, "_d": d})

                    # ---- DMS events (per hour), only if camera up
                    if dms_up > 0:
                        fat = 1 + max(0.0, hint - 3.5) * 0.9
                        drowsy_mult = 1 + 2.0 * max(0.0, hint - 4.0)
                        if vso == "VSO-24" and wk >= 5:
                            fat *= 1.5
                            drowsy_mult *= 1.8 + 0.3 * (wk - 5)   # fatigue builds week on week
                        if light == "night":
                            drowsy_mult *= 1.3
                        drates = {"eyes_off_road": 0.55 * fat, "drowsiness": 0.07 * drowsy_mult,
                                  "phone_use": 0.015, "camera_obstructed": 0.01}
                        for dtype, rate in drates.items():
                            for _ in range(pois(rate * step * dms_up)):
                                t = start_h + h + R.random() * step
                                late = t > 18.0
                                ack = R.lognormvariate(math.log(45 if not late else 110), 0.7)
                                dms.append({"id": nid("dms", "D"), "ts": ts(d, t), "shift": sid, "vehicle": veh,
                                            "vso": vso, "type": dtype,
                                            "duration_s": round(R.uniform(2.1, 4.5) if dtype == "eyes_off_road"
                                                                else R.uniform(3, 12), 1),
                                            "hour_into_shift": round(t - start_h, 2),
                                            "ack_s": round(min(ack, 1500))})
                    h += step

                for k in ("km", "km_day", "km_dusk", "km_night"):
                    shift[k] = round(shift[k], 1)
                if R.random() < 0.012 and key not in FORCED:
                    shift["km"] = None   # odometer sync failure
                shift["_start_h"] = start_h
                shifts.append(shift)

# ---------------------------------------------------------------- finalize interventions
def add_int(shift, d, t, itype, trig, site=None, reaction=None, ttc=None, speed=None, note=None):
    hint = t - shift["_start_h"]
    if reaction is None:
        reaction = R.lognormvariate(math.log(0.85), 0.28)
        if hint > 4:
            reaction += 0.35 * (hint - 4)
        if shift["vso"] == "VSO-24" and hint > 5:
            reaction *= 1.25
    rec = {
        "id": None, "ts": ts(d, t), "shift": shift["id"], "vehicle": shift["vehicle"], "zone": shift["zone"],
        "vso": shift["vso"], "sw": shift["sw"], "type": itype, "trigger": trig, "site": site,
        "light": light_at(d, t), "weather": shift["weather"], "hour_into_shift": round(hint, 2),
        "speed_kph": speed if speed is not None else round(R.uniform(8, 42), 1),
        "reaction_s": round(reaction, 2),
        "ttc_s": ttc if ttc is not None else (round(R.uniform(1.3, 3.6), 1) if itype == "safety_critical" else None),
        "reviewed_h": None,
    }
    if itype == "safety_critical":
        wk = week_of(d)
        med = 40 if wk in (5, 6) else 14
        rec["reviewed_h"] = round(min(140, R.lognormvariate(math.log(med), 0.45)), 1)
    if note:
        rec["note"] = note
    return rec


pending = interventions
interventions = [add_int(p["_s"], p["_d"], p["t"], p["type"], p["trigger"], p["site"]) for p in pending]


def S(d, veh, sl):
    return next(s for s in shifts if s["date"] == d.isoformat() and s["vehicle"] == veh and s["id"].endswith(sl))


def hm(h, m, s=0):
    return h + m / 60 + s / 3600


def add_flag(shift, d, t, ftype, site):
    flags.append({"id": nid("flag", "F"), "ts": ts(d, t), "shift": shift["id"], "vehicle": shift["vehicle"],
                  "type": ftype, "site": site, "sw": shift["sw"], "light": light_at(d, t)})


def add_dms(shift, d, t, dtype, dur, ack):
    dms.append({"id": nid("dms", "D"), "ts": ts(d, t), "shift": shift["id"], "vehicle": shift["vehicle"],
                "vso": shift["vso"], "type": dtype, "duration_s": dur,
                "hour_into_shift": round(t - shift["_start_h"], 2), "ack_s": ack})


# ---- INC-0398  AV-09 lane encroachment (calibration drift)
d = date(2026, 10, 15); s = S(d, "AV-09", "A")
for t in (hm(11, 18, 30), hm(11, 19, 40), hm(11, 19, 58)):
    add_flag(s, d, t, "localization_drift", "Old Bridge Rd")
add_flag(s, d, hm(11, 20, 1), "perception_low_conf", "Old Bridge Rd")
i398 = add_int(s, d, hm(11, 20, 5), "safety_critical", "localization", "Old Bridge Rd", reaction=0.9, ttc=2.8,
               speed=31.0, note="VSO steered right after vehicle crossed centre line by ~0.35 m on curve.")
interventions.append(i398)

# ---- INC-0405  AV-07 rear-ended by third party
d = date(2026, 10, 21); s = S(d, "AV-07", "A")

# ---- INC-0412  AV-06 near miss, unprotected left (v4.3.0)
d = date(2026, 10, 29); s = S(d, "AV-06", "P")
add_flag(s, d, hm(17, 51, 48), "occlusion_high", "Marlow Ave & 5th St")
add_flag(s, d, hm(17, 51, 55), "planner_uncertainty", "Marlow Ave & 5th St")
add_flag(s, d, hm(17, 52, 3), "hard_brake", "Marlow Ave & 5th St")
i412 = add_int(s, d, hm(17, 52, 1), "safety_critical", "planning", "Marlow Ave & 5th St", reaction=0.7, ttc=1.1,
               speed=14.0, note="AV committed to left turn; oncoming car emerged from behind parked box truck.")
interventions.append(i412)

# ---- INC-0419  AV-10 curb strike, VSO-24 hour 6
d = date(2026, 11, 5); s = S(d, "AV-10", "P")
add_dms(s, d, hm(20, 22, 40), "eyes_off_road", 2.6, 140)
add_dms(s, d, hm(20, 35, 10), "drowsiness", 7.8, 550)
add_dms(s, d, hm(20, 40, 58), "eyes_off_road", 3.1, 380)
add_flag(s, d, hm(20, 41, 12), "perception_low_conf", "Rowan St (narrow two-way)")
add_flag(s, d, hm(20, 41, 26), "hard_brake", "Rowan St (narrow two-way)")
i419 = add_int(s, d, hm(20, 41, 28), "safety_critical", "perception", "Rowan St (narrow two-way)", reaction=2.4,
               ttc=0.9, speed=14.0, note="Takeover after lateral-deviation alert; right front wheel struck curb.")
interventions.append(i419)

# ---- INC-0427  AV-02 cone contact in construction zone
d = date(2026, 11, 10); s = S(d, "AV-02", "P")
add_flag(s, d, hm(15, 21, 50), "ood_scene", "Dock St & Pier 3")
add_flag(s, d, hm(15, 21, 55), "perception_low_conf", "Dock St & Pier 3")
i427 = add_int(s, d, hm(15, 22, 6), "safety_critical", "external", "Dock St & Pier 3", reaction=1.0, ttc=0.4,
               speed=6.0, note="Displaced traffic cone in travel lane; contact at 6 km/h.")
interventions.append(i427)

interventions.sort(key=lambda r: r["ts"])
for n, r in enumerate(interventions, 1):
    r["id"] = f"I-{n:05d}"

# ---- duplicate rows from logger retry (Oct 22-23)
dups = []
for r in interventions:
    if r["ts"][:10] in ("2026-10-22", "2026-10-23") and R.random() < 0.4:
        c = dict(r)
        dups.append(c)
for n, c in enumerate(dups, 1):
    c["id"] = f"I-9{n:04d}"
interventions += dups
interventions.sort(key=lambda r: (r["ts"], r["id"]))

flags.sort(key=lambda r: r["ts"])
dms.sort(key=lambda r: r["ts"])

incidents = [
    {"id": "INC-0398", "ts": i398["ts"], "vehicle": "AV-09", "vso": "VSO-22", "zone": "Old Town",
     "site": "Old Bridge Rd", "sw": "v4.2.0", "severity": "S0", "severity_label": "Near miss",
     "type": "Lane encroachment", "contact": False, "injury": False, "investigation": "INV-003",
     "summary": "Vehicle drifted ~0.35 m across the centre line on a left-hand curve. VSO corrected; oncoming car ~40 m away."},
    {"id": "INC-0405", "ts": "2026-10-21T08:14:22", "vehicle": "AV-07", "vso": "VSO-13", "zone": "Ridgeview",
     "site": "College Ave crosswalk", "sw": "v4.3.0", "severity": "S1", "severity_label": "Minor contact",
     "type": "Rear-ended by third party", "contact": True, "injury": False, "investigation": "INV-005",
     "summary": "AV stationary at red light for 6.2 s when a third-party car struck the rear bumper at ~12 km/h."},
    {"id": "INC-0412", "ts": i412["ts"], "vehicle": "AV-06", "vso": "VSO-15", "zone": "Ridgeview",
     "site": "Marlow Ave & 5th St", "sw": "v4.3.0", "severity": "S0", "severity_label": "Near miss",
     "type": "Unprotected left turn conflict", "contact": False, "injury": False, "investigation": "INV-001",
     "summary": "AV began an unprotected left at dusk; oncoming car emerged from behind a parked box truck. VSO braked at TTC 1.1 s; min separation 2.3 m."},
    {"id": "INC-0419", "ts": i419["ts"], "vehicle": "AV-10", "vso": "VSO-24", "zone": "Old Town",
     "site": "Rowan St (narrow two-way)", "sw": "v4.3.1", "severity": "S1", "severity_label": "Minor contact",
     "type": "Curb strike", "contact": True, "injury": False, "investigation": "INV-002",
     "summary": "At night in rain, the AV moved right for an oncoming van; VSO takeover came 2.4 s after the alert and the right front wheel struck the curb at 14 km/h."},
    {"id": "INC-0427", "ts": i427["ts"], "vehicle": "AV-02", "vso": "VSO-04", "zone": "Harbor District",
     "site": "Dock St & Pier 3", "sw": "v4.3.1", "severity": "S1", "severity_label": "Minor contact",
     "type": "Object contact (traffic cone)", "contact": True, "injury": False, "investigation": "INV-004",
     "summary": "A wind-displaced cone sat in the lane inside the construction zone; AV slowed but contacted it at 6 km/h."},
]

maintenance = [
    {"date": "2026-09-29", "vehicle": "AV-05", "work": "Tire replacement (rear left)", "calibration": "n/a", "rts": "2026-09-29"},
    {"date": "2026-10-09", "vehicle": "AV-09", "work": "Windshield replacement (external vendor)", "calibration": "not performed", "rts": "2026-10-09"},
    {"date": "2026-10-14", "vehicle": "AV-02", "work": "Lidar window cleaning and inspection", "calibration": "performed", "rts": "2026-10-14"},
    {"date": "2026-10-20", "vehicle": "AV-09", "work": "Front camera extrinsic recalibration", "calibration": "performed", "rts": "2026-10-20"},
    {"date": "2026-10-22", "vehicle": "AV-07", "work": "Rear bumper repair after INC-0405", "calibration": "performed", "rts": "2026-10-23"},
    {"date": "2026-11-06", "vehicle": "AV-10", "work": "Right front wheel and tire replacement after INC-0419", "calibration": "performed", "rts": "2026-11-07"},
    {"date": "2026-11-08", "vehicle": "AV-03", "work": "DMS camera replaced (offline since Nov 2)", "calibration": "performed", "rts": "2026-11-09"},
]

field_obs = [
    {"id": "FO-101", "date": "2026-09-24", "zone": "Harbor District", "vehicle": "AV-01", "author": "FA-01", "category": "road_environment", "text": "Faded lane markings on Canal St between Mill Ln and 3rd Ave."},
    {"id": "FO-102", "date": "2026-09-30", "zone": "Ridgeview", "vehicle": "AV-05", "author": "VSO-11", "category": "road_environment", "text": "Delivery box trucks routinely park in the loading zone at Marlow Ave & 5th St after 3 pm, blocking view of oncoming lane."},
    {"id": "FO-103", "date": "2026-10-06", "zone": "Old Town", "vehicle": "AV-11", "author": "FA-02", "category": "vso_behavior", "text": "Ride-along audit: VSO followed hands-hover procedure throughout; no issues."},
    {"id": "FO-104", "date": "2026-10-13", "zone": "Old Town", "vehicle": "AV-09", "author": "VSO-22", "category": "vehicle_behavior", "text": "AV-09 tracks noticeably left of lane centre on Old Bridge Rd curves. Felt it 'hug' the centre line twice."},
    {"id": "FO-105", "date": "2026-10-14", "zone": "Old Town", "vehicle": "AV-09", "author": "VSO-27", "category": "vehicle_behavior", "text": "Second report: AV-09 lane position biased left. Logged in shift notes, not escalated to maintenance."},
    {"id": "FO-106", "date": "2026-10-20", "zone": "Ridgeview", "vehicle": "AV-08", "author": "FA-01", "category": "vso_behavior", "text": "Ride-along audit: VSO on phone at a red light (vehicle stationary). Coached on the spot."},
    {"id": "FO-107", "date": "2026-10-23", "zone": "Ridgeview", "vehicle": "AV-06", "author": "VSO-17", "category": "vehicle_behavior", "text": "Since v4.3.0, AV pauses then commits late on Marlow left turn when trucks are parked. Felt rushed twice today around sunset."},
    {"id": "FO-108", "date": "2026-10-26", "zone": "Harbor District", "vehicle": "AV-03", "author": "VSO-02", "category": "road_environment", "text": "New lane closure with cones at Dock St & Pier 3 (utility works). Signed for 4 weeks."},
    {"id": "FO-109", "date": "2026-10-27", "zone": "Ridgeview", "vehicle": "AV-07", "author": "VSO-19", "category": "vehicle_behavior", "text": "Hale Rd & Pine St left turn: AV crept, stopped, then accelerated into gap that closed. Took over."},
    {"id": "FO-110", "date": "2026-10-30", "zone": "Old Town", "vehicle": "AV-10", "author": "FA-02", "category": "vso_behavior", "text": "Ride-along (PM): VSO-24 on hour 5 of shift, yawning repeatedly; stated they cover extra PM blocks most days."},
    {"id": "FO-111", "date": "2026-11-02", "zone": "Harbor District", "vehicle": "AV-03", "author": "VSO-06", "category": "equipment", "text": "DMS status light off on AV-03 at pre-shift check. Ticket raised; vehicle kept in service."},
    {"id": "FO-112", "date": "2026-11-03", "zone": "Harbor District", "vehicle": "AV-01", "author": "VSO-08", "category": "road_environment", "text": "Cones at Dock St closure shift in wind; some drift into the open lane by late afternoon."},
    {"id": "FO-113", "date": "2026-11-06", "zone": "Ridgeview", "vehicle": "AV-05", "author": "VSO-14", "category": "vehicle_behavior", "text": "v4.3.1: Marlow left turn creep behaviour back to normal. Still one hesitation at dusk."},
    {"id": "FO-114", "date": "2026-11-09", "zone": "Old Town", "vehicle": "AV-12", "author": "FA-02", "category": "road_environment", "text": "Street lighting out on a section of Rowan St; very dark in rain."},
    {"id": "FO-115", "date": "2026-11-12", "zone": "Harbor District", "vehicle": "AV-04", "author": "FA-01", "category": "road_environment", "text": "Dock St closure extended; contractor confirmed cones now ballasted."},
]

# ---------------------------------------------------------------- stats used in narratives
def rate(num, den):
    return num / den * 1000 if den else 0


def site_stats(site_names, sw_list, light=None):
    sc = sum(1 for r in interventions if r["id"][2] != "9" and r["site"] in site_names and r["sw"] in sw_list
             and r["type"] == "safety_critical" and (light is None or r["light"] == light))
    pu = sum(1 for f in flags if f["site"] in site_names and f["sw"] in sw_list and f["type"] == "planner_uncertainty"
             and (light is None or f["light"] == light))
    return sc, pu


LEFT = ["Marlow Ave & 5th St", "Hale Rd & Pine St"]
sc420, pu420 = site_stats(LEFT, ["v4.2.0"])
sc430, pu430 = site_stats(LEFT, ["v4.3.0"])
sc431, pu431 = site_stats(LEFT, ["v4.3.1"])
days = {"v4.2.0": 24, "v4.3.0": 14, "v4.3.1": 10}   # operating days per version
v24 = [s for s in shifts if s["vso"] == "VSO-24"]
v24_long = sum(1 for s in v24 if s["hours"] > 4.0)
all_long = sum(1 for s in shifts if s["hours"] > 4.0)
late_dms = [x for x in dms if x["type"] == "drowsiness"]
dr_after4 = sum(1 for x in late_dms if x["hour_into_shift"] > 4)
av09_ld = sum(1 for f in flags if f["vehicle"] == "AV-09" and f["type"] == "localization_drift"
              and "2026-10-09" <= f["ts"][:10] < "2026-10-20")
av09_ld_after = sum(1 for f in flags if f["vehicle"] == "AV-09" and f["type"] == "localization_drift"
                    and "2026-10-20" <= f["ts"][:10] <= "2026-10-30")

STATS = {"sc420": sc420, "sc430": sc430, "sc431": sc431, "pu420": pu420, "pu430": pu430, "pu431": pu431,
         "v24_long": v24_long, "v24_shifts": len(v24), "all_long": all_long, "av09_ld": av09_ld,
         "av09_ld_after": av09_ld_after}

OWNER = "M. Belmares, Safety Assurance"
investigations = [
    {
        "id": "INV-001", "title": "Unprotected left-turn regression after v4.3.0", "incidents": ["INC-0412"],
        "status": "Corrective action in verification", "risk": "High", "opened": "2026-10-30", "owner": OWNER,
        "chart": "left_turn",
        "summary": (f"INC-0412 was not a one-off. At the two occluded unprotected-left sites in Ridgeview, planner-uncertainty flags went from "
                    f"{pu420/24:.1f} per operating day on v4.2.0 to {pu430/14:.1f} on v4.3.0, and safety-critical takeovers from {sc420} in 24 days to {sc430} in 14 days. "
                    f"The rise is concentrated at dusk and at the most occluded site. v4.3.1 cut flags to {pu431/10:.1f} per day and saw {sc431} safety-critical takeover{'s' if sc431 != 1 else ''} in 10 days, "
                    f"but flags are still above the v4.2.0 baseline, so the action stays open."),
        "timeline": [
            {"t": "2026-09-30", "src": "Field obs FO-102", "event": "Box trucks noted parking at Marlow loading zone after 3 pm, blocking view of oncoming lane."},
            {"t": "2026-10-19", "src": "Release log", "event": "v4.3.0 rolled out fleet-wide. Sim gate passed; no occluded-left low-light scenarios in suite."},
            {"t": "2026-10-20 → 10-25", "src": "Model flags", "event": "Planner-uncertainty and hard-brake flags at Marlow and Hale rise above the W1-W4 baseline band (leading indicator)."},
            {"t": "2026-10-23", "src": "Field obs FO-107", "event": "VSO-17 reports AV 'pauses then commits late' at Marlow around sunset."},
            {"t": "2026-10-27", "src": "Field obs FO-109", "event": "Similar takeover at Hale Rd & Pine St."},
            {"t": "2026-10-29 17:51:48", "src": "Model flags", "event": "occlusion_high flag at Marlow Ave & 5th St (AV-06, dusk, sunset 18:03)."},
            {"t": "2026-10-29 17:51:55", "src": "Model flags", "event": "planner_uncertainty flag while AV creeps into the turn."},
            {"t": "2026-10-29 17:52:01", "src": "Intervention I-log", "event": "VSO-15 takes over and brakes; TTC 1.1 s. Oncoming car emerged from behind parked box truck."},
            {"t": "2026-10-29 17:52:03", "src": "Model flags", "event": "hard_brake recorded. Min separation 2.3 m, no contact (INC-0412, S0)."},
            {"t": "2026-10-30", "src": "Safety Assurance", "event": "Investigation opened; site pattern escalated to planning team with rate evidence."},
            {"t": "2026-11-04", "src": "Release log", "event": "v4.3.1 hotfix restores conservative creep when the oncoming lane is occluded."},
        ],
        "evidence": [
            {"item": "Intervention log, filtered to Marlow and Hale", "source": "interventions", "finding": f"Safety-critical takeovers: v4.2.0 {sc420} (24 days), v4.3.0 {sc430} (14 days), v4.3.1 {sc431} (10 days)."},
            {"item": "Model flags at the same sites", "source": "model flags", "finding": f"planner_uncertainty per operating day: v4.2.0 {pu420/24:.1f}, v4.3.0 {pu430/14:.1f}, v4.3.1 {pu431/10:.1f}. Rose the week before INC-0412."},
            {"item": "Exposure by light condition", "source": "shifts (km_dusk)", "finding": "Dusk km per week roughly doubled across the period as sunsets moved earlier, so rates are compared per dusk km, not raw counts."},
            {"item": "Occlusion gradient", "source": "site reference", "finding": "Effect scales with occlusion: Marlow (high) > Hale > Market St (medium) > Harbor Blvd (low, no clear change)."},
            {"item": "Release gate record", "source": "release log", "finding": "v4.3.0 suite had no occluded oncoming-lane scenarios in low light."},
            {"item": "Field observations FO-102, FO-107, FO-109", "source": "field obs", "finding": "Operators described the behaviour 6 days before the near miss; reports were not linked to the release."},
        ],
        "whys": [
            "Why did the near miss happen? The AV committed to the turn while an oncoming car was hidden behind a parked truck.",
            "Why did it commit? v4.3.0's new yielding cost terms shortened the creep-and-look phase when the oncoming lane was occluded.",
            "Why wasn't this caught before release? The sim regression suite had no occluded unprotected-left scenarios in low light.",
            "Why did it reach an incident after rollout? Rising flags and operator reports were not monitored per site after the release.",
            "Why not? There was no post-release watch list tying leading indicators to the change that shipped.",
        ],
        "factors": {
            "Software / model": ["v4.3.0 planner cost change reduced creep behaviour under occlusion", "Uncertainty flag raised but did not trigger a more conservative policy"],
            "Process / controls": ["Release gate scenario coverage gap", "No post-release leading-indicator watch for 2 weeks"],
            "Environment": ["Parked box trucks block sightline after 3 pm", "Earlier sunsets moved PM shifts into dusk"],
            "People": ["VSO-15 responded correctly (0.7 s); operator reports existed but were not escalated"],
            "Data": ["Field observations stored as free text, not linked to software version"],
        },
        "root_cause": "A planner change in v4.3.0 reduced creep-and-look behaviour on unprotected left turns with an occluded oncoming lane, and the release gate had no low-light occluded scenarios to catch it.",
        "actions": [
            {"action": "Ship v4.3.1 conservative-creep hotfix", "type": "Corrective", "owner": "Planning team", "due": "2026-11-04", "status": "Done"},
            {"action": "Add 64 occluded-left low-light scenarios to release gate", "type": "Preventive", "owner": "Simulation team", "due": "2026-11-04", "status": "Done"},
            {"action": "Restrict PM unprotected lefts at Marlow when loading zone occupied (route avoid) until rate returns to baseline", "type": "Corrective", "owner": "Fleet Ops", "due": "2026-11-18", "status": "In progress"},
            {"action": "Two-week post-release watch list for every release: site-level flag and takeover rates vs baseline", "type": "Preventive", "owner": "Safety Assurance", "due": "2026-11-30", "status": "In progress"},
            {"action": "Tag field observations with vehicle, site and software version", "type": "Preventive", "owner": "Ops Tooling", "due": "2026-12-15", "status": "Open"},
        ],
        "limitations": [
            "Counts at two sites are small; rates per version have wide uncertainty.",
            "Dusk exposure changes with season, which partly confounds the before/after comparison.",
            "Occlusion level per pass is inferred from flags, not measured directly.",
        ],
    },
    {
        "id": "INV-002", "title": "Late takeover by fatigued VSO on extended shift", "incidents": ["INC-0419"],
        "status": "Open, actions in progress", "risk": "High", "opened": "2026-11-06", "owner": OWNER,
        "chart": "fatigue",
        "summary": (f"VSO-24 worked {v24_long} of {len(v24)} shifts longer than the 4.0 h limit from week 5; the fleet had {all_long} over-limit shifts in total. "
                    f"INC-0419 happened 6.1 h into a 6.3 h shift, at night in rain. DMS flagged drowsiness 6 minutes earlier and ops acknowledged it after 9 min 10 s. "
                    f"Takeover reaction was 2.4 s against a fleet median under 1 s."),
        "timeline": [
            {"t": "2026-10-19 →", "src": "Shift schedule", "event": "VSO-24 begins covering extended PM blocks (5.5-6.5 h) on AV-10/AV-11."},
            {"t": "2026-10-30", "src": "Field obs FO-110", "event": "Ride-along auditor notes VSO-24 yawning in hour 5; says they cover extra PM blocks most days."},
            {"t": "2026-11-05 14:35", "src": "Shift record", "event": "VSO-24 starts 6.3 h shift on AV-10 (Old Town). Rain from late afternoon."},
            {"t": "2026-11-05 20:22:40", "src": "DMS", "event": "Eyes off road 2.6 s."},
            {"t": "2026-11-05 20:35:10", "src": "DMS", "event": "Drowsiness alert (7.8 s). Ops acknowledgement at 20:44:20, 9 min 10 s later."},
            {"t": "2026-11-05 20:40:58", "src": "DMS", "event": "Eyes off road 3.1 s."},
            {"t": "2026-11-05 20:41:12", "src": "Model flags", "event": "perception_low_conf on curb edge, Rowan St (street lighting out, wet)."},
            {"t": "2026-11-05 20:41:26", "src": "Vehicle", "event": "Lateral-deviation alert as AV moves right for oncoming van."},
            {"t": "2026-11-05 20:41:28", "src": "Intervention I-log", "event": "VSO-24 takeover, reaction 2.4 s. Right front wheel strikes curb at 14 km/h (INC-0419, S1)."},
            {"t": "2026-11-06", "src": "Safety Assurance", "event": "Investigation opened; VSO-24 stood down from PM shifts pending review."},
        ],
        "evidence": [
            {"item": "Shift schedule", "source": "shifts", "finding": f"{v24_long} VSO-24 shifts over 4.0 h; scheduling tool did not block them."},
            {"item": "DMS events by hour into shift", "source": "DMS", "finding": "Fleet drowsiness rate rises sharply after hour 4; VSO-24's rate is the highest in the fleet."},
            {"item": "Takeover reaction times", "source": "interventions", "finding": "Fleet median under 1 s; VSO-24 reactions lengthen after hour 5."},
            {"item": "DMS acknowledgement times", "source": "DMS", "finding": "Share of alerts acknowledged after 5 min is highest after 18:00, when ops staffing is thinner."},
            {"item": "Field observation FO-110 and FO-114", "source": "field obs", "finding": "Fatigue observed 6 days earlier; Rowan St lighting outage reported 4 days later confirms dark conditions."},
        ],
        "whys": [
            "Why did the wheel hit the curb? The VSO took over 2.4 s after the alert, too late to correct.",
            "Why was the takeover slow? The VSO was drowsy, 6.1 h into a shift, at night.",
            "Why was the VSO on a 6.3 h shift? The scheduling tool allowed blocks over the 4.0 h policy and this VSO covered them repeatedly.",
            "Why did the drowsiness alert not stop the shift? The alert waited 9 min for acknowledgement and there is no rule to stand a VSO down after a drowsiness alert.",
            "Why? The fatigue controls are written policy but not enforced in tools or monitored in reporting.",
        ],
        "factors": {
            "People": ["Fatigue from extended and repeated PM shifts", "Eyes-off-road events in the minutes before the event"],
            "Process / controls": ["4.0 h shift limit not enforced by scheduling tool", "No stand-down rule after DMS drowsiness alert", "DMS acknowledgement SLA (5 min) missed"],
            "Environment": ["Night, rain, street lighting out on Rowan St", "Narrow two-way road with oncoming van"],
            "Software / model": ["Low perception confidence on curb edge in dark, wet conditions"],
            "Data": ["Fatigue indicators existed in DMS data but were not trended per VSO"],
        },
        "root_cause": "Fatigue controls were not enforced: the scheduling tool allowed shifts beyond the 4.0 h limit, and a DMS drowsiness alert did not lead to a timely response or stand-down.",
        "actions": [
            {"action": "Hard-block shifts over 4.0 h in the scheduling tool", "type": "Preventive", "owner": "Fleet Ops", "due": "2026-11-20", "status": "In progress"},
            {"action": "Mandatory stand-down and ops call after any DMS drowsiness alert", "type": "Preventive", "owner": "Ops Safety", "due": "2026-11-15", "status": "Done"},
            {"action": "Add evening ops staffing to meet 5-min DMS acknowledgement SLA", "type": "Corrective", "owner": "Ops Manager", "due": "2026-11-30", "status": "Open"},
            {"action": "Weekly per-VSO fatigue indicator in the safety pack (DMS rate after hour 4, overtime shifts)", "type": "Preventive", "owner": "Safety Assurance", "due": "2026-11-21", "status": "Done"},
            {"action": "Report Rowan St lighting outage to city; night route restriction until fixed", "type": "Corrective", "owner": "Fleet Ops", "due": "2026-11-12", "status": "Done"},
        ],
        "limitations": [
            "DMS measures eye and head behaviour; it does not measure fatigue directly.",
            "One VSO's data cannot separate individual factors from shift pattern; both are addressed.",
        ],
    },
    {
        "id": "INV-003", "title": "AV-09 lane bias after windshield replacement", "incidents": ["INC-0398"],
        "status": "Closed", "risk": "Medium", "opened": "2026-10-16", "owner": OWNER, "chart": "calibration",
        "summary": (f"AV-09 returned to service on Oct 9 after an external windshield replacement without a camera recalibration. "
                    f"Over the next 11 days it logged {av09_ld} localization-drift flags (vs {av09_ld_after} in the 11 days after recalibration) "
                    f"and two operator reports of left lane bias before the Oct 15 encroachment."),
        "timeline": [
            {"t": "2026-10-09", "src": "Maintenance log", "event": "Windshield replaced by vendor; calibration check 'not performed'; returned to service same day."},
            {"t": "2026-10-09 →", "src": "Model flags", "event": "AV-09 localization_drift and perception_low_conf flags rise to several times the fleet rate."},
            {"t": "2026-10-13", "src": "Field obs FO-104", "event": "VSO-22: AV-09 tracks left of lane centre on curves."},
            {"t": "2026-10-14", "src": "Field obs FO-105", "event": "Second report; logged in shift notes, not escalated."},
            {"t": "2026-10-15 11:19:40", "src": "Model flags", "event": "Repeated localization_drift on Old Bridge Rd."},
            {"t": "2026-10-15 11:20:05", "src": "Intervention I-log", "event": "VSO-22 steers right after ~0.35 m centre-line crossing (INC-0398, S0)."},
            {"t": "2026-10-16", "src": "Safety Assurance", "event": "Vehicle anomaly matched to maintenance record; recalibration booked for first vendor slot (Oct 20). AV-09 stayed in service meanwhile."},
            {"t": "2026-10-20", "src": "Maintenance log", "event": "Front camera extrinsic recalibration; flags return to fleet level."},
        ],
        "evidence": [
            {"item": "Per-vehicle flag rates", "source": "model flags", "finding": "AV-09 was the top weekly anomaly in W3-W4 for localization drift."},
            {"item": "Maintenance log", "source": "maintenance", "finding": "Calibration 'not performed' after windshield work on Oct 9."},
            {"item": "Before/after recalibration", "source": "model flags", "finding": f"{av09_ld} drift flags in 11 days before vs {av09_ld_after} after."},
            {"item": "Field observations FO-104, FO-105", "source": "field obs", "finding": "Operators noticed the bias 2 days before the event."},
        ],
        "whys": [
            "Why did AV-09 cross the centre line? Lane position was biased left on curves.",
            "Why? Front camera extrinsics were off after the windshield was replaced.",
            "Why was it not recalibrated? The return-to-service checklist did not require calibration after glass work by a vendor.",
            "Why wasn't the bias caught sooner? Operator reports stayed in shift notes and vehicle-level flag trends were not reviewed daily.",
            "Why? No owner for per-vehicle anomaly review.",
        ],
        "factors": {
            "Vehicle / hardware": ["Camera extrinsic calibration invalid after windshield replacement"],
            "Process / controls": ["Return-to-service checklist gap for vendor glass work", "Operator reports not escalated", "No rule to stand a vehicle down while a calibration defect is open"],
            "Data": ["Per-vehicle anomaly signal present from day 1 but not reviewed"],
            "People": ["VSO-22 responded correctly"],
        },
        "root_cause": "The return-to-service process did not require camera recalibration after a vendor windshield replacement.",
        "actions": [
            {"action": "Recalibrate AV-09 front camera", "type": "Corrective", "owner": "Vehicle Maintenance", "due": "2026-10-20", "status": "Done"},
            {"action": "Add mandatory calibration check after any glass, sensor-mount or bumper work", "type": "Preventive", "owner": "Vehicle Maintenance", "due": "2026-10-31", "status": "Done"},
            {"action": "Daily per-vehicle anomaly review (flag z-score vs fleet)", "type": "Preventive", "owner": "Safety Assurance", "due": "2026-10-31", "status": "Done"},
            {"action": "Stand vehicles down until any open sensor-calibration defect is closed", "type": "Preventive", "owner": "Fleet Ops", "due": "2026-10-31", "status": "Done"},
        ],
        "limitations": ["Magnitude of the calibration error was not measured before correction."],
    },
    {
        "id": "INV-004", "title": "Construction zone at Dock St & Pier 3", "incidents": ["INC-0427"],
        "status": "Open, monitoring", "risk": "Medium", "opened": "2026-11-10", "owner": OWNER, "chart": "construction",
        "summary": ("Precautionary takeovers at Dock St & Pier 3 rose from the week the lane closure started (Oct 26). The rise is environmental: it appears on every software version, "
                    "is limited to one site, and matches field reports. INC-0427 was a 6 km/h contact with a wind-displaced cone."),
        "timeline": [
            {"t": "2026-10-26", "src": "Field obs FO-108", "event": "Lane closure with cones begins at Dock St & Pier 3 (4 weeks)."},
            {"t": "2026-10-26 →", "src": "Interventions / flags", "event": "Precautionary takeovers and ood_scene flags rise at the site only."},
            {"t": "2026-11-03", "src": "Field obs FO-112", "event": "Cones drift into the open lane in wind."},
            {"t": "2026-11-10 15:21:50", "src": "Model flags", "event": "ood_scene, then perception_low_conf at the closure (AV-02)."},
            {"t": "2026-11-10 15:22:06", "src": "Intervention I-log", "event": "VSO-04 takeover 1.0 s; cone contacted at 6 km/h (INC-0427, S1, property only)."},
            {"t": "2026-11-12", "src": "Field obs FO-115", "event": "Contractor ballasts cones; closure extended."},
        ],
        "evidence": [
            {"item": "Site-level takeovers by week", "source": "interventions", "finding": "Increase begins W6 at this site only; other Harbor sites flat."},
            {"item": "Trigger attribution", "source": "interventions", "finding": "Most takeovers at the site are attributed 'external', not to a stack module."},
            {"item": "Field observations FO-108, FO-112, FO-115", "source": "field obs", "finding": "Confirm closure start, cone drift, and fix."},
        ],
        "whys": [
            "Why the contact? A cone displaced by wind sat inside the travel lane.",
            "Why did the AV not avoid it fully? It was classified as low-priority static debris in an unusual (out-of-distribution) scene.",
            "Why was the AV routed through? Temporary closures are not fed into routing or ODD restrictions.",
        ],
        "factors": {
            "Environment": ["Temporary lane closure, unballasted cones drifting in wind"],
            "Software / model": ["Out-of-distribution scene; displaced cone treated as low-priority object"],
            "Process / controls": ["No process to restrict ODD around reported temporary works"],
            "People": ["VSO-04 responded within 1.0 s"],
        },
        "root_cause": "Temporary works reported by operators were not used to restrict routing, exposing the fleet to an unusual scene with drifting cones.",
        "actions": [
            {"action": "Route around Dock St closure until removed", "type": "Corrective", "owner": "Fleet Ops", "due": "2026-11-11", "status": "Done"},
            {"action": "Process: field-reported temporary works trigger an ODD review within 24 h", "type": "Preventive", "owner": "Safety Assurance", "due": "2026-11-25", "status": "In progress"},
            {"action": "Add drifting-cone scenarios to perception eval set", "type": "Preventive", "owner": "Perception team", "due": "2026-12-10", "status": "Open"},
        ],
        "limitations": ["Pre-closure baseline at this site is short (5 weeks)."],
    },
    {
        "id": "INV-005", "title": "Rear-end collision by third party", "incidents": ["INC-0405"],
        "status": "Closed", "risk": "Low", "opened": "2026-10-21", "owner": OWNER, "chart": None,
        "summary": "The AV was stationary at a red light for 6.2 s with brake lights on when a third-party car struck it at ~12 km/h. Data shows no AV contribution and an attentive VSO.",
        "timeline": [
            {"t": "2026-10-21 08:14:16", "src": "Vehicle", "event": "AV-07 stops at red light, College Ave; brake lights on."},
            {"t": "2026-10-21 08:14:22", "src": "Vehicle / IMU", "event": "Rear impact ~12 km/h from third-party car. No injuries."},
            {"t": "2026-10-21 08:20", "src": "Ops", "event": "Police and insurer notified; dashcam and logs preserved."},
        ],
        "evidence": [
            {"item": "Vehicle logs and rear camera", "source": "vehicle", "finding": "Stationary 6.2 s before impact; no harsh braking."},
            {"item": "DMS", "source": "DMS", "finding": "No DMS events in the 10 minutes before impact."},
        ],
        "whys": ["Why the collision? Following driver did not stop. No AV behaviour contributed."],
        "factors": {"Environment": ["Morning traffic, third-party following too closely"]},
        "root_cause": "Third-party driver error. No AV or VSO contribution found.",
        "actions": [{"action": "Rear bumper repair and rear radar recalibration", "type": "Corrective", "owner": "Vehicle Maintenance", "due": "2026-10-23", "status": "Done"}],
        "limitations": [],
    },
]

controls = [
    {"id": "C1", "name": "Shift length within 4.0 h limit", "policy": "VSOs drive no more than 4.0 h continuously.", "test": "shift_length"},
    {"id": "C2", "name": "Safety-critical takeovers triaged within 48 h", "policy": "Every safety-critical takeover is reviewed within 48 h.", "test": "triage"},
    {"id": "C3", "name": "Calibration before return to service", "policy": "Sensor calibration is verified after maintenance that can disturb sensors.", "test": "calibration"},
    {"id": "C4", "name": "DMS alerts acknowledged within 5 min", "policy": "Ops acknowledges every DMS alert within 5 minutes.", "test": "dms_ack"},
    {"id": "C5", "name": "DMS available on every shift", "policy": "DMS uptime of at least 98% on every shift.", "test": "dms_uptime"},
    {"id": "C6", "name": "Pre-shift vehicle check completed", "policy": "Pre-shift checklist completed before autonomous driving.", "test": "precheck"},
    {"id": "C7", "name": "Release gate scenario coverage", "policy": "Each release passes sim regression covering known high-risk manoeuvres.", "test": "release"},
]

for s in shifts:
    s.pop("_start_h", None)

data = {
    "meta": {
        "title": "Simulated AV fleet: operational safety dataset",
        "generated_by": "tools/generate_data.py", "seed": 42, "start": START.isoformat(),
        "end": (START + timedelta(days=WEEKS * 7 - 1)).isoformat(), "weeks": WEEKS,
        "disclaimer": "All data is synthetic and fictional. Not real vehicles, people, places or company data.",
        "zones": {z: {"vehicles": c["vehicles"], "vsos": c["vsos"],
                      "sites": [{"name": n, "maneuver": m, "occlusion": o} for n, m, o in c["sites"]]}
                  for z, c in ZONES.items()},
        "releases": RELEASES, "stats": STATS,
    },
    "shifts": shifts, "interventions": interventions, "flags": flags, "dms": dms, "incidents": incidents,
    "field_obs": field_obs, "maintenance": maintenance, "investigations": investigations, "controls": controls,
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(data, separators=(",", ":")))
print(f"shifts {len(shifts)}  interventions {len(interventions)} (dups {len(dups)})  flags {len(flags)}  "
      f"dms {len(dms)}  -> {OUT}  ({OUT.stat().st_size/1e6:.2f} MB)")
print(STATS)
