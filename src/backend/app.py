import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.backend.agent.config import build_harness
from src.backend.api.agent_routes import router as agent_router
from src.backend.api.review_routes import router as review_router
from src.backend.api.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.agent_harness = None
    if os.environ.get("AGENT_HARNESS_ENABLED") == "1":
        harness = build_harness()
        # Migrations are explicit. Startup fails clearly if storage is unavailable
        # or another harness worker already owns recovery/execution.
        harness.store.start()
        app.state.agent_harness = harness
        try:
            yield
        finally:
            harness.store.close()
            app.state.agent_harness = None
    else:
        yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(review_router)
app.include_router(agent_router)
