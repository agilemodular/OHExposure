-- Molecular weight enables ppm ↔ mg/m³ conversion at reference conditions; recorded per substance with its source.
alter table substances add column molecular_weight numeric check (molecular_weight is null or molecular_weight > 0);
alter table substances add column molecular_weight_source text;
alter table assessment_revisions add constraint assessment_revisions_calc_code_check check (calc_code is null or calc_code in ('twa_8h','stel_15'));
