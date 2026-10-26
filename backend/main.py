from contextlib import asynccontextmanager
from datetime import datetime, timezone
import os
from typing import Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import httpx
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, Float, ForeignKey, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker
from dotenv import load_dotenv
from assist import create_assist_reply, resolve_spoken_language, transcribe_audio


load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./rise.db")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Asset(Base):
    __tablename__ = "assets"

    asset_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    site: Mapped[str] = mapped_column(String(200))
    issue: Mapped[str] = mapped_column(String(120))
    note: Mapped[str] = mapped_column(Text)
    work_orders: Mapped[list["WorkOrder"]] = relationship(back_populates="asset_record")


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.asset_id"), index=True)
    site: Mapped[str] = mapped_column(String(200))
    issue: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(20))
    technician: Mapped[str] = mapped_column(String(160))
    skill: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    asset_record: Mapped[Asset] = relationship(back_populates="work_orders")


class WorkOrderCreate(BaseModel):
    assetId: str = Field(min_length=1, max_length=80)
    site: str = Field(min_length=1, max_length=200)
    issue: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=5000)
    severity: str = Field(pattern="^(Low|Medium|High|Critical)$")
    technician: str = Field(min_length=1, max_length=160)


class AssetCreate(BaseModel):
    assetId: str = Field(min_length=1, max_length=80)
    site: str = Field(min_length=1, max_length=200)
    issue: str = Field(min_length=1, max_length=120)
    note: str = Field(min_length=1, max_length=3000)


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class AssistContext(BaseModel):
    assetId: str = Field(default="", max_length=80)
    site: str = Field(default="", max_length=200)
    issue: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=3000)
    severity: str = Field(default="Medium", max_length=20)


class AssistRequest(BaseModel):
    messages: list[ChatTurn] = Field(min_length=1, max_length=20)
    context: AssistContext = Field(default_factory=AssistContext)
    responseLanguage: str = Field(default="auto", pattern=r"^(auto|[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*)$", max_length=35)
    responseStyle: Literal["text", "spoken"] = "text"


class RealtimeSessionRequest(BaseModel):
    context: AssistContext


ASSET_SEEDS = (
    {
        "asset_id": "HVAC-024",
        "site": "North Tower - Floor 4",
        "issue": "Cooling performance",
        "note": "Unit is running but airflow is reduced and the compressor takes too long to recover after startup.",
    },
    {
        "asset_id": "ELEC-118",
        "site": "Distribution Room 2",
        "issue": "Electrical fault",
        "note": "Breaker trips after 90 seconds under full load.",
    },
    {
        "asset_id": "PUMP-54",
        "site": "Water Treatment Plant",
        "issue": "Water leakage",
        "note": "Pump output is unstable with visible leakage around the mechanical seal.",
    },
)


def seed_assets() -> None:
    with SessionLocal() as session:
        for asset_data in ASSET_SEEDS:
            if session.get(Asset, asset_data["asset_id"]) is None:
                session.add(Asset(**asset_data))
        session.commit()


