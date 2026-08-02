#!/usr/bin/env python3
"""Shut the container down when a program cannot be started.

supervisord restarts a program that stops, but gives up after startretries and
marks it FATAL. It then keeps running, because the other program is still alive,
so the container stays up with a dead API inside it and never recovers.

Docker's healthcheck does notice, since /health is proxied to the API, but
"unhealthy" is only a label: `restart: unless-stopped` restarts a container that
*exits*, not one that is merely unhealthy. So the practical outcome was a
dashboard that was down, a container that looked like it was running, and
nothing to recover it until someone noticed.

This listens for a program entering FATAL and stops supervisord, so the container
exits and Docker's restart policy applies.

If the API can never start, for example because of an unwritable data volume,
this produces a restart loop. That is the right outcome for an unfixable problem:
Docker backs restarts off, the failure is in the logs and in the restart count,
and the alternative is the same problem staying invisible.
"""
import os
import signal
import sys

# Read by docker-entrypoint.sh after supervisord exits.
FAILURE_MARKER = os.environ.get('SUPERVISOR_FATAL_MARKER', '/tmp/stackyard-fatal')


def write_stdout(s):
    sys.stdout.write(s)
    sys.stdout.flush()


def write_stderr(s):
    sys.stderr.write(s)
    sys.stderr.flush()


def main():
    while True:
        # The listener protocol: say ready, read one header line, read the
        # payload it describes, then acknowledge.
        write_stdout('READY\n')
        line = sys.stdin.readline()
        if not line:
            return
        headers = dict(pair.split(':', 1) for pair in line.split() if ':' in pair)

        payload = sys.stdin.read(int(headers.get('len', 0)))
        data = dict(pair.split(':', 1) for pair in payload.split() if ':' in pair)

        if headers.get('eventname') == 'PROCESS_STATE_FATAL':
            name = data.get('processname', 'unknown')
            write_stderr(
                'exit-on-fatal: %s could not be started and supervisord has given up. '
                'Stopping so the container exits and its restart policy applies.\n' % name
            )
            write_stdout('RESULT 2\nOK')
            # supervisord always exits 0 on SIGTERM, so a marker file carries
            # the failure out to the entrypoint, which turns it into the
            # container's exit code. Without that the container would report a
            # clean stop: `restart: unless-stopped` restarts on any exit so it
            # would still recover, but someone using `on-failure` would get no
            # restart at all, and `docker ps` would describe a dead API as a
            # normal shutdown.
            try:
                with open(FAILURE_MARKER, 'w') as fh:
                    fh.write(name)
            except OSError:
                pass  # the exit still happens; only the exit code is lost

            # SIGTERM to supervisord rather than supervisorctl: it needs no
            # XML-RPC interface enabled and nothing extra on PATH.
            os.kill(os.getppid(), signal.SIGTERM)
            sys.exit(1)

        write_stdout('RESULT 2\nOK')


if __name__ == '__main__':
    main()
