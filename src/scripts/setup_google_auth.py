from __future__ import annotations
import os
import sys
from pathlib import Path

# Add src to python path to resolve imports correctly when running as standalone script
sys.path.append(str(Path(__file__).resolve().parents[2]))

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
except ModuleNotFoundError:
    print("Missing Python dependencies (google-auth-oauthlib).")
    print("")
    print("Use the project virtualenv:")
    print("  ./scripts/setup-google-auth.sh")
    print("")
    print("Or manually:")
    print("  python3 -m venv .venv")
    print("  source .venv/bin/activate")
    print("  pip install -r requirements.txt")
    print("  python src/scripts/setup_google_auth.py")
    sys.exit(1)
from src.config import settings, setup_logging

logger = setup_logging()

from src.google_service import SCOPES


def resolve_local_path(configured_path: str) -> Path:
    """Map container-style /app paths to the local project tree when running on the host."""
    path = Path(configured_path)
    if path.exists():
        return path

    project_root = Path(__file__).resolve().parents[2]
    app_prefix = Path("/app")

    if path.is_absolute():
        try:
            relative_to_app = path.relative_to(app_prefix)
        except ValueError:
            return path

        candidate = project_root / relative_to_app
        if candidate.exists() or candidate.parent.exists():
            return candidate

    return path


def run_interactive_auth() -> None:
    """Invokes standard 3-legged OAuth flow to generate a valid refreshable token.json."""
    # Google may return equivalent Classroom scope aliases (for example
    # coursework vs student-submissions variants). Relax exact string
    # matching so the local setup flow does not fail on equivalent grants.
    os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

    secret_file = resolve_local_path(settings.GOOGLE_CLIENT_SECRET_FILE)
    token_file = resolve_local_path(settings.GOOGLE_TOKEN_FILE)

    print("=" * 70)
    print("        GOOGLE CLASSROOM OAUTH SERVICE CREDENTIAL GENERATOR        ")
    print("=" * 70)
    print(f"Targeting Credentials Secret: {secret_file}")
    print(f"Destination OAuth Token:     {token_file}")
    print("-" * 70)

    # Pre-verification guards
    if not os.path.exists(secret_file):
        logger.error(f"Google secret file not found at: {secret_file}")
        print("\n❌ CRITICAL ERROR: 'client_secret.json' is missing!")
        print(f"Please download your Web App OAuth Credentials JSON from the Google Cloud Console")
        print(f"and place it at: '{secret_file}' before running this setup script.\n")
        sys.exit(1)

    # Ensure parent structures exist
    Path(token_file).parent.mkdir(parents=True, exist_ok=True)

    print("\nStarting Desktop Auth flow on local device server...")
    print("A browser window will open shortly requesting you to sign in with your Google Workspace.")
    print("Please confirm your scopes consent on the authorization prompt.\n")

    try:
        # Standard Desktop redirection authorization flow
        flow = InstalledAppFlow.from_client_secrets_file(
            secret_file,
            scopes=SCOPES
        )
        
        # Runs a local server on high port (e.g. 5000-9000 or arbitrary port) to catch callback redirects.
        creds = flow.run_local_server(
            host="localhost",
            port=0,
            authorization_prompt_message="Completing Authorization... Please review the web window",
            success_message="SUCCESS! Your token.json has been written. You can now close this browser window."
        )

        # Write credential strings
        with open(token_file, "w") as token_fp:
            token_fp.write(creds.to_json())

        logger.info(f"Token acquired. Credentials saved successfully at '{token_file}'")
        print("\n" + "=" * 70)
        print("🎉 OAUTH COMPLETED SUCCESSFULLY!")
        print("=" * 70)
        print(f"Token file successfully generated at: {token_file}")
        print("Your background docker service will capture this volume to authenticate automagically.\n")

    except Exception as e:
        logger.critical(f"OAuth sequence failed: {e}")
        print(f"\n❌ OAuth sequence aborted with failure details: {e}")
        print("Double-check your credentials/client_secret.json parameters or network settings.\n")
        sys.exit(1)


if __name__ == "__main__":
    run_interactive_auth()
