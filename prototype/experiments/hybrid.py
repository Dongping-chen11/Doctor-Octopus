"""Synthetic-only ML ranking experiment. No real medical or offer-response records.
Run: python -m experiments.hybrid
Only Python standard library is required.
"""
import csv
import json
import math
import random
import statistics
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from engine import eligibility, load_rows, score

ROOT = Path(__file__).resolve().parent
FEATURES = ('travel_ease','practitioner_match','clinic_match','wait_norm','notice_norm','earlier_benefit')
SEED = 2608


def clamp(x): return max(0.0, min(1.0, float(x)))
def sigmoid(z): return 1.0 / (1.0 + math.exp(-max(-30.0,min(30.0,z))))


def features_for(patient, slot, notice_hours, earlier_benefit):
    return {
        'travel_ease': clamp(1 - int(patient['travel_min']) / 90),
        'practitioner_match': float(patient['preferred_provider_id'] == slot['provider_id']),
        'clinic_match': float(patient['clinic_preference'] == slot['clinic_id']),
        'wait_norm': clamp((datetime.strptime(slot['released_at'][:10],'%Y-%m-%d').date() - datetime.strptime(patient['waitlist_since'],'%Y-%m-%d').date()).days/35),
        'notice_norm': clamp(notice_hours/24),
        'earlier_benefit': clamp(earlier_benefit),
    }


def synthetic_response_probability(x, patient_bias=0):
    """Hidden invented behavior; explicitly NOT fitted to observed patients."""
    z = (-2.4 + 1.7*x['travel_ease'] + 0.9*x['practitioner_match']
         + 0.35*x['clinic_match'] + 0.55*x['wait_norm']
         + 0.8*x['notice_norm'] + 1.1*x['earlier_benefit'] + patient_bias)
    return sigmoid(z)


def generated_examples(patients, slots, per_patient=48, seed=SEED):
    rng = random.Random(seed)
    examples=[]
    for p in patients:
        # Stable fictional person variation not directly passed to the learner.
        bias = rng.gauss(0, 0.24)
        for j in range(per_patient):
            s=slots[rng.randrange(len(slots))]
            notice=rng.uniform(0.5, 48)
            benefit=rng.random()
            x=features_for(p,s,notice,benefit)
            prob=synthetic_response_probability(x,bias)
            y=int(rng.random()<prob)
            examples.append({'patient_id':p['patient_id'],'features':x,'label':y,'hidden_p':prob})
    return examples


@dataclass
class LogisticModel:
    weights: list
    def predict(self,x):
        z=self.weights[0]+sum(w*x[name] for w,name in zip(self.weights[1:],FEATURES))
        return sigmoid(z)
    def to_dict(self):
        return {'intercept':self.weights[0],'coefficients':dict(zip(FEATURES,self.weights[1:])), 'warning':'Synthetic training labels; not real patient acceptance probabilities'}


def fit_logistic(rows, epochs=700, lr=0.6, l2=0.02):
    w=[0.0]*(len(FEATURES)+1)
    n=len(rows)
    for _ in range(epochs):
        grad=[0.0]*len(w)
        for row in rows:
            xs=[1]+[row['features'][f] for f in FEATURES]
            error=sigmoid(sum(a*b for a,b in zip(w,xs)))-row['label']
            for k,v in enumerate(xs): grad[k]+=error*v
        for k in range(len(w)):
            regularizer=0 if k==0 else l2*w[k]
            w[k]-=lr*(grad[k]/n+regularizer)
    return LogisticModel(w)


def brier(model,rows): return sum((model.predict(r['features'])-r['label'])**2 for r in rows)/len(rows)
def logloss(model,rows):
    return -sum(r['label']*math.log(max(1e-8,model.predict(r['features'])))+(1-r['label'])*math.log(max(1e-8,1-model.predict(r['features']))) for r in rows)/len(rows)


