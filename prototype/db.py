"""SQLite repository for a fully synthetic two-clinic demo. No source patient rows."""
import csv, json, sqlite3
from pathlib import Path
ROOT=Path(__file__).resolve().parent
PATH=ROOT/'data'/'doctor_octopus_demo.sqlite3'
SCHEMA="""
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS clinics(id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS practitioners(id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id), display_name TEXT NOT NULL, service_type TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS patients(id TEXT PRIMARY KEY, display_name TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clinic_patients(clinic_id TEXT NOT NULL REFERENCES clinics(id), patient_id TEXT NOT NULL REFERENCES patients(id), PRIMARY KEY(clinic_id, patient_id));
CREATE TABLE IF NOT EXISTS appointment_requests(id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), service_type TEXT NOT NULL, active INTEGER NOT NULL, opted_in INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS appointments(id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id), practitioner_id TEXT NOT NULL REFERENCES practitioners(id), patient_id TEXT REFERENCES patients(id), payload TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS offers(id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id), patient_id TEXT NOT NULL REFERENCES patients(id), status TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS historical_demo_appointments(id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id), practitioner_id TEXT NOT NULL REFERENCES practitioners(id), patient_id TEXT NOT NULL REFERENCES patients(id), service_type TEXT NOT NULL, starts_at TEXT NOT NULL, duration_min INTEGER NOT NULL, state TEXT NOT NULL);
"""
PROVIDERS={'REV-PHY-01':('REVIVE','Dr. Elena Park','physiotherapy'),'REV-PHY-02':('REVIVE','Dr. Oliver Reed','physiotherapy'),'BET-MAS-01':('BETHESDA','Maya Williams, RMT','massage'),'BET-PHY-01':('BETHESDA','Dr. Daniel Kim','physiotherapy'),'REV-MAS-01':('REVIVE','Sofia Brooks, RMT','massage'),'REV-CHI-01':('REVIVE','Dr. Priya Shah','chiropractic'),'BET-ACU-01':('BETHESDA','Mei Chen, R.Ac.','acupuncture')}

def connect():
    c=sqlite3.connect(PATH, timeout=10)
    c.row_factory=sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    return c

def init(force=False):
    PATH.parent.mkdir(parents=True, exist_ok=True)
    if force and PATH.exists():PATH.unlink()
    with connect() as c:
        c.executescript(SCHEMA)
        if c.execute('SELECT COUNT(*) FROM patients').fetchone()[0]: return
        c.executemany('INSERT INTO clinics VALUES(?,?,?)',[('REVIVE','Revive Rehab','Edmonton'),('BETHESDA','Bethesda Health & Wellness','Edmonton')])
        c.executemany('INSERT INTO practitioners VALUES(?,?,?,?)',[(k,*v) for k,v in PROVIDERS.items()])
        with (ROOT/'data'/'patients.csv').open(newline='',encoding='utf-8') as f:patients=list(csv.DictReader(f))
        with (ROOT/'data'/'slots.csv').open(newline='',encoding='utf-8') as f:slots=list(csv.DictReader(f))
        for p in patients:
            c.execute('INSERT INTO patients VALUES(?,?,?)',(p['patient_id'],p['display_name'],json.dumps(p)))
            c.execute('INSERT INTO clinic_patients VALUES(?,?)',(p['home_clinic_id'],p['patient_id']))
            c.execute('INSERT INTO appointment_requests VALUES(?,?,?,?,?)',(p['request_id'],p['patient_id'],p['service_type'],int(p['active_request']=='True'),int(p['opt_in']=='True')))
        for s in slots:
            if s['provider_id'] not in PROVIDERS:
                c.execute('INSERT INTO practitioners VALUES(?,?,?,?)',(s['provider_id'],s['clinic_id'],'Demo practitioner '+s['provider_id'],s['service_type']))
            initial={**s,'status':'booked','winner':'ORIGINAL-'+s['slot_id'],'original_patient':'ORIGINAL-'+s['slot_id']}
            c.execute('INSERT INTO appointments VALUES(?,?,?,?,?,?)',(s['slot_id'],s['clinic_id'],s['provider_id'],None,json.dumps(initial),'booked'))
        # Fictional extra appointment HISTORY for demo database exploration only.
        # Never derived row-by-row from source; reproducible and not automatically matchable.
        import random, datetime
        rng=random.Random(2026)
        states=['completed','completed','completed','cancelled','rescheduled','no_show']
        keys=list(PROVIDERS)
        for i in range(160):
            practitioner=keys[i%len(keys)]
            clinic,_,service=PROVIDERS[practitioner]
            pid=patients[(i*7+3)%len(patients)]['patient_id']
            day=datetime.datetime(2026,10,1)+datetime.timedelta(days=i%36,hours=9+(i*3)%8)
            c.execute('INSERT INTO historical_demo_appointments VALUES(?,?,?,?,?,?,?,?)',('H%04d'%i,clinic,practitioner,pid,service,day.strftime('%Y-%m-%d %H:%M'),[30,45,60][i%3],states[rng.randrange(len(states))]))
        c.execute('INSERT INTO events(description) VALUES(?)',('Seeded two-clinic synthetic demo database (250 patients each)',))

def load_patients():
    init()
    with connect() as c:return [json.loads(r['payload']) for r in c.execute('SELECT payload FROM patients ORDER BY id')]

def load_slots():
    init()
    with connect() as c:return [json.loads(r['payload']) for r in c.execute('SELECT payload FROM appointments ORDER BY id')]

def load_runtime():
    with connect() as c:
        appointments={r['id']:json.loads(r['payload']) for r in c.execute('SELECT id,payload FROM appointments')}
        offers={r['id']:json.loads(r['payload']) for r in c.execute('SELECT id,payload FROM offers')}
        events=[r['description'] for r in c.execute('SELECT description FROM events ORDER BY seq')]
    return appointments,offers,events

def save_runtime(slots,offers,events):
    with connect() as c:
        for s in slots.values():
            pid=s.get('winner')
            if pid and pid.startswith('ORIGINAL-'):pid=None
            c.execute('UPDATE appointments SET status=?, patient_id=?, payload=? WHERE id=?',(s['status'],pid,json.dumps(s),s['slot_id']))
        c.execute('DELETE FROM offers')
        for o in offers.values():
            c.execute('INSERT INTO offers VALUES(?,?,?,?,?)',(o['id'],o['slot_id'],o['patient_id'],o['state'],json.dumps(o)))
        c.execute('DELETE FROM events')
        c.executemany('INSERT INTO events(description) VALUES(?)',[(str(e),) for e in events])

def reset_runtime():
    with (ROOT/'data'/'slots.csv').open(newline='',encoding='utf8') as f:slots=list(csv.DictReader(f))
    initial={s['slot_id']:{**s,'status':'booked','winner':'ORIGINAL-'+s['slot_id'],'original_patient':'ORIGINAL-'+s['slot_id']} for s in slots}
    save_runtime(initial,{},['Reset: all synthetic appointments start booked.'])
    return initial
