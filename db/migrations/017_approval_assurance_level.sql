-- Phase H1 review fix: record the organisation's assurance level at approval, so an issued report states whether the
-- conclusion was approved under an authorised pilot, independent of the organisation's level when the report is issued.
alter table assessment_revisions add column assurance_level_at_approval text
  check (assurance_level_at_approval in ('demo','evaluation','pilot'));
