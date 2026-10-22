// How each sample was used in a calculation output: kept separate so a report never says only "Used: yes".
export function usage(out: any, s: any): { calculation: string; formal: string } {
  const shifts = out?.shifts ?? [];
  const inCalc = shifts.some((sh: any) => sh.result && sh.sampleCodes?.includes(s.sampleCode));
  const inFormal = shifts.some((sh: any) => sh.result && sh.comparison && !sh.indicative && sh.sampleCodes?.includes(s.sampleCode));
  const why = s.sampleType === 'static' ? 'context only (static)' : s.sampleType === 'field_blank' ? 'QC only (blank)'
    : !s.included ? 'excluded' : !s.concentration ? 'not calculable' : s.indicative ? 'indicative only' : 'result not calculated';
  return { calculation: inCalc ? 'Yes' : `No — ${why}`, formal: inFormal ? 'Yes' : inCalc ? `No — ${s.indicative ? 'indicative only' : 'not compared'}` : 'No' };
}
