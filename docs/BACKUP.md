# Backup and restore plan

**What matters:** the PostgreSQL database holds everything (users, leads, the append-only activity history, settings, reminder log). The containers are disposable; the secrets in `.env.production` are the only other thing to keep, in a password manager.

## Targets

|                                    | Target                                         | How                                                                   |
| ---------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| Recovery point (data you can lose) | up to 24 hours                                 | nightly `pg_dump`; tighten by running it more often                   |
| Recovery time (time to be back up) | about an hour, mostly a human finding the file | restore into a new database, point the API at it                      |
| Retention                          | 14 daily files on the host, longer off-host    | `KEEP_DAYS` (default 14); keep monthly copies off-host as you see fit |

If your host offers a managed PostgreSQL with point-in-time recovery, use it **in addition**: it gives a much smaller recovery point. The dump below still protects against account-level mistakes and gives you a portable copy.

## Making a backup

`scripts/backup.sh` writes a compressed custom-format dump (`pg_dump --format=custom`), proves it is readable (`pg_restore --list`), then prunes files older than `KEEP_DAYS`. It exits non-zero on any failure and never leaves a half-written file under the final name.

```
DATABASE_URL=postgresql://leadbook:PASSWORD@HOST:5432/leadbook BACKUP_DIR=/var/backups/leadbook KEEP_DAYS=14 scripts/backup.sh
```

Run it from the host's scheduler, for example (cron, 02:30 daily):

```
30 2 * * * cd /opt/leadbook && DATABASE_URL=... BACKUP_DIR=/var/backups/leadbook scripts/backup.sh >> /var/log/leadbook-backup.log 2>&1
```

With the supplied Compose file, run it from a container that has the PostgreSQL 16 client tools on the Compose network, for instance `docker compose ... exec postgres pg_dump ...`, or install `postgresql-client-16` on the host (the client must be the same major version as the server, or newer).

**A backup that only exists on the database host is not a backup.** Copy `BACKUP_DIR` to separate storage (another machine or an object store) after each run, and make the copy encrypted if the storage is not yours alone: the dump contains customer names, phone numbers and password hashes.

**Alert on failure:** make the scheduler email or page on a non-zero exit, and on a missing new file (check the newest file's age).

## Restoring

1. Create an **empty** database (new name, or drop and recreate): `createdb leadbook_restored`.
2. `DATABASE_URL=postgresql://.../leadbook_restored scripts/restore.sh /path/to/leadbook-YYYYMMDDTHHMMSSZ.dump`. The script refuses a database that already has tables, so it cannot overwrite live data.
3. Run the migrations command from [DEPLOY.md](DEPLOY.md) against it. If the dump is from an older release this brings the schema up to date; if not it does nothing.
4. Point the API's `DATABASE_URL` at the restored database, restart, check `/health` and a few leads.
5. Keep the damaged database until you are sure.

Verified in the sandbox on PostgreSQL 16: a seeded database was dumped and restored to a second database with identical row counts, the append-only triggers on the activity history were intact, and the migration command was a no-op afterwards.

## Drill

Once a month restore the latest off-host copy into a scratch database and compare a few counts (`select count(*) from leads, activities, users`). A backup you have never restored is a hope, not a plan. Record the date and result somewhere your team will see it.

## Not covered

- Changes since the last dump (see the recovery point above).
- Secrets: `.env.production`, the WhatsApp credentials. Keep them in a password manager.
- Logs are not backed up; the activity history in the database is the business record.
