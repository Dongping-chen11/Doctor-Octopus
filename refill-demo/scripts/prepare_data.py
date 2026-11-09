"""Build the demo's JSON data from the two clinic exports.

Real: providers, services, durations, patient visit histories, cancellation
history, refill rates, and a show-up model trained on real outcomes.
Mocked (the exports lack them): names, home locations, availability,
upcoming bookings, waitlist status, language, offer history.
"""
import json, math, random, sys, re
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "/mnt/project-files/nathack_c/aide_data/aide_data")
OUT = Path(__file__).resolve().parent.parent / "src" / "data"
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(42)
np.random.seed(42)

FILES = {
    "bethesda": "BethesdaHealthAndWellnessCentreInc_Appointments_20250701_20260714.csv",
    "revive": "ReviveRehabPhysiotherapyMassageInc_Appointments_20250701_20260714.csv",
}
CLINICS = {
    # Locations are MOCK (the export only says "Edmonton").
    "bethesda": {"id": "bethesda", "name": "Bethesda Health & Wellness", "short": "Bethesda", "lat": 53.4630, "lng": -113.4300},
    "revive": {"id": "revive", "name": "Revive Rehab Physio & Massage", "short": "Revive", "lat": 53.5960, "lng": -113.5150},
}

def category(t):
    t = t.lower() if isinstance(t, str) else ""
    if re.search(r"report|chart|ab\d|case conference|cancellation/noshow|documents", t): return "admin"
    if "chiro" in t: return "chiro"
    if "acupun" in t: return "acupuncture"
    if re.search(r"facial|hair|wax|thread|mani|pedi|nail|lash|eyebrow|make up|polish|henna|highlight|led light|beard|brazil|root touch|foot care|sideburn|body scrub|haircut", t): return "aesthetics"
    if re.search(r"massage|cupping|reflexology|hot stone|aromatherapy|hijjama|relaxation|tmj|lymphatic|signature|bundle", t): return "massage"
    if re.search(r"physio|assessment|subsequent|shockwave|vestibular|treatment|extended|wcb|mva", t): return "physio"
    return "other"

def payer(t):
    t = t.lower() if isinstance(t, str) else ""
    if "mva" in t: return "MVA"
    if "wcb" in t: return "WCB"
    return "private"

frames = []
for cid, f in FILES.items():
    d = pd.read_csv(SRC / f, encoding="utf-8-sig")
    d["clinic"] = cid
    frames.append(d)
d = pd.concat(frames, ignore_index=True)
for c in ["start_at", "end_at", "booked_at", "cancelled_at", "no_show_at"]:
    d[c] = pd.to_datetime(d[c], utc=True, errors="coerce").dt.tz_convert("America/Edmonton")
d["dur"] = ((d.end_at - d.start_at).dt.total_seconds() / 60).round()
d["cat"] = d.treatment_name.map(category)
d["payer"] = d.treatment_name.map(payer)
d["initial"] = d.treatment_name.fillna("").str.lower().str.contains("initial")
d["staff"] = d.staff_member_name.str.replace(r"^Dr\. (Ac\. )?", "", regex=True).str.strip()
d["staff"] = d.staff.replace({"Mariia Kuzyk": "Mariia Kuzik", "Bharti Bharti": "Bharti Agnihotri"})
real = d[d.state.isin(["arrived", "cancelled", "no_show", "booked", "rescheduled"]) & ~d.cat.isin(["admin", "other"]) & d.patient_uid.str.startswith("PT-") & (d.patient_uid != "PT-REVIEW")].copy()
real["bad"] = real.state.isin(["cancelled", "no_show"]).astype(int)
DATA_END = real.start_at.max().normalize()

# ---------------- providers ----------------
providers = []
for name, g in real.groupby("staff"):
    if len(g) < 40: continue
    cats = g.cat.value_counts(normalize=True)
    cats = [c for c, v in cats.items() if v >= 0.08]
    durs = {c: int(g[g.cat == c].dur.median()) for c in cats}
    pid = re.sub(r"[^a-z]+", "-", name.lower()).strip("-")
    providers.append({
        "id": pid, "name": name, "clinics": sorted(g.clinic.unique().tolist()),
        "categories": cats, "typicalDuration": durs, "volume": int(len(g)),
        "languages": ["English"] + (["Punjabi"] if "Gill" in name or "Kaur" in name else []) + (["Malayalam"] if name.split()[-1] in ("Johnson", "Johny", "Sajeev", "Scaria", "Zachariah", "E", "Alexander", "Mathew") else []) + (["Tagalog"] if "Uy" in name else []) + (["Ukrainian"] if "Shvorak" in name or "Kuzik" in name else []),
    })
pmap = {p["name"]: p for p in providers}
real = real[real.staff.isin(pmap)]