def train_patient_split(examples,seed=SEED):
    ids=sorted({r['patient_id'] for r in examples})
    rng=random.Random(seed); rng.shuffle(ids)
    cutoff=max(1,int(len(ids)*.7)); train_ids=set(ids[:cutoff])
    return ([r for r in examples if r['patient_id'] in train_ids],
            [r for r in examples if r['patient_id'] not in train_ids],train_ids)


def rank_candidates(items, approach):
    """Each item includes patient, hard-eligible slot, normalized rule score and ML estimate."""
    def value(row):
        if approach=='waitlist_first': return row['wait']
        if approach=='rules': return row['rules']
        if approach=='ml_only': return row['predicted_accept']
        if approach=='hybrid':
            # Illustrative benefit/fairness blend, not a clinical priority score.
            return .55*row['predicted_accept'] + .30*row['rules'] + .15*row['wait']
        raise ValueError(approach)
    return sorted(items, key=lambda r:(-value(r),r['patient_id']))


def evaluate_policy(model,patients,slots,seed=SEED+1,scenarios=400):
    rng=random.Random(seed)
    result={k:{'fills':0,'offers':0,'sum_wait_selected':0.0,'selected_count':0,'first_choice_fills':0} for k in ('waitlist_first','rules','ml_only','hybrid')}
    valid={s['slot_id']:[p for p in patients if not eligibility(p,s)] for s in slots}
    # Fixed candidates and independent simulated outcomes are reused across policies.
    used=0
    for i in range(scenarios):
        slot=slots[i%len(slots)]; pool=valid[slot['slot_id']]
        if len(pool)<2: continue
        used+=1
        notice=rng.uniform(.5,30)
        choices=[]
        for p in pool:
            benefit=rng.random()
            x=features_for(p,slot,notice,benefit)
            rule_value=score(p,slot)[0]/100
            wait=x['wait_norm']
            truth=synthetic_response_probability(x)
            outcome=rng.random()<truth
            choices.append({'patient_id':p['patient_id'],'rules':rule_value,'wait':wait,'predicted_accept':model.predict(x),'would_accept':outcome})
        for policy,stat in result.items():
            top=rank_candidates(choices,policy)[:3]
            stat['fills']+=int(any(r['would_accept'] for r in top))
            stat['first_choice_fills']+=int(top[0]['would_accept'])
            stat['offers']+=len(top)
            stat['sum_wait_selected']+=sum(r['wait'] for r in top)
            stat['selected_count']+=len(top)
    out={k:{'fill_rate':round(v['fills']/used,3),'filled':v['fills'],'first_choice_fill_rate':round(v['first_choice_fills']/used,3),'first_choice_fills':v['first_choice_fills'],'scenarios':used,'avg_offers_sent':round(v['offers']/used,2),'avg_wait_norm_offered':round(v['sum_wait_selected']/v['selected_count'],3)} for k,v in result.items()}
    return out,valid


