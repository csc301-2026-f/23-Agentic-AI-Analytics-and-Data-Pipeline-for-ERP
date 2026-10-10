# Run the app locally

## Start both servers with one command

From the repository root, run this in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\src\start-dev.ps1
```

The script checks the Python dependencies, installs them from `requirements.txt`
if needed, starts the FastAPI backend, and waits for its health check before
opening a PowerShell window for the Next.js frontend. Leave both windows open
while using the app. Open the frontend URL printed by Next.js, usually
<http://localhost:3000/>.

## Start the servers manually

Open two PowerShell terminals.

In the first terminal, from the repository root:

```powershell
python -m uvicorn src.backend.app:app --reload
```

In the second terminal, from the repository root:

```powershell
cd .\src\frontend
npm install
npm run dev
```

If the Python dependencies have not been installed yet, run this once from the
repository root:

```powershell
python -m pip install -r requirements.txt
```

The frontend forwards `/api` requests to the backend at `http://127.0.0.1:8000`.
Keep the backend terminal running while using the chat.
