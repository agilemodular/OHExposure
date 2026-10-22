#!/usr/bin/env python3
"""Builds test/fixtures/worked-examples.fixtures.json: structured regression fixtures for engine 1.5.0.

INDEPENDENCE: expected numeric values are derived here, in Python, from the documented formulas (EH40/2005 4th ed.
2020, Schedule paras 2 and 8 and para 68; the calculation specification), not by calling the TypeScript engine under
test. Expected statuses and flags are written by hand from the specification's decision table. The engine is only run
by the test (test/worked-examples.test.ts), which compares its output with these fixtures.

Run: python3 scripts/tr/build_fixtures.py
"""
import copy, json, math, os
from datetime import datetime

MOLAR_VOLUME = 24.05526  # L/mol, EH40 para 68 (20 degC, 1 atm)
REL_TOL = 1e-9           # numeric comparison tolerance used by the fixtures test
ENGINE = {'engine': '1.5.0', 'twa_8h': '1.4.0', 'stel_15': '1.3.0'}

METHOD = {'code': 'M', 'version': '1', 'resultBasis': 'mass_on_sample', 'flowDriftTolerancePct': 5, 'minVolumeL': None, 'suitableForFormalAssessment': True}
INST = {'assetTag': 'P1', 'screeningOnly': False, 'calibrationValidAtSampling': True}
JUST = 'Worker in office with no process access for the rest of the shift.'


def sample(**o):
    s = {'sampleId': o.get('sampleCode', 'S'), 'sampleCode': 'S', 'sampleType': 'personal', 'subjectRef': 'W1',
         'startAt': '2026-03-02T08:00:00Z', 'endAt': '2026-03-02T16:00:00Z', 'timezone': 'UTC', 'interruptions': [],
         'flowPreLpm': 2, 'flowPostLpm': 2, 'method': copy.deepcopy(METHOD), 'instrument': copy.deepcopy(INST), 'qc': [],
         'result': {'revision': 1, 'value': 300, 'unit': 'ug', 'qualifier': '=', 'lod': 10, 'loq': 30}}
    s.update(o)
    if 'sampleCode' in o: s['sampleId'] = o['sampleCode']
    return s


def res(value, qualifier='=', lod=10, loq=30, unit='ug'):
    return {'revision': 1, 'value': value, 'unit': unit, 'qualifier': qualifier, 'lod': lod, 'loq': loq}


def bm(value, avg=480, unit='mg/m3'):
    return {'versionId': 'b', 'type': 'EXAMPLE', 'averagingMinutes': avg, 'value': value, 'unit': unit, 'verificationStatus': 'verified', 'isSynthetic': True, 'source': 'synthetic example'}


P = {'exposureMinutesPerShift': 480, 'unsampledAssumption': 'none'}
STEL_P = {'exposureMinutesPerShift': None, 'unsampledAssumption': 'none'}

# ── Independent oracle ────────────────────────────────────────────────────────────────────────────────────────

def minutes(a, b):
    f = lambda x: datetime.fromisoformat(x.replace('Z', '+00:00'))
    return (f(b) - f(a)).total_seconds() / 60


def sampled_minutes(s):
    total = minutes(s['startAt'], s['endAt'])
    spans = sorted((max(0, minutes(s['startAt'], i['start'])), min(total, minutes(s['startAt'], i['end']))) for i in s['interruptions'])
    paused, a, b = 0.0, None, None
    for x, y in spans:
        if y <= x: continue
        if a is None or x > b:
            if a is not None: paused += b - a
            a, b = x, y
        else: b = max(b, y)
    if a is not None: paused += b - a
    return total - paused, total


def concentration(s):
    """mg/m3 interval from mass on sample: C = m / V, V = mean flow (L/min) × sampled time (min) / 1000."""
    r = s['result']
    t, _ = sampled_minutes(s)
    if r['unit'] in ('mg/m3', 'ug/m3'):  # direct concentration result
        k = 1 if r['unit'] == 'mg/m3' else 1 / 1000
        return {'lower': r['value'] * k, 'upper': r['value'] * k, 'sampledMinutes': t, 'volumeL': None}
    v_m3 = (s['flowPreLpm'] + s['flowPostLpm']) / 2 * t / 1000
    to_mg = 1 / 1000 if r['unit'] == 'ug' else 1
    q = r['qualifier']
    if q in ('=', 'estimated'): lo = hi = r['value']
    # A reported '<' value and a stated limit both bound the result; the larger is the conservative upper bound (R4 N1).
    elif q == '<LOD': lo, hi = 0, max(x for x in (r['value'], r['lod']) if x is not None)
    elif q == '<LOQ': lo, hi = 0, max(x for x in (r['value'], r['loq']) if x is not None)
    elif q == 'detected_below_loq': lo, hi = r['lod'], r['loq']
    elif q == '>': lo, hi = r['value'], math.inf
    return {'lower': lo * to_mg / v_m3, 'upper': hi * to_mg / v_m3 if hi != math.inf else 'Infinity', 'sampledMinutes': t, 'volumeL': v_m3 * 1000}


def twa(samples, exposure, assumption='none'):
    """EH40 Schedule para 2: TWA = Σ(Ci·Ti)/480 min; unsampled time per the stated assumption."""
    c = [concentration(s) for s in samples]
    lo = sum(x['lower'] * x['sampledMinutes'] for x in c)
    hi = sum(x['upper'] * x['sampledMinutes'] for x in c)
    t = sum(x['sampledMinutes'] for x in c)
    if assumption == 'same_as_sampled':
        lo += lo / t * (exposure - t); hi += hi / t * (exposure - t)
    return {'lower': lo / 480, 'upper': hi / 480}


def stel(s, scaled=False):
    c = concentration(s)
    k = c['sampledMinutes'] / 15 if scaled else 1
    return {'lower': c['lower'] * k, 'upper': c['upper'] * k}


def cmp_state(lo, hi, b):
    thr = b * (1 - REL_TOL)
    if hi != 'Infinity' and hi < thr: return 'below_benchmark'
    if lo >= thr: return 'at_or_above_benchmark'
    return 'indeterminate'


# ── Cases ─────────────────────────────────────────────────────────────────────────────────────────────────────
cases = []


def case(id, group, description, calc, samples, parameters, benchmark, expect, derivation, change=None, mw=None, extra=None, change14=None):
    c = {'id': id, 'group': group, 'description': description, 'calc': calc, 'methodVersion': ENGINE[calc], 'engineVersion': ENGINE['engine'],
         'input': {'calc': calc, 'samples': samples, 'parameters': parameters, 'benchmark': benchmark, 'molecularWeight': mw},
         'expected': expect, 'tolerance': {'relative': 1e-9, 'note': 'Numeric expectations from an independent Python calculation; double precision, no rounding.'},
         'derivation': derivation}
    if change: c['changeFrom_1_3_1'] = change
    if change14: c['changeFrom_1_4_0'] = change14
    if extra: c.update(extra)
    cases.append(c)


# Original worked examples (hygienist-review-pack.md §3), same inputs as scripts/generate-validation-examples.ts
s1 = sample()
t = twa([s1], 480)
case('E1', 'original', 'Full-shift sample, 300 µg over 480 min at 2 L/min', 'twa_8h', [s1], P, bm(0.5),
     {'results': [{'subject': 'W1', 'lower': t['lower'], 'upper': t['upper'], 'comparison': 'below_benchmark'}], 'samples': [{'code': 'S', **{k: concentration(s1)[k] for k in ('lower', 'upper')}, 'included': True}],
      'dataQuality': 'complete', 'benchmarkState': 'below_benchmark', 'calculationAvailability': 'complete', 'evidenceAdequacy': 'adequate', 'flagsInclude': ['SHIFT_INFERRED']},
     'V = 2 L/min × 480 min = 960 L; C = 0.300 mg / 0.960 m³ = 0.3125 mg/m³; TWA = 0.3125 × 480 / 480.')

