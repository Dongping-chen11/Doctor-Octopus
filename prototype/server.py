"""Doctor Octopus v0.8 - local synthetic demo, Python standard library only.

Not suitable for real patient information or internet-facing deployment.
Role-specific JSON payloads demonstrate data minimization; persona IDs do not authenticate.
"""
import json
from datetime import datetime, timedelta
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from engine import match
from db import init as init_database, load_patients, load_slots, load_runtime, save_runtime, reset_runtime

ROOT = Path(__file__).resolve().parent
init_database()
PATIENTS = load_patients()
SLOTS = load_slots()
PATIENT_BY_ID = {p['patient_id']: p for p in PATIENTS}
LOCK = threading.RLock()
CLINIC_NAMES = {'REVIVE': 'Revive Rehab', 'BETHESDA': 'Bethesda Health & Wellness'}


def slot_public(s):
    """Only details relevant to a patient's own offer or appointment."""
    return {k: s[k] for k in ('slot_id', 'clinic_id', 'provider_id', 'service_type',
                              'visit_type', 'duration_min', 'start_at', 'end_at', 'status')}


class Demo:
    def __init__(self):
        self.reset()

    def reset(self):
        self.slots = {s['slot_id']: {**s, 'status': 'booked',
                     'winner': 'ORIGINAL-' + s['slot_id'],
                     'original_patient': 'ORIGINAL-' + s['slot_id'], 'simulation_now': s['released_at'], 'wave': 0} for s in SLOTS}
        self.offers = {}
        self.events = ['Reset: all fictional appointments start booked.']

    def now(self, slot):
        return datetime.strptime(slot.get('simulation_now') or slot['released_at'], '%Y-%m-%d %H:%M')

    def advance(self, slot_id, minutes):
        """Move one opening's fictional clock forward; process offer expiry deterministically."""
        slot=self.slots.get(slot_id)
        if not slot or slot['status'] not in ('open','offering','held','confirmed'):
            raise ValueError('No active recovery case')
        if not isinstance(minutes,int) or not 1 <= minutes <= 240:
            raise ValueError('Advance must be 1-240 minutes')
        slot['simulation_now']=(self.now(slot)+timedelta(minutes=minutes)).strftime('%Y-%m-%d %H:%M')
        self.process_expiry(slot_id)
        self.log(f"{slot_id}: demo clock advanced {minutes} min to {slot['simulation_now']}")

    def process_expiry(self, slot_id):
        slot=self.slots[slot_id]
        current=self.now(slot)
        expired=[]
        for o in self.offers.values():
            if o['slot_id']==slot_id and o['state']=='offered' and o.get('expires_at') and current>=datetime.strptime(o['expires_at'],'%Y-%m-%d %H:%M'):
                o['state']='expired'
                expired.append(o['id'])
        if expired:
            self.log(f"{slot_id}: expired {', '.join(expired)}")
        if slot['status']=='offering' and not any(o['slot_id']==slot_id and o['state']=='offered' for o in self.offers.values()):
            slot['status']='open'
            self.send(slot_id)

    def log(self, msg):
        self.events.append(msg)

    def clinic_state(self, clinic_id=None):
        """Clinic data: scheduling and offers for authorized staff in a real system."""
        if clinic_id is not None and clinic_id not in CLINIC_NAMES:
            raise ValueError('Unknown clinic')
        slots = [s for s in self.slots.values() if clinic_id is None or s['clinic_id'] == clinic_id]
        slot_ids = {s['slot_id'] for s in slots}
        offers = [o for o in self.offers.values() if o['slot_id'] in slot_ids]
        scoped_people = {p['patient_id'] for p in PATIENTS if clinic_id is None or p.get('home_clinic_id') == clinic_id}
        scoped_people.update(o['patient_id'] for o in offers)
        return {'selected_clinic':clinic_id, 'clinics': [{'id':k,'name':v} for k,v in CLINIC_NAMES.items()],
                'patients_at_clinic':sum(p.get('home_clinic_id')==clinic_id for p in PATIENTS) if clinic_id else len(PATIENTS),
                'slots': slots, 'offers': offers,
                'patient_names': {p['patient_id']:p['display_name'] for p in PATIENTS if p['patient_id'] in scoped_people},
                'stats': {'booked': sum(s['status'] == 'booked' for s in slots),
                          'open': sum(s['status'] in ('open', 'offering') for s in slots),
                          'held': sum(s['status'] == 'held' for s in slots),
                          'confirmed': sum(s['status'] == 'confirmed' for s in slots)},
                'clinic_names': CLINIC_NAMES}

    def patient_state(self, patient_id):
        patient = PATIENT_BY_ID.get(patient_id)
        if patient is None:
            raise ValueError('Unknown patient persona')
        # Never return match scores, candidate lists, other patients, or clinic event logs.
        visible = ('patient_id', 'display_name', 'service_type', 'visit_type', 'required_duration_min',
                   'clinic_preference', 'preferred_provider_id', 'provider_required',
                   'active_request', 'opt_in', 'available_start', 'available_end',
                   'travel_min')
        offers = []
        for o in self.offers.values():
            if o['patient_id'] == patient_id:
                offers.append({'id': o['id'], 'state': o['state'],
                               'slot': slot_public(self.slots[o['slot_id']]),
                               'expires_at': o.get('expires_at'), 'simulation_now': self.slots[o['slot_id']].get('simulation_now')})
        appointments = [slot_public(s) for s in self.slots.values()
                        if s['winner'] == patient_id and s['status'] in ('held', 'confirmed')]
        return {'patient': {k: patient[k] for k in visible},
                'offers': offers, 'appointments': appointments,
                'clinic_names': CLINIC_NAMES}

    def candidates(self, slot_id):
        if slot_id not in self.slots:
            raise ValueError('Unknown appointment')
        if self.slots[slot_id]['status'] not in ('open', 'offering'):
            return {'eligible': [], 'excluded': [], 'message': 'Cancel the appointment to create an opening.'}
        window={**self.slots[slot_id], 'released_at':self.slots[slot_id].get('simulation_now',self.slots[slot_id]['released_at'])}
        matches=match(window, PATIENTS)
        for p in matches['eligible'] + matches['excluded']:
            p['display_name']=PATIENT_BY_ID[p['patient_id']]['display_name']
        return matches

    def cancel(self, slot_id):
        slot = self.slots.get(slot_id)
        if not slot:
            raise ValueError('Unknown appointment')
        if slot['status'] != 'booked':
            raise ValueError('Only initially booked appointments can be cancelled in this demo')
        slot['status'] = 'open'
        slot['simulation_now'] = slot['released_at']  # deterministic demo time, not wall-clock
        slot['wave'] = 0
        slot['released_from_cancellation'] = True
        slot['winner'] = None
        self.log(f'{slot_id}: original appointment cancelled; opening created')
        self.log(f"{slot_id}: {len(self.candidates(slot_id)['eligible'])} eligible candidates")

    def send(self, slot_id):
        """Top-three wave. Expiring/declined waves move to the next ranked candidates."""
        slot=self.slots.get(slot_id)
        if not slot or slot['status'] not in ('open','offering'):
            raise ValueError('Opening unavailable')
        if any(o['slot_id']==slot_id and o['state']=='offered' for o in self.offers.values()):
            raise ValueError('An offer wave is still active; decline or advance its demo clock')
        current=self.now(slot)
        options=self.candidates(slot_id)['eligible']
        already={o['patient_id'] for o in self.offers.values() if o['slot_id']==slot_id}
        selected=[p for p in options if p['patient_id'] not in already][:3]
        if not selected:
            slot['status']='open'
            self.log(f'{slot_id}: no more eligible patients; opening remains unfilled')
            return
        # Each offer gets at most 20 minutes and must end before the patient cannot travel to the opening.
        slot['status']='offering'
        slot['wave']=int(slot.get('wave',0))+1
        for candidate in selected:
            person=PATIENT_BY_ID[candidate['patient_id']]
            travel=int(person['travel_min'])+int(person.get('travel_buffer_minutes') or 5)
            start=datetime.strptime(slot['start_at'],'%Y-%m-%d %H:%M')
            deadline=min(current+timedelta(minutes=20), start-timedelta(minutes=travel+5))
            if deadline<=current:
                continue
            oid=f'O{len(self.offers)+1:04}'
            self.offers[oid]={'id':oid,'slot_id':slot_id,'patient_id':candidate['patient_id'],
                'state':'offered','score':candidate['score'],'wave':slot['wave'],
                'sent_at':current.strftime('%Y-%m-%d %H:%M'),
                'expires_at':deadline.strftime('%Y-%m-%d %H:%M')}
        if not any(o['slot_id']==slot_id and o['state']=='offered' for o in self.offers.values()):
            slot['status']='open'
            self.log(f'{slot_id}: no candidate can respond and travel in time')
        else:
            self.log(f"{slot_id}: wave {slot['wave']} sent, 20-min maximum reply window")

    def respond(self, oid, choice, acting_patient_id):
        offer = self.offers.get(oid)
        if not offer or offer['patient_id'] != acting_patient_id:
            raise ValueError('Offer not found for selected patient')
        self.process_expiry(offer['slot_id'])
        if offer['state'] != 'offered':
            raise ValueError('Offer is no longer available')
        slot = self.slots[offer['slot_id']]
        if choice == 'decline':
            offer['state'] = 'declined'
            self.log(f"{oid}: {acting_patient_id} declined")
            self.process_expiry(offer['slot_id'])
            return
        if choice != 'accept':
            raise ValueError('Invalid response')
        if slot['status'] != 'offering':
            raise ValueError('Appointment has already been claimed')
        valid = {p['patient_id'] for p in self.candidates(offer['slot_id'])['eligible']}
        if acting_patient_id not in valid:
            raise ValueError('Patient no longer eligible')
        slot['status'] = 'held'
        slot['winner'] = acting_patient_id
        offer['state'] = 'held'
        for other in self.offers.values():
            if other['slot_id'] == offer['slot_id'] and other['state'] == 'offered':
                other['state'] = 'superseded'
        self.log(f'{oid}: held for {acting_patient_id}; other offers withdrawn')

    def confirm(self, slot_id):
        slot = self.slots.get(slot_id)
        if not slot or slot['status'] != 'held':
            raise ValueError('No held appointment to confirm')
        slot['status'] = 'confirmed'
        for offer in self.offers.values():
            if offer['slot_id'] == slot_id and offer['state'] == 'held':
                offer['state'] = 'confirmed'
        self.log(f"{slot_id}: confirmed for {slot['winner']}")


