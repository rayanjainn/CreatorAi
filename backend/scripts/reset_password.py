"""Set a user's password from the command line: ``make reset-password``.

    python scripts/reset_password.py                    # the only user; prompts for the password
    python scripts/reset_password.py --email me@x.com   # a specific user
    python scripts/reset_password.py --password '...'   # non-interactive (shows in shell history)

Existing sign-in tokens stay valid until they expire (JWT_TTL_DAYS); delete ``data/.secret`` to
invalidate them all. Exit code 0 on success, 1 otherwise.
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.db import migrate, session_scope
from app.models import User
from app.schemas.auth import Credentials
from app.security import hash_password


def reset_password(email: str | None, password: str) -> str:
    """Set the password and return the user's email. Raises ValueError with a friendly message."""
    Credentials(email="x@example.com", password=password)  # reuses the 8..200 character rule
    with session_scope() as db:
        users = list(db.scalars(select(User)))
        if email:
            wanted = email.strip().lower()
            matches = [u for u in users if u.email == wanted]
            if not matches:
                known = ", ".join(u.email for u in users) or "none"
                raise ValueError(f"No user with email {wanted}. Existing users: {known}")
            user = matches[0]
        elif len(users) == 1:
            user = users[0]
        elif not users:
            raise ValueError("There is no user yet. Sign up in the web app or run `make seed`.")
        else:
            raise ValueError(
                "Several users exist; pass --email (" + ", ".join(u.email for u in users) + ")"
            )
        user.password_hash = hash_password(password)
        return user.email


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--email", help="user to update (default: the only user)")
    parser.add_argument("--password", help="new password (prompted when omitted)")
    args = parser.parse_args(argv)

    password = args.password
    if password is None:
        password = getpass.getpass("New password (min 8 characters): ")
        if password != getpass.getpass("Repeat it: "):
            print("Passwords do not match.", file=sys.stderr)
            return 1
    migrate()
    try:
        email = reset_password(args.email, password)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # pydantic validation of the password
        print(
            f"Error: password rejected ({exc.__class__.__name__}): use 8 to 200 characters.",
            file=sys.stderr,
        )
        return 1
    print(f"Password updated for {email}. Sign in with it now.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