s2 = sample(flowPostLpm=1.8, interruptions=[{'start': '2026-03-02T12:00:00Z', 'end': '2026-03-02T12:30:00Z'}])
c2 = concentration(s2)
case('E2', 'original', 'Interruption 30 min and flow drift 10 % (method tolerance 5 %, consequence not stated)', 'twa_8h', [s2], P, bm(0.5),
     {'samples': [{'code': 'S', 'lower': c2['lower'], 'upper': c2['upper'], 'sampledMinutes': c2['sampledMinutes'], 'volumeL': c2['volumeL'], 'included': False}], 'results': [],
      'dataQuality': 'failed', 'benchmarkState': 'not_comparable', 'evidenceAdequacy': 'no_formal_evidence', 'flagsInclude': ['INTERRUPTED', 'ACCEPTANCE_RULE_UNDEFINED', 'FLOW_DRIFT_DISPOSITION_REQUIRED']},
     'T = 480 − 30 = 450 min; mean flow 1.9 L/min; V = 855 L; C = 0.300/0.855 = 0.350877… mg/m³.',
     change='1.3.1 kept the sample with a qualify flag. 1.4.0 (TR-05): the method does not state the consequence of a flow-drift failure, so the sample is excluded until a reviewer records a disposition.')
s2a = copy.deepcopy(s2); s2a['method']['acceptance'] = {'flowDrift': 'advisory'}
case('E2-advisory', 'original-variant', 'E2 with the method stating flow drift as advisory', 'twa_8h', [s2a], {**P, 'exposureMinutesPerShift': 450}, bm(0.5),
     {'samples': [{'code': 'S', 'lower': c2['lower'], 'upper': c2['upper'], 'included': True}], 'results': [{'subject': 'W1', **twa([s2a], 450), 'comparison': 'below_benchmark'}],
      'dataQuality': 'qualified', 'benchmarkState': 'below_benchmark', 'flagsInclude': ['FLOW_DRIFT_ADVISORY']},
     'As E2; exposure period 450 min = sampled time, so TWA = 0.350877 × 450 / 480 = 0.328947 mg/m³.')

a3 = sample(sampleCode='A', endAt='2026-03-02T12:00:00Z', result=res(240)); b3 = sample(sampleCode='B', startAt='2026-03-02T12:00:00Z', result=res(96))
t3 = twa([a3, b3], 480)
case('E3', 'original', 'Two consecutive samples 0.5 and 0.2 mg/m³', 'twa_8h', [a3, b3], P, bm(0.5),
     {'results': [{'subject': 'W1', **t3, 'comparison': 'below_benchmark'}], 'dataQuality': 'complete', 'benchmarkState': 'below_benchmark'},
     '(0.5 × 240 + 0.2 × 240) / 480 = 0.35 mg/m³.')

h4 = sample(endAt='2026-03-02T12:00:00Z', result=res(240))
case('E4-none', 'original', 'Half-shift sample, 480-min exposure, no assumption', 'twa_8h', [h4], P, bm(0.5),
     {'results': [{'subject': 'W1', 'lower': None, 'upper': None, 'comparison': 'not_comparable'}], 'dataQuality': 'incomplete', 'benchmarkState': 'indeterminate', 'calculationAvailability': 'none', 'flagsInclude': ['COVERAGE_INCOMPLETE']},
     'Coverage 240/480 = 50 %; no assumption → no TWA; uncalculable formal result → indeterminate.')
z4 = twa([h4], 480)
case('E4-zero', 'original', 'Half-shift sample, zero exposure assumed (justified)', 'twa_8h', [h4], {**P, 'unsampledAssumption': 'zero_exposure', 'unsampledJustification': JUST}, bm(0.5),
     {'results': [{'subject': 'W1', **z4, 'comparison': 'below_benchmark', 'assumptionDependent': True}], 'dataQuality': 'qualified', 'benchmarkState': 'below_benchmark', 'flagsInclude': ['UNSAMPLED_ZERO']},
     '0.5 × 240 / 480 = 0.25 mg/m³.')
m4 = twa([h4], 480, 'same_as_sampled')
case('E4-same', 'original', 'Half-shift sample, sampled mean assumed for the rest (justified)', 'twa_8h', [h4], {**P, 'unsampledAssumption': 'same_as_sampled', 'unsampledJustification': JUST}, bm(0.5),
     {'results': [{'subject': 'W1', **m4, 'comparison': 'at_or_above_benchmark', 'assumptionDependent': True}], 'dataQuality': 'qualified', 'benchmarkState': 'at_or_above_benchmark', 'flagsInclude': ['EXTRAPOLATED']},
     '0.5 × 480 / 480 = 0.5 mg/m³; equal to the benchmark → at or above.')

s5 = sample(result=res(None, '<LOD')); c5 = concentration(s5)
case('E5-0.05', 'original', 'Non-detect < 10 µg over 960 L; benchmark 0.05', 'twa_8h', [s5], P, bm(0.05),
     {'samples': [{'code': 'S', 'lower': 0, 'upper': c5['upper'], 'included': True}], 'results': [{'subject': 'W1', **twa([s5], 480), 'comparison': 'below_benchmark'}], 'benchmarkState': 'below_benchmark', 'dataQuality': 'qualified', 'flagsInclude': ['NON_DETECT']},
     'Interval 0 – 0.010/0.960 = 0 – 0.0104167 mg/m³.')
case('E5-0.005', 'original', 'Non-detect < 10 µg over 960 L; benchmark 0.005', 'twa_8h', [s5], P, bm(0.005),
     {'results': [{'subject': 'W1', **twa([s5], 480), 'comparison': 'indeterminate'}], 'benchmarkState': 'indeterminate'},
     'Interval spans 0.005.')

s6 = sample(endAt='2026-03-02T18:00:00Z', result=res(360))
c6 = concentration(s6)
case('E6', 'original', '10-hour shift, 360 µg over 600 min', 'twa_8h', [s6], {**P, 'exposureMinutesPerShift': 600}, bm(0.5),
     {'results': [{'subject': 'W1', 'lower': c6['lower'] * 600 / 480, 'upper': c6['upper'] * 600 / 480, 'comparison': 'below_benchmark'}], 'dataQuality': 'complete', 'benchmarkState': 'below_benchmark', 'flagsInclude': ['EXTENDED_SHIFT']},
     'V = 1200 L; C = 0.3 mg/m³; TWA = 0.3 × 600 / 480 = 0.375 mg/m³.')

s7 = sample(startAt='2026-03-02T10:00:00Z', endAt='2026-03-02T10:15:00Z', result=res(45, '=', 1, 3))
case('E7', 'original', 'STEL, exact 15-minute sample, 45 µg', 'stel_15', [s7], STEL_P, bm(1, 15),
     {'results': [{'subject': 'W1', **stel(s7), 'comparison': 'at_or_above_benchmark'}], 'benchmarkState': 'at_or_above_benchmark'},
     'V = 30 L; C = 0.045 / 0.030 = 1.5 mg/m³ (EH40 Schedule para 8: determined by sampling over the 15-minute period).')

s7b = sample(startAt='2026-03-02T10:00:00Z', endAt='2026-03-02T10:10:00Z', result=res(45, '=', 1, 3))
case('E7b', 'original', 'STEL, 10-minute sample, zero-remainder with justification only', 'stel_15', [s7b], {**STEL_P, 'shortSampleAssumption': 'zero_remainder', 'shortSampleJustification': 'Decanting task observed to last 10 minutes.'}, bm(2, 15),
     {'results': [{'subject': 'W1', 'lower': None, 'upper': None, 'comparison': 'not_comparable'}], 'benchmarkState': 'indeterminate', 'flagsInclude': ['STEL_REMAINDER_EVIDENCE_REQUIRED']},
     'Task completion alone does not establish zero exposure for the remaining 5 min.',
     change='1.3.1 produced 1.5 mg/m³ from the justification alone. 1.4.0 (TR-01) requires supporting evidence for the remainder assumption.')
case('E7b-evidence', 'original-variant', 'E7b with continuous observation recorded', 'stel_15', [s7b], {**STEL_P, 'shortSampleAssumption': 'zero_remainder', 'shortSampleJustification': 'Decanting task observed to last 10 minutes.', 'shortSampleEvidenceBasis': 'continuous_observation', 'shortSampleEvidenceRef': 'Observation sheet OB-7'}, bm(2, 15),
     {'results': [{'subject': 'W1', **stel(s7b, scaled=True), 'comparison': 'below_benchmark', 'assumptionDependent': True}], 'benchmarkState': 'below_benchmark', 'dataQuality': 'qualified', 'flagsInclude': ['STEL_ZERO_REMAINDER', 'STEL_SHORT_PEAK_LIMITATION']},
     'C = 0.045/0.020 = 2.25 mg/m³; 15-min value = 2.25 × 10 / 15 = 1.5 mg/m³ (assumption-dependent).')

