"""Run while server.py is running; tests routed HTTP behavior then restores demo."""
import json
from urllib.request import urlopen, Request
from urllib.error import HTTPError
ROOT = 'http://127.0.0.1:8000'

def get(path):
    with urlopen(ROOT + path, timeout=4) as response:
        return response.status, response.read(), response.headers.get('Content-Type')

def post(path, obj):
    with urlopen(Request(ROOT+path,data=json.dumps(obj).encode(),headers={'Content-Type':'application/json'},method='POST'),timeout=4) as response:
        return json.load(response)

try:
    for path in ['/clinic/','/clinic/schedule','/clinic/matching','/clinic/appointments','/clinic/approvals','/patient/','/patient/find','/patient/offers','/patient/appointments','/patient/preferences','/demo/']:
        status, content, mime = get(path)
        assert status == 200 and 'text/html' in mime and b'Doctor Octopus' in content, path
    public=json.loads(get('/api/patient/openings')[1])
    assert public == {'openings': []}, public
    post('/api/demo/reset',{})
    state=json.loads(get('/api/clinic/state')[1]); assert state['slots'][0]['status']=='booked'
    post('/api/clinic/action',{'action':'cancel','slot_id':'S001'})
    public=json.loads(get('/api/patient/openings')[1]); assert len(public['openings'])==1 and set(public['openings'][0]).issubset({'slot_id','clinic_id','provider_id','service_type','visit_type','duration_min','start_at','end_at','status'})
    matches=json.loads(get('/api/clinic/matches/S001')[1]); assert len(matches['eligible']) > 1
    post('/api/clinic/action',{'action':'send','slot_id':'S001'})
    state=json.loads(get('/api/clinic/state')[1]); offer=next(o for o in state['offers'] if o['slot_id']=='S001')
    pv=json.loads(get('/api/patient/state?id='+offer['patient_id'])[1]);
    assert pv['offers'][0]['id']==offer['id']
    assert 'score' not in json.dumps(pv) and 'eligible' not in json.dumps(pv)
    assert len(pv['offers'])==1
    post('/api/patient/action',{'action':'respond','offer_id':offer['id'],'patient_id':offer['patient_id'],'choice':'accept'})
    assert json.loads(get('/api/patient/state?id='+offer['patient_id'])[1])['appointments'][0]['status']=='held'
    post('/api/clinic/action',{'action':'confirm','slot_id':'S001'})
    assert json.loads(get('/api/clinic/state')[1])['slots'][0]['status']=='confirmed'
    assert json.loads(get('/api/patient/state?id='+offer['patient_id'])[1])['appointments'][0]['status']=='confirmed'
    print('PASS: 12 routes + role-separated API + cancellation/offers/hold/confirm')
finally:
    try: post('/api/demo/reset',{})
    except Exception: pass
