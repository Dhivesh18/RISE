# RISE Gemini Hackathon Prototype

## Current scope
This branch adds a selectable Gemini provider to the existing FastAPI Assist chat endpoint. It does **not** claim Gemini Enterprise integration, Gemini Live voice, verified skills, or production deployment.

## Setup
1. Install dependencies from `backend/requirements.txt`.
2. Create `backend/.env` using `backend/.env.example`.
3. Set `RISE_AI_PROVIDER=gemini`, `GEMINI_API_KEY` and an available `GEMINI_MODEL`.
4. Run `uvicorn main:app --reload --port 8001` inside `backend/`.
5. Run the frontend in `web/` using `npm run dev`.
6. Scan or enter a seeded asset ID such as `HVAC-024` and ask a maintenance question using typed Assist.

## Important limitations
- The existing live voice and transcription endpoints still use OpenAI and need separate Gemini migration.
- The local playbook fallback is returned if Gemini is not configured or the request fails. Inspect the `provider` field in `/api/assist/chat` to verify that a response actually came from `gemini`.
- Do not describe the existing severity-based work-order score as supervisor-verified skill evidence.
- AI advice is decision support; technicians must follow OEM/site procedures and lockout/tagout.
- Never commit real API keys or user data.
- Validate current hackathon rules, required Google products, existing-code eligibility and submission deadlines with organizers.

## Suggested demo
QR/asset lookup → describe observed fault → Gemini-assisted safe triage → create work order → supervisor review (future enhancement).

## Acceptance checks before final submission
- [ ] Gemini response returns `provider: gemini` with a valid key.
- [ ] No-key behavior is clearly labeled local mode.
- [ ] Frontend chat works end to end.
- [ ] Tests and lint pass.
- [ ] Verify Google platform eligibility.
- [ ] Record a real 1–2 minute demonstration.
