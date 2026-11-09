import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from experiments.hybrid import (FEATURES, build_report, evaluate_policy, features_for,
  fit_logistic, generated_examples, rank_candidates, train_patient_split, synthetic_response_probability)
from engine import load_rows, eligibility

class HybridExperimentTests(unittest.TestCase):
    def setUp(self):
        self.patients=load_rows('patients.csv');self.slots=load_rows('slots.csv')
    def test_split_has_no_patient_leakage(self):
        train,test,ids=train_patient_split(generated_examples(self.patients,self.slots,2))
        self.assertTrue(train and test)
        self.assertFalse(ids & {r['patient_id'] for r in test})
    def test_model_probability_in_range(self):
        train,_,_=train_patient_split(generated_examples(self.patients,self.slots,2))
        model=fit_logistic(train,epochs=20)
        self.assertGreater(model.predict(train[0]['features']),0)
        self.assertLess(model.predict(train[0]['features']),1)
    def test_label_probabilities_are_synthetic(self):
        x=features_for(self.patients[0],self.slots[0],1,0.5)
        self.assertEqual(set(x),set(FEATURES))
        self.assertTrue(0<synthetic_response_probability(x)<1)
    def test_hard_ineligible_never_enters_simulation_pool(self):
        train,_,_=train_patient_split(generated_examples(self.patients,self.slots,2))
        model=fit_logistic(train,epochs=20)
        _,valid=evaluate_policy(model,self.patients,self.slots,scenarios=12)
        for s in self.slots:
            self.assertTrue(all(not eligibility(p,s) for p in valid[s['slot_id']]))
    def test_ranker_respects_wait_priority(self):
        rows=[dict(patient_id='a',wait=.1,rules=.9,predicted_accept=.9),dict(patient_id='b',wait=.9,rules=.1,predicted_accept=.1)]
        self.assertEqual(rank_candidates(rows,'waitlist_first')[0]['patient_id'],'b')
    def test_seeded_results_reproduce(self):
        examples=generated_examples(self.patients,self.slots,3)
        self.assertEqual(examples,generated_examples(self.patients,self.slots,3))

if __name__=='__main__':unittest.main()
