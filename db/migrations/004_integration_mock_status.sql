alter table integration_outbox drop constraint integration_outbox_status_check;
alter table integration_outbox add constraint integration_outbox_status_check
  check (status in ('pending','delivered','failed','dead','mock_recorded'));
comment on column integration_outbox.status is 'mock_recorded = accepted by a labelled mock transport; nothing was transmitted to another product';
