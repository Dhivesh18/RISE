# Rise

Rise is a frontline workforce intelligence platform that turns work into measurable capability.

## Vision
Rise helps facilities, hospitality, manufacturing, and service teams convert every maintenance job, technician interaction, and outcome into structured intelligence for:

- faster diagnostics
- better skill visibility
- training recommendations
- workforce optimization
- verified worker passports

## Core idea
Work is not just activity. It is a source of skill data.

Every technician interaction becomes a signal:

- problem diagnosed
- action taken
- outcome achieved
- skill demonstrated
- training gap identified

## Brand positioning
Rise — Workforce Intelligence, Skills, Training & Advancement

## Product modules
- Pulse: workforce intelligence dashboard
- Assist: AI frontline work assistant
- Skills: capability and skill graph
- Learn: contextual upskilling
- Passport: verified worker profile

## Goals
1. Reduce MTTR and downtime
2. Improve first-time fix rates
3. Identify skill gaps early
4. Turn frontline work into a learning engine
5. Build a portable worker capability layer

## Target market
- facilities management
- hotels
- hospitals
- manufacturing
- retail operations
- warehousing

## Roadmap
### Phase 1
QR asset access and technician issue capture

### Phase 2
AI-assisted diagnostics and job intake

### Phase 3
Skill extraction and training recommendations

### Phase 4
Workforce analytics and skill passport

### Phase 5
Talent marketplace and workforce optimization

## Stack recommendation
- Frontend: React or Next.js
- Backend: Python + FastAPI
- Database: PostgreSQL
- Automation: n8n
- AI: LLM APIs, speech-to-text, TTS
- Knowledge: RAG and vector search
- Analytics: Metabase

## Starting point
The first product should solve one real problem: helping a technician capture a maintenance issue, get guided assistance, and convert the outcome into skill intelligence.

## Run the Rise web prototype
The Next.js app is in `web/`; the FastAPI service is in `backend/`.

1. In `backend/`, create and activate a virtual environment, then install `requirements.txt`.
2. Start the API with `uvicorn main:app --reload --port 8001` from `backend/`. Without `DATABASE_URL`, local development uses SQLite and creates `rise.db` automatically.
3. To use PostgreSQL, copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL` to your local or hosted PostgreSQL connection string.
4. In `web/`, run `npm run dev` and open `http://localhost:3000`. Camera access requires localhost or HTTPS and browser permission.

The API exposes `GET /health`, asset lookup/registration, work-order listing/creation, `POST /api/assist/chat`, `POST /api/assist/transcribe`, and `POST /api/assist/realtime/session`. New job begins with only QR scanning or asset-ID entry; asset details and Assist appear after a successful lookup. **Start live voice** uses OpenAI Realtime over WebRTC for direct, low-latency speech-to-speech with server-side turn detection and interruption support. FastAPI keeps the permanent `OPENAI_API_KEY` server-side and returns only a short-lived Realtime client secret to the browser. The Realtime model defaults to `gpt-realtime-2.1`; set `OPENAI_REALTIME_MODEL` in `backend/.env` to override it. Typed chat remains available and uses the regular Assist endpoint. Realtime voice requires an OpenAI project with Realtime model access, an API key in `backend/.env`, browser microphone permission, and localhost or HTTPS. Chat/audio is sent to OpenAI for processing. Assistant output is decision support, not an approved service procedure.

## Mission
Turn frontline work into measurable capability and career growth.
