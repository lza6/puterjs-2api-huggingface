# app.py
# This is the main entrypoint for the Hugging Face Gradio SDK.
# Its sole purpose is to act as a launcher for our real application,
# which is managed by the start.sh script.

import os
import subprocess
import sys

print("--- Python Launcher (app.py) is starting ---", flush=True)

# Path to the startup script
start_script = "./start.sh"

# Check if the script exists
if not os.path.exists(start_script):
    print(f"!!! ERROR: Startup script not found at {start_script}", file=sys.stderr, flush=True)
    sys.exit(1)

# Make sure the script is executable
try:
    # Using subprocess.run for better error handling
    subprocess.run(["chmod", "+x", start_script], check=True)
    print(f"--- Made {start_script} executable ---", flush=True)
except subprocess.CalledProcessError as e:
    print(f"!!! ERROR: Failed to make startup script executable: {e}", file=sys.stderr, flush=True)
    sys.exit(1)
except FileNotFoundError:
    print(f"!!! ERROR: 'chmod' command not found. The environment is missing basic tools.", file=sys.stderr, flush=True)
    sys.exit(1)

print(f"--- Handing over control to {start_script} ---", flush=True)

# Use os.execv to replace the current Python process with the bash script.
# This is the most robust way to make the script the main process of the container.
# It ensures that signals (like stop/restart) from the Hugging Face platform
# are sent directly to the workerd process.
try:
    # The first argument is the path to the executable, the second is the list of arguments,
    # starting with the program name itself.
    args = ["/bin/bash", start_script]
    os.execv(args[0], args)
except FileNotFoundError:
    print(f"!!! ERROR: /bin/bash not found. Cannot execute startup script.", file=sys.stderr, flush=True)
    sys.exit(1)

# The following lines will never be reached if execv is successful.
print("!!! FATAL ERROR: os.execv failed. The launcher is still running.", file=sys.stderr, flush=True)
sys.exit(1)