def build_report(output_dir=None):
    output_dir=Path(output_dir or ROOT/'results');output_dir.mkdir(exist_ok=True,parents=True)
    patients=load_rows('patients.csv');slots=load_rows('slots.csv')
    events=generated_examples(patients,slots)
    train,test,train_ids=train_patient_split(events)
    model=fit_logistic(train)
    metrics={'dataset':'ENTIRELY SYNTHETIC simulated offer responses (NOT Rosemi clinical patient records)',
             'training_offer_events':len(train),'test_offer_events':len(test),
             'training_patient_ids':len(train_ids),'test_patient_ids':len({e['patient_id'] for e in test}),
             'test_brier':round(brier(model,test),4), 'test_log_loss':round(logloss(model,test),4),
             'test_majority_baseline_brier':round(sum((sum(r['label'] for r in train)/len(train)-r['label'])**2 for r in test)/len(test),4)}
    outcomes,valid=evaluate_policy(model,patients,slots)
    report={'model_metrics':metrics,'comparison':outcomes,'model':model.to_dict(),
            'method':'400 seeded fictional hypothetical offers across five slots; only slots with >=2 eligible patients are compared, with identical candidate outcomes for each policy; top 3 offered once; no real-world outcome claims.',
            'cautions':['Show-up model deliberately excluded','Acceptance responses are generated from invented probabilities','Observed performance is only performance against that synthetic generator','Independence and fairness are not validated','Original booking workflow is unchanged']}
    (output_dir/'experiment_results.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    with (output_dir/'comparison.csv').open('w',newline='',encoding='utf8') as f:
        writer=csv.writer(f);writer.writerow(['policy','simulated_fill_rate','simulated_fills','scenarios','offers_per_opening','mean_wait_priority_of_offered','first_choice_fill_rate'])
        for k,v in outcomes.items():writer.writerow([k,v['fill_rate'],v['filled'],v['scenarios'],v['avg_offers_sent'],v['avg_wait_norm_offered'],v['first_choice_fill_rate']])
    (output_dir/'model_coefficients.json').write_text(json.dumps(model.to_dict(),indent=2),encoding='utf8')
    rows=''.join(f"<tr><td>{k.replace('_',' ').title()}</td><td>{v['filled']} / {v['scenarios']}</td><td>{v['fill_rate']*100:.1f}%</td><td>{v['first_choice_fill_rate']*100:.1f}%</td><td>{v['avg_wait_norm_offered']:.3f}</td></tr>" for k,v in outcomes.items())
    (output_dir/'report.html').write_text(f"""<!doctype html><html lang="en"><meta charset="utf-8"><title>Doctor Octopus experimental ranking comparison</title><style>body{{font:16px system-ui;max-width:950px;margin:45px auto;padding:0 22px;color:#213541}}h1{{color:#0a7864}}.warn{{padding:14px;border-left:5px solid #d18b19;background:#fff8eb}}table{{border-collapse:collapse;width:100%}}td,th{{border-bottom:1px solid #ccd7db;padding:14px;text-align:left}}.stat{{display:inline-block;padding:15px;background:#eff7f5;border-radius:10px;margin:8px}}</style><h1>Doctor Octopus · Ranking experiment</h1><p class="warn"><strong>SIMULATION ONLY.</strong> No real offer-response labels are available. The model learns from invented synthetic responses, so these are not real acceptance probabilities or validated clinic results.</p><h2>Three approaches + a waiting-list baseline</h2><p>All policies see the <b>same hard-eligible fictional candidates and the same predetermined fictional responses</b> in each scenario. Each offers to the top 3 only.</p><table><tr><th>Ranking policy</th><th>Simulated filled scenarios</th><th>Top-3 fill rate</th><th>First-choice fill rate</th><th>Average wait priority offered (0–1)</th></tr>{rows}</table><h2>Held-out synthetic acceptance prediction</h2><div class="stat">Training events: {len(train)}</div><div class="stat">Test events: {len(test)}</div><div class="stat">Brier error: {metrics['test_brier']}</div><div class="stat">Constant-model Brier: {metrics['test_majority_baseline_brier']}</div><p>The split holds out whole fictional patient IDs, rather than randomly dividing responses from the same patient across train and test.</p><h2>How to read this</h2><p>Because most slots have 1–3 eligible people, top-three outcomes may be identical for every policy. First-choice success is a more sensitive ranking diagnostic here. A higher simulated fill rate means more successful top-three selections <em>under the assumptions baked into the simulation</em>. It does not establish better performance in a clinic. Real acceptance labels, prospective testing, and stakeholder review would be needed.</p><p>The app's production-like demo is deliberately left on its established rules-based ranker. This is a separate evaluation artifact.</p></html>""",encoding='utf8')
    return report


if __name__=='__main__':
    r=build_report()
    print(json.dumps({'model_metrics':r['model_metrics'],'comparison':r['comparison']},indent=2))
    print('Open experiments/results/report.html in your browser (no server required).')