case('E8', 'original', 'Conversion 20 ppm, MW 92.14 g/mol', 'twa_8h', [], P, None, {'conversion': {'from': {'lower': 20, 'upper': 20, 'unit': 'ppm'}, 'to': 'mg/m3', 'molecularWeight': 92.14, 'lower': 20 * 92.14 / MOLAR_VOLUME, 'upper': 20 * 92.14 / MOLAR_VOLUME}},
     '20 × 92.14 / 24.05526 = 76.6069… mg/m³ (EH40 para 68 molar volume).',
     change='1.3.1 used 24.0551 rounded from R·T/P (76.6075). 1.4.0 uses the value stated in EH40 para 68 (24.05526) without rounding; relative difference 6.5 × 10⁻⁶.')

a9 = sample(sampleCode='A', endAt='2026-03-02T12:00:00Z', result=res(240)); b9 = sample(sampleCode='B', startAt='2026-03-02T11:00:00Z', result=res(240))
case('E9', 'original', 'Overlapping samples for one worker', 'twa_8h', [a9, b9], P, bm(0.5),
     {'results': [{'subject': 'W1', 'lower': None, 'upper': None, 'comparison': 'not_comparable'}], 'dataQuality': 'incomplete', 'benchmarkState': 'indeterminate', 'calculationAvailability': 'none', 'flagsInclude': ['SAMPLES_OVERLAP']},
     'Overlap would double count → no TWA → indeterminate (H1-F01 behaviour retained).')

cal = {**INST, 'calibrationValidAtSampling': False}
s10 = sample(instrument=cal)
case('E10a', 'original', 'Calibration expired; indicative 0.3125 vs benchmark 1.0', 'twa_8h', [s10], P, bm(1),
     {'benchmarkState': 'not_comparable', 'evidenceAdequacy': 'no_formal_evidence', 'unresolved': ['S'], 'flagsInclude': ['CALIBRATION_INVALID']},
     'Indicative only; the indicative interval is below 1.0 so it cannot be at or above; no formal comparison.')
case('E10b', 'original', 'Calibration expired; indicative 0.3125 vs benchmark 0.2', 'twa_8h', [s10], P, bm(0.2),
     {'benchmarkState': 'indeterminate', 'unresolved': ['S']},
     'Indicative 0.3125 ≥ 0.2 could be at or above; not proof either way → indeterminate.')
ok = sample(sampleCode='OK', subjectRef='W2', result=res(96)); calS = sample(sampleCode='CAL', instrument=cal)
case('E10c', 'original', 'One valid worker below 0.2; another indicative (calibration expired)', 'twa_8h', [ok, calS], P, bm(0.2),
     {'results': [{'subject': 'W2', **twa([ok], 480), 'comparison': 'below_benchmark'}, {'subject': 'W1', **twa([calS], 480), 'comparison': 'not_comparable'}], 'benchmarkState': 'indeterminate', 'evidenceAdequacy': 'unresolved_evidence', 'unresolved': ['CAL']},
     'W2: 0.096/0.960 = 0.1 mg/m³ below; CAL unresolved → overall indeterminate.', extra={'note': 'The review pack labels the workers W2 and W3; the generator labels them W2 and W1. Values are the same.'})
case('E11', 'original', 'Static sample only', 'twa_8h', [sample(sampleType='static')], P, bm(0.2),
     {'benchmarkState': 'not_comparable', 'results': []}, 'Static samples are never compared with personal benchmarks.')
case('E12', 'original', 'Screening-only instrument', 'twa_8h', [sample(instrument={**INST, 'screeningOnly': True})], P, bm(1),
     {'benchmarkState': 'not_comparable', 'unresolved': ['S'], 'flagsInclude': ['SCREENING_INSTRUMENT']}, 'Indicative only; below 1.0; not comparable.')
s13 = sample(result=res(None, '<LOQ')); c13 = concentration(s13)
case('E13', 'original', 'Generic < LOQ (LOD 10 µg, LOQ 30 µg) over 960 L; benchmark 0.02', 'twa_8h', [s13], P, bm(0.02),
     {'samples': [{'code': 'S', 'lower': 0, 'upper': c13['upper'], 'included': True}], 'benchmarkState': 'indeterminate', 'dataQuality': 'qualified', 'flagsInclude': ['BELOW_LOQ']},
     'Detection not confirmed: interval 0 – 0.030/0.960 = 0 – 0.03125 mg/m³.',
     change='1.3.1 used the LOD as the lower bound (0.010417–0.03125), inferring detection from the presence of an LOD. 1.4.0 (item C) carries generic "<LOQ" as 0–LOQ; see E13-detected for confirmed detection.')
s13d = sample(result=res(None, 'detected_below_loq')); c13d = concentration(s13d)
case('E13-detected', 'original-variant', 'Laboratory-confirmed detection below LOQ (LOD 10, LOQ 30)', 'twa_8h', [s13d], P, bm(0.02),
     {'samples': [{'code': 'S', 'lower': c13d['lower'], 'upper': c13d['upper'], 'included': True}], 'benchmarkState': 'indeterminate', 'flagsInclude': ['DETECTED_BELOW_LOQ']},
     'Interval LOD–LOQ = 0.0104167 – 0.03125 mg/m³.')
case('E14', 'original', 'Failed QC check without disposition', 'twa_8h', [sample(qc=[{'checkType': 'flow_check', 'outcome': 'fail', 'disposition': None}])], P, bm(0.5),
     {'dataQuality': 'failed', 'benchmarkState': 'not_comparable', 'evidenceAdequacy': 'no_formal_evidence', 'unresolved': ['S'], 'flagsInclude': ['QC_FAIL_UNRESOLVED']},
     'Sample excluded; its interval (0.3125) is below 0.5, so it could not be at or above; no formal comparison.')

# ── TR reproductions (inputs unchanged from the review) ──────────────────────────────────────────────────────
tr1 = sample(startAt='2026-03-02T10:00:00Z', endAt='2026-03-02T10:16:00Z', result=res(31.2, '=', 1, 3))
case('TR-01', 'TR', '16-minute sample averaging 0.975 mg/m³; 15-minute benchmark 1', 'stel_15', [tr1], STEL_P, bm(1, 15),
     {'results': [{'subject': 'W1', 'lower': None, 'upper': None, 'comparison': 'not_comparable'}], 'benchmarkState': 'indeterminate', 'dataQuality': 'incomplete', 'flagsInclude': ['STEL_SAMPLE_TOO_LONG']},
     'C = 0.0312/0.032 = 0.975 mg/m³ over 16 min. 15 min at 1.04 mg/m³ + 1 min at 0 gives the same average, so the average cannot establish the 15-minute value.',
     change='1.3.1: complete / below_benchmark (14–16 min accepted as 15). 1.4.0: no result; indeterminate.')
v = sample(sampleCode='A'); x = sample(sampleCode='B', subjectRef='W2', result=res(None, '<LOD', 1920, 5000), qc=[{'checkType': 'flow_check', 'outcome': 'fail', 'disposition': None}])
case('TR-02', 'TR', 'Valid worker below 0.5; another worker excluded non-detect 0–2 mg/m³', 'twa_8h', [v, x], P, bm(0.5),
     {'results': [{'subject': 'W1', **twa([v], 480), 'comparison': 'below_benchmark'}], 'benchmarkState': 'indeterminate', 'evidenceAdequacy': 'unresolved_evidence', 'unresolved': ['B'], 'dataQuality': 'qualified'},
     'W1 0.3125 below; W2 excluded with no disposition → no favourable overall comparison.',
     change='1.3.1: qualified / below_benchmark (excluded interval lower bound 0 < 0.5 was ignored).')
