# Run the app locally

## Run the D2 mock report-definition demo

From the repository root, start the frontend-only demo in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\src\start-dev.ps1
```

This starts Next.js with `REVIEW_DEMO_MODE=mock`; it does not read the root
`.env`, start FastAPI, or connect to a database. Open:

- Business user: <http://127.0.0.1:3000/demo>
- Data engineer: <http://127.0.0.1:3000/review>

## Start the full app manually

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