def work_order_payload(work_order: WorkOrder) -> dict[str, object]:
    return {
        "asset": work_order.asset_id,
        "technician": work_order.technician,
        "issue": work_order.issue,
        "severity": work_order.severity,
        "skill": round(work_order.skill),
        "site": work_order.site,
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    seed_assets()
    yield


app = FastAPI(title="Rise API", version="0.1.0", lifespan=lifespan)
origins = os.getenv("RISE_CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in origins],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/assets/{asset_id}")
def get_asset(asset_id: str) -> dict[str, str]:
    with SessionLocal() as session:
        asset = session.get(Asset, asset_id)
        if asset is None:
            raise HTTPException(status_code=404, detail="Asset not found")
        return {
            "assetId": asset.asset_id,
            "site": asset.site,
            "issue": asset.issue,
            "note": asset.note,
        }


@app.post("/api/assets", status_code=201)
def register_asset(payload: AssetCreate) -> dict[str, str | bool]:
    with SessionLocal() as session:
        asset = session.get(Asset, payload.assetId)
        created = asset is None
        if asset is None:
            asset = Asset(
                asset_id=payload.assetId,
                site=payload.site,
                issue=payload.issue,
                note=payload.note,
            )
            session.add(asset)
        else:
            asset.site = payload.site
            asset.issue = payload.issue
            asset.note = payload.note
        session.commit()
        return {
            "assetId": asset.asset_id,
            "site": asset.site,
            "issue": asset.issue,
            "note": asset.note,
            "created": created,
        }


@app.get("/api/work-orders")
def list_work_orders() -> list[dict[str, object]]:
    with SessionLocal() as session:
        orders = session.scalars(select(WorkOrder).order_by(WorkOrder.id.desc()).limit(100)).all()
        return [work_order_payload(order) for order in orders]


@app.post("/api/work-orders", status_code=201)
def create_work_order(payload: WorkOrderCreate) -> dict[str, object]:
    with SessionLocal() as session:
        asset = session.get(Asset, payload.assetId)
        if asset is None:
            asset = Asset(
                asset_id=payload.assetId,
                site=payload.site,
                issue=payload.issue,
                note=payload.description,
            )
            session.add(asset)
            session.flush()
        skill = {"Low": 70, "Medium": 78, "High": 86, "Critical": 92}[payload.severity]
        order = WorkOrder(
            asset_id=payload.assetId,
            site=payload.site,
            issue=payload.issue,
            description=payload.description,
            severity=payload.severity,
            technician=payload.technician,
            skill=skill,
        )
        session.add(order)
        session.commit()
        session.refresh(order)
        return work_order_payload(order)


@app.post("/api/assist/chat")
async def assist_chat(payload: AssistRequest) -> dict[str, str]:
    messages = [message.model_dump() for message in payload.messages]
    context = payload.context.model_dump()
    last_user_message = next(
        (message["content"] for message in reversed(messages) if message["role"] == "user"),
        "",
    )
    _, detected_locale = resolve_spoken_language("", last_user_message)
    try:
        reply, provider = await create_assist_reply(
            messages,
            context,
            payload.responseLanguage,
            payload.responseStyle,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    locale = detected_locale if payload.responseLanguage == "auto" else payload.responseLanguage
    return {"reply": reply, "provider": provider, "locale": locale}


@app.post("/api/assist/transcribe")
async def assist_transcribe(audio: UploadFile = File(...)) -> dict[str, str]:
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=415, detail="Upload an audio recording.")
    content = await audio.read(15 * 1024 * 1024 + 1)
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Recording is too large. Please speak a shorter question.")
    if not content:
        raise HTTPException(status_code=400, detail="Recording is empty. Please try again.")
    try:
        return await transcribe_audio(content, audio.content_type, audio.filename or "question.webm")
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.post("/api/assist/realtime/session")
async def create_realtime_session(payload: RealtimeSessionRequest) -> dict[str, str]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="OpenAI voice is not configured on the server.")

    context = payload.context
    instructions = (
        "You are Rise, a calm, helpful maintenance technician assistant speaking directly to a technician. "
        "Have a natural, back-and-forth voice conversation. Detect the language the user speaks and reply in that same language; "
        "do not default to English or Hindi when the user speaks Tamil. Speak in clear, connected sentences, not numbered lists or headings. "
        "Explain what to check and why, and ask one short follow-up question when information is missing. "
        "Use the supplied asset context as context, not proof that any part has failed. "
        "When an image is provided, describe only visible details and distinguish observation from diagnosis. Do not infer hidden faults, identify people, or recommend hazardous work based only on an image. Ask for safe readings or qualified inspection when needed. "
        "Never advise live electrical work, bypassing interlocks, or ignoring lockout/tagout or OEM/site procedures. "
        "For hazards, prioritize isolation and qualified personnel. This is decision support, not an approved service procedure.\n\n"
        f"Current asset: {context.assetId or 'not identified'}\n"
        f"Site: {context.site or 'not provided'}\n"
        f"Asset / issue type: {context.issue or 'not provided'}\n"
        f"Known asset note: {context.description or 'none'}\n"
        f"Severity: {context.severity}"
    )
    session_config = {
        "expires_after": {"anchor": "created_at", "seconds": 600},
        "session": {
            "type": "realtime",
            "model": os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1"),
            "instructions": instructions,
            "output_modalities": ["audio"],
            "audio": {
                "input": {
                    "noise_reduction": {"type": "near_field"},
                    "transcription": {"model": "gpt-4o-mini-transcribe"},
                    "turn_detection": {"type": "semantic_vad", "eagerness": "medium"},
                },
                "output": {"voice": "marin"},
            },
        },
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/realtime/client_secrets",
                headers={"Authorization": f"Bearer {api_key}"},
                json=session_config,
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="Could not connect to OpenAI Realtime.") from error

    if response.is_error:
        raise HTTPException(status_code=502, detail="OpenAI could not create a Realtime voice session.")
    data = response.json()
    secret = data.get("value")
    session_id = (data.get("session") or {}).get("id")
    if not secret or not session_id:
        raise HTTPException(status_code=502, detail="OpenAI returned an incomplete Realtime session.")
    return {"clientSecret": secret, "sessionId": session_id}