# ---------------- show-up model (trained on real outcomes) ----------------
m = real[real.state.isin(["arrived", "cancelled", "no_show"])].copy().sort_values("start_at")
m["lead_days"] = ((m.start_at - m.booked_at).dt.total_seconds() / 86400).clip(lower=0).fillna(3)
g = m.groupby("patient_uid")
m["prior_n"] = g.cumcount()
m["prior_bad"] = g.bad.cumsum() - m.bad
PRIOR_A, PRIOR_B = 1.0, 8.0  # Beta prior ~ 11% cancel rate
m["prior_rate"] = (m.prior_bad + PRIOR_A) / (m.prior_n + PRIOR_A + PRIOR_B)
m["online"] = m.booked_online.fillna(False).astype(bool).astype(int)
m["log_lead"] = np.log1p(m.lead_days)
m["first"] = m.first_visit.astype(bool).astype(int)
m["evening"] = (m.start_at.dt.hour >= 17).astype(int)
m["morning"] = (m.start_at.dt.hour < 11).astype(int)
m["saturday"] = (m.start_at.dt.dayofweek == 5).astype(int)
for c in ["massage", "chiro", "aesthetics", "acupuncture"]:
    m["cat_" + c] = (m.cat == c).astype(int)
m["insurance"] = (m.payer != "private").astype(int)
FEATS = ["prior_rate", "online", "log_lead", "first", "evening", "morning", "saturday", "cat_massage", "cat_chiro", "cat_aesthetics", "cat_acupuncture", "insurance"]
cut = m.start_at.quantile(0.8)
tr, te = m[m.start_at < cut], m[m.start_at >= cut]
clf = LogisticRegression(max_iter=1000).fit(tr[FEATS], tr.bad)
auc = roc_auc_score(te.bad, clf.predict_proba(te[FEATS])[:, 1])
clf = LogisticRegression(max_iter=1000).fit(m[FEATS], m.bad)
model = {
    "target": "P(cancel or no-show)", "features": FEATS,
    "coef": dict(zip(FEATS, [round(float(x), 4) for x in clf.coef_[0]])),
    "intercept": round(float(clf.intercept_[0]), 4),
    "prior": {"a": PRIOR_A, "b": PRIOR_B}, "testAuc": round(float(auc), 3),
    "trainedOn": int(len(m)), "baseRate": round(float(m.bad.mean()), 4),
}
print("show-up model AUC (time split):", model["testAuc"], model["coef"])

# ---------------- cancellation history + baseline refill ----------------
act = d[d.state.isin(["arrived", "booked"])]
lost = real[real.state.isin(["cancelled", "no_show"])].copy()
lost["lead_h"] = ((lost.start_at - lost.cancelled_at).dt.total_seconds() / 3600)
lost.loc[lost.state == "no_show", "lead_h"] = 0
filled = []
for _, r in lost.iterrows():
    mm = act[(act.staff_member_name == r.staff_member_name) & (act.start_at < r.end_at) & (act.end_at > r.start_at) & (act.patient_uid != r.patient_uid)]
    if pd.notna(r.cancelled_at): mm = mm[mm.booked_at >= r.cancelled_at - pd.Timedelta(minutes=1)]
    filled.append(bool(len(mm)))
lost["filled"] = filled
history = [{
    "clinic": r.clinic, "provider": pmap[r.staff]["id"], "category": r.cat, "payer": r.payer,
    "start": r.start_at.isoformat(), "dow": int(r.start_at.dayofweek), "hour": round(r.start_at.hour + r.start_at.minute / 60, 2),
    "duration": int(r.dur), "leadHours": round(float(max(r.lead_h, 0) if pd.notna(r.lead_h) else 0), 2),
    "type": r.state, "refilled": bool(r.filled),
} for r in lost.itertuples()]
BUCKETS = [(0, 2, "Under 2 h"), (2, 6, "2 to 6 h"), (6, 24, "6 to 24 h"), (24, 72, "1 to 3 days"), (72, 1e9, "Over 3 days")]
baseline = []
for lo, hi, lab in BUCKETS:
    s = lost[(lost.lead_h.fillna(0).clip(lower=0) >= lo) & (lost.lead_h.fillna(0).clip(lower=0) < hi)]
    baseline.append({"label": lab, "lo": lo, "hi": hi, "rate": round(float(s.filled.mean()), 3), "n": int(len(s))})

# ---------------- patients: real history + mock attributes ----------------
FIRST = "Maya Liam Ava Noah Priya Arjun Sofia Lucas Aisha Omar Chloe Ethan Mei Daniel Hana Leo Zara Ryan Nora Kai Elena Sam Isla Jonah Amara Victor Ines Tariq Grace Mateo Lena Ravi Yuki Owen Fatima Felix Rosa Dev Clara Hugo Asha Ben Iris Malik Ruby Theo Simran Marco Jade Arman".split()
LAST = "ABCDEFGHJKLMNPRSTVWYZ"
LANGS = [("English", 0.80), ("Punjabi", 0.07), ("Malayalam", 0.05), ("Tagalog", 0.04), ("Ukrainian", 0.04)]
def pick_lang():
    x = rng.random(); acc = 0
    for l, p in LANGS:
        acc += p
        if x < acc: return l
    return "English"

