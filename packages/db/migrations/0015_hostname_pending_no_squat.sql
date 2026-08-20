-- Pending custom hostnames must not globally squat a name another school will verify.
-- Uniqueness of *resolved* tenants remains: one verified+active hostname at a time.

alter table organisation_hostnames
  drop constraint if exists organisation_hostnames_hostname_key;

create unique index if not exists organisation_hostnames_active_hostname_idx
  on organisation_hostnames (hostname)
  where is_active = true and verification_status = 'verified';