tr3 = sample(result=res(None, '<LOQ', 1000, 1))
case('TR-03', 'TR', '<LOQ with LOD 1000 µg and LOQ 1 µg', 'twa_8h', [tr3], P, bm(0.5),
     {'samples': [{'code': 'S', 'lower': None, 'upper': None, 'included': True}], 'benchmarkState': 'indeterminate', 'dataQuality': 'incomplete', 'flagsInclude': ['INPUT_INVALID_LIMITS']},
     'LOD > LOQ is contradictory; no interval is formed.', change='1.3.1: interval 1.041667–0.001042 (lower > upper) / below_benchmark.')
tr4 = sample(result=res(0.000384, '=', 0.0001, 0.0003))
case('TR-04', 'TR', '0.000384 µg over 960 L; benchmark 3e-7 mg/m³', 'twa_8h', [tr4], P, bm(0.0000003),
     {'results': [{'subject': 'W1', **twa([tr4], 480), 'comparison': 'at_or_above_benchmark'}], 'benchmarkState': 'at_or_above_benchmark'},
     'C = 3.84e-7 mg / 0.96 m³ = 4e-7 mg/m³ > 3e-7.', change='1.3.1 rounded to 6 decimal places (0) and reported below_benchmark.')
tr5 = sample(flowPostLpm=1)
case('TR-05', 'TR', 'Flow 2.0 → 1.0 L/min; method tolerance 5 %; consequence not stated', 'twa_8h', [tr5], P, bm(0.5),
     {'samples': [{'code': 'S', **{k: concentration(tr5)[k] for k in ('lower', 'upper')}, 'included': False}], 'benchmarkState': 'not_comparable', 'dataQuality': 'failed', 'flagsInclude': ['ACCEPTANCE_RULE_UNDEFINED', 'FLOW_DRIFT_DISPOSITION_REQUIRED']},
     'Drift 50 % > 5 %: excluded until a reviewer records a disposition.', change='1.3.1: qualified / below_benchmark with a qualify flag.')

# ── TR-01 variants (STEL timing) ─────────────────────────────────────────────────────────────────────────────
def stelS(start, end, mass, **o): return sample(startAt=start, endAt=end, result=res(mass, '=', 1, 3), **o)
e15 = stelS('2026-03-02T10:00:00Z', '2026-03-02T10:15:00Z', 30)
case('TR-01a', 'TR-variant', 'Exactly 15 min uninterrupted, 1.0 mg/m³ vs 1.0', 'stel_15', [e15], STEL_P, bm(1, 15), {'results': [{'subject': 'W1', **stel(e15), 'comparison': 'at_or_above_benchmark'}]}, '0.030/0.030 = 1.0 mg/m³.')
e15b = stelS('2026-03-02T10:00:00Z', '2026-03-02T10:15:00.050Z', 30)
case('TR-01b', 'TR-variant', '15 min + 0.05 s (numerical timestamp tolerance only)', 'stel_15', [e15b], STEL_P, bm(2, 15), {'results': [{'subject': 'W1', **stel(e15b), 'comparison': 'below_benchmark'}]}, 'Within the 0.1 s numerical tolerance; not a sampling tolerance.')
e151 = stelS('2026-03-02T10:00:00Z', '2026-03-02T10:15:01Z', 30)
case('TR-01c', 'TR-variant', '15 min 1 s', 'stel_15', [e151], STEL_P, bm(2, 15), {'results': [{'subject': 'W1', 'lower': None, 'upper': None, 'comparison': 'not_comparable'}], 'flagsInclude': ['STEL_SAMPLE_TOO_LONG']}, 'Longer than 15 min: no result.')
e14 = stelS('2026-03-02T10:00:00Z', '2026-03-02T10:14:00Z', 28)
case('TR-01d', 'TR-variant', '14 min, no assumption', 'stel_15', [e14], STEL_P, bm(2, 15), {'results': [{'subject': 'W1', 'lower': None, 'upper': None, 'comparison': 'not_comparable'}], 'flagsInclude': ['STEL_SAMPLE_SHORT']}, 'Shorter than 15 min without the assumption: no result.')
ei = stelS('2026-03-02T10:00:00Z', '2026-03-02T10:20:00Z', 30, interruptions=[{'start': '2026-03-02T10:05:00Z', 'end': '2026-03-02T10:10:00Z'}])
case('TR-01e', 'TR-variant', '15 min sampled over a 20-min window (interrupted)', 'stel_15', [ei], STEL_P, bm(2, 15), {'results': [{'subject': 'W1', 'lower': None, 'upper': None, 'comparison': 'not_comparable'}], 'flagsInclude': ['STEL_WINDOW_TOO_LONG']}, 'Not a single 15-minute period.')
ew = stelS('2026-03-02T10:00:00Z', '2026-03-02T10:15:00Z', 24, interruptions=[{'start': '2026-03-02T10:05:00Z', 'end': '2026-03-02T10:08:00Z'}])
case('TR-01f', 'TR-variant', '12 min sampled within a 15-min window, with assumption and evidence', 'stel_15', [ew], {**STEL_P, 'shortSampleAssumption': 'zero_remainder', 'shortSampleJustification': 'Pump paused while the worker left the booth area.', 'shortSampleEvidenceBasis': 'direct_reading_instrument', 'shortSampleEvidenceRef': 'DRM-02 log 10:05–10:08'}, bm(2, 15),
     {'results': [{'subject': 'W1', **stel(ew, scaled=True), 'comparison': 'below_benchmark', 'assumptionDependent': True}], 'flagsInclude': ['STEL_ZERO_REMAINDER']}, 'C = 0.024/0.024 = 1.0 mg/m³ over 12 min; 1.0 × 12/15 = 0.8 mg/m³.')

# ── TR-02 variants (evidence disposition) ────────────────────────────────────────────────────────────────────
def disp(kind, rel=None): return {'kind': kind, 'reason': 'Recorded reason for the disposition.', 'consequence': 'Stated consequence for the assessment scope.', 'authorisedBy': 'Reviewer R', 'relatedSampleCode': rel}
hi = sample(sampleCode='A', result=res(600))
case('TR-02a', 'TR-variant', 'Adverse valid result alongside unresolved excluded evidence', 'twa_8h', [hi, x], P, bm(0.5), {'benchmarkState': 'at_or_above_benchmark', 'evidenceAdequacy': 'unresolved_evidence'}, 'A valid at-or-above result stands regardless of unresolved evidence (0.625 ≥ 0.5).')
xd = copy.deepcopy(x); xd['subjectRef'] = 'W1'; xd['evidenceDisposition'] = disp('duplicate', 'A')
case('TR-02b', 'TR-variant', 'Excluded sample dispositioned as "duplicate" of a valid sample, no duplicate category or relationship evidence', 'twa_8h', [v, xd], P, bm(0.5),
     {'benchmarkState': 'indeterminate', 'evidenceAdequacy': 'unresolved_evidence', 'unresolved': ['B'], 'unresolvedWhy': {'B': 'category not stated'}},
     'Same worker, shift and window, but no duplicate category: the relationship is not evidenced, so the disposition is not accepted.',
     change14='1.4.0 accepted any "duplicate" naming a formal sample of the same worker and shift (below_benchmark / adequate). 1.5.0 (TR-06) needs a supported category and relationship evidence; see TR-06f for a supported duplicate record.')
xn = copy.deepcopy(x); xn['evidenceDisposition'] = disp('not_replaced')
case('TR-02c', 'TR-variant', 'Excluded sample not replaced (worker unassessed)', 'twa_8h', [v, xn], P, bm(0.5), {'benchmarkState': 'indeterminate', 'evidenceAdequacy': 'coverage_gap'}, 'Coverage gap blocks a favourable overall comparison.')
xa = copy.deepcopy(x); xa['evidenceDisposition'] = disp('remaining_coverage_adequate')
case('TR-02d', 'TR-variant', 'Reviewer judges remaining coverage adequate', 'twa_8h', [v, xa], P, bm(0.5), {'benchmarkState': 'below_benchmark', 'evidenceAdequacy': 'adequate_with_accepted_gaps'}, 'Authorised judgement with stated consequence.')
xi = copy.deepcopy(x); xi['evidenceDisposition'] = {**disp('outside_scope'), 'consequence': ''}
case('TR-02e', 'TR-variant', 'Disposition without an assessment of consequences', 'twa_8h', [v, xi], P, bm(0.5), {'benchmarkState': 'indeterminate', 'evidenceAdequacy': 'unresolved_evidence'}, 'Incomplete disposition does not resolve the evidence.')
xo = copy.deepcopy(x); xo['evidenceDisposition'] = disp('outside_scope')
case('TR-02f', 'TR-variant', 'Excluded sample outside the assessment scope', 'twa_8h', [v, xo], P, bm(0.5), {'benchmarkState': 'below_benchmark', 'evidenceAdequacy': 'adequate'}, 'Not part of the intended scope.')
ov = sample(sampleCode='B', subjectRef='W2', result=res(100, '>'), instrument=cal)
case('TR-02g', 'TR-variant', 'Indicative over-range result (upper bound unknown) beside a valid below result', 'twa_8h', [v, ov], P, bm(0.5), {'benchmarkState': 'indeterminate', 'evidenceAdequacy': 'unresolved_evidence', 'unresolved': ['B']}, 'Unknown upper bound cannot be ruled out.')