patients = []
for uid, g in real.groupby("patient_uid"):
    g = g.sort_values("start_at")
    days_since = (DATA_END - g.start_at.max().normalize()).days
    if len(g) < 2 or days_since > 150: continue
    last = g.iloc[-1]
    cat_counts = g.cat.value_counts()
    main_cat = cat_counts.index[0]
    gm = g[g.cat == main_cat]
    prov = gm.staff.value_counts().index[0]
    need_dur = int(gm.tail(3).dur.median() // 5 * 5)
    if need_dur < 15: continue
    hours = g.start_at.dt.hour
    windows = {"morning": bool(((hours < 12).mean()) >= 0.2), "afternoon": bool((((hours >= 12) & (hours < 17)).mean()) >= 0.2), "evening": bool(((hours >= 17).mean()) >= 0.2)}
    if not any(windows.values()): windows["afternoon"] = True
    days = sorted(set(int(x) for x in g.start_at.dt.dayofweek))
    if len(days) < 3: days = sorted(set(days) | set(rng.sample(range(0, 6), 2)))
    clinic = g.clinic.value_counts().index[0]
    c = CLINICS[clinic]
    near = rng.random() < 0.7
    lat = c["lat"] + rng.gauss(0, 0.035 if near else 0.07)
    lng = c["lng"] + rng.gauss(0, 0.06 if near else 0.12)
    n, nb = len(g), int(g.bad.sum())
    has_booking = rng.random() < 0.6
    p = {
        "id": uid, "name": f"{rng.choice(FIRST)} {rng.choice(LAST)}.",
        "homeClinic": clinic, "lat": round(lat, 4), "lng": round(lng, 4),
        "need": {"category": main_cat, "payer": gm.iloc[-1]["payer"], "duration": need_dur, "initial": False},
        "provider": pmap[prov]["id"], "acceptsOtherProviders": rng.random() < 0.55,
        "history": {"visits": n, "cancels": nb, "online": round(float(g.booked_online.fillna(False).astype(bool).mean()), 2), "daysSinceLastVisit": int(days_since)},
        "flexMode": rng.random() < 0.45, "freeToday": False,
        "windows": windows, "days": days,
        "nextBookingInDays": rng.randint(3, 24) if has_booking else None,
        "waitingDays": None if has_booking else rng.randint(1, 30),
        "acute": rng.random() < 0.08 or (last.payer != "private" and rng.random() < 0.15),
        "language": pick_lang(),
        "offerAcceptRate": round(min(0.95, max(0.05, rng.betavariate(3, 4))), 2),
        "offersThisWeek": rng.choice([0, 0, 0, 1, 1, 2, 3]),
        "optedOut": rng.random() < 0.04,
    }
    patients.append(p)
# "I'm free today" chips: mostly flex patients
for p in patients:
    p["freeToday"] = rng.random() < (0.22 if p["flexMode"] else 0.04)
print("patients:", len(patients), "providers:", len(providers), "history:", len(history))

# ---------------- a synthetic "today" (Tuesday) schedule ----------------
SHOW = ["sudeesh-e", "anastasiia-shvorak", "ahmed-sleiman", "sonu-johny", "binu-johnson", "lucy-wood"]
prov_by_id = {p["id"]: p for p in providers}
by_provider = {}
for p in patients:
    by_provider.setdefault(p["provider"], []).append(p)
schedule = []
aid = 1
for pid in SHOW:
    if pid not in prov_by_id: continue
    pr = prov_by_id[pid]
    clinic = pr["clinics"][0] if pid != "binu-johnson" else "revive"
    t = 9 * 60
    pool = [p for p in by_provider.get(pid, [])]
    rng.shuffle(pool)
    while t < 18 * 60:
        cat = rng.choices(pr["categories"], weights=[pr["volume"]] * len(pr["categories"]))[0] if rng.random() < 0.3 else pr["categories"][0]
        dur = int(pr["typicalDuration"][cat])
        dur = max(20, min(90, int(round(dur / 10.0) * 10)))
        if t + dur > 18 * 60 + 30: break
        if rng.random() < 0.88 and pool:
            pt = pool.pop()
            schedule.append({"id": f"a{aid}", "provider": pid, "clinic": clinic, "startMin": t, "duration": dur, "category": cat, "patientId": pt["id"], "state": "booked"})
        else:
            schedule.append({"id": f"a{aid}", "provider": pid, "clinic": clinic, "startMin": t, "duration": dur, "category": cat, "patientId": None, "state": "open"})
        aid += 1
        t += dur + (10 if rng.random() < 0.2 else 0)

json.dump({"clinics": list(CLINICS.values()), "providers": providers, "showcaseProviders": SHOW}, open(OUT / "clinics.json", "w"), indent=1)
json.dump(patients, open(OUT / "patients.json", "w"), separators=(",", ":"))
json.dump(model, open(OUT / "showModel.json", "w"), indent=1)
json.dump({"baseline": baseline, "history": history, "dataRange": [str(real.start_at.min().date()), str(real.start_at.max().date())]}, open(OUT / "history.json", "w"), separators=(",", ":"))
json.dump(schedule, open(OUT / "schedule.json", "w"), indent=1)
print("baseline", baseline)