DEMO = Demo()
DEMO.slots, DEMO.offers, DEMO.events = load_runtime()
if not DEMO.slots:
    DEMO.reset()
    save_runtime(DEMO.slots, DEMO.offers, DEMO.events)



class Handler(BaseHTTPRequestHandler):
    def output(self, status, payload):
        blob = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(blob)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(blob)

    def html(self, filename):
        blob = (ROOT / 'static' / filename).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(blob)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(blob)

    def asset(self, filename, mime):
        blob = (ROOT / 'static' / filename).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(blob)))
        self.end_headers()
        self.wfile.write(blob)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == '/':
            self.send_response(302)
            self.send_header('Location', '/clinic/')
            self.end_headers()
            return
        if path in ('/clinic', '/clinic/', '/clinic/schedule', '/clinic/matching', '/clinic/appointments', '/clinic/approvals'):
            return self.html('clinic.html')
        if path in ('/patient', '/patient/', '/patient/offers', '/patient/appointments', '/patient/preferences', '/patient/find'):
            return self.html('patient.html')
        if path in ('/demo', '/demo/'):
            return self.html('demo.html')
        if path == '/static/styles.css':
            return self.asset('styles.css', 'text/css; charset=utf-8')
        if path == '/static/clinic.js':
            return self.asset('clinic.js', 'text/javascript; charset=utf-8')
        if path == '/static/patient.js':
            return self.asset('patient.js', 'text/javascript; charset=utf-8')
        if path == '/static/demo.js':
            return self.asset('demo.js', 'text/javascript; charset=utf-8')
        if path == '/api/demo/personas':
            # Fictional IDs are a developer-only persona picker, NOT authentication.
            return self.output(200, {'patient_ids': list(PATIENT_BY_ID), 'patient_names': {k:v['display_name'] for k,v in PATIENT_BY_ID.items()}})
        with LOCK:
            if path == '/api/clinic/state':
                clinic_id = parse_qs(parsed.query).get('clinic', [None])[0]
                try:
                    return self.output(200, DEMO.clinic_state(clinic_id))
                except ValueError as e:
                    return self.output(400, {'error': str(e)})
            if path.startswith('/api/clinic/matches/'):
                try:
                    slot_id=path.rsplit('/',1)[-1]
                    requested_clinic=parse_qs(parsed.query).get('clinic',[None])[0]
                    if requested_clinic is not None and (requested_clinic not in CLINIC_NAMES or DEMO.slots.get(slot_id,{}).get('clinic_id') != requested_clinic):
                        raise ValueError('Appointment not part of selected clinic')
                    return self.output(200, DEMO.candidates(slot_id))
                except ValueError as e:
                    return self.output(400, {'error': str(e)})
            if path == '/api/patient/state':
                patient_id = parse_qs(parsed.query).get('id', [''])[0]
                try:
                    return self.output(200, DEMO.patient_state(patient_id))
                except ValueError as e:
                    return self.output(404, {'error': str(e)})
            if path == '/api/patient/openings':
                return self.output(200, {'openings': [slot_public(s) for s in DEMO.slots.values() if s['status'] in ('open', 'offering')]})
            if path == '/api/demo/events':
                return self.output(200, {'events': list(DEMO.events[-100:])})
        return self.output(404, {'error': 'Not found'})

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ('/api/clinic/action', '/api/patient/action', '/api/demo/reset'):
            return self.output(404, {'error': 'Not found'})
        try:
            n = int(self.headers.get('Content-Length', '0'))
            if n < 0 or n > 10000:
                return self.output(413, {'error': 'Invalid request length'})
            body = json.loads(self.rfile.read(n)) if n else {}
            if not isinstance(body, dict):
                raise ValueError('Expected JSON object')
            with LOCK:
                if path == '/api/demo/reset':
                    DEMO.reset()
                    result = {'message': 'Demo reset'}
                elif path == '/api/clinic/action':
                    a = body.get('action')
                    claimed_clinic=body.get('clinic_id')
                    if claimed_clinic is not None and (claimed_clinic not in CLINIC_NAMES or DEMO.slots.get(body.get('slot_id'),{}).get('clinic_id') != claimed_clinic):
                        raise ValueError('Appointment not part of selected clinic')
                    if a == 'cancel':
                        DEMO.cancel(body['slot_id'])
                    elif a == 'send':
                        DEMO.send(body['slot_id'])
                    elif a == 'confirm':
                        DEMO.confirm(body['slot_id'])
                    elif a == 'advance':
                        DEMO.advance(body['slot_id'], body['minutes'])
                    else:
                        raise ValueError('Unknown clinic action')
                    result = {'message': f'Clinic action {a} completed'}
                else:
                    if body.get('action') != 'respond':
                        raise ValueError('Unknown patient action')
                    DEMO.respond(body['offer_id'], body['choice'], body['patient_id'])
                    result = {'message': 'Patient response saved'}
                save_runtime(DEMO.slots, DEMO.offers, DEMO.events)
                return self.output(200, result)
        except (KeyError, ValueError, TypeError) as e:
            return self.output(400, {'error': str(e)})

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8000), Handler)
    print('Doctor Octopus v0.9 SQLite running at http://127.0.0.1:8000/clinic/', flush=True)
    print('Patient portal: http://127.0.0.1:8000/patient/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped normally.')
    finally:
        server.server_close()