xw = copy.deepcopy(x); xw['evidenceDisposition'] = disp('duplicate', 'A')
case('TR-02h', 'TR-variant', 'R4 N4: "duplicate" naming a sample of a different worker', 'twa_8h', [v, xw], P, bm(0.5), {'benchmarkState': 'indeterminate', 'evidenceAdequacy': 'unresolved_evidence', 'unresolved': ['B']}, 'A duplicate must cover the same worker and shift.')

xs = copy.deepcopy(x); xs['subjectRef'] = 'W1'; xs['evidenceDisposition'] = disp('duplicate', 'B')
case('TR-02i', 'TR-variant', 'R4 N4: "duplicate" naming itself', 'twa_8h', [v, xs], P, bm(0.5), {'benchmarkState': 'indeterminate', 'unresolved': ['B']}, 'A sample cannot duplicate itself.')

# ── TR-03 variants (input validation) ─────────────────────────────────────────────────────────────────────────
for cid, desc, s, flag in [
    ('TR-03a', 'Negative value', sample(result=res(-5)), 'INPUT_INVALID_NEGATIVE'),
    ('TR-03b', 'Zero flow', sample(flowPreLpm=0), 'INPUT_INVALID_FLOW'),
    ('TR-03c', 'Unknown unit', sample(result=res(10, '=', 1, 3, 'kg')), 'INPUT_INVALID_UNIT'),
    ('TR-03d', 'Detected below LOQ without an LOD', sample(result=res(None, 'detected_below_loq', None, 30)), 'INPUT_INVALID_LIMITS'),
    ('TR-03e', 'Unknown qualifier', sample(result=res(10, '~')), 'INPUT_INVALID_QUALIFIER')]:
    case(cid, 'TR-variant', desc, 'twa_8h', [s], P, bm(0.5), {'samples': [{'code': 'S', 'lower': None, 'upper': None}], 'flagsInclude': [flag], 'benchmarkState': 'indeterminate'}, 'Invalid input: no numeric result, specific reason.')
case('TR-03f', 'TR-variant', 'Benchmark value zero', 'twa_8h', [sample()], P, {**bm(0.5), 'value': 0}, {'benchmarkState': 'not_comparable', 'notePattern': 'Benchmark rejected'}, 'A benchmark must be a positive finite number.')
o3 = sample(result=res(500, '>'))
case('TR-03g', 'TR-variant', 'Over-range result: upper bound unknown and explicit', 'twa_8h', [o3], P, bm(0.5), {'samples': [{'code': 'S', 'lower': concentration(o3)['lower'], 'upper': 'Infinity', 'upperUnbounded': True}], 'results': [{'subject': 'W1', 'lower': concentration(o3)['lower'], 'upper': 'Infinity', 'comparison': 'at_or_above_benchmark'}]}, '0.500/0.960 = 0.520833 ≥ 0.5; upper bound unknown, serialised as "Infinity" with upperUnbounded = true.')

n1 = sample(result=res(600, '<LOQ', 10, 30))
case('TR-03h', 'TR-variant', 'R4 N1: "<LOQ" reported with a value (600 µg) above the LOQ (30 µg)', 'twa_8h', [n1], P, bm(0.5),
     {'samples': [{'code': 'S', 'lower': 0, 'upper': concentration(n1)['upper']}], 'results': [{'subject': 'W1', **twa([n1], 480), 'comparison': 'indeterminate'}], 'flagsInclude': ['LIMIT_VALUE_DIFFERS']},
     'Upper bound = max(600, 30) µg / 960 L = 0.625 mg/m³; interval 0–0.625 spans 0.5.', change='Before the R4 fix the LOQ (30 µg) was used and the result was 0–0.03125, below benchmark.')

# ── TR-04 variants (precision and boundaries) ─────────────────────────────────────────────────────────────────
for cid, mass, state in [('TR-04a', 480, 'at_or_above_benchmark'), ('TR-04b', 479.999, 'below_benchmark'), ('TR-04c', 480.001, 'at_or_above_benchmark')]:
    s = sample(result=res(mass))
    case(cid, 'TR-variant', f'{mass} µg over 960 L vs 0.5 mg/m³', 'twa_8h', [s], P, bm(0.5), {'results': [{'subject': 'W1', **twa([s], 480), 'comparison': state}]}, f'{mass}/960 mg/m³ vs 0.5 (equal counts as at or above).')
u = sample(method={**METHOD, 'resultBasis': 'concentration'}, result=res(500, '=', 1, 3, 'ug/m3'))
case('TR-04d', 'TR-variant', '500 µg/m³ equals 0.5 mg/m³', 'twa_8h', [u], P, bm(0.5), {'results': [{'subject': 'W1', 'lower': 0.5, 'upper': 0.5, 'comparison': 'at_or_above_benchmark'}]}, 'Equivalent unit representation.')
case('TR-04e', 'TR-variant', 'Round trip ppm → mg/m³ → ppm', 'twa_8h', [], P, None, {'roundTrip': {'value': 3.7, 'molecularWeight': 78.11, 'relative': 1e-12}}, 'Repeated transformations return the original value.')
q = sample(result=res(None, '<LOD', 0.000288))
case('TR-04f', 'TR-variant', 'Tiny non-detect interval 0–3e-7 vs 3e-7', 'twa_8h', [q], P, bm(0.0000003), {'results': [{'subject': 'W1', **twa([q], 480), 'comparison': 'indeterminate'}]}, 'Upper bound 0.000288 µg / 0.96 m³ = 3e-7 equals the benchmark → spans it (indeterminate).')

# ── TR-05 variants (method acceptance) ───────────────────────────────────────────────────────────────────────
def m(**acc): return {**METHOD, 'acceptance': acc}
case('TR-05a', 'TR-variant', 'Flow drift: method says invalid; a disposition is present but cannot override', 'twa_8h', [sample(flowPostLpm=1, method=m(flowDrift='invalid'), acceptanceDispositions=[{'criterion': 'flow_drift', 'evidence': 'Mid-sampling checks were within tolerance.', 'authorisedBy': 'Reviewer R', 'scope': 'This sample only'}])], P, bm(0.5),
     {'samples': [{'code': 'S', 'included': False}], 'flagsInclude': ['FLOW_DRIFT_INVALID']}, 'Hard prohibition: not accepted by disposition.')
case('TR-05b', 'TR-variant', 'Flow drift: disposition required and recorded (criterion, evidence, reviewer, scope)', 'twa_8h', [sample(flowPostLpm=1, method=m(flowDrift='disposition_required'), acceptanceDispositions=[{'criterion': 'flow_drift', 'evidence': 'Mid-sampling checks were within tolerance.', 'authorisedBy': 'Reviewer R', 'scope': 'This sample only'}])], {**P, 'exposureMinutesPerShift': 480}, bm(0.5),
     {'samples': [{'code': 'S', 'included': True}], 'flagsInclude': ['FLOW_DRIFT_ACCEPTED'], 'dataQuality': 'qualified'}, 'Accepted with a complete disposition.')
case('TR-05c', 'TR-variant', 'Flow drift: disposition with free text only (no scope)', 'twa_8h', [sample(flowPostLpm=1, method=m(flowDrift='disposition_required'), acceptanceDispositions=[{'criterion': 'flow_drift', 'evidence': 'Looked fine to me.', 'authorisedBy': 'Reviewer R', 'scope': ''}])], P, bm(0.5),
     {'samples': [{'code': 'S', 'included': False}], 'flagsInclude': ['FLOW_DRIFT_DISPOSITION_REQUIRED']}, 'Incomplete disposition does not accept the sample.')
case('TR-05d', 'TR-variant', 'Minimum volume 1000 L not met (960 L), advisory', 'twa_8h', [sample(method={**m(minVolume='advisory'), 'minVolumeL': 1000})], P, bm(0.5), {'samples': [{'code': 'S', 'included': True}], 'flagsInclude': ['VOLUME_BELOW_MIN_ADVISORY']}, '960 L < 1000 L, advisory.')
case('TR-05e', 'TR-variant', 'Minimum volume not met, consequence not stated', 'twa_8h', [sample(method={**METHOD, 'minVolumeL': 1000})], P, bm(0.5), {'samples': [{'code': 'S', 'included': False}], 'flagsInclude': ['ACCEPTANCE_RULE_UNDEFINED', 'VOLUME_BELOW_MIN_DISPOSITION_REQUIRED']}, 'Unknown rule → disposition required.')

# ── Items A–D ────────────────────────────────────────────────────────────────────────────────────────────────
n1 = sample(sampleCode='N1', startAt='2026-01-01T22:00:00Z', endAt='2026-01-02T02:00:00Z', result=res(480)); n2 = sample(sampleCode='N2', startAt='2026-01-02T02:00:00Z', endAt='2026-01-02T06:00:00Z', result=res(480))
case('A-1', 'method', 'Night shift across midnight without a shift reference', 'twa_8h', [n1, n2], P, bm(2), {'flagsInclude': ['SHIFT_ASSOCIATION_REQUIRED'], 'calculationAvailability': 'none'}, 'No silent merging or splitting across midnight.')
n1r, n2r = {**n1, 'shiftRef': 'N-0101'}, {**n2, 'shiftRef': 'N-0101'}
case('A-2', 'method', 'Night shift with an explicit shift reference', 'twa_8h', [n1r, n2r], P, bm(2), {'results': [{'subject': 'W1', **twa([n1r, n2r], 480), 'comparison': 'below_benchmark'}]}, '(1.0 × 240 + 1.0 × 240)/480 = 1.0 mg/m³.')
sp1 = sample(sampleCode='SP1', startAt='2026-03-02T06:00:00Z', endAt='2026-03-02T10:00:00Z', result=res(240)); sp2 = sample(sampleCode='SP2', startAt='2026-03-02T16:00:00Z', endAt='2026-03-02T20:00:00Z', result=res(96))
case('A-3', 'method', 'Split shift on one date, no reference (grouped by date, noted)', 'twa_8h', [sp1, sp2], P, bm(0.5), {'results': [{'subject': 'W1', **twa([sp1, sp2], 480), 'comparison': 'below_benchmark'}], 'flagsInclude': ['SHIFT_INFERRED']}, 'Same local date, no samples near another date.')
case('B-1', 'method', 'Two task records without times (240 + 240), exposure entered 300', 'twa_8h', [sample(endAt='2026-03-02T13:00:00Z', result=res(300))], {**P, 'exposureMinutesPerShift': 300, 'exposureRecords': [{'ref': 'T1', 'minutes': 240, 'basis': 'recorded_fact'}, {'ref': 'T2', 'minutes': 240, 'basis': 'recorded_fact'}]}, bm(0.5),
     {'flagsInclude': ['EXPOSURE_OVERLAP_UNKNOWN']}, 'Total between 240 (full overlap) and 480 (sequential).')
case('B-2', 'method', 'Timed overlapping tasks 0–240 and 120–360 (union 360), exposure entered 300', 'twa_8h', [sample(endAt='2026-03-02T13:00:00Z', result=res(300))], {**P, 'exposureMinutesPerShift': 300, 'exposureRecords': [{'ref': 'T1', 'minutes': 240, 'basis': 'recorded_fact', 'startMin': 0, 'endMin': 240}, {'ref': 'T2', 'minutes': 240, 'basis': 'recorded_fact', 'startMin': 120, 'endMin': 360}]}, bm(0.5),
     {'flagsInclude': ['EXPOSURE_BELOW_RECORDED']}, 'Overlap counted once: 360 min; 300 is too short.')
case('B-3', 'method', 'Estimated task duration', 'twa_8h', [sample()], {**P, 'exposureRecords': [{'ref': 'T1', 'minutes': 480, 'basis': 'user_estimate'}]}, bm(0.5), {'flagsInclude': ['EXPOSURE_DURATION_ESTIMATED'], 'dataQuality': 'qualified'}, 'Estimates are recorded as uncertainty.')

case('B-4', 'method', 'R4 N3: task times 0–60 but 120 recorded minutes; exposure entered 60', 'twa_8h', [sample(endAt='2026-03-02T09:00:00Z', result=res(60))], {**P, 'exposureMinutesPerShift': 60, 'exposureRecords': [{'ref': 'T1', 'minutes': 120, 'basis': 'recorded_fact', 'startMin': 0, 'endMin': 60}]}, bm(0.5),
     {'flagsInclude': ['EXPOSURE_BELOW_RECORDED'], 'calculationAvailability': 'none'}, 'Recorded minutes (120) bound the total even when the times say 60; 60 entered is too short.')

# ── TR-06 duplicate relationships (independent review of 9b87c17) ────────────────────────────────────────────
# Policy (specification §0.6): a duplicate needs a supported category and matching relationship evidence: same worker,
# substance, exposure group, tasks and shift; same_event_record: windows within ±1 min and the same instrument;
# paired_colocated: the same pair reference recorded at capture and windows overlapping ≥ 90 % of the longer window.
# A set-aside paired result higher than the retained one (or a disagreeing record of one event) is a conflict.
# Statuses below are written by hand from that policy; numbers come from the oracle above.
CONC = {**METHOD, 'resultBasis': 'concentration', 'flowDriftTolerancePct': None}
CTX = {'substanceRef': 'SUB', 'groupRef': 'G1', 'tasksPerformed': 'Main task', 'pairRef': 'PAIR-1'}
QCF = [{'checkType': 'flow_check', 'outcome': 'fail', 'disposition': None}]
def cs(code, start, end, value, **o):
    """Personal sample with a direct concentration result (mg/m³), as in the review's TR-06 statement."""
    return sample(sampleCode=code, startAt=f'2026-03-02T{start}Z', endAt=f'2026-03-02T{end}Z', flowPreLpm=None, flowPostLpm=None, method=copy.deepcopy(CONC), result={'revision': 1, 'value': value, 'unit': 'mg/m3', 'qualifier': '=', 'lod': None, 'loq': None}, **o)
def dd(rel, dtype=None, kind='duplicate'):
    d = {'kind': kind, 'reason': 'Recorded as a duplicate of the morning sample', 'consequence': 'The morning sample represents this worker and shift', 'authorisedBy': 'Practitioner P', 'relatedSampleCode': rel}
    if dtype: d['duplicateType'] = dtype
    return d
STEL15 = {'shortSampleAssumption': 'none'}
AM = cs('AM', '08:00:00', '08:15:00', 0.1)
PM = cs('PM', '15:00:00', '15:15:00', 2, qc=QCF)
case('TR-06-before', 'TR-06', 'Review reproduction, before any disposition: AM valid 0.1 mg/m³; PM excluded 2 mg/m³ (failed QC, no disposition); 15-min benchmark 1', 'stel_15', [AM, PM], STEL15, bm(1, 15),
     {'results': [{'subject': 'W1', **stel(AM), 'comparison': 'below_benchmark'}], 'benchmarkState': 'indeterminate', 'evidenceAdequacy': 'unresolved_evidence', 'unresolved': ['PM']},
     'AM 0.1 < 1; PM excluded and 2 ≥ 1, unresolved → indeterminate.')
case('TR-06', 'TR-06', 'Review reproduction: PM dispositioned "duplicate" of AM (no category, no relationship evidence)', 'stel_15', [AM, {**PM, 'evidenceDisposition': dd('AM')}], STEL15, bm(1, 15),
     {'benchmarkState': 'indeterminate', 'evidenceAdequacy': 'unresolved_evidence', 'unresolved': ['PM'], 'unresolvedWhy': {'PM': 'category not stated'}, 'setAside': []},
     'Different sampling windows of one worker are not duplicates; the disposition is not accepted.',
     change14='1.4.0: below_benchmark / adequate (same worker and date accepted as a duplicate).')
AMc, PMc = {**AM, **CTX}, {**PM, **CTX}
case('TR-06a', 'TR-06', 'As TR-06, disposition claims same_event_record with relationship evidence; windows 08:00 and 15:00', 'stel_15', [AMc, {**PMc, 'evidenceDisposition': dd('AM', 'same_event_record')}], STEL15, bm(1, 15),
     {'benchmarkState': 'indeterminate', 'unresolved': ['PM'], 'unresolvedWhy': {'PM': 'windows differ by more than 1 min'}}, 'Not the same sampling event.')
case('TR-06b', 'TR-06', 'As TR-06, disposition claims paired_colocated with the same pair reference; windows do not overlap', 'stel_15', [AMc, {**PMc, 'evidenceDisposition': dd('AM', 'paired_colocated')}], STEL15, bm(1, 15),
     {'benchmarkState': 'indeterminate', 'unresolved': ['PM'], 'unresolvedWhy': {'PM': 'overlap for 0 min'}}, 'Paired samplers run at the same time.')
def pair(value2, start2='08:00:00', end2='08:15:00', dtype='paired_colocated', o1=None, o2=None, rel='AM'):
    a = {**cs('AM', '08:00:00', '08:15:00', 0.1), **CTX, **(o1 or {})}
    b = {**cs('AM2', start2, end2, value2, qc=QCF), **CTX, **(o2 or {}), 'evidenceDisposition': dd(rel, dtype)}
    return a, b
a, b = pair(0.08)
case('TR-06c', 'TR-06', 'Supported paired sampler: AM2 (excluded, 0.08) worn with AM (0.1), same pair reference and window', 'stel_15', [a, b], STEL15, bm(1, 15),
     {'results': [{'subject': 'W1', **stel(a), 'comparison': 'below_benchmark'}], 'benchmarkState': 'below_benchmark', 'evidenceAdequacy': 'adequate', 'unresolved': [], 'setAside': [{'code': 'AM2', 'kind': 'duplicate', 'duplicateType': 'paired_colocated'}]},
     'Relationship evidenced; the set-aside result (0.08) is not higher than the retained one (0.1).')
a, b = pair(2)
case('TR-06d', 'TR-06', 'Paired sampler conflict: AM2 2 mg/m³ vs retained AM 0.1', 'stel_15', [a, b], STEL15, bm(1, 15),
     {'benchmarkState': 'indeterminate', 'evidenceAdequacy': 'unresolved_evidence', 'unresolved': ['AM2'], 'rejectedConflict': ['AM2'], 'unresolvedWhy': {'AM2': 'higher than the retained result'}},
     'A duplicate label cannot suppress adverse evidence: the higher paired result needs a reviewer\'s review.')
a, b = pair(0.5)
case('TR-06e', 'TR-06', 'Paired sampler conflict below the benchmark: AM2 0.5 vs retained 0.1', 'stel_15', [a, b], STEL15, bm(1, 15),
     {'benchmarkState': 'indeterminate', 'evidenceAdequacy': 'unresolved_evidence', 'unresolved': ['AM2'], 'rejectedConflict': ['AM2']},
     'Still a conflict: the policy does not depend on whether the higher result reaches the benchmark. Unresolved evidence blocks a favourable overall comparison (decision table), so the overall state is indeterminate.')
a, b = pair(0.1, dtype='same_event_record')
case('TR-06f', 'TR-06', 'Supported duplicate record of one sampling event (same instrument, window and result)', 'stel_15', [a, b], STEL15, bm(1, 15),
     {'benchmarkState': 'below_benchmark', 'evidenceAdequacy': 'adequate', 'setAside': [{'code': 'AM2', 'kind': 'duplicate', 'duplicateType': 'same_event_record'}]}, 'Same event recorded twice.')
a, b = pair(0.09, dtype='same_event_record')
case('TR-06g', 'TR-06', 'Two records of one event with different results (0.09 vs 0.1)', 'stel_15', [a, b], STEL15, bm(1, 15),
     {'evidenceAdequacy': 'unresolved_evidence', 'unresolved': ['AM2'], 'rejectedConflict': ['AM2'], 'unresolvedWhy': {'AM2': 'report different results'}}, 'One event cannot have two results; the discrepancy is resolved, not set aside.')
for cid, desc, kw, why in [
    ('TR-06h', 'different worker', {'o2': {'subjectRef': 'W2'}}, 'different worker'),
    ('TR-06i', 'different substance', {'o2': {'substanceRef': 'SUB-2'}}, 'different substance'),
    ('TR-06j', 'tasks not recorded for the set-aside sample', {'o2': {'tasksPerformed': None}}, 'tasks performed are not recorded'),
    ('TR-06k', 'different task context', {'o2': {'tasksPerformed': 'Cleaning'}}, 'tasks recorded differ'),
    ('TR-06l', 'no pair reference recorded', {'o2': {'pairRef': None}}, 'no pair reference'),
    ('TR-06m', 'different exposure group', {'o2': {'groupRef': 'G2'}}, 'different exposure group'),
    ('TR-06n', 'same-event record naming a different instrument', {'dtype': 'same_event_record', 'o2': {'instrument': {**INST, 'assetTag': 'P2'}}}, 'different instruments'),
    ('TR-06o', 'paired windows overlapping 80 % (08:03–08:18)', {'start2': '08:03:00', 'end2': '08:18:00'}, 'less than 90 %'),
    ('TR-06s', 'substance not recorded for either sample', {'o1': {'substanceRef': None}, 'o2': {'substanceRef': None}}, 'substance is not recorded'),
    ('TR-06t', 'different shift reference', {'o1': {'shiftRef': 'DAY-A'}, 'o2': {'shiftRef': 'DAY-B'}}, 'different shift')]:
    a, b = pair(0.08, **kw)
    case(cid, 'TR-06', f'Duplicate refused: {desc}', 'stel_15', [a, b], STEL15, bm(1, 15), {'evidenceAdequacy': 'unresolved_evidence', 'unresolved': ['AM2'], 'unresolvedWhy': {'AM2': why}}, 'Missing or mismatching relationship evidence leaves the disposition unresolved.')
a, b = pair(0.08, start2='08:01:30', end2='08:16:30')
case('TR-06p', 'TR-06', 'Paired windows overlapping exactly 90 % (boundary, accepted)', 'stel_15', [a, b], STEL15, bm(1, 15), {'evidenceAdequacy': 'adequate', 'setAside': [{'code': 'AM2', 'kind': 'duplicate', 'duplicateType': 'paired_colocated'}]}, 'Overlap 13.5 of 15 min = 90 %: at the boundary, accepted (≥).')
a, b = pair(0.1, start2='08:01:00', end2='08:16:00', dtype='same_event_record')
case('TR-06q', 'TR-06', 'Same-event record with start and end 1 min apart (boundary, accepted)', 'stel_15', [a, b], STEL15, bm(1, 15), {'evidenceAdequacy': 'adequate'}, 'Differences up to 1 min are accepted as recording granularity.')
a, b = pair(0.1, start2='08:01:01', end2='08:16:01', dtype='same_event_record')
case('TR-06r', 'TR-06', 'Same-event record with start and end 1 min 1 s apart (refused)', 'stel_15', [a, b], STEL15, bm(1, 15), {'evidenceAdequacy': 'unresolved_evidence', 'unresolvedWhy': {'AM2': 'windows differ by more than 1 min'}}, 'Beyond the 1-min recording granularity.')
case('TR-06u', 'TR-06', 'The coverage route: a technical reviewer judges the remaining coverage adequate for PM', 'stel_15', [AM, {**PM, 'evidenceDisposition': dd(None, kind='remaining_coverage_adequate')}], STEL15, bm(1, 15),
     {'benchmarkState': 'below_benchmark', 'evidenceAdequacy': 'adequate_with_accepted_gaps', 'setAside': [{'code': 'PM', 'kind': 'remaining_coverage_adequate'}]},
     'A different sample offered as adequate coverage goes through the reviewer-only judgement (role enforced by the service and the database), never through "duplicate".')
case('TR-06v', 'TR-06', 'Unsupported category text', 'stel_15', [AMc, {**PMc, 'evidenceDisposition': dd('AM', 'adequate_coverage')}], STEL15, bm(1, 15),
     {'evidenceAdequacy': 'unresolved_evidence', 'unresolvedWhy': {'PM': 'is not supported'}}, 'Only the two documented categories are supported.')

# ── TR-07 contradictory detected_below_loq (independent review of 9b87c17) ──────────────────────────────────────
# Value-field meaning (specification §0.7): detected_below_loq → an estimate in [LOD, LOQ] (both inclusive), or, when
# declared as a reporting threshold, equal to the LOQ. Interval is always [LOD, LOQ]. Contradictory → no numeric result.
def dbl(value, lod=10, loq=30, meaning=None, q='detected_below_loq', **o):
    r = res(value, q, lod, loq)
    if meaning: r['valueMeaning'] = meaning
    return sample(result=r, **o)
d7 = dbl(600)
case('TR-07', 'TR-07', 'Review reproduction: detected_below_loq, value 600 µg, LOD 10, LOQ 30, 960 L; 8-h benchmark 0.5', 'twa_8h', [d7], P, bm(0.5),
     {'samples': [{'code': 'S', 'lower': None, 'upper': None, 'included': True}], 'benchmarkState': 'indeterminate', 'dataQuality': 'incomplete', 'calculationAvailability': 'none', 'flagsInclude': ['INPUT_INVALID_DBL_VALUE'], 'flagMessage': {'INPUT_INVALID_DBL_VALUE': 'value 600 ug.*LOD 10 ug, LOQ 30 ug.*above the LOQ'}},
     'Detected below the LOQ (30 µg) cannot be 600 µg: contradictory; no numeric result; no favourable assessment.',
     change14='1.4.0 ignored the value: interval 0.01042–0.03125 mg/m³, below_benchmark.')
ok7 = dbl(20); c7 = concentration(ok7)
case('TR-07a', 'TR-07', 'Valid estimate 20 µg inside [10, 30]', 'twa_8h', [ok7], P, bm(0.5),
     {'samples': [{'code': 'S', 'lower': c7['lower'], 'upper': c7['upper']}], 'results': [{'subject': 'W1', **twa([ok7], 480), 'comparison': 'below_benchmark'}], 'benchmarkState': 'below_benchmark', 'flagsInclude': ['DETECTED_BELOW_LOQ']},
     'Interval LOD–LOQ: 0.010/0.960 – 0.030/0.960 = 0.0104167 – 0.03125 mg/m³; the estimate is recorded, not used as a quantified value.')
for cid, val, flag in [('TR-07b', 10, 'DBL_VALUE_AT_LIMIT'), ('TR-07c', 30, 'DBL_VALUE_AT_LIMIT')]:
    s7x = dbl(val)
    case(cid, 'TR-07', f'Boundary: estimate {val} µg equals a limit (inclusive)', 'twa_8h', [s7x], P, bm(0.5), {'samples': [{'code': 'S', 'lower': c7['lower'], 'upper': c7['upper']}], 'flagsInclude': [flag], 'benchmarkState': 'below_benchmark'}, 'Limits are inclusive.')
for cid, desc, s7x, flag in [
    ('TR-07d', 'Estimate 9.999 µg below the LOD', dbl(9.999), 'INPUT_INVALID_DBL_VALUE'),
    ('TR-07e', 'Estimate 30.0001 µg above the LOQ', dbl(30.0001), 'INPUT_INVALID_DBL_VALUE'),
    ('TR-07f', 'LOQ missing', dbl(20, 10, None), 'INPUT_INVALID_LIMITS'),
    ('TR-07g', 'LOD equal to LOQ (30, 30)', dbl(None, 30, 30), 'INPUT_INVALID_LIMITS'),
    ('TR-07h', 'LOD above LOQ (40, 30)', dbl(None, 40, 30), 'INPUT_INVALID_LIMITS'),
    ('TR-07i', 'Declared reporting threshold 600 µg is not the LOQ', dbl(600, meaning='reporting_threshold'), 'INPUT_INVALID_DBL_VALUE'),
    ('TR-07j', 'Value declared "measured" with qualifier detected_below_loq', dbl(20, meaning='measured'), 'INPUT_INVALID_VALUE_MEANING'),
    ('TR-07k', '"<LOQ" with the value declared an estimate', dbl(20, q='<LOQ', meaning='estimate'), 'INPUT_INVALID_VALUE_MEANING')]:
    case(cid, 'TR-07', desc, 'twa_8h', [s7x], P, bm(0.5), {'samples': [{'code': 'S', 'lower': None, 'upper': None}], 'flagsInclude': [flag], 'benchmarkState': 'indeterminate'}, 'Contradictory or invalid: no numeric result, specific reason.')
th = dbl(30, meaning='reporting_threshold')
case('TR-07l', 'TR-07', 'Laboratory format with the LOQ in the value field, mapped explicitly as a reporting threshold', 'twa_8h', [th], P, bm(0.5), {'samples': [{'code': 'S', 'lower': c7['lower'], 'upper': c7['upper']}], 'benchmarkState': 'below_benchmark'}, 'Threshold = LOQ: consistent; interval LOD–LOQ.')
nv = dbl(None)
case('TR-07m', 'TR-07', 'No value (limits only)', 'twa_8h', [nv], P, bm(0.5), {'samples': [{'code': 'S', 'lower': c7['lower'], 'upper': c7['upper']}], 'benchmarkState': 'below_benchmark'}, 'Interval LOD–LOQ.')
ok_w2 = sample(sampleCode='A', subjectRef='W2')
bad = {**dbl(600, qc=QCF), 'sampleCode': 'D', 'sampleId': 'D', 'evidenceDisposition': {'kind': 'remaining_coverage_adequate', 'reason': 'Reviewer judges the other worker adequate', 'consequence': 'W1 is represented by W2 in this group', 'authorisedBy': 'Reviewer R'}}
case('TR-07n', 'TR-07', 'Contradictory record (also excluded by QC) cannot be set aside, even by a reviewer', 'twa_8h', [ok_w2, bad], P, bm(0.5),
     {'benchmarkState': 'indeterminate', 'evidenceAdequacy': 'unresolved_evidence', 'unresolved': ['D'], 'unresolvedWhy': {'D': 'contradictory or invalid inputs'}}, 'Awaits laboratory clarification; blocks a favourable overall comparison.')
bad_nr = {**bad, 'evidenceDisposition': {**bad['evidenceDisposition'], 'kind': 'not_replaced'}}
case('TR-07o', 'TR-07', 'Contradictory record recorded as not replaced: coverage gap', 'twa_8h', [ok_w2, bad_nr], P, bm(0.5), {'benchmarkState': 'indeterminate', 'evidenceAdequacy': 'coverage_gap'}, 'The worker remains unassessed.')
es = sample(result={**res(150, 'estimated'), 'valueMeaning': 'estimate'})
case('TR-07p', 'TR-07', 'Estimated 150 µg with the default meaning stated explicitly (unchanged behaviour)', 'twa_8h', [es], P, bm(0.5), {'results': [{'subject': 'W1', **twa([es], 480), 'comparison': 'below_benchmark'}], 'flagsInclude': ['ESTIMATED']}, '0.150/0.960 = 0.15625 mg/m³.')

out = {'description': 'Structured regression fixtures for engine 1.5.0. Expected values are independent of the engine (Python oracle + hand-written statuses).',
       'engine': ENGINE, 'molarVolumeLPerMol': MOLAR_VOLUME, 'comparisonRelativeTolerance': REL_TOL, 'generatedBy': 'scripts/tr/build_fixtures.py', 'cases': cases}
path = os.path.join(os.path.dirname(__file__), '..', '..', 'test', 'fixtures', 'worked-examples.fixtures.json')
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w') as f:
    json.dump(out, f, indent=1, ensure_ascii=False, allow_nan=False)
print('written', len(cases), 'cases to', os.path.normpath(path))